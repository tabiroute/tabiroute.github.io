import {test} from 'node:test';
import assert from 'node:assert/strict';
import {rakutenCredentials,classifyAuthReason} from '../worker/worker.mjs';

let seq=0;
const fresh=async()=>(await import('../worker/worker.mjs?rakuten-auth='+ ++seq)).default;
const env={RAKUTEN_APP_ID:' APP-SECRET \n',RAKUTEN_ACCESS_KEY:' ACCESS-SECRET \n',RAKUTEN_AFFILIATE_ID:' AFFILIATE \n',HOTPEPPER_API_KEY:'HP-SECRET',SITE_URL:'https://tabiroute.github.io/',ALLOWED_ORIGINS:'https://tabiroute.github.io'};
const req=(path,origin='https://tabiroute.github.io')=>new Request('https://worker.test'+path,{headers:{Origin:origin}});
const ctx={waitUntil:p=>p.catch(()=>{})};

test('credentials trim whitespace and identify only the configured allowed HTTPS site',()=>{
 const c=rakutenCredentials(env);
 assert.equal(c.appId,'APP-SECRET');assert.equal(c.affiliateId,'AFFILIATE');
 assert.deepEqual(c.headers,{accessKey:'ACCESS-SECRET',Referer:'https://tabiroute.github.io/',Origin:'https://tabiroute.github.io'});
 for(const SITE_URL of ['not a url','http://tabiroute.github.io/','https://other.test/','https://user:pass@tabiroute.github.io/'])assert.throws(()=>rakutenCredentials({...env,SITE_URL}));
 assert.throws(()=>rakutenCredentials({...env,RAKUTEN_ACCESS_KEY:' \n'}),/not_configured/);
 const clean=rakutenCredentials({...env,SITE_URL:'https://tabiroute.github.io/?key=PRIVATE#fragment'});
 assert.equal(clean.headers.Referer,'https://tabiroute.github.io/');
});

test('all three hotel endpoints use the same headers without putting accessKey in the URL',async()=>{
 const w=await fresh(),old=fetch,seen=[];
 const start=new Date(Date.now()+10*86400000).toISOString().slice(0,10),end=new Date(Date.now()+11*86400000).toISOString().slice(0,10);
 globalThis.fetch=async(u,o)=>{seen.push(u.pathname);assert.equal(u.searchParams.get('applicationId'),'APP-SECRET');assert.equal(u.searchParams.get('affiliateId'),'AFFILIATE');assert(!u.href.includes('ACCESS-SECRET'));assert.equal(o.headers.accessKey,'ACCESS-SECRET');assert.equal(o.headers.Origin,'https://tabiroute.github.io');assert.equal(o.headers.Referer,'https://tabiroute.github.io/');return Response.json({hotels:[]});};
 try{for(const path of ['/hotels?lat=35&lng=135','/hotels?q=京都','/availability?hotelNo=1&checkin='+start+'&checkout='+end]){const r=await w.fetch(req(path),env,ctx);assert.equal(r.status,200);assert(!(await r.text()).includes('SECRET'));}
 assert.deepEqual(seen.map(s=>s.split('/').at(-2)),['SimpleHotelSearch','KeywordHotelSearch','VacantHotelSearch']);
 }finally{globalThis.fetch=old;}
});

test('caller Origin is never substituted for the configured site',async()=>{
 const w=await fresh(),old=fetch;let count=0;
 globalThis.fetch=async(u,o)=>{count++;assert.equal(o.headers.Origin,'https://tabiroute.github.io');return Response.json({hotels:[]});};
 try{assert.equal((await w.fetch(req('/hotels?q=京都','https://evil.test'),env,ctx)).status,403);assert.equal(count,0);
 const alternate={...env,ALLOWED_ORIGINS:env.ALLOWED_ORIGINS+',https://preview.test'};
 assert.equal((await w.fetch(req('/hotels?q=京都','https://preview.test'),alternate,ctx)).status,200);assert.equal(count,1);
 }finally{globalThis.fetch=old;}
});

test('403 classification is retained through cooldown without disclosing upstream secrets',async()=>{
 const w=await fresh(),old=fetch;let count=0;
 globalThis.fetch=async()=>{count++;return Response.json({errors:{errorMessage:'Invalid Access Key: ACCESS-SECRET https://private.test/'}},{status:403});};
 try{for(const [i,q] of ['京都','大阪'].entries()){const j=await (await w.fetch(req('/hotels?q='+q),env,ctx)).json();assert.equal(j.diagnostic.authReason,'credentials_rejected');assert.equal(j.diagnostic.stage,i?'cooldown':'upstream_http');if(!i)assert.equal(j.diagnostic.upstreamStatus,403);assert(!JSON.stringify(j).includes('SECRET'));assert(!JSON.stringify(j).includes('private.test'));}assert.equal(count,1);
 }finally{globalThis.fetch=old;}
});

test('reason labels are conservative classifications, with no raw text returned',()=>{
 assert.equal(classifyAuthReason({code:'HTTP_REFERRER_NOT_ALLOWED'}),'site_not_allowed');
 assert.equal(classifyAuthReason({message:'Origin is required'}),'site_header_missing');
 assert.equal(classifyAuthReason({message:'IP address is not allowed'}),'ip_not_allowed');
 assert.equal(classifyAuthReason({message:'Insufficient API permission'}),'api_permission_denied');
 assert.equal(classifyAuthReason({message:'Forbidden SECRET'}),'unclassified');
});

test('HTML and oversized 403 bodies remain unclassified and safe',async()=>{
 const old=fetch;
 try{for(const body of ['<html>SECRET</html>',JSON.stringify({message:'Invalid Access Key',padding:'SECRET'.repeat(4000)})]){const w=await fresh();globalThis.fetch=async()=>new Response(body,{status:403});const j=await (await w.fetch(req('/hotels?q=京都'),env,ctx)).json();assert.equal(j.diagnostic.authReason,'unclassified');assert(!JSON.stringify(j).includes('SECRET'));}}
 finally{globalThis.fetch=old;}
});

test('Hotpepper success is independent of Rakuten configuration and sends no Rakuten headers',async()=>{
 const w=await fresh(),old=fetch;
 globalThis.fetch=async(u,o)=>{assert.equal(u.hostname,'webservice.recruit.co.jp');assert.equal(u.searchParams.get('key'),'HP-SECRET');assert.deepEqual(o.headers,{});return Response.json({results:{shop:[]}});};
 try{const r=await w.fetch(req('/restaurants?lat=35&lng=135'),{...env,SITE_URL:'invalid',RAKUTEN_ACCESS_KEY:''},ctx);assert.equal(r.status,200);const h=await (await w.fetch(req('/health'),env,ctx)).json();assert.equal(h.version,'booking-v5-stay-plans');}
 finally{globalThis.fetch=old;}
});
