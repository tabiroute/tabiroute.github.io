/* たびルート 旅のしおり エディター（47都道府県で共通）
   各テンプレートは SCENERY / EDITION / PREF / SLUG / ROMAN / ART / THEME / ART_CROPS だけを持ち、この処理を読み込みます。

   保存のしくみ
   - この端末：IndexedDB「tabiroute-editable-journal」。文字は journals、写真は photos（写真ごとに1回だけ保存）。
     以前は入力のたびに全写真を含むデータ全体を書き直しており、写真が多いと保存に失敗しやすかった。
   - 旅行メンバーと共有（ログインして共有している旅行のとき）：親ページ（index.html）経由で Firestore に保存。
     文字は projects/{旅行}/journals/{都道府県}、写真は projects/{旅行}/journalPhotos/{都道府県}_{写真ID}。
     プライベートブラウズや別のブラウザで開いても、翌日に写真が元に戻らない。
   - 同時に編集したときは、変更した項目だけを上書きして合わせる（他の人の変更を消さない）。 */
'use strict';
function decoration(part,cls){const c=ART_CROPS[part],s=ART_CROPS.size,w=c[2]-c[0],h=c[3]-c[1];return `<div class="${cls} art-window" style="aspect-ratio:${w}/${h}" aria-hidden="true"><img src="${SCENERY}" alt="" style="width:${100*s[0]/w}%;height:${100*s[1]/h}%;left:${-100*c[0]/w}%;top:${-100*c[1]/h}%"></div>`}

const seed=JSON.parse(document.getElementById('seed').textContent||'{}');
const params=new URLSearchParams(location.search);const project=params.get('project')||seed.documentId||'personal';
const key='shiori-v1:'+SLUG+':'+project;
const embedded=parent!==window;
let data,db,saveTimer,syncTimer,activePhoto,draftPhoto,photoEpoch=0,revision=0;
const $=id=>document.getElementById(id);
const hasKey=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

const MEMORY_PROMPTS=[['旅のはじまり','出発するときの気持ちや、楽しみにしていること。'],['ホテルに着いたら','お部屋からの眺め、ほっとしたひとときを。'],['今日いちばんの風景','心に残った景色と、そのときの気持ち。'],['ご当地のおいしい時間','出会った料理や、また食べたい味。'],['寄り道で見つけたもの','道ばたの発見や、思いがけない出会い。'],['旅のおわりに','今回の旅でいちばん覚えておきたいこと。']];
const TRANSPORTS=['徒歩','電車・バス','電車','新幹線','バス','車','飛行機','船','自転車','食事','宿泊','思い出'];
function memoryAllowed(pg){return pg.hasOvernight===true?[0,1,2,3,4,5]:[0,2,3,4,5];}
function syncDayMetadata(payload){const maxDay=Math.max(1,...data.schedule.map(p=>+(p.title.match(/(\d+)日目/)||[])[1]||1));data.schedule.forEach(pg=>{const di=Number.isInteger(pg.dayIndex)?pg.dayIndex:Math.max(0,(+(pg.title.match(/(\d+)日目/)||[])[1]||1)-1),d=payload?.days?.[di];pg.dayIndex=di;pg.isLastDay=d?di===payload.days.length-1:(pg.isLastDay??di===maxDay-1);pg.hasOvernight=d?!!d.hasOvernight:(pg.hasOvernight??!pg.isLastDay);});}
function fillMemorySlots(){syncDayMetadata();data.schedule.forEach((pg,j)=>pg.stops.forEach((st,i)=>{if(st.memory&&st.memoryIndex===1&&!pg.hasOvernight&&st.place===MEMORY_PROMPTS[1][0]){st.memoryIndex=5;st.place=MEMORY_PROMPTS[5][0];if(st.note===MEMORY_PROMPTS[1][1])st.note=MEMORY_PROMPTS[5][1];}if(st.memory||st.place||st.time||st.note||st.caption||data.photos['s'+j+'-'+i])return;const k=i===0?0:i===3?(pg.hasOvernight?1:5):[2,3,4][(j+i)%3];Object.assign(st,{memory:true,memoryIndex:k,place:MEMORY_PROMPTS[k][0],note:MEMORY_PROMPTS[k][1],transport:'思い出'});}));}

const blankStop=()=>({time:'',place:'',note:'',transport:'徒歩',caption:''});
function defaults(){return {design:'watercolor',documentId:crypto.randomUUID?crypto.randomUUID():String(Date.now()),title:PREF,subtitle:'歴史と自然、そしておいしいものに出会う旅',date:'',coverCaption:'',message:THEME.label,memoryTitle:'思い出のフォト',memorySubtitle:'この旅で出会った、最高の瞬間たち。',end:'See you on the next trip.',schedule:[{title:PREF.replace(/[都府県]$/,'')+'の旅スケジュール',subtitle:'',stops:Array.from({length:4},blankStop)}],captions:Array(6).fill(''),photos:{}}}

/* ---------- 写真：ID・検証・保存 ---------- */
const PHOTO_KEY=/^(cover|m[0-5]|s\d{1,2}-[0-3])$/,REF=/^p[0-9a-z]{10,40}$/;
const isImageData=s=>typeof s==='string'&&s.length<15e6&&/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/.test(s);
// 写真の内容から作るID（同じ写真は同じID。暗号用ではない）
function photoRef(s){let h1=0xdeadbeef,h2=0x41c6ce57,h3=0x9e3779b9;for(let i=0;i<s.length;i++){const c=s.charCodeAt(i);h1=Math.imul(h1^c,2654435761);h2=Math.imul(h2^c,1597334677);h3=Math.imul(h3^c,2246822507);}h1=Math.imul(h1^(h1>>>16),2246822507)^Math.imul(h2^(h2>>>13),3266489909);h2=Math.imul(h2^(h2>>>16),2246822507)^Math.imul(h1^(h1>>>13),3266489909);h3=Math.imul(h3^(h3>>>15),2654435761)^h1;return 'p'+(h1>>>0).toString(36)+(h2>>>0).toString(36)+(h3>>>0).toString(36)+s.length.toString(36)}
const photoCache=new Map(); // ref -> data URL（表示中の写真）
const num=(v,min,max,d)=>{v=Number(v);return Number.isFinite(v)?Math.min(max,Math.max(min,v)):d};
function cleanPhoto(v){
 if(!v||typeof v!=='object')return undefined;
 const src=isImageData(v.src)?v.src:undefined,ref=REF.test(v.ref||'')?v.ref:src?photoRef(src):undefined;if(!ref)return undefined;
 const p={ref,x:num(v.x,0,100,50),y:num(v.y,0,100,50)};
 if(src){p.src=src;photoCache.set(ref,src);}
 if(v.orig==='art'||REF.test(v.orig||''))p.orig=v.orig;
 if(isImageData(v.original))p.original=v.original; // 旧形式・HTML保存からの読み込み
 if(v.crop&&typeof v.crop==='object')p.crop={zoom:num(v.crop.zoom,1,5,1),x:num(v.crop.x,-5,5,0),y:num(v.crop.y,-5,5,0),angle:[0,90,180,270].includes(v.crop.angle)?v.crop.angle:0};
 return p;
}
// 共有サーバー・保存ファイルから来たデータは、形と長さを確かめてから使う
function clean(d){
 const D=defaults();if(!d||typeof d!=='object')return D;
 const str=(v,max)=>typeof v==='string'||typeof v==='number'?String(v).slice(0,max):'';
 const out={design:d.design==='editorial'?'editorial':'watercolor',documentId:str(d.documentId,80)||D.documentId,title:str(d.title,40),subtitle:str(d.subtitle,120),date:str(d.date,60),coverCaption:str(d.coverCaption,60),message:str(d.message,80),memoryTitle:str(d.memoryTitle,48),memorySubtitle:str(d.memorySubtitle,100),end:str(d.end,70)};
 out.schedule=(Array.isArray(d.schedule)?d.schedule:[]).slice(0,30).filter(pg=>pg&&typeof pg==='object').map(pg=>{
  const stops=(Array.isArray(pg.stops)?pg.stops:[]).slice(0,4).map(st=>{st=st&&typeof st==='object'?st:{};const o={time:str(st.time,12),place:str(st.place,64),note:str(st.note,120),transport:TRANSPORTS.includes(st.transport)?st.transport:'徒歩',caption:str(st.caption,48)};if(st.memory===true){o.memory=true;o.memoryIndex=[0,1,2,3,4,5].includes(st.memoryIndex)?st.memoryIndex:0;}return o});
  while(stops.length<4)stops.push(blankStop());
  const o={title:str(pg.title,48),subtitle:str(pg.subtitle,100),stops};
  if(Number.isInteger(pg.dayIndex)&&pg.dayIndex>=0&&pg.dayIndex<60)o.dayIndex=pg.dayIndex;
  if(typeof pg.isLastDay==='boolean')o.isLastDay=pg.isLastDay;if(typeof pg.hasOvernight==='boolean')o.hasOvernight=pg.hasOvernight;
  return o});
 if(!out.schedule.length)out.schedule=D.schedule;
 out.captions=Array.from({length:6},(_,i)=>str(Array.isArray(d.captions)?d.captions[i]:'',48));
 out.photos={};
 if(d.photos&&typeof d.photos==='object')for(const [k,v]of Object.entries(d.photos)){if(!PHOTO_KEY.test(k))continue;if(v===null){out.photos[k]=null;continue}const p=cleanPhoto(v);if(p)out.photos[k]=p;}
 return out;
}
// 端末に保存する形（写真本体は photos ストアへ。ここには ID だけ）
let inlinePhotos=false; // 写真を別に保存できなかったとき（容量不足など）は、従来どおりデータの中に持つ
function persistable(){return JSON.parse(JSON.stringify({...data,photos:Object.fromEntries(Object.entries(data.photos).map(([k,v])=>[k,v?{ref:v.ref,orig:v.orig,crop:v.crop,x:v.x,y:v.y,...(inlinePhotos?{src:v.src||photoCache.get(v.ref),original:v.original}:{})}:null]))}))}
// 共有サーバーに送る形（切り抜き前の元写真は端末だけに置く）
function cloudData(){return JSON.parse(JSON.stringify({...data,photos:Object.fromEntries(Object.entries(data.photos).map(([k,v])=>[k,v?{ref:v.ref,x:v.x??50,y:v.y??50}:null]))}))}

/* ---------- 画面 ---------- */
function field(path,val,placeholder='',cls='',max=60,rows=1){return `<textarea class="field ${cls}" data-path="${path}" aria-label="${esc(placeholder||path)}" placeholder="${esc(placeholder)}" maxlength="${max}" rows="${rows}" spellcheck="false">${esc(val)}</textarea>`}
function photo(id,captionPath,caption,cover=false){const p=hasKey(data.photos,id)?data.photos[id]:(cover?{src:ART,x:50,y:10}:null);const n=id==='cover'?'01':String(+(id.match(/\d+$/)?.[0]||0)+1).padStart(2,'0');const src=p&&(p.src||photoCache.get(p.ref));const loading=p&&!src;return `<div class="photo"><button type="button" class="photo-hit" data-photo="${id}" aria-label="${cover?'表紙':id}の写真を選択">${src?`<img src="${esc(src)}" alt="${esc(caption||'旅の写真')}" style="object-position:${num(p.x,0,100,50)}% ${num(p.y,0,100,50)}%">`:''}<span class="empty"><b>${n}</b><span>${loading?'写真を読み込み中…':'YOUR PHOTO HERE'}</span></span></button>${field(captionPath,caption,'写真にひとこと','caption',24,1)}</div>`}
function controls(index,remove){return `<div class="page-controls"><button data-png="${index}">PNG保存 ↗</button>${remove===undefined?'':`<button data-remove="${remove}">／ ページ削除</button>`}</div>`}
function render(){
fillMemorySlots();
document.body.classList.toggle('classic',data.design!=='editorial');$('designToggle').textContent=data.design==='editorial'?'旅のジャーナルに切替':'ポストカード風に切替';
let h=`<section class="page cover">${decoration('bottom','scenery')}<span class="classic-motto">Good Travel<br>Good Days!</span>${decoration('top','classic-mark')}<span class="classic-label">TRAVEL JOURNAL</span><div class="edition"><span>TABIROUTE / TRAVEL JOURNAL</span><span>NO. ${EDITION}</span></div><div class="roman">${data.design==='editorial'?ROMAN.charAt(0)+ROMAN.slice(1).toLowerCase()+'.':ROMAN}</div><div class="cover-photo">${photo('cover','coverCaption',data.coverCaption,true)}</div><span class="vertical">A LITTLE ESCAPE, A LOVELY MEMORY.</span><div class="stamp"><small>JAPAN / ${ROMAN}</small><b>${EDITION}</b><small>TRAVEL NOTES</small></div>${field('title',data.title,'旅のタイトル','cover-title',16,1)}${field('date',data.date,'YYYY.MM.DD — MM.DD','date',30,1)}${field('message',data.message,'心に残したい、旅のひとこと。','cover-message',35,2)}<span class="sign">Bon voyage!</span>${controls(0)}</section>`;
data.schedule.forEach((pg,j)=>{h+=`<section class="page itinerary">${decoration('bottom','scenery')}<span class="top-label">CHAPTER ${String(j+1).padStart(2,'0')} / ${ROMAN}</span><div class="display-title">The itinerary.</div>${field(`schedule.${j}.title`,pg.title,'旅のスケジュール','page-title',24,1)}${field(`schedule.${j}.subtitle`,pg.subtitle,'日付や旅のテーマを入力','subtitle',50,2)}<div class="route">`;
pg.stops.forEach((st,i)=>{const p=`schedule.${j}.stops.${i}`;h+=`<article class="stop ${st.memory?'memory-row':''}"><span class="num">${String(i+1).padStart(2,'0')}</span>${photo(`s${j}-${i}`,p+'.caption',st.caption)}<div class="stop-copy"><div class="stop-head">${st.memory?`<span class="memory-label">MEMORY</span><button type="button" class="memory-tools" data-memory="${j}|${i}" title="思い出のタイトル候補を変更" aria-label="思い出のタイトル候補を変更">↻</button>`:field(p+'.time',st.time,'時刻','time',8,1)}<select class="transport" data-path="${p}.transport" aria-label="移動手段">${TRANSPORTS.map(x=>`<option${x===st.transport?' selected':''}>${x}</option>`).join('')}</select></div>${field(p+'.place',st.place,'訪れたい場所','place',32,2)}${field(p+'.note',st.note,'楽しみなこと、残したいメモ。','note',60,2)}</div></article>`});h+=`</div><div class="page-bottom"><span>TAKE THE SCENIC ROUTE.</span><span>${EDITION} / ${String(j+2).padStart(2,'0')}</span></div>${controls(j+1,j)}</section>`});
h+=`<section class="page album">${decoration('bottom','scenery')}<span class="top-label">COLLECT MOMENTS, NOT THINGS.</span><div class="display-title">Little memories.</div>${field('memoryTitle',data.memoryTitle,'思い出のフォト','page-title',24,1)}${field('memorySubtitle',data.memorySubtitle,'この旅で見つけた、小さなしあわせ。','subtitle',50,2)}<div class="memories">${data.captions.map((c,i)=>photo('m'+i,'captions.'+i,c)).join('')}</div>${field('end',data.end,'See you on the next trip.','album-end',35,1)}<span class="star">✳</span>${controls(data.schedule.length+1)}</section>`;$('pages').innerHTML=h;requestAnimationFrame(fitFields);document.fonts.ready.then(fitFields);
}
// 他の人の変更を反映するときは、入力中の欄とカーソル位置を保つ
function renderKeepingFocus(){const a=document.activeElement,path=a?.dataset?.path,s=a?.selectionStart,e=a?.selectionEnd;render();if(path){const el=document.querySelector(`[data-path="${CSS.escape(path)}"]`);if(el){el.focus({preventScroll:true});try{if(s!=null)el.setSelectionRange(s,e)}catch{}}}}
function reportHeight(){if(embedded&&document.getElementById('pages'))parent.postMessage({type:'tabiroute:journal:resize',height:Math.ceil(document.getElementById('pages').getBoundingClientRect().bottom+scrollY+15)},location.origin)}
function fitFields(){document.querySelectorAll('.field').forEach(el=>{el.style.fontSize='';const initial=parseFloat(getComputedStyle(el).fontSize);let size=initial;while((el.scrollHeight>el.clientHeight+1||el.scrollWidth>el.clientWidth+1)&&size>initial*.62){size-=.25;el.style.fontSize=size+'px'}});reportHeight()}
window.addEventListener('resize',()=>requestAnimationFrame(fitFields));
function status(s){$('status').textContent=s}

/* ---------- 保存先の表示 ---------- */
(()=>{const st=document.createElement('style');st.textContent='.sync-note{display:block;margin:6px auto 0;max-width:980px;padding:8px 12px;border-radius:10px;font-size:13px;line-height:1.6;background:#fff8e6;border:1px solid #ecd9a6;color:#5b4a1e}.sync-note.cloud{background:#eef6ff;border-color:#bcd3ee;color:#1d3d63}.sync-note.warn{background:#fff1ef;border-color:#efc2bb;color:#7a2a20}@media print{.sync-note{display:none}}body.exporting .sync-note{display:none}';document.head.append(st);
 const help=document.querySelector('.help');if(help)help.textContent='文字はその場で入力、写真枠をタップして差し替え。水彩ジャーナルと縦4:5のポストカード風に切り替えられます。ページ下の「PNG保存」で画像に、「しおりだけPDF保存」でPDFにできます。「編集できるHTMLを保存」で写真・入力内容ごと持ち出せます。';
 const n=document.createElement('p');n.id='syncNote';n.className='sync-note';n.setAttribute('role','note');(help||$('status')).after(n);})();
let syncMode='local';
function showSync(mode,detail=''){syncMode=mode;const n=$('syncNote');if(!n)return;
 const text={cloud:'このしおり（文字・写真）は、この旅行に参加しているメンバーと共有して保存します。ほかの端末やブラウザでも同じ内容を開けます。',
  local:'このしおりは、この端末のこのブラウザだけに保存しています。プライベートブラウズでは画面を閉じると消えます。別の端末に移すときは「編集できるHTMLを保存」を使ってください。'+(embedded?'旅行をアカウントに保存（ログイン）すると、メンバーと共有して保存できます。':''),
  rules:'共有サーバーに保存する権限がないため、しおりはこの端末だけに保存しています（この旅行に参加しているか確認してください。サイト管理者は Firestore のルールを更新してください）。プライベートブラウズでは閉じると消えます。',
  offline:'共有サーバーに接続できないため、この端末に保存しています。接続が戻ると自動で共有します。',
  error:'共有サーバーへの保存に失敗しています。この端末には保存済みです。'+detail}[mode]||'';
 n.textContent=text;n.className='sync-note'+(mode==='cloud'?' cloud':mode==='local'?'':' warn');}

/* ---------- この端末（IndexedDB） ---------- */
async function openDB(){return await new Promise((resolve,reject)=>{const r=indexedDB.open('tabiroute-editable-journal',2);r.onupgradeneeded=()=>{const d=r.result;if(!d.objectStoreNames.contains('journals'))d.createObjectStore('journals');if(!d.objectStoreNames.contains('photos'))d.createObjectStore('photos');};r.onsuccess=()=>{const d=r.result;d.onversionchange=()=>d.close();resolve(d)};r.onerror=()=>reject(r.error);r.onblocked=()=>{try{status('別のタブで開いている「旅のしおり」を閉じてください。保存の準備をしています…')}catch{}setTimeout(()=>reject(Object.assign(Error('blocked'),{name:'BlockedError'})),12000)}})}
function idb(store,mode,fn){return new Promise((resolve,reject)=>{const t=db.transaction(store,mode),r=fn(t.objectStore(store));let v;if(r)r.onsuccess=()=>{v=r.result};t.oncomplete=()=>resolve(v);t.onerror=()=>reject(t.error);t.onabort=()=>reject(t.error||Error('abort'))})}
async function getPhoto(ref){if(ref==='art')return ART;if(photoCache.has(ref))return photoCache.get(ref);if(!db)return null;try{const v=await idb('photos','readonly',s=>s.get(ref));return isImageData(v)?v:null}catch{return null}}
async function putPhoto(ref,src){if(!db||ref==='art')return false;try{await idb('photos','readwrite',s=>s.put(src,ref));return true}catch(e){console.warn('photo save',e);return false}}
let persistAsked=false,localOK=true;
async function saveLocal(){
 clearTimeout(saveTimer);saveTimer=null;
 if(!db){status('この環境では自動保存が使えません。「編集できるHTMLを保存」で保管してください。');return false}
 try{await idb('journals','readwrite',s=>s.put({v:2,data:persistable(),rev:cloud.rev,dirty:[...dirty.keys()],synced:[...syncedRefs].slice(-400),savedAt:Date.now()},key));localOK=true;
  if(!persistAsked&&navigator.storage?.persist){persistAsked=true;navigator.storage.persisted?.().then(p=>p||navigator.storage.persist()).catch(()=>{});}
  if(!cloud.enabled)status('この端末に保存しました。');return true}
 catch(e){localOK=false;console.error(e);status(cloud.enabled?'この端末への保存に失敗しました。共有サーバーへの保存を続けます。':'保存できませんでした（端末の空き容量・プライベートブラウズを確認してください）。「編集できるHTMLを保存」で保管してください。');return false}
}

/* ---------- 変更の記録 ---------- */
const dirty=new Map();let dirtySeq=0; // 変更した項目のパス -> 変更番号（共有サーバーに送るまで残す）
function photoKeysChanged(before,after){const ks=new Set([...Object.keys(before),...Object.keys(after)]);for(const k of ks)if(JSON.stringify(before[k]?.ref??before[k]??null)!==JSON.stringify(after[k]?.ref??after[k]??null))changed('photos.'+k);}
function changed(path){revision++;if(path){if(path==='*')dirty.clear();dirty.set(path,++dirtySeq);}status('保存中…');clearTimeout(saveTimer);saveTimer=setTimeout(saveLocal,350);scheduleSync(path&&path.startsWith('photos.')?200:1200);}
function flush(){if(saveTimer)saveLocal();if(syncTimer&&cloud.enabled){clearTimeout(syncTimer);syncTimer=null;sync();}}
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')flush()});
window.addEventListener('pagehide',flush);

/* ---------- 共有サーバー（親ページ経由） ---------- */
const cloud={enabled:false,rev:0,reason:'local',backoff:0};
const syncedRefs=new Set();let syncing=false,syncAgain=false;
const asks=new Map();let askSeq=0;
function ask(type,payload,timeout=45000){return new Promise((resolve,reject)=>{const id=++askSeq;asks.set(id,{resolve,reject});parent.postMessage({type:'tabiroute:journal:'+type,id,slug:SLUG,project,...payload},location.origin);setTimeout(()=>{if(asks.delete(id))reject(Object.assign(Error('timeout'),{code:'timeout'}))},timeout)})}
function getPath(o,a){for(const k of a){if(o==null)return undefined;o=o[k]}return o}
// 共有サーバーの内容に、自分が変更した項目だけを重ねる
function applyDirty(base,local,paths){
 if(paths.includes('*'))return JSON.parse(JSON.stringify(local));
 const out=JSON.parse(JSON.stringify(base||{}));
 for(const p of [...new Set(paths)].sort((a,b)=>a.split('.').length-b.split('.').length)){
  const a=p.split('.'),v=getPath(local,a);let o=out,ok=true;
  for(const k of a.slice(0,-1)){if(o[k]==null||typeof o[k]!=='object'){ok=false;break}o=o[k]}
  if(!ok){if(out[a[0]]==null)out[a[0]]=JSON.parse(JSON.stringify(local[a[0]]??null));continue} // 相手が消したページへの変更は捨てる（ほかの人の内容を丸ごと上書きしない）
  if(v===undefined)delete o[a[a.length-1]];else o[a[a.length-1]]=JSON.parse(JSON.stringify(v));
 }
 return out;
}
function scheduleSync(delay=1200){if(!cloud.enabled||!dirty.size)return;clearTimeout(syncTimer);syncTimer=setTimeout(()=>{syncTimer=null;sync()},delay)}
async function sync(){
 if(!cloud.enabled||!dirty.size)return;if(syncing){syncAgain=true;return}
 syncing=true;const sent=new Map(dirty),d=cloudData(),photos={};
 for(const p of Object.values(d.photos))if(p&&!syncedRefs.has(p.ref)){const s=photoCache.get(p.ref);if(s)photos[p.ref]=s;}
 try{
  const r=await ask('sync',{base:cloud.rev,data:d,dirty:[...sent.keys()],photos},45000+Object.keys(photos).length*90000);
  (r.uploaded||[]).forEach(x=>syncedRefs.add(x));
  for(const [k,v]of sent)if(dirty.get(k)===v)dirty.delete(k);
  // 共有サーバーに無かった写真（別の端末で消された等）は、もう一度送る
  if(r.missing?.length){for(const ref of r.missing){syncedRefs.delete(ref);for(const [k,p]of Object.entries(data.photos))if(p?.ref===ref)dirty.set('photos.'+k,++dirtySeq);}syncAgain=true;}
  const newer=Number(r.rev)>cloud.rev;if(newer)cloud.rev=Number(r.rev);cloud.backoff=0;
  if(newer&&r.merged&&r.data)applyRemote(r.data,cloud.rev,true);
  showSync('cloud');saveLocal();
  if(r.skipped?.length)status('共有できなかった写真があります（'+r.skipped.length+'枚）。その写真をもう一度選び直してください。');else status('保存しました（旅行メンバーと共有）');
 }catch(e){
  if(e.code==='permission-denied'||e.code==='unauthenticated'||e.code==='not-cloud'){cloud.enabled=false;showSync(e.code==='permission-denied'?'rules':'local');saveLocal();}
  else{cloud.backoff=Math.min(120000,(cloud.backoff||4000)*2);showSync(e.code==='unavailable'||e.code==='timeout'?'offline':'error',e.code==='too_large'?'しおりの文字が多すぎます。':'');clearTimeout(syncTimer);syncTimer=setTimeout(()=>{syncTimer=null;sync()},cloud.backoff);}
 }finally{syncing=false;if(syncAgain){syncAgain=false;scheduleSync(300)}}
}
// 共有サーバーの内容を取り込む（自分の未送信の変更は残す）
let composing=false,pendingRemote=null;
document.addEventListener('compositionstart',()=>{composing=true});
document.addEventListener('compositionend',()=>{composing=false;if(pendingRemote){const r=pendingRemote;pendingRemote=null;setTimeout(()=>applyRemote(r.remote,r.rev,r.quiet),0)}});
function applyRemote(remote,rev,quiet){
 if(composing){pendingRemote={remote,rev,quiet};return}
 const merged=clean(applyDirty(remote,cloudData(),[...dirty.keys()]));
 for(const [k,p]of Object.entries(merged.photos)){if(!p)continue;const old=data.photos[k];if(old&&old.ref===p.ref)merged.photos[k]={...old,x:p.x,y:p.y};else{p.src=photoCache.get(p.ref);syncedRefs.add(p.ref);}}
 data=merged;if(rev!=null)cloud.rev=rev;renderKeepingFocus();saveLocal();loadMissingPhotos();
 if(!quiet)status('ほかのメンバーの変更を反映しました。');
}
let loadingPhotos=false;
let loadPhotosAgain=false;
async function loadMissingPhotos(){
 if(loadingPhotos){loadPhotosAgain=true;return}loadingPhotos=true;
 try{
  const need=()=>[...new Set(Object.values(data.photos).filter(p=>p&&!p.src&&!photoCache.has(p.ref)).map(p=>p.ref))];
  for(const ref of need()){const s=await getPhoto(ref);if(s)photoCache.set(ref,s);}
  let rest=need();
  if(rest.length&&cloud.enabled){
   for(let i=0;i<rest.length;i+=8){
    try{const r=await ask('photos',{refs:rest.slice(i,i+8)},60000);for(const [ref,s]of Object.entries(r.photos||{}))if(isImageData(s)&&REF.test(ref)){photoCache.set(ref,s);syncedRefs.add(ref);putPhoto(ref,s);}}catch(e){console.warn('photos',e);break}
   }
  }
  let any=false;for(const p of Object.values(data.photos))if(p&&!p.src&&photoCache.has(p.ref)){p.src=photoCache.get(p.ref);any=true}
  if(any)renderKeepingFocus();
  rest=need();if(rest.length)status('一部の写真を読み込めませんでした（'+rest.length+'枚）。通信状況を確認してから開き直してください。');
 }finally{loadingPhotos=false;if(loadPhotosAgain){loadPhotosAgain=false;setTimeout(loadMissingPhotos,0)}}
}
window.addEventListener('message',e=>{
 if(e.source!==parent||e.origin!==location.origin)return;const m=e.data||{};
 if(m.type==='tabiroute:journal:reply'){const a=asks.get(m.id);if(!a)return;asks.delete(m.id);if(m.ok)a.resolve(m.result||{});else a.reject(Object.assign(Error(m.error?.message||m.error?.code||'error'),{code:m.error?.code||'error'}));}
 if(m.type==='tabiroute:journal:remote'&&m.slug===SLUG&&cloud.enabled&&Number(m.rev)>cloud.rev&&m.data)ready.then(()=>applyRemote(m.data,Number(m.rev)));
});

/* ---------- 入力 ---------- */
$('pages').addEventListener('click',e=>{const b=e.target.closest('[data-memory]');if(!b)return;const [j,i]=b.dataset.memory.split('|').map(Number),st=data.schedule[j].stops[i];const allowed=memoryAllowed(data.schedule[j]);st.memoryIndex=allowed[(allowed.indexOf(st.memoryIndex)+1)%allowed.length];st.place=MEMORY_PROMPTS[st.memoryIndex][0];if(MEMORY_PROMPTS.some(p=>p[1]===st.note))st.note=MEMORY_PROMPTS[st.memoryIndex][1];render();changed(`schedule.${j}.stops.${i}`);});
$('pages').addEventListener('input',e=>{const p=e.target.dataset.path;if(!p)return;const a=p.split('.');let o=data;for(const k of a.slice(0,-1))o=o[k];o[a[a.length-1]]=e.target.value;fitFields();changed(p)});
$('pages').addEventListener('click',e=>{const b=e.target.closest('[data-photo],[data-remove],[data-png]');if(!b)return;if(b.dataset.png!==undefined){exportPNG(+b.dataset.png);return}if(b.dataset.remove!==undefined){if(data.schedule.length===1){status('旅程ページは最低1ページ必要です。');return}if(!confirm('このページの予定と写真を削除しますか？'))return;const n=+b.dataset.remove;data.schedule.splice(n,1);const photos={};for(const [k,v]of Object.entries(data.photos)){const m=/^s(\d+)-(\d+)$/.exec(k);if(!m)photos[k]=v;else if(+m[1]!==n)photos['s'+(+m[1]>n?+m[1]-1:+m[1])+'-'+m[2]]=v}const before=data.photos;data.photos=photos;render();changed('schedule');photoKeysChanged(before,photos);return}openPhoto(b)});

/* ---------- 写真の切り抜き ---------- */
// Crop coordinates are normalized to the displayed frame; retain the original for re-editing.
let cropImage=null,crop={zoom:1,x:0,y:0,angle:0},cropRatio=1,cropBusy=false,hostViewport=null;
const pointers=new Map();let gesture=null;
function positionPhotoDialog(){
 const d=$('photoDialog');if(!d.open)return;
 const v=hostViewport||{top:0,height:innerHeight};
 d.style.top=(v.top+v.height/2)+'px';d.style.maxHeight=Math.max(120,v.height-24)+'px';
}
window.addEventListener('message',e=>{if(e.source===parent&&e.origin===location.origin&&e.data?.type==='tabiroute:journal:viewport'){hostViewport=e.data.viewport;positionPhotoDialog()}});
window.addEventListener('resize',()=>{positionPhotoDialog();drawCrop()});
function cropGeometry(){
 if(!cropImage)return null;const w=$('cropStage').clientWidth,h=$('cropStage').clientHeight;
 const rotated=crop.angle%180!==0,iw=rotated?cropImage.height:cropImage.width,ih=rotated?cropImage.width:cropImage.height;
 const scale=Math.max(w/iw,h/ih)*crop.zoom,sw=iw*scale,sh=ih*scale;
 crop.x=Math.max(-(sw-w)/2/w,Math.min((sw-w)/2/w,crop.x));crop.y=Math.max(-(sh-h)/2/h,Math.min((sh-h)/2/h,crop.y));
 return {w,h,scale};
}
function drawCrop(){
 const g=cropGeometry(),c=$('cropPreview');if(!g)return;
 c.width=Math.round(g.w*2);c.height=Math.round(g.h*2);const ctx=c.getContext('2d');ctx.scale(2,2);ctx.fillStyle='#fff';ctx.fillRect(0,0,g.w,g.h);
 ctx.translate(g.w/2+crop.x*g.w,g.h/2+crop.y*g.h);ctx.rotate(crop.angle*Math.PI/180);ctx.scale(g.scale,g.scale);ctx.drawImage(cropImage,-cropImage.width/2,-cropImage.height/2);
 $('cropZoom').value=crop.zoom;$('zoomValue').textContent=crop.zoom.toFixed(1)+'×';
}
async function loadCrop(src,state){
 const epoch=++photoEpoch;cropBusy=true;$('photoDone').disabled=true;$('cropHint').textContent='写真を読み込み中…';
 try{if(typeof src!=='string'||!src)throw Error('no photo');const im=new Image();im.src=src;await im.decode();if(epoch!==photoEpoch)return;cropImage=im;crop={zoom:1,x:0,y:0,angle:0,...state};
 if(state&&hasKey(state,'legacyX')){const w=$('cropStage').clientWidth,h=$('cropStage').clientHeight,scale=Math.max(w/im.width,h/im.height);crop.x=(.5-(state.legacyX??50)/100)*(im.width*scale-w)/w;crop.y=(.5-(state.legacyY??50)/100)*(im.height*scale-h)/h;delete crop.legacyX;delete crop.legacyY}
 $('cropStage').classList.add('has-photo');$('cropHint').textContent='指で移動・2本指で拡大縮小';drawCrop();
 }catch(e){if(epoch===photoEpoch){cropImage=null;$('cropHint').textContent='写真を読み込めません。別の写真を選んでください。'}}finally{if(epoch===photoEpoch){cropBusy=false;$('photoDone').disabled=!cropImage}}
}
async function openPhoto(b){
 activePhoto=b.dataset.photo;photoEpoch++;cropImage=null;cropBusy=false;pointers.clear();gesture=null;
 const p=hasKey(data.photos,activePhoto)?data.photos[activePhoto]:(activePhoto==='cover'?{src:ART,orig:'art',x:50,y:10}:null);
 draftPhoto=p?{...p}:null;cropRatio=b.clientWidth/b.clientHeight;
 const stage=$('cropStage');stage.style.aspectRatio=String(cropRatio);stage.style.width='min(100%, '+Math.round(250*cropRatio)+'px)';stage.classList.remove('has-photo');$('cropHint').textContent='下のボタンから写真を選んでください';$('file').value='';$('photoDone').disabled=true;
 $('photoDialog').showModal();positionPhotoDialog();if(embedded)parent.postMessage({type:'tabiroute:journal:photo-open'},location.origin);
 if(!p)return;
 const epoch=photoEpoch;let original=p.original||null;
 if(!original&&p.orig&&p.crop){original=await getPhoto(p.orig);if(epoch!==photoEpoch)return;}
 if(original&&p.crop){draftPhoto.original=original;loadCrop(original,p.crop);}
 else loadCrop(p.src||photoCache.get(p.ref)||await getPhoto(p.ref),{legacyX:p.x,legacyY:p.y});
}
function releaseCanvas(c){if(c){c.width=0;c.height=0}}
// 共有サーバーに置ける大きさ（JPEG・約0.9MB以下）にする。以前の版の写真（1600px・PNGなど）もここで縮める
async function fitForCloud(src){
 if(/^data:image\/jpeg;/.test(src)&&src.length<=900000)return src;
 const im=new Image();im.src=src;await im.decode();let c=document.createElement('canvas');
 try{for(const [side,q]of [[1280,.86],[1280,.78],[1100,.74],[960,.7],[800,.66]]){const r=Math.min(1,side/Math.max(im.naturalWidth,im.naturalHeight));c.width=Math.max(1,Math.round(im.naturalWidth*r));c.height=Math.max(1,Math.round(im.naturalHeight*r));const ctx=c.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,c.width,c.height);ctx.drawImage(im,0,0,c.width,c.height);const out=c.toDataURL('image/jpeg',q);if(out.length<=900000)return out;}throw Error('photo too large')}
 finally{releaseCanvas(c);c=null}
}
$('file').onchange=async()=>{
 const f=$('file').files[0];if(!f)return;
 if(!/^image\/(jpeg|png|webp|heic|heif)$/.test(f.type)&&f.type!==''||f.size>40*1024*1024){$('cropHint').textContent='40MB以下の写真（JPEG・PNG・WebP）を選んでください。';return}
 const epoch=++photoEpoch;cropBusy=true;$('photoDone').disabled=true;$('cropHint').textContent='写真を読み込み中…';const url=URL.createObjectURL(f);let c=null;
 try{const im=new Image();im.src=url;await im.decode();if(epoch!==photoEpoch)return;
 // 元写真は長辺2048pxに縮めて保存する（iPhone の大きな写真をそのまま扱うと、メモリ不足で保存に失敗しやすい）
 const ratio=Math.min(1,2048/Math.max(im.naturalWidth||im.width,im.naturalHeight||im.height));c=document.createElement('canvas');c.width=Math.max(1,Math.round((im.naturalWidth||im.width)*ratio));c.height=Math.max(1,Math.round((im.naturalHeight||im.height)*ratio));const ctx=c.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,c.width,c.height);ctx.drawImage(im,0,0,c.width,c.height);
 const original=c.toDataURL('image/jpeg',.9);releaseCanvas(c);c=null;im.src='';
 draftPhoto={original,fresh:true,x:50,y:50};await loadCrop(original);
 }catch(e){if(epoch===photoEpoch){cropBusy=false;$('photoDone').disabled=!cropImage;$('cropHint').textContent='写真を読み込めません。別の写真を選んでください（HEICの場合は「互換性優先」の設定や、スクリーンショットでもお試しいただけます）。'}}finally{releaseCanvas(c);URL.revokeObjectURL(url)}
};
function zoomCrop(z,cx=0,cy=0){const old=crop.zoom;crop.zoom=Math.min(5,Math.max(1,z));const ratio=crop.zoom/old;crop.x=cx-(cx-crop.x)*ratio;crop.y=cy-(cy-crop.y)*ratio;drawCrop()}
$('cropZoom').oninput=e=>zoomCrop(+e.target.value);
$('cropRotate').onclick=()=>{crop.angle=(crop.angle+90)%360;crop.zoom=1;crop.x=crop.y=0;drawCrop()};
$('cropReset').onclick=()=>{crop={zoom:1,x:0,y:0,angle:0};drawCrop()};
function startGesture(){const pts=[...pointers.values()];gesture={crop:{...crop},pts};}
const stage=$('cropStage');stage.onpointerdown=e=>{if(!cropImage)return;e.preventDefault();stage.setPointerCapture(e.pointerId);pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});startGesture()};
stage.onpointermove=e=>{
 if(!pointers.has(e.pointerId)||!gesture)return;e.preventDefault();pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});const pts=[...pointers.values()],g=gesture,rect=stage.getBoundingClientRect();
 if(pts.length===1){crop.x=g.crop.x+(pts[0].x-g.pts[0].x)/rect.width;crop.y=g.crop.y+(pts[0].y-g.pts[0].y)/rect.height}
 else{const a=g.pts,b=pts,dist=p=>Math.hypot(p[1].x-p[0].x,p[1].y-p[0].y);const oldCX=((a[0].x+a[1].x)/2-rect.left)/rect.width-.5,oldCY=((a[0].y+a[1].y)/2-rect.top)/rect.height-.5;
 crop.zoom=Math.max(1,Math.min(5,g.crop.zoom*dist(b)/Math.max(1,dist(a))));const ratio=crop.zoom/g.crop.zoom;
 crop.x=((b[0].x+b[1].x)/2-rect.left)/rect.width-.5-(oldCX-g.crop.x)*ratio;crop.y=((b[0].y+b[1].y)/2-rect.top)/rect.height-.5-(oldCY-g.crop.y)*ratio;
 }drawCrop();
};
function endPointer(e){pointers.delete(e.pointerId);startGesture()};stage.onpointerup=endPointer;stage.onpointercancel=endPointer;stage.onlostpointercapture=endPointer;
stage.onwheel=e=>{if(!cropImage)return;e.preventDefault();const r=stage.getBoundingClientRect();zoomCrop(crop.zoom*Math.exp(-e.deltaY*.002),(e.clientX-r.left)/r.width-.5,(e.clientY-r.top)/r.height-.5)};
stage.onkeydown=e=>{if(!cropImage)return;const moves={ArrowLeft:[-.025,0],ArrowRight:[.025,0],ArrowUp:[0,-.025],ArrowDown:[0,.025]};if(moves[e.key]){e.preventDefault();crop.x+=moves[e.key][0];crop.y+=moves[e.key][1];drawCrop()}};
$('photoDone').onclick=async()=>{
 if(!cropImage||cropBusy)return;cropBusy=true;$('photoDone').disabled=true;const id=activePhoto,dp=draftPhoto||{};let c=document.createElement('canvas');
 try{
 // 切り抜いた写真は長辺1280px（しおりのPDF・PNGに十分な大きさ。共有サーバーの容量も節約）
 const g=cropGeometry();c.width=Math.round(1280*Math.min(1,cropRatio));c.height=Math.round(c.width/cropRatio);const ctx=c.getContext('2d'),k=c.width/g.w;
 ctx.fillStyle='#fff';ctx.fillRect(0,0,c.width,c.height);ctx.translate(c.width/2+crop.x*c.width,c.height/2+crop.y*c.height);ctx.rotate(crop.angle*Math.PI/180);ctx.scale(g.scale*k,g.scale*k);ctx.drawImage(cropImage,-cropImage.width/2,-cropImage.height/2);
 let src=c.toDataURL('image/jpeg',.86);releaseCanvas(c);c=null;if(!isImageData(src))throw Error('encode');src=await fitForCloud(src);
 const ref=photoRef(src);let orig=dp.orig||null;
 if(dp.fresh){orig=photoRef(dp.original);photoCache.set(orig,dp.original);await putPhoto(orig,dp.original);}
 else if(!dp.orig&&dp.ref)orig=dp.ref; // 共有サーバーから来た写真は、その写真自体を元写真として使う
 photoCache.set(ref,src);const ok=await putPhoto(ref,src);
 data.photos[id]={ref,src,orig:orig||undefined,crop:{...crop},x:50,y:50};if(!data.photos[id].orig)delete data.photos[id].orig;
 if(dp.fresh)photoCache.delete(orig); // 元写真はメモリに置き続けない（端末の保存領域には保存済み）
 render();changed('photos.'+id);$('photoDialog').close();
 if(!ok&&db)status('写真をこの端末に保存できませんでした（空き容量を確認してください）。'+(cloud.enabled?'共有サーバーには保存します。':''));
 }catch(e){console.error(e);$('cropHint').textContent='写真を反映できませんでした。もう一度お試しください。'}
 finally{releaseCanvas(c);cropBusy=false;$('photoDone').disabled=!cropImage}
};
$('photoDelete').onclick=()=>{data.photos[activePhoto]=null;render();changed('photos.'+activePhoto);$('photoDialog').close()};$('photoCancel').onclick=()=>$('photoDialog').close();
$('photoDialog').addEventListener('close',()=>{photoEpoch++;pointers.clear();cropImage=null;draftPhoto=null;releaseCanvas($('cropPreview'));if(embedded)parent.postMessage({type:'tabiroute:journal:photo-close'},location.origin)});

/* ---------- ツールバー ---------- */
$('refreshPlan').hidden=!embedded;$('refreshPlan').onclick=()=>{if(confirm('最新の予定表を反映します。旅程ページの手編集と写真は置き換わります。表紙・思い出ページは残ります。続けますか？'))parent.postMessage({type:'tabiroute:journal:request-plan'},location.origin)};
$('designToggle').onclick=()=>{data.design=data.design==='editorial'?'watercolor':'editorial';render();changed('design')};
$('viewSize').onclick=()=>{document.body.classList.toggle('large');$('viewSize').textContent=document.body.classList.contains('large')?'一覧に戻る':'大きく編集';requestAnimationFrame(fitFields)};
$('add').onclick=()=>{if(data.schedule.length>=30){status('旅程は最大30ページです。');return}data.schedule.push({title:'旅のスケジュール',subtitle:'',stops:Array.from({length:4},blankStop)});render();changed('schedule.'+(data.schedule.length-1))};$('print').onclick=exportPDF;

async function inlineJournalAssets(copy){
  const asData=async(url)=>{const res=await fetch(url);if(!res.ok)throw Error('Asset '+res.status);const blob=await res.blob();return await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(reader.error);reader.readAsDataURL(blob)})};
  for(const link of copy.querySelectorAll('link[data-embed]')){
    const url=new URL(link.getAttribute('href'),document.baseURI),res=await fetch(url);if(!res.ok)throw Error('Font CSS');let css=await res.text();
    const matches=[...css.matchAll(/url\(([^)]+)\)/g)];
    for(const match of matches){const ref=match[1].replace(/["']/g,'');if(!ref.startsWith('data:'))css=css.replace(match[0],'url('+await asData(new URL(ref,url))+')')}
    const style=document.createElement('style');style.textContent=css;link.replaceWith(style);
  }
  for(const script of copy.querySelectorAll('script[data-embed][src]')){
    const res=await fetch(new URL(script.getAttribute('src'),document.baseURI));if(!res.ok)throw Error('Export script');script.textContent=(await res.text()).replace(/<\/script/gi,'<\\/script');script.removeAttribute('src');script.removeAttribute('data-embed');
  }
  if(!SCENERY.startsWith('data:')){
    const scenery=await asData(new URL(SCENERY,document.baseURI));
    for(const script of copy.querySelectorAll('script:not([src])'))script.textContent=script.textContent.replace('const SCENERY='+JSON.stringify(SCENERY),'const SCENERY='+JSON.stringify(scenery));
  }
}
// 持ち出し用：写真本体を埋め込んだデータ
async function portableData(){const d=JSON.parse(JSON.stringify(persistable()));for(const [k,p]of Object.entries(data.photos)){if(!p)continue;const src=p.src||await getPhoto(p.ref);d.photos[k]=src?{src,x:p.x,y:p.y}:undefined;}return JSON.parse(JSON.stringify(d))}
$('backup').onclick=async()=>{$('backup').disabled=true;status('編集できるHTMLを作成しています…');try{const copy=document.documentElement.cloneNode(true);copy.querySelector('#travelSaveDialog')?.remove();copy.querySelector('#syncNote')?.remove();copy.querySelector('#backup').disabled=false;copy.querySelector('#seed').textContent=JSON.stringify(await portableData()).replace(/</g,'\\u003c');copy.querySelector('#pages').innerHTML='';copy.querySelector('#status').textContent='';copy.querySelector('#photoDialog').removeAttribute('open');copy.querySelectorAll('style').forEach(s=>{if(s.textContent.startsWith('.sync-note'))s.remove()});await inlineJournalAssets(copy);const blob=new Blob(['<!doctype html>\n'+copy.outerHTML],{type:'text/html;charset=utf-8'});downloadBlob(blob,SLUG+'-travel-journal.html');status('HTMLの準備ができました。保存方法を選んでください。')}catch(e){status('HTML保存に必要な素材を取得できませんでした。オンラインで再度お試しください。');console.error(e)}finally{$('backup').disabled=false}};
$('reset').onclick=()=>{if(!confirm('現在のしおりを初期化しますか？'+(cloud.enabled?'旅行メンバーのしおりも初期化されます。':'')+' 必要なら先にHTMLを保存してください。'))return;data=defaults();render();changed('*')};

/* ---------- PDF・PNG 保存 ---------- */
let exportBusy=false;
const wait=ms=>new Promise(r=>setTimeout(r,ms));
// 紙の質感（細かいノイズ）。テンプレートは SVG フィルターの背景画像で描いているが、
// iPhone の Safari では SVG を画像として描くとキャンバスが「汚染」され、保存時に SecurityError になる。
// 書き出しのときだけ、同じ雰囲気のノイズを自前のキャンバスで描く。
let noiseTile=null;
function paperNoise(){if(noiseTile)return noiseTile;const c=document.createElement('canvas');c.width=c.height=180;const ctx=c.getContext('2d'),img=ctx.createImageData(180,180);let seed=20261005;const rnd=()=>(seed=(seed*1664525+1013904223)>>>0)/4294967296;for(let i=0;i<img.data.length;i+=4){const v=rnd()*255|0;img.data[i]=v;img.data[i+1]=(v+rnd()*60)%255|0;img.data[i+2]=(v+rnd()*60)%255|0;img.data[i+3]=Math.round(66*rnd());}ctx.putImageData(img,0,0);noiseTile=c;return c}
async function capturePage(pg,width=1440){
 await document.fonts.ready;await Promise.all([...pg.querySelectorAll('img')].map(im=>im.decode().catch(()=>{})));
 const bounds=pg.getBoundingClientRect(),scale=width/bounds.width,made=[];
 // 画像はすべて、こちらで書き出す大きさのキャンバスに描いてから渡す（html2canvas に画像を読み込ませない）
 const imgs=[...pg.querySelectorAll('img')];imgs.forEach((im,i)=>im.dataset.cap=i);
 const W=Math.round(bounds.width*scale),H=Math.round(bounds.height*scale);
 let canvas=null;
 try{
 canvas=await html2canvas(pg,{scale,backgroundColor:null,logging:false,imageTimeout:20000,useCORS:false,allowTaint:false,
  // ほかのページや編集用の画面は複製しない（スマホのメモリ不足対策）
  ignoreElements:el=>(el.classList?.contains('page')&&el!==pg)||el.tagName==='DIALOG'||el.id==='syncNote',
  onclone:doc=>{
  doc.body.classList.add('exporting');doc.querySelectorAll('.page-controls,.photo-hit .empty').forEach(el=>el.style.display='none');
  // html2canvas は ::before/::after を複製時に実体の要素に置き換えるので、その背景画像（SVG のノイズ）を外す
  const st=doc.createElement('style');st.textContent='.page:after,.page:before{background-image:none!important}';doc.head.append(st);
  doc.querySelectorAll('html2canvaspseudoelement').forEach(el=>{if(/url\(/.test(el.style.backgroundImage||''))el.style.backgroundImage='none'});
  doc.querySelectorAll('select.transport').forEach(el=>{const span=doc.createElement('span');span.className=el.className;span.textContent=el.value;el.replaceWith(span)});
  doc.querySelectorAll('img').forEach(im=>{
   const src=imgs[+im.dataset.cap];if(!src||!src.naturalWidth){im.remove();return}
   const cv=doc.createElement('canvas');made.push(cv);
   if(src.closest('.photo-hit')){
    // 写真：枠の大きさで、object-fit:cover と同じ切り抜き
    const w=Math.max(1,Math.round((src.offsetWidth||1)*scale)),h=Math.max(1,Math.round((src.offsetHeight||1)*scale));cv.width=w;cv.height=h;
    const ctx=cv.getContext('2d'),[px,py]=String(src.style.objectPosition||'50% 50%').split(' ').map(v=>parseFloat(v)/100),k=Math.max(w/src.naturalWidth,h/src.naturalHeight),dw=src.naturalWidth*k,dh=src.naturalHeight*k;
    ctx.drawImage(src,(w-dw)*(Number.isFinite(px)?px:.5),(h-dh)*(Number.isFinite(py)?py:.5),dw,dh);
    cv.style.cssText='display:block;width:100%;height:100%';
   }else{
    // 飾りの絵：はみ出し部分を切り取る窓（親の枠）ごと描く
    const box=src.parentElement,w=Math.max(1,Math.round(box.clientWidth*scale)),h=Math.max(1,Math.round(box.clientHeight*scale));cv.width=w;cv.height=h;
    let x=src.offsetLeft,y=src.offsetTop,iw=src.offsetWidth,ih=src.offsetHeight;if(src.offsetParent!==box){const pr=box.getBoundingClientRect(),ir=src.getBoundingClientRect(),f=box.clientWidth/(pr.width||1);x=(ir.left-pr.left)*f;y=(ir.top-pr.top)*f;iw=ir.width*f;ih=ir.height*f;}
    cv.getContext('2d').drawImage(src,x*scale,y*scale,iw*scale,ih*scale);
    cv.style.cssText='position:absolute;left:0;top:0;width:100%;height:100%;display:block';
   }
   im.replaceWith(cv);
  });
  // 紙の質感
  const page=doc.querySelector('.page');if(page){const n=doc.createElement('canvas');made.push(n);n.width=Math.max(1,Math.round(W/2));n.height=Math.max(1,Math.round(H/2));const ctx=n.getContext('2d');ctx.fillStyle=ctx.createPattern(paperNoise(),'repeat');ctx.fillRect(0,0,n.width,n.height);n.style.cssText='position:absolute;inset:0;width:100%;height:100%;z-index:5;pointer-events:none;opacity:.22';page.append(n);}
  doc.querySelectorAll('.field').forEach(el=>{const div=doc.createElement('div');div.className=el.className;div.style.cssText=el.style.cssText;div.textContent=el.value;div.style.whiteSpace='pre-wrap';div.style.wordBreak='break-word';el.replaceWith(div)});
 }});
 // 書き出せる状態か（汚染されていないか）を、ここで確かめる
 try{canvas.getContext('2d').getImageData(0,0,1,1)}catch(e){throw Object.assign(Error('画像の安全確認に失敗しました（'+(e?.name||'')+'）'),{name:e?.name||'SecurityError'})}
 const out=canvas;canvas=null;return out;
 }finally{releaseCanvas(canvas);made.forEach(releaseCanvas);imgs.forEach(im=>delete im.dataset.cap)}
}
// うまくいかないときは、解像度を下げてやり直す（iPhone の Safari はキャンバスの合計メモリに上限がある）
async function captureWithRetry(pg,widths){let last;for(const w of widths){try{return await capturePage(pg,w)}catch(e){last=e;console.warn('capture',w,e);await wait(250)}}throw last}
function downloadBlob(blob,name){TabirouteSave.open(blob,name)}
function exportError(e){const m=String(e?.message||e||'').replace(/\s+/g,' ').slice(0,80);return `保存できませんでした。もう一度お試しください。ページごとの「PNG保存」も使えます。（${e?.name||'Error'}${m?'：'+m:''}）`}
async function withExport(fn){
 if(exportBusy)return;exportBusy=true;document.activeElement?.blur();$('pages').inert=true;const buttons=[...document.querySelectorAll('.toolbar button')].map(el=>[el,el.disabled]);buttons.forEach(([el])=>el.disabled=true);
 try{await fn()}catch(e){status(exportError(e));console.error(e)}finally{exportBusy=false;$('pages').inert=false;buttons.forEach(([el,v])=>el.disabled=v)}
}
const mobile=()=>matchMedia('(max-width:600px)').matches||/iPhone|iPad|Android/i.test(navigator.userAgent);
async function exportPNG(index){const pg=document.querySelectorAll('.page')[index];if(!pg)return;await withExport(async()=>{
 status('投稿用PNGを作成しています…');const canvas=await captureWithRetry(pg,[1080,810,640]);let blob;try{blob=await new Promise(r=>canvas.toBlob(r,'image/png'))}finally{releaseCanvas(canvas)}if(!blob)throw Error('PNGを作成できませんでした');downloadBlob(blob,SLUG+'-'+String(index+1).padStart(2,'0')+'.png');status('PNGの準備ができました。保存方法を選んでください。');
})}
async function exportPDF(){await withExport(async()=>{
 const pages=[...document.querySelectorAll('.page')],first=pages[0].getBoundingClientRect(),pdf=new jspdf.jsPDF({unit:'mm',format:[140,140*first.height/first.width],compress:true});
 pdf.setProperties({title:PREF+' 旅のしおり',creator:'たびルート'});
 const widths=mobile()?[1080,760,560]:[1440,1080,760];
 for(let i=0;i<pages.length;i++){
  status('しおりだけのPDFを作成中… '+(i+1)+' / '+pages.length+'ページ');
  const canvas=await captureWithRetry(pages[i],widths),height=140*canvas.height/canvas.width;if(i)pdf.addPage([140,height],'portrait');
  let jpg;try{jpg=canvas.toDataURL('image/jpeg',.9)}finally{releaseCanvas(canvas)}
  if(!jpg||jpg.length<100)throw Error('ページ画像を作成できませんでした');
  pdf.addImage(jpg,'JPEG',0,0,140,height,undefined,'FAST');jpg=null;
  await wait(60);
 }
 downloadBlob(pdf.output('blob'),SLUG+'-travel-journal.pdf');status('PDFの準備ができました。保存方法を選んでください。');
})}

/* ---------- 予定表との連携・読み込み ---------- */
// 共有サーバーにつながらなかったときは、時間をおいて（または通信が戻ったら）つなぎ直す
let retryTimer=null;
function retryCloud(){if(retryTimer||cloud.enabled)return;cloud.retry=(cloud.retry||0)+1;const go=()=>{clearTimeout(retryTimer);retryTimer=null;removeEventListener('online',go);if(!cloud.enabled)parent.postMessage({type:'tabiroute:journal:ready',slug:SLUG,project,retry:true},location.origin)};retryTimer=setTimeout(go,Math.min(300000,15000*2**(cloud.retry-1)));addEventListener('online',go);}
function importPlan(payload){if(!payload||payload.pref!==PREF||!Array.isArray(payload.days))return;const pages=[];for(const [di,d]of payload.days.slice(0,30).entries()){const rows=Array.isArray(d.rows)?d.rows:[];for(let i=0;i<Math.max(1,rows.length);i+=4){const stops=rows.slice(i,i+4).map(r=>({...blankStop(),time:String(r.t||'').slice(0,12),place:String(r.name||'').slice(0,36),transport:r.meal?'食事':r.kind==='hotel'?'宿泊':d.mode==='car'?'車':d.mode==='walk'?'徒歩':'電車・バス'}));while(stops.length<4)stops.push(blankStop());pages.push({dayIndex:di,isLastDay:di===payload.days.length-1,hasOvernight:!!d.hasOvernight,title:(di+1)+'日目のスケジュール',subtitle:String(d.date||'').slice(0,50),stops})}}data.schedule=pages.slice(0,30);if(!data.schedule.length)data.schedule=defaults().schedule;data.date=String(payload.date||'').slice(0,40);render();changed('schedule');changed('date')}
// 旧形式（写真をデータの中に持っていた）を、写真ごとの保存に移す
// 戻り値：すべての写真を保存できたか。できなかったときは写真をデータの中に残したまま保存する（消さない）
async function adoptPhotos(markDirty){
 let ok=true;
 for(const [k,p]of Object.entries(data.photos)){
  if(!p)continue;
  try{if(p.src){const fit=await fitForCloud(p.src);if(fit!==p.src){if(!p.original){p.original=p.src;p.crop=undefined;}p.src=fit;p.ref=photoRef(fit);photoCache.set(p.ref,fit);}}}catch(e){console.warn('fit',e)}
  if(p.src&&!(await getPhotoStored(p.ref))&&!(await putPhoto(p.ref,p.src)))ok=false;
  if(p.original){const o=photoRef(p.original);if(await putPhoto(o,p.original)){p.orig=o;delete p.original;}else ok=false;}
  if(markDirty)dirty.set('photos.'+k,++dirtySeq);
 }
 // 以前の版で書いた文字も、共有サーバーの内容より優先して残す
 if(markDirty)for(const k of ['title','date','message','coverCaption','memoryTitle','memorySubtitle','end','design','captions','schedule'])dirty.set(k,++dirtySeq);
 return ok;
}
async function getPhotoStored(ref){if(!db)return null;try{return await idb('photos','readonly',s=>s.get(ref))}catch{return null}}
window.addEventListener('message',async e=>{
 if(e.source!==parent||e.origin!==location.origin||e.data?.type!=='tabiroute:journal:init')return;await ready;const m=e.data;if(!m.payload)return;
 const c=m.cloud||{};
 if(c.enabled){cloud.enabled=true;cloud.retry=0;showSync('cloud');}else if(!cloud.enabled){showSync(c.reason==='rules'?'rules':c.reason==='offline'?'offline':'local');if(c.reason==='offline'&&embedded)retryCloud();}
 if(m.force){const before=data.photos;data.photos=Object.fromEntries(Object.entries(data.photos).filter(([k])=>!/^s\d+-\d+$/.test(k)));importPlan(m.payload);photoKeysChanged(before,data.photos);return}
 if(c.enabled&&c.data){
  if(!restored||Number(c.rev)!==cloud.rev||dirty.size){applyRemote(c.data,Number(c.rev)||0,true);}
  syncDayMetadata(m.payload);render();loadMissingPhotos();status(dirty.size?'このしおりの変更を共有しています…':'共有しているしおりを開きました。');scheduleSync(300);return;
 }
 if(restored||revision>0){
  if(c.enabled){cloud.rev=0;dirty.set('*',++dirtySeq);} // 共有サーバーにまだ無い → この端末の内容を共有する
  syncDayMetadata(m.payload);render();saveLocal();scheduleSync(300);status('保存済みのしおりを開きました。');return;
 }
 importPlan(m.payload);
});
let restored=false;const ready=(async()=>{
 let legacy=false;
 try{db=await openDB();const saved=await idb('journals','readonly',s=>s.get(key));
  if(saved&&saved.v===2&&saved.data){data=clean(saved.data);cloud.rev=Number(saved.rev)||0;(saved.dirty||[]).forEach(p=>dirty.set(p,++dirtySeq));(saved.synced||[]).forEach(r=>syncedRefs.add(r));restored=true;}
  else if(saved){data=clean(saved);restored=true;legacy=true;}
 }catch(e){console.warn('journal db',e);db=null;}
 if(!data)data=Object.keys(seed).length?clean(seed):defaults();
 if(!restored&&Object.keys(seed).length)legacy=true;
 if(legacy){try{const ok=db?await adoptPhotos(true):false;inlinePhotos=!ok;if(db)await saveLocal()}catch(e){inlinePhotos=true;console.warn(e)}}
 status(db?'文字や写真を選んで、自分だけのしおりに。':'この環境では自動保存が使えません。「編集できるHTMLを保存」で保管してください。');
 showSync('local');render();loadMissingPhotos();
 if(embedded)parent.postMessage({type:'tabiroute:journal:ready',slug:SLUG,project},location.origin)
})();
