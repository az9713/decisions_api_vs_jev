const $=id=>document.getElementById(id);
const cases={
post:[['My card was charged twice.','Billing',0],['The app crashes when I sign in.','Technical',1],['Can I buy a plan for fifty people?','Sales',2],['Please refund my cancelled order.','Billing',0],['Our integration returns an error.','Technical',1],['I need pricing for a new team.','Sales',2]],
emotion:[['It has been a crazy week. Everything went wrong.','concerned',2],['Actually, crazy in a GOOD way. We launched today!','excited',5],['The flowers finally bloomed. So lovely.','delighted',1],['Wait, the rabbit opened the gate itself?','surprised',3],['I wonder which path we should explore.','thoughtful',4],['Let us sit here quietly for a minute.','neutral',0]],
robot:[['Follow the fruit. Objects: apple, gamepad, mug.','apple',0],['Follow the thing used for gaming. Objects: apple, gamepad, mug.','gamepad',1],['Follow the object used for drinking tea. Objects: apple, gamepad, mug.','mug',2],['Follow the apple, not the gamepad. Objects: apple, gamepad, mug.','apple',0]]
};
const contexts={
post:['Choose Billing, Technical, or Sales. Cards here are illustrative fixtures, not API answers.','Latency appears as waiting envelopes. Correct routing and timeliness must both count in the real benchmark.'],
emotion:['Choose one of six expressions for the latest supplied transcript. Voice timing is measured separately.','The raccoon changes when a usable response arrives. An old reaction cannot replace a newer transcript reaction. Faster text updates reveal this visible tradeoff.'],
robot:['Choose a target object ID from the same supplied object descriptions. Shared code controls the head.','This is semantic object selection over text. The illustration does not compare image understanding. Tracking error also depends on the shared controller and object motion.']
};
const atlas=new Image();atlas.src='/assets/raccoon-emotions.png';
let time=0,last=performance.now(),next=0,index=0,playing=true,scenario='post';
let streams=[[],[]],applied=[null,null],results=[{timely:0,missed:0},{timely:0,missed:0}],total=0;
function reset(){time=0;next=0;index=0;streams=[[],[]];applied=[null,null];results=[{timely:0,missed:0},{timely:0,missed:0}];total=0;last=performance.now();$('input').textContent='The next shared case will appear here.';}
function controls(){for(const id of ['rate','deadline','jev','decisions'])$(id+'-value').textContent=$(id).value+(id==='rate'?' / s':' ms');$('task').textContent=contexts[scenario][0];$('meaning').textContent=contexts[scenario][1];}
for(const id of ['rate','deadline','jev','decisions'])$(id).addEventListener('input',controls);
$('scenario').addEventListener('change',()=>{scenario=$('scenario').value;reset();controls();});
$('reset').addEventListener('click',reset);
$('pause').addEventListener('click',()=>{playing=!playing;$('pause').textContent=playing?'Pause':'Play';});
function rounded(ctx,x,y,w,h,r,fill){ctx.fillStyle=fill;ctx.beginPath();ctx.roundRect(x,y,w,h,r);ctx.fill();}
function text(ctx,value,x,y,color='#d8e8ca',size=17){ctx.fillStyle=color;ctx.font=size+'px system-ui';ctx.fillText(value,x,y);}
function dispatch(){
 const fixture=cases[scenario][index%cases[scenario].length];const id=++total;
 $('input').textContent=fixture[0];
 for(let s=0;s<2;s++)streams[s].push({id,fixture,start:time,delay:Number($(s?'decisions':'jev').value),deadline:Number($('deadline').value),done:false,settled:false});
 index++;next=time+1000/Number($('rate').value);
}
function settle(s){
 for(const job of streams[s]){
  const age=time-job.start;
  if(!job.settled&&(age>=job.delay||age>=job.deadline)){
   job.settled=true;
   const stale=scenario!=='post'&&job.id<total;
   job.good=job.delay<=job.deadline&&!stale;
   if(job.good){results[s].timely++;applied[s]=job;}else results[s].missed++;
  }
  if(age>=job.delay)job.done=true;
 }
 streams[s]=streams[s].filter(j=>time-j.start<Math.max(j.deadline,j.delay)+3500);
}
function envelope(ctx,x,y,fill){rounded(ctx,x-25,y-16,50,32,4,fill);ctx.strokeStyle='#6f644c';ctx.lineWidth=1.5;ctx.beginPath();ctx.moveTo(x-25,y-16);ctx.lineTo(x,y+1);ctx.lineTo(x+25,y-16);ctx.stroke();}
function post(ctx,s){
 text(ctx,'Identical messages → classification → animated delivery',22,28,'#b4caab',15);
 ctx.strokeStyle='#506b50';ctx.lineWidth=7;ctx.beginPath();ctx.moveTo(30,120);ctx.lineTo(470,120);ctx.stroke();
 const labels=['Billing','Technical','Sales'];labels.forEach((v,i)=>{rounded(ctx,520,48+i*94,118,72,12,'#294331');text(ctx,v,531,78+i*94,'#dfedcc',16);text(ctx,'Inbox',531,101+i*94,'#9db793',12);});
 for(const job of streams[s]){
  const age=time-job.start,flight=Math.min(1,age/Math.max(250,job.deadline));
  let x=45+flight*400,y=120;
  if(job.settled){const p=Math.min(1,Math.max(0,age-Math.min(job.delay,job.deadline))/700);x=445+(job.good?125:0)*p;y=120+((job.good?83+job.fixture[2]*94:305)-120)*p;}
  if(age>Math.min(job.delay,job.deadline)+1300)continue;
  envelope(ctx,x,y,job.settled?(job.good?'#b8d59c':'#c59680'):'#e4d8b1');text(ctx,'#'+job.id,x-13,y+5,'#273625',11);
 }
 rounded(ctx,26,285,450,44,8,'#362c26');text(ctx,'Late / stale answers stay visible as misses',40,313,'#d4b6a1',14);
}
function raccoon(ctx,s){
 const job=applied[s],i=job?job.fixture[2]:0;
 if(atlas.complete&&atlas.naturalWidth){const w=atlas.width/3,h=atlas.height/2;const bob=Math.sin(time/450)*4;ctx.drawImage(atlas,i%3*w,Math.floor(i/3)*h,w,h,190,38+bob,280,280);}
 text(ctx,job?job.fixture[1]:'neutral',30,42,'#daedcc',22);
 text(ctx,'Last applied: '+(job?'case #'+job.id:'awaiting a timely reaction'),30,338,'#b3c9a9',16);
}
function robot(ctx,s){
 const objectXs=[0,1,2].map(i=>90+i*210+Math.sin(time/900+i*2)*50);
 objectXs.forEach((x,i)=>{ctx.save();ctx.translate(x,82);if(i===0){ctx.fillStyle='#b86a56';ctx.beginPath();ctx.ellipse(0,0,25,22,0,0,7);ctx.fill();ctx.fillStyle='#a5c682';ctx.fillRect(-3,-32,5,13);}else if(i===1){rounded(ctx,-38,-17,76,36,12,'#8ba7ba');text(ctx,'+',-27,7,'#25342d',23);text(ctx,'••',8,4,'#25342d',18);}else{rounded(ctx,-22,-23,44,47,5,'#ddc69f');ctx.strokeStyle='#ddc69f';ctx.lineWidth=5;ctx.beginPath();ctx.arc(27,0,14,-1.6,1.6);ctx.stroke();}ctx.restore();text(ctx,['apple','gamepad','mug'][i],x-28,125,'#bfd0b6',14);});
 const selected=applied[s]?.fixture[2],gaze=selected===undefined?330:objectXs[selected];
 ctx.strokeStyle='#9ec891';ctx.lineWidth=2;ctx.setLineDash([5,6]);ctx.beginPath();ctx.moveTo(330,205);ctx.lineTo(gaze,110);ctx.stroke();ctx.setLineDash([]);
 const angle=(gaze-330)/700;ctx.save();ctx.translate(330,240);ctx.rotate(angle);rounded(ctx,-75,-56,150,110,44,'#b8c4a9');ctx.fillStyle='#e0e5ce';ctx.beginPath();ctx.ellipse(0,1,51,38,0,0,7);ctx.fill();for(const x of [-24,24]){ctx.fillStyle='#334737';ctx.beginPath();ctx.arc(x+(gaze-330)/45,-7,9,0,7);ctx.fill();}ctx.restore();text(ctx,'Selected: '+(applied[s]?.fixture[1]||'awaiting a target'),24,339,'#d7e6c9',17);
}
function draw(s){
 const ctx=$(s?'b':'a').getContext('2d');ctx.clearRect(0,0,660,360);
 if(scenario==='post')post(ctx,s);else if(scenario==='emotion')raccoon(ctx,s);else robot(ctx,s);
 const stat=results[s];$(s?'b-metrics':'a-metrics').textContent='Illustrative: '+stat.timely+' timely · '+stat.missed+' late / stale · '+Math.max(0,total-stat.timely-stat.missed)+' pending';
}
function animation(now){const delta=Math.min(100,now-last);last=now;if(playing&&!document.hidden){time+=delta;if(time>=next)dispatch();settle(0);settle(1);}draw(0);draw(1);requestAnimationFrame(animation);}
window.__concept={reset,get scenario(){return scenario;},get time(){return time;},get total(){return total;},get results(){return results;},get playing(){return playing;}};
reset();controls();requestAnimationFrame(animation);
