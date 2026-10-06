const {chromium}=require('playwright'),fs=require('fs'),path=require('path'),http=require('http'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../..');
const calls=[];let mode='ok';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=','base64');
const hotel={id:'12345',name:'テスト京都ホテル',lat:34.9858,lng:135.7588,address:'京都府京都市下京区',photo:'https://img.travel.rakuten.co.jp/hotel.jpg',url:'https://travel.rakuten.co.jp/HOTEL/12345/12345.html',planUrl:'https://hotel.travel.rakuten.co.jp/hotelinfo/plan/12345',rating:4.25,reviewCount:123,access:'京都駅より徒歩5分'};
const shop={id:'J000000001',name:'京都ごはん 本店',lat:34.986,lng:135.759,address:'京都府京都市下京区1',genre:'和食',hours:'11:00～20:00',photo:'https://imgfp.hotp.jp/food.jpg',url:'https://www.hotpepper.jp/strJ000000001/',budget:'ランチ 1,000円'};
const server=http.createServer((req,res)=>{const url=new URL(req.url,'http://localhost');if(url.pathname.startsWith('/api/')){calls.push(url);res.setHeader('Content-Type','application/json');if(mode==='html'){res.statusCode=429;res.end('error code: 1027');return;}if(mode==='fail'){res.statusCode=429;res.end(JSON.stringify({ok:false,code:'provider_limited',retryAfter:300}));return;}const items=url.pathname==='/api/hotels'?[hotel]:url.pathname==='/api/restaurants'?[shop]:[{name:'朝食付きプラン',room:'ツイン',url:'https://hotel.travel.rakuten.co.jp/hotelinfo/plan/12345?f_otona_su=2'}];res.end(JSON.stringify({ok:true,items,expiresAt:Date.now()+(url.pathname.endsWith('availability')?60000:3600000),fetchedAt:Date.now()}));return;}
 const rel=url.pathname==='/'?'index.html':url.pathname.slice(1);const file=path.resolve(root,rel);if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||fs.statSync(file).isDirectory()){res.statusCode=404;res.end('missing');return;}res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.html')?'text/html; charset=utf-8':'application/octet-stream');if(rel==='booking/config.js'){res.end('window.TABIROUTE_BOOKING={apiBase:location.origin+"/api",enabled:true};window.TABIROUTE_PLACE_MEDIA={};');return;}res.end(fs.readFileSync(file));});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({headless:true,executablePath:path.resolve(root,'../browser-runtime/chromium-route'),args:['--no-sandbox','--disable-gpu','--no-zygote']});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',r=>r.request().url().startsWith(origin)?r.continue():r.abort());
  await page.goto(origin);await page.addStyleTag({url:origin+'/shiori/assets/fonts.css'});await page.addStyleTag({content:'body,input,button,select,h1,h2,h3,span{font-family:JournalJP,sans-serif!important}'});await page.evaluate(()=>document.fonts.ready);await page.waitForFunction(()=>typeof APP!=='undefined'&&APP.view==='home');
  await page.click('[data-app="open"][data-v="lsample"]');
  await page.waitForFunction(()=>S&&APP.view==='project');
  await page.evaluate(()=>{S.step=5;S.date=isoToday(30);S.days=3;S.mealDecisions={};S.stayDecision='';S.hotelMode='';S.hotelCands=[];S.hotelName='';S.hotelLoc=null;S.picks=[];S.wishes=[
   {id:'a',name:'清水寺',lat:34.9949,lng:135.785,stay:90,status:'ok'},
   {id:'b',name:'八坂神社',lat:35.0037,lng:135.7785,stay:90,status:'ok'},
   {id:'c',name:'金閣寺',lat:35.0394,lng:135.7292,stay:90,status:'ok'},
   {id:'d',name:'嵐山',lat:35.0094,lng:135.6668,stay:90,status:'ok'},
   {id:'e',name:'伏見稲荷大社',lat:34.9671,lng:135.7727,stay:90,status:'ok'}
  ];S.dayOf={a:0,b:0,c:1,d:1,e:2};S.manualOrd={0:['a','b'],1:['c','d'],2:['e']};render();});
  assert.equal(calls.length,0,'initial question does not request APIs');
  assert.equal(await page.locator('#routeFoodSearch').count(),0);
  await page.click('[data-route-food="undecided"]');await page.waitForFunction(()=>!ROUTE_UI.foodBusy);
  assert.equal(calls.length,1);assert(await page.locator('.pref-chips').isVisible());
  assert(/清水寺|八坂神社/.test(await page.locator('.booking-route').innerText()));
  assert.equal(await page.locator('.booking-card h3').textContent(),shop.name);
  await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:path.join(root,'booking/docs/route-food-mobile.png'),fullPage:true});
  const firstCenter=calls.at(-1).searchParams.get('lat');
  const before=calls.length;await page.evaluate(()=>{render();render();});assert.equal(calls.length,before);
  await page.selectOption('[data-route-day]','1');
  await page.click('[data-route-food="undecided"]');await page.waitForFunction(()=>!ROUTE_UI.foodBusy);
  assert.notEqual(calls.at(-1).searchParams.get('lat'),firstCenter,'day selection changes location');
  await page.click('[data-route-addfood="0"]');
  assert.equal(await page.evaluate(()=>S.wishes.find(w=>w.hpId)?.day),2,'restaurant pinned to chosen day');
  assert.equal(await page.evaluate(()=>buildPlan().days[1].ord.some(w=>w.meal==='昼')),true);
  // Same restaurant can be used on a different day; another choice replaces only its slot.
  await page.selectOption('[data-route-day]','0');await page.waitForFunction(()=>!ROUTE_UI.foodBusy);
  await page.click('[data-route-addfood="0"]');
  assert.equal(await page.evaluate(()=>S.wishes.filter(w=>w.hpId).length),2);
  await page.click('[data-route-slot="夜"]');assert.equal(await page.locator('#routeFoodSearch').count(),0);
  await page.click('[data-route-food="decided"]');await page.fill('#routeFoodQuery','京都ごはん');await page.locator('#routeFoodSearch button').click();await page.waitForFunction(()=>!ROUTE_UI.foodBusy);
  assert.equal(calls.at(-1).searchParams.get('q'),'京都ごはん');
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'mobile food overflow');
  // Decisions and selected food are persisted in the plan, not only transient UI.
  assert.equal(await page.evaluate(()=>planOf(S).mealDecisions['0|夜']),'decided');
  await page.evaluate(()=>{S.step=6;render();});assert.equal(await page.locator('[data-bk-field]').count(),0);
  assert.notEqual(await page.evaluate(()=>canNext()),true);
  await page.click('[data-route-stay="undecided"]');await page.waitForFunction(()=>!ROUTE_UI.hotelBusy);
  assert.equal(await page.evaluate(()=>canNext()),true);
  assert.equal(await page.locator('.booking-card h3').textContent(),hotel.name);
  assert(await page.locator('.booking-conditions').isVisible());assert.equal(await page.locator('.booking-conditions').getAttribute('open'),null);
  await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:path.join(root,'booking/docs/route-hotel-mobile.png'),fullPage:true});
  await page.locator('.booking-conditions summary').click();await page.selectOption('[data-bk-field="adults"]','3');
  // Keep the condition editor open across field edits.
  assert.notEqual(await page.locator('.booking-conditions').getAttribute('open'),null);await page.selectOption('[data-bk-field="rooms"]','2');
  await page.click('[data-bk-availability]');await page.locator('.booking-plan').waitFor();
  assert.equal(calls.at(-1).searchParams.get('adults'),'3');assert.equal(calls.at(-1).searchParams.get('rooms'),'2');
  await page.click('[data-bk-pick]');assert.equal(await page.evaluate(()=>hotelPoint(stopsAll()).name),hotel.name);
  await page.click('[data-route-split="1"]');await page.waitForFunction(()=>!ROUTE_UI.hotelBusy);
  await page.selectOption('[data-route-night]','1');await page.waitForFunction(()=>!ROUTE_UI.hotelBusy);
  assert.equal(await page.evaluate(()=>bookingConditions().checkin),await page.evaluate(()=>bookingISO(dayDate(1))));
  await page.click('[data-bk-pick]');assert.equal(await page.evaluate(()=>hotelPoint(stopsAll(),1).name),hotel.name);
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'mobile hotel overflow');
  await page.evaluate(()=>{S.step=7;render();});assert(await page.locator('[data-route-open-food]').count());
  await page.locator('[data-route-open-food="0|夜"]').click();assert.equal(await page.evaluate(()=>S.step),5);assert.equal(await page.evaluate(()=>bookingFoodSlot()),'夜');
  // API failure keeps local proposals and external links, and stops repeated requests.
  await page.evaluate(()=>{for(const k of Object.keys(sessionStorage))if(k.startsWith('tb-api-pause'))sessionStorage.removeItem(k);});
  mode='fail';await page.click('[data-route-food="undecided"]');await page.waitForFunction(()=>!ROUTE_UI.foodBusy);
  // The first near request can be cached. Use a unique dish query to force an upstream request.
  await page.evaluate(()=>bookingRouteFoodSearch('限度テスト'));await page.waitForFunction(()=>!ROUTE_UI.foodBusy);
  assert(/混み合っています|一時休止/.test(await page.locator('.booking-notice').innerText()));
  const limited=calls.length;await page.evaluate(()=>bookingRouteFoodSearch('二度目'));await page.waitForFunction(()=>!ROUTE_UI.foodBusy);assert.equal(calls.length,limited);
  assert(await page.locator('.pref-chips').isVisible());assert(await page.locator('a[href*="hotpepper.jp/CSP"]').count());
  await page.evaluate(()=>{BOOKING_CFG.apiBase='';S.step=6;S.hotelSplit=false;render();});await page.click('[data-route-refresh-stay]');await page.waitForFunction(()=>!ROUTE_UI.hotelBusy);
  assert((await page.locator('.booking-notice').innerText()).includes('予約サイト'));
  assert(await page.locator('.booking-route').isVisible());
  await page.evaluate(()=>{S.days=1;S.hotelMode='';S.stayDecision='';render();});assert.equal(await page.evaluate(()=>canNext()),true);
  assert((await page.locator('#main').innerText()).includes('日帰り'));
  assert.deepEqual(errors,[]);
  // Pure route/ranking assertions against ordered stops, local food and hotel endpoints.
  const unit=await page.evaluate(()=>{
   const a={name:'A',lat:35,lng:135},b={name:'B',lat:35,lng:135.02},c={name:'C',lat:36,lng:136};
   const ctx={before:a,after:b,center:a,foods:['湯豆腐']};
   const ranked=bookingRankFood([{name:'遠い店',lat:36,lng:136},{name:'湯豆腐の店',lat:35,lng:135.01,cuisine:'和食'}],ctx);
   const first=bookingMealContext(0,'昼',{days:[{ord:[a,b],items:[{type:'stop',s:a,t:660,dur:60},{type:'lunch',t:720},{type:'stop',s:b,t:800}]}]});
   const second=bookingMealContext(0,'昼',{days:[{ord:[b,a],items:[{type:'stop',s:b,t:660,dur:60},{type:'lunch',t:720},{type:'stop',s:a,t:800}]}]});
   S.days=3;S.hotelSplit=true;S.bookingNight=0;
   const stay=bookingStayContext({days:[{ord:[a,b]},{ord:[c]}]});
   return {rank:ranked[0].name,before:first.before.name,after:first.after.name,reversed:second.before.name,hotelFrom:stay.pairs[0].before.name,hotelTo:stay.pairs[0].after.name};
  });
  assert.deepEqual(unit,{rank:'湯豆腐の店',before:'A',after:'B',reversed:'B',hotelFrom:'B',hotelTo:'C'});
  await page.setViewportSize({width:1440,height:960});await page.evaluate(()=>{S.step=6;S.stayDecision='';S.hotelMode='';S.hotelName='';render();window.scrollTo(0,0);});assert(await page.locator('[data-route-stay="decided"]').isVisible());assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:path.join(root,'booking/docs/route-desktop.png'),fullPage:true});
  // Date changes keep stay length, including month/year boundaries and leap years.
  await page.evaluate(()=>{S.step=6;S.date='2026-11-25';S.days=3;S.booking={};S.hotelSplit=false;S.stayDecision='undecided';ROUTE_UI.conditionsOpen=true;render();});
  await page.fill('[data-bk-field="checkin"]','2026-12-31');await page.locator('[data-bk-field="checkin"]').dispatchEvent('change');
  assert.equal(await page.locator('[data-bk-field="checkout"]').inputValue(),'2027-01-02');
  await page.fill('[data-bk-field="checkout"]','2027-01-01');await page.locator('[data-bk-field="checkout"]').dispatchEvent('change');
  await page.fill('[data-bk-field="checkin"]','2026-11-25');await page.locator('[data-bk-field="checkin"]').dispatchEvent('change');
  assert.equal(await page.locator('[data-bk-field="checkout"]').inputValue(),'2026-11-26');
  assert.equal(await page.evaluate(()=>bookingAddDays('2028-02-28',1)),'2028-02-29');
  assert.equal(await page.evaluate(()=>bookingAddDays('2026-02-30',1)),'');
  // Moving a two-night trip then switching nights keeps a single consecutive stay calendar.
  await page.evaluate(()=>{S.booking={startDate:'2026-12-31',stayNights:2};S.stayDecision='decided';S.hotelMode='decided';S.hotelName='';S.hotelLoc=null;S.hotelInfo=null;S.nights=[];S.stayDecisions={};render();});
  await page.click('[data-route-split="1"]');
  assert.equal(await page.locator('[data-bk-field="checkout"]').inputValue(),'2027-01-01');
  await page.locator('.booking-manual summary').click();await page.fill('#routeHotelName','京都の宿A');await page.fill('#routeHotelCoords','35.01, 135.77');await page.click('[data-route-manual-stay]');
  await page.selectOption('[data-route-night]','1');
  assert.equal(await page.locator('[data-bk-field="checkin"]').inputValue(),'2027-01-01');
  assert.equal(await page.locator('[data-bk-field="checkout"]').inputValue(),'2027-01-02');
  assert.equal(await page.locator('[data-bk-field="checkout"]').getAttribute('readonly'),'');
  await page.locator('.booking-manual summary').click();await page.fill('#routeHotelName','奈良の宿B');await page.fill('#routeHotelCoords','34.685, 135.805');await page.click('[data-route-manual-stay]');
  const chain=await page.evaluate(()=>{const p=buildPlan();return {night1:p.nightHotels[0].name,night2:p.nightHotels[1].name,day2From:p.days[1].from.name,day2To:p.days[1].to.name,day3From:p.days[2].from.name,map:mapHotelPoints(p,p.days).map(x=>x.name),persist:planOf(S).nights.map(n=>n.name)}});
  assert.deepEqual(chain,{night1:'京都の宿A',night2:'奈良の宿B',day2From:'京都の宿A',day2To:'奈良の宿B',day3From:'奈良の宿B',map:['京都の宿A','奈良の宿B'],persist:['京都の宿A','奈良の宿B']});
  await page.setViewportSize({width:390,height:844});await page.evaluate(()=>{ROUTE_UI.conditionsOpen=true;render();window.scrollTo(0,0);});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.addStyleTag({content:'.toast{visibility:hidden!important}'});await page.screenshot({path:path.join(root,'booking/docs/stay-v5-split-mobile.png'),fullPage:true});
  await page.click('[data-route-select-night="0"]');
  assert.equal(await page.evaluate(()=>bookingConditions().checkin),'2026-12-31');
  await page.click('[data-route-split="0"]');assert.equal(await page.evaluate(()=>bookingConditions().checkout),'2027-01-02');
  const comparison=await page.evaluate(()=>{const a={name:'京都',lat:35,lng:135},b={name:'南部',lat:34,lng:136};return bookingStayComparison({days:[{ord:[a]},{ord:[a,b]},{ord:[b]}]});});
  assert.equal(comparison.recommend,true);assert(comparison.gain>12);
  // A no-vacancy response has a specific explanation and a working provider-returned plan-list URL.
  await page.evaluate(({hotel})=>{S.booking={};S.hotelSplit=false;S.stayDecision='undecided';S.hotelName='';S.hotelMode='undecided';S.hotelPick=-1;const h={name:hotel.name,hotelNo:hotel.id,lat:hotel.lat,lng:hotel.lng,rkURL:hotel.url,rkPlanURL:hotel.planUrl,routeDistance:1.3};ROUTE_UI.hotel={key:bookingStayKey(),items:[h],expiresAt:Date.now()+60000};BOOKING_UI.availability[h.hotelNo]={key:JSON.stringify(bookingConditions()),project:APP.pid,data:{items:[],availabilityStatus:'no_availability',expiresAt:Date.now()+60000,fetchedAt:Date.now()}};render();},{hotel});
  assert((await page.locator('.booking-plans').innerText()).includes('空室はAPIでは見つかりませんでした'));
  assert.equal(await page.locator('.booking-card a').filter({hasText:'楽天で空室・宿泊プランを確認'}).getAttribute('href'),hotel.planUrl);
  for(const [selector,pathPart] of [['[data-route-stay="decided"] img','ic-hotel.png'],['[data-route-stay="undecided"] img','ic-hotel-undecided.png']]){assert((await page.locator(selector).getAttribute('src')).endsWith(pathPart));assert(await page.locator(selector).evaluate(img=>img.complete&&img.naturalWidth>0));}
  await page.evaluate(()=>window.scrollTo(0,0));await page.addStyleTag({content:'.toast{visibility:hidden!important}'});await page.screenshot({path:path.join(root,'booking/docs/stay-v5-links-mobile.png'),fullPage:true});
  await page.evaluate(()=>{S.step=5;render();window.scrollTo(0,0);});
  await page.locator('[data-route-food="decided"] img').waitFor();
  await page.waitForFunction(()=>[...document.querySelectorAll('.booking-choice-icon img')].every(img=>img.complete&&img.naturalWidth>0));
  await page.addStyleTag({content:'.toast{visibility:hidden!important}'});await page.screenshot({path:path.join(root,'booking/docs/stay-v5-food-mobile.png'),fullPage:true});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  assert.deepEqual(errors,[]);
  await page.setViewportSize({width:1440,height:1000});await page.evaluate(()=>{S.step=6;S.hotelSplit=true;S.bookingNight=0;ROUTE_UI.conditionsOpen=false;render();window.scrollTo(0,0);});await page.addStyleTag({content:'.toast{visibility:hidden!important}'});await page.screenshot({path:path.join(root,'booking/docs/stay-v5-desktop.png'),fullPage:true});
  console.log('PASS: decision-first mobile flow, route/day-aware search, local dishes, exact day insertion, repeated shop across days, dates/occupancy, split hotels, result entry points, persistence, quota fallback, missing config, day trip and ranking; v5 date shifts, leap dates, multi-hotel route chain/map/persistence, no-vacancy fallback, generated/ existing icons');
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
