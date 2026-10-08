import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDemoServer } from '../server.mjs';
import { postPayload,postSummary,CASES } from '../public/postoffice-core.mjs';
test('post office uses identical prompts without gold labels and counts every offered case',()=>{
 const a=postPayload({engine:'decisions',text:CASES[0].text,expected:'SECRET_GOLD'}),b=postPayload({engine:'jev',text:CASES[0].text,expected:'SECRET_GOLD'});
 assert.notEqual(a.model,b.model);delete a.model;delete b.model;assert.deepEqual(a,b);assert.ok(!JSON.stringify(a).includes('SECRET_GOLD'));
 for(const engine of ['bad','__proto__','constructor'])assert.throws(()=>postPayload({engine,text:'hello'}));
 assert.throws(()=>postPayload({engine:'jev',text:'x'.repeat(12001)}));
 const summary=postSummary([{ok:true,expected:'billing',choice:'billing',onTime:true,roundTripMs:10,estimatedUsd:0.001},{ok:true,expected:'billing',choice:'billing',onTime:false,roundTripMs:500},{ok:false,expected:'billing'},{ok:false,expected:'billing',skipped:true,estimatedUsd:0}]);
 assert.equal(summary.count,4);assert.equal(summary.accuracy,.5);assert.equal(summary.timelyCorrect,.25);assert.equal(summary.p50,255);assert.equal(summary.late,1);assert.equal(summary.errors,1);assert.equal(summary.skipped,1);
 assert.equal(new Set(CASES.map(c=>c.id)).size,24);for(const q of ['billing','technical','sales','review'])assert.equal(CASES.filter(c=>c.expected===q).length,6);
});
test('gateway route works without OpenAI key, settles reported cost, hides secrets and validates responses',async()=>{
 const port=3201,dataDir=await mkdtemp(join(tmpdir(),'post-office-'));let calls=0,payloads=[];
 const app=await createDemoServer({gatewayKey:'private-gateway-test',port,dataDir,attachVoice:false,fetchImpl:async(url,options)=>{
 assert.equal(url,'https://ai-gateway.vercel.sh/v1/decisions');assert.equal(options.headers.Authorization,'Bearer private-gateway-test');
 payloads.push(JSON.parse(options.body));calls++;
 return new Response(JSON.stringify({usage:{input_tokens:100},answers:[{type:'choice',name:'queue',choice:calls===3?'invalid':'billing'}],provider_metadata:{gateway:{cost:'0.0000042',generationId:'test-generation'}}}),{status:200});
 }});await new Promise(r=>app.server.listen(port,'127.0.0.1',r));const base='http://127.0.0.1:'+port;
 try{
 const headers={origin:base,'content-type':'application/json'},send=engine=>fetch(base+'/api/decision',{method:'POST',headers,body:JSON.stringify({demo:'postoffice',engine,text:'Please refund my invoice.',expected:'SECRET_GOLD'})});
 const status=await(await fetch(base+'/api/status')).text();assert.ok(!status.includes('private-gateway-test'));assert.equal(JSON.parse(status).gatewayConfigured,true);
 for(const engine of ['decisions','jev']){const r=await send(engine);assert.equal(r.status,200);const result=await r.json();assert.equal(result.estimatedUsd,.0000042);assert.equal(result.costSource,'gateway');assert.equal(result.engine,engine);}
 assert.equal((await send('jev')).status,422);assert.equal(app.budget.summary().reservedUsd,0);
 const [a,b]=payloads;assert.notEqual(a.model,b.model);assert.deepEqual(a.providerOptions.gateway.only,['openai']);assert.deepEqual(b.providerOptions.gateway.only,['typesafe-ai']);delete a.model;delete b.model;delete a.providerOptions;delete b.providerOptions;assert.deepEqual(a,b);
 assert.equal((await fetch(base+'/api/decision',{method:'POST',headers,body:JSON.stringify({demo:'raccoon',text:'hello'})})).status,503);
 const log=await readFile(join(dataDir,'requests.jsonl'),'utf8');assert.ok(!log.includes('Please refund'));assert.ok(!log.includes('private-gateway'));assert.ok(!log.includes('SECRET_GOLD'));
 }finally{await app.close();}
});
