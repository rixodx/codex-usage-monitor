'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { BackendManager, compare, releaseAsset, trustedUrl, verify } = require('./backend');
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
  assert.match(result.text,/离线启动/);
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
