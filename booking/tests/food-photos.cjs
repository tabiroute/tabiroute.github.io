/* 有名店・お店の写真が「必ず」出ることと、表示が速いことを確かめるテスト。
   使い方: node booking/tests/food-photos.cjs  （playwright が必要。外部への通信はすべて止め、写真サーバーは偽物で置き換える） */
const {chromium}=require('playwright'),fs=require('fs'),path=require('path'),http=require('http'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../..');
const jpg=fs.readFileSync(path.join(root,'img/food.jpg'));
const calls=[];
// ホットペッパーの検索結果（表記ゆれのある同じお店と、名前の似た別の支店）
const hp=[
 {id:'J000000101',name:'スパゲッティハウス チャオ BINO栄店',lat:35.16905,lng:136.90649,address:'愛知県名古屋市中区錦３－２４－１７ ＢＩＮＯ栄Ｂ１',genre:'イタリアン・フレンチ',photo:'https://imgfp.hotp.jp/ciao.jpg',url:'https://www.hotpepper.jp/strJ000000101/'},
 {id:'J000000102',name:'スパゲッティハウス チャオ 名駅店',lat:35.1705,lng:136.882,address:'愛知県名古屋市中村区名駅1-1-1',genre:'イタリアン・フレンチ',photo:'https://imgfp.hotp.jp/ciao2.jpg',url:'https://www.hotpepper.jp/strJ000000102/'}
];
const server=http.createServer((req,res)=>{const url=new URL(req.url,'http://localhost');
 if(url.pathname.startsWith('/api/')){calls.push(url);res.setHeader('Content-Type','application/json');
  if(url.pathname==='/api/restaurants'){const q=url.searchParams.get('q')||'';res.end(JSON.stringify({ok:true,items:hp.filter(h=>h.name.includes(q)),expiresAt:Date.now()+3600000,fetchedAt:Date.now()}));return;}
  if(url.pathname==='/api/food-photos'){res.end(JSON.stringify({ok:true,version:'food-photo-v2',status:'missing',photos:[],expiresAt:Date.now()+300000}));return;}
  if(url.pathname==='/api/photo-image'){res.setHeader('Content-Type','image/jpeg');res.end(jpg);return;}
  res.statusCode=404;res.end('{}');return;}
 const rel=url.pathname==='/'?'index.html':decodeURIComponent(url.pathname.slice(1));const file=path.resolve(root,rel);
 if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||fs.statSync(file).isDirectory()){res.statusCode=404;res.end('missing');return;}
 res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.html')?'text/html; charset=utf-8':file.endsWith('.json')?'application/json':file.endsWith('.jpg')?'image/jpeg':'application/octet-stream');
 if(rel==='booking/config.js'){res.end('window.TABIROUTE_BOOKING={apiBase:location.origin+"/api",enabled:true};window.TABIROUTE_PLACE_MEDIA={};');return;}
 res.end(fs.readFileSync(file));});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 const exe=process.env.CHROME||['/opt/pw-browsers/chromium-1194/chrome-linux/chrome',path.resolve(root,'../browser-runtime/chromium-route')].find(p=>fs.existsSync(p));
 const browser=await chromium.launch({headless:true,...(exe?{executablePath:exe}:{}),args:['--no-sandbox','--disable-gpu','--no-zygote']});
 let wiki=0;
 try{
  const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',r=>{const u=r.request().url();
   if(u.startsWith(origin))return r.continue();
   if(/^https:\/\/(thumb|upload)\.wikimedia\.org\//.test(u)){wiki++;return r.fulfill({status:200,contentType:'image/jpeg',body:jpg});}
   if(/^https:\/\/imgfp\.hotp\.jp\//.test(u))return r.fulfill({status:200,contentType:'image/jpeg',body:jpg});
   return r.abort();});
  await page.goto(origin);await page.waitForFunction(()=>typeof APP!=='undefined'&&APP.view==='home'&&typeof foodPhotoSlot==='function');
  await page.click('[data-app="open"][data-v="lsample"]');await page.waitForFunction(()=>S&&APP.view==='project');

  // 1) 全都道府県の有名店：カードを描いた瞬間に写真がある（「写真未取得」「検索中」が1枚もない）
  const all=await page.evaluate(async()=>{
   await f4Catalog();const t0=performance.now();
   const html=F4.cat.map(f=>f4Card({...f})).join('');const ms=performance.now()-t0;
   const box=document.createElement('div');box.id='t';box.innerHTML=html;document.body.append(box);
   const figs=[...box.querySelectorAll('[data-food-photo]')];
   const prefs=new Set(F4.cat.map(f=>f.pref));
   const noImg=figs.filter(f=>!f.querySelector('img')).length,empty=box.querySelectorAll('.food-photo-empty').length;
   const generic=figs.filter(f=>f.querySelector('img')?.getAttribute('src')==='img/food.jpg').length;
   const withGeo=F4.cat.filter(f=>Number.isFinite(f.lat)&&Number.isFinite(f.lng)).length;
   box.remove();
   return {shops:F4.cat.length,prefs:prefs.size,figs:figs.length,noImg,empty,generic,ms:Math.round(ms),withGeo};
  });
  console.log('famous shops',all);
  assert.equal(all.prefs,47);assert.equal(all.figs,all.shops);assert.equal(all.noImg,0);assert.equal(all.empty,0);
  assert.equal(all.generic,0,'every famous shop gets a photo of its own dish, not the generic fallback');
  assert.equal(all.withGeo,all.shops,'every famous shop has coordinates (no geocoding while the list is shown)');
  assert(all.ms<1500,'rendering all cards with photos is fast: '+all.ms+'ms');

  // 2) 料理名の対応：あんかけスパの有名店にはあんかけスパの写真、別名（デニム丼など）は写っている料理名を出す
  const map=await page.evaluate(()=>({
   ankake:foodDishPhoto({dish:'あんかけスパ',name:'スパゲティハウス チャオ BINO栄店',pref:'愛知県'}).dish,
   denim:foodDishPhoto({dish:'デニム丼',name:'x',pref:'岡山県'}).dish,
   hpRamen:foodDishPhoto({name:'麺屋 一番',genre:'ラーメン',genreCode:'G013',pref:'東京都'}).dish,
   cafe:foodDishPhoto({name:'珈琲館 栄',pref:'愛知県'}).dish,
   unknown:foodDishPhoto({name:'みどり',pref:'北海道'}).dish,
   unknownCity:foodDishPhoto({name:'みどり',pref:'愛知県',city:'名古屋市'}).dish,
   shortWord:foodDishPhoto({name:'イカリ亭',pref:'千葉県'}).dish
  }));
  console.log('dish mapping',map);
  assert.equal(map.ankake,'あんかけスパ');assert.equal(map.denim,'海鮮丼');assert.equal(map.hpRamen,'ラーメン');assert.equal(map.cafe,'カフェ');
  assert.equal(map.unknown,'ジンギスカン','unknown shops show the prefecture specialty');assert.equal(map.unknownCity,'ひつまぶし');
  assert.notEqual(map.shortWord,'イカ');

  // 3) 店名・住所の照合：表記ゆれ（ッ・全角・号）は同じお店、別の支店は別のお店
  const match=await page.evaluate(()=>{const o={name:'スパゲティハウス チャオ BINO栄店',addr:'愛知県名古屋市中区錦3-24-17 BINO栄B1階',lat:35.16904,lng:136.90648,geoExact:true};
   return {same:foodPhotoMatch(o,{name:'スパゲッティハウス チャオ BINO栄店',address:'愛知県名古屋市中区錦３－２４－１７ ＢＩＮＯ栄Ｂ１',lat:35.16905,lng:136.90649}),
    branch:foodPhotoMatch(o,{name:'スパゲッティハウス チャオ 名駅店',address:'愛知県名古屋市中村区名駅1-1-1',lat:35.1705,lng:136.882}),
    otherAddr:foodPhotoMatch({name:'五香飯店',addr:'北海道小樽市花園1丁目6-6'},{name:'五香飯店',address:'北海道札幌市中央区1-1'}),
    kanji:foodPhotoMatch({name:'中華食堂 桂苑',addr:'北海道小樽市稲穂2丁目16-14'},{name:'中華食堂 桂苑',address:'北海道小樽市稲穂二丁目16番14号'}),
    shortName:foodPhotoMatch({name:'中華食堂 桂苑',addr:'北海道小樽市稲穂2丁目16-14'},{name:'桂苑',address:'北海道小樽市稲穂２－１６－１４　都通り商店街アーケード内'}),
    okurigana:foodPhotoMatch({name:'網焼レストラン 見蘭',addr:'山口県萩市堀内89 ミドリヤファーム内'},{name:'網焼きレストラン 見蘭',address:'山口県萩市堀内89'}),
    sameBuildingOtherShop:foodPhotoMatch({name:'一花亭たびじ',addr:'北海道函館市若松町9-15 函館朝市どんぶり横丁市場'},{name:'朝市食堂 函館ぶっかけ',address:'北海道函館市若松町９－１５'}),
    keyword:[foodShopKeyword('スパゲティハウス チャオ BINO栄店'),foodShopKeyword('中華食堂 桂苑'),foodShopKeyword('成吉思汗 だるま 本店'),foodShopKeyword('五香飯店')]};});
  console.log('matching',match);
  assert.equal(match.same,true);assert.equal(match.branch,false);assert.equal(match.otherAddr,false);assert.equal(match.kanji,true);assert.equal(match.shortName,true);assert.equal(match.okurigana,true);assert.equal(match.sameBuildingOtherShop,false);
  assert.deepEqual(match.keyword,['チャオ','桂苑','だるま','五香飯店']);

  // 4) 画面に出た有名店は、裏でお店自身の写真（ホットペッパー）に差し替わる。料理イメージは先に出ている
  const swap=await page.evaluate(async()=>{
   await f4Catalog();const f=F4.cat.find(x=>x.name==='スパゲティハウス チャオ BINO栄店');
   const box=document.createElement('div');box.innerHTML=f4Card({...f});document.body.prepend(box);
   const first=box.querySelector('img').getAttribute('src'),label=box.querySelector('.food-photo-label').textContent;
   hydrateImages();
   for(let i=0;i<50&&!box.querySelector('img').src.includes('hotp.jp');i++)await new Promise(r=>setTimeout(r,100));
   return {first,label,after:box.querySelector('img').getAttribute('src'),afterLabel:box.querySelector('.food-photo-label').textContent};
  });
  console.log('swap',swap);
  assert(/thumb\.wikimedia\.org/.test(swap.first));assert.equal(swap.label,'料理イメージ');
  assert.equal(swap.after,'https://imgfp.hotp.jp/ciao.jpg');assert.equal(swap.afterLabel,'店舗写真');
  const hpCalls=calls.filter(u=>u.pathname==='/api/restaurants');
  assert.equal(hpCalls.length,1);assert.equal(hpCalls[0].searchParams.get('q'),'チャオ');assert(hpCalls[0].searchParams.get('lat'));

  // 5) 写真が読めないときは、写真プロキシ → たびルートの料理写真に切り替わり、空欄にならない
  const broken=await page.evaluate(async()=>{
   const box=document.createElement('div');box.innerHTML=foodPhotoSlot({name:'テスト食堂',pref:'沖縄県',food:true},'result');document.body.prepend(box);
   const steps=[];for(let i=0;i<3;i++){const img=box.querySelector('img');steps.push(img.getAttribute('src'));foodPhotoBroken(img);}
   steps.push(box.querySelector('img').getAttribute('src'));return steps;});
  console.log('broken',broken.map(s=>s.slice(0,60)));
  assert(/thumb\.wikimedia/.test(broken[0]));assert(/photo-image/.test(broken[1]));assert(/upload\.wikimedia/.test(broken[2]));assert.equal(broken[3],'img/food.jpg');

  // 6) 実際の画面（愛知県・あんかけスパ・有名店）
  await page.evaluate(async()=>{document.querySelectorAll('body>div:not([id])').forEach(x=>x.remove());});
  assert.deepEqual(errors,[]);
  console.log('wikimedia image requests (served locally in this test):',wiki);
  console.log('ok');
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exit(1);});
