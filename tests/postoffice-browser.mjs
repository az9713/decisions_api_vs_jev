import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { access,readdir,mkdir,writeFile } from 'node:fs/promises';
import { join,resolve } from 'node:path';
import { CASES } from '../public/postoffice-core.mjs';
const require=createRequire(import.meta.url);let pw;try{pw=require('playwright');}catch{pw=require(join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));}
let executablePath;try{await access(pw.chromium.executablePath());}catch{for(const d of (await readdir(join(process.env.LOCALAPPDATA,'ms-playwright'))).filter(d=>d.startsWith('chromium_headless_shell-')).sort().reverse()){const f=join(process.env.LOCALAPPDATA,'ms-playwright',d,'chrome-headless-shell-win64/chrome-headless-shell.exe');try{await access(f);executablePath=f;break;}catch{}}}
const live=process.argv.includes('--live'),browser=await pw.chromium.launch({headless:true,executablePath}),page=await browser.newPage({viewport:{width:1440,height:1100},acceptDownloads:true});
const checks=[],errors=[],seen=[],downloads=[];
page.on('pageerror',e=>errors.push(e.message));page.on('download',d=>downloads.push(d));
if(!live)await page.route('**/api/status',async route=>{const response=await route.fetch();const body=await response.json();await route.fulfill({json:{...body,keyConfigured:true,gatewayConfigured:true}});});
if(!live)await page.route('**/api/decision',async route=>{
 const body=route.request().postDataJSON();seen.push(body);
 const index=CASES.findIndex(c=>body.text.endsWith(c.text)),c=CASES[index];assert.ok(c);assert.equal(body.expected,undefined);
 const delay=body.engine==='jev'?350:60;await new Promise(r=>setTimeout(r,delay));
 const wrong=body.engine==='decisions'&&index===0;
 const error=body.engine==='jev'&&index===3;
 await route.fulfill({status:error?502:200,contentType:'application/json',body:JSON.stringify(error?{error:'Fixture transport error'}:{choice:wrong?'sales':c.expected,apiMs:delay,inputTokens:100,estimatedUsd:.00001,costSource:'fixture'})});
});
try{
 await page.goto('http://127.0.0.1:3087/');await page.waitForFunction(()=>window.__postoffice?.ready);
 assert.equal(await page.locator('#key-status').innerText(),'Gateway key configured');checks.push('Home renders and configured gateway enables controls');
 if(live){
 await page.evaluate(()=>window.__postoffice.start({count:24,rate:1,concurrency:3,deadlineMs:2000}));
 }else{
 await page.evaluate(()=>window.__postoffice.start({count:8,rate:4,concurrency:1,deadlineMs:100,contextChars:1000}));
 assert.equal(await page.locator('#rate').isDisabled(),true);
 }
 await page.waitForFunction(()=>!window.__postoffice.running&&!window.__postoffice.pending,{},{timeout:60000});
 await page.waitForTimeout(650);
 const report=await page.evaluate(()=>window.__postoffice.report());
 assert.equal(report.samples.decisions.length,report.offered);assert.equal(report.samples.jev.length,report.offered);
 assert.ok(report.samples.decisions.some(s=>s.ok));assert.ok(report.samples.jev.some(s=>s.ok));checks.push('Both engines return measured choices; every offered letter is counted');
 if(!live){
 assert.ok(report.summary.decisions.skipped>0);assert.equal(report.summary.decisions.skipped,report.summary.jev.skipped);checks.push('Overload drops paired letters symmetrically');
 assert.ok(report.summary.jev.late>0);assert.ok(report.samples.decisions.some(s=>s.ok&&!s.correct));checks.push('Late responses remain measured; wrong routes reduce accuracy');
 for(let i=0;i<seen.length;i+=2){const a={...seen[i]},b={...seen[i+1]};delete a.engine;delete b.engine;assert.deepEqual(a,b);}checks.push('Actual outgoing paired HTTP inputs are identical and omit labels');
 const delivered=await page.evaluate(()=>window.__postoffice.deliveries);for(const e of ['decisions','jev'])assert.equal(delivered[e].reduce((a,b)=>a+b,0),report.offered);checks.push('Envelope animation lands once per letter, including drops and late trays');
 const firstPaint=report.samples.decisions.filter(s=>s.ok);assert.ok(firstPaint.every(s=>Number.isFinite(s.firstPaintMs)&&s.firstPaintMs>=s.arrivalToResponseMs));checks.push('Response-to-visible-animation paint timestamps are recorded');
 await page.click('#post-export');await page.waitForTimeout(200);assert.equal(downloads.length,2);assert.ok(downloads.some(d=>d.suggestedFilename().endsWith('.csv')));checks.push('JSON and CSV exports download');
 await page.evaluate(()=>window.__postoffice.start({count:8,rate:4,concurrency:3,deadlineMs:2000}));
 await page.waitForFunction(()=>!window.__postoffice.running&&!window.__postoffice.pending);
 assert.equal(await page.evaluate(()=>window.__postoffice.report().summary.jev.errors),1);checks.push('Provider failure is visible and reduces timely correctness');
 await page.evaluate(()=>window.__postoffice.start({count:8,rate:4,concurrency:1,deadlineMs:2000}));
 await page.waitForTimeout(80);await page.click('#post-stop');await page.waitForFunction(()=>!window.__postoffice.pending);assert.equal(await page.locator('#post-start').isEnabled(),true);checks.push('Stop drains existing work before enabling a new run');
 }else{
 assert.equal(report.summary.decisions.errors,0);assert.equal(report.summary.jev.errors,0);
 assert.equal(report.summary.decisions.completed,24);assert.equal(report.summary.jev.completed,24);checks.push('Live 24-letter paired benchmark completes without errors or drops');
 for(const engine of ['decisions','jev'])assert.ok(report.samples[engine].every(s=>s.model===report.models[engine]&&s.gateway?.generationId&&Number.isFinite(s.estimatedUsd)));checks.push('Gateway generation IDs, model identities and billable costs verified');
 }
 await page.screenshot({path:resolve('evidence/postoffice-'+(live?'live':'browser')+'.png'),fullPage:true});
 await page.goto('http://127.0.0.1:3087/maple.html');await page.waitForFunction(()=>window.__lab?.ready);
 assert.equal(await page.locator('#raccoon-pane').isVisible(),true);assert.equal(await page.locator('#rabbit-pane').isVisible(),false);assert.equal(await page.locator('#voice-start').isEnabled(),true);checks.push('Maple opens directly with voice controls and approved artwork');
 await page.setViewportSize({width:390,height:850});await page.goto('http://127.0.0.1:3087/');await page.waitForFunction(()=>window.__postoffice?.ready);
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));checks.push('Mobile home has no horizontal overflow');
 assert.deepEqual(errors,[]);
 await mkdir('evidence',{recursive:true});await writeFile('evidence/postoffice-'+(live?'live':'browser')+'-validation.json',JSON.stringify({testedAt:new Date().toISOString(),live,checks,errors,report},null,2));
 console.log(JSON.stringify({live,checks,summary:report.summary},null,2));
}finally{await browser.close();}
