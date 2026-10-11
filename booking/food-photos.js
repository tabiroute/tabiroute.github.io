/* One lazy, cached pipeline for actual restaurant photos in every prefecture. */
const FOOD_PHOTOS={items:new Map(),results:new Map(),pending:new Map(),active:0,queue:[],failed:new Set(),workerUnavailable:false};
const foodPhotoResolver=TabirouteFoodPhotoCore.resolver({api:TabirouteFoodPhotoCore.transport({store:photoStore}).api,store:photoStore});
function foodPhotoKey(o){return JSON.stringify([TabirouteFoodPhotoCore.VERSION,bookingID(o),norm(o.name),TabirouteFoodPhotoCore.address(o.addr)||[o.lat??'',o.lng??''],o.pref||'']);}
function foodPhotoSeed(o){
 const match=RESTAURANT_PHOTO_SEEDS.find(s=>norm(s.name)===norm(o.name)&&TabirouteFoodPhotoCore.address(s.addr)===TabirouteFoodPhotoCore.address(o.addr)&&(!o.pref||s.pref===o.pref));
 if(!match)return null;const p=match.photo,src=[p.src,p.remote].find(u=>u&&!FOOD_PHOTOS.failed.has(u));
 return src?{...p,src,expiresAt:Infinity}:null;
}
function foodPhotoProvided(o){
 const custom=bookingMedia(o),own=bookingSafeURL(o.ownPhoto),registered=bookingSafeURL(custom.url),api=Number(o.apiExpiresAt)>Date.now()?bookingSafeURL(o.apiPhoto):'';
 const src=[own,registered,api].find(u=>u&&!FOOD_PHOTOS.failed.has(u));if(!src)return null;
 const manual=src===own||src===registered;
 return {src,manual,kind:src===registered&&custom.kind==='dish'?'restaurant-dish':'shop',label:src===own?'登録写真':src===registered&&custom.kind==='dish'?'料理写真':'店舗写真',credit:src===own?'利用者が登録':src===registered?custom.credit||'登録写真':'画像提供：ホットペッパー グルメ',page:manual?'':hpURL(o),expiresAt:manual?Infinity:Number(o.apiExpiresAt)};
}
function foodPhotoCached(key){
 if(FOOD_PHOTOS.results.has(key))return FOOD_PHOTOS.results.get(key);
 try{const r=JSON.parse(sessionStorage.getItem('tb-shop-photo-v2:'+key)||'null');if(r?.until>Date.now()){FOOD_PHOTOS.results.set(key,r);return r;}}catch{}
 return null;
}
function foodPhotoRemember(key,r){
 FOOD_PHOTOS.results.set(key,r);
 try{sessionStorage.setItem('tb-shop-photo-v2:'+key,JSON.stringify(r));const keys=Object.keys(sessionStorage).filter(k=>k.startsWith('tb-shop-photo-v2:'));for(const k of keys){const v=JSON.parse(sessionStorage.getItem(k)||'null');if(!v||v.until<=Date.now())sessionStorage.removeItem(k);}keys.slice(0,Math.max(0,keys.length-60)).forEach(k=>sessionStorage.removeItem(k));}catch{}
}
function foodPhotoChoice(key){
 const o=FOOD_PHOTOS.items.get(key)||{},provided=foodPhotoProvided(o),seed=foodPhotoSeed(o),r=foodPhotoCached(key)?.photo;
 const all=[provided,seed,r].filter(p=>p?.src&&p.expiresAt>Date.now()&&!FOOD_PHOTOS.failed.has(p.src));
 return all.sort((a,b)=>(b.manual?100:b.kind==='restaurant-dish'?80:20)-(a.manual?100:a.kind==='restaurant-dish'?80:20))[0]||null;
}
async function foodRestaurantDish(o){
 let place;try{place=TabirouteFoodPhotoCore.restaurant(o);}catch{return null;}
 const base=photoBase();let data;
 if(base&&!FOOD_PHOTOS.workerUnavailable){
  const r=await fetch(base+'/food-photos?'+new URLSearchParams(place),{credentials:'omit',signal:AbortSignal.timeout(10000)});
  if(r.status===404)FOOD_PHOTOS.workerUnavailable=true;
  else {
   const j=await r.json();
   if(r.status===400&&j.code==='dish_required')FOOD_PHOTOS.workerUnavailable=true;
   else if(!r.ok)throw PHOTO_CORE.fail(r.status===429?'provider_limited':'provider_unavailable',PHOTO_CORE.retrySeconds(r.headers.get('Retry-After')));
   else if(j.version===TabirouteFoodPhotoCore.VERSION)data=j;
   else FOOD_PHOTOS.workerUnavailable=true;
  }
 }
 // Direct Commons is only a compatibility fallback, not a second search after timeouts.
 if(!data)data=await foodPhotoResolver.resolve(place);
 const photo=(data.photos||[]).find(p=>p.kind==='restaurant-dish'&&PHOTO_CORE.fileName(p.file)&&p.artist&&p.license&&PHOTO_CORE.imageURL(p.remote||p.src)&&!FOOD_PHOTOS.failed.has(PHOTO_CORE.imageURL(p.remote||p.src)));
 return photo?{...photo,src:PHOTO_CORE.imageURL(photo.remote||photo.src),proxy:base&&photo.src===base+'/photo-image?file='+encodeURIComponent(photo.file)?photo.src:'',expiresAt:Number(data.expiresAt)}:null;
}
function foodPhotoMatch(o,h){
 const hp=o.hpId||(/^hotpepper:/.test(bookingID(o))?bookingID(o).slice(10):'');
 if(hp)return h.id===hp;
 if(norm(o.name)!==norm(h.name))return false;
 if(o.addr&&h.address)return TabirouteFoodPhotoCore.address(o.addr)===TabirouteFoodPhotoCore.address(h.address);
 return !!(bookingPoint(o)&&bookingPoint(h)&&hav(o,h)<0.3);
}
async function foodShopPhoto(o){
 const hp=o.hpId||(/^hotpepper:/.test(bookingID(o))?bookingID(o).slice(10):'');
 const known=Object.values(F4.res).flatMap(r=>r.hp||[]).concat(F4.name?.hp||[]),exact=known.filter(h=>foodPhotoMatch(o,{...h,id:h.hpId,address:h.addr}));
 if(exact.length===1&&foodPhotoProvided(exact[0]))return foodPhotoProvided(exact[0]);
 let params;
 if(/^J\d{9}$/.test(hp))params={id:hp};
 else if(bookingPoint(o))params={lat:Number(o.lat).toFixed(5),lng:Number(o.lng).toFixed(5),q:o.name,range:2};
 else if(HP_SA[o.pref||S.pref])params={sa:HP_SA[o.pref||S.pref],q:o.name};
 else return null;
 const j=await BookingAPI.get('/restaurants',params),matches=(j.items||[]).filter(h=>foodPhotoMatch(o,h));
 if(matches.length!==1||!matches[0].photo)return null;
 const h=matches[0],src=bookingSafeURL(h.photo);if(!src||FOOD_PHOTOS.failed.has(src))return null;
 return {src,kind:'shop',label:'店舗写真',credit:'画像提供：ホットペッパー グルメ',page:bookingSafeURL(h.url),expiresAt:j.expiresAt};
}
function foodPhotoInner(key){
 const o=FOOD_PHOTOS.items.get(key)||{},p=foodPhotoChoice(key),r=foodPhotoCached(key);
 if(p){
  const credit=p.artist||p.credit||'',source=p.page?`<a href="${esc(bookingSafeURL(p.page))}" target="_blank" rel="noopener">${esc(credit)}</a>`:esc(credit);
  const license=p.license?` · <a href="${esc(bookingSafeURL(p.licenseURL||p.page))}" target="_blank" rel="noopener">${esc(p.license)}</a>`:'';
  return `<img src="${esc(p.src)}" alt="${esc(o.name+'の'+(p.kind==='restaurant-dish'?'料理写真':'店舗写真'))}" loading="lazy" decoding="async" onerror="foodPhotoBroken(this)"><span class="food-photo-label">${esc(p.label||'店舗写真')}</span><figcaption><details><summary>写真・出典</summary>${source}${license}${p.artist?'<br>過去の写真': ''}${p.changes?'<br>'+esc(p.changes):''}</details></figcaption>`;
 }
 const done=r&&r.until>Date.now(),url='https://www.google.com/search?'+new URLSearchParams({tbm:'isch',q:[o.name,o.addr||o.pref,'料理'].filter(Boolean).join(' ')});
 return `<div class="food-photo-empty">${ICON.img}<span>${done?'写真未取得':'写真を検索中'}</span><a href="${esc(url)}" target="_blank" rel="noopener" aria-label="${esc(o.name+'の料理写真を検索')}">写真を探す</a></div>`;
}
function foodPhotoSlot(o,size){
 const key=foodPhotoKey(o);FOOD_PHOTOS.items.set(key,{...o});
 if(FOOD_PHOTOS.items.size>300){for(const k of FOOD_PHOTOS.items.keys()){if(FOOD_PHOTOS.items.size<=250)break;if(k!==key&&!FOOD_PHOTOS.pending.has(k)&&!document.querySelector(`[data-food-photo="${CSS.escape(k)}"]`)){FOOD_PHOTOS.items.delete(k);FOOD_PHOTOS.results.delete(k);}}}
 return `<figure class="food-photo food-photo-${esc(size)}" data-food-photo="${esc(key)}">${foodPhotoInner(key)}</figure>`;
}
function foodPhotoPaint(key){document.querySelectorAll(`[data-food-photo="${CSS.escape(key)}"]`).forEach(el=>el.innerHTML=foodPhotoInner(key));}
async function foodPhotoLoad(key){
 const o=FOOD_PHOTOS.items.get(key);if(!o)return;
 let best=null,retry=300;
 const publish=p=>{if(!p||FOOD_PHOTOS.failed.has(p.src))return;if(!best||p.kind==='restaurant-dish'){best=p;foodPhotoRemember(key,{photo:best,until:Math.min(best.expiresAt,Date.now()+86400000)});foodPhotoPaint(key);}};
 const catchError=e=>{retry=Math.max(retry,e?.retryAfter||e?.seconds||0);};
 const provided=foodPhotoChoice(key);
 const jobs=[foodRestaurantDish(o).then(publish).catch(catchError)];
 if(!provided)jobs.push(foodShopPhoto(o).then(publish).catch(catchError));
 // Each provider paints immediately; a slow provider cannot delay a faster result.
 await Promise.allSettled(jobs);
 if(!best)foodPhotoRemember(key,{until:Date.now()+Math.min(3600,retry)*1000});
 foodPhotoPaint(key);
}
function foodPhotoRequest(key,force=false){
 if(FOOD_PHOTOS.pending.has(key))return FOOD_PHOTOS.pending.get(key);
 const o=FOOD_PHOTOS.items.get(key);if(!o)return Promise.resolve();
 const p=foodPhotoChoice(key);if(p?.manual||p?.kind==='restaurant-dish')return Promise.resolve();
 if(!force&&foodPhotoCached(key)?.until>Date.now())return Promise.resolve();
 let finish;const job=new Promise(r=>finish=r);FOOD_PHOTOS.pending.set(key,job);FOOD_PHOTOS.queue.push({key,finish});foodPhotoPump();return job;
}
function foodPhotoPump(){while(FOOD_PHOTOS.active<3&&FOOD_PHOTOS.queue.length){const {key,finish}=FOOD_PHOTOS.queue.shift();if(!document.querySelector(`[data-food-photo="${CSS.escape(key)}"]`)){FOOD_PHOTOS.pending.delete(key);finish();continue;}FOOD_PHOTOS.active++;foodPhotoLoad(key).catch(()=>{foodPhotoRemember(key,{until:Date.now()+60000});foodPhotoPaint(key);}).finally(()=>{FOOD_PHOTOS.active--;FOOD_PHOTOS.pending.delete(key);finish();foodPhotoPump();});}}
const foodPhotoObserver=typeof IntersectionObserver==='function'?new IntersectionObserver(entries=>{for(const x of entries)if(x.isIntersecting){foodPhotoObserver.unobserve(x.target);foodPhotoRequest(x.target.dataset.foodPhoto);}}, {rootMargin:'100px'}):null;
const foodOldHydrate=hydrateImages;
hydrateImages=function(){foodOldHydrate();foodPhotoObserver?.disconnect();document.querySelectorAll('[data-food-photo]').forEach(el=>{if(foodPhotoObserver)foodPhotoObserver.observe(el);else foodPhotoRequest(el.dataset.foodPhoto);});};
function foodPhotoBroken(img){
 const key=img.closest('[data-food-photo]')?.dataset.foodPhoto;if(!key)return;
 FOOD_PHOTOS.failed.add(img.getAttribute('src'));
 const current=foodPhotoCached(key),p=current?.photo;
 const backup=p&&[PHOTO_CORE.imageURL(p.remote),p.proxy].find(src=>src&&!FOOD_PHOTOS.failed.has(src));
 if(backup){current.photo={...p,src:backup};foodPhotoRemember(key,current);foodPhotoPaint(key);return;}
 // Stop automatic retry loops. Other verified sources may still complete in the current job.
 foodPhotoRemember(key,{until:Date.now()+60000});foodPhotoPaint(key);
 if(foodPhotoChoice(key)||FOOD_PHOTOS.pending.has(key))return;
 foodPhotoRequest(key,true);
}
const foodOldBookingPhoto=bookingPhoto;
bookingPhoto=function(o,size){return o&&(o.food||o.meal||o.cuisine||bookingID(o).startsWith('hotpepper:'))?foodPhotoSlot(o,size):foodOldBookingPhoto(o,size);};
async function foodPhotoRefresh(id,manual=false){const o=S.wishes.find(w=>w.id===id);if(!o)return;const key=foodPhotoKey(o);FOOD_PHOTOS.items.set(key,{...o});if(manual){FOOD_PHOTOS.results.delete(key);try{sessionStorage.removeItem('tb-shop-photo-v2:'+key);}catch{}for(const src of [o.ownPhoto,o.apiPhoto,bookingMedia(o).url])if(src)FOOD_PHOTOS.failed.delete(src);}await foodPhotoRequest(key,manual);foodPhotoPaint(key);}
