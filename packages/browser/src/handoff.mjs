import {parseLiveSession} from './index.mjs';
import {create_public_handoff,parse_public_handoff} from './foregather_wasm.js';
const invalid=()=>{throw new Error('Invalid pairing link');};
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===keys;
export function validatePublicRoom({room,namespace,purpose,now}) {
  if(!exact(room,'secret_format,session')||!['words','characters'].includes(room.secret_format))invalid();
  return Object.freeze({session:parseLiveSession({session:room.session,namespace,purpose,now}),secret_format:room.secret_format});
}
export function createPairingLink({baseUrl,room,namespace,purpose,now,allowLoopbackHttp=false}) {
  room=validatePublicRoom({room,namespace,purpose,now});
  if(typeof baseUrl!=='string'||baseUrl.length>2048||typeof allowLoopbackHttp!=='boolean')invalid();
  return create_public_handoff(baseUrl,JSON.stringify(room),allowLoopbackHttp,namespace,purpose,now);
}
export function parsePairingLink({url,baseUrl,namespace,purpose,now,allowLoopbackHttp=false}) {
  if(typeof url!=='string'||url.length>2048||typeof baseUrl!=='string'||baseUrl.length>2048||typeof allowLoopbackHttp!=='boolean')invalid();
  const room=JSON.parse(parse_public_handoff(url,baseUrl,allowLoopbackHttp,namespace,purpose,now));
  return validatePublicRoom({room,namespace,purpose,now});
}
