/* 公共交通オープンデータ（ODPT）：飛行機の便と、電車の時刻。
   アクセストークンは Cloudflare Worker の環境変数 ODPT_TOKEN に置き、ブラウザには出さない。
   - STEP3：出発・到着の空港を選ぶと、その日に飛ぶ JAL・ANA の便が並ぶ。タップで決まる（画面は booking/ride.js）。
   - 予定表：同じ路線で行ける区間は、時刻表の列車（◯時◯分発→◯時◯分着）に合わせる。
   データが無い・取れないときは、今までどおり目安の時刻と手入力で使える。 */
'use strict';
const ODPT={status:null,statusAt:0,statusBusy:false,flights:new Map(),rail:new Map(),noDirect:new Set(),tries:new Map(),busy:0,queue:[],last:null};
function odptBase(){try{const u=new URL(window.TABIROUTE_BOOKING?.apiBase||'');return u.protocol==='https:'||u.hostname==='127.0.0.1'?u.href.replace(/\/$/,''):'';}catch{return '';}}
async function odptFetch(path,params,timeout=25000){
 const base=odptBase();if(!base)throw Object.assign(Error('no base'),{code:'not_configured'});
 const u=new URL(base+path);for(const [k,v]of Object.entries(params||{}))if(v!==undefined&&v!==null&&v!=='')u.searchParams.set(k,v);
 let r;try{r=await fetch(u,{credentials:'omit',signal:AbortSignal.timeout(timeout)});}catch{throw Object.assign(Error('network'),{code:'network'});}
 let j;try{j=await r.json();}catch{throw Object.assign(Error('bad'),{code:r.status===404?'unsupported':'network'});}
 if(r.status===404&&!String(j?.version||'').startsWith('odpt'))throw Object.assign(Error('unsupported'),{code:'unsupported'});
 if(!r.ok||!j.ok)throw Object.assign(Error(j.code||'error'),{code:j.code||'error',retryAfter:j.retryAfter});
 return j;
}
// Worker の対応状況（トークンの有無）を1回だけ確かめる
function odptStatus(){
 if(!odptBase())return {ok:false,code:'not_configured',token:false,flights:false,rail:[]};
 if(ODPT.status&&Date.now()-ODPT.statusAt<600000)return ODPT.status;
 if(!ODPT.statusBusy&&odptBase()){ODPT.statusBusy=true;odptFetch('/odpt/status',{},10000).then(j=>{ODPT.status=j;}).catch(e=>{ODPT.status={ok:false,code:e.code,token:false,flights:false,rail:[]};}).finally(()=>{ODPT.statusAt=Date.now();ODPT.statusBusy=false;if(S?.step===2||S?.step===7)render();});}
 return ODPT.status;
}
const odptTime=ms=>{if(!ms)return '';const d=new Date(ms);return `${d.getMonth()+1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2,'0')}`;};
function odptCredit(at,extra){return `<p class="odpt-credit">時刻：公共交通オープンデータセンター${extra?'・'+esc(extra):''}（${esc(odptTime(at))}取得）。正確さは保証されません。</p>`;}

/* ---------- STEP3：飛行機の便を選ぶ ---------- */
function odptAirports(){const m=iata();return Object.keys(m).map(code=>({code,name:m[code]})).sort((a,b)=>a.name.localeCompare(b.name,'ja'));}
function odptAirSel(which){
 const pick=airPick(which)||(airOpts(which)[0]?.name)||'',near=airOpts(which).map(x=>x.name),all=odptAirports();
 const opt=x=>`<option value="${esc(x.name)}" ${x.name===pick?'selected':''}>${esc(x.name.replace(/空港$/,''))}（${esc(x.code)}）</option>`;
 return `<select data-odpt-air="${which}" aria-label="${which==='dep'?'出発の空港':'到着の空港'}"><option value="">選ぶ</option>${near.length?`<optgroup label="近い空港">${all.filter(x=>near.includes(x.name)).map(opt).join('')}</optgroup>`:''}<optgroup label="すべて">${all.filter(x=>!near.includes(x.name)).map(opt).join('')}</optgroup></select>`;
}
function odptPortCode(which){const n=airPick(which)||(airOpts(which)[0]?.name)||'';return TN[n]?.[2]||'';}
function odptLoadFlights(from,to,date){
 const k=from+'|'+to+'|'+date,old=ODPT.flights.get(k);if(old&&!(old.error&&Date.now()-old.errorAt>Math.max(60,old.retryAfter||60)*1000))return old;
 const st={busy:true};ODPT.flights.set(k,st);
 odptFetch('/odpt/flights',{from,to,date}).then(j=>Object.assign(st,{busy:false,items:j.items||[],at:j.fetchedAt,partial:j.partial})).catch(e=>Object.assign(st,{busy:false,error:e.code||'error',errorAt:Date.now(),retryAfter:e.retryAfter})).finally(()=>{if(S?.step===2)render();});
 return st;
}
// STEP3 の画面（便のボタン・登録）は booking/ride.js でつくる
document.addEventListener('change',e=>{
 const t=e.target;if(!t.dataset?.odptAir)return;
 const which=t.dataset.odptAir,before=odptPortCode(which);setAir(which,t.value||'');
 // 空港を変えたら、リストから選んだ便は選び直してもらう
 if(odptPortCode(which)!==before&&S.flight){for(const dir of ['out','ret'])if(S.flight[dir]?.src==='odpt')delete S.flight[dir];save();}
 render();
});
document.addEventListener('click',e=>{
 const b=e.target.closest('[data-odpt-fl]');if(!b)return;
 const [dir,i,f0,t0]=b.dataset.odptFl.split('|'),from=f0||(dir==='out'?odptPortCode('dep'):odptPortCode('arr')),to=t0||(dir==='out'?odptPortCode('arr'):odptPortCode('dep'));
 const date=isoOf(dayDate(dir==='out'?0:Math.max(0,(S.days||1)-1))),st=ODPT.flights.get(from+'|'+to+'|'+date),x=st?.items?.[+i];if(!x)return;
 S.flight={...(S.flight||{})};const cur=S.flight[dir];
 if(cur&&cur.src==='odpt'&&cur.dep===x.dep&&flNo(cur.no)===flNo(x.no)){delete S.flight[dir];msg.flp='';}
 else{S.flight[dir]={no:x.no,dep:x.dep,arr:x.arr,kind:'air',src:'odpt',at:st.at};rideRemember(S.flight[dir]);const m=iata();if(!airPick('dep'))setAir('dep',m[dir==='out'?from:to]);if(!airPick('arr')&&(dir==='out'||!multiPref()))setAir('arr',m[dir==='out'?to:from]);msg.flp='';}
 save();render();
});

/* ---------- 予定表：同じ路線で行ける区間は、時刻表の列車に合わせる ---------- */
const odptDay=di=>isoOf(dayDate(di));
const odptPt=p=>p&&Number.isFinite(+p.lat)&&Number.isFinite(+p.lng)?{lat:(+p.lat).toFixed(5),lng:(+p.lng).toFixed(5)}:null;
// 時刻表を取れる鉄道（都営・東京メトロ・りんかい線・TX・多摩モノレール・横浜市営地下鉄）がある範囲だけ問い合わせる
const odptArea=p=>p&&+p.lat>35.25&&+p.lat<36.15&&+p.lng>139.25&&+p.lng<140.15;
function odptLegKey(a,b,date){return [a.lat,a.lng,b.lat,b.lng,date].join('|');}
// 観光の区間（電車・バス）
function odptLegJobs(plan){
 const jobs=[];
 for(const d of plan?.days||[])for(const it of d.items||[]){
  if(it.type!=='leg'||it.mode!=='transit'||!(it.t>=0&&it.t<1440)||!odptArea(it.from)||!odptArea(it.to))continue;const a=odptPt(it.from),b=odptPt(it.to);if(!a||!b)continue;
  const date=odptDay(d.di),nk=odptLegKey(a,b,date);if(ODPT.noDirect.has(nk))continue;
  const c=legCache[legKey(it.from,it.to,'transit')+'@'+date];
  if(c?.odpt&&it.t<=c.odpt.reqT&&c.odpt.reqT-it.t<=10)continue; // 出発がほぼ同じ（遅くならない）なら取り直さない
  const k=nk+'|'+it.t;if((ODPT.tries.get(k)||0)>=2)continue;
  jobs.push({kind:'leg',k,nk,it,a,b,date,time:m2t(it.t),type:'departure',aname:it.from.name,bname:it.to.name});
 }
 return jobs;
}
// 行き・帰りの電車（自宅と空港・駅のあいだ）
function odptRideOf(it,di){
 const sg=it?.seg;if(!sg||sg.flight||sg.fixed||sg.kind==='car'||sg.kind==='walk'||(!sg.from&&!sg.to))return null;
 // 自宅からの区間（from がない）・自宅までの区間（to がない）は、登録した出発地を使う
 const home=myStartPt(),A=sg.from?tnPt(sg.from):home&&{...home,name:home.label},B=sg.to?tnPt(sg.to):home&&{...home,name:home.label};if(!A||!B||!odptArea(A)||!odptArea(B))return null;
 const tm=it.back?it.t:it.t+(sg.min||0);if(!(tm>=0&&tm<1440))return null; // 前日・翌日にまたぐ時刻は問い合わせない
 return {A,B,date:odptDay(di),type:it.back?'departure':'arrival',time:m2t(tm)};
}
const odptRideTable=new Map(); // 区間・日付・出発地 → 見つかった列車
function odptRideKey(it){const h=myStartPt(),last=Math.max(0,(S.days||1)-1);return 'ride|'+rideKey(it)+'|'+odptDay(it.back?last:0)+'|'+(h?(+h.lat).toFixed(4)+','+(+h.lng).toFixed(4):'');}
function odptRideJobs(plan){
 const jobs=[],last=Math.max(0,(S.days||1)-1);
 for(const d of plan?.days||[])for(const [list,di]of [[d.tripOut,0],[d.tripBack,last]]){
  for(const it of list||[]){
   if(it.type!=='trip')continue;const r=odptRideOf(it,di);if(!r)continue;
   const a=odptPt(r.A),b=odptPt(r.B),k=odptRideKey(it);if(!a||!b||ODPT.noDirect.has(odptLegKey(a,b,r.date)))continue;
   const v=odptRideTable.get(k);if(v&&Math.abs(t2m(v.reqTime)-t2m(r.time))<=20)continue;if((ODPT.tries.get(k+'|'+r.time)||0)>=2)continue;
   jobs.push({kind:'ride',k,tk:k+'|'+r.time,a,b,date:r.date,time:r.time,type:r.type,aname:it.seg.from?stName(it.seg.from):'',bname:it.seg.to?stName(it.seg.to):'',rk:rideKey(it)});
  }
 }
 return jobs;
}
async function odptRun(){
 if(ODPT.busy){ODPT.again=true;return;}if(!ODPT.status?.ok)return;const plan=window.__plan;if(!plan)return;
 const jobs=[...odptRideJobs(plan),...odptLegJobs(plan)].slice(0,8);if(!jobs.length)return;
 ODPT.busy=1;const state=S;let changed=false;
 try{
  for(const j of jobs){
   const tk=j.tk||j.k;ODPT.tries.set(tk,(ODPT.tries.get(tk)||0)+1);
   let r;try{r=await odptFetch('/odpt/train',{alat:j.a.lat,alng:j.a.lng,blat:j.b.lat,blng:j.b.lng,aname:j.aname,bname:j.bname,date:j.date,time:j.time,type:j.type});}catch(e){if(/limited|not_configured|token|unsupported/.test(e.code||''))break;continue;}
   if(S!==state)return;
   if(r.status==='no_direct'){if(!r.partial)ODPT.noDirect.add(odptLegKey(j.a,j.b,j.date));continue;}
   if(r.status!=='found')continue;
   const want=t2m(j.time),dm=r.depMin%1440,am=r.arrMin%1440;if(j.type==='arrival'?am>want+1&&am-want<720:dm+1<want&&want-dm<720)continue; // 条件に合わない結果は使わない
   if(j.kind==='leg'){
    const t=j.it.t,arr=r.arrMin>=1440&&t<1200?r.arrMin-1440:r.arrMin,min=Math.max(1,arr-t+(r.to?.walk||0));
    if(min>j.it.min*3+30)continue; // 遠回りすぎる結果は使わない
    legCache[legKey(j.it.from,j.it.to,'transit')+'@'+j.date]={min,km:j.it.km,odpt:{...r,reqT:t}};changed=true;
   }else{odptRideTable.set(j.k,{dep:r.dep,arr:r.arr,reqTime:j.time,odpt:r});changed=true;}
  }
 }finally{ODPT.busy=0;}
 if(changed&&S===state){bookingRouteMemo=null;render();}
 else if(ODPT.again||jobs.length>=8){ODPT.again=false;setTimeout(odptRun,300);}
}
// 手で入れた時刻（S.rideT）がなければ、時刻表の列車を使う
const odptOldRealRide=realRide;
realRide=function(it){const own=odptOldRealRide(it);if(own)return own;const v=odptRideTable.get(odptRideKey(it));return v?{dep:v.dep,arr:v.arr,odpt:v.odpt}:null;};
const odptOldAfterResult=afterResult;
afterResult=function(){odptOldAfterResult();odptStatus();setTimeout(()=>odptRun(),50);};
function odptCreditText(o){return `<span class="odpt-src">公共交通オープンデータ${o.credit?'（'+esc(o.credit)+'）':''}・${esc(odptTime(o.fetchedAt))}取得</span>`;}
