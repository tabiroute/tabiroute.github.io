/* Pure, deterministic timeline calculation. No network, DOM or saved-state writes. */
(function(root){
'use strict';
const minutes=s=>/^([01]\d|2[0-3]):[0-5]\d$/.test(s||'')?Number(s.slice(0,2))*60+Number(s.slice(3)):s==='24:00'?1440:null;
function windows(rule,date){
 const day=new Date(date+'T12:00:00Z').getUTCDay();
 if(rule.closed||(rule.closedDays||[]).includes(day)||(rule.closedDates||'').split(/[\s,、]+/).includes(date))return [];
 if(!rule.hours)return null;
 return rule.hours.split(/[,、]/).map(s=>s.trim().split('-').map(minutes)).filter(a=>a.length===2&&a.every(Number.isFinite)&&a[1]!==a[0]).map(([a,b])=>[a,b<a?b+1440:b]).sort((a,b)=>a[0]-b[0]);
}
function availability(rule,date,arrival,duration){
 const w=windows(rule,date),last=minutes(rule.lastAdmission);
 if(w===null)return last!==null&&arrival>last?{ok:false,reason:'最終入場を過ぎています',short:arrival-last}:{ok:true,t:arrival,unknown:true};
 for(const [a,b]of w){const t=Math.max(a,arrival);if(t+duration<=b&&(last===null||t<=last))return {ok:true,t};}
 return {ok:false,reason:w.length?'営業時間・最終入場に収まりません':'休館日です',short:w.length?Math.max(0,arrival+duration-w.at(-1)[1],last===null?0:arrival-last):0};
}
function calculate(o){
 const items=[],issues=[],sequence=[];let t=o.start,prev=o.from,km=0,n=0,lunchT=null;
 const rules=o.rules||{},duration=s=>Math.max(5,Number(rules[s.id]?.duration)||Math.round((s.stay||60)*(s.meal?1:o.pace)/5)*5);
 const issue=(s,code,message,short=0)=>issues.push({id:s?.id,code,message,short:Math.ceil(short)});
 const wait=(until,label)=>{if(until>t){items.push({type:'wait',t,dur:until-t,label});t=until;}};
 const travel=to=>{if(!to)return;const l=o.route(prev,to);if(l.min||l.km){items.push({type:'leg',...l,buf:o.buffer,from:prev,to,t});t+=l.min+o.buffer;km+=l.km;}prev=to;};
 const service=(label,dur,node)=>{items.push({type:'service',label,dur,t,node});t+=dur;};
 items.push({type:'start',t,label:prev.name,node:prev});
 const fixed=o.seq.filter(s=>rules[s.id]?.fixed&&minutes(rules[s.id].time)!==null).sort((a,b)=>minutes(rules[a.id].time)-minutes(rules[b.id].time));
 const mealStops=o.seq.filter(s=>s.meal&&!fixed.includes(s));
 const flexible=o.seq.filter(s=>!fixed.includes(s)&&!mealStops.includes(s));
 const anchors=[...mealStops.map(s=>({s,target:s.meal==='朝'?Math.max(o.start,480):s.meal==='昼'?720:s.meal==='休憩'?900:1050,fixed:false})),...fixed.map(s=>({s,target:minutes(rules[s.id].time),fixed:true})),...(o.meals||[]).map(s=>({s,target:s.target,fixed:false}))].sort((a,b)=>a.target-b.target||Number(b.fixed)-Number(a.fixed));
 // 宿を移る日の朝食（お店未定）は、チェックアウトより前に宿でとる想定にする。
 if(o.checkout&&anchors[0]?.s.missing&&anchors[0].s.meal==='朝'&&anchors[0].target<=t+30){const a=anchors.shift();wait(a.target,'朝食の時間まで');items.push({type:'missingMeal',t,meal:'朝',dur:a.s.stay});t+=a.s.stay;}
 if(o.checkout){if(t+o.checkout.duration>o.checkout.latest)issue(null,'checkout','チェックアウト期限に'+Math.ceil(t+o.checkout.duration-o.checkout.latest)+'分間に合いません',t+o.checkout.duration-o.checkout.latest);service('チェックアウト・荷物整理',o.checkout.duration,prev);}
 if(o.luggage?.drop){travel(o.luggage.drop);service('荷物を預ける（受付可否を宿に確認）',o.luggage.duration,o.luggage.drop);}
 // 食事（予約なし）の時刻には幅を持たせる。昼食・夕食は最大120分（14時・19時半ごろまで）、休憩は60分まで後ろにずらして、
 // 午前の観光を入れられるようにする（以前は12時までに終わらない観光を昼食後に回し、午前が空いていた）。
 const SLACK={'朝':0,'昼':120,'休憩':60,'夜':120};
 function place(s,fixedTime){
  const r=rules[s.id]||{},dur=duration(s),l=o.route(prev,s),arrival=t+l.min+(l.min||l.km?o.buffer:0),av=availability(r,o.date,arrival,dur);
  if(fixedTime===undefined&&!av.ok){issue(s,'closed',s.name+'：'+av.reason,av.short);items.push({type:'excluded',t,label:s.name+'：'+av.reason,s});return;}
  travel(s);
  if(fixedTime!==undefined){
   const at=availability(r,o.date,fixedTime,dur);
   if(!at.ok||at.t!==fixedTime)issue(s,'reservation-hours',s.name+'：予約時刻と営業時間が一致しません',at.short||0);
   if(t>fixedTime)issue(s,'reservation-late',s.name+'：予約に'+Math.ceil(t-fixedTime)+'分不足。予約時刻は変更していません',t-fixedTime);
   wait(fixedTime,'予約開始まで');
  }else wait(av.t,'開館・営業開始まで');
  const display=fixedTime===undefined?t:fixedTime;
  items.push({type:'stop',s,t:display,arrival:t,dur,n:++n,meal:s.meal,fixed:fixedTime!==undefined});sequence.push(s);
  if(s.meal==='昼')lunchT=display;
  t=Math.max(t,display)+dur;
 }
 for(const a of anchors){
  // Preserve requested relative order while putting only feasible visits before an anchor.
  while(flexible.length){const s=flexible[0],l=o.route(prev,s),av=availability(rules[s.id]||{},o.date,t+l.min+o.buffer,duration(s));
   if(!av.ok){flexible.shift();place(s);continue;}
   const next=a.s.missing?0:o.route(s,a.s).min+o.buffer;
   let limit=a.fixed?a.target:a.target+(SLACK[a.s.meal]??0);
   const nextFixed=anchors.find(x=>x.fixed&&x!==a&&x.target>=a.target);
   if(!a.fixed&&nextFixed)limit=Math.max(a.target,Math.min(limit,nextFixed.target-(a.s.missing?a.s.stay:duration(a.s))-o.route(a.s.missing?s:a.s,nextFixed.s).min-o.buffer));
   if(av.t+duration(s)+next>limit)break;
   flexible.shift();place(s);
  }
  if(a.s.missing){
   const nextFixed=anchors.find(x=>x.fixed&&x.target>=a.target);
   let dur=a.s.stay;
   if(nextFixed&&Math.max(t,a.target)+dur+o.route(prev,nextFixed.s).min+o.buffer>nextFixed.target){items.push({type:'missingMeal',t,meal:a.s.meal,dur:0,unallocated:true});issue(null,'meal-time',a.s.meal+'食の時間を確保できていません');}
   else{wait(Math.max(t,a.target),'食事の時間まで');items.push({type:'missingMeal',t,meal:a.s.meal,dur});if(a.s.meal==='昼')lunchT=t;t+=dur;}
  }else{if(!a.fixed){const travelTime=o.route(prev,a.s).min+o.buffer;wait(a.target-travelTime,'食事の時間まで');}place(a.s,a.fixed?a.target:undefined);}
 }
 flexible.forEach(s=>place(s));
 if(o.luggage?.retrieve){travel(o.luggage.retrieve);service('預けた荷物を受け取る',o.luggage.duration,o.luggage.retrieve);}
 if(!o.endAtLast)travel(o.to);
 if(o.checkin){wait(o.checkin.earliest,'チェックイン受付まで');const arrive=t;service('チェックイン・荷物を置く',o.checkin.duration,o.to);if(arrive>o.checkin.latest)issue(null,'checkin','チェックイン受付終了に'+Math.ceil(arrive-o.checkin.latest)+'分間に合いません',arrive-o.checkin.latest);}
 items.push({type:'end',t,label:o.endAtLast?'旅のおわり':o.to.name,node:o.endAtLast?{...prev,tripEnd:true}:o.to});
 // 泊まる日は「観光の終わり」を終了時刻と比べる。夕食・宿への移動・チェックインは終了時刻の後でもよいが、22時を過ぎたら知らせる。
 const sightEnd=Math.max(o.start,...items.filter(x=>(x.type==='stop'&&x.meal!=='夜')||(x.type==='missingMeal'&&x.meal!=='夜'&&x.dur)||(x.type==='service'&&/預け/.test(x.label))).map(x=>x.t+x.dur));
 const overMinutes=o.eveningAfterEnd?Math.max(0,Math.ceil(sightEnd-o.end),Math.ceil(t-Math.max(o.end,1320))):Math.max(0,Math.ceil(t-o.end));
 if(overMinutes)issue(null,'overrun',o.eveningAfterEnd&&sightEnd<=o.end?'宿に着くのが22時を'+overMinutes+'分過ぎます':'予定の終了を'+overMinutes+'分超過しています',overMinutes);
 return {items,t,km,lunchT,late:null,startT:o.start,over:overMinutes>0,overMinutes,issues,sequence};
}
const api={minutes,windows,availability,calculate};root.TravelPlanner=api;if(typeof module!=='undefined')module.exports=api;
})(globalThis);
