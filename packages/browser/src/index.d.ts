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
