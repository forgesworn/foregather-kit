import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {init,createLiveOffer,createCharacterOffer,createPairingFlow,createLiveRelayClient,ForegatherTransportError} from '../packages/browser/dist/index.mjs';
await init({module_or_path:readFileSync(new URL('../packages/browser/dist/foregather_wasm_bg.wasm',import.meta.url))});
const namespace='test.flows',purpose='invitation',now=()=>1800000000;
// Real elapsed time in whole seconds from a fixed base, started by the first read. A short lifetime
// then lasts its full length from flow creation, whichever wall-clock second the test begins in.
const elapsedClock=()=>{let start;return()=>{start??=performance.now();return now()+Math.floor((performance.now()-start)/1000);};};
test('expiry cancels an unresponsive transport and cannot restart the spent flow',async()=>{
  const current=elapsedClock(),offer=createLiveOffer({namespace,purpose,now:now(),lifetime:1});
  const flow=createPairingFlow({...offer,namespace,purpose,role:'inviter',now:current,transport:{send:async()=>{},receive:()=>new Promise(()=>{})}});
  const watchdog=setTimeout(()=>flow.cancel(),2500);
  try{await assert.rejects(flow.pair());assert.equal(flow.state,'expired');await assert.rejects(flow.pair());}finally{clearTimeout(watchdog);flow.dispose();}
});
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
function flows({characters=false,wrong=false,transform,onState}={}) {
  const offer=(characters?createCharacterOffer:createLiveOffer)({namespace,purpose,now:now()});const t=transports(transform);
  const base={...offer,namespace,purpose,now};
  const a=createPairingFlow({...base,role:'inviter',transport:t.a,onState});
  const b=createPairingFlow({...base,...(wrong?{secretWords:'jazz earth glacier ability'}:{}),role:'recipient',transport:t.b});
  return {a,b,t,offer};
}
test('flow explicitly verifies before handoff and distinguishes relay send from decrypted receipt',async()=>{
  for(const characters of [false,true]) {
    const progress=[];const {a,b,t,offer}=flows({characters,onState:value=>progress.push(value.state)});
    const [aw,bw]=await Promise.all([a.pair(),b.pair()]);assert.equal(aw,bw);assert.equal(a.state,'verifying');
    const payload=new TextEncoder().encode('synthetic invitation for application review');
    await assert.rejects(a.send({payload}));await assert.rejects(b.receive());
    a.verify({matches:true});b.verify({matches:true});
    let delivered=false;const sending=a.send({payload}).then(result=>{delivered=true;return result;});
    for(let i=0;i<100&&a.state!=='awaiting-receipt';i++)await new Promise(resolve=>setTimeout(resolve,1));
    assert.equal(a.state,'awaiting-receipt');assert.equal(delivered,false);
    assert.deepEqual(await b.receive(),payload);assert.deepEqual(await sending,{decrypted:true});
    assert.equal(a.state,'delivered');assert.equal(b.state,'received');a.dispose();b.dispose();assert.equal(a.state,'delivered');
    assert.deepEqual(progress,['waiting','confirming','verifying','ready','sending','awaiting-receipt','delivered']);
    for(const message of t.sent) {const json=JSON.stringify(message.value);assert.equal(json.includes(new TextDecoder().decode(payload)),false);assert.equal(json.includes(offer.secretWords??offer.secretCode),false);}
  }
});
test('wrong secret fails closed and the same flow cannot restart its gate',async()=>{
  const {a,b}=flows({wrong:true});const results=await Promise.allSettled([a.pair(),b.pair()]);
  assert.ok(results.every(result=>result.status==='rejected'));assert.equal(a.state,'failed');assert.equal(b.state,'failed');
  await assert.rejects(a.pair());await assert.rejects(b.pair());
});
test('cancellation terminates even a transport that ignores AbortSignal',async()=>{
  const offer=createLiveOffer({namespace,purpose,now:now()});const controller=new AbortController();
  const flow=createPairingFlow({...offer,namespace,purpose,role:'inviter',now,transport:{send:async()=>{},receive:()=>new Promise(()=>{})}});
  const pending=flow.pair({signal:controller.signal});controller.abort();await assert.rejects(pending);assert.equal(flow.state,'cancelled');await assert.rejects(flow.pair());
});
test('a rejected verification destroys the confirmed channel and cannot be reversed',async()=>{
  const {a,b}=flows();await Promise.all([a.pair(),b.pair()]);a.verify({matches:false});
  assert.equal(a.state,'cancelled');assert.throws(()=>a.verify({matches:true}));b.cancel();
});
test('uncertain receipt upload retries identical ciphertext without spending another sequence',async()=>{
  let once=true;const {a,b,t}=flows({transform:(role,input,value)=>{
    if(role==='recipient'&&input.kind==='packet'&&once){once=false;throw new ForegatherTransportError('timeout');}return value;
  }});
  await Promise.all([a.pair(),b.pair()]);a.verify({matches:true});b.verify({matches:true});
  const payload=new Uint8Array([0,255,1]);const [receipt,received]=await Promise.all([a.send({payload}),b.receive()]);
  assert.deepEqual(receipt,{decrypted:true});assert.deepEqual(received,payload);
  const writes=t.sent.filter(message=>message.role==='recipient'&&message.kind==='packet');assert.equal(writes.length,2);assert.deepEqual(writes[0].value,writes[1].value);assert.equal(writes[0].value.seq,0);
});
test('tampered encrypted receipt cannot report delivery',async()=>{
  const {a,b}=flows({transform:(role,input,value)=>role==='recipient'&&input.kind==='packet'?{...value,ciphertext:(value.ciphertext[0]==='A'?'B':'A')+value.ciphertext.slice(1)}:value});
  await Promise.all([a.pair(),b.pair()]);a.verify({matches:true});b.verify({matches:true});
  const sending=a.send({payload:new Uint8Array([1])});await b.receive();await assert.rejects(sending);assert.equal(a.state,'failed');
});
test('flow rejects clock rollback, wrong local context and excessive payloads',async()=>{
  const offer=createLiveOffer({namespace,purpose,now:now()});const t=transports();
  assert.throws(()=>createPairingFlow({...offer,namespace:'other.app',purpose,role:'inviter',now,transport:t.a}));
  let time=now();const flow=createPairingFlow({...offer,namespace,purpose,role:'inviter',now:()=>time,transport:t.a});time--;
  await assert.rejects(flow.pair());assert.equal(flow.state,'failed');
  const {a,b}=flows({onState:()=>{throw Error('presentation failed');}});await Promise.all([a.pair(),b.pair()]);a.verify({matches:true});b.verify({matches:true});
  await assert.rejects(a.send({payload:new Uint8Array(16365)}));assert.equal(a.state,'ready');a.cancel();b.cancel();
});
test('HTTP read recovery keeps one exchange and packet counter through the complete flow',async()=>{
  const offer=createLiveOffer({namespace,purpose,now:now()}),inviterToken=Buffer.alloc(32,1).toString('base64url');
  const messages=new Map(),readCounts=new Map(),writes=[],progress=[];let recipientToken,claims=0;
  const relay=createLiveRelayClient({apiUrl:'https://example.test/v1/',fetch:async(url,options)=>{
    if(url.pathname.endsWith('/claim')){claims++;recipientToken=options.headers.Authorization;return new Response(null,{status:204});}
    const [role,kind]=url.pathname.split('/').slice(-2),key=`${role}/${kind}`;
    const expected=role==='inviter'?`Bearer ${inviterToken}`:recipientToken;
    if(options.method==='PUT') {
      assert.equal(options.headers.Authorization,expected);writes.push({key,value:JSON.parse(options.body)});
      assert.equal(messages.has(key),false);messages.set(key,JSON.parse(options.body));return new Response(null,{status:204});
    }
    assert.equal(options.method,'GET');assert.ok([`Bearer ${inviterToken}`,recipientToken].includes(options.headers.Authorization));
    const count=(readCounts.get(key)??0)+1;readCounts.set(key,count);
    if(count===1){if(kind==='packet-0')throw new TypeError('Synthetic network interruption');return new Response(null,{status:503});}
    return messages.has(key)?new Response(JSON.stringify(messages.get(key))):new Response(null,{status:404});
  }});
  const base={...offer,namespace,purpose,now};
  const a=createPairingFlow({...base,role:'inviter',transport:relay.inviter({allocation:{room:{session:offer.session,secret_format:'words'},inviter_token:inviterToken}}),onState:value=>progress.push(value.state)});
  const b=createPairingFlow({...base,role:'recipient',transport:await relay.recipient({locator:offer.session.locator})});
  try {
    const [aw,bw]=await Promise.all([a.pair(),b.pair()]);assert.equal(aw,bw);a.verify({matches:true});b.verify({matches:true});
    const payload=new Uint8Array([0,255,1]);const [receipt,received]=await Promise.all([a.send({payload}),b.receive()]);
    assert.deepEqual(receipt,{decrypted:true});assert.deepEqual(received,payload);assert.equal(claims,1);
    assert.deepEqual(writes.map(({key})=>key).sort(),['inviter/hello','inviter/packet-0','inviter/proof','recipient/hello','recipient/packet-0','recipient/proof']);
    assert.ok([...readCounts.values()].every(count=>count>=2));assert.ok(writes.filter(({key})=>key.endsWith('/packet-0')).every(({value})=>value.seq===0));
    assert.deepEqual(progress,['waiting','confirming','verifying','ready','sending','awaiting-receipt','delivered']);
  }finally{a.dispose();b.dispose();}
});
function pollingFlow(fetch,{current=now,lifetime=120}={}) {
  const offer=createLiveOffer({namespace,purpose,now:now(),lifetime});
  const relay=createLiveRelayClient({apiUrl:'https://example.test/v1/',fetch});
  return createPairingFlow({...offer,namespace,purpose,role:'inviter',now:current,transport:relay.inviter({allocation:{room:{session:offer.session,secret_format:'words'},inviter_token:Buffer.alloc(32,1).toString('base64url')}})});
}
test('exhausted HTTP reads destroy the flow without a new hello or gate attempt',async()=>{
  let reads=0,writes=0;const flow=pollingFlow(async(_url,options)=>{
    if(options.method==='PUT'){writes++;return new Response(null,{status:204});}reads++;return new Response(null,{status:503});
  });
  try {
    await assert.rejects(flow.pair(),error=>error.kind==='http'&&error.status===503);assert.equal(flow.state,'failed');assert.equal(reads,3);assert.equal(writes,1);
    await assert.rejects(flow.pair());assert.equal(reads,3);assert.equal(writes,1);
  }finally{flow.dispose();}
});
test('cancelling HTTP retry backoff is terminal and sends no additional requests',async()=>{
  let reads=0,timer;const controller=new AbortController();
  const flow=pollingFlow(async(_url,options)=>{
    if(options.method==='PUT')return new Response(null,{status:204});reads++;timer=setTimeout(()=>controller.abort(),20);return new Response(null,{status:503});
  });
  try{await assert.rejects(flow.pair({signal:controller.signal}));assert.equal(flow.state,'cancelled');assert.equal(reads,1);await assert.rejects(flow.pair());assert.equal(reads,1);}finally{clearTimeout(timer);flow.dispose();}
});
test('a read retry cannot extend the original pairing expiry',async()=>{
  let reads=0,requestSignal;const current=elapsedClock();
  const flow=pollingFlow(async(_url,options)=>{
    if(options.method==='PUT')return new Response(null,{status:204});reads++;
    if(reads===1)return new Response(null,{status:503});
    requestSignal=options.signal;return new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true}));
  },{current,lifetime:2});
  const watchdog=setTimeout(()=>flow.cancel(),4500);
  try{await assert.rejects(flow.pair());assert.equal(flow.state,'expired');assert.equal(reads,2);assert.equal(requestSignal.aborted,true);await assert.rejects(flow.pair());assert.equal(reads,2);}finally{clearTimeout(watchdog);flow.dispose();}
});
async function delivered(options={}) {
  const {a,b,t}=flows(options);await Promise.all([a.pair(),b.pair()]);a.verify({matches:true});b.verify({matches:true});
  const payload=new TextEncoder().encode('synthetic invitation for a reply');
  const [receipt,received]=await Promise.all([a.send({payload,keepOpen:true}),b.receive({keepOpen:true})]);
  assert.deepEqual(receipt,{decrypted:true});assert.deepEqual(received,payload);assert.equal(a.state,'delivered');assert.equal(b.state,'received');
  return {a,b,t};
}
test('a kept channel carries one bound reply from recipient to inviter on sequence one',async()=>{
  const progress=[];const {a,b,t}=await delivered({onState:value=>progress.push(value.state)});
  const message=new TextEncoder().encode('{"v":1,"event":"downloaded"}');
  const [reply]=await Promise.all([a.awaitReply(),b.reply({payload:message})]);
  assert.deepEqual(reply,message);assert.equal(a.state,'replied');assert.equal(b.state,'replied');
  assert.deepEqual(progress.slice(-3),['delivered','awaiting-reply','replied']);
  const replies=t.sent.filter(m=>m.role==='recipient'&&m.kind==='packet'&&m.sequence===1);assert.equal(replies.length,1);assert.equal(replies[0].value.seq,1);
  assert.equal(JSON.stringify(replies[0].value).includes('downloaded'),false);
  await assert.rejects(a.awaitReply());await assert.rejects(b.reply({payload:message}));a.dispose();b.dispose();assert.equal(a.state,'replied');
});
test('replies need keepOpen on both ends and stay within 1,024 bytes',async()=>{
  const {a,b}=flows();await Promise.all([a.pair(),b.pair()]);a.verify({matches:true});b.verify({matches:true});
  await Promise.all([a.send({payload:new Uint8Array([1])}),b.receive()]);
  await assert.rejects(a.awaitReply());await assert.rejects(b.reply({payload:new Uint8Array([2])}));
  const kept=await delivered();await assert.rejects(kept.b.reply({payload:new Uint8Array(1025)}));
  await assert.rejects(kept.a.send({payload:new Uint8Array([1]),keepOpen:'yes'}));
  const [reply]=await Promise.all([kept.a.awaitReply(),kept.b.reply({payload:new Uint8Array(1024)})]);assert.equal(reply.length,1024);
});
test('a tampered reply fails the inviter without reporting one',async()=>{
  const {a,b}=await delivered({transform:(role,input,value)=>role==='recipient'&&input.kind==='packet'&&input.sequence===1?{...value,ciphertext:(value.ciphertext[0]==='A'?'B':'A')+value.ciphertext.slice(1)}:value});
  const waiting=a.awaitReply();await b.reply({payload:new Uint8Array([9])});await assert.rejects(waiting);assert.equal(a.state,'failed');
});
test('an uncertain reply upload retries identical ciphertext on sequence one',async()=>{
  let once=true;const {a,b,t}=await delivered({transform:(role,input,value)=>{
    if(role==='recipient'&&input.kind==='packet'&&input.sequence===1&&once){once=false;throw new ForegatherTransportError('timeout');}return value;
  }});
  const [reply]=await Promise.all([a.awaitReply(),b.reply({payload:new Uint8Array([7,7])})]);assert.deepEqual(reply,new Uint8Array([7,7]));
  const writes=t.sent.filter(m=>m.role==='recipient'&&m.kind==='packet'&&m.sequence===1);assert.equal(writes.length,2);assert.deepEqual(writes[0].value,writes[1].value);
});
test('a kept channel closes at the deadline; the delivered transfer keeps its state',async()=>{
  const current=elapsedClock(),offer=createLiveOffer({namespace,purpose,now:now(),lifetime:2}),t=transports();
  const base={...offer,namespace,purpose,now:current};
  const a=createPairingFlow({...base,role:'inviter',transport:t.a}),b=createPairingFlow({...base,role:'recipient',transport:t.b});
  const watchdog=setTimeout(()=>{a.cancel();b.cancel();},4500);
  try{
    await Promise.all([a.pair(),b.pair()]);a.verify({matches:true});b.verify({matches:true});
    await Promise.all([a.send({payload:new Uint8Array([1]),keepOpen:true}),b.receive({keepOpen:true})]);
    const waiting=a.awaitReply();await assert.rejects(waiting,error=>error instanceof ForegatherTransportError&&error.kind==='expired');assert.equal(a.state,'expired');
    await new Promise(resolve=>setTimeout(resolve,50));assert.equal(b.state,'received');
    await assert.rejects(b.reply({payload:new Uint8Array([1])}),error=>error instanceof ForegatherTransportError&&error.kind==='expired');
  }finally{clearTimeout(watchdog);a.dispose();b.dispose();}
});
