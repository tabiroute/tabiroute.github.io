import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
let seq=0;
const fresh=async()=>(await import('../worker/worker.mjs?diagnostics='+ ++seq)).default;
const env={RAKUTEN_APP_ID:'SECRET-APP',RAKUTEN_ACCESS_KEY:'SECRET-ACCESS',HOTPEPPER_API_KEY:'SECRET-HP'};
const request=path=>new Request('https://worker.test'+path,{headers:{Origin:'https://tabiroute.github.io'}});
const ctx={waitUntil:p=>p.catch(()=>{})};
const paths=['/hotels?lat=35&lng=135','/restaurants?lat=35&lng=135'];
test('both providers fail before fetch on a misconfigured rate limiter while health reports presence only',async()=>{
 const w=await fresh(),bad={...env,API_RATE_LIMITER:'true'};let count=0;const old=fetch;globalThis.fetch=async()=>{count++;throw Error('must not fetch')};
 try{const h=await (await w.fetch(request('/health'),bad,ctx)).json();assert.equal(h.ok,true);assert.equal(h.checks.rateLimiter,'invalid_binding');assert.equal(h.checks.upstreamTested,false);
 for(const path of paths){const j=await (await w.fetch(request(path),bad,ctx)).json();assert.equal(j.code,'rate_limiter_unavailable');assert.deepEqual(j.diagnostic,{stage:'rate_limit',reason:'invalid_binding'});}assert.equal(count,0);
 }finally{globalThis.fetch=old;}
});
test('limiter outage remains fail-closed; unknown exception code/body is never returned',async()=>{
 const w=await fresh();const bad={...env,API_RATE_LIMITER:{limit:async()=>{throw Object.assign(Error('SECRET-ACCESS'),{code:'SECRET-HP'})}}};
 const j=await (await w.fetch(request(paths[0]),bad,ctx)).json();assert.equal(j.code,'rate_limiter_unavailable');assert.equal(j.diagnostic.reason,'binding_failure');assert(!JSON.stringify(j).includes('SECRET'));
});
test('fetch timeouts and network exceptions are separate and omit secret messages',async()=>{
 const old=fetch;try{for(const name of ['TimeoutError','TypeError']){const w=await fresh();globalThis.fetch=async()=>{throw Object.assign(Error('SECRET-ACCESS https://example.test/?key=SECRET-HP'),{name});};
 for(const path of paths){const j=await (await w.fetch(request(path),env,ctx)).json();assert.equal(j.code,'provider_unavailable');assert.equal(j.diagnostic.stage,'fetch');assert.equal(j.diagnostic.reason,name==='TimeoutError'?'timeout':'network');assert.equal(j.diagnostic.provider,path.startsWith('/hotels')?'rakuten':'hotpepper');assert(!JSON.stringify(j).includes('SECRET'));}}
 }finally{globalThis.fetch=old;}
});
test('redirect is identified without following it or disclosing Location',async()=>{
 const w=await fresh(),old=fetch;let calls=0;globalThis.fetch=async(u,o)=>{calls++;assert.equal(o.redirect,'manual');return new Response('',{status:302,headers:{Location:'https://example.test/?key=SECRET-ACCESS'}})};
 try{const j=await (await w.fetch(request(paths[0]),env,ctx)).json();assert.equal(j.diagnostic.reason,'redirect');assert.equal(j.diagnostic.upstreamStatus,302);assert.equal(calls,1);assert(!JSON.stringify(j).includes('SECRET'));}finally{globalThis.fetch=old;}
});
test('upstream HTTP status is distinguished from the Worker 503',async()=>{
 const w=await fresh(),old=fetch;globalThis.fetch=async()=>Response.json({error:'server_error',description:'SECRET-ACCESS'},{status:500});
 try{const r=await w.fetch(request(paths[0]),env,ctx),j=await r.json();assert.equal(r.status,503);assert.equal(j.diagnostic.upstreamStatus,500);assert.equal(j.diagnostic.stage,'upstream_http');assert(!JSON.stringify(j).includes('SECRET'));}finally{globalThis.fetch=old;}
});
test('unknown cache exceptions identify the common stage and never echo raw errors',async()=>{
 const w=await fresh();globalThis.caches={default:{match:async()=>{throw Object.assign(Error('SECRET-HP'),{code:'SECRET-ACCESS'})}}};
 try{const j=await (await w.fetch(request(paths[0]),env,ctx)).json();assert.equal(j.code,'worker_internal_error');assert.equal(j.diagnostic.stage,'cache_read');assert(!JSON.stringify(j).includes('SECRET'));}finally{delete globalThis.caches;}
});
test('diagnostic page displays details and cooldown is isolated by provider',async()=>{
 const html=readFileSync(new URL('../diagnostics.html',import.meta.url),'utf8');const script=html.match(/<script>([\s\S]*?)<\/script>/)[1];const elements={result:{},base:{}};let listener;const calls=[];
 const context={URL,Map,Date,AbortSignal,JSON,Math,Number,location:{origin:'https://tabiroute.github.io'},window:{TABIROUTE_BOOKING:{apiBase:'https://worker.test'}},document:{getElementById:id=>elements[id],querySelectorAll:()=>[],addEventListener:(type,cb)=>{listener=cb;}},fetch:async u=>{calls.push(u);return Response.json(u.includes('/health')?{ok:true,version:'booking-v3-diagnostics',checks:{upstreamTested:false}}:{ok:false,code:'provider_unavailable',retryAfter:60,diagnostic:{stage:'fetch',reason:'network'}},{status:u.includes('/health')?200:503});}};
 vm.runInNewContext(script,context);
 const click=path=>listener({target:{closest:()=>({dataset:{path}})}});
 await click(paths[0]);assert(elements.result.textContent.includes('"reason": "network"'));assert(elements.result.textContent.includes('"test": "rakuten"'));
 await click('/health');assert(elements.result.textContent.includes('upstreamTested'));
 await click(paths[1]);assert.equal(calls.length,3);assert(elements.result.textContent.includes('"test": "hotpepper"'));
 await click(paths[0]);assert.equal(calls.length,3);assert(elements.result.textContent.includes('お待ちください'));
});
test('availability diagnostic sends exact hotel and dates and displays no-vacancy separately',async()=>{
 const html=readFileSync(new URL('../diagnostics.html',import.meta.url),'utf8'),script=html.match(/<script>([\s\S]*?)<\/script>/)[1];let listener,called;
 const elements={result:{},base:{},hotelNo:{value:'12345'},checkin:{value:'2026-11-25'},checkout:{value:'2026-11-26'},adults:{value:'1'},rooms:{value:'1'}};
 const context={URL,URLSearchParams,Map,Date,AbortSignal,JSON,Math,Number,Object,location:{origin:'https://tabiroute.github.io'},window:{TABIROUTE_BOOKING:{apiBase:'https://worker.test'}},document:{getElementById:id=>elements[id],querySelectorAll:()=>[],addEventListener:(type,cb)=>listener=cb},fetch:async u=>{called=new URL(u);return Response.json({ok:true,items:[],availabilityStatus:'no_availability',bookingLinksConfigured:true,diagnostic:{stage:'availability',roomCount:0}})}};
 vm.runInNewContext(script,context);await listener({target:{closest:()=>({dataset:{path:'/availability'}})}});
 assert.equal(called.pathname,'/availability');assert.equal(called.searchParams.get('hotelNo'),'12345');assert.equal(called.searchParams.get('checkin'),'2026-11-25');assert.equal(called.searchParams.get('checkout'),'2026-11-26');assert(elements.result.textContent.includes('no_availability'));assert(elements.result.textContent.includes('roomCount'));
});
