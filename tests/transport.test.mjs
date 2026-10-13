import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {init,createLiveOffer,createLiveRelayClient,createCreationGrantClient} from '../packages/browser/dist/index.mjs';
await init({module_or_path:readFileSync(new URL('../packages/browser/dist/foregather_wasm_bg.wasm',import.meta.url))});
const now=1800000000,offer=createLiveOffer({namespace:'test.transport',purpose:'invitation',now}),capability=Buffer.alloc(32,1).toString('base64url');
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
