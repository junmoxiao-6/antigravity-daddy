'use strict';
// 配额引擎：直接复用 LS 的官方 RPC，不猜云接口
// 实测可用：
//   RetrieveUserQuotaSummary -> groups[].buckets[] {bucketId, displayName, window: 'weekly'|'5h', remainingFraction, resetTime}
//   GetUserStatus            -> planStatus.planInfo（套餐额度）+ clientModelConfigs[].quotaInfo（每模型周配额）
const rpc = require('./rpc');

const GROUP_LABEL = {
  'Gemini Models': 'Gemini 模型',
  'Claude and GPT models': 'Claude 与 GPT 模型',
  'Gemini 4 Argon': 'Gemini 4 Argon',
};
const WINDOW_LABEL = { weekly: '周额度', '5h': '5 小时窗口', '1h': '1 小时窗口', daily: '日额度' };

function normalizeSummary(res) {
  const groups = (res && res.response && res.response.groups) || (res && res.groups) || [];
  return groups.map(g => ({
    name: g.displayName,
    nameZh: GROUP_LABEL[g.displayName] || g.displayName,
    description: g.description || '',
    buckets: (g.buckets || []).map(b => ({
      id: b.bucketId,
      window: b.window,
      windowZh: WINDOW_LABEL[b.window] || b.window,
      remaining: typeof b.remainingFraction === 'number' ? b.remainingFraction : null,
      resetAt: b.resetTime || null,
      resetInSec: b.resetTime ? Math.max(0, Math.round((Date.parse(b.resetTime) - Date.now()) / 1000)) : null,
    })),
  }));
}

function normalizeModels(statusRes) {
  const us = (statusRes && statusRes.userStatus) || {};
  const cfgs = (us.cascadeModelConfigData && us.cascadeModelConfigData.clientModelConfigs) || [];
  return cfgs.map(c => ({
    label: c.label,
    modelId: c.modelId,
    provider: /claude/i.test(c.label) ? 'claude' : /gpt/i.test(c.label) ? 'gpt' : 'gemini',
    family: /claude/i.test(c.label) ? 'claude' : /gpt/i.test(c.label) ? 'gpt' : 'gemini',
    remaining: c.quotaInfo ? c.quotaInfo.remainingFraction : null,
    resetAt: c.quotaInfo ? c.quotaInfo.resetTime : null,
    supportsImages: !!c.supportsImages,
  }));
}

function planInfo(statusRes) {
  const us = (statusRes && statusRes.userStatus) || {};
  const pi = (us.planStatus && us.planStatus.planInfo) || {};
  const ps = us.planStatus || {};
  return {
    name: us.name || null, email: us.email || null,
    tier: pi.teamsTier || null, planName: pi.planName || null,
    promptCredits: { available: ps.availablePromptCredits ?? null, monthly: pi.monthlyPromptCredits ?? null },
    flowCredits: { available: ps.availableFlowCredits ?? null, monthly: pi.monthlyFlowCredits ?? null },
    canBuyCredits: !!pi.canBuyMoreCredits,
  };
}

/**
 * 最佳账号评分：
 *  - 周窗口权重更高（周硬配额耗尽会锁号）
 *  - 蹬额度模式：把临期且高余额的账号优先级抬到最高
 */
function scoreAccount(acc, snapshot, weights = { weekly: 0.6, fiveHour: 0.4 }) {
  if (!snapshot) return { score: -1, reason: '无配额数据' };
  if (acc.disabled) return { score: -1, reason: '手动禁用' };
  const buckets = [];
  for (const g of snapshot.groups) for (const b of g.buckets) buckets.push(b);
  const weekly = buckets.filter(b => b.window === 'weekly');
  const five = buckets.filter(b => b.window === '5h');
  const avg = (arr) => arr.length ? arr.reduce((s, b) => s + (b.remaining ?? 0), 0) / arr.length : 1;
  const w = avg(weekly), f = avg(five);
  let score = (w * weights.weekly + f * weights.fiveHour) * 100;
  const pedal = (acc.pedalModels || []).length > 0;
  let pedalBoost = 0;
  if (pedal) {
    const soon = weekly.some(b => b.resetInSec !== null && b.resetInSec < 48 * 3600);
    if (soon && w > 0.7) pedalBoost = 50;
  }
  score += pedalBoost;
  if (w <= 0) return { score: -100, reason: '周配额已耗尽（锁定）' };
  return { score: Math.round(score), weekly: w, fiveHour: f, pedalBoost, reason: pedalBoost ? '蹬额度模式加成' : '' };
}

async function snapshot() {
  const [summary, status] = await Promise.all([
    rpc.quotaSummary().catch(e => ({ __error: e.message })),
    rpc.getUserStatus().catch(e => ({ __error: e.message })),
  ]);
  const errs = [];
  if (summary.__error) errs.push('配额摘要: ' + summary.__error);
  if (status.__error) errs.push('用户状态: ' + status.__error);
  // LS 有时 HTTP 200 但内部报错：{"userStatus":{"cascadeModelConfigData":{"errorMessage":"..."}}}
  const cfgErr = status && status.userStatus && status.userStatus.cascadeModelConfigData
    && status.userStatus.cascadeModelConfigData.errorMessage;
  if (cfgErr) errs.push('上游模型配置: ' + cfgErr);
  return {
    fetchedAt: Date.now(),
    plan: (status.__error || cfgErr) ? null : planInfo(status),
    groups: summary.__error ? [] : normalizeSummary(summary),
    models: (status.__error || cfgErr) ? [] : normalizeModels(status),
    errors: errs,
  };
}

module.exports = { snapshot, scoreAccount, normalizeSummary, normalizeModels, planInfo, GROUP_LABEL, WINDOW_LABEL };
