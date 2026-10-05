/* Shared resolver, used unchanged by the browser and the Worker. No per-place files/catalogue. */
// iOS 15 以前の Safari には AbortSignal.timeout が無く、fetch の前に例外になるため補う。
if(typeof AbortSignal!=='undefined'&&typeof AbortSignal.timeout!=='function'&&typeof AbortController==='function')AbortSignal.timeout=ms=>{const c=new AbortController();setTimeout(()=>{try{c.abort(new DOMException('signal timed out','TimeoutError'))}catch{c.abort()}},ms);return c.signal};
(function(root){'use strict';
const VERSION='photo-v10',DAY=86400000;
const HOSTS={wiki:'https://ja.wikipedia.org/w/api.php',data:'https://www.wikidata.org/w/api.php',commons:'https://commons.wikimedia.org/w/api.php'};
const REJECT=/\.svg$|\.gif$|地図|案内板|説明板|看板|路線図|平面図|ロゴ|肖像|噴煙|噴火|\b(?:map|maps|logo|flag|diagram|portrait|postcard|eruption|smoke|signboard|illustration|painting)\b|black.and.white/i;
function text(v){return String(v||'').replace(/<[^>]*>/g,' ').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&[^;]+;/g,' ').normalize('NFKC').replace(/[_\s]+/g,' ').trim();}
function norm(v){return text(v).toLowerCase().replace(/[\s・ー‐\-（）()「」]/g,'');}
function wikiTitle(v){let s=String(v||'');if(s.startsWith('https://ja.wikipedia.org/wiki/')){try{s=decodeURIComponent(s.split('/wiki/')[1].split('#')[0]);}catch{return '';}}else if(s.startsWith('ja:'))s=s.slice(3);else if(/[:/]/.test(s))return '';return text(s).slice(0,180);}
function place(o){const e=o.extra||{};const lat=Number(o.lat),lng=Number(o.lng);if(o.lat==null||o.lng==null||!Number.isFinite(lat)||!Number.isFinite(lng)||lat<20||lat>46||lng<122||lng>154)throw fail('location_required',0);const name=text(o.name).slice(0,160);if(name.length<2)throw fail('name_required',0);return {name,lat:+lat.toFixed(5),lng:+lng.toFixed(5),wiki:wikiTitle(o.wiki||e.wiki||e.wikipedia),qid:/^Q[1-9]\d*$/.test(o.qid||e.wikidata||'')?o.qid||e.wikidata:'',pref:text(o.pref).slice(0,10)};}
function key(p){return JSON.stringify([VERSION,p.name,p.lat,p.lng,p.wiki||'',p.qid||'']);}
function distance(a,b){const r=Math.PI/180,x=(b.lat-a.lat)*r,y=(b.lng-a.lng)*r,z=Math.sin(x/2)**2+Math.cos(a.lat*r)*Math.cos(b.lat*r)*Math.sin(y/2)**2;return 12742*Math.asin(Math.min(1,Math.sqrt(z)));}
function titles(p){const n=p.name,b=n.replace(/[（(][^）)]*[）)]/g,'').trim(),inside=n.match(/[（(]([^）)]+)[）)]/);return [...new Set([p.wiki,n,b,...b.split(/\s+/).filter(s=>s.length>=3),inside?.[1],b.replace(/(?:展望台|展望デッキ|ロープウェイ|の町並み|の街並み)$/,'')].filter(s=>s&&s.length>=2))].slice(0,7);}
function fail(code,retryAfter=60){return Object.assign(new Error(code),{code,retryAfter});}
function retrySeconds(v,now=Date.now()){const s=String(v||'');const n=/^\d+$/.test(s)?Number(s):Math.ceil((Date.parse(s)-now)/1000);return Number.isFinite(n)&&n>0?Math.min(86400,n):60;}
function imageURL(v){try{const u=new URL(v);return u.protocol==='https:'&&!u.username&&!u.password&&['upload.wikimedia.org','thumb.wikimedia.org'].includes(u.hostname)?u.href:'';}catch{return '';}}
function fileName(v){const f=text(v).replace(/^(?:File|ファイル):/,'');return f.length<=240&&!/[\u0000-\u001f/:\\]/.test(f)&&/\.(?:jpe?g|png|webp)$/i.test(f)?f:'';}
function photo(page,p,article,structured=false){
 const ii=page?.imageinfo?.[0],file=fileName(page?.title);if(!ii||!file||!/^image\/(jpeg|png|webp)$/.test(ii.mime)||ii.width<400||ii.height<250||ii.width/ii.height<.45||ii.width/ii.height>4)return null;
 const m=ii.extmetadata||{},license=text(m.LicenseShortName?.value),caption=text(m.ImageDescription?.value),artist=text(m.Artist?.value);
 if(m.NonFree?.value==='true'||!(/^(CC BY(?:-SA)? [\d.]|CC0|Public domain)/.test(license))||!artist||REJECT.test(file+' '+caption))return null;
 const primary=norm(file)===norm(article?.pageimage),names=[p.name,article?.title,...(article?.langlinks||[]).map(x=>x.title)].filter(Boolean);
 const from=caption.match(/(.{1,120})から(?:見た|望む|眺めた|撮影)/)?.[1]||caption.match(/\bfrom\s+(.{1,120})/i)?.[1];
 if(from&&!/展望|眺望|山|岬|峠|高原|湖|海岸/.test(p.name)&&names.some(n=>norm(n).length>=3&&norm(from).includes(norm(n))))return null;
 if(!primary&&!structured&&!names.some(n=>norm(n).length>=3&&norm(file+' '+caption).includes(norm(n))))return null;
 const src=imageURL(ii.thumburl||ii.url),orig=imageURL(ii.url);if(!src||!orig)return null;
 const pageURL='https://commons.wikimedia.org/wiki/File:'+encodeURIComponent(file);
 return {file,src,orig,page:pageURL,artist,license,licenseURL:/^https?:\/\//.test(m.LicenseUrl?.value||'')?m.LicenseUrl.value.replace(/^http:/,'https:'):pageURL,width:ii.width,height:ii.height,contain:ii.width/ii.height<1.1,policy:10,lazyCredit:false,score:(structured?40:primary?30:10)+(/全景|外観|庭園|境内|panorama|exterior|landscape/i.test(caption)?5:0)};
}
function articleScore(p,a){
 if(!a||a.missing||Object.prototype.hasOwnProperty.call(a.pageprops||{},'disambiguation'))return -1;
 const c=a.coordinates?.[0],d=c?distance(p,{lat:c.lat,lng:c.lon}):null;
 const explicit=(p.wiki&&norm(p.wiki)===norm(a.title))||(p.qid&&p.qid===a.pageprops?.wikibase_item);
 if(explicit)return d===null||d<15?150-(d||0):-1;
 if(d===null)return -1;
 const full=norm(a.title.replace(/\s*[（(][^）)]*[）)]$/,'')),ns=titles(p).map(norm);const exact=ns.includes(full);if(!exact||d>15)return -1;
 return 100-Math.min(20,d*2)+(d<1?10:0);
}
function memoryStore(limit=250){const m=new Map();return {async get(k){return m.get(k)||null;},async set(k,v){m.delete(k);m.set(k,v);while(m.size>limit)m.delete(m.keys().next().value);},async delete(k){m.delete(k);}};}
function transport({fetcher=(...a)=>fetch(...a),store=memoryStore(),now=Date.now,gap=350,headers={}}={}){
 let chain=Promise.resolve(),last=0;const pauses=new Map(),flights=new Map();
 async function api(host,args,{refresh=false}={}){
  if(!HOSTS[host])throw fail('invalid_provider',0);const u=new URL(HOSTS[host]);u.search=new URLSearchParams({format:'json',formatversion:'2',origin:'*',maxlag:'5',...args});u.searchParams.sort();const k='api:'+u.href;
  const old=await store.get(k).catch(()=>null);if(!refresh&&old&&old.until>now())return old.data;
  if(flights.has(k))return flights.get(k);
  const pending=chain.catch(()=>{}).then(async()=>{
   if((pauses.get(host)||0)>now())throw fail('provider_limited',Math.ceil((pauses.get(host)-now())/1000));
   const wait=Math.max(0,gap-(now()-last));if(wait)await new Promise(r=>setTimeout(r,wait));last=now();
   let r,j;try{r=await fetcher(u.href,{headers,signal:AbortSignal.timeout(9000),redirect:'error'});}catch{throw fail('provider_unavailable');}
   if(r.status===429||r.status===503){const retry=retrySeconds(r.headers.get('Retry-After'),now());pauses.set(host,now()+retry*1000);throw fail('provider_limited',retry);}
   if(!r.ok)throw fail(r.status===403?'provider_denied':'provider_unavailable',r.status===403?300:60);
   try{j=await r.json();}catch{throw fail('provider_bad_response');}
   if(!j||typeof j!=='object')throw fail('provider_bad_response');
   if(j.error){const retry=retrySeconds(r.headers.get('Retry-After'),now());if(/maxlag|ratelimited|readonly/.test(j.error.code||'')){pauses.set(host,now()+retry*1000);throw fail('provider_limited',retry);}throw fail('provider_bad_response');}
   await store.set(k,{data:j,until:now()+DAY,staleUntil:now()+7*DAY}).catch(()=>{});return j;
  });chain=pending;flights.set(k,pending);try{return await pending;}finally{flights.delete(k);}
 }
 return {api};
}
function resolver({api,store=memoryStore(),now=Date.now}={}){
 const flights=new Map();
 async function files(names,refresh=false){const fs=[...new Set(names.map(fileName).filter(Boolean))].slice(0,12);if(!fs.length)return [];const j=await api('commons',{action:'query',prop:'imageinfo',iiprop:'url|extmetadata|mime|size',iiurlwidth:'500',titles:fs.map(f=>'File:'+f).join('|')},{refresh});return j.query?.pages||[];}
 async function resolveUncached(p,refresh){
  const request=(host,args)=>api(host,args,{refresh});let deferredError=null;
  const query={action:'query',redirects:'1',prop:'coordinates|pageimages|pageprops|langlinks',ppprop:'disambiguation|wikibase_item',piprop:'name',pilicense:'free',pilimit:'50',colimit:'50',lllang:'en',lllimit:'50'};
  let entity=null,article=null,entityFiles=[];
  async function data(qid){const j=await request('data',{action:'wbgetentities',ids:qid,props:'claims|sitelinks|labels',languages:'ja|en',sitefilter:'jawiki'});const e=j.entities?.[qid];if(!e||e.missing!==undefined)return null;const c=e.claims?.P625?.find(x=>x.rank!=='deprecated'&&x.mainsnak?.datavalue)?.mainsnak.datavalue.value;if(!c||distance(p,{lat:c.latitude,lng:c.longitude})>15)return null;return e;}
  if(p.qid){entity=await data(p.qid);if(!entity)return {status:'unverified',reason:'identity_mismatch'};p={...p,wiki:p.wiki||entity.sitelinks?.jawiki?.title||''};}
  let j={};try{j=await request('wiki',{...query,titles:titles(p).join('|')});}catch(e){if(!entity)throw e;deferredError=e;}let pages=j.query?.pages||[];
  // Redirects are accepted as exact identity only when the input title resolved to that page.
  const redirects=j.query?.redirects||[];if(p.wiki)for(const r of redirects)if(norm(r.from)===norm(p.wiki))p={...p,wiki:r.to};
  const choose=list=>{const ranked=list.map(a=>({a,s:articleScore(p,a)})).filter(x=>x.s>=0).sort((a,b)=>b.s-a.s);return ranked.length&&(!(ranked.length>1&&ranked[0].s-ranked[1].s<3)||ranked[0].s>=140)?ranked[0].a:null;};
  article=choose(pages);
  if(!article&&!entity){j=await request('wiki',{...query,generator:'search',gsrnamespace:'0',gsrlimit:'6',gsrsearch:p.name+' '+p.pref});article=choose(j.query?.pages||[]);}
  if(!article&&!entity){
   const search=await request('data',{action:'wbsearchentities',language:'ja',uselang:'ja',type:'item',limit:'5',search:p.name});
   const ids=(search.search||[]).filter(x=>titles(p).some(n=>norm(n)===norm(x.label)||norm(n)===norm(x.match?.text))).map(x=>x.id).filter(x=>/^Q[1-9]\d*$/.test(x));
   const found=[];for(const id of ids.slice(0,3)){const e=await data(id);if(e)found.push(e);}
   if(found.length===1)entity=found[0];
  }
  if(!article&&!entity)return {status:'unverified',reason:'place_not_resolved'};
  const qid=entity?.id||article?.pageprops?.wikibase_item;
  if(!entity&&qid)try{entity=await data(qid);}catch(e){deferredError=e;}
  entityFiles=(entity?.claims?.P18||[]).filter(x=>x.rank!=='deprecated').map(x=>x.mainsnak?.datavalue?.value).filter(Boolean).slice(0,3);
  const primary=[...entityFiles,article?.pageimage].filter(Boolean);let photos=(await files(primary,refresh)).map(f=>photo(f,p,article,entityFiles.some(n=>norm(n)===norm(fileName(f.title))))).filter(Boolean).sort((a,b)=>b.score-a.score);
  if(!photos.length&&article){const g=await request('wiki',{action:'query',prop:'images',imlimit:'40',titles:article.title});const fs=(g.query?.pages||[]).flatMap(x=>(x.images||[]).map(i=>i.title)).filter(f=>!REJECT.test(f));photos=(await files(fs,refresh)).map(f=>photo(f,p,article)).filter(Boolean).sort((a,b)=>b.score-a.score);}
  if(!photos.length&&qid){
   const structured=await request('commons',{action:'query',generator:'search',gsrnamespace:'6',gsrlimit:'6',gsrsearch:'haswbstatement:P180='+qid+' filetype:bitmap',prop:'imageinfo',iiprop:'url|extmetadata|mime|size',iiurlwidth:'500'});
   photos=(structured.query?.pages||[]).map(f=>photo(f,p,article,true)).filter(Boolean).sort((a,b)=>b.score-a.score);
  }
  if(!photos.length&&deferredError)throw deferredError;
  const identity={qid:qid||'',wiki:article?.title||p.wiki,lat:article?.coordinates?.[0]?.lat??p.lat,lng:article?.coordinates?.[0]?.lon??p.lng};
  return photos.length?{status:'ready',identity,photos:photos.slice(0,4)}:{status:'missing',reason:'no_verified_photo',identity};
 }
 async function resolve(input,{force=false}={}){const p=place(input),k='resolve:'+key(p);const old=await store.get(k).catch(()=>null);if(!force&&old?.until>now())return {...old.data,cached:true};if(flights.has(k))return flights.get(k);
  const work=(async()=>{try{const result=await resolveUncached(p,force);const data={...result,version:VERSION,fetchedAt:now(),expiresAt:now()+(result.status==='ready'?DAY:300000)};await store.set(k,{data,until:data.expiresAt,staleUntil:now()+(result.status==='ready'?7*DAY:300000)}).catch(()=>{});return data;}catch(e){if(old?.data?.status==='ready'&&old.staleUntil>now())return {...old.data,stale:true,retryAfter:e.retryAfter||60};throw e;}})();flights.set(k,work);try{return await work;}finally{flights.delete(k);}
 }
 return {resolve,files};
}
root.TabiroutePhotoCore={VERSION,DAY,text,norm,wikiTitle,place,key,titles,distance,fail,retrySeconds,imageURL,fileName,photo,articleScore,memoryStore,transport,resolver};
if(typeof module!=='undefined'&&module.exports)module.exports=root.TabiroutePhotoCore;
})(globalThis);
