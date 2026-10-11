/* 旅のしおりのテスト：①「表紙と思い出フォトだけ」を選べる ②「ホテルに着いたら」が予定の途中に出ない
   使い方: node booking/tests/shiori.cjs （playwright が必要。外部への通信はしない） */
const {chromium}=require('playwright'),fs=require('fs'),path=require('path'),http=require('http'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../..');
const server=http.createServer((req,res)=>{const url=new URL(req.url,'http://localhost');const rel=decodeURIComponent(url.pathname.slice(1))||'index.html';const file=path.resolve(root,rel);
 if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||fs.statSync(file).isDirectory()){res.statusCode=404;res.end('missing');return;}
 res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.html')?'text/html; charset=utf-8':file.endsWith('.woff2')?'font/woff2':'application/octet-stream');res.end(fs.readFileSync(file));});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 const exe=process.env.CHROME||['/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find(p=>fs.existsSync(p));
 const browser=await chromium.launch({headless:true,...(exe?{executablePath:exe}:{}),args:['--no-sandbox','--disable-gpu','--no-zygote']});
 try{
  const ctx=await browser.newContext({viewport:{width:1280,height:900}}),page=await ctx.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',r=>r.request().url().startsWith(origin)?r.continue():r.abort());
  const url=origin+'/shiori/templates/tochigi.html?project=test1';
  await page.goto(url);await page.waitForSelector('.page.album');
  const count=()=>page.evaluate(()=>({pages:document.querySelectorAll('.page').length,itin:document.querySelectorAll('.page.itinerary').length,add:document.getElementById('add').hidden,pressed:[...document.querySelectorAll('#layoutSwitch [data-layout]')].map(b=>b.dataset.layout+':'+b.getAttribute('aria-pressed')).join(','),albumPng:document.querySelector('.page.album [data-png]')?.dataset.png}));

  // ① 初めはスケジュールあり（表紙・旅程・思い出）
  let c=await count();console.log('start',c);
  assert.equal(c.pages,3);assert.equal(c.itin,1);assert.equal(c.add,false);assert.equal(c.pressed,'full:true,photos:false');assert.equal(c.albumPng,'2');
  await page.fill('[data-path="schedule.0.title"]','1日目の予定（消えないこと）');
  await page.click('#layoutSwitch [data-layout="photos"]');
  c=await count();console.log('photos only',c);
  assert.equal(c.pages,2);assert.equal(c.itin,0);assert.equal(c.add,true);assert.equal(c.pressed,'full:false,photos:true');assert.equal(c.albumPng,'1','PNG保存ボタンが正しいページを指す');
  // 保存されて、開き直しても同じ
  await page.waitForTimeout(800);await page.reload();await page.waitForSelector('.page.album');
  c=await count();console.log('after reload',c);assert.equal(c.pages,2);assert.equal(c.pressed,'full:false,photos:true');
  // 戻すと、入力した内容が残っている
  await page.click('#layoutSwitch [data-layout="full"]');c=await count();assert.equal(c.pages,3);
  assert.equal(await page.inputValue('[data-path="schedule.0.title"]'),'1日目の予定（消えないこと）');
  // スマホ幅でもボタンが見える
  await page.setViewportSize({width:390,height:844});
  const box=await page.locator('#layoutSwitch').boundingBox();assert(box&&box.width>200&&box.x>=0&&box.x+box.width<=390,'layout switch fits on phones');
  await page.screenshot({path:path.join(process.env.SHOT_DIR||'/tmp','shiori-mobile.png')});
  await page.setViewportSize({width:1280,height:900});

  // ② 予定表から作ったしおり：「ホテルに着いたら」は出さない（泊まりの日も、最後の日も）
  const memo=await page.evaluate(()=>{
   importPlan({pref:PREF,date:'2026.10.02 — 10.04',days:[
    {date:'10/2（金）',hasOvernight:true,rows:[{t:'15:10',name:'みんみん',meal:true},{t:'16:45',name:'大谷資料館'},{t:'18:20',name:'ザ・グランドスパ南大門'}]},
    {date:'10/3（土）',hasOvernight:true,rows:[{t:'10:00',name:'日光東照宮'},{t:'14:40',name:'那須高原'},{t:'17:10',name:'那須サファリパーク'},{t:'19:00',name:'ホテル',kind:'hotel'},{t:'20:00',name:'夜の散歩'}]},
    {date:'10/4（日）',hasOvernight:false,rows:[{t:'10:00',name:'那須どうぶつ王国'}]}]});
   const places=[...document.querySelectorAll('.page.itinerary')].map(pg=>[...pg.querySelectorAll('.place')].map(x=>x.value));
   // 以前の版で入った「ホテルに着いたら」も置き換わる
   data.schedule[0].stops[3]={time:'',place:'ホテルに着いたら',note:'お部屋からの眺め、ほっとしたひとときを。',transport:'思い出',caption:'',memory:true,memoryIndex:1};render();
   const migrated={...data.schedule[0].stops[3]};
   // ↻ で選べる題にも出てこない
   const seen=new Set();for(let i=0;i<8;i++){document.querySelector('[data-memory="0|3"]').click();seen.add(data.schedule[0].stops[3].place);}
   return {places,migrated:[migrated.place,migrated.note],cycle:[...seen]};});
  console.log('memory',JSON.stringify(memo));
  assert(!memo.places.flat().includes('ホテルに着いたら'));assert.equal(memo.migrated[0],'今日いちばんの風景');assert.notEqual(memo.migrated[1],'お部屋からの眺め、ほっとしたひとときを。');
  assert(!memo.cycle.includes('ホテルに着いたら'));assert(memo.places[0].slice(0,3).join()==='みんみん,大谷資料館,ザ・グランドスパ南大門');
  assert(memo.places.at(-1).includes('旅のおわりに'),'last day ends with 旅のおわりに');

  // 表紙と思い出フォトだけのときの PDF/PNG：書き出すページも2枚
  await page.click('#layoutSwitch [data-layout="photos"]');
  assert.equal(await page.evaluate(()=>document.querySelectorAll('.page').length),2);
  await page.screenshot({path:path.join(process.env.SHOT_DIR||'/tmp','shiori-photos-only.png'),fullPage:false});
  assert.deepEqual(errors,[]);
  console.log('ok');
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exit(1);});
