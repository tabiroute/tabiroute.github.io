/* 旅行の名前をあとから変えられること・「新しい旅行をつくる」の文言・広告の表記を確かめるテスト
   使い方: node booking/tests/rename.cjs （playwright が必要。外部への通信は止める） */
const {chromium}=require('playwright'),fs=require('fs'),path=require('path'),http=require('http'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../..');
const server=http.createServer((req,res)=>{const url=new URL(req.url,'http://localhost');
 if(url.pathname.startsWith('/api/')){res.setHeader('Content-Type','application/json');res.statusCode=404;res.end('{}');return;}
 const rel=url.pathname==='/'?'index.html':decodeURIComponent(url.pathname.slice(1));const file=path.resolve(root,rel);
 if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||fs.statSync(file).isDirectory()){res.statusCode=404;res.end('missing');return;}
 res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.html')?'text/html; charset=utf-8':file.endsWith('.json')?'application/json':file.endsWith('.png')?'image/png':file.endsWith('.jpg')?'image/jpeg':'application/octet-stream');
 if(rel==='booking/config.js'){res.end('window.TABIROUTE_BOOKING={apiBase:location.origin+"/api",enabled:true};window.TABIROUTE_PLACE_MEDIA={};');return;}
 res.end(fs.readFileSync(file));});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 const exe=process.env.CHROME||['/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find(p=>fs.existsSync(p));
 const browser=await chromium.launch({headless:true,...(exe?{executablePath:exe}:{}),args:['--no-sandbox','--disable-gpu','--no-zygote']});
 const shots=process.env.SHOT_DIR||'/tmp';
 try{
  const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',r=>r.request().url().startsWith(origin)?r.continue():r.abort());
  await page.goto(origin);await page.waitForFunction(()=>typeof APP!=='undefined'&&APP.view==='home'&&APP.projects&&APP.projects.length>0);

  // ④ 文言
  const btn=await page.locator('.homehd [data-app="newProject"]').textContent();console.log('new button:',btn);
  assert.equal(btn.trim(),'＋ 新しい旅行をつくる');
  // 広告の表記がページ上部にある
  assert.match(await page.locator('.adnote').textContent(),/#アフィリエイト広告/);

  // ③ マイ旅行のカードから名前を変える
  const id=await page.evaluate(()=>APP.projects[0].id);
  await page.click(`.pcard-acts [data-app="rename"][data-v="${id}"]`);
  await page.waitForSelector('#rnTitle');await page.fill('#rnTitle','京都 紅葉の旅');await page.click('#rnForm button[type="submit"]');
  await page.waitForFunction(id=>APP.projects.find(p=>p.id===id)?.title==='京都 紅葉の旅',id);
  assert(await page.locator('.pcard h3',{hasText:'京都 紅葉の旅'}).count()===1);
  await page.screenshot({path:path.join(shots,'rename-home.png')});
  // 開き直しても残っている
  await page.reload();await page.waitForFunction(()=>typeof APP!=='undefined'&&APP.view==='home'&&APP.projects.length>0);
  assert.equal(await page.evaluate(id=>APP.projects.find(p=>p.id===id)?.title,id),'京都 紅葉の旅');

  // 旅行の画面の上部からも変えられる
  await page.click(`[data-app="open"][data-v="${id}"]`);await page.waitForFunction(()=>APP.view==='project'&&document.querySelector('.pbar-t h2'));
  await page.click('.pbar-t [data-app="rename"]');await page.waitForSelector('#rnTitle');
  assert.equal(await page.inputValue('#rnTitle'),'京都 紅葉の旅');
  await page.fill('#rnTitle','秋の京都');await page.press('#rnTitle','Enter');
  await page.waitForFunction(()=>document.querySelector('.pbar-t h2').textContent==='秋の京都');
  await page.screenshot({path:path.join(shots,'rename-project.png')});

  // 「沖縄の旅」のまま行き先が栃木県になっている旅行：上部に「栃木の旅」に変えるボタン
  await page.evaluate(async()=>{await newProject('沖縄の旅',{pref:'栃木県'});});
  await page.waitForFunction(()=>APP.view==='project'&&APP.project&&APP.project.title==='沖縄の旅'&&document.querySelector('.titlefix'));
  const fix=await page.locator('.titlefix').textContent();console.log('title fix:',fix);assert.match(fix,/栃木の旅/);
  await page.screenshot({path:path.join(shots,'rename-stale.png')});
  await page.click('.titlefix');await page.waitForFunction(()=>APP.project.title==='栃木の旅'&&!document.querySelector('.titlefix'));

  // 自動で付いた名前は、行き先を変えると新しい行き先に合わせて変わる（自分で付けた名前は変わらない）
  const follow=await page.evaluate(async()=>{
   await newProject('沖縄の旅',{pref:'沖縄県'});await new Promise(r=>setTimeout(r,300));
   S.pref='栃木県';save();await new Promise(r=>setTimeout(r,900));const auto=APP.project.title;
   await newProject('家族旅行',{pref:'沖縄県'});await new Promise(r=>setTimeout(r,300));
   S.pref='栃木県';save();await new Promise(r=>setTimeout(r,900));const mine=APP.project.title;
   return {auto,mine,stored:APP.projects.find(p=>p.id===APP.pid)?.title};});
  console.log('follow',follow);assert.equal(follow.auto,'栃木の旅');assert.equal(follow.mine,'家族旅行');

  // スマホ幅
  await page.setViewportSize({width:390,height:844});await page.evaluate(()=>render());
  await page.screenshot({path:path.join(shots,'rename-mobile.png')});
  assert.deepEqual(errors,[]);
  console.log('ok');
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exit(1);});
