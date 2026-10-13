import {createLivePairing,createCharacterPairing,parseLiveSession} from './index.mjs';
import {delay,ForegatherTransportError} from './transport.mjs';
import {create_transfer,transfer_receipt,transfer_payload,transfer_acknowledged} from './foregather_wasm.js';

const MAX_PAYLOAD=16364;
const invalid=()=>{throw new Error('Invalid pairing operation');};
function abortable(promise,signal) {
  return new Promise((resolve,reject)=>{
    const abort=()=>{signal.removeEventListener('abort',abort);reject(signal.reason);};
    if(signal.aborted){reject(signal.reason);return;}
    signal.addEventListener('abort',abort,{once:true});
    Promise.resolve(promise).then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));
  });
}
/** One flow owns one gate. Retries send identical bytes; a failed flow is terminal. */
export function createPairingFlow({session,secretWords,secretCode,role,namespace,purpose,now,transport,onState}) {
  if(typeof now!=='function'||!transport||typeof transport.send!=='function'||typeof transport.receive!=='function'||onState!==undefined&&typeof onState!=='function')invalid();
  let lastNow=now();session=parseLiveSession({session,namespace,purpose,now:lastNow});
  if((secretWords===undefined)===(secretCode===undefined))invalid();
  const gate=(secretCode===undefined?createLivePairing:createCharacterPairing)({session,secretWords,secretCode,role,namespace,purpose,now:lastNow,attempts:1});
  const controller=new AbortController();let channel,exchange,pending,state='idle',busy=false,verified=false;
  const notify=next=>{state=next;try{onState?.(Object.freeze({state,expires:session.expires}));}catch{/* Presentation callbacks cannot affect protocol state. */}};
  const cleanup=()=>{clearTimeout(timer);channel?.dispose();exchange?.dispose();pending?.dispose();gate.dispose();try{transport.dispose?.();}catch{/* Transport teardown cannot keep a cryptographic state alive. */}};
  const stop=next=>{if(controller.signal.aborted||['delivered','received'].includes(state))return;notify(next);controller.abort(new ForegatherTransportError(next));cleanup();};
  const timer=setTimeout(()=>stop('expired'),Math.max(0,(session.expires-lastNow)*1000));timer.unref?.();
  const clock=()=>{const value=now();if(!Number.isSafeInteger(value)||value<lastNow)invalid();lastNow=value;if(value>=session.expires){stop('expired');throw controller.signal.reason;}return value;};
  const retryable=error=>error instanceof TypeError||error?.kind==='timeout'||error?.kind==='http'&&[408,429,502,503,504].includes(error.status);
  async function sendExact(input,signal) {
    for(let attempt=0;;attempt++) {
      try {clock();await abortable(transport.send({...input,signal}),signal);return;}
      catch(error){if(signal.aborted||attempt>=2||!retryable(error))throw error;await delay(100*(attempt+1),signal);}
    }
  }
  async function operation(expected,signal,work) {
    if(busy||!expected.includes(state)||controller.signal.aborted)invalid();busy=true;
    const combined=signal?AbortSignal.any([signal,controller.signal]):controller.signal;
    const abort=()=>{if(signal?.aborted)stop('cancelled');};combined.addEventListener('abort',abort,{once:true});
    try {combined.throwIfAborted();clock();return await work(combined);}
    catch(error){if(!controller.signal.aborted)stop(signal?.aborted?'cancelled':'failed');throw error;}
    finally{combined.removeEventListener('abort',abort);busy=false;}
  }
  return Object.freeze({
    get state(){return state;},
    async pair({signal}={}) {return operation(['idle'],signal,async signal=>{
      notify('waiting');exchange=gate.start({now:clock()});
      await sendExact({kind:'hello',value:exchange.hello()},signal);
      const peerHello=await abortable(transport.receive({kind:'hello',signal}),signal);
      pending=exchange.finish({peerHello,now:clock()});exchange=undefined;notify('confirming');
      await sendExact({kind:'proof',value:pending.proof()},signal);
      const peerProof=await abortable(transport.receive({kind:'proof',signal}),signal);
      channel=pending.confirm({peerProof,now:clock()});pending=undefined;gate.dispose();
      const words=channel.verificationWords({now:clock()});notify('verifying');return words;
    });},
    verify({matches}) {if(state!=='verifying'||busy||typeof matches!=='boolean')invalid();clock();if(!matches){stop('cancelled');return;}verified=true;notify('ready');},
    async send({payload,signal}) {
      if(role!=='inviter'||!verified||!(payload instanceof Uint8Array)||payload.length>MAX_PAYLOAD)invalid();
      return operation(['ready'],signal,async signal=>{
        notify('sending');const transfer=create_transfer(payload);
        try {
          const packet=channel.seal({payload:transfer,now:clock()});
          await sendExact({kind:'packet',sequence:0,value:JSON.parse(packet)},signal);notify('awaiting-receipt');
          const reply=await abortable(transport.receive({kind:'packet',sequence:0,signal}),signal);
          const clear=channel.open({packet:JSON.stringify(reply),now:clock()});
          try{transfer_acknowledged(transfer,clear);}finally{clear.fill(0);}
        }finally{transfer.fill(0);}
        notify('delivered');cleanup();return Object.freeze({decrypted:true});
      });
    },
    async receive({signal}={}) {
      if(role!=='recipient'||!verified)invalid();
      return operation(['ready'],signal,async signal=>{
        notify('receiving');const packet=await abortable(transport.receive({kind:'packet',sequence:0,signal}),signal);
        const clear=channel.open({packet:JSON.stringify(packet),now:clock()});let payload;
        try {
          payload=transfer_payload(clear);const receipt=transfer_receipt(clear);let encrypted;
          try{encrypted=channel.seal({payload:receipt,now:clock()});}finally{receipt.fill(0);}
          await sendExact({kind:'packet',sequence:0,value:JSON.parse(encrypted)},signal);
          notify('received');cleanup();return payload;
        }catch(error){payload?.fill(0);throw error;}
        finally{clear.fill(0);}
      });
    },
    cancel(){stop('cancelled');},
    dispose(){stop('cancelled');},
  });
}
