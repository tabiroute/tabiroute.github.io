/* 乗る便・列車の時刻を決める。
   - ODPT で取れる便（JAL・ANA）はボタンで選ぶ（booking/odpt.js）。
   - 新幹線・ODPT にない路線は、無料の検索サイト（Yahoo!乗換案内・Googleマップ／便の時刻表・Googleフライト）で調べる。
   - 調べた便・列車は「手で入れる」か「画像から読む」（端末の中で文字を読み取り、確かめてから登録）。
   - 登録した発着時刻は固定し、駅・空港までの移動と乗り換えの余裕を含めて予定を組み直す（index.html の myTrip）。 */
'use strict';
const RIDE={reg:null};
const rideLast=()=>Math.max(0,(S.days||1)-1);
const rideClock=t=>m2t(((Math.round(t)%1440)+1440)%1440);
const rideHHMM=v=>{const m=String(v||'').match(/^(\d{1,2}):(\d{2})$/);return m&&+m[1]<=29&&+m[2]<=59?String(+m[1]%24).padStart(2,'0')+':'+m[2]:'';};

/* ---------- 行き・帰りの「飛行機・新幹線・特急」の区間 ---------- */
function rideMain(dir){
 let tr=null;try{tr=myTrip();}catch(e){}if(!tr)return null;
 let list=tr.out,di=0;
 if(dir==='ret'){di=rideLast();try{list=tripBackItems(tr,t2m((dayTime(di)||{}).end||'17:00'));}catch(e){return null;}}
 const it=list.find(x=>x.main);if(!it||!it.seg)return null;
 const sg=it.seg,air=!!sg.flight;let dep,arr;
 if(air){const chk=sg.chk||FLY_CHK;dep=it.t+chk;arr=dep+(sg.fly||Math.max(30,sg.min-chk-(sg.out||FLY_OUT)));}
 else if(sg.fixed){dep=it.t+(sg.chk||RAILCHK);arr=it.t+sg.min;}
 else{dep=it.t;arr=it.t+sg.min;}
 return {sg,air,di,dep,arr,from:air?String(sg.from):stName(sg.from),to:air?String(sg.to):stName(sg.to),line:sg.line||''};
}
// 調べるリンク（無料で使える検索サイト。出発・到着・日時を入れて開く）
function rideLinks(m,air,dir){
 const di=dir==='ret'?rideLast():0;
 if(air){
  if(!m)return [['Googleフライト','https://www.google.com/travel/flights?hl=ja']];
  return [['便の時刻表',gflURL(m.sg,di)],['Googleフライト',gflightsURL(m.sg,di)]];
 }
 if(!m)return [['Yahoo!乗換案内','https://transit.yahoo.co.jp/'],['Googleマップ','https://www.google.com/maps/dir/?api=1&travelmode=transit']];
 return [['Yahoo!乗換案内',yahooURL(m.from,m.to,di,m.dep)],['Googleマップ',gmapDir(m.from,m.to,'transit')]];
}
const rideLinksHTML=ls=>`<div class="ride-links"><span>調べる</span>${ls.map(([l,u])=>`<a href="${esc(u)}" target="_blank" rel="noopener">${esc(l)}</a>`).join('')}</div>`;

/* ---------- STEP3：遠くへの移動 ---------- */
const RIDE_ERR={odpt_not_configured:'便の一覧は準備中です。',unsupported:'便の一覧は準備中です。',odpt_token_invalid:'便の一覧を読み込めません（管理者の設定が必要です）。',odpt_limited:'混み合っています。少し待ってください。',client_limited:'混み合っています。少し待ってください。'};
const RIDE_MORE={};   // 便の一覧を全部見せているか（行き・帰り）
document.addEventListener('click',e=>{const b=e.target.closest('[data-odpt-more]');if(!b)return;const d=b.dataset.odptMore;RIDE_MORE[d]=!RIDE_MORE[d];render();});
function rideOdptChips(dir){
 const s=odptStatus();
 if(!s)return '<p class="note" role="status">便を読み込んでいます…</p>';
 if(s.flights===false)return '';
 // 行程で使う空港（複数の県をめぐるときは、帰りは最後の県の近くの空港になる）
 const m=rideMain(dir),code=n=>TN[n]?.[2]||'';
 const from=m&&m.air&&code(m.sg.from)||(dir==='out'?odptPortCode('dep'):odptPortCode('arr')),to=m&&m.air&&code(m.sg.to)||(dir==='out'?odptPortCode('arr'):odptPortCode('dep'));
 if(!from||!to)return '<p class="note">空港を選ぶと、便が出ます。</p>';
 const date=isoOf(dayDate(dir==='out'?0:rideLast())),st=odptLoadFlights(from,to,date),f=(S.flight||{})[dir];
 if(st.busy)return '<p class="note" role="status">便を探しています…</p>';
 if(st.error)return `<p class="note">${esc(RIDE_ERR[st.error]||'便を読み込めませんでした。')}</p>`;
 if(!st.items.length)return '<p class="note">JAL・ANAの直行便はありません。</p>';
 ODPT.last=st.at||ODPT.last;
 const sel=x=>f&&(x.nos.some(n=>flNo(n)===flNo(f.no))||(f.dep===x.dep&&f.arr===x.arr));
 let h='';
 if(f?.src==='odpt'&&!st.items.some(sel))h+='<p class="note warnline">選んだ便はこの日に飛びません。選び直してください。</p>';
 // 便が多いときは、目安の時刻に近い6便だけ出して「もっと見る」。選んだあとは、選んだ便だけにする
 const chip=(x,i)=>`<button type="button" class="odpt-fl" role="listitem" data-odpt-fl="${dir}|${i}|${from}|${to}" aria-pressed="${!!sel(x)}"><b>${esc(x.dep)}→${esc(x.arr)}${x.arrDay?'<small>+1日</small>':''}</b><small>${esc(x.nos.slice(0,2).join(' / '))}${x.via?.length?' 経由':''}</small></button>`;
 const all=st.items.map((x,i)=>({x,i})),pick=all.find(o=>sel(o.x)),open=!!RIDE_MORE[dir];
 if(pick&&!open)return h+`<div class="odpt-flights odpt-one" role="list">${chip(pick.x,pick.i)}</div><button type="button" class="linkbtn odpt-more" data-odpt-more="${dir}">ほかの便を見る（${all.length}便）</button>`;
 let show=all;
 if(!open&&all.length>6){const m=rideMain(dir),want=m?(dir==='out'?m.dep:m.dep):null,mm=v=>{const [a,b]=String(v).split(':').map(Number);return a*60+b;};
  const c=want==null?0:all.reduce((b,o,k)=>Math.abs(mm(o.x.dep)-want)<Math.abs(mm(all[b].x.dep)-want)?k:b,0),st0=Math.max(0,Math.min(all.length-6,c-2));show=all.slice(st0,st0+6);}
 return h+`<p class="ride-sub">JAL・ANA（タップで決まります）</p><div class="odpt-flights" role="list">${show.map(o=>chip(o.x,o.i)).join('')}</div>${all.length>6?`<button type="button" class="linkbtn odpt-more" data-odpt-more="${dir}">${open?'少なくする':`もっと見る（全${all.length}便）`}</button>`:''}`;
}
// 登録した便・列車のうち、いまの乗り物（飛行機／列車）に合うものだけを使う（rideKind は index.html）
function rideFor(dir,air){const f=(S.flight||{})[dir];if(!f)return null;const k=rideKind(f);return !k||k===(air?'air':'rail')?f:null;}
function rideCardHTML(dir,lm){
 const m0=rideMain(dir),air=lm==='auto'?!!(m0&&m0.air):lm==='air',m=m0&&m0.air===air?m0:null,f=rideFor(dir,air);
 const date=dayDate(dir==='out'?0:rideLast()),has=!!(f&&(f.dep||f.no)),noRoute=!m&&!!myStartPt();
 const route=m?`<span class="ride-route">${esc(m.from)} → ${esc(m.to)}</span>`:'';
 const state=has&&f.dep
  ?`${confPill(f.src==='odpt'?'odpt':'user')}<b>${esc((air?flNo(f.no):f.no)||'')} ${esc(f.dep)}→${esc(f.arr||'？')}</b>`
  :`${confPill('est')}${m?`<span class="ride-est">目安 ${rideClock(m.dep)}→${rideClock(m.arr)}</span>`:''}`;
 let h=`<div class="ride-card" data-dir="${dir}"><div class="ride-hd"><b>${dir==='out'?'行き':'帰り'}</b><span>${esc(fmtDay(date))}</span>${route}</div>`;
 if(noRoute&&!has)return h+`<p class="note">${air&&(S.air?.dep||S.air?.arr)?'この空港では行程をつくれません。出発地や行き先に近い空港を選んでください。':`この経路には${air?'飛行機':'新幹線・特急'}がありません。`}</p>${air&&lm==='air'?rideOdptChips(dir):''}</div>`;
 h+=`<div class="ride-state">${state}</div>`;
 if(has&&!f.dep)h+='<p class="note warnline">出発の時刻が入っていません。</p>';
 if(dir==='out'&&has){let w='';try{w=tripMemo()?.flWarn||'';}catch(e){}if(w)h+=`<p class="note warnline">${esc(w)}</p>`;}
 if(noRoute)h+=`<p class="note warnline">この経路には${air?'飛行機':'新幹線・特急'}がないため、この時刻は使っていません。</p>`;
 if(air&&lm==='air')h+=rideOdptChips(dir);
 h+=`<div class="ride-acts">${noRoute?'':`<button type="button" class="btn small ${has?'ghost':'primary'}" data-ride-reg="main|${dir}">${has?'変更':'手で入れる'}</button>${rideOcrBtn('main|'+dir)}`}${has?`<button type="button" class="linkbtn" data-rreg-clear="main|${dir}">消す</button>`:''}</div>`;
 if(!noRoute)h+=rideLinksHTML(rideLinks(m,air,dir));
 return h+'</div>';
}
function rideOcrBtn(target,big,off){return `<label class="btn small ${big?'primary':'ghost'} ride-ocr${off?' is-off':''}">${ICON.img||''}画像から読む<input type="file" accept="image/*" data-ride-ocr="${esc(target)}" aria-label="画像から読む"${off?' disabled':''}></label>`;}
flightHTML=function(){
 if(!usesFlight())return '';
 const lm=longMode();
 let h=`<h2 class="sub">遠くへの移動</h2><div class="chips">${[['air','飛行機'],['rail','新幹線・特急'],['auto','おまかせ']].map(([k,l])=>`<button type="button" class="chip" data-longmode="${k}" aria-pressed="${lm===k}">${k==='air'?ICON.plane:k==='rail'?ICON.shinkansen:ICON.spark}${l}</button>`).join('')}</div>`;
 if(lm==='auto')h+='<p class="note">早いほうを自動で選びます。</p>';
 else if(lm==='air')h+=`<div class="odpt-ports"><label><span>出発</span>${odptAirSel('dep')}</label><span class="odpt-arrow" aria-hidden="true">⇄</span><label><span>到着</span>${odptAirSel('arr')}</label></div>`;
 else h+='<p class="note">新幹線・特急の時刻は公開データがありません。調べて登録してください。</p>';
 if(!myStartPt())h+=`<p class="note">出発地を登録すると、区間と目安の時刻が出ます。</p>`;
 if(lm==='auto'&&!myStartPt())return h;
 h+=`<div class="ride-cards">${rideCardHTML('out',lm)}${rideCardHTML('ret',lm)}</div>`;
 h+=`<p class="odpt-credit">${lm==='air'?`空港には出発の${FLY_CHK}分前`:lm==='rail'?`駅には発車の${RAILCHK}分前`:`駅には発車の${RAILCHK}分前、空港には${FLY_CHK}分前`}に着く計算です。登録した時刻に合わせて予定を組み直します。</p>`;
 if(lm==='air'&&ODPT.last)h+=odptCredit(ODPT.last,'JAL・ANA');
 return h+(typeof transitPanelHTML==='function'?transitPanelHTML():'');
};

/* ---------- 登録の画面（手で入れる・画像から読む） ---------- */
function rideTarget(target){
 const i=String(target||'').indexOf('|'),kind=target.slice(0,i),rest=target.slice(i+1);
 if(kind==='main'&&(rest==='out'||rest==='ret'))return {kind,dir:rest};
 if(kind==='ride'&&rest)return {kind,rk:rest,dir:rest.startsWith('ret|')?'ret':'out'};
 return null;
}
// 予定表の行（電車）の区間を探す
function rideFindRow(rk){
 const p=window.__plan;if(!p)return null;
 for(const d of p.days||[])for(const it of [...(d.tripOut||[]),...(d.tripBack||[])])if(it.type==='trip'&&it.seg&&rideKey(it)===rk){const f=tripSegInfo(it.seg,p.trip?.label||'',(p.trip?.me&&p.trip.me.mode)||'transit',d.di,it.t);return {it,di:d.di,title:f.title};}
 return null;
}
function rideOpen(target,file){
 const tg=rideTarget(target);if(!tg)return;
 const r={target,...tg,no:'',dep:'',arr:'',focus:'dep',ocr:null,msg:'',warn:'',fromImage:false,orig:null};
 if(tg.kind==='main'){
  const m=rideMain(tg.dir);r.air=m?m.air:longMode()==='air';
  const f=rideFor(tg.dir,r.air)||{};r.orig=f.dep||f.no?f:null;
  Object.assign(r,{no:(r.air?flNo(f.no):f.no)||'',dep:rideHHMM(f.dep),arr:rideHHMM(f.arr),route:m?`${m.from} → ${m.to}`:'',date:dayDate(tg.dir==='out'?0:rideLast())});
 }else{
  const v=rideTable()[tg.rk]||{},row=rideFindRow(tg.rk);r.air=false;r.orig=v.dep?v:null;
  Object.assign(r,{no:v.no||'',dep:rideHHMM(v.dep),arr:rideHHMM(v.arr),route:row?row.title:'',date:dayDate(row?row.di:(tg.dir==='ret'?rideLast():0))});
 }
 if(r.dep)r.focus='arr';
 RIDE.reg=r;$('#modal').hidden=false;rideRender();
 if(file)rideReadImage(file);else setTimeout(()=>$('#rregNo')?.focus(),40);
}
// 読み取り中の表示だけを書き換える（入力中の欄は作り直さない）
function rideStatusHTML(r){const o=r.ocr;return o?.busy?`<span class="spin"></span>読み取り中…${o.pct!=null?` ${o.pct}%`:''}${o.first?'<br><small>初回は準備に少し時間がかかります。</small>':''}`:esc(r.msg||'');}
function rideRender(){
 const r=RIDE.reg,el=$('#sheet');if(!r||!el||$('#modal').hidden)return;
 const what=r.air?'便':r.kind==='main'?'列車':'電車',o=r.ocr,busy=!!o?.busy;
 const ae=document.activeElement,keep=ae&&ae.closest&&ae.closest('#sheet')&&ae.id?ae.id:null;
 let sel=null;try{if(keep&&ae.type==='text')sel=[ae.selectionStart,ae.selectionEnd];}catch(e){}
 el.dataset.owner='ride';
 el.innerHTML=`<div class="eyebrow">${r.dir==='out'?'行き':'帰り'}・${esc(fmtDay(r.date))}</div><h2 id="mTitle">乗る${what}を登録</h2>${r.route?`<p class="ride-route">${esc(r.route)}</p>`:''}
 <div class="rreg-ocr">${rideOcrBtn('',!r.dep&&!o,busy)}<small>乗換案内・予約・きっぷの画面写真から読みます。画像は送信しません。</small>
 <p class="status" id="rregStatus" role="status"${busy||r.msg?'':' hidden'}>${rideStatusHTML(r)}</p>
 ${o?.times?.length?`<div class="rreg-times"><span>読み取った時刻（タップで「${r.focus==='arr'?'着':'発'}」に入ります）</span>${o.times.map(t=>`<button type="button" class="chip small" data-rreg-time="${esc(t)}" aria-pressed="${t===r.dep||t===r.arr}">${esc(t)}</button>`).join('')}</div>`:''}</div>
 <div class="rreg-form"><label class="rreg-no"><span>${r.air?'便名':'列車名'}${r.kind==='ride'?'（なくても可）':''}</span><input type="text" id="rregNo" data-reg="no" value="${esc(r.no)}" placeholder="${r.air?'例 NH21':r.kind==='main'?'例 のぞみ21号':'例 快速'}" autocomplete="off" spellcheck="false"></label>
 <div class="rreg-tm"><label class="${r.focus==='dep'?'on':''}"><span>発</span><input type="time" id="rregDep" data-reg="dep" value="${esc(r.dep)}"></label><span aria-hidden="true">→</span><label class="${r.focus==='arr'?'on':''}"><span>着</span><input type="time" id="rregArr" data-reg="arr" value="${esc(r.arr)}"></label></div></div>
 ${r.warn?`<p class="note warnline">${esc(r.warn)}</p>`:''}
 <div class="row rreg-btns">${r.orig?`<button type="button" class="linkbtn" data-rreg-clear="${esc(r.target)}">登録を消す</button>`:''}<button type="button" class="btn" data-close="1">やめる</button><button type="button" class="btn primary" data-rreg-save="1" ${busy?'disabled':''}>登録する</button></div>`;
 if(keep){const k=document.getElementById(keep);if(k){k.focus({preventScroll:true});if(sel)try{k.setSelectionRange(sel[0],sel[1]);}catch(e){}}}
}
// iPhone の時刻欄は input が届かないことがあるため、登録のときに画面の値を読み直す
function rideReadForm(r){for(const [id,k] of [['rregNo','no'],['rregDep','dep'],['rregArr','arr']]){const el=document.getElementById(id);if(el)r[k]=el.value;}}
function rideSave(){
 const r=RIDE.reg;if(!r)return;rideReadForm(r);
 const dep=rideHHMM(r.dep),arr=rideHHMM(r.arr),no=String(r.no||'').trim().slice(0,30);
 if(!dep){r.warn='「発」の時刻を入れてください。';r.focus='dep';return rideRender();}
 if(r.kind==='ride'&&!arr){r.warn='「着」の時刻を入れてください。';r.focus='arr';return rideRender();}
 if(arr){let d=t2m(arr)-t2m(dep);if(d<0)d+=1440;if(d===0||d>16*60){r.warn='発と着の時刻を確かめてください。';return rideRender();}}
 if(r.kind==='main'){
  const nn=r.air?flNo(no):no,o=r.orig,same=o&&o.src==='odpt'&&flNo(o.no)===flNo(nn)&&o.dep===dep&&(o.arr||'')===arr;
  S.flight={...(S.flight||{}),[r.dir]:same?{...o,kind:'air'}:{no:nn,dep,arr,kind:r.air?'air':'rail',src:r.fromImage?'image':'user',at:Date.now()}};
  rideRemember(S.flight[r.dir]);
 }else setRealRide(r.rk,{dep,arr,...(no?{no}:{})});
 closeModal();save();render();
}
function rideClear(target){
 const tg=rideTarget(target);if(!tg)return;
 if(tg.kind==='main'){if(S.flight){S.flight={...S.flight};delete S.flight[tg.dir];}save();}
 else setRealRide(tg.rk,null);
 render();
}
// 画面を閉じたら（やめる・Esc・外側を押す）、読み取り中の結果も捨てる
const rideOldClose=closeModal;
closeModal=function(){RIDE.reg=null;const el=$('#sheet');if(el)delete el.dataset.owner;return rideOldClose.apply(this,arguments);};

/* ---------- 文字から便名・列車名と時刻を読み取る ---------- */
const RIDE_TRAIN='のぞみ|ひかり|こだま|みずほ|さくら|つばめ|はやぶさ|はやて|こまち|かがやき|はくたか|つるぎ|あさま|とき|たにがわ|やまびこ|なすの|つばさ|サンダーバード|しらさぎ|はるか|くろしお|きのさき|こうのとり|はまかぜ|スーパーはくと|やくも|しおかぜ|いしづち|南風|しまんと|うずしお|かもめ|みどり|ハウステンボス|ソニック|にちりん|きりしま|ひゅうが|ゆふいんの森|ゆふ|スペーシア|けごん|きぬ|りょうもう|ひたち|ときわ|あずま|あずさ|かいじ|富士回遊|踊り子|成田エクスプレス|スカイライナー|ロマンスカー|はこね|えのしま|ひのとり|アーバンライナー|しまかぜ|ラピート|こうや|ひだ|しなの|南紀|北斗|すずらん|カムイ|ライラック|おおぞら|とかち|いなほ|しらゆき|つがる|ライナー';
const RIDE_TRAIN_RE=new RegExp(`(${RIDE_TRAIN})(\\d{1,4})号?`);   // 「このときは」などを拾わないよう、号数があるものだけ
const RIDE_FLIGHT_RE=/(?:^|[^A-Z0-9])(JAL|ANA|JL|NH|BC|SKY|MM|APJ|GK|JJP|6J|SNJ|7G|SFJ|JH|FDA|IJ|SJO|NU|JTA|RAC|OC|ORC|EH|HD|ADO)-?(\d{1,4})(?![0-9])/;
function rideNorm(text){
 return String(text||'').replace(/[０-９Ａ-Ｚａ-ｚ]/g,c=>String.fromCharCode(c.charCodeAt(0)-0xFEE0)).replace(/[：∶﹕]/g,':')
  .split(/\r?\n/).map(l=>l.replace(/[\s　]+/g,'').replace(/(\d)[;；.．](\d{2})(?!\d)/g,'$1:$2')).filter(Boolean).join('\n');
}
function rideParse(text,opt={}){
 const t=rideNorm(text),lines=t.split('\n'),out={times:[]};
 // 画面写真のいちばん上（時計だけの行）は除く
 const skip=lines.length>1&&lines[0].length<=14&&/^\D{0,6}\d{1,2}:\d{2}\D{0,8}$/.test(lines[0])&&!/[発着号便]/.test(lines[0])?lines[0].length:-1;
 const T=[];for(const m of t.matchAll(/(\d{1,2}):(\d{2})(?!\d)/g)){if(m.index<skip)continue;const h=+m[1],mi=+m[2];if(h>29||mi>59)continue;const v=String(h%24).padStart(2,'0')+':'+m[2],nx=t[m.index+m[0].length]||'';T.push({v,i:m.index,tag:nx==='発'?'発':nx==='着'?'着':''});}
 out.times=[...new Set(T.map(x=>x.v))].slice(0,12).sort();   // 時刻順に並べて選びやすくする
 let nm=null;
 const fm=t.match(RIDE_FLIGHT_RE);if(fm){const a={JAL:'JL',ANA:'NH',SKY:'BC',APJ:'MM',JJP:'GK',SNJ:'6J',SFJ:'7G',FDA:'JH',SJO:'IJ',ADO:'HD'}[fm[1]]||fm[1];const i=fm.index+fm[0].indexOf(fm[1]);nm={no:a+fm[2],i,len:fm.index+fm[0].length-i};}
 const tm=t.match(RIDE_TRAIN_RE);if(tm&&(!nm||!opt.air)){nm={no:tm[1]+tm[2]+'号',i:tm.index,len:tm[0].length};}
 if(nm)out.no=nm.no;
 let dep=null,arr=null;
 if(nm){
  const end=nm.i+nm.len,before=T.filter(x=>x.i<nm.i&&nm.i-x.i<=90),after=T.filter(x=>x.i>=end&&x.i-end<=220);
  if(before.length&&after.length){dep=before.at(-1);arr=after[0];}
  else if(after.length>=2){dep=after[0];arr=after[1];}
  else if(before.length>=2){dep=before.at(-2);arr=before.at(-1);}
  else if(after.length)dep=after[0];else if(before.length)dep=before.at(-1);
 }
 if(!dep){const d=T.find(x=>x.tag==='発'),a=d&&T.find(x=>x.tag==='着'&&x.i>d.i);if(d){dep=d;arr=a||null;}}
 if(!dep&&T.length){dep=T[0];arr=T.find(x=>x.i>T[0].i&&x.v!==T[0].v)||null;}
 if(dep)out.dep=dep.v;
 if(arr&&dep){let d=t2m(arr.v)-t2m(dep.v);if(d<0)d+=1440;if(d>0&&d<=16*60)out.arr=arr.v;}
 // 日付（10月6日・10/6(火)）
 const dm=t.match(/(\d{1,2})月(\d{1,2})日/)||t.match(/(?:^|[^\d:])(\d{1,2})\/(\d{1,2})(?=[(（])/);
 if(dm&&+dm[1]>=1&&+dm[1]<=12&&+dm[2]>=1&&+dm[2]<=31)out.date={m:+dm[1],d:+dm[2]};
 return out;
}
// 貼り付けた文字（乗換案内のコピーなど）からも読む
function rideApplyParsed(p,src){
 const r=RIDE.reg;if(!r)return false;
 if(p.no&&(!r.air||RIDE_FLIGHT_RE.test(' '+p.no)))r.no=p.no;
 if(p.dep)r.dep=p.dep;if(p.arr)r.arr=p.arr;
 r.focus=r.dep&&!r.arr?'arr':'dep';
 r.warn='';
 if(p.date&&r.date&&(p.date.m!==r.date.getMonth()+1||p.date.d!==r.date.getDate()))r.warn=`${src}の日付（${p.date.m}/${p.date.d}）が旅行の日と違います。確かめてください。`;
 return !!p.dep;
}

/* ---------- 画像の文字の読み取り（Tesseract.js。端末の中で読み取り、画像は送らない） ---------- */
const OCR={lib:null,worker:null,idle:0,used:false,onlog:null};
const OCR_SRC='https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/dist/tesseract.min.js';
const OCR_SRI='sha256-EP/3hIQGd1nEMCigKnLXbQuQ6xcwK7I7WKnsVBC8kos=';   // 版を固定し、中身が変わっていたら読み込まない
function ocrLib(){
 if(window.Tesseract)return Promise.resolve(window.Tesseract);
 if(!OCR.lib)OCR.lib=new Promise((res,rej)=>{const s=document.createElement('script');s.src=OCR_SRC;s.async=true;s.crossOrigin='anonymous';s.integrity=OCR_SRI;s.onload=()=>window.Tesseract?res(window.Tesseract):rej(Error('load'));s.onerror=()=>rej(Error('load'));document.head.appendChild(s);}).catch(e=>{OCR.lib=null;throw e;});
 return OCR.lib;
}
async function ocrWorker(){
 const T=await ocrLib();
 if(!OCR.worker)OCR.worker=T.createWorker('jpn',1,{logger:m=>OCR.onlog&&OCR.onlog(m)}).catch(e=>{OCR.worker=null;throw e;});
 return OCR.worker;
}
// 読みやすい大きさ・白黒にする（ダークモードの画面は白黒を反転）
async function ocrImage(file){
 if(!file||(file.type&&!/^image\//.test(file.type)))throw Object.assign(Error('type'),{code:'type'});
 if(file.size>25e6)throw Object.assign(Error('big'),{code:'big'});
 const url=URL.createObjectURL(file);
 try{
  const im=new Image();im.src=url;await im.decode();
  const w0=im.naturalWidth,h0=im.naturalHeight,L=Math.max(w0,h0);if(!w0||!h0)throw Error('size');
  const k=L>2600?2600/L:L<1100?Math.min(2,1100/L):1,c=document.createElement('canvas');c.width=Math.round(w0*k);c.height=Math.round(h0*k);
  const g=c.getContext('2d',{willReadFrequently:true});g.fillStyle='#fff';g.fillRect(0,0,c.width,c.height);g.drawImage(im,0,0,c.width,c.height);
  const d=g.getImageData(0,0,c.width,c.height),p=d.data;let sum=0;
  for(let i=0;i<p.length;i+=4){const y=0.299*p[i]+0.587*p[i+1]+0.114*p[i+2];p[i]=p[i+1]=p[i+2]=y;sum+=y;}
  if(sum/(p.length/4)<110)for(let i=0;i<p.length;i+=4){p[i]=p[i+1]=p[i+2]=255-p[i];}
  g.putImageData(d,0,0);return c;
 }catch(e){throw e.code?e:Object.assign(Error('decode'),{code:'decode'});}
 finally{URL.revokeObjectURL(url);}
}
async function ocrText(file,onPct){
 const img=await ocrImage(file);
 OCR.onlog=m=>{const s=String(m?.status||''),p=Number(m?.progress)||0;onPct(/recogniz/.test(s)?Math.round(40+p*60):Math.min(39,Math.round(p*39)));};
 clearTimeout(OCR.idle);
 try{const w=await ocrWorker(),{data}=await w.recognize(img);return data?.text||'';}
 finally{OCR.onlog=null;OCR.idle=setTimeout(()=>{const w=OCR.worker;OCR.worker=null;w&&w.then(x=>x.terminate()).catch(()=>{});},120000);}
}
async function rideReadImage(file){
 const r=RIDE.reg;if(!r||!file)return;
 r.ocr={busy:true,pct:0,first:!OCR.used,times:[]};r.msg='';r.warn='';rideRender();
 let last=0;
 try{
  const text=await ocrText(file,p=>{if(RIDE.reg!==r||p===r.ocr.pct)return;r.ocr.pct=p;const now=Date.now();if(now-last>200){last=now;const st=document.getElementById('rregStatus');if(st)st.innerHTML=rideStatusHTML(r);}});
  OCR.used=true;if(RIDE.reg!==r)return;
  const p=rideParse(text,{air:r.air});r.ocr={busy:false,times:p.times};
  const ok=rideApplyParsed(p,'画像');r.fromImage=ok;
  r.msg=ok?'読み取りました。合っているか確かめて「登録する」を押してください。':'時刻を読み取れませんでした。手で入れてください。';
 }catch(e){
  if(RIDE.reg!==r)return;r.ocr=null;
  r.msg=e.code==='type'||e.code==='decode'?'この画像は読めません。画面写真（PNG・JPEG）を選んでください。':e.code==='big'?'画像が大きすぎます。':'読み取りの準備ができませんでした。通信を確かめるか、手で入れてください。';
 }
 rideRender();
}

/* ---------- 操作 ---------- */
document.addEventListener('click',e=>{
 const b=e.target.closest('[data-ride-reg],[data-rreg-save],[data-rreg-time],[data-rreg-clear]');if(!b)return;
 if(b.dataset.rideReg){e.preventDefault();return rideOpen(b.dataset.rideReg);}
 if(b.dataset.rregClear){e.preventDefault();if(b.closest('#sheet'))closeModal();return rideClear(b.dataset.rregClear);}
 const r=RIDE.reg;if(!r)return;
 if(b.dataset.rregSave){e.preventDefault();return rideSave();}
 if(b.dataset.rregTime){const v=b.dataset.rregTime;if(r.focus==='arr'){r.arr=v;}else{r.dep=v;r.focus='arr';}r.warn='';rideRender();}
});
document.addEventListener('change',e=>{
 const t=e.target;if(!t.matches?.('input[data-ride-ocr]'))return;
 const f=t.files&&t.files[0],target=t.dataset.rideOcr;t.value='';if(!f)return;
 if(target)rideOpen(target,f);else rideReadImage(f);
});
for(const ev of ['input','change'])document.addEventListener(ev,e=>{
 const t=e.target,r=RIDE.reg;if(!r||!t.dataset?.reg||!t.closest('#sheet'))return;
 r[t.dataset.reg]=t.value;if(t.dataset.reg!=='no')r.fromImage=false;
});
document.addEventListener('focusin',e=>{
 const t=e.target,r=RIDE.reg;if(!r||!t.dataset?.reg||!t.closest('#sheet'))return;
 if((t.dataset.reg==='dep'||t.dataset.reg==='arr')&&r.focus!==t.dataset.reg){r.focus=t.dataset.reg;const lab=document.querySelectorAll('.rreg-tm label');lab.forEach(l=>l.classList.toggle('on',!!l.querySelector(`[data-reg="${r.focus}"]`)));const s=document.querySelector('.rreg-times>span');if(s)s.textContent=`読み取った時刻（タップで「${r.focus==='arr'?'着':'発'}」に入ります）`;}
});
document.addEventListener('paste',e=>{
 const t=e.target,r=RIDE.reg;if(!r||t?.dataset?.reg!=='no'||!t.closest('#sheet'))return;
 const txt=e.clipboardData?.getData('text')||'';if(!/\d{1,2}\s*[:：]\s*\d{2}/.test(txt))return;
 e.preventDefault();const p=rideParse(txt,{air:r.air});rideApplyParsed(p,'貼り付けた文字');
 r.ocr={busy:false,times:p.times};r.msg=p.dep?'貼り付けた文字から入れました。確かめて「登録する」を押してください。':'';rideRender();
});
if(typeof module!=='undefined')module.exports={rideParse,rideNorm,rideHHMM};
