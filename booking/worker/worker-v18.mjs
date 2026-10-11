// Standalone v18 Worker: paste the entire file into the existing Worker.
// v18: /shop-photos（お店自身の写真を OpenStreetMap・Wikimedia Commons・Wikipedia・Wikidata・公式サイトから探す）を追加
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
function titles(p){
 // 「八坂神社・祇園」「嵐山 竹林の小径」のような名前は、区切って1つずつ照合する（2文字の地名も試す。位置が15km以内のものだけ採用）
 const n=p.name,b=n.replace(/[（(][^）)]*[）)]/g,'').trim(),inside=n.match(/[（(]([^）)]+)[）)]/)?.[1];
 const parts=b.split(/[\s・／/、“”"]+/).filter(s=>s.length>=2);
 const cut=s=>s.replace(/(?:展望台|展望デッキ|展望館|ロープウェイ|ロープウェー|の町並み|の街並み|町並み|城下町|跡公園|本館)$/,'');
 return [...new Set([p.wiki,n,b,...parts.slice().reverse(),inside,...[b,...parts].map(cut)].filter(s=>s&&s.length>=2))].slice(0,10);}
function fail(code,retryAfter=60){return Object.assign(new Error(code),{code,retryAfter});}
function retrySeconds(v,now=Date.now()){const s=String(v||'');const n=/^\d+$/.test(s)?Number(s):Math.ceil((Date.parse(s)-now)/1000);return Number.isFinite(n)&&n>0?Math.min(86400,n):60;}
function imageURL(v){try{const u=new URL(v);return u.protocol==='https:'&&!u.username&&!u.password&&['upload.wikimedia.org','thumb.wikimedia.org'].includes(u.hostname)?u.href:'';}catch{return '';}}
function fileName(v){const f=String(v||'').replace(/^(?:File|ファイル):/,'').replace(/_/g,' ').trim();return f.length<=240&&!/[\u0000-\u001f/:\\]/.test(f)&&/\.(?:jpe?g|png|webp)$/i.test(f)?f:'';}
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
   // Cloudflare Workers は redirect:'error' を受け付けない（例外になり、写真が全件「通信エラー」になっていた）。manual で受けて転送は断る。
   let r,j;try{r=await fetcher(u.href,{headers,signal:AbortSignal.timeout(9000),redirect:'manual'});}catch{throw fail('provider_unavailable');}
   if(r.type==='opaqueredirect'||(r.status>=300&&r.status<400))throw fail('provider_bad_response',300);
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
  const choose=list=>{const ranked=list.map(a=>({a,s:articleScore(p,a)})).filter(x=>x.s>=0).sort((a,b)=>b.s-a.s||b.a.title.length-a.a.title.length);return ranked[0]?.a||null;}; // 候補はどれも名前が完全に一致し15km以内なので、近いもの（同点なら長い名前）を使う
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
/* Exact restaurant photos. Never substitute a generic dish or another branch. */
(function(root){'use strict';
const C=root.TabiroutePhotoCore,VERSION='food-photo-v2';
const NOT_FOOD=/外観|店内|店舗|入口|看板|建物|店構え|メニュー表|カップ麺|即席|袋麺|監修|パッケージ|シーサー|\b(?:exterior|interior|facade|entrance|building|sign|menu|instant|packaging|shisa|restaurant)\b/i;
const FOOD=/そば|蕎麦|うどん|ラーメン|らーめん|焼きそば|丼|寿司|すし|鮨|刺身|定食|カレー|餃子|ぎょうざ|おでん|お好み焼|たこ焼|タコライス|ステーキ|ハンバーグ|ハンバーガー|天ぷら|天麩羅|唐揚|焼肉|焼き鳥|やきとり|串カツ|鍋|煮込み|ぜんざい|かき氷|ケーキ|パフェ|ソフトクリーム|料理|食事|\b(?:soba|udon|ramen|noodles?|sushi|sashimi|curry|gyoza|oden|tempura|steak|burger|meal|dish|dessert|cake|parfait|taco\s*rice)\b/i;
function restaurant(o={}){
 const name=C.text(o.name),addr=C.text(o.addr||o.address),pref=C.text(o.pref),city=C.text(o.city);
 if(name.length<2||name.length>160||/[|:#<>\[\]{}"\\]/.test(name))throw C.fail('name_required',0);
 const lat=o.lat==null||o.lat===''?NaN:Number(o.lat),lng=o.lng==null||o.lng===''?NaN:Number(o.lng);
 const geo=Number.isFinite(lat)&&Number.isFinite(lng)&&lat>=20&&lat<=46&&lng>=122&&lng<=154;
 if(!addr&&!geo)throw C.fail('location_required',0);
 if(addr.length>240||pref.length>10||city.length>40)throw C.fail('invalid_request',0);
 return {name,addr,pref,city,...(geo?{lat:+lat.toFixed(5),lng:+lng.toFixed(5)}:{})};
}
// Remove only a descriptive prefix separated by a space. Branch names remain intact.
function searchName(p){return p.name.replace(/^(?:.+?の専門店|手打ちそば)\s+/,'');}
function address(v){return C.text(v).replace(/\s+/g,'').replace(/[‐−－]/g,'-').replace(/丁目|番地|番/g,'-').replace(/号(?=$|[^0-9])/g,'');}
function key(p){return JSON.stringify([VERSION,C.norm(p.name),address(p.addr)||[p.lat,p.lng],p.pref]);}
function photo(page,p){
 const file=C.fileName(page?.title),m=page?.imageinfo?.[0]?.extmetadata||{};
 const caption=C.text(m.ImageDescription?.value),all=file+' '+caption,n=searchName(p);
 if(!C.norm(caption+' '+file).includes(C.norm(n)))return null;
 // An exact street address or camera location is required: prefecture alone is insufficient.
 const addr=address(p.addr),addressMatch=addr.length>=8&&address(caption).includes(addr)&&!/[0-9]/.test(address(caption).split(addr)[1]?.[0]||'');
 const lat=m.GPSLatitude?.value,lng=m.GPSLongitude?.value;
 const near=lat!=null&&lng!=null&&p.lat!=null&&Number.isFinite(+lat)&&Number.isFinite(+lng)&&C.distance(p,{lat:+lat,lng:+lng})<0.3;
 if(!addressMatch&&!near)return null;
 const withoutName=all.split(n).join(' ').replace(/料理店|飲食店|そば屋|蕎麦屋|ラーメン店/g,' ');
 if(NOT_FOOD.test(all)||!FOOD.test(withoutName))return null;
 const found=C.photo(page,{name:n},null);return found?{...found,kind:'restaurant-dish',label:'料理写真',restaurant:p.name}:null;
}
// Independent, bounded lanes keep restaurant lookups from waiting for sightseeing photos.
function transport(options={}){const lanes=[C.transport({...options,gap:400}),C.transport({...options,gap:400})];let next=0;return {api:(...args)=>lanes[next++%lanes.length].api(...args)};}
function resolver({api,store=C.memoryStore(),now=Date.now}={}){
 const flights=new Map();
 async function resolve(input){
  const p=restaurant(input),k=key(p),old=await store.get(k).catch(()=>null);
  if(old?.until>now())return {...old.data,cached:true};
  if(flights.has(k))return flights.get(k);
  const work=(async()=>{
   // One request returns both search matches and licensed image metadata.
   const j=await api('commons',{action:'query',generator:'search',gsrnamespace:'6',gsrlimit:'8',gsrsearch:'"'+searchName(p)+'" filetype:bitmap',prop:'imageinfo',iiprop:'url|extmetadata|mime|size',iiurlwidth:'500'});
   const photos=(j.query?.pages||[]).map(f=>photo(f,p)).filter(Boolean).slice(0,2);
   const data={ok:true,version:VERSION,status:photos.length?'ready':'missing',restaurant:p,photos,fetchedAt:now(),expiresAt:now()+(photos.length?C.DAY:300000)};
   await store.set(k,{data,until:data.expiresAt,staleUntil:data.expiresAt}).catch(()=>{});return data;
  })();flights.set(k,work);try{return await work;}finally{flights.delete(k);}
 }
 return {resolve};
}
root.TabirouteFoodPhotoCore={VERSION,restaurant,searchName,address,key,photo,transport,resolver};
if(typeof module!=='undefined'&&module.exports)module.exports=root.TabirouteFoodPhotoCore;
})(globalThis);

/* お店自身の写真を、ホットペッパー以外のいろいろな方法でネットから探す（Worker で使う）。
   1) OpenStreetMap（Overpass）：お店の位置のまわりで店名が合う地点を探し、写真・Wikidata・公式サイトのタグを読む
   2) Wikimedia Commons：お店の近くで撮られた写真（位置情報つき）のうち、店名が写真名・説明にあるもの
   3) Wikipedia：お店の記事（記事の位置がお店から2km以内）の代表写真
   4) Wikidata：OpenStreetMap・Wikipedia から分かったお店の項目の写真と公式サイト
   5) 公式サイト：OpenStreetMap・Wikidata に載っている公式サイトの紹介用画像（og:image）
   名前だけでなく「位置」か「住所」でも同じお店か確かめる。別の支店・別のお店の写真は出さない。
   Commons の写真は作者・ライセンスを確認したものだけ。公式サイトの画像は出典（サイト名とリンク）を添えて、サイトから直接表示する。 */
(function(root){'use strict';
const VERSION='shop-photo-v1',DAY=86400000;
const OVERPASS=['https://overpass-api.de/api/interpreter','https://overpass.private.coffee/api/interpreter'];
function nameKey(s){return String(s||'').normalize('NFKC').toLowerCase().replace(/[ッっ]/g,'').replace(/ヴ/g,'ブ').replace(/[\s・ー‐\-－–（）()「」『』【】、。,.!！?？&＆'’"“”/／~〜]/g,'');}
const GENERIC=/^(?:本店|総本店|本舗|支店|分店|新館|別館|食堂|料理店|飲食店|ラーメン|らーめん|寿司|すし|鮨|そば|蕎麦|うどん|居酒屋|レストラン|カフェ|喫茶|珈琲|焼肉|中華|定食|手打ち?そば|手打ち?うどん)$/;
function branch(s){const m=String(s||'').normalize('NFKC').match(/([^\s　]+?(?:店|館))$/);return m&&!/^(?:本店|総本店)$/.test(m[1])?nameKey(m[1]):'';}
function nameMatch(a,b){
 const x=nameKey(a),y=nameKey(b);if(!x||!y)return false;if(x===y)return true;
 const strip=s=>s.replace(/(?:総本店|本店|本舗)$/,'');const xs=strip(x),ys=strip(y);
 if(xs.length<3||ys.length<3)return xs===ys;
 if(!(xs.includes(ys)||ys.includes(xs)))return false;
 const ba=branch(a),bb=branch(b);return !(ba&&bb&&ba!==bb&&!ba.includes(bb)&&!bb.includes(ba));
}
// 店名のうち、支店名や一般語を除いた特徴のある語（「中華食堂 桂苑」→「桂苑」）
function keyword(name){
 const t=String(name||'').normalize('NFKC').replace(/[（(][^）)]*[）)]/g,' ').split(/[\s　・]+/).map(w=>w.replace(/[+＋!！?？&＆'’"“”#＃*＊.,:;]/g,'')).filter(Boolean);
 const core=t.filter(w=>!GENERIC.test(w)&&!(t.length>1&&/(?:店|館)$/.test(w)&&w!==t[0]));
 const list=(core.length?core:t).filter(w=>w.length>=2);if(!list.length)return (t[0]||'').slice(0,40);
 const jp=w=>/[぀-ヿ㐀-鿿]/.test(w);
 const ja=list.filter(jp).sort((a,b)=>a.length-b.length),en=list.filter(w=>!jp(w)).sort((a,b)=>b.length-a.length);
 return (ja[0]||en[0]).slice(0,40);
}
// 店名が合う：表記ゆれを除いて同じ、または特徴のある語（2文字以上）が入っている
function sameShop(shop,other){const k=nameKey(keyword(shop));return nameMatch(shop,other)||(k.length>=2&&nameKey(other).includes(k));}
// 「〜の近くの道」「〜から見た景色」のように、店名は入っていてもお店を写していない写真は使わない
const BESIDE=/\b(?:near|nearby|next to|beside|opposite|in front of|across from|behind|around|view from|seen from|road to|way to|approach to)\b|付近|近く|周辺|向かい|の裏|の横|から見た|からの眺め|からの景色|への道|前の道|前の通り/i;
function aboutShop(pg){const m=pg.imageinfo?.[0]?.extmetadata||{};return !BESIDE.test(String(pg.title||'').replace(/_/g,' ')+' '+String(m.ImageDescription?.value||'').replace(/<[^>]*>/g,' '));}
function distance(a,b){const r=Math.PI/180,x=(b.lat-a.lat)*r,y=(b.lng-a.lng)*r,z=Math.sin(x/2)**2+Math.cos(a.lat*r)*Math.cos(b.lat*r)*Math.sin(y/2)**2;return 12742*Math.asin(Math.min(1,Math.sqrt(z)));}
function fail(code,retryAfter=60){return Object.assign(new Error(code),{code,retryAfter});}
function input(o={}){
 const text=v=>String(v||'').normalize('NFKC').replace(/\s+/g,' ').trim();
 const name=text(o.name),addr=text(o.addr||o.address),pref=text(o.pref);
 if(name.length<2||name.length>160||/[<>{}\\|]/.test(name))throw fail('name_required',0);
 const lat=Number(o.lat),lng=Number(o.lng);
 if(o.lat==null||o.lng==null||o.lat===''||o.lng===''||!Number.isFinite(lat)||!Number.isFinite(lng)||lat<20||lat>46||lng<122||lng>154)throw fail('location_required',0);
 if(addr.length>240||pref.length>10)throw fail('invalid_request',0);
 return {name,addr,pref,lat:+lat.toFixed(5),lng:+lng.toFixed(5),exact:o.exact!=='0'&&o.exact!==false,web:websiteURL(o.web)};
}
function cacheKey(p){return JSON.stringify([VERSION,nameKey(p.name),p.lat.toFixed(4),p.lng.toFixed(4),p.web||'']);}
// 公式サイトのURL：http(s)・ドメイン名つき・IPアドレスやローカルは使わない
function websiteURL(v){
 try{const u=new URL(String(v||'').trim());
  if(!['https:','http:'].includes(u.protocol)||u.username||u.password||u.port)return '';
  const h=u.hostname.toLowerCase();if(!h.includes('.')||/^[\d.]+$/.test(h)||h.includes(':')||/(^|\.)(localhost|local|internal|invalid|test)$/.test(h))return '';
  // SNS・予約サイト・地図は「お店の公式サイト」ではないので使わない
  if(/(^|\.)(instagram|facebook|twitter|x|tiktok|youtube|line|google|tabelog|hotpepper|retty|gnavi|ikyu|yelp|tripadvisor|ameblo)\.[a-z.]+$/.test(h)||h==='goo.gl')return '';
  u.hash='';return u.href.length<=300?u.href:'';}catch{return '';}
}
// og:image など、ページの紹介用画像を読む（ロゴ・アイコンらしいものは使わない）
function pageImage(html,base){
 const head=String(html||'').slice(0,200000),found=[];
 for(const m of head.matchAll(/<meta\b[^>]*>/gi)){
  const tag=m[0],prop=(tag.match(/\b(?:property|name|itemprop)\s*=\s*["']([^"']+)["']/i)||[])[1]||'',content=(tag.match(/\bcontent\s*=\s*["']([^"']+)["']/i)||[])[1]||'';
  if(/^(?:og:image(?::secure_url|:url)?|twitter:image(?::src)?|image)$/i.test(prop)&&content)found.push(content);
 }
 for(const m of head.matchAll(/<link\b[^>]*rel\s*=\s*["']image_src["'][^>]*>/gi)){const h=(m[0].match(/\bhref\s*=\s*["']([^"']+)["']/i)||[])[1];if(h)found.push(h);}
 for(const raw of found){
  let u;try{u=new URL(raw.replace(/&amp;/g,'&').trim(),base);}catch{continue;}
  if(u.protocol==='http:')u.protocol='https:';
  if(u.protocol!=='https:'||u.username||u.password)continue;
  if(/(?:^|[\/_\-.])(?:logo|favicon|icon|apple-touch|noimage|no_image|no-image|dummy|blank|spacer)(?:[\/_\-.]|$)/i.test(u.pathname))continue;
  if(/\.(?:svg|gif|ico)(?:$|\?)/i.test(u.pathname))continue;
  return u.href;
 }
 return '';
}
async function readText(r,max=600000){
 const reader=r.body?.getReader();if(!reader)return '';const dec=new TextDecoder();let out='',n=0;
 try{while(true){const {value,done}=await reader.read();if(done)break;n+=value.byteLength;out+=dec.decode(value,{stream:true});if(n>max||/<\/head>/i.test(out)){await reader.cancel().catch(()=>{});break;}}}finally{try{reader.releaseLock();}catch{}}
 return out;
}
function memoryStore(limit=300){const m=new Map();return {async get(k){return m.get(k)||null;},async set(k,v){m.delete(k);m.set(k,v);while(m.size>limit)m.delete(m.keys().next().value);}};}
function withTimeout(p,ms,fallback){let t;return Promise.race([p.catch(()=>fallback),new Promise(r=>{t=setTimeout(()=>r(fallback),ms);})]).finally(()=>clearTimeout(t));}

function resolver({api,fetcher=(...a)=>fetch(...a),store=memoryStore(),now=Date.now,ua='TabiroutePhoto/18.0 (https://tabiroute.github.io/)',photo}={}){
 const flights=new Map();
 const headers={'User-Agent':ua,'Accept':'application/json'};
 // Commons のファイル情報を確かめて、作者・ライセンスつきの写真にする
 async function commonsFiles(names){
  const fs=[...new Set(names.map(n=>String(n||'').replace(/^(?:File|ファイル):/i,'').replace(/_/g,' ').trim()).filter(n=>/\.(?:jpe?g|png|webp)$/i.test(n)))].slice(0,12);if(!fs.length)return [];
  const j=await api('commons',{action:'query',prop:'imageinfo',iiprop:'url|extmetadata|mime|size',iiurlwidth:'330',titles:fs.map(f=>'File:'+f).join('|')});
  return (j.query?.pages||[]).map(pg=>photo(pg,{name:'x'},null,true)).filter(Boolean);
 }
 async function overpass(p){
  const r=p.exact?150:400,q=`[out:json][timeout:8];nwr(around:${r},${p.lat},${p.lng})[name];out tags center 120;`;
  for(const host of OVERPASS){
   try{const res=await fetcher(host,{method:'POST',headers:{...headers,'Content-Type':'application/x-www-form-urlencoded'},body:'data='+encodeURIComponent(q),signal:AbortSignal.timeout(9000),redirect:'manual'});
    if(!res.ok)continue;const j=JSON.parse(await readText(res,2000000));
    return (j.elements||[]).map(e=>({e,lat:e.lat??e.center?.lat,lng:e.lon??e.center?.lon})).filter(x=>x.lat!=null&&distance(p,x)<=r/1000)
     .filter(x=>[x.e.tags?.name,x.e.tags?.['name:ja'],x.e.tags?.official_name,x.e.tags?.alt_name].filter(Boolean).some(n=>sameShop(p.name,n)))
     .sort((a,b)=>distance(p,a)-distance(p,b)).slice(0,3).map(x=>x.e.tags||{});
   }catch{}
  }
  return [];
 }
 async function commonsNear(p){
  const k=nameKey(keyword(p.name));if(k.length<2)return [];
  const j=await api('commons',{action:'query',generator:'geosearch',ggscoord:p.lat+'|'+p.lng,ggsradius:String(p.exact?200:500),ggsnamespace:'6',ggslimit:'60',prop:'imageinfo',iiprop:'url|extmetadata|mime|size',iiurlwidth:'330'});
  return (j.query?.pages||[]).filter(pg=>{const m=pg.imageinfo?.[0]?.extmetadata||{};return aboutShop(pg)&&nameKey(pg.title+' '+String(m.ImageDescription?.value||'').replace(/<[^>]*>/g,' ')).includes(k);}).map(pg=>photo(pg,{name:'x'},null,true)).filter(Boolean);
 }
 // 店名で Commons を探す：写真の位置がお店から300m以内か、説明にお店の住所（番地まで）があるものだけ
 async function commonsByName(p){
  const kw=keyword(p.name),k=nameKey(kw);if(k.length<2)return [];
  const j=await api('commons',{action:'query',generator:'search',gsrnamespace:'6',gsrlimit:'10',gsrsearch:'"'+kw+'" filetype:bitmap',prop:'imageinfo',iiprop:'url|extmetadata|mime|size',iiurlwidth:'330'});
  const addr=String(p.addr||'').normalize('NFKC').replace(/^(?:東京都|北海道|(?:京都|大阪)府|.{2,3}県)/,'').replace(/[\s　].*$/,'').replace(/丁目|番地|番|号/g,'-').replace(/[‐−－–ー]/g,'-').replace(/-+$/,'');
  return (j.query?.pages||[]).filter(pg=>{const m=pg.imageinfo?.[0]?.extmetadata||{},cap=String(m.ImageDescription?.value||'').replace(/<[^>]*>/g,' ');
   if(!aboutShop(pg)||!nameKey(pg.title+' '+cap).includes(k))return false;
   const lat=Number(m.GPSLatitude?.value),lng=Number(m.GPSLongitude?.value);
   if(Number.isFinite(lat)&&Number.isFinite(lng)&&m.GPSLatitude?.value!=null)return distance(p,{lat,lng})<0.3;
   const c=cap.normalize('NFKC').replace(/丁目|番地|番|号/g,'-').replace(/[‐−－–ー]/g,'-').replace(/\s+/g,'');
   return /\d/.test(addr)&&addr.length>=6&&c.includes(addr);
  }).map(pg=>photo(pg,{name:'x'},null,true)).filter(Boolean);
 }
 async function wikipedia(p){
  const kw=keyword(p.name);if(kw.length<2)return {photos:[],qids:[]};
  const j=await api('wiki',{action:'query',generator:'search',gsrsearch:kw,gsrlimit:'6',prop:'coordinates|pageimages|pageprops',piprop:'name',pilicense:'free',ppprop:'wikibase_item|disambiguation'});
  const pages=(j.query?.pages||[]).filter(pg=>!Object.prototype.hasOwnProperty.call(pg.pageprops||{},'disambiguation')).filter(pg=>{
   const t=pg.title.replace(/\s*[（(][^）)]*[）)]$/,''),c=pg.coordinates?.[0];
   return (nameKey(t)===nameKey(kw)||nameMatch(p.name,t))&&c&&distance(p,{lat:c.lat,lng:c.lon})<2;});
  return {photos:await commonsFiles(pages.map(pg=>pg.pageimage)),qids:pages.map(pg=>pg.pageprops?.wikibase_item).filter(q=>/^Q\d+$/.test(q||''))};
 }
 // Wikidata を店名で検索（ラベルが合う項目だけ。位置の確認は wikidata() で行う）
 async function wikidataSearch(p){
  const kw=keyword(p.name);if(kw.length<2)return [];
  const j=await api('data',{action:'wbsearchentities',language:'ja',uselang:'ja',type:'item',limit:'7',search:kw});
  return (j.search||[]).filter(x=>/^Q\d+$/.test(x.id||'')&&[x.label,x.match?.text].filter(Boolean).some(t=>nameKey(t)===nameKey(kw)||nameMatch(p.name,t))).map(x=>x.id).slice(0,3);
 }
 async function wikidata(p,qids,trusted){
  const ids=[...new Set(qids)].slice(0,4);if(!ids.length)return {photos:[],sites:[]};
  const j=await api('data',{action:'wbgetentities',ids:ids.join('|'),props:'claims'});
  const files=[],sites=[];
  for(const id of ids){const e=j.entities?.[id];if(!e||e.missing!==undefined)continue;
   const v=pid=>(e.claims?.[pid]||[]).filter(x=>x.rank!=='deprecated').map(x=>x.mainsnak?.datavalue?.value).filter(Boolean);
   const c=v('P625')[0],near=c?distance(p,{lat:c.latitude,lng:c.longitude})<2:trusted.has(id);if(!near)continue;
   files.push(...v('P18').slice(0,2));sites.push(...v('P856').slice(0,2));}
  return {photos:await commonsFiles(files),sites};
 }
 async function official(site){
  const url=websiteURL(site);if(!url)return null;
  const tries=[url.replace(/^http:/,'https:'),url].filter((x,i,a)=>a.indexOf(x)===i);
  for(const start of tries){
   let next=start,res;
   for(let hop=0;hop<4;hop++){
    try{res=await fetcher(next,{headers:{'User-Agent':ua,'Accept':'text/html,application/xhtml+xml'},redirect:'manual',signal:AbortSignal.timeout(6000)});}catch{res=null;break;}
    if(res.status>=300&&res.status<400){const loc=websiteURL(new URL(res.headers.get('Location')||'',next).href);if(!loc)break;next=loc;continue;}
    break;
   }
   if(!res||!res.ok||!/text\/html|application\/xhtml/i.test(res.headers.get('Content-Type')||''))continue;
   const img=pageImage(await readText(res),next);if(!img)continue;
   // 画像として読めるか確かめる（大きすぎ・小さすぎ・画像でないものは使わない）
   try{const r=await fetcher(img,{headers:{'User-Agent':ua,'Accept':'image/*'},redirect:'follow',signal:AbortSignal.timeout(6000)});
    const type=r.headers.get('Content-Type')||'',len=Number(r.headers.get('Content-Length')||0);try{await r.body?.cancel();}catch{}
    if(!r.ok||!/^image\/(?:jpeg|png|webp)/i.test(type)||(len&&(len<6000||len>8000000)))continue;
   }catch{continue;}
   const host=new URL(next).hostname.replace(/^www\./,'');
   return {src:img,kind:'official',label:'公式サイトの写真',credit:'出典：'+host+'（公式サイト）',page:next,site:host};
  }
  return null;
 }
 async function resolveUncached(p){
  const [osm,near,named,wp,wds]=await Promise.all([withTimeout(overpass(p),10000,[]),withTimeout(commonsNear(p),9000,[]),withTimeout(commonsByName(p),9000,[]),withTimeout(wikipedia(p),9000,{photos:[],qids:[]}),withTimeout(wikidataSearch(p),8000,[])]);
  const tagFiles=[],trusted=new Set(),qids=[...wp.qids,...wds],sites=p.web?[p.web]:[]; // 確認済みの公式サイトを最優先
  for(const t of osm){
   for(const v of [t.wikimedia_commons,t.image])if(v&&/^(?:File:|https:\/\/(?:commons\.wikimedia\.org\/wiki\/File:|upload\.wikimedia\.org\/))/i.test(v))tagFiles.push(decodeURIComponent(String(v).split('/').pop().replace(/^File:/i,'')));
   if(/^Q\d+$/.test(t.wikidata||'')){qids.push(t.wikidata);trusted.add(t.wikidata);}
   for(const w of [t.website,t['contact:website'],t.url])if(websiteURL(w))sites.push(w);
  }
  const [tagPhotos,wd]=await Promise.all([withTimeout(commonsFiles(tagFiles),8000,[]),withTimeout(wikidata(p,qids,trusted),8000,{photos:[],sites:[]})]);
  sites.push(...wd.sites);
  const free=[...tagPhotos,...wd.photos,...near,...named,...wp.photos];
  const seen=new Set(),photos=[];
  for(const f of free){if(seen.has(f.file))continue;seen.add(f.file);photos.push({...f,kind:'shop-free',label:'お店の写真'});}
  let site=null;
  if(photos.length<2)for(const s of [...new Set(sites)].slice(0,2)){site=await withTimeout(official(s),14000,null);if(site)break;}
  if(site)photos.push(site);
  return {status:photos.length?'ready':'missing',photos:photos.slice(0,3),website:websiteURL(sites[0])||'',sources:{osm:osm.length,commonsNear:near.length,commonsName:named.length,wikipedia:wp.photos.length,wikidata:wd.photos.length,official:site?1:0}};
 }
 async function resolve(o){
  const p=input(o),k=cacheKey(p),old=await store.get(k).catch(()=>null);
  if(old?.until>now())return {...old.data,cached:true};
  if(flights.has(k))return flights.get(k);
  const work=(async()=>{const r=await resolveUncached(p);const data={ok:true,version:VERSION,...r,fetchedAt:now(),expiresAt:now()+(r.photos.length?7*DAY:DAY)};
   await store.set(k,{data,until:data.expiresAt,staleUntil:data.expiresAt}).catch(()=>{});return data;})();
  flights.set(k,work);try{return await work;}finally{flights.delete(k);}
 }
 return {resolve};
}
root.TabirouteShopPhotoCore={VERSION,aboutShop,nameKey,nameMatch,keyword,sameShop,distance,input,cacheKey,websiteURL,pageImage,resolver,memoryStore};
if(typeof module!=='undefined'&&module.exports)module.exports=root.TabirouteShopPhotoCore;
})(globalThis);

const C=globalThis.TabiroutePhotoCore;
const runtimes=new Map(), imageFlights=new Map(), limits=new Map();
function json(data,status=200,origin='',retry=0){return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...(origin?{'Access-Control-Allow-Origin':origin,Vary:'Origin','Access-Control-Expose-Headers':'Retry-After'}:{}),...(retry?{'Retry-After':String(retry)}:{})}});}
function cacheStore(base){const memory=C.memoryStore(350);return {async get(k){const m=await memory.get(k);if(m)return m;try{const r=await globalThis.caches?.default?.match(new Request(base+'/_photo-cache/'+C.VERSION+'?k='+encodeURIComponent(k)));return r?await r.json():null;}catch{return null;}},async set(k,v){await memory.set(k,v);try{await globalThis.caches?.default?.put(new Request(base+'/_photo-cache/'+C.VERSION+'?k='+encodeURIComponent(k)),new Response(JSON.stringify(v),{headers:{'Content-Type':'application/json','Cache-Control':'public,max-age='+Math.max(1,Math.ceil((v.staleUntil-Date.now())/1000))}}));}catch{}},async delete(k){await memory.delete(k);try{await globalThis.caches?.default?.delete(new Request(base+'/_photo-cache/'+C.VERSION+'?k='+encodeURIComponent(k)));}catch{}}};}
function runtime(base,env){if(!runtimes.has(base)){const store=cacheStore(base);let contact='https://tabiroute.github.io/';try{const u=new URL(env.SITE_URL||contact);if(u.protocol==='https:'&&!u.username&&!u.password)contact=u.origin+u.pathname;}catch{}const t=C.transport({store,headers:{'User-Agent':'TabiroutePhoto/10.0 ('+contact+')','Accept':'application/json'}});runtimes.set(base,{...C.resolver({api:t.api,store}),shop:globalThis.TabirouteShopPhotoCore.resolver({api:t.api,store,photo:C.photo,ua:'TabiroutePhoto/18.0 ('+contact+')'}),food:globalThis.TabirouteFoodPhotoCore.resolver({api:globalThis.TabirouteFoodPhotoCore.transport({store,headers:{'User-Agent':'TabiroutePhoto/17.0 ('+contact+')','Accept':'application/json'}}).api,store}),store});if(runtimes.size>5)runtimes.delete(runtimes.keys().next().value);}return runtimes.get(base);}
function rate(request){const ip=request.headers.get('CF-Connecting-IP')||'unknown',bucket=Math.floor(Date.now()/60000),old=limits.get(ip),count=old?.bucket===bucket?old.count+1:1;limits.set(ip,{bucket,count});if(limits.size>2000)for(const[k,v]of limits)if(v.bucket!==bucket)limits.delete(k);if(count>90)throw C.fail('client_limited',60);}
async function readBytes(r){if(!/^image\/(jpeg|png|webp)(?:;|$)/i.test(r.headers.get('Content-Type')||''))throw C.fail('image_invalid');const max=4*1024*1024;if(Number(r.headers.get('Content-Length'))>max)throw C.fail('image_too_large',300);const reader=r.body?.getReader();if(!reader)throw C.fail('image_invalid');const chunks=[];let n=0;try{while(true){const {value,done}=await reader.read();if(done)break;n+=value.byteLength;if(n>max){await reader.cancel();throw C.fail('image_too_large',300);}chunks.push(value);}}finally{reader.releaseLock();}const bytes=new Uint8Array(n);let off=0;for(const b of chunks){bytes.set(b,off);off+=b.length;}const jpeg=bytes[0]===255&&bytes[1]===216,png=bytes[0]===137&&bytes[1]===80&&bytes[2]===78&&bytes[3]===71,webp=String.fromCharCode(...bytes.slice(0,4))==='RIFF'&&String.fromCharCode(...bytes.slice(8,12))==='WEBP';if(!jpeg&&!png&&!webp)throw C.fail('image_invalid');return {bytes,type:jpeg?'image/jpeg':png?'image/png':'image/webp'};}
export async function photoRoute(request,env,ctx){const u=new URL(request.url),origin=request.headers.get('Origin')||'',rt=runtime(u.origin,env);
 try{
  if(u.pathname==='/food-photos'){
   rate(request);const result=await rt.food.resolve(Object.fromEntries(u.searchParams));
   return json({...result,photos:(result.photos||[]).map(p=>({...p,remote:p.src,src:u.origin+'/photo-image?file='+encodeURIComponent(p.file)}))},200,origin);
  }
  if(u.pathname==='/shop-photos'){
   rate(request);const result=await rt.shop.resolve(Object.fromEntries(u.searchParams));
   // Commons の写真は写真プロキシ経由でも読めるようにする（公式サイトの画像はサイトから直接表示）
   return json({...result,photos:(result.photos||[]).map(p=>p.kind==='official'?p:({...p,remote:p.src,src:u.origin+'/photo-image?file='+encodeURIComponent(p.file)}))},200,origin);
  }
  if(u.pathname==='/photos'){
   rate(request);const p=C.place({name:u.searchParams.get('name'),lat:u.searchParams.get('lat'),lng:u.searchParams.get('lng'),wiki:u.searchParams.get('wiki'),qid:u.searchParams.get('qid'),pref:u.searchParams.get('pref')});const result=await rt.resolve(p,{force:u.searchParams.get('refresh')==='1'});
   return json({ok:true,...result,photos:(result.photos||[]).map(p=>({...p,remote:p.src,src:u.origin+'/photo-image?file='+encodeURIComponent(p.file)}))},200,origin);
  }
  const file=C.fileName(u.searchParams.get('file'));if(!file)throw C.fail('invalid_file',0);
  const key=new Request(u.origin+'/photo-image?file='+encodeURIComponent(file));let hit;try{hit=await globalThis.caches?.default?.match(key);}catch{}
  if(hit)return imageResponse(hit,origin);
  rate(request);let task=imageFlights.get(key.url);
  if(!task){task=(async()=>{
   const rows=await rt.files([file]);const verified=rows.map(p=>C.photo(p,{name:file},{pageimage:file},true)).find(Boolean);if(!verified)throw C.fail('photo_not_licensed',300);
   let decoded;
   for(const url of [...new Set([verified.src,verified.orig])]){
    // 転送はウィキメディアの画像サーバー内だけ、3回まで自分でたどる（Workers は redirect:'error' 非対応）
    let r,next=url;
    for(let hop=0;hop<4;hop++){
     try{r=await fetch(next,{redirect:'manual',headers:{'User-Agent':'TabiroutePhoto/10.0 ('+(env.SITE_URL||'https://tabiroute.github.io/')+')'},signal:AbortSignal.timeout(12000)});}catch{throw C.fail('provider_unavailable');}
     if(r.status<300||r.status>=400)break;
     const loc=C.imageURL(new URL(r.headers.get('Location')||'',next).href);if(!loc||hop===3)throw C.fail('image_invalid',300);next=loc;
    }
    if(r.status===429||r.status===503)throw C.fail('provider_limited',C.retrySeconds(r.headers.get('Retry-After')));
    if(r.status===404)continue;if(!r.ok)throw C.fail('provider_unavailable');decoded=await readBytes(r);break;
   }
   if(!decoded)throw C.fail('image_missing',300);
   const result=new Response(decoded.bytes,{headers:{'Content-Type':decoded.type,'Cache-Control':'public,max-age=86400','X-Content-Type-Options':'nosniff'}});
   if(globalThis.caches?.default)ctx.waitUntil(globalThis.caches.default.put(key,result.clone()).catch(()=>{}));return result;
  })();imageFlights.set(key.url,task);task.finally(()=>imageFlights.delete(key.url)).catch(()=>{});}
  return imageResponse((await task).clone(),origin);
 }catch(e){const code=e.code||'provider_unavailable',status=/required|invalid_file|invalid_request/.test(code)?400:/limited/.test(code)?429:503,retry=e.retryAfter??60;return json({ok:false,version:C.VERSION,code,retryAfter:retry},status,origin,retry);}
}
function imageResponse(r,origin){const h=new Headers(r.headers);h.set('Access-Control-Allow-Origin',origin||'*');h.set('Vary','Origin');h.set('Access-Control-Expose-Headers','Retry-After');return new Response(r.body,{status:r.status,headers:h});}

/* たびルート：無料API専用プロキシ。DB/KV/有料サービスへの依存なし。 */
const VERSION = 'booking-v18';
const KNOWN_FAULT = Symbol('booking-fault');
const TTL = {hotels:3600, restaurants:3600, availability:60};
const circuits = new Map();
const authReasons = new Map();
const ipWindows = new Map();
// ---- origin guard (v1) --------------------------------------------------------
// 1) /health 以外は、許可したサイトの Origin が付いた呼び出しだけ受け付ける。
//    <img> で読む /photo-image だけは Origin が付かないため、Referer が許可サイトなら通す。
// 2) 宿・お店・空室の検索は、1つの実行環境あたり1分60回（キャッシュに無いものだけ数える）。
//    IPを変えながら大量に叩かれても、楽天・ホットペッパーの上限を使い切られないための上限。
const GUARD_VERSION='origin-guard-v1',GUARD_BURST=60,GUARD_PATHS=new Set(['/hotels','/restaurants','/availability']);
let guardWindow={bucket:0,count:0};
function refererOrigin(request){try{return new URL(request.headers.get('Referer')||'').origin}catch{return ''}}
function guardBurst(){const bucket=Math.floor(Date.now()/60000);if(guardWindow.bucket!==bucket)guardWindow={bucket,count:0};guardWindow.count++;if(guardWindow.count>GUARD_BURST)throw fault('client_limited',429,30,{stage:'origin_guard',reason:'burst_limit'});}
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
    const q=text(s.get('q'));if(q&&q.length<2)throw fault('invalid_request',400,0);if(q)return {q};
    // 探す半径（km、0.5〜3.0）と、楽天の絞り込み条件（禁煙・Wi-Fi・大浴場・温泉）
    const rs=s.get('r');let r='3';if(rs!==null&&rs!==''){const n=Number(rs);if(!Number.isFinite(n)||n<0.5||n>3)throw fault('invalid_request',400,0);r=(Math.round(n*10)/10).toFixed(1);}
    const cond=String(s.get('cond')||'');if(cond&&!/^(kinen|internet|daiyoku|onsen)(,(kinen|internet|daiyoku|onsen)){0,3}$/.test(cond))throw fault('invalid_request',400,0);
    // 日程と人数があるときは、その日に空室がある宿と、その日の料金を返す（楽天の空室検索）
    let stay={};if(s.get('checkin')||s.get('checkout')){const ci=date(s.get('checkin')),co=date(s.get('checkout'));const today=new Date(Date.now()+9*3600000).toISOString().slice(0,10),days=(Date.parse(co)-Date.parse(ci))/86400000;if(ci<today||days<1||days>30||(Date.parse(ci)-Date.parse(today))/86400000>400)throw fault('invalid_dates',400,0);stay={checkin:ci,checkout:co,adults:int(s.get('adults'),1,10,1),rooms:int(s.get('rooms'),1,10,1)};}
    return {lat:coord(s.get('lat'),20,46),lng:coord(s.get('lng'),122,154),r,...(cond?{cond:[...new Set(cond.split(','))].sort().join(',')}:{}),...stay};
  }
  if(path==='/restaurants'){const id=text(s.get('id'),10);if(id&&!/^J\d{9}$/.test(id))throw fault('invalid_request',400,0);if(id)return {id};const genre=String(s.get('genre')||'');if(genre&&!/^G0(0[1-9]|1[0-7])$/.test(genre))throw fault('invalid_request',400,0);
    // 店名で県全体を探す（観光ルートから離れたお店も）：サービスエリアコード（最大3つ）と言葉が必須
    const sa=String(s.get('sa')||'');if(sa&&!id){if(!/^SA\d{2}(,SA\d{2}){0,2}$/.test(sa))throw fault('invalid_request',400,0);const q=text(s.get('q'));if(q.length<2)throw fault('invalid_request',400,0);return {sa,q,genre};}
    return {...(id?{id}:{}),lat:coord(s.get('lat'),20,46),lng:coord(s.get('lng'),122,154),q:text(s.get('q')),cafe:s.get('cafe')==='1',genre,range:int(s.get('range'),1,5,5)};}
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
// 楽天の設備情報（responseType=large）を、短い文字の一覧にする（最大40件・各40文字まで）
function hotelFacilities(a){
  const f=a.find(v=>v&&v.hotelFacilitiesInfo)?.hotelFacilitiesInfo;if(!f)return [];
  const out=[];const add=v=>{if(Array.isArray(v))v.forEach(add);else if(v&&typeof v==='object')Object.values(v).forEach(add);else if(typeof v==='string'&&v.trim())out.push(v.trim().slice(0,40));};
  for(const k of ['roomFacilities','hotelFacilities','bathType','aboutBath']){add(f[k]);}
  return [...new Set(out)].slice(0,40);
}
// 空室検索のプランと料金（1泊目）。chargeFlag 1＝1室あたり、0＝1人あたり（1室の人数を掛けて1室あたりにする）。料金がはっきりしないときは出さない
function planCharge(c,adults){
  const v=Number(c?.rakutenCharge),f=String(c?.chargeFlag);if(!(v>0)||!['0','1'].includes(f))return null;
  const perRoom=f==='1'?v:(adults>0?v*adults:null);return {perRoom,perPerson:f==='0'?v:null,date:String(c.stayDate||''),flag:Number(f)};
}
function hotelPlans(a,adults){
  const out=[];
  for(const part of a)for(const list of [asArray(part?.roomInfo)]){let cur=null;
    for(const block of list){
      if(block?.roomBasicInfo){const r=block.roomBasicInfo;cur={name:String(r.planName||r.roomName||'宿泊プラン').slice(0,80),room:String(r.roomName||'').slice(0,60),url:safeURL(r.reserveUrl,'rakuten'),breakfast:String(r.withBreakfastFlag)==='1',dinner:String(r.withDinnerFlag)==='1',price:null};out.push(cur);}
      else if(block?.dailyCharge&&cur&&!cur.price)cur.price=planCharge(block.dailyCharge,adults);
    }}
  return out.filter(x=>x.url).sort((a,b)=>(a.price?.perRoom??1e12)-(b.price?.perRoom??1e12)).slice(0,3);
}
export function normalizeHotels(j,adults=0){
  return (j.hotels||[]).flatMap(x=>{
    const a=Array.isArray(x.hotel)?x.hotel:[x.hotel||x];const b=a.find(v=>v.hotelBasicInfo)?.hotelBasicInfo;
    if(!b||!/^\d+$/.test(String(b.hotelNo))||!b.hotelName)return [];
    const lat=Number(b.latitude),lng=Number(b.longitude);if(!Number.isFinite(lat)||!Number.isFinite(lng)||lat<20||lat>46||lng<122||lng>154)return [];
    return [{id:String(b.hotelNo),name:String(b.hotelName),lat,lng,address:String(b.address1||'')+String(b.address2||''),photo:safeURL(b.hotelImageUrl||b.hotelThumbnailUrl,'rakuten'),url:safeURL(b.hotelInformationUrl,'rakuten'),planUrl:safeURL(b.planListUrl,'rakuten'),minCharge:Number(b.hotelMinCharge)>0?Number(b.hotelMinCharge):null,rating:Number(b.reviewAverage)>0?Number(b.reviewAverage):null,reviewCount:Number(b.reviewCount)||0,access:String(b.access||''),parking:String(b.parkingInformation||''),facilities:hotelFacilities(a),...(adults?(()=>{const plans=hotelPlans(a,adults),ps=plans.map(x=>x.price?.perRoom).filter(v=>v>0);return {plans,price:ps.length?Math.min(...ps):null};})():{})}];
  }).slice(0,30);
}
export function normalizeRestaurants(j){
  return (j.results?.shop||[]).flatMap(s=>{
    const lat=Number(s.lat),lng=Number(s.lng);if(!/^J\d+$/.test(s.id)||!s.name||!Number.isFinite(lat)||!Number.isFinite(lng))return [];
    return [{id:s.id,name:String(s.name),lat,lng,address:String(s.address||''),genre:String(s.genre?.name||''),catch:String(s.catch||''),budget:String(s.budget?.average||''),budgetBand:String(s.budget?.name||''),genreCode:String(s.genre?.code||''),hours:String(s.open||''),closed:String(s.close||''),lunch:String(s.lunch||''),photo:safeURL(s.photo?.pc?.l||s.photo?.pc?.m||s.photo?.pc?.s||s.photo?.mobile?.l,'hotpepper'),url:safeURL(s.urls?.pc,'hotpepper')}];
  });
}
const asArray=value=>Array.isArray(value)?value:value&&typeof value==='object'?[value]:[];
export function availabilityResult(j,hotelNo,adults=0){
  const plans=[];let matched=false,roomCount=0,missingLinks=0,rejectedLinks=0,facilityUrl='';
  for(const wrapped of asArray(j.hotels)){
    const parts=asArray(wrapped.hotel||wrapped);
    const basic=parts.find(p=>p.hotelBasicInfo)?.hotelBasicInfo;
    if(String(basic?.hotelNo)!==String(hotelNo))continue;
    matched=true;
    facilityUrl=facilityUrl||safeURL(basic.planListUrl,'rakuten')||safeURL(basic.hotelInformationUrl,'rakuten');
    for(const part of parts){
      let last=null;
      for(const block of asArray(part.roomInfo)){
        // 料金（dailyCharge）は、すぐ前のプラン（roomBasicInfo）のもの
        if(block.dailyCharge){if(last&&!last.price){const c=planCharge(block.dailyCharge,adults);if(c)last.price=c;}continue;}
        const room=block.roomBasicInfo;if(!room)continue;
        roomCount++;last=null;
        const url=safeURL(room.reserveUrl,'rakuten');
        if(!url){if(room.reserveUrl)rejectedLinks++;else missingLinks++;continue;}
        last={name:String(room.planName||room.roomName||'宿泊プラン'),room:String(room.roomName||''),url,breakfast:String(room.withBreakfastFlag)==='1',dinner:String(room.withDinnerFlag)==='1'};plans.push(last);
      }
    }
  }
  const items=[...new Map(plans.map(p=>[p.url,p])).values()].sort((a,b)=>(a.price?.perRoom??1e12)-(b.price?.perRoom??1e12)).slice(0,8);   // 安い順
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
  // 400（条件の誤り）はその検索だけの問題なので、ほかの利用者の検索は止めない
  if(r.status===400)throw fault('invalid_request',400,0,{...detail,reason:String(j?.error||'').slice(0,40)});
  if(!r.ok){circuits.set(provider,Date.now()+60000);throw fault('provider_unavailable',503,60,detail);}
  if(j.error){if(j.error==='not_found')return {hotels:[]};const limited=/too_many|rate|limit/i.test(j.error);circuits.set(provider,Date.now()+300000);throw fault(limited?'provider_limited':'provider_config',503,300,{...detail,stage:'provider_error'});}
  if(j.results?.error){const e=[].concat(j.results.error)[0];circuits.set(provider,Date.now()+300000);throw fault(String(e?.code)==='2000'?'provider_config':'provider_unavailable',503,300,{...detail,stage:'provider_error'});}
  return j;
}
async function query(path,p,env){
  if(path==='/restaurants'){
    if(!env.HOTPEPPER_API_KEY)throw fault('not_configured',503,1800);
    const u=new URL('https://webservice.recruit.co.jp/hotpepper/gourmet/v1/');
    u.search=new URLSearchParams({key:env.HOTPEPPER_API_KEY,format:'json',...(p.id?{id:p.id}:p.sa?{service_area:p.sa,keyword:p.q,...(p.genre?{genre:p.genre}:{})}:{lat:p.lat,lng:p.lng,range:p.range,...(p.genre?{genre:p.genre}:p.cafe?{genre:'G014'}:{}),...(p.q?{keyword:p.q}:{})}),count:'20',order:p.sa?'4':'1'});   // 県全体を店名・料理名で探すときは「おすすめ順」（位置で探すときは距離順になる）
    return {items:normalizeRestaurants(await upstream('hotpepper',u)),provider:'hotpepper'};
  }
  const credentials=rakutenCredentials(env);
  const vacant=path==='/hotels'&&!p.q&&!!p.checkin;
  const endpoint=path==='/availability'||vacant?'VacantHotelSearch/20170426':p.q?'KeywordHotelSearch/20260731':'SimpleHotelSearch/20260731';
  const u=new URL('https://openapi.rakuten.co.jp/engine/api/Travel/'+endpoint);
  // 場所で探すときは設備（部屋の設備・館内の設備）も受け取る（バス・トイレ別などの確認に使う）
  const params={applicationId:credentials.appId,format:'json',formatVersion:'1',datumType:'1',responseType: path==='/availability'||(!p.q&&path==='/hotels')?'large':'middle',hits:'20'};
  if(credentials.affiliateId)params.affiliateId=credentials.affiliateId;
  if(path==='/availability')Object.assign(params,{hotelNo:p.hotelNo,checkinDate:p.checkin,checkoutDate:p.checkout,adultNum:p.adults,roomNum:p.rooms,searchPattern:'1'});
  else if(p.q)params.keyword=p.q;
  else Object.assign(params,{latitude:p.lat,longitude:p.lng,searchRadius:p.r||'3',...(p.cond?{squeezeCondition:p.cond}:{}),...(vacant?{checkinDate:p.checkin,checkoutDate:p.checkout,adultNum:p.adults,roomNum:p.rooms,searchPattern:'0',hits:'30',sort:'+roomCharge'}:{})});   // 安い順：宿ごとに返る3プランも安いものになる
  u.search=new URLSearchParams(params);
  const j=await upstream('rakuten',u,credentials.headers);
  if(path==='/availability')return {...availabilityResult(j,p.hotelNo,p.adults),provider:'rakuten',conditions:p,bookingLinksConfigured:!!credentials.affiliateId};
  return {items:normalizeHotels(j,vacant?p.adults:0),provider:'rakuten',...(p.cond?{cond:p.cond}:{}),...(p.r?{radius:Number(p.r)}:{}),...(vacant?{vacant:true,stay:{checkin:p.checkin,checkout:p.checkout,adults:p.adults,rooms:p.rooms}}:{})};
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
// ===== 公共交通オープンデータ（ODPT）: 飛行機の時刻表と、鉄道の直通列車の時刻 =====
// アクセストークンは Cloudflare の環境変数 ODPT_TOKEN（シークレット）に入れる。ブラウザには出さない。
// 使うデータは「公共交通オープンデータ基本ライセンス」と CC BY 4.0 のものだけ（チャレンジ限定のデータは使わない）。
const ODPT_VERSION='odpt-v1';
const ODPT_BASE='https://api.odpt.org/api/v4/',ODPT_PUBLIC='https://api-public.odpt.org/api/v4/';
// 鉄道：列車時刻表が公開されている事業者。pub=true はキー不要の公開API（CC BY 4.0）
const ODPT_RAIL=[
 // box：その事業者の駅がある範囲（南, 西, 北, 東）。範囲外の問い合わせでは、駅の一覧を読み込まない（処理を軽くする）
 {op:'Toei',name:'都営地下鉄',pub:true,credit:'東京都交通局',box:[35.57,139.59,35.81,139.96]},
 {op:'TokyoMetro',name:'東京メトロ',box:[35.59,139.59,35.81,139.98]},
 {op:'TWR',name:'りんかい線',box:[35.59,139.69,35.67,139.83]},
 {op:'MIR',name:'つくばエクスプレス',box:[35.68,139.75,36.10,140.13]},
 {op:'TamaMonorail',name:'多摩モノレール',box:[35.61,139.36,35.77,139.49]},
 {op:'YokohamaMunicipal',name:'横浜市営地下鉄',box:[35.32,139.46,35.59,139.67]}
];
const odptInBox=(x,p)=>p.lat>=x.box[0]&&p.lng>=x.box[1]&&p.lat<=x.box[2]&&p.lng<=x.box[3];
const ODPT_AIRLINES=['JAL','ANA'];
const ODPT_IATA=/^[A-Z]{3}$/;
const odptMem=new Map();
const odptWindows=new Map();
function odptRate(request){const ip=request.headers.get('CF-Connecting-IP')||'unknown',bucket=Math.floor(Date.now()/60000),old=odptWindows.get(ip),count=old?.bucket===bucket?old.count+1:1;odptWindows.set(ip,{bucket,count});if(odptWindows.size>2000)for(const[k,v]of odptWindows)if(v.bucket!==bucket)odptWindows.delete(k);if(count>90)throw fault('client_limited',429,60);}

// ---- 日付：曜日と祝日（鉄道の「平日／土休日」ダイヤの判定に使う） ----
function odptDate(s){if(!/^\d{4}-\d{2}-\d{2}$/.test(s||''))return null;const d=new Date(s+'T12:00:00Z');return Number.isFinite(+d)&&d.toISOString().slice(0,10)===s?d:null;}
function odptNthMonday(y,m,n){const first=new Date(Date.UTC(y,m-1,1,12)).getUTCDay();return 1+((8-first)%7)+(n-1)*7;}
function odptHolidaySet(y){
 const s=new Set(),add=(m,d)=>s.add(`${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`);
 add(1,1);add(1,odptNthMonday(y,1,2));add(2,11);add(2,23);
 add(3,Math.floor(20.8431+0.242194*(y-1980)-Math.floor((y-1980)/4)));
 add(4,29);add(5,3);add(5,4);add(5,5);add(7,odptNthMonday(y,7,3));add(8,11);add(9,odptNthMonday(y,9,3));
 add(9,Math.floor(23.2488+0.242194*(y-1980)-Math.floor((y-1980)/4)));add(10,odptNthMonday(y,10,2));add(11,3);add(11,23);
 // 振替休日（日曜の祝日の次の平日）と国民の休日（祝日にはさまれた日）
 const day=d=>new Date(d+'T12:00:00Z'),iso=d=>d.toISOString().slice(0,10);
 for(const h of [...s].sort()){if(day(h).getUTCDay()===0){let n=day(h);do n=new Date(+n+86400000);while(s.has(iso(n)));s.add(iso(n));}}
 for(const h of [...s].sort()){const n2=iso(new Date(+day(h)+2*86400000)),n1=iso(new Date(+day(h)+86400000));if(s.has(n2)&&!s.has(n1)&&day(n1).getUTCDay()!==0)s.add(n1);}
 return s;
}
function odptDayType(date){
 const d=odptDate(date);if(!d)return null;const w=d.getUTCDay(),md=date.slice(5);
 // 年末年始（12/30〜1/3）は多くの鉄道が休日ダイヤ
 if(w===0||odptHolidaySet(d.getUTCFullYear()).has(date)||md>='12-30'||md<='01-03')return 'holiday';
 return w===6?'saturday':'weekday';
}
const ODPT_WEEK=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
function odptCalendarRank(cal,date){
 const c=String(cal||'').replace(/^odpt\.Calendar:/,''),t=odptDayType(date),w=ODPT_WEEK[odptDate(date).getUTCDay()];
 if(c===w)return 0;
 const pref={weekday:['Weekday'],saturday:['Saturday','SaturdayHoliday','Holiday'],holiday:['Holiday','SaturdayHoliday','SundayHoliday','Sunday']}[t];
 const i=pref.indexOf(c);return i<0?99:i+1;
}
function odptMinutes(s){const m=/^(\d{1,2}):(\d{2})$/.exec(s||'');return m?+m[1]*60+ +m[2]:null;}
function odptHHMM(n){n=((n%1440)+1440)%1440;return String(Math.floor(n/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0');}
function odptDist(a,b){const R=6371000,r=Math.PI/180,x=(b.lng-a.lng)*r*Math.cos((a.lat+b.lat)/2*r),y=(b.lat-a.lat)*r;return Math.hypot(x,y)*R;}
const odptTitle=v=>typeof v==='string'?v:(v?.ja||v?.en||'');

// ---- ODPT への問い合わせ（キャッシュ付き。キャッシュの鍵にトークンを入れない） ----
async function odptGet(env,ctx,type,params,{pub=false,ttl=43200}={}){
 if(!pub&&!env.ODPT_TOKEN)throw fault('odpt_not_configured',503,3600);
 const u=new URL((pub?ODPT_PUBLIC:ODPT_BASE)+type);for(const[k,v]of Object.entries(params))u.searchParams.set(k,v);u.searchParams.sort();
 const key=u.href,mem=odptMem.get(key);if(mem&&mem.until>Date.now())return mem.data;
 const ck=new Request('https://odpt-cache.invalid/'+ODPT_VERSION+'/'+encodeURIComponent(key)),cache=globalThis.caches?.default;
 try{const hit=cache&&await cache.match(ck);if(hit){const data=await hit.json();odptMem.set(key,{data,until:Date.now()+Math.min(ttl,600)*1000});return data;}}catch{}
 const real=new URL(u);if(!pub)real.searchParams.set('acl:consumerKey',env.ODPT_TOKEN);
 let r;try{r=await fetch(real.href,{headers:{Accept:'application/json'},redirect:'manual',signal:AbortSignal.timeout(10000)});}catch{throw fault('odpt_unavailable',503,120,{stage:'odpt',reason:'network'});}
 if(r.status===401||r.status===403)throw fault(pub?'odpt_unavailable':'odpt_token_invalid',503,3600,{stage:'odpt',reason:'auth',httpStatus:r.status});
 if(r.status===429||r.status===503)throw fault('odpt_limited',429,120,{stage:'odpt',httpStatus:r.status});
 if(!r.ok)throw fault('odpt_unavailable',503,120,{stage:'odpt',httpStatus:r.status});
 let data;try{data=await r.json();}catch{throw fault('odpt_unavailable',503,120,{stage:'odpt',reason:'json'});}
 if(!Array.isArray(data))throw fault('odpt_unavailable',503,120,{stage:'odpt',reason:'shape'});
 if(odptMem.size>300)odptMem.delete(odptMem.keys().next().value);odptMem.set(key,{data,until:Date.now()+Math.min(ttl,600)*1000});
 if(cache)ctx.waitUntil(cache.put(ck,new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json','Cache-Control':'public,max-age='+ttl}})).catch(()=>{}));
 return data;
}
const odptNewest=list=>list.map(x=>x?.['dc:date']).filter(Boolean).sort().at(-1)||null;

// ---- 飛行機：JAL・ANA のフライト時刻表から、その日に飛ぶ便 ----
async function odptFlights(env,ctx,q){
 const from=String(q.get('from')||'').toUpperCase(),to=String(q.get('to')||'').toUpperCase(),date=q.get('date')||'';
 if(!ODPT_IATA.test(from)||!ODPT_IATA.test(to)||from===to||!odptDate(date))throw fault('invalid_request',400,0);
 const dow=ODPT_WEEK[odptDate(date).getUTCDay()],day0=Date.parse(date+'T00:00:00+09:00'),day1=day0+86400000-1;
 const lists=await Promise.allSettled(ODPT_AIRLINES.map(op=>odptGet(env,ctx,'odpt:FlightSchedule',{'odpt:operator':'odpt.Operator:'+op,'odpt:originAirport':'odpt.Airport:'+from,'odpt:destinationAirport':'odpt.Airport:'+to},{ttl:43200})));
 const failed=lists.filter(x=>x.status==='rejected');if(failed.length===lists.length)throw failed[0].reason;
 const groups=new Map(),sources=[];
 for(const [i,res]of lists.entries()){
  if(res.status!=='fulfilled')continue;sources.push(...res.value);
  for(const sch of res.value){
   const cal=String(sch['odpt:calendar']||'').replace(/^odpt\.Calendar:/,'');
   if(cal!==dow&&!(cal==='Weekday'&&dow!=='Saturday'&&dow!=='Sunday')&&!(cal==='SaturdayHoliday'&&(dow==='Saturday'||dow==='Sunday'))&&cal!=='Everyday'&&cal!=='')continue;
   for(const o of sch['odpt:flightScheduleObject']||[]){
    const dep=odptMinutes(o['odpt:originTime']),arr=odptMinutes(o['odpt:destinationTime']);if(dep===null)continue;
    if(+(o['odpt:originDayDifference']||0)!==0)continue;
    const vf=o['odpt:isValidFrom']?Date.parse(o['odpt:isValidFrom']):null,vt=o['odpt:isValidTo']?Date.parse(o['odpt:isValidTo']):null;
    if((vf&&vf>day1)||(vt&&vt<day0))continue;
    const nos=(Array.isArray(o['odpt:flightNumber'])?o['odpt:flightNumber']:[o['odpt:flightNumber']]).map(x=>String(x||'').toUpperCase().replace(/\s+/g,'')).filter(x=>/^[A-Z0-9]{2,3}\d{1,4}$/.test(x));if(!nos.length)continue;
    const airline=String(o['odpt:airline']||'').replace(/^odpt\.Operator:/,'')||ODPT_AIRLINES[i];
    const g=[...groups.values()].find(x=>x.dep===odptHHMM(dep)&&x.nos.some(n=>nos.includes(n)));
    const item={no:nos[0],nos,airline,dep:odptHHMM(dep),arr:arr===null?'':odptHHMM(arr),arrDay:+(o['odpt:destinationDayDifference']||0),via:(o['odpt:viaAirport']||[]).map(x=>String(x).replace(/^odpt\.Airport:/,'')),aircraft:o['odpt:aircraftType']||''};
    if(!g)groups.set(airline+'|'+dep+'|'+(arr??'')+'|'+nos[0],item);else{for(const n of nos)if(!g.nos.includes(n))g.nos.push(n);}
   }
  }
 }
 const items=[...groups.values()].sort((a,b)=>a.dep.localeCompare(b.dep));
 return {from,to,date,items,partial:failed.length>0,dataDate:odptNewest(sources),fetchedAt:Date.now(),expiresAt:Date.now()+43200000};
}

// ---- 鉄道：駅・路線・列車種別の一覧。事業者ごとに小さくまとめて1日キャッシュ ----
const odptOpMem=new Map();
async function odptOperatorIndex(env,ctx,x){
 const m=odptOpMem.get(x.op);if(m&&m.until>Date.now())return m.data;
 const ck=new Request('https://odpt-cache.invalid/'+ODPT_VERSION+'/index/'+x.op),cache=globalThis.caches?.default;
 try{const hit=cache&&await cache.match(ck);if(hit){const data=await hit.json();odptOpMem.set(x.op,{data,until:Date.now()+3600000});return data;}}catch{}
 const [st,rw,tt]=await Promise.all([odptGet(env,ctx,'odpt:Station',{'odpt:operator':'odpt.Operator:'+x.op},{pub:x.pub,ttl:86400}),odptGet(env,ctx,'odpt:Railway',{'odpt:operator':'odpt.Operator:'+x.op},{pub:x.pub,ttl:86400}),odptGet(env,ctx,'odpt:TrainType',{'odpt:operator':'odpt.Operator:'+x.op},{pub:x.pub,ttl:86400}).catch(()=>[])]);
 const stations=[],railways={},types={};
 for(const s of st){const lat=+s['geo:lat'],lng=+s['geo:long'];if(!s['owl:sameAs']||!s['odpt:railway'])continue;stations.push({id:s['owl:sameAs'],t:s['dc:title']||odptTitle(s['odpt:stationTitle']),r:s['odpt:railway'],lat:s['geo:lat']!=null&&Number.isFinite(lat)?lat:null,lng:s['geo:long']!=null&&Number.isFinite(lng)?lng:null,op:x.op});}
 const byName=new Map();for(const s of stations)if(s.lat!==null&&!byName.has(s.t))byName.set(s.t,s);
 for(const s of stations)if(s.lat===null&&byName.has(s.t)){s.lat=byName.get(s.t).lat;s.lng=byName.get(s.t).lng;}
 for(const r of rw)railways[r['owl:sameAs']]={t:r['dc:title']||odptTitle(r['odpt:railwayTitle']),c:/^#[0-9A-Fa-f]{6}$/.test(r['odpt:color']||'')?r['odpt:color']:'',asc:r['odpt:ascendingRailDirection']||'',desc:r['odpt:descendingRailDirection']||'',order:(r['odpt:stationOrder']||[]).slice().sort((a,b)=>a['odpt:index']-b['odpt:index']).map(o=>o['odpt:station']),op:x.op};
 for(const t of tt)types[t['owl:sameAs']]=t['dc:title']||odptTitle(t['odpt:trainTypeTitle']);
 const data={stations:stations.filter(s=>s.lat!==null),railways,types,dataDate:[odptNewest(st),odptNewest(rw)].filter(Boolean).sort().at(-1)||null};
 odptOpMem.set(x.op,{data,until:Date.now()+3600000});
 if(cache)ctx.waitUntil(cache.put(ck,new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json','Cache-Control':'public,max-age=86400'}})).catch(()=>{}));
 return data;
}
// 2地点の両方が範囲に入る事業者だけを読み込む（直通の列車は同じ事業者の路線に限るため）
async function odptIndex(env,ctx,points){
 const ops=ODPT_RAIL.filter(x=>(x.pub||env.ODPT_TOKEN)&&(points||[]).every(p=>odptInBox(x,p)));
 const stations=[],railways={},types={},dates=[],failed=[];
 for(const x of ops){
  try{const d=await odptOperatorIndex(env,ctx,x);stations.push(...d.stations);Object.assign(railways,d.railways);Object.assign(types,d.types);dates.push(d.dataDate);}
  catch(e){failed.push(e);}
 }
 // 1社も読めなかったときは「直通なし」ではなく、取得できなかったと返す
 if(ops.length&&failed.length===ops.length)throw failed.find(e=>e?.code==='odpt_token_invalid')||failed[0];
 return {stations,railways,types,dataDate:dates.filter(Boolean).sort().at(-1)||null,operators:ops.map(x=>x.op),partial:failed.length>0};
}
function odptNear(index,p,limit=800){
 // 名前が同じ駅（乗り換えの駅名など）は、少し遠くても優先する。歩く距離は実際の距離で数える
 const out=[],name=String(p.name||'').replace(/駅$/,'');
 for(const s of index.stations){
  const d=odptDist(p,s),same=!!name&&s.t===name;
  if(d<=limit||(same&&d<=1500))out.push({...s,d,rank:same?Math.max(0,d-600):d});
 }
 return out.sort((a,b)=>a.rank-b.rank).slice(0,10);
}
function odptOrderIndex(order,a,b){
 // 環状線などで同じ駅が2回出る場合は、駅の数が少ないほうを選ぶ
 let best=null;order.forEach((x,i)=>{if(x!==a)return;order.forEach((y,j)=>{if(y!==b||i===j)return;if(!best||Math.abs(j-i)<Math.abs(best[1]-best[0]))best=[i,j];});});return best;
}
const WALK=80; // 歩く速さ（m/分）
async function odptTrain(env,ctx,q){
 const num=k=>{const v=Number(q.get(k));return Number.isFinite(v)?v:null;};
 const a={lat:num('alat'),lng:num('alng'),name:String(q.get('aname')||'').slice(0,40)},b={lat:num('blat'),lng:num('blng'),name:String(q.get('bname')||'').slice(0,40)};
 const date=q.get('date')||'',time=odptMinutes(q.get('time')||''),type=q.get('type')==='arrival'?'arrival':'departure';
 if([a.lat,a.lng,b.lat,b.lng].some(v=>v===null||Math.abs(v)>180)||!odptDate(date)||time===null)throw fault('invalid_request',400,0);
 const index=await odptIndex(env,ctx,[a,b]);
 const A=odptNear(index,a),B=odptNear(index,b);
 const pairs=[];
 for(const sa of A)for(const sb of B){if(sa.r!==sb.r||sa.id===sb.id)continue;const rw=index.railways[sa.r];if(!rw)continue;const ij=odptOrderIndex(rw.order,sa.id,sb.id);if(!ij)continue;pairs.push({sa,sb,rw,ij,walk:sa.rank+sb.rank});}
 pairs.sort((x,y)=>x.walk-y.walk);
 const base={date,type,dataDate:index.dataDate,fetchedAt:Date.now(),expiresAt:Date.now()+21600000};
 if(!pairs.length)return {...base,status:'no_direct',partial:!!index.partial};
 const tried=new Set();
 for(const p of pairs.slice(0,3)){
  if(tried.has(p.sa.r+p.sa.id+p.sb.id))continue;tried.add(p.sa.r+p.sa.id+p.sb.id);
  const dir=p.ij[1]>p.ij[0]?p.rw.asc:p.rw.desc;if(!dir)continue;
  const pub=!!ODPT_RAIL.find(x=>x.op===p.rw.op)?.pub;
  const walkA=Math.ceil(p.sa.d*1.25/WALK),walkB=Math.ceil(p.sb.d*1.25/WALK);
  let tables;try{tables=await odptGet(env,ctx,'odpt:StationTimetable',{'odpt:station':p.sa.id,'odpt:railDirection':dir},{pub,ttl:43200});}catch(e){if(e?.code==='odpt_token_invalid')throw e;continue;}
  const table=tables.filter(t=>odptCalendarRank(t['odpt:calendar'],date)<99).sort((x,y)=>odptCalendarRank(x['odpt:calendar'],date)-odptCalendarRank(y['odpt:calendar'],date))[0];
  if(!table)continue;
  // 深夜0〜2時台は前日の続きとして扱う
  const deps=(table['odpt:stationTimetableObject']||[]).map(o=>{let m=odptMinutes(o['odpt:departureTime']);if(m===null)return null;if(m<180)m+=1440;return {m,o};}).filter(Boolean).sort((x,y)=>x.m-y.m);
  const hops=Math.abs(p.ij[1]-p.ij[0]),need=type==='departure'?time+walkA:time-walkB;
  const cands=type==='departure'?deps.filter(x=>x.m>=need).slice(0,4):deps.filter(x=>x.m<=need-Math.ceil(hops*2.2)).slice(-5).reverse();
  for(const c of cands){
   const trainId=c.o['odpt:train'],trainNo=c.o['odpt:trainNumber'];if(!trainId&&!trainNo)continue;
   let tts;try{tts=await odptGet(env,ctx,'odpt:TrainTimetable',trainId?{'odpt:train':trainId,'odpt:calendar':table['odpt:calendar']}:{'odpt:railway':p.sa.r,'odpt:trainNumber':trainNo,'odpt:calendar':table['odpt:calendar']},{pub,ttl:43200});}catch(e){if(e?.code==='odpt_token_invalid')throw e;continue;}
   for(const tt of tts){
    const objs=tt['odpt:trainTimetableObject']||[];let depM=null,arrM=null;
    const tm=v=>{const m=odptMinutes(v);return m===null?null:m<180?m+1440:m;};
    for(const o of objs){
     if(depM===null){if(o['odpt:departureStation']===p.sa.id)depM=tm(o['odpt:departureTime']);continue;}
     if(o['odpt:arrivalStation']===p.sb.id||o['odpt:departureStation']===p.sb.id){arrM=tm(o['odpt:arrivalTime'])??tm(o['odpt:departureTime']);break;}
    }
    if(depM===null||arrM===null||arrM<depM)continue;
    if(type==='departure'&&depM<need)continue;if(type==='arrival'&&arrM>time-walkB)continue;
    const dest=(tt['odpt:destinationStation']||[]).map(id=>index.stations.find(s=>s.id===id)?.t||'').filter(Boolean).join('・');
    const tname=(tt['odpt:trainName']||[]).map(odptTitle).filter(Boolean).join('・');
    return {...base,status:'found',operator:ODPT_RAIL.find(x=>x.op===p.rw.op)?.name||p.rw.op,credit:ODPT_RAIL.find(x=>x.op===p.rw.op)?.credit||'',line:p.rw.t,color:p.rw.c,
     from:{name:p.sa.t,id:p.sa.id,walk:walkA,m:Math.round(p.sa.d)},to:{name:p.sb.t,id:p.sb.id,walk:walkB,m:Math.round(p.sb.d)},
     dep:odptHHMM(depM),arr:odptHHMM(arrM),depMin:depM,arrMin:arrM,ride:arrM-depM,trainType:index.types[tt['odpt:trainType']]||'',trainName:tname,dest,
     extraFee:tt['odpt:needExtraFee']===true,calendar:String(table['odpt:calendar']||'').replace(/^odpt\.Calendar:/,''),dataDate:tt['dc:date']||table['dc:date']||index.dataDate};
   }
  }
 }
 return {...base,status:'not_found'};
}
async function odptRoute(request,env,ctx,origin){
 const u=new URL(request.url);
 try{
  if(u.pathname==='/odpt/status')return response({ok:true,version:ODPT_VERSION,token:!!env.ODPT_TOKEN,flights:!!env.ODPT_TOKEN,rail:ODPT_RAIL.filter(x=>x.pub||env.ODPT_TOKEN).map(x=>x.name)},200,origin);
  odptRate(request);
  if(u.pathname==='/odpt/flights')return response({ok:true,version:ODPT_VERSION,...await odptFlights(env,ctx,u.searchParams)},200,origin);
  if(u.pathname==='/odpt/train')return response({ok:true,version:ODPT_VERSION,...await odptTrain(env,ctx,u.searchParams)},200,origin);
  return response({ok:false,code:'not_found'},404,origin);
 }catch(e){const known=e?.[KNOWN_FAULT];return response({ok:false,version:ODPT_VERSION,code:known?e.code:'odpt_internal_error',retryAfter:known?e.retryAfter:120,diagnostic:known?(e.diagnostic||{}):{}},known?e.status:503,origin,known?e.retryAfter:120);}
}
export {odptHolidaySet,odptDayType,odptCalendarRank,odptFlights,odptTrain,odptIndex};

export default {async fetch(request,env,ctx){
  const origin=request.headers.get('Origin');const allowed=(env.ALLOWED_ORIGINS||'https://tabiroute.github.io').split(',').map(s=>s.trim()).filter(Boolean);
  const u=new URL(request.url);
  if(origin&&!allowed.includes(origin))return response({ok:false,code:'origin_denied'},403,null);
  if(!origin&&u.pathname!=='/health'&&!(u.pathname==='/photo-image'&&allowed.includes(refererOrigin(request))))return response({ok:false,code:'origin_required'},403,null);
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{'Access-Control-Allow-Origin':origin||allowed[0],'Access-Control-Allow-Methods':'GET, OPTIONS','Access-Control-Max-Age':'86400','Vary':'Origin'}});
  if(request.method!=='GET')return response({ok:false,code:'method_not_allowed'},405,origin);
  if(u.pathname==='/health')return response({ok:true,version:VERSION,photoVersion:'photo-v10',shopPhotoVersion:'shop-photo-v1',configured:{rakuten:!!(env.RAKUTEN_APP_ID&&env.RAKUTEN_ACCESS_KEY),hotpepper:!!env.HOTPEPPER_API_KEY,bookingLinks:!!env.RAKUTEN_AFFILIATE_ID},enabled:env.API_ENABLED!=='false',odpt:{version:ODPT_VERSION,token:!!env.ODPT_TOKEN},guard:{version:GUARD_VERSION,originRequired:true,burstPerMinute:GUARD_BURST},checks:{rateLimiter:env.API_RATE_LIMITER?(typeof env.API_RATE_LIMITER.limit==='function'?'binding_present':'invalid_binding'):'local_fallback',timeoutSupported:typeof AbortSignal?.timeout==='function',upstreamTested:false}},200,origin);
  if(u.pathname.startsWith('/odpt/')){if(env.API_ENABLED==='false')return response({ok:false,code:'maintenance',retryAfter:1800},503,origin,1800);return await odptRoute(request,env,ctx,origin);}
  let stage='validation';
  try{
    if(env.API_ENABLED==='false')throw fault('maintenance',503,1800);
    if(u.pathname==='/photos'||u.pathname==='/photo-image'||u.pathname==='/food-photos'||u.pathname==='/shop-photos')return await photoRoute(request,env,ctx);
    const p=validate(u.pathname,u.searchParams);stage='rate_limit';await rateLimit(request,env);stage='cache_read';
    const ttl=TTL[u.pathname.slice(1)], canonical=new URL(request.url);canonical.pathname='/_cache/'+VERSION+u.pathname;canonical.search=new URLSearchParams(p);canonical.searchParams.sort();
    // Cache only normalized public data; no app IDs or API secrets in cache keys/bodies.
    const key=new Request(canonical.href), cache=globalThis.caches?.default;
    const hit=cache&&await cache.match(key);if(hit){const data=await hit.json();if(data.expiresAt>Date.now())return response({...data,cached:true},200,origin);}
    const flightKey=canonical.href;
    stage='provider_query';let pending=flights.get(flightKey);
    if(!pending&&GUARD_PATHS.has(u.pathname))guardBurst();
    if(!pending){pending=query(u.pathname,p,env).then(data=>({...data,ok:true,fetchedAt:Date.now(),expiresAt:Date.now()+ttl*1000}));flights.set(flightKey,pending);pending.finally(()=>flights.delete(flightKey)).catch(()=>{});}
    const data=await pending;
    stage='cache_write';if(cache)ctx.waitUntil(cache.put(key,new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json','Cache-Control':'public,max-age='+ttl}})));
    return response(data,200,origin);
  }catch(e){const known=e?.[KNOWN_FAULT];return response({ok:false,version:VERSION,code:known?e.code:'worker_internal_error',retryAfter:known?e.retryAfter:300,diagnostic:known?(e.diagnostic||{stage}):{stage}},known?e.status:503,origin,known?e.retryAfter:300);}
}};
