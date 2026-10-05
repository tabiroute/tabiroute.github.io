/* しおり（iframe）の共有保存を、親ページ（index.html）で Firestore に読み書きする。
   - 文字：projects/{旅行ID}/journals/{都道府県}   { data, rev, updatedAt, updatedBy, by }
   - 写真：projects/{旅行ID}/journalPhotos/{都道府県}_{写真ID}   { slug, ref, src(JPEG data URL), by, at }
   読み書きできるのは、その旅行のメンバーだけ（firestore.rules）。Firebase Storage は使わない（無料の Spark プランのまま）。 */
(function(){'use strict';
const SLUG=/^[a-z]{3,12}$/,REF=/^p[0-9a-z]{10,40}$/,PID=/^[A-Za-z0-9_-]{6,64}$/;
const isJpeg=s=>typeof s==='string'&&s.length<=950000&&/^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/.test(s);
const available=()=>typeof APP!=='undefined'&&APP.mode==='cloud'&&APP.user&&!APP.user.local&&typeof FB!=='undefined'&&FB&&FB.db&&typeof firebase!=='undefined';
const slugOf=pref=>typeof JEN!=='undefined'&&JEN[pref]?JEN[pref].toLowerCase():'';
const jdoc=(pid,slug)=>FB.db.collection('projects').doc(pid).collection('journals').doc(slug);
const pdoc=(pid,slug,ref)=>FB.db.collection('projects').doc(pid).collection('journalPhotos').doc(slug+'_'+ref);
const timeout=(p,ms)=>Promise.race([p,new Promise((_,rej)=>setTimeout(()=>rej(Object.assign(Error('timeout'),{code:'timeout'})),ms))]);
const refsOf=d=>new Set(Object.values(d?.photos||{}).filter(p=>p&&REF.test(p.ref||'')).map(p=>p.ref));
function code(e){const c=String(e?.code||'').replace(/^firestore\//,'');return c||'error'}
function getPath(o,a){for(const k of a){if(o==null)return undefined;o=o[k]}return o}
// 共有サーバーの内容に、送ってきた人が変更した項目だけを重ねる（しおり側と同じ規則）
function applyDirty(base,local,paths){
 if(!Array.isArray(paths)||paths.includes('*'))return JSON.parse(JSON.stringify(local));
 const out=JSON.parse(JSON.stringify(base||{}));
 for(const p of [...new Set(paths.map(String))].sort((a,b)=>a.split('.').length-b.split('.').length)){
  const a=p.split('.');if(a.some(k=>k==='__proto__'||k==='constructor'||k==='prototype'))continue;
  const v=getPath(local,a);let o=out,ok=true;
  for(const k of a.slice(0,-1)){if(o[k]==null||typeof o[k]!=='object'){ok=false;break}o=o[k]}
  if(!ok){if(out[a[0]]==null)out[a[0]]=JSON.parse(JSON.stringify(local[a[0]]??null));continue}
  if(v===undefined)delete o[a[a.length-1]];else o[a[a.length-1]]=JSON.parse(JSON.stringify(v));
 }
 return out;
}

/* しおりを開いたとき：共有サーバーの内容を添えて渡す */
async function init(frame,payload){
 const send=cloud=>{try{frame.contentWindow?.postMessage({type:'tabiroute:journal:init',payload,cloud},location.origin)}catch{}};
 const slug=slugOf(S?.pref),pid=APP?.pid;
 if(!available()||!slug||!pid)return send({enabled:false,reason:'local'});
 try{
  const snap=await timeout(jdoc(pid,slug).get(),12000),d=snap.exists?snap.data():null;
  send({enabled:true,rev:Number(d?.rev)||0,data:d?.data||null});watch(pid,slug);
 }catch(e){const c=code(e);console.warn('journal init',e);send({enabled:false,reason:c==='permission-denied'?'rules':'offline'});}
}

/* ほかのメンバーの変更を、開いているしおりに届ける */
let watcher=null;
function stopWatch(){try{watcher?.unsub()}catch{}watcher=null}
function watch(pid,slug){
 const k=pid+'/'+slug;if(watcher?.k===k)return;stopWatch();
 const unsub=jdoc(pid,slug).onSnapshot(snap=>{
  const f=document.getElementById('journalFrame');
  if(!f||APP.pid!==pid||slugOf(S?.pref)!==slug||APP.ptab!=='journal'){stopWatch();return}
  if(snap.metadata.hasPendingWrites||!snap.exists)return;const d=snap.data();
  if(!d||d.updatedBy===CLIENT_ID)return;
  f.contentWindow?.postMessage({type:'tabiroute:journal:remote',slug,rev:Number(d.rev)||0,data:d.data},location.origin);
 },()=>stopWatch());
 watcher={k,unsub};
}

/* 保存：写真を先に置き、そのあと文字をトランザクションで書く */
async function sync(m){
 if(!available())throw Object.assign(Error('not cloud'),{code:'not-cloud'});
 const pid=String(m.project||''),slug=String(m.slug||'');
 if(!PID.test(pid)||!SLUG.test(slug)||!m.data||typeof m.data!=='object')throw Object.assign(Error('bad request'),{code:'invalid-argument'});
 if(JSON.stringify(m.data).length>700000)throw Object.assign(Error('too large'),{code:'too_large'});
 const want=refsOf(m.data),uploaded=[],skipped=[];
 for(const [ref,src]of Object.entries(m.photos||{})){
  if(!REF.test(ref)||!want.has(ref))continue;
  if(!isJpeg(src)){skipped.push(ref);continue}
  await timeout(pdoc(pid,slug,ref).set({slug,ref,src,by:APP.user.uid,at:Date.now()}),90000);uploaded.push(ref);
 }
 let before=null,next=m.data,merged=false,rev=1;
 await timeout(FB.db.runTransaction(async tx=>{
  const ref=jdoc(pid,slug),cur=await tx.get(ref),c=cur.exists?cur.data():null;
  before=c?.data||null;next=m.data;merged=false;
  if(c&&Number(c.rev)!==Number(m.base)){next=applyDirty(c.data,m.data,m.dirty);merged=true;}
  rev=(Number(c?.rev)||0)+1;
  tx.set(ref,{data:next,rev,updatedAt:Date.now(),updatedBy:CLIENT_ID,by:APP.user.uid});
 }),45000);
 // 新しく参照された写真が共有サーバーにあるか確かめる（無ければしおり側が送り直す）
 const prev=refsOf(before),after=refsOf(next),missing=[];
 await Promise.all([...after].filter(r=>!prev.has(r)&&!uploaded.includes(r)).slice(0,30).map(async r=>{try{const s=await pdoc(pid,slug,r).get();if(!s.exists)missing.push(r)}catch{}}));
 // 利用者が差し替え・削除した写真だけを消す（容量の節約）。ページ削除などで一時的に参照が無くなった写真は消さない
 const explicit=new Set((Array.isArray(m.dirty)?m.dirty:[]).map(String).filter(p=>/^photos\.[a-z0-9-]+$/.test(p)).map(p=>before?.photos?.[p.slice(7)]?.ref).filter(Boolean));
 for(const r of explicit)if(!after.has(r))pdoc(pid,slug,r).delete().catch(()=>{});
 return {rev,merged,data:merged?next:null,uploaded,missing,skipped};
}
async function photos(m){
 if(!available())throw Object.assign(Error('not cloud'),{code:'not-cloud'});
 const pid=String(m.project||''),slug=String(m.slug||'');if(!PID.test(pid)||!SLUG.test(slug))throw Object.assign(Error('bad request'),{code:'invalid-argument'});
 const out={};
 await Promise.all((Array.isArray(m.refs)?m.refs:[]).filter(r=>REF.test(r)).slice(0,8).map(async r=>{const s=await timeout(pdoc(pid,slug,r).get(),30000);const v=s.exists?s.data():null;if(v&&isJpeg(v.src))out[r]=v.src;}));
 return {photos:out};
}
window.addEventListener('message',async e=>{
 if(e.origin!==location.origin||!e.source)return;const m=e.data||{};
 if(m.type!=='tabiroute:journal:sync'&&m.type!=='tabiroute:journal:photos')return;
 const reply=msg=>{try{e.source.postMessage({type:'tabiroute:journal:reply',id:m.id,...msg},location.origin)}catch{}};
 try{reply({ok:true,result:m.type==='tabiroute:journal:sync'?await sync(m):await photos(m)});}
 catch(err){console.warn('journal '+m.type,err);reply({ok:false,error:{code:code(err),message:String(err?.message||err).slice(0,120)}});}
});
// 旅行を削除するときは、しおりの文字・写真も消す（Firestore はサブコレクションを自動では消さない）
async function purge(pid){for(const name of ['journalPhotos','journals'])for(let i=0;i<20;i++){const q=await FB.db.collection('projects').doc(pid).collection(name).limit(100).get();if(q.empty)break;await Promise.all(q.docs.map(d=>d.ref.delete()));}}
if(typeof Cloud!=='undefined'&&typeof Cloud.remove==='function'){const remove=Cloud.remove.bind(Cloud);Cloud.remove=async function(pid){try{if(available()&&PID.test(String(pid)))await timeout(purge(pid),30000)}catch(e){console.warn('journal purge',e)}return remove(pid)}}
window.TabirouteJournalHost={init,applyDirty,stopWatch};
})();
