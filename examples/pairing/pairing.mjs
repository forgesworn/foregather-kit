import {init,createLiveOffer,createCharacterOffer,createPairingFlow,createLiveRelayClient,createPairingLink,parsePairingLink,validatePublicRoom,formatCharacterCode,canonicalRendezvousCode} from '/pkg/index.mjs';
import {createPairingQr,scanPairingCamera} from '/pkg/qr.mjs';
await init();
const $=id=>document.getElementById(id),namespace='demo.pairing',purpose='invitation',now=()=>Math.floor(Date.now()/1000),baseUrl=location.origin+'/';
const relay=createLiveRelayClient({apiUrl:location.origin+'/v1/',allowLoopbackHttp:true});
let flow,room,role,allocation,countdown,scanController;
const config=()=>({baseUrl,namespace,purpose,now:now(),allowLoopbackHttp:true});
function status(message){$('status').textContent=message;}
function progress({state}) {
  const messages={waiting:'Waiting for the other client',confirming:'Confirming the encrypted pairing',verifying:'Paired — compare the verification words',ready:'Verification accepted',sending:'Sending encrypted invitation','awaiting-receipt':'Waiting for the recipient to decrypt',delivered:'Recipient decrypted the invitation',receiving:'Waiting for the invitation',received:'Invitation received for review',expired:'Pairing expired. Start again with a fresh code.',cancelled:'Pairing cancelled. Start again with a fresh code.',failed:'Pairing failed. Start again with a fresh code.'};
  status(messages[state]??state);$('restart').hidden=false;
  if(['failed','expired','cancelled'].includes(state)){for(const id of ['verification','send-section','recipient'])$(id).hidden=true;}
}
function recipient(candidate) {
  room=validatePublicRoom({room:candidate,namespace,purpose,now:now()});role='recipient';history.replaceState(null,'',location.pathname);$('setup').hidden=true;$('recipient').hidden=false;$('secret').focus();
}
async function pair(secret) {
  const transport=role==='inviter'?relay.inviter({allocation}):await relay.recipient({locator:room.session.locator});
  flow=createPairingFlow({session:room.session,...(room.secret_format==='words'?{secretWords:secret}:{secretCode:secret}),role,namespace,purpose,now,transport,onState:progress});
  const words=await flow.pair();$('private-secret').textContent='Secret used';$('offer').hidden=true;$('recipient').hidden=true;$('words').textContent=words;$('verification').hidden=false;$('matches').focus();
}
$('create-form').onsubmit=async event=>{event.preventDefault();$('create').disabled=true;try {
  role='inviter';const format=$('format').value,offer=(format==='words'?createLiveOffer:createCharacterOffer)({namespace,purpose,now:now()});room={session:offer.session,secret_format:format};
  const response=await fetch('/allocate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(room),credentials:'omit',redirect:'error',signal:AbortSignal.timeout(10000)});if(response.status!==201)throw Error('Allocation refused');allocation=await response.json();
  const secret=format==='words'?offer.secretWords:offer.secretCode;const link=createPairingLink({...config(),room});$('setup').hidden=true;$('offer').hidden=false;$('public-code').textContent=formatCharacterCode(allocation.room_code);$('private-secret').textContent=format==='words'?secret:formatCharacterCode(secret);$('link').href=link;
  const qr=createPairingQr({...config(),room});$('qr').innerHTML=qr.svg;
  countdown=setInterval(()=>{$('expires').textContent=`${Math.max(0,room.session.expires-now())} seconds left`;},1000);void pair(secret).catch(()=>status('Pairing failed. Start again with a fresh pairing.'));
}catch{status('Could not create pairing. Start again.');$('restart').hidden=false;}};
$('find-form').onsubmit=async event=>{event.preventDefault();try{recipient(await relay.lookup({roomCode:canonicalRendezvousCode($('room-code').value)}));status('Pairing found. Enter the separate secret.');}catch{status('Pairing not found or expired.');}};
$('pair-form').onsubmit=async event=>{event.preventDefault();$('pair').disabled=true;const secret=$('secret').value;$('secret').value='';try{await pair(secret);}catch{flow?.dispose();status('Pairing failed. Start again with a fresh pairing.');$('restart').hidden=false;}};
$('matches').onclick=()=>{flow.verify({matches:true});$('verification').hidden=true;if(role==='inviter')$('send-section').hidden=false;else void flow.receive().then(payload=>{$('payload').textContent=new TextDecoder('utf-8',{fatal:true}).decode(payload);payload.fill(0);$('received').hidden=false;}).catch(()=>status('Invitation transfer failed. Start again.'));};
$('mismatch').onclick=()=>flow.cancel();
$('send').onclick=async()=>{const payload=new TextEncoder().encode($('invitation').value);$('send').disabled=true;try{await flow.send({payload});}catch{status('Invitation transfer failed. Start again.');}finally{payload.fill(0);}};
$('scan').onclick=async()=>{scanController=new AbortController();$('camera').hidden=false;$('scan').disabled=true;try{recipient(await scanPairingCamera({...config(),now,video:$('camera'),signal:scanController.signal}));}catch{status('Camera unavailable or scanning cancelled. You can enter the public room code.');}finally{$('camera').hidden=true;$('scan').disabled=false;}};
function dispose(){clearInterval(countdown);scanController?.abort();flow?.dispose();}
$('restart').onclick=()=>{dispose();location.assign(location.pathname);};addEventListener('pagehide',dispose);
if(location.hash){try{recipient(parsePairingLink({...config(),url:location.href}));}catch{status('Invalid or expired pairing link.');$('restart').hidden=false;}}
