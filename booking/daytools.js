/* 予定表の道具：
   ・概算の電車・バスの区間に「時刻を入れる」（入れた発・着の時刻に合わせて、その日の予定を組み直す）
   ・回る順番を変える画面を、場所から直接開く（「動かす」） */
PLAN_KEYS.push('legTimes');
let LT_KEY=null;   // 開いている「時刻を入れる」の区間（#sheet に属性を付けない：ほかの画面のクリックを拾わないため）
function legPtKey(p){return Number(p.lat).toFixed(4)+','+Number(p.lng).toFixed(4);}
function legKeyOf(a,b){return legPtKey(a)+'>'+legPtKey(b);}
function legTimeOK(v){return /^([01]\d|2[0-3]):[0-5]\d$/.test(v||'');}
// planner.js の schedule から呼ばれる：その日のこの区間に入れた時刻
function legUserTime(di,a,b){
  if(!S?.legTimes||!a||!b||a.lat==null||b.lat==null)return null;
  const v=S.legTimes[di+'|'+legKeyOf(a,b)];
  if(!v||!legTimeOK(v.dep)||!legTimeOK(v.arr))return null;
  const dep=t2m(v.dep),arr=t2m(v.arr);
  return arr>=dep?{dep,arr,note:String(v.note||'')}:null;
}
function legTimeBtn(di,it){
  if(!it.from||!it.to||it.from.lat==null||it.to.lat==null)return '';
  const has=!!it.user;
  return `<button type="button" class="btn small ${has?'ghost':'primary'} legtime-b" data-legtime="${di}|${esc(legKeyOf(it.from,it.to))}">${has?'時刻を変える':'時刻を入れる'}</button>${has&&it.user.note?`<span class="legtime-note">${esc(it.user.note)}</span>`:''}`;
}
function legFind(di,key){
  const d=window.__plan?.days?.[di];if(!d)return null;
  return d.items.find(x=>x.type==='leg'&&x.from&&x.to&&legKeyOf(x.from,x.to)===key)||null;
}
function openLegTime(di,key){
  const it=legFind(di,key);if(!it)return;
  const v=(S.legTimes||{})[di+'|'+key]||{};
  const hm=m=>{m=Math.max(0,Math.min(1439,Math.round(m)));return String(Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0');};
  const dep=v.dep||hm(it.t),arr=v.arr||hm(it.t+it.min);
  $('#sheet').innerHTML=`<div class="eyebrow">${di+1}日目の移動</div><h2 id="mTitle">時刻を入れる</h2>
  <p class="note" style="font-size:13.5px"><b>${esc(it.from.name||'')}</b> → <b>${esc(it.to.name||'')}</b></p>
  <div class="rreg-form legtime-form">
    <div class="legtime-row"><label>発<input type="time" id="ltDep" value="${esc(dep)}" step="60"></label><span aria-hidden="true">→</span><label>着<input type="time" id="ltArr" value="${esc(arr)}" step="60"></label></div>
    <label>乗るもの（なくてもOK）<input type="text" id="ltNote" maxlength="40" value="${esc(v.note||'')}" placeholder="例：JR奈良線 快速"></label>
  </div>
  <p class="note">乗換案内で調べた時刻を入れると、その時刻で組み直します。</p>
  <p><a href="${esc(wayURL(placeWay(it.from),placeWay(it.to),di,it.t))}" target="_blank" rel="noopener">乗換案内で調べる</a></p>
  <div class="row" style="justify-content:space-between;margin-top:12px">${v.dep?'<button type="button" class="linkbtn" data-legtime-del="1">入れた時刻を消す</button>':'<span></span>'}<span class="row" style="gap:8px"><button type="button" class="btn" data-close="1">やめる</button><button type="button" class="btn primary" data-legtime-save="1">保存</button></span></div>`;
  LT_KEY=di+'|'+key;
  $('#modal').hidden=false;
  setTimeout(()=>document.getElementById('ltDep')?.focus(),30);
}
function saveLegTime(del){
  const k=LT_KEY;if(!k||!document.getElementById('ltDep'))return;
  S.legTimes={...(S.legTimes||{})};
  if(del){delete S.legTimes[k];}
  else{
    const dep=document.getElementById('ltDep').value,arr=document.getElementById('ltArr').value,note=document.getElementById('ltNote').value.trim().slice(0,40);
    if(!legTimeOK(dep)||!legTimeOK(arr))return toast('発と着の時刻を入れてください');
    if(t2m(arr)<t2m(dep))return toast('着の時刻は、発より後にしてください');
    S.legTimes[k]={dep,arr,note};
  }
  LT_KEY=null;
  if(typeof bookingRouteMemo!=='undefined')bookingRouteMemo=null;
  closeModal();save();render();toast(del?'時刻を消しました':'入れた時刻で組み直しました');
}
// 場所の「動かす」：順番を変える画面を、その場所を選んだ状態で開く
const ltCloseModal=closeModal;closeModal=function(){LT_KEY=null;return ltCloseModal.apply(this,arguments);};
function openMoveFor(id){if(typeof openOrderEditor!=='function')return;openOrderEditor();APP.ordSel=id;renderOrderEditor();}
document.addEventListener('click',e=>{
  const t=e.target.closest('button[data-legtime],[data-legtime-save],[data-legtime-del],[data-movefor]');if(!t)return;
  if(t.dataset.legtime){const i=t.dataset.legtime.indexOf('|');openLegTime(+t.dataset.legtime.slice(0,i),t.dataset.legtime.slice(i+1));}
  else if(t.hasAttribute('data-legtime-save'))saveLegTime(false);
  else if(t.hasAttribute('data-legtime-del'))saveLegTime(true);
  else if(t.dataset.movefor)openMoveFor(t.dataset.movefor);
});
document.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.isComposing&&e.keyCode!==229&&e.target.closest?.('.legtime-form')){e.preventDefault();saveLegTime(false);}});
