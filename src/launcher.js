'use strict';
// 启动器：接管官方 Antigravity 启动（不修改其二进制/签名），并把守护进程跑起来
// 关键事实（实测变更）：
//   - 2.32.x 及更早：主进程自己 appendSwitch('remote-debugging-port','0')，
//     端口记在 <userData>/DevToolsActivePort，我们只要去读。
//   - 2.33.0 起：不再自动开调试端口，DevToolsActivePort 也不再生成 ——
//     客户端照常启动，但没有任何 CDP 通道，注入层永远连不上（表现为「图标消失」）。
// 因此现在由我们显式传 --remote-debugging-port=<固定端口>，不再依赖官方自动开启。
const { spawn, execFile, execFileSync } = require('child_process');
const path = require('path');
const P = require('./paths');
const { Cdp } = require('./cdp');

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const getArg = (f, d) => { const i = args.indexOf(f); return i >= 0 && args[i + 1] ? args[i + 1] : d; };

const FIXED_PORT = Number(getArg('--port', 9333));

function log(...a) { console.log('[launcher]', ...a); }

// 官方进程数：用于识别「客户端在跑但没有调试端口」这种单实例死锁
function agyProcCount() {
  try {
    const out = execFileSync('tasklist', ['/FI', 'IMAGENAME eq Antigravity.exe', '/FO', 'CSV', '/NH'],
      { encoding: 'utf8', timeout: 4000, windowsHide: true });
    return (out.match(/Antigravity\.exe/gi) || []).length;
  } catch { return 0; }
}
function killClient() {
  try {
    execFileSync('taskkill', ['/IM', 'Antigravity.exe', '/F'], { timeout: 5000, windowsHide: true });
  } catch (_) { }
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function isClientRunning() {
  return Cdp.resolvePort(FIXED_PORT); // 返回端口号或 null
}

function startClient() {
  const exe = P.agyExe();
  if (!exe) {
    console.error('未找到 Antigravity.exe，请检查安装路径：');
    P.AGY_EXE_CANDIDATES.forEach(p => console.error('  - ' + p));
    process.exit(1);
  }
  log('启动客户端:', exe);
  // 关键坑（实测）：若父环境带有 ELECTRON_RUN_AS_NODE=1（很多 IDE / Agent 终端会注入），
  // Antigravity.exe 会以纯 Node 模式启动 → 打印 node --help 或直接 exit 0，永远不出窗口。
  // NODE_OPTIONS 会往主进程注入 --require 垫片，同样可能污染，一并剔除。
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.NODE_OPTIONS;
  // 强制上游走代理：LS 是 Go 进程，只认 HTTP(S)_PROXY（Chromium 的 --proxy-server 对它无效）
  try {
    const cfg = require('./store').getConfig();
    if (cfg.upstream && cfg.upstream.enabled) {
      env.HTTP_PROXY = cfg.upstream.proxy;
      env.HTTPS_PROXY = cfg.upstream.proxy;
      env.ALL_PROXY = cfg.upstream.proxy;
      env.NO_PROXY = cfg.upstream.noProxy || '127.0.0.1,localhost,::1';
      log('上游代理已注入:', cfg.upstream.proxy);
    }
  } catch (_) { }
  // 2.33.0 起官方不再自己开调试端口，因此这里显式指定固定端口。
  // 用固定端口（而不是 0）后，daemon 也不必再读 DevToolsActivePort。
  const child = spawn(exe, ['--remote-debugging-port=' + FIXED_PORT],
    { detached: true, stdio: 'ignore', windowsHide: false, env });
  child.unref();
  return child;
}

async function waitForCdp(timeoutMs = 90000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const port = await Cdp.resolvePort(FIXED_PORT);
    if (port) return port;
    await new Promise(r => setTimeout(r, 700));
  }
  return null;
}

async function main() {
  console.log('=== Antigravity Daddy v0.3.13 ===');
  console.log('数据目录:', P.DATA_DIR);

  // --client-only：主窗口的「启动 / 唤醒客户端」专用，只拉起官方 exe 后立即退出，
  // 不重复起守护进程（8787 端口会被占用）。
  if (has('--client-only')) {
    const runningNow = await isClientRunning();
    if (runningNow) { log('客户端已在运行，CDP 端口:', runningNow); return; }
    startClient();
    const p = await waitForCdp(60000);
    log(p ? '客户端已就绪，CDP 端口: ' + p : '等待 CDP 超时');
    return;
  }

  // --force-client：自愈专用。忽略 DevToolsActivePort 缓存（僵尸客户端会留下陈旧端口，
  // 导致普通路径误判“已在运行”而不重启），强制拉起官方客户端，再起守护。
  if (has('--force-client')) {
    log('force-client: 忽略缓存端口，强制拉起官方客户端');
    startClient();
    process.env.AGYD_CDP_PORT = String(FIXED_PORT);
    const daemon = require('./daemon');
    daemon.boot().catch(e => console.error('[daemon] boot failed:', e.message));
    return;
  }

  const running = await isClientRunning();
  if (running) {
    log('检测到 Antigravity 已在运行，CDP 端口:', running, '（复用，不重启客户端）');
  } else if (!has('--no-start')) {
    // 关键：不阻塞等 CDP。官方冷启动常要 60–90 s，若等它就绪才起 daemon，
    // 主窗口和本地 API 会长时间「假死」。daemon 先起并立即监听 8787，
    // 客户端后台拉起，之后由 daemon 的 12s 自愈巡检自动 attach + 注入。
    //
    // 但 2.33.0+ 有个单实例死锁：客户端已在跑却没有调试端口时，直接再启动会把参数
    // 转发给旧实例然后退出 —— 端口永远不开。必须先结束旧实例，才能带参启动。
    const alive = agyProcCount();
    if (alive > 0) {
      log('客户端在运行但未开调试端口（2.33.0+ 行为），结束旧实例后带参重启…');
      killClient();
      await sleep(1800);
    }
    startClient();
    log('官方客户端已在后台拉起（已指定调试端口 ' + FIXED_PORT + '）');
  }

  // 守护进程：HTTP API 立即就绪；CDP 连接由 boot 的重试 + startWatch 持续自愈
  process.env.AGYD_CDP_PORT = String(running || FIXED_PORT);
  const daemon = require('./daemon');
  daemon.boot().catch(e => console.error('[daemon] boot failed:', e.message));

  console.log('');
  console.log('已就绪：');
  console.log('  · 右下角悬浮球 = Antigravity Daddy 面板（账号/额度/工具/主题/草稿）');
  console.log('  · 输入框工具条 = 暂存草稿 / 快捷短语');
  console.log('  · 本地 API  =', 'http://127.0.0.1:' + (process.env.AGYD_PORT || 8787));
  console.log('按 Ctrl+C 退出（客户端保持运行，注入层随之失效）');
}

main().catch(e => { console.error('启动失败:', e.message); process.exit(1); });
