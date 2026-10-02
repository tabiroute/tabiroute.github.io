/* たびルート：無料API専用プロキシ。DB/KV/有料サービスへの依存なし。 */
const VERSION = 'booking-v5-stay-plans';
const KNOWN_FAULT = Symbol('booking-fault');
const TTL = {hotels:3600, restaurants:3600, availability:60};
const circuits = new Map();
const authReasons = new Map();
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
export function rakutenCredentials(env){
  const appId=String(env.RAKUTEN_APP_ID||'').trim(),accessKey=String(env.RAKUTEN_ACCESS_KEY||'').trim();
  if(!appId||!accessKey)throw fault('not_configured',503,1800,{provider:'rakuten',stage:'credentials'});
  let site;
  try{site=new URL(String(env.SITE_URL||'https://tabiroute.github.io/').trim());}catch{throw fault('provider_config',503,1800,{provider:'rakuten',stage:'request_setup',reason:'invalid_site_url'});}
  const allowed=(env.ALLOWED_ORIGINS||'https://tabiroute.github.io').split(',').map(x=>x.trim());
  if(site.protocol!=='https:'||site.username||site.password||!allowed.includes(site.origin))throw fault('provider_config',503,1800,{provider:'rakuten',stage:'request_setup',reason:'site_origin_mismatch'});
  // Identify this application's own configured website; never copy a caller's
  // arbitrary Origin or substitute a third-party site to get around a refusal.
  site.search='';site.hash='';
  return {appId,accessKey,affiliateId:String(env.RAKUTEN_AFFILIATE_ID||'').trim(),headers:{accessKey,Referer:site.href,Origin:site.origin}};
}
export function classifyAuthReason(body){
  // Heuristic classifications, not verbatim upstream text or official codes.
  const codes=[body?.error,body?.code,body?.errorCode,body?.errors?.errorCode,body?.errors?.code,body?.error?.code].filter(x=>typeof x==='string').join(' ').toUpperCase();
  if(/HTTP_REFERRER_NOT_ALLOWED|REFERRER_NOT_ALLOWED|ORIGIN_NOT_ALLOWED/.test(codes))return 'site_not_allowed';
  if(/REFERRER_MISSING|ORIGIN_MISSING/.test(codes))return 'site_header_missing';
  if(/INVALID_ACCESS_KEY|ACCESS_KEY_INVALID|INVALID_APPLICATION_ID|INVALID_APP_ID/.test(codes))return 'credentials_rejected';
  const text=[body?.error_description,body?.errorMessage,body?.message,body?.errors?.errorMessage,body?.errors?.message,body?.error?.message].filter(x=>typeof x==='string').map(x=>x.slice(0,2048).toLowerCase()).join(' ');
  if(/(?:referer|referrer|origin).{0,45}(?:not allowed|not permitted|mismatch)/.test(text))return 'site_not_allowed';
  if(/(?:referer|referrer|origin).{0,45}(?:missing|required)/.test(text))return 'site_header_missing';
  if(/invalid (?:access\s*key|application\s*id|app\s*id)|(?:access\s*key|application\s*id|app\s*id).{0,30}(?:invalid|expired|revoked)/.test(text))return 'credentials_rejected';
  if(/(?:ip address|source ip).{0,40}(?:not allowed|denied)/.test(text))return 'ip_not_allowed';
  if(/(?:scope|permission).{0,35}(?:insufficient|missing|denied)|insufficient.{0,35}(?:scope|permission)/.test(text))return 'api_permission_denied';
  return 'unclassified';
}
async function authReason(response){
  // Read at most 16 KiB and return a fixed label only. No key, URL, raw body,
  // exception message, or upstream HTML is exposed to clients or logs.
  let reader;
  try{reader=response.body?.getReader();if(!reader)return 'unclassified';let size=0,raw='';const decoder=new TextDecoder();
    while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>16384){await reader.cancel();return 'unclassified';}raw+=decoder.decode(value,{stream:true});}
    raw+=decoder.decode();return classifyAuthReason(JSON.parse(raw));
  }catch{return 'unclassified';}finally{reader?.releaseLock();}
}
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
const asArray=value=>Array.isArray(value)?value:value&&typeof value==='object'?[value]:[];
export function availabilityResult(j,hotelNo){
  const plans=[];let matched=false,roomCount=0,missingLinks=0,rejectedLinks=0,facilityUrl='';
  for(const wrapped of asArray(j.hotels)){
    const parts=asArray(wrapped.hotel||wrapped);
    const basic=parts.find(p=>p.hotelBasicInfo)?.hotelBasicInfo;
    if(String(basic?.hotelNo)!==String(hotelNo))continue;
    matched=true;
    facilityUrl=facilityUrl||safeURL(basic.planListUrl,'rakuten')||safeURL(basic.hotelInformationUrl,'rakuten');
    for(const part of parts){
      for(const block of asArray(part.roomInfo)){
        const room=block.roomBasicInfo;if(!room)continue;
        roomCount++;
        const url=safeURL(room.reserveUrl,'rakuten');
        if(!url){if(room.reserveUrl)rejectedLinks++;else missingLinks++;continue;}
        plans.push({name:String(room.planName||room.roomName||'宿泊プラン'),room:String(room.roomName||''),url});
      }
    }
  }
  const items=[...new Map(plans.map(p=>[p.url,p])).values()].slice(0,6);
  const availabilityStatus=items.length?'plans_available':!matched?'no_availability':roomCount?'links_unavailable':'no_room_details';
  return {items,matched,availabilityStatus,facilityUrl,diagnostic:{stage:'availability',roomCount,missingLinks,rejectedLinks}};
}
export function normalizeAvailability(j,hotelNo){return availabilityResult(j,hotelNo).items;}
async function upstream(provider,url,headers={}){
  const until=circuits.get(provider)||0;if(until>Date.now())throw fault('provider_limited',429,Math.ceil((until-Date.now())/1000),{provider,stage:'cooldown',...(authReasons.has(provider)?{authReason:authReasons.get(provider)}:{})});
  authReasons.delete(provider);
  let r,j,signal;const started=Date.now();
  try{signal=AbortSignal.timeout(9000);}catch{throw fault('worker_runtime_error',503,60,{provider,stage:'request_setup'});}
  try{r=await fetch(url,{headers,signal,redirect:'manual'});}
  catch(e){const timeout=signal.aborted||e?.name==='TimeoutError'||e?.name==='AbortError';circuits.set(provider,Date.now()+60000);throw fault('provider_unavailable',503,60,{provider,stage:'fetch',reason:timeout?'timeout':'network',elapsedMs:Date.now()-started});}
  const detail={provider,stage:'upstream_http',upstreamStatus:r.status};
  // Do not follow redirects with API credentials or include URLs / response bodies.
  if(r.status>=300&&r.status<400){circuits.set(provider,Date.now()+60000);throw fault('provider_unavailable',503,60,{...detail,reason:'redirect'});}
  if(r.status===401||r.status===403){const reason=provider==='rakuten'?await authReason(r):null;circuits.set(provider,Date.now()+1800000);if(reason)authReasons.set(provider,reason);throw fault('provider_config',503,1800,{...detail,...(reason?{authReason:reason}:{})});}
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
  const credentials=rakutenCredentials(env);
  const endpoint=path==='/availability'?'VacantHotelSearch/20170426':p.q?'KeywordHotelSearch/20260731':'SimpleHotelSearch/20260731';
  const u=new URL('https://openapi.rakuten.co.jp/engine/api/Travel/'+endpoint);
  const params={applicationId:credentials.appId,format:'json',formatVersion:'1',datumType:'1',responseType: path==='/availability'?'large':'middle',hits:'20'};
  if(credentials.affiliateId)params.affiliateId=credentials.affiliateId;
  if(path==='/availability')Object.assign(params,{hotelNo:p.hotelNo,checkinDate:p.checkin,checkoutDate:p.checkout,adultNum:p.adults,roomNum:p.rooms,searchPattern:'1'});
  else if(p.q)params.keyword=p.q;
  else Object.assign(params,{latitude:p.lat,longitude:p.lng,searchRadius:'3'});
  u.search=new URLSearchParams(params);
  const j=await upstream('rakuten',u,credentials.headers);
  if(path==='/availability')return {...availabilityResult(j,p.hotelNo),provider:'rakuten',conditions:p,bookingLinksConfigured:!!credentials.affiliateId};
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
