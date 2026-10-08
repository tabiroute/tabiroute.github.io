/* Classic script: loaded after the existing app definitions and before boot(). */
const BOOKING_CFG=window.TABIROUTE_BOOKING||{};
const BOOKING_UI={hotelsBusy:false,hotelMessage:'',availability:{},foodMessage:'',seq:0};
const BOOKING_CREDIT_HP='Powered by <a href="http://webservice.recruit.co.jp/">ホットペッパーグルメ Webサービス</a>';
const BOOKING_CREDIT_RK='<a href="https://webservice.rakuten.co.jp/" target="_blank" rel="noopener"><img src="https://webservice.rakuten.co.jp/img/credit/200709/credit_22121.gif" width="221" height="21" alt="Rakuten Web Service Center"></a>';
PLAN_KEYS.push('booking','bookingNight');
const BookingAPI=(()=>{
  const pending=new Map(),memory=new Map();
  const read=k=>{try{return JSON.parse(sessionStorage.getItem('tb-api-'+k)||'null')}catch{return null}};
  const write=(k,v)=>{try{sessionStorage.setItem('tb-api-'+k,JSON.stringify(v))}catch{}};
  function base(){try{const u=new URL(BOOKING_CFG.apiBase);return BOOKING_CFG.enabled!==false&&(u.protocol==='https:'||(['localhost','127.0.0.1'].includes(u.hostname)&&u.protocol==='http:'))?u.href.replace(/\/$/,''):'';}catch{return '';}}
  function error(code,seconds=0){return Object.assign(new Error(code),{code,seconds});}
  async function get(path,params){
    const root=base();if(!root)throw error('not_configured');
    const provider=path==='/restaurants'?'hotpepper':'rakuten';const scope=root+'|'+provider;
    const url=root+path+'?'+new URLSearchParams(params);const cached=memory.get(url)||read('cache-v7-'+url);
    if(cached?.expiresAt>Date.now()){memory.set(url,cached);return {...cached,cached:true};}
    const until=read('pause-'+scope)||0;if(until>Date.now())throw error('cooldown',Math.ceil((until-Date.now())/1000));
    if(pending.has(url))return pending.get(url);
    const task=(async()=>{
      let quota=read('usage-'+root)||{start:Date.now(),count:0};if(Date.now()-quota.start>=3600000)quota={start:Date.now(),count:0};
      if(quota.count>=150)throw error('session_limit',Math.ceil((quota.start+3600000-Date.now())/1000));quota.count++;write('usage-'+root,quota);
      let r,j;
      try{r=await fetch(url,{credentials:'omit',signal:AbortSignal.timeout(12000)});}
      catch{write('pause-'+scope,Date.now()+300000);throw error('network',300);}
      try{j=await r.json();}catch{write('pause-'+scope,Date.now()+300000);throw error(r.status===429?'provider_limited':'network',300);}
      if(!r.ok||j.ok!==true){const seconds=Math.min(3600,Math.max(60,[j.retryAfter,r.headers.get('Retry-After')].map(Number).find(n=>Number.isFinite(n)&&n>0)||300));if((r.status>=500||r.status===429||r.status===403)&&j.code!=='booking_links_not_configured')write('pause-'+scope,Date.now()+seconds*1000);throw error(j.code||'unavailable',seconds);}
      if(!Array.isArray(j.items)||!Number.isFinite(j.expiresAt))throw error('unavailable');
      for(const[k,v]of memory)if(v.expiresAt<=Date.now())memory.delete(k);if(memory.size>=35)memory.delete(memory.keys().next().value);memory.set(url,j);write('cache-v7-'+url,j);
      // Keep the tab cache bounded and remove expired API data, including Recruit data.
      try{const keys=Object.keys(sessionStorage).filter(k=>k.startsWith('tb-api-cache-'));for(const k of keys){const v=JSON.parse(sessionStorage.getItem(k)||'null');if(!v||v.expiresAt<=Date.now())sessionStorage.removeItem(k);}const left=Object.keys(sessionStorage).filter(k=>k.startsWith('tb-api-cache-'));left.slice(0,Math.max(0,left.length-35)).forEach(k=>sessionStorage.removeItem(k));}catch{}
      return j;
    })();pending.set(url,task);try{return await task}finally{pending.delete(url)}
  }
  return {get,configured:()=>!!base(),base};
})();
function bookingMessage(e){
  const m={booking_links_not_configured:'条件付き予約リンクは準備中です。楽天の施設ページで日程・人数を指定してください。',not_configured:'現在は予約サイト・店舗サイトで情報を確認できます。',provider_config:'情報提供サービスの認証・許可設定を確認する必要があります。外部サイトから引き続き探せます。',provider_unavailable:'情報提供サービスから正常な応答がありませんでした。おすすめのエリアは表示できます。',provider_bad_response:'情報提供サービスから読み取れない応答がありました。外部サイトをご利用ください。',origin_denied:'このサイトからの接続が許可されていません。サイト運営者による接続設定の確認が必要です。',not_found:'検索先が見つかりません。サイト運営者による接続先の確認が必要です。',provider_limited:'情報取得が混み合っています。予約サイト・店舗サイトは引き続き利用できます。',client_limited:'検索回数が多くなっています。少し時間をおいてお試しください。',session_limit:'この端末での検索をしばらく休止しています。外部サイトから引き続き探せます。',cooldown:'情報取得を一時休止しています。下のリンクをご利用ください。',network:'通信またはサービスの利用制限により情報を取得できません。下のリンクをご利用ください。',maintenance:'情報取得を一時休止しています。下のリンクをご利用ください。',invalid_dates:'チェックイン・チェックアウトの日付を確認してください。',invalid_request:'入力した検索条件を確認してください。',children_external:'お子さま連れの人数・食事・寝具の条件は予約サイトで指定してください。'};
  return (m[e?.code]||'情報を取得できませんでした。下のリンクをご利用ください。')+(e?.seconds?' 再取得の目安：約'+Math.ceil(e.seconds/60)+'分後。':'');
}
function bookingISO(d){const z=n=>String(n).padStart(2,'0');return `${d.getFullYear()}-${z(d.getMonth()+1)}-${z(d.getDate())}`;}
function bookingAddDays(value,days){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value||''))return '';
  const d=new Date(value+'T12:00:00Z');if(!Number.isFinite(+d)||d.toISOString().slice(0,10)!==value)return '';
  d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);
}
function bookingNightIndex(){return S.hotelSplit?Math.max(0,Math.min(Number(S.bookingNight)||0,Math.max(0,nNights()-1))):0;}
function bookingDateState(){
  const b=S.booking||{},ni=bookingNightIndex();
  const start=b.startDate||(b.checkin?bookingAddDays(b.checkin,-ni):'')||bookingISO(dayDate(0));
  const legacyNights=!S.hotelSplit&&b.checkin&&b.checkout?(Date.parse(b.checkout)-Date.parse(b.checkin))/86400000:0;
  return {startDate:start,stayNights:Math.max(1,Math.min(30,Number(b.stayNights)||legacyNights||nNights()||1))};
}
function bookingCommitDates(){S.booking={...(S.booking||{}),...bookingDateState()};delete S.booking.checkin;delete S.booking.checkout;}
function bookingResetDates(){if(S.booking)for(const k of ['startDate','stayNights','checkin','checkout'])delete S.booking[k];}
function bookingConditions(){
  const b=S.booking||{},dates=bookingDateState(),ni=bookingNightIndex();
  return {checkin:bookingAddDays(dates.startDate,ni),checkout:bookingAddDays(dates.startDate,S.hotelSplit?ni+1:dates.stayNights),adults:Number(b.adults||Math.max(1,Math.min(10,Math.ceil(nPeople()/Math.max(1,Number(S.rooms||1)))))),rooms:Number(b.rooms||S.rooms||1),children:Number(b.children||0)};
}
function bookingChangeField(field,value){
  ROUTE_UI.conditionsOpen=!!document.querySelector('.booking-conditions')?.open;
  const before=bookingConditions();bookingCommitDates();
  if(field==='checkin'){
    const start=bookingAddDays(value,-bookingNightIndex());if(!start){toast('正しい日付を入力してください');return;}
    S.booking.startDate=start;
  }else if(field==='checkout'){
    const nights=(Date.parse(value)-Date.parse(before.checkin))/86400000;
    if(S.hotelSplit||!bookingAddDays(value,0)||!Number.isInteger(nights)||nights<1||nights>30){toast('チェックアウトはチェックインの翌日から30泊以内で指定してください');render();return;}
    S.booking.stayNights=nights;
  }else S.booking[field]=Number(value);
  save();render();
}
function bookingValid(c){const today=new Date(Date.now()+9*3600000).toISOString().slice(0,10);const days=(Date.parse(c.checkout)-Date.parse(c.checkin))/86400000;return /^\d{4}-\d\d-\d\d$/.test(c.checkin)&&/^\d{4}-\d\d-\d\d$/.test(c.checkout)&&c.checkin>=today&&days>0&&days<=30&&Number.isInteger(c.adults)&&c.adults>=1&&c.adults<=10&&Number.isInteger(c.rooms)&&c.rooms>=1&&c.rooms<=10&&Number.isInteger(c.children)&&c.children>=0&&c.children<=10;}
function bookingConditionText(){const c=bookingConditions();return `${c.checkin}〜${c.checkout}／${c.rooms}部屋／1室あたり大人${c.adults}名${c.children?'・子ども'+c.children+'名':''}`;}
function stayInfo(){const c=bookingConditions();return {in:new Date(c.checkin+'T12:00:00'),out:new Date(c.checkout+'T12:00:00'),nights:Math.max(1,Math.round((Date.parse(c.checkout)-Date.parse(c.checkin))/86400000)),ppl:c.adults,rooms:c.rooms};}
function stayText(){return bookingConditionText();}
function bookingSafeURL(v){if(typeof v!=='string'||!v.trim())return '';try{const u=new URL(v,location.href);return ['https:','http:'].includes(u.protocol)&&!u.username&&!u.password?u.href:''}catch{return ''}}
function bookingID(o){return o?.providerId|| (o?.hotelNo?'rakuten:'+o.hotelNo:o?.hpId?'hotpepper:'+o.hpId:/^(rakuten|hotpepper):/.test(o?.osm||'')?o.osm:'');}
function bookingMedia(o){return (window.TABIROUTE_PLACE_MEDIA||{})[bookingID(o)]||{};}
function bookingHotelURL(h){
  const u=bookingSafeURL(h?.rkPlanURL||h?.planUrl||h?.rkURL||h?.url);return u||rakutenHotelURL(h?.name||hotelAreaQ());
}
let bookingSJIS;
function bookingEncodeSJIS(value){
  // Jalan's legacy keyword form uses Shift_JIS. Generate a reverse table locally;
  // no third-party encoding service receives hotel names or trip conditions.
  if(!bookingSJIS){
    const dec=new TextDecoder('shift_jis'), map=new Map();
    for(let n=0;n<256;n++){const ch=dec.decode(new Uint8Array([n]));if(ch.length===1&&ch!=='\ufffd')map.set(ch,[n]);}
    for(let a=0x81;a<=0xfc;a++){if(a>0x9f&&a<0xe0)continue;for(let b=0x40;b<=0xfc;b++){if(b===0x7f)continue;const ch=dec.decode(new Uint8Array([a,b]));if(ch.length===1&&ch!=='\ufffd'&&!map.has(ch))map.set(ch,[a,b]);}}
    bookingSJIS=map;
  }
  return Array.from(value).flatMap(ch=>bookingSJIS.get(ch)||[0x3f]).map(n=>'%'+n.toString(16).padStart(2,'0').toUpperCase()).join('');
}
function jalanHotelURL(name){
  return 'https://www.jalan.net/uw/uwp2011/uww2011init.do?distCd=06&rootCd=7701&screenId=FWPCTOP&keyword='+bookingEncodeSJIS(name||cityLabel()||S.pref);
}
function bookingJalanURL(h){const u=bookingSafeURL(bookingMedia(h).jalanUrl);try{if(u&&new URL(u).hostname==='www.jalan.net')return u;}catch{}return jalanHotelURL(h?.name);}
// 楽天のアフィリエイトリンク（hb.afl.rakuten.co.jp）は【広告】と表示し、rel="sponsored" を付ける（ステマ規制・Google のリンク指針）。
function bookingIsAd(u){try{return /(^|\.)afl\.rakuten\.co\.jp$/.test(new URL(u).hostname)}catch{return false}}
function bookingRel(u){return bookingIsAd(u)?'noopener sponsored':'noopener'}
function bookingAdLabel(u){return bookingIsAd(u)?'【広告】':''}
function bookingHotelLinks(h){const hu=bookingHotelURL(h);return `<div class="booking-actions"><a class="btn small" href="${esc(hu)}" target="_blank" rel="${bookingRel(hu)}">${bookingAdLabel(hu)}${h?.rkPlanURL||h?.rkURL||h?.url?'楽天で空室・宿泊プランを確認':'楽天でホテルを探す'}</a><a class="btn small ghost" href="${esc(bookingJalanURL(h))}" target="_blank" rel="noopener">じゃらんで探す</a><button type="button" class="btn small ghost" data-bk-copy="${esc(h?.name||'')}">宿泊条件をコピー</button></div><p class="note">直接開く場合は予約サイトで日程・人数を確認してください。じゃらんは施設を選び直す場合があります。</p>`;}
// ホットペッパーの検索ページ。都道府県（SA）の指定がないとエラー画面になるため必ず付ける。キーワードが空のときは都道府県のページを開く。
const HP_SA={"東京都":"SA11","神奈川県":"SA12","埼玉県":"SA13","千葉県":"SA14","茨城県":"SA15","栃木県":"SA16","群馬県":"SA17","滋賀県":"SA21","京都府":"SA22","大阪府":"SA23","兵庫県":"SA24","奈良県":"SA25","和歌山県":"SA26","岐阜県":"SA31","静岡県":"SA32","愛知県":"SA33","三重県":"SA34","北海道":"SA41","青森県":"SA51","岩手県":"SA52","宮城県":"SA53","秋田県":"SA54","山形県":"SA55","福島県":"SA56","新潟県":"SA61","富山県":"SA62","石川県":"SA63","福井県":"SA64","山梨県":"SA65","長野県":"SA66","鳥取県":"SA71","島根県":"SA72","岡山県":"SA73","広島県":"SA74","山口県":"SA75","徳島県":"SA81","香川県":"SA82","愛媛県":"SA83","高知県":"SA84","福岡県":"SA91","佐賀県":"SA92","長崎県":"SA93","熊本県":"SA94","大分県":"SA95","宮崎県":"SA96","鹿児島県":"SA97","沖縄県":"SA98"};
function hpSearchURL(q,pref,genre){const sa=HP_SA[pref||S.pref],kw=String(q||'').normalize('NFKC').replace(/\s+/g,' ').trim().slice(0,60),g=/^G0\d\d$/.test(genre||'')?genre:'';
 if(!sa)return 'https://www.hotpepper.jp/';
 if(!kw)return `https://www.hotpepper.jp/${sa}/${g?g+'/':''}`;
 return `https://www.hotpepper.jp/CSP/psh010/doBasic?SA=${sa}${g?'&GR='+g:''}&FWT=${encodeURIComponent(kw)}`;}
function hpURL(f){const u=bookingSafeURL(f?.hpURL);try{if(u&&['www.hotpepper.jp','hotpepper.jp','hpr.jp'].includes(new URL(u).hostname))return u;}catch{}return hpSearchURL(f?.name||'',f?.pref||S.pref);}
function bookingPhoto(o,size){
  const id=bookingID(o),custom=bookingMedia(o),hotel=id.startsWith('rakuten:')||o.hotel;
  const valid=Number(o.apiExpiresAt)>Date.now();
  const photo=bookingSafeURL(custom.url)|| (valid?bookingSafeURL(o.apiPhoto):'');
  const credit=custom.url?custom.credit:hotel?'写真提供：楽天トラベル':'画像提供：ホットペッパー グルメ';
  const type=custom.kind==='exterior'?'外観写真':custom.kind==='dish'?'料理写真':hotel?'施設写真（外観とは限りません）':'店舗写真（料理・内観等）';
  if(!photo)return `<div class="booking-photo booking-photo-${esc(size)}"><div class="booking-no-photo">${hotel?ICON.bed:ICON.food||ICON.img}<span>店舗・施設の写真未登録</span></div></div>`;
  return `<figure class="booking-photo booking-photo-${esc(size)}"><img src="${esc(photo)}" alt="${esc(o.name)}の${esc(type)}" loading="lazy" decoding="async" onerror="this.hidden=true;this.parentNode.querySelector('figcaption').textContent='写真を読み込めませんでした'"/><figcaption>${esc(type)}<br>${esc(credit||'提供元確認済み写真')}</figcaption></figure>`;
}
const bookingOriginalImgSlot=imgSlot;
imgSlot=function(o,size){
  if(!o)return '';
  const isFood=!!o.food||!!o.cuisine||!!o.meal||/^hotpepper:/.test(o.osm||'');const isHotel=o.hotel||/hotel|guest_house|hostel|motel/.test(o.type||'');
  if(!isFood&&!isHotel&&!bookingID(o))return bookingOriginalImgSlot(o,size);
  let full=o;
  if(!bookingID(full)&&S){const all=[...(S.hotelCands||[]),...(S.wishes||[]),S.hotelInfo,...(S.nights||[]).map(n=>n.info)].filter(Boolean);const same=all.find(x=>x.name===o.name&&Math.abs(Number(x.lat)-Number(o.lat))<0.00001&&Math.abs(Number(x.lng)-Number(o.lng))<0.00001);if(same)full={...o,...same};}
  return bookingPhoto(full,size);
};
// Remove generic food photos and disable paid Google Places lookups, including saved legacy keys.
const bookingOriginalFindImage=findImage;
findImage=async o=>(o?.food||o?.hotel)?{none:true,t:Date.now()}:bookingOriginalFindImage(o);
loadGRates=async()=>{};
foodRate=()=>'';
keyPanelHTML=()=>'';
hasDish=f=>!!f;
rakutenRates=async()=>{};
function bookingHotelFields(){
  const c=bookingConditions(),today=new Date(Date.now()+9*3600000).toISOString().slice(0,10);
  return `<div class="booking-box"><h3>宿泊の日程・人数</h3><div class="booking-fields">
    <label>チェックイン<input type="date" data-bk-field="checkin" value="${esc(c.checkin)}" min="${today}" required></label>
    <label>チェックアウト<input type="date" data-bk-field="checkout" value="${esc(c.checkout)}" min="${esc(bookingAddDays(c.checkin,1))}" ${S.hotelSplit?'readonly aria-describedby="bookingDateHint"':''} required></label>
    <label>1室あたりの大人<select data-bk-field="adults">${Array.from({length:10},(_,i)=>`<option value="${i+1}" ${c.adults===i+1?'selected':''}>${i+1}名</option>`).join('')}</select></label>
    <label>部屋数<select data-bk-field="rooms">${Array.from({length:10},(_,i)=>`<option value="${i+1}" ${c.rooms===i+1?'selected':''}>${i+1}部屋</option>`).join('')}</select></label>
    <label>1室あたりの子ども<select data-bk-field="children">${Array.from({length:11},(_,i)=>`<option value="${i}" ${c.children===i?'selected':''}>${i}名</option>`).join('')}</select></label>
    </div><p class="note">合計：大人${c.adults*c.rooms}名${c.children?'・子ども'+c.children*c.rooms+'名':''}。各部屋が同じ人数の場合の条件です。人数が部屋ごとに異なる場合や、お子さまの年齢・食事・寝具は予約サイトで指定してください。</p>
    ${c.children?'<p class="booking-notice">お子さま連れの場合は、予約サイトで詳細条件を指定して空室をご確認ください。</p>':''}
    ${!bookingValid(c)?'<p class="booking-notice" role="alert">日付を確認してください。チェックアウトはチェックインより後、30泊以内で指定できます。</p>':''}
    <p id="bookingDateHint" class="note">${S.hotelSplit?'各泊は1泊ずつ検索します。チェックインを動かすと、ほかの泊も同じ日数だけ移動します。':`${bookingDateState().stayNights}泊の条件です。チェックインを変更すると泊数を保ってチェックアウトも移動します。`}</p><button type="button" class="linkbtn" data-bk-reset>旅行の日程に戻す</button><p class="note">宿泊検索の日付です。旅行の予定表の日付は変更しません。</p>${bookingDateState().startDate!==bookingISO(dayDate(0))||!S.hotelSplit&&bookingDateState().stayNights!==nNights()?'<p class="booking-notice">旅行の日程と宿泊検索の日程が異なります。予約前に日付をご確認ください。</p>':''}</div>`;
}
function bookingAvailabilityMessage(data){
  if(data.availabilityStatus==='no_availability')return 'この日程・人数に合う空室はAPIでは見つかりませんでした。満室のほか、未販売・対象外のプランもあります。下の楽天のプラン一覧でも確認できます。';
  if(data.availabilityStatus==='links_unavailable')return data.bookingLinksConfigured===false?'宿泊プラン情報はありますが、直接予約用のリンクは未設定です。下の楽天のプラン一覧から日程・人数を指定してください。':'宿泊プラン情報はありますが、直接予約用のURLが利用できません。下の楽天のプラン一覧から確認できます。';
  if(data.availabilityStatus==='no_room_details')return '施設は見つかりましたが、対象の部屋・プラン詳細は返されませんでした。下の楽天のプラン一覧で確認してください。';
  return 'この条件のプランリンクは返されませんでした。下の楽天のプラン一覧で日程・人数を指定して確認できます。';
}
function bookingHotelCard(h,i){
  const c=bookingConditions(),key=JSON.stringify(c),a=BOOKING_UI.availability[h.hotelNo],current=a?.key===key&&a.project===APP.pid;
  const fresh=current&&a.data?.expiresAt>Date.now();
  const picked=S.hotelSplit?nightsArr()[S.bookingNight||0]?.info?.hotelNo===h.hotelNo:((S.hotelMode==='undecided'&&S.hotelPick===i)||(S.hotelMode==='decided'&&S.hotelInfo?.hotelNo===h.hotelNo));
  return `<article class="booking-card"><div class="booking-card-top">${bookingPhoto({...h,hotel:true},'card')}<div><span class="booking-eyebrow">STAY / 楽天トラベル</span><h3>${esc(h.name)}</h3><p class="note">${esc(h.addr||'')}</p>${h.apiExpiresAt>Date.now()&&h.rate?rateBadge(h.rate,h.cnt,'楽天トラベル'):''}<p class="note">${esc(h.access||'')}</p></div></div>
    <div class="booking-actions"><button type="button" class="btn primary" data-bk-availability="${esc(h.hotelNo)}" ${!BookingAPI.configured()||!bookingValid(c)||c.children||(current&&(a.busy||a.code==='booking_links_not_configured'))?'disabled':''}>${current&&a.busy?'空室を確認中…':'この条件で宿泊プランを見る'}</button><button type="button" class="btn ${picked?'primary':''}" data-bk-pick="${i}">${picked?'✓ 予定に追加済み':'この宿を予定に追加'}</button></div>
    ${current&&a.message?`<p class="booking-notice" role="status">${esc(a.message)}</p>`:''}
    ${fresh?`<div class="booking-plans"><p class="note">${esc(bookingConditionText())}<br>${new Date(a.data.fetchedAt).toLocaleTimeString('ja-JP')}取得。料金・最終的な空室は楽天で確認してください。</p>${a.data.items.map(p=>{const pu=bookingSafeURL(p.url);return `<a class="booking-plan" href="${esc(pu)}" target="_blank" rel="${bookingRel(pu)}"><b>${esc(p.name)}</b>${p.price?.perRoom>0?`<em class="plan-price">${Number(p.price.perRoom).toLocaleString()}円<small>／1室1泊</small></em>`:''}<span>${esc(p.room)}${p.breakfast?'・朝食付き':''}${p.dinner?'・夕食付き':''} → ${bookingAdLabel(pu)}楽天で確認</span></a>`}).join('')}${!a.data.items.length?`<p class="note">${esc(bookingAvailabilityMessage(a.data))}</p>`:''}</div>`:''}
    ${bookingHotelLinks(fresh&&a.data.facilityUrl?{...h,rkPlanURL:a.data.facilityUrl}:h)}</article>`;
}
function stepHotel(){
  const cands=(S.hotelCands||[]).filter(h=>h.hotelNo);
  return `<section class="panel booking-panel">${head(6,'泊まるところ','日程と人数を入力して、気になるホテルの宿泊プランを確認しましょう。')}
    ${nNights()<1?'<p class="booking-notice">日帰りの予定です。宿泊を追加する場合は、旅行の日数も変更してください。</p>':''}
    ${nNights()>=2?`<div class="choices two"><button type="button" class="choice" data-hsplit="0" aria-pressed="${!S.hotelSplit}"><div><b>全部同じホテル</b><span>全日程の宿を探します</span></div></button><button type="button" class="choice" data-hsplit="1" aria-pressed="${!!S.hotelSplit}"><div><b>泊ごとに変える</b><span>宿泊日を選んで探します</span></div></button></div>`:''}
    ${S.hotelSplit&&nNights()>=2?`<label class="booking-night">探す宿泊日<select data-bk-night>${Array.from({length:nNights()},(_,i)=>`<option value="${i}" ${i===(S.bookingNight||0)?'selected':''}>${i+1}泊目：${esc(fmtDay(dayDate(i)))}</option>`).join('')}</select></label>${nightsHTML()}`:''}
    ${bookingHotelFields()}
    <form id="bookingHotelSearch" class="booking-search"><label for="bookingHotelQuery">ホテル名・地域で探す</label><div class="row"><input id="bookingHotelQuery" name="query" maxlength="80" placeholder="例：京都駅、ホテルの正式名称" value="${esc(S.booking?.q||'')}"><button type="submit" class="btn primary" ${BOOKING_UI.hotelsBusy?'disabled':''}>${BOOKING_UI.hotelsBusy?'検索中…':'ホテルを探す'}</button></div><p class="note">名前を空欄にすると、観光スポット周辺（約3km）のホテルを探します。</p></form>
    <p class="booking-notice" role="status">${esc(BOOKING_UI.hotelMessage||(!BookingAPI.configured()?'ホテル検索は準備中です。下の予約サイトから探すことができます。':'施設写真は外観とは限りません。選んだ宿の詳細を予約サイトで確認できます。'))}</p>
    ${cands.length?`<div class="booking-results">${cands.map((h)=>bookingHotelCard(h,S.hotelCands.indexOf(h))).join('')}</div><div class="booking-credit">${BOOKING_CREDIT_RK}</div>`:''}
    ${bookingHotelLinks({name:S.booking?.q||S.hotelName||hotelAreaQ()})}
    <details class="booking-manual"><summary>決まっているホテルを手入力する</summary><p class="note">APIが利用できない場合も、宿を予定に登録できます。</p><label>ホテル名<input id="bookingManualName" value="${esc(S.hotelName||'')}" placeholder="ホテルの正式名称"></label><label>緯度・経度（任意）<input id="bookingManualCoords" placeholder="例：34.9858, 135.7588"></label><button type="button" class="btn" data-bk-manual>この宿を予定に追加</button></details>
    ${S.hotelMode==='decided'&&S.hotelName?`<p class="booking-notice">予定の宿：${esc(S.hotelName)}${S.hotelLoc?'':'（位置未確認）'}</p>`:''}
    <p class="note">「予定に追加」は予約確定ではありません。予約は外部サイトでお手続きください。</p></section>`;
}
async function bookingSearchHotels(q){
  if(BOOKING_UI.hotelsBusy)return;const state=S,pid=APP.pid;const seq=++BOOKING_UI.seq;
  S.booking={...(S.booking||{}),q:String(q||'').trim()};save();BOOKING_UI.hotelsBusy=true;BOOKING_UI.hotelMessage='';render();
  try{const p=S.booking.q?{q:S.booking.q}:(()=>{const a=S.hotelSplit?nightArea(S.bookingNight||0):stopsAll().length?bestArea(stopsAll()):foodCenters().昼;return {lat:a.lat.toFixed(5),lng:a.lng.toFixed(5)}})();
    const j=await BookingAPI.get('/hotels',p);if(S!==state||APP.pid!==pid||seq!==BOOKING_UI.seq)return;
    const previous=S.hotelMode==='undecided'?S.hotelCands?.[S.hotelPick]:null;const selected=previous?.hotelNo;if(previous){S.hotelMode='decided';S.hotelName=previous.name;S.hotelLoc={lat:previous.lat,lng:previous.lng};S.hotelInfo=previous;}
    S.hotelCands=j.items.map(h=>({name:h.name,lat:h.lat,lng:h.lng,addr:h.address,kind:'ホテル',type:'hotel',hotelNo:h.id,providerId:'rakuten:'+h.id,osm:'rakuten:'+h.id,rkURL:h.url,rkPlanURL:h.planUrl,apiPhoto:h.photo,apiExpiresAt:j.expiresAt,rate:h.rating,cnt:h.reviewCount,access:h.access,park:!!h.parking&&!/なし|無し/.test(h.parking),src:'rakuten',sc:0}));
    S.hotelPick=S.hotelCands.findIndex(h=>h.hotelNo===selected);BOOKING_UI.hotelMessage=j.items.length?`${j.items.length}件のホテルが見つかりました。各ホテルで宿泊条件に合うプランを確認できます。`:'該当するホテルが見つかりませんでした。ホテル名を短くするか、地域名で探してください。';save();
  }catch(e){if(S===state&&APP.pid===pid)BOOKING_UI.hotelMessage=bookingMessage(e);}finally{BOOKING_UI.hotelsBusy=false;render();}
}
async function bookingAvailability(id){
  const c=bookingConditions();if(!bookingValid(c)||c.children)return;
  const existing=BOOKING_UI.availability[id];if(existing?.busy)return;
  const a={key:JSON.stringify(c),project:APP.pid,busy:true};BOOKING_UI.availability[id]=a;render();
  try{a.data=await BookingAPI.get('/availability',{hotelNo:id,...c});}catch(e){a.code=e.code;a.message=bookingMessage(e);}finally{a.busy=false;render();}
}
function bookingToFood(h,j,center){return {name:h.name,lat:h.lat,lng:h.lng,addr:h.address,cuisine:h.genre,hours:h.hours,closed:h.closed,budget:h.budget,budgetBand:h.budgetBand,genreCode:h.genreCode,catch:h.catch,hpId:h.id,providerId:'hotpepper:'+h.id,hpURL:h.url,apiPhoto:h.photo,apiExpiresAt:j.expiresAt,osm:'hotpepper:'+h.id,type:'restaurant',food:true,dist:hav(center,h),sc:0,onR:false,open:null,src:'hotpepper',extra:{web:h.url}};}
async function loadFood(force){
  if(busy.food)return;const state=S,pid=APP.pid,key=foodKey(),slot=S.foodTab||'昼';
  if(!force&&S.food?.key===key&&S.food?.expiresAt>Date.now()&&S.food?.[slot])return;
  busy.food=true;msg.food='';render();
  try{const center=foodCenters()[slot],j=await BookingAPI.get('/restaurants',{lat:center.lat.toFixed(5),lng:center.lng.toFixed(5)});
    if(S!==state||pid!==APP.pid||foodKey()!==key)return;
    const prev=S.food?.key===key?S.food:{};S.food={...prev,key,expiresAt:j.expiresAt,[slot]:j.items.map(h=>bookingToFood(h,j,center))};
    msg.food=j.items.length?'':'この周辺には掲載店舗が見つかりませんでした。ホットペッパーでも検索できます。';save();
  }catch(e){if(S===state&&pid===APP.pid){msg.food=bookingMessage(e);S.food={key,[slot]:[],expiresAt:Date.now()+60000};}}
  finally{busy.food=false;render();}
}
async function foodSearch(q){
  q=String(q||'').trim();if(!q){msg.foodS='店名や食べたいものを入力してください。';render();return;}if(busy.foodS)return;
  const state=S,pid=APP.pid,slot=S.foodTab||'昼',key=foodKey();busy.foodS=true;DRAFT.foodQ=q;S.foodS={q,items:[]};msg.foodS='';render();
  try{const center=foodCenters()[slot],j=await BookingAPI.get('/restaurants',{lat:center.lat.toFixed(5),lng:center.lng.toFixed(5),q});if(S!==state||APP.pid!==pid||key!==foodKey())return;
    S.foodS={q,items:j.items.map(h=>bookingToFood(h,j,center)),expiresAt:j.expiresAt,key,slot};save();
  }catch(e){if(S===state&&APP.pid===pid)msg.foodS=bookingMessage(e);}finally{busy.foodS=false;render();}
}
function foodItem(f,slot,i,key){
  key=key||slot;const added=S.wishes.some(w=>w.osm===f.osm);const fresh=f.apiExpiresAt>Date.now();
  return `<article class="booking-card"><div class="booking-card-top">${bookingPhoto(f,'card')}<div><span class="booking-eyebrow">GOURMET / ホットペッパー</span><h3>${esc(f.name)}</h3><p class="note">${esc(f.addr||'')}</p>${fresh?`<p>${esc(f.cuisine||'')}</p><p class="note">${esc(f.budget||'')}<br>${esc(f.hours||'')}</p>`:'<p class="note">保存したお店です。最新情報は店舗ページで確認できます。</p>'}<p class="note">検索地点から約${Number(f.dist||0).toFixed(1)}km</p></div></div><div class="booking-actions"><a class="btn" href="${esc(hpURL(f))}" target="_blank" rel="noopener">ホットペッパーで口コミ・料理を見る</a><button type="button" class="btn ${added?'':'primary'}" data-addfood="${esc(key)}|${i-1}">${added?'✓ 予定から外す':'＋ '+MEALNAME[slot]+'に追加'}</button></div><p class="note">口コミ点数はホットペッパーの店舗ページでご確認ください。</p></article>`;
}
function foodSection(){
  const slot=S.foodTab||'昼',source=S.foodS?.q?S.foodS:null;
  const live=source?source.slot===slot&&source.key===foodKey()&&source.expiresAt>Date.now():S.food?.key===foodKey()&&S.food.expiresAt>Date.now();
  const list=(live?(source?source.items:S.food?.[slot])||[]:[]).filter(f=>f.apiExpiresAt>Date.now());
  return `<div class="booking-panel"><h2 class="sub">ホットペッパーでお店を探す</h2><div class="chips">${MEALS.map(m=>`<button type="button" class="chip" data-foodtab="${m}" aria-pressed="${slot===m}">${MEALNAME[m]}</button>`).join('')}</div><form id="bookingFoodSearch" class="booking-search"><label for="foodQ">店名・料理名</label><div class="row"><input id="foodQ" name="query" maxlength="80" value="${esc(S.foodS?.q||'')}" placeholder="例：海鮮、ラーメン、店名"><button type="submit" class="btn primary" ${busy.foodS?'disabled':''}>検索</button></div></form><div class="booking-actions"><button type="button" class="btn" data-bk-food-near ${busy.food?'disabled':''}>${busy.food?'周辺のお店を検索中…':'周辺のお店を探す'}</button>${source?'<button type="button" class="btn ghost" data-act="foodClear">検索を解除</button>':''}<a class="btn ghost" href="${esc(hpSearchURL(source?.q||'',S.pref))}" target="_blank" rel="noopener">ホットペッパーで探す</a></div>
    <p class="booking-notice" role="status">${esc((source?msg.foodS:msg.food)||'写真は掲載店舗のものです。店舗トップ写真には料理以外の写真も含まれます。')}</p><p class="note">口コミ点数は公開APIで提供されていないため、店舗ページで確認できます。営業時間や定休日も来店前にご確認ください。</p>
    ${busy.foodS?'<p role="status">お店を検索中…</p>':''}<div class="booking-results">${list.map((f,i)=>foodItem(f,slot,i+1,source?'s':slot)).join('')}</div>
    ${!list.length&&!busy.food&&!busy.foodS?'<p class="empty">表示できる店舗情報がありません。検索するか、ホットペッパーのサイトをご利用ください。</p>':''}<div class="booking-credit">${BOOKING_CREDIT_HP}</div></div>`;
}
function addFood(slot,i){
  const f=foodList(slot)[i];if(!f)return;if(slot==='s')slot=S.foodTab||'昼';const existing=S.wishes.find(w=>w.osm===f.osm);
  if(existing)S.wishes=S.wishes.filter(w=>w!==existing);
  else S.wishes.push({...f,id:newId(),q:f.name,stay:MEALWIN[slot].stay,status:'ok',anchor:'',food:true,meal:slot,day:0});
  save();render();
}
// An explicit click/search drives new requests. Rendering a screen never consumes API quota.
function bookingPickHotel(i){const h=S.hotelCands?.[i];if(!h)return;if(S.hotelSplit){const ns=nightsArr();ns[S.bookingNight||0]={name:h.name,loc:{lat:h.lat,lng:h.lng},addr:h.addr,info:h};}else{S.hotelMode='undecided';S.hotelPick=i;S.hotelName=h.name;}save();render();}
document.addEventListener('submit',e=>{if(e.target.id==='bookingHotelSearch'){e.preventDefault();bookingSearchHotels(new FormData(e.target).get('query'));}if(e.target.id==='bookingFoodSearch'){e.preventDefault();foodSearch(new FormData(e.target).get('query'));}});
document.addEventListener('change',e=>{const t=e.target;if(t.dataset.bkField){bookingChangeField(t.dataset.bkField,t.value);}if(t.hasAttribute('data-bk-night')){S.bookingNight=Number(t.value);if(S.booking){delete S.booking.checkin;delete S.booking.checkout;}save();render();}});
document.addEventListener('click',e=>{const t=e.target.closest('[data-hsplit]');if(t&&S.booking){delete S.booking.checkin;delete S.booking.checkout;S.bookingNight=0;}},true);
document.addEventListener('click',async e=>{const t=e.target.closest('[data-bk-availability],[data-bk-pick],[data-bk-copy],[data-bk-reset],[data-bk-manual],[data-bk-food-near]');if(!t)return;
  if(t.dataset.bkAvailability)return bookingAvailability(t.dataset.bkAvailability);
  if(t.hasAttribute('data-bk-pick'))return bookingPickHotel(Number(t.dataset.bkPick));
  if(t.hasAttribute('data-bk-reset')){bookingResetDates();save();render();return;}
  if(t.hasAttribute('data-bk-food-near')){S.foodS=null;DRAFT.foodQ='';return loadFood(true);}
  if(t.hasAttribute('data-bk-copy')){const value=t.dataset.bkCopy+'\n'+bookingConditionText();try{await navigator.clipboard.writeText(value);toast('ホテル名と宿泊条件をコピーしました');}catch{window.prompt('宿泊条件をコピーしてください',value);}return;}
  if(t.hasAttribute('data-bk-manual')){const name=document.getElementById('bookingManualName').value.trim(),raw=document.getElementById('bookingManualCoords').value.trim();if(!name){toast('ホテル名を入力してください');return;}let loc=null;if(raw){const m=raw.match(/^\s*(\d+(?:\.\d+)?)\s*[,、]\s*(\d+(?:\.\d+)?)\s*$/);if(!m||+m[1]<20||+m[1]>46||+m[2]<122||+m[2]>154){toast('緯度・経度を「34.9858, 135.7588」の形で入力してください');return;}loc={lat:+m[1],lng:+m[2]};}if(S.hotelSplit){nightsArr()[S.bookingNight||0]={name,loc};}else{S.hotelMode='decided';S.hotelName=name;S.hotelLoc=loc;S.hotelInfo=null;S.hotelPick=-1;}save();render();}
});
// Named-restaurant entry uses the same provider and asks the user to choose the
// matching branch, instead of attaching the first geocoder result automatically.
shopSuggest=function(){clearTimeout(shopT);APP.shop={q:'',list:[],busy:false};shopPaint();};
shopListHTML=()=>'';
addMyShop=function(){const q=document.getElementById('myShop')?.value.trim();if(!q){toast('店名を入力してください');return;}S.foodTab=S.myMeal||'昼';return foodSearch(q);};
document.addEventListener('click',e=>{if(!e.target.closest('[data-bk-foodmanual]'))return;const name=document.getElementById('myShop')?.value.trim();if(!name){toast('店名を入力してください');return;}const meal=S.myMeal||'昼';S.wishes.push({id:newId(),q:name,name,food:true,meal,day:0,lat:null,lng:null,status:'pending',stay:MEALWIN[meal].stay,src:'mine',anchor:''});save();render();toast('店名を予定に追加しました。場所は「行きたい場所」で確認できます。');});
