import {
  init, createStoredCodec, createKithmootCodec, createResolverClient,
  createLiveOffer, createLivePairing, deriveSpokenWords, deriveDirectionalWords,
  type Envelope, type Allocation, type LiveSession,
} from '@forgesworn/foregather-kit';

const now = 1_800_000_000;
await init({module_or_path: new Uint8Array(8)});
const codec = createStoredCodec({namespace:'example.rooms',baseUrl:'https://invites.example/i/'});
const sealed = codec.seal({id:'BwcHBwcHBwcHBwcHBwcHBw',payload:new Uint8Array(1),expires:now+120,now});
const envelope: Envelope = sealed.envelope;
const payload: Uint8Array = codec.open({url:sealed.url,envelope:JSON.stringify(envelope),now});
const locator: string = codec.locator(sealed.url);
const fold = createKithmootCodec({validateInvitation: url => url.startsWith('https://kithmoot.app/j/')});
const invitation: string = fold.open({url:sealed.url,envelope:'{}',now});
fold.seal({id:locator,invitation,expires:now+120,now});
const resolver = createResolverClient({apiUrl:'https://invites.example/v1/invitations/',fetch});
const signal = new AbortController().signal;
const allocation: Allocation = await resolver.allocate({expires:now+120,createToken:'synthetic',signal});
await resolver.upload({id:allocation.id,uploadToken:allocation.upload_token,envelope,signal});
const ciphertext: string = await resolver.fetch({id:locator,signal});
await resolver.delete({id:locator,deleteToken:allocation.delete_token,signal});
const offer = createLiveOffer({namespace:'example.rooms',purpose:'bootstrap',now});
const session: LiveSession = offer.session;
const gate = createLivePairing({...offer,namespace:'example.rooms',purpose:'bootstrap',role:'inviter',now});
const remaining: number = gate.remaining();
const exchange = gate.start({now});
const hello: string = exchange.hello();
const pending = exchange.finish({peerHello:hello,now});
const proof: string = pending.proof();
const channel = pending.confirm({peerProof:proof,now});
const verification: string = channel.verificationWords({now});
const packet: string = channel.seal({payload,now});
const opened: Uint8Array = channel.open({packet,now});
channel.dispose(); pending.dispose(); exchange.dispose(); gate.dispose();
const words: string = deriveSpokenWords({secret:payload,context:'example',counter:0});
const directional: [string,string] = deriveDirectionalWords({secret:payload,namespace:'example',roles:['a','b'],counter:0});
// These examples are compiled, never executed: each rejected call guards a public boundary.
// @ts-expect-error Payload must be bytes.
codec.seal({id:locator,payload:'plaintext',expires:now+120,now});
// @ts-expect-error A caller must supply trusted time.
createLiveOffer({namespace:'example.rooms',purpose:'bootstrap'});
// @ts-expect-error Roles are a fixed union.
createLivePairing({...offer,namespace:'example.rooms',purpose:'bootstrap',role:'observer',now});
// @ts-expect-error Live profiles cannot silently downgrade.
const wrongProfile: LiveSession = {...session,profile:'v1'};
// @ts-expect-error Fold validator must return a boolean.
createKithmootCodec({validateInvitation: () => 'accepted'});
// @ts-expect-error Directional derivation requires exactly two roles.
deriveDirectionalWords({secret:payload,namespace:'example',roles:['a'],counter:0});
