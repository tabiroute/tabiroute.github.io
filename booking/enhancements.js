/* v7: scoped budgets, preferences, optional cafe and browser handoff. */
PLAN_KEYS.push('foodPreferences','hotelBudget','cafeDays');
function foodPreference(){return {query:'',maxBudget:0,includeUnknown:true,...S.foodPreferences?.[bookingFoodDay()+'|'+bookingFoodSlot()]};}
function hotelPreference(){return {maxBudget:0,includeUnknown:true,...S.hotelBudget?.[S.hotelSplit?bookingNightIndex():'all']};}
function budgetRank(x){return ({within:0,possible:1,unknown:2,over:3})[x.budgetState?.status]??2;}
function parsePriceRange(raw){const s=String(raw||'').normalize('NFKC').replace(/,/g,'').trim(),r=s.match(/(\d+)\s*円?\s*[~〜～\-]\s*(\d+)\s*円?/);if(r)return {low:+r[1],high:+r[2]};const u=s.match(/^[~〜～]\s*(\d+)\s*円/);if(u)return {low:0,high:+u[1]};const l=s.match(/^(\d+)\s*円?\s*[~〜～]/);if(l)return {low:+l[1],high:null};const x=s.match(/^(?:約)?\s*(\d+)\s*円?(?:程度|前後|目安)?$/);return x?{low:+x[1],high:+x[1]}:null;}
function foodPrice(f,slot){const s=String(f.budget||'').normalize('NFKC'),label={昼:'ランチ|昼食|昼',朝:'朝食|モーニング|朝',休憩:'カフェ|スイーツ|お茶',夜:'ディナー|夕食|夜'}[slot],m=s.match(new RegExp('(?:'+label+')[\\s:：]*([^/／;；、]*)'));if(m){const p=parsePriceRange(m[1].split(/ディナー|ランチ|昼食|夕食|朝食|カフェ/)[0].trim());if(p)return p;}if(slot==='夜')return parsePriceRange(f.budgetBand)||parsePriceRange(s);if(slot==='休憩'&&f.genreCode==='G014')return parsePriceRange(s);return null;}
function assessBudget(range,max,minimum=false){if(!max)return {status:'unknown',label:'予算指定なし'};if(!range)return {status:'unknown',label:'この時間帯の料金は未確認'};if(range.low>max)return {status:'over',label:'予算を超える目安'};if(!minimum&&range.high!==null&&range.high<=max)return {status:'within',label:'掲載目安では予算内'};return {status:'possible',label:minimum?'最安値目安は予算以下・指定日の料金は未確認':'予算内で選べるか要確認'};}
const budgetFoodRank=bookingRankFood,budgetHotelRank=bookingRankHotels;
bookingRankFood=function(items,c){const p=foodPreference();return budgetFoodRank(items,c).map(f=>({...f,budgetState:assessBudget(foodPrice(f,c.slot),+p.maxBudget)})).filter(f=>f.budgetState.status!=='over'&&(p.includeUnknown||!p.maxBudget||f.budgetState.status!=='unknown')).sort((a,b)=>budgetRank(a)-budgetRank(b)||a.routeScore-b.routeScore);};
bookingRankHotels=function(items,c){const p=hotelPreference();return budgetHotelRank(items,c).map(h=>({...h,budgetState:assessBudget(h.minCharge>0?{low:h.minCharge,high:null}:null,+p.maxBudget,true)})).filter(h=>h.budgetState.status!=='over'&&(p.includeUnknown||!p.maxBudget||h.budgetState.status!=='unknown')).sort((a,b)=>budgetRank(a)-budgetRank(b)||a.routeDistance-b.routeDistance);};
// 予算は「選ぶだけ」の小さな欄にする（食事は時間帯ごと、宿は1部屋1泊）
const BUDGET_STEPS={朝:[800,1000,1500,2000],昼:[1000,1500,2000,3000,5000],休憩:[800,1000,1500,2000,3000],夜:[2000,3000,5000,8000,10000,15000],hotel:[8000,10000,15000,20000,30000,50000]};
function budgetSelect(kind,slot){const p=kind==='food'?foodPreference():hotelPreference(),v=+p.maxBudget>0?Math.round(+p.maxBudget):0,steps=[...BUDGET_STEPS[kind==='food'?slot:'hotel']];if(v&&!steps.includes(v))steps.push(v);steps.sort((a,b)=>a-b);
 return `<select data-budget="${kind}" data-budget-field="maxBudget" aria-label="${kind==='food'?'1人あたりの予算':'1部屋1泊の予算'}"><option value="0">予算 指定なし</option>${steps.map(n=>`<option value="${n}" ${n===v?'selected':''}>〜${n.toLocaleString()}円</option>`).join('')}</select>`;}
function budgetUnknownCheck(kind){const p=kind==='food'?foodPreference():hotelPreference();return `<label class="pref-check"><input type="checkbox" data-budget="${kind}" data-budget-field="includeUnknown" ${p.includeUnknown?'checked':''}>料金がわからない${kind==='food'?'お店':'宿'}も表示</label>`;}
function budgetEditor(kind){return `<div class="pref-bar"><div class="pref-row"><span class="pref-label">1部屋1泊の予算</span>${budgetSelect(kind)}${budgetUnknownCheck(kind)}</div></div>`;}
function budgetBadge(o,kind){return `<p class="budget-status">${esc(o.budgetState?.label||'料金条件を確認してください')}${kind==='hotel'&&o.minCharge?`<br>掲載最安値目安 ${Number(o.minCharge).toLocaleString()}円／部屋・泊`:''}</p>`;}
const budgetFoodCard=bookingFoodResultCard;bookingFoodResultCard=function(f,i,c){return budgetFoodCard(f,i,c).replace('<div class="booking-actions">',budgetBadge(f,'food')+'<div class="booking-actions">');};
const budgetHotelCard=bookingHotelCard;bookingHotelCard=function(h,i){return budgetHotelCard(h,i).replace('<div class="booking-actions">',budgetBadge(h,'hotel')+'<div class="booking-actions">');};
function foodDecision(){const m=bookingMealDecision();return m==='direction'?'undecided':m;}
stepFood=function(){const c=bookingMealContext(),mode=foodDecision(),p=foodPreference(),picked=bookingMealPicked(c),cafe=c.slot==='休憩';
let h=`<section class="panel booking-panel"><div class="eyebrow">STEP 6 / 8 · FOOD & CAFE</div><h1 class="q">${cafe?'観光の合間に、カフェでひと休み':'お店は決まっていますか？'}</h1>${bookingDaySelect()}${cafe?`<p class="note">昼食と夕食の間、15時頃に45分の休憩を入れます。予約・営業時間を優先します。</p><label class="budget-check"><input type="checkbox" data-cafe-enable ${S.cafeDays?.[c.di]?'checked':''}>${c.di+1}日目にカフェ・スイーツ休憩を入れる</label>`:''}<div class="food-choices two">${[['decided','決まっている','店名で探して登録','ic-food-decided.png'],['undecided','まだ決まっていない','希望と予算から選ぶ','ic-food-undecided.png']].map(([v,l,n,img])=>`<button type="button" class="choice" data-route-food="${v}" aria-pressed="${mode===v}"><img src="img/${img}" alt="" width="60" height="60"><b>${l}</b><span>${n}</span></button>`).join('')}</div>`;
if(picked.length)h+=`<div class="booking-selected"><b>${c.di+1}日目の${MEALNAME[c.slot]}</b>${picked.map(w=>`<p>${esc(w.name)} <button class="linkbtn" data-delwish="${esc(w.id)}">外す</button></p>`).join('')}</div>`;
if(!mode)return h+'<p class="note">食事やカフェは、あとから決めることもできます。</p></section>';
if(mode==='decided')h+=`<form id="routeFoodSearch" class="booking-search"><label>決まっている店名<input id="routeFoodQuery" name="query" maxlength="80" value="${esc(p.query)}" placeholder="店名・支店名"></label><button class="btn primary">お店を探す</button></form><details class="booking-manual"><summary>お店を手入力で登録</summary><label>店名<input id="routeFoodName"></label><label>緯度・経度<input id="routeFoodCoords" placeholder="34.9858, 135.7588"></label><button class="btn" data-route-manual-food>この食事に登録</button></details>`;
else{const dishes=cafe?['カフェ','パフェ','ケーキ','抹茶','コーヒー']:c.foods;
 h+=`${bookingRouteHTML(c)}<form id="foodPreferenceSearch" class="pref-bar"><div class="pref-row"><label class="pref-q"><span class="sr-only">食べたいもの</span><input name="query" data-food-query maxlength="80" value="${esc(p.query)}" placeholder="${cafe?'食べたいもの（例：パフェ）':'食べたいもの（例：黒豚・寿司）'}"></label>${budgetSelect('food',c.slot)}<button class="btn primary small" ${ROUTE_UI.foodBusy?'disabled':''}>${ROUTE_UI.foodBusy?'検索中…':'探す'}</button></div>${dishes.length?`<div class="pref-chips"><span>${cafe?'人気':'ご当地'}</span>${dishes.slice(0,8).map(x=>`<button type="button" class="chip" data-route-dish="${esc(x)}">${esc(x)}</button>`).join('')}</div>`:''}${budgetUnknownCheck('food')}<p class="pref-hint">空欄のまま「探す」で、観光ルートの近くのお店を出します。予算は${esc(MEALNAME[c.slot])}の掲載目安（1人）で比べます。</p></form>`;}
const fq=[c.city,(ROUTE_UI.food?.key===bookingMealKey(c)?ROUTE_UI.food.query:p.query)||(cafe?'カフェ':'')].filter(Boolean).join(' ');
return h+bookingFoodResults(c)+plannerCompareHTML('food')+`<div class="booking-fallback"><p>お店の情報が取得できないときも、食事はあとから決められます。</p><a class="btn ghost" href="${esc(hpSearchURL(fq,c.pref,cafe?'G014':''))}" target="_blank" rel="noopener">ホットペッパーで探す</a></div>`+'<p class="note">アレルギー対応は店舗で確認してください。</p></section>';};
const budgetHotelUI=stepHotel;stepHotel=function(){const h=budgetHotelUI();if(!nNights()||bookingStayDecision()!=='undecided')return h;return h.replace('<button type="button" class="btn primary" data-route-refresh-stay',budgetEditor('hotel')+'<button type="button" class="btn primary" data-route-refresh-stay');};
function storeFoodQuery(q){const k=bookingFoodDay()+'|'+bookingFoodSlot();S.foodPreferences={...S.foodPreferences,[k]:{...foodPreference(),query:String(q||'').trim().slice(0,80)}};}
/* 食べたいものの検索。
   ホットペッパーのキーワードは「全部の語に一致するお店」だけを返すため、「抹茶スイーツ」「鹿児島ラーメン」では0件になりやすい。
   ①そのままの言葉 → ②言葉を分けて（抹茶／スイーツ、ラーメン）→ ③料理のジャンル（カフェ・スイーツ、ラーメン）の順に広げ、
   場所も「食事の前後の観光地」と「その間」で探して、まとめて並べる。 */
const FOOD_GENRES=[[/ラーメン|らーめん|拉麺|つけ麺|つけめん/,'G013'],[/スイーツ|カフェ|パフェ|ケーキ|抹茶|甘味|和菓子|かき氷|珈琲|コーヒー|パンケーキ|ぜんざい|団子|だんご|白熊|しろくま|パン/,'G014'],[/焼肉|ホルモン|ジンギスカン/,'G008'],[/お好み焼き|もんじゃ|たこ焼き/,'G016'],[/中華|餃子|ぎょうざ|ちゃんぽん|皿うどん|担々麺|小籠包/,'G007'],[/イタリアン|パスタ|ピザ|フレンチ/,'G006'],[/洋食|ハンバーグ|オムライス|ステーキ|ハンバーガー/,'G005'],[/韓国/,'G017'],[/カレー|エスニック|タイ料理|ベトナム/,'G009'],[/居酒屋|酒場|焼き鳥|焼鳥|もつ鍋/,'G001'],[/和食|寿司|すし|鮨|そば|蕎麦|うどん|天ぷら|天麩羅|とんかつ|うなぎ|鰻|海鮮|刺身|定食|おばんざい|湯豆腐|豆腐|懐石|割烹|しゃぶしゃぶ|すき焼き|黒豚|鶏飯|牛タン|ふぐ|かに|蟹|郷土料理|丼|地鶏|さつま揚げ/,'G004']];
const FOOD_WORDS=['ラーメン','つけ麺','スイーツ','抹茶','カフェ','パフェ','ケーキ','和菓子','かき氷','白熊','焼肉','ホルモン','ジンギスカン','お好み焼き','もんじゃ','たこ焼き','餃子','ちゃんぽん','皿うどん','寿司','鮨','そば','蕎麦','うどん','天ぷら','とんかつ','黒豚','うなぎ','海鮮','刺身','定食','おばんざい','湯豆腐','しゃぶしゃぶ','すき焼き','鶏飯','牛タン','カレー','ステーキ','ハンバーグ','焼き鳥','居酒屋','郷土料理','さつま揚げ','地鶏','もつ鍋','ふぐ','かに','丼'];
function foodQueryPlan(q,c){
 const raw=String(q||'').normalize('NFKC').replace(/\s+/g,' ').trim();if(!raw)return [];
 const out=[],add=(q,genre,tier)=>{if(!out.some(x=>x.q===q&&x.genre===genre))out.push({q,genre,tier});};
 add(raw,'',0);
 // 地名（鹿児島ラーメン・京ラーメンの「鹿児島」「京」）を外し、料理の言葉ごとに分ける
 const places=[...new Set([...tripPrefs(),c.pref].filter(Boolean).flatMap(p=>[p,p.replace(/[都道府県]$/,'')]).concat(c.city?[c.city,c.city.replace(/[市区町村]$/,'')]:[],'京'))].filter(x=>x.length>=1).sort((a,b)=>b.length-a.length);
 let rest=raw;for(const p of places)if(rest.startsWith(p)&&rest.length>p.length){rest=rest.slice(p.length).trim();break;}
 const words=FOOD_WORDS.filter(w=>rest.includes(w)).sort((a,b)=>rest.indexOf(a)-rest.indexOf(b));
 if(rest!==raw)add(rest,'',1);
 for(const w of words.slice(0,3))add(w,'',1);
 const g=FOOD_GENRES.find(([re])=>re.test(raw));if(g)add('',g[1],2);
 return out;
}
function foodPoints(c){const pts=[];for(const p of [c.center,c.before,c.after])if(p&&Number.isFinite(+p.lat)&&Number.isFinite(+p.lng)&&!pts.some(x=>hav(x,p)<1.2))pts.push({lat:+p.lat,lng:+p.lng});return pts.slice(0,3);}
async function foodSearchAll(c,query,exact){
 const cafe=c.slot==='休憩',pts=foodPoints(c),plan=query?(exact?[{q:String(query).trim(),genre:'',tier:0}]:foodQueryPlan(query,c)):[{q:'',genre:'',tier:0}],found=new Map();let calls=0,lastErr=null,ok=0,expires=Infinity;
 const run=async(v,pt)=>{if(calls>=6)return;calls++;try{const j=await BookingAPI.get('/restaurants',{lat:pt.lat.toFixed(5),lng:pt.lng.toFixed(5),...(v.q?{q:v.q}:{}),...(v.genre?{genre:v.genre}:cafe?{cafe:1}:{})});ok++;expires=Math.min(expires,j.expiresAt||Infinity);
   for(const h of j.items||[]){if(v.genre&&h.genreCode&&h.genreCode!==v.genre)continue; // 古い Worker はジャンル指定を受け付けないので、ここでも絞る
    const f={...bookingToFood(h,j,c.center),pref:c.pref,matchTier:v.tier,matchedBy:v.q||v.genre},old=found.get(f.providerId);if(!old||old.matchTier>f.matchTier)found.set(f.providerId,f);}}
  catch(e){lastErr=e;if(/limit|cooldown/.test(e.code||''))calls=99;}};
 // 段階ごとに探し、十分な数（8件）がそろったら止める（問い合わせは最大6回。まず観光ルートの中心で探し、少ないときだけ前後の場所でも探す）
 const t0=plan.filter(v=>v.tier===0),t1=plan.filter(v=>v.tier===1).slice(0,2),t2=plan.filter(v=>v.tier===2),[c0,...others]=pts;
 const stages=[t0.map(v=>[v,c0]),[...t1,...t2].map(v=>[v,c0]),others.flatMap(pt=>t0.map(v=>[v,pt])),others.flatMap(pt=>[...t1.slice(0,1),...t2].map(v=>[v,pt]))];
 for(const st of stages){if(!st.length||!c0)continue;await Promise.all(st.map(([v,pt])=>run(v,pt)));if(found.size>=8||calls>=6)break;}
 if(!ok&&lastErr)throw lastErr;
 return {items:[...found.values()],expiresAt:Number.isFinite(expires)?expires:Date.now()+600000,plan};
}
bookingRouteFoodSearch=async function(query){if(query===undefined)query=foodPreference().query;storeFoodQuery(query);if(bookingFoodSlot()==='休憩')S.cafeDays={...S.cafeDays,[bookingFoodDay()]:true};const c=bookingMealContext(),key=bookingMealKey(c),state=S,pid=APP.pid,seq=++ROUTE_UI.foodSeq;ROUTE_UI.foodBusy=true;ROUTE_UI.food={key,query,items:[],message:''};save();render();
 try{const r=await foodSearchAll(c,query,bookingMealDecision()==='decided');   // 店名が決まっているときは、その名前だけで探す
 if(S!==state||APP.pid!==pid||seq!==ROUTE_UI.foodSeq||bookingMealKey()!==key)return;
  const items=bookingRankFood(r.items,c).sort((a,b)=>(a.matchTier||0)-(b.matchTier||0)||budgetRank(a)-budgetRank(b)||a.routeScore-b.routeScore);
  const exact=items.filter(x=>!x.matchTier).length,words=[...new Set(items.filter(x=>x.matchTier).map(x=>x.matchedBy).filter(x=>!/^G0/.test(x)))];
  const msg=!items.length?(query?`「${query}」のお店は、観光ルートの近くでは見つかりませんでした。言葉を短くするか、下の「ホットペッパーで探す」をお試しください。`:'観光ルートの近くでは見つかりませんでした。下の「ホットペッパーで探す」をお試しください。')
   :query&&!exact?`「${query}」そのものは見つからなかったため、${words.length?'「'+words.join('」「')+'」や':''}同じジャンルのお店を出しています。`
   :`${c.di+1}日目の${MEALNAME[c.slot]}：観光の前後から行きやすい順です。`;
  ROUTE_UI.food={key,query,items,expiresAt:r.expiresAt,message:msg};}
 catch(e){if(S===state&&seq===ROUTE_UI.foodSeq)ROUTE_UI.food={key,query,items:[],message:bookingMessage(e)};}
 finally{if(S===state&&seq===ROUTE_UI.foodSeq){ROUTE_UI.foodBusy=false;render();}}
 if(S===state&&seq===ROUTE_UI.foodSeq&&S.step===5&&ROUTE_UI.food?.items.length)await plannerCompare('food');};
const foodPutV6=bookingPutFood;bookingPutFood=function(f,c){if(bookingMealPicked(c).some(w=>plannerRule(w.id).fixed))return toast('予約済みの食事です。予約の設定を解除してから変更してください。');if(c.slot==='休憩')S.cafeDays={...S.cafeDays,[c.di]:true};S.mealOmissions={...S.mealOmissions,[c.di+'|'+c.slot]:false};foodPutV6(f,c);};
document.addEventListener('change',e=>{const t=e.target;if(t.dataset.budget){const kind=t.dataset.budget,k=t.dataset.budgetField,p=kind==='food'?foodPreference():hotelPreference();p[k]=k==='includeUnknown'?t.checked:Math.max(0,Math.min(1000000,Math.round(+t.value||0)));if(kind==='food'){S.foodPreferences={...S.foodPreferences,[bookingFoodDay()+'|'+bookingFoodSlot()]:p};bookingResetFoodRequest();}else{S.hotelBudget={...S.hotelBudget,[S.hotelSplit?bookingNightIndex():'all']:p};bookingResetHotelRequest();}save();render();}if(t.hasAttribute('data-cafe-enable')){const di=bookingFoodDay(),picked=bookingMealPicked(bookingMealContext());if(!t.checked&&picked.some(w=>plannerRule(w.id).fixed)){t.checked=true;return toast('予約済みのカフェです。予約の設定を解除してから外してください。');}if(!t.checked){S.wishes=S.wishes.filter(w=>!picked.includes(w));for(const w of picked)if(S.dayOf)delete S.dayOf[w.id];for(const k of Object.keys(S.manualOrd||{}))S.manualOrd[k]=S.manualOrd[k].filter(id=>!picked.some(w=>w.id===id));}S.cafeDays={...S.cafeDays,[di]:t.checked};S.mealOmissions={...S.mealOmissions,[di+'|休憩']:!t.checked};bookingRouteMemo=null;save();render();}});
document.addEventListener('input',e=>{if(e.target.hasAttribute('data-food-query')){storeFoodQuery(e.target.value);save();}});
document.addEventListener('submit',e=>{if(e.target.id==='foodPreferenceSearch'){e.preventDefault();bookingRouteFoodSearch(new FormData(e.target).get('query')||'');}});
document.addEventListener('click',e=>{if(e.target.closest('[data-budget-search-hotel]'))bookingRouteHotelSearch(bookingStayDecision()==='decided'?(DRAFT.routeHotelQuery||S.hotelName||''):'');});
function externalBrowserURL(raw=location.href){const u=new URL(raw,location.href);u.searchParams.set('openExternalBrowser','1');return u.href;}
const inviteV6=inviteUrl;inviteUrl=function(pid){return externalBrowserURL(inviteV6(pid));};
const authV6=authAction;authAction=async function(kind){if(kind!=='gLogin'||!/\bLine\//i.test(navigator.userAgent))return authV6(kind);const u=externalBrowserURL(),modal=document.querySelector('#modal');modal.innerHTML=`<div class="sheet external-login" role="dialog" aria-modal="true" aria-labelledby="externalLoginTitle"><button class="close" data-close="1" aria-label="閉じる">×</button><h2 id="externalLoginTitle">GoogleログインはSafari・Chromeで</h2><p>LINE内ではGoogleログインが利用できません。外部ブラウザで旅行のリンクを開き、もう一度Googleログインを押してください。</p><a class="btn primary" href="${esc(u)}" target="_blank" rel="noopener">Safari・Chromeで開く</a><p class="note">開かない場合はLINEのメニューから「ブラウザで開く」を選ぶか、リンクをコピーしてください。共有リンクの旅行はそのまま開けます。このブラウザだけに保存した旅行やゲストのログイン状態は自動では移りません。</p><textarea readonly aria-label="外部ブラウザ用リンク">${esc(u)}</textarea><button class="btn" data-copy-external>リンクをコピー</button><p role="status" id="externalLoginStatus"></p></div>`;modal.hidden=false;};
document.addEventListener('click',async e=>{if(!e.target.closest('[data-copy-external]'))return;const input=document.querySelector('.external-login textarea'),msg=document.querySelector('#externalLoginStatus');try{await navigator.clipboard.writeText(input.value);msg.textContent='コピーしました。Safari・Chromeに貼り付けてください。';}catch(err){input.focus();input.select();msg.textContent='リンクを選択しました。長押ししてコピーしてください。';}});
function approvedAffiliateURL(raw,hosts){try{const u=new URL(raw);return u.protocol==='https:'&&!u.username&&!u.password&&hosts.includes(u.hostname)?u.href:'';}catch(e){return '';}}
const rentV6=rentURLs;rentURLs=function(place){const a=window.TABIROUTE_AFFILIATES||{},r=approvedAffiliateURL(a.rakutenCarURL,['hb.afl.rakuten.co.jp']),j=approvedAffiliateURL(a.jalanCarURL,['ck.jp.ap.valuecommerce.com']);return [[r?'楽天レンタカー【広告】':'楽天トラベル レンタカー',r||'https://travel.rakuten.co.jp/cars/'],[j?'じゃらんレンタカー【広告】':'じゃらんレンタカー',j||'https://www.jalan.net/rentacar/'],...rentV6(place).filter(x=>!/楽天|じゃらん/.test(x[0]))];};
