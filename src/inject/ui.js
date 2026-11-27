// ============================================================================
// Antigravity Daddy 注入层 v0.3.14
//  - 交互参考 WorkDaddy（可贴边悬浮球、悬停展开、接管主题）
//  - 信息架构吸收 Antigravity Tools（总览看板 / 账号 / 配额 / 模型 / 诊断），
//    但只服务于"把官方客户端用得更好"，不复刻它的中转站与服务端能力
//  - 数据来源：本机 Language Server Connect-RPC + DOM 只读
// ============================================================================
const API = CFG.api;
const TAG = 'agy-daddy';
const MY_VER = '0.3.14';

// 已注入过就只 ping 一下。但必须同时确认 host 还挂在页面上：
// 登录页 → 主界面这类 SPA 切换会把 DOM 整段重建，host 被清掉后如果只按
// window.__AGYD__ 判定「已注入」，UI 会永久消失且再也不重建（登录页看起来就是「不能用」）。
if (window.__AGYD__ && window.__AGYD__.mounted && window.__AGYD__.version === MY_VER
    && document.getElementById(TAG + '-host')) { window.__AGYD__.ping(); return; }

const A = {
  editor: ['[data-lexical-editor="true"][aria-label="Message input"]', '[data-lexical-editor="true"]'],
  inputBox: ['[data-testid="agent-input-box"]', '.surface-composer'],
  toolbar: ['[data-testid="input-box-bottom-toolbar"]'],
  send: ['[data-testid="send-button"]', '[data-testid="input-send-button"]', '[data-testid*="send" i]'],
  msgActions: ['[data-testid="cascade-system-message-toolbar"]', '[data-testid="user-message-actions"]'],
  permConfirm: ['[data-testid="declared-permissions-confirm"]', '[data-testid="subagent-approve"]', '[data-testid="ask-question-option"]'],
  automationsBtn: ['[data-testid="automations-button"]'],
};
const pick = (g) => { for (const s of A[g] || []) { const e = document.querySelector(s); if (e) return e; } return null; };
const pickAll = (g) => { for (const s of A[g] || []) { const l = document.querySelectorAll(s); if (l.length) return [...l]; } return []; };

const state = {
  ui: null, tab: 'accounts', accounts: [], quota: null, config: null, drafts: [],
  sysinfo: null, models: [], search: '',
};

// 品牌标记：与悬浮球 / exe 图标同一个 ∞（无底板，形状即图标）
const LOGO = `<svg viewBox="19 36.5 62 27" width="22" height="22" aria-hidden="true">
  <defs>
    <linearGradient id="agyd-brand" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#a78bfa"/><stop offset=".5" stop-color="#7c5cff"/><stop offset="1" stop-color="#22d3ee"/>
    </linearGradient>
  </defs>
  <path d="M77.0,50.0 L76.69,52.33 L75.81,54.48 L74.44,56.33 L72.71,57.77 L70.76,58.77 L68.71,59.35 L66.64,59.55 L64.64,59.41 L62.73,59.0 L60.94,58.38 L59.27,57.59 L57.71,56.68 L56.26,55.68 L54.9,54.61 L53.62,53.49 L52.38,52.34 L51.18,51.18 L50.0,50.0 L48.82,48.82 L47.62,47.66 L46.38,46.51 L45.1,45.39 L43.74,44.32 L42.29,43.32 L40.73,42.41 L39.06,41.62 L37.27,41.0 L35.36,40.59 L33.36,40.45 L31.29,40.65 L29.24,41.23 L27.29,42.23 L25.56,43.67 L24.19,45.52 L23.31,47.67 L23.0,50.0 L23.31,52.33 L24.19,54.48 L25.56,56.33 L27.29,57.77 L29.24,58.77 L31.29,59.35 L33.36,59.55 L35.36,59.41 L37.27,59.0 L39.06,58.38 L40.73,57.59 L42.29,56.68 L43.74,55.68 L45.1,54.61 L46.38,53.49 L47.62,52.34 L48.82,51.18 L50.0,50.0 L51.18,48.82 L52.38,47.66 L53.62,46.51 L54.9,45.39 L56.26,44.32 L57.71,43.32 L59.27,42.41 L60.94,41.62 L62.73,41.0 L64.64,40.59 L66.64,40.45 L68.71,40.65 L70.76,41.23 L72.71,42.23 L74.44,43.67 L75.81,45.52 L76.69,47.67 L77.0,50.0" fill="none" stroke="url(#agyd-brand)" stroke-width="9" stroke-linecap="round"/>
</svg>`;


// 悬浮球图标：∞ 双环接力（无底板，形状即图标，与 exe/app 图标同一套几何）
//  光点沿 ∞ 流动 = 账号接力；速度 = 周配额健康度；低配额变琥珀
const LOOP_D = 'M77.0,50.0 L76.69,52.33 L75.81,54.48 L74.44,56.33 L72.71,57.77 L70.76,58.77 L68.71,59.35 L66.64,59.55 L64.64,59.41 L62.73,59.0 L60.94,58.38 L59.27,57.59 L57.71,56.68 L56.26,55.68 L54.9,54.61 L53.62,53.49 L52.38,52.34 L51.18,51.18 L50.0,50.0 L48.82,48.82 L47.62,47.66 L46.38,46.51 L45.1,45.39 L43.74,44.32 L42.29,43.32 L40.73,42.41 L39.06,41.62 L37.27,41.0 L35.36,40.59 L33.36,40.45 L31.29,40.65 L29.24,41.23 L27.29,42.23 L25.56,43.67 L24.19,45.52 L23.31,47.67 L23.0,50.0 L23.31,52.33 L24.19,54.48 L25.56,56.33 L27.29,57.77 L29.24,58.77 L31.29,59.35 L33.36,59.55 L35.36,59.41 L37.27,59.0 L39.06,58.38 L40.73,57.59 L42.29,56.68 L43.74,55.68 L45.1,54.61 L46.38,53.49 L47.62,52.34 L48.82,51.18 L50.0,50.0 L51.18,48.82 L52.38,47.66 L53.62,46.51 L54.9,45.39 L56.26,44.32 L57.71,43.32 L59.27,42.41 L60.94,41.62 L62.73,41.0 L64.64,40.59 L66.64,40.45 L68.71,40.65 L70.76,41.23 L72.71,42.23 L74.44,43.67 L75.81,45.52 L76.69,47.67 L77.0,50.0';
const LOOP_TRACK = `path('M77.0,50.0 L76.69,52.33 L75.81,54.48 L74.44,56.33 L72.71,57.77 L70.76,58.77 L68.71,59.35 L66.64,59.55 L64.64,59.41 L62.73,59.0 L60.94,58.38 L59.27,57.59 L57.71,56.68 L56.26,55.68 L54.9,54.61 L53.62,53.49 L52.38,52.34 L51.18,51.18 L50.0,50.0 L48.82,48.82 L47.62,47.66 L46.38,46.51 L45.1,45.39 L43.74,44.32 L42.29,43.32 L40.73,42.41 L39.06,41.62 L37.27,41.0 L35.36,40.59 L33.36,40.45 L31.29,40.65 L29.24,41.23 L27.29,42.23 L25.56,43.67 L24.19,45.52 L23.31,47.67 L23.0,50.0 L23.31,52.33 L24.19,54.48 L25.56,56.33 L27.29,57.77 L29.24,58.77 L31.29,59.35 L33.36,59.55 L35.36,59.41 L37.27,59.0 L39.06,58.38 L40.73,57.59 L42.29,56.68 L43.74,55.68 L45.1,54.61 L46.38,53.49 L47.62,52.34 L48.82,51.18 L50.0,50.0 L51.18,48.82 L52.38,47.66 L53.62,46.51 L54.9,45.39 L56.26,44.32 L57.71,43.32 L59.27,42.41 L60.94,41.62 L62.73,41.0 L64.64,40.59 L66.64,40.45 L68.71,40.65 L70.76,41.23 L72.71,42.23 L74.44,43.67 L75.81,45.52 L76.69,47.67 L77.0,50.0')`;

function buildBallIcon() {
  const uid = 'b' + Math.random().toString(36).slice(2, 8);
  return `<svg class="mascot" viewBox="19 36.5 62 27" aria-hidden="true" style="--spd:6s;--track:${LOOP_TRACK}">
  <defs>
    <linearGradient id="lg${uid}" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#a78bfa"/><stop offset=".5" stop-color="#7c5cff"/><stop offset="1" stop-color="#22d3ee"/>
    </linearGradient>
  </defs>
  <path d="${LOOP_D}" fill="none" stroke="url(#lg${uid})" stroke-width="7" stroke-linecap="round"/>
  <path class="dash" d="${LOOP_D}" fill="none" stroke="#a78bfa" stroke-width="1.6"
        stroke-linecap="round" stroke-dasharray="2 12" opacity=".34"/>
  <g class="orb">
    <circle r="6.4" fill="var(--hue)" opacity=".18"/>
    <circle r="3.4" fill="var(--hue)"/>
    <circle r="1.5" fill="#ffffff"/>
  </g>
</svg>`;
}

// ---------- 工具 ----------
async function api(path, body) {
  const r = await fetch(API + path, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const t = await r.text();
  let j; try { j = t ? JSON.parse(t) : {}; } catch (_) { j = { raw: t }; }
  if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status));
  return j;
}
const el = (tag, props = {}, kids = []) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'style') Object.assign(n.style, v);
    else if (k === 'text') n.textContent = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (v !== false && v !== null && v !== undefined) n.setAttribute(k, v);
  }
  for (const k of [].concat(kids)) n.append(k);
  return n;
};
const pct = (v) => v === null || v === undefined ? '--' : (Math.round(v * 1000) / 10) + '%';
const fmtIn = (s) => {
  if (s === null || s === undefined) return '--';
  if (s <= 0) return '已重置';
  const d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60);
  return d > 0 ? `${d}天${h}时` : h > 0 ? `${h}时${m}分` : `${m}分`;
};
const barCls = (v) => v <= .1 ? 'bar crit' : v <= .3 ? 'bar warn' : 'bar';

// ---------- 样式 ----------
const CSS = `
:host { all: initial; }
* { box-sizing: border-box; font-family: "Inter", "Segoe UI Variable Text", "Segoe UI", "Microsoft YaHei UI", "Microsoft YaHei", system-ui, sans-serif;
  -webkit-font-smoothing: antialiased; }
.dock { position: fixed; right: 7px; bottom: 96px; display: flex; align-items: center; pointer-events: auto; isolation: isolate; }
.dock.left { left: 7px; right: auto; }
/* 悬浮球：无底板，图标形状即按钮本体 */
.ball { width: 46px; height: 46px; cursor: pointer; position: relative; background: none; border: 0;
  --hue: #22d3ee;
  display: flex; align-items: center; justify-content: center;
  filter: drop-shadow(0 3px 7px rgba(12,16,32,.24));
  transition: transform .24s cubic-bezier(.2,.85,.25,1), opacity .18s ease, filter .2s; will-change: transform; }
.ball svg.mascot { width: 100%; height: 100%; display: block; overflow: visible; }
.orb { transform-box: fill-box; offset-path: var(--track);
  animation: agyd-run var(--spd, 6s) linear infinite; will-change: offset-distance; }
@keyframes agyd-run { from { offset-distance: 0%; } to { offset-distance: 100%; } }
.dash { animation: agyd-dash calc(var(--spd, 6s) * .55) linear infinite; }
@keyframes agyd-dash { to { stroke-dashoffset: -120; } }
.ball.flash .orb { filter: drop-shadow(0 0 5px var(--hue)); }
.dock.snapped .ball { transform: translateX(4px) scale(.66); transform-origin: right center; opacity: .6; }
.dock.left.snapped .ball { transform: translateX(-4px) scale(.66); transform-origin: left center; }
.dock.snapped .orb, .dock.snapped .dash { animation-play-state: paused; }
.dock.snapped .orb { opacity: .3; }
.dock.snapped:hover .ball { transform: translateX(0) scale(1); opacity: 1; }
.dock:not(.snapped) .ball:hover { transform: scale(1.08); filter: drop-shadow(0 6px 14px rgba(12,16,32,.26)); }
.hot { position: absolute; top: -8px; bottom: -8px; width: 26px; right: -4px; }
.dock.left .hot { left: -4px; right: auto; }

.panel { position: fixed; right: 68px; top: 50%; width: min(980px, calc(100vw - 120px)); min-width: 560px;
  height: auto; max-height: min(84vh, 800px); min-height: 280px;
  display: flex; flex-direction: column; border-radius: 16px; overflow: hidden; color: #1c1c1f;
  background: #f5f6f8;
  border: 1px solid rgba(10,10,12,.08); box-shadow: 0 26px 70px rgba(10,10,20,.26);
  opacity: 0; pointer-events: none;
  transform: translateY(-50%) translateX(12px) scale(.997);
  transition: opacity .16s ease, transform .2s cubic-bezier(.2,.85,.25,1); resize: both; }
.dock.left .panel { right: auto; left: 68px; transform: translateY(-50%) translateX(-12px) scale(.997); }
.panel.open { opacity: 1; transform: translateY(-50%); pointer-events: auto; }
.dock.left .panel.open { transform: translateY(-50%); }
.panel.dark { background: #1b1b20; color: #e9e9ee; border-color: rgba(255,255,255,.10); }

.hd { display: flex; align-items: center; gap: 10px; padding: 14px 16px 10px; }
.hd .brand { display: flex; align-items: center; gap: 8px; font-size: 15px; font-weight: 700; letter-spacing: .1px; }
.hd .ver { font-size: 10.5px; opacity: .42; font-weight: 500; }
.sp { flex: 1; }
.tabs { display: flex; gap: 2px; padding: 0 12px; border-bottom: 1px solid rgba(120,120,150,.16); overflow-x: auto; }
.tabs::-webkit-scrollbar { display: none; }
.tab { padding: 10px 13px; font-size: 13.5px; font-weight: 500; cursor: pointer; opacity: .55; border-bottom: 2px solid transparent; white-space: nowrap; }
.tab.on { opacity: 1; font-weight: 600; border-bottom-color: #4f8cff; }
.body { padding: 14px 16px 18px; overflow: auto; flex: 1; min-height: 0; }
.body::-webkit-scrollbar { width: 8px; }
.body::-webkit-scrollbar-thumb { background: rgba(120,120,150,.3); border-radius: 4px; }

.card { border: 1px solid rgba(120,120,150,.16); border-radius: 12px; padding: 14px; margin-bottom: 12px; background: #ffffff; }
.panel.dark .card { background: rgba(255,255,255,.05); border-color: rgba(255,255,255,.10); }
.card > h4 { margin: 0 0 10px; font-size: 13.5px; font-weight: 650; opacity: .9; display: flex; align-items: center; gap: 7px; }
.card > h4 .tag { font-size: 9.5px; font-weight: 600; padding: 1px 6px; border-radius: 6px; background: rgba(79,140,255,.14); color: #3b74d8; }
.panel.dark .card > h4 .tag { background: rgba(120,170,255,.18); color: #9fc0ff; }

.stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 14px; }
.stat { border: 1px solid rgba(120,120,150,.16); border-radius: 14px; padding: 14px 16px; background: #ffffff; }
.panel.dark .stat { background: rgba(255,255,255,.05); border-color: rgba(255,255,255,.1); }
.stat .k { font-size: 11px; opacity: .55; font-weight: 500; }
.stat .v { font-size: 20px; font-weight: 750; line-height: 1.25; margin-top: 3px; letter-spacing: -.2px; }
.stat .s { font-size: 10.5px; opacity: .48; margin-top: 2px; }

.row { display: flex; align-items: center; gap: 8px; padding: 8px 9px; border-radius: 9px; background: rgba(120,120,150,.07); margin-bottom: 6px; }
.row.cur { outline: 1.5px solid #4f8cff; background: rgba(79,140,255,.10); }
.row .em { font-size: 12px; font-weight: 600; }
.row .sub { font-size: 10.5px; opacity: .6; margin-top: 1px; }
.btn { border: 1px solid rgba(120,120,150,.32); background: rgba(255,255,255,.65); color: inherit; font-size: 11.5px;
  padding: 5px 10px; border-radius: 8px; cursor: pointer; white-space: nowrap; }
.btn:hover { background: rgba(120,120,150,.18); }
.btn.pri { background: #4f8cff; border-color: #4f8cff; color: #fff; }
.btn.ghost { background: transparent; }
.btn.danger { color: #d33; border-color: rgba(221,51,51,.35); }
.btn:disabled { opacity: .45; cursor: default; }
.seg { display: flex; gap: 2px; background: rgba(120,120,150,.14); border-radius: 9px; padding: 2px; }
.seg > button { flex: 1; font-size: 11.5px; padding: 6px 5px; border: 0; border-radius: 7px; background: transparent; color: inherit; cursor: pointer; opacity: .72; }
.seg > button.on { background: #1c1c1f; color: #fff; opacity: 1; font-weight: 600; }
.panel.dark .seg > button.on { background: #f0f0f4; color: #17171b; }
.sw { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 7px 2px; font-size: 12.5px; }
.sw .hint { font-size: 10.5px; opacity: .55; margin-top: 2px; }
.tgl { width: 40px; height: 22px; border-radius: 12px; background: rgba(120,120,150,.35); position: relative; cursor: pointer; flex: none; transition: background .18s; }
.tgl.on { background: #34c759; }
.tgl::after { content:''; position: absolute; top: 2px; left: 2px; width: 18px; height: 18px; border-radius: 50%; background: #fff;
  transition: transform .2s cubic-bezier(.2,.85,.25,1); box-shadow: 0 1px 3px rgba(0,0,0,.3); }
.tgl.on::after { transform: translateX(18px); }
.bar { height: 6px; border-radius: 4px; background: rgba(120,120,150,.2); overflow: hidden; margin-top: 5px; }
.bar > i { display: block; height: 100%; background: linear-gradient(90deg,#3ecf8e,#4f8cff); }
.bar.warn > i { background: linear-gradient(90deg,#f6c445,#f0823c); }
.bar.crit > i { background: linear-gradient(90deg,#f0823c,#e5484d); }
.bk { display: flex; justify-content: space-between; font-size: 11.5px; opacity: .84; }
.ov-hello { display: flex; align-items: flex-start; margin-bottom: 16px; }
.ov-hello .h1 { font-size: 22px; font-weight: 750; letter-spacing: -.4px; }
.ov-hello .sub { font-size: 11.5px; opacity: .55; margin-top: 3px; }
.ov-hello .ops { margin-left: auto; display: flex; gap: 8px; }
.chips { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 16px; }
.chip { font-size: 11.5px; padding: 6px 11px; border-radius: 9px; background: rgba(120,120,150,.10); font-weight: 500; }
.chip.on { background: #14161a; color: #fff; }
.grid4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; margin-bottom: 14px; }
.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
@media (max-width: 860px) { .grid4 { grid-template-columns: 1fr 1fr } .grid2 { grid-template-columns: 1fr } }
.metric { border: 1px solid rgba(120,120,150,.16); border-radius: 14px; padding: 16px; background: #fff; display: flex; flex-direction: column; }
.metric .t { display: flex; align-items: center; gap: 7px; font-size: 12.5px; font-weight: 650; }
.metric .big { font-size: 26px; font-weight: 780; letter-spacing: -.6px; margin-top: 14px; line-height: 1; }
.metric .u { font-size: 12px; font-weight: 600; opacity: .4; margin-left: 3px; }
.metric .h { font-size: 11px; opacity: .5; margin-top: 7px; line-height: 1.5; }
.metric .foot { margin-top: auto; padding-top: 12px; display: flex; align-items: center; justify-content: space-between; font-size: 10.5px; opacity: .55; }
.metric .pill { font-size: 11px; padding: 2px 8px; border-radius: 7px; background: rgba(62,207,142,.16); color: #1a8f5f; font-weight: 650; }
.metric .pill.warn { background: rgba(240,161,60,.18); color: #a8641a; }
.metric .pill.crit { background: rgba(229,72,77,.16); color: #b0262b; }
.accbar { display: flex; align-items: flex-end; gap: 16px; padding: 2px 2px 12px; }
.accbar .lab { font-size: 11px; opacity: .55; margin-bottom: 2px; }
.accbar .val { font-size: 17px; font-weight: 750; letter-spacing: -.1px; }
.accbar .sp { flex: 1; }
.iconbtn { width: 32px; height: 32px; border-radius: 9px; border: 1px solid rgba(120,120,150,.28);
  background: rgba(255,255,255,.75); display: flex; align-items: center; justify-content: center;
  cursor: pointer; font-size: 14px; line-height: 1; color: inherit; }
.iconbtn:hover { background: rgba(120,120,150,.16); }
.acc { border: 1px solid rgba(120,120,150,.18); border-radius: 13px; padding: 13px 15px; background: rgba(255,255,255,.66); margin-bottom: 10px; }
.acc.cur { border-color: rgba(79,140,255,.6); box-shadow: 0 0 0 1px rgba(79,140,255,.22); }
.acc .top { display: flex; align-items: center; gap: 8px; }
.acc .name { font-size: 13.5px; font-weight: 700; }
.acc .badge { font-size: 10.5px; padding: 2px 7px; border-radius: 6px; border: 1px solid rgba(120,120,150,.32); opacity: .8; }
.acc .badge.on { background: #1c1c1f; color: #fff; border-color: #1c1c1f; opacity: 1; }
.acc .ops { margin-left: auto; display: flex; gap: 6px; }
.acc .meta { display: flex; justify-content: space-between; align-items: baseline; margin-top: 9px; font-size: 11.5px; }
.acc .meta .k { opacity: .52; margin-right: 5px; }
.acc .meta .v { font-weight: 650; }
.acc .pbar { height: 7px; border-radius: 4px; background: rgba(120,120,150,.16); overflow: hidden; margin-top: 9px; }
.acc .pbar > i { display: block; height: 100%; border-radius: 4px; transition: width .4s ease; }
.acc .pbar.ok > i { background: linear-gradient(90deg,#3ecf8e,#4f8cff); }
.acc .pbar.warn > i { background: linear-gradient(90deg,#f6c445,#f0823c); }
.acc .pbar.crit > i { background: linear-gradient(90deg,#f0823c,#e5484d); }
.acc .pbar.idle > i { background: rgba(120,120,150,.35); }
.small { font-size: 11.5px; opacity: .6; line-height: 1.65; }
.kv { display: grid; grid-template-columns: 96px 1fr; gap: 5px 8px; font-size: 11.5px; }
.kv > span:nth-child(odd) { opacity: .55; }
textarea, input[type=text] { width: 100%; font-size: 12px; padding: 7px 9px; border-radius: 8px; color: inherit;
  border: 1px solid rgba(120,120,150,.3); background: rgba(255,255,255,.75); }
.panel.dark textarea, .panel.dark input[type=text] { background: rgba(255,255,255,.08); }
.toast { position: fixed; left: 50%; bottom: 44px; transform: translateX(-50%); background: #111a; color: #fff;
  font-size: 12px; padding: 8px 14px; border-radius: 10px; z-index: 2147483002; pointer-events: none; }
.inline-btn { display: inline-flex; align-items: center; height: 22px; padding: 0 7px; margin-right: 4px; font-size: 11px;
  border-radius: 6px; cursor: pointer; color: inherit; background: rgba(120,120,150,.14); border: 1px solid rgba(120,120,150,.2); }
.inline-btn:hover { background: rgba(120,120,150,.26); }
.fork-btn { font-size: 10px; padding: 2px 6px; border-radius: 6px; cursor: pointer; margin-left: 6px;
  background: rgba(120,120,150,.16); border: 1px solid rgba(120,120,150,.22); opacity: 0; transition: opacity .15s; }
.turn:hover .fork-btn { opacity: .92; }

.ball { overflow: visible; }
.mascot { display: block; }
.mascot { display: block; width: 100%; height: 100%; }

.menus { display: flex; flex-direction: column; gap: 6px; }
.menus .row { justify-content: space-between; }
.log { font-family: ui-monospace, Consolas, monospace; font-size: 10.5px; line-height: 1.5; white-space: pre-wrap;
  max-height: 200px; overflow: auto; background: rgba(0,0,0,.05); border-radius: 8px; padding: 8px; }
.panel.dark .log { background: rgba(255,255,255,.06); }
`;

// ---------- 输入区样式（light DOM）----------
// 工具条与浮层挂在官方 DOM（不是 shadow root），因此必须单独注入页面级样式，
// 否则类名不生效 —— 这正是旧版按钮退化成浏览器默认按钮、看起来「只有字儿」的原因。
const LIGHT_CSS = `
.agyd-slot { display:inline-flex; align-items:center; gap:4px; margin-right:8px; flex-shrink:0; }
.agyd-pill {
  display:inline-flex; align-items:center; justify-content:flex-start; gap:0;
  width:28px; height:28px; padding:0 6px; margin:0; flex:0 0 auto;
  border:none; border-radius:50%; cursor:pointer; overflow:hidden;
  background:#1c1c1f; color:#fff; box-shadow:0 1px 3px rgba(0,0,0,.2);
  font:inherit; font-size:12.5px; line-height:1; -webkit-user-select:none; user-select:none;
  transition: width .18s ease, border-radius .18s ease, padding .15s ease,
              background .15s ease, opacity .15s ease, box-shadow .15s ease;
}
.agyd-pill:hover { width:var(--agyd-w,96px); border-radius:40px; padding-right:10px; background:#2c2c33; }
.agyd-pill:active { background:#15151a; }
.agyd-pill:focus-visible { outline:2px solid #4f8cff; outline-offset:2px; }
.agyd-pill[data-empty="1"] { opacity:.42; box-shadow:none; }
.agyd-pill-ico { display:flex; align-items:center; justify-content:center; flex-shrink:0; width:16px; height:16px; }
.agyd-pill-ico svg { width:16px; height:16px; display:block; }
.agyd-pill-txt {
  opacity:0; max-width:0; overflow:hidden; white-space:nowrap;
  font-size:12.5px; font-weight:500; margin-left:0;
  transition: opacity .18s ease, max-width .22s ease, margin-left .22s ease;
}
.agyd-pill:hover .agyd-pill-txt { opacity:1; max-width:78px; margin-left:7px; }

.agyd-pop {
  position:fixed; left:0; bottom:0; width:296px; max-width:86vw; z-index:2147483002;
  opacity:0; visibility:hidden; transform:translateY(6px); pointer-events:none;
  transition: opacity .18s ease, transform .18s ease, visibility 0s linear .18s;
  font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;
}
.agyd-pop.open { opacity:1; visibility:visible; transform:translateY(0); pointer-events:auto; transition-delay:0s; }
/* 隐形桥接区：补上按钮与浮层之间的空隙，鼠标移入时不会因短暂离开按钮而收起。
   不设 pointer-events，跟随父级（未打开时为 none，不会挡住页面点击）。 */
.agyd-pop::before {
  content:''; position:absolute; left:-14px; right:-14px; bottom:-16px; height:18px;
}
.agyd-pop-card {
  padding:8px; border-radius:12px; color:#1c1c1f; cursor:default;
  background:rgba(255,255,255,.9);
  -webkit-backdrop-filter:blur(18px) saturate(1.3); backdrop-filter:blur(18px) saturate(1.3);
  border:1px solid rgba(10,10,12,.09); box-shadow:0 12px 32px rgba(0,0,0,.18);
}
.agyd-pop-title { padding:2px 8px 6px; font-size:11px; font-weight:600; color:#8a8a92; }
.agyd-pop-list { max-height:236px; overflow-y:auto; overflow-anchor:none; scrollbar-width:thin; }
.agyd-pop-row {
  position:relative; display:flex; align-items:center; gap:8px;
  padding:8px 10px; border-radius:8px; font-size:12.5px; line-height:1.45; cursor:pointer;
}
.agyd-pop-row:hover, .agyd-pop-row:focus-within { background:rgba(10,10,20,.06); }
.agyd-pop-txt { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; padding-right:28px; }
.agyd-pop-act { position:absolute; right:6px; display:flex; gap:2px; opacity:0; transition:opacity .12s ease; }
.agyd-pop-row:hover .agyd-pop-act, .agyd-pop-row:focus-within .agyd-pop-act { opacity:1; }
.agyd-act-btn {
  display:inline-flex; align-items:center; justify-content:center;
  width:24px; height:24px; padding:0; border:none; border-radius:6px;
  background:transparent; color:#666; cursor:pointer; flex-shrink:0;
}
.agyd-act-btn:hover { background:rgba(10,10,20,.09); color:#1c1c1f; }
.agyd-act-btn.danger:hover { color:#d64545; }
.agyd-act-btn svg { width:15px; height:15px; display:block; }
.agyd-pop-foot {
  display:flex; align-items:center; justify-content:space-between; gap:8px;
  padding:8px 6px 2px; margin-top:2px; border-top:1px solid rgba(10,10,12,.08);
}
.agyd-pop-link { display:inline-flex; align-items:center; gap:5px; font-size:12px; font-weight:500; color:#555; cursor:pointer; }
.agyd-pop-link:hover { color:#1c1c1f; }
.agyd-pop-link svg { width:14px; height:14px; display:block; }
.agyd-pop-count { font-size:11.5px; color:#9a9aa2; }
.agyd-pop-empty { padding:14px 8px; text-align:center; font-size:12px; color:#9a9aa2; }
`;

// ---------- 主题接管 ----------
const THEMES = {
  follow: {},
  light: { '--background': '#FFFFFF', '--content': '#FFFFFF', '--card': '#FFFFFF', '--sidebar': '#F7F7F9' },
  dark: { '--background': '#161619', '--content': '#161619', '--card': '#1d1d21', '--sidebar': '#121214', '--foreground': '#EDEDF0', '--secondary-foreground': '#C9C9D2', '--border': 'rgba(255,255,255,.09)', '--card-border': 'rgba(255,255,255,.10)' },
  green: { '--background': '#EAF3E7', '--content': '#EDF6EA', '--card': '#F4FAF1', '--sidebar': '#DFEDDA', '--foreground': '#1F3320', '--secondary-foreground': '#33472F', '--border': 'rgba(40,80,40,.14)' },
  cyber: { '--background': '#12091f', '--content': '#150a24', '--card': '#1c0f30', '--sidebar': '#0d0617', '--foreground': '#EAD9FF', '--secondary-foreground': '#C4A6F5', '--border': 'rgba(180,120,255,.22)' },
  glass: { '--background': 'rgba(250,250,255,.62)', '--content': 'rgba(255,255,255,.55)', '--card': 'rgba(255,255,255,.42)', '--sidebar': 'rgba(245,245,252,.55)', '--glass-border': 'rgba(255,255,255,.55)' },
};
let themeStyle = null;
function applyTheme(cfg) {
  const on = cfg.takeOverTheme !== false;
  const name = on ? (cfg.theme || 'follow') : 'follow';
  if (!themeStyle) { themeStyle = document.createElement('style'); themeStyle.id = 'agy-daddy-theme'; document.head.append(themeStyle); }
  const vars = THEMES[name] || {};
  if (!on || name === 'follow' || !Object.keys(vars).length) {
    themeStyle.textContent = ''; document.documentElement.removeAttribute('data-agyd-theme');
    if (state.ui) state.ui.panel.classList.remove('dark');
    return;
  }
  document.documentElement.setAttribute('data-agyd-theme', name);
  const darkish = name === 'dark' || name === 'cyber';
  const decl = Object.entries(vars).map(([k, v]) => `${k}: ${v} !important;`).join('');
  themeStyle.textContent = `:root[data-agyd-theme="${name}"] { ${decl} ${darkish ? 'color-scheme: dark;' : 'color-scheme: light;'} }
    :root[data-agyd-theme="${name}"] body { background: var(--background) !important; }`;
  if (state.ui) state.ui.panel.classList.toggle('dark', darkish);
}

// ---------- 贴边 ----------
const uiCfg = () => (state.config && state.config.ui) || {};
let snapTimer = null;
function scheduleSnap() {
  const ui = state.ui; if (!ui) return;
  clearTimeout(snapTimer);
  if (!uiCfg().autoSnap) { ui.dock.classList.remove('snapped'); return; }
  snapTimer = setTimeout(() => { if (!ui.panel.classList.contains('open')) ui.dock.classList.add('snapped'); },
    uiCfg().snapDelayMs || 5000);
}
function unsnap() { clearTimeout(snapTimer); if (state.ui) state.ui.dock.classList.remove('snapped'); }

function toast(msg, ms = 2200) {
  const t = el('div', { class: 'toast', text: msg });
  document.body.append(t); setTimeout(() => t.remove(), ms);
}

// ---------- 面板骨架 ----------
const ALL_TABS = [['overview', '总览'], ['accounts', '账号'], ['models', '模型'],
  ['conversations', '会话'], ['boost', '增强'], ['automation', '自动化'],
  ['system', '电脑'], ['gateway', '中转站'], ['theme', '主题'], ['about', '关于']];
function visibleTabs() {
  const hidden = uiCfg().hiddenTabs || [];
  const list = ALL_TABS.filter(([k]) => k === 'overview' || !hidden.includes(k));
  return list.length ? list : [ALL_TABS[0]];
}

function renderPanel() {
  const ui = state.ui;
  ui.tabBar = el('div', { class: 'tabs' });
  ui.body = el('div', { class: 'body' });
  ui.panel.replaceChildren(
    el('div', { class: 'hd' }, [
      el('div', { class: 'brand', html: LOGO + '<span>Antigravity Daddy</span><span class="ver">v0.3</span>' }),
      el('div', { class: 'sp' }),
      el('button', { class: 'iconbtn', text: '☰', title: '菜单显示', onclick: () => { state.tab = 'menus'; drawTabs(); } }),
      el('button', { class: 'iconbtn', text: '↻', title: '刷新配额（向上游重新拉取）', onclick: (e) => refreshQuotaNow(e.currentTarget) }),
      el('button', { class: 'iconbtn', text: '✕', title: '收起', onclick: () => togglePanel(false) }),
    ]),
    ui.tabBar, ui.body,
  );
  drawTabs();
}
function drawTabs() {
  const ui = state.ui;
  const tabs = visibleTabs();
  if (!tabs.some(([k]) => k === state.tab) && state.tab !== 'menus') state.tab = tabs[0][0];
  ui.tabBar.replaceChildren(...tabs.map(([k, l]) => el('div', {
    class: 'tab' + (state.tab === k ? ' on' : ''), text: l,
    onclick: () => { state.tab = k; drawTabs(); },
  })));
  drawBody();
}
function drawBody() {
  const b = state.ui && state.ui.body; if (!b) return;
  const map = {
    overview: tabOverview, accounts: tabAccounts, quota: tabQuota, models: tabModels,
    conversations: tabConversations, boost: tabBoost, automation: tabAutomation,
    system: tabSystem, gateway: tabGateway, theme: tabTheme, about: tabAbout, menus: tabMenus,
  };
  (map[state.tab] || tabOverview)(b);
}
function togglePanel(show) {
  const ui = state.ui;
  const open = show === undefined ? !ui.panel.classList.contains('open') : show;
  ui.panel.classList.toggle('open', open);
  if (open) { unsnap(); refresh(true); } else { scheduleSnap(); }
}

// ---------- 菜单显示（对齐 Tools 的“菜单显示”） ----------
function tabMenus(box) {
  box.replaceChildren();
  const hidden = uiCfg().hiddenTabs || [];
  const card = el('div', { class: 'card' }, [el('h4', {}, [document.createTextNode('菜单显示'), el('span', { class: 'tag', text: '总览常驻' })])]);
  card.append(el('div', { class: 'small', text: '勾选需要显示的页签；隐藏只是不显示，不影响功能。' }));
  const list = el('div', { class: 'menus', style: { marginTop: '8px' } });
  ALL_TABS.forEach(([k, label]) => {
    const locked = k === 'overview';
    const on = locked || !hidden.includes(k);
    const row = el('div', { class: 'row' }, [
      el('div', { class: 'em', text: label }),
      el('div', {
        class: 'tgl' + (on ? ' on' : '') + (locked ? ' lock' : ''),
        style: locked ? { opacity: '.45', cursor: 'default' } : {},
        onclick: async () => {
          if (locked) return;
          const cur = new Set(uiCfg().hiddenTabs || []);
          cur.has(k) ? cur.delete(k) : cur.add(k);
          await api('/api/settings', { ui: { hiddenTabs: [...cur] } });
          await refresh(true);
        },
      }),
    ]);
    list.append(row);
  });
  card.append(list);
  card.append(el('button', { class: 'btn pri', style: { marginTop: '10px' }, text: '完成', onclick: () => { state.tab = 'overview'; drawTabs(); } }));
  box.append(card);
}

// ---------- 总览 ----------
// 真正的「刷新」：向上游重新拉配额（POST /api/refresh），而不是只重读本地 state。
// 之前所有刷新按钮都只调 refresh(true)，配额一直停在缓存里，看起来就是「点了没反应」。
async function refreshQuotaNow(btn) {
  const label = btn ? btn.textContent : null;
  if (btn) { btn.disabled = true; btn.textContent = '…'; }
  try {
    const r = await api('/api/refresh', {});
    await refresh(true);
    if (r && r.ok) {
      const ms = r.meta && r.meta.lastDurationMs != null ? `（${r.meta.lastDurationMs}ms）` : '';
      const err = r.meta && r.meta.lastError;
      toast(err ? `已刷新 · 上游提示：${String(err).slice(0, 60)}` : `配额已刷新${ms}`, 3600);
    } else {
      toast('刷新失败: ' + ((r && r.error) || '上游无响应'), 4200);
    }
  } catch (e) {
    // /api/refresh 在快照失败时返回 500，api() 会抛错，这里统一收口
    toast('刷新失败: ' + e.message, 4200);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = label; }
  }
}

function quotaGroups() { return (state.quota && state.quota.groups) || []; }
function groupOf(name) { return quotaGroups().find(g => (g.name || '').includes(name)); }
function bucket(g, win) { return g && (g.buckets || []).find(b => b.window === win); }

function tabOverview(box) {
  box.replaceChildren();
  const cur = state.accounts.find(a => a.isCurrent);
  const q = state.quota;
  const plan = (q && q.plan) || {};
  const gem = groupOf('Gemini Models');
  const third = groupOf('Claude and GPT');
  const arg = groupOf('Argon');
  const wkOf = (g) => g ? bucket(g, 'weekly') : null;
  const fhOf = (g) => g ? bucket(g, '5h') : null;
  const errs = (q && q.errors) || [];
  const stage = (state.ls && state.ls.stage) || (state.ls && state.ls.attached ? 'ready' : 'waiting');
  const up = errs.length === 0 && qgHasData();
  // 未登录 / LS 未就绪时不显示「上游异常」和 0%，显式说明原因
  const stageText = stage === 'login' ? '客户端未登录' : stage === 'waiting' ? '等待连接客户端' : null;
  const who = (plan.name || (cur && (cur.email || '').split('@')[0]) || '用户').trim();

  // 问候 + 主操作
  box.append(el('div', { class: 'ov-hello' }, [
    el('div', {}, [
      el('div', { class: 'h1', text: `你好，${who} 👋` }),
      el('div', { class: 'sub', text: cur ? `当前 ${cur.email} · ${plan.planName || '未知套餐'}` : '尚未纳入任何账号' }),
    ]),
    el('div', { class: 'ops' }, [
      el('button', { class: 'btn pri', text: '刷新配额', onclick: async () => { await refresh(true); toast('已刷新'); } }),
      el('button', { class: 'btn', text: '+ 添加账号', onclick: () => pasteBox(box) }),
    ]),
  ]));

  // 上游不可用时的显式横幅（不把「读不到」显示成 0%）
  if (stageText || errs.length) {
    const why = stageText || String(errs[0] || '上游未响应');
    box.append(el('div', { class: 'card', style: { borderColor: 'rgba(229,72,77,.35)' } }, [
      el('h4', { text: '⚠ 上游数据不可用' }),
      el('div', { class: 'small', text: why + '。下方配额/账号数据可能为空或为缓存值，不代表真实余量为 0。' }),
      el('div', { class: 'small', style: { marginTop: '5px' }, text: stageText === '客户端未登录' ? '请在官方客户端完成登录，本面板会自动重新挂载（约 12 秒内）。' : '确认客户端在运行、上游可达后点「刷新配额」。' }),
    ]));
  }

  // 状态 chips
  const chips = el('div', { class: 'chips' });
  chips.append(el('div', { class: 'chip on', text: '综合加权' }));
  chips.append(el('div', { class: 'chip', text: `可用账号 ${state.accounts.filter(a => !a.disabled).length}` }));
  chips.append(el('div', { class: 'chip', text: stageText ? `上游 ${stageText}` : `上游 ${up ? '正常' : '异常'}` }));
  if (errs.length) chips.append(el('div', { class: 'chip', text: '上游返回错误' }));
  if (plan.canBuyCredits) chips.append(el('div', { class: 'chip', text: '可加购额度' }));
  const autoOn = (state.config && state.config.autoSwitch && state.config.autoSwitch.enabled);
  chips.append(el('div', { class: 'chip', text: '自动切换 ' + (autoOn ? '开' : '关') }));
  box.append(chips);

  // 4 张指标卡
  const grid = el('div', { class: 'grid4' });
  const mkMetric = (title, big, unit, hint, foot, pillText, pillCls) => {
    const m = el('div', { class: 'metric' });
    const t = el('div', { class: 't', text: title });
    if (pillText) t.append(el('span', { class: 'pill ' + (pillCls || ''), text: pillText }));
    m.append(t);
    m.append(el('div', { class: 'big' }, [document.createTextNode(big), el('span', { class: 'u', text: unit || '' })]));
    if (hint) m.append(el('div', { class: 'h', text: hint }));
    if (foot) m.append(el('div', { class: 'foot' }, [el('div', { text: foot })]));
    return m;
  };

  const okCount = state.accounts.filter(a => !a.disabled).length;
  grid.append(mkMetric('账号生态', `${okCount}`, `/ ${state.accounts.length} 可用`, '手动停用 / 已移除不计入', `号池容量 ${state.accounts.length}`, okCount ? '正常' : '', okCount ? '' : 'warn'));

  const gw = wkOf(gem), gf = fhOf(gem);
  grid.append(mkMetric('Gemini 模型', gw ? Math.round((gw.remaining || 0) * 100) : '--', '%', '7 天周配额剩余',
    gf ? `5H 滚动 ${pct(gf.remaining)}` : '5H 滚动 --',
    gw && gw.remaining <= .3 ? '偏低' : (gw ? '充足' : ''), gw && gw.remaining <= .3 ? 'warn' : ''));

  const tw = wkOf(third), tf = fhOf(third);
  grid.append(mkMetric('Claude & GPT', tw ? Math.round((tw.remaining || 0) * 100) : '--', '%', '7 天周配额剩余',
    tf ? `5H 滚动 ${pct(tf.remaining)}` : '第三方模型池',
    tw && tw.remaining <= .3 ? '偏低' : (tw ? '充足' : ''), tw && tw.remaining <= .3 ? 'warn' : ''));

  const health = gw && tw ? Math.round(((gw.remaining + tw.remaining) / 2) * 100) : (gw ? Math.round(gw.remaining * 100) : '--');
  grid.append(mkMetric('健康度 & 风控', health, '%', '两池周配额均值',
    errs.length ? errs[0].slice(0, 34) : '零上游报错',
    errs.length ? '有风险' : '全绿无风险', errs.length ? 'crit' : ''));
  box.append(grid);

  // 底排：当前账号 / 最佳推荐
  const g2 = el('div', { class: 'grid2' });

  const curCard = el('div', { class: 'card', style: { marginBottom: '0' } }, [el('h4', { text: '当前账号' })]);
  if (cur) {
    curCard.append(el('div', { class: 'acc', style: { marginBottom: '0', border: '0', padding: '0', background: 'transparent' } }, [
      el('div', { class: 'top' }, [
        el('div', { class: 'name', text: cur.label || (cur.email || '').split('@')[0] }),
        el('div', { class: 'badge on', text: '使用中' }),
        plan.planName ? el('div', { class: 'badge', text: plan.planName }) : '',
      ]),
      el('div', { class: 'meta' }, [
        el('div', {}, [el('span', { class: 'k', text: '账号' }), el('span', { class: 'v', text: cur.email || '--' })]),
        el('div', {}, [el('span', { class: 'k', text: '周配额重置' }), el('span', { class: 'v', text: gw ? fmtIn(gw.resetInSec) : '--' })]),
      ]),
    ]));
  } else {
    curCard.append(el('div', { class: 'small', text: '还没有纳入账号。点上方「+ 添加账号」或「刷新配额」自动纳入当前登录的账号。' }));
  }
  g2.append(curCard);

  const bestCard = el('div', { class: 'card', style: { marginBottom: '0' } }, [el('h4', { text: '最佳账号推荐' })]);
  if (state.accounts.length <= 1) {
    bestCard.append(el('div', { class: 'small', text: '号池不足 2 个账号，暂无法比较。添加第二个账号后，这里会按配额余量推荐该切给谁。' }));
  } else {
    const cands = state.accounts.filter(a => !a.isCurrent && !a.disabled);
    bestCard.append(el('div', { class: 'small', text: cands.length ? `可切换 ${cands.length} 个账号，点「切最佳」自动挑额度最高的一个。` : '没有可切换的账号' }));
  }
  g2.append(bestCard);
  box.append(g2);
}

function tabAccounts(box) {
  box.replaceChildren();
  const accs = state.accounts;
  const plan = (state.quota && state.quota.plan) || {};
  const wk = (quotaGroups().map(g => bucket(g, 'weekly')).filter(Boolean))[0];
  const five = (quotaGroups().map(g => bucket(g, '5h')).filter(Boolean))[0];

  // 登录页 / 未连上时，账号列表依然可用（本地号池 + 本地凭据），
  // 这是从登录页「逃生」的唯一入口，必须说清楚。
  const stage = (state.ls && state.ls.stage) || null;
  if (stage === 'login' || stage === 'waiting') {
    box.append(el('div', {
      class: 'card',
      style: { borderColor: 'rgba(240,161,60,.55)', background: 'rgba(240,161,60,.10)', marginBottom: '10px' },
    }, [
      el('div', { style: { fontWeight: '700', marginBottom: '4px' }, text: stage === 'login' ? '客户端停在登录页' : '等待客户端连接' }),
      el('div', { class: 'small', text: stage === 'login'
        ? '下面的账号来自本地号池，不受登录状态影响。直接点其它账号的「切换」即可换号（会写凭据并重启客户端，不需要先在这里登录）。配额要登录后才能读取。'
        : '守护已就绪，正在等官方客户端开窗口；窗口出现后本面板会自动接管，期间本地账号仍可操作。' }),
    ]));
  }

  box.append(el('div', { class: 'accbar' }, [
    el('div', {}, [el('div', { class: 'lab', text: '账号数' }), el('div', { class: 'val', text: String(accs.length) })]),
    el('div', { style: { width: '1px', height: '34px', background: 'rgba(120,120,150,.22)' } }),
    el('div', {}, [el('div', { class: 'lab', text: '周配额剩余' }), el('div', { class: 'val', text: wk ? pct(wk.remaining) : '--' })]),
    el('div', {}, [el('div', { class: 'lab', text: '套餐' }), el('div', { class: 'val', style: { fontSize: '16px' }, text: plan.planName || '--' })]),
    el('div', {}, [el('div', { class: 'lab', text: '上次刷新' }),
      el('div', { class: 'val', style: { fontSize: '12px', fontWeight: '600' },
        text: (state.quotaMeta && state.quotaMeta.lastRefreshAt) ? (Math.max(0, Math.round((Date.now() - state.quotaMeta.lastRefreshAt) / 1000)) < 2 ? '刚刚' : Math.round((Date.now() - state.quotaMeta.lastRefreshAt) / 1000) + ' 秒前') : '--' })]),
    el('div', { class: 'sp' }),
    el('button', { class: 'iconbtn', title: '刷新配额（向上游重新拉取）', text: '↻', onclick: (e) => refreshQuotaNow(e.currentTarget) }),
    el('button', { class: 'iconbtn', title: '立即预热', text: '⚡', onclick: async () => {
      const r = await api('/api/quota/preheat', {}).catch(e => ({ error: e.message }));
      toast(r.error ? '预热失败: ' + r.error : `已预热 ${r.meta ? r.meta.lastDurationMs : '?'}ms`, 3600);
      await refresh(true);
    } }),
    el('button', { class: 'iconbtn', title: '导出账号', text: '↑', onclick: exportAccounts }),
    el('button', { class: 'iconbtn', title: '导入账号', text: '↓', onclick: importAccounts }),
    el('button', { class: 'iconbtn', title: '切最佳', text: '⇄', onclick: bestSwitch }),
  ]));

  const search = el('input', { type: 'text', placeholder: '搜索邮箱…', value: state.search });
  search.oninput = () => { state.search = search.value; drawBody(); };
  search.style.marginBottom = '12px';
  box.append(search);

  const list = accs.filter(a => !state.search || (a.email || '').toLowerCase().includes(state.search.toLowerCase()));
  if (!list.length) {
    box.append(el('div', { class: 'small', text: accs.length ? '没有匹配的账号' : '号池为空，点下方「纳入当前」把正在登录的账号收进来' }));
  }

  list.forEach(a => {
    const isCur = a.isCurrent;
    const card = el('div', { class: 'acc' + (isCur ? ' cur' : '') });
    const top = el('div', { class: 'top' });
    top.append(el('div', { class: 'name', text: a.label || (a.email || '').split('@')[0] }));
    if (isCur) top.append(el('div', { class: 'badge on', text: '当前使用' }));
    if (plan.planName && isCur) top.append(el('div', { class: 'badge', text: plan.planName }));
    if (a.forbiddenModels && a.forbiddenModels.length) top.append(el('div', { class: 'badge', text: '冻结 ' + a.forbiddenModels.length }));
    // 没有 refresh_token 的账号切过去会停在登录页，提前标出来
    if (a.canAutoLogin === false) top.append(el('div', { class: 'badge', text: '需手动登录' }));
    top.append(el('div', { class: 'ops' }, [
      el('button', {
        class: 'btn' + (isCur ? '' : ' pri'), text: isCur ? '已激活' : '切换',
        onclick: async (e) => {
          if (isCur) return;
          const b = e.currentTarget; b.disabled = true; b.textContent = '重启中…';
          if (a.canAutoLogin === false) toast('该账号缺少 refresh_token，切换后需要手动登录一次', 5200);
          try {
            const r = await api('/api/switch', { id: a.id });
            if (r.ok) {
              toast(r.note || `当前已经是 ${r.after}`, 4200);
              b.disabled = false; b.textContent = '切换';
            } else if (r.restarting) {
              toast(r.note || '正在重启客户端以加载新账号，约 1 分钟', 7000);
            } else {
              toast(r.note || '凭据已写入但未生效，请手动重启客户端', 5000);
              b.disabled = false; b.textContent = '切换';
            }
          } catch (err) {
            // 重启会重载页面，请求被切断属预期，不必当成失败报错
            toast('客户端重启中，页面随后会自动恢复', 5000);
          }
          await refresh(true).catch(() => { });
        },
      }),
      el('button', { class: 'btn danger', text: '移除', onclick: async () => { await api('/api/account/delete', { id: a.id }); await refresh(true); } }),
    ]));
    card.append(top);

    card.append(el('div', { class: 'meta' }, [
      el('div', {}, [el('span', { class: 'k', text: '账号' }), el('span', { class: 'v', text: a.email || '--' })]),
      el('div', {}, [el('span', { class: 'k', text: '周配额重置' }), el('span', { class: 'v', text: isCur && wk ? fmtIn(wk.resetInSec) : '切换后读取' })]),
    ]));

    const rem = isCur && wk ? wk.remaining : null;
    const used5h = isCur && five ? (1 - (five.remaining || 0)) : null;
    card.append(el('div', { class: 'meta' }, [
      el('div', {}, [el('span', { class: 'k', text: '剩余' }), el('span', { class: 'v', text: isCur ? pct(rem) : '--' })]),
      el('div', {}, [el('span', { class: 'k', text: '5 小时窗口已用' }), el('span', { class: 'v', text: !isCur ? '--' : (five ? pct(used5h) : '无 5H 窗口') })]),
    ]));

    const cls = !isCur ? 'idle' : rem === null ? 'idle' : rem <= .1 ? 'crit' : rem <= .3 ? 'warn' : 'ok';
    const bar = el('div', { class: 'pbar ' + cls });
    bar.append(el('i', { style: { width: (isCur && rem !== null ? Math.max(2, Math.min(100, rem * 100)) : 0) + '%' } }));
    card.append(bar);

    box.append(card);
  });

  box.append(el('div', { style: { display: 'flex', gap: '8px', marginTop: '4px', flexWrap: 'wrap' } }, [
    el('button', { class: 'btn pri', text: '登录新账号', onclick: () => pasteBox(box) }),
    el('button', { class: 'btn', text: '纳入当前', onclick: async () => { const r = await api('/api/account/adopt', {}).catch(e => ({ error: e.message })); toast(r.error || (r.duplicate ? '已在号池' : '已纳入')); await refresh(true); } }),
    el('button', { class: 'btn', text: '切最佳', onclick: bestSwitch }),
    el('button', { class: 'btn', text: '清空搜索', onclick: async () => { state.search = ''; await refresh(true); } }),
  ]));

  // 当前账号配额明细
  const qg = quotaGroups();
  const det = el('div', { class: 'card', style: { marginTop: '14px' } }, [el('h4', {}, [document.createTextNode('当前账号配额'), el('span', { class: 'tag', text: plan.email || '--' })])]);
  if (!qg.length) det.append(el('div', { class: 'small', text: '暂未读到配额（上游可能未响应，点刷新重试）' }));
  qg.forEach(g => {
    const row = el('div', { class: 'row', style: { alignItems: 'flex-start', flexDirection: 'column', gap: '6px' } });
    row.append(el('div', { style: { display: 'flex', width: '100%', alignItems: 'baseline' } }, [
      el('div', { class: 'em', style: { flex: '1' }, text: g.nameZh || g.name }),
      el('div', { class: 'sub', text: (g.buckets || []).map(b => `${b.windowZh} ${pct(b.remaining)}`).join('  ·  ') }),
    ]));
    (g.buckets || []).forEach(b => {
      const bar = el('div', { class: barCls(b.remaining), style: { width: '100%', marginTop: '0' } });
      bar.append(el('i', { style: { width: Math.max(2, Math.min(100, (b.remaining || 0) * 100)) + '%' } }));
      row.append(el('div', { style: { width: '100%' } }, [
        el('div', { class: 'sub', style: { marginBottom: '3px' }, text: `${b.windowZh}：剩余 ${pct(b.remaining)} · ${fmtIn(b.resetInSec)} 后重置` }),
        bar,
      ]));
    });
    det.append(row);
  });
  const cr = plan.promptCredits, fl = plan.flowCredits;
  if (cr || fl) {
    det.append(el('div', { class: 'row', style: { justifyContent: 'space-between' } }, [
      el('div', { class: 'sub', text: `Prompt ${cr ? cr.available + ' / ' + cr.monthly : '--'}` }),
      el('div', { class: 'sub', text: `Flow ${fl ? fl.available + ' / ' + fl.monthly : '--'}` }),
    ]));
  }
  box.append(det);

  box.append(el('div', { class: 'small', style: { marginTop: '10px' }, text: '切号 = 重写 Windows 凭据 gemini:antigravity（App / CLI / IDE 共用一条）。客户端的语言服务会把 token 缓存在内存里，只改凭据不会生效，所以切换时客户端会自动重启一次（约 1 分钟），回来后就是新账号；配额只有当前激活的账号能读。' }));
}

async function exportAccounts() {
  try {
    const d = await api('/api/account/export', {});
    const blob = new Blob([JSON.stringify(d, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'agy-daddy-accounts-' + new Date().toISOString().slice(0, 10) + '.json';
    a.click();
    URL.revokeObjectURL(a.href);
    toast('已导出（含 refresh_token，勿外传）', 3800);
  } catch (e) { toast('导出失败: ' + e.message); }
}

function importAccounts() {
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = '.json,application/json';
  inp.onchange = async () => {
    const f = inp.files && inp.files[0];
    if (!f) return;
    try {
      const txt = await f.text();
      const j = JSON.parse(txt);
      const r = await api('/api/account/import', j);
      toast(`导入完成：新增 ${r.added}，重复 ${r.dup}`, 4200);
      await refresh(true);
    } catch (e) { toast('导入失败: ' + e.message, 4200); }
  };
  inp.click();
}

function pasteBox(box) {
  const old = box.querySelector('.paste-card');
  if (old) { old.remove(); return; }
  const wrap = el('div', { class: 'card paste-card', style: { marginTop: '12px' } }, [el('h4', { text: '添加账号' })]);
  wrap.append(el('div', { class: 'small', text: '两种方式：① 点「纳入当前」直接把正在登录的账号收进来；② 把别处导出的凭据 JSON 粘贴到下面。' }));
  const ta = el('textarea', { rows: '6', placeholder: '{"token":{"access_token":"...","refresh_token":"...","expiry":"..."},"id_token_email":"a@b.com"}' });
  ta.style.cssText = 'width:100%;margin-top:10px;border-radius:10px;border:1px solid rgba(120,120,150,.3);padding:10px;font-size:12px;font-family:ui-monospace,Consolas,monospace;resize:vertical;color:inherit;background:rgba(255,255,255,.7)';
  wrap.append(ta);
  wrap.append(el('div', { style: { display: 'flex', gap: '8px', marginTop: '10px' } }, [
    el('button', {
      class: 'btn pri', text: '保存',
      onclick: async () => {
        try {
          const j = JSON.parse(ta.value.trim());
          const r = await api('/api/account/add', { creds: j, label: j.id_token_email || '' });
          toast(r.duplicate ? '该账号已在号池' : '已添加');
          wrap.remove();
          await refresh(true);
        } catch (e) { toast('解析失败: ' + e.message, 4000); }
      },
    }),
    el('button', { class: 'btn', text: '取消', onclick: () => wrap.remove() }),
  ]));
  box.append(wrap);
  ta.focus();
}

async function bestSwitch() {
  try {
    const r = await api('/api/best-switch', {});
    if (r.ok) toast(`已切到 ${r.after || r.current || '最佳账号'}`, 4200);
    else if (r.restarting) toast(r.note || '正在重启客户端以加载新账号，约 1 分钟', 7000);
    else toast(r.reason || r.note || '没有可切换的账号', 4200);
    await refresh(true).catch(() => { });
  } catch (e) {
    // 重启导致页面重载时请求会被切断，属预期
    toast('客户端重启中，页面随后会自动恢复', 5000);
  }
}

function qgHasData() {
  return quotaGroups().some(g => (g.buckets || []).length > 0);
}


function tabQuota(box) {
  box.replaceChildren();
  const q = state.quota;
  const qm = state.quotaMeta || {};
  const qcfg = (state.config && state.config.quota) || {};
  const ago = qm.lastRefreshAt ? Math.max(0, Math.round((Date.now() - qm.lastRefreshAt) / 1000)) : null;

  // 刷新状态条（Step 2）
  const bar = el('div', { class: 'accbar' }, [
    el('div', {}, [el('div', { class: 'lab', text: '上次刷新' }), el('div', { class: 'val', style: { fontSize: '16px' }, text: ago === null ? '尚未刷新' : (ago < 2 ? '刚刚' : ago + ' 秒前') })]),
    el('div', { style: { width: '1px', height: '30px', background: 'rgba(120,120,150,.22)' } }),
    el('div', {}, [el('div', { class: 'lab', text: '耗时' }), el('div', { class: 'val', style: { fontSize: '16px' }, text: (qm.lastDurationMs == null ? '--' : qm.lastDurationMs + 'ms') })]),
    el('div', {}, [el('div', { class: 'lab', text: '自动刷新' }), el('div', { class: 'val', style: { fontSize: '16px' }, text: (qcfg.autoRefresh === false ? '关闭' : '每 ' + Math.round((qcfg.refreshSec || 120) / 60) + ' 分') })]),
    el('div', { class: 'sp' }),
    el('button', { class: 'btn pri', text: '立即预热', onclick: async () => {
      const r = await api('/api/quota/preheat', {}).catch(e => ({ error: e.message }));
      toast(r.error ? '预热失败: ' + r.error : `已预热 ${r.meta ? r.meta.lastDurationMs : '?'}ms`, 3600);
      await refresh(true);
    } }),
  ]);
  box.append(bar);

  if (!q) { box.append(el('div', { class: 'small', text: '暂无数据' })); return; }
  if (q.errors && q.errors.length) {
    box.append(el('div', { class: 'card' }, [el('h4', { text: '⚠ 上游异常' }), el('div', { class: 'small', text: String(q.errors[0]) })]));
  }
  (q.groups || []).forEach(g => {
    const c = el('div', { class: 'card' }, [el('h4', {}, [document.createTextNode(g.nameZh || g.name), el('span', { class: 'tag', text: g.name })] )]);
    (g.buckets || []).forEach(b => {
      const v = b.remaining || 0;
      c.append(el('div', { style: { marginBottom: '8px' } }, [
        el('div', { class: 'bk' }, [el('span', { text: b.windowZh || b.window }), el('span', { text: `${pct(b.remaining)} · ${fmtIn(b.resetInSec)} 后重置` })]),
        el('div', { class: barCls(v) }, [el('i', { style: { width: Math.max(1, v * 100) + '%' } })]),
      ]));
    });
    box.append(c);
  });
  const api2 = el('div', { class: 'card' }, [el('h4', { text: '操作' })]);
  api2.append(el('div', { style: { display: 'flex', gap: '7px' } }, [
    el('button', { class: 'btn pri', text: '刷新', onclick: () => refresh(true) }),
    el('button', { class: 'btn', text: '打开官方设置-模型', onclick: () => { const b = document.querySelector('[data-testid="settings-button"]'); if (b) b.click(); else toast('未找到'); } }),
  ]));
  const seg = el('div', { class: 'seg', style: { width: '190px' } });
  [[60, '1 分'], [120, '2 分'], [300, '5 分']].forEach(([v, l]) => {
    seg.append(el('button', {
      class: (qcfg.refreshSec || 120) === v ? 'on' : '', text: l,
      onclick: async () => { await api('/api/settings', { quota: { refreshSec: v } }); await refresh(true); },
    }));
  });
  api2.append(el('div', { class: 'sw' }, [
    el('div', {}, [el('div', { text: '自动定时刷新' }), el('div', { class: 'hint', text: '后台按间隔刷新配额，面板不打开也生效' })]),
    el('div', { class: 'tgl' + (qcfg.autoRefresh !== false ? ' on' : ''), onclick: async () => {
      await api('/api/settings', { quota: { autoRefresh: !(qcfg.autoRefresh !== false) } });
      await refresh(true);
    } }),
  ]));
  api2.append(el('div', { class: 'sw' }, [
    el('div', {}, [el('div', { text: '刷新间隔' }), el('div', { class: 'hint', text: '太频繁会被上游限流，建议 2 分钟' })]),
    seg,
  ]));
  api2.append(el('div', { class: 'small', style: { marginTop: '8px' }, text: '「立即预热」= 主动打一次配额 RPC，把上游缓存拉新后再判定自动切换；不做伪造请求。' }));
  box.append(api2);
}

// ---------- 模型 ----------
function tabModels(box) {
  box.replaceChildren();
  const models = state.models || [];
  const plan = (state.quota && state.quota.plan) || {};

  box.append(el('div', { class: 'accbar' }, [
    el('div', {}, [el('div', { class: 'lab', text: '模型数' }), el('div', { class: 'val', text: String(models.length) })]),
    el('div', { style: { width: '1px', height: '30px', background: 'rgba(120,120,150,.22)' } }),
    el('div', {}, [el('div', { class: 'lab', text: '可用池' }), el('div', { class: 'val', style: { fontSize: '13px' }, text: quotaGroups().map(g => g.nameZh || g.name).join(' · ') || '--' })]),
    el('div', { class: 'sp' }),
    el('button', { class: 'iconbtn', title: '刷新模型', text: '↻', onclick: async () => { await refresh(true); toast('已刷新'); } }),
    el('button', { class: 'iconbtn', title: '打开官方选择器', text: '↗', onclick: () => {
      const b = document.querySelector('[data-testid="model-selector-trigger"]');
      if (b) b.click(); else toast('未找到官方模型选择器');
    } }),
  ]));

  const search = el('input', { type: 'text', placeholder: '搜索模型…', value: state.modelSearch || '' });
  search.oninput = () => { state.modelSearch = search.value; drawBody(); };
  search.style.marginBottom = '12px';
  box.append(search);

  const q = (state.modelSearch || '').toLowerCase();
  const list = models.filter(m => !q || ((m.label || '') + (m.modelId || '')).toLowerCase().includes(q));

  if (!list.length) {
    box.append(el('div', { class: 'small', text: models.length ? '没有匹配的模型' : '暂无模型数据（需客户端已登录并连上 LS）' }));
    return;
  }

  // 分组：Gemini / Claude / GPT / 其它
  const buckets = [['Gemini 池', m => /gemini/i.test(m.modelId || m.label || '')],
    ['Claude 池', m => /claude|opus|sonnet|haiku/i.test(m.modelId || m.label || '')],
    ['GPT 池', m => /gpt|o[34]/i.test(m.modelId || m.label || '')]];
  const used = new Set();
  buckets.forEach(([title, test]) => {
    const arr = list.filter(m => test(m));
    arr.forEach(m => used.add(m));
    if (!arr.length) return;
    const c = el('div', { class: 'card' }, [el('h4', {}, [document.createTextNode(title), el('span', { class: 'tag', text: arr.length + ' 个' })])]);
    arr.forEach(m => {
      const rem = m.remaining === null || m.remaining === undefined ? null : m.remaining;
      const row = el('div', { class: 'row', style: { flexDirection: 'column', alignItems: 'stretch', gap: '5px' } });
      row.append(el('div', { style: { display: 'flex', alignItems: 'baseline', gap: '8px' } }, [
        el('div', { class: 'em', style: { flex: '1' }, text: m.label || m.modelId || '未命名' }),
        el('div', { class: 'sub', text: rem === null ? '--' : pct(rem) }),
        el('button', { class: 'btn ghost', style: { fontSize: '10.5px' }, text: '复制 ID', onclick: () => {
          navigator.clipboard.writeText(m.modelId || m.label || '');
          toast('已复制 ' + (m.modelId || m.label));
        } }),
      ]));
      const bar = el('div', { class: rem === null ? 'bar' : barCls(rem), style: { marginTop: '0' } });
      bar.append(el('i', { style: { width: Math.max(1, (rem || 0) * 100) + '%' } }));
      row.append(bar);
      row.append(el('div', { class: 'sub', style: { fontSize: '10px' }, text: m.modelId || '' }));
      c.append(row);
    });
    box.append(c);
  });

  const others = list.filter(m => !used.has(m));
  if (others.length) {
    const c = el('div', { class: 'card' }, [el('h4', {}, [document.createTextNode('其它'), el('span', { class: 'tag', text: others.length + ' 个' })])]);
    others.forEach(m => c.append(el('div', { class: 'row' }, [
      el('div', { style: { flex: '1', minWidth: 0 } }, [
        el('div', { class: 'em', text: m.label || m.modelId }),
        el('div', { class: 'sub', text: m.modelId || '' }),
      ]),
      el('span', { class: 'badge', text: m.remaining === null ? '--' : pct(m.remaining) }),
    ])));
    box.append(c);
  }

  box.append(el('div', { class: 'small', style: { marginTop: '4px' }, text: '配额按客户端返回的剩余比例展示；模型是否可用以官方选择器为准，这里只做只读展示。' }));
}


function tabConversations(box) {
  box.replaceChildren();
  const names = [...document.querySelectorAll('[data-project-label]')].map(n => n.getAttribute('data-project-label')).filter(Boolean);
  const rows = [...document.querySelectorAll('[data-testid="conversation-kebab"]')].length;
  const c = el('div', { class: 'card' }, [el('h4', { text: '项目 / 会话（官方侧栏）' })]);
  c.append(el('div', { class: 'small', text: `项目 ${names.length} 个 · 会话行 ${rows} 条` }));
  names.slice(0, 20).forEach(n => c.append(el('div', { class: 'row' }, [el('div', { class: 'em', text: n })])));
  c.append(el('button', { class: 'btn', style: { marginTop: '6px' }, text: '打开会话导航', onclick: () => { const b = document.querySelector('[data-testid="conversation-kebab"]'); if (b) b.click(); else toast('未找到'); } }));
  box.append(c);

  const d = el('div', { class: 'card' }, [el('h4', { text: '暂存提示词' })]);
  const ds = (state.drafts || []).filter(x => x.kind !== 'fork');
  if (!ds.length) d.append(el('div', { class: 'small', text: '还没有暂存。输入框写好内容后点左侧书签按钮即可存进来。' }));
  ds.forEach(x => d.append(el('div', { class: 'row', style: { flexDirection: 'column', alignItems: 'stretch' } }, [
    el('div', { class: 'em', text: (x.text || '').slice(0, 120) }),
    el('div', { style: { display: 'flex', gap: '6px', marginTop: '5px' } }, [
      el('button', { class: 'btn', text: '填入', onclick: () => { insertText(x.text); toast('已填入'); } }),
      el('button', { class: 'btn', text: '发送', onclick: () => { insertText(x.text); setTimeout(clickSend, 120); } }),
      el('button', { class: 'btn danger', text: '删除', onclick: async () => { await api('/api/drafts/delete', { id: x.id }); await refresh(true); } }),
    ]),
  ])));
  box.append(d);

  const forks = (state.drafts || []).filter(x => x.kind === 'fork');
  if (forks.length) {
    const f = el('div', { class: 'card' }, [el('h4', { text: '分支上下文（' + forks.length + '）' })]);
    forks.slice(-5).reverse().forEach(x => f.append(el('div', { class: 'row', style: { flexDirection: 'column', alignItems: 'stretch' } }, [
      el('div', { class: 'small', text: (x.text || '').slice(0, 100) }),
      el('button', { class: 'btn', style: { marginTop: '4px', alignSelf: 'flex-start' }, text: '填入输入框', onclick: () => { insertText(x.text); toast('已填入'); } }),
    ])));
    box.append(f);
  }
}

// ---------- 增强 ----------
function tabBoost(box) {
  box.replaceChildren();
  const u = (state.config && state.config.unattended) || {};
  const uic = uiCfg();
  const upc = (state.config && state.config.upstream) || {};
  const mk = (label, hint, key, val, group) => el('div', { class: 'sw' }, [
    el('div', {}, [el('div', { text: label }), el('div', { class: 'hint', text: hint })]),
    el('div', { class: 'tgl' + (val ? ' on' : ''), onclick: async () => { await api('/api/settings', { [group]: { [key]: !val } }); await refresh(true); } }),
  ]);
  // 自动切换（Step 1）
  const autoCfg = (state.config && state.config.autoSwitch) || { enabled: false, threshold: 0.3, intervalSec: 120, cooldownSec: 300 };
  const autoSt = state.auto || {};
  const autoCard = el('div', { class: 'card' }, [el('h4', {}, [document.createTextNode('自动切换'), el('span', { class: 'tag', text: autoCfg.enabled ? '已启用' : '已关闭' })])]);
  autoCard.append(el('div', { class: 'sw' }, [
    el('div', {}, [el('div', { text: '配额见底自动换号' }), el('div', { class: 'hint', text: '任一模型池周配额低于阈值时，切到优先级最高的其它账号' })]),
    el('div', { class: 'tgl' + (autoCfg.enabled ? ' on' : ''), onclick: async () => {
      await api('/api/auto', { enabled: !autoCfg.enabled });
      await refresh(true);
    } }),
  ]));
  const thSeg = el('div', { class: 'seg', style: { width: '180px' } });
  [[0.2, '20%'], [0.3, '30%'], [0.5, '50%']].forEach(([v, l]) => {
    thSeg.append(el('button', {
      class: Math.abs((autoCfg.threshold || 0.3) - v) < 0.001 ? 'on' : '', text: l,
      onclick: async () => { await api('/api/auto', { threshold: v }); await refresh(true); },
    }));
  });
  autoCard.append(el('div', { class: 'sw' }, [
    el('div', {}, [el('div', { text: '触发阈值' }), el('div', { class: 'hint', text: '取最紧张的一池做判定' })]),
    thSeg,
  ]));
  const ivSeg = el('div', { class: 'seg', style: { width: '180px' } });
  [[60, '1 分'], [120, '2 分'], [300, '5 分']].forEach(([v, l]) => {
    ivSeg.append(el('button', {
      class: (autoCfg.intervalSec || 120) === v ? 'on' : '', text: l,
      onclick: async () => { await api('/api/auto', { intervalSec: v }); await refresh(true); },
    }));
  });
  autoCard.append(el('div', { class: 'sw' }, [
    el('div', {}, [el('div', { text: '巡检间隔' }), el('div', { class: 'hint', text: '切完进入 5 分钟冷却，避免来回跳' })]),
    ivSeg,
  ]));
  autoCard.append(el('div', { class: 'small', style: { marginTop: '10px' }, text: '状态：' + (autoSt.lastAction || '未启用')
    + (autoSt.lastCheckAt ? '（上次巡检 ' + new Date(autoSt.lastCheckAt).toLocaleTimeString() + '）' : '') }));
  autoCard.append(el('div', { style: { display: 'flex', gap: '8px', marginTop: '10px' } }, [
    el('button', { class: 'btn', text: '立即判定一次', onclick: async () => {
      const r = await api('/api/auto/tick', {}).catch(e => ({ error: e.message }));
      toast(r.error ? '失败: ' + r.error : (r.state && r.state.lastAction) || '已执行', 4200);
      await refresh(true);
    } }),
  ]));
  box.append(autoCard);

  box.append(el('div', { class: 'card' }, [
    el('h4', { text: '无人值守' }),
    mk('中断 / 限流自动续接', '检测到中断或 429 时自动重试或发「继续」', 'autoContinue', u.autoContinue, 'unattended'),
    mk('权限弹窗免打扰', '自动点确认（风险自负，默认关）', 'autoConfirm', u.autoConfirm, 'unattended'),
  ]));
  box.append(el('div', { class: 'card' }, [
    el('h4', { text: '注入项' }),
    mk('输入框「暂存 / 短语」', '挂到官方输入框底栏', 'showComposerBar', uic.showComposerBar !== false, 'ui'),
    mk('回复旁「分支」按钮', '把该轮上下文写入草稿', 'showFork', uic.showFork !== false, 'ui'),
  ]));
  // 上游代理设置页（Step 4）：开关 / 地址 / NO_PROXY / 连通性实测 / 重启提示
  const upCard = el('div', { class: 'card' }, [
    el('h4', {}, [document.createTextNode('上游代理（强制）'), el('span', { class: 'tag', text: '重启客户端后生效' })]),
    mk('客户端固定走代理', 'LS 是 Go 进程，只认 HTTP(S)_PROXY；Chromium 的 --proxy-server 对它无效', 'enabled', upc.enabled, 'upstream'),
  ]);
  const proxyInp = el('input', { type: 'text', value: upc.proxy || 'http://127.0.0.1:7897', placeholder: 'http://127.0.0.1:7897' });
  const noProxyInp = el('input', { type: 'text', value: upc.noProxy || '127.0.0.1,localhost,::1', placeholder: '127.0.0.1,localhost,::1' });
  const grid = el('div', { class: 'kv', style: { gridTemplateColumns: '96px 1fr', alignItems: 'center' } });
  grid.append(el('span', { text: '代理地址' }), proxyInp, el('span', { text: 'NO_PROXY' }), noProxyInp);
  upCard.append(grid);
  const netOut = el('div', { class: 'small', style: { marginTop: '8px' }, text: '未实测。直连 / 代理两条链路可分别测，不改任何系统设置。' });
  upCard.append(el('div', { style: { display: 'flex', gap: '7px', marginTop: '9px', flexWrap: 'wrap' } }, [
    el('button', { class: 'btn pri', text: '保存设置', onclick: async () => {
      const v = proxyInp.value.trim();
      if (!/^https?:\/\/[^\s:]+:\d+$/.test(v)) { toast('地址格式应为 http://host:port'); return; }
      await api('/api/settings', { upstream: { proxy: v, noProxy: noProxyInp.value.trim() } });
      toast('已保存；重启客户端后生效');
      await refresh(true);
    } }),
    el('button', { class: 'btn', text: '连通性实测', onclick: async () => {
      netOut.textContent = '实测中…';
      const r = await api('/api/netcheck', {}).catch(e => ({ error: e.message }));
      if (r.error) { netOut.textContent = '实测失败：' + r.error; return; }
      const f = (x) => x ? `${x.via === 'proxy' ? '代理' : '直连'} HTTP ${x.status || '—'}${x.error ? '（' + x.error + '）' : ''}` : '无结果';
      netOut.textContent = `${f(r.direct)} ｜ ${f(r.proxied)} ｜ 代理 ${r.proxy || '--'}`;
      toast('实测完成', 3000);
    } }),
    el('button', { class: 'btn', text: '重启守护进程', onclick: async () => {
      const r = await api('/api/attach', {}).catch(e => ({ error: e.message }));
      toast(r.error ? '重连失败: ' + r.error : '守护进程已重新挂载');
    } }),
  ]));
  upCard.append(netOut);
  upCard.append(el('div', { class: 'small', style: { marginTop: '8px' }, text: '改地址后需完全退出 Antigravity 再由本程序重新拉起；只关窗口不退出进程不会重新读环境变量。' }));
  box.append(upCard);
}

// ---------- 自动化 ----------
function tabAutomation(box) {
  box.replaceChildren();
  const c = el('div', { class: 'card' }, [el('h4', { text: '官方自动化（原生）' })]);
  const items = [...document.querySelectorAll('[data-testid="automation-group"],[data-testid="automation-name"]')].slice(0, 12);
  if (!items.length) c.append(el('div', { class: 'small', text: '当前页面无列表，点下方按钮进入官方面板。' }));
  items.forEach(n => c.append(el('div', { class: 'row' }, [el('div', { class: 'em', text: (n.textContent || '').trim().slice(0, 80) })])));
  c.append(el('div', { style: { display: 'flex', gap: '7px', marginTop: '8px' } }, [
    el('button', { class: 'btn pri', text: '打开 Automations', onclick: () => { const b = pick('automationsBtn'); if (b) b.click(); else toast('未找到入口'); } }),
    el('button', { class: 'btn', text: '刷新', onclick: drawBody }),
  ]));
  box.append(c);
  box.append(el('div', { class: 'card' }, [el('h4', { text: '编排（规划中）' }),
    el('div', { class: 'small', text: '不重造官方调度器。计划：按配额阈值巡检账号 → 触发原生 automation / 切换账号 → 记录运行结果到本地面板。' })]));
}

// ---------- 诊断 ----------
function appendLog(card, text) {
  const old = card.querySelector('.log'); if (old) old.remove();
  card.append(el('div', { class: 'log', text: String(text || '') }));
}

function tabSystem(box) {
  box.replaceChildren();
  const s = state.sysinfo || {};
  const qm = state.quotaMeta || {};
  const au = state.auto || {};

  // 顶部：运行指标
  box.append(el('div', { class: 'accbar' }, [
    el('div', {}, [el('div', { class: 'lab', text: '客户端' }), el('div', { class: 'val', style: { fontSize: '14px' }, text: s.agyVersion || '--' })]),
    el('div', { style: { width: '1px', height: '30px', background: 'rgba(120,120,150,.22)' } }),
    el('div', {}, [el('div', { class: 'lab', text: 'CDP / LS' }), el('div', { class: 'val', style: { fontSize: '14px' }, text: (s.cdpPort || '--') + ' / ' + (s.lsPort || '--') })]),
    el('div', {}, [el('div', { class: 'lab', text: '上次刷新' }), el('div', { class: 'val', style: { fontSize: '14px' }, text: qm.lastRefreshAt ? Math.round((Date.now() - qm.lastRefreshAt) / 1000) + ' 秒前' : '--' })]),
    el('div', {}, [el('div', { class: 'lab', text: '自动切换' }), el('div', { class: 'val', style: { fontSize: '14px' }, text: (state.config && state.config.autoSwitch && state.config.autoSwitch.enabled) ? '开' : '关' })]),
    el('div', { class: 'sp' }),
    el('button', { class: 'iconbtn', title: '重新注入界面', text: '⟳', onclick: async () => {
      const r = await api('/api/inject', {}).catch(e => ({ error: e.message }));
      toast(r.error ? '注入失败: ' + r.error : '已重新注入');
    } }),
  ]));

  // 环境
  const c = el('div', { class: 'card' }, [el('h4', { text: '环境' })]);
  const kv = el('div', { class: 'kv' });
  const put = (k, v) => kv.append(el('span', { text: k }), el('span', { text: v === null || v === undefined ? '--' : String(v) }));
  put('系统', s.platform); put('CPU', s.cpu); put('内存', s.mem);
  put('数据目录', s.dataDir);
  c.append(kv);
  c.append(el('div', { style: { display: 'flex', gap: '7px', marginTop: '9px', flexWrap: 'wrap' } }, [
    el('button', { class: 'btn', text: '数据目录', onclick: () => api('/api/openfolder', { which: 'data' }).catch(e => toast(e.message)) }),
    el('button', { class: 'btn', text: '备份目录', onclick: () => api('/api/openfolder', { which: 'backups' }).catch(e => toast(e.message)) }),
    el('button', { class: 'btn', text: '日志目录', onclick: () => api('/api/openfolder', { which: 'logs' }).catch(e => toast(e.message)) }),
    el('button', { class: 'btn', text: '缓存目录', onclick: () => api('/api/openfolder', { which: 'cache' }).catch(e => toast(e.message)) }),
  ]));
  box.append(c);

  // 上游连通性
  const net = el('div', { class: 'card' }, [el('h4', { text: '上游连通性' })]);
  net.append(el('div', { class: 'small', text: '直连 vs 代理实测，确认客户端拿配额/会话的链路是否通。' }));
  net.append(el('div', { style: { display: 'flex', gap: '7px', marginTop: '9px' } }, [
    el('button', { class: 'btn pri', text: '实测', onclick: async () => {
      const r = await api('/api/netcheck', {}).catch(e => ({ error: e.message }));
      appendLog(net, JSON.stringify(r, null, 1));
      toast(r.error ? '失败: ' + r.error : '实测完成', 3000);
    } }),
    el('button', { class: 'btn', text: '立即预热配额', onclick: async () => {
      const r = await api('/api/quota/preheat', {}).catch(e => ({ error: e.message }));
      toast(r.error ? '失败: ' + r.error : `已预热 ${r.meta ? r.meta.lastDurationMs : '?'}ms`, 3600);
      await refresh(true);
    } }),
  ]));
  box.append(net);

  // 运行日志（内嵌）：级别过滤 / 关键词 / 行数 / 复制 / 刷新 / 打开目录
  const lg = el('div', { class: 'card' }, [el('h4', {}, [document.createTextNode('运行日志'), el('span', { class: 'tag', text: 'daemon.log' })])]);
  const lf = state.logFilter || { level: 'all', q: '', limit: 200 };
  let lastLog = '';
  const meta = el('div', { class: 'small', style: { marginTop: '8px' } });
  const syncMeta = (r) => { meta.textContent = r ? `显示 ${r.shown || 0} / 共 ${r.total || 0} 行 · 最近 ${lf.limit} 行内过滤` : ''; };
  const load = async () => {
    const qs = new URLSearchParams({ level: lf.level, limit: String(lf.limit), ...(lf.q ? { q: lf.q } : {}) });
    const r = await api('/api/logs?' + qs.toString()).catch(e => ({ log: e.message }));
    lastLog = r.log || '(空)';
    appendLog(lg, lastLog);
    syncMeta(r);
    lg.append(meta); // 元信息固定在日志块下方
  };
  const seg = el('div', { class: 'seg', style: { width: '210px' } });
  [['all', '全部'], ['error', '错误'], ['warn', '警告'], ['info', '信息']].forEach(([v, l]) => {
    seg.append(el('button', { class: lf.level === v ? 'on' : '', text: l, onclick: async () => {
      state.logFilter = lf; lf.level = v; await refresh(false); drawBody();
    } }));
  });
  const q = el('input', { type: 'text', placeholder: '关键词过滤…', value: lf.q });
  const limitSel = el('select', {});
  [80, 200, 500].forEach(n => limitSel.append(el('option', { value: String(n), text: n + ' 行' })));
  limitSel.value = String(lf.limit);
  limitSel.style.cssText = 'font-size:11.5px;padding:5px 7px;border-radius:8px;border:1px solid rgba(120,120,150,.3);color:inherit;background:rgba(255,255,255,.75)';
  lg.append(el('div', { style: { display: 'flex', gap: '7px', marginBottom: '9px', flexWrap: 'wrap', alignItems: 'center' } }, [
    seg,
    el('div', { style: { flex: '1 1 130px', minWidth: '110px' } }, [q]),
    limitSel,
  ]));
  lg.append(el('div', { style: { display: 'flex', gap: '7px', marginBottom: '9px', flexWrap: 'wrap' } }, [
    el('button', { class: 'btn pri', text: '刷新', onclick: load }),
    el('button', { class: 'btn', text: '过滤', onclick: async () => {
      lf.q = q.value.trim(); lf.limit = Number(limitSel.value) || 200;
      state.logFilter = lf; await load();
    } }),
    el('button', { class: 'btn', text: '复制', onclick: async () => {
      try { await navigator.clipboard.writeText(lastLog); toast('已复制日志'); }
      catch (_) {
        const t = document.createElement('textarea'); t.value = lastLog; document.body.append(t); t.select();
        try { document.execCommand('copy'); toast('已复制日志'); } catch (e) { toast('复制失败: ' + e.message); }
        t.remove();
      }
    } }),
    el('button', { class: 'btn', text: '打开目录', onclick: () => api('/api/openfolder', { which: 'logs' }).catch(e => toast(e.message)) }),
  ]));
  box.append(lg);
  load();

  // 维护
  const mt = el('div', { class: 'card' }, [el('h4', { text: '维护' })]);
  mt.append(el('div', { class: 'small', text: '不做破坏性操作：清理缓存/删除数据都只打开目录，由你手动处理。' }));
  mt.append(el('div', { style: { display: 'flex', gap: '7px', marginTop: '9px', flexWrap: 'wrap' } }, [
    el('button', { class: 'btn', text: '打开客户端缓存', onclick: () => api('/api/openfolder', { which: 'cache' }).catch(e => toast(e.message)) }),
    el('button', { class: 'btn', text: '重新连接客户端', onclick: async () => {
      const r = await api('/api/attach', { port: Number(s.cdpPort) || 9333 }).catch(e => ({ error: e.message }));
      toast(r.error ? '连接失败: ' + r.error : '已重新连接');
    } }),
  ]));
  box.append(mt);
}

function tabGateway(box) {
  box.replaceChildren();
  const g = (state.config && state.config.gateway) || {};
  const st = state.gatewayProbe || null;
  const url = g.url || ('http://127.0.0.1:' + (g.externalPort || 8045));

  box.append(el('div', { class: 'ov-hello', style: { marginBottom: '14px' } }, [
    el('div', {}, [
      el('div', { class: 'h1', text: 'AI 中转站' }),
      el('div', { class: 'sub', text: '把本机客户端的能力暴露成标准 API；当前为占位入口，尚未接入服务' }),
    ]),
    el('div', { class: 'ops' }, [
      el('span', { class: 'pill ' + (st && st.online ? '' : 'warn'), text: st ? (st.online ? '在线' : '未连接') : '未检测' }),
    ]),
  ]));

  // 状态卡
  const grid = el('div', { class: 'grid4' });
  const mk = (t, big, unit, hint, pill, cls) => {
    const m = el('div', { class: 'metric' });
    m.append(el('div', { class: 't' }, [document.createTextNode(t), pill ? el('span', { class: 'pill ' + (cls || ''), text: pill }) : '']));
    m.append(el('div', { class: 'big' }, [document.createTextNode(big), el('span', { class: 'u', text: unit || '' })]));
    m.append(el('div', { class: 'h', text: hint }));
    return m;
  };
  grid.append(mk('接入状态', st ? (st.online ? '在线' : '离线') : '待接入', '', st ? (st.error || ('HTTP ' + st.status + ' · ' + st.latencyMs + 'ms')) : '尚未探测服务地址', st && st.online ? '可用' : '未接入', st && st.online ? '' : 'warn'));
  grid.append(mk('服务地址', (g.externalPort || 8045), ' 端口', url, '', ''));
  grid.append(mk('路由模型', '0', ' 个', '接入后在此配置模型映射', '未接入', 'warn'));
  grid.append(mk('调用统计', '0', ' 次', '接入后统计请求量与 Token', '未接入', 'warn'));
  box.append(grid);

  // 地址 + 探测
  const card = el('div', { class: 'card' }, [el('h4', { text: '服务地址' })]);
  const inp = el('input', { type: 'text', value: url, placeholder: 'http://127.0.0.1:8045' });
  inp.style.marginBottom = '10px';
  card.append(inp);
  card.append(el('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } }, [
    el('button', { class: 'btn pri', text: '检测连通性', onclick: async () => {
      const r = await api('/api/gateway/probe', { url: inp.value.trim() }).catch(e => ({ error: e.message }));
      state.gatewayProbe = r;
      const c = r.contract;
      const tail = c ? (c.openaiCompatible ? ` · OpenAI 兼容 · ${c.modelCount} 个模型` : ' · 非 /v1/models 契约') : '';
      toast(r.error ? '探测失败: ' + r.error : (r.online ? `在线 · HTTP ${r.status} · ${r.latencyMs}ms${tail}` : '未连接：' + (r.error || '')), 4800);
      drawBody();
    } }),
    el('button', { class: 'btn', text: '查看对接契约', onclick: async () => {
      const r = await api('/api/gateway/contract').catch(e => ({ error: e.message }));
      state.gatewayContract = r;
      toast(r.error ? '读取失败: ' + r.error : '已展开对接契约（只读）', 3000);
      drawBody();
    } }),
    el('button', { class: 'btn', text: '保存地址', onclick: async () => {
      try {
        const u = new URL(inp.value.trim());
        await api('/api/settings', { gateway: { url: u.origin, externalPort: Number(u.port || 80) } });
        toast('已保存');
        await refresh(true);
      } catch (e) { toast('地址无效'); }
    } }),
  ]));
  card.append(el('div', { class: 'small', style: { marginTop: '10px' }, text: '本机若已运行 Antigravity Tools 的反代（默认 8045），这里会显示在线；不运行则显示未连接，属正常。' }));
  box.append(card);

  // 探测结果 / 对接契约（只读，不点亮任何能力）
  if (st && st.contract) {
    const c = st.contract;
    const cc = el('div', { class: 'card' }, [el('h4', {}, [document.createTextNode('契约探测结果'), el('span', { class: 'tag', text: '只读' })])]);
    const kv = el('div', { class: 'kv' });
    kv.append(el('span', { text: 'OpenAI 兼容' }), el('span', { text: c.openaiCompatible ? '是（GET /v1/models 返回 data[]）' : '否' }));
    kv.append(el('span', { text: '模型数' }), el('span', { text: c.modelCount !== undefined ? String(c.modelCount) : '--' }));
    kv.append(el('span', { text: 'Key 校验' }), el('span', { text: c.authAccepted === undefined ? '--' : (c.authAccepted ? '通过' : '被拒（401/403）') }));
    kv.append(el('span', { text: '模型样例' }), el('span', { text: (c.models || []).slice(0, 6).join(', ') || '无' }));
    cc.append(kv);
    box.append(cc);
  }
  if (state.gatewayContract && state.gatewayContract.fields) {
    const ct = state.gatewayContract;
    const cc = el('div', { class: 'card' }, [el('h4', {}, [document.createTextNode('对接契约'), el('span', { class: 'tag', text: '待接入' })])]);
    cc.append(el('div', { class: 'small', text: `协议 ${ct.protocol} · 当前 enabled=${ct.enabled} · ${ct.boundary}` }));
    const kv = el('div', { class: 'kv', style: { marginTop: '8px' } });
    ct.fields.forEach(f => kv.append(el('span', { text: f.key + (f.required ? ' *' : '') }), el('span', { text: f.desc })));
    cc.append(kv);
    cc.append(el('div', { style: { display: 'flex', gap: '7px', marginTop: '9px' } }, [
      el('button', { class: 'btn', text: '复制契约 JSON', onclick: async () => {
        try { await navigator.clipboard.writeText(JSON.stringify(ct, null, 2)); toast('已复制'); }
        catch (e) { toast('复制失败: ' + e.message); }
      } }),
    ]));
    cc.append(el('div', { class: 'small', style: { marginTop: '8px' }, text: '完整字段与接入步骤：' + ct.doc }));
    box.append(cc);
  }

  // 待接入项（禁用态）
  const todo = el('div', { class: 'card' }, [el('h4', {}, [document.createTextNode('待接入项'), el('span', { class: 'tag', text: '入口已就绪' })])]);
  const items = [
    ['模型映射', '把 Gemini / Claude 池映射成 OpenAI 兼容模型名'],
    ['路由策略', '按配额余量挑池，支持熔断与重试'],
    ['密钥管理', '给外部调用方分发 key，可随时吊销'],
    ['用量统计', '按账号 / 模型统计请求与 Token'],
  ];
  items.forEach(([t, d]) => {
    todo.append(el('div', { class: 'sw' }, [
      el('div', {}, [el('div', { text: t }), el('div', { class: 'hint', text: d })]),
      el('div', { class: 'tgl', style: { opacity: '.4', cursor: 'default' }, title: '待接入' }),
    ]));
  });
  todo.append(el('div', { class: 'small', style: { marginTop: '10px' }, text: '以上开关为占位，不生效、不影响其它功能。接入中转站服务后再逐个点亮。' }));
  box.append(todo);
}

function tabTheme(box) {
  box.replaceChildren();
  const u = uiCfg();
  const save = async (patch) => { await api('/api/settings', { ui: patch }); await refresh(true); };

  const card = el('div', { class: 'card' }, [el('h4', { text: '悬浮球' })]);
  card.append(el('div', { class: 'small', text: '图标形状就是按钮本身，不加圆底。光点沿 ∞ 流动 = 账号接力；跑得越慢代表周配额越少，≤30% 变琥珀。' }));
  card.append(el('div', { class: 'sw' }, [
    el('div', {}, [el('div', { text: '自动贴边' }), el('div', { class: 'hint', text: '闲置 5 秒后收起，鼠标靠近即展开' })]),
    el('div', { class: 'tgl' + (u.autoSnap !== false ? ' on' : ''), onclick: () => save({ autoSnap: !(u.autoSnap !== false) }) }),
  ]));
  card.append(el('div', { class: 'sw' }, [
    el('div', {}, [el('div', { text: '停靠边缘' })]),
    el('div', { class: 'seg', style: { width: '110px' } }, [
      el('button', { class: (u.dockSide || 'right') === 'right' ? 'on' : '', text: '右', onclick: () => save({ dockSide: 'right' }) }),
      el('button', { class: u.dockSide === 'left' ? 'on' : '', text: '左', onclick: () => save({ dockSide: 'left' }) }),
    ]),
  ]));
  box.append(card);

  box.append(el('div', { class: 'card' }, [
    el('h4', { text: '接管主题' }),
    el('div', { class: 'sw' }, [
      el('div', {}, [el('div', { text: '接管客户端外观' }), el('div', { class: 'hint', text: '只覆盖官方 CSS 变量，关闭即恢复原生' })]),
      el('div', { class: 'tgl' + (u.takeOverTheme !== false ? ' on' : ''), onclick: () => save({ takeOverTheme: !(u.takeOverTheme !== false) }) }),
    ]),
  ]));

  const app = el('div', { class: 'card' }, [el('h4', { text: '主题外观' })]);
  const seg2 = el('div', { class: 'seg', style: { flexWrap: 'wrap' } });
  [['follow', '跟随系统'], ['light', '浅色'], ['dark', '深色'], ['green', '护眼绿'], ['cyber', '赛博紫'], ['glass', '毛玻璃']].forEach(([k, l]) => {
    seg2.append(el('button', { class: (u.theme || 'follow') === k ? 'on' : '', text: l, onclick: () => save({ theme: k }) }));
  });
  app.append(seg2, el('div', { class: 'small', style: { marginTop: '8px' }, text: '即时生效；不改动任何官方文件。' }));
  box.append(app);
}

// ---------- 关于 ----------
function tabAbout(box) {
  box.replaceChildren();
  box.append(el('div', { class: 'card', style: { textAlign: 'center' } }, [
    el('div', { html: LOGO.replace('width="22" height="22"', 'width="64" height="64"'), style: { display: 'flex', justifyContent: 'center', marginBottom: '8px' } }),
    el('div', { style: { fontSize: '15px', fontWeight: 700 }, text: 'Antigravity Daddy' }),
    el('div', { class: 'small', text: 'v0.3 · 内嵌式 Antigravity 增强与多账号调度' }),
  ]));
  const c = el('div', { class: 'card' }, [el('h4', { text: '锚点命中（实测）' })]);
  const kv = el('div', { class: 'kv' });
  ['editor', 'toolbar', 'send', 'msgActions', 'permConfirm', 'automationsBtn'].forEach(g => {
    kv.append(el('span', { text: g }), el('span', { text: pick(g) ? '✓' : '✗' }));
  });
  c.append(kv); box.append(c);
  box.append(el('div', { class: 'card' }, [
    el('h4', { text: '数据与边界' }),
    el('div', { class: 'small', html: '注入方式：CDP Runtime.evaluate + Shadow DOM，<b>不改官方任何文件</b>。<br/>数据来源：本机 Language Server 的 Connect-RPC（配额/模型/会话）+ 官方 DOM 只读。<br/>凭据：Windows Credential Manager 原文 + 本机 AES-256-GCM 副本。' }),
  ]));
}

// ---------- 输入框 ----------
// 页面里可能同时存在多个 lexical 编辑器（历史输入框、隐藏实例），旧实现直接取第一个，
// 会命中一个空且不可见的实例 —— 导致「暂存」总判空、置灰失效。这里只取可见实例，
// 并优先官方标注的 Message input。
function editor() {
  const all = [...document.querySelectorAll('[data-lexical-editor="true"]')].filter((e) => {
    const r = e.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  });
  if (!all.length) return null;
  return all.find((e) => (e.getAttribute('aria-label') || '') === 'Message input') || all[all.length - 1];
}
function readEditorText() { const e = editor(); return e ? (e.innerText || '').trim() : ''; }
function insertText(text) {
  const e = editor(); if (!e) { toast('未找到输入框'); return false; }
  e.focus();
  const sel = window.getSelection(); sel.removeAllRanges();
  const r = document.createRange(); r.selectNodeContents(e); r.collapse(false); sel.addRange(r);
  document.execCommand('insertText', false, text);
  return true;
}
function clickSend() { const b = pick('send'); if (b && !b.disabled) { b.click(); return true; } return false; }
function currentConversationId() {
  const m = /[?&]conversation=([0-9a-f-]+)/i.exec(location.search);
  return m ? m[1] : 'unknown';
}
// 输入框底栏整行：官方 class `.agy-composer-footer`（稳定），兜底用模型选择器上溯两级
function composerFooter() {
  const f = document.querySelector('.agy-composer-footer');
  if (f) return f;
  const m = document.querySelector('[data-testid="model-selector-trigger"]');
  const g = m && m.parentElement && m.parentElement.parentElement;
  return g || null;
}
// 输入框容器（用于结构兜底）
function composerRoot() {
  const ed = editor();
  if (ed) {
    const box = ed.closest('[data-testid="agent-input-box"]') || ed.closest('.surface-composer');
    if (box) return box;
  }
  return pick('inputBox') || null;
}
// 发送按钮：官方没有稳定的 testid，按「已知选择器 → aria-label → 容器内最右下按钮」三级兜底。
function sendButton() {
  for (const s of A.send) { const b = document.querySelector(s); if (b) return b; }
  const byLabel = [...document.querySelectorAll('button[aria-label]')]
    .find((b) => /send|发送|submit/i.test(b.getAttribute('aria-label') || ''));
  if (byLabel) return byLabel;
  const root = composerRoot();
  if (!root) return null;
  const btns = [...root.querySelectorAll('button')].filter((b) => {
    const r = b.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  });
  if (!btns.length) return null;
  // 最靠右、其次最靠下 —— 发送键始终在输入区的右下角
  btns.sort((a, b) => {
    const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
    return (rb.right - ra.right) || (rb.bottom - ra.bottom);
  });
  return btns[0];
}
function composerHost() {
  // 官方当前没有 input-box-bottom-toolbar；真实底栏是含 model-selector 的那一行
  const m = document.querySelector('[data-testid="model-selector-trigger"]');
  if (m && m.parentElement) return m.parentElement;
  return pick('toolbar') || pick('inputBox');
}
// 图标（Material 风格实心路径，随按钮前景色渲染，不引入任何外部资源）
const ICONS = {
  stash: '<path d="M17 3H7a2 2 0 0 0-2 2v16l7-3 7 3V5a2 2 0 0 0-2-2z"/>',
  bolt: '<path d="M11 21h-1l1-7H7.5c-.58 0-.57-.32-.38-.66.19-.34.05-.08.07-.12C8.48 10.94 10.42 7.54 13 3h1l-1 7h3.5c.49 0 .56.33.47.51l-.07.15C12.96 17.55 11 21 11 21z"/>',
  inbox: '<path d="M19 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2zm0 12h-4a3 3 0 0 1-6 0H5V5h14v10z"/>',
  arrow: '<path d="M12 4l-1.41 1.41L16.17 11H4v2h12.17l-5.58 5.59L12 20l8-8z"/>',
  trash: '<path d="M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>',
  plus: '<path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>',
};
const svgIcon = (name, size) => '<svg viewBox="0 0 24 24" width="' + (size || 16) + '" height="' + (size || 16) +
  '" fill="currentColor" aria-hidden="true">' + (ICONS[name] || '') + '</svg>';

// 胶囊按钮：默认只露图标，hover 向右展开成胶囊并淡入文字（对齐 WorkDaddy 的圆钮手感）
function pill(key, icon, label, width, onClick) {
  const b = el('button', { class: 'agyd-pill', title: label, 'data-agyd': key, 'aria-label': label, type: 'button' });
  b.style.setProperty('--agyd-w', width + 'px');
  b.append(el('span', { class: 'agyd-pill-ico', html: svgIcon(icon) }), el('span', { class: 'agyd-pill-txt', text: label }));
  b.addEventListener('mousedown', (e) => e.preventDefault()); // 不把焦点从输入框抢走
  if (onClick) b.addEventListener('click', onClick);
  return b;
}

async function doStash() {
  const text = readEditorText();
  if (!text) return toast('输入框是空的，先写点内容');
  try {
    await api('/api/drafts/add', { conversationId: currentConversationId(), text });
    await api('/api/clear-composer', {});
    toast('已暂存');
    await refresh(true);
    refreshPop('stash');
  } catch (e) { toast('暂存失败: ' + e.message); }
}

function injectComposerBar() {
  if (uiCfg().showComposerBar === false) return;
  // 位置：底栏整行里、官方右侧按钮组（Turbo / 麦克风 / 发送）之前。
  // 独立成一格，不参与官方按钮组，避免挤进麦克风的语音胶囊里。
  const footer = composerFooter();
  if (!footer) return;
  const rightGroup = (() => {
    const last = footer.lastElementChild;
    return last && !last.classList.contains('agyd-slot') ? last : null;
  })();
  const place = (node) => {
    if (rightGroup) footer.insertBefore(node, rightGroup);
    else footer.append(node);
  };
  const exist = document.querySelector('.agyd-slot');
  if (exist) {
    // 位置纠偏：必须直接挂在 footer 上、且紧贴右组之前
    if (exist.parentElement !== footer) { place(exist); return; }
    if (rightGroup && exist.nextElementSibling !== rightGroup) place(exist);
    return;
  }
  const slot = el('div', { class: 'agyd-slot' });
  const stash = pill('stash', 'stash', '暂存提示词', 104, doStash);
  const phrases = pill('phrases', 'bolt', '快捷短语', 92);
  // 暂存按钮：点击=暂存当前输入；悬停=已暂存列表（可回填/删除）。
  mountPop(stash, 'stash', buildStash, { clickToggle: false });
  mountPop(phrases, 'phrases', buildPhrases);
  slot.append(stash, phrases);
  place(slot);
  syncComposerState();
}

// 暂存按钮跟随输入状态：空输入时置灰（与官方发送按钮禁用态一致的手感）
function syncComposerState() {
  const b = document.querySelector('.agyd-pill[data-agyd="stash"]');
  if (!b) return;
  b.setAttribute('data-empty', readEditorText() ? '0' : '1');
}

// ---------- 输入区浮层 ----------
function closeAllPops() {
  document.querySelectorAll('.agyd-pop.open').forEach((p) => p.classList.remove('open'));
}
function refreshPop(key) {
  const p = document.getElementById('agyd-pop-' + key);
  if (p && p.classList.contains('open') && p.__agydBuild) p.replaceChildren(p.__agydBuild());
}
function positionPop(pop, anchor) {
  const r = anchor.getBoundingClientRect();
  const w = pop.offsetWidth || 296;
  pop.style.left = Math.round(Math.max(8, Math.min(r.left, window.innerWidth - w - 8))) + 'px';
  pop.style.bottom = Math.round(Math.max(8, window.innerHeight - r.top + 10)) + 'px';
}
// 悬停即开、点击可切换、移出延迟收起（同 WorkDaddy 的 explore 弹层）
function mountPop(anchor, key, builder, opts) {
  const clickToggle = !opts || opts.clickToggle !== false;
  let timer = null;
  const popEl = () => document.getElementById('agyd-pop-' + key);
  const close = () => { if (timer) { clearTimeout(timer); timer = null; } const p = popEl(); if (p) p.classList.remove('open'); };
  const open = () => {
    if (timer) { clearTimeout(timer); timer = null; }
    let p = popEl();
    if (!p) {
      p = el('div', { class: 'agyd-pop', id: 'agyd-pop-' + key });
      p.__agydBuild = builder;
      p.append(builder());
      p.addEventListener('mouseenter', () => { if (timer) { clearTimeout(timer); timer = null; } });
      p.addEventListener('mouseleave', () => { if (timer) clearTimeout(timer); timer = setTimeout(() => p.classList.remove('open'), 150); });
      p.addEventListener('mousedown', (e) => e.stopPropagation());
      document.body.append(p);
    } else {
      p.replaceChildren(builder());
    }
    positionPop(p, anchor);
    p.classList.add('open');
  };
  const later = () => { if (timer) clearTimeout(timer); timer = setTimeout(() => { const p = popEl(); if (p) p.classList.remove('open'); }, 170); };
  anchor.addEventListener('mouseenter', open);
  anchor.addEventListener('mouseleave', later);
  if (clickToggle) {
    anchor.addEventListener('click', (e) => { e.preventDefault(); const p = popEl(); (p && p.classList.contains('open')) ? close() : open(); });
  }
  document.addEventListener('pointerdown', (ev) => {
    const p = popEl();
    if (!anchor.contains(ev.target) && !(p && p.contains(ev.target))) close();
  }, true);
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') close(); });
  window.addEventListener('resize', close);
  document.addEventListener('scroll', close, true);
  return { open, close };
}

function getPhrases() {
  const c = state.config && Array.isArray(state.config.phrases) ? state.config.phrases : null;
  return (c && c.length) ? c : [
    { title: '继续', text: '继续' },
    { title: '总结进展', text: '请总结当前进展、已完成与待办，并给出下一步建议。' },
    { title: '只给结论', text: '只给结论和关键依据，不要过程性描述。' },
  ];
}
async function savePhrases(list) {
  try { await api('/api/settings', { phrases: list }); if (state.config) state.config.phrases = list; }
  catch (e) { toast('保存短语失败: ' + e.message); }
}

function buildPhrases() {
  const card = el('div', { class: 'agyd-pop-card' });
  const list = getPhrases();
  card.append(el('div', { class: 'agyd-pop-title', text: '快捷短语 · 点击填入输入框' }));
  const box = el('div', { class: 'agyd-pop-list' });
  if (!list.length) box.append(el('div', { class: 'agyd-pop-empty', text: '暂无短语。先在输入框写点内容，再点下方「存当前输入」。' }));
  list.forEach((p, idx) => {
    const row = el('div', { class: 'agyd-pop-row', role: 'button', tabindex: '0', title: p.text || p.title || '' });
    row.append(el('span', { class: 'agyd-pop-txt', text: p.title || p.text || '' }));
    const acts = el('div', { class: 'agyd-pop-act' });
    const ins = el('button', { class: 'agyd-act-btn', title: '填入输入框', html: svgIcon('arrow', 15) });
    ins.onclick = (e) => { e.stopPropagation(); if (insertText(p.text || p.title || '')) { closeAllPops(); toast('已填入'); } };
    const del = el('button', { class: 'agyd-act-btn danger', title: '删除该短语', html: svgIcon('trash', 15) });
    del.onclick = async (e) => { e.stopPropagation(); await savePhrases(getPhrases().filter((_, i) => i !== idx)); refreshPop('phrases'); toast('已删除短语'); };
    acts.append(ins, del);
    row.append(acts);
    row.onclick = () => { if (insertText(p.text || p.title || '')) { closeAllPops(); toast('已填入'); } };
    box.append(row);
  });
  card.append(box);
  const foot = el('div', { class: 'agyd-pop-foot' });
  const add = el('span', { class: 'agyd-pop-link', html: svgIcon('plus', 14) + '<span>存当前输入</span>' });
  add.onclick = async (e) => {
    e.stopPropagation();
    const text = readEditorText();
    if (!text) return toast('输入框是空的，先写点内容');
    await savePhrases(getPhrases().concat([{ title: text.slice(0, 20), text }]));
    refreshPop('phrases');
    toast('已保存短语');
  };
  foot.append(add, el('span', { class: 'agyd-pop-count', text: '共 ' + list.length + ' 条' }));
  card.append(foot);
  return card;
}

function buildStash() {
  const card = el('div', { class: 'agyd-pop-card' });
  const items = (state.drafts || []).filter((x) => x.kind !== 'fork');
  card.append(el('div', { class: 'agyd-pop-title', text: '暂存提示词 · 点击回填输入框' }));
  const box = el('div', { class: 'agyd-pop-list' });
  if (!items.length) box.append(el('div', { class: 'agyd-pop-empty', text: '还没有暂存。写好一段话后点左侧按钮即可存进来。' }));
  items.forEach((x) => {
    const row = el('div', { class: 'agyd-pop-row', role: 'button', tabindex: '0', title: x.text });
    row.append(el('span', { class: 'agyd-pop-txt', text: x.text }));
    const acts = el('div', { class: 'agyd-pop-act' });
    const fill = el('button', { class: 'agyd-act-btn', title: '填入输入框', html: svgIcon('arrow', 15) });
    fill.onclick = (e) => { e.stopPropagation(); if (insertText(x.text)) { closeAllPops(); toast('已填入'); } };
    const del = el('button', { class: 'agyd-act-btn danger', title: '删除该暂存', html: svgIcon('trash', 15) });
    del.onclick = async (e) => { e.stopPropagation(); try { await api('/api/drafts/delete', { id: x.id }); await refresh(true); refreshPop('stash'); toast('已删除'); } catch (err) { toast('删除失败: ' + err.message); } };
    acts.append(fill, del);
    row.append(acts);
    row.onclick = () => { if (insertText(x.text)) { closeAllPops(); toast('已填入'); } };
    box.append(row);
  });
  card.append(box);
  const foot = el('div', { class: 'agyd-pop-foot' });
  const add = el('span', { class: 'agyd-pop-link', html: svgIcon('plus', 14) + '<span>暂存当前输入</span>' });
  add.onclick = async (e) => { e.stopPropagation(); await doStash(); refreshPop('stash'); };
  foot.append(add, el('span', { class: 'agyd-pop-count', text: '共 ' + items.length + ' 条' }));
  card.append(foot);
  return card;
}

// 兼容旧调用（面板内若有入口）
function showPhrases() {
  const a = document.querySelector('.agyd-pill[data-agyd="phrases"]');
  if (a) a.dispatchEvent(new MouseEvent('mouseenter'));
}
function showDrafts() {
  const a = document.querySelector('.agyd-pill[data-agyd="stash"]');
  if (a) a.dispatchEvent(new MouseEvent('mouseenter'));
}

// ---------- 分支 ----------
function markForkButtons() {
  if (uiCfg().showFork === false) return;
  pickAll('msgActions').forEach((bar) => {
    const host = bar.parentElement || bar;
    if (!host || host.querySelector(':scope > .fork-btn')) return;
    host.classList.add('turn');
    host.append(el('button', {
      class: 'fork-btn', text: '分支',
      onclick: async (ev) => {
        ev.stopPropagation();
        await api('/api/fork', { conversationId: currentConversationId(), text: (host.innerText || '').trim().slice(0, 20000), at: Date.now() });
        toast('已写入草稿（会话页可填入）', 3600);
      },
    }));
  });
}

// ---------- 无人值守 ----------
const INTERRUPT_RE = /(interrupted|connection lost|please continue|retry|中断|连接中断|请继续|重试|429|quota exceeded)/i;
function autoContinueTick() {
  const u = (state.config && state.config.unattended) || {};
  if (!u.autoContinue) return;
  if (Date.now() - state.lastContinueAt < (u.cooldownMs || 4000)) return;
  if ((state.continueCount || 0) >= (u.maxContinues || 8)) return;
  const bars = pickAll('msgActions');
  const last = bars[bars.length - 1];
  if (!last) return;
  const host = last.parentElement || last;
  if (!INTERRUPT_RE.test((host.innerText || '').slice(-400))) return;
  state.lastContinueAt = Date.now(); state.continueCount++;
  insertText('继续');
  setTimeout(() => { if (clickSend()) toast('检测到中断，已发「继续」'); }, 150);
}
function autoConfirmTick() {
  const u = (state.config && state.config.unattended) || {};
  if (!u.autoConfirm) return;
  const t = pickAll('permConfirm').find(b => !b.disabled);
  if (t) { t.click(); toast('已自动确认权限弹窗'); }
}

// ---------- 挂载 ----------
function mount() {
  // 升级/重复注入：先清掉旧版注入节点，避免同页出现两套 UI
  try { document.querySelectorAll('#' + TAG + '-host, #agyd-light-css, .agyd-slot, .agyd-pop').forEach(e => e.remove()); } catch (_) { }
  const host = document.createElement('div');
  host.id = TAG + '-host';
  host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647;';
  const sr = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style'); style.textContent = CSS;

  const dock = el('div', { class: 'dock' });
  const panel = el('div', { class: 'panel' });
  const ball = el('div', { class: 'ball', html: buildBallIcon() });
  const hot = el('div', { class: 'hot' });
  dock.append(panel, ball, hot);
  sr.append(style, dock);
  // 工具条/浮层在官方 light DOM，必须用页面级样式
  try {
    const light = document.createElement('style');
    light.id = 'agyd-light-css';
    light.textContent = LIGHT_CSS;
    (document.head || document.documentElement).append(light);
  } catch (_) { }
  document.documentElement.append(host);

  ball.onclick = () => togglePanel();
  dock.addEventListener('pointerenter', unsnap);
  dock.addEventListener('pointerleave', scheduleSnap);

  let drag = null;
  ball.addEventListener('pointerdown', (e) => {
    state._dragging = true;
    drag = { y: e.clientY, bottom: parseInt(dock.style.bottom || '96', 10) };
    try { ball.setPointerCapture(e.pointerId); } catch (_) { }
  });
  ball.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const next = Math.min(Math.max(8, drag.bottom - (e.clientY - drag.y)), window.innerHeight - 80);
    dock.style.bottom = next + 'px';
  });
  ball.addEventListener('pointerup', async () => {
    if (!drag) return;
    const bottom = parseInt(dock.style.bottom || '96', 10);
    drag = null; state._dragging = false;
    await api('/api/settings', { ui: { ballBottom: bottom } }).catch(() => { });
  });

  state.ui = { host, dock, panel, ball };
  renderPanel();
  refresh(true);
  // 实例令牌 + 版本守卫：同版本重复注入时，旧闭包的定时器也必须退场，
  // 否则会和新实例抢着建 DOM/写 state（曾出现旧文字按钮反复顶掉新 UI）。
  const MY_TOKEN = Math.random().toString(36).slice(2) + Date.now().toString(36);
  const alive = () => !!(window.__AGYD__ && window.__AGYD__.token === MY_TOKEN);
  const guard = (fn, ms) => {
    const t = setInterval(() => {
      if (!alive()) { clearInterval(t); return; }
      try { fn(); } catch (e) { window.__AGYD_ERR__ = 'timer: ' + (e && e.message); }
    }, ms);
    return t;
  };
  guard(() => refresh(false), 60000);
  guard(() => { injectComposerBar(); syncComposerState(); markForkButtons(); }, 1500);
  guard(() => { autoContinueTick(); autoConfirmTick(); }, 3000);
  // host 存活看护：SPA 整段重建 DOM（登录页 ↔ 主界面）会把 host 摘掉。
  // 定时器还在、Shadow DOM 内容也还在，直接挂回去即可，不必重新 mount。
  guard(() => {
    if (!host.isConnected) {
      (document.body || document.documentElement).append(host);
      if (!document.getElementById('agyd-light-css')) {
        const light = document.createElement('style');
        light.id = 'agyd-light-css';
        light.textContent = LIGHT_CSS;
        (document.head || document.documentElement).append(light);
      }
    }
  }, 2000);
  scheduleSnap();

  window.__AGYD__ = {
    version: MY_VER, token: MY_TOKEN, mounted: true, ping: () => 'pong',
    refresh, insertText, togglePanel, state, pick,
    applyTheme: () => applyTheme(uiCfg()),
    // 诊断：定位「工具条为何没出现」时用
    _diag: () => ({
      host: !!composerHost(),
      slot: document.querySelectorAll('.agyd-slot').length,
      showBar: uiCfg().showComposerBar,
      editorText: (() => { const e = editor(); return e ? (e.innerText || '').trim().slice(0, 40) : null; })(),
      err: window.__AGYD_ERR__ || null,
    }),
  };
  toast('Antigravity Daddy 已挂载', 1600);
}

// ---------- 同步 ----------
async function refresh(force) {
  try {
    const s = await api('/api/state');
    state.accounts = s.accounts || [];
    state.ls = s.ls || null;
    state.quota = s.quota || null;
    state.quotaMeta = s.quotaMeta || null;
    state.auto = s.auto || null;
    state.config = s.config || null;
    state.drafts = s.drafts || [];
    // 切号会重启客户端 → 页面重载，结果只能通过这里取回；同一事件只提示一次
    if (s.switchNotice && s.switchNotice.at !== state._lastSwitchNoticeAt) {
      state._lastSwitchNoticeAt = s.switchNotice.at;
      toast(s.switchNotice.note, 6000);
    }
    if (!state.accounts.length && !state._autoAdoptTried) {
      state._autoAdoptTried = true;
      await api('/api/account/adopt', {}).catch(() => { });
      const s2 = await api('/api/state').catch(() => null);
      if (s2) state.accounts = s2.accounts || [];
    }
    if (force) {
      state.models = (await api('/api/models').catch(() => ({ models: [] }))).models || [];
      state.sysinfo = await api('/api/sysinfo').catch(() => null);
    }
    const ui = state.ui;
    if (ui) {
      const c = uiCfg();
      if (!ui.ball.querySelector('svg')) ui.ball.innerHTML = buildBallIcon();
      ui.ball.className = 'ball' + (ui.ball.classList.contains('flash') ? ' flash' : '');
      ui.dock.classList.toggle('left', c.dockSide === 'left');
      if (!state._dragging) ui.dock.style.bottom = (c.ballBottom || 96) + 'px';

      // 光点速度 = 周配额健康度；≤30% 变琥珀
      const wk = (quotaGroups().map(g => bucket(g, 'weekly')).filter(Boolean))[0];
      const rem = wk ? Math.max(0, Math.min(1, wk.remaining || 0)) : 0;
      const low = !!wk && rem <= 0.3;
      const speed = low ? 24 : rem <= 0.6 ? 12 : 6;
      const svgEl = ui.ball.querySelector('svg');
      if (svgEl) svgEl.style.setProperty('--spd', speed + 's');
      ui.ball.style.setProperty('--hue', low ? '#f0a13c' : '#22d3ee');
      ui.ball.classList.toggle('low', low);
      ui.ball.classList.toggle('alert', low);

      // 切号 → 光点闪一下（交接确认）
      const curEmail = (state.accounts.find(a => a.isCurrent) || {}).email || '';
      if (state._lastEmail && curEmail && state._lastEmail !== curEmail) {
        ui.ball.classList.add('flash');
        setTimeout(() => { if (state.ui) state.ui.ball.classList.remove('flash'); }, 700);
      }
      if (curEmail) state._lastEmail = curEmail;
      applyTheme(c);
      if (ui.panel.classList.contains('open')) drawBody();
    }
  } catch (e) {
    if (state.ui) state.ui.ball.classList.add('alert');
  }
}

mount();
