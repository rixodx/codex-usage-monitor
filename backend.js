'use strict';
// Bootstrap only the upstream zJay26/codex-usage stable Windows release.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const https = require('node:https');
const http = require('node:http');
const tls = require('node:tls');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

const RELEASE_API = 'https://api.github.com/repos/zJay26/codex-usage/releases/latest';
const REPOSITORY = 'https://github.com/zJay26/codex-usage/releases/download/';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function version(raw) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(raw || '').trim());
  return match ? match.slice(1).map(Number) : null;
}
function compare(a, b) {
  const left = version(a), right = version(b);
  if (!left || !right) throw new Error('服务版本格式无法识别');
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return Math.sign(left[i] - right[i]);
  return 0;
}
function releaseAsset(release, arch = process.arch) {
  if (!release || release.draft || release.prerelease || !version(release.tag_name)) throw new Error('GitHub 未返回有效正式版');
  if (!['x64', 'arm64'].includes(arch)) throw new Error('仅支持 Windows x64 / ARM64');
  const name = 'codex-usage-windows-' + (arch === 'arm64' ? 'arm64' : 'amd64') + '.exe';
  const asset = (release.assets || []).find(a => a.name === name);
  const expected = REPOSITORY + release.tag_name + '/' + name;
  if (!asset || asset.browser_download_url !== expected) throw new Error('正式版缺少对应 Windows 安装包');
  if (!/^sha256:[0-9a-f]{64}$/i.test(asset.digest || '')) throw new Error('正式版缺少 SHA-256 校验值，已停止自动更新');
  return { name, tag: release.tag_name, version: release.tag_name.replace(/^v/, ''),
    url: expected, digest: asset.digest.slice(7).toLowerCase(), size: Number(asset.size) };
}
function trustedUrl(raw) {
  const url = new URL(raw);
  if (url.protocol !== 'https:' || url.username || url.password
      || !['api.github.com', 'github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com', 'github-releases.githubusercontent.com'].includes(url.hostname)) {
    throw new Error('更新下载地址不在 GitHub 官方域名范围');
  }
  return url;
}
function proxyUrl(raw) {
  if (!raw) return null;
  const proxy = new URL(raw);
  if (proxy.protocol !== 'http:' || proxy.username || proxy.password || proxy.pathname !== '/' || proxy.search || proxy.hash) {
    throw new Error('更新代理仅支持不含账号密码的 HTTP 代理地址');
  }
  return proxy;
}

// HTTPS CONNECT with normal TLS certificate verification. No global proxy changes.
function remoteBuffer(raw, proxy = '', maxBytes = 100 * 1024 * 1024, onProgress = () => {}, redirects = 0) {
  const url = trustedUrl(raw);
  const upstream = proxyUrl(proxy);
  if (redirects > 5) return Promise.reject(new Error('下载重定向过多'));
  return new Promise((resolve, reject) => {
    let done = false;
    let active;
    let tunnel;
    const timer = setTimeout(() => fail(new Error('GitHub 连接超时')), 90000);
    function fail(error) {
      if (done) return;
      done = true; clearTimeout(timer); active?.destroy(); tunnel?.destroy(); reject(error);
    }
    function start(socket) {
      if (done) { socket?.destroy(); return; }
      const agent = socket ? new https.Agent({ keepAlive: false }) : false;
      if (socket) agent.createConnection = () => socket;
      active = https.request({ protocol: 'https:', hostname: url.hostname, port: url.port || 443,
        path: url.pathname + url.search, method: 'GET', agent,
        headers: { 'User-Agent': 'CodexUsageWidget/0.3', Accept: 'application/vnd.github+json' } }, response => {
        if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
          response.resume();
          let next;
          try { next = trustedUrl(new URL(response.headers.location, url).href); } catch (error) { fail(error); return; }
          done = true; clearTimeout(timer);
          remoteBuffer(next.href, proxy, maxBytes, onProgress, redirects + 1).then(resolve, reject);
          return;
        }
        if (response.statusCode !== 200) { response.resume(); fail(new Error('GitHub HTTP '+response.statusCode)); return; }
        const chunks = []; let bytes = 0;
        const length = Number(response.headers['content-length']) || 0;
        response.on('data', chunk => {
          bytes += chunk.length;
          if (bytes > maxBytes) { fail(new Error('下载内容超过大小限制')); return; }
          chunks.push(chunk); onProgress(bytes, length);
        });
        response.on('error', fail);
        response.on('end', () => {
          if (done) return;
          done = true; clearTimeout(timer); resolve(Buffer.concat(chunks));
        });
      });
      active.on('error', fail); active.end();
    }
    if (!upstream) { start(); return; }
    const connect = http.request({ hostname: upstream.hostname, port: upstream.port || 80,
      method: 'CONNECT', path: url.hostname + ':443', headers: { Host: url.hostname + ':443' } });
    active = connect;
    connect.on('connect', (response, socket, head) => {
      if (response.statusCode !== 200) { socket.destroy(); fail(new Error('更新代理连接失败')); return; }
      if (head.length) socket.unshift(head);
      tunnel = tls.connect({ socket, servername: url.hostname, rejectUnauthorized: true });
      tunnel.once('error', fail);
      tunnel.once('secureConnect', () => start(tunnel));
    });
    connect.on('error', fail); connect.end();
  });
}

function verify(data, asset) {
  if (asset.size && data.length !== asset.size) throw new Error('下载文件大小不匹配');
  const digest = crypto.createHash('sha256').update(data).digest('hex');
  if (digest !== asset.digest) throw new Error('SHA-256 校验失败，未执行下载文件');
}
function execute(file, args, env = process.env, timeout = 15000) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { windowsHide: true, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('采集服务命令超时')); }, timeout);
    child.stdout.on('data', data => { if (output.length < 32768) output += data; });
    child.stderr.resume();
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('exit', code => { clearTimeout(timer); code === 0 ? resolve(output.trim()) : reject(new Error('采集服务命令失败（'+code+'）')); });
  });
}
function serviceBase(raw) {
  const url = new URL(raw || 'http://127.0.0.1:43189');
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
      || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('无效的本地服务地址');
  return url;
}
async function inspect(base) {
  try {
    const response = await fetch(base + '/api/v1/status', { signal: AbortSignal.timeout(2000), redirect: 'error' });
    if (!response.ok) return null;
    const value = await response.json();
    if (!version(value.version) || !value.status || value.privacy?.loopback_only !== true) return null;
    return value;
  } catch { return null; }
}

class BackendManager {
  constructor(root, onUpdate = () => {}, options = {}) {
    this.root = root;
    this.cache = path.join(root, '.runtime');
    this.onUpdate = onUpdate;
    this.inspect = options.inspect || inspect;
    this.download = options.download || remoteBuffer;
    this.execute = options.execute || execute;
    this.spawn = options.spawn || spawn;
    this.pause = options.pause || delay;
    this.attempts = options.attempts || 45;
    this.arch = options.arch || process.arch;
    this.pending = null;
  }
  report(phase, text, more = {}) {
    this.state = { ...(this.state || {}), phase, text, ...more, checkedAt: new Date().toISOString() };
    this.onUpdate(this.state);
  }
  async command(mode, base, previous) {
    const shell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(this.root, 'service-control.ps1'),
      '-Mode', mode, '-Port', String(base.port || 80)];
    if (previous) args.push('-ExpectedPid', String(previous.pid), '-ExpectedPath', previous.path);
    return JSON.parse(await this.execute(shell, args));
  }
  async prepare(asset, proxy) {
    const folder = path.join(this.cache, asset.tag);
    const file = path.join(folder, asset.name);
    fs.mkdirSync(folder, { recursive: true });
    if (fs.existsSync(file)) {
      try { verify(fs.readFileSync(file), asset); return file; } catch { /* Redownload a modified cache file. */ }
    }
    this.report('downloading', '下载采集服务 v'+asset.version, { latestVersion: asset.version });
    let lastPercent = -1;
    const data = await this.download(asset.url, proxy, 100*1024*1024, (bytes, length) => {
      const percent = length ? Math.min(100, Math.floor(bytes / length * 100)) : 0;
      if (percent !== lastPercent) { lastPercent = percent; this.report('downloading', '下载采集服务 '+percent+'%', { progress: percent }); }
    });
    verify(data, asset);
    fs.writeFileSync(file + '.part', data);
    fs.renameSync(file + '.part', file);
    return file;
  }
  start(file, home) {
    const child = this.spawn(file, ['daemon'], { detached: true, windowsHide: true, stdio: 'ignore',
      env: { ...process.env, CODEX_USAGE_HOME: home } });
    return new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('spawn', () => { child.unref(); resolve(child.pid); });
    });
  }
  async wait(base, expected) {
    for (let i=0; i<this.attempts; i++) {
      const state = await this.inspect(base.origin);
      if (state && compare(state.version, expected) === 0) return state;
      await this.pause(1000);
    }
    throw new Error('新版采集服务未通过启动检查');
  }
  backup(home) {
    const folder = path.join(this.cache, 'backups', Date.now()+'-'+crypto.randomBytes(3).toString('hex'));
    fs.mkdirSync(folder, { recursive: true });
    const files = ['usage.sqlite', 'usage.sqlite-wal', 'usage.sqlite-shm', 'config.json'];
    for (const name of files) if (fs.existsSync(path.join(home,name))) fs.copyFileSync(path.join(home,name),path.join(folder,name));
    return { folder, files };
  }
  restore(home, backup) {
    for (const name of backup.files) {
      const source = path.join(backup.folder,name), target = path.join(home,name);
      if (fs.existsSync(source)) fs.copyFileSync(source,target);
      else if (name !== 'config.json' && fs.existsSync(target)) fs.unlinkSync(target);
    }
  }
  ensure(config = {}) {
    if (this.pending) return this.pending;
    this.pending = this.run(config).catch(error => {
      this.report('warning', '采集服务检查失败', { error: error.message });
      return this.state;
    }).finally(() => { this.pending = null; });
    return this.pending;
  }
  async run(config) {
    const base = serviceBase(config.baseUrl);
    this.report('checking', '检查采集服务版本…', { error:null, warning:null, progress:null, latestVersion:null });
    const existing = await this.inspect(base.origin);
    this.report('checking', '检查 GitHub 最新正式版…', { currentVersion: existing?.version || null });
    const manifestPath = path.join(this.cache,'release.json');
    const proxy = config.updateProxy || process.env.HTTPS_PROXY || process.env.https_proxy || '';
    let asset, offline = false;
    try {
      const metadata = JSON.parse((await this.download(RELEASE_API,proxy,2*1024*1024)).toString('utf8'));
      asset = releaseAsset(metadata,this.arch);
    } catch (error) {
      if (existing) {
        this.report('warning', 'v'+existing.version+' · 未能核实最新版本', { error: error.message });
        return this.state;
      }
      try {
        const cached=JSON.parse(fs.readFileSync(manifestPath,'utf8'));
        asset=releaseAsset(cached,this.arch);
        const file=path.join(this.cache,asset.tag,asset.name);
        verify(fs.readFileSync(file),asset);
      } catch { throw new Error('本地服务缺失，且无法连接 GitHub 下载；请检查更新代理'); }
      this.report('starting','离线启动已校验的缓存版本',{ warning:'尚未核实最新版本' });
      offline = true;
    }
    if (existing && compare(existing.version,asset.version)>=0) {
      this.report('ready','v'+existing.version+' · 已是最新',{currentVersion:existing.version,latestVersion:asset.version});
      return this.state;
    }
    const file=await this.prepare(asset,proxy);
    fs.mkdirSync(this.cache,{recursive:true});
    fs.writeFileSync(manifestPath,JSON.stringify({tag_name:asset.tag,draft:false,prerelease:false,assets:[{name:asset.name,browser_download_url:asset.url,digest:'sha256:'+asset.digest,size:asset.size}]}));
    const executableVersion=(await this.execute(file,['version'])).trim();
    const reported=executableVersion.match(/(?:^|\s)v?(\d+\.\d+\.\d+)(?:\s|$)/);
    if (!reported || compare(reported[1],asset.version)!==0) throw new Error('下载程序版本不匹配，未停止旧服务');
    const defaultHome=process.env.CODEX_USAGE_HOME || path.join(process.env.LOCALAPPDATA || path.join(os.homedir(),'AppData','Local'),'codex-usage');
    const home=existing?.status?.database_path ? path.dirname(existing.status.database_path) : defaultHome;
    if (!path.isAbsolute(home) || path.parse(home).root===home || path.resolve(home)===path.resolve(os.homedir())) throw new Error('采集服务数据目录不安全');
    const cfgFile=path.join(home,'config.json');
    let serviceConfig={};
    if (fs.existsSync(cfgFile)) serviceConfig=JSON.parse(fs.readFileSync(cfgFile,'utf8'));
    if (Number(serviceConfig.port || 43189)!==Number(base.port || 80)) throw new Error('服务配置端口与悬浮窗不一致，请先调整本地服务配置');
    const old=existing ? await this.command('Probe',base) : null;
    let backup=null, startedPid=null, stopped=false;
    try {
      if (old) {
        this.report('installing','切换采集服务至 v'+asset.version+'…');
        await this.command('Stop',base,old);
        stopped=true;
        backup=this.backup(home);
      } else this.report('starting','启动采集服务 v'+asset.version+'…');
      startedPid=await this.start(file,home);
      await this.wait(base,asset.version);
    } catch (error) {
      if (startedPid) {
        try {
          await this.command('StopOwned',base,{pid:startedPid,path:file});
        } catch (stopError) {
          // Never restore a live database if the new process cannot be stopped.
          throw new Error(error.message+'；无法安全回滚：'+stopError.message);
        }
      }
      if (old && stopped) {
        if (backup) this.restore(home,backup);
        await this.start(old.path,home); await this.wait(base,existing.version);
        this.report('warning','更新失败，已恢复 v'+existing.version,{currentVersion:existing.version,error:error.message});
        return this.state;
      }
      throw error;
    }
    this.report(offline?'warning':'ready','v'+asset.version+' · '+(offline?'离线启动，未核实最新版本':existing?'已更新':'已启动'),
      {currentVersion:asset.version,latestVersion:offline?null:asset.version});
    return this.state;
  }
}

module.exports={BackendManager,version,compare,releaseAsset,trustedUrl,verify,remoteBuffer,serviceBase};
