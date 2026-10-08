import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDemoServer, decisionPayload, steeringFromPerception } from '../server.mjs';
import { Budget } from '../lib/budget.mjs';
import http from 'node:http';

test('budget serializes concurrent reservations and retains unresolved calls across restarts', async () => {
  const path = join(await mkdtemp(join(tmpdir(),'decisions-budget-')),'ledger.jsonl'); const b = await new Budget(path,.10).load();
  const calls = await Promise.allSettled(Array.from({length:3},()=>b.reserve(.04,'test'))); assert.equal(calls.filter(x=>x.status==='fulfilled').length,2);
  const id = calls.find(x=>x.status==='fulfilled').value; await b.settle(id,.01,'test'); await b.settle(id,.01,'test');
  const reloaded = await new Budget(path,.10).load(); assert.equal(reloaded.summary().estimatedSpentUsd,.01); assert.equal(reloaded.summary().reservedUsd,.04); assert.ok(Math.abs(reloaded.summary().availableUsd-.05)<1e-12);
});
test('expected labels and game state never enter Decisions payloads', () => {
  const payload = decisionPayload({demo:'rabbit',image:'data:image/png;base64,AAAA',expected:'right',lane:2,blocked:[0,1]}); assert.equal(payload.input[0].content.length,2); assert.ok(!JSON.stringify(payload).includes('"expected"')); assert.ok(!JSON.stringify(payload).includes('"blocked"'));
  assert.equal(decisionPayload({demo:'raccoon',text:'Hi',expected:'neutral'}).input,'Hi'); assert.throws(()=>decisionPayload({demo:'rabbit',image:'https://example.com/image.png'}));
});
test('runner policy uses only API visual classifications and obeys outside paths', () => {
  const answers=(rabbit,log)=>[{type:'choice',name:'rabbit_path',choice:rabbit},{type:'choice',name:'log_path',choice:log}];
  assert.equal(steeringFromPerception(answers('1','1')).choice,'right');assert.equal(steeringFromPerception(answers('3','3')).choice,'left');assert.equal(steeringFromPerception(answers('2','2')).choice,'left');assert.equal(steeringFromPerception(answers('1','3')).choice,'stay');assert.equal(steeringFromPerception(answers('2','none')).choice,'stay');assert.throws(()=>steeringFromPerception(answers('invalid','1')));
});
test('local server hides secrets, rejects foreign origins, validates choices, and records only metadata', async () => {
  const dataDir = await mkdtemp(join(tmpdir(),'decisions-server-')); const port=3197; let calls=0;
  const fake = async (_url, options) => { calls++; assert.equal(options.headers.Authorization,'Bearer private-test-key'); const payload=JSON.parse(options.body); assert.equal(payload.model,'gpt-6-luna'); return new Response(JSON.stringify({model:'gpt-6-luna',usage:{input_tokens:100},answers:[{type:'choice',name:'expression',choice:calls===1?'delighted':'invalid'}]}),{status:200,headers:{'openai-processing-ms':'42'}}); };
  const app=await createDemoServer({key:'private-test-key',port,dataDir,fetchImpl:fake}); await new Promise(r=>app.server.listen(port,'127.0.0.1',r)); const base=`http://127.0.0.1:${port}`;
  try {
    for (const path of ['/.env','/server.mjs','/../.env','/assets/../../.env']) assert.equal((await fetch(base+path)).status,404);
    const status=await(await fetch(base+'/api/status')).text(); assert.ok(!status.includes('private-test-key'));
    const headers={'content-type':'application/json',origin:base}, body=JSON.stringify({demo:'raccoon',text:'Private transcript should never be logged.'});
    assert.equal((await fetch(base+'/api/decision',{method:'POST',headers:{...headers,origin:'https://foreign.test'},body})).status,403);
    const first=await(await fetch(base+'/api/decision',{method:'POST',headers,body})).json(); assert.equal(first.choice,'delighted'); assert.equal(first.processingMs,42); assert.equal(first.inputTokens,100);
    assert.equal((await fetch(base+'/api/decision',{method:'POST',headers,body})).status,422); assert.equal(calls,2);
    const log=await readFile(join(dataDir,'requests.jsonl'),'utf8'); assert.ok(!log.includes('Private transcript')); assert.ok(!log.includes('private-test-key')); assert.equal(app.budget.summary().reservedUsd,0);
  } finally { await app.close(); }
});
test('provider failures release known reservations; ambiguous transport failures retain them', async () => {
  const port=3198,dataDir=await mkdtemp(join(tmpdir(),'decisions-errors-')); let call=0;
  const app=await createDemoServer({key:'fake',port,dataDir,fetchImpl:async()=>{ if (++call===1) return new Response(JSON.stringify({error:{code:'rate_limit'}}),{status:429}); throw new Error('network'); }}); await new Promise(r=>app.server.listen(port,'127.0.0.1',r));
  try { const base=`http://127.0.0.1:${port}`, options={method:'POST',headers:{origin:base,'content-type':'application/json'},body:JSON.stringify({demo:'raccoon',text:'Hi'})}; assert.equal((await fetch(base+'/api/decision',options)).status,429); assert.equal(app.budget.summary().reservedUsd,0); assert.equal((await fetch(base+'/api/decision',options)).status,502); assert.equal(app.budget.summary().reservedUsd,.02); } finally {await app.close();}
});
test('expired provider work is aborted, releases capacity, and retains uncertain cost', async () => {
  const port=3199,dataDir=await mkdtemp(join(tmpdir(),'decisions-expiry-'));let calls=0,aborted=false;
  const app=await createDemoServer({key:'fake',port,dataDir,fetchImpl:async(_url,{signal})=>{
    if(++calls===1)return new Promise((resolve,reject)=>{signal.addEventListener('abort',()=>{aborted=true;reject(signal.reason);},{once:true});});
    return new Response(JSON.stringify({usage:{input_tokens:100},answers:[{name:'rabbit_path',type:'choice',choice:'1'},{name:'log_path',type:'choice',choice:'1'}]}),{status:200});
  }});await new Promise(r=>app.server.listen(port,'127.0.0.1',r));const base=`http://127.0.0.1:${port}`;
  const options=limit=>({method:'POST',headers:{origin:base,'content-type':'application/json'},body:JSON.stringify({demo:'rabbit',image:'data:image/png;base64,AAAA',maxAgeMs:limit})});
  try{const started=Date.now();assert.equal((await fetch(base+'/api/decision',options(100))).status,408);assert.ok(Date.now()-started<1500);assert.equal(aborted,true);assert.equal(app.budget.summary().reservedUsd,.02);const fresh=await(await fetch(base+'/api/decision',options(1000))).json();assert.equal(fresh.choice,'right');assert.equal(calls,2);assert.equal((await(await fetch(base+'/api/status')).json()).inFlight,0);}finally{await app.close();}
});
test('browser disconnect aborts provider work instead of leaving an occupied slot', async()=>{
  const port=3200,dataDir=await mkdtemp(join(tmpdir(),'decisions-disconnect-'));let startedResolve,abortedResolve;
  const started=new Promise(r=>startedResolve=r),aborted=new Promise(r=>abortedResolve=r);
  const app=await createDemoServer({key:'fake',port,dataDir,fetchImpl:async(_url,{signal})=>new Promise((resolve,reject)=>{startedResolve();signal.addEventListener('abort',()=>{abortedResolve();reject(signal.reason);},{once:true});})});await new Promise(r=>app.server.listen(port,'127.0.0.1',r));
  try{const request=http.request({hostname:'127.0.0.1',port,path:'/api/decision',method:'POST',headers:{origin:`http://127.0.0.1:${port}`,'content-type':'application/json'}},()=>{});request.on('error',()=>{});request.end(JSON.stringify({demo:'rabbit',image:'data:image/png;base64,AAAA'}));await started;request.destroy();await Promise.race([aborted,new Promise((_,reject)=>setTimeout(()=>reject(new Error('Provider remained active')),1000))]);await new Promise(r=>setTimeout(r,30));assert.equal((await(await fetch(`http://127.0.0.1:${port}/api/status`)).json()).inFlight,0);assert.equal(app.budget.summary().reservedUsd,.02);}finally{await app.close();}
});
