/* 店名で探す（「決まっている」お店）を広げる：
   ①観光ルートの近く（ホットペッパー）→ ②行く県の全体（ホットペッパー、Worker booking-v13 以降）→ ③地図データ（OpenStreetMap）
   見つからないお店（食べログ百名店などホットペッパーに載っていない店）は、住所・駅名を入れて登録できる。
   食べログはデータを取り出す仕組み（API）がないため、アプリの中には出さず、食べログのページを開くリンクにする。 */
const FOOD2_SA=n=>typeof HP_SA!=='undefined'?HP_SA[n]:'';
function food2Prefs(c){return [...new Set([c?.pref,...(typeof tripPrefs==='function'?tripPrefs():[S.pref])].filter(Boolean))].slice(0,3);}
function food2Short(p){return p==='北海道'?p:String(p||'').replace(/[都府県]$/,'');}
// 食べログ百名店のページ（料理の種類と地域で選ぶ。わからないときは百名店のトップ）
const HYAKU=[[/ラーメン|らーめん|拉麺|つけ麺|中華そば/,'ramen'],[/うどん/,'udon'],[/そば|蕎麦/,'soba'],[/寿司|鮨|すし/,'sushi'],[/焼肉|ホルモン/,'yakiniku'],[/焼き鳥|焼鳥/,'yakitori'],[/とんかつ/,'tonkatsu'],[/天ぷら|天麩羅/,'tempura'],[/うなぎ|鰻/,'unagi'],[/カレー/,'curry'],[/和菓子|甘味|団子|大福/,'wagashi'],[/スイーツ|ケーキ|パフェ|洋菓子/,'sweets'],[/喫茶/,'kissaten'],[/カフェ|コーヒー|珈琲/,'cafe'],[/パン/,'bread'],[/餃子|ぎょうざ/,'gyoza'],[/中華|中国料理/,'chinese'],[/お好み焼き|もんじゃ|たこ焼き/,'okonomiyaki'],[/居酒屋/,'izakaya'],[/すき焼き|しゃぶしゃぶ/,'sukiyaki_shabushabu'],[/ステーキ/,'steak'],[/ハンバーガー/,'hamburger'],[/洋食|ハンバーグ|オムライス/,'yoshoku'],[/ピザ/,'pizza'],[/イタリアン|パスタ/,'italian'],[/フレンチ/,'french'],[/鶏料理|水炊き/,'toriryori'],[/和食|日本料理|懐石|割烹/,'japanese'],[/アイス|ジェラート/,'ice_gelato']];
const HYAKU_ONE=new Set(['tonkatsu','tempura','unagi','kissaten','gyoza','okonomiyaki','sukiyaki_shabushabu','hamburger','pizza','toriryori','ice_gelato']);
const HYAKU_TOKYO=new Set(['sushi','yakiniku','curry','wagashi','sweets','bread','chinese','french','italian','japanese','asia_ethnic']);
const HYAKU_WEST=new Set(['滋賀県','京都府','大阪府','兵庫県','奈良県','和歌山県','鳥取県','島根県','岡山県','広島県','山口県','徳島県','香川県','愛媛県','高知県','福岡県','佐賀県','長崎県','熊本県','大分県','宮崎県','鹿児島県','沖縄県']);
function hyakumeitenURL(q,pref){
  const g=HYAKU.find(([re])=>re.test(String(q||'')))?.[1],base='https://award.tabelog.com/hyakumeiten';
  if(!g)return base;
  if(HYAKU_ONE.has(g))return base+'/'+g;
  if(g==='ramen'){const sp={北海道:'hokkaido',東京都:'tokyo',神奈川県:'kanagawa',愛知県:'aichi',大阪府:'osaka'}[pref];if(sp)return base+'/ramen_'+sp;}
  if(g==='udon'&&pref==='香川県')return base+'/udon_kagawa';
  if(pref==='東京都'&&(HYAKU_TOKYO.has(g)||g==='ramen'))return base+'/'+g+'_tokyo';
  return base+'/'+g+'_'+(HYAKU_WEST.has(pref)?'west':'east');
}
function food2Links(q,c,decided){
  const pref=c?.pref||S.pref,area=(decided?pref:[c?.city,pref].filter(Boolean)[0])||'';
  return `<div class="food2-links"><a class="btn small ghost" href="${esc(tabelogURL(q||'',area,!q))}" target="_blank" rel="noopener">食べログで探す</a><a class="btn small ghost" href="${esc(hyakumeitenURL(q,pref))}" target="_blank" rel="noopener">食べログ百名店</a><a class="btn small ghost" href="${esc('https://www.google.com/maps/search/'+encodeURIComponent([q,food2Short(pref)].filter(Boolean).join(' ')))}" target="_blank" rel="noopener">Googleマップ</a></div>`;
}
// 地図データ（OpenStreetMap）のお店
function food2FromOSM(x){
  if(!x||!Number.isFinite(+x.lat)||!Number.isFinite(+x.lng))return null;
  if(x.cat&&!/amenity|shop/.test(x.cat))return null;
  const CU={ramen:'ラーメン',sushi:'寿司',soba:'そば',udon:'うどん',japanese:'和食',noodle:'麺類',coffee_shop:'カフェ',cafe:'カフェ',curry:'カレー',yakiniku:'焼肉',tempura:'天ぷら',tonkatsu:'とんかつ',chinese:'中華',italian:'イタリアン',french:'フレンチ',pizza:'ピザ',burger:'ハンバーガー',okonomiyaki:'お好み焼き',seafood:'海鮮',yakitori:'焼き鳥',izakaya:'居酒屋',dessert:'スイーツ',cake:'ケーキ',bakery:'パン'};
  const cu=String(x.cuisine||'').split(';').map(v=>CU[v.trim()]||(/^[a-z_ ]+$/.test(v.trim())?'':v.trim())).filter(Boolean).join('・');
  return {name:x.name,lat:+x.lat,lng:+x.lng,addr:x.addr||'',cuisine:cu,providerId:'osm:'+x.osm,osm:'osm:'+x.osm,src:'osm',food:true,type:'restaurant',sc:0,onR:false,open:null,extra:x.extra||null};
}
async function food2Wider(c,q){
  const out=[],errs=[];
  const sa=food2Prefs(c).map(FOOD2_SA).filter(Boolean).slice(0,3).join(',');
  const jobs=[];
  if(sa&&q.length>=2)jobs.push(BookingAPI.get('/restaurants',{sa,q}).then(j=>{(j.items||[]).forEach(h=>out.push({...bookingToFood(h,j,c.center),pref:c.pref,matchTier:0,wide:true}));}).catch(e=>errs.push(e)));
  if(typeof searchNomi==='function')jobs.push(searchNomi(q,{bounded:true,limit:6}).then(list=>{(list||[]).map(food2FromOSM).filter(Boolean).forEach(f=>{if(!out.some(o=>hav(o,f)<0.08&&norm(o.name)===norm(f.name)))out.push({...f,pref:c.pref,matchTier:0});});}).catch(e=>errs.push(e)));
  await Promise.all(jobs);
  return {items:out,err:!out.length&&errs[0]||null};
}
const food2Search=bookingRouteFoodSearch;
bookingRouteFoodSearch=async function(query){
  await food2Search(query);
  if(bookingMealDecision()!=='decided')return;
  const q=String(query===undefined?foodPreference().query:query||'').trim(),r=ROUTE_UI.food,c=bookingMealContext(),key=bookingMealKey(c),state=S,seq=ROUTE_UI.foodSeq;
  if(!q||!r||r.key!==key||r.items.length)return;
  ROUTE_UI.foodBusy=true;ROUTE_UI.food={...r,message:`観光ルートの近くにはなかったため、${food2Prefs(c).map(food2Short).join('・')}の全体と地図データで「${q}」を探しています…`};render();
  try{
    const w=await food2Wider(c,q);if(S!==state||seq!==ROUTE_UI.foodSeq||bookingMealKey()!==key)return;
    const items=bookingRankFood(w.items,c);
    ROUTE_UI.food={key,query:q,items,expiresAt:Date.now()+3600000,message:items.length?`「${q}」：観光ルートから離れたお店もふくめて出しています。`:`「${q}」は見つかりませんでした。食べログなどで住所を調べて、下の「住所・駅名で登録」から入れてください。`};
  }finally{if(seq===ROUTE_UI.foodSeq){ROUTE_UI.foodBusy=false;render();}}
};
// 地図データのお店のカード（ホットペッパーのカードとは出す情報が違う）
const food2Card=bookingFoodResultCard;
bookingFoodResultCard=function(f,i,c){
  if(f.src!=='osm'){const h=food2Card(f,i,c);return f.wide?h.replace('<div class="booking-actions">',`<p class="note">観光ルートから約${hav(c.center,f).toFixed(1)}km（直線）</p><div class="booking-actions">`):h;}
  const picked=bookingMealPicked(c).some(w=>w.providerId===f.providerId);
  return `<article class="booking-card"><div><span class="booking-eyebrow">地図データ（OpenStreetMap）</span><h3>${esc(f.name)}</h3><p class="note">${esc(f.addr||'')}${f.cuisine?'<br>'+esc(f.cuisine):''}</p><p class="note">観光ルートから約${hav(c.center,f).toFixed(1)}km（直線）</p></div><div class="booking-actions"><button type="button" class="btn ${picked?'':'primary'}" data-route-addfood="${i}">${picked?'✓ 予定に追加済み':`${c.di+1}日目の${MEALNAME[c.slot]}に追加`}</button><a class="btn ghost" href="${esc('https://www.google.com/maps/search/?api=1&query='+f.lat+','+f.lng)}" target="_blank" rel="noopener">地図で見る</a></div></article>`;
};
// 手入力：緯度・経度ではなく、住所や駅名で場所を決める
async function food2Place(raw){
  raw=String(raw||'').trim();if(!raw)return null;
  const m=raw.normalize('NFKC').match(/^\s*(\d+(?:\.\d+)?)\s*[,、]\s*(\d+(?:\.\d+)?)\s*$/);
  if(m&&+m[1]>=20&&+m[1]<=46&&+m[2]>=122&&+m[2]<=154)return {lat:+m[1],lng:+m[2]};
  // 住所の一部（「本町2-3-1」など）がほかの県に当たらないよう、行く県の中の結果だけ使う。県名がないときは県名を付けて探し直す
  const inTrip=x=>(typeof tripPrefs==='function'?tripPrefs():[S.pref]).some(p=>String(x.addr||'').includes(p))||(typeof inPref==='function'&&inPref(x));
  try{const g=(await searchGSI(raw)).filter(inTrip);if(g[0])return {lat:g[0].lat,lng:g[0].lng,addr:g[0].addr};}catch{}
  if(!/[都道府県]/.test(raw))for(const p of (typeof tripPrefs==='function'?tripPrefs():[S.pref]).slice(0,3)){try{const g=(await searchGSI(p+raw)).filter(inTrip);if(g[0])return {lat:g[0].lat,lng:g[0].lng,addr:g[0].addr};}catch{}}
  try{const n=await searchNomi(raw,{bounded:true,limit:1});if(n&&n[0])return {lat:n[0].lat,lng:n[0].lng,addr:n[0].addr};}catch{}
  return false;
}
const food2Step=stepFood;
stepFood=function(){
  let h=food2Step();
  if(bookingMealDecision()!=='decided')return h.replace('<div class="booking-fallback">',`<div class="booking-fallback">${food2Links(foodPreference().query||'',bookingMealContext())}`);
  const c=bookingMealContext(),q=foodPreference().query||'';
  // 手入力の欄を「店名＋住所・駅名」にする
  h=h.replace(/<details class="booking-manual">[\s\S]*?<\/details>/,`<details class="booking-manual" ${ROUTE_UI.food?.items?.length===0&&ROUTE_UI.food?.query?'open':''}><summary>住所・駅名で登録</summary><label>店名<input id="routeFoodName" maxlength="80" value="${esc(q)}" placeholder="お店の名前"></label><label>住所・駅名<input id="routeFoodPlace" maxlength="120" placeholder="例：東京都葛飾区東新小岩1-4-17／新小岩駅"></label><p class="note">食べログやお店のページの住所を貼り付けてください。</p><button class="btn" type="button" data-food2-manual>この食事に登録</button><span class="status" id="food2Status"></span></details>`);
  return h.replace('<div class="booking-fallback">',`<div class="booking-fallback">${food2Links(q,c,true)}`);
};
document.addEventListener('click',async e=>{
  const t=e.target.closest('[data-food2-manual]');if(!t)return;
  const name=document.getElementById('routeFoodName')?.value.trim(),raw=document.getElementById('routeFoodPlace')?.value.trim(),st=document.getElementById('food2Status');
  if(!name)return toast('店名を入れてください');
  t.disabled=true;if(st)st.textContent=raw?'場所を調べています…':'';
  const c=bookingMealContext();
  try{
    const loc=raw?await food2Place(raw):null;
    if(raw&&!loc){if(st)st.textContent='場所が見つかりませんでした。住所を短くするか、駅名を入れてください。';return;}
    bookingPutFood({name,lat:loc?.lat??null,lng:loc?.lng??null,addr:loc?.addr||raw||'',src:'mine'},c);
  }finally{t.disabled=false;}
});

/* ---- 食事（STEP6）の画面：日ごと・食事ごとの一覧から選ぶ形にして、文字を減らす ---- */
const FOOD3_SLOTS=[['朝','朝'],['昼','昼'],['休憩','カフェ'],['夜','夜']];
function food3Picked(di,slot){return S.wishes.filter(w=>w.food&&w.meal===slot&&bookingFoodDayOf(w)===di);}
function food3Cell(di,slot,label){
  const on=bookingFoodDay()===di&&bookingFoodSlot()===slot,pk=food3Picked(di,slot),off=slot==='休憩'?!S.cafeDays?.[di]:!!S.mealOmissions?.[di+'|'+slot];
  return `<button type="button" class="food3-cell${pk.length?' done':''}${off?' off':''}" data-food3-cell="${di}|${slot}" aria-pressed="${on}"><b>${label}</b><span>${pk.length?esc(pk[0].name):off?(slot==='休憩'?'なし':'不要'):'未定'}</span></button>`;
}
function food3Grid(){
  return `<div class="food3-grid">${Array.from({length:S.days||1},(_,di)=>`<div class="food3-day"><p>${di+1}日目 <small>${esc(fmtDay(dayDate(di)))}</small></p><div class="food3-cells">${FOOD3_SLOTS.map(([s,l])=>food3Cell(di,s,l)).join('')}</div></div>`).join('')}</div>`;
}
stepFood=function(){
  const c=bookingMealContext(),mode=bookingMealDecision(),p=foodPreference(),picked=bookingMealPicked(c),cafe=c.slot==='休憩',name=`${c.di+1}日目の${cafe?'カフェ':MEALNAME[c.slot]}`;
  let h=`<section class="panel booking-panel food3">${head(5,'食事','決めたい食事を押してください。未定のままでもOKです。')}${food3Grid()}<div class="food3-box"><h3 class="food3-h">${esc(name)}</h3>`;
  if(c.before||c.after)h+=`<p class="food3-near">${esc(c.before?.name||'出発')} → <b>ここ</b> → ${esc(c.after?.name||'宿')}</p>`;
  if(cafe)h+=`<label class="budget-check"><input type="checkbox" data-cafe-enable ${S.cafeDays?.[c.di]?'checked':''}>カフェ休憩を入れる（15時ごろ・45分）</label>`;
  if(picked.length)h+=`<div class="food3-picked">${picked.map(w=>`<p><b>✓ ${esc(w.name)}</b>${w.status!=='ok'?'<small>（場所は未確認）</small>':''}<button class="linkbtn" type="button" data-delwish="${esc(w.id)}">外す</button></p>`).join('')}</div>`;
  if(cafe&&!S.cafeDays?.[c.di])return h+'</div></section>';
  h+=`<div class="food3-seg" role="group"><button type="button" data-route-food="decided" aria-pressed="${mode==='decided'}">決まっている</button><button type="button" data-route-food="undecided" aria-pressed="${mode==='undecided'}">おすすめから選ぶ</button></div>`;
  if(mode==='decided'){
    h+=`<form id="routeFoodSearch" class="food3-form"><input id="routeFoodQuery" name="query" maxlength="80" value="${esc(p.query)}" placeholder="お店の名前" aria-label="お店の名前"><button class="btn primary" ${ROUTE_UI.foodBusy?'disabled':''}>探す</button></form>`;
    h+=bookingFoodResults(c);
    h+=`<details class="booking-manual food3-manual" ${ROUTE_UI.food?.query&&!ROUTE_UI.food?.items?.length&&!ROUTE_UI.foodBusy?'open':''}><summary>見つからないとき：住所・駅名で登録</summary><label>店名<input id="routeFoodName" maxlength="80" value="${esc(p.query)}" placeholder="お店の名前"></label><label>住所・駅名<input id="routeFoodPlace" maxlength="120" placeholder="例：東京都葛飾区東新小岩1-4-17"></label><button class="btn" type="button" data-food2-manual>登録</button><span class="status" id="food2Status"></span></details>`;
    h+=food2Links(p.query||'',c,true);
  }else if(mode==='undecided'){
    const dishes=cafe?['カフェ','パフェ','ケーキ','抹茶','コーヒー']:c.foods;
    h+=`<form id="foodPreferenceSearch" class="food3-form"><input name="query" data-food-query maxlength="80" value="${esc(p.query)}" placeholder="${cafe?'例：パフェ':'食べたいもの（例：寿司）'}" aria-label="食べたいもの">${budgetSelect('food',c.slot)}<button class="btn primary" ${ROUTE_UI.foodBusy?'disabled':''}>${ROUTE_UI.foodBusy?'探しています…':'探す'}</button></form>`;
    h+=`<div class="food3-unknown">${budgetUnknownCheck('food')}</div>`;
    if(dishes.length)h+=`<div class="chips food3-dishes">${dishes.slice(0,8).map(x=>`<button type="button" class="chip" data-route-dish="${esc(x)}">${esc(x)}</button>`).join('')}</div>`;
    h+=bookingFoodResults(c)+(typeof plannerCompareHTML==='function'?plannerCompareHTML('food'):'');
    h+=food2Links(p.query||'',c,false)+`<p class="note"><a href="${esc(hpSearchURL([c.city,p.query||(cafe?'カフェ':'')].filter(Boolean).join(' '),c.pref,cafe?'G014':''))}" target="_blank" rel="noopener">ホットペッパーで探す</a></p>`;
  }
  if(!cafe&&!picked.length)h+=`<p class="food3-skip"><button type="button" class="linkbtn" data-food3-skip="${c.di}|${c.slot}">${S.mealOmissions?.[c.di+'|'+c.slot]?'この食事を予定に入れる':'この食事はいらない'}</button></p>`;
  return h+'</div></section>';
};
document.addEventListener('click',e=>{
  const t=e.target.closest('[data-food3-cell],[data-food3-skip]');if(!t)return;
  if(t.dataset.food3Cell){const [di,slot]=t.dataset.food3Cell.split('|');if(bookingFoodDay()===+di&&bookingFoodSlot()===slot)return;S.bookingFoodDay=+di;S.bookingFoodSlot=slot;bookingResetFoodRequest();save();render();if(bookingMealDecision()==='undecided'&&(slot!=='休憩'||S.cafeDays?.[+di]))bookingRouteFoodSearch();
    setTimeout(()=>document.querySelector('.food3-box')?.scrollIntoView({block:'nearest',behavior:'smooth'}),30);}
  else{const k=t.dataset.food3Skip;S.mealOmissions={...(S.mealOmissions||{}),[k]:!S.mealOmissions?.[k]};if(typeof bookingRouteMemo!=='undefined')bookingRouteMemo=null;save();render();}
});
