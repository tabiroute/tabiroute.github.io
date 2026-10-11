/* Exact restaurant photos. Never substitute a generic dish or another branch. */
(function(root){'use strict';
const C=root.TabiroutePhotoCore,VERSION='food-photo-v2';
const NOT_FOOD=/外観|店内|店舗|入口|看板|建物|店構え|メニュー表|カップ麺|即席|袋麺|監修|パッケージ|シーサー|\b(?:exterior|interior|facade|entrance|building|sign|menu|instant|packaging|shisa|restaurant)\b/i;
const FOOD=/そば|蕎麦|うどん|ラーメン|らーめん|焼きそば|丼|寿司|すし|鮨|刺身|定食|カレー|餃子|ぎょうざ|おでん|お好み焼|たこ焼|タコライス|ステーキ|ハンバーグ|ハンバーガー|天ぷら|天麩羅|唐揚|焼肉|焼き鳥|やきとり|串カツ|鍋|煮込み|ぜんざい|かき氷|ケーキ|パフェ|ソフトクリーム|料理|食事|\b(?:soba|udon|ramen|noodles?|sushi|sashimi|curry|gyoza|oden|tempura|steak|burger|meal|dish|dessert|cake|parfait|taco\s*rice)\b/i;
function restaurant(o={}){
 const name=C.text(o.name),addr=C.text(o.addr||o.address),pref=C.text(o.pref),city=C.text(o.city);
 if(name.length<2||name.length>160||/[|:#<>\[\]{}"\\]/.test(name))throw C.fail('name_required',0);
 const lat=o.lat==null||o.lat===''?NaN:Number(o.lat),lng=o.lng==null||o.lng===''?NaN:Number(o.lng);
 const geo=Number.isFinite(lat)&&Number.isFinite(lng)&&lat>=20&&lat<=46&&lng>=122&&lng<=154;
 if(!addr&&!geo)throw C.fail('location_required',0);
 if(addr.length>240||pref.length>10||city.length>40)throw C.fail('invalid_request',0);
 return {name,addr,pref,city,...(geo?{lat:+lat.toFixed(5),lng:+lng.toFixed(5)}:{})};
}
// Remove only a descriptive prefix separated by a space. Branch names remain intact.
function searchName(p){return p.name.replace(/^(?:.+?の専門店|手打ちそば)\s+/,'');}
function address(v){return C.text(v).replace(/\s+/g,'').replace(/[‐−－]/g,'-').replace(/丁目|番地|番/g,'-').replace(/号(?=$|[^0-9])/g,'');}
function key(p){return JSON.stringify([VERSION,C.norm(p.name),address(p.addr)||[p.lat,p.lng],p.pref]);}
function photo(page,p){
 const file=C.fileName(page?.title),m=page?.imageinfo?.[0]?.extmetadata||{};
 const caption=C.text(m.ImageDescription?.value),all=file+' '+caption,n=searchName(p);
 if(!C.norm(caption+' '+file).includes(C.norm(n)))return null;
 // An exact street address or camera location is required: prefecture alone is insufficient.
 const addr=address(p.addr),addressMatch=addr.length>=8&&address(caption).includes(addr)&&!/[0-9]/.test(address(caption).split(addr)[1]?.[0]||'');
 const lat=m.GPSLatitude?.value,lng=m.GPSLongitude?.value;
 const near=lat!=null&&lng!=null&&p.lat!=null&&Number.isFinite(+lat)&&Number.isFinite(+lng)&&C.distance(p,{lat:+lat,lng:+lng})<0.3;
 if(!addressMatch&&!near)return null;
 const withoutName=all.split(n).join(' ').replace(/料理店|飲食店|そば屋|蕎麦屋|ラーメン店/g,' ');
 if(NOT_FOOD.test(all)||!FOOD.test(withoutName))return null;
 const found=C.photo(page,{name:n},null);return found?{...found,kind:'restaurant-dish',label:'料理写真',restaurant:p.name}:null;
}
// Independent, bounded lanes keep restaurant lookups from waiting for sightseeing photos.
function transport(options={}){const lanes=[C.transport({...options,gap:400}),C.transport({...options,gap:400})];let next=0;return {api:(...args)=>lanes[next++%lanes.length].api(...args)};}
function resolver({api,store=C.memoryStore(),now=Date.now}={}){
 const flights=new Map();
 async function resolve(input){
  const p=restaurant(input),k=key(p),old=await store.get(k).catch(()=>null);
  if(old?.until>now())return {...old.data,cached:true};
  if(flights.has(k))return flights.get(k);
  const work=(async()=>{
   // One request returns both search matches and licensed image metadata.
   const j=await api('commons',{action:'query',generator:'search',gsrnamespace:'6',gsrlimit:'8',gsrsearch:'"'+searchName(p)+'" filetype:bitmap',prop:'imageinfo',iiprop:'url|extmetadata|mime|size',iiurlwidth:'500'});
   const photos=(j.query?.pages||[]).map(f=>photo(f,p)).filter(Boolean).slice(0,2);
   const data={ok:true,version:VERSION,status:photos.length?'ready':'missing',restaurant:p,photos,fetchedAt:now(),expiresAt:now()+(photos.length?C.DAY:300000)};
   await store.set(k,{data,until:data.expiresAt,staleUntil:data.expiresAt}).catch(()=>{});return data;
  })();flights.set(k,work);try{return await work;}finally{flights.delete(k);}
 }
 return {resolve};
}
root.TabirouteFoodPhotoCore={VERSION,restaurant,searchName,address,key,photo,transport,resolver};
if(typeof module!=='undefined'&&module.exports)module.exports=root.TabirouteFoodPhotoCore;
})(globalThis);
