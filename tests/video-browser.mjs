import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir,writeFile,access } from 'node:fs/promises';
import { join,resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const require=createRequire(import.meta.url);let pw;
try{pw=require('playwright');}catch{pw=require(join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));}
const url=process.argv[2]||pathToFileURL(resolve('docs/index.html')).href;
let executablePath=process.env.PLAYWRIGHT_CHROMIUM_PATH;
if(!executablePath&&process.platform==='win32'){const installed=join(process.env.ProgramFiles||process.env.PROGRAMFILES||'C:/Program Files','Google/Chrome/Application/chrome.exe');try{await access(installed);executablePath=installed;}catch{}}
const browser=await pw.chromium.launch({...(executablePath?{executablePath}:{channel:'chrome'}),headless:true});
try{
 const page=await browser.newPage({viewport:{width:1280,height:1000}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto(url);await page.waitForFunction(()=>document.querySelector('video')?.readyState>=1,{},{timeout:30000});
 const info=await page.locator('video').evaluate(v=>({duration:v.duration,width:v.videoWidth,height:v.videoHeight,controls:v.controls,error:v.error?.message||null}));
 assert.ok(Math.abs(info.duration-44.376)<.1);assert.equal(info.width,1920);assert.equal(info.height,866);assert.equal(info.controls,true);assert.equal(info.error,null);
 await page.locator('video').evaluate(v=>{v.muted=true;return v.play();});await page.waitForFunction(()=>document.querySelector('video').currentTime>1);
 await page.locator('video').evaluate(v=>{v.pause();v.currentTime=30;});await page.waitForFunction(()=>Math.abs(document.querySelector('video').currentTime-30)<.2&&!document.querySelector('video').seeking);
 await page.screenshot({path:resolve('evidence/pages-video-'+(url.startsWith('https')?'live':'local')+'.png'),fullPage:true});
 await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));assert.deepEqual(errors,[]);
 const report={url,testedAt:new Date().toISOString(),info,playbackAdvanced:true,seekTo30Seconds:true,mobileOverflow:false,errors};
 await mkdir('evidence',{recursive:true});await writeFile('evidence/video-'+(url.startsWith('https')?'live':'local')+'-validation.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{await browser.close();}
