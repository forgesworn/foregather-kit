import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {init,createLiveOffer,createLiveRelayClient,createCreationGrantClient,ForegatherTransportError} from '../packages/browser/dist/index.mjs';
await init({module_or_path:readFileSync(new URL('../packages/browser/dist/foregather_wasm_bg.wasm',import.meta.url))});
const now=1800000000,offer=createLiveOffer({namespace:'test.transport',purpose:'invitation',now}),capability=Buffer.alloc(32,1).toString('base64url');
const hello=Buffer.alloc(33,2).toString('base64url');
const response=value=>new Response(JSON.stringify(value));
const inviter=fetch=>createLiveRelayClient({apiUrl:'https://example.test/v1/',fetch}).inviter({allocation:{room:{session:offer.session,secret_format:'words'},inviter_token:capability}});
test('private fields and unencrypted payload objects are refused before transport',async()=>{
  let requests=0;const relay=createLiveRelayClient({apiUrl:'https://example.test/v1/',fetch:async()=>{requests++;throw Error('Unexpected request');}});
  for(const room of [{session:offer.session,secret_format:'words',secretWords:offer.secretWords},{session:{...offer.session,secretCode:'ABC234'},secret_format:'words'}])await assert.rejects(relay.allocate({room,createToken:capability}));
  const transport=relay.inviter({allocation:{room:{session:offer.session,secret_format:'words'},inviter_token:capability}});
  await assert.rejects(transport.send({kind:'packet',sequence:0,value:{plaintext:'private invitation'}}));
  await assert.rejects(transport.send({kind:'hello',value:offer.secretWords}));
  assert.equal(requests,0);
});
test('grant client uses headers and no ambient credentials, and bounds hostile responses',async()=>{
  let observed;const request={operatorToken:capability,resource:'live',expires:now+60,maxUses:1,maxInvitationLifetime:120};
  const client=createCreationGrantClient({apiUrl:'https://example.test/prefix/v1/',fetch:async(url,options)=>{observed={url:String(url),options};return new Response(JSON.stringify({id:offer.session.locator,token:capability,resource:'live',expires:now+60,remaining:1,max_invitation_lifetime:120}),{status:201});}});
  await client.issue(request);assert.equal(observed.url,'https://example.test/prefix/v1/creation-grants');assert.equal(observed.url.includes(capability),false);assert.equal(observed.options.headers.Authorization,'Bearer '+capability);assert.equal(observed.options.credentials,'omit');assert.equal(observed.options.redirect,'error');
  let cancelled=false;const hostile=createCreationGrantClient({apiUrl:'https://example.test/v1/',fetch:async()=>new Response(new ReadableStream({pull(controller){controller.enqueue(new Uint8Array(30000));},cancel(){cancelled=true;}}))});
  await assert.rejects(hostile.issue(request));assert.equal(cancelled,true);
});
test('public lookup retries transient reads without acquiring any capability',async()=>{
  for(const failure of [()=>new Response(null,{status:503}),()=>{throw new TypeError('Synthetic network interruption');}]) {
    const requests=[],room={session:offer.session,secret_format:'words'};
    const relay=createLiveRelayClient({apiUrl:'https://example.test/v1/',fetch:async(url,options)=>{requests.push({url:String(url),options});return requests.length===1?failure():response(room);}});
    assert.deepEqual(await relay.lookup({roomCode:'ABC234'}),room);assert.equal(requests.length,2);
    assert.equal(requests[0].url,requests[1].url);assert.ok(requests.every(({options})=>options.method==='GET'&&options.headers.Authorization===undefined));
  }
});
test('polling retries keep the same peer path and role capability across missing messages',async()=>{
  const requests=[];const steps=[()=>new Response(null,{status:503}),()=>new Response(null,{status:404}),()=>{throw new TypeError('Synthetic network interruption');},()=>new Response(null,{status:404}),()=>response(hello)];
  const transport=inviter(async(url,options)=>{requests.push({url:String(url),options});return steps.shift()();});
  try {
    assert.equal(await transport.receive({kind:'hello'}),hello);assert.equal(requests.length,5);
    assert.ok(requests.every(({url,options})=>url===`https://example.test/v1/live-sessions/${offer.session.locator}/messages/recipient/hello`&&options.method==='GET'&&options.headers.Authorization===`Bearer ${capability}`));
  }finally{transport.dispose();}
});
test('persistent transient reads fail after three attempts',async()=>{
  let requests=0;const transport=inviter(async()=>{requests++;return new Response(null,{status:503});});
  try{await assert.rejects(transport.receive({kind:'hello'}),error=>error instanceof ForegatherTransportError&&error.kind==='http'&&error.status===503);assert.equal(requests,3);}finally{transport.dispose();}
});
test('authentication errors and malformed responses fail without retries',async()=>{
  for(const failure of [()=>new Response(null,{status:401}),()=>new Response(null,{status:403}),()=>new Response(null,{status:409}),()=>new Response(null,{status:500}),()=>new Response('{'),()=>response('not-a-hello'),()=>response({hello})]) {
    let requests=0;const transport=inviter(async()=>{requests++;return failure();});
    try{await assert.rejects(transport.receive({kind:'hello'}),ForegatherTransportError);assert.equal(requests,1);}finally{transport.dispose();}
  }
  let requests=0;const malformed=createLiveRelayClient({apiUrl:'https://example.test/v1/',fetch:async()=>{requests++;return response({session:offer.session,secret_format:'words',secretWords:offer.secretWords});}});
  await assert.rejects(malformed.lookup({roomCode:'ABC234'}),error=>error.kind==='invalid-response');assert.equal(requests,1);
});
test('cancellation and disposal interrupt read backoff before another request',async()=>{
  for(const dispose of [false,true]) {
    let requests=0,timer,requestSignal;const controller=new AbortController();
    const transport=inviter(async(_url,options)=>{requests++;requestSignal=options.signal;timer=setTimeout(()=>dispose?transport.dispose():controller.abort(),20);return new Response(null,{status:503});});
    try{await assert.rejects(transport.receive({kind:'hello',signal:controller.signal}));assert.equal(requests,1);assert.equal(requestSignal.aborted,true);}finally{clearTimeout(timer);transport.dispose();}
  }
});
test('disposing a transport aborts its in-flight request and leaves it unusable',async()=>{
  let started,requestSignal,requests=0;const beginning=new Promise(resolve=>{started=resolve;});
  const transport=inviter(async(_url,options)=>{requests++;requestSignal=options.signal;started();return new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true}));});
  const pending=transport.receive({kind:'hello'});await beginning;transport.dispose();
  await assert.rejects(pending,error=>error.kind==='cancelled');assert.equal(requestSignal.aborted,true);
  await assert.rejects(transport.receive({kind:'hello'}),error=>error.kind==='cancelled');assert.equal(requests,1);
});
