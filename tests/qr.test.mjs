import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {init,createLiveOffer,createPairingLink,parsePairingLink} from '../packages/browser/dist/index.mjs';
import {createPairingQr,decodePairingQr} from '../packages/browser/dist/qr.mjs';
await init({module_or_path:readFileSync(new URL('../packages/browser/dist/foregather_wasm_bg.wasm',import.meta.url))});
const namespace='test.qr',purpose='invitation',now=1800000000,baseUrl='https://example.test/pair/';
const config={namespace,purpose,now,baseUrl};
test('public QR link roundtrips through an independent image decoder without an access secret',()=>{
  const offer=createLiveOffer({namespace,purpose,now});const room={session:offer.session,secret_format:'words'};
  const qr=createPairingQr({...config,room});assert.equal(qr.url.includes(offer.secretWords),false);
  const publicText=Buffer.from(new URL(qr.url).hash.slice(1),'base64url').toString();assert.equal(publicText.includes(offer.secretWords),false);assert.equal(publicText.includes('secretWords'),false);
  assert.deepEqual(parsePairingLink({...config,url:qr.url}),room);
  assert.deepEqual(decodePairingQr({...config,rgba:qr.rgba,width:qr.width,height:qr.height}),room);
  const inverted=qr.rgba.map((value,index)=>index%4===3?value:255-value);
  assert.deepEqual(decodePairingQr({...config,rgba:inverted,width:qr.width,height:qr.height}),room);
});
test('handoff rejects foreign origins, changed application context, expiry and secret-bearing input',()=>{
  const offer=createLiveOffer({namespace,purpose,now});const room={session:offer.session,secret_format:'words'};
  const link=createPairingLink({...config,room});
  for(const altered of [{baseUrl:'https://other.test/pair/'},{namespace:'other.app'},{purpose:'other'},{now:now+120},{url:link+'='},{url:link.replace('/pair/','/other/')},{url:link.replace('/pair/#','/pair/?key=secret#')}])assert.throws(()=>parsePairingLink({...config,url:link,...altered}));
  assert.throws(()=>createPairingLink({...config,room:{...room,secretWords:offer.secretWords}}));
  assert.throws(()=>createPairingLink({...config,room:{...room,session:{...offer.session,secretCode:'ABC234'}}}));
  const encoded=Buffer.from(JSON.stringify({v:'unsupported',room})).toString('base64url');assert.throws(()=>parsePairingLink({...config,url:baseUrl+'#'+encoded}));
});
test('blank and malformed images cannot produce pairing requests',()=>{
  assert.equal(decodePairingQr({...config,rgba:new Uint8ClampedArray(64*64*4).fill(255),width:64,height:64}),null);
  for(const shape of [{width:0,height:1},{width:2049,height:1},{width:10,height:10}])assert.throws(()=>decodePairingQr({...config,rgba:new Uint8ClampedArray(4),...shape}));
});
