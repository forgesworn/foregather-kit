import {createLivePairing,createCharacterPairing,parseLiveSession} from './index.mjs';
import {delay,ForegatherTransportError} from './transport.mjs';
import {create_transfer,transfer_receipt,transfer_payload,transfer_acknowledged,transfer_reply,transfer_read_reply,exchange_encode,exchange_decode} from './foregather_wasm.js';

const MAX_PAYLOAD=16364,MAX_REPLY=1024,MAX_EXCHANGE_PAYLOAD=16379,MAX_EXCHANGE_MESSAGES=32;
const invalid=()=>{throw new Error('Invalid pairing operation');};
function abortable(promise,signal) {
  return new Promise((resolve,reject)=>{
    const abort=()=>{signal.removeEventListener('abort',abort);reject(signal.reason);};
    if(signal.aborted){reject(signal.reason);return;}
    signal.addEventListener('abort',abort,{once:true});
    Promise.resolve(promise).then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));
  });
}
/** One flow owns one gate. Retries send identical bytes; a failed flow is terminal.
 * keepOpen holds the confirmed channel after the transfer for one optional
 * foregather-transfer-reply/1 message, recipient to inviter, until the deadline.
 * exchange() instead dedicates the verified channel to foregather-exchange/1:
 * up to 32 ordered messages each way, one send and one receive in flight. */
export function createPairingFlow({session,secretWords,secretCode,role,namespace,purpose,now,transport,onState}) {
  if(typeof now!=='function'||!transport||typeof transport.send!=='function'||typeof transport.receive!=='function'||onState!==undefined&&typeof onState!=='function')invalid();
  let lastNow=now();session=parseLiveSession({session,namespace,purpose,now:lastNow});
  if((secretWords===undefined)===(secretCode===undefined))invalid();
  const gate=(secretCode===undefined?createLivePairing:createCharacterPairing)({session,secretWords,secretCode,role,namespace,purpose,now:lastNow,attempts:1});
  const controller=new AbortController();let channel,exchange,pending,kept,ended,state='idle',busy=false,verified=false;
  const notify=next=>{state=next;try{onState?.(Object.freeze({state,expires:session.expires}));}catch{/* Presentation callbacks cannot affect protocol state. */}};
  const cleanup=()=>{clearTimeout(timer);kept?.fill(0);kept=undefined;channel?.dispose();exchange?.dispose();pending?.dispose();gate.dispose();try{transport.dispose?.();}catch{/* Transport teardown cannot keep a cryptographic state alive. */}};
  const stop=next=>{if(controller.signal.aborted)return;
    // A finished transfer keeps its state; a channel kept open for a reply closes.
    if(['delivered','received','replied'].includes(state)){if(kept){ended=next;controller.abort(new ForegatherTransportError(next));cleanup();}return;}
    notify(next);controller.abort(new ForegatherTransportError(next));cleanup();};
  const keptOpen=()=>{if(kept)return;if(ended)throw new ForegatherTransportError(ended);invalid();};
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
    async send({payload,signal,keepOpen=false}) {
      if(role!=='inviter'||!verified||!(payload instanceof Uint8Array)||payload.length>MAX_PAYLOAD||typeof keepOpen!=='boolean')invalid();
      return operation(['ready'],signal,async signal=>{
        notify('sending');const transfer=create_transfer(payload);
        try {
          const packet=channel.seal({payload:transfer,now:clock()});
          await sendExact({kind:'packet',sequence:0,value:JSON.parse(packet)},signal);notify('awaiting-receipt');
          const reply=await abortable(transport.receive({kind:'packet',sequence:0,signal}),signal);
          const clear=channel.open({packet:JSON.stringify(reply),now:clock()});
          try{transfer_acknowledged(transfer,clear);}finally{clear.fill(0);}
          if(keepOpen)kept=transfer.slice();
        }finally{transfer.fill(0);}
        notify('delivered');if(!keepOpen)cleanup();return Object.freeze({decrypted:true});
      });
    },
    async receive({signal,keepOpen=false}={}) {
      if(role!=='recipient'||!verified||typeof keepOpen!=='boolean')invalid();
      return operation(['ready'],signal,async signal=>{
        notify('receiving');const packet=await abortable(transport.receive({kind:'packet',sequence:0,signal}),signal);
        const clear=channel.open({packet:JSON.stringify(packet),now:clock()});let payload;
        try {
          payload=transfer_payload(clear);const receipt=transfer_receipt(clear);let encrypted;
          try{encrypted=channel.seal({payload:receipt,now:clock()});}finally{receipt.fill(0);}
          await sendExact({kind:'packet',sequence:0,value:JSON.parse(encrypted)},signal);
          if(keepOpen)kept=clear.slice();
          notify('received');if(!keepOpen)cleanup();return payload;
        }catch(error){payload?.fill(0);throw error;}
        finally{clear.fill(0);}
      });
    },
    async awaitReply({signal}={}) {
      if(role!=='inviter')invalid();keptOpen();
      return operation(['delivered'],signal,async signal=>{
        notify('awaiting-reply');const packet=await abortable(transport.receive({kind:'packet',sequence:1,signal}),signal);
        const clear=channel.open({packet:JSON.stringify(packet),now:clock()});let message;
        try{message=transfer_read_reply(kept,clear);}finally{clear.fill(0);}
        notify('replied');cleanup();return message;
      });
    },
    async reply({payload,signal}) {
      if(role!=='recipient'||!(payload instanceof Uint8Array)||payload.length>MAX_REPLY)invalid();keptOpen();
      return operation(['received'],signal,async signal=>{
        notify('replying');const frame=transfer_reply(kept,payload);let encrypted;
        try{encrypted=channel.seal({payload:frame,now:clock()});}finally{frame.fill(0);}
        await sendExact({kind:'packet',sequence:1,value:JSON.parse(encrypted)},signal);
        notify('replied');cleanup();
      });
    },
    exchange() {
      if(!verified||busy||state!=='ready'||controller.signal.aborted)invalid();clock();notify('exchanging');
      let sent=0,received=0,sending=false,receiving=false;
      const ended=()=>{if(controller.signal.aborted)throw controller.signal.reason;};
      // Send and receive run independently; any failure or cancellation ends the whole exchange.
      async function step(signal,work) {
        const combined=signal?AbortSignal.any([signal,controller.signal]):controller.signal;
        const abort=()=>{if(signal?.aborted)stop('cancelled');};combined.addEventListener('abort',abort,{once:true});
        try {combined.throwIfAborted();clock();return await work(combined);}
        catch(error){if(!controller.signal.aborted)stop(signal?.aborted?'cancelled':'failed');throw error;}
        finally{combined.removeEventListener('abort',abort);}
      }
      return Object.freeze({
        get sent(){return sent;},
        get received(){return received;},
        async send({payload,signal}) {
          ended();if(sending||sent>=MAX_EXCHANGE_MESSAGES||!(payload instanceof Uint8Array)||payload.length>MAX_EXCHANGE_PAYLOAD)invalid();
          sending=true;
          try {
            await step(signal,async signal=>{
              const index=sent,frame=exchange_encode(index,payload);let packet;
              try{packet=channel.seal({payload:frame,now:clock()});}finally{frame.fill(0);}
              sent++;await sendExact({kind:'packet',sequence:index,value:JSON.parse(packet)},signal);
            });
          }finally{sending=false;}
        },
        async receive({signal}={}) {
          ended();if(receiving||received>=MAX_EXCHANGE_MESSAGES)invalid();
          receiving=true;
          try {
            return await step(signal,async signal=>{
              const index=received,packet=await abortable(transport.receive({kind:'packet',sequence:index,signal}),signal);
              const clear=channel.open({packet:JSON.stringify(packet),now:clock()});
              try{const message=exchange_decode(index,clear);received++;return message;}finally{clear.fill(0);}
            });
          }finally{receiving=false;}
        },
        close() {if(controller.signal.aborted)return;notify('closed');controller.abort(new ForegatherTransportError('closed'));cleanup();},
      });
    },
    cancel(){stop('cancelled');},
    dispose(){stop('cancelled');},
  });
}
