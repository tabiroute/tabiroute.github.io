/* 宿泊（STEP7）の画面をつくり直す：言葉を少なく、選ぶ順番どおりに並べる。
   ①泊まり方（同じホテル／泊ごと）→ ②決まっている／まだ → ③どこに泊まる？（おすすめ・駅の近く・市や町）
   → ④詳細な条件（駅近・バス・トイレ別・禁煙など。開いたときだけ表示）→ 探す → 候補
   条件のうち「禁煙・Wi-Fi・大浴場・温泉」は楽天トラベルの検索で絞り、「駅近・駐車場・評価」は施設の情報で確かめる。
   「バス・トイレ別」は施設の設備一覧に書いてあるときだけ「あり」とし、書いていない宿は「要確認」として残す。 */
PLAN_KEYS.push('stayArea','stayCond');
const STAY2={st:{},stBusy:{},moreOpen:false,datesOpen:false};
const STAY2_COND=[['st5','駅近（徒歩5分）'],['bt','バス・トイレ別'],['kinen','禁煙'],['daiyoku','大浴場'],['onsen','温泉'],['internet','Wi-Fi'],['park','駐車場'],['r4','評価4.0以上']];
const STAY2_API=new Set(['kinen','internet','daiyoku','onsen']);
function stay2Key(){return S.hotelSplit?'n'+bookingNightIndex():'all';}
function stay2Area(){return (S.stayArea||{})[stay2Key()]||{kind:'rec'};}
function stay2Conds(){return ((S.stayCond||{})[stay2Key()]||[]).filter(k=>STAY2_COND.some(c=>c[0]===k));}
// 検索の中心：おすすめ以外（駅・市町）を選んだときは、その場所で探す
const stay2BaseContext=bookingStayContext;
bookingStayContext=function(plan){
  const c=stay2BaseContext(plan),a=stay2Area();
  // 選んだ駅・市町が、いまの観光ルートから遠い（行き先を変えたあとなど）ときは使わない
  if(a.kind!=='rec'&&a.name&&Number.isFinite(+a.lat)&&Number.isFinite(+a.lng)&&hav(c.center,{lat:+a.lat,lng:+a.lng})<=60)return {...c,rec:c.center,center:{name:a.name,lat:+a.lat,lng:+a.lng},area:a};
  return {...c,rec:c.center};
};
function stay2Api(c){
  const a=stay2Area(),conds=stay2Conds().filter(k=>STAY2_API.has(k));
  // 日程・人数を付けると、その日に空室がある宿と、その日の料金で探す（Worker booking-v14 以降）
  const bc=bookingConditions(),dates=bookingValid(bc)&&!bc.children?{checkin:bc.checkin,checkout:bc.checkout,adults:bc.adults,rooms:bc.rooms}:{};
  return {r:c.area?.kind==='st'?'1':'3',...(conds.length?{cond:conds.join(',')}:{}),...dates};
}
function stay2Walk(h){const ms=[...String(h.access||'').normalize('NFKC').matchAll(/徒歩\s*(?:約)?\s*(\d+)\s*分/g)].map(m=>+m[1]);return ms.length?Math.min(...ms):null;}
function stay2Check(k,h,j){
  if(STAY2_API.has(k))return String(j?.cond||'').split(',').includes(k)?'ok':'?';   // 古い Worker は条件を受け取らないので「要確認」
  if(k==='st5'){const w=stay2Walk(h);return w==null?'?':w<=5?'ok':'no';}
  if(k==='bt'){const f=h.facilities||[];return f.some(x=>/バス.?トイレ.?別|バス.?トイレ.?セパレート/.test(x))?'ok':'?';}
  if(k==='park'){const p=String(h.parking||'').normalize('NFKC');return /あり|有|可能|台/.test(p)?'ok':/^(なし|無し|不可)|駐車場(は)?(なし|無し)/.test(p)?'no':'?';}
  if(k==='r4'){return h.rate==null?'?':h.rate>=4?'ok':'no';}
  return '?';
}
function stay2Apply(items,j,c){
  const conds=stay2Conds(),label=k=>STAY2_COND.find(x=>x[0]===k)[1];
  // 古い Worker（半径を受け取らない）で駅の近くを選んだときは、ここで約1.2km以内に絞る
  if(c?.area?.kind==='st'&&j&&j.radius==null)items=items.filter(h=>hav(c.center,h)<=1.2);
  if(!conds.length)return {items:items.map(h=>({...h,walk:stay2Walk(h)})),message:''};
  const out=items.map(h=>{const r=conds.map(k=>[k,stay2Check(k,h,j)]);return {...h,walk:stay2Walk(h),condOk:r.filter(x=>x[1]==='ok').map(x=>label(x[0])),condUnk:r.filter(x=>x[1]==='?').map(x=>label(x[0])),condNo:r.some(x=>x[1]==='no')};}).filter(h=>!h.condNo);
  out.sort((a,b)=>a.condUnk.length-b.condUnk.length);
  const all=out.filter(h=>!h.condUnk.length).length;
  return {items:out,message:out.length?`条件に合う宿 ${all}件${out.length>all?`・要確認 ${out.length-all}件`:''}`:'条件に合う宿が見つかりませんでした。条件を減らすか、場所を変えてください。'};
}
// 駅の候補：主な駅（新幹線・特急の駅）と、地図データの駅（中心から2.5km以内）
function stay2StKey(p){return p.lat.toFixed(3)+','+p.lng.toFixed(3);}
// 駅の候補：その県の主な駅（booking/stations.js。観光の中心から近い順）＋ 近くの駅（地図データ、2.5km以内・3つまで）
function stay2Prefs(c){
  const ps=new Set();(c?.pairs||[]).forEach(p=>[p.before,p.after].forEach(x=>{if(x&&bookingPoint(x))ps.add(typeof prefAt==='function'?prefAt(x):S.pref);}));
  if(!ps.size)(typeof tripPrefs==='function'?tripPrefs():[S.pref]).forEach(p=>ps.add(p));
  return [...ps].filter(Boolean);
}
function stay2Stations(c){
  const rec=c.rec||c.center,M=window.TABIROUTE_MAIN_STATIONS||{};
  // 遠すぎる駅（60km超）は出さない（選んでも観光ルートから遠いため使わない：bookingStayContext と同じ基準）
  const main=stay2Prefs(c).flatMap(p=>(M[p]||[]).map(([name,lat,lng])=>({name,lat,lng,d:hav(rec,{lat,lng}),major:true}))).filter(x=>x.d<=60).sort((a,b)=>a.d-b.d);
  const near=(STAY2.st[stay2StKey(rec)]||[]).filter(x=>!main.some(m=>m.name===x.name)).slice(0,3);
  return [...main.slice(0,8),...near];
}
async function stay2LoadStations(p){
  const k=stay2StKey(p);if(STAY2.st[k]||STAY2.stBusy[k])return;STAY2.stBusy[k]=true;
  const list=[];
  try{const j=await overpass(`[out:json][timeout:15];node["railway"="station"]["name"](around:2500,${p.lat},${p.lng});out 40;`,9000);
    (j.elements||[]).forEach(e=>{const n=String(e.tags?.['name:ja']||e.tags?.name||'').replace(/駅$/,'');if(!n)return;const q={lat:e.lat,lng:e.lon};if(!list.some(x=>x.name===n+'駅'))list.push({name:n+'駅',lat:q.lat,lng:q.lng,d:hav(p,q)});});}catch{}
  list.sort((a,b)=>a.d-b.d);
  STAY2.st[k]=list.slice(0,6);STAY2.stBusy[k]=false;
  if(S?.step===6)render();
}
// 市・町の候補：その泊の前後（連泊なら全日程）の観光地がある市町
function stay2Cities(c){
  const plan=bookingRoutePlan(),days=S.hotelSplit?[c.ni,c.ni+1]:plan.days.map((d,i)=>i);
  const stops=days.flatMap(i=>plan.days[i]?.ord||[]).filter(x=>!x.meal&&bookingPoint(x));
  const base=(typeof allSpotsTrip==='function'?allSpotsTrip():allSpots(S.pref)).filter(x=>x.src==='base');
  const cityOf=x=>x.city||base.reduce((b,s)=>{const d=hav(s,x);return d<b.d?{c:s.city,d}:b;},{c:'',d:12}).c;
  const m=new Map();stops.forEach(x=>{const n=cityOf(x);if(!n)return;const o=m.get(n)||{name:n,n:0,pts:[]};o.n++;o.pts.push(x);m.set(n,o);});
  return [...m.values()].sort((a,b)=>b.n-a.n).slice(0,6).map(o=>{const ref=base.filter(s=>s.city===o.name);const ps=ref.length?ref:o.pts;return {name:o.name,lat:ps.reduce((a,s)=>a+s.lat,0)/ps.length,lng:ps.reduce((a,s)=>a+s.lng,0)/ps.length};});
}
function stay2PlanHTML(){
  if(nNights()<2)return '';
  const c=bookingStayComparison(),rec=!!c?.recommend;
  const opt=(v,t,on)=>`<button type="button" class="stay2-pill" data-route-split="${v}" aria-pressed="${on}">${t}${(v==='1')===rec?'<i>おすすめ</i>':''}</button>`;
  return `<div class="stay2-row"><span class="stay2-h">泊まり方</span><div class="stay2-pills">${opt('0','同じホテル',!S.hotelSplit)}${opt('1','泊ごとに選ぶ',!!S.hotelSplit)}</div></div><p class="stay2-why">${rec?`泊ごとに分けると、移動が約${Math.round(c.gain)}km短くなります。`:'荷物を置いたまま観光できます。'}</p>`;
}
function stay2NightsHTML(){
  if(!S.hotelSplit)return '';
  const ns=nightsArr();
  return `<div class="stay2-nights" role="tablist" aria-label="泊ごと">${Array.from({length:nNights()},(_,i)=>{const n=ns[i]||{};return `<button type="button" class="stay2-night" role="tab" data-route-select-night="${i}" aria-pressed="${i===bookingNightIndex()}"><b>${i+1}泊目</b><span>${esc(fmtDay(new Date(bookingAddDays(bookingDateState().startDate,i)+'T12:00:00')))}</span><small>${n.name?'✓ '+esc(n.name):'未定'}</small></button>`;}).join('')}</div>`;
}
function stay2WhereHTML(c){
  const a=stay2Area(),rec=c.rec||c.center;
  const opt=(k,t,sub)=>`<button type="button" class="stay2-where-o" data-stay-kind="${k}" aria-pressed="${a.kind===k}"><b>${t}</b><span>${esc(sub)}</span></button>`;
  let h=`<div class="stay2-block"><p class="stay2-h">どこに泊まる？</p><div class="stay2-where">${opt('rec','おすすめ',(rec?.name||'観光地')+'周辺')}${opt('st','駅の近く',a.kind==='st'&&a.name?a.name:'駅を選ぶ')}${opt('city','市・町',a.kind==='city'&&a.name?a.name:'市町を選ぶ')}</div>`;
  if(a.kind==='st'){const k=stay2StKey(rec);if(!STAY2.st[k])stay2LoadStations(rec);const list=stay2Stations(c);
    h+=`<div class="chips stay2-chips">${list?list.length?list.map((s,i)=>`<button type="button" class="chip" data-stay-pick="st|${esc(s.name)}" aria-pressed="${a.name===s.name}">${esc(s.name)}</button>`).join(''):'<span class="note">近くの駅が見つかりませんでした。「市・町」から選んでください。</span>':'<span class="note"><span class="spin"></span>近くの駅を探しています…</span>'}</div>`;}
  if(a.kind==='city'){const list=stay2Cities(c);
    h+=`<div class="chips stay2-chips">${list.length?list.map((s,i)=>`<button type="button" class="chip" data-stay-pick="city|${esc(s.name)}" aria-pressed="${a.name===s.name}">${esc(s.name)}</button>`).join(''):'<span class="note">観光地を選ぶと、市・町が出ます。</span>'}</div>`;}
  return h+'</div>';
}
function stay2MoreHTML(){
  const on=new Set(stay2Conds()),n=on.size;
  return `<details class="stay2-more" ${STAY2.moreOpen?'open':''}><summary>詳細な条件を選ぶ${n?`<span class="stay2-count">${n}</span>`:''}</summary>
   <div class="chips stay2-chips">${STAY2_COND.map(([k,l])=>`<button type="button" class="chip" data-stay-cond="${k}" aria-pressed="${on.has(k)}">${on.has(k)?'✓ ':''}${l}</button>`).join('')}</div>
   ${typeof budgetEditor==='function'?budgetEditor('hotel'):''}
   <details class="stay2-dates" ${STAY2.datesOpen?'open':''}><summary>日程・人数：${esc(bookingConditionText())}</summary>${bookingHotelFields()}</details>
  </details>`;
}
function stay2Card(x,i,mode){
  let h=bookingHotelCard(x,i);
  const tags=[x.walk!=null?`駅から徒歩${x.walk}分`:'',...(x.condOk||[]).map(t=>'✓ '+t)].filter(Boolean);
  // 検索した日の料金（1室1泊）と、安いプラン（最大3つ）
  const md=d=>{const t=new Date(String(d||'')+'T12:00:00');return isNaN(t)?'':fmtDay(t);};
  const price=x.datePrice>0?`<div class="stay2-price"><b>${Number(x.datePrice).toLocaleString()}円〜</b><span>${esc(md(x.dateStay?.checkin))} 1泊・1室（大人${x.dateStay?.adults||1}名）</span></div>`:'';
  const plans=(x.plans||[]).filter(p=>p.url).slice(0,3);
  const planHTML=plans.length?`<ul class="stay2-plans">${plans.map(p=>{const u=bookingSafeURL(p.url);return `<li><a href="${esc(u)}" target="_blank" rel="${bookingRel(u)}"><span>${esc(p.name)}${p.breakfast?'<i>朝食</i>':''}${p.dinner?'<i>夕食</i>':''}</span><b>${p.price?.perRoom>0?Number(p.price.perRoom).toLocaleString()+'円':'料金は楽天で'}</b></a></li>`;}).join('')}</ul>`:'';
  const extra=`${price}${planHTML}${tags.length||x.condUnk?.length?`<p class="stay2-tags">${tags.map(t=>`<span>${esc(t)}</span>`).join('')}${x.condUnk?.length?`<span class="unk">要確認：${esc(x.condUnk.join('・'))}</span>`:''}</p>`:''}${mode==='undecided'&&Number.isFinite(x.routeDistance)?`<p class="note">観光地まで 約${x.routeDistance.toFixed(1)}km／泊（直線）</p>`:''}`;
  return h.replace('<div class="booking-actions">',extra+'<div class="booking-actions">');
}
stepHotel=function(){
  if(!nNights())return `<section class="panel booking-panel">${head(6,'今回は日帰りです','宿泊の入力はいりません。')}<button class="btn" type="button" data-go="1">日程を変える</button></section>`;
  const mode=bookingStayDecision(),c=bookingStayContext(),r=ROUTE_UI.hotel,valid=r?.key===bookingStayKey(c),fresh=valid&&r.expiresAt>Date.now();
  let h=`<section class="panel booking-panel booking-flow stay2">${head(6,'泊まるところ','')}${stay2PlanHTML()}${stay2NightsHTML()}`;
  if(!S.hotelSplit)h+=bookingStaySelections();
  h+=`<p class="stay2-h">${S.hotelSplit?`${bookingNightIndex()+1}泊目の宿は決まっていますか？`:'宿は決まっていますか？'}</p>${bookingDecisionHTML('stay',mode).replace('観光の順序からおすすめを選ぶ','場所と条件から選ぶ')}`;
  if(!mode)return h+'<p class="note">未定のままでも予定表はつくれます。</p></section>';
  if(mode==='undecided'){
    const a=stay2Area(),need=a.kind!=='rec'&&!a.name;
    h+=stay2WhereHTML(c)+stay2MoreHTML()+`<button type="button" class="btn primary stay2-go" data-route-refresh-stay ${ROUTE_UI.hotelBusy||need?'disabled':''}>${ROUTE_UI.hotelBusy?'探しています…':need?(a.kind==='st'?'駅を選んでください':'市・町を選んでください'):'この条件でホテルを探す'}</button>`;
  }else{
    h+=`<form id="routeHotelSearch" class="booking-search"><label for="routeHotelQuery">ホテルの名前</label><div class="row"><input id="routeHotelQuery" name="query" maxlength="80" placeholder="ホテルの正式名称" value="${esc(DRAFT.routeHotelQuery||'')}"><button class="btn primary" ${ROUTE_UI.hotelBusy?'disabled':''}>確認</button></div></form><details class="booking-manual"><summary>手入力で登録</summary><label>ホテル名<input id="routeHotelName" maxlength="80" value="${esc(S.hotelSplit?nightsArr()[c.ni]?.name||'':S.hotelName||'')}"></label><label>緯度・経度（なくてもOK）<input id="routeHotelCoords" placeholder="例：34.9858, 135.7588"></label><button class="btn" type="button" data-route-manual-stay>この宿を登録</button></details><details class="stay2-dates" ${STAY2.datesOpen?'open':''}><summary>日程・人数：${esc(bookingConditionText())}</summary>${bookingHotelFields()}</details>`;
  }
  if(valid&&r.message)h+=`<p class="booking-notice" role="status">${esc(r.message)}</p>`;
  if(fresh&&r.items.length)h+=`<div class="booking-results">${r.items.map((x,i)=>stay2Card(x,i,mode)).join('')}</div><div class="booking-credit">${BOOKING_CREDIT_RK}</div>`;
  h+=`<div class="booking-fallback">${bookingHotelLinks({name:mode==='decided'?(DRAFT.routeHotelQuery||S.hotelName||c.center.name):(c.center.name||cityLabel()||S.pref)})}</div><p class="note">「予定に追加」は予約ではありません。空室・料金は予約サイトで確認してください。</p>`;
  h+=(typeof plannerHotelForm==='function'?plannerHotelForm():'')+(typeof plannerCompareHTML==='function'?plannerCompareHTML('hotel'):'');
  return h+'</section>';
};
function stay2Set(fn){const all={...(S.stayArea||{})};fn(all);S.stayArea=all;bookingResetHotelRequest();if(typeof bookingRouteMemo!=='undefined')bookingRouteMemo=null;save();render();}
document.addEventListener('click',e=>{
  const t=e.target.closest('[data-stay-kind],[data-stay-pick],[data-stay-cond]');if(!t)return;
  const k=stay2Key();
  if(t.dataset.stayKind){const kind=t.dataset.stayKind;stay2Set(all=>{all[k]={kind};});if(kind==='rec'&&bookingStayDecision()==='undecided')bookingRouteHotelSearch();}
  else if(t.dataset.stayPick){const [kind,...rest]=t.dataset.stayPick.split('|'),i=rest.join('|'),c=bookingStayContext();const rec=c.rec||c.center;const list=kind==='st'?stay2Stations(c):stay2Cities(c);const p=list.find(x=>x.name===i);if(!p)return;stay2Set(all=>{all[k]={kind,name:p.name,lat:p.lat,lng:p.lng};});bookingRouteHotelSearch();}
  else if(t.dataset.stayCond){const on=new Set(stay2Conds()),v=t.dataset.stayCond;on.has(v)?on.delete(v):on.add(v);S.stayCond={...(S.stayCond||{}),[k]:[...on]};STAY2.moreOpen=true;bookingResetHotelRequest();save();render();}
});
document.addEventListener('toggle',e=>{if(!e.target.isConnected)return;if(e.target.matches?.('.stay2-more'))STAY2.moreOpen=e.target.open;if(e.target.matches?.('.stay2-dates'))STAY2.datesOpen=e.target.open;},true);
// 日程・人数を変えたら、空室と料金が変わるので、少し待って探し直す（何度も変えたときは最後の1回だけ）
let stay2Redo=0;
document.addEventListener('change',e=>{if(!e.target.closest?.('[data-bk-field]')||S?.step!==6||bookingStayDecision()!=='undecided')return;clearTimeout(stay2Redo);stay2Redo=setTimeout(()=>{if(S?.step===6&&bookingStayDecision()==='undecided')bookingRouteHotelSearch();},700);});
// 開いた・閉じたをすぐ覚える（toggle イベントは遅れて届くため、そのあいだに画面を作り直すと閉じてしまう）
document.addEventListener('click',e=>{const sm=e.target.closest?.('summary');if(!sm)return;const d=sm.parentElement;if(d?.matches('.stay2-more'))STAY2.moreOpen=!d.open;else if(d?.matches('.stay2-dates'))STAY2.datesOpen=!d.open;},true);
