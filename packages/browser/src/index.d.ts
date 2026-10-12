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
