'use strict';
// 路径解析：所有本地事实集中在这里，便于版本升级后单点修正
const os = require('os');
const fs = require('fs');
const path = require('path');

const HOME = os.homedir();
const LOCALAPPDATA = process.env.LOCALAPPDATA || path.join(HOME, 'AppData', 'Local');
const APPDATA = process.env.APPDATA || path.join(HOME, 'AppData', 'Roaming');

// 本项目数据目录（不动官方任何文件）
const DATA_DIR = path.join(LOCALAPPDATA, 'AGY-Daddy');
const VAULT_FILE = path.join(DATA_DIR, 'vault.enc');
const VAULT_KEY = path.join(DATA_DIR, 'vault.key');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const DRAFT_FILE = path.join(DATA_DIR, 'drafts.json');
const LOG_DIR = path.join(DATA_DIR, 'logs');

// 官方 Antigravity 2.x 落点（实测 2.29.0）
const AGY_EXE_CANDIDATES = [
  path.join(LOCALAPPDATA, 'Programs', 'antigravity', 'Antigravity.exe'),
  path.join(LOCALAPPDATA, 'Programs', 'Antigravity', 'Antigravity.exe'),
  path.join(LOCALAPPDATA, 'Antigravity', 'Antigravity.exe'),
];
// userData 可能被 junction / 重定向到其它盘，所以始终以系统已知路径为准
const AGY_USERDATA_CANDIDATES = [
  path.join(APPDATA, 'Antigravity'),
  path.join(APPDATA, 'antigravity'),
];
const GEMINI_DIR = path.join(HOME, '.gemini');

// Windows 凭据（go-keyring 写法：服务名:账户名）
const CRED_TARGET = 'gemini:antigravity';
const CRED_USER = 'antigravity';

function firstExisting(list) {
  for (const p of list) {
    try { if (fs.existsSync(p)) return p; } catch (_) { }
  }
  return null;
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
  return p;
}

let _exeCache; // undefined=未解析, null=解析失败
/**
 * 定位 Antigravity.exe。本机实测它可能不在 C:（userData 与 Programs 都可被重定向到别的盘），
 * 因此顺序为：环境变量 > 常见路径 > 注册表 InstallLocation > 各盘扫描。
 */
function agyExe() {
  if (_exeCache !== undefined) return _exeCache;
  const tryPaths = [];
  if (process.env.AGYD_AGY_EXE) tryPaths.push(process.env.AGYD_AGY_EXE);
  tryPaths.push(...AGY_EXE_CANDIDATES);

  const direct = firstExisting(tryPaths);
  if (direct) { _exeCache = direct; return direct; }

  // 注册表（HKCU/HKLM 卸载项里的 InstallLocation）
  try {
    const { execFileSync } = require('child_process');
    const ps = [
      "$p=@('HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',",
      "'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',",
      "'HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*');",
      "Get-ItemProperty $p -ErrorAction SilentlyContinue |",
      "Where-Object { $_.DisplayName -match 'Antigravity' -and $_.DisplayName -notmatch 'Tools' } |",
      "Select-Object -ExpandProperty InstallLocation -ErrorAction SilentlyContinue"
    ].join(' ');
    const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps],
      { encoding: 'utf8', timeout: 8000, windowsHide: true }).trim();
    for (const dir of out.split(/\r?\n/).map(s => s.replace(/"/g, '').trim()).filter(Boolean)) {
      const exe = path.join(dir, 'Antigravity.exe');
      if (fs.existsSync(exe)) { _exeCache = exe; return exe; }
    }
  } catch (_) { /* ignore */ }

  // 各固定盘扫描（含本机 F: 重定向的情形）
  for (const drive of ['C', 'D', 'E', 'F', 'G', 'H']) {
    const p = `${drive}:\\${path.join(process.env.USERNAME ? '' : '', '')}`;
    for (const rel of [
      'AppData\\Local\\Programs\\antigravity\\Antigravity.exe',
      'AppData\\Local\\Programs\\Antigravity\\Antigravity.exe',
      'jun\\AppData\\Local\\Programs\\antigravity\\Antigravity.exe',
    ]) {
      const exe = `${drive}:\\` + rel;
      try { if (fs.existsSync(exe)) { _exeCache = exe; return exe; } } catch (_) { }
    }
    void p;
  }
  _exeCache = null;
  return null;
}
function agyUserData() { return firstExisting(AGY_USERDATA_CANDIDATES); }

// Chromium 会把实际 CDP 端口写进 userData/DevToolsActivePort
function readDevToolsActivePort() {
  const ud = agyUserData();
  if (!ud) return null;
  const f = path.join(ud, 'DevToolsActivePort');
  try {
    const txt = fs.readFileSync(f, 'utf8').trim().split(/\r?\n/);
    const port = parseInt(txt[0], 10);
    if (!port) return null;
    return { port, wsPath: txt[1] || null, file: f, mtime: fs.statSync(f).mtimeMs };
  } catch (_) {
    return null;
  }
}

module.exports = {
  HOME, LOCALAPPDATA, APPDATA, DATA_DIR, VAULT_FILE, VAULT_KEY, CONFIG_FILE, DRAFT_FILE, LOG_DIR,
  AGY_EXE_CANDIDATES, AGY_USERDATA_CANDIDATES, GEMINI_DIR,
  CRED_TARGET, CRED_USER,
  firstExisting, ensureDir, agyExe, agyUserData, readDevToolsActivePort,
};
