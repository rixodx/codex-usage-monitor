'use strict';
// Transport follows the public Codex app-server protocol. See THIRD_PARTY_NOTICES.md.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { createInterface } = require('node:readline');

function windowValue(raw) {
  if (!raw) return null;
  const used = raw.usedPercent ?? raw.used_percent;
  const duration = raw.windowDurationMins ?? raw.window_minutes;
  if (used === null || used === undefined || used === '' || typeof used === 'boolean'
      || !Number.isFinite(Number(used)) || ![300, 10080].includes(Number(duration))) return null;
  const usedPercent = Math.max(0, Math.min(100, Number(used)));
  const reset = raw.resetsAt ?? raw.resets_at;
  return {
    usedPercent, remainingPercent: 100 - usedPercent,
    windowDurationMins: Number(duration),
    resetsAt: Number.isFinite(Number(reset)) && Number(reset) > 0 ? Number(reset) : null,
  };
}

function normalizeLimits(payload, source = 'live', observedAt = new Date().toISOString()) {
  const buckets = payload?.rateLimitsByLimitId;
  const bucket = buckets ? buckets.codex : (payload?.rateLimits || payload);
  const result = { source, observedAt, fiveHour: null, sevenDay: null };
  if (!bucket || ((bucket.limitId ?? bucket.limit_id) && (bucket.limitId ?? bucket.limit_id) !== 'codex')) return result;
  for (const raw of [bucket.primary, bucket.secondary]) {
    const value = windowValue(raw);
    if (value?.windowDurationMins === 300) result.fiveHour = value;
    if (value?.windowDurationMins === 10080) result.sevenDay = value;
  }
  return result;
}

function parseLocalSnapshot(text) {
  let best = null;
  for (const line of text.split(/\r?\n/)) {
    if (!line.includes('"token_count"') || !line.includes('"rate_limits"')) continue;
    try {
      const event = JSON.parse(line);
      if (event.type !== 'event_msg' || event.payload?.type !== 'token_count'
          || !Number.isFinite(Date.parse(event.timestamp))) continue;
      const value = normalizeLimits(event.payload.rate_limits, 'local', event.timestamp);
      if ((value.fiveHour || value.sevenDay) && (!best || Date.parse(value.observedAt) > Date.parse(best.observedAt))) best = value;
    } catch { /* A partially written or truncated JSONL record is expected. */ }
  }
  return best;
}

function localSnapshot(home = process.env.CODEX_HOME || path.join(os.homedir(), '.codex')) {
  const root = path.join(home, 'sessions');
  const files = [];
  function recentDirectories(folder) {
    try {
      return fs.readdirSync(folder, { withFileTypes: true }).filter(e => e.isDirectory() && /^\d+$/.test(e.name))
        .sort((a, b) => b.name.localeCompare(a.name)).map(e => path.join(folder, e.name));
    } catch { return []; }
  }
  // Only recent date directories; never recursively read conversation history.
  const days = [];
  for (const year of recentDirectories(root).slice(0, 2)) {
    for (const month of recentDirectories(year).slice(0, 2)) {
      for (const day of recentDirectories(month)) days.push(day);
    }
  }
  for (const day of days.slice(0, 8)) {
    try {
      for (const entry of fs.readdirSync(day, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue;
        const file = path.join(day, entry.name);
        const stat = fs.statSync(file);
        files.push({ file, modified: stat.mtimeMs, size: stat.size });
      }
    } catch { /* Skip inaccessible directories without changing their permissions. */ }
  }
  let best = null;
  for (const entry of files.sort((a, b) => b.modified - a.modified).slice(0, 32)) {
    let fd;
    try {
      fd = fs.openSync(entry.file, 'r');
      const bytes = Math.min(256 * 1024, entry.size);
      const data = Buffer.alloc(bytes);
      fs.readSync(fd, data, 0, bytes, entry.size - bytes);
      const found = parseLocalSnapshot(data.toString('utf8'));
      if (found && (!best || Date.parse(found.observedAt) > Date.parse(best.observedAt))) best = found;
    } catch { /* Files can be rotated or removed while scanning. */ }
    finally { if (fd !== undefined) fs.closeSync(fd); }
  }
  return best;
}

function findCodex(config = {}) {
  if (config.codexExe) {
    if (!fs.existsSync(config.codexExe) || path.extname(config.codexExe).toLowerCase() !== '.exe') throw new Error('Codex CLI 路径无效');
    return config.codexExe;
  }
  const candidates = [process.env.CODEX_EXE];
  const local = process.env.LOCALAPPDATA || '';
  candidates.push(path.join(local, 'Programs', 'OpenAI', 'Codex', 'bin', 'codex.exe'));
  for (const folder of (process.env.PATH || process.env.Path || '').split(path.delimiter)) {
    if (folder) candidates.push(path.join(folder.replace(/^"|"$/g, ''), 'codex.exe'));
  }
  const versionRoot = path.join(local, 'OpenAI', 'Codex', 'bin');
  try {
    for (const entry of fs.readdirSync(versionRoot, { withFileTypes: true }).filter(e => e.isDirectory()).sort((a, b) => b.name.localeCompare(a.name))) {
      candidates.push(path.join(versionRoot, entry.name, 'codex.exe'));
    }
  } catch {}
  const result = candidates.find(file => file && fs.existsSync(file));
  if (!result) throw new Error('找不到 Codex CLI；可在 settings.json 设置 codexExe');
  return result;
}

class AppServer {
  constructor(executable, options = {}) {
    this.executable = executable;
    this.spawnProcess = options.spawnProcess || spawn;
    this.timeoutMs = options.timeoutMs || 8000;
    this.child = null;
    this.pending = new Map();
    this.sequence = 0;
    this.starting = null;
  }
  async ready() {
    if (this.starting) return this.starting;
    this.starting = (async () => {
      const child = this.spawnProcess(this.executable, ['app-server'], {
        stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
      });
      this.child = child;
      const failed = () => {
        if (this.child !== child) return;
        for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error('Codex 额度连接已断开')); }
        this.pending.clear();
        if (this.child === child) { this.child = null; this.starting = null; }
      };
      child.on('error', failed);
      child.on('exit', failed);
      child.stdin.on('error', failed);
      child.stderr.resume(); // Do not persist raw app-server logs or credentials.
      const lines = createInterface({ input: child.stdout });
      lines.on('line', line => {
        try {
          const message = JSON.parse(line);
          const request = this.pending.get(message.id);
          if (!request) return;
          clearTimeout(request.timer);
          this.pending.delete(message.id);
          if (message.error) request.reject(new Error('额度接口查询失败（'+(message.error.code ?? '未知')+'）'));
          else request.resolve(message.result);
        } catch {}
      });
      await this.send('initialize', { clientInfo: { name: 'codex_usage_widget', title: 'Codex Usage Widget', version: '0.2.0' } });
      child.stdin.write(JSON.stringify({ method: 'initialized', params: {} }) + '\n');
    })();
    try { await this.starting; } catch (error) { this.close(); throw error; }
  }
  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      if (!this.child || this.child.killed || !this.child.stdin.writable) return reject(new Error('Codex 额度连接不可用'));
      const id = ++this.sequence;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('额度查询超时')); }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(JSON.stringify({ method, params, id }) + '\n');
    });
  }
  async read() { await this.ready(); return this.send('account/rateLimits/read'); }
  close() {
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error('额度连接已关闭')); }
    this.pending.clear();
    const child = this.child;
    this.child = null; this.starting = null;
    if (child) { child.stdin.end(); child.kill(); }
  }
}

class QuotaProvider {
  constructor(onUpdate, options = {}) {
    this.onUpdate = onUpdate;
    this.readLocal = options.readLocal || localSnapshot;
    this.makeClient = options.makeClient || (exe => new AppServer(exe));
    this.resolveExe = options.resolveExe || findCodex;
    this.snapshot = null;
    this.client = null;
    this.clientPath = null;
    this.pending = null;
    this.nextQuery = 0;
    this.lastLocalScan = 0;
    this.stopped = false;
  }
  publish(value) { this.snapshot = value; this.onUpdate(value); }
  refresh(config = {}, force = false) {
    if (this.stopped) return Promise.resolve();
    const now = Date.now();
    if (now - this.lastLocalScan >= 15000 || force) {
      this.lastLocalScan = now;
      const local = this.readLocal();
      if (local && (!this.snapshot || Date.parse(local.observedAt) > Date.parse(this.snapshot.observedAt))) this.publish(local);
    }
    if (this.pending) return this.pending;
    if (!force && now < this.nextQuery) return Promise.resolve();
    this.nextQuery = now + 60000;
    this.pending = (async () => {
      try {
        const executable = this.resolveExe(config);
        if (!this.client || this.clientPath !== executable) {
          this.client?.close(); this.client = this.makeClient(executable); this.clientPath = executable;
        }
        const result = await this.client.read();
        if (!this.stopped) this.publish(normalizeLimits(result));
      } catch (error) {
        this.client?.close(); this.client = null;
        if (!this.stopped) this.publish({ ...(this.snapshot || { source: 'unavailable', observedAt: null, fiveHour: null, sevenDay: null }),
          error: error.message, attemptedAt: new Date().toISOString() });
      } finally { this.pending = null; }
    })();
    return this.pending;
  }
  close() { this.stopped = true; this.client?.close(); }
}

module.exports = { windowValue, normalizeLimits, parseLocalSnapshot, localSnapshot, AppServer, QuotaProvider };
