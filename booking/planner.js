/* v6: explicit constraints, protected reservations and editable recovery proposals. */
PLAN_KEYS.push('stopRules','stayRules','visitOrder','mealOmissions');
const plannerRule=id=>S.stopRules?.[id]||{};
const plannerStay=i=>({checkin:'15:00',checkinEnd:'23:00',checkout:'10:00',inMinutes:15,outMinutes:15,bagMinutes:15,luggage:'carry',...S.stayRules?.[i],burden:0});
// 宿が未定（エリアの目安）のときは、同じエリアなら連泊とみなす。片方だけ未定なら別の宿として扱う。
const plannerSame=(a,b)=>!!(a&&b)&&(a.area||b.area?(!!a.area&&!!b.area&&hav(a,b)<0.1):((bookingID(a)&&bookingID(a)===bookingID(b))||(a.name===b.name&&hav(a,b)<0.1)));
const plannerOldOrder=orderPath;
orderPath=function(A,B,arr){if(!['near','far'].includes(S.visitOrder))return plannerOldOrder(A,B,arr);return arr.slice().sort((a,b)=>(hav(A,a)-hav(A,b))*(S.visitOrder==='far'?-1:1));};
const plannerReservationDay=r=>r.date?Math.round((Date.parse(r.date+'T12:00:00Z')-Date.parse(bookingISO(dayDate(0))+'T12:00:00Z'))/86400000):Number(r.day)||0;
const plannerBaseStops=stopsAll;
stopsAll=function(){return plannerBaseStops().filter(s=>{const r=plannerRule(s.id);return !r.fixed||(plannerReservationDay(r)>=0&&plannerReservationDay(r)<S.days);});};
const plannerOldBuild=buildPlan;
buildPlan=function(){
 // Reservations retain their day even when the general order is reset.
 const saved=S.dayOf;S.dayOf={...saved};for(const [id,r]of Object.entries(S.stopRules||{}))if(r.fixed)S.dayOf[id]=plannerReservationDay(r);
 try{const plan=plannerOldBuild();for(const s of plannerBaseStops()){const r=plannerRule(s.id);if(r.fixed&&(plannerReservationDay(r)<0||plannerReservationDay(r)>=S.days))plan.days[0]?.issues.push({id:s.id,code:'reservation-outside',message:s.name+'：予約日 '+(r.date||((+r.day+1)+'日目'))+' が旅行期間外です。予約日は変更していません',short:0});}return plan;}finally{S.dayOf=saved;}
};
schedule=function(H,seq,hasLunchRest,from,t0,to,di=0){
 const dt=dayTime(di),start=t0?t2m(t0):t2m(dt.start),z=to||H,a=from||H;
 let end=t2m(dt.end);if(to?.tripHub){const tr=tripMemo();if(tr)end=tr.endBy!=null?Math.min(end,tr.endBy):end-tr.backMin;}
 const prev=di>0?hotelPoint(stopsAll(),di-1):null,tonight=di<nNights()?hotelPoint(stopsAll(),di):null;
 const changing=prev&&(!tonight||!plannerSame(prev,tonight));
 const pr=plannerStay(Math.max(0,di-1)),nr=plannerStay(di);
 const checkout=changing?{duration:+pr.outMinutes+(tonight?+nr.burden:0),latest:t2m(pr.checkout)}:null;
 const checkin=tonight&&(!prev||changing)?{duration:+nr.inMinutes,earliest:t2m(nr.checkin),latest:t2m(nr.checkinEnd)}:null;
 let luggage=null;
 if(changing&&pr.luggage==='previous')luggage={drop:prev,retrieve:prev,duration:+pr.bagMinutes};
 else if(tonight&&nr.luggage==='next'&&(!prev||changing))luggage={drop:tonight,duration:+nr.bagMinutes};
 const meals=MEALS.filter(m=>(m!=='休憩'||S.cafeDays?.[di])&&!seq.some(s=>s.meal===m)&&!S.mealOmissions?.[di+'|'+m]).map(m=>({missing:true,id:'missing-'+di+'-'+m,meal:m,target:m==='朝'?Math.max(start,8*60):m==='昼'?12*60:m==='休憩'?15*60:17*60+30,stay:m==='朝'?30:m==='休憩'?45:60}));
 // 食事の枠を観光の予定に入れる条件。朝食は10時より前に始まる日だけ。
 // 昼食・夕食は、その時間帯に観光しているときだけ入れる（到着が夕方なら昼食は行きの移動中に回す）。
 const active=meals.filter(m=>m.meal==='朝'?start<10*60:m.meal==='昼'?(start<=13*60+30&&end>=12*60+30):m.meal==='休憩'?(start<=15*60+30&&end>=16*60):(start<=20*60&&(di<nNights()||end>=19*60)));
 globalThis.ODPT_DAYKEY=bookingISO(dayDate(di)); // その日の時刻表の結果だけを使う（booking/odpt.js）
 const r=TravelPlanner.calculate({seq,rules:S.stopRules,date:bookingISO(dayDate(di)),start,end,from:a,to:z,pace:paceK(),buffer:paceBuf(),route:(a,b)=>{if(hav(a,b)<0.01)return {min:0,km:0,mode:'walk'};const l=leg(a,b),u=typeof legUserTime==='function'?legUserTime(di,a,b):null;return u&&l.mode==='transit'?{...l,odpt:null,user:u}:l;},checkout,checkin,luggage,endAtLast:di===S.days-1&&!to?.tripHub,eveningAfterEnd:di<nNights()&&!to?.tripHub,meals:dt.off?[]:active});
 globalThis.ODPT_DAYKEY=null;
 // 観光の時間に入らなかった昼食・夕食は、行き・帰りの移動中（空港・乗り換え・長い乗車）に置けるか、あとで確かめる
 r.travelMeals=dt.off?[]:meals.filter(m=>!active.includes(m)&&(m.meal==='昼'||m.meal==='夜')).map(m=>m.meal);
 return r;
};
function plannerItemHTML(it,d){
 const button=it.type==='missingMeal'?`<button class="btn small primary" type="button" data-route-open-food="${d.di}|${it.meal}">${d.di+1}日目の${MEALNAME[it.meal]}を決める</button><button class="linkbtn" data-pl-omit="${d.di}|${it.meal}">この食事は不要</button>`:'';
 const label=it.type==='missingMeal'?`${MEALNAME[it.meal]} · お店は未定`:it.label;
 return `<li class="planner-event"><div class="t">${it.outside?'予定外':m2t(it.t)}</div><div class="stop"><div class="nm">${esc(label)}</div><div class="sm">${it.dur?`${it.dur}分を確保`:it.type==='missingMeal'?(it.outside?'観光の前後の食事です。必要に応じてお店を指定できます。':'時間未確保・予約前後の予定を調整してください。'):''}</div>${button}</div></li>`;
}
function plannerRuleForm(s,di){
 const r=plannerRule(s.id),key=esc(s.id);
 const input=(k,label,type='text',value=r[k]||'',extra='')=>`<label>${label}<input type="${type}" data-pl-rule="${key}" data-field="${k}" value="${esc(value)}" ${extra}></label>`;
 return `<details class="planner-rule"><summary>${esc(s.name)}${r.fixed?' · '+esc(r.time)+' 予約固定':''}${r.hours?' · 営業時間設定済み':''}</summary><div class="planner-fields">
 <label><input type="checkbox" data-pl-rule="${key}" data-field="fixed" ${r.fixed?'checked':''}>予約時刻を固定する</label>
 <label>予約する日<select data-pl-rule="${key}" data-field="day">${Array.from({length:S.days},(_,i)=>`<option value="${i}" ${i===(r.day??di??0)?'selected':''}>${i+1}日目</option>`).join('')}</select></label>
 ${input('date','予約日（固定）','date',r.date||bookingISO(dayDate(r.day??di??0)))}${input('time','予約の開始時刻','time',r.time||'13:00')}${input('duration','滞在時間（分）','number',r.duration||s.stay||60,'min="5" max="720" step="5"')}
 ${input('hours','営業時間（例 09:00-12:00,13:00-17:00）','text',r.hours||'','placeholder="未確認"')}${input('lastAdmission','最終入場','time')}
 <label>休館する曜日（複数選択可）<span class="planner-week">${['日','月','火','水','木','金','土'].map((w,i)=>`<label><input type="checkbox" data-pl-rule="${key}" data-week="${i}" ${(r.closedDays||[]).includes(i)?'checked':''}>${w}</label>`).join('')}</span></label>
 ${input('closedDates','臨時休館日（YYYY-MM-DD、カンマ区切り）')}
 <label>優先度<select data-pl-rule="${key}" data-field="priority">${[[1,'低め'],[2,'通常'],[3,'必ず行きたい']].map(([v,l])=>`<option value="${v}" ${(r.priority||2)===v?'selected':''}>${l}</option>`).join('')}</select></label>
 ${input('source','確認元のURL・メモ')}
 </div><p class="note">営業時間は現地の日付で扱います。昼休みは区切って入力してください。空欄は未確認として扱い、営業中とは判定しません。予約済みの日時変更はこの欄で行います。</p></details>`;
}
function plannerRulesHTML(stops,di){return `<details class="planner-panel"><summary>営業時間・休館日・予約時刻を設定</summary><p class="note">公式サイトや予約確認メールの時刻を入力してください。予約を固定すると日と開始時刻を守って計算します。</p>${stops.map(s=>plannerRuleForm(s,di)).join('')}</details>`;}
const plannerOldWish=stepWish;
stepWish=function(){return plannerOldWish()+plannerRulesHTML(plannerBaseStops());};
function plannerHotelForm(){
 if(!nNights())return '';const i=bookingNightIndex(),r=plannerStay(i);
 const inp=(k,l,type)=>`<label>${l}<input data-pl-stay="${i}" data-field="${k}" type="${type}" value="${esc(r[k])}" ${type==='number'?'min="0" max="180" step="5"':''}></label>`;
 return `<details class="planner-panel"><summary>${S.hotelSplit?`${i+1}泊目`:'各泊共通'}のチェックイン・荷物の時間</summary><div class="planner-fields">${inp('checkin','チェックイン受付開始','time')}${inp('checkinEnd','受付終了','time')}${inp('checkout','チェックアウト期限','time')}${inp('inMinutes','チェックイン所要時間（分）','number')}${inp('outMinutes','チェックアウト所要時間（分）','number')}${inp('bagMinutes','荷物の預け・受取（各・分）','number')}<label>荷物の扱い<select data-pl-stay="${i}" data-field="luggage">${[['carry','持ち歩く'],['next','次の宿に先に預ける'],['previous','前の宿に預けて観光後に受け取る']].map(([v,l])=>`<option value="${v}" ${r.luggage===v?'selected':''}>${l}</option>`).join('')}</select></label></div><p class="note">初期値は所要時間の目安です。受付時刻と荷物預かりの可否は宿に確認してください。連泊中はチェックアウト・チェックインを繰り返しません。</p></details>`;
}
const plannerOldHotel=stepHotel;
stepHotel=function(){return plannerOldHotel()+plannerHotelForm();};
const plannerOldResult=stepResult;
stepResult=function(){return `<div class="planner-order"><label>観光地を回る順序<select id="plannerOrder"><option value="auto" ${!S.visitOrder||S.visitOrder==='auto'?'selected':''}>移動を少なくする</option><option value="far" ${S.visitOrder==='far'?'selected':''}>出発地から遠いところから</option><option value="near" ${S.visitOrder==='near'?'selected':''}>出発地から近いところから</option></select></label><p class="note">各日の出発地からの距離で並べます。営業時間と固定予約を優先するため、順序が変わる場合があります。</p></div>`+plannerOldResult();};
function plannerSimulate(mutate){const state={stopRules:S.stopRules,dayOf:S.dayOf,manualOrd:S.manualOrd};S.stopRules=JSON.parse(JSON.stringify(S.stopRules||{}));S.dayOf={...S.dayOf};S.manualOrd={...S.manualOrd};try{mutate();return buildPlan();}finally{Object.assign(S,state);bookingRouteMemo=null;}}
const plannerSuggestions=new Map(),plannerProposalMemo=new Map();
function plannerProblems(d){
 const unknown=d.ord.filter(s=>!plannerRule(s.id).hours).length;
 let h=`<div class="planner-status">${unknown?`<p class="note">営業時間未確認：${unknown}か所。営業時間・休館日の設定欄で確認できます。</p>`:''}`;
 if(d.issues?.length){h+=`<div class="banner warn"><div><b>予定の調整が必要です</b><ul>${d.issues.map(x=>`<li>${esc(x.message)}</li>`).join('')}</ul></div></div>`;
 const score=p=>p.days.reduce((v,x)=>v+(x.overMinutes||0)+(x.issues||[]).filter(i=>i.code!=='overrun').reduce((v,i)=>v+Math.max(60,i.short||0),0),0);
 const base=score(window.__plan),candidates=d.ord.filter(s=>!plannerRule(s.id).fixed&&!s.meal).sort((a,b)=>(plannerRule(a.id).priority||2)-(plannerRule(b.id).priority||2)).slice(0,3);
 const memoKey=(typeof bookingRouteSignature==='function'?bookingRouteSignature():'')+'|'+JSON.stringify([S.mealOmissions,S.dayOf,S.manualOrd,d.di]);
 let proposals=plannerProposalMemo.get(memoKey);
 if(!proposals){proposals=[];
 for(const s of candidates){const r=plannerRule(s.id),dur=r.duration||Math.round(s.stay*paceK()/5)*5;
 if(dur>30){const duration=Math.max(30,dur-30),p=plannerSimulate(()=>{S.stopRules[s.id]={...r,duration};});if(score(p)<base)proposals.push({label:`${s.name}の滞在を${duration}分にする`,id:s.id,duration,improvement:base-score(p),over:p.days[d.di].overMinutes});}
 for(let i=0;i<S.days;i++){if(i===d.di||dayTime(i).off)continue;const p=plannerSimulate(()=>{S.dayOf[s.id]=i;delete S.manualOrd[i];delete S.manualOrd[d.di];});if(score(p)<base&&p.days[i].ord.some(x=>x.id===s.id)&&!p.days[i].issues.length){proposals.push({label:`${s.name}を${i+1}日目へ移す`,id:s.id,day:i,from:d.di,over:p.days[d.di].overMinutes});break;}}
 }
 if(plannerProposalMemo.size>40)plannerProposalMemo.clear();plannerProposalMemo.set(memoKey,proposals);}
 h+='<div class="planner-proposals">'+proposals.slice(0,4).map((p,i)=>{const k=d.di+'-'+i;plannerSuggestions.set(k,{...p,project:APP.pid});return `<button type="button" class="btn small" data-pl-apply="${k}">${esc(p.label)}（この日の超過 ${p.over||0}分）</button>`;}).join('')+'</div>';
 const late=d.issues.find(x=>x.code==='reservation-late');if(late)h+=`<p class="note">予約前に削る候補：${candidates.map(s=>esc(s.name)).join('、')||'変更可能な観光地がありません'}。予約に不足する時間は${late.short}分です。営業時間・予約の設定から滞在時間を調整できます。</p>`;
 if(!proposals.length)h+='<p class="note">自動で提案できる改善案がありません。終了時刻や観光地の数を見直してください。予約は動かしていません。</p>';
 }
 return h+'</div>';
}
const plannerOldDay=dayHTML;
dayHTML=function(d,H){let h=plannerOldDay(d,H);return h.replace('<ol class="tl">',plannerProblems(d)+'<ol class="tl">').replace(/<\/article>$/,plannerRulesHTML([...new Map([...d.ord,...d.items.filter(x=>x.type==='excluded').map(x=>x.s),...plannerBaseStops().filter(s=>d.issues.some(x=>x.id===s.id))].map(s=>[s.id,s])).values()],d.di)+`<div class="planner-omissions">${MEALS.filter(m=>S.mealOmissions?.[d.di+'|'+m]).map(m=>`<button class="linkbtn" data-pl-restore="${d.di}|${m}">${MEALNAME[m]}の未定枠を戻す</button>`).join('')}</div></article>`);};
function plannerCommit(){bookingRouteMemo=null;save();render();}
document.addEventListener('change',e=>{
 const t=e.target;
 if(t.id==='plannerOrder'){S.visitOrder=t.value;S.manualOrd={};plannerCommit();}
 if(t.dataset.plRule!==undefined){const id=t.dataset.plRule,r={...plannerRule(id)},k=t.dataset.field;
 if(t.dataset.week!==undefined){r.closedDays=[...(r.closedDays||[]).filter(n=>n!==+t.dataset.week),...(t.checked?[+t.dataset.week]:[])];}
 else if(k==='hours'){if(t.value&&!/^\d{2}:\d{2}-\d{2}:\d{2}(\s*[,、]\s*\d{2}:\d{2}-\d{2}:\d{2})*$/.test(t.value)||t.value&&TravelPlanner.windows({hours:t.value},'2026-10-02').length!==t.value.split(/[,、]/).length){toast('営業時間は 09:00-17:00 の形で入力してください');t.value=r.hours||'';return;}r[k]=t.value;}
 else if(k==='closedDates'){if(t.value.split(/[\s,、]+/).some(x=>x&&!/^\d{4}-\d{2}-\d{2}$/.test(x))){toast('休館日は YYYY-MM-DD で入力してください');return;}r[k]=t.value;}
 else r[k]=t.type==='checkbox'?t.checked:['day','duration','priority'].includes(k)?+t.value:t.value;
 if(r.fixed){r.time=r.time||'13:00';r.day=r.day??(window.__plan?.days.find(d=>d.ord.some(s=>s.id===id))?.di||0);if(k==='day'||!r.date)r.date=bookingISO(dayDate(r.day));if(k==='date')r.day=plannerReservationDay(r);}
 S.stopRules={...S.stopRules,[id]:r};bookingRouteMemo=null;save();if(S.step===7||k==='fixed')render();
 }
 if(t.dataset.plStay!==undefined){const k=t.dataset.field,v=t.type==='number'?Math.max(0,Math.min(180,+t.value||0)):t.value,indices=S.hotelSplit?[+t.dataset.plStay]:Array.from({length:nNights()},(_,i)=>i);S.stayRules={...S.stayRules};for(const i of indices)S.stayRules[i]={...S.stayRules[i],[k]:v};bookingRouteMemo=null;save();}
});
document.addEventListener('click',e=>{
 const t=e.target.closest('[data-pl-apply],[data-pl-omit],[data-pl-restore]');if(!t)return;
 if(t.dataset.plApply){const p=plannerSuggestions.get(t.dataset.plApply);if(!p||p.project!==APP.pid||plannerRule(p.id).fixed)return;const r=plannerRule(p.id);if(p.duration)S.stopRules={...S.stopRules,[p.id]:{...r,duration:p.duration}};else{S.dayOf={...S.dayOf,[p.id]:p.day};S.manualOrd={...S.manualOrd};delete S.manualOrd[p.day];delete S.manualOrd[p.from];}plannerCommit();}
 if(t.dataset.plOmit){S.mealOmissions={...S.mealOmissions,[t.dataset.plOmit]:true};plannerCommit();}
 if(t.dataset.plRestore){S.mealOmissions={...S.mealOmissions};delete S.mealOmissions[t.dataset.plRestore];plannerCommit();}
});
// Explicit reservation editor is the only way to move a protected booking.
document.addEventListener('click',e=>{const t=e.target.closest('[data-move],[data-ordsel]');if(!t)return;let id=t.dataset.ordsel;if(t.dataset.move){const [di,si]=t.dataset.move.split('|');id=window.__plan?.days[+di]?.items.filter(x=>x.type==='stop')[+si]?.s.id;}if(id&&plannerRule(id).fixed){e.preventDefault();e.stopImmediatePropagation();toast('予約は固定されています。営業時間・予約の設定から日時を変更してください。');}},true);
const plannerPhotoAttempts=new Set();
const plannerOldPhoto=bookingPhoto;
bookingPhoto=function(o,size){
 const food=o.food||o.meal||bookingID(o).startsWith('hotpepper:');
 let html=bookingSafeURL(o.ownPhoto)?`<figure class="booking-photo booking-photo-${esc(size)}"><img src="${esc(bookingSafeURL(o.ownPhoto))}" alt="${esc(o.name)}の登録写真" loading="lazy" onerror="this.hidden=true;this.parentNode.querySelector('figcaption').textContent='写真を読み込めませんでした'"><figcaption>利用者が登録した写真</figcaption></figure>`:plannerOldPhoto(o,size);
 if(food&&o.id)html+=`<div class="planner-photo-tools"><button class="linkbtn" data-pl-photo="${esc(o.id)}">写真を再取得</button><details><summary>写真URLを登録</summary><label>このお店の写真URL<input type="url" data-pl-photo-url="${esc(o.id)}" value="${esc(o.ownPhoto||'')}" placeholder="https://…"></label></details></div>`;
 return food&&o.id?`<div class="planner-photo-block">${html}</div>`:html;
};
async function plannerRefreshPhoto(id,manual=false){
 const state=S,w=S.wishes.find(x=>x.id===id);if(!w||!bookingPoint(w))return;
 const k=APP.pid+'|'+id;if(!manual&&plannerPhotoAttempts.has(k))return;plannerPhotoAttempts.add(k);
 try{
  const hp=w.hpId||bookingID(w).replace(/^hotpepper:/,'');
  const j=await BookingAPI.get('/restaurants',{lat:w.lat.toFixed(5),lng:w.lng.toFixed(5),...(/^J\d{9}$/.test(hp)?{id:hp}:{q:w.name})});
  if(S!==state||!S.wishes.includes(w))return;
  const matches=j.items.filter(x=>/^J\d{9}$/.test(hp)?x.id===hp:norm(x.name)===norm(w.name)&&hav(x,w)<0.3);
  if(matches.length!==1||!matches[0].photo){if(manual)toast('同じお店の写真を確認できませんでした。STEP6で店舗を選び直すか、写真URLを登録してください。');return;}
  const f=bookingToFood(matches[0],j,w);Object.assign(w,{hpId:f.hpId,providerId:f.providerId,hpURL:f.hpURL,apiPhoto:f.apiPhoto,apiExpiresAt:f.apiExpiresAt});save();if(APP.ptab==='result'||S.step===7)render();
 }catch(e){if(manual&&S===state)toast(bookingMessage(e));}
}
const plannerOldAfter=afterResult;
afterResult=function(){plannerOldAfter();const list=S.wishes.filter(w=>w.food&&!w.ownPhoto&&(!w.apiPhoto||w.apiExpiresAt<=Date.now())).slice(0,6);(async()=>{for(const w of list)await plannerRefreshPhoto(w.id);})();};
document.addEventListener('click',e=>{const t=e.target.closest('[data-pl-photo]');if(t)plannerRefreshPhoto(t.dataset.plPhoto,true);});
document.addEventListener('change',e=>{const t=e.target;if(t.dataset.plPhotoUrl!==undefined){const w=S.wishes.find(w=>w.id===t.dataset.plPhotoUrl);if(!w)return;if(t.value&&!bookingSafeURL(t.value)){toast('https:// から始まる写真URLを入力してください');return;}w.ownPhoto=bookingSafeURL(t.value);plannerCommit();}});
// Keep editors open while showing the newly calculated timeline.
const plannerOldRender=render;
render=function(){const opens=[...document.querySelectorAll('.planner-panel[open],.planner-rule[open]')].map(e=>e.querySelector('summary')?.textContent?.split(' · ')[0]);plannerOldRender();for(const e of document.querySelectorAll('.planner-panel,.planner-rule'))if(opens.includes(e.querySelector('summary')?.textContent?.split(' · ')[0]))e.open=true;};
const plannerRouteCache=new Map();
let plannerRouteRunning=false;
function plannerMode(di){return S.dayMode?.[di]||(S.transport==='auto'?bookingRoutePlan().days[di]?.mode:S.transport)||'transit';}
async function plannerRealLeg(a,b,di,time,type,budget){
 if(!a||!b)return null;
 const mode=plannerMode(di)==='walk'||hav(a,b)*1.3<=1.3?'walk':plannerMode(di)==='car'?'car':'transit';
 if(hav(a,b)<0.01)return {min:0,km:0,mode};
 const date=bookingISO(dayDate(di)),key=[mode,a.lat,a.lng,b.lat,b.lng,mode==='transit'?date+'|'+time+'|'+type:''].join('|');
 const cached=plannerRouteCache.get(key);if(cached&&cached.expires>Date.now())return cached.value;
 if(budget.left<=0)return null;
 if(mode==='transit'&&!transitOn())return null;
 budget.left--;
 let value=null;
 try{
  if(mode==='transit'){
   const j=await tGet('/course',{from:a.name+' '+S.pref,to:b.name+' '+S.pref,date:date.replace(/-/g,''),time:time.replace(':',''),type,plane:'0'}),legs=j?.mode==='times'?j.courses?.[0]?.legs:null;
   if(legs?.length){const dep=TravelPlanner.minutes(legs[0].dep),arr=TravelPlanner.minutes(legs.at(-1).arr);if(dep!==null&&arr!==null){let finish=arr;if(finish<dep)finish+=1440;const requested=t2m(time);value={min:type==='departure'?finish-requested:requested-dep,km:null,mode};if(value.min<0||value.min>1440)value=null;}}
  }else{
   const base=mode==='car'?'https://router.project-osrm.org/route/v1/driving/':'https://routing.openstreetmap.de/routed-foot/route/v1/driving/';
   const response=await fetch(base+`${a.lng},${a.lat};${b.lng},${b.lat}?overview=false`,{signal:AbortSignal.timeout(8000)});const j=await response.json(),r=j.code==='Ok'&&j.routes?.[0];
   if(response.ok&&r&&Number.isFinite(r.duration)&&Number.isFinite(r.distance)){value={min:Math.ceil(r.duration/60)+(mode==='car'?5:0),km:r.distance/1000,mode};legCache[legKey(a,b,mode)]={min:value.min,km:value.km};}
  }
 }catch{}
 if(plannerRouteCache.size>150)plannerRouteCache.clear();plannerRouteCache.set(key,{value,expires:Date.now()+(value?3600000:60000)});return value;
}
async function plannerCompare(kind){
 if(plannerRouteRunning)return;const state=S,pid=APP.pid,r=ROUTE_UI[kind];if(!r?.items.length)return;
 plannerRouteRunning=true;const context=kind==='hotel'?bookingStayContext():bookingMealContext(),savedKey=r.key,budget={left:12},shortlist=r.items.slice(0,3);
 if(kind==='hotel'&&S.hotelSplit&&context.ni>0){const previous=hotelPoint(stopsAll(),context.ni-1);if(!previous.area&&!shortlist.some(h=>plannerSame(h,previous))){const stored=nightsArr()[context.ni-1]?.info;if(stored)shortlist.splice(2,1,{...stored,hotel:true,routeDistance:0});}}
 r.routeBusy=true;render();
 try{
  for(const item of shortlist){let total=0,complete=true;const routes=[];
   const pairs=kind==='hotel'?context.pairs:[{before:context.before,after:context.after,night:context.di}];
   for(const p of pairs){const di=p.night,plan=bookingRoutePlan(),last=plan.days[di]?.items.filter(x=>x.type==='stop'&&!x.meal).at(-1),departure=kind==='hotel'?m2t(last?last.t+last.dur:17*60):m2t(context.time??MEALWIN[context.slot].target),nextDay=kind==='hotel'?Math.min(S.days-1,di+1):di;
    const legs=[[p.before,item,di,departure,'departure'],[item,p.after,nextDay,kind==='hotel'?dayTime(nextDay).start:m2t(t2m(departure)+(context.slot==='朝'?30:60)),kind==='hotel'?'arrival':'departure']];
    for(const [a,b,d,time,type]of legs){if(!a||!b)continue;const leg=await plannerRealLeg(a,b,d,time,type,budget);if(S!==state||APP.pid!==pid||ROUTE_UI[kind]!==r)return;if(!leg)complete=false;else{total+=leg.min;routes.push(leg);}}
   }
   const previous=kind==='hotel'&&context.ni>0?hotelPoint(stopsAll(),context.ni-1):null;
   const handling=kind==='hotel'&&previous&&!previous.area&&!plannerSame(previous,item)?+plannerStay(context.ni).inMinutes+ +plannerStay(context.ni-1).outMinutes+ +plannerStay(context.ni).burden:0;
   item.routeCheck={complete,minutes:total,handling,routes,reason:!complete?(transitOn()?'取得できない区間があります':'電車の実時刻は未接続のため、該当区間は未確認'):''};
  }
  if(S!==state||APP.pid!==pid||ROUTE_UI[kind]!==r||r.key!==savedKey)return;
  if(shortlist.every(x=>x.routeCheck?.complete))shortlist.sort((a,b)=>(typeof budgetRank==='function'?budgetRank(a)-budgetRank(b):0)||a.routeCheck.minutes+a.routeCheck.handling-b.routeCheck.minutes-b.routeCheck.handling);
  r.items=[...shortlist,...r.items.filter(x=>!shortlist.includes(x)&&!shortlist.some(h=>bookingID(h)===bookingID(x)))];
  if(kind==='hotel'){S.hotelCands=r.items;S.hotelPick=-1;}
  r.routeCompared=true;bookingRouteMemo=null;r.key=kind==='hotel'?bookingStayKey():bookingMealKey();
 }finally{plannerRouteRunning=false;r.routeBusy=false;if(S===state&&APP.pid===pid&&ROUTE_UI[kind]===r){save();render();}}
}
function plannerRouteMeta(o){const r=o.routeCheck;if(!r)return '';return `<p class="planner-route-meta">${r.complete?`実経路の移動 合計${Math.ceil(r.minutes)}分${r.handling?` ＋ ホテル変更の手間${r.handling}分`:''}（${[...new Set(r.routes.map(x=>({car:'車',walk:'徒歩',transit:'電車・バス'}[x.mode])))].join('・')}）`:`実経路を確認できない区間があるため、順位を確定していません。${esc(r.reason)}`}</p>`;}
const plannerOldFoodCard=bookingFoodResultCard;
bookingFoodResultCard=function(f,i,c){return plannerOldFoodCard(f,i,c).replace('<div class="booking-actions">',plannerRouteMeta(f)+'<div class="booking-actions">');};
const plannerOldHotelCard=bookingHotelCard;
bookingHotelCard=function(h,i){return plannerOldHotelCard(h,i).replace('<div class="booking-actions">',plannerRouteMeta(h)+'<div class="booking-actions">');};
function plannerCompareHTML(kind){const r=ROUTE_UI[kind];if(!r?.items.length)return '';return `<div class="planner-route-compare"><button class="btn" type="button" data-pl-compare="${kind}" ${plannerRouteRunning?'disabled':''}>${r.routeBusy?'実経路を確認中…':'上位3件を実経路・移動時間で比較'}</button><p class="note">STEP3と各日の移動手段を使います。最大12区間まで確認します。道路経路は渋滞を含まない目安です。電車は経路サービス接続時に時刻を比較します。全区間を取得できた候補だけで順位を確定します。</p></div>`;}
const plannerFoodUI=stepFood;stepFood=function(){return plannerFoodUI()+plannerCompareHTML('food');};
const plannerHotelUI=stepHotel;stepHotel=function(){return plannerHotelUI()+plannerCompareHTML('hotel');};
document.addEventListener('click',e=>{const t=e.target.closest('[data-pl-compare]');if(t)plannerCompare(t.dataset.plCompare);});
// （以前の「ホテルを毎晩変えると…合計◯分」の説明は、泊まり方の選択欄にまとめた）
// Failed route services must never cause an endless render/retry loop.
osrmRoutes=async function(){
 const plan=window.__plan,state=S;if(!plan||busy.osrm)return;const todo=[];
 for(const d of plan.days)for(const it of d.items)if(it.type==='leg'&&it.mode==='car'&&!it.real)todo.push({it,di:d.di});
 if(!todo.length)return;busy.osrm=true;let changed=false;const budget={left:12};
 try{for(const {it,di}of todo.slice(0,12)){const result=await plannerRealLeg(it.from,it.to,di,m2t(it.t),'departure',budget);if(S!==state)return;if(result)changed=true;}}finally{busy.osrm=false;if(changed&&S===state&&S.step===7){bookingRouteMemo=null;render();}}
};
// Search first narrows candidates geographically, then compares only that shortlist.
const plannerSearchFood=bookingRouteFoodSearch;
bookingRouteFoodSearch=async function(query=''){await plannerSearchFood(query);if(!query&&S.step===5)await plannerCompare('food');};
const plannerSearchHotel=bookingRouteHotelSearch;
bookingRouteHotelSearch=async function(query=''){await plannerSearchHotel(query);if(!query&&S.step===6)await plannerCompare('hotel');};

// 行き・帰りの移動中の食事（例：到着が夕方の日の昼食を、出発空港で）。
const PLANNER_MEAL_WINDOW={'昼':[11*60,14*60+30,45],'夜':[17*60+30,20*60+30,60]};
function plannerTravelMeal(list,meal,di){
 const [w0,w1,dur]=PLANNER_MEAL_WINDOW[meal];let best=null;
 list.forEach((it,i)=>{
  let a,b,place,how,pref=0;
  if(it.type==='trip'&&it.seg?.flight){a=it.t;b=it.t+(it.seg.chk||(typeof FLY_CHK!=='undefined'?FLY_CHK:60));place=String(it.seg.from||'空港');how='空港で（搭乗前に）';pref=30;}
  else if(it.type==='xfer'&&it.min>=25){a=it.t;b=it.t+it.min;place=it.place||'乗り換え駅';how='乗り換えの合間に';pref=10;}
  else if(it.type==='trip'&&it.seg&&!it.seg.flight&&it.seg.min>=60&&!/car|drive/.test(it.seg.kind||'')){a=it.t;b=it.t+it.seg.min;place=it.seg.line||'車内';how='車内で（駅弁など）';pref=-1;}
  else return;
  const s0=Math.max(a,w0),ov=Math.min(b,w1)-s0;if(ov<20)return;
  const score=ov+Math.max(0,pref);if(!best||score>best.score)best={score,i:pref<0?i+1:i,t:s0,dur:Math.min(dur,Math.max(20,ov)),place,how};  // 車内で食べるときは、乗ったあとに並べる
 });
 if(!best)return false;
 list.splice(best.i,0,{type:'tripmeal',t:best.t,meal,dur:best.dur,place:best.place,how:best.how,di});return true;
}
function plannerTravelMeals(out,r){
 for(const meal of r?.travelMeals||[]){
  if(S.mealOmissions?.[out.di+'|'+meal])continue;
  const lists=[out.tripOut,out.tripBack].filter(Array.isArray);
  for(const list of lists)if(plannerTravelMeal(list,meal,out.di))break;
 }
}
const plannerOldTripItem=tripItemHTML;
tripItemHTML=function(it,trip,di){
 if(it.type!=='tripmeal')return plannerOldTripItem(it,trip,di);
 return `<li class="trip planner-event"><div class="t">${m2t(it.t)}</div><div class="stop" style="--c:var(--hot)"><div class="nm"><span class="pill meal">${esc(MEALNAME[it.meal])}</span>${esc(it.place)}で${esc(MEALNAME[it.meal])}</div><div class="sm">${esc(it.how)}・約${it.dur}分。移動の合間にとる想定です。</div><button class="linkbtn" data-pl-omit="${it.di}|${it.meal}">この食事は不要</button></div></li>`;
};
