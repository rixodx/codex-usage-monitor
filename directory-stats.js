'use strict';
const path = require('node:path');

function homeKey(value) {
  if (typeof value !== 'string' || !path.win32.isAbsolute(value)) throw new Error('统计目录必须是 Windows 绝对路径');
  return path.win32.normalize(value).replace(/[\\/]+$/, '').toLowerCase();
}
function selectionKey(homes) {
  return Array.isArray(homes) ? [...new Set(homes.map(homeKey))].sort().join('|') : '*';
}
function rateNano(value) {
  const match = /^(\d+)(?:\.(\d{1,3}))?$/.exec(String(value).trim());
  if (!match) throw new Error('本地服务返回无效模型价格');
  return BigInt(match[1]) * 1000n + BigInt((match[2] || '').padEnd(3,'0'));
}
function resolveRate(model, pricing) {
  const name = String(model || '').trim().toLowerCase();
  const builtin = requested => (pricing.catalog || []).find(entry => [entry.model, ...(entry.aliases || [])].some(base => {
    if (requested === base) return true;
    const suffix = requested.slice(base.length + 1);
    return (entry.snapshot_patterns || []).length && requested.startsWith(base + '-') && /^\d{4}-\d{2}-\d{2}$/.test(suffix)
      && !Number.isNaN(Date.parse(suffix)) && new Date(suffix).toISOString().slice(0,10) === suffix;
  }));
  const override = pricing.overrides?.[name];
  const entry = override ? (override.alias_of ? builtin(override.alias_of) : override) : builtin(name);
  if (!entry) return null;
  return ['input','cached_input','cache_write_input','output'].map(key => {
    const value = entry[key + '_usd_per_million'];
    return value === undefined || value === '' ? null : rateNano(value);
  });
}
function priceUsage(usage, model, pricing) {
  const [input,cached,write,output,reasoning,total] = ['input','cached_input','cache_write_input','output','reasoning_output','total'].map(k => usage[k] || 0);
  const tokens = total || input + output;
  const unknown = { nano:0n, priced:0, unpriced:Math.max(0,tokens) };
  if ([input,cached,write,output,reasoning,total].some(n => !Number.isSafeInteger(n) || n < 0)
      || cached > input || write > input-cached || reasoning > output) return unknown;
  const rate = resolveRate(model,pricing);
  if (!input && !output && tokens > 0) return rate?.every(n => n === 0n) ? { nano:0n,priced:tokens,unpriced:0 } : unknown;
  if (tokens !== input+output || !rate || rate[0] === null || rate[1] === null || rate[3] === null) return unknown;
  const missingWrite = rate[2] === null ? write : 0;
  return {
    nano:BigInt(input-cached-write)*rate[0] + BigInt(cached)*rate[1] + BigInt(write)*(rate[2] || 0n) + BigInt(output)*rate[3],
    priced:tokens-missingWrite, unpriced:missingWrite,
  };
}
function filterStatistics(events, pricing, homes) {
  if (!Array.isArray(events) || !Array.isArray(pricing?.catalog)) throw new Error('本地服务返回的目录统计数据不兼容');
  const selected = new Set(homes.map(homeKey));
  const fields = ['input','cached_input','cache_write_input','output','reasoning_output','total'];
  const usage = Object.fromEntries(fields.map(k => [k,0]));
  const sessions = new Set(), models = new Map();
  let lastEvent=null, nano=0n, priced=0, unpriced=0;
  for (const event of events) {
    if (!event.codex_home || !selected.has(homeKey(event.codex_home))) continue;
    const data = event.usage;
    if (!data || typeof data !== 'object') throw new Error('用量记录缺少 token 分类');
    const model = String(event.model || '').trim() || '未知模型';
    const cost = priceUsage(data,model,pricing);
    const row = models.get(model) || { key:model,usage:Object.fromEntries(fields.map(k=>[k,0])),nano:0n,unpriced:0 };
    for (const key of fields) {
      const value=Number(data[key]) || 0;
      if (!Number.isSafeInteger(value) || value < 0) throw new Error('用量记录包含无效 token 计数');
      usage[key]+=value; row.usage[key]+=value;
      if (!Number.isSafeInteger(usage[key])) throw new Error('目录统计 token 计数超出安全范围');
    }
    nano+=cost.nano; priced+=cost.priced; unpriced+=cost.unpriced;
    row.nano+=cost.nano; row.unpriced+=cost.unpriced; models.set(model,row);
    if (event.session_id) sessions.add(event.session_id);
    if (event.timestamp && (!lastEvent || Date.parse(event.timestamp)>Date.parse(lastEvent))) lastEvent=event.timestamp;
  }
  return {
    summary:{usage,grand_total:usage.total,session_count:sessions.size,last_event:lastEvent},
    report:{summary:{usd:Number(nano)/1e9,coverage_ratio:priced+unpriced ? priced/(priced+unpriced) : 0,unpriced_tokens:unpriced},
      models:[...models.values()].map(row=>({key:row.key,usage:row.usage,estimate:{usd:Number(row.nano)/1e9,unpriced_tokens:row.unpriced}})),
      catalog_as_of:pricing.catalog_as_of,basis:pricing.basis},
  };
}
module.exports={homeKey,selectionKey,filterStatistics};
