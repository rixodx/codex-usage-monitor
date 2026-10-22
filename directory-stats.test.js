'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {filterStatistics,selectionKey}=require('./directory-stats');
const {collect}=require('./collector');
const first='C:\\Users\\tester\\.codex', second='C:\\Users\\tester\\other';
const pricing={catalog_as_of:'2026-10-07',basis:'current_standard_api_text_token_prices',catalog:[{
  model:'gpt-test',aliases:['test-alias'],snapshot_patterns:['gpt-test-YYYY-MM-DD'],input_usd_per_million:'2',cached_input_usd_per_million:'0.1',output_usd_per_million:'10'
}],overrides:{'glm-5.3':{input_usd_per_million:'1.4',cached_input_usd_per_million:'0.26',cache_write_input_usd_per_million:'0',output_usd_per_million:'4.4'}}};
const event=(home,model='gpt-test',usage={input:1000,cached_input:800,output:50,reasoning_output:30,total:1050})=>({codex_home:home,model,usage,session_id:home,timestamp:'2026-10-22T00:00:00Z'});

test('directory filter changes totals, cost, model list and sessions together',()=>{
 const events=[event(first),event(second,'glm-5.3')];
 const one=filterStatistics(events,pricing,[first]);
 assert.equal(one.summary.grand_total,1050); assert.equal(one.summary.session_count,1);
 assert.equal(one.report.summary.usd,0.00098);
 assert.deepEqual(one.report.models.map(m=>m.key),['gpt-test']);
 const two=filterStatistics(events,pricing,[first,second]);
 assert.equal(two.summary.grand_total,2100); assert.equal(two.summary.session_count,2);
 assert.equal(two.report.summary.usd,0.001688);
 const empty=filterStatistics(events,pricing,[]);
 assert.equal(empty.summary.grand_total,0); assert.equal(empty.report.summary.usd,0);
 assert.deepEqual(empty.report.models,[]);
});
test('matching uses full normalized Windows home paths and never directory prefixes',()=>{
 const events=[event(first),event(first+'-other'),event(second)];
 assert.equal(filterStatistics(events,pricing,[first.toUpperCase()+'\\',first]).summary.grand_total,1050);
 assert.equal(selectionKey([first,second,first]),selectionKey([second.toUpperCase(),first+'\\']));
});
test('invalid categories and unknown cache-write rates retain tokens as unpriced',()=>{
 const invalid=event(first,'glm-5.3',{input:10,cached_input:30,output:2,total:42});
 const partial=event(first,'gpt-test',{input:100,cached_input:20,cache_write_input:30,output:5,total:105});
 const result=filterStatistics([invalid,partial],pricing,[first]);
 assert.equal(result.summary.grand_total,147);
 assert.equal(result.report.summary.unpriced_tokens,72);
 assert.equal(result.report.summary.usd,0.000152);
 assert.equal(result.report.summary.coverage_ratio,75/147);
});
test('snapshot aliases and explicit free usage follow service catalog without fast multipliers',()=>{
 const catalog={...pricing,catalog:[...pricing.catalog,{model:'free',input_usd_per_million:'0',cached_input_usd_per_million:'0',cache_write_input_usd_per_million:'0',output_usd_per_million:'0'}]};
 const result=filterStatistics([event(first,'test-alias-2026-10-22'),event(first,'free',{total:100})],catalog,[first]);
 assert.equal(result.report.summary.unpriced_tokens,0); assert.equal(result.report.summary.usd,0.00098);
});
test('filtered collection requests event export and live pricing, and propagates errors',async()=>{
 const urls=[];
 const request=async url=>{
  urls.push(url);
  return {ok:true,json:async()=>url.includes('/export?')?[event(first),event(second,'glm-5.3')]:url.endsWith('/pricing')?pricing:{status:{},version:'2.7.3'}};
 };
 const result=await collect({collectionHomes:[first]},request);
 assert.equal(result.total,1050); assert.equal(result.models.length,1); assert.equal(result.usd,0.00098);
 assert.equal(result.filterKey,selectionKey([first])); assert.equal(urls.length,3);
 assert.ok(urls.every(url=>!url.includes('codex_fast_weighted')));
 await assert.rejects(collect({collectionHomes:[first]},async()=>({ok:false,status:503})),/503/);
});
