import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gzipSync} from 'node:zlib';
import * as stored from '../packages/browser/dist/stored.mjs';

const bytes=readFileSync(new URL('../packages/browser/dist/foregather_stored_bg.wasm',import.meta.url));
await stored.init({module_or_path:bytes});
test('stored-only entry opens frozen wire vectors and exposes no live pairing API',()=>{
  assert.deepEqual(Object.keys(stored).sort(),['ForegatherTransportError','createCreationGrantClient','createKithmootCodec','createResolverClient','createStoredCodec','init']);
  const vectors=JSON.parse(readFileSync(new URL('../crates/foregather-kit/vectors/foregather-v1.json',import.meta.url)));
  // The independent fixtures are exercised with this separate WASM module too.
  for(const vector of vectors.vectors) {
    const codec=stored.createStoredCodec({namespace:vector.namespace,baseUrl:vector.base});
    assert.deepEqual(Buffer.from(codec.open({url:vector.url,envelope:JSON.stringify(vector.envelope),now:vector.now})),Buffer.from(vector.payload,'base64url'));
  }
  const codec=stored.createStoredCodec({namespace:'stored.example',baseUrl:'https://example.com/i/'});
  const now=1800000000,payload=new Uint8Array([0,255,1]);
  const sealed=codec.seal({id:'BwcHBwcHBwcHBwcHBwcHBw',payload,expires:now+60,now});
  assert.deepEqual(codec.open({url:sealed.url,envelope:JSON.stringify(sealed.envelope),now}),payload);
  assert.throws(()=>codec.open({url:sealed.url,envelope:JSON.stringify(sealed.envelope),now:now+60}));
});
test('stored-only WASM excludes PAKE exports and is smaller in plain and gzip bytes',()=>{
  const exports=WebAssembly.Module.exports(new WebAssembly.Module(bytes)).map(value=>value.name);
  assert.equal(exports.some(name=>/live|character|spoken|rendezvous/i.test(name)),false);
  const full=readFileSync(new URL('../packages/browser/dist/foregather_wasm_bg.wasm',import.meta.url));
  assert.ok(bytes.length<full.length);assert.ok(gzipSync(bytes).length<gzipSync(full).length);
});
