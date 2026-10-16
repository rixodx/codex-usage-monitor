'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { normalizeLimits, parseLocalSnapshot, QuotaProvider, AppServer } = require('./quota');

const five = { usedPercent: 7, windowDurationMins: 300, resetsAt: 1900000000 };
const seven = { usedPercent: 16, windowDurationMins: 10080, resetsAt: 1900500000 };

test('selects codex bucket, and maps by duration rather than primary/secondary position', () => {
  const result = normalizeLimits({ rateLimitsByLimitId: { other: { primary: five }, codex: { primary: seven, secondary: five } } });
  assert.equal(result.fiveHour.usedPercent, 7);
  assert.equal(result.fiveHour.remainingPercent, 93);
  assert.equal(result.sevenDay.usedPercent, 16);
});

test('missing, null, and unrelated windows are never treated as zero usage', () => {
  for (const payload of [
    { primary: { ...five, usedPercent: null } },
    { primary: { ...five, windowDurationMins: 60 } },
    { rateLimitsByLimitId: { another: { primary: five } }, rateLimits: { primary: five } },
    { limitId: 'another-model', primary: five },
  ]) assert.equal(normalizeLimits(payload).fiveHour, null);
});

test('zero usage is valid; excessive percentages clamp, invalid reset is unknown', () => {
  assert.equal(normalizeLimits({ primary: { ...five, usedPercent: 0 } }).fiveHour.remainingPercent, 100);
  const result = normalizeLimits({ primary: { ...five, usedPercent: 120, resetsAt: null } });
  assert.equal(result.fiveHour.usedPercent, 100);
  assert.equal(result.fiveHour.resetsAt, null);
});

test('local fallback reads only quota events, tolerates partial JSON and uses event timestamps', () => {
  const event = (date, limits) => JSON.stringify({ type: 'event_msg', timestamp: date, payload: { type: 'token_count', rate_limits: limits } });
  const raw = [
    event('2026-10-16T09:00:00Z', { primary: { used_percent: 4, window_minutes: 300, resets_at: 1900000000 } }),
    '{"partial":',
    JSON.stringify({ type: 'event_msg', timestamp: '2026-10-16T10:00:00Z', payload: { type: 'agent_message', message: 'ignored' } }),
    event('2026-10-16T08:00:00Z', { primary: five }),
  ].join('\n');
  const result = parseLocalSnapshot(raw);
  assert.equal(result.fiveHour.usedPercent, 4);
  assert.equal(result.observedAt, '2026-10-16T09:00:00Z');
  assert.equal(result.source, 'local');
  assert.equal(result.sevenDay, null);
  assert.equal('message' in result, false);
});

test('live failure keeps a timestamped local snapshot and backs off', async () => {
  const updates = [];
  let queries = 0;
  const local = normalizeLimits({ primary: five, secondary: seven }, 'local', '2026-10-16T09:00:00Z');
  const provider = new QuotaProvider(q => updates.push(q), {
    readLocal: () => local, resolveExe: () => 'fake.exe',
    makeClient: () => ({ read: async () => { queries++; throw new Error('offline'); }, close() {} }),
  });
  await provider.refresh(); await provider.refresh();
  assert.equal(queries, 1);
  assert.equal(provider.snapshot.source, 'local');
  assert.equal(provider.snapshot.fiveHour.usedPercent, 7);
  assert.equal(provider.snapshot.error, 'offline');
  provider.close();
});

test('successful live response replaces the whole snapshot; missing 5h is not filled with old data', async () => {
  const provider = new QuotaProvider(() => {}, {
    readLocal: () => normalizeLimits({ primary: five }, 'local', '2026-10-16T09:00:00Z'),
    resolveExe: () => 'fake.exe',
    makeClient: () => ({ read: async () => ({ rateLimits: { primary: seven } }), close() {} }),
  });
  await provider.refresh();
  assert.equal(provider.snapshot.source, 'live');
  assert.equal(provider.snapshot.fiveHour, null);
  assert.equal(provider.snapshot.sevenDay.usedPercent, 16);
  provider.close();
});

test('app-server initializes before querying, reuses its child and closes it', async () => {
  const calls = []; let child; let spawns = 0;
  const server = new AppServer('fake.exe', { spawnProcess: () => {
    spawns++;
    child = new EventEmitter(); child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.kill = () => { child.killed = true; setImmediate(() => child.emit('exit', 0)); };
    child.stdin.on('data', data => {
      const message = JSON.parse(data.toString()); calls.push(message.method);
      if (message.id) setImmediate(() => child.stdout.write(JSON.stringify({ id: message.id, result: message.method === 'initialize' ? {} : { rateLimits: { primary: five } } })+'\n'));
    });
    return child;
  } });
  const first = await server.read(); await server.read();
  assert.deepEqual(calls, ['initialize', 'initialized', 'account/rateLimits/read', 'account/rateLimits/read']);
  assert.equal(spawns, 1); assert.equal(first.rateLimits.primary.usedPercent, 7);
  server.close(); assert.equal(child.killed, true);
});

test('a query timeout rejects and can be closed without leaving a pending timer', async () => {
  const server = new AppServer('fake.exe', { timeoutMs: 15 });
  server.child = { killed: false, stdin: { writable: true, write() {}, end() {} }, kill() {} };
  await assert.rejects(server.send('account/rateLimits/read'), /超时/);
  assert.equal(server.pending.size, 0);
  server.close();
});
