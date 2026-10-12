import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import { init, createLiveOffer, createLivePairing, deriveSpokenWords, deriveDirectionalWords } from '../packages/browser/dist/index.mjs';
await init({module_or_path:readFileSync(new URL('../packages/browser/dist/foregather_wasm_bg.wasm',import.meta.url))});
const now=1800000000, namespace='example.rooms', purpose='bootstrap';
function pair(secretWords) {
  const offer=createLiveOffer({namespace,purpose,now});
  const a=createLivePairing({...offer,namespace,purpose,role:'inviter',now});
  const b=createLivePairing({...offer,secretWords:secretWords??offer.secretWords,namespace,purpose,role:'recipient',now});
  const ax=a.start({now}),bx=b.start({now}),ah=ax.hello(),bh=bx.hello();
  const ap=ax.finish({peerHello:bh,now}),bp=bx.finish({peerHello:ah,now});
  return {a,b,ax,bx,ap,bp};
}
function established() {
  const p=pair(),ap=p.ap.proof(),bp=p.bp.proof();
  const a=p.ap.confirm({peerProof:bp,now}),b=p.bp.confirm({peerProof:ap,now});
  p.a.dispose();p.b.dispose();return {a,b};
}
test('frozen Spoken Token words and directional v2 vectors, independently derived by Node',()=>{
  const secret=new Uint8Array(32);secret[31]=1;
  assert.equal(deriveSpokenWords({secret,context:'test',counter:0}), 'jazz earth glacier');
  assert.deepEqual(deriveDirectionalWords({secret,namespace:'rideshare',roles:['driver','rider'],counter:42,count:1}),['shed','rely']);
  const wordlist=readFileSync(new URL('../crates/foregather-kit/src/en-v1.txt',import.meta.url),'utf8').split('\n');
  for(const identity of [undefined,'alice','bob','🫏']) {
    const data=Buffer.concat([Buffer.from('independent'),...(identity===undefined?[]:[Buffer.from([0]),Buffer.from(identity)]),Buffer.from([0,0,0,7])]);
    const digest=createHmac('sha256',secret).update(data).digest();
    const expected=Array.from({length:16},(_,i)=>wordlist[digest.readUInt16BE(i*2)%2048]).join(' ');
    assert.equal(deriveSpokenWords({secret,context:'independent',counter:7,identity,count:16}),expected);
  }
});
test('live WASM confirmation and two-way encrypted bootstrap, no raw-key export',()=>{
  const {a,b}=established();
  try {
    assert.equal(a.verificationWords({now}),b.verificationWords({now}));
    const packet=a.seal({payload:new TextEncoder().encode('application still reviews this invitation'),now});
    assert.equal(new TextDecoder().decode(b.open({packet,now})),'application still reviews this invitation');
    assert.throws(()=>b.open({packet,now}));assert.throws(()=>a.open({packet,now}));
    const reply=b.seal({payload:new Uint8Array([1,2,3]),now});assert.deepEqual(a.open({packet:reply,now}),new Uint8Array([1,2,3]));
  } finally {a.dispose();b.dispose();}
  assert.throws(()=>a.verificationWords({now}));
});
test('wrong secret fails both confirmations and consumes states and budget',()=>{
  const p=pair('jazz earth glacier ability'),ap=p.ap.proof(),bp=p.bp.proof();
  assert.throws(()=>p.ap.confirm({peerProof:bp,now}));assert.throws(()=>p.bp.confirm({peerProof:ap,now}));
  assert.throws(()=>p.ap.confirm({peerProof:bp,now}));assert.equal(p.a.remaining(),0);assert.throws(()=>p.a.start({now}));
  p.a.dispose();p.b.dispose();
});
test('cancelled and malformed exchanges spend attempts even before WASM transfer',()=>{
  const offer=createLiveOffer({namespace,purpose,wordCount:2,now});
  const gate=createLivePairing({...offer,namespace,purpose,role:'inviter',attempts:2,now});
  const cancelled=gate.start({now});cancelled.dispose();assert.equal(gate.remaining(),1);
  const x=gate.start({now});assert.throws(()=>x.finish({peerHello:'x'.repeat(100000),now}));assert.throws(()=>x.hello());
  assert.equal(gate.remaining(),0);assert.throws(()=>gate.start({now}));gate.dispose();
});
test('expected namespace and purpose are selected locally; numeric narrowing is refused',()=>{
  const offer=createLiveOffer({namespace,purpose,now});
  for(const changed of [{namespace:'wrong.app'},{purpose:'other'},{attempts:257},{attempts:1.5},{role:'host'},{now:NaN}]) assert.throws(()=>createLivePairing({...offer,namespace,purpose,role:'recipient',now,...changed}));
  for(const wordCount of [1,17,2**32+4,3.5]) assert.throws(()=>createLiveOffer({namespace,purpose,now,wordCount}));
  const secret=new Uint8Array(32);
  for(const counter of [-1,2**32,1.5]) assert.throws(()=>deriveSpokenWords({secret,context:'test',counter}));
});
