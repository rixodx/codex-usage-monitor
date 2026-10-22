'use strict';
// Local token/cost adapter plus optional Codex account quota reader.
const fs = require('node:fs');
const path = require('node:path');
const { QuotaProvider } = require('./quota');
const { BackendManager } = require('./backend');
const { selectionKey, filterStatistics } = require('./directory-stats');

function number(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function bounds(period, now = new Date()) {
  const day = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
  const [year, month, date] = day.split('-').map(Number);
  const start = new Date(Date.UTC(year, month - 1, date));
  const end = new Date(start.getTime() + 86400000);
  if (period === 'week') start.setUTCDate(start.getUTCDate() - 6);
  else if (period === 'month') start.setUTCDate(1);
  else if (period === '30days') start.setUTCDate(start.getUTCDate() - 29);
  return { since: start.toISOString().slice(0, 10), until: end.toISOString().slice(0, 10) };
}

function baseUrl(raw) {
  const url = new URL(raw || 'http://127.0.0.1:43189');
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
      || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('服务地址必须是本机 HTTP 地址，例如 http://127.0.0.1:43189');
  }
  return url.origin;
}

function summarize(summary, report, status, period) {
  if (!summary?.usage || !report?.summary || !status?.status) {
    throw new Error('本地服务返回的数据格式不兼容，请更新统计工具或检查服务地址');
  }
  const u = summary.usage;
  const c = report.summary;
  const models = (report.models || []).map(m => ({
    name: m.key, tokens: number(m.usage?.total), usd: number(m.estimate?.usd),
    unpriced: number(m.estimate?.unpriced_tokens),
  })).sort((a, b) => b.tokens - a.tokens);
  const input = number(u.input);
  const cached = number(u.cached_input);
  const coverage = Number(c.coverage_ratio);
  const warnings = [];
  if (summary.coverage_incomplete) warnings.push('本地记录覆盖不完整');
  if (number(c.unpriced_tokens)) warnings.push('部分 token 未参与计价');
  if (cached > input) warnings.push('缓存分类异常，请在完整面板检查');
  if (status.scanning) warnings.push('后台正在整理记录');
  return {
    ok: true, updatedAt: new Date().toISOString(), period,
    total: number(summary.grand_total ?? u.total), input, cached,
    uncached: Math.max(0, input - cached), output: number(u.output),
    reasoning: number(u.reasoning_output), usd: number(c.usd),
    coverage: Number.isFinite(coverage) ? Math.max(0, Math.min(1, coverage)) : null,
    unpriced: number(c.unpriced_tokens), warnings, models,
    sessions: number(summary.session_count),
    lastEvent: summary.last_event || null,
    lastScan: status.status.last_scan || null,
    pricingDate: report.catalog_as_of || '',
    basis: report.basis || '',
    serviceVersion: status.version || '',
  };
}

async function readJson(base, route, request = fetch) {
  const response = await request(base + route, {
    signal: AbortSignal.timeout(6000), redirect: 'error',
    headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' },
  });
  if (!response.ok) throw new Error(`本地服务返回 HTTP ${response.status}`);
  return response.json();
}

async function collect(config, request = fetch) {
  const base = baseUrl(config.baseUrl);
  const period = ['today', 'week', 'month', '30days'].includes(config.period) ? config.period : 'today';
  const query = new URLSearchParams(bounds(period)).toString();
  if (Array.isArray(config.collectionHomes)) {
    const [events,pricing,status] = await Promise.all([
      readJson(base,'/api/v1/export?'+query+'&format=json',request),
      readJson(base,'/api/v1/pricing',request),
      readJson(base,'/api/v1/status',request),
    ]);
    const {summary,report}=filterStatistics(events,pricing,config.collectionHomes);
    const result=summarize(summary,report,status,period);
    if (status.status?.warning_count) result.warnings.push('采集服务有历史覆盖提示，详见完整面板');
    return {...result,baseUrl:base,directoryFilter:config.collectionHomes,filterKey:selectionKey(config.collectionHomes)};
  }
  // Standard API-equivalent basis, deliberately excluding subscription Fast-credit multipliers.
  const [summary, report, status] = await Promise.all([
    readJson(base, '/api/v1/summary?' + query, request),
    readJson(base, '/api/v1/cost-estimate?' + query, request),
    readJson(base, '/api/v1/status', request),
  ]);
  return { ...summarize(summary, report, status, period), baseUrl: base, filterKey:'*' };
}

let writeSequence = 0;
async function atomicWrite(file, value, io = fs, pause = ms => new Promise(resolve => setTimeout(resolve, ms))) {
  const temp = file + '.' + process.pid + '.' + (++writeSequence) + '.tmp';
  try {
    io.writeFileSync(temp, JSON.stringify(value, null, 2), 'utf8');
    for (let attempt=0; ; attempt++) {
      try { io.renameSync(temp, file); return; }
      catch (error) {
        if (!['EPERM','EACCES','EBUSY'].includes(error.code) || attempt>=11) throw error;
        await pause(Math.min(200, 25*(attempt+1)));
      }
    }
  } finally {
    try { if (io.existsSync(temp)) io.unlinkSync(temp); } catch {}
  }
}
function createStateWriter(file, onError = () => {}, write = atomicWrite) {
  let tail = Promise.resolve();
  return value => {
    tail = tail.then(() => write(file,value)).catch(error => { onError(error); });
    return tail;
  };
}

async function main() {
  if (typeof fetch !== 'function') throw new Error('需要 Node.js 18 或以上版本');
  const root = __dirname;
  const configFile = path.join(root, 'settings.json');
  const stateFile = path.join(root, 'state.json');
  const saveState = createStateWriter(stateFile, error => {
    try { fs.appendFileSync(path.join(root,'collector-error.log'),new Date().toISOString()+' State write: '+error.message+'\n'); } catch {}
  });
  let previous = null;
  let stopping = false;
  let currentConfig = {};
  let quotaSnapshot = null;
  let backendState = null;
  let bootstrapPromise = null;
  let collectionSelectionKey = null;
  const backend = new BackendManager(root, value => {
    backendState = value;
    const state = { ...(previous || { ok: false }), backend: value, quota: quotaSnapshot };
    if (previous) previous = state;
    void saveState(state);
  });
  const quota = new QuotaProvider(value => {
    quotaSnapshot = value;
    if (previous) {
      previous = { ...previous, quota: value };
      void saveState(previous);
    }
  });
  const parentIndex = process.argv.indexOf('--parent-pid');
  const parentPid = parentIndex >= 0 ? Number(process.argv[parentIndex + 1]) : null;
  function parentAlive() {
    if (!Number.isInteger(parentPid) || parentPid <= 0) return true;
    try { process.kill(parentPid, 0); return true; }
    catch (error) { return error.code !== 'ESRCH'; }
  }
  process.on('SIGTERM', () => { stopping = true; quota.close(); });
  process.on('exit', () => quota.close());
  while (!stopping && parentAlive()) {
    let config = {};
    try {
      if (fs.existsSync(configFile)) config = JSON.parse(fs.readFileSync(configFile, 'utf8').replace(/^\uFEFF/, ''));
      currentConfig = config;
      const captureKey = JSON.stringify(config.collectionDirectories ?? null);
      if (Array.isArray(config.collectionDirectories) && captureKey !== collectionSelectionKey && !backend.pending && !process.argv.includes('--no-bootstrap')) {
        collectionSelectionKey = captureKey;
        bootstrapPromise = backend.ensure(config);
      }
      if (!bootstrapPromise && !process.argv.includes('--no-bootstrap')) bootstrapPromise = backend.recover(config);
      void quota.refresh(config);
      previous = { ...await collect(config), quota: quotaSnapshot, backend: backendState };
      await saveState(previous);
    } catch (error) {
      if (!process.argv.includes('--no-bootstrap')) {
        const recovery = backend.recover(config);
        if (recovery) bootstrapPromise = recovery;
      }
      const safeMessage = error.name === 'TimeoutError' ? '本地服务响应超时' : error.message;
      const errorState = { ...(previous || {}), quota: quotaSnapshot, backend: backendState, ok: false, error: safeMessage, attemptedAt: new Date().toISOString() };
      previous = errorState;
      await saveState(errorState);
      if (process.argv.includes('--once')) { console.error(safeMessage); process.exitCode = 1; }
    }
    if (process.argv.includes('--once')) {
      await quota.refresh(currentConfig);
      if (bootstrapPromise) await bootstrapPromise;
      quota.close();
      break;
    }
    // Short waits let menu changes and manual refresh take effect promptly.
    const seconds = [5, 15, 30].includes(Number(config.interval)) ? Number(config.interval) : 5;
    for (let i = 0; i < seconds * 4 && !stopping; i++) {
      if (!parentAlive()) { stopping = true; quota.close(); break; }
      const flag = path.join(root, 'refresh.flag');
      if (fs.existsSync(flag)) { try { fs.unlinkSync(flag); } catch {} void quota.refresh(currentConfig, true); break; }
      const updateFlag=path.join(root,'backend-update.flag');
      if (fs.existsSync(updateFlag)) {
        try { fs.unlinkSync(updateFlag); } catch {}
        bootstrapPromise=backend.ensure(currentConfig);
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 250));
    }
  }
  quota.close();
}

module.exports = { bounds, baseUrl, summarize, collect, atomicWrite, createStateWriter };
if (require.main === module) main().catch(error => {
  console.error(error.message);
  try { fs.writeFileSync(path.join(__dirname, 'collector-error.log'), error.stack || error.message, 'utf8'); } catch {}
  process.exitCode = 1;
});
