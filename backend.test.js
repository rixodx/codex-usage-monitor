'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { BackendManager, compare, releaseAsset, trustedUrl, verify, latestRelease } = require('./backend');
const bytes = Buffer.from('verified upstream fixture');
const digest = crypto.createHash('sha256').update(bytes).digest('hex');
function release(tag = 'v2.7.2') {
  return { tag_name: tag, assets: [{ name: 'codex-usage-windows-amd64.exe',
    browser_download_url: 'https://github.com/zJay26/codex-usage/releases/download/'+tag+'/codex-usage-windows-amd64.exe',
    size: bytes.length, digest: 'sha256:'+digest }] };
}
function fixture(t, initial = null) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-backend-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const home = path.join(root, 'data'); fs.mkdirSync(home);
  fs.writeFileSync(path.join(home,'usage.sqlite'), 'original database');
  let running = initial;
  const calls = [];
  const manager = new BackendManager(root, () => {}, {
    arch: 'x64', attempts: 1, pause: async () => {},
    inspect: async () => running ? { version: running, status: { database_path: path.join(home,'usage.sqlite') } } : null,
    download: async url => { calls.push(['download', url]); return url.endsWith('/latest') ? Buffer.from(JSON.stringify(release())) : bytes; },
    execute: async () => 'codex-usage 2.7.2'
  });
  manager.command = async mode => { calls.push([mode]); if (mode !== 'Probe') running = null; return {pid: 123,path: path.join(root,'old','codex-usage.exe')}; };
  manager.start = async file => { calls.push(['start', file]); running = file.includes('old') ? initial : '2.7.2'; return 456; };
  return { manager, root, home, calls, setRunning: value => { running = value; } };
}
test('stable versions compare numerically and release assets are pinned to the upstream', () => {
  assert.equal(compare('2.10.0','v2.9.9'),1);
  assert.throws(() => releaseAsset({...release(), prerelease:true}));
  assert.throws(() => releaseAsset(release('../unsafe')));
  const wrong = release(); wrong.assets[0].browser_download_url='https://example.com/file.exe';
  assert.throws(() => releaseAsset(wrong));
  const unsigned = release(); delete unsigned.assets[0].digest;
  assert.throws(() => releaseAsset(unsigned));
  assert.throws(() => trustedUrl('https://github.com.evil.example/file'));
  assert.throws(() => trustedUrl('http://github.com/file'));
  assert.throws(() => verify(Buffer.from('corrupt'), releaseAsset(release())));
});
test('latest or newer running service is reused without downloading an executable or restarting', async t => {
  for (const current of ['2.7.2','2.8.0']) {
    const f=fixture(t,current);
    const result=await f.manager.ensure({});
    assert.equal(result.phase,'ready');
    assert.equal(f.calls.length,1);
    assert.equal(result.currentVersion,current);
  }
});
test('network failure preserves an existing running service', async t => {
  const f=fixture(t,'2.6.0');
  f.manager.download=async () => { throw new Error('offline'); };
  const result=await f.manager.ensure({});
  assert.equal(result.phase,'warning');
  assert.match(result.text,/未能核实/);
  assert.deepEqual(f.calls,[]);
});
test('missing service downloads, verifies, and starts the latest release', async t => {
  const f=fixture(t);
  const result=await f.manager.ensure({});
  assert.equal(result.phase,'ready');
  assert.equal(result.currentVersion,'2.7.2');
  assert.equal(f.calls.filter(c=>c[0]==='start').length,1);
  assert.equal(f.calls.filter(c=>c[0]==='Stop').length,0);
  verify(fs.readFileSync(path.join(f.manager.cache,'v2.7.2','codex-usage-windows-amd64.exe')),releaseAsset(release()));
});
test('download completion is followed by verification and persistence before reporting saved', async t => {
  const f=fixture(t);
  const phases=[];
  f.manager.onUpdate=state=>{
    phases.push(state.phase);
    if(state.phase==='saved') {
      assert.ok(fs.existsSync(state.downloadPath));
      verify(fs.readFileSync(state.downloadPath),releaseAsset(release()));
    }
  };
  await f.manager.ensure({});
  assert.deepEqual(phases.filter(phase=>['verifying','saving','saved','ready'].includes(phase)),['verifying','saving','saved','ready']);
});
test('corrupt download never stops the old service', async t => {
  const f=fixture(t,'2.6.0');
  f.manager.download=async url=>url.endsWith('/latest')?Buffer.from(JSON.stringify(release())):Buffer.from('tampered');
  const result=await f.manager.ensure({});
  assert.equal(result.phase,'warning');
  assert.match(result.error,/大小|SHA/);
  assert.equal(f.calls.filter(c=>['Stop','start'].includes(c[0])).length,0);
});
test('an update backs up the existing database before starting the new service', async t => {
  const f=fixture(t,'2.6.0');
  const result=await f.manager.ensure({});
  assert.equal(result.phase,'ready');
  assert.deepEqual(f.calls.filter(c=>['Probe','Stop','start'].includes(c[0])).map(c=>c[0]),['Probe','Stop','start']);
  const folders=fs.readdirSync(path.join(f.manager.cache,'backups'));
  assert.equal(fs.readFileSync(path.join(f.manager.cache,'backups',folders[0],'usage.sqlite'),'utf8'),'original database');
});
test('failed health check stops only the new process, restores data, and restarts the old binary', async t => {
  const f=fixture(t,'2.6.0');
  f.manager.start=async file=>{
    f.calls.push(['start',file]);
    if (file.includes('old')) f.setRunning('2.6.0');
    else { fs.writeFileSync(path.join(f.home,'usage.sqlite'),'new schema'); f.setRunning(null); }
    return 456;
  };
  const result=await f.manager.ensure({});
  assert.equal(result.phase,'warning');
  assert.match(result.text,/已恢复/);
  assert.equal(fs.readFileSync(path.join(f.home,'usage.sqlite'),'utf8'),'original database');
  assert.equal(f.calls.filter(c=>c[0]==='StopOwned').length,1);
  assert.equal(f.calls.filter(c=>c[0]==='start').length,2);
});
test('changed process identity cancels replacement without restarting anything', async t => {
  const f=fixture(t,'2.6.0');
  f.manager.command=async mode=>{ if(mode==='Stop') throw new Error('identity changed'); return {pid:123,path:'old.exe'}; };
  const result=await f.manager.ensure({});
  assert.equal(result.phase,'warning');
  assert.match(result.error,/identity/);
  assert.equal(f.calls.filter(c=>c[0]==='start').length,0);
});
test('a binary reporting the wrong version never stops the existing service', async t => {
  const f=fixture(t,'2.6.0');
  f.manager.execute=async ()=>'codex-usage 2.5.0';
  const result=await f.manager.ensure({});
  assert.match(result.error,/版本不匹配/);
  assert.equal(f.calls.filter(c=>['Stop','start'].includes(c[0])).length,0);
});
test('if the new process cannot be stopped, a live database is never restored', async t => {
  const f=fixture(t,'2.6.0');
  const command=f.manager.command;
  f.manager.command=async mode=>{
    if(mode==='StopOwned') throw new Error('cannot stop');
    return command(mode);
  };
  f.manager.start=async ()=>{
    fs.writeFileSync(path.join(f.home,'usage.sqlite'),'new schema');
    f.setRunning(null);
    return 456;
  };
  const result=await f.manager.ensure({});
  assert.match(result.error,/无法安全回滚/);
  assert.equal(fs.readFileSync(path.join(f.home,'usage.sqlite'),'utf8'),'new schema');
});
test('offline cached startup verifies the cached file and labels latest-version uncertainty', async t => {
  const f=fixture(t);
  await f.manager.ensure({});
  f.setRunning(null);
  f.manager.download=async ()=>{ throw new Error('offline'); };
  const result=await f.manager.ensure({});
  assert.equal(result.phase,'warning');
  assert.match(result.text,/未能核实最新版本/);
  assert.equal(result.latestVersion,null);
  const file=path.join(f.manager.cache,'v2.7.2','codex-usage-windows-amd64.exe');
  fs.writeFileSync(file,'corrupt'); f.setRunning(null);
  const starts=f.calls.filter(c=>c[0]==='start').length;
  await f.manager.ensure({});
  assert.equal(f.calls.filter(c=>c[0]==='start').length,starts);
});
test('concurrent startup checks share one operation', async t => {
  const f=fixture(t,'2.7.2');
  const a=f.manager.ensure({}), b=f.manager.ensure({});
  assert.equal(a,b);
  await a;
  assert.equal(f.calls.length,1);
});
test('cached service starts before a slow GitHub check completes', async t => {
  const f=fixture(t);
  await f.manager.ensure({});
  f.setRunning(null);
  let releaseNetwork;
  let networkStarted;
  const reachedNetwork = new Promise(resolve => { networkStarted=resolve; });
  f.manager.download=async ()=>{
    networkStarted();
    return new Promise(resolve=>{releaseNetwork=()=>resolve(Buffer.from(JSON.stringify(release())));});
  };
  const starts=f.calls.filter(c=>c[0]==='start').length;
  const operation=f.manager.ensure({});
  await reachedNetwork;
  assert.equal(f.calls.filter(c=>c[0]==='start').length,starts+1);
  releaseNetwork(); await operation;
});
test('runtime failures recover a stopped service, with retries throttled to 30 seconds', async t => {
  const f=fixture(t);
  let clock=100000;
  f.manager.now=()=>clock;
  await f.manager.recover({});
  f.setRunning(null);
  assert.equal(f.manager.recover({}),null);
  clock+=30000;
  const starts=f.calls.filter(c=>c[0]==='start').length;
  await f.manager.recover({});
  assert.equal(f.calls.filter(c=>c[0]==='start').length,starts+1);
});
test('REST rate limits fall back to the official release page and SHA256SUMS', async () => {
  const download=async url=>{
    if(url.includes('api.github.com')) throw new Error('HTTP 403');
    if(url.endsWith('/latest')) return Buffer.from('<meta property="og:url" content="/zJay26/codex-usage/releases/tag/v2.7.2" />');
    assert.equal(url,'https://github.com/zJay26/codex-usage/releases/download/v2.7.2/SHA256SUMS');
    return Buffer.from(digest+'  codex-usage-windows-amd64.exe\n');
  };
  const asset=await latestRelease(download,'','x64');
  assert.equal(asset.version,'2.7.2');
  verify(bytes,asset);
  await assert.rejects(latestRelease(async url=>url.endsWith('/latest')&&!url.includes('api.')?Buffer.from('<meta property="og:url" content="https://evil.example/v2.7.2" />'):Promise.reject(new Error('403')),'','x64'));
});

test('directory selection can disable the default home while retaining history and pricing', async t => {
  const f=fixture(t,'2.7.2');
  const main=path.join(f.root,'main'), second=path.join(f.root,'second home');
  fs.mkdirSync(path.join(main,'sessions'),{recursive:true});
  fs.mkdirSync(path.join(second,'sessions'),{recursive:true});
  const cfg=path.join(f.home,'config.json');
  fs.writeFileSync(cfg,JSON.stringify({extra_codex_homes:[second],port:43189,pricing_overrides:{x:{input_usd_per_million:'1'}}}));
  const existing={version:'2.7.2',configured_homes:[main,second],status:{database_path:path.join(f.home,'usage.sqlite')}};
  await f.manager.configureHomes({collectionHomes:[second]},existing,new URL('http://127.0.0.1:43189'));
  assert.equal(f.manager.collectionPrimary,second);
  const saved=JSON.parse(fs.readFileSync(cfg));
  assert.deepEqual(saved.extra_codex_homes,[]);
  assert.deepEqual(saved.pricing_overrides,{x:{input_usd_per_million:'1'}});
  assert.equal(fs.readFileSync(path.join(f.home,'usage.sqlite'),'utf8'),'original database');
  assert.ok(f.calls.some(c=>c[0]==='Stop'));
  assert.ok(fs.readdirSync(f.home).some(n=>n.startsWith('.codex-usage-homes-backup-')));
});

test('unchecking all homes scans only a managed empty folder and unchanged selection avoids restart', async t => {
  const f=fixture(t,'2.7.2');
  const existing={version:'2.7.2',configured_homes:[path.join(f.root,'main')],status:{database_path:path.join(f.home,'usage.sqlite')}};
  await f.manager.configureHomes({collectionHomes:[]},existing,new URL('http://127.0.0.1:43189'));
  const empty=path.join(f.home,'.codex-usage-paused-home');
  assert.equal(f.manager.collectionPrimary,empty);
  assert.ok(fs.statSync(path.join(empty,'sessions')).isDirectory());
  const count=f.calls.length;
  await f.manager.configureHomes({collectionHomes:[]},{...existing,configured_homes:[empty]},new URL('http://127.0.0.1:43189'));
  assert.equal(f.calls.length,count);
});

test('directory apply failure restores previous configuration and original primary home', async t => {
  const f=fixture(t,'2.7.2');
  const main=path.join(f.root,'main'), second=path.join(f.root,'second');
  fs.mkdirSync(path.join(second,'sessions'),{recursive:true});
  const cfg=path.join(f.home,'config.json'), original=JSON.stringify({extra_codex_homes:[second],port:43189});
  fs.writeFileSync(cfg,original);
  const starts=[];
  f.manager.start=async (file,home,primary)=>{ starts.push(primary || f.manager.collectionPrimary); return 456; };
  let waits=0;
  f.manager.wait=async()=>{ if(waits++===0) throw new Error('unhealthy'); return {}; };
  const existing={version:'2.7.2',configured_homes:[main,second],status:{database_path:path.join(f.home,'usage.sqlite')}};
  await assert.rejects(f.manager.configureHomes({collectionHomes:[second]},existing,new URL('http://127.0.0.1:43189')),/unhealthy/);
  assert.equal(fs.readFileSync(cfg,'utf8'),original);
  assert.deepEqual(starts,[second,main]);
});
