'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { bounds, baseUrl, summarize, collect, atomicWrite, createStateWriter } = require('./collector');

test('transient Windows sharing errors retry atomic replacement and clean temporary files', async () => {
  let attempts=0, removed=0, saved=false;
  const temps=[];
  const io={
    writeFileSync: (file,text)=>{temps.push(file);assert.deepEqual(JSON.parse(text),{ok:true});},
    renameSync: ()=>{attempts++; if(attempts<4) throw Object.assign(new Error('shared file'),{code:'EPERM'}); saved=true;},
    existsSync: ()=>!saved,
    unlinkSync: ()=>{removed++;}
  };
  await atomicWrite('state.json',{ok:true},io,async()=>{});
  assert.equal(attempts,4);
  assert.equal(removed,0);
  assert.notEqual(temps[0],'state.json.tmp');
  saved=false; attempts=0;
  io.renameSync=()=>{attempts++; throw Object.assign(new Error('permanent lock'),{code:'EPERM'});};
  await assert.rejects(atomicWrite('state.json',{ok:true},io,async()=>{}),/permanent lock/);
  assert.equal(attempts,12); assert.equal(removed,1);
});
test('a failed status save does not kill later updates or the background downloader', async () => {
  const errors=[], writes=[];
  const save=createStateWriter('state.json',error=>errors.push(error.message),async(file,state)=>{
    writes.push(state.progress);
    if(state.progress===44) throw new Error('EPERM');
  });
  await Promise.all([save({progress:44}),save({progress:100}),save({progress:'ready'})]);
  assert.deepEqual(errors,['EPERM']);
  assert.deepEqual(writes,[44,100,'ready']);
});

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
