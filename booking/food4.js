/* 食事（STEP6）v4
   ① 食べたいご飯は決まっている？
      ・決まっている → 店名で探す（ホットペッパー＋ネット〔有名店リスト・地図データ〕）
      ・決まっていない → その土地の名物を選ぶ（複数可・自由入力）→ 有名店／ルートの近さ → 候補
   ② 選んだお店は「選択済み」にするだけ。何日目の朝・昼・夜に食べるかは、予定表を作るときにアプリが決める（mealAutoAssign）。
   ③ 予定表の「食事の順番を変える」で、お店を押して入れたい枠を押すと入れかわる。 */
PLAN_KEYS.push('foodPlan','foodTarget');
const F4={seq:0,res:{},items:new Map(),more:{},geo:new Map(),cat:null,catP:null,name:null,swSel:null,picking:new Set()};
const F4_SLOTS=[['朝','朝'],['昼','昼'],['休憩','カフェ'],['夜','夜']];
// 「食べに行く」ものではない名物（候補の食べものには出さない）
const F4_NOT_DISH=/^(落花生|納豆|すだち|砂丘らっきょう|しょうゆ豆|桃|メロン|パイナップル|朝市|中華街|キタの居酒屋|味噌|チーズ)$/;
const F4_SWEET=/スイーツ|カフェ|喫茶|珈琲|コーヒー|パフェ|ケーキ|甘味|和菓子|かき氷|ぜんざい|団子|だんご|白熊|しろくま|ジェラート|アイス|クレープ|パンケーキ|抹茶|饅頭|まんじゅう|プリン|クリームボックス|アップルパイ|もみじ饅頭|カステラ|ずんだ|焼きまんじゅう|赤福/;
const F4_NIGHT=/居酒屋|酒場|焼肉|焼き肉|ホルモン|焼き鳥|焼鳥|串焼|串カツ|もつ鍋|水炊き|しゃぶしゃぶ|すき焼|ふぐ|河豚|割烹|料亭|懐石|会席|バー|バル|ジンギスカン|鍋|おでん|ステーキ|クエ|カニ|蟹|かに|あんこう|きりたんぽ|手羽先|馬刺し/;
const F4_LUNCH=/ラーメン|らーめん|拉麺|中華そば|つけ麺|うどん|そば|蕎麦|定食|丼|カレー|ちゃんぽん|皿うどん|焼きそば|ハンバーガー|バーガー|パスタ|オムライス|とんかつ|カツ|食堂|ランチ|ほうとう|冷麺|じゃじゃ麺|そうめん|お好み焼き|たこ焼き|明石焼き|餃子/;
const F4_MORNING=/モーニング|朝食|朝ごはん|朝定食|ベーカリー|パン屋|茶粥|朝粥/;
const f4Plan=()=>({mode:'',dishes:[],own:[],how:'',...(S.foodPlan||{})});
function f4Set(p){S.foodPlan={...f4Plan(),...p};save();render();}
const f4Short=p=>p==='北海道'?p:String(p||'').replace(/[都府県]$/,'');
const f4Km=k=>k==null?'':k<1?k.toFixed(1):k<10?k.toFixed(1).replace(/\.0$/,''):String(Math.round(k));

/* ---- その土地の名物（選んだ市・観光地の市・県） ---- */
function f4Foods(){
  const out=[],add=x=>{x=String(x||'').trim();if(x&&!F4_NOT_DISH.test(x)&&!out.includes(x))out.push(x);};
  const cities=new Set(tripCities());
  try{stopsAll().filter(s=>!s.meal&&s.city).forEach(s=>cities.add(s.city));}catch(e){}
  for(const c of cities)(LOCAL[c]||LOCAL[String(c).replace(/^.*?[都道府県]/,'')]||[]).forEach(add);
  for(const p of tripPrefs())(SPECIAL[p]||[]).forEach(add);
  return out.slice(0,14);
}
/* ---- 観光ルート ---- */
function f4RoutePts(){try{return stopsAll().filter(s=>!s.meal&&bookingPoint(s));}catch(e){return [];}}
function f4RouteKm(f){
  if(!bookingPoint(f))return null;
  const pts=f4RoutePts();
  if(pts.length)return Math.min(...pts.map(p=>hav(p,f)));
  try{const H=hotelPoint(stopsAll());if(bookingPoint(H))return hav(H,f);}catch(e){}
  return null;
}
// 検索の中心：観光地から、互いに離れた地点を最大4つ（ホットペッパーの検索は半径3km）
function f4Centers(){
  const pts=f4RoutePts();
  if(!pts.length){const b=bookingFallbackPoint();return [{lat:b.lat,lng:b.lng}];}
  const c=centroid(pts),out=[pts.slice().sort((a,b)=>hav(a,c)-hav(b,c))[0]];
  while(out.length<4){
    const far=pts.map(p=>({p,d:Math.min(...out.map(o=>hav(o,p)))})).sort((a,b)=>b.d-a.d)[0];
    if(!far||far.d<4)break;out.push(far.p);
  }
  return out.map(p=>({lat:+p.lat,lng:+p.lng}));
}
/* ---- 有名店リスト（booking/famous-food.json：食べログ百名店・発祥の店・老舗などをネットで調べたもの） ---- */
function f4Catalog(){
  if(F4.cat)return Promise.resolve(F4.cat);
  return F4.catP||(F4.catP=fetch('booking/famous-food.json?v=1').then(r=>r.ok?r.json():null).then(j=>{
    F4.cat=(j?.shops||[]).map(a=>({pref:a[0],city:a[1],dish:a[2],name:a[3],addr:a[4],kind:a[5],why:a[6],srcURL:a[7],lat:a[8]??null,lng:a[9]??null,src:'famous',food:true,type:'restaurant',providerId:'famous:'+a[0]+':'+a[3]}));
    F4.catAt=j?.checked||'';return F4.cat;
  }).catch(()=>{F4.cat=[];F4.catFail=true;return F4.cat;}));   // 読めなかったときは空のまま（何度も取りに行かない）
}
function f4CatFor(dish){
  const ps=tripPrefs(),cs=tripCities(),d=norm(dish);if(!F4.cat||!d)return [];
  const hit=F4.cat.filter(x=>ps.includes(x.pref)&&(x.dish===dish||(d.length>=2&&(norm(x.dish).includes(d)||d.includes(norm(x.dish))))));
  const seen=new Set(),out=[];
  for(const x of hit){if(seen.has(x.name))continue;seen.add(x.name);out.push({...x,dish:x.dish,...f4GeoGet(x)});}
  return out.sort((a,b)=>(cs.includes(b.city)?1:0)-(cs.includes(a.city)?1:0)||((f4RouteKm(a)??999)-(f4RouteKm(b)??999)));
}
function f4CatByName(q){
  const n=norm(q);if(!F4.cat||n.length<2)return [];
  const ps=tripPrefs(),seen=new Set();
  return F4.cat.filter(x=>{const m=norm(x.name);return (m.includes(n)||n.includes(m.replace(/本店|総本店|本舗/g,'')))&&!seen.has(x.name)&&seen.add(x.name);})
    .map(x=>({...x,...f4GeoGet(x)})).sort((a,b)=>(ps.includes(b.pref)?1:0)-(ps.includes(a.pref)?1:0)).slice(0,6);
}
/* ---- 住所から場所（国土地理院の住所検索。結果は覚えておく） ---- */
function f4GeoGet(x){if(bookingPoint(x))return {};const g=F4.geo.get(x.addr);return g?{lat:g.lat,lng:g.lng}:{};}
async function f4Geo(x){
  if(bookingPoint(x))return {lat:+x.lat,lng:+x.lng};
  const key=x.addr||x.name;if(F4.geo.has(key))return F4.geo.get(key)||null;
  let r=null;
  if(x.addr){try{const g=await searchGSI(String(x.addr).replace(/\s.*$/,''));if(g[0])r={lat:g[0].lat,lng:g[0].lng};}catch(e){}}
  if(!r&&x.name){try{const n=await searchNomi(x.name,{bounded:true,limit:1});if(n&&n[0])r={lat:n[0].lat,lng:n[0].lng};}catch(e){}}
  F4.geo.set(key,r||false);return r;
}
// 画面に出した有名店の場所を、少しずつ調べて距離を出す
let f4GeoRunning=false;
async function f4GeoFill(list){
  if(f4GeoRunning)return;f4GeoRunning=true;let changed=false;
  try{for(const x of list.filter(x=>!bookingPoint(x)&&x.addr&&!F4.geo.has(x.addr)).slice(0,8)){await f4Geo(x);changed=true;}}
  finally{f4GeoRunning=false;}
  if(changed&&S.step===5)render();
}
/* ---- 時間帯の向き・不向き ---- */
function f4Text(m){return [m.name,m.cuisine,m.dish,m.catch,m.kindLabel].filter(Boolean).join(' ');}
function f4Ranges(h){const s=String(h||'').normalize('NFKC');return [...s.matchAll(/(\d{1,2}):(\d{2})\s*[~〜\-－–]\s*(翌)?\s*(\d{1,2}):(\d{2})/g)].map(m=>{const a=+m[1]*60+ +m[2];let b=+m[4]*60+ +m[5];if(m[3]||b<=a)b+=1440;return [a,b];});}
function f4OpenAt(m,T){const rs=[...f4Ranges(m.hours),...f4Ranges(m.extra?.hours)];if(!rs.length)return null;return rs.some(([a,b])=>(T>=a&&T<b)||(T+1440>=a&&T+1440<b));}
function f4Kind(m){
  const t=f4Text(m);
  return {sweet:F4_SWEET.test(t)||m.genreCode==='G014'||m.kind==='cafe',night:F4_NIGHT.test(t)||/^G00[18]$/.test(m.genreCode||''),lunch:F4_LUNCH.test(t),morning:F4_MORNING.test(t)};
}
function f4Guess(m){
  const k=f4Kind(m);if(k.sweet&&!k.lunch)return '休憩';if(k.morning)return '朝';
  const L=f4OpenAt(m,12*60+15),D=f4OpenAt(m,18*60+30);
  if(L===false&&D!==false||/なし/.test(m.lunch||'')&&D!==false)return '夜';   // 昼は開いていない
  if(D===false&&L!==false)return '昼';
  return k.night&&!k.lunch?'夜':'昼';
}
// その枠に入れてよいか（ラーメンを朝食に、定食をカフェの時間に、のような組み合わせは自動では作らない）
function f4Fits(m,slot){
  const k=f4Kind(m);
  if(slot==='休憩')return (k.sweet||m.kind==='takeout')&&f4OpenAt(m,15*60)!==false;
  if(slot==='朝')return k.morning||(k.sweet&&!k.night)||f4OpenAt(m,8*60+15)===true&&!k.night;
  if(slot==='昼')return f4OpenAt(m,12*60+15)!==false&&!/なし/.test(m.lunch||'');   // 昼に開いていないお店は昼食にしない
  if(slot==='夜')return f4OpenAt(m,18*60+30)!==false;
  return true;
}
function f4Suit(m,slot){
  const k=f4Kind(m);let c=0;
  if(slot==='休憩')c+=k.sweet?0:(m.kind==='takeout'?4:30);
  else if(k.sweet&&!k.lunch)c+=slot==='朝'&&k.morning?2:14;
  if(slot==='朝')c+=k.morning?0:22;
  if(slot==='夜')c+=k.night?0:k.lunch?5:1;
  if(slot==='昼')c+=k.night&&!k.lunch?6:0;
  if(slot==='昼'&&/なし/.test(m.lunch||''))c+=40;
  const o=f4OpenAt(m,{朝:8*60+15,昼:12*60+15,休憩:15*60,夜:18*60+30}[slot]);
  if(o===false)c+=45;else if(o===true)c-=1;
  return c;
}
/* ---- その日の、その食事の時間に観光しているか（booking/planner.js の食事枠と同じ考え方） ---- */
function f4DayWindow(di){
  const dt=dayTime(di);let start=t2m(dt.start),end=t2m(dt.end),tm=null;
  try{tm=tripMemo();}catch(e){}
  if(di===0){if(tm&&tm.arrive!=null&&Number.isFinite(tm.arrive))start=tm.arrive;else{try{const m=meetStartNode();if(m?.time)start=t2m(m.time);}catch(e){}}}
  if(di===(S.days||1)-1&&tm)end=tm.endBy!=null?Math.min(end,tm.endBy):end-(tm.backMin||0);
  return {start,end,off:!!dt.off};
}
function f4SlotOK(di,slot,auto){
  const w=f4DayWindow(di);if(w.off)return false;
  if(auto&&S.mealOmissions?.[di+'|'+slot])return false;
  return slot==='朝'?w.start<10*60:slot==='昼'?(w.start<=13*60+30&&w.end>=12*60+30):slot==='休憩'?(w.start<=15*60+30&&w.end>=16*60):(w.start<=20*60&&(di<nNights()||w.end>=19*60));
}
/* ---- 自動で「何日目の、朝・昼・カフェ・夜」に入れる（index.html の buildPlan から呼ぶ） ----
   その日に回る観光地（夜は泊まる宿、朝は前の晩の宿も）からの近さ＋お店の向き（営業時間・料理の種類）で、
   いちばん合う組み合わせから順に決める。決めた結果は保存しない（観光地を変えれば、また決め直す）。 */
function f4Dist(m,di,slot,groups,H,stops){
  const sights=(groups[di]||[]).filter(x=>bookingPoint(x)&&!x.meal);
  const minS=sights.length?Math.min(...sights.map(s=>hav(s,m))):null;
  const night=i=>{try{return S.hotelSplit&&nNights()>0?hotelPoint(stops,Math.max(0,Math.min(i,nNights()-1))):H;}catch(e){return H;}};
  const vals=[];
  if(slot==='朝'){if(di>0){const h=night(di-1);if(bookingPoint(h))vals.push(hav(h,m));}if(minS!=null)vals.push(minS+1);}
  else if(slot==='夜'){if(minS!=null)vals.push(minS);if(di<nNights()){const h=night(di);if(bookingPoint(h))vals.push(hav(h,m));}}
  else if(minS!=null)vals.push(minS);
  if(!vals.length){const h=night(di);vals.push(bookingPoint(h)?hav(h,m)+2:50);}
  return Math.min(...vals);
}
function mealAutoAssign(list,groups,slots,conflicts,H,stops){
  const cand=[],DAY=S.dayOf||{},fits=new Set();
  list.forEach((m,mi)=>{if(!bookingPoint(m))return;for(let di=0;di<groups.length;di++)for(const [slot] of F4_SLOTS){
    if(DAY[m.id]!=null&&DAY[m.id]!==''&&di!==Math.max(0,Math.min(groups.length-1,+DAY[m.id]||0)))continue;   // 「動かす」で日を決めたお店は、その日の中で決める
    if(!f4SlotOK(di,slot,true)||!f4Fits(m,slot))continue;fits.add(m);cand.push({m,di,slot,c:f4Dist(m,di,slot,groups,H,stops)+f4Suit(m,slot)+di*0.01+mi*0.0001-(DAY[m.id]!=null&&DAY[m.id]!==''?1000:0)});}});   // 日を決めたお店から先に枠を決める
  cand.sort((a,b)=>a.c-b.c);
  const done=new Set();
  for(const x of cand){
    if(done.has(x.m)||slots[x.di][x.slot])continue;
    done.add(x.m);x.m.meal=x.slot;if(!x.m.stayTouched)x.m.stay=MEALWIN[x.slot].stay;x.m.autoMeal=true;slots[x.di][x.slot]=x.m;
  }
  // 枠が足りないお店は、近い日の「立ち寄り」にする（予定表の「食事の順番を変える」で動かせる）
  list.filter(m=>!done.has(m)).forEach(m=>{
    let di=0,bd=1e9;groups.forEach((g,i)=>{const s=g.filter(bookingPoint),c=s.length?centroid(s):H;const d=bookingPoint(c)&&bookingPoint(m)?hav(c,m):1e8;if(d<bd){bd=d;di=i;}});
    if(DAY[m.id]!=null&&DAY[m.id]!=='')di=Math.max(0,Math.min(groups.length-1,+DAY[m.id]||0));
    const cf={...m,meal:'',conflict:'食事',conflictNote:fits.has(m)?'食事の枠が足りないため、立ち寄りにしています':'営業時間に合う食事の時間がないため、立ち寄りにしています'};conflicts.push(cf);groups[di].push(cf);
  });
}

/* ---- 検索 ---- */
function f4FromHP(h,j,c){return {...bookingToFood(h,j,c),lunch:h.lunch||'',src:'hotpepper'};}
function f4Key(f){return f.providerId||('x:'+f.src+':'+f.name+':'+(f.addr||''));}
function f4Merge(list){const out=[];for(const f of list){if(out.some(o=>f4Key(o)===f4Key(f)||(norm(o.name)===norm(f.name)&&(!bookingPoint(o)||!bookingPoint(f)||hav(o,f)<0.25))))continue;out.push(f);}return out;}
function f4SA(){return tripPrefs().map(p=>HP_SA[p]).filter(Boolean).slice(0,3).join(',');}
function f4Timeout(p,ms){return Promise.race([p,new Promise(r=>setTimeout(()=>r(null),ms))]);}
// 店名で探す：ホットペッパー（行く県の全体＋ルートの近く）と、ネット（有名店リスト・地図データ）を同時に。届いたものから出す
async function f4SearchName(q){
  q=String(q||'').normalize('NFKC').replace(/\s+/g,' ').trim().slice(0,80);if(!q)return toast('お店の名前を入れてください');
  const seq=++F4.seq,state=S,r={q,hp:[],net:[],hpBusy:true,netBusy:true,hpErr:'',seq,state};F4.name=r;render();
  const done=()=>S===state&&F4.name===r;
  await f4Catalog();if(!done())return;
  r.net=f4CatByName(q);render();
  const hp=(async()=>{
    const jobs=[],sa=f4SA(),c0=f4Centers()[0];
    if(sa&&q.length>=2)jobs.push(BookingAPI.get('/restaurants',{sa,q}).then(j=>(j.items||[]).map(h=>f4FromHP(h,j,c0))));
    if(c0)jobs.push(BookingAPI.get('/restaurants',{lat:c0.lat.toFixed(5),lng:c0.lng.toFixed(5),q,range:5}).then(j=>(j.items||[]).map(h=>f4FromHP(h,j,c0))));
    const res=await Promise.allSettled(jobs);if(!done())return;
    const ok=res.filter(x=>x.status==='fulfilled').flatMap(x=>x.value);
    r.hp=f4Merge(ok).sort((a,b)=>(norm(a.name).startsWith(norm(q))?0:1)-(norm(b.name).startsWith(norm(q))?0:1)||((f4RouteKm(a)??999)-(f4RouteKm(b)??999)));
    if(!ok.length){const e=res.find(x=>x.status==='rejected');if(e)r.hpErr=bookingMessage(e.reason);}
    r.hpBusy=false;render();
  })();
  const net=(async()=>{
    let list=null;try{list=await f4Timeout(searchNomi(q,{bounded:true,limit:6}),6000);}catch(e){}
    if(!done())return;
    const osm=(list||[]).map(food2FromOSM).filter(Boolean).map(f=>({...f,src:'osm'}));
    r.net=f4Merge([...r.net,...osm]);r.netBusy=false;r.netSlow=list===null;render();
    f4GeoFill(r.net);
  })();
  await Promise.all([hp,net]);
}
// 名物から探す：有名店（有名店リスト＋ホットペッパーのおすすめ順）／ルートの近く（ホットペッパー・観光地から近い順）
function f4ResKey(dish,how){return how+'|'+dish+'|'+JSON.stringify(f4Centers().map(p=>[p.lat.toFixed(2),p.lng.toFixed(2)]))+'|'+tripPrefs().join();}
async function f4SearchDish(dish,how){
  const key=f4ResKey(dish,how),old=F4.res[key];
  if(old&&(old.busy||old.expiresAt>Date.now()))return;
  const state=S,r={dish,how,busy:true,hp:[],err:'',expiresAt:0};F4.res[key]=r;
  try{
    if(how==='famous'){
      await f4Catalog();
      const sa=f4SA(),plan=foodQueryPlan(dish,{pref:S.pref,city:''}),words=[...new Set([dish.length<2?dish+'料理':dish,...plan.filter(v=>v.tier===1&&v.q&&v.q.length>=2).map(v=>v.q)])].slice(0,2);
      r.expiresAt=Date.now()+600000;
      for(const q of words){if(!sa||q.length<2)continue;const j=await BookingAPI.get('/restaurants',{sa,q});r.expiresAt=Math.max(Number(j.expiresAt)||0,Date.now()+60000);r.hp=(j.items||[]).map(h=>f4FromHP(h,j,f4Centers()[0]));if(r.hp.length)break;}
    }else{
      const plan=foodQueryPlan(dish,{pref:S.pref,city:''}),cs=f4Centers();let found=[],exp=Infinity,fail=null;
      const tries=[...plan.filter(v=>v.tier===0),...plan.filter(v=>v.tier===1).slice(0,1),...plan.filter(v=>v.tier===2)];
      for(const v of tries){
        // 観光地ごとの中心（最大4か所）を同時に探す。1か所が失敗しても、ほかの結果は使う
        const res=await Promise.allSettled(cs.map(c=>BookingAPI.get('/restaurants',{lat:c.lat.toFixed(5),lng:c.lng.toFixed(5),...(v.q?{q:v.q}:{}),...(v.genre?{genre:v.genre}:{})}).then(j=>({j,c}))));
        for(const x of res){
          if(x.status!=='fulfilled'){fail=fail||x.reason;continue;}
          const {j,c}=x.value;exp=Math.min(exp,j.expiresAt||Infinity);
          found=f4Merge([...found,...(j.items||[]).filter(h=>!v.genre||!h.genreCode||h.genreCode===v.genre).map(h=>({...f4FromHP(h,j,c),matchTier:v.tier}))]);
        }
        if(found.length)break;
        if(fail&&res.every(x=>x.status!=='fulfilled'))throw fail;
      }
      r.hp=found.sort((a,b)=>(a.matchTier||0)-(b.matchTier||0)||((f4RouteKm(a)??999)-(f4RouteKm(b)??999)));r.expiresAt=Math.max(Number.isFinite(exp)?exp:Date.now()+600000,Date.now()+60000);   // 少なくとも1分は探し直さない
    }
  }catch(e){r.err=bookingMessage(e);r.expiresAt=Date.now()+60000;}
  finally{r.busy=false;if(S===state&&S.step===5)render();}
}
async function f4SearchAll(){
  const p=f4Plan();if(p.mode!=='undecided'||!p.how)return;
  const state=S;
  await Promise.all(p.dishes.map(d=>f4SearchDish(d,p.how)));   // 食べものごとに同時に探す
  if(p.how==='famous'){await f4Catalog();if(S===state)f4GeoFill(p.dishes.flatMap(d=>f4CatFor(d).slice(0,4)));}
}

/* ---- 選ぶ・外す ---- */
function f4Picked(){return S.wishes.filter(w=>w.food);}
function f4Selected(f){return f4Picked().find(w=>(f.providerId&&w.providerId===f.providerId)||(norm(w.name)===norm(f.name)&&(!bookingPoint(w)||!bookingPoint(f)||hav(w,f)<0.3)));}
function f4Target(){const t=S.foodTarget;return t&&Number.isInteger(+t.di)&&+t.di<(S.days||1)&&MEALS.includes(t.slot)?{di:+t.di,slot:t.slot}:null;}
function f4PutAt(w,di,slot){
  w.meal=slot;w.day=di+1;w.mealAuto=false;if(!w.stayTouched)w.stay=MEALWIN[slot].stay;
  if(S.dayOf)delete S.dayOf[w.id];
  S.mealOmissions={...(S.mealOmissions||{}),[di+'|'+slot]:false};
  if(slot==='休憩')S.cafeDays={...(S.cafeDays||{}),[di]:true};
}
// 予定表の「◯日目の昼食を決める」から来たときは、その枠に入れる（前にその枠に手で入れていたお店は、自動で別の枠へ）
function f4PlaceAt(w,t){
  for(const o of f4Picked())if(o!==w&&!o.mealAuto&&o.meal===t.slot&&bookingFoodDayOf(o)===t.di&&!plannerRule(o.id).fixed){o.mealAuto=true;o.day=0;if(S.dayOf)delete S.dayOf[o.id];}
  f4PutAt(w,t.di,t.slot);S.foodTarget=null;
}
async function f4Pick(f){
  const key=f4Key(f);if(F4.picking.has(key))return;   // 2回続けて押しても1回分だけ
  const had=f4Selected(f),t=f4Target();
  if(had&&t){
    if(plannerRule(had.id).fixed)return toast('予約した食事です。予約の設定を外してから変えてください。');
    if(had.status!=='ok')return toast('このお店は場所を確認できていないため、予定表に入れられません。');
    f4PlaceAt(had,t);bookingRouteMemo=null;save();render();return toast(`${t.di+1}日目の${MEALNAME[t.slot]}に入れました`);
  }
  if(had){
    if(plannerRule(had.id).fixed)return toast('予約した食事です。予約の設定を外してから変えてください。');
    S.wishes=S.wishes.filter(w=>w!==had);if(S.dayOf)delete S.dayOf[had.id];
    for(const k of Object.keys(S.manualOrd||{}))S.manualOrd[k]=S.manualOrd[k].filter(id=>id!==had.id);
    bookingRouteMemo=null;save();render();return toast('外しました');
  }
  const state=S;let loc=bookingPoint(f)?{lat:+f.lat,lng:+f.lng}:null;
  if(!loc){
    F4.picking.add(key);render();toast('お店の場所を調べています…');
    try{loc=await f4Geo(f);}finally{F4.picking.delete(key);}
    if(S!==state)return;
    if(f4Selected(f)){render();return;}
  }
  const id=newId(),slot=f4Guess(f);
  const w={...f,id,q:f.name,name:f.name,lat:loc?.lat??null,lng:loc?.lng??null,addr:f.addr||'',food:true,meal:slot,mealAuto:true,day:0,stay:MEALWIN[slot].stay,status:loc?'ok':'pending',src:f.src==='hotpepper'?'hotpepper':'web',anchor:'',type:'restaurant'};
  delete w.routeScore;delete w.dist;delete w.matchTier;delete w.sc;
  const tt=loc?f4Target():null;
  if(tt)f4PlaceAt(w,tt);
  S.wishes.push(w);bookingRouteMemo=null;save();render();
  toast(!loc?'選択済みにしました。ただ、お店の場所を確認できないため予定表には入りません（「決まっている」の「住所で登録」から入れられます）':tt?`${tt.di+1}日目の${MEALNAME[tt.slot]}に入れました`:'選択済みにしました。食べる日と時間は予定表で決めます');
}
async function f4Manual(){
  const name=document.getElementById('f4ManName')?.value.trim(),raw=document.getElementById('f4ManPlace')?.value.trim(),st=document.getElementById('f4ManStatus');
  if(!name)return toast('店名を入れてください');
  if(!raw)return toast('住所か駅名を入れてください');
  if(st)st.textContent='場所を調べています…';
  const loc=await food2Place(raw);
  if(!loc){if(st)st.textContent='場所が見つかりませんでした。住所を短くするか、駅名を入れてください。';return;}
  // すでに選んだお店（場所がわからなかったお店）なら、場所だけ入れ直す
  const had=f4Picked().find(w=>norm(w.name)===norm(name));
  if(had){
    if(had.status==='ok'&&bookingPoint(had)){if(st)st.textContent='';return toast('このお店はもう選択済みです');}
    Object.assign(had,{lat:loc.lat,lng:loc.lng,addr:loc.addr||raw,status:'ok'});
    const t=f4Target();if(t)f4PlaceAt(had,t);
    if(st)st.textContent='';bookingRouteMemo=null;save();render();return toast('場所を登録しました。予定表に入ります');
  }
  await f4Pick({name,lat:loc.lat,lng:loc.lng,addr:loc.addr||raw,src:'mine',providerId:'mine:'+name+':'+loc.lat.toFixed(4)});
}

/* ---- 画面 ---- */
function f4Card(f){
  const key=f4Key(f);F4.items.set(key,f);
  const sel=!!f4Selected(f),km=f4RouteKm(f);
  const src=f.src==='hotpepper'?'ホットペッパー':f.src==='famous'?'有名店':f.src==='osm'?'地図データ':'登録';
  const meta=[f.src==='famous'?f.why:'',km!=null?`ルートから約${f4Km(km)}km`:'',f.src==='hotpepper'?f.cuisine:(f.cuisine||''),f.src==='hotpepper'&&f.budget?'予算 '+f.budget:''].filter(Boolean);
  const photo=Number(f.apiExpiresAt)>Date.now()&&bookingSafeURL(f.apiPhoto);
  const link=f.src==='hotpepper'?hpURL(f):'https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(bookingPoint(f)&&f.src==='osm'?f.lat+','+f.lng:[f.name,f.addr||f4Short(f.pref||S.pref)].join(' '));
  return `<article class="f4-card${sel?' sel':''}"><div class="f4-ph">${photo?`<img src="${esc(photo)}" alt="" loading="lazy" onerror="this.remove()">`:''}<span aria-hidden="true">${esc(String(f.dish||f.cuisine||f.name||'').slice(0,1))}</span></div><div class="f4-main"><span class="f4-src f4-src-${esc(f.src||'x')}">${src}</span><b>${esc(f.name)}</b>${meta.length?`<small>${esc(meta.join('・'))}</small>`:''}${f.addr?`<small class="f4-addr">${esc(f.addr)}</small>`:''}</div><div class="f4-act">${F4.picking.has(key)?'<button type="button" class="btn small" disabled><span class="spin"></span>確認中</button>':`<button type="button" class="btn small ${sel?'':'primary'}" data-f4-pick="${esc(key)}" aria-pressed="${sel}">${sel?'✓ 選択済み':'選ぶ'}</button>`}<a href="${esc(link)}" target="_blank" rel="noopener">${f.src==='hotpepper'?'お店のページ':'地図'}</a>${f.src==='famous'&&bookingSafeURL(f.srcURL)?`<a href="${esc(bookingSafeURL(f.srcURL))}" target="_blank" rel="noopener">出典</a>`:''}</div></article>`;
}
function f4List(list,id,n=4){
  if(!list.length)return '';
  const open=F4.more[id],shown=open?list:list.slice(0,n);
  return `<div class="f4-list">${shown.map(f4Card).join('')}</div>${list.length>n?`<button type="button" class="linkbtn f4-more" data-f4-more="${esc(id)}">${open?'閉じる':`もっと見る（あと${list.length-n}件）`}</button>`:''}`;
}
function f4Links(q,famous){
  const pref=tripPrefs()[0]||S.pref,area=f4Short(pref);
  const g='https://www.google.com/search?q='+encodeURIComponent(q+' '+area+(famous?' 有名店':''));
  return `<p class="f4-links"><span>ネットで見る</span><a href="${esc(g)}" target="_blank" rel="noopener">Google</a><a href="${esc('https://www.google.com/maps/search/'+encodeURIComponent(q+' '+area))}" target="_blank" rel="noopener">Googleマップ</a><a href="${esc(tabelogURL(q,area,!!famous))}" target="_blank" rel="noopener">食べログ</a>${famous?`<a href="${esc(hyakumeitenURL(q,pref))}" target="_blank" rel="noopener">百名店</a>`:''}</p>`;
}
function f4PickedHTML(){
  const list=f4Picked();if(!list.length)return '';
  return `<div class="f4-picked"><p class="f4-picked-h"><b>選択済み</b><span>${list.length}件</span></p><ul>${list.map(w=>`<li><span>✓ ${esc(w.name)}${w.status!=='ok'?'<small>（場所未確認）</small>':''}</span>${plannerRule(w.id).fixed?'<small>予約</small>':`<button type="button" class="linkbtn" data-delwish="${esc(w.id)}">外す</button>`}</li>`).join('')}</ul><p class="f4-note">いつ食べるかは、予定表で自動で決めます。</p></div>`;
}
function f4Q(n,t,sub){return `<p class="f4-q"><span class="f4-n">${n}</span>${t}${sub?`<small>${sub}</small>`:''}</p>`;}
function f4Seg(attr,val,opts){return `<div class="f4-seg" role="group">${opts.map(([v,l,s])=>`<button type="button" ${attr}="${v}" aria-pressed="${val===v}"><b>${l}</b>${s?`<span>${s}</span>`:''}</button>`).join('')}</div>`;}
function f4DecidedHTML(){
  const r=F4.name&&F4.name.state===S?F4.name:null,q=r?.q||'';
  let h=f4Q(2,'お店の名前は？','ホットペッパーとネットで探します')+`<form id="f4NameForm" class="f4-form"><input id="f4NameQ" name="q" maxlength="80" value="${esc(q)}" placeholder="お店の名前" aria-label="お店の名前" autocomplete="off"><button class="btn primary">探す</button></form>`;
  if(!r)return h+'<p class="f4-note">食べる日と時間（朝・昼・夜）は、予定表でアプリが決めます。</p>';
  h+=`<div class="f4-res"><h3 class="f4-h">ホットペッパー${r.hpBusy?'<span class="spin"></span>':`<small>${r.hp.length}件</small>`}</h3>`;
  h+=r.hpBusy?'':r.hp.length?f4List(r.hp,'name-hp'):`<p class="f4-empty">${esc(r.hpErr||'見つかりませんでした')}</p>`;
  if(r.hp.length)h+=`<div class="booking-credit">${BOOKING_CREDIT_HP}</div>`;
  h+=`<h3 class="f4-h">ネット（有名店・地図データ）${r.netBusy?'<span class="spin"></span>':`<small>${r.net.length}件</small>`}</h3>`;
  h+=r.net.length?f4List(r.net,'name-net'):r.netBusy?'':`<p class="f4-empty">${r.netSlow?'時間がかかったため、ここまでで止めました。下のリンクから探せます。':'見つかりませんでした'}</p>`;
  h+=f4Links(q,false)+'</div>';
  const none=!r.hpBusy&&!r.netBusy&&!r.hp.length&&!r.net.length;
  h+=`<details class="f4-manual" ${none?'open':''}><summary>見つからないとき：住所で登録</summary><label>店名<input id="f4ManName" maxlength="80" value="${esc(q)}"></label><label>住所・駅名<input id="f4ManPlace" maxlength="120" placeholder="例：札幌市豊平区中の島2条7-8-28"></label><button type="button" class="btn" data-f4-manual>登録</button><span class="status" id="f4ManStatus"></span></details>`;
  return h;
}
function f4UndecidedHTML(){
  const p=f4Plan(),foods=f4Foods(),own=p.own.filter(x=>!foods.includes(x)),all=[...foods,...own];
  let h=f4Q(2,'食べたいものは？','いくつでも');
  h+=`<div class="f4-chips">${all.map(x=>`<button type="button" class="chip" data-f4-dish="${esc(x)}" aria-pressed="${p.dishes.includes(x)}">${esc(x)}</button>`).join('')}</div>`;
  h+=`<form id="f4OwnForm" class="f4-form f4-own"><input id="f4OwnQ" maxlength="30" placeholder="ほかの食べもの（例：うなぎ）" aria-label="ほかの食べもの" autocomplete="off"><button class="btn">追加</button></form>`;
  if(!p.dishes.length)return h;
  h+=f4Q(3,'お店の選び方は？');
  h+=f4Seg('data-f4-how',p.how,[['famous','有名店','その料理で名の知れたお店'],['route','ルートの近く','観光の合間に寄りやすい']]);
  if(!p.how)return h;
  h+='<div class="f4-res">';
  for(const d of p.dishes){
    const r=F4.res[f4ResKey(d,p.how)],famous=p.how==='famous',cat=famous?f4CatFor(d):[];
    const hp=(r?.hp||[]).slice(0,famous?6:12);
    h+=`<section class="f4-dish"><h3 class="f4-h">${esc(d)}${r?.busy?'<span class="spin"></span>':''}</h3>`;
    if(famous){
      h+=cat.length?`<p class="f4-sub">有名店（ネットで調べたお店）</p>${f4List(cat,'cat-'+d,3)}`:'';
      h+=hp.length?`<p class="f4-sub">ホットペッパーのおすすめ</p>${f4List(hp,'hp-'+d,3)}<div class="booking-credit">${BOOKING_CREDIT_HP}</div>`:'';
    }else h+=hp.length?`${f4List(hp,'hp-'+d,4)}<div class="booking-credit">${BOOKING_CREDIT_HP}</div>`:'';
    if(r&&!r.busy&&!hp.length&&!cat.length)h+=`<p class="f4-empty">${esc(r.err||(famous?'見つかりませんでした。下のリンクから探せます。':'ルートの近くでは見つかりませんでした。「有名店」も試せます。'))}</p>`;
    else if(r?.err&&!hp.length)h+=`<p class="f4-empty">${esc(r.err)}</p>`;
    h+=f4Links(d,famous)+'</section>';
  }
  return h+'</div>';
}
stepFood=function(){
  const p=f4Plan(),t=f4Target();
  let h=`<section class="panel booking-panel f4">${head(5,'食事')}`;
  if(t)h+=`<div class="f4-target"><span><b>${t.di+1}日目の${MEALNAME[t.slot]}</b>に入れるお店を選んでいます</span><button type="button" class="linkbtn" data-f4-target-clear>やめる</button></div>`;
  h+=f4PickedHTML();
  h+=f4Q(1,'食べたいご飯は決まっていますか？');
  h+=f4Seg('data-f4-mode',p.mode,[['decided','決まっている','お店の名前で探す'],['undecided','決まっていない','名物から選ぶ']]);
  if(p.mode==='decided')h+=f4DecidedHTML();
  else if(p.mode==='undecided')h+=f4UndecidedHTML();
  else h+='<p class="f4-note">食事は決めなくても予定表を作れます。</p>';
  return h+'</section>';
};

/* ---- 予定表：食事の順番を変える ---- */
function f4MealCells(){
  const plan=window.__plan||bookingRoutePlan(),cells={},extra=[];
  plan.days.forEach(d=>d.items.forEach(it=>{if(it.type==='stop'&&it.meal)cells[d.di+'|'+it.meal]={id:it.s.id,name:it.s.name,t:it.t};else if(it.type==='stop'&&it.s.conflict&&it.s.food)extra.push({id:it.s.id,name:it.s.name,di:d.di});}));
  return {plan,cells,extra};
}
function f4SwapHTML(){
  const {plan,cells,extra}=f4MealCells(),sel=F4.swSel;
  const anyManual=f4Picked().some(w=>!w.mealAuto&&!plannerRule(w.id).fixed);
  let h=`<div class="eyebrow">食事</div><h2 id="mTitle">食事の順番を変える</h2><p class="note f4sw-help">${sel?'<b>入れたい枠を押してください。</b>お店がある枠なら入れかわります。':'動かしたいお店を押してください。'}</p><div class="f4sw-grid">`;
  for(const d of plan.days){
    h+=`<div class="f4sw-day"><p>${d.di+1}日目 <small>${esc(fmtDay(dayDate(d.di)))}</small></p><div class="f4sw-cells">`;
    for(const [slot,label] of F4_SLOTS){
      const c=cells[d.di+'|'+slot],ok=f4SlotOK(d.di,slot,false),fixed=c&&plannerRule(c.id).fixed;
      const cls=['f4sw-cell',c?'has':'',c&&c.id===sel?'sel':'',!ok&&!c?'off':'',fixed?'lock':''].filter(Boolean).join(' ');
      h+=`<button type="button" class="${cls}" data-f4sw="${d.di}|${slot}" ${!ok&&!c||fixed?'disabled':''} aria-pressed="${!!(c&&c.id===sel)}"><b>${label}</b><span>${c?esc(c.name):ok?'空き':'時間外'}</span>${fixed?'<small>予約</small>':''}</button>`;
    }
    h+='</div></div>';
  }
  h+='</div>';
  if(extra.length)h+=`<p class="f4sw-extra-h">入りきらないお店（押してから枠を選ぶ）</p><div class="f4-chips">${extra.map(x=>`<button type="button" class="chip" data-f4sw-pick="${esc(x.id)}" aria-pressed="${x.id===sel}">${esc(x.name)}</button>`).join('')}</div>`;
  h+=`<div class="row f4sw-foot">${anyManual?'<button type="button" class="linkbtn" data-f4sw-auto>自動に戻す</button>':'<span></span>'}<button type="button" class="btn primary" data-close="1">閉じる</button></div>`;
  return h;
}
function f4SwapOpen(sel){
  if(sel!==undefined)F4.swSel=sel||null;
  $('#sheet').innerHTML=f4SwapHTML();$('#modal').hidden=false;F4.swOpen=true;
}
function f4OrderFix(id,di,slot){
  for(const k of Object.keys(S.manualOrd||{}))S.manualOrd[k]=S.manualOrd[k].filter(x=>x!==id);
  const mo=S.manualOrd?.[di];if(!mo?.length)return;
  const d=window.__plan?.days?.[di],times={};(d?.items||[]).forEach(it=>{if(it.type==='stop')times[it.s.id]=it.t;});
  const T=MEALWIN[slot].target,at=mo.findIndex(x=>(times[x]??-1)>T);
  mo.splice(at<0?mo.length:at,0,id);
}
function f4Move(id,di,slot){
  const w=S.wishes.find(x=>x.id===id);if(!w)return;
  if(plannerRule(id).fixed)return toast('予約した食事は、営業時間・予約の設定から日時を変えてください。');
  const {cells}=f4MealCells(),from=Object.keys(cells).find(k=>cells[k].id===id),occ=cells[di+'|'+slot];
  if(occ&&occ.id===id){F4.swSel=null;return f4SwapOpen();}
  if(occ&&plannerRule(occ.id).fixed)return toast('予約した食事の枠には入れられません。');
  // 手で動かしたら、いま表に出ているほかのお店も今の枠に止める（1つ動かしただけで、ほかの食事が動かないように）
  for(const [k,c] of Object.entries(cells)){
    if(c.id===id||(occ&&c.id===occ.id))continue;
    const o=S.wishes.find(x=>x.id===c.id);if(!o||!o.mealAuto||plannerRule(o.id).fixed)continue;
    const [cd,cs]=k.split('|');f4PutAt(o,+cd,cs);
  }
  if(occ){
    const o=S.wishes.find(x=>x.id===occ.id);
    if(o&&plannerRule(o.id).fixed)return toast('予約した食事の枠には入れられません。');
    if(o){if(from){const [fd,fs]=from.split('|');f4PutAt(o,+fd,fs);f4OrderFix(o.id,+fd,fs);}else{o.mealAuto=true;o.day=0;}}
  }
  f4PutAt(w,di,slot);f4OrderFix(id,di,slot);
  F4.swSel=null;bookingRouteMemo=null;save();render();f4SwapOpen();
  toast(occ?'入れかえました':`${di+1}日目の${MEALNAME[slot]}にしました`);
}
function f4AutoAll(){
  for(const w of f4Picked()){if(plannerRule(w.id).fixed)continue;w.mealAuto=true;w.day=0;if(S.dayOf)delete S.dayOf[w.id];for(const k of Object.keys(S.manualOrd||{}))S.manualOrd[k]=S.manualOrd[k].filter(x=>x!==w.id);}
  F4.swSel=null;bookingRouteMemo=null;save();render();f4SwapOpen();toast('自動で決め直しました');
}
const f4OldResult=stepResult;
stepResult=function(){
  const h=f4OldResult(),n=f4Picked().filter(w=>w.status==='ok').length;
  if(!n||!window.__plan)return h;
  const auto=f4Picked().every(w=>w.mealAuto||plannerRule(w.id).fixed);
  const bar=`<div class="f4-mealbar"><div><b>食事</b><span>選んだお店${n}件を${auto?'、朝・昼・夜に自動で入れました':'入れています'}</span></div><button type="button" class="btn small primary" data-f4-swap="">食事の順番を変える</button></div>`;
  return h.replace('<div class="tabs" role="tablist">',bar+'<div class="tabs" role="tablist">');
};

/* ---- 操作 ---- */
document.addEventListener('click',e=>{
  const t=e.target.closest('[data-f4-mode],[data-f4-dish],[data-f4-how],[data-f4-pick],[data-f4-more],[data-f4-manual],[data-f4-target-clear],[data-f4-swap],[data-f4sw],[data-f4sw-pick],[data-f4sw-auto]');if(!t)return;
  const d=t.dataset;
  if(d.f4Mode!==undefined){f4Set({mode:d.f4Mode});if(d.f4Mode==='undecided')f4SearchAll();setTimeout(()=>document.getElementById(d.f4Mode==='decided'?'f4NameQ':'f4OwnQ')?.closest('.f4-form')?.scrollIntoView({block:'nearest',behavior:'smooth'}),40);}
  else if(d.f4Dish!==undefined){const p=f4Plan(),on=p.dishes.includes(d.f4Dish);f4Set({dishes:on?p.dishes.filter(x=>x!==d.f4Dish):[...p.dishes,d.f4Dish].slice(-8)});if(!on)f4SearchAll();}
  else if(d.f4How!==undefined){f4Set({how:d.f4How});f4SearchAll();}
  else if(d.f4Pick!==undefined){const f=F4.items.get(d.f4Pick);if(f)f4Pick(f);}
  else if(d.f4More!==undefined){F4.more[d.f4More]=!F4.more[d.f4More];render();}
  else if(t.hasAttribute('data-f4-manual'))f4Manual();
  else if(t.hasAttribute('data-f4-target-clear')){S.foodTarget=null;save();render();}
  else if(d.f4Swap!==undefined)f4SwapOpen(d.f4Swap||null);
  else if(d.f4swPick!==undefined)f4SwapOpen(F4.swSel===d.f4swPick?null:d.f4swPick);
  else if(t.hasAttribute('data-f4sw-auto'))f4AutoAll();
  else if(d.f4sw!==undefined){
    const [di,slot]=d.f4sw.split('|'),{cells}=f4MealCells(),c=cells[d.f4sw];
    if(!F4.swSel){if(c)f4SwapOpen(c.id);else toast('先に、動かしたいお店を押してください');return;}
    f4Move(F4.swSel,+di,slot);
  }
});
// 予定表の「◯日目の昼食を決める」：その枠に入れるお店を選ぶ
document.addEventListener('click',e=>{const t=e.target.closest('[data-route-open-food]');if(!t)return;const [di,slot]=t.dataset.routeOpenFood.split('|');if(MEALS.includes(slot)){S.foodTarget={di:+di,slot};}},true);
document.addEventListener('submit',e=>{
  if(e.target.id==='f4NameForm'){e.preventDefault();f4SearchName(document.getElementById('f4NameQ')?.value);}
  if(e.target.id==='f4OwnForm'){e.preventDefault();const v=String(document.getElementById('f4OwnQ')?.value||'').normalize('NFKC').trim().slice(0,30);if(!v)return toast('食べものを入れてください');const p=f4Plan();f4Set({own:[...p.own.filter(x=>x!==v),v].slice(-6),dishes:[...p.dishes.filter(x=>x!==v),v].slice(-8)});f4SearchAll();}
});
document.addEventListener('keydown',e=>{if(e.key==='Enter'&&(e.isComposing||e.keyCode===229)&&e.target.closest?.('.f4-form'))e.preventDefault();},true);
// モーダルを閉じたら、選んでいたお店を忘れる
const f4CloseModal=closeModal;closeModal=function(){F4.swSel=null;F4.swOpen=false;return f4CloseModal.apply(this,arguments);};
// 食事の画面を開いたとき、名物の候補を先に読んでおく
const f4OldRender=render;
render=function(){
  const r=f4OldRender.apply(this,arguments);
  if(S?.step===5){
    if(!F4.cat&&!F4.catP)f4Catalog().then(c=>{if(S?.step===5&&c.length)render();});
    // 保存してあった「名物＋選び方」で、まだ候補がないとき（読み込み直した・別の画面から戻った）は探し直す
    const p=f4Plan();F4.auto=F4.auto||{};
    const due=p.mode==='undecided'&&p.how?p.dishes.map(d=>f4ResKey(d,p.how)).filter(k=>{const x=F4.res[k];return (!x||(!x.busy&&x.expiresAt<=Date.now()))&&!(F4.auto[k]>Date.now()-60000);}):[];
    if(due.length){due.forEach(k=>F4.auto[k]=Date.now());setTimeout(f4SearchAll,0);}   // 自動で探し直すのは、同じ条件で1分に1回まで
  }
  return r;
};
