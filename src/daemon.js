'use strict';
// Antigravity Daddy 守护进程：本地 HTTP API（给注入层调用）+ CDP 注入管理 + LS RPC 桥
// 设计原则：不写官方任何文件；所有状态只落在 %LOCALAPPDATA%\AGY-Daddy（内部数据目录代号，保持不变）
const http = require('http');
const fs = require('fs');
const path = require('path');
const P = require('./paths');
const store = require('./store');
const rpc = require('./rpc');
const accountsApi = require('./accounts');
const quotaApi = require('./quota');
const { Cdp } = require('./cdp');

const PORT = Number(process.env.AGYD_PORT || 8787);
const HOST = '127.0.0.1';
const INJECT_UI = path.join(__dirname, 'inject', 'ui.js');

let cdp = null;
let lsInfo = { port: null, csrf: null, version: null, attached: false, target: null };
let quotaCache = null;
let injecting = false;

P.ensureDir(P.DATA_DIR);
P.ensureDir(P.LOG_DIR);

function log(...a) {
  const line = `[${new Date().toISOString()}] ` + a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' ');
  console.log(line);
  try { fs.appendFileSync(path.join(P.LOG_DIR, 'daemon.log'), line + '\n'); } catch (_) { }
}

// ---------------- CDP 注入 ----------------

function buildPayload() {
  const code = fs.readFileSync(INJECT_UI, 'utf8');
  const cfg = JSON.stringify({ api: `http://${HOST}:${PORT}` });
  return `(function(){ const CFG = ${cfg}; try {\n${code}\n} catch (e) { console.error('[Antigravity Daddy] inject error', e); return 'error:' + e.message; } })()`;
}

async function injectNow(reason) {
  if (!cdp) return { ok: false, error: 'CDP 未连接' };
  if (injecting) return { ok: false, error: '注入进行中' };
  injecting = true;
  try {
    const cfg = await cdp.eval(`JSON.stringify({origin: location.origin, cfg: window.__APP_CONFIG__ || null, href: location.href})`);
    const info = JSON.parse(cfg || '{}');
    if (info.origin && info.cfg && info.cfg.csrfToken) {
      rpc.setEndpoint(info.origin, info.cfg.csrfToken, info.cfg.appVersion);
      lsInfo = { ...lsInfo, port: new URL(info.origin).port, csrf: info.cfg.csrfToken, version: info.cfg.appVersion, attached: true, stage: 'ready', target: info.href };
    }
    else {
      // 页面在登录 / 引导页：没有 __APP_CONFIG__，配额与账号 RPC 全部不可用。
      // 必须显式降级，绝不能把「读不到」显示成 0%。
      lsInfo = { ...lsInfo, attached: false, stage: 'login', target: info.href || null };
    }
    const r = await cdp.eval(buildPayload());
    log('inject ok', reason || '', r === 'already' ? '(already)' : '', lsInfo.attached ? '' : '(LS 未就绪)');
    return { ok: true, marker: r, ls: lsInfo };
  } catch (e) {
    log('inject failed:', e.message);
    return { ok: false, error: e.message };
  } finally {
    injecting = false;
  }
}

async function attach({ port = 9333 } = {}) {
  if (cdp) cdp.close();
  cdp = await Cdp.attach(port);
  log('CDP attached', cdp.port, cdp.targetUrl && cdp.targetUrl.slice(0, 90));
  // 监听导航/重载，自动重新挂载（官方升级或切会话都不会丢）
  cdp.on((msg) => {
    if (msg.method === 'Page.frameNavigated' && msg.params && msg.params.frame && !msg.params.frame.parentId) {
      setTimeout(() => injectNow('frameNavigated'), 1200);
    }
  });
  await cdp.send('Page.enable').catch(() => { });
  return injectNow('attach');
}

// ---------------- 配额预热与定时刷新 ----------------
const quotaMeta = { lastRefreshAt: 0, lastDurationMs: null, lastError: null, refreshes: 0, nextAt: 0 };
let quotaTimer = null;

async function refreshQuota(reason) {
  const t0 = Date.now();
  try {
    quotaCache = await quotaApi.snapshot();
    const errs = (quotaCache && quotaCache.errors) || [];
    quotaMeta.lastRefreshAt = Date.now();
    quotaMeta.lastDurationMs = Date.now() - t0;
    quotaMeta.lastError = errs.length ? errs[0] : null;
    quotaMeta.refreshes++;
    const sec = Math.max(30, (store.getConfig().quota || {}).refreshSec || 120);
    quotaMeta.nextAt = quotaMeta.lastRefreshAt + sec * 1000;
    if (reason) log('[quota]', reason, quotaMeta.lastDurationMs + 'ms', errs.length ? 'errors=' + errs.length : 'ok');
    return { ok: true, quota: quotaCache, meta: quotaMeta };
  } catch (e) {
    quotaMeta.lastError = e.message;
    quotaMeta.lastRefreshAt = Date.now();
    quotaMeta.lastDurationMs = Date.now() - t0;
    log('[quota] refresh failed', e.message);
    return { ok: false, error: e.message, meta: quotaMeta };
  }
}

function startQuotaLoop() {
  if (quotaTimer) clearInterval(quotaTimer);
  quotaTimer = setInterval(() => {
    const cfg = store.getConfig();
    const sec = Math.max(30, (cfg.quota || {}).refreshSec || 120);
    const auto = (cfg.quota || {}).autoRefresh !== false;
    if (!auto) return;
    if (!lsInfo.port) return;
    if (Date.now() - quotaMeta.lastRefreshAt < sec * 1000) return;
    refreshQuota('auto').catch(() => { });
  }, 15000);
  if (quotaTimer.unref) quotaTimer.unref();
  log('quota loop started');
}

// ---------------- 自动切换引擎 ----------------
// 判定：最紧张一池的周配额 <= threshold（默认 30%）→ 切到 priority 最高的其它账号
// 约束：默认关闭；开关打开后按 intervalSec 巡检；切完进入 cooldownSec 冷却，防抖
const autoState = {
  enabled: false, lastCheckAt: 0, lastSwitchAt: 0, lastAction: '未启用',
  lastError: null, running: false, ticks: 0, lastRemain: null, lastFrom: null, lastTo: null,
};
let autoTimer = null;

async function autoTick(manual = false) {
  const cfg = store.getConfig().autoSwitch || {};
  if (!cfg.enabled && !manual) return { skipped: 'disabled' };
  if (autoState.running) return { skipped: 'busy' };
  autoState.running = true;
  try {
    const now = Date.now();
    if (!manual && autoState.lastSwitchAt && now - autoState.lastSwitchAt < (cfg.cooldownSec || 300) * 1000) {
      autoState.lastAction = '冷却中';
      return { skipped: 'cooldown' };
    }
    autoState.lastCheckAt = now;
    autoState.ticks++;
    quotaCache = await quotaApi.snapshot();
    const groups = (quotaCache && quotaCache.groups) || [];
    const wks = groups.map(g => (g.buckets || []).find(b => b.window === 'weekly')).filter(Boolean);
    if (!wks.length) { autoState.lastAction = '无配额数据'; return { skipped: 'no-quota' }; }
    // 取最紧张的一池作为判定依据（任一池见底就该换）
    const rem = Math.min(...wks.map(b => b.remaining === null || b.remaining === undefined ? 1 : b.remaining));
    autoState.lastRemain = rem;
    const th = cfg.threshold || 0.3;
    if (rem > th) {
      autoState.lastAction = `剩余 ${(rem * 100).toFixed(0)}%，高于阈值 ${(th * 100).toFixed(0)}%`;
      return { ok: true, remain: rem, action: 'none' };
    }
    const list = await accountsApi.listAccounts();
    const cur = list.accounts.find(a => a.isCurrent);
    const cands = list.accounts.filter(a => !a.isCurrent && !a.disabled);
    if (!cands.length) {
      autoState.lastAction = `剩余 ${(rem * 100).toFixed(0)}%，但号池没有可切换的账号`;
      return { ok: true, remain: rem, action: 'no-candidate' };
    }
    cands.sort((a, b) => ((b.priority && b.priority.gemini || 0) + (b.priority && b.priority.claude || 0))
      - ((a.priority && a.priority.gemini || 0) + (a.priority && a.priority.claude || 0)));
    const target = cands[0];
    autoState.lastFrom = cur ? cur.email : null;
    const r = await accountsApi.switchAccount(target.id, {});
    autoState.lastSwitchAt = Date.now();
    autoState.lastAction = r.ok ? `已自动切到 ${target.email}` : `切换失败：${r.error || '未知原因'}`;
    if (r.ok) { autoState.lastTo = target.email; quotaCache = await quotaApi.snapshot().catch(() => quotaCache); }
    log('[auto-switch]', autoState.lastAction, 'remain=' + rem);
    return { ok: !!r.ok, remain: rem, switched: r.ok ? target.email : null, from: autoState.lastFrom, error: r.error };
  } catch (e) {
    autoState.lastError = e.message;
    autoState.lastAction = '异常：' + e.message;
    log('[auto-switch] error', e.message);
    return { error: e.message };
  } finally {
    autoState.running = false;
  }
}

function startAutoLoop() {
  if (autoTimer) clearInterval(autoTimer);
  autoTimer = setInterval(() => {
    const cfg = store.getConfig().autoSwitch || {};
    autoState.enabled = !!cfg.enabled;
    if (!cfg.enabled) return;
    const gap = Math.max(30, cfg.intervalSec || 120) * 1000;
    if (Date.now() - autoState.lastCheckAt < gap) return;
    autoTick(false).catch(() => { });
  }, 20000);
  if (autoTimer.unref) autoTimer.unref();
  log('auto-switch loop started');
}

// ---------------- 状态聚合 ----------------

async function buildState() {
  const accountsList = await accountsApi.listAccounts().catch(e => ({ accounts: [], error: e.message }));
  if (!quotaCache) quotaCache = await quotaApi.snapshot().catch(() => null);
  return {
    ok: true,
    ls: lsInfo,
    accounts: accountsList.accounts,
    accountsError: accountsList.error || null,
    quota: quotaCache,
    quotaMeta,
    config: store.getConfig(),
    auto: (() => {
      const c = (store.getConfig().autoSwitch) || {};
      return { ...autoState, enabled: !!c.enabled, threshold: c.threshold, intervalSec: c.intervalSec, cooldownSec: c.cooldownSec };
    })(),
    drafts: store.loadDrafts().items || [],
    paths: { dataDir: P.DATA_DIR, agyExe: P.agyExe(), userData: P.agyUserData(), gemini: P.GEMINI_DIR },
  };
}

// ---------------- HTTP ----------------

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Private-Network': 'true',
    'Cache-Control': 'no-store',
  };
}

function send(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders() });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => { data += c; if (data.length > 8e6) req.destroy(); });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

async function route(req, res) {
  const u = new URL(req.url, `http://${HOST}:${PORT}`);
  const p = u.pathname;
  if (req.method === 'OPTIONS') { res.writeHead(204, corsHeaders()); return res.end(); }

  // 独立控制台：属于我们软件自己的界面，同源提供（Edge --app 模式加载）
  if (p === '/' || p === '/console' || p === '/console/') {
    const f = path.join(__dirname, 'console', 'index.html');
    if (!fs.existsSync(f)) {
      res.writeHead(503, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end('<h1>控制台页面缺失</h1><p>src/console/index.html 未生成</p>');
    }
    const html = fs.readFileSync(f, 'utf8');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(html);
  }

  if (p === '/api/health') return send(res, 200, { ok: true, cdp: !!cdp, ls: lsInfo, version: '0.3.8', stage: lsInfo.stage || (lsInfo.attached ? 'ready' : 'waiting'), brand: 'Antigravity Daddy' });
  if (p === '/api/state') return send(res, 200, await buildState());

  // 一次性启动器的 --stop：只停 daemon，保留官方客户端与已注入面板（面板失去 API 后自行降级）
  if (p === '/api/shutdown' && req.method === 'POST') {
    send(res, 200, { ok: true, message: 'Antigravity Daddy 守护进程已停止' });
    log('shutdown requested via API');
    setTimeout(() => process.exit(0), 250);
    return;
  }

  if (p === '/api/refresh') {
    const r = await refreshQuota('manual');
    return send(res, r.ok ? 200 : 500, r);
  }

  if (p === '/api/quota/preheat' && req.method === 'POST') {
    const r = await refreshQuota('preheat');
    return send(res, r.ok ? 200 : 500, r);
  }

  if (p === '/api/quota/meta') {
    return send(res, 200, { ok: true, meta: quotaMeta, refreshSec: (store.getConfig().quota || {}).refreshSec || 120 });
  }

  if (p === '/api/inject' && req.method === 'POST') {
    const r = await injectNow('manual');
    return send(res, r.ok ? 200 : 500, r);
  }

  if (p === '/api/attach' && req.method === 'POST') {
    const body = await readBody(req);
    const r = await attach({ port: body.port || 9333 });
    return send(res, 200, r);
  }

  if (p === '/api/auto' && req.method === 'GET') {
    const c = store.getConfig().autoSwitch || {};
    return send(res, 200, {
      ok: true, config: c,
      state: { ...autoState, enabled: !!c.enabled },
    });
  }

  if (p === '/api/auto' && req.method === 'POST') {
    const body = await readBody(req);
    const patch = {};
    if (typeof body.enabled === 'boolean') patch.enabled = body.enabled;
    if (typeof body.threshold === 'number') patch.threshold = Math.max(0.05, Math.min(0.95, body.threshold));
    if (typeof body.intervalSec === 'number') patch.intervalSec = Math.max(30, Math.min(3600, body.intervalSec));
    if (typeof body.cooldownSec === 'number') patch.cooldownSec = Math.max(30, Math.min(7200, body.cooldownSec));
    const next = store.patchConfig({ autoSwitch: patch }).autoSwitch;
    autoState.enabled = !!next.enabled;
    autoState.lastAction = next.enabled ? '已启用，等待下一次巡检' : '已停用';
    log('auto-switch config', next);
    return send(res, 200, { ok: true, config: next, state: autoState });
  }

  if (p === '/api/auto/tick' && req.method === 'POST') {
    const r = await autoTick(true);
    return send(res, 200, { ...r, state: autoState });
  }

  if (p === '/api/switch' && req.method === 'POST') {
    const body = await readBody(req);
    try {
      const r = await accountsApi.switchAccount(body.id, body);
      if (r.ok) await refreshQuota('after-switch');
      return send(res, 200, r);
    } catch (e) { return send(res, 400, { ok: false, error: e.message }); }
  }

  if (p === '/api/account/adopt' && req.method === 'POST') {
    try {
      const r = await accountsApi.adoptCurrent((await readBody(req)).label);
      return send(res, 200, r);
    } catch (e) { return send(res, 400, { error: e.message }); }
  }

  if (p === '/api/account/add' && req.method === 'POST') {
    const body = await readBody(req);
    try {
      let creds = body.creds;
      if (!creds || !creds.token) throw new Error('需要完整凭据 JSON（含 token.refresh_token）；仅有 refresh_token 的录入需 OAuth 换取，当前版本未内置');
      const r = await accountsApi.addAccount(creds, { label: body.label });
      return send(res, 200, r);
    } catch (e) { return send(res, 400, { error: e.message }); }
  }

  if (p === '/api/account/update' && req.method === 'POST') {
    const body = await readBody(req);
    try { return send(res, 200, await accountsApi.updateAccount(body.id, body)); }
    catch (e) { return send(res, 400, { error: e.message }); }
  }

  if (p === '/api/account/delete' && req.method === 'POST') {
    const body = await readBody(req);
    try { return send(res, 200, await accountsApi.deleteAccount(body.id)); }
    catch (e) { return send(res, 400, { error: e.message }); }
  }

  if (p === '/api/settings' && req.method === 'POST') {
    const body = await readBody(req);
    const cfg = store.patchConfig(body);
    return send(res, 200, { ok: true, config: cfg });
  }

  if (p === '/api/drafts/add' && req.method === 'POST') {
    const body = await readBody(req);
    const d = store.loadDrafts();
    d.items = d.items || [];
    d.items.push({ id: Math.random().toString(36).slice(2, 10), conversationId: body.conversationId || null, text: body.text || '', at: Date.now() });
    store.saveDrafts(d);
    return send(res, 200, { ok: true, count: d.items.length });
  }

  if (p === '/api/drafts/delete' && req.method === 'POST') {
    const body = await readBody(req);
    const d = store.loadDrafts();
    d.items = (d.items || []).filter(x => x.id !== body.id);
    store.saveDrafts(d);
    return send(res, 200, { ok: true });
  }

  if (p === '/api/fork' && req.method === 'POST') {
    const body = await readBody(req);
    const d = store.loadDrafts();
    d.items = d.items || [];
    d.items.push({
      id: Math.random().toString(36).slice(2, 10),
      conversationId: body.conversationId || null,
      text: (body.text || '').slice(0, 20000),
      at: Date.now(), kind: 'fork',
    });
    store.saveDrafts(d);
    return send(res, 200, { ok: true });
  }

  if (p === '/api/account/export' && req.method === 'POST') {
    try {
      const accs = store.loadAccounts();
      return send(res, 200, {
        version: 1, exportedAt: new Date().toISOString(),
        accounts: accs.map(a => ({
          email: a.email, label: a.label, priority: a.priority,
          forbiddenModels: a.forbiddenModels, pedalModels: a.pedalModels, creds: a.creds,
        })),
        warning: '导出内容含 refresh_token，等同账号凭据，勿外传',
      });
    } catch (e) { return send(res, 400, { error: e.message }); }
  }

  if (p === '/api/account/import' && req.method === 'POST') {
    const body = await readBody(req);
    try {
      const list = (body.accounts || []).filter(x => x && x.creds && x.creds.token);
      let added = 0, dup = 0;
      for (const x of list) {
        const r = await accountsApi.addAccount(x.creds, { label: x.label });
        r.duplicate ? dup++ : added++;
      }
      return send(res, 200, { ok: true, added, dup, total: list.length });
    } catch (e) { return send(res, 400, { error: e.message }); }
  }

  if (p === '/api/logs') {
    try {
      const f = path.join(P.LOG_DIR, 'daemon.log');
      const lines = fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split(/\r?\n/) : [];
      const q = u.searchParams;
      const level = q.get('level') || 'all';
      const limit = Math.min(1000, Math.max(20, Number(q.get('limit') || 200)));
      const kw = (q.get('q') || '').toLowerCase();
      // 中文没有 \b 词边界，不能用 \b 包裹；全部用「子串」判定
      const cls = (l) => /(error|errors=|failed|failure|异常|失败|超时|timeout|refused|crash|未响应)/i.test(l) ? 'error'
        : /(warn|warning|未找到|未就绪|等待|waiting|降级|retry|重试)/i.test(l) ? 'warn' : 'info';
      const filtered = lines
        .filter(l => l.trim())
        .filter(l => level === 'all' || cls(l) === level)
        .filter(l => !kw || l.toLowerCase().includes(kw))
        .slice(-limit);
      return send(res, 200, {
        log: filtered.length ? filtered.join('\n') : '(无匹配日志)',
        total: lines.filter(l => l.trim()).length,
        shown: filtered.length, level, limit,
        file: f,
      });
    } catch (e) { return send(res, 200, { log: 'read failed: ' + e.message }); }
  }

  if (p === '/api/clear-composer' && req.method === 'POST') {
    if (!cdp) return send(res, 400, { error: 'CDP 未连接' });
    try {
      // 实测：Lexical 只认真实按键事件，execCommand('delete'/'cut') 无效
      await cdp.eval(`(()=>{const e=document.querySelector('[data-lexical-editor="true"]'); if(e) e.focus(); return !!e})()`);
      const key = (type, vk, code, k, mod) => cdp.send('Input.dispatchKeyEvent', { type, windowsVirtualKeyCode: vk, code, key: k, ...(mod !== undefined ? { modifiers: mod } : {}) });
      await key('rawKeyDown', 65, 'KeyA', 'a', 2);
      await key('keyUp', 65, 'KeyA', 'a', 2);
      await new Promise(r => setTimeout(r, 120));
      await key('rawKeyDown', 8, 'Backspace', 'Backspace');
      await key('keyUp', 8, 'Backspace', 'Backspace');
      return send(res, 200, { ok: true });
    } catch (e) { return send(res, 500, { error: e.message }); }
  }

  if (p === '/api/projects') {
    try {
      const r = await rpc.listProjects();
      const list = (r && (r.projects || r.projectList || [])) || [];
      return send(res, 200, { projects: list });
    } catch (e) { return send(res, 200, { projects: [], error: e.message }); }
  }

  if (p === '/api/models') {
    try {
      const r = await rpc.modelConfig();
      const cfgs = (r && r.clientModelConfigs) || [];
      return send(res, 200, { models: cfgs.map(c => ({
        label: c.label, modelId: c.modelId,
        remaining: c.quotaInfo ? c.quotaInfo.remainingFraction : null,
        resetAt: c.quotaInfo ? c.quotaInfo.resetTime : null,
      })) });
    } catch (e) { return send(res, 200, { models: [], error: e.message }); }
  }

  // 中转站：只做「连通性 + 契约」探测，不代发任何业务请求、不代理流量。
  if (p === '/api/gateway/probe' && req.method === 'POST') {
    const body = await readBody(req);
    const cfg = store.getConfig().gateway || {};
    const url = (body.url || cfg.url || `http://127.0.0.1:${cfg.externalPort || 8045}`).replace(/\/+$/, '');
    const t0 = Date.now();
    const getJson = (fullUrl, headers = {}) => new Promise((resolve) => {
      let u;
      try { u = new URL(fullUrl); } catch (e) { return resolve({ online: false, error: '地址无效' }); }
      const mod = u.protocol === 'https:' ? require('https') : require('http');
      const req2 = mod.request({
        hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: (u.pathname || '/') + (u.search || ''), method: 'GET', timeout: 4000,
        headers: { Accept: 'application/json', ...headers },
      }, (r2) => {
        const chunks = [];
        r2.on('data', d => chunks.push(d));
        r2.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8').slice(0, 64000);
          let json = null; try { json = JSON.parse(text); } catch (_) { }
          resolve({ online: r2.statusCode < 500, status: r2.statusCode, latencyMs: Date.now() - t0, json });
        });
      });
      req2.on('timeout', () => { req2.destroy(); resolve({ online: false, error: '超时' }); });
      req2.on('error', (e) => resolve({ online: false, error: e.code === 'ECONNREFUSED' ? '端口未监听' : e.message }));
      req2.end();
    });

    const root = await getJson(url + '/');
    // OpenAI 兼容契约探测：GET {url}/v1/models，带 Bearer key（key 只发往用户填的地址，不写日志）
    let contract = null;
    if (root.online) {
      const key = (body.apiKey || cfg.apiKey || '').trim();
      const models = await getJson(url + '/v1/models', key ? { Authorization: 'Bearer ' + key } : {});
      if (models.json) {
        const arr = Array.isArray(models.json.data) ? models.json.data : (models.json.models || []);
        contract = {
          openaiCompatible: Array.isArray(models.json.data),
          models: arr.slice(0, 30).map(m => (typeof m === 'string' ? m : (m.id || m.name || ''))).filter(Boolean),
          modelCount: arr.length,
          authAccepted: models.status !== 401 && models.status !== 403,
          status: models.status,
        };
      } else {
        contract = { openaiCompatible: false, status: models.status, error: models.error || '无 JSON 响应' };
      }
    }
    return send(res, 200, {
      ok: true, url, online: root.online, status: root.status, latencyMs: root.latencyMs,
      error: root.error || null, contract,
      configured: { enabled: !!cfg.enabled, protocol: cfg.protocol || 'openai', hasKey: !!(cfg.apiKey || body.apiKey) },
      note: '仅探测连通性与 /v1/models 契约；不代发请求、不代理流量',
    });
  }

  // 对接契约（只读）：给后续接入方一个稳定的字段清单，不改动任何流量行为
  if (p === '/api/gateway/contract') {
    const cfg = store.getConfig().gateway || {};
    return send(res, 200, {
      ok: true,
      enabled: !!cfg.enabled,
      protocol: cfg.protocol || 'openai',
      fields: [
        { key: 'gateway.url', required: true, desc: '服务根地址，不带 /v1' },
        { key: 'gateway.apiKey', required: false, desc: 'Bearer key，仅存本机 config.json' },
        { key: 'gateway.protocol', required: true, desc: 'openai | anthropic | custom' },
        { key: 'gateway.modelMap', required: false, desc: '官方模型 ID → 上游模型名' },
        { key: 'gateway.routing', required: false, desc: 'quota | round-robin | fixed' },
        { key: 'gateway.stats', required: false, desc: '用量统计开关' },
      ],
      endpoints: ['POST /api/gateway/probe', 'GET /api/gateway/contract', 'POST /api/settings'],
      boundary: '当前为占位：不代发请求、不代理流量、不统计用量',
      doc: 'docs/中转站对接契约.md',
    });
  }

  if (p === '/api/sysinfo') {
    const os = require('os');
    const cfg = store.getConfig();
    return send(res, 200, {
      platform: `${os.platform()} ${os.release()}`,
      cpu: `${os.cpus()[0] && os.cpus()[0].model} x${os.cpus().length}`,
      mem: `${Math.round((os.totalmem() - os.freemem()) / 1e9)} / ${Math.round(os.totalmem() / 1e9)} GB`,
      agyVersion: lsInfo.version || null,
      cdpPort: cdp ? cdp.port : null,
      lsPort: lsInfo.port || null,
      dataDir: P.DATA_DIR,
      upstream: cfg.upstream,
    });
  }

  if (p === '/api/openfolder' && req.method === 'POST') {
    const body = await readBody(req);
    let target = P.DATA_DIR;
    if (body.which === 'backups') target = path.join(P.DATA_DIR, 'backups');
    else if (body.which === 'logs') target = P.LOG_DIR;
    else if (body.which === 'cache') target = path.join(P.agyUserData() || P.DATA_DIR, 'Cache');
    P.ensureDir(target);
    require('child_process').execFile('explorer.exe', [target], () => { });
    return send(res, 200, { ok: true, path: target });
  }

  if (p === '/api/netcheck' && req.method === 'POST') {
    const cfg = store.getConfig();
    const https = require('https');
    const { URL } = require('url');
    const probe = (useProxy) => new Promise((resolve) => {
      const u = new URL('https://daily-cloudcode-pa.googleapis.com/');
      const opts = { hostname: u.hostname, port: 443, path: '/', method: 'GET', timeout: 8000, rejectUnauthorized: true };
      if (useProxy) {
        const px = new URL(cfg.upstream.proxy);
        opts.hostname = px.hostname; opts.port = px.port || 7897; opts.path = u.href; opts.method = 'GET';
        opts.headers = { Host: u.hostname };
      }
      const req2 = https.request(opts, (r2) => { resolve({ via: useProxy ? 'proxy' : 'direct', status: r2.statusCode }); r2.resume(); });
      req2.on('timeout', () => { req2.destroy(); resolve({ via: useProxy ? 'proxy' : 'direct', status: 0, error: 'timeout' }); });
      req2.on('error', (e) => resolve({ via: useProxy ? 'proxy' : 'direct', status: 0, error: e.message }));
      req2.end();
    });
    const [direct, proxied] = await Promise.all([probe(false), probe(true)]);
    return send(res, 200, { direct, proxied, proxy: cfg.upstream.proxy });
  }

  if (p === '/api/best-switch' && req.method === 'POST') {
    try {
      const list = await accountsApi.listAccounts();
      const cur = list.accounts.find(a => a.isCurrent);
      const cands = list.accounts.filter(a => !a.isCurrent && !a.disabled)
        .sort((a, b) => (b.priority.gemini + b.priority.claude) - (a.priority.gemini + a.priority.claude));
      if (!cands.length) return send(res, 200, { ok: false, reason: '没有可切换的其它账号（先在账号页添加）' });
      const target = cands[0];
      const r = await accountsApi.switchAccount(target.id, {});
      if (r.ok) await refreshQuota('after-switch');
      return send(res, 200, { ...r, current: cur ? cur.email : null });
    } catch (e) { return send(res, 400, { ok: false, error: e.message }); }
  }

  if (p === '/api/rpc' && req.method === 'POST') {
    const body = await readBody(req);
    try { return send(res, 200, await rpc.call(body.method, body.body || {})); }
    catch (e) { return send(res, 400, { error: e.message }); }
  }

  return send(res, 404, { error: 'not found' });
}

function startServer(onReady) {
  const srv = http.createServer((req, res) => {
    route(req, res).catch(e => { try { send(res, 500, { error: e.message }); } catch (_) { } });
  });
  // 单实例保护：端口已被另一个守护占用时，本实例直接退出，绝不启动第二套循环。
  srv.on('error', (e) => {
    if (e && e.code === 'EADDRINUSE') {
      log(`port ${PORT} already in use: another daemon is running — this instance exits`);
      process.exit(0);
    }
    log('server error:', e && e.message ? e.message : String(e));
    process.exit(1);
  });
  srv.listen(PORT, HOST, () => {
    log(`daemon listening http://${HOST}:${PORT}`);
    if (onReady) onReady();
  });
  return srv;
}

// ---------------- 自愈巡检 ----------------
// 覆盖两种真实场景：客户端中途重启（CDP 断开）、从登录页登录进主界面
// （SPA 内跳转不触发 frameNavigated，__APP_CONFIG__ 是登录后才有）。
let watchTimer = null;
let watchBusy = false;
// 客户端生命周期自愈（纯 JS，免编译）：
//  - 官方进程彻底没了(用户正常关闭) → 守护自退，让下次双击走「全新启动」；
//  - 官方进程还在但连接/注入反复失败(半死僵尸) → 杀僵尸并重启官方客户端。
let _goneCycles = 0;   // 连续「0 个官方进程」周期数
let _failCycles = 0;   // 连续「有进程但连不上/注入失败」周期数
let _everAttached = false;

function agyProcCount() {
  try {
    const { execFileSync } = require('child_process');
    const out = execFileSync('tasklist', ['/FI', 'IMAGENAME eq Antigravity.exe', '/FO', 'CSV', '/NH'],
      { encoding: 'utf8', timeout: 4000, windowsHide: true });
    return (out.match(/Antigravity\.exe/gi) || []).length;
  } catch { return 0; }
}

function healRestartClient() {
  try {
    const { execFileSync } = require('child_process');
    execFileSync('taskkill', ['/IM', 'Antigravity.exe', '/F'], { timeout: 4000, windowsHide: true });
    log('[watch] 僵尸客户端：已结束残留进程，准备重启');
  } catch (e) { log('[watch] kill client failed:', e.message); }
  try { if (cdp) cdp.close(); } catch (_) { }
  cdp = null; lsInfo = { port: null, csrf: null, version: null, attached: false, target: null };
  setTimeout(() => {
    try {
      const exe = P.agyExe();
      if (!exe) { log('[watch] heal: 未找到 Antigravity.exe'); return; }
      const { spawn } = require('child_process');
      const child = spawn(exe, [], { detached: true, stdio: 'ignore', windowsHide: false });
      child.unref();
      log('[watch] 已重启官方客户端');
    } catch (e) { log('[watch] relaunch failed:', e.message); }
  }, 2500);
}

function startWatch() {
  if (watchTimer) clearInterval(watchTimer);
  watchTimer = setInterval(async () => {
    if (watchBusy || injecting) return;
    watchBusy = true;
    try {
      const n = agyProcCount();
      // 1) 客户端彻底关闭：连续 3 个周期(≈36s)无进程 → 守护自退，下次双击全新启动
      if (n === 0) {
        _goneCycles++;
        if (_goneCycles >= 3) {
          log('[watch] 官方客户端已关闭，守护进程退出（下次双击将全新启动）');
          try { if (cdp) cdp.close(); } catch (_) { }
          process.exit(0);
        }
        return;
      }
      _goneCycles = 0;

      let ok = false;
      if (!cdp || !cdp.isAlive()) {
        const r = await attach({ port: Number(process.env.AGYD_CDP_PORT || 9333) }).catch(() => ({ ok: false }));
        ok = !!(r && r.ok);
        if (ok) { _everAttached = true; log('[watch] reattached, stage =', lsInfo.stage || '?'); }
      } else if (!lsInfo.attached) {
        const r = await injectNow('watch-recover').catch(() => ({ ok: false }));
        ok = !!(r && r.ok && r.ls && r.ls.attached);
        if (ok) { _everAttached = true; log('[watch] LS 已就绪'); }
      } else {
        ok = true; _everAttached = true;
      }

      // 2) 进程在、但连接/注入连续失败(半死僵尸) → 杀并重启客户端（仅在本会话曾成功连接过才动手）
      if (ok) { _failCycles = 0; }
      else {
        _failCycles++;
        if (_failCycles >= 3 && _everAttached) {
          log('[watch] 客户端无响应（连续', _failCycles, '次），执行自愈重启');
          _failCycles = 0;
          healRestartClient();
        }
      }
    } catch (_) { /* 下轮再试 */ }
    finally { watchBusy = false; }
  }, 12000);
  if (watchTimer.unref) watchTimer.unref();
  log('client watch started');
}

// ---------------- 主流程 ----------------

async function main() {
  // 循环只在成功绑定端口后启动：抢不到 8787 的重复守护会在 listen 失败时直接退出，
  // 不会再跑出第二套 quota/auto 循环（旧版就是这里重复刷日志）。
  startServer(() => {
    startAutoLoop();
    startQuotaLoop();
  });
  const started = Date.now();
  // 以指数退避重试直到客户端就绪（官方可能还在启动）
  for (let i = 0; i < 20; i++) {
    try {
      const r = await attach({ port: Number(process.env.AGYD_CDP_PORT || 9333) });
      if (r.ok) { log('ready, LS', lsInfo.port, 'v' + lsInfo.version); break; }
      log('attach but inject failed:', r.error);
    } catch (e) {
      log('waiting for client...', e.message);
    }
    await new Promise(r => setTimeout(r, Math.min(1000 * (i + 1), 5000)));
  }
  log('boot cost', Date.now() - started, 'ms');
  startWatch();
}

if (require.main === module) main();

module.exports = { attach, injectNow, buildState, log, boot: main, getCdp: () => cdp };
