/* v2: decisions first; recommendations follow the actual ordered itinerary.
   This module is loaded after client.js. Rendering never fetches a provider. */
PLAN_KEYS.push('mealDecisions','bookingFoodDay','bookingFoodSlot','stayDecision','stayDecisions');
const ROUTE_UI={food:null,hotel:null,foodSeq:0,hotelSeq:0,foodBusy:false,hotelBusy:false};
let bookingRouteMemo=null;
function bookingRouteSignature(){
  return JSON.stringify([S.pref,S.city,S.cityOther,S.days,S.date,S.start,S.end,S.pace,S.transport,S.dayMode,S.cafeDays,S.foodPreferences,S.hotelBudget,S.dayTimes,S.dayOf,S.manualOrd,S.stopRules,S.stayRules,S.visitOrder,S.wishes,S.picks,S.hotelMode,S.hotelName,S.hotelLoc,S.hotelAnchor,S.hotelPick,S.hotelCands,S.hotelSplit,S.nights,APP.pid,APP.project?.starts,APP.project?.meet,S.flight,S.air]);
}
function bookingRoutePlan(){
  const key=bookingRouteSignature();
  if(bookingRouteMemo?.key===key)return bookingRouteMemo.plan;
  const plan=buildPlan();bookingRouteMemo={key,plan};return plan;
}
function bookingFoodDay(){return Math.max(0,Math.min((S.days||1)-1,Number(S.bookingFoodDay)||0));}
function bookingFoodSlot(){return MEALS.includes(S.bookingFoodSlot)?S.bookingFoodSlot:'昼';}
function bookingPoint(p){return p&&Number.isFinite(p.lat)&&Number.isFinite(p.lng);}
function bookingFallbackPoint(){const p=PREF[S.pref]||{lat:35.68,lng:139.76};return {lat:p.lat,lng:p.lng,name:cityLabel()||S.pref||'旅行先'};}
function bookingLocalAt(center){
  const nearest=allSpots(S.pref).filter(bookingPoint).map(s=>({s,d:hav(center,s)})).sort((a,b)=>a.d-b.d)[0];
  const city=nearest&&nearest.d<20?nearest.s.city:(cityLabel()||'');
  return {city,foods:[...new Set([...(LOCAL[city]||[]),...(SPECIAL[S.pref]||[])])].slice(0,6)};
}
function bookingMealContext(di=bookingFoodDay(),slot=bookingFoodSlot(),plan=bookingRoutePlan()){
  const day=plan.days[di],items=day?.items||[],sights=items.filter(x=>x.type==='stop'&&!x.s.meal&&!x.s.conflict);
  let before=null,after=null;
  if(slot==='朝'){before=day?.from||items.find(x=>x.type==='start')?.node;after=sights[0]?.s;}
  else if(slot==='夜'){before=sights.at(-1)?.s;after=day?.to||day?.hotel;}
  else{
    const lunch=items.find(x=>x.type==='lunch'&&slot==='昼'||x.type==='missingMeal'&&x.meal===slot||x.type==='stop'&&x.s.meal===slot);
    const t=lunch?.t??MEALWIN[slot].target;
    before=sights.filter(x=>x.t<=t).at(-1)?.s;
    after=sights.find(x=>x.t>t)?.s;
    if(!before)before=day?.from||items.find(x=>x.type==='start')?.node;
    if(!after)after=day?.to||day?.hotel;
  }
  before=bookingPoint(before)?before:null;after=bookingPoint(after)?after:null;
  const anchor=before||after||bookingFallbackPoint();
  const gap=before&&after?hav(before,after):0;
  // Long intercity legs: search near the last visited place, never an arbitrary
  // halfway point in the sea or mountains. Rank against both endpoints below.
  const center=before&&after&&gap<=6?{lat:(before.lat+after.lat)/2,lng:(before.lng+after.lng)/2}:anchor;
  const plannedMeal=items.find(x=>x.type==='missingMeal'&&x.meal===slot||x.type==='stop'&&x.s.meal===slot);
  return {di,slot,time:plannedMeal?.t??MEALWIN[slot].target,before,after,center,hasSights:!!sights.length,...bookingLocalAt(center)};
}
function bookingMealKey(c=bookingMealContext()){
  return JSON.stringify([APP.pid,S.pref,S.date,S.transport,S.dayMode,S.cafeDays,S.foodPreferences,S.hotelBudget,c.di,c.slot,c.time,c.before?.name,c.before?.lat,c.before?.lng,c.after?.name,c.after?.lat,c.after?.lng,c.center]);
}
function bookingExtraDistance(p,c){
  if(c.before&&c.after)return Math.max(0,hav(c.before,p)+hav(p,c.after)-hav(c.before,c.after));
  return hav(c.center,p);
}
function bookingRankFood(items,c){
  return items.map(f=>{const text=norm([f.name,f.cuisine,f.catch].join(' '));const local=c.foods.filter(x=>text.includes(norm(x)));const extra=bookingExtraDistance(f,c);return {...f,localMatches:local,routeExtra:extra,routeReason:local.length?'掲載情報に「'+local.join('・')+'」／ルートからの寄り道が少ない候補':'食事の前後の移動を考えた候補',routeScore:extra+hav(c.center,f)*0.25-(local.length?1:0)};}).sort((a,b)=>a.routeScore-b.routeScore);
}
function bookingStayContext(plan=bookingRoutePlan()){
  const nights=Math.max(1,nNights()),ni=S.hotelSplit?Math.min(S.bookingNight||0,nights-1):0;
  const indices=S.hotelSplit?[ni]:Array.from({length:nights},(_,i)=>i);
  const pairs=indices.map(i=>({before:plan.days[i]?.ord.filter(x=>!x.meal).at(-1),after:plan.days[i+1]?.ord.find(x=>!x.meal),night:i})).filter(p=>p.before||p.after);
  const points=pairs.flatMap(p=>[p.before,p.after]).filter(bookingPoint);
  // Choose a real sightseeing endpoint with minimum total straight-line travel.
  const center=points.length?points.slice().sort((a,b)=>points.reduce((s,p)=>s+hav(a,p)-hav(b,p),0))[0]:bookingFallbackPoint();
  return {ni,pairs,center,hasSights:points.length>0};
}
function bookingStayKey(c=bookingStayContext()){return JSON.stringify([APP.pid,S.pref,S.date,S.days,S.transport,S.dayMode,S.cafeDays,S.foodPreferences,S.hotelBudget,S.stayRules,!!S.hotelSplit,c.ni,c.pairs,c.center]);}
function bookingRankHotels(items,c){return items.map(h=>({...h,routeDistance:c.pairs.reduce((v,p)=>v+(p.before?hav(p.before,h):0)+(p.after?hav(h,p.after):0),0)/Math.max(1,c.pairs.length)})).sort((a,b)=>a.routeDistance-b.routeDistance);}
function bookingRouteHTML(c,hotel=false){
  const pairs=hotel?c.pairs:[c];
  return `<div class="booking-route"><span class="booking-eyebrow">${hotel?'STAY LOCATION':'YOUR ROUTE'}</span><h3>${hotel?'観光のつながりから、泊まるエリアを提案':'この時間帯の観光ルート'}</h3>${pairs.map(p=>`<div class="booking-route-line">${hotel?`<small>${p.night+1}泊目</small>`:''}<span>${esc(p.before?.name||'出発地周辺')}</span><b>${hotel?'宿泊':'食事'}</b><span>${esc(p.after?.name||'次の予定まで')}</span></div>`).join('')}${!c.hasSights?'<p class="note">観光地がまだ選ばれていません。先に行きたい場所を選ぶと、回る順序に沿って提案できます。</p><button class="btn small" type="button" data-go="4">観光地を選ぶ</button>':`<p class="note">${hotel?'当日の最後と翌日の最初の観光地への移動を考慮します。同じ宿に連泊する場合は全泊分を比較します。':'前後の観光地と予定時刻から検索地点を決め、寄り道の少なさと地域の料理で候補を並べます。'} 距離は直線距離の目安です。</p>`}</div>`;
}
function bookingDaySelect(){return `<label class="booking-day-label">食事を決める日<select data-route-day>${Array.from({length:S.days||1},(_,i)=>`<option value="${i}" ${i===bookingFoodDay()?'selected':''}>${i+1}日目 · ${esc(fmtDay(dayDate(i)))}</option>`).join('')}</select></label><div class="chips booking-meal-tabs">${MEALS.map(m=>`<button type="button" class="chip" data-route-slot="${m}" aria-pressed="${bookingFoodSlot()===m}">${MEALNAME[m]}</button>`).join('')}</div>`;}
function bookingMealDecision(){const m=S.mealDecisions?.[bookingFoodDay()+'|'+bookingFoodSlot()]||'';return m==='direction'?'undecided':m;}
function bookingDecisionHTML(kind,mode){const food=kind==='food';return `<div class="choices two booking-decisions"><button type="button" class="choice" data-route-${kind}="decided" aria-pressed="${mode==='decided'}"><div class="booking-choice-icon"><img src="img/${food?'ic-food-decided':'ic-hotel'}.png" alt="" width="80" height="80"></div><div><b>決まっている</b><span>${food?'お店の名前を入れる':'ホテル名を入れる'}</span></div></button><button type="button" class="choice" data-route-${kind}="undecided" aria-pressed="${mode==='undecided'}"><div class="booking-choice-icon"><img src="img/${food?'ic-food-undecided':'ic-hotel-undecided'}.png" alt="" width="80" height="80"></div><div><b>まだ決まっていない</b><span>${food?'観光ルートとご当地の食事から選ぶ':'観光の順序からおすすめを選ぶ'}</span></div></button></div>`;}
// 日にち「おまかせ」(day:0) のお店は、計算済みの予定表で入った日を使う（以前はどの日にも数えられず「未定」のままだった）。
function bookingFoodDayOf(w){if(S.dayOf&&S.dayOf[w.id]!=null&&S.dayOf[w.id]!=='')return Number(S.dayOf[w.id]);if(Number(w.day)>0)return Number(w.day)-1;const d=window.__plan?.days?.find(d=>(d.ord||[]).some(s=>s.id===w.id));return d?d.di:-1;}
function bookingMealPicked(c){return S.wishes.filter(w=>w.food&&w.meal===c.slot&&bookingFoodDayOf(w)===c.di);}
function bookingFoodResultCard(f,i,c){
  const picked=bookingMealPicked(c).some(w=>w.providerId===f.providerId);
  return `<article class="booking-card"><div class="booking-card-top">${bookingPhoto(f,'card')}<div><span class="booking-eyebrow">${i===0?'ROUTE PICK':'GOURMET'} / ホットペッパー</span><h3>${esc(f.name)}</h3><p class="booking-reason">${esc(f.routeReason)}</p><p class="note">${esc(f.addr||'')}<br>${esc(f.cuisine||'')} · ${esc(f.budget||'予算は店舗ページで確認')}</p><p class="note">前後の移動に加わる距離：約${f.routeExtra.toFixed(1)}km（直線距離）</p></div></div><div class="booking-actions"><button type="button" class="btn ${picked?'':'primary'}" data-route-addfood="${i}">${picked?'✓ 予定に追加済み':`${c.di+1}日目の${MEALNAME[c.slot]}に追加`}</button><a class="btn ghost" href="${esc(hpURL(f))}" target="_blank" rel="noopener">口コミ・料理を見る</a></div><p class="note">料理の提供時間・営業時間は店舗ページで確認してください。</p></article>`;
}
function bookingFoodResults(c){
  const r=ROUTE_UI.food,key=bookingMealKey(c),valid=r?.key===key;
  const fresh=valid&&r.expiresAt>Date.now(),items=fresh?r.items:[];
  return `${valid&&r.message?`<p class="booking-notice" role="status">${esc(r.message)}</p>`:''}${ROUTE_UI.foodBusy?'<p class="booking-notice" role="status">このルートに合うお店を確認しています…</p>':''}<div class="booking-results">${items.map((f,i)=>bookingFoodResultCard(f,i,c)).join('')}</div>${items.length?`<div class="booking-credit">${BOOKING_CREDIT_HP}</div>`:''}${valid&&!fresh&&r.items?.length?'<p class="note">店舗情報の有効期限が過ぎました。再検索すると最新の候補を取得できます。</p>':''}`;
}
stepFood=function(){
  const c=bookingMealContext(),mode=bookingMealDecision(),picked=bookingMealPicked(c);
  let h=`<section class="panel booking-panel booking-flow">${head(5,'食事のお店は決まっていますか？','日ごと・食事ごとに、決まっているお店の登録も、おすすめからの選択もできます。')}${bookingDaySelect()}${bookingDecisionHTML('food',mode)}`;
  if(picked.length)h+=`<div class="booking-selected"><b>${c.di+1}日目の${MEALNAME[c.slot]}</b>${picked.map(w=>`<div><span>${esc(w.name)}${w.status!=='ok'?'（位置未確認）':''}</span><button class="linkbtn" type="button" data-delwish="${esc(w.id)}">外す</button></div>`).join('')}</div>`;
  if(!mode)return h+'<p class="note">どちらかを選んでください。食事は未定のままでも予定表を作れます。</p></section>';
  if(mode==='decided')h+=`<form class="booking-search" id="routeFoodSearch"><label for="routeFoodQuery">決まっているお店の名前</label><div class="row"><input id="routeFoodQuery" name="query" maxlength="80" placeholder="店名・支店名" value="${esc(DRAFT.routeFoodQuery||'')}"><button class="btn primary" ${ROUTE_UI.foodBusy?'disabled':''}>お店を確認</button></div></form><details class="booking-manual"><summary>お店を手入力で登録する</summary><label>店名<input id="routeFoodName" maxlength="80" placeholder="お店の正式名称"></label><label>緯度・経度（任意）<input id="routeFoodCoords" placeholder="例：34.9858, 135.7588"></label><p class="note">位置が未確認でも名前を保存できます。位置を確認すると回るルートに反映されます。</p><button class="btn" type="button" data-route-manual-food>この食事に登録</button></details>`;
  else h+=`${bookingRouteHTML(c)}<div class="booking-local"><span class="booking-eyebrow">LOCAL FOOD</span><h3>${esc(c.city||S.pref)}で食べたい、ご当地の食事</h3><p class="note">食べたいものを選ぶと、観光ルート周辺のお店を探せます。</p><div class="chips">${c.foods.map(x=>`<button class="chip" type="button" data-route-dish="${esc(x)}" ${ROUTE_UI.foodBusy?'disabled':''}>${esc(x)}</button>`).join('')}</div></div><button type="button" class="btn primary" data-route-refresh-food ${ROUTE_UI.foodBusy?'disabled':''}>${ROUTE_UI.foodBusy?'候補を確認中…':'このルートのおすすめ店を見る'}</button>`;
  h+=bookingFoodResults(c);
  h+=`<div class="booking-fallback"><p>お店の情報が取得できないときも、食事はあとから決められます。</p><a class="btn ghost" href="${esc(hpSearchURL([c.city||S.pref,ROUTE_UI.food?.key===bookingMealKey(c)?ROUTE_UI.food.query:'',c.slot==='昼'?'ランチ':c.slot==='朝'?'朝食':''].filter(Boolean).join(' ')))}" target="_blank" rel="noopener">ホットペッパーで探す</a><p class="note">店舗写真と口コミは同じお店の情報を確認します。口コミ点数はAPIでは取得できません。</p></div></section>`;
  return h;
};
async function bookingRouteFoodSearch(query=''){
  const c=bookingMealContext(),key=bookingMealKey(c),state=S,pid=APP.pid,seq=++ROUTE_UI.foodSeq;
  ROUTE_UI.foodBusy=true;ROUTE_UI.food={key,query,items:[],message:''};render();
  try{
    const j=await BookingAPI.get('/restaurants',{lat:c.center.lat.toFixed(5),lng:c.center.lng.toFixed(5),...(query?{q:query}:{})});
    if(S!==state||APP.pid!==pid||seq!==ROUTE_UI.foodSeq||bookingMealKey()!==key)return;
    const items=bookingRankFood(j.items.map(h=>bookingToFood(h,j,c.center)),c);
    ROUTE_UI.food={key,query,items,expiresAt:j.expiresAt,message:items.length?`${c.di+1}日目の${MEALNAME[c.slot]}に合う候補です。気になるお店を選んで予定に追加してください。`:query?'この料理に合う掲載店舗は見つかりませんでした。「このルートのおすすめ店を見る」で料理を指定せず探せます。':'この周辺の掲載店舗は見つかりませんでした。ご当地の食事の提案や外部サイトをご利用ください。'};
  }catch(e){if(S===state&&APP.pid===pid&&seq===ROUTE_UI.foodSeq)ROUTE_UI.food={key,query,items:[],message:bookingMessage(e)};}
  finally{if(seq===ROUTE_UI.foodSeq){ROUTE_UI.foodBusy=false;render();}}
}
function bookingStayDecision(){return (S.hotelSplit?S.stayDecisions?.[bookingNightIndex()]:'')||S.stayDecision||S.hotelMode||'';}
function bookingStaySelections(){
  const stays=S.hotelSplit?nightsArr().slice(0,nNights()).map((n,i)=>({name:n.name,loc:n.loc,night:i})):S.hotelName?[{name:S.hotelName,loc:S.hotelLoc}]:[];
  if(S.hotelSplit)return `<div class="booking-nights" aria-label="泊ごとのホテル">${stays.map(n=>`<button type="button" class="booking-night-card" data-route-select-night="${n.night}" aria-pressed="${n.night===bookingNightIndex()}"><b>${n.night+1}泊目 · ${esc(fmtDay(new Date(bookingAddDays(bookingDateState().startDate,n.night)+'T12:00:00')))}</b><span>${esc(n.name||'ホテルは未定')}</span><small>${n.name?(n.loc?'予定に追加済み（予約は別途）':'位置未確認'):'この泊の候補を探す'}</small></button>`).join('')}</div>`;
  return stays.length?`<div class="booking-selected"><b>予定に入れた宿</b>${stays.map(n=>`<div><span>${esc(n.name)}${!n.loc?'（位置未確認）':''}</span></div>`).join('')}</div>`:'';
}
function bookingStayComparison(plan=bookingRoutePlan()){
  if(nNights()<2)return null;
  const pairs=Array.from({length:nNights()},(_,i)=>({night:i,before:plan.days[i]?.ord.filter(x=>!x.meal).at(-1),after:plan.days[i+1]?.ord.find(x=>!x.meal)}));
  const points=pairs.flatMap(p=>[p.before,p.after]).filter(bookingPoint);if(points.length<2)return null;
  const distance=(h,p)=>(bookingPoint(p.before)?hav(h,p.before):0)+(bookingPoint(p.after)?hav(h,p.after):0);
  const best=(ps)=>points.reduce((a,b)=>ps.reduce((sum,p)=>sum+distance(a,p)-distance(b,p),0)<=0?a:b);
  const common=best(pairs),rows=pairs.map(p=>({...p,center:best([p])}));
  const same=pairs.reduce((sum,p)=>sum+distance(common,p),0),split=rows.reduce((sum,p)=>sum+distance(p.center,p),0),gain=Math.max(0,same-split);
  return {common,rows,same,split,gain,recommend:gain>=12&&gain/Math.max(1,same)>=0.15};
}
// 泊まり方（連泊か、泊ごとに変えるか）を、2つのボタンで選ぶ。おすすめと理由を1行で添える。
function bookingStayAdvice(){
  const c=bookingStayComparison();
  const rec=c?.recommend,why=rec?`泊ごとに宿のエリアを変えると、宿と観光地の行き来が約${Math.round(c.gain)}km短くなります。`:'宿のエリアを分けても移動はあまり短くならないので、荷物の移動がない連泊がおすすめです。';
  const opt=(v,title,sub,on)=>`<button type="button" class="stay-opt" data-route-split="${v}" aria-pressed="${on}"><b>${title}${(v==='1')===!!rec?'<span class="stay-rec">おすすめ</span>':''}</b><small>${sub}</small></button>`;
  return `<div class="stay-plan"><p class="stay-plan-h">泊まり方</p><div class="stay-opts">${opt('0','同じホテルに連泊','荷物を置いたまま観光できる',!S.hotelSplit)}${opt('1','泊ごとにホテルを選ぶ','日ごとの観光地の近くに泊まれる',!!S.hotelSplit)}</div>${c?`<p class="stay-why">${esc(why)}${rec?`<br><small>${c.rows.map(p=>`${p.night+1}泊目：${esc(p.center.name)}周辺`).join(' ／ ')}</small>`:''}</p>`:''}</div>`;
}
function bookingSetSplit(split){
  bookingCommitDates();S.hotelSplit=split;S.bookingNight=0;NIGHTAREA=null;
  if(split&&S.hotelName){const ns=nightsArr();for(let i=0;i<nNights();i++)if(!ns[i].name)ns[i]={name:S.hotelName,loc:S.hotelLoc,info:S.hotelInfo};}
  if(!split&&!S.hotelName){const first=nightsArr().find(n=>n.name);if(first){S.hotelName=first.name;S.hotelLoc=first.loc;S.hotelInfo=first.info;S.hotelMode='decided';}}
  bookingResetHotelRequest();save();render();if(bookingStayDecision()==='undecided')bookingRouteHotelSearch();
}
function bookingSelectNight(ni){
  bookingCommitDates();S.bookingNight=Math.max(0,Math.min(nNights()-1,Number(ni)||0));bookingResetHotelRequest();save();render();if(bookingStayDecision()==='undecided')bookingRouteHotelSearch();
}
stepHotel=function(){
  if(!nNights())return `<section class="panel booking-panel">${head(6,'今回は日帰りの旅行です','宿泊先の入力は不要です。予定表へ進めます。')}<button class="btn" type="button" data-go="1">日程を変更する</button></section>`;
  const mode=bookingStayDecision(),c=bookingStayContext(),r=ROUTE_UI.hotel,valid=r?.key===bookingStayKey(c),fresh=valid&&r.expiresAt>Date.now();
  let h=`<section class="panel booking-panel booking-flow">${head(6,'宿泊場所は決まっていますか？','未定の場合は、観光の終わりと翌日の始まりをつなぐ宿を提案します。')}${bookingStaySelections()}${bookingDecisionHTML('stay',mode)}`;
  if(!mode)return h+'<p class="note">どちらかを選んでください。未定のまま予定表を作ることもできます。</p></section>';
  if(nNights()>1)h+=bookingStayAdvice();
  if(S.hotelSplit)h+=`<label class="booking-day-label">宿泊日<select data-route-night>${Array.from({length:nNights()},(_,i)=>`<option value="${i}" ${i===c.ni?'selected':''}>${i+1}泊目 · ${esc(fmtDay(new Date(bookingAddDays(bookingDateState().startDate,i)+'T12:00:00')))}</option>`).join('')}</select></label>`;
  if(mode==='undecided')h+=`${bookingRouteHTML(c,true)}<p class="booking-area"><b>おすすめの検索エリア</b><span>${esc(c.center.name||'観光地')} 周辺</span></p><button type="button" class="btn primary" data-route-refresh-stay ${ROUTE_UI.hotelBusy?'disabled':''}>${ROUTE_UI.hotelBusy?'候補を確認中…':'観光ルートに合うホテルを見る'}</button>`;
  h+=`<details class="booking-conditions" ${ROUTE_UI.conditionsOpen?'open':''}><summary>宿泊条件：${esc(bookingConditionText())} <span>変更する</span></summary>${bookingHotelFields()}</details>`;
  if(mode==='decided')h+=`<form id="routeHotelSearch" class="booking-search"><label for="routeHotelQuery">決まっているホテルの名前</label><div class="row"><input id="routeHotelQuery" name="query" maxlength="80" placeholder="ホテルの正式名称" value="${esc(DRAFT.routeHotelQuery||'')}"><button class="btn primary" ${ROUTE_UI.hotelBusy?'disabled':''}>ホテルを確認</button></div></form><details class="booking-manual"><summary>ホテルを手入力で登録する</summary><label>ホテル名<input id="routeHotelName" maxlength="80" value="${esc(S.hotelSplit?nightsArr()[c.ni]?.name||'':S.hotelName||'')}"></label><label>緯度・経度（任意）<input id="routeHotelCoords" placeholder="例：34.9858, 135.7588"></label><button class="btn" type="button" data-route-manual-stay>この宿を予定に登録</button></details>`;
  if(valid&&r.message)h+=`<p class="booking-notice" role="status">${esc(r.message)}</p>`;
  if(ROUTE_UI.hotelBusy)h+='<p class="booking-notice" role="status">ホテルの候補を確認しています…</p>';
  if(fresh&&r.items.length)h+=`<div class="booking-results">${r.items.map((x,i)=>{const h=bookingHotelCard(x,i);return h.replace('<div class="booking-actions">',`<p class="booking-reason">${mode==='undecided'?`当日の最後・翌日の最初の観光地まで、合計約${x.routeDistance.toFixed(1)}km／泊（直線距離）`:'同名の施設がある場合は住所をご確認ください。'}</p><div class="booking-actions">`);}).join('')}</div><div class="booking-credit">${BOOKING_CREDIT_RK}</div>`;
  h+=`<div class="booking-fallback"><p>候補の取得ができない場合も、このエリアから探せます。</p>${bookingHotelLinks({name:mode==='decided'?(DRAFT.routeHotelQuery||S.hotelName||c.center.name):(c.center.name||cityLabel()||S.pref)})}</div><p class="note">予定への追加と予約は別です。空室・最終料金は予約サイトでご確認ください。</p></section>`;
  return h;
};
async function bookingRouteHotelSearch(query=''){
  const previous=S.hotelMode==='undecided'&&S.hotelPick>=0?S.hotelCands?.[S.hotelPick]:null;
  if(previous&&!S.hotelSplit){S.stayDecision=S.stayDecision||'undecided';S.hotelName=previous.name;S.hotelLoc={lat:previous.lat,lng:previous.lng};S.hotelInfo=previous;S.hotelMode='decided';S.hotelPick=-1;}
  const c=bookingStayContext(),key=bookingStayKey(c),state=S,pid=APP.pid,seq=++ROUTE_UI.hotelSeq;
  ROUTE_UI.hotelBusy=true;ROUTE_UI.hotel={key,items:[],message:''};render();
  try{
    const j=await BookingAPI.get('/hotels',query?{q:query}:{lat:c.center.lat.toFixed(5),lng:c.center.lng.toFixed(5)});
    if(S!==state||APP.pid!==pid||seq!==ROUTE_UI.hotelSeq||bookingStayKey()!==key)return;
    const items=bookingRankHotels(j.items.map(h=>({name:h.name,lat:h.lat,lng:h.lng,addr:h.address,kind:'ホテル',type:'hotel',hotel:true,hotelNo:h.id,providerId:'rakuten:'+h.id,osm:'rakuten:'+h.id,rkURL:h.url,rkPlanURL:h.planUrl,apiPhoto:h.photo,apiExpiresAt:j.expiresAt,rate:h.rating,cnt:h.reviewCount,access:h.access,minCharge:h.minCharge,src:'rakuten'})),c);
    // Candidate refresh never changes a previously selected stay.
    S.hotelCands=items;S.hotelPick=-1;
    ROUTE_UI.hotel={key:bookingStayKey(),items,expiresAt:j.expiresAt,message:items.length?'観光ルートに合う候補です。宿を選んでから、必要に応じて空室を確認できます。':'このエリアの施設が見つかりませんでした。外部サイトで周辺の宿もご確認ください。'};save();
  }catch(e){if(S===state&&APP.pid===pid&&seq===ROUTE_UI.hotelSeq)ROUTE_UI.hotel={key,items:[],message:bookingMessage(e)};}
  finally{if(seq===ROUTE_UI.hotelSeq){ROUTE_UI.hotelBusy=false;render();}}
}
bookingPickHotel=function(i){
  const r=ROUTE_UI.hotel;if(!r||r.key!==bookingStayKey()||r.expiresAt<=Date.now())return;
  const h=r.items[i];if(!h)return;
  if(S.hotelSplit)nightsArr()[bookingStayContext().ni]={name:h.name,loc:{lat:h.lat,lng:h.lng},addr:h.addr,info:h};
  else{S.hotelName=h.name;S.hotelLoc={lat:h.lat,lng:h.lng};S.hotelInfo=h;S.hotelMode='decided';S.hotelPick=-1;}
  save();render();toast('宿を予定に追加しました。予約は予約サイトでお手続きください。');
};
function bookingManualPoint(id){const raw=document.getElementById(id)?.value.trim();if(!raw)return null;const m=raw.match(/^\s*(\d+(?:\.\d+)?)\s*[,、]\s*(\d+(?:\.\d+)?)\s*$/);if(!m||+m[1]<20||+m[1]>46||+m[2]<122||+m[2]>154)throw new Error('緯度・経度を「34.9858, 135.7588」の形で入力してください');return {lat:+m[1],lng:+m[2]};}
function bookingPutFood(f,c){
  const existing=bookingMealPicked(c);
  if(existing.some(w=>w.providerId&&w.providerId===f.providerId)){toast('この食事には追加済みです');return;}
  // One meal per slot. Replace that slot only; the same shop may be used another day.
  S.wishes=S.wishes.filter(w=>!existing.includes(w));
  if(S.dayOf)for(const w of existing)delete S.dayOf[w.id];
  if(S.manualOrd)for(const k of Object.keys(S.manualOrd))S.manualOrd[k]=S.manualOrd[k].filter(id=>!existing.some(w=>w.id===id));
  const id=newId();S.wishes.push({...f,id,q:f.name,food:true,meal:c.slot,day:c.di+1,stay:MEALWIN[c.slot].stay,status:bookingPoint(f)?'ok':'pending',anchor:''});
  if(S.manualOrd?.[c.di]?.length&&bookingPoint(f)){
    const order=S.manualOrd[c.di];let at=c.slot==='朝'?0:c.slot==='夜'?order.length:c.after?.id?order.indexOf(c.after.id):-1;
    if(at<0)at=c.before?.id&&order.includes(c.before.id)?order.indexOf(c.before.id)+1:order.length;
    order.splice(at,0,id);
  }
  save();render();toast(`${c.di+1}日目の${MEALNAME[c.slot]}に登録しました`);
}
const bookingPreviousCanNext=canNext;
canNext=function(){if(S?.step===6)return nNights()===0||!!bookingStayDecision()||'宿泊場所が決まっているか選んでください';return bookingPreviousCanNext();};
// Eliminate the old render-triggered Overpass hotel search.
webHotels=async()=>{};
function bookingResetFoodRequest(){ROUTE_UI.foodSeq++;ROUTE_UI.foodBusy=false;ROUTE_UI.food=null;}
function bookingResetHotelRequest(){ROUTE_UI.hotelSeq++;ROUTE_UI.hotelBusy=false;ROUTE_UI.hotel=null;}
document.addEventListener('toggle',e=>{if(e.target.isConnected&&e.target.matches?.('.booking-conditions'))ROUTE_UI.conditionsOpen=e.target.open;},true);
document.addEventListener('input',e=>{if(e.target.id==='routeFoodQuery')DRAFT.routeFoodQuery=e.target.value;if(e.target.id==='routeHotelQuery')DRAFT.routeHotelQuery=e.target.value;});
document.addEventListener('submit',e=>{
  if(e.target.id==='routeFoodSearch'){e.preventDefault();const q=String(new FormData(e.target).get('query')||'').trim();if(!q)return toast('店名を入力してください');bookingRouteFoodSearch(q);}
  if(e.target.id==='routeHotelSearch'){e.preventDefault();const q=String(new FormData(e.target).get('query')||'').trim();if(q.length<2)return toast('ホテル名を2文字以上で入力してください');bookingRouteHotelSearch(q);}
});
document.addEventListener('change',e=>{
  const t=e.target;
  if(t.hasAttribute('data-route-day')){S.bookingFoodDay=Number(t.value);bookingResetFoodRequest();save();render();if(bookingMealDecision()==='undecided')bookingRouteFoodSearch();}
  if(t.hasAttribute('data-route-night'))bookingSelectNight(t.value);
});
document.addEventListener('click',e=>{
  const t=e.target.closest('[data-route-food],[data-route-stay],[data-route-slot],[data-route-dish],[data-route-refresh-food],[data-route-refresh-stay],[data-route-addfood],[data-route-manual-food],[data-route-manual-stay],[data-route-split],[data-route-open-food],[data-route-open-stay],[data-route-select-night]');if(!t)return;
  const d=t.dataset;
  if(d.routeFood){S.mealDecisions={...(S.mealDecisions||{}),[bookingFoodDay()+'|'+bookingFoodSlot()]:d.routeFood};bookingResetFoodRequest();save();render();if(d.routeFood==='undecided')bookingRouteFoodSearch();}
  if(d.routeStay){if(S.hotelSplit)S.stayDecisions={...(S.stayDecisions||{}),[bookingNightIndex()]:d.routeStay};else S.stayDecision=d.routeStay;if(!S.hotelName)S.hotelMode=d.routeStay;bookingResetHotelRequest();save();render();if(d.routeStay==='undecided')bookingRouteHotelSearch();}
  if(d.routeSlot){S.bookingFoodSlot=d.routeSlot;bookingResetFoodRequest();save();render();if(bookingMealDecision()==='undecided')bookingRouteFoodSearch();}
  if(d.routeDish)bookingRouteFoodSearch(d.routeDish);
  if(t.hasAttribute('data-route-refresh-food'))bookingRouteFoodSearch();
  if(t.hasAttribute('data-route-refresh-stay'))bookingRouteHotelSearch();
  if(d.routeAddfood!==undefined){const c=bookingMealContext(),r=ROUTE_UI.food;if(r?.key===bookingMealKey(c)&&r.expiresAt>Date.now()&&r.items[+d.routeAddfood])bookingPutFood(r.items[+d.routeAddfood],c);}
  if(t.hasAttribute('data-route-manual-food')){try{const name=document.getElementById('routeFoodName').value.trim();if(!name)return toast('店名を入力してください');const loc=bookingManualPoint('routeFoodCoords');bookingPutFood({name,lat:loc?.lat??null,lng:loc?.lng??null,src:'mine'},bookingMealContext());}catch(err){toast(err.message);}}
  if(t.hasAttribute('data-route-manual-stay')){try{const name=document.getElementById('routeHotelName').value.trim();if(!name)return toast('ホテル名を入力してください');const loc=bookingManualPoint('routeHotelCoords');if(S.hotelSplit)nightsArr()[bookingStayContext().ni]={name,loc};else{S.hotelName=name;S.hotelLoc=loc;S.hotelInfo=null;S.hotelMode='decided';S.hotelPick=-1;}save();render();}catch(err){toast(err.message);}}
  if(d.routeSplit!==undefined)bookingSetSplit(d.routeSplit==='1');
  if(d.routeSelectNight!==undefined)bookingSelectNight(d.routeSelectNight);
  if(d.routeOpenFood!==undefined){const [di,slot]=d.routeOpenFood.split('|');S.bookingFoodDay=+di;S.bookingFoodSlot=slot;bookingResetFoodRequest();APP.ptab='plan';S.step=5;S.visited=Math.max(5,S.visited||0);save();render();window.scrollTo({top:0});}
  if(d.routeOpenStay!==undefined){bookingCommitDates();/* 連泊の設定のまま開く（泊ごとに分けるかは STEP6 で利用者が選ぶ） */S.bookingNight=S.hotelSplit?+d.routeOpenStay:0;bookingResetHotelRequest();APP.ptab='plan';S.step=6;S.visited=Math.max(6,S.visited||0);save();render();window.scrollTo({top:0});}
});
