/* v8: bundled verified photos first; identity-aware discovery for other attractions. */
let photoQueue=Promise.resolve(),photoPauseUntil=0,photoLastAt=0;
function photoGet(url){const job=photoQueue.then(async()=>{if(Date.now()<photoPauseUntil)throw Error('Photo service cooldown');const delay=Math.max(0,300-(Date.now()-photoLastAt));if(delay)await new Promise(r=>setTimeout(r,delay));photoLastAt=Date.now();try{return await jget(url);}catch(e){if(/429|503/.test(e.message))photoPauseUntil=Date.now()+60000;throw e;}});photoQueue=job.catch(()=>{});return job;}
const PHOTO_REJECT=/噴煙|噴火|案内板|銘板|説明板|看板|地図|配置図|平面図|路線図|古写真|絵葉書|絵はがき|浮世絵|肖像|モノクロ|eruption|smoke|ash[ _-]*cloud|steam[ _-]*plume|signboard|information[ _-]*board|close[ _-]*up|detail[ _-]*of|portraits?|postcards?|engravings?|lithographs?|monochrome|black[ _-]*and[ _-]*white|floor[ _-]*plan|\b(?:maps?|logos?|flags?|diagrams?|paintings?|drawings?|illustrations?)\b/i;
const PHOTO_WIDE=/全景|遠景|全体|外観|正面|正門|庭園|境内|本堂|本殿|風景|panoram|overall|exterior|facade|landscape|general[ _-]*view/i;
const attractionArticleCache=new Map();
function attractionText(x){return String(x||'').normalize('NFKC').replace(/<[^>]*>/g,' ').replace(/[_\s]+/g,' ').trim();}
function attractionCore(x){return attractionText(x).normalize('NFKD').replace(/[\u0300-\u036f]/g,'').normalize('NFKC').toLowerCase().replace(/[\s・ー‐\-（）()]/g,'');}
titleCands=function(name){const n=attractionText(name),b=n.replace(/（.*?）|\(.*?\)/g,'').trim(),parts=b.split(/\s+/),inside=n.match(/[（(]([^）)]+)[）)]/);return [...new Set([n,b,parts.length>1?parts.slice(1).join(' '):'',inside?.[1]].filter(x=>x&&x.length>=2))];};
function explicitWiki(o){let w=String(o.extra?.wiki||o.extra?.wikipedia||'').trim();if(w.startsWith('https://ja.wikipedia.org/wiki/')){try{w=decodeURIComponent(w.split('/wiki/')[1]).split('#')[0];}catch{return '';}}else if(w.startsWith('ja:'))w=w.slice(3);else if(/[:/]/.test(w))return '';return attractionText(w);}
function attractionTitles(o){return [...new Set([explicitWiki(o),...titleCands(o.name)].filter(Boolean))];}
function attractionNames(o,p){return [...new Set([...attractionTitles(o),p?.title,...(p?.langlinks||[]).map(x=>x.title)].filter(Boolean))];}
function attractionNameIn(text,names){const t=attractionCore(text);return names.some(n=>{const k=attractionCore(n);return k.length>=2&&t.includes(k);});}
function attractionPosition(o,p){if(!p||p.missing||Object.prototype.hasOwnProperty.call(p.pageprops||{},'disambiguation'))return false;const c=p.coordinates?.[0];if(c)return !!bookingPoint(o)&&hav(o,{lat:c.lat,lng:c.lon})<(/山|湖|島|渓谷|渓流|国立公園/.test(o.name)?12:3);return !!explicitWiki(o)&&attractionCore(explicitWiki(o))===attractionCore(p.title);}
function attractionPhotoScore(p,o,article){
 const ii=p.imageinfo?.[0];if(!ii||!/^image\/(jpeg|png|webp)$/.test(ii.mime||'')||ii.width<400||ii.height<250)return null;
 const ratio=ii.width/ii.height;if(ratio<0.45||ratio>4)return null;
 const m=ii.extmetadata||{},caption=attractionText(m.ImageDescription?.value),text=attractionText(p.title+' '+caption),file=p.title.replace(/^(?:File|ファイル):/i,'');
 // Categories describe the entire subject (e.g. volcanoes), not necessarily this photo.
 const from=caption.match(/(.{1,50})から(?:見た|望む)/);if(from&&!/展望|山|岬|峠/.test(o.name)&&attractionNameIn(from[1],[o.name]))return null;
 const primary=attractionCore(file)===attractionCore(article?.pageimage);
 if(BADIMG.test(p.title)||OLDIMG.test(p.title)||PHOTO_REJECT.test(text)||(!primary&&!attractionNameIn(text,attractionNames(o,article))))return null;
 return {file,...fromInfo(ii,p.title,false),score:(PHOTO_WIDE.test(text)?20:0)+(primary?12:0)+(ratio>=1.3&&ratio<=2.3?3:0)+Math.min(4,ii.width/1000),contain:ratio<1.1,lazyCredit:false,policy:8};
}
async function attractionCandidates(o,article){
 let names=[article.pageimage,...(article.images||[]).map(x=>x.title.replace(/^(?:File|ファイル):/i,''))].filter(Boolean);
 const read=async files=>{if(!files.length)return [];const j=await photoGet(CM+'action=query&prop=imageinfo&iiprop=url|extmetadata|mime|size&iiurlwidth=500&titles='+enc(files.map(n=>'File:'+n).join('|')));return (j.query?.pages||[]).map(p=>attractionPhotoScore(p,o,article)).filter(Boolean).sort((a,b)=>b.score-a.score);};
 // A verified lead image needs only one metadata request. Alternatives are a fallback.
 if(article.pageimage){const lead=await read([article.pageimage]);if(lead.length)return lead;}
 if(names.length<2){const j=await photoGet(WP+'action=query&prop=images&imlimit=40&titles='+enc(article.title));names.push(...(j.query?.pages?.[0]?.images||[]).map(x=>x.title.replace(/^(?:File|ファイル):/i,'')));}
 names=[...new Set(names)].filter(x=>x!==article.pageimage&&/\.(jpe?g|png|webp)$/i.test(x)&&!BADIMG.test(x)&&!OLDIMG.test(x)).sort((a,b)=>((attractionNameIn(b,attractionNames(o,article))?20:0)+(PHOTO_WIDE.test(b)?10:0))-((attractionNameIn(a,attractionNames(o,article))?20:0)+(PHOTO_WIDE.test(a)?10:0))).slice(0,6);
 return read(names);
}
async function attractionArticles(items){
 if(!items.length)return;
 const titles=[...new Set(items.flatMap(x=>attractionTitles(x.o)))],pages={};
 for(let i=0;i<titles.length;i+=40){const chunk=titles.slice(i,i+40),j=await photoGet(WP+'action=query&redirects=1&prop=pageimages|coordinates|langlinks|pageprops&ppprop=disambiguation&piprop=name&pilicense=free&pilimit=50&colimit=50&lllang=en&lllimit=50&titles='+enc(chunk.join('|'))),q=j.query||{},map={};chunk.forEach(t=>map[t]=t);for(const x of [...(q.normalized||[]),...(q.redirects||[])])for(const t of Object.keys(map))if(map[t]===x.from)map[t]=x.to;const byTitle=Object.fromEntries((q.pages||[]).filter(p=>!p.missing).map(p=>[p.title,p]));chunk.forEach(t=>{if(byTitle[map[t]])pages[t]=byTitle[map[t]];});}
 for(const {k,o} of items)attractionArticleCache.set(k,attractionTitles(o).map(t=>pages[t]).find(p=>attractionPosition(o,p))||null);
}
async function attractionSearch(o){
 // Resolve disambiguated article names; location and a full name still must match.
 const query=titleCands(o.name).at(-1)||o.name;
 const j=await photoGet(WP+'action=query&generator=search&gsrnamespace=0&gsrlimit=5&gsrsearch='+enc(query)+'&prop=pageimages|coordinates|langlinks|pageprops&ppprop=disambiguation&piprop=name&pilicense=free&colimit=50&lllang=en&lllimit=50');
 return (j.query?.pages||[]).find(p=>attractionPosition(o,p)&&attractionTitles(o).some(t=>attractionCore(p.title.replace(/\s*[（(].*?[）)]/g,''))===attractionCore(t)))||null;
}
function curatedAttraction(o){
 if(!o||o.food||o.hotel||!bookingPoint(o))return null;
 const hit=(window.TABIROUTE_PHOTO_CATALOG||[]).find(p=>p.names.some(n=>attractionCore(n)===attractionCore(o.name))&&hav(o,p)<p.radius);
 if(hit)return {...hit,src:new URL(hit.src,document.baseURI).href,policy:8,lazyCredit:false,local:true};
 return norm(o.name)==='桜島'&&hav(o,{lat:31.585,lng:130.657})<12?{file:'Sakurajima -城山展望台より.jpg',src:new URL('booking/assets/sakurajima.jpg',document.baseURI).href,artist:'こたつむり / 露出調整 Nkon21',license:'CC BY-SA 2.1 JP',page:'https://commons.wikimedia.org/wiki/File:Sakurajima_-%E5%9F%8E%E5%B1%B1%E5%B1%95%E6%9C%9B%E5%8F%B0%E3%82%88%E3%82%8A.jpg',policy:8,local:true,lazyCredit:false}:null;
}
// Render bundled photos synchronously: no search queue, API quota or negative cache dependency.
const attractionSlot=imgSlot;imgSlot=function(o,size){const c=curatedAttraction(o);if(c)IMG[imgKey(o)]=c;return attractionSlot(o,size);};
runBatch=async function(){const keys=[...batchQ];batchQ.clear();if(!keys.length)return;const items=[];for(const k of keys){const o=IMGREG[k],c=curatedAttraction(o);if(c){IMG[k]=c;delete imgWait[k];paintKey(k);}else if(o&&!o.food&&!o.hotel)items.push({k,o});}try{await attractionArticles(items);}catch(e){}for(const k of keys)if(!curatedAttraction(IMGREG[k]))imgQueue.push(k);pumpImg();};
findImage=async function(o){if(!o||o.food||o.hotel)return {none:true,t:Date.now()};const c=curatedAttraction(o);if(c)return c;try{const k=imgKey(o);if(!attractionArticleCache.has(k))await attractionArticles([{k,o}]);let article=attractionArticleCache.get(k);if(!article){article=await attractionSearch(o);attractionArticleCache.set(k,article);}if(!article)return {none:true,t:Date.now(),unverified:true};const list=await attractionCandidates(o,article);return list.length?{...list[0],alts:list.map(r=>({...r})),ai:0}:{none:true,t:Date.now(),unverified:true};}catch(e){return {none:true,t:Date.now(),err:true};}};
altPhotos=async function(k){const o=IMGREG[k];if(!o||o.food||o.hotel||curatedAttraction(o))return [];let article=attractionArticleCache.get(k);if(!article)return (await findImage(o))?.alts||[];return attractionCandidates(o,{...article,pageimage:null});};
nextPhoto=async function(k){const list=await altPhotos(k);if(!list.length){toast('この場所の写真として確認できる別の写真が見つかりませんでした');return;}const i=((IMG[k]?.ai??-1)+1)%list.length;IMG[k]={...list[i],alts:list,ai:i,near:false};imgSave();paintKey(k);};
const attractionInner=phInner;phInner=function(k,size){const r=IMG[k];let html=attractionInner(k,size).replace('<img ',IMG[k]?.contain?'<img style="object-fit:contain;background:#edf2f5" ':'<img ').replace('写真が見つかりませんでした',IMG[k]?.unverified?'この観光地の写真は未確認です':'写真が見つかりませんでした');if(r?.local&&r.src&&!/^(sm|thumb|nearcard)$/.test(size))html+=`<a class="photo-source" href="${esc(r.page)}" target="_blank" rel="noopener" style="position:absolute;bottom:4px;left:5px;right:5px;width:fit-content;max-width:calc(100% - 10px);padding:2px 5px;border-radius:4px;background:rgba(0,0,0,.65);color:white;font-size:9px;line-height:1.4;z-index:2" title="写真の出典・利用条件（縮小・再圧縮済み）">写真：${esc(r.artist)} · ${esc(r.license)}</a>`;return html;};
const attractionRetry=retryImages;retryImages=function(){attractionArticleCache.clear();photoPauseUntil=0;attractionRetry();};
