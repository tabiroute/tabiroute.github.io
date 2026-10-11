/* Food photos for every restaurant card, in every prefecture.
   1) A photo of the dish the shop is known for is shown at once from a reviewed catalogue
      (booking/dish-photos.js, Wikimedia Commons, author and licence kept). It is labelled
      「料理イメージ」 and is never presented as a photo of the shop itself.
   2) In the background the shop's own photo is looked up (registered photo, Hot Pepper shop
      photo with name and address/location checks, or a Commons photo of that exact shop).
      When one is found it replaces the image. A slow source never delays the first image. */
const FOOD_PHOTOS={items:new Map(),results:new Map(),pending:new Map(),active:0,queue:[],failed:new Set(),workerUnavailable:false};
const FOOD_PHOTO_CACHE='tb-shop-photo-v3:';
const foodPhotoResolver=TabirouteFoodPhotoCore.resolver({api:TabirouteFoodPhotoCore.transport({store:photoStore}).api,store:photoStore});
function foodPhotoKey(o){return JSON.stringify([TabirouteFoodPhotoCore.VERSION,bookingID(o),norm(o.name),TabirouteFoodPhotoCore.address(o.addr)||[o.lat??'',o.lng??''],o.pref||'']);}

/* ---- 料理イメージ（その土地の名物の写真。必ず1枚出す） ---- */
const DISH_CAT=window.TABIROUTE_DISH_PHOTOS||{d:{},a:{}};
function dishNorm(s){return String(s||'').normalize('NFKC').toLowerCase().replace(/[\s・ー‐\-－–（）()「」『』【】、。,.!！?？&＆'’"“”/／]/g,'');}
// 料理名と別名を、長い名前から順に照合する（「あんかけスパ」が「スパ」より先に当たる）
const DISH_INDEX=(()=>{const out=[];for(const k of Object.keys(DISH_CAT.d||{}))out.push([dishNorm(k),k]);for(const[a,k]of Object.entries(DISH_CAT.a||{}))if(DISH_CAT.d?.[k])out.push([dishNorm(a),k]);return out.filter(x=>x[0].length>=2).sort((a,b)=>b[0].length-a[0].length);})();
// ホットペッパーのジャンル → 料理イメージ
const DISH_BY_GENRE={G001:'居酒屋',G002:'居酒屋',G003:'和食',G004:'和食',G005:'洋食',G006:'イタリアン',G007:'中華',G008:'焼肉',G009:'エスニック',G010:'洋食',G011:'居酒屋',G012:'バー',G013:'ラーメン',G014:'カフェ',G015:'和食',G016:'お好み焼き',G017:'韓国料理'};
// 店名・ジャンル名にあればその料理（カタログの名前に無い言い方）
const DISH_WORDS=[[/らーめん|中華そば|つけ麺|担々麺|担担麺|まぜそば/,'ラーメン'],[/鮨|すし|スシ/,'寿司'],[/蕎麦|そば処|手打ちそば|生そば/,'そば'],[/饂飩|うどん/,'うどん'],[/鰻|うな/,'うなぎ'],[/とんかつ|豚カツ|かつ亭|カツ丼/,'とんかつ'],[/天麩羅|天婦羅/,'天ぷら'],[/やきとり|焼鳥|串焼/,'焼き鳥'],[/焼肉|ホルモン|ジンギス/,'焼肉'],[/ステーキ|鉄板焼/,'ステーキ'],[/珈琲|コーヒー|喫茶|カフェ|cafe|coffee/,'カフェ'],[/甘味|和菓子|団子|だんご|饅頭|まんじゅう|餅|もち/,'和菓子'],[/パン|ベーカリー|bakery/,'ベーカリー'],[/ケーキ|スイーツ|パティスリー|洋菓子|ジェラート|アイス|パフェ/,'スイーツ'],[/海鮮|魚|鮮魚|浜焼|漁港|市場|水産/,'海鮮'],[/割烹|料亭|懐石|和食|日本料理|定食|食堂|御膳/,'和食'],[/中華|餃子|飯店|菜館|酒家|楼/,'中華'],[/イタリア|パスタ|ピザ|ピッツァ|トラットリア|リストランテ|osteria|pizza/,'イタリアン'],[/フレンチ|ビストロ|bistro|レストラン|洋食|グリル|キッチン/,'洋食'],[/カレー|curry/,'カレー'],[/バーガー|burger/,'ハンバーガー'],[/居酒屋|酒場|酒処|炉端|ろばた|立ち飲み|大衆|バル/,'居酒屋'],[/お好み焼|鉄板|もんじゃ/,'お好み焼き'],[/たこ焼/,'たこ焼き'],[/おでん/,'おでん'],[/韓国|焼肉/,'韓国料理']];
const DISH_EXACT=new Map([...Object.keys(DISH_CAT.d||{}).map(k=>[dishNorm(k),k]),...Object.entries(DISH_CAT.a||{}).filter(([,k])=>DISH_CAT.d?.[k]).map(([a,k])=>[dishNorm(a),k])]);
// 1文字の料理名（鮎・桃）は完全一致のときだけ。2文字以上は文中に含まれていれば当てる
function dishFind(t){const n=dishNorm(t);if(!n)return '';if(DISH_EXACT.has(n))return DISH_EXACT.get(n);if(n.length<2)return '';for(const[k,v]of DISH_INDEX)if(n.includes(k))return v;return '';}
function foodDishFor(o){
  if(!o)return '';
  // 1. その店の名物として登録した料理 → 2. ジャンル・紹介文 → 3. 店名 → 4. ジャンルコード → 5. その土地の名物
  for(const t of [o.dish,o.cuisine,o.genre,o.catch,o.kindLabel]){const k=t&&dishFind(t);if(k)return k;}
  const name=o.name||'',all=[o.cuisine,o.genre,o.catch,name].filter(Boolean).join(' ');
  const word=DISH_WORDS.find(([re])=>re.test(all.normalize('NFKC').toLowerCase()));
  const byName=dishFind(name);if(byName&&dishNorm(byName).length>=3)return byName;   // 店名の短い語（「イカ」など）は別の意味のことがあるので使わない
  if(word&&DISH_CAT.d?.[word[1]])return word[1];
  const g=DISH_BY_GENRE[o.genreCode];if(g&&DISH_CAT.d?.[g])return g;
  const pref=o.pref||(typeof S!=='undefined'?S?.pref:''),city=o.city||'';
  const local=[...((typeof LOCAL!=='undefined'&&LOCAL[city])||[]),...((typeof SPECIAL!=='undefined'&&SPECIAL[pref])||[])];
  for(const d of local){const k=dishFind(d);if(k)return k;}
  return DISH_CAT.d?.['和食']?'和食':Object.keys(DISH_CAT.d||{})[0]||'';
}
// Wikimedia の縮小画像（330px。よく使われる幅なので配信側に用意されていて速い）。元の写真が小さいときは元の写真
function dishEnc(x){return encodeURIComponent(x).replace(/[!'()*]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase());}
function dishURLs(path,width){
  const i=path.indexOf('/',2),dir=path.slice(0,i),name=path.slice(i+1),e=dishEnc(name);
  const orig=(DISH_CAT.orig||'https://upload.wikimedia.org/wikipedia/commons/')+dir+'/'+e;
  return {small:width>330?(DISH_CAT.thumb||'https://thumb.wikimedia.org/wikipedia/commons/thumb/')+dir+'/'+e+'/330px-'+e:orig,orig,file:name.replace(/_/g,' ')};
}
function foodDishPhoto(o){
  const dish=foodDishFor(o),d=dish&&DISH_CAT.d?.[dish];
  if(!d)return {src:'img/food.jpg',dish:dish||'料理',kind:'dish-image',label:'料理イメージ',credit:'たびルート',generic:true,expiresAt:Infinity};
  const [path,width,artist,license,lic]=d,u=dishURLs(path,width),file=u.file;
  const page='https://commons.wikimedia.org/wiki/File:'+encodeURIComponent(file.replace(/ /g,'_'));
  const licenseURL=/^L:/.test(lic||'')?(/^L:zero\//.test(lic)?'https://creativecommons.org/publicdomain/'+lic.slice(2)+'/':'https://creativecommons.org/licenses/'+lic.slice(2)+'/'):/^https:/.test(lic||'')?lic:page;
  const base=photoBase();
  return {src:u.small,remote:u.small,proxy:base?base+'/photo-image?file='+encodeURIComponent(file):'',orig:u.orig,
    file,page,artist,license,licenseURL,dish,kind:'dish-image',label:'料理イメージ',changes:'表示用に縮小・トリミング',expiresAt:Infinity};
}

// 有名店ごとに確かめた「お店の写真」（Wikimedia Commons・booking/famous-photos.js）。画面に出した瞬間に表示できる
const FAMOUS_PHOTOS=window.TABIROUTE_FAMOUS_PHOTOS||{p:{},w:{}};
function foodFamousKey(o){return (o.pref||'')+'|'+(o.name||'');}
function foodFamousPhoto(o){
 const d=FAMOUS_PHOTOS.p?.[foodFamousKey(o)];if(!d)return null;
 const [path,width,artist,license,lic]=d,u=dishURLs(path,width),file=u.file,base=photoBase();
 const page='https://commons.wikimedia.org/wiki/File:'+encodeURIComponent(file.replace(/ /g,'_'));
 const licenseURL=/^L:/.test(lic||'')?(/^L:zero\//.test(lic)?'https://creativecommons.org/publicdomain/'+lic.slice(2)+'/':'https://creativecommons.org/licenses/'+lic.slice(2)+'/'):/^https:/.test(lic||'')?lic:page;
 const src=[u.small,base?base+'/photo-image?file='+encodeURIComponent(file):'',u.orig].find(x=>x&&!FOOD_PHOTOS.failed.has(x));
 return src?{src,file,page,artist,license,licenseURL,kind:'shop-free',label:'お店の写真',changes:'表示用に縮小・トリミング',expiresAt:Infinity}:null;
}
function foodPhotoSeed(o){
 // 1枚ずつ確認した写真（RESTAURANT_PHOTO_SEEDS）を先に、無ければ有名店の確認済み写真
 const match=RESTAURANT_PHOTO_SEEDS.find(s=>norm(s.name)===norm(o.name)&&TabirouteFoodPhotoCore.address(s.addr)===TabirouteFoodPhotoCore.address(o.addr)&&(!o.pref||s.pref===o.pref));
 const p=match?.photo,src=p&&[p.src,p.remote].find(u=>u&&!FOOD_PHOTOS.failed.has(u));
 return src?{...p,src,expiresAt:Infinity}:foodFamousPhoto(o);
}
function foodPhotoProvided(o){
 const custom=bookingMedia(o),own=bookingSafeURL(o.ownPhoto),registered=bookingSafeURL(custom.url),api=Number(o.apiExpiresAt)>Date.now()?bookingSafeURL(o.apiPhoto):'';
 const src=[own,registered,api].find(u=>u&&!FOOD_PHOTOS.failed.has(u));if(!src)return null;
 const manual=src===own||src===registered;
 return {src,manual,kind:src===registered&&custom.kind==='dish'?'restaurant-dish':'shop',label:src===own?'登録写真':src===registered&&custom.kind==='dish'?'料理写真':'店舗写真',credit:src===own?'利用者が登録':src===registered?custom.credit||'登録写真':'画像提供：ホットペッパー グルメ',page:manual?'':hpURL(o),expiresAt:manual?Infinity:Number(o.apiExpiresAt)};
}
function foodPhotoCached(key){
 if(FOOD_PHOTOS.results.has(key))return FOOD_PHOTOS.results.get(key);
 try{const r=JSON.parse(sessionStorage.getItem(FOOD_PHOTO_CACHE+key)||'null');if(r?.until>Date.now()){FOOD_PHOTOS.results.set(key,r);return r;}}catch{}
 return null;
}
function foodPhotoRemember(key,r){
 FOOD_PHOTOS.results.set(key,r);
 try{sessionStorage.setItem(FOOD_PHOTO_CACHE+key,JSON.stringify(r));const keys=Object.keys(sessionStorage).filter(k=>k.startsWith(FOOD_PHOTO_CACHE));for(const k of keys){const v=JSON.parse(sessionStorage.getItem(k)||'null');if(!v||v.until<=Date.now())sessionStorage.removeItem(k);}keys.slice(0,Math.max(0,keys.length-120)).forEach(k=>sessionStorage.removeItem(k));}catch{}
}
// 並び：登録写真 ＞ そのお店の料理写真 ＞ そのお店の写真（Commons 等・ライセンス確認済み）＞ ホットペッパーの店舗写真 ＞ 公式サイトの画像 ＞ 料理イメージ
const FOOD_PHOTO_RANK=p=>p.manual?100:p.kind==='restaurant-dish'?80:p.kind==='shop-free'?75:p.kind==='shop'?60:p.kind==='official'?50:p.generic?1:10;
// お店自身の写真（登録・ホットペッパー・確認済みのCommons）があればそれ。無ければ料理イメージ（必ずある）
function foodPhotoShopChoice(key){
 const o=FOOD_PHOTOS.items.get(key)||{},provided=foodPhotoProvided(o),seed=foodPhotoSeed(o),r=foodPhotoCached(key)?.photo;
 const all=[provided,seed,r].filter(p=>p?.src&&p.expiresAt>Date.now()&&!FOOD_PHOTOS.failed.has(p.src));
 return all.sort((a,b)=>FOOD_PHOTO_RANK(b)-FOOD_PHOTO_RANK(a))[0]||null;
}
function foodPhotoChoice(key,size){
 const shop=foodPhotoShopChoice(key);if(shop)return shop;
 const o=FOOD_PHOTOS.items.get(key)||{},dish=foodDishPhoto(o);
 // 縮小画像 → 写真プロキシ → 元画像 → たびルートの料理写真 の順に、読めるものを使う
 const src=[dish.src,dish.proxy,dish.orig].find(u=>u&&!FOOD_PHOTOS.failed.has(u));
 return src?{...dish,src}:{src:'img/food.jpg',dish:dish.dish,kind:'dish-image',label:'料理イメージ',credit:'たびルート',generic:true,expiresAt:Infinity};
}
async function foodRestaurantDish(o){
 let place;try{place=TabirouteFoodPhotoCore.restaurant(o);}catch{return null;}
 const base=photoBase();let data;
 if(base&&!FOOD_PHOTOS.workerUnavailable){
  const r=await fetch(base+'/food-photos?'+new URLSearchParams(place),{credentials:'omit',signal:AbortSignal.timeout(10000)});
  if(r.status===404)FOOD_PHOTOS.workerUnavailable=true;
  else {
   const j=await r.json();
   if(r.status===400&&j.code==='dish_required')FOOD_PHOTOS.workerUnavailable=true;
   else if(!r.ok)throw PHOTO_CORE.fail(r.status===429?'provider_limited':'provider_unavailable',PHOTO_CORE.retrySeconds(r.headers.get('Retry-After')));
   else if(j.version===TabirouteFoodPhotoCore.VERSION)data=j;
   else FOOD_PHOTOS.workerUnavailable=true;
  }
 }
 // Direct Commons is only a compatibility fallback, not a second search after timeouts.
 if(!data)data=await foodPhotoResolver.resolve(place);
 const photo=(data.photos||[]).find(p=>p.kind==='restaurant-dish'&&PHOTO_CORE.fileName(p.file)&&p.artist&&p.license&&PHOTO_CORE.imageURL(p.remote||p.src)&&!FOOD_PHOTOS.failed.has(PHOTO_CORE.imageURL(p.remote||p.src)));
 return photo?{...photo,src:PHOTO_CORE.imageURL(photo.remote||photo.src),proxy:base&&photo.src===base+'/photo-image?file='+encodeURIComponent(photo.file)?photo.src:'',expiresAt:Number(data.expiresAt)}:null;
}

/* ---- ネットからお店自身の写真を探す（Worker の /shop-photos：OpenStreetMap・Commons・Wikipedia・Wikidata・公式サイト） ---- */
async function foodWebPhoto(o){
 const base=photoBase();if(!base||FOOD_PHOTOS.shopUnavailable||!bookingPoint(o))return null;
 const web=FAMOUS_PHOTOS.w?.[foodFamousKey(o)]||'';
 const q={name:o.name,addr:o.addr||'',lat:Number(o.lat).toFixed(5),lng:Number(o.lng).toFixed(5),pref:o.pref||'',exact:o.geoExact===false?'0':'1',...(web?{web}:{})};
 const r=await fetch(base+'/shop-photos?'+new URLSearchParams(q),{credentials:'omit',signal:AbortSignal.timeout(25000)});
 let j=null;try{j=await r.json();}catch{}
 // 古い Worker（/shop-photos が無い）のときは、これまでの方法（/food-photos）だけで探す
 if(r.status===404||(r.ok&&j?.version!=='shop-photo-v1')){FOOD_PHOTOS.shopUnavailable=true;return null;}
 if(!r.ok)throw PHOTO_CORE.fail(r.status===429?'provider_limited':'provider_unavailable',PHOTO_CORE.retrySeconds(r.headers.get('Retry-After')));
 const exp=Number(j.expiresAt)||Date.now()+86400000;
 for(const p of j.photos||[]){
  if(p.kind==='shop-free'){const remote=PHOTO_CORE.imageURL(p.remote||''),proxy=bookingSafeURL(p.src);const src=[remote,proxy].find(u=>u&&!FOOD_PHOTOS.failed.has(u));
   if(src&&p.artist&&p.license)return {src,proxy:proxy!==src?proxy:'',remote,file:p.file,page:bookingSafeURL(p.page),artist:p.artist,license:p.license,licenseURL:bookingSafeURL(p.licenseURL),kind:'shop-free',label:'お店の写真',expiresAt:exp};}
  if(p.kind==='official'){const src=String(p.src||'');if(/^https:\/\//.test(src)&&bookingSafeURL(src)&&!FOOD_PHOTOS.failed.has(src))return {src,page:bookingSafeURL(p.page),credit:String(p.credit||'公式サイト').slice(0,80),kind:'official',label:'公式サイトの写真',expiresAt:exp};}
 }
 return null;
}

/* ---- ホットペッパーの「そのお店」の写真：店名と住所（または位置）の両方が合うときだけ ---- */
// 表記ゆれ（スパゲティ／スパゲッティ、全角／半角、本店の有無など）を吸収して比べる
function shopNameKey(s){return String(s||'').normalize('NFKC').toLowerCase().replace(/[ッっ]/g,'').replace(/[ヴ]/g,'ブ').replace(/[\s・ー‐\-－–（）()「」『』【】、。,.!！?？&＆'’"“”/／~〜]/g,'');}
const SHOP_GENERIC=/^(?:本店|総本店|本舗|支店|分店|新館|別館|食堂|料理店|飲食店|ラーメン|らーめん|寿司|すし|鮨|そば|蕎麦|うどん|居酒屋|レストラン|カフェ|喫茶|珈琲|焼肉|中華|定食|手打ち?そば|手打ち?うどん)$/;
function shopBranch(s){const m=String(s||'').normalize('NFKC').match(/([^\s　]+?(?:店|館))$/);return m&&!/^(?:本店|総本店)$/.test(m[1])?shopNameKey(m[1]):'';}
function foodShopNameMatch(a,b){
 const x=shopNameKey(a),y=shopNameKey(b);if(!x||!y)return false;if(x===y)return true;
 const strip=s=>s.replace(/(?:総本店|本店|本舗)$/,'');const xs=strip(x),ys=strip(y);
 if(xs.length<3||ys.length<3)return xs===ys;
 if(!(xs.includes(ys)||ys.includes(xs)))return false;
 // 支店名が両方にあるときは同じ支店だけ（「○○ 栄店」と「○○ 名駅店」は別のお店）
 const ba=shopBranch(a),bb=shopBranch(b);if(ba&&bb&&ba!==bb&&!ba.includes(bb)&&!bb.includes(ba))return false;
 return true;
}
// 住所：「丁目・番地・号」「全角数字」「漢数字の丁目」の違いをそろえて、町名と番地の数字で比べる
function shopAddrParts(v){
 const kan={'一':1,'二':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9,'十':10};
 let s=String(v||'').normalize('NFKC').replace(/^(?:東京都|北海道|(?:京都|大阪)府|.{2,3}県)/,'').replace(/[\s　].*$/,'');
 s=s.replace(/([一二三四五六七八九十]{1,2})(?=丁目|条|線)/g,m=>{let n=0;for(const c of m)n=c==='十'?(n||1)*10:n+kan[c];return String(n);});
 s=s.replace(/丁目|番地|番|号|の(?=\d)/g,'-').replace(/[‐−－–ー](?=\d)/g,'-').replace(/-+/g,'-').replace(/-$/,'');
 const m=s.match(/^(.*?)(\d+(?:-\d+)*)/);if(!m)return {town:s,nums:[]};
 return {town:m[1].replace(/大字|字/g,''),nums:m[2].split('-').map(Number)};
}
function foodShopAddrMatch(a,b){
 if(!a||!b)return null;const x=shopAddrParts(a),y=shopAddrParts(b);
 if(!x.town||!y.town||!(x.town.endsWith(y.town)||y.town.endsWith(x.town)))return false;
 if(!x.nums.length||!y.nums.length)return null;
 const n=Math.min(x.nums.length,y.nums.length,3);for(let i=0;i<n;i++)if(x.nums[i]!==y.nums[i])return false;
 return n>=2||(x.nums.length===1&&y.nums.length===1)?true:null;
}
function foodPhotoMatch(o,h){
 const hp=o.hpId||(/^hotpepper:/.test(bookingID(o))?bookingID(o).slice(10):'');
 if(hp)return h.id===hp;
 const addr=foodShopAddrMatch(o.addr,h.address||h.addr);if(addr===false)return false;
 const near=bookingPoint(o)&&bookingPoint(h)&&o.geoExact!==false?hav(o,h):null;
 if(addr===true&&near!==null&&near>=1.5)return false;
 if(foodShopNameMatch(o.name,h.name))return addr===true||(near!==null&&near<0.2);
 // 番地まで同じ住所なら、店名の特徴的な部分（「中華食堂 桂苑」の「桂苑」）が入っていれば同じお店（「網焼／網焼き」のような送り仮名の違いを許す）
 const kw=shopNameKey(foodShopKeyword(o.name));
 return addr===true&&kw.length>=2&&shopNameKey(h.name).includes(kw);
}
// 検索のことば：店名のうち、支店名や「ラーメン」のような一般語を除いた、いちばん特徴のある短い部分
// （「スパゲティ／スパゲッティ」のような表記ゆれで外れないよう、日本語は短い語を選ぶ。位置1km以内で探すので短くても絞れる）
function foodShopKeyword(name){
 const t=String(name||'').normalize('NFKC').replace(/[（(][^）)]*[）)]/g,' ').split(/[\s　・]+/).map(w=>w.replace(/[+＋!！?？&＆'’"“”#＃*＊.,:;]/g,'')).filter(Boolean);
 const core=t.filter(w=>!SHOP_GENERIC.test(w)&&!(t.length>1&&/(?:店|館)$/.test(w)&&w!==t[0]));
 const list=(core.length?core:t).filter(w=>w.length>=2);if(!list.length)return (t[0]||'').slice(0,40);
 const jp=w=>/[\u3040-\u30ff\u3400-\u9fff]/.test(w);
 const ja=list.filter(jp).sort((a,b)=>a.length-b.length),en=list.filter(w=>!jp(w)).sort((a,b)=>b.length-a.length);
 return (ja[0]||en[0]).slice(0,40);
}
async function foodShopPhoto(o){
 const hp=o.hpId||(/^hotpepper:/.test(bookingID(o))?bookingID(o).slice(10):'');
 const known=Object.values(F4.res).flatMap(r=>r.hp||[]).concat(F4.name?.hp||[]),exact=known.filter(h=>foodPhotoMatch(o,{...h,id:h.hpId,address:h.addr}));
 if(exact.length===1&&foodPhotoProvided(exact[0]))return foodPhotoProvided(exact[0]);
 const kw=foodShopKeyword(o.name);let params;
 if(/^J\d{9}$/.test(hp))params={id:hp};
 else if(bookingPoint(o)&&kw.length>=2)params={lat:Number(o.lat).toFixed(5),lng:Number(o.lng).toFixed(5),q:kw,range:o.geoExact===false?5:3};   // 位置が町名までの目安のときは3km、番地まで分かるときは1km
 else if(HP_SA[o.pref||S.pref]&&kw.length>=2)params={sa:HP_SA[o.pref||S.pref],q:kw};
 else return null;
 const j=await BookingAPI.get('/restaurants',params),matches=(j.items||[]).filter(h=>foodPhotoMatch(o,h));
 if(matches.length!==1||!matches[0].photo)return null;
 const h=matches[0],src=bookingSafeURL(h.photo);if(!src||FOOD_PHOTOS.failed.has(src))return null;
 return {src,kind:'shop',label:'店舗写真',credit:'画像提供：ホットペッパー グルメ',page:bookingSafeURL(h.url),hpId:h.id,expiresAt:j.expiresAt};
}
function foodPhotoInner(key,size){
 const o=FOOD_PHOTOS.items.get(key)||{},p=foodPhotoChoice(key,size);
 const isDish=p.kind==='dish-image';
 const credit=p.artist||p.credit||'',source=p.page?`<a href="${esc(bookingSafeURL(p.page))}" target="_blank" rel="noopener">${esc(credit)}</a>`:esc(credit);
 const license=p.license?` · <a href="${esc(bookingSafeURL(p.licenseURL||p.page))}" target="_blank" rel="noopener">${esc(p.license)}</a>`:'';
 const note=isDish?`「${esc(p.dish||'料理')}」の写真です（このお店の写真ではありません）<br>`:p.kind==='official'?'お店の公式サイトの紹介画像です<br>':'';
 const alt=isDish?`${p.dish||'料理'}のイメージ写真`:o.name+'の'+(p.kind==='restaurant-dish'?'料理写真':p.kind==='official'?'公式サイトの写真':'写真');
 return `<img src="${esc(p.src)}" alt="${esc(alt)}" loading="lazy" decoding="async"${p.kind==='official'?' referrerpolicy="no-referrer"':''} onerror="foodPhotoBroken(this)"><span class="food-photo-label${isDish?' is-dish':''}">${esc(p.label||'店舗写真')}</span><figcaption><details><summary>写真・出典</summary>${note}${source}${license}${p.changes?'<br>'+esc(p.changes):''}</details></figcaption>`;
}
function foodPhotoSlot(o,size){
 const key=foodPhotoKey(o);FOOD_PHOTOS.items.set(key,{...o,_size:size});
 if(FOOD_PHOTOS.items.size>300){for(const k of FOOD_PHOTOS.items.keys()){if(FOOD_PHOTOS.items.size<=250)break;if(k!==key&&!FOOD_PHOTOS.pending.has(k)&&!document.querySelector(`[data-food-photo="${CSS.escape(k)}"]`)){FOOD_PHOTOS.items.delete(k);FOOD_PHOTOS.results.delete(k);}}}
 return `<figure class="food-photo food-photo-${esc(size)}" data-food-photo="${esc(key)}">${foodPhotoInner(key,size)}</figure>`;
}
function foodPhotoPaint(key){document.querySelectorAll(`[data-food-photo="${CSS.escape(key)}"]`).forEach(el=>{const size=(el.className.match(/food-photo-(\w+)/)||[])[1];const html=foodPhotoInner(key,size);const cur=el.querySelector('img')?.getAttribute('src');const next=html.match(/<img src="([^"]*)"/)?.[1]?.replace(/&amp;/g,'&');if(cur&&next&&cur===next)return;el.innerHTML=html;});}
async function foodPhotoLoad(key){
 const o=FOOD_PHOTOS.items.get(key);if(!o)return;
 let best=null,retry=300;
 const publish=p=>{if(!p||FOOD_PHOTOS.failed.has(p.src))return;if(!best||FOOD_PHOTO_RANK(p)>FOOD_PHOTO_RANK(best)){best=p;foodPhotoRemember(key,{photo:best,until:Math.min(best.expiresAt,Date.now()+86400000)});foodPhotoPaint(key);}};
 const catchError=e=>{retry=Math.max(retry,e?.retryAfter||e?.seconds||0);};
 const provided=foodPhotoShopChoice(key);
 const jobs=[];
 // ネット検索（新しい Worker）と、ホットペッパーを同時に探す。早く見つかったものから表示し、良いものが後から来たら差し替える
 if(!(provided&&FOOD_PHOTO_RANK(provided)>=75))jobs.push(foodWebPhoto(o).then(async p=>{if(p)return publish(p);if(FOOD_PHOTOS.shopUnavailable)publish(await foodRestaurantDish(o));}).catch(catchError));
 if(!provided)jobs.push(foodShopPhoto(o).then(publish).catch(catchError));
 // Each provider paints immediately; a slow provider cannot delay a faster result.
 await Promise.allSettled(jobs);
 if(!best)foodPhotoRemember(key,{until:Date.now()+Math.min(3600,retry)*1000});
}
function foodPhotoRequest(key,force=false){
 if(FOOD_PHOTOS.pending.has(key))return FOOD_PHOTOS.pending.get(key);
 const o=FOOD_PHOTOS.items.get(key);if(!o)return Promise.resolve();
 const p=foodPhotoShopChoice(key);if(p&&FOOD_PHOTO_RANK(p)>=75)return Promise.resolve();   // 登録写真・確認済みのお店の写真があれば、ネットでは探さない
 if(!force&&foodPhotoCached(key)?.until>Date.now())return Promise.resolve();
 let finish;const job=new Promise(r=>finish=r);FOOD_PHOTOS.pending.set(key,job);FOOD_PHOTOS.queue.push({key,finish});foodPhotoPump();return job;
}
function foodPhotoPump(){while(FOOD_PHOTOS.active<4&&FOOD_PHOTOS.queue.length){const {key,finish}=FOOD_PHOTOS.queue.shift();if(!document.querySelector(`[data-food-photo="${CSS.escape(key)}"]`)){FOOD_PHOTOS.pending.delete(key);finish();continue;}FOOD_PHOTOS.active++;foodPhotoLoad(key).catch(()=>{foodPhotoRemember(key,{until:Date.now()+60000});}).finally(()=>{FOOD_PHOTOS.active--;FOOD_PHOTOS.pending.delete(key);finish();foodPhotoPump();});}}
const foodPhotoObserver=typeof IntersectionObserver==='function'?new IntersectionObserver(entries=>{for(const x of entries)if(x.isIntersecting){foodPhotoObserver.unobserve(x.target);foodPhotoRequest(x.target.dataset.foodPhoto);}}, {rootMargin:'200px'}):null;
const foodOldHydrate=hydrateImages;
hydrateImages=function(){foodOldHydrate();foodPhotoObserver?.disconnect();document.querySelectorAll('[data-food-photo]').forEach(el=>{if(foodPhotoObserver)foodPhotoObserver.observe(el);else foodPhotoRequest(el.dataset.foodPhoto);});};
function foodPhotoBroken(img){
 const key=img.closest('[data-food-photo]')?.dataset.foodPhoto;if(!key)return;
 const bad=img.getAttribute('src');if(!bad||bad==='img/food.jpg')return;
 FOOD_PHOTOS.failed.add(bad);
 const current=foodPhotoCached(key),p=current?.photo;
 const backup=p&&p.src===bad&&[PHOTO_CORE.imageURL(p.remote),p.proxy].find(src=>src&&!FOOD_PHOTOS.failed.has(src));
 if(backup){current.photo={...p,src:backup};foodPhotoRemember(key,current);}
 // お店の写真が読めなかったときは、料理イメージ（別の読み込み先）に切り替わる。空欄にはしない
 foodPhotoPaint(key);
}
const foodOldBookingPhoto=bookingPhoto;
bookingPhoto=function(o,size){return o&&(o.food||o.meal||o.cuisine||bookingID(o).startsWith('hotpepper:'))?foodPhotoSlot(o,size):foodOldBookingPhoto(o,size);};
async function foodPhotoRefresh(id,manual=false){const o=S.wishes.find(w=>w.id===id);if(!o)return;const key=foodPhotoKey(o);FOOD_PHOTOS.items.set(key,{...o});if(manual){FOOD_PHOTOS.results.delete(key);try{sessionStorage.removeItem(FOOD_PHOTO_CACHE+key);}catch{}for(const src of [o.ownPhoto,o.apiPhoto,bookingMedia(o).url])if(src)FOOD_PHOTOS.failed.delete(src);}await foodPhotoRequest(key,manual);foodPhotoPaint(key);}
