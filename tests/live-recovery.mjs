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

const report={testedAt:new Date().toISOString(),live:true,checks:[],ready:false};
const browser=await playwright.chromium.launch({headless:true,executablePath});
const page=await browser.newPage({viewport:{width:1440,height:1100}});
const errors=[];page.on('pageerror',error=>errors.push(error.message));
try {
  await page.goto('http://localhost:3087');await page.waitForFunction(()=>window.__lab?.ready);
  await page.locator('#rabbit-start').click();
  await page.waitForFunction(()=>!window.__lab.game.running||window.__lab.game.cleared>=5,null,{timeout:30000}).catch(()=>{});
  const running=await page.evaluate(()=>window.__lab.game.running);
  if(running)await page.locator('#rabbit-stop').click();
  await page.waitForFunction(()=>window.__lab.game.pending===0);
  Object.assign(report,await page.evaluate(()=>({state:document.getElementById('rabbit-state').textContent,samples:window.__lab.samples.rabbit,summary:window.__lab.summarize(window.__lab.samples.rabbit),cleared:window.__lab.game.cleared,bumps:window.__lab.game.bumps,toast:document.getElementById('toast').textContent})));
  if(report.state==='Paused: API too slow'){
    const count=report.samples.length;await page.waitForTimeout(1200);assert.equal(await page.evaluate(()=>window.__lab.samples.rabbit.length),count);
    report.checks.push({name:'Live slow API pauses trail and stops new requests',passed:true});
  } else report.ready=report.cleared>=5&&report.bumps===0;
  assert.deepEqual(errors,[]);report.checks.push({name:'No uncaught browser errors',passed:true});
  report.status=await(await fetch('http://localhost:3087/api/status')).json();
  await page.screenshot({path:resolve('evidence/live-recovery.png'),fullPage:true});
}finally{
  await browser.close();await writeFile(resolve('evidence/live-recovery-validation.json'),JSON.stringify(report,null,2));
}
console.log(JSON.stringify(report,null,2));if(!report.ready)process.exitCode=1;
