'use strict';
// Antigravity Language Server (LS) Connect-RPC 客户端
// 事实依据（实测 2.29.0）：
//   - LS 由主进程 spawn：language_server.exe --https_server_port <port> --csrf_token <uuid>
//   - 渲染页面 origin = https://127.0.0.1:<lsPort>，页面内 window.__APP_CONFIG__.csrfToken 即令牌
//   - RPC 需带 header x-codeium-csrf-token（从渲染器 bundle 中提取确认）
//   - 服务名 exa.language_server_pb.LanguageServerService
const https = require('https');
const { execFile } = require('child_process');

const SERVICE = '/exa.language_server_pb.LanguageServerService/';

let endpoint = { base: null, csrf: null, version: null };

function setEndpoint(base, csrf, version) {
  endpoint = { base: base.replace(/\/$/, ''), csrf, version: version || endpoint.version };
  return endpoint;
}
function getEndpoint() { return { ...endpoint }; }

function call(method, body = {}, timeoutMs = 15000) {
  if (!endpoint.base || !endpoint.csrf) return Promise.reject(new Error('LS endpoint not resolved'));
  const u = new URL(endpoint.base);
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: u.hostname,
      port: u.port,
      path: SERVICE + method,
      method: 'POST',
      rejectUnauthorized: false,
      timeout: timeoutMs,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        'Connect-Protocol-Version': '1',
        'x-codeium-csrf-token': endpoint.csrf,
        'User-Agent': 'AntigravityDaddy/0.3.11',
      },
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        if (!res.statusCode || res.statusCode >= 400) {
          return reject(new Error(`LS ${method} HTTP ${res.statusCode}: ${text.slice(0, 300)}`));
        }
        try { resolve(text ? JSON.parse(text) : {}); }
        catch (e) { reject(new Error(`LS ${method} bad json: ${text.slice(0, 200)}`)); }
      });
    });
    req.on('timeout', () => req.destroy(new Error(`LS ${method} timeout`)));
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// ---------- 高层封装（字段名均已用真实响应验证） ----------

/** 用户状态：邮箱 / 套餐 / 每模型剩余比例与重置时间 */
async function getUserStatus() { return call('GetUserStatus'); }

/** 配额分桶：weekly / 5h 双窗口，按 Gemini / Claude&GPT / Argon 分组 */
async function quotaSummary() { return call('RetrieveUserQuotaSummary'); }

async function authStatus() { return call('GetAuthStatus'); }

/** 模型清单（含 modelId、quotaInfo、supportsImages） */
async function modelConfig() { return call('GetCascadeModelConfigData'); }

async function userInfo() { return call('GetUserInfo').catch(() => call('FetchUserInfo').catch(() => null)); }

async function listProjects() { return call('ListProjects'); }
async function readProjects() { return call('ReadProjects'); }

// 会话/轨迹（用于会话迁移、Token 统计、Fork 上下文）
async function allTrajectories(body = {}) { return call('GetAllCascadeTrajectories', body); }
async function trajectorySteps(body) { return call('GetCascadeTrajectorySteps', body); }
async function trajectoryTurns(body) { return call('GetTrajectoryTurns', body); }
async function convertTrajectoryToMarkdown(body) { return call('ConvertTrajectoryToMarkdown', body); }
async function forkConversation(body) { return call('ForkConversation', body); }

// 无人值守相关
async function sendUserCascadeMessage(body) { return call('SendUserCascadeMessage', body, 30000); }
async function waitForIdle(body) { return call('WaitForConversationFullyIdle', body, 120000); }
async function cancelInvocation(body) { return call('CancelCascadeInvocation', body); }
async function resolveOutstanding(body) { return call('ResolveOutstandingSteps', body); }
async function handleInteraction(body) { return call('HandleCascadeUserInteraction', body); }

/**
 * 从 language_server.exe 的命令行兜底解析 --https_server_port / --csrf_token。
 * 仅当 CDP 未连接时使用（CDP 一直是首选，因为页面内 __APP_CONFIG__ 最权威）。
 */
function discoverFromProcess() {
  return new Promise((resolve) => {
    const ps = 'Get-CimInstance Win32_Process -Filter "Name=\'language_server.exe\'" | Select-Object -First 1 -ExpandProperty CommandLine';
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { windowsHide: true, timeout: 8000 },
      (err, stdout) => {
        if (err || !stdout) return resolve(null);
        const port = /--https_server_port\s+(\d+)/.exec(stdout);
        const csrf = /--csrf_token\s+([0-9a-f-]{16,})/.exec(stdout);
        if (!port || !csrf) return resolve(null);
        resolve({ base: `https://127.0.0.1:${port[1]}`, csrf: csrf[1], source: 'process' });
      });
  });
}

module.exports = {
  SERVICE, setEndpoint, getEndpoint, call,
  getUserStatus, quotaSummary, authStatus, modelConfig, userInfo,
  listProjects, readProjects, allTrajectories, trajectorySteps, trajectoryTurns,
  convertTrajectoryToMarkdown, forkConversation,
  sendUserCascadeMessage, waitForIdle, cancelInvocation, resolveOutstanding, handleInteraction,
  discoverFromProcess,
};
