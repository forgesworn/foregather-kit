import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {init,createLiveOffer,createPairingFlow,createLiveRelayClient,ForegatherTransportError} from '../packages/browser/dist/index.mjs';
import {exchange_encode,exchange_decode} from '../packages/browser/dist/foregather_wasm.js';
await init({module_or_path:readFileSync(new URL('../packages/browser/dist/foregather_wasm_bg.wasm',import.meta.url))});
const namespace='test.flows',purpose='exchange',now=()=>1800000000;
const elapsedClock=()=>{let start;return()=>{start??=performance.now();return now()+Math.floor((performance.now()-start)/1000);};};
const text=value=>new TextEncoder().encode(value);
const closedAs=kind=>error=>error instanceof ForegatherTransportError&&error.kind===kind;
const invalid=error=>error instanceof Error&&!(error instanceof ForegatherTransportError);
function transports(transform) {
  const values=new Map(),waiters=new Map(),sent=[];
  const transport=role=>({
    async send(input) {
      const key=`${role}/${input.kind}/${input.sequence??''}`;sent.push({role,...input});
      let value=structuredClone(input.value);if(transform)value=transform(role,input,value);
      if(!values.has(key)){values.set(key,value);waiters.get(key)?.(value);}
    },
    receive(input) {const peer=role==='inviter'?'recipient':'inviter',key=`${peer}/${input.kind}/${input.sequence??''}`;
      if(values.has(key))return Promise.resolve(values.get(key));return new Promise(resolve=>waiters.set(key,resolve));
    },
  });
  return {a:transport('inviter'),b:transport('recipient'),sent};
}
async function verified({transform,onState,lifetime,clock=now}={}) {
  const offer=createLiveOffer({namespace,purpose,now:now(),lifetime}),t=transports(transform);
  const base={...offer,namespace,purpose,now:clock};
  const a=createPairingFlow({...base,role:'inviter',transport:t.a,onState}),b=createPairingFlow({...base,role:'recipient',transport:t.b});
  await Promise.all([a.pair(),b.pair()]);a.verify({matches:true});b.verify({matches:true});
  return {a,b,t,offer};
}
async function exchanging(options) {
  const flows=await verified(options);return {...flows,x:flows.a.exchange(),y:flows.b.exchange()};
}
const flip=value=>({...value,ciphertext:(value.ciphertext[0]==='A'?'B':'A')+value.ciphertext.slice(1)});

test('an exchange carries ordered messages both ways, with send and receive in flight together',async()=>{
  const progress=[];const {a,b,t,x,y,offer}=await exchanging({onState:value=>progress.push(value.state)});
  assert.equal(a.state,'exchanging');assert.equal(b.state,'exchanging');
  // The inviter waits for the reply while it sends a second message.
  const [first]=await Promise.all([y.receive(),x.send({payload:text('{"event":"invite"}')})]);
  assert.deepEqual(first,text('{"event":"invite"}'));
  const replying=x.receive();
  await Promise.all([x.send({payload:text('second from inviter')}),y.send({payload:text('first from recipient')})]);
  assert.deepEqual(await replying,text('first from recipient'));assert.deepEqual(await y.receive(),text('second from inviter'));
  assert.deepEqual([x.sent,x.received,y.sent,y.received],[2,1,1,2]);
  for(const role of ['inviter','recipient']) {
    const packets=t.sent.filter(m=>m.role===role&&m.kind==='packet');
    assert.deepEqual(packets.map(m=>m.sequence),role==='inviter'?[0,1]:[0]);assert.ok(packets.every(m=>m.value.seq===m.sequence));
  }
  for(const message of t.sent){const json=JSON.stringify(message.value);for(const secret of ['invite','second from','first from',offer.secretWords])assert.equal(json.includes(secret),false);}
  x.close();assert.equal(a.state,'closed');assert.deepEqual(progress,['waiting','confirming','verifying','ready','exchanging','closed']);
  await assert.rejects(x.send({payload:text('late')}),closedAs('closed'));await assert.rejects(x.receive(),closedAs('closed'));
  a.dispose();assert.equal(a.state,'closed');y.close();b.dispose();
});

test('each direction carries 32 messages of at most 16,379 bytes, one send and one receive at a time',async()=>{
  const {a,x,y}=await exchanging();
  await assert.rejects(x.send({payload:new Uint8Array(16380)}),invalid);await assert.rejects(x.send({payload:'text'}),invalid);assert.equal(a.state,'exchanging');
  const pending=x.send({payload:new Uint8Array(16379).fill(7)});await assert.rejects(x.send({payload:new Uint8Array(1)}),invalid);await pending;
  const receiving=y.receive();await assert.rejects(y.receive(),invalid);assert.equal((await receiving).length,16379);
  for(let index=1;index<32;index++){await x.send({payload:new Uint8Array([index])});assert.deepEqual(await y.receive(),new Uint8Array([index]));}
  assert.equal(x.sent,32);await assert.rejects(x.send({payload:new Uint8Array(1)}),invalid);await assert.rejects(y.receive(),invalid);
  assert.equal(a.state,'exchanging');x.close();y.close();
});

test('an exchange needs verification and never shares the channel with a transfer',async()=>{
  const {a:early,b:other}=await (async()=>{const offer=createLiveOffer({namespace,purpose,now:now()}),t=transports();
    const a=createPairingFlow({...offer,namespace,purpose,now,role:'inviter',transport:t.a}),b=createPairingFlow({...offer,namespace,purpose,now,role:'recipient',transport:t.b});
    return {a,b};})();
  assert.throws(()=>early.exchange());early.dispose();other.dispose();
  const {a,b,x}=await exchanging();assert.throws(()=>a.exchange());
  await assert.rejects(a.send({payload:new Uint8Array([1])}),invalid);await assert.rejects(b.receive(),invalid);
  x.close();b.dispose();
  const kept=await verified();const sending=kept.a.send({payload:new Uint8Array([1])});assert.throws(()=>kept.a.exchange());
  // The recipient opted into the exchange while the inviter sent a transfer-v1 invitation.
  const y=kept.b.exchange();await assert.rejects(y.receive(),error=>!(error instanceof ForegatherTransportError));
  assert.equal(kept.b.state,'failed');kept.a.cancel();await assert.rejects(sending);
});

test('a tampered exchange packet fails the receiver without returning a message',async()=>{
  const {b,x,y}=await exchanging({transform:(role,input,value)=>role==='inviter'&&input.kind==='packet'&&input.sequence===1?flip(value):value});
  await x.send({payload:text('intact')});assert.deepEqual(await y.receive(),text('intact'));
  await x.send({payload:text('tampered')});await assert.rejects(y.receive());assert.equal(b.state,'failed');
  await assert.rejects(y.send({payload:text('after failure')}),closedAs('failed'));x.close();
});

test('an uncertain exchange upload retries identical ciphertext on the same sequence',async()=>{
  let once=true;const {t,x,y}=await exchanging({transform:(role,input,value)=>{
    if(role==='recipient'&&input.kind==='packet'&&input.sequence===0&&once){once=false;throw new ForegatherTransportError('timeout');}return value;
  }});
  const [message]=await Promise.all([x.receive(),y.send({payload:new Uint8Array([4,2])})]);assert.deepEqual(message,new Uint8Array([4,2]));
  const writes=t.sent.filter(m=>m.role==='recipient'&&m.kind==='packet');assert.equal(writes.length,2);assert.deepEqual(writes[0].value,writes[1].value);assert.equal(y.sent,1);
  x.close();y.close();
});

test('the session deadline ends a pending exchange receive and refuses later sends',async()=>{
  const {a,b,x,y}=await exchanging({lifetime:2,clock:elapsedClock()});
  const watchdog=setTimeout(()=>{a.cancel();b.cancel();},4500);
  try {
    await x.send({payload:text('before the deadline')});assert.deepEqual(await y.receive(),text('before the deadline'));
    await assert.rejects(x.receive(),closedAs('expired'));assert.equal(a.state,'expired');
    await assert.rejects(y.send({payload:text('too late')}),closedAs('expired'));assert.equal(b.state,'expired');
  }finally{clearTimeout(watchdog);a.dispose();b.dispose();}
});

test('caller cancellation ends the exchange; close rejects a pending receive',async()=>{
  const {a,x,y}=await exchanging();const controller=new AbortController();
  const waiting=x.receive({signal:controller.signal});controller.abort();await assert.rejects(waiting);assert.equal(a.state,'cancelled');
  await assert.rejects(x.send({payload:new Uint8Array(1)}),closedAs('cancelled'));
  const pending=y.receive();y.close();await assert.rejects(pending,closedAs('closed'));
});

test('an exchange crosses the HTTP relay on packet slots matching each message index',async()=>{
  const offer=createLiveOffer({namespace,purpose,now:now()}),inviterToken=Buffer.alloc(32,1).toString('base64url');
  const messages=new Map(),writes=[];let recipientToken;
  const relay=createLiveRelayClient({apiUrl:'https://example.test/v1/',fetch:async(url,options)=>{
    if(url.pathname.endsWith('/claim')){recipientToken=options.headers.Authorization;return new Response(null,{status:204});}
    const [role,kind]=url.pathname.split('/').slice(-2),key=`${role}/${kind}`;
    if(options.method==='PUT'){assert.ok(new TextEncoder().encode(options.body).length<=24576);writes.push(key);assert.equal(messages.has(key),false);messages.set(key,JSON.parse(options.body));return new Response(null,{status:204});}
    return messages.has(key)?new Response(JSON.stringify(messages.get(key))):new Response(null,{status:404});
  }});
  const base={...offer,namespace,purpose,now};
  const a=createPairingFlow({...base,role:'inviter',transport:relay.inviter({allocation:{room:{session:offer.session,secret_format:'words'},inviter_token:inviterToken}})});
  const b=createPairingFlow({...base,role:'recipient',transport:await relay.recipient({locator:offer.session.locator})});
  try {
    await Promise.all([a.pair(),b.pair()]);a.verify({matches:true});b.verify({matches:true});const x=a.exchange(),y=b.exchange();
    const largest=new Uint8Array(16379).fill(255);
    await Promise.all([x.send({payload:largest}),y.receive().then(m=>assert.deepEqual(m,largest))]);
    await Promise.all([y.send({payload:text('answer')}),x.receive().then(m=>assert.deepEqual(m,text('answer')))]);
    await Promise.all([x.send({payload:text('again')}),y.receive().then(m=>assert.deepEqual(m,text('again')))]);
    assert.deepEqual(writes.filter(key=>key.includes('packet')).sort(),['inviter/packet-0','inviter/packet-1','recipient/packet-0']);
    x.close();y.close();
  }finally{a.dispose();b.dispose();}
});

test('WASM exchange framing matches the independent Python vectors',()=>{
  const fixture=JSON.parse(readFileSync(new URL('../crates/foregather-kit/vectors/exchange-v1.json',import.meta.url)));
  assert.equal(fixture.profile,'foregather-exchange/1');
  for(const vector of fixture.frames) {
    const payload=Buffer.from(vector.payload,'base64url'),frame=Buffer.from(vector.frame,'base64url');
    assert.equal(Buffer.from(exchange_encode(vector.index,payload)).toString('base64url'),vector.frame);
    assert.deepEqual(Buffer.from(exchange_decode(vector.index,frame)),payload);
    assert.throws(()=>exchange_decode((vector.index+1)%32,frame));
  }
  for(const vector of fixture.packets)assert.equal(vector.packet.seq,vector.index);
  assert.throws(()=>exchange_encode(0,new Uint8Array(16380)));assert.throws(()=>exchange_decode(0,new Uint8Array([70,71,1,1,0])));
});
