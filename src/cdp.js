'use strict';
// 极简 CDP 客户端（只用 Node 内置 WebSocket，无三方依赖）
// 事实：Antigravity 主进程默认 appendSwitch('remote-debugging-port','0')，
// 实际端口写在 <userData>/DevToolsActivePort；主动传 --remote-debugging-port=9222 可固定端口。
const http = require('http');
const { readDevToolsActivePort } = require('./paths');

function httpJson(port, pathName) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path: pathName, timeout: 4000 }, (res) => {
      const c = [];
      res.on('data', d => c.push(d));
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(c).toString('utf8'))); }
        catch (e) { reject(e); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('cdp http timeout')));
    req.on('error', reject);
  });
}

async function listTargets(port) { return httpJson(port, '/json/list'); }
async function version(port) { return httpJson(port, '/json/version'); }

/** 严格校验：只有 UA 里带 Antigravity/ 的 CDP 才是我们要注入的客户端
 *  （实测坑：本机 WorkBuddy 自己也占用 9222，盲连会把 UI 注入到宿主应用里） */
async function isAntigravityPort(port) {
  try {
    const v = await version(port);
    return !!(v && /Antigravity\//i.test(v['User-Agent'] || ''));
  } catch (_) { return false; }
}

function pickPage(targets, allowAny = false) {
  const pages = (targets || []).filter(t =>
    t.type === 'page' && !/^(devtools|chrome-extension|chrome):\/\//i.test(t.url || ''));
  // 端口已经过 UA 校验，allowAny 时允许落到登录/引导页（那里没有 __APP_CONFIG__）
  return pages.find(t => /^https:\/\/127\.0\.0\.1/.test(t.url))
    || pages.find(t => /^https?:\/\/127\.0\.0\.1/.test(t.url))
    || pages.find(t => /Antigravity/.test(t.title || ''))
    || (allowAny ? (pages[0] || null) : null);
}

class Cdp {
  constructor({ port, wsUrl }) {
    this.port = port;
    this.wsUrl = wsUrl;
    this.ws = null;
    this.seq = 0;
    this.waiters = new Map();
    this.listeners = new Set();
    this.targetUrl = null;
  }

  static async resolvePort(preferred = 9333) {
    // 1) 固定端口（由我们的启动器注入，且必须是 Antigravity 自己的 CDP）
    if (preferred && await isAntigravityPort(preferred)) return preferred;
    // 2) 官方自选端口（主进程默认 appendSwitch('remote-debugging-port','0')）
    const rec = readDevToolsActivePort();
    if (rec && rec.port && await isAntigravityPort(rec.port)) return rec.port;
    return null;
  }

  static async attach(preferredPort = 9333) {
    const port = await Cdp.resolvePort(preferredPort);
    if (!port) throw new Error('未找到 Antigravity 的 CDP 端口（客户端未运行，或调试端口被其它应用占用）');
    const targets = await listTargets(port);
    const page = pickPage(targets, true);
    if (!page || !page.webSocketDebuggerUrl) throw new Error('未找到可注入的渲染进程目标');
    const cdp = new Cdp({ port, wsUrl: page.webSocketDebuggerUrl });
    cdp.targetUrl = page.url;
    await cdp.connect();
    // 端口身份已由 isAntigravityPort 用 /json/version 的 UA 校验过，
    // 且优先取自官方 DevToolsActivePort，渲染进程归属已经可信。
    // 这里只读取页面自报信息用于判断「LS 是否就绪」，不再因页面缺少
    // __APP_CONFIG__ 而拒绝注入：官方 2.30 更新后会停在
    // /onboarding?login=true，此时 productName=null、title 为空，
    // 旧逻辑会把整个面板一起挡掉（实测 2026-11-12）。
    // 仅当页面明确自报为「别的产品」时才断开，防误注入宿主应用。
    try {
      const id = await cdp.eval(`JSON.stringify({p: (window.__APP_CONFIG__||{}).productName||null, t: document.title||'', href: location.href})`);
      const info = JSON.parse(id || '{}');
      cdp.pageIdentity = info;
      cdp.lsReady = info.p === 'antigravity';
      const foreign = info.p && info.p !== 'antigravity' && !/antigravity/i.test(info.href || '');
      if (foreign) {
        cdp.close();
        throw new Error('目标页面不是 Antigravity（productName=' + info.p + ', title=' + info.t + '）');
      }
    } catch (e) {
      if (/不是 Antigravity/.test(e.message)) throw e;
    }
    return cdp;
  }

  connect() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.wsUrl);
      this.ws = ws;
      const onErr = (e) => reject(new Error('CDP 连接失败: ' + (e && e.message || 'unknown')));
      ws.addEventListener('open', () => {
        ws.removeEventListener('error', onErr);
        resolve(this);
      }, { once: true });
      ws.addEventListener('error', onErr, { once: true });
      ws.addEventListener('message', (ev) => {
        let msg;
        try { msg = JSON.parse(ev.data); } catch (_) { return; }
        if (msg.id && this.waiters.has(msg.id)) {
          const { resolve: r, reject: j } = this.waiters.get(msg.id);
          this.waiters.delete(msg.id);
          if (msg.error) j(new Error(msg.error.message || JSON.stringify(msg.error)));
          else r(msg.result);
        } else if (msg.method) {
          for (const l of this.listeners) { try { l(msg); } catch (_) { } }
        }
      });
      ws.addEventListener('close', () => {
        for (const { reject: j } of this.waiters.values()) j(new Error('CDP 连接已关闭'));
        this.waiters.clear();
      });
    });
  }

  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  isAlive() { return !!(this.ws && this.ws.readyState === 1); }

  send(method, params = {}) {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.waiters.set(id, { resolve, reject });
      try { this.ws.send(JSON.stringify({ id, method, params })); }
      catch (e) { this.waiters.delete(id); reject(e); }
      setTimeout(() => {
        if (this.waiters.has(id)) { this.waiters.delete(id); reject(new Error(`CDP ${method} 超时`)); }
      }, 30000);
    });
  }

  /** 执行表达式并取回值；表达式需自行 return/为 IIFE */
  async eval(expression, { awaitPromise = true } = {}) {
    const r = await this.send('Runtime.evaluate', {
      expression, returnByValue: true, awaitPromise, allowUnsafeEvalBlockedByCSP: true,
    });
    if (r.exceptionDetails) {
      const d = r.exceptionDetails;
      throw new Error('页面异常: ' + (d.exception && d.exception.description || d.text));
    }
    return r.result ? r.result.value : undefined;
  }

  async screenshot(filePath) {
    const r = await this.send('Page.captureScreenshot', { format: 'png' });
    require('fs').writeFileSync(filePath, Buffer.from(r.data, 'base64'));
    return filePath;
  }

  close() { try { this.ws && this.ws.close(); } catch (_) { } }
}

module.exports = { Cdp, listTargets, version, pickPage };
