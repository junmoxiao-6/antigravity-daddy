'use strict';
// 多账号：凭据读写（Windows Credential Manager）+ 原子切号 + 校验
// 关键事实：Antigravity 2.x 把 OAuth 凭据放在 Generic 凭据 gemini:antigravity，
// 内容是明文 UTF-8 JSON：{token:{access_token,refresh_token,expiry,...},auth_method,id_token_email,writer_id}
// App / CLI(agy) / IDE 共用这一条凭据 —— 切一次即多端同步，不需要"三级双写"。
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const P = require('./paths');
const store = require('./store');
const rpc = require('./rpc');

// Python 只用于「读写 Windows 凭据」，其余功能不依赖它。
// 找不到时账号页会显式提示，可用 AGYD_PYTHON 指定解释器。
const PY_CANDIDATES = [
  process.env.AGYD_PYTHON,
  'python',
  'python3',
  'py',
].filter(Boolean);

let pyCmd = null;

function runPy(args, { timeout = 20000, binary = false } = {}) {
  const candidates = pyCmd ? [pyCmd] : PY_CANDIDATES;
  const script = path.join(__dirname, 'cred.py');
  return new Promise((resolve, reject) => {
    let idx = 0;
    const tryNext = (lastErr) => {
      if (idx >= candidates.length) return reject(lastErr || new Error('未找到可用的 Python 解释器（可设 AGYD_PYTHON 指定）'));
      const exe = candidates[idx++];
      execFile(exe, [script, ...args], { timeout, windowsHide: true, encoding: binary ? 'buffer' : 'utf8', maxBuffer: 8 << 20 },
        (err, stdout, stderr) => {
          if (err) {
            const code = err.code;
            if (code === 'ENOENT' || code === 9009) return tryNext(err);
            if (code === 2) return reject(new Error('凭据不存在: ' + String(stderr || '').trim()));
            return reject(new Error((err.message || 'python 执行失败') + ' ' + String(stderr || '').trim()));
          }
          pyCmd = exe;
          resolve(binary ? stdout : stdout);
        });
    };
    tryNext(null);
  });
}

function safeEmail(j) { return (j && (j.id_token_email || (j.token && j.token.email))) || null; }
function refreshFingerprint(j) {
  const rt = j && j.token && j.token.refresh_token || '';
  return rt ? crypto.createHash('sha256').update(rt).digest('hex').slice(0, 16) : null;
}

async function readCredentialRaw() {
  const buf = await runPy(['read'], { binary: true });
  if (!buf || !buf.length) throw new Error('凭据为空');
  const text = Buffer.isBuffer(buf) ? buf.toString('utf8') : String(buf);
  return { raw: Buffer.isBuffer(buf) ? buf : Buffer.from(text, 'utf8'), json: JSON.parse(text) };
}

async function probeCredential() {
  const out = await runPy(['probe']);
  return JSON.parse(out);
}

/**
 * 写入凭据：先备份 -> cred.py write（5 次指数退避 + 回读校验 + 失败回滚）
 */
async function writeCredentialJson(json) {
  const dir = P.ensureDir(path.join(P.DATA_DIR, 'backups'));
  const tmp = path.join(dir, 'pending-cred.json');
  fs.writeFileSync(tmp, JSON.stringify(json));
  let backupPath = null;
  try { backupPath = (await runPy(['backup', dir])).trim(); } catch (_) { }
  const out = await runPy(['write', tmp]);
  try { fs.unlinkSync(tmp); } catch (_) { }
  return { ...JSON.parse(out), backupPath };
}

// ---------------- 账号库 ----------------

function normalizeAccount(json, extra = {}) {
  const email = safeEmail(json);
  const token = json.token || {};
  const expiresAt = token.expiry ? Date.parse(token.expiry) : null;
  return {
    id: extra.id || crypto.randomUUID(),
    email,
    label: extra.label || email || '未命名账号',
    fingerprint: refreshFingerprint(json),
    authMethod: json.auth_method || 'consumer',
    writerId: json.writer_id || null,
    expiresAt,
    hasRefresh: !!token.refresh_token,
    priority: { gemini: 50, claude: 50, ...(extra.priority || {}) },
    forbiddenModels: extra.forbiddenModels || [],
    pedalModels: extra.pedalModels || [],
    disabled: !!extra.disabled,
    addedAt: extra.addedAt || Date.now(),
    lastSwitchedAt: extra.lastSwitchedAt || null,
    creds: json, // 加密入保险箱
  };
}

function publicAccount(a, currentFp) {
  const { creds, ...rest } = a;
  return { ...rest, isCurrent: !!currentFp && a.fingerprint === currentFp };
}

async function listAccounts() {
  const accounts = store.loadAccounts();
  let fp = null;
  try { fp = refreshFingerprint((await readCredentialRaw()).json); } catch (_) { }
  return { accounts: accounts.map(a => publicAccount(a, fp)), currentFingerprint: fp };
}

async function addAccount(json, extra = {}) {
  const accounts = store.loadAccounts();
  const acc = normalizeAccount(json, extra);
  if (!acc.email) throw new Error('凭据里没有可识别的邮箱，拒绝入库');
  const dup = accounts.find(a => a.fingerprint && a.fingerprint === acc.fingerprint);
  if (dup) { dup.label = extra.label || dup.label; store.saveAccounts(accounts); return { account: publicAccount(dup, null), duplicate: true }; }
  accounts.push(acc);
  store.saveAccounts(accounts);
  return { account: publicAccount(acc, null), duplicate: false };
}

async function updateAccount(id, patch) {
  const accounts = store.loadAccounts();
  const a = accounts.find(x => x.id === id);
  if (!a) throw new Error('账号不存在');
  if (patch.label !== undefined) a.label = patch.label;
  if (patch.priority) a.priority = { ...a.priority, ...patch.priority };
  if (patch.forbiddenModels) a.forbiddenModels = patch.forbiddenModels;
  if (patch.pedalModels) a.pedalModels = patch.pedalModels;
  if (patch.disabled !== undefined) a.disabled = !!patch.disabled;
  store.saveAccounts(accounts);
  return publicAccount(a, null);
}

async function deleteAccount(id) {
  const accounts = store.loadAccounts();
  const i = accounts.findIndex(x => x.id === id);
  if (i < 0) throw new Error('账号不存在');
  const [removed] = accounts.splice(i, 1);
  store.saveAccounts(accounts);
  return { deleted: removed.email };
}

/**
 * 切号：写凭据 -> 轮询 GetUserStatus 校验邮箱是否已切换
 * 说明：LS 侧凭据可能缓存于内存；若 8s 内未生效，返回 needsRestart 提示（不擅自重启客户端，
 * 以免破坏当前会话，这是"100% 保留会话"承诺的边界）。
 */
async function switchAccount(id, opts = {}) {
  const accounts = store.loadAccounts();
  const target = accounts.find(x => x.id === id);
  if (!target) throw new Error('账号不存在');
  if (target.disabled) throw new Error('该账号已被手动禁用');

  const before = await rpc.getUserStatus().then(r => r.userStatus && r.userStatus.email).catch(() => null);

  // 「是否已经是这个账号」必须看本地凭据指纹，不能靠 LS 的 email 字段：
  // GetUserStatus 的返回结构会随客户端版本变化（2.34.0 上读不到 email 时，
  // 同账号也会被误判成「需要重启」，于是点一次切换就把客户端重启一遍）。
  // 指纹来自凭据管理器里的实际内容，是确定性的。
  let curFp = null;
  try { curFp = refreshFingerprint((await readCredentialRaw()).json); } catch (_) { }
  if (curFp && target.fingerprint && curFp === target.fingerprint) {
    return {
      ok: true, before, after: before, target: target.email, needsRestart: false,
      note: '当前已经是该账号', mirrorNote: 'App / CLI(agy) / IDE 共用同一条 gemini:antigravity 凭据，无需分端双写',
      backupPath: null, elapsedMs: 0,
    };
  }

  const started = Date.now();
  const writeResult = await writeCredentialJson(target.creds);
  target.lastSwitchedAt = Date.now();
  store.saveAccounts(accounts);

  // 不再轮询等 LS 换号：语言服务把 token 缓存在内存里，只改凭据管理器它不会重读
  // （实测 GetUserStatus 一直返回旧邮箱）。等下去只是让人看着转圈。
  // 直接把「需要重启」交给上层 —— 客户端重启后才会读到新凭据。
  return {
    ok: false,
    before, after: before, target: target.email,
    needsRestart: true,
    mirrorNote: 'App / CLI(agy) / IDE 共用同一条 gemini:antigravity 凭据，无需分端双写',
    backupPath: writeResult.backupPath || null,
    elapsedMs: Date.now() - started,
  };
}

/** 记录首个可用账号（首次把当前登录态纳入号池） */
async function adoptCurrent(label) {
  const { json } = await readCredentialRaw();
  return addAccount(json, { label });
}

module.exports = {
  readCredentialRaw, probeCredential, writeCredentialJson, refreshFingerprint, safeEmail,
  listAccounts, addAccount, updateAccount, deleteAccount, switchAccount, adoptCurrent, normalizeAccount,
};
