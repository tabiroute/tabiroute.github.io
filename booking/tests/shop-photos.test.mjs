import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const S=require('../shop-photo-core.js');

const env={ALLOWED_ORIGINS:'https://tabiroute.github.io',SITE_URL:'https://tabiroute.github.io/'};
const ctx={waitUntil:p=>p.catch(()=>{})};
const req=path=>new Request('https://example.workers.dev'+path,{headers:{Origin:'https://tabiroute.github.io','CF-Connecting-IP':'1.2.3.'+Math.floor(Math.random()*200)}});
const shop={name:'スパゲティハウス チャオ BINO栄店',addr:'愛知県名古屋市中区錦3-24-17 BINO栄B1階',lat:'35.16904',lng:'136.90648',pref:'愛知県'};
const meta=(desc,lic='CC BY-SA 4.0',gps)=>({ImageDescription:{value:desc},LicenseShortName:{value:lic},LicenseUrl:{value:'https://creativecommons.org/licenses/by-sa/4.0'},Artist:{value:'Taro'},...(gps?{GPSLatitude:{value:String(gps[0])},GPSLongitude:{value:String(gps[1])}}:{})});
const page=(title,desc,gps)=>({title:'File:'+title,imageinfo:[{url:'https://upload.wikimedia.org/wikipedia/commons/a/ab/'+encodeURIComponent(title),thumburl:'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/x.jpg/500px-x.jpg',mime:'image/jpeg',width:1600,height:1200,extmetadata:meta(desc,undefined,gps)}]});

function mock({freePhotos=true,site=true}={}){
 const seen=[];
 globalThis.fetch=async(url,opt={})=>{const u=new URL(typeof url==='string'?url:url.url);seen.push(u.href);
  if(/overpass/.test(u.hostname)){
   const body=decodeURIComponent(String(opt.body||'').replace(/^data=/,''));assert.match(body,/around:150,35.16904,136.90648/);
   return Response.json({elements:[
    {type:'node',id:1,lat:35.16905,lon:136.90649,tags:{name:'スパゲッティハウス チャオ BINO栄店',amenity:'restaurant',...(site?{website:'https://ciao.example.jp/shop/'}:{}),...(freePhotos?{wikidata:'Q900'}:{})}},
    {type:'node',id:2,lat:35.1691,lon:136.9065,tags:{name:'スパゲッティハウス チャオ 名駅店',amenity:'restaurant',website:'https://wrong.example.jp/'}},
    {type:'node',id:3,lat:35.1691,lon:136.9065,tags:{name:'喫茶 となり',amenity:'cafe',website:'https://tonari.example.jp/'}}]});
  }
  if(u.hostname==='commons.wikimedia.org'){
   const g=u.searchParams.get('generator'),titles=u.searchParams.get('titles');
   if(g==='geosearch')return Response.json({query:{pages:freePhotos?[page('Ciao BINO Sakae.jpg','スパゲッティハウス チャオ BINO栄店の店先'),page('Nagoya street.jpg','錦三丁目の通り')]:[]}});
   if(g==='search')return Response.json({query:{pages:freePhotos?[page('Ciao ankake.jpg','チャオのあんかけスパ',[35.169,136.9065]),page('Ciao far away.jpg','チャオ',[35.5,137.5])]:[]}});
   if(titles)return Response.json({query:{pages:titles.split('|').map(t=>page(t.replace(/^File:/,''),'Wikidata'))}});
  }
  if(u.hostname==='ja.wikipedia.org')return Response.json({query:{pages:[]}});
  if(u.hostname==='www.wikidata.org')return Response.json({entities:{Q900:{claims:{P18:[{rank:'normal',mainsnak:{datavalue:{value:'Ciao exterior.jpg'}}}]}}}});
  if(u.hostname==='ciao.example.jp'&&u.pathname==='/shop/')return new Response('<html><head><meta property="og:image" content="/img/logo.png"><meta property="og:image" content="/img/shop-top.jpg"></head><body>x</body></html>',{headers:{'Content-Type':'text/html; charset=utf-8'}});
  if(u.hostname==='ciao.example.jp'&&u.pathname==='/img/shop-top.jpg')return new Response(new Uint8Array(20000),{headers:{'Content-Type':'image/jpeg','Content-Length':'20000'}});
  return new Response('not found',{status:404});
 };
 return seen;
}

test('core: same shop by name variant, not another branch or a different shop',()=>{
 assert.equal(S.sameShop('スパゲティハウス チャオ BINO栄店','スパゲッティハウス チャオ BINO栄店'),true);
 assert.equal(S.nameMatch('スパゲティハウス チャオ BINO栄店','スパゲッティハウス チャオ 名駅店'),false);
 assert.equal(S.sameShop('中華食堂 桂苑','桂苑'),true);
 assert.equal(S.sameShop('中華食堂 桂苑','喫茶 となり'),false);
 const pic=(title,d='')=>S.aboutShop({title,imageinfo:[{extmetadata:{ImageDescription:{value:d}}}]});
 assert.equal(pic('File:View of Shumpanro Hotel.JPG'),true);assert.equal(pic('File:Japan National Route 9 near Shumpanro Hotel.JPG'),false);assert.equal(pic('File:x.jpg','春帆楼付近の道'),false);
});
test('core: website and og:image safety',()=>{
 assert.equal(S.websiteURL('http://127.0.0.1/'),'');assert.equal(S.websiteURL('https://localhost/'),'');assert.equal(S.websiteURL('https://www.instagram.com/shop'),'');
 assert.equal(S.websiteURL('https://tabelog.com/aichi/A2301/'),'');assert.equal(S.websiteURL('https://shop.example.jp:8080/'),'');
 assert.equal(S.websiteURL('https://shop.example.jp/menu'),'https://shop.example.jp/menu');
 assert.equal(S.pageImage('<meta name="twitter:image" content="http://shop.example.jp/a.jpg">','https://shop.example.jp/'),'https://shop.example.jp/a.jpg');
 assert.equal(S.pageImage('<meta property="og:image" content="/favicon.ico"><meta property="og:image" content="javascript:alert(1)">','https://shop.example.jp/'),'');
});

test('worker /shop-photos: OpenStreetMap + Wikidata + Commons (near / by name) give licensed photos of that shop',async()=>{
 const old=globalThis.fetch;const seen=mock();
 try{
  const worker=(await import('../worker/worker-v18.mjs?free')).default;
  const r=await worker.fetch(req('/shop-photos?'+new URLSearchParams(shop)),env,ctx),j=await r.json();
  assert.equal(r.status,200);assert.equal(j.status,'ready');assert.equal(j.version,'shop-photo-v1');
  const files=j.photos.map(p=>p.file);
  assert(files.includes('Ciao exterior.jpg'),'Wikidata photo from the OSM element');
  assert(files.includes('Ciao BINO Sakae.jpg'),'Commons photo taken near the shop');
  assert(!files.includes('Nagoya street.jpg'),'nearby photo without the shop name is not used');
  assert(!files.includes('Ciao far away.jpg'),'same name far away is not used');
  for(const p of j.photos){assert.equal(p.kind,'shop-free');assert(p.artist&&p.license);assert.match(p.src,/\/photo-image\?file=/);}
  assert(!seen.some(u=>u.includes('wrong.example.jp')||u.includes('tonari.example.jp')),'other shops\' websites are never opened');
 }finally{globalThis.fetch=old;}
});

test('worker /shop-photos: official website image when no free photo exists',async()=>{
 const old=globalThis.fetch;const seen=mock({freePhotos:false});
 try{
  const worker=(await import('../worker/worker-v18.mjs?official')).default;
  const r=await worker.fetch(req('/shop-photos?'+new URLSearchParams(shop)),env,ctx),j=await r.json();
  assert.equal(j.status,'ready');assert.equal(j.photos.length,1);
  const p=j.photos[0];assert.equal(p.kind,'official');assert.equal(p.src,'https://ciao.example.jp/img/shop-top.jpg');assert.equal(p.page,'https://ciao.example.jp/shop/');assert.match(p.credit,/ciao\.example\.jp/);
  assert(!seen.some(u=>u.endsWith('/img/logo.png')),'logo is skipped');
 }finally{globalThis.fetch=old;}
});

test('worker /shop-photos: the checked official site passed by the app is used even if OpenStreetMap has none',async()=>{
 const old=globalThis.fetch;mock({freePhotos:false,site:false});
 try{
  const worker=(await import('../worker/worker-v18.mjs?web')).default;
  const r=await worker.fetch(req('/shop-photos?'+new URLSearchParams({...shop,web:'https://ciao.example.jp/shop/'})),env,ctx),j=await r.json();
  assert.equal(j.status,'ready');assert.equal(j.photos[0].kind,'official');assert.equal(j.photos[0].src,'https://ciao.example.jp/img/shop-top.jpg');
  const bad=await worker.fetch(req('/shop-photos?'+new URLSearchParams({...shop,name:'別の店 テスト',web:'http://127.0.0.1/'})),env,ctx),k=await bad.json();
  assert.equal(k.status,'missing');
 }finally{globalThis.fetch=old;}
});

test('worker /shop-photos: nothing found is a normal empty answer; bad input is rejected',async()=>{
 const old=globalThis.fetch;mock({freePhotos:false,site:false});
 try{
  const worker=(await import('../worker/worker-v18.mjs?none')).default;
  let r=await worker.fetch(req('/shop-photos?'+new URLSearchParams(shop)),env,ctx);let j=await r.json();
  assert.equal(r.status,200);assert.equal(j.status,'missing');assert.deepEqual(j.photos,[]);
  r=await worker.fetch(req('/shop-photos?name=x&lat=35&lng=136'),env,ctx);assert.equal(r.status,400);
  r=await worker.fetch(req('/shop-photos?name=%E3%83%86%E3%82%B9%E3%83%88'),env,ctx);assert.equal(r.status,400);
  r=await worker.fetch(new Request('https://example.workers.dev/shop-photos?'+new URLSearchParams(shop),{headers:{Origin:'https://evil.example'}}),env,ctx);assert.equal(r.status,403);
 }finally{globalThis.fetch=old;}
});
