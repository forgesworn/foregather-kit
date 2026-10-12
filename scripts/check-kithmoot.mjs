// Read-only consumer check against KithMoot's installed, pinned Fold parser.
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {init,createKithmootCodec} from '../packages/browser/dist/index.mjs';
const checkout=resolve(process.argv[2]??new URL('../../kithmoot/',import.meta.url).pathname);
const consumer=JSON.parse(readFileSync(resolve(checkout,'package.json')));
const {parseRoomLink,encodeRoomLink}=await import(pathToFileURL(resolve(checkout,'node_modules/@forgesworn/fold-kit/dist/link.js')));
await init({module_or_path:readFileSync(new URL('../packages/browser/dist/foregather_wasm_bg.wasm',import.meta.url))});
const codec=createKithmootCodec({validateInvitation:value=>!!parseRoomLink(value).invitation});
const {vectors}=JSON.parse(readFileSync(new URL('../crates/foregather-kit/vectors/kithmoot-short-invitation-v1.json',import.meta.url)));
for(const vector of vectors) {
  const opened=codec.open({url:vector.url,envelope:JSON.stringify(vector.envelope),now:vector.now});
  assert.equal(opened,vector.fullInvitation);
  assert.deepEqual(parseRoomLink(opened),parseRoomLink(vector.fullInvitation));
  const id=new URL(vector.url).pathname.split('/').at(-1);
  const sealed=codec.seal({id,invitation:opened,expires:vector.now+3600,now:vector.now});
  assert.equal(codec.open({url:sealed.url,envelope:JSON.stringify(sealed.envelope),now:vector.now}),opened);
}
const legacy=encodeRoomLink('https://kithmoot.app/j/',{secret:new Uint8Array(32).fill(9),relays:[],iceUrls:[]});
assert.throws(()=>codec.seal({id:'BwcHBwcHBwcHBwcHBwcHBw',invitation:legacy,expires:1800003600,now:1800000000}));
console.log(JSON.stringify({passed:true,foldDependency:consumer.dependencies['@forgesworn/fold-kit'],vectors:vectors.length,legacyTrafficSecretRejected:true,roomMembershipCreated:false}));
