export interface Envelope { v: 1; expires: number; nonce: string; ciphertext: string }
export interface SealedInvitation { url: string; envelope: Envelope }
export interface OpenInput { url: string; envelope: string; now: number }
export function init(options?: { module_or_path: BufferSource | WebAssembly.Module | RequestInfo | URL | Response }): Promise<void>;
export function createStoredCodec(config: { namespace: string; baseUrl: string; allowLoopbackHttp?: boolean }): Readonly<{
  seal(input: { id: string; payload: Uint8Array; expires: number; now: number }): SealedInvitation;
  open(input: OpenInput): Uint8Array;
  locator(url: string): string;
}>;
export function createKithmootCodec(config: { validateInvitation: (url: string) => boolean }): Readonly<{
  seal(input: { id: string; invitation: string; expires: number; now: number }): SealedInvitation;
  open(input: OpenInput): string;
  locator(url: string): string;
}>;
export interface Allocation { id: string; expires: number; upload_token: string; delete_token: string }
export function createResolverClient(config: { apiUrl: string; allowLoopbackHttp?: boolean; fetch?: typeof fetch }): Readonly<{
  allocate(input: { expires: number; createToken: string; signal?: AbortSignal }): Promise<Allocation>;
  upload(input: { id: string; uploadToken: string; envelope: Envelope | string; signal?: AbortSignal }): Promise<void>;
  fetch(input: { id: string; signal?: AbortSignal }): Promise<string>;
  delete(input: { id: string; deleteToken: string; signal?: AbortSignal }): Promise<void>;
}>;

/** Experimental profile, not RFC 9382 wire compatible or independently audited. */
export interface LiveSession { profile: 'foregather-live/spake2-ed25519/1'; namespace: string; purpose: string; locator: string; issued: number; expires: number }
export interface LiveOffer { readonly session: Readonly<LiveSession>; readonly secretWords: string }
export interface LiveChannel {
  verificationWords(input: { count?: number; now: number }): string;
  seal(input: { payload: Uint8Array; now: number }): string;
  open(input: { packet: string; now: number }): Uint8Array;
  dispose(): void;
}
export interface LiveConfirmation { proof(): string; confirm(input: { peerProof: string; now: number }): LiveChannel; dispose(): void }
export interface LiveExchange { hello(): string; finish(input: { peerHello: string; now: number }): LiveConfirmation; dispose(): void }
export interface LivePairing { remaining(): number; start(input: { now: number }): LiveExchange; dispose(): void }
export function createLiveOffer(input: { namespace: string; purpose: string; wordCount?: number; lifetime?: number; now: number }): LiveOffer;
export function createLivePairing(input: { session: LiveSession; secretWords: string; namespace: string; purpose: string; role: 'inviter' | 'recipient'; attempts?: number; now: number }): LivePairing;
export function deriveSpokenWords(input: { secret: Uint8Array; context: string; counter: number; identity?: string; count?: number }): string;
export function deriveDirectionalWords(input: { secret: Uint8Array; namespace: string; roles: [string, string]; counter: number; count?: number }): [string, string];

/** Character access secret, distinct from a public RendezvousCode. Experimental. */
export interface CharacterOffer { readonly session: Readonly<LiveSession>; readonly secretCode: string }
export function createCharacterOffer(input: { namespace: string; purpose: string; characterCount?: number; lifetime?: number; now: number }): CharacterOffer;
export function createCharacterPairing(input: { session: LiveSession; secretCode: string; namespace: string; purpose: string; role: 'inviter' | 'recipient'; attempts?: number; now: number }): LivePairing;
export function createRendezvousCode(input?: {length?: number}): string;
export function canonicalRendezvousCode(code: string): string;
/** Optional hyphens between triples are accepted; the canonical code stays unseparated. */
export function formatCharacterCode(code: string): string;
/** Applies to independent uniform generation; character count excludes separators. */
export function accessSecretOdds(input: {format: 'words' | 'characters'; count: number; attempts?: number}): Readonly<{bits: number; possibilities: bigint; guesses: number}>;

export function parseLiveSession(input: {session: LiveSession; namespace: string; purpose: string; now: number}): Readonly<LiveSession>;
export type PairingState = 'idle' | 'waiting' | 'confirming' | 'verifying' | 'ready' | 'sending' | 'awaiting-receipt' | 'delivered' | 'receiving' | 'received' | 'expired' | 'cancelled' | 'failed';
export interface PairingProgress { readonly state: PairingState; readonly expires: number }
export type LiveMessage = {kind:'hello' | 'proof'; value:string; signal?:AbortSignal} | {kind:'packet'; sequence:number; value:unknown; signal?:AbortSignal};
export type LiveReceive = {kind:'hello' | 'proof'; signal?:AbortSignal} | {kind:'packet'; sequence:number; signal?:AbortSignal};
export interface PairingTransport { send(input:LiveMessage):Promise<void>; receive(input:LiveReceive):Promise<unknown>; dispose?():void }
export interface PairingFlow {
  readonly state:PairingState;
  pair(input?:{signal?:AbortSignal}):Promise<string>;
  verify(input:{matches:boolean}):void;
  send(input:{payload:Uint8Array;signal?:AbortSignal}):Promise<Readonly<{decrypted:true}>>;
  receive(input?:{signal?:AbortSignal}):Promise<Uint8Array>;
  cancel():void;
  dispose():void;
}
export function createPairingFlow(input:{session:LiveSession;role:'inviter'|'recipient';namespace:string;purpose:string;now:()=>number;transport:PairingTransport;onState?:(progress:PairingProgress)=>void} & ({secretWords:string;secretCode?:never}|{secretCode:string;secretWords?:never})):PairingFlow;
export interface HttpConfig {apiUrl:string;allowLoopbackHttp?:boolean;fetch?:typeof fetch}
export class ForegatherTransportError extends Error { readonly kind:string; readonly status?:number; constructor(kind:string,status?:number) }
export interface CreationGrant {readonly id:string;readonly token:string;readonly resource:'stored'|'live';readonly expires:number;readonly remaining:number;readonly max_invitation_lifetime:number}
export function createCreationGrantClient(config:HttpConfig):Readonly<{
  issue(input:{operatorToken:string;resource:'stored'|'live';expires:number;maxUses:number;maxInvitationLifetime:number;signal?:AbortSignal}):Promise<CreationGrant>;
  revoke(input:{operatorToken:string;grantId:string;signal?:AbortSignal}):Promise<void>;
}>;
export interface LiveRoom {session:LiveSession;secret_format:'words'|'characters'}
export interface PairingLinkConfig {baseUrl:string;namespace:string;purpose:string;now:number;allowLoopbackHttp?:boolean}
export function validatePublicRoom(input:{room:LiveRoom;namespace:string;purpose:string;now:number}):Readonly<LiveRoom>;
export function createPairingLink(input:PairingLinkConfig & {room:LiveRoom}):string;
export function parsePairingLink(input:PairingLinkConfig & {url:string}):Readonly<LiveRoom>;
export interface LiveAllocation {readonly room:LiveRoom;readonly room_code:string;readonly inviter_token:string;readonly delete_token:string}
export function createLiveRelayClient(config:HttpConfig):Readonly<{
  allocate(input:{room:LiveRoom;createToken:string;signal?:AbortSignal}):Promise<LiveAllocation>;
  lookup(input:{roomCode:string;signal?:AbortSignal}):Promise<LiveRoom>;
  inviter(input:{allocation:LiveAllocation}):PairingTransport;
  recipient(input:{locator:string;signal?:AbortSignal}):Promise<PairingTransport>;
  delete(input:{locator:string;deleteToken:string;signal?:AbortSignal}):Promise<void>;
}>;
