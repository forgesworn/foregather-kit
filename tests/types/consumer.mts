import {
  init, createStoredCodec, createKithmootCodec, createResolverClient,
  createLiveOffer, createLivePairing, deriveSpokenWords, deriveDirectionalWords,
  createCharacterOffer, createCharacterPairing, createRendezvousCode, canonicalRendezvousCode, formatCharacterCode, accessSecretOdds,
  type Envelope, type Allocation, type LiveSession,
} from '@forgesworn/foregather-kit';
import {createPairingFlow,parseLiveSession,createLiveRelayClient,createCreationGrantClient,ForegatherTransportError,createPairingLink,parsePairingLink,validatePublicRoom,type PairingTransport,type PairingState,type PairingExchange,type LiveRoom} from '@forgesworn/foregather-kit';
import * as storedOnly from '@forgesworn/foregather-kit/stored';
import {createPairingQr,decodePairingQr,scanPairingCamera} from '@forgesworn/foregather-kit/qr';

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

const charOffer = createCharacterOffer({namespace:'example.rooms',purpose:'bootstrap',characterCount:6,now});
const secretCode: string = charOffer.secretCode;
const charGate = createCharacterPairing({...charOffer,namespace:'example.rooms',purpose:'bootstrap',role:'inviter',now});
charGate.dispose();
const publicCode: string = canonicalRendezvousCode(createRendezvousCode({length:6}));
const readableCode: string = formatCharacterCode(secretCode);
const possibilities: bigint = accessSecretOdds({format:'characters',count:6,attempts:1}).possibilities;
// @ts-expect-error Digits-only generation is not an available secret format.
accessSecretOdds({format:'digits',count:6});
// @ts-expect-error Character access requires its own secret field.
createCharacterPairing({...offer,namespace:'example.rooms',purpose:'bootstrap',role:'recipient',now});
// @ts-expect-error Character offers require trusted time.
createCharacterOffer({namespace:'example.rooms',purpose:'bootstrap'});

const httpConfig={apiUrl:'https://example.test/v1/',fetch};
const liveRelay=createLiveRelayClient(httpConfig),grants=createCreationGrantClient(httpConfig);
const grant=await grants.issue({operatorToken:'synthetic',resource:'live',expires:now+60,maxUses:1,maxInvitationLifetime:120,signal});
await grants.revoke({operatorToken:'synthetic',grantId:grant.id,signal});
const room:LiveRoom={session,secret_format:'words'};
const liveAllocation=await liveRelay.allocate({room,createToken:grant.token,signal});
const publicRoom:LiveRoom=await liveRelay.lookup({roomCode:liveAllocation.room_code,signal});
const transport:PairingTransport=liveRelay.inviter({allocation:liveAllocation});
const receiving:PairingTransport=await liveRelay.recipient({locator:session.locator,signal});
const flow=createPairingFlow({...offer,namespace:'example.rooms',purpose:'bootstrap',role:'inviter',now:()=>now,transport,onState:progress=>{const expiry:number=progress.expires;}});
const flowWords:string=await flow.pair({signal});flow.verify({matches:true});const decrypted:true=(await flow.send({payload,signal})).decrypted;flow.cancel();flow.dispose();
const recipientFlow=createPairingFlow({...charOffer,namespace:'example.rooms',purpose:'bootstrap',role:'recipient',now:()=>now,transport:receiving});
const receivedBytes:Uint8Array=await recipientFlow.receive({signal});recipientFlow.dispose();
const keptFlow=createPairingFlow({...offer,namespace:'example.rooms',purpose:'bootstrap',role:'inviter',now:()=>now,transport});
const keptReceipt:true=(await keptFlow.send({payload,signal,keepOpen:true})).decrypted;const replyBytes:Uint8Array=await keptFlow.awaitReply({signal});keptFlow.dispose();
const replyingFlow=createPairingFlow({...charOffer,namespace:'example.rooms',purpose:'bootstrap',role:'recipient',now:()=>now,transport:receiving});
const keptBytes:Uint8Array=await replyingFlow.receive({signal,keepOpen:true});const replied:void=await replyingFlow.reply({payload:keptBytes,signal});replyingFlow.dispose();
const replyState:PairingState='awaiting-reply';
const exchangeFlow=createPairingFlow({...offer,namespace:'example.rooms',purpose:'bootstrap',role:'inviter',now:()=>now,transport});
await exchangeFlow.pair({signal});exchangeFlow.verify({matches:true});const exchanging:PairingExchange=exchangeFlow.exchange();
const exchangeSent:void=await exchanging.send({payload,signal});const exchangeBytes:Uint8Array=await exchanging.receive({signal});await exchanging.receive();
const exchangeCounts:number=exchanging.sent+exchanging.received;exchanging.close();exchangeFlow.dispose();
const exchangeStates:PairingState[]=['exchanging','closed'];
await liveRelay.delete({locator:session.locator,deleteToken:liveAllocation.delete_token,signal});
const checkedSession:Readonly<LiveSession>=parseLiveSession({session,namespace:'example.rooms',purpose:'bootstrap',now});
const linkConfig={baseUrl:'https://example.test/pair/',namespace:'example.rooms',purpose:'bootstrap',now};
const link:string=createPairingLink({...linkConfig,room});
const parsedRoom:Readonly<LiveRoom>=parsePairingLink({...linkConfig,url:link});validatePublicRoom({room:publicRoom,namespace:'example.rooms',purpose:'bootstrap',now});
const qr=createPairingQr({...linkConfig,room});const decoded:LiveRoom|null=decodePairingQr({...linkConfig,rgba:qr.rgba,width:qr.width,height:qr.height});
const scanned:LiveRoom=await scanPairingCamera({...linkConfig,now:()=>now,video:document.createElement('video'),signal});
const transportError:ForegatherTransportError=new ForegatherTransportError('http',503);
await storedOnly.init({module_or_path:new Uint8Array(8)});storedOnly.createStoredCodec({namespace:'example.rooms',baseUrl:'https://example.test/i/'});storedOnly.createCreationGrantClient(httpConfig);
// @ts-expect-error A flow receives exactly one access-secret format.
createPairingFlow({...offer,secretCode:'ABC234',namespace:'example.rooms',purpose:'bootstrap',role:'inviter',now:()=>now,transport});
// @ts-expect-error The context is selected locally; a URL cannot supply it implicitly.
parsePairingLink({baseUrl:linkConfig.baseUrl,url:link,now});
// @ts-expect-error Stored-only consumers cannot accidentally opt into live pairing.
storedOnly.createLiveOffer({namespace:'example.rooms',purpose:'bootstrap',now});
// @ts-expect-error Decryption and rendering require correctly shaped RGBA bytes.
decodePairingQr({...linkConfig,rgba:'pixels',width:10,height:10});
// @ts-expect-error Public-link payloads contain no private access secret.
createPairingLink({...linkConfig,room:{...room,secretWords:offer.secretWords}});
