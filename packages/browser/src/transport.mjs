/** Optional, explicit HTTP transport. Tokens never occur in URL paths or queries. */
export class ForegatherTransportError extends Error {
  constructor(kind, status) {
    super(kind === 'http' ? `Foregather request failed (${status})` : `Foregather transport ${kind}`);
    this.name='ForegatherTransportError';this.kind=kind;
    if(status!==undefined)this.status=status;
  }
}
const fail=()=>{throw new ForegatherTransportError('invalid-response');};
const id=value=>{if(typeof value!=='string'||!/^[A-Za-z0-9_-]{21}[AQgw]$/.test(value))fail();return value;};
const token=value=>{if(typeof value!=='string'||!/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/.test(value))fail();return value;};
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===keys;
function publicRoom(value) {
  if(!exact(value,'secret_format,session')||!['words','characters'].includes(value.secret_format)||!exact(value.session,'expires,issued,locator,namespace,profile,purpose'))fail();
  const {profile,namespace,purpose,locator,issued,expires}=value.session;
  if(profile!=='foregather-live/spake2-ed25519/1'||![namespace,purpose].every(value=>typeof value==='string'&&/^[a-z][a-z0-9._-]{0,63}$/.test(value))||!Number.isSafeInteger(issued)||issued<0||!Number.isSafeInteger(expires)||expires<=issued||expires-issued>600)fail();id(locator);
  return {session:{profile,namespace,purpose,locator,issued,expires},secret_format:value.secret_format};
}
function canonicalBytes(value,min,max) {
  if(typeof value!=='string'||value.length>Math.ceil(max*4/3)||!/^[A-Za-z0-9_-]+$/.test(value))fail();
  let text;try{text=atob(value.replaceAll('-','+').replaceAll('_','/'));}catch{fail();}
  if(text.length<min||text.length>max||btoa(text).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'')!==value)fail();return value;
}
function publicMessage(kind,sequence,value) {
  if(kind==='hello'||kind==='proof')return canonicalBytes(value,kind==='hello'?33:32,kind==='hello'?33:32);
  if(!exact(value,'ciphertext,seq,v')||value.v!=='foregather-live/spake2-ed25519/1'||value.seq!==sequence)fail();
  return {v:value.v,seq:value.seq,ciphertext:canonicalBytes(value.ciphertext,16,16400)};
}
export function secureEndpoint(value, allowLoopbackHttp=false) {
  if(typeof value!=='string'||typeof allowLoopbackHttp!=='boolean')fail();
  const u=new URL(value);
  if(u.href!==value||u.search||u.hash||u.username||u.password||!u.pathname.endsWith('/')
    ||!(u.protocol==='https:'||allowLoopbackHttp&&u.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(u.hostname)))fail();
  return u;
}
export async function readJson(response,maxBytes=24576) {
  const reader=response.body?.getReader();if(!reader)fail();
  let total=0;const chunks=[];
  try {for(;;){const {done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>maxBytes)fail();chunks.push(value);}}
  catch(error){await reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}
  const bytes=new Uint8Array(total);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{fail();}
}
export function httpClient({apiUrl,allowLoopbackHttp=false,fetch:fetcher=globalThis.fetch}) {
  const endpoint=secureEndpoint(apiUrl,allowLoopbackHttp);if(typeof fetcher!=='function')fail();
  return async function request(method,path,{body,capability,signal,missing=false,json=false}={}) {
    signal?.throwIfAborted();
    const combined=signal?AbortSignal.any([signal,AbortSignal.timeout(10000)]):AbortSignal.timeout(10000);
    const headers={Accept:'application/json'};if(capability!==undefined)headers.Authorization=`Bearer ${token(capability)}`;
    const serialized=body===undefined?undefined:JSON.stringify(body);
    if(serialized!==undefined){if(new TextEncoder().encode(serialized).byteLength>24576)fail();headers['Content-Type']='application/json';}
    try {
      const response=await fetcher(new URL(path,endpoint),{method,headers,body:serialized,signal:combined,credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer'});
      if(missing&&response.status===404){await response.body?.cancel();return undefined;}
      if(!response.ok){await response.body?.cancel();throw new ForegatherTransportError('http',response.status);}
      if(json)return await readJson(response);
      await response.body?.cancel();return undefined;
    } catch(error) {
      if(signal?.aborted)throw new ForegatherTransportError('cancelled');
      if(combined.aborted)throw new ForegatherTransportError('timeout');
      throw error;
    }
  };
}
export function delay(ms,signal) {
  return new Promise((resolve,reject)=>{
    if(signal?.aborted){reject(signal.reason);return;}
    const abort=()=>{clearTimeout(timer);signal.removeEventListener('abort',abort);reject(signal.reason);};
    const timer=setTimeout(()=>{signal?.removeEventListener('abort',abort);resolve();},ms);
    signal?.addEventListener('abort',abort,{once:true});
  });
}
const transientReadFailure=error=>error instanceof TypeError||error?.kind==='timeout'||error?.kind==='http'&&[408,429,502,503,504].includes(error.status);
async function retryRead(request,path,options) {
  // A read retry owns no PAKE state: keep its path, capability and caller deadline.
  for(let attempt=0;;attempt++) {
    try{return await request('GET',path,options);}
    catch(error){if(options.signal?.aborted||attempt>=2||!transientReadFailure(error))throw error;await delay(100*(attempt+1),options.signal);}
  }
}
export function createCreationGrantClient(config) {
  const request=httpClient(config);
  return Object.freeze({
    async issue({operatorToken,resource,expires,maxUses,maxInvitationLifetime,signal}) {
      if(!['stored','live'].includes(resource)||!Number.isSafeInteger(expires)||expires<0||!Number.isSafeInteger(maxUses)||maxUses<1||maxUses>1000||!Number.isSafeInteger(maxInvitationLifetime)||maxInvitationLifetime<1||maxInvitationLifetime>(resource==='live'?600:604800))fail();
      const grant=await request('POST','creation-grants',{body:{resource,expires,max_uses:maxUses,max_invitation_lifetime:maxInvitationLifetime},capability:operatorToken,signal,json:true});
      if(!grant||Object.keys(grant).sort().join(',')!=='expires,id,max_invitation_lifetime,remaining,resource,token'||grant.resource!==resource||grant.expires!==expires||grant.remaining!==maxUses||grant.max_invitation_lifetime!==maxInvitationLifetime)fail();
      id(grant.id);token(grant.token);return Object.freeze(grant);
    },
    async revoke({operatorToken,grantId,signal}) {await request('DELETE',`creation-grants/${id(grantId)}`,{capability:operatorToken,signal});},
  });
}
export function createLiveRelayClient(config) {
  const request=httpClient(config);
  const kind=(value,sequence)=>{
    if(['hello','proof'].includes(value)&&sequence===undefined)return value;
    if(value==='packet'&&Number.isSafeInteger(sequence)&&sequence>=0&&sequence<32)return `packet-${sequence}`;
    fail();
  };
  function transport({locator,role,capability}) {
    id(locator);token(capability);if(!['inviter','recipient'].includes(role))fail();
    const lifetime=new AbortController();
    const alive=()=>{if(lifetime.signal.aborted)throw new ForegatherTransportError('cancelled');};
    const combined=signal=>signal?AbortSignal.any([signal,lifetime.signal]):lifetime.signal;
    return Object.freeze({
      async send({kind:messageKind,sequence,value,signal}) {alive();const suffix=kind(messageKind,sequence),body=publicMessage(messageKind,sequence,value);await request('PUT',`live-sessions/${locator}/messages/${role}/${suffix}`,{body,capability,signal:combined(signal)});alive();},
      async receive({kind:messageKind,sequence,signal}) {
        alive();signal=combined(signal);const peer=role==='inviter'?'recipient':'inviter',path=`live-sessions/${locator}/messages/${peer}/${kind(messageKind,sequence)}`;
        for(;;){signal.throwIfAborted();alive();const value=await retryRead(request,path,{capability,signal,missing:true,json:true});
          alive();if(value!==undefined)return publicMessage(messageKind,sequence,value);await delay(200,signal);
        }
      },
      dispose(){lifetime.abort(new ForegatherTransportError('cancelled'));},
    });
  }
  return Object.freeze({
    async allocate({room,createToken,signal}) {
      room=publicRoom(room);
      const allocation=await request('POST','live-sessions',{body:room,capability:createToken,signal,json:true});
      if(!allocation||Object.keys(allocation).sort().join(',')!=='delete_token,inviter_token,room,room_code'||allocation.room?.session?.locator!==room?.session?.locator||allocation.room.secret_format!==room.secret_format||typeof allocation.room_code!=='string'||!/^[0-9A-HJKMNP-TV-Z]{6}$/.test(allocation.room_code))fail();
      const returned=allocation.room.session,expected=room.session;
      if(Object.keys(returned).sort().join(',')!==Object.keys(expected).sort().join(',')||Object.keys(expected).some(key=>returned[key]!==expected[key]))fail();
      token(allocation.inviter_token);token(allocation.delete_token);return Object.freeze(allocation);
    },
    async lookup({roomCode,signal}) {
      // Public room lookup intentionally accepts no capability or access secret.
      if(typeof roomCode!=='string'||!/^[0-9A-HJKMNP-TV-Z]{6}$/.test(roomCode))fail();
      const room=await retryRead(request,`live-sessions/rooms/${roomCode}`,{signal,json:true});
      return publicRoom(room);
    },
    inviter({allocation}) {return transport({locator:allocation.room.session.locator,role:'inviter',capability:allocation.inviter_token});},
    async recipient({locator,signal}) {
      id(locator);const bytes=globalThis.crypto.getRandomValues(new Uint8Array(32));
      let text='';for(const byte of bytes)text+=String.fromCharCode(byte);bytes.fill(0);
      const capability=btoa(text).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
      // Retries reuse this claim capability; they never reset an endpoint PAKE budget.
      for(let attempt=0;;attempt++) {
        try{await request('POST',`live-sessions/${locator}/claim`,{capability,signal});break;}
        catch(error){if(signal?.aborted||attempt>=2||!(error instanceof TypeError||error?.kind==='timeout'||[408,502,503,504].includes(error?.status)))throw error;await delay(100*(attempt+1),signal);}
      }
      return transport({locator,role:'recipient',capability});
    },
    async delete({locator,deleteToken,signal}) {await request('DELETE',`live-sessions/${id(locator)}`,{capability:deleteToken,signal});},
  });
}
