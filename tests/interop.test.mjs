import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createCipheriv, createDecipheriv } from 'node:crypto';
import { init, createStoredCodec, createKithmootCodec } from '../packages/browser/dist/index.mjs';

await init({ module_or_path: readFileSync(new URL('../packages/browser/dist/foregather_wasm_bg.wasm',import.meta.url)) });
const now = 1800000000, expires = now+3600;
const id = Buffer.alloc(16,7).toString('base64url');
const base = 'https://resolver.example/i/';
const generic = createStoredCodec({ namespace: 'example.rooms',baseUrl: base });
const fixture = JSON.parse(readFileSync(new URL('../crates/foregather-kit/vectors/kithmoot-short-invitation-v1.json',import.meta.url)));
const native = request => JSON.parse(execFileSync(fileURLToPath(new URL('../target/debug/examples/codec',import.meta.url)),[],{ input: JSON.stringify(request), encoding: 'utf8' }));
const validateInvitation = value => {
  // Test-only structural validator. Applications must supply their actual Fold parser.
  try { const u = new URL(value); const p = JSON.parse(Buffer.from(u.hash.slice(1),'base64url'));
    return u.origin==='https://kithmoot.app' && u.pathname==='/j/' && [2,3].includes(p.v) && typeof p.j==='string' && typeof p.h==='string';
  } catch { return false; }
};
const kithmoot = createKithmootCodec({ validateInvitation });

for (const vector of JSON.parse(readFileSync(new URL('../crates/foregather-kit/vectors/foregather-v1.json',import.meta.url))).vectors) {
  test(`WASM opens frozen Foregather vector ${vector.name}`,()=>{
    const codec=createStoredCodec({namespace:vector.namespace,baseUrl:vector.base});
    assert.equal(Buffer.from(codec.open({url:vector.url,envelope:JSON.stringify(vector.envelope),now:vector.now})).toString('base64url'),vector.payload);
  });
}

for (const vector of fixture.vectors) test(`WASM opens independent KithMoot vector ${vector.name}`,() => {
  assert.equal(kithmoot.open({ url: vector.url,envelope: JSON.stringify(vector.envelope),now: vector.now }),vector.fullInvitation);
});

test('Node AES-GCM independently opens WASM ciphertext',() => {
  const original = Buffer.from([0,255,1,0,128,100]);
  const sealed = generic.seal({ id,payload: original,expires,now });
  const key = Buffer.from(new URL(sealed.url).hash.slice(1),'base64url');
  const bytes = Buffer.from(sealed.envelope.ciphertext,'base64url');
  const decipher = createDecipheriv('aes-256-gcm',key,Buffer.from(sealed.envelope.nonce,'base64url'));
  decipher.setAAD(Buffer.from(`foregather-envelope/v1:example.rooms:${id}:${expires}`));
  decipher.setAuthTag(bytes.subarray(-16));
  const decoded = JSON.parse(Buffer.concat([decipher.update(bytes.subarray(0,-16)),decipher.final()]));
  assert.deepEqual(decoded,{ v: 1,data: original.toString('base64url') });
});

test('WASM independently opens Node AES-GCM ciphertext',() => {
  const key = Buffer.alloc(32,11), nonce = Buffer.alloc(12,13), data = Buffer.from('independent Node payload');
  const cipher = createCipheriv('aes-256-gcm',key,nonce);
  cipher.setAAD(Buffer.from(`foregather-envelope/v1:example.rooms:${id}:${expires}`));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify({v:1,data:data.toString('base64url')})),cipher.final(),cipher.getAuthTag()]);
  const envelope = JSON.stringify({v:1,expires,nonce:nonce.toString('base64url'),ciphertext:ciphertext.toString('base64url')});
  assert.deepEqual(Buffer.from(generic.open({url: `${base}${id}#${key.toString('base64url')}`,envelope,now})),data);
});

test('native and WASM open each other’s generated invitations',() => {
  const payload = Buffer.from('native to browser: 🫏');
  const request = { profile: 'v1:example.rooms',base,now };
  const fromNative = native({ ...request,action: 'seal',id,payload: payload.toString('base64url'),expires });
  assert.deepEqual(Buffer.from(generic.open({url:fromNative.url,envelope:JSON.stringify(fromNative.envelope),now})),payload);
  const fromWasm = generic.seal({id,payload,expires,now});
  const opened = native({...request,action:'open',url:fromWasm.url,envelope:JSON.stringify(fromWasm.envelope)});
  assert.equal(opened.payload,payload.toString('base64url'));
});

test('KithMoot compatibility preserves exact v2/v3 invitation bytes across native and WASM',() => {
  for (const vector of fixture.vectors) {
    const sealed = kithmoot.seal({id,invitation:vector.fullInvitation,expires,now});
    const opened = native({ action:'open',profile:'kithmoot/v1',base:'https://z1p.app/k/',now,url:sealed.url,envelope:JSON.stringify(sealed.envelope) });
    assert.equal(Buffer.from(opened.payload,'base64url').toString(),vector.fullInvitation);
    assert.equal(sealed.url.length,84);
  }
});

test('tampering, wrong namespace, unknown fields and expiry are rejected',() => {
  const sealed = generic.seal({id,payload:Buffer.from('secret'),expires,now});
  for (const field of ['expires','nonce','ciphertext','v','unknown']) {
    const changed = {...sealed.envelope};
    if (field==='expires') changed.expires++;
    else if (field==='v') changed.v=2;
    else if (field==='unknown') changed.unknown=true;
    else { const bytes=Buffer.from(changed[field],'base64url'); bytes[0]^=1; changed[field]=bytes.toString('base64url'); }
    assert.throws(()=>generic.open({url:sealed.url,envelope:JSON.stringify(changed),now}));
  }
  const other = createStoredCodec({namespace:'another.app',baseUrl:base});
  assert.throws(()=>other.open({url:sealed.url,envelope:JSON.stringify(sealed.envelope),now}));
  assert.throws(()=>generic.open({url:sealed.url,envelope:JSON.stringify(sealed.envelope),now:expires}));
});

test('WASM rejects unsafe clocks, oversized responses and noncanonical secret URLs',() => {
  for (const clock of [NaN,Infinity,-1,now+0.1,Number.MAX_SAFE_INTEGER+1]) {
    assert.throws(()=>generic.seal({id,payload:new Uint8Array(1),expires,now:clock}));
  }
  const sealed = generic.seal({id,payload:new Uint8Array(1),expires,now});
  assert.throws(()=>generic.open({url:sealed.url,envelope:' '.repeat(32769),now}));
  for (const url of [sealed.url+'=',sealed.url.replace('#','?tracking=1#'),sealed.url.replace('resolver.example','evil.example')]) assert.throws(()=>generic.locator(url));
});

test('KithMoot requires caller validation before sealing and after recovery',() => {
  assert.throws(()=>createKithmootCodec({}));
  const refuse = createKithmootCodec({validateInvitation:()=>false});
  const vector = fixture.vectors[0];
  assert.throws(()=>refuse.seal({id,invitation:vector.fullInvitation,expires,now}));
  assert.throws(()=>refuse.open({url:vector.url,envelope:JSON.stringify(vector.envelope),now}));
});
