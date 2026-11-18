'use strict';
// 本地存储：配置、账号保险箱（AES-256-GCM）、草稿队列
const fs = require('fs');
const crypto = require('crypto');
const P = require('./paths');

const DEFAULT_CONFIG = {
  version: 2,
  ui: {
    theme: 'follow', takeOverTheme: true,
    ballStyle: 'none', ballIcon: 'head', autoSnap: true, snapDelayMs: 5000, dockSide: 'right', ballBottom: 96,
    showComposerBar: true, showFork: true, panelTab: 'accounts', hiddenTabs: [],
  },
  switch: { syncWorkspace: true, verifyEmail: true, timeoutMs: 8000 },
  // 自动切换：默认关闭；阈值按"最紧张一池的周配额"判定
  autoSwitch: { enabled: false, threshold: 0.3, intervalSec: 120, cooldownSec: 300 },
  unattended: { autoContinue: false, autoConfirm: false, maxContinues: 8, cooldownMs: 4000 },
  quota: { refreshSec: 120, warnBelow: 15, autoRefresh: true },
  upstream: { enabled: true, proxy: 'http://127.0.0.1:7897', noProxy: '127.0.0.1,localhost,::1',
    note: 'LS 是 Go 进程，只认 HTTP(S)_PROXY；强制走代理可绕开系统代理模式差异' },
  // 中转站：只保留「接入契约」字段，enabled=false 时全部不生效，不代发请求、不代理流量。
  // 等选定上游网站后，填 url + apiKey + protocol 即可按 docs/中转站对接契约.md 逐步点亮。
  gateway: {
    enabled: false,
    url: '',                 // 形如 https://api.example.com，不带 /v1，不带尾斜杠
    externalPort: 8045,      // 本机已有反代（Antigravity Tools）时可留作探测目标
    apiKey: '',              // 仅存本机 config.json，不写日志、不回传
    protocol: 'openai',      // openai | anthropic | custom，接入时确认
    modelMap: {},            // 官方模型 ID → 上游模型名
    routing: 'quota',        // quota（按余量挑池）| round-robin | fixed
    stats: false,            // 用量统计开关，未接入时恒 false
    note: '占位：8045 由 Antigravity Tools 提供，默认复用不复刻；接入契约见 docs/中转站对接契约.md',
  },
};

P.ensureDir(P.DATA_DIR);

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return fallback; }
}
function writeJsonAtomic(file, obj) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, file);
}

// ---------- 配置 ----------
let config = null;
function getConfig() {
  if (!config) {
    const loaded = readJson(P.CONFIG_FILE, null) || {};
    config = { ...DEFAULT_CONFIG, ...loaded,
      ui: { ...DEFAULT_CONFIG.ui, ...(loaded.ui || {}) },
      switch: { ...DEFAULT_CONFIG.switch, ...(loaded.switch || {}) },
      unattended: { ...DEFAULT_CONFIG.unattended, ...(loaded.unattended || {}) },
      quota: { ...DEFAULT_CONFIG.quota, ...(loaded.quota || {}) },
      autoSwitch: { ...DEFAULT_CONFIG.autoSwitch, ...(loaded.autoSwitch || {}) },
      upstream: { ...DEFAULT_CONFIG.upstream, ...(loaded.upstream || {}) },
      gateway: { ...DEFAULT_CONFIG.gateway, ...(loaded.gateway || {}) },
    };
  }
  return config;
}
function patchConfig(patch) {
  const c = getConfig();
  const next = { ...c, ...patch };
  for (const k of ['ui', 'switch', 'unattended', 'quota', 'gateway', 'upstream', 'autoSwitch']) {
    if (patch[k]) next[k] = { ...c[k], ...patch[k] };
  }
  writeJsonAtomic(P.CONFIG_FILE, next);
  config = next;
  return next;
}

// ---------- 保险箱 ----------
function keyMaterial() {
  if (fs.existsSync(P.VAULT_KEY)) return fs.readFileSync(P.VAULT_KEY);
  const k = crypto.randomBytes(32);
  fs.writeFileSync(P.VAULT_KEY, k, { mode: 0o600 });
  return k;
}

function deriveKey(password) {
  if (!password) return keyMaterial();
  return crypto.scryptSync(password, 'agy-daddy-vault-v1', 32);
}

function encryptVault(accounts, password) {
  const key = deriveKey(password);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(JSON.stringify({ accounts }, null, 1), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([Buffer.from('AGYD1'), iv, tag, data]);
}

function decryptVault(buf, password) {
  if (!buf || buf.length < 32 || buf.slice(0, 5).toString() !== 'AGYD1') throw new Error('保险箱格式不正确');
  const key = deriveKey(password);
  const iv = buf.slice(5, 17);
  const tag = buf.slice(17, 33);
  const data = buf.slice(33);
  const d = crypto.createDecipheriv('aes-256-gcm', key, iv);
  d.setAuthTag(tag);
  return JSON.parse(Buffer.concat([d.update(data), d.final()]).toString('utf8'));
}

function loadAccounts(password) {
  if (!fs.existsSync(P.VAULT_FILE)) return [];
  try {
    const v = decryptVault(fs.readFileSync(P.VAULT_FILE), password);
    return v.accounts || [];
  } catch (e) {
    throw new Error('读取账号保险箱失败（口令错误或文件损坏）: ' + e.message);
  }
}

function saveAccounts(accounts, password) {
  const buf = encryptVault(accounts, password);
  const tmp = P.VAULT_FILE + '.tmp';
  fs.writeFileSync(tmp, buf);
  fs.renameSync(tmp, P.VAULT_FILE);
  return true;
}

// ---------- 草稿队列 ----------
function loadDrafts() { return readJson(P.DRAFT_FILE, { byConversation: {} }); }
function saveDrafts(d) { writeJsonAtomic(P.DRAFT_FILE, d); }

module.exports = {
  DEFAULT_CONFIG, getConfig, patchConfig,
  loadAccounts, saveAccounts, encryptVault, decryptVault,
  loadDrafts, saveDrafts, readJson, writeJsonAtomic,
};
