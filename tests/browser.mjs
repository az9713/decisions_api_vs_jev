import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile, access, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { summarize } from '../public/core.mjs';
const require = createRequire(import.meta.url);
let playwright;
try { playwright = require('playwright'); } catch { playwright = require(join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')); }
const live = process.argv.includes('--live'), voiceOnly = process.argv.includes('--voice-only'), visionOnly = process.argv.includes('--vision-only');
const root = resolve('.'), evidence = resolve('evidence'); await mkdir(evidence,{recursive:true});
const report={testedAt:new Date().toISOString(),live,checks:[],failures:[],consoleErrors:[],samples:{rabbit:[],raccoon:[]},voiceRuns:[]};
let executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH;
try { await access(playwright.chromium.executablePath()); } catch {
  const cache=join(process.env.LOCALAPPDATA,'ms-playwright');
  for (const directory of (await readdir(cache)).filter(d=>d.startsWith('chromium_headless_shell-')).sort().reverse()) {
    const candidate=join(cache,directory,'chrome-headless-shell-win64/chrome-headless-shell.exe');try{await access(candidate);executablePath=candidate;break;}catch{}
  }
}
const browser = await playwright.chromium.launch({headless:true,executablePath,args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream',`--use-file-for-fake-audio-capture=${resolve('tests/voice-fixture.wav')}`,'--autoplay-policy=no-user-gesture-required']});
const context = await browser.newContext({viewport:{width:1440,height:1100},permissions:['microphone']}); const page=await context.newPage();
page.on('pageerror',error=>report.consoleErrors.push(error.message));
page.on('console',message=>{if(message.type()==='error') report.consoleErrors.push(message.text());});
let frameNumber=0;
if(live) page.on('request',async request=>{if(request.url().endsWith('/api/decision')){const input=request.postDataJSON();if(input?.demo==='rabbit'&&await page.evaluate(()=>window.__lab.game.benchmark)){const number=++frameNumber;const path=join(evidence,'vision-frames');await mkdir(path,{recursive:true});await writeFile(join(path,`frame-${String(number).padStart(2,'0')}.jpg`),Buffer.from(input.image.split(',')[1],'base64'));}}});
const check=async(name,fn)=>{try{const detail=await fn();report.checks.push({name,passed:true,detail});console.log(`PASS ${name}${detail?': '+JSON.stringify(detail):''}`);}catch(error){report.failures.push({name,error:error.message});console.log(`FAIL ${name}: ${error.message}`);}};
if (!live) await page.route('**/api/decision',async route=>{const input=route.request().postDataJSON();await new Promise(r=>setTimeout(r,180));await route.fulfill({contentType:'application/json',body:JSON.stringify({choice:input.demo==='rabbit'?'left':'delighted',status:200,apiMs:170,processingMs:100,inputTokens:100,estimatedUsd:.00001})});});
try {
  await page.goto('http://localhost:3087'+(voiceOnly?'/maple.html':'/legacy-rabbit.html')); await page.waitForFunction(()=>window.__lab?.ready);
  await check('artwork and default controls',async()=>{assert.equal(await page.locator('#garden').getAttribute('width'),'640');assert.equal(await page.locator('#rabbit-start').isEnabled(),true);return {artworkLoaded:true};});
  if (!voiceOnly) {
    await check('rabbit controls and paused replies',async()=>{
      await page.locator('#rabbit-start').click(); await page.waitForFunction(()=>window.__lab.game.pending>0); await page.locator('#rabbit-stop').click(); await page.waitForFunction(()=>window.__lab.game.pending===0,null,{timeout:30000});
      const info=await page.evaluate(()=>({lane:window.__lab.game.lane,running:window.__lab.game.running,sample:window.__lab.samples.rabbit.at(-1)})); assert.equal(info.running,false);assert.equal(info.lane,1);assert.equal(info.sample.applied,undefined);assert.equal(info.sample.stale,'run ended');return {discardedAfterPause:true};
    });
    if (live) {
      await check('18 frozen vision frames at three resolutions',async()=>{await page.locator('#vision-benchmark').click();await page.waitForFunction(()=>window.__lab.samples.rabbit.filter(x=>x.mode==='vision-benchmark').length===18&&!window.__lab.game.benchmark,null,{timeout:240000});const rows=await page.evaluate(()=>window.__lab.samples.rabbit.filter(x=>x.mode==='vision-benchmark'));assert.equal(rows.filter(x=>x.ok).length,18);return {calls:rows.length,matches:rows.filter(x=>x.correct).length};});
      if (!visionOnly) await check('rabbit moving trail and latency stress',async()=>{
        const stages=[];
        for(const speed of [80,320,640]){
          await page.evaluate(speed=>{window.__lab.resetGarden();document.getElementById('speed').value=String(speed);document.getElementById('speed').dispatchEvent(new Event('input'));document.getElementById('concurrency').value='2';window.__lab.startGarden();},speed);
          await page.waitForTimeout(14000); await page.locator('#rabbit-stop').click();await page.waitForFunction(()=>window.__lab.game.pending===0,null,{timeout:30000});
          stages.push(await page.evaluate(speed=>({speed,cleared:window.__lab.game.cleared,bumps:window.__lab.game.bumps,skipped:window.__lab.game.skipped,summary:window.__lab.summarize(window.__lab.samples.rabbit.filter(s=>s.mode==='trail'&&s.speed===speed))}),speed));
        }
        assert.ok(stages.every(x=>x.summary.successes>0));report.stressStages=stages;return stages;
      });
    } else {
      await check('forward-running trail and animated neighboring jump',async()=>{
        await page.locator('#rabbit-reset').click();await page.locator('#rabbit-start').click();
        await page.waitForFunction(()=>window.__lab.game.jump&&window.__lab.game.distance>0);
        const jumping=await page.evaluate(()=>({distance:window.__lab.game.distance,jump:window.__lab.game.jump,rows:window.__lab.game.rows.map(r=>r.blocked)}));
        assert.ok(jumping.distance>0);assert.notEqual(jumping.jump.from,jumping.jump.to);assert.ok(jumping.rows.every(r=>r.length===1));
        await page.waitForFunction(()=>!window.__lab.game.jump&&window.__lab.game.lane===0);await page.locator('#rabbit-stop').click();return {forwardMotion:true,animatedJump:true,oneLogPerRow:true};
      });
    }
    await page.screenshot({path:join(evidence,live?'rabbit-live.png':'rabbit-browser.png'),fullPage:true});
    await page.locator('[data-tab="raccoon"]').click();
    if(live && !visionOnly) await check('18 scripted expression decisions',async()=>{await page.locator('#emotion-benchmark').click();await page.waitForFunction(()=>window.__lab.samples.raccoon.filter(x=>x.mode==='expression-benchmark').length===18&&!window.__lab.expression.benchmark,null,{timeout:180000});const rows=await page.evaluate(()=>window.__lab.samples.raccoon.filter(x=>x.mode==='expression-benchmark'));assert.equal(rows.filter(x=>x.ok).length,18);return {calls:rows.length,matches:rows.filter(x=>x.correct).length};});
    else if(!live) await check('typed raccoon expression paints',async()=>{await page.locator('#emotion-text').fill('The flowers are lovely today.');await page.locator('#emotion-send').click();await page.waitForFunction(()=>window.__lab.samples.raccoon.length===1);assert.equal(await page.locator('#expression-label').textContent(),'Delighted');return {painted:true};});
  } else {
    await page.locator('[data-tab="raccoon"]').click();
    if(live) await check('18 scripted expression decisions',async()=>{await page.locator('#emotion-benchmark').click();await page.waitForFunction(()=>window.__lab.samples.raccoon.filter(x=>x.mode==='expression-benchmark').length===18&&!window.__lab.expression.benchmark,null,{timeout:180000});const rows=await page.evaluate(()=>window.__lab.samples.raccoon.filter(x=>x.mode==='expression-benchmark'));assert.equal(rows.filter(x=>x.ok).length,18);return {calls:rows.length,matches:rows.filter(x=>x.correct).length};});
  }
  if(live && !visionOnly) await check('real microphone fixture, generated voice, expression and finalized usage',async()=>{
    await page.locator('#voice-start').click();
    await page.waitForFunction(()=>window.__lab.voice?.ready||window.__lab.voiceRuns.length>0,null,{timeout:45000});
    const initial=await page.evaluate(()=>({ready:window.__lab.voice?.ready,toast:document.getElementById('toast').textContent}));assert.equal(initial.ready,true,initial.toast||'voice not ready');
    await page.waitForFunction(()=>window.__lab.voice?.user.length>10&&window.__lab.voice?.assistant.length>5&&window.__lab.samples.raccoon.some(x=>x.mode==='live-voice'&&x.applied),null,{timeout:45000});
    await page.waitForTimeout(18000);
    report.voiceTransport=await page.evaluate(async()=>{const v=window.__lab.voice,stats=await v.peer.getStats();return {inputTranscriptCharacters:v.user.length,outputTranscriptCharacters:v.assistant.length,audioPlaybackSeconds:document.getElementById('voice-audio').currentTime,receivedAudio:[...stats.values()].filter(x=>x.type==='inbound-rtp'&&x.kind==='audio').map(x=>({bytesReceived:x.bytesReceived,packetsReceived:x.packetsReceived,totalAudioEnergy:x.totalAudioEnergy})),events:v.events};});
    assert.ok(report.voiceTransport.receivedAudio.some(x=>x.bytesReceived>0));assert.ok(report.voiceTransport.audioPlaybackSeconds>0);
    await page.locator('#voice-stop').click();await page.waitForFunction(()=>!window.__lab.voice,null,{timeout:25000});const final=await page.evaluate(()=>window.__lab.voiceRuns.at(-1));assert.equal(final.finalized,true);assert.ok(final.seconds>0);return {finalized:true,seconds:final.seconds,transcripts:true,audioReceived:true};
  });
  await page.screenshot({path:join(evidence,live?'raccoon-live.png':'raccoon-browser.png'),fullPage:true});
  await check('exports include measured JSON and CSV',async()=>{const downloads=[];page.on('download',d=>downloads.push(d.suggestedFilename()));await page.locator('[data-export="raccoon"]').click();await page.waitForTimeout(500);assert.equal(downloads.length,2);return downloads;});
  await check('mobile layout has no horizontal overflow',async()=>{await page.setViewportSize({width:390,height:844});await page.waitForTimeout(100);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:join(evidence,'mobile.png'),fullPage:true});return {width:390};});
  Object.assign(report,await page.evaluate(()=>({samples:window.__lab.samples,voiceRuns:window.__lab.voiceRuns})));
  await check('no uncaught browser errors',async()=>{assert.deepEqual(report.consoleErrors,[]);return {count:0};});
} finally {
  try{await page.evaluate(()=>{window.__lab?.stopGarden();window.__lab?.endVoice();});await page.waitForFunction(()=>!window.__lab?.voice,null,{timeout:20000});}catch{}
  report.summaries={rabbit:summarize(report.samples.rabbit),raccoon:summarize(report.samples.raccoon)};
  report.status=await(await fetch('http://localhost:3087/api/status')).json();
  const name=voiceOnly?'voice-validation.json':visionOnly?'vision-validation.json':live?'live-validation.json':'browser-validation.json';await writeFile(join(evidence,name),JSON.stringify(report,null,2));await browser.close();console.log(`Report: evidence/${name}`);
}
if(report.failures.length)process.exitCode=1;
