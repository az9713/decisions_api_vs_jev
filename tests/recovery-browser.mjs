import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { access, readdir, mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createDemoServer } from '../server.mjs';
const require = createRequire(import.meta.url);
let playwright;
try { playwright = require('playwright'); } catch { playwright = require(join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')); }
let executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH;
try { await access(playwright.chromium.executablePath()); } catch {
  const cache=join(process.env.LOCALAPPDATA,'ms-playwright');
  for (const name of (await readdir(cache)).filter(n=>n.startsWith('chromium_headless_shell-')).sort().reverse()) {
    const candidate=join(cache,name,'chrome-headless-shell-win64/chrome-headless-shell.exe');
    try { await access(candidate); executablePath=candidate; break; } catch {}
  }
}
const report={testedAt:new Date().toISOString(),billable:false,checks:[],failures:[],pageErrors:[],providerEvents:[]};
const browser=await playwright.chromium.launch({headless:true,executablePath});
const context=await browser.newContext({viewport:{width:1440,height:1100}});
const page=await context.newPage();
page.on('pageerror',error=>report.pageErrors.push(error.message));
let mode='stall', calls=0;
const fake=async(_url,{signal})=>{
  const call=++calls, start=Date.now();
  const state=await page.evaluate(()=>({lane:window.__lab.game.lane,blocked:window.__lab.game.rows.filter(r=>!r.resolved&&r.y<740).sort((a,b)=>b.y-a.y)[0]?.blocked[0]}));
  const delay=mode==='stall'&&call===1?15000:mode==='out-of-order'&&call===1?450:mode==='pause'?15000:50;
  report.providerEvents.push({mode,call,type:'start',at:start,delay});
  await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve();},delay);
    function abort(){clearTimeout(timer);report.providerEvents.push({mode,call,type:'abort',waitMs:Date.now()-start});reject(signal.reason);}
    if(signal.aborted)abort();else signal.addEventListener('abort',abort,{once:true});
  });
  report.providerEvents.push({mode,call,type:'complete',waitMs:Date.now()-start});
  return new Response(JSON.stringify({usage:{input_tokens:100},answers:[{type:'choice',name:'rabbit_path',choice:String(state.lane+1)},{type:'choice',name:'log_path',choice:state.blocked===undefined?'none':String(state.blocked+1)}]}),{status:200,headers:{'openai-processing-ms':'1'}});
};
const port=3201;
const app=await createDemoServer({key:'private-regression-key',port,dataDir:await mkdtemp(join(tmpdir(),'rabbit-recovery-')),fetchImpl:fake});
await new Promise(r=>app.server.listen(port,'127.0.0.1',r));
const check=async(name,fn)=>{try{const detail=await fn();report.checks.push({name,passed:true,detail});console.log('PASS '+name+': '+JSON.stringify(detail));}catch(error){report.failures.push({name,error:error.message});console.log('FAIL '+name+': '+error.message);}};
try {
  await page.goto('http://127.0.0.1:'+port+'/legacy-rabbit.html');await page.waitForFunction(()=>window.__lab?.ready);
  await check('15-second upstream stall expires and fresh frame dodges the log',async()=>{
    const started=Date.now();
    await page.locator('#rabbit-start').click();
    await page.waitForFunction(()=>window.__lab.samples.rabbit.some(s=>s.applied&&s.choice==='left'),null,{timeout:4000});
    const freshAfterMs=Date.now()-started;
    assert.ok(freshAfterMs<2500,'Fresh capture did not recover promptly');
    assert.ok(report.providerEvents.some(e=>e.call===1&&e.type==='abort'&&e.waitMs<1500));
    await page.waitForFunction(()=>window.__lab.game.cleared>=1,null,{timeout:5000});
    await page.locator('#rabbit-stop').click();await page.waitForFunction(()=>window.__lab.game.pending===0);
    const result=await page.evaluate(()=>({cleared:window.__lab.game.cleared,bumps:window.__lab.game.bumps,samples:window.__lab.samples.rabbit,lastApplied:window.__lab.game.lastApplied,footer:document.getElementById('last-action').textContent}));
    const expired=result.samples.find(s=>s.cancelled&&s.stale==='frame expired');
    assert.ok(expired);assert.equal(expired.applied,undefined);assert.equal(expired.roundTripMs,undefined);assert.equal(expired.onTime,false);assert.equal(result.bumps,0);
    const before={sequence:result.lastApplied,footer:result.footer};
    await page.waitForTimeout(Math.max(0,15500-(Date.now()-started)));
    const after=await page.evaluate(()=>({sequence:window.__lab.game.lastApplied,footer:document.getElementById('last-action').textContent}));
    assert.deepEqual(after,before,'Old reply overwrote the last applied action');
    return {injectedDelayMs:15000,expiredWaitMs:expired.observedWaitMs,freshAfterMs,cleared:result.cleared,bumps:result.bumps,oldReplyCouldNotOverwrite:true};
  });
  await check('resolved logs disappear from both displayed and captured canvas',async()=>{
    const pixels=await page.evaluate(()=>{
      const lab=window.__lab;lab.resetGarden();const row={id:999,y:500,blocked:[0],types:[1,1,1],resolved:false};lab.game.rows=[row];lab.drawGarden();
      const ctx=document.getElementById('garden').getContext('2d'),region=()=>Array.from(ctx.getImageData(50,430,220,140).data).join(',');
      const before=region();row.resolved=true;lab.drawGarden();const resolved=region();lab.game.rows=[];lab.drawGarden();return {beforeDiffers:before!==resolved,resolvedMatchesEmpty:resolved===region()};
    });
    assert.equal(pixels.beforeDiffers,true);assert.equal(pixels.resolvedMatchesEmpty,true);return pixels;
  });
  await check('out-of-order successful replies cannot overwrite newer applied frame',async()=>{
    mode='out-of-order';calls=0;
    await page.evaluate(()=>{const lab=window.__lab;lab.resetGarden();lab.game.rows[0].blocked=[0];document.getElementById('interval').value='200';document.getElementById('concurrency').value='2';lab.drawGarden();lab.startGarden();});
    await page.waitForFunction(()=>window.__lab.samples.rabbit.some(s=>s.stale==='out of order'),null,{timeout:3000});
    const result=await page.evaluate(()=>{const lab=window.__lab,stale=lab.samples.rabbit.find(s=>s.stale==='out of order');return {stale,latest:lab.game.lastApplied,footer:document.getElementById('last-action').textContent};});
    assert.ok(result.latest>result.stale.sequence);assert.equal(result.stale.applied,undefined);
    await page.locator('#rabbit-stop').click();await page.waitForFunction(()=>window.__lab.game.pending===0);return {discardedSequence:result.stale.sequence,lastAppliedSequence:result.latest};
  });
  await check('reset cancels pending transport and preserves reset footer',async()=>{
    mode='pause';calls=0;await page.locator('#rabbit-reset').click();await page.locator('#rabbit-start').click();
    await page.waitForFunction(()=>window.__lab.game.pending>0);await page.waitForTimeout(60);
    await page.locator('#rabbit-reset').click();await page.waitForFunction(()=>window.__lab.game.pending===0);
    assert.equal(await page.locator('#last-action').textContent(),'—');
    assert.equal(await page.evaluate(()=>window.__lab.game.running),false);
    assert.ok(report.providerEvents.some(e=>e.mode==='pause'&&e.type==='abort'));
    return {pending:0,footer:'—',providerAborted:true};
  });
  await check('hidden-page event pauses motion and cancels pending work',async()=>{
    mode='pause';calls=0;await page.locator('#rabbit-start').click();await page.waitForFunction(()=>window.__lab.game.pending>0);await page.waitForTimeout(60);
    await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));delete document.hidden;});
    await page.waitForFunction(()=>window.__lab.game.pending===0);
    assert.equal(await page.evaluate(()=>window.__lab.game.running),false);
    assert.equal(await page.locator('#rabbit-state').textContent(),'Paused while tab hidden');return {paused:true,pending:0};
  });
  await check('three consecutive expired frames pause instead of continuing blind',async()=>{
    mode='pause';calls=0;await page.locator('#rabbit-reset').click();await page.evaluate(()=>{document.getElementById('concurrency').value='1';document.getElementById('interval').value='500';});await page.locator('#rabbit-start').click();
    await page.waitForFunction(()=>document.getElementById('rabbit-state').textContent==='Paused: API too slow',null,{timeout:5000});await page.waitForFunction(()=>window.__lab.game.pending===0);
    const stoppedCalls=calls;await page.waitForTimeout(1200);assert.equal(calls,stoppedCalls);assert.equal(stoppedCalls,3);assert.equal(await page.evaluate(()=>window.__lab.game.bumps),0);
    return {expiredFrames:3,paused:true,bumps:0,noFurtherRequests:true};
  });
  await page.screenshot({path:resolve('evidence/recovery-browser.png'),fullPage:true});
  await check('cancellations are explicit and excluded from completed latency quantiles',async()=>{
    const result=await page.evaluate(()=>({summary:window.__lab.summarize(window.__lab.samples.rabbit),samples:window.__lab.samples.rabbit}));
    assert.ok(result.summary.expired>=1);assert.ok(result.summary.cancelled>=3);assert.equal(result.summary.errors,0);
    assert.ok(result.summary.p95<1000);assert.ok(result.samples.filter(s=>s.cancelled).every(s=>s.censored&&!Number.isFinite(s.roundTripMs)));
    report.samples=result.samples;report.summary=result.summary;return result.summary;
  });
  await check('no uncaught browser errors',async()=>{assert.deepEqual(report.pageErrors,[]);return {count:0};});
} finally {
  try { await page.evaluate(()=>window.__lab?.stopGarden()); } catch {}
  await browser.close();await app.close();await mkdir(resolve('evidence'),{recursive:true});
  await writeFile(resolve('evidence/recovery-validation.json'),JSON.stringify(report,null,2));console.log('Report: evidence/recovery-validation.json');
}
if(report.failures.length)process.exitCode=1;
