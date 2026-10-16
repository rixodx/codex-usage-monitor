'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { bounds, baseUrl, summarize, collect } = require('./collector');

test('China-local midnight, rolling days, and month boundaries', () => {
  const now = new Date('2026-10-15T16:01:00Z');
  assert.deepEqual(bounds('today', now), { since: '2026-10-16', until: '2026-10-17' });
  assert.deepEqual(bounds('week', now), { since: '2026-10-10', until: '2026-10-17' });
  assert.deepEqual(bounds('month', now), { since: '2026-10-01', until: '2026-10-17' });
  assert.deepEqual(bounds('week', new Date('2026-01-01T01:00:00Z')), { since: '2025-12-26', until: '2026-01-02' });
});

test('only loopback service addresses are accepted', () => {
  assert.equal(baseUrl('http://127.0.0.1:43189'), 'http://127.0.0.1:43189');
  for (const url of ['https://example.com', 'http://127.0.0.1.evil.com', 'http://user:secret@localhost', 'http://localhost/path']) {
    assert.throws(() => baseUrl(url));
  }
});

test('preserves provider totals; never double counts cached or reasoning tokens', () => {
  const result = summarize({ usage: { input: 1000, cached_input: 800, output: 50, reasoning_output: 30, total: 1050 }, grand_total: 1050, coverage_incomplete: true },
    { summary: { usd: '0.1234', coverage_ratio: 0.9, unpriced_tokens: 105 }, models: [] }, { status: {} }, 'today');
  assert.equal(result.total, 1050);
  assert.equal(result.uncached, 200);
  assert.equal(result.usd, 0.1234);
  assert.equal(result.warnings.length, 2);
  assert.equal(result.coverage, 0.9);
});

test('API failures propagate, rather than displaying a zero usage success', async () => {
  await assert.rejects(collect({}, async () => ({ ok: false, status: 503 })), /503/);
});

test('requests standard API cost, not subscription Fast-credit weighting', async () => {
  const urls = [];
  const request = async url => {
    urls.push(url);
    return { ok: true, json: async () => url.includes('/summary?') ? { usage: {}, grand_total: 0 }
      : url.includes('/cost-estimate?') ? { summary: { usd: '0' } } : { status: {} } };
  };
  const result = await collect({ period: 'today' }, request);
  assert.equal(result.ok, true);
  assert.equal(urls.length, 3);
  assert.ok(urls.every(url => !url.includes('codex_fast_weighted')));
});
