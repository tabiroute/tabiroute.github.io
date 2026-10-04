/* v10: visible-only scheduling, stable place identity, shared Worker cache and bounded device cache. */
const PHOTO_CORE=globalThis.TabiroutePhotoCore,IMG={},IMGREG={},imgWait={},PHOTO_VERSION='photo-v10';
const PHOTO_META='tabiroute-photo-meta-v10',PHOTO_BYTES='tabiroute-photo-bytes-v10';
const photoMeta=new Map();try{for(const [k,v]of JSON.parse(localStorage.getItem(PHOTO_META)||'[]'))if(v.staleUntil>Date.now())photoMeta.set(k,v);}catch{}
let metaSave;const photoStore={async get(k){return photoMeta.get(k)||null;},async set(k,v){photoMeta.delete(k);photoMeta.set(k,v);while(photoMeta.size>180)photoMeta.delete(photoMeta.keys().next().value);clearTimeout(metaSave);metaSave=setTimeout(()=>{try{localStorage.setItem(PHOTO_META,JSON.stringify([...photoMeta]));}catch{}},200);},async delete(k){photoMeta.delete(k);}};
const directTransport=PHOTO_CORE.transport({store:photoStore}),directResolver=PHOTO_CORE.resolver({api:directTransport.api,store:photoStore});
let photoWorkerUnsupported=false,photoWorkerPause=0,photoActive=0,photoRetryTimer=0;const photoJobs=[],photoURLs=new Map();
function imgKey(o){try{return PHOTO_CORE.key(PHOTO_CORE.place(o));}catch{return norm(o?.name)+'@'+(o?.lat??'')+','+(o?.lng??'');}}
function photoBase(){try{const u=new URL(window.TABIROUTE_BOOKING?.apiBase||'');return ['https:','http:'].includes(u.protocol)&&!u.username&&!u.password?u.href.replace(/\/$/,''):'';}catch{return '';}}
function photoInput(o){return {...o,pref:o.pref||S?.pref||''};}
async function photoResolve(o,force=false){
 const p=PHOTO_CORE.place(photoInput(o)),base=photoBase(),k='worker:'+base+':'+PHOTO_CORE.key(p),old=await photoStore.get(k);
 if(base&&!photoWorkerUnsupported){
  if(!force&&old?.until>Date.now())return {...old.data,cached:true};
  try{
   if(photoWorkerPause>Date.now())throw PHOTO_CORE.fail('provider_limited',Math.ceil((photoWorkerPause-Date.now())/1000));
   const u=base+'/photos?'+new URLSearchParams({...p,...(force?{refresh:'1'}:{})});let r;try{r=await fetch(u,{credentials:'omit',signal:AbortSignal.timeout(55000)});}catch{throw PHOTO_CORE.fail('provider_unavailable');}
   let j;try{j=await r.json();}catch{throw PHOTO_CORE.fail('provider_bad_response');}
   // Older Workers have no photo endpoint. Direct mode uses the same resolver, not another search policy.
   if(r.status===404||(j.code==='not_found'&&!j.version?.includes('v10'))){photoWorkerUnsupported=true;}
   else{
    if(!r.ok||!j.ok){const retry=PHOTO_CORE.retrySeconds(r.headers.get('Retry-After')||j.retryAfter);if(r.status===429||r.status===503)photoWorkerPause=Date.now()+retry*1000;throw PHOTO_CORE.fail(j.code||'provider_unavailable',retry);}
    if(j.version!==PHOTO_VERSION||!['ready','missing','unverified'].includes(j.status))throw PHOTO_CORE.fail('provider_bad_response');
    const data={...j,photos:(j.photos||[]).filter(x=>PHOTO_CORE.fileName(x.file)&&x.artist&&x.license&&x.src===base+'/photo-image?file='+encodeURIComponent(x.file)&&PHOTO_CORE.imageURL(x.remote))};
    if(data.status==='ready'&&!data.photos.length)throw PHOTO_CORE.fail('provider_bad_response');
    await photoStore.set(k,{data,until:Number(j.expiresAt)||Date.now()+300000,staleUntil:(Number(data.fetchedAt)||Date.now())+(data.status==='ready'?7*PHOTO_CORE.DAY:300000)});return data;
   }
  }catch(e){if(old?.data?.status==='ready'&&old.staleUntil>Date.now())return {...old.data,stale:true,retryAfter:e.retryAfter||60};throw e;}
 }
 return directResolver.resolve(p,{force});
}
async function trimPhotoBytes(cache){try{const keys=await cache.keys();let total=0;const keep=[];for(const k of keys){const r=await cache.match(k),size=Number(r?.headers.get('X-Photo-Bytes')||0);keep.push({k,size});total+=size;}while(keep.length>60||total>24*1024*1024){const x=keep.shift();await cache.delete(x.k);total-=x.size;}}catch{}}
async function photoBytes(photo){
 const cacheKey=new URL('./_photo-cache/'+PHOTO_VERSION+'?file='+encodeURIComponent(photo.file),document.baseURI).href;let cache,hit;
 try{cache=await caches.open(PHOTO_BYTES);hit=await cache.match(cacheKey);}catch{}
 if(hit&&Date.now()-Number(hit.headers.get('X-Photo-Saved'))<7*PHOTO_CORE.DAY){const blob=await hit.blob();return {blob,cached:true};}
 let r;try{r=await fetch(photo.src,{credentials:'omit',signal:AbortSignal.timeout(20000)});}catch{throw PHOTO_CORE.fail('image_network');}
 if(r.status===429||r.status===503){let j={};try{j=await r.json();}catch{}throw PHOTO_CORE.fail(j.code||'provider_limited',PHOTO_CORE.retrySeconds(r.headers.get('Retry-After')||j.retryAfter));}
 if(r.status===404)throw PHOTO_CORE.fail('image_missing',60);if(!r.ok)throw PHOTO_CORE.fail('image_network');
 if(!/^image\/(jpeg|png|webp)(?:;|$)/i.test(r.headers.get('Content-Type')||''))throw PHOTO_CORE.fail('image_invalid');
 const length=Number(r.headers.get('Content-Length'));if(length>4*1024*1024)throw PHOTO_CORE.fail('image_too_large');const blob=await r.blob();if(!blob.size||blob.size>4*1024*1024)throw PHOTO_CORE.fail('image_too_large');
 // Decode before caching: a successful HTTP response alone is not proof of a usable image.
 const u=URL.createObjectURL(blob);try{const im=new Image();im.src=u;await im.decode();if(!im.naturalWidth)throw Error();}catch{throw PHOTO_CORE.fail('image_invalid');}finally{URL.revokeObjectURL(u);}
 if(cache)try{await cache.put(cacheKey,new Response(blob,{headers:{'Content-Type':blob.type,'X-Photo-Saved':String(Date.now()),'X-Photo-Bytes':String(blob.size)}}));await trimPhotoBytes(cache);}catch{}
 return {blob,cached:false};
}
function releasePhotoURL(k){const u=photoURLs.get(k);if(u){URL.revokeObjectURL(u);photoURLs.delete(k);}}
async function findImage(o,{force=false,start=0}={}){
 if(!o||o.food||o.hotel||o.meal)return {none:true,status:'excluded',t:Date.now()};
 let result=await photoResolve(o,force);if(result.status!=='ready')return {none:true,status:result.status,unverified:result.status==='unverified',t:Date.now(),retryAt:result.expiresAt};
 const photos=result.photos||[],k=imgKey(o);let error;
 for(let i=0;i<photos.length;i++){
  const at=(start+i)%photos.length,p=photos[at];try{const {blob,cached}=await photoBytes(p);releasePhotoURL(k);const src=URL.createObjectURL(blob);photoURLs.set(k,src);for(const key of photoURLs.keys()){if(photoURLs.size<=120)break;if(key!==k&&!document.querySelector('.ph[data-imgkey="'+CSS.escape(key)+'"]')){releasePhotoURL(key);delete IMG[key];}}return {...p,src,downloadSrc:p.src,status:'ready',alts:photos,ai:at,stale:!!result.stale,byteCached:cached,t:Date.now(),expiresAt:result.expiresAt};}
  catch(e){error=e;if(/limited|unavailable|network/.test(e.code||''))throw e;}
 }
 // Invalidate stale URL metadata once; never recurse indefinitely.
 if(!force&&error?.code==='image_missing')return findImage(o,{force:true,start:0});
 throw error||PHOTO_CORE.fail('image_unavailable');
}
function imgSlot(o,size){if(!o?.name)return '';const k=imgKey(o);IMGREG[k]={...o};return `<div class="ph ph-${esc(size)}" data-imgkey="${esc(k)}" data-size="${esc(size)}">${phInner(k,size)}</div>`;}
function phInner(k,size){const r=IMG[k],o=IMGREG[k]||{},small=/^(sm|thumb|nearcard)$/.test(size);
 if(r?.src)return `<img src="${esc(r.src)}" alt="${esc(o.name)}" ${r.contain?'style="object-fit:contain;background:#edf2f5"':''} loading="lazy" decoding="async" onload="this.classList.add('ok')" onerror="imgBroken(this)" title="${esc(creditText(r))}">${!small?`<a class="photo-source" href="${esc(r.page)}" target="_blank" rel="noopener" style="position:absolute;bottom:4px;left:5px;right:5px;width:fit-content;max-width:calc(100% - 10px);padding:2px 5px;border-radius:4px;background:#000b;color:white;font-size:9px;z-index:2">${esc(r.artist)} · ${esc(r.license)}</a>`:''}${/hero|card/.test(size)&&r.alts?.length>1?`<button type="button" class="ph-swap" data-nextimg="${esc(k)}" aria-label="別の確認済み写真">⟳</button>`:''}`;
 const message=r?.status==='missing'?'公開写真が未登録です':r?.status==='unverified'?'場所を特定できず写真を確認できません':r?.status==='error'?'写真の通信を再試行します':imgWait[k]?'写真を確認しています…':'写真を読み込みます';
 return `<div class="phi" role="status">${ICON.img}${small?'':esc(message)}${!small&&r?.none?`<span><button class="linkbtn" type="button" data-photo-retry="${esc(k)}" style="font-size:11px">再読み込み</button></span>`:''}</div>`;
}
function creditText(r){return r?.src?'写真：'+r.artist+'（'+r.license+'）':'';}
function creditHTML(r){return r?.src?`${esc(creditText(r))} <a href="${esc(r.page)}" target="_blank" rel="noopener">出典</a> <a href="${esc(r.licenseURL||r.page)}" target="_blank" rel="noopener">利用条件</a>`:'';}
function ensureCredit(k){const el=document.querySelector(`.credit[data-credit="${CSS.escape(k)}"]`);if(el)el.innerHTML=creditHTML(IMG[k]);}
function sizedUrl(u){return u;} // Keep the URL issued by the provider; never synthesize thumbnail URLs.
function paintKey(k){if(typeof HOVER!=='undefined'&&HOVER?.k===k)HOVER.paint();document.querySelectorAll(`.ph[data-imgkey="${CSS.escape(k)}"]`).forEach(el=>{el.classList.remove('loading');el.innerHTML=phInner(k,el.dataset.size);});ensureCredit(k);}
function photoScheduleRetry(){clearTimeout(photoRetryTimer);const waits=Object.keys(IMG).filter(k=>IMG[k]?.status==='error'&&(IMG[k].attempts||0)<3&&document.querySelector(`.ph[data-imgkey="${CSS.escape(k)}"]`)).map(k=>IMG[k].retryAt-Date.now());if(waits.length)photoRetryTimer=setTimeout(hydrateImages,Math.max(250,Math.min(...waits)));}
function imgRequest(k,force=false){if(imgWait[k]||!IMGREG[k]||(!force&&IMG[k]?.retryAt>Date.now()))return;imgWait[k]=true;photoJobs.push({k,force});pumpImg();}
function pumpImg(){while(photoActive<2&&photoJobs.length){const {k,force}=photoJobs.shift();photoActive++;const previous=IMG[k];paintKey(k);
 const job=findImage(IMGREG[k],{force});
 job.then(r=>{IMG[k]=r;}).catch(e=>{const attempts=(previous?.attempts||0)+1;IMG[k]={none:true,status:'error',err:true,code:e.code||'image_network',t:Date.now(),attempts,retryAt:Date.now()+Math.max(e.retryAfter||60,Math.min(300,30*2**attempts))*1000};}).finally(()=>{delete imgWait[k];photoActive--;paintKey(k);photoScheduleRetry();pumpImg();});
}}
const photoObserver=typeof IntersectionObserver!=='undefined'?new IntersectionObserver(entries=>{for(const x of entries)if(x.isIntersecting){photoObserver.unobserve(x.target);const k=x.target.dataset.imgkey;if(!IMG[k]?.src&&((IMG[k]?.attempts||0)<3))imgRequest(k);}}, {rootMargin:'300px'}):null;
function hydrateImages(){photoObserver?.disconnect();document.querySelectorAll('.ph[data-imgkey]').forEach(el=>{const k=el.dataset.imgkey,r=IMG[k];if(r?.src)return;if(r?.retryAt>Date.now())return;if(photoObserver)photoObserver.observe(el);else imgRequest(k);});photoScheduleRetry();}
function retryImages(){for(const k of Object.keys(IMG)){if(IMG[k]?.none){delete IMG[k];}}hydrateImages();}
async function imgBroken(el){const k=el.closest('.ph')?.dataset.imgkey;if(!k)return;releasePhotoURL(k);IMG[k]={none:true,status:'error',err:true,attempts:3,retryAt:Date.now()+60000,t:Date.now()};paintKey(k);}
async function nextPhoto(k){if(imgWait[k])return;const old=IMG[k];if(!old?.alts?.length)return;imgWait[k]=true;try{const r=await findImage(IMGREG[k],{start:(old.ai+1)%old.alts.length});IMG[k]=r;}catch{toast('別の写真は現在読み込めません。表示中の写真を保持します。');}finally{delete imgWait[k];paintKey(k);}}
function attractionPhotoScore(p,o,a){return PHOTO_CORE.photo(p,o,a);} // Existing quality regression test / diagnostics.
function hasDish(f){return !!f;}
document.addEventListener('click',e=>{const b=e.target.closest('[data-photo-retry]');if(!b)return;const k=b.dataset.photoRetry;if(IMG[k]?.retryAt>Date.now()&&IMG[k]?.status==='error'){toast('再試行まで約'+Math.ceil((IMG[k].retryAt-Date.now())/1000)+'秒お待ちください。');return;}delete IMG[k];imgRequest(k,true);});
window.addEventListener('online',()=>{for(const r of Object.values(IMG))if(r.status==='error'&&r.retryAt<=Date.now())r.attempts=0;hydrateImages();});
window.addEventListener('pagehide',()=>{clearTimeout(photoRetryTimer);});
// Remove only obsolete photo/search caches. Saved trips and account data are unaffected.
try{for(let i=localStorage.length-1;i>=0;i--){const k=localStorage.key(i);if(/^tabiroute-img-v\d+$/.test(k))localStorage.removeItem(k);}}catch{}
