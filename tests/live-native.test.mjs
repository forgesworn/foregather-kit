import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { readFileSync } from 'node:fs';
import { createDecipheriv } from 'node:crypto';
import { init, createLiveOffer, createLivePairing, createCharacterOffer, createCharacterPairing } from '../packages/browser/dist/index.mjs';
await init({module_or_path:readFileSync(new URL('../packages/browser/dist/foregather_wasm_bg.wasm',import.meta.url))});
const now=1800000000,namespace='example.rooms',purpose='bootstrap';
for(const format of ['words','characters']) test(`native Rust peer pairs with WASM using ${format}, confirms and exchanges protected invitations`,async()=>{
  const peer=spawn(new URL('../target/debug/examples/live-peer',import.meta.url).pathname,[],{stdio:['pipe','pipe','pipe']});
  const lines=createInterface({input:peer.stdout})[Symbol.asyncIterator]();
  const request=async input=>{peer.stdin.write(JSON.stringify({now,...input})+'\n');const line=await lines.next();assert.equal(line.done,false);const result=JSON.parse(line.value);assert.equal(result.error,undefined);return result;};
  const offer=(format==='words'?createLiveOffer:createCharacterOffer)({namespace,purpose,now});
  const gate=(format==='words'?createLivePairing:createCharacterPairing)({...offer,namespace,purpose,role:'recipient',now});let channel;
  try {
    const native=await request({action:'start',...offer,namespace,purpose,role:'inviter'});
    const exchange=gate.start({now}),hello=exchange.hello();
    const nativePending=await request({action:'finish',peerHello:hello});
    const pending=exchange.finish({peerHello:native.hello,now}),proof=pending.proof();
    const confirmed=await request({action:'confirm',peerProof:proof});
    channel=pending.confirm({peerProof:nativePending.proof,now});assert.equal(channel.verificationWords({now}),confirmed.words);
    const packet=(await request({action:'seal',payload:Buffer.from('native invitation bytes').toString('base64url')})).packet;
    assert.equal(Buffer.from(channel.open({packet,now})).toString(),'native invitation bytes');
    const response=channel.seal({payload:Buffer.from('browser review acknowledgement'),now});
    assert.equal(Buffer.from((await request({action:'open',packet:response})).payload,'base64url').toString(),'browser review acknowledgement');
  } finally {channel?.dispose();gate.dispose();peer.kill();}
});
test('Node independently authenticates frozen native bootstrap vector and transcript framing',()=>{
  const v=JSON.parse(readFileSync(new URL('../crates/foregather-kit/vectors/live-spake2-ed25519-v1.json',import.meta.url)));
  const framed=parts=>Buffer.concat(parts.flatMap(part=>{part=Buffer.from(part);const len=Buffer.alloc(4);len.writeUInt32BE(part.length);return [len,part];}));
  const {packet}=v,seq=Buffer.alloc(8);seq.writeBigUInt64BE(BigInt(packet.seq));
  const aad=framed([v.session.profile,Buffer.from(v.transcript,'base64url'),'inviter',seq]);
  const bytes=Buffer.from(packet.ciphertext,'base64url');
  const decrypt=createDecipheriv('aes-256-gcm',Buffer.from(v.sendKeyA,'base64url'),Buffer.alloc(12));
  decrypt.setAAD(aad);decrypt.setAuthTag(bytes.subarray(-16));
  assert.equal(Buffer.concat([decrypt.update(bytes.subarray(0,-16)),decrypt.final()]).toString(),v.plaintext);
});
