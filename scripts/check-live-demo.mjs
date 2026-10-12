import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const child=spawn(process.execPath,['examples/live/serve.mjs'],{env:{...process.env,FOREGATHER_LIVE_PORT:'0'},stdio:['ignore','ignore','pipe']});
let browser;
try {
  const origin=await new Promise((resolve,reject)=>{let text='';child.stderr.on('data',chunk=>{text+=chunk;const match=/listening on (http:\/\/127\.0\.0\.1:\d+)/.exec(text);if(match)resolve(match[1]);});child.on('error',reject);child.on('exit',()=>reject(Error('Demo exited')));setTimeout(()=>reject(Error('Demo startup timed out')),10000).unref();});
  browser=await chromium.launch({headless:true});
  const requests=[],external=[];
  const watch=(page,client)=>page.on('request',r=>{if(!r.url().startsWith(origin))external.push(r.url());if(r.url().includes('/relay/'))requests.push({client,url:r.url(),method:r.method(),body:r.postData()});});
  const host=await browser.newPage(),guest=await browser.newPage();watch(host,'host');watch(guest,'guest');
  await host.goto(origin);await host.locator('#create').click();await host.locator('#offer').waitFor({state:'visible'});
  const link=await host.locator('#link').getAttribute('href'),words=await host.locator('#secret').textContent();
  assert.equal(words.split(' ').length,4);assert.equal(link.includes(words),false);
  await guest.goto(link);await guest.locator('#guest').waitFor({state:'visible'});
  assert.equal(requests.some(r=>r.client==='guest'),false);
  await guest.locator('#code').fill(words);await guest.locator('#pair').click();
  await host.locator('#confirmed').waitFor({state:'visible'});await guest.locator('#confirmed').waitFor({state:'visible'});
  assert.equal(await host.locator('#verification').textContent(),await guest.locator('#verification').textContent());
  assert.equal(await guest.locator('#received').isVisible(),false);
  const plaintext='Synthetic review-only room invitation 🫏';await host.locator('#invitation').fill(plaintext);await host.locator('#transfer').click();
  await guest.locator('#received').waitFor({state:'visible'});assert.equal(await guest.locator('#payload').textContent(),plaintext);
  for(const r of requests){assert.equal(r.url.includes(words),false);assert.equal(r.body?.includes(words)??false,false);assert.equal(r.body?.includes(plaintext)??false,false);}
  // Wrong code cannot establish a channel or release an invitation.
  const wrongHost=await browser.newPage(),wrongGuest=await browser.newPage();watch(wrongHost,'wrongHost');watch(wrongGuest,'wrongGuest');
  await wrongHost.goto(origin);await wrongHost.locator('#create').click();await wrongHost.locator('#offer').waitFor({state:'visible'});
  const wrongLink=await wrongHost.locator('#link').getAttribute('href'),realWords=await wrongHost.locator('#secret').textContent();
  await wrongGuest.goto(wrongLink);await wrongGuest.locator('#guest').waitFor({state:'visible'});
  const wrong=realWords.split(' ');wrong[0]=wrong[0]==='ability'?'able':'ability';await wrongGuest.locator('#code').fill(wrong.join(' '));await wrongGuest.locator('#pair').click();
  await wrongGuest.getByText('Pairing failed or expired. Create a fresh code to retry.',{exact:true}).waitFor();
  await wrongHost.getByText('Pairing failed or expired. Create a fresh code to retry.',{exact:true}).waitFor();
  assert.equal(await wrongGuest.locator('#confirmed').isVisible(),false);assert.equal(await wrongHost.locator('#send').isVisible(),false);
  const route=`${origin}/relay/BwcHBwcHBwcHBwcHBwcHBw/inviter/hello`;
  const write=()=>fetch(route,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify('synthetic')});
  assert.equal((await fetch(route,{method:'POST',headers:{Origin:'https://other.example'},body:'"synthetic"'})).status,403);
  const racing=await Promise.all([write(),write()]);assert.deepEqual(racing.map(r=>r.status).sort(),[201,409]);
  assert.equal((await fetch(route.replace('/hello','/payload'),{method:'POST',headers:{Origin:origin},body:'x'.repeat(24577)})).status,413);
  assert.deepEqual(external,[]);
  console.log(JSON.stringify({passed:true,twoBrowserClients:true,wrongCodeRejected:true,noSecretOrPlaintextAtRelay:true,explicitHandoffAndReview:true,writeOnceRace:true,externalRequests:0,browser:browser.version()}));
} finally {
  await browser?.close();
  if(child.exitCode===null){child.kill('SIGINT');await once(child,'exit');}
}
