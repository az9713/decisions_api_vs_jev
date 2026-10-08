import { CASES, ENGINES, QUEUES, postSummary } from './postoffice-core.mjs';
const $=id=>document.getElementById(id), engines=Object.keys(ENGINES), colors=['#e3bd79','#91c7b0','#adc1ec','#d7a9ce'];
const samples={decisions:[],jev:[]}, mail={decisions:[],jev:[]}, deliveries={decisions:[0,0,0,0,0],jev:[0,0,0,0,0]};
let running=false,pending=0,offered=0,timer,settings,runId,configured=false,atlas=null,ready=false,startedAt;
const ms=n=>Number.isFinite(n)?Math.round(n)+' ms':'—', pct=n=>Number.isFinite(n)?(100*n).toFixed(1)+'%':'—';
function dials(){ $('rate-value').textContent=Number($('rate').value).toFixed(1);$('deadline-value').textContent=$('deadline').value+' ms'; }
function controls(){
 for(const id of ['rate','deadline','post-concurrency','context','case-count']) $(id).disabled=running||pending>0;
 $('post-start').disabled=!configured||!ready||running||pending>0; $('post-stop').disabled=!running; $('post-export').disabled=!samples.decisions.length||running||pending>0;
}
async function status(){
 try {const r=await fetch('/api/status');if(!r.ok)throw Error('Server unavailable');const s=await r.json();configured=s.gatewayConfigured;budget(s.budget);
 $('key-status').textContent=configured?'Gateway key configured':'Gateway key missing';$('key-dot').classList.toggle('offline',!configured);
 if(!running&&!pending)$('run-state').textContent=configured?(runId?'Run complete':'Ready for paired test'):'Gateway key missing';
 controls(); }catch(e){configured=false;$('run-state').textContent='Server disconnected';$('key-status').textContent=e.message;controls();}
}
function budget(b){if(!b)return;$('budget-mini').textContent='$'+b.availableUsd.toFixed(2)+' available';$('budget-detail').textContent='Project: $'+b.estimatedSpentUsd.toFixed(4)+' known/estimated + $'+b.reservedUsd.toFixed(2)+' reserved for uncertain calls · $'+b.capUsd.toFixed(2)+' cap';}
function update(){
 for(const engine of engines){const s=postSummary(samples[engine]);const pairs=[
 ['Offered',s.count,s.completed+' completed · '+s.errors+' errors · '+s.skipped+' dropped'],
 ['Median',ms(s.p50),'p95 '+ms(s.p95)+' · p99 '+ms(s.p99)],
 ['Correct',pct(s.accuracy),'Includes errors and drops'],
 ['Timely correct',pct(s.timelyCorrect),s.late+' late completed responses'],
 ['Known cost','$'+s.cost.toFixed(6),s.unknownCost+' unknown cost calls'],
 ['Input tokens',s.inputTokens.toLocaleString(),'Actual provider token usage']];
 $(engine+'-stats').replaceChildren(...pairs.map(([label,value,detail])=>{const el=document.createElement('div');el.className='stat';for(const[tag,text]of[['span',label],['b',String(value)],['small',detail]]){const child=document.createElement(tag);child.textContent=text;el.append(child);}return el;}));}
 $('post-log').replaceChildren();
 for(let i=Math.max(0,offered-12);i<offered;i++){
 const a=samples.decisions.find(s=>s.sequence===i+1),b=samples.jev.find(s=>s.sequence===i+1),tr=document.createElement('tr');
 const label=s=>!s?'Pending':s.skipped?'Dropped':!s.ok?'Error '+(s.status||''):s.choice+(s.onTime?'':' · late')+(s.choice===s.expected?'':' · wrong');
 for(const value of [i+1,a?.expected||b?.expected||CASES[i%CASES.length].expected,label(a),ms(a?.roundTripMs),label(b),ms(b?.roundTripMs)]){const td=document.createElement('td');td.textContent=value;tr.append(td);}
 $('post-log').prepend(tr);
 }
 const ctx=$('post-chart').getContext('2d');ctx.clearRect(0,0,1000,160);const max=Math.max(settings?.deadlineMs||2000,...engines.flatMap(e=>samples[e].map(s=>s.roundTripMs||0)));
 ctx.fillStyle='#a9bcab';ctx.font='12px system-ui';ctx.fillText('Green: Decisions · Lavender: Jev · scale '+Math.ceil(max)+' ms',12,18);
 ctx.setLineDash([5,5]);ctx.strokeStyle='#d6b879';ctx.beginPath();ctx.moveTo(12,140-(settings?.deadlineMs||2000)/max*105);ctx.lineTo(980,140-(settings?.deadlineMs||2000)/max*105);ctx.stroke();ctx.setLineDash([]);
 engines.forEach((e,j)=>{ctx.fillStyle=j?'#c1a7df':'#91c7b0';for(const s of samples[e])if(s.ok){ctx.beginPath();ctx.arc(20+(s.sequence-1)*950/Math.max(1,offered-1),140-s.roundTripMs/max*105,4,0,Math.PI*2);ctx.fill();}});
}
function finish(){if(!running&&!pending){$('run-state').textContent='Run complete';$('progress').textContent=offered+' letters offered to both models. Errors and drops count against timely correctness. Export retains settings and every sample.';controls();status();}}
function stop(){running=false;clearTimeout(timer);$('run-state').textContent=pending?'Draining '+pending+' pairs':'Run complete';controls();finish();}
function inputText(c){return settings.contextChars?'Shared background notes (not the current request):\n'+('The garden office opens at nine. Parcels use recycled paper. ').repeat(Math.ceil(settings.contextChars/58)).slice(0,settings.contextChars)+'\n\nCURRENT REQUEST:\n'+c.text:c.text;}
async function decision(engine,c,sequence,arrival){
 const envelope={sequence,born:arrival,state:'pending',choice:null,painted:false};mail[engine].push(envelope);
 const start=performance.now();let sample={engine,sequence,caseId:c.id,expected:c.expected,deadlineMs:settings.deadlineMs,ok:false};
 try{
 const r=await fetch('/api/decision',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({demo:'postoffice',engine,text:inputText(c)})});
 const result=await r.json(),completed=performance.now();budget(result.budget);
 sample={...sample,...result,status:r.status,roundTripMs:completed-start,arrivalToResponseMs:completed-arrival,ok:r.ok&&QUEUES.includes(result.choice),onTime:r.ok&&completed-arrival<=settings.deadlineMs};
 if(!sample.ok)sample.error=result.error||'Invalid response';
 }catch(e){sample.error=e.message;sample.roundTripMs=performance.now()-start;sample.onTime=false;sample.status=0;}
 sample.correct=sample.ok&&sample.choice===c.expected;
 envelope.state=sample.ok?'routed':'error';envelope.choice=sample.choice;envelope.onTime=sample.onTime;envelope.correct=sample.correct;envelope.resultAt=performance.now();envelope.sample=sample;
 samples[engine].push(sample);$(engine+'-latest').textContent='#'+sequence+' · '+(sample.ok?sample.choice+(sample.onTime?'':' · late'):'failed')+' · '+ms(sample.roundTripMs);
 update();return sample;
}
function offer(){
 if(!running)return;
 const sequence=++offered,c=CASES[(sequence-1)%CASES.length],arrival=performance.now();
 $('letter-id').textContent='#'+sequence+' · '+c.id;$('letter-text').textContent=c.text;
 if(pending>=settings.concurrency){
 for(const engine of engines){samples[engine].push({engine,sequence,caseId:c.id,expected:c.expected,ok:false,skipped:true,onTime:false,estimatedUsd:0});mail[engine].push({sequence,born:arrival,state:'dropped',resultAt:arrival,painted:true,counted:true});deliveries[engine][4]++;}
 update();
 }else{
 pending++;const order=sequence%2?engines:[...engines].reverse();
 Promise.allSettled(order.map(e=>decision(e,c,sequence,arrival))).then(()=>{pending--;controls();finish();});
 }
 $('progress').textContent=offered+' / '+settings.count+' letters · '+pending+' pairs in flight';
 if(offered>=settings.count){stop();return;}
 timer=setTimeout(offer,1000/settings.rate);
}
function start(overrides={}){
 if(running||pending||!configured)return false;
 settings={rate:Number($('rate').value),deadlineMs:Number($('deadline').value),concurrency:Number($('post-concurrency').value),contextChars:Number($('context').value),count:Number($('case-count').value),...overrides};
 if(!Number.isFinite(settings.rate)||settings.rate<.2||settings.rate>4||!Number.isInteger(settings.count)||settings.count<1||settings.count>48||![1,2,3].includes(settings.concurrency)||![0,1000,4000].includes(settings.contextChars)||settings.deadlineMs<100||settings.deadlineMs>10000)throw Error('Invalid run settings');
 samples.decisions.length=0;samples.jev.length=0;for(const e of engines){mail[e].length=0;deliveries[e].fill(0);}
 offered=0;running=true;startedAt=new Date().toISOString();runId=crypto.randomUUID();$('run-state').textContent='Live paired requests';controls();update();offer();return true;
}
function rounded(ctx,x,y,w,h,r){ctx.beginPath();ctx.roundRect(x,y,w,h,r);ctx.fill();}
function draw(engine,now){
 const ctx=$(engine+'-stage').getContext('2d');ctx.clearRect(0,0,640,400);
 const sky=ctx.createLinearGradient(0,0,0,400);sky.addColorStop(0,'#263d37');sky.addColorStop(1,'#496b44');ctx.fillStyle=sky;ctx.fillRect(0,0,640,400);
 // The plush clerk uses the approved R1 artwork; sorting is driven only by API results.
 ctx.fillStyle='#365c3c';for(let i=0;i<9;i++){ctx.beginPath();ctx.arc(i*85+10,100+Math.sin(i)*12,50,0,Math.PI*2);ctx.fill();}
 ctx.fillStyle='#263a2b';rounded(ctx,18,246,604,130,16);
 ctx.font='bold 15px system-ui';ctx.textAlign='center';
 for(let i=0;i<5;i++){const x=28+i*122;ctx.fillStyle=i<4?colors[i]:'#a6b3aa';rounded(ctx,x,268,108,78,10);ctx.fillStyle='#26382e';ctx.fillRect(x+12,282,84,8);ctx.fillText(i<4?['Billing','Tech','Sales','Review'][i]:'Late / error',x+54,314);ctx.fillText(deliveries[engine][i],x+54,336);}
 if(atlas){const bob=matchMedia('(prefers-reduced-motion: reduce)').matches?0:Math.sin(now/850)*3;ctx.drawImage(atlas,0,0,atlas.width/3,atlas.height/2,228,24+bob,184,184);}
 ctx.fillStyle='#d4c09a';rounded(ctx,22,218,596,36,9);ctx.fillStyle='#20382a';ctx.fillText(engine==='jev'?'Jev’s garden counter':'Decisions’ garden counter',320,241);
 for(const m of mail[engine]){
 let x=88+(m.sequence%5)*16,y=152,alpha=1;
 if(m.state==='pending'){y+=Math.sin(now/160+m.sequence)*5;}
 else{
 const p=Math.min(1,(now-m.resultAt)/500),index=m.state==='routed'&&m.onTime?QUEUES.indexOf(m.choice):4;
 x+=(82+index*122-x)*p;y+=(282-y)*p;alpha=1-p*.45;
 if(!m.painted){m.painted=true;if(m.sample)m.sample.firstPaintMs=performance.now()-m.born;}
 if(p===1&&!m.counted){m.counted=true;deliveries[engine][index]++;}
 if(p===1)continue;
 }
 ctx.save();ctx.globalAlpha=alpha;ctx.fillStyle=m.state==='routed'&&!m.correct?'#e4a198':'#fff1d4';rounded(ctx,x-24,y-16,48,32,4);ctx.strokeStyle='#957b52';ctx.beginPath();ctx.moveTo(x-24,y-16);ctx.lineTo(x,y+3);ctx.lineTo(x+24,y-16);ctx.stroke();ctx.fillStyle='#4a4933';ctx.font='11px system-ui';ctx.fillText(m.sequence,x,y+11);ctx.restore();
 }
 mail[engine]=mail[engine].filter(m=>m.state==='pending'||now-m.resultAt<1000);
}
function frame(now){for(const e of engines)draw(e,now);requestAnimationFrame(frame);}
function report(){return {runId,startedAt,exportedAt:new Date().toISOString(),models:ENGINES,transport:'Vercel AI Gateway /v1/decisions',settings,offered,summary:Object.fromEntries(engines.map(e=>[e,postSummary(samples[e])])),samples,method:'Same input and choices; paired concurrent dispatch, alternating dispatch order. No retries in this app. Late responses measured; hard abort at 20s. Synthetic labeled dataset; repeated cases not independent. First paint excludes animation completion. Gateway/provider overhead included.'};}
function exportResults(){
 const data=report();const quote=v=>'"'+String(v??'').replaceAll('"','""')+'"';
 const columns=['engine','sequence','caseId','expected','choice','ok','onTime','skipped','status','roundTripMs','apiMs','firstPaintMs','inputTokens','estimatedUsd','costSource'];
 const csv=[columns.join(','),...engines.flatMap(e=>samples[e].map(s=>columns.map(k=>quote(s[k])).join(',')))].join('\r\n');
 for(const [ext,text,type]of[['json',JSON.stringify(data,null,2),'application/json'],['csv',csv,'text/csv']]){const url=URL.createObjectURL(new Blob([text],{type})),a=document.createElement('a');a.href=url;a.download='garden-postoffice-'+runId+'.'+ext;a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);}
}
for(const id of ['rate','deadline'])$(id).addEventListener('input',dials);
$('post-start').onclick=()=>start();$('post-stop').onclick=stop;$('post-export').onclick=exportResults;
document.addEventListener('visibilitychange',()=>{if(document.hidden&&running)stop();});
window.__postoffice={start,stop,samples,report,get ready(){return ready;},get running(){return running;},get pending(){return pending;},get deliveries(){return deliveries;}};
dials();update();await status();
try{atlas=await new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>reject(Error('Maple artwork failed to load'));image.src='/assets/raccoon-emotions.png';});ready=true;controls();}
catch(e){$('progress').textContent=e.message;configured=false;controls();}
requestAnimationFrame(frame);
