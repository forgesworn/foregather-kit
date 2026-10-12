import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {once} from 'node:events';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const dir=mkdtempSync(join(tmpdir(),'foregather-demo-')),token=randomBytes(32).toString('base64url');
const children=[];let browser;
async function start(command,args,env,pattern){
  const child=spawn(command,args,{env:{...process.env,...env},stdio:['ignore','ignore','pipe']});children.push(child);
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error('Demo startup timed out')),10000);let output='';
    child.stderr.on('data',chunk=>{output+=chunk;const match=output.match(pattern);if(match){clearTimeout(timer);resolve(match[1]);}});
    for(const event of ['error','exit'])child.once(event,()=>{clearTimeout(timer);reject(Error('Demo process failed'));});
  });
}
try {
  const address=await start(fileURLToPath(new URL('../target/debug/foregather-server',import.meta.url)),[],{FOREGATHER_DB:join(dir,'db'),FOREGATHER_BIND:'127.0.0.1:0',FOREGATHER_CREATE_TOKEN:token},/listening on (127\.0\.0\.1:\d+)/);
  const origin=await start(process.execPath,[fileURLToPath(new URL('../examples/browser/serve.mjs',import.meta.url))],{FOREGATHER_RESOLVER_URL:`http://${address}`,FOREGATHER_CREATE_TOKEN:token,FOREGATHER_DEMO_PORT:'0'},/demo listening on (http:\/\/127\.0\.0\.1:\d+)/);
  browser=await chromium.launch({headless:true});
  const owner=await browser.newPage();await owner.goto(origin);
  await owner.locator('#payload').fill('Synthetic invitation: 🫏');
  await owner.locator('#create').click();
  await owner.waitForFunction(()=>document.getElementById('share').value.includes('#'));
  const shared=await owner.locator('#share').inputValue();
  const guest=await browser.newPage();let fetched=0,external=0;
  guest.on('request',req=>{if(req.url().includes('/v1/invitations/'))fetched++;if(!req.url().startsWith(origin))external++;});
  await guest.goto(shared);await guest.locator('#review').waitFor();
  await guest.waitForFunction(()=>!document.getElementById('review').disabled);
  assert.equal(fetched,0);assert.equal(await guest.locator('#candidate').textContent(),'');
  await guest.locator('#review').click();
  await guest.waitForFunction(()=>document.getElementById('candidate').textContent==='Synthetic invitation: 🫏');
  assert.equal(fetched,1);assert.equal(external,0);
  await owner.locator('#remove').click();
  await owner.waitForFunction(()=>document.getElementById('share').value==='');
  await guest.locator('#review').click();
  await guest.waitForFunction(()=>document.getElementById('status').textContent.includes('could not'));
  assert.equal(await guest.locator('#candidate').textContent(),'');
  // The local operator proxy refuses an outside origin even if a native caller spoofs Host.
  const refused=await fetch(`${origin}/v1/invitations`,{method:'POST',headers:{Origin:'https://outside.example','Content-Type':'application/json'},body:'{}'});
  assert.equal(refused.status,403);
  console.log(JSON.stringify({passed:true,twoBrowserClients:true,noFetchBeforeReview:true,externalRequests:0,deletionObserved:true,outsideOriginRejected:true}));
} finally {
  await browser?.close();
  for(const child of children.reverse())if(child.pid&&child.exitCode===null&&child.signalCode===null){const exit=once(child,'exit');child.kill('SIGINT');await exit;}
  rmSync(dir,{recursive:true,force:true});
}
