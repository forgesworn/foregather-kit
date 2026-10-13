import type {LiveRoom} from '@forgesworn/foregather-kit';
export interface PairingLinkConfig {baseUrl:string;namespace:string;purpose:string;now:number;allowLoopbackHttp?:boolean}
export interface PairingQr {readonly url:string;readonly svg:string;readonly width:number;readonly height:number;readonly rgba:Uint8ClampedArray}
export function createPairingQr(input:PairingLinkConfig & {room:LiveRoom;scale?:number}):PairingQr;
export function decodePairingQr(input:PairingLinkConfig & {rgba:Uint8ClampedArray;width:number;height:number}):LiveRoom|null;
export function scanPairingCamera(input:Omit<PairingLinkConfig,'now'> & {video:HTMLVideoElement;now:()=>number;signal?:AbortSignal}):Promise<LiveRoom>;
