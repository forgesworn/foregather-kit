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
  const watch=(page,client)=>page.on('request',r=>{if(!r.url().startsWith(origin))external.push(r.url());if(r.url().includes('/relay/')||r.url().includes('/rooms'))requests.push({client,url:r.url(),method:r.method(),body:r.postData()});});
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
  // Public-room lookup supports both secret presentations and does not spend a PAKE attempt.
  for(const format of ['words','characters']) {
    const h=await browser.newPage(),g=await browser.newPage();watch(h,`${format}Host`);watch(g,`${format}Guest`);
    await h.goto(origin);await h.locator('#format').selectOption(format);await h.locator('#length').fill('6');
    await h.locator('#create').click();await h.locator('#offer').waitFor({state:'visible'});
    const roomCode=await h.locator('#room-code').textContent(),secret=await h.locator('#secret').textContent();
    assert.match(roomCode,/^[0-9A-HJKMNP-TV-Z]{6}$/);
    if(format==='words')assert.equal(secret.split(' ').length,6);else assert.match(secret,/^[0-9A-HJKMNP-TV-Z]{6}$/);
    await g.goto(origin);await g.locator('#room').fill(roomCode.toLowerCase());await g.locator('#find').click();
    await g.locator('#guest').waitFor({state:'visible'});
    assert.equal(requests.some(r=>r.client===`${format}Guest`&&r.url.includes('/relay/')),false);
    await g.locator('#code').fill(secret);await g.locator('#pair').click();
    await h.locator('#confirmed').waitFor({state:'visible'});await g.locator('#confirmed').waitFor({state:'visible'});
    assert.equal(await h.locator('#verification').textContent(),await g.locator('#verification').textContent());
    const candidate=`Synthetic ${format} room-code handoff`;await h.locator('#invitation').fill(candidate);await h.locator('#transfer').click();
    await g.locator('#received').waitFor({state:'visible'});assert.equal(await g.locator('#payload').textContent(),candidate);
    for(const r of requests.filter(r=>r.client.startsWith(format)))assert.equal(r.body?.includes(secret)??false,false);
  }
  const codeHost=await browser.newPage(),codeGuest=await browser.newPage();
  await codeHost.goto(origin);await codeHost.locator('#format').selectOption('characters');await codeHost.locator('#create').click();await codeHost.locator('#offer').waitFor({state:'visible'});
  const publicCode=await codeHost.locator('#room-code').textContent(),privateCode=await codeHost.locator('#secret').textContent();
  assert.notEqual(publicCode,privateCode);
  await codeGuest.goto(origin);await codeGuest.locator('#room').fill(publicCode);await codeGuest.locator('#find').click();await codeGuest.locator('#guest').waitFor({state:'visible'});
  await codeGuest.locator('#code').fill(publicCode);await codeGuest.locator('#pair').click();
  await codeGuest.getByText('Pairing failed or expired. Create a fresh code to retry.',{exact:true}).waitFor();
  await codeHost.getByText('Pairing failed or expired. Create a fresh code to retry.',{exact:true}).waitFor();
  assert.equal(await codeGuest.locator('#received').isVisible(),false);
  // Directory rejects secrets/foreign creation, expires aliases and bounds reads/allocations.
  const register=room=>fetch(`${origin}/rooms`,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(room)});
  const now=Math.floor(Date.now()/1000),session={profile:'foregather-live/spake2-ed25519/1',namespace:'demo.live',purpose:'invitation',locator:'BwcHBwcHBwcHBwcHBwcHBw',issued:now,expires:now+120};
  const room={session,secretFormat:'characters'};
  assert.equal((await register({...room,secretCode:'ABC234'})).status,400);
  assert.equal((await register({...room,session:{...session,unknown:true}})).status,400);
  assert.equal((await register({...room,session:{...session,namespace:'foreign.app'}})).status,400);
  assert.equal((await fetch(`${origin}/rooms`,{method:'POST',headers:{Origin:'https://other.example'},body:JSON.stringify(room)})).status,403);
  assert.equal((await fetch(`${origin}/rooms`,{method:'POST',headers:{Origin:origin},body:'x'.repeat(1025)})).status,413);
  const short=await register({...room,session:{...session,expires:now+2}});assert.equal(short.status,201);
  const shortCode=(await short.json()).roomCode;
  assert.equal((await fetch(`${origin}/rooms/${shortCode}`)).status,200);
  await new Promise(resolve=>setTimeout(resolve,2100));assert.equal((await fetch(`${origin}/rooms/${shortCode}`)).status,404);
  const allocated=new Set();let refused=false;
  for(let i=0;i<65;i++){const r=await register(room);if(r.status===429){refused=true;break;}assert.equal(r.status,201);const code=(await r.json()).roomCode;assert.equal(allocated.has(code),false);allocated.add(code);}
  assert.equal(refused,true);
  let limited=false;
  for(let i=0;i<241;i++){const r=await fetch(`${origin}/rooms/${publicCode}`);if(r.status===429){limited=true;break;}assert.equal(r.status,200);}
  assert.equal(limited,true);
  const route=`${origin}/relay/BwcHBwcHBwcHBwcHBwcHBw/inviter/hello`;
  const write=()=>fetch(route,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify('synthetic')});
  assert.equal((await fetch(route,{method:'POST',headers:{Origin:'https://other.example'},body:'"synthetic"'})).status,403);
  const racing=await Promise.all([write(),write()]);assert.deepEqual(racing.map(r=>r.status).sort(),[201,409]);
  assert.equal((await fetch(route.replace('/hello','/payload'),{method:'POST',headers:{Origin:origin},body:'x'.repeat(24577)})).status,413);
  assert.deepEqual(external,[]);
  console.log(JSON.stringify({passed:true,twoBrowserClients:true,wrongCodeRejected:true,noSecretOrPlaintextAtRelay:true,explicitHandoffAndReview:true,wordAndCharacterSecrets:true,publicRoomLookup:true,publicCodeCannotPair:true,expiredAliasRejected:true,directoryBudgets:true,writeOnceRace:true,externalRequests:0,browser:browser.version()}));
} finally {
  await browser?.close();
  if(child.exitCode===null){child.kill('SIGINT');await once(child,'exit');}
}
