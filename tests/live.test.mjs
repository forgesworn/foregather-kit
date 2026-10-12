import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import { init, createLiveOffer, createLivePairing, deriveSpokenWords, deriveDirectionalWords, createCharacterOffer, createCharacterPairing, createRendezvousCode, canonicalRendezvousCode } from '../packages/browser/dist/index.mjs';
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


test('character access secrets pair, reject wrong/public codes and keep one-use budgets',()=>{
  for(const characterCount of [6,8,12,32]) {
    const offer=createCharacterOffer({namespace,purpose,characterCount,now});
    assert.equal(offer.secretCode.length,characterCount);
    assert.equal(offer.secretWords,undefined);
    const a=createCharacterPairing({...offer,namespace,purpose,role:'inviter',now});
    const b=createCharacterPairing({...offer,secretCode:offer.secretCode.toLowerCase(),namespace,purpose,role:'recipient',now});
    const ax=a.start({now}),bx=b.start({now}),ah=ax.hello(),bh=bx.hello();
    const ap=ax.finish({peerHello:bh,now}),bp=bx.finish({peerHello:ah,now}),aproof=ap.proof(),bproof=bp.proof();
    const ac=ap.confirm({peerProof:bproof,now}),bc=bp.confirm({peerProof:aproof,now});
    assert.equal(ac.verificationWords({now}),bc.verificationWords({now}));
    const payload=Buffer.from('synthetic character transfer');
    assert.deepEqual(Buffer.from(bc.open({packet:ac.seal({payload,now}),now})),payload);
    assert.equal(a.remaining(),0);assert.throws(()=>a.start({now}));
    a.dispose();b.dispose();ac.dispose();bc.dispose();
  }
  const offer=createCharacterOffer({namespace,purpose,now});
  const wrong=(offer.secretCode[0]==='A'?'B':'A')+offer.secretCode.slice(1);
  const a=createCharacterPairing({...offer,namespace,purpose,role:'inviter',now});
  const b=createCharacterPairing({...offer,secretCode:wrong,namespace,purpose,role:'recipient',now});
  const ax=a.start({now}),bx=b.start({now}),ah=ax.hello(),bh=bx.hello();
  const ap=ax.finish({peerHello:bh,now}),bp=bx.finish({peerHello:ah,now}),aproof=ap.proof(),bproof=bp.proof();
  assert.throws(()=>ap.confirm({peerProof:bproof,now}));assert.throws(()=>bp.confirm({peerProof:aproof,now}));
  assert.throws(()=>ap.proof());assert.equal(a.remaining(),0);assert.equal(b.remaining(),0);a.dispose();b.dispose();
});
test('character and public code bounds, alphabet, context and entropy presentation are explicit',()=>{
  const offer=createCharacterOffer({namespace,purpose,now});
  for(const characterCount of [5,33,2**32+6,6.5])assert.throws(()=>createCharacterOffer({namespace,purpose,characterCount,now}));
  for(const secretCode of ['ABC23I','ABC23O','ABC23L','ABC23U','ABC-234','ABCDE','ABC234é'])assert.throws(()=>createCharacterPairing({...offer,secretCode,namespace,purpose,role:'recipient',now}));
  assert.throws(()=>createCharacterPairing({...offer,namespace:'wrong.app',purpose,role:'recipient',now}));
  for(const length of [6,8,12,32]) {
    const code=createRendezvousCode({length});assert.equal(code.length,length);
    assert.match(code,/^[0-9A-HJKMNP-TV-Z]+$/);assert.equal(canonicalRendezvousCode(' '+code.toLowerCase()+' '),code);
  }
  assert.throws(()=>createRendezvousCode({length:5}));assert.throws(()=>canonicalRendezvousCode('ABC-234'));
});


test('frozen character mapping agrees with independent Node bit encoding and word-mode PAKE',()=>{
  const fixture=JSON.parse(readFileSync(new URL('../crates/foregather-kit/vectors/access-base32-en-v1.json',import.meta.url)));
  const wordlist=readFileSync(new URL('../crates/foregather-kit/src/en-v1.txt',import.meta.url),'utf8').trimEnd().split('\n');
  for(const {code,canonicalWords} of fixture.vectors) {
    const bits=[...code].map(c=>fixture.alphabet.indexOf(c).toString(2).padStart(5,'0')).join('');
    const chunks=bits.match(/.{1,11}/g).map(chunk=>Number.parseInt(chunk.padEnd(11,'0'),2));
    assert.equal([1024+code.length,...chunks].map(i=>wordlist[i]).join(' '),canonicalWords);
    const offer=createLiveOffer({namespace,purpose,now});
    const a=createCharacterPairing({session:offer.session,secretCode:code,namespace,purpose,role:'inviter',now});
    const b=createLivePairing({session:offer.session,secretWords:canonicalWords,namespace,purpose,role:'recipient',now});
    const ax=a.start({now}),bx=b.start({now}),ah=ax.hello(),bh=bx.hello();
    const ap=ax.finish({peerHello:bh,now}),bp=bx.finish({peerHello:ah,now}),aproof=ap.proof(),bproof=bp.proof();
    const ac=ap.confirm({peerProof:bproof,now}),bc=bp.confirm({peerProof:aproof,now});
    assert.equal(ac.verificationWords({now}),bc.verificationWords({now}));a.dispose();b.dispose();ac.dispose();bc.dispose();
  }
});
