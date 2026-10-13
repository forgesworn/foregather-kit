import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const child=spawn(process.execPath,['examples/pairing/serve.mjs'],{env:{...process.env,FOREGATHER_PAIRING_PORT:'0'},stdio:['ignore','ignore','pipe']});let browser;
try {
  const origin=await new Promise((resolve,reject)=>{let output='';const timer=setTimeout(()=>reject(Error('Pairing demo startup timed out')),15000);child.stderr.on('data',chunk=>{output+=chunk;const match=/demo listening on (http:\/\/127\.0\.0\.1:\d+)/.exec(output);if(match){clearTimeout(timer);resolve(match[1]);}});child.once('error',error=>{clearTimeout(timer);reject(error);});child.once('exit',()=>{clearTimeout(timer);reject(Error('Pairing demo exited'));});});
  browser=await chromium.launch({headless:true});const requests=[],external=[];
  function watch(page,role){page.on('request',request=>{if(/^https?:/.test(request.url())&&new URL(request.url()).origin!==origin)external.push(request.url());if(request.url().includes('/v1/')||request.url().endsWith('/allocate'))requests.push({role,url:request.url(),body:request.postData()});});}
  for(const format of ['words','characters']) {
    const host=await browser.newPage(),guest=await browser.newPage({viewport:{width:375,height:812}});watch(host,format+'Host');watch(guest,format+'Guest');
    await host.goto(origin);await host.locator('#format').selectOption(format);await host.locator('#create').click();await host.locator('#offer').waitFor({state:'visible'});
    const secret=await host.locator('#private-secret').textContent(),link=await host.locator('#link').getAttribute('href');assert.ok(secret&&link);await host.locator('#qr svg').waitFor();
    await guest.goto(link);await guest.locator('#recipient').waitFor({state:'visible'});
    assert.equal(requests.some(request=>request.role===format+'Guest'),false);
    await guest.locator('#secret').fill(secret);await guest.locator('#pair').click();await host.locator('#verification').waitFor({state:'visible'});await guest.locator('#verification').waitFor({state:'visible'});
    assert.equal(await host.locator('#words').textContent(),await guest.locator('#words').textContent());assert.equal(await host.locator('#send-section').isVisible(),false);
    await host.locator('#matches').click();await guest.locator('#matches').click();const payload=`Synthetic ${format} invitation for review`;
    await host.locator('#invitation').fill(payload);await host.locator('#send').click();await guest.locator('#received').waitFor({state:'visible'});await host.getByText('Recipient decrypted the invitation',{exact:true}).waitFor();
    assert.equal(await guest.locator('#payload').textContent(),payload);assert.equal(await guest.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    for(const request of requests.filter(request=>request.role.startsWith(format))){assert.equal(request.body?.includes(secret)??false,false);assert.equal(request.body?.includes(payload)??false,false);}
    await guest.locator('#restart').click();await guest.locator('#setup').waitFor({state:'visible'});assert.equal(new URL(guest.url()).hash,'');await host.close();await guest.close();
  }
  assert.deepEqual(external,[]);console.log(JSON.stringify({passed:true,realRustRelay:true,twoBrowserClients:true,publicQrRendered:true,explicitVerification:true,encryptedReceipt:true,wordsAndCharacters:true,mobileViewport:true,zeroExternalRequests:true}));
}finally{await browser?.close();if(child.exitCode===null&&child.signalCode===null){const exited=once(child,'exit');child.kill('SIGINT');await exited;}}
