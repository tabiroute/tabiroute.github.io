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
