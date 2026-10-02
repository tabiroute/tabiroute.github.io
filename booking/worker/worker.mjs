/* たびルート：無料API専用プロキシ。DB/KV/有料サービスへの依存なし。 */
const VERSION = 'booking-v3-diagnostics';
const KNOWN_FAULT = Symbol('booking-fault');
const TTL = {hotels:3600, restaurants:3600, availability:60};
const circuits = new Map();
const ipWindows = new Map();
const flights = new Map();
const HOSTS = {
  rakuten:['travel.rakuten.co.jp','hotel.travel.rakuten.co.jp','web.travel.rakuten.co.jp','img.travel.rakuten.co.jp','hb.afl.rakuten.co.jp','hb.afl.rakuten.co.jp'],
  hotpepper:['www.hotpepper.jp','hotpepper.jp','imgfp.hotp.jp','imgfp.hotpepper.jp','hpr.jp']
};
export function safeURL(value,provider){
  try {const u=new URL(String(value||''));if(!['https:','http:'].includes(u.protocol)||u.username||u.password)return '';if(!HOSTS[provider]?.includes(u.hostname))return '';u.protocol='https:';return u.href;}catch{return '';}
}
function fault(code,status=503,retryAfter=300,diagnostic){return Object.assign(new Error(code),{code,status,retryAfter,diagnostic,[KNOWN_FAULT]:true});}
function int(v,min,max,def){if(v===null||v===undefined||v==='')return def;const n=Number(v);if(!Number.isInteger(n)||n<min||n>max)throw fault('invalid_request',400,0);return n;}
function text(v,max=80){v=String(v||'').trim();if(v.length>max)throw fault('invalid_request',400,0);return v;}
function coord(v,min,max){const n=Number(v);if(v===null||v===''||!Number.isFinite(n)||n<min||n>max)throw fault('invalid_request',400,0);return n.toFixed(5);}
function date(v){if(!/^\d{4}-\d{2}-\d{2}$/.test(v||''))throw fault('invalid_dates',400,0);const d=new Date(v+'T00:00:00Z');if(!Number.isFinite(+d)||d.toISOString().slice(0,10)!==v)throw fault('invalid_dates',400,0);return v;}
export function validate(path,s){
  if(path==='/hotels'){
    const q=text(s.get('q'));if(q&&q.length<2)throw fault('invalid_request',400,0);return q?{q}:{lat:coord(s.get('lat'),20,46),lng:coord(s.get('lng'),122,154)};
  }
  if(path==='/restaurants')return {lat:coord(s.get('lat'),20,46),lng:coord(s.get('lng'),122,154),q:text(s.get('q')),range:int(s.get('range'),1,5,5)};
  if(path==='/availability'){
    const p={hotelNo:int(s.get('hotelNo'),1,9999999999),checkin:date(s.get('checkin')),checkout:date(s.get('checkout')),adults:int(s.get('adults'),1,10,2),rooms:int(s.get('rooms'),1,10,1)};
    const today=new Date(Date.now()+9*3600000).toISOString().slice(0,10);
    const days=(Date.parse(p.checkout)-Date.parse(p.checkin))/86400000;
    if(!p.hotelNo||p.checkin<today||days<1||days>30)throw fault('invalid_dates',400,0);
    // 初版は大人のみ。同一人数の部屋を指定。子供を0人に置き換えて検索しない。
    if(int(s.get('children'),0,10,0)>0)throw fault('children_external',422,0);
    return p;
  }
  throw fault('not_found',404,0);
}
export function normalizeHotels(j){
  return (j.hotels||[]).flatMap(x=>{
    const a=Array.isArray(x.hotel)?x.hotel:[x.hotel||x];const b=a.find(v=>v.hotelBasicInfo)?.hotelBasicInfo;
    if(!b||!/^\d+$/.test(String(b.hotelNo))||!b.hotelName)return [];
    const lat=Number(b.latitude),lng=Number(b.longitude);if(!Number.isFinite(lat)||!Number.isFinite(lng)||lat<20||lat>46||lng<122||lng>154)return [];
    return [{id:String(b.hotelNo),name:String(b.hotelName),lat,lng,address:String(b.address1||'')+String(b.address2||''),photo:safeURL(b.hotelImageUrl||b.hotelThumbnailUrl,'rakuten'),url:safeURL(b.hotelInformationUrl,'rakuten'),planUrl:safeURL(b.planListUrl,'rakuten'),rating:Number(b.reviewAverage)>0?Number(b.reviewAverage):null,reviewCount:Number(b.reviewCount)||0,access:String(b.access||''),parking:String(b.parkingInformation||'')}];
  }).slice(0,20);
}
export function normalizeRestaurants(j){
  return (j.results?.shop||[]).flatMap(s=>{
    const lat=Number(s.lat),lng=Number(s.lng);if(!/^J\d+$/.test(s.id)||!s.name||!Number.isFinite(lat)||!Number.isFinite(lng))return [];
    return [{id:s.id,name:String(s.name),lat,lng,address:String(s.address||''),genre:String(s.genre?.name||''),catch:String(s.catch||''),budget:String(s.budget?.average||s.budget?.name||''),hours:String(s.open||''),closed:String(s.close||''),photo:safeURL(s.photo?.pc?.l||s.photo?.pc?.m,'hotpepper'),url:safeURL(s.urls?.pc,'hotpepper')}];
  });
}
export function normalizeAvailability(j,hotelNo){
  const hotels=(j.hotels||[]).filter(x=>(x.hotel||[]).some(y=>String(y.hotelBasicInfo?.hotelNo)===String(hotelNo)));
  if(!hotels.length)return [];
  const plans=[];
  for(const hotel of hotels)for(const part of hotel.hotel||[]){
    const room=part.roomInfo;if(!room)continue;
    const blocks=Array.isArray(room)?room:[room];
    for(const b of blocks){const r=b.roomBasicInfo;if(!r)continue;const url=safeURL(r.reserveUrl,'rakuten');
      if(url)plans.push({name:String(r.planName||r.roomName||'宿泊プラン'),room:String(r.roomName||''),url});
    }
  }
  return [...new Map(plans.map(p=>[p.url,p])).values()].slice(0,6);
}
async function upstream(provider,url,headers={}){
  const until=circuits.get(provider)||0;if(until>Date.now())throw fault('provider_limited',429,Math.ceil((until-Date.now())/1000),{provider,stage:'cooldown'});
  let r,j,signal;const started=Date.now();
  try{signal=AbortSignal.timeout(9000);}catch{throw fault('worker_runtime_error',503,60,{provider,stage:'request_setup'});}
  try{r=await fetch(url,{headers,signal,redirect:'manual'});}
  catch(e){const timeout=signal.aborted||e?.name==='TimeoutError'||e?.name==='AbortError';circuits.set(provider,Date.now()+60000);throw fault('provider_unavailable',503,60,{provider,stage:'fetch',reason:timeout?'timeout':'network',elapsedMs:Date.now()-started});}
  const detail={provider,stage:'upstream_http',upstreamStatus:r.status};
  // Do not follow redirects with API credentials or include URLs / response bodies.
  if(r.status>=300&&r.status<400){circuits.set(provider,Date.now()+60000);throw fault('provider_unavailable',503,60,{...detail,reason:'redirect'});}
  if(r.status===401||r.status===403){circuits.set(provider,Date.now()+1800000);throw fault('provider_config',503,1800,detail);}
  if(r.status===429||r.status===503){circuits.set(provider,Date.now()+300000);throw fault('provider_limited',429,300,detail);}
  try{j=await r.json();}catch(e){circuits.set(provider,Date.now()+60000);throw fault('provider_bad_response',503,60,{...detail,stage:'response_body',reason:signal.aborted||e?.name==='TimeoutError'||e?.name==='AbortError'?'timeout':'unreadable'});}
  if(!j||typeof j!=='object'){circuits.set(provider,Date.now()+60000);throw fault('provider_bad_response',503,60,{...detail,stage:'response_body',reason:'invalid_shape'});}
  if(r.status===404&&j.error==='not_found')return {hotels:[]};
  if(!r.ok){circuits.set(provider,Date.now()+60000);throw fault('provider_unavailable',503,60,detail);}
  if(j.error){if(j.error==='not_found')return {hotels:[]};const limited=/too_many|rate|limit/i.test(j.error);circuits.set(provider,Date.now()+300000);throw fault(limited?'provider_limited':'provider_config',503,300,{...detail,stage:'provider_error'});}
  if(j.results?.error){const e=[].concat(j.results.error)[0];circuits.set(provider,Date.now()+300000);throw fault(String(e?.code)==='2000'?'provider_config':'provider_unavailable',503,300,{...detail,stage:'provider_error'});}
  return j;
}
async function query(path,p,env){
  if(path==='/restaurants'){
    if(!env.HOTPEPPER_API_KEY)throw fault('not_configured',503,1800);
    const u=new URL('https://webservice.recruit.co.jp/hotpepper/gourmet/v1/');
    u.search=new URLSearchParams({key:env.HOTPEPPER_API_KEY,format:'json',lat:p.lat,lng:p.lng,range:p.range,count:'20',order:'1',...(p.q?{keyword:p.q}:{})});
    return {items:normalizeRestaurants(await upstream('hotpepper',u)),provider:'hotpepper'};
  }
  if(!env.RAKUTEN_APP_ID||!env.RAKUTEN_ACCESS_KEY)throw fault('not_configured',503,1800);
  if(path==='/availability'&&!env.RAKUTEN_AFFILIATE_ID)throw fault('booking_links_not_configured',503,1800);
  const endpoint=path==='/availability'?'VacantHotelSearch/20170426':p.q?'KeywordHotelSearch/20260731':'SimpleHotelSearch/20260731';
  const u=new URL('https://openapi.rakuten.co.jp/engine/api/Travel/'+endpoint);
  const params={applicationId:env.RAKUTEN_APP_ID,format:'json',formatVersion:'1',datumType:'1',responseType: path==='/availability'?'large':'middle',hits:'20'};
  if(env.RAKUTEN_AFFILIATE_ID)params.affiliateId=env.RAKUTEN_AFFILIATE_ID;
  if(path==='/availability')Object.assign(params,{hotelNo:p.hotelNo,checkinDate:p.checkin,checkoutDate:p.checkout,adultNum:p.adults,roomNum:p.rooms});
  else if(p.q)params.keyword=p.q;
  else Object.assign(params,{latitude:p.lat,longitude:p.lng,searchRadius:'3'});
  u.search=new URLSearchParams(params);
  const j=await upstream('rakuten',u,{accessKey:env.RAKUTEN_ACCESS_KEY,Referer:env.SITE_URL||'https://tabiroute.github.io/'});
  if(path==='/availability')return {items:normalizeAvailability(j,p.hotelNo),provider:'rakuten',conditions:p,matched:(j.hotels||[]).length>0};
  return {items:normalizeHotels(j),provider:'rakuten'};
}
function response(data,status,origin,retry){return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...(origin?{'Access-Control-Allow-Origin':origin,'Vary':'Origin','Access-Control-Expose-Headers':'Retry-After'}:{}),...(retry?{'Retry-After':String(retry)}:{})}});}
async function rateLimit(request,env){
  const ip=request.headers.get('CF-Connecting-IP')||'unknown';
  if(env.API_RATE_LIMITER){
    if(typeof env.API_RATE_LIMITER.limit!=='function')throw fault('rate_limiter_unavailable',503,60,{stage:'rate_limit',reason:'invalid_binding'});
    try{const result=await env.API_RATE_LIMITER.limit({key:ip});
      if(typeof result?.success!=='boolean')throw fault('rate_limiter_unavailable',503,60,{stage:'rate_limit',reason:'invalid_response'});
      if(!result.success)throw fault('client_limited',429,60,{stage:'rate_limit',reason:'limit_reached'});
    }catch(e){if(e?.[KNOWN_FAULT])throw e;throw fault('rate_limiter_unavailable',503,60,{stage:'rate_limit',reason:'binding_failure'});}return;
  }
  // Dashboard-only deployment also works. This fallback is per-isolate, not a global quota.
  const bucket=Math.floor(Date.now()/60000);const prev=ipWindows.get(ip);const count=prev?.bucket===bucket?prev.count+1:1;ipWindows.set(ip,{bucket,count});
  if(ipWindows.size>2000)for(const[k,v]of ipWindows)if(v.bucket!==bucket)ipWindows.delete(k);
  if(count>30)throw fault('client_limited',429,60);
}
export default {async fetch(request,env,ctx){
  const origin=request.headers.get('Origin');const allowed=(env.ALLOWED_ORIGINS||'https://tabiroute.github.io').split(',').map(s=>s.trim()).filter(Boolean);
  const u=new URL(request.url);
  if(origin&&!allowed.includes(origin))return response({ok:false,code:'origin_denied'},403,null);
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{'Access-Control-Allow-Origin':origin||allowed[0],'Access-Control-Allow-Methods':'GET, OPTIONS','Access-Control-Max-Age':'86400','Vary':'Origin'}});
  if(request.method!=='GET')return response({ok:false,code:'method_not_allowed'},405,origin);
  if(u.pathname==='/health')return response({ok:true,version:VERSION,configured:{rakuten:!!(env.RAKUTEN_APP_ID&&env.RAKUTEN_ACCESS_KEY),hotpepper:!!env.HOTPEPPER_API_KEY,bookingLinks:!!env.RAKUTEN_AFFILIATE_ID},enabled:env.API_ENABLED!=='false',checks:{rateLimiter:env.API_RATE_LIMITER?(typeof env.API_RATE_LIMITER.limit==='function'?'binding_present':'invalid_binding'):'local_fallback',timeoutSupported:typeof AbortSignal?.timeout==='function',upstreamTested:false}},200,origin);
  let stage='validation';
  try{
    if(env.API_ENABLED==='false')throw fault('maintenance',503,1800);
    const p=validate(u.pathname,u.searchParams);stage='rate_limit';await rateLimit(request,env);stage='cache_read';
    const ttl=TTL[u.pathname.slice(1)], canonical=new URL(request.url);canonical.pathname='/_cache/'+VERSION+u.pathname;canonical.search=new URLSearchParams(p);canonical.searchParams.sort();
    // Cache only normalized public data; no app IDs or API secrets in cache keys/bodies.
    const key=new Request(canonical.href), cache=globalThis.caches?.default;
    const hit=cache&&await cache.match(key);if(hit){const data=await hit.json();if(data.expiresAt>Date.now())return response({...data,cached:true},200,origin);}
    const flightKey=canonical.href;
    stage='provider_query';let pending=flights.get(flightKey);
    if(!pending){pending=query(u.pathname,p,env).then(data=>({...data,ok:true,fetchedAt:Date.now(),expiresAt:Date.now()+ttl*1000}));flights.set(flightKey,pending);pending.finally(()=>flights.delete(flightKey)).catch(()=>{});}
    const data=await pending;
    stage='cache_write';if(cache)ctx.waitUntil(cache.put(key,new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json','Cache-Control':'public,max-age='+ttl}})));
    return response(data,200,origin);
  }catch(e){const known=e?.[KNOWN_FAULT];return response({ok:false,version:VERSION,code:known?e.code:'worker_internal_error',retryAfter:known?e.retryAfter:300,diagnostic:known?(e.diagnostic||{stage}):{stage}},known?e.status:503,origin,known?e.retryAfter:300);}
}};
