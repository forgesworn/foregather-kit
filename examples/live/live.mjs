import {init,createLiveOffer,createLivePairing} from '/pkg/index.mjs';
await init();
const namespace='demo.live',purpose='invitation',now=()=>Math.floor(Date.now()/1000),$=id=>document.getElementById(id);
let gate,channel,session,role,active=false;
function status(value){$('status').textContent=value;}
async function put(kind,value){const r=await fetch(`/relay/${session.locator}/${role}/${kind}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value),credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(5000)});if(r.status!==201)throw Error('Relay refused message');}
async function get(kind){const peer=role==='inviter'?'recipient':'inviter';while(active&&now()<session.expires){const r=await fetch(`/relay/${session.locator}/${peer}/${kind}`,{credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(5000)});if(r.ok){const reader=r.body.getReader();let size=0;const chunks=[];try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>24576){await reader.cancel();throw Error('Oversized relay response');}chunks.push(value);}const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}finally{reader.releaseLock();}}if(r.status!==404)throw Error('Relay failed');await new Promise(resolve=>setTimeout(resolve,100));}throw Error('Pairing expired');}
async function connect(){active=true;let exchange,pending;try{
  exchange=gate.start({now:now()});await put('hello',exchange.hello());status('Waiting for the other client');
  pending=exchange.finish({peerHello:await get('hello'),now:now()});await put('proof',pending.proof());
  channel=pending.confirm({peerProof:await get('proof'),now:now()});gate.dispose();$('secret').textContent='Code used';
  $('verification').textContent=channel.verificationWords({now:now()});$('confirmed').hidden=false;status('Paired — compare the verification words');
  if(role==='inviter')$('send').hidden=false;
  else {const packet=await get('payload');const payload=channel.open({packet:JSON.stringify(packet),now:now()});$('payload').textContent=new TextDecoder('utf-8',{fatal:true}).decode(payload);payload.fill(0);$('received').hidden=false;status('Invitation received for review');}
} catch {active=false;channel?.dispose();gate?.dispose();status('Pairing failed or expired. Create a fresh code to retry.');} finally{exchange?.dispose();pending?.dispose();}}
$('create').onclick=()=>{try{
  const offer=createLiveOffer({namespace,purpose,now:now()});session=offer.session;role='inviter';
  gate=createLivePairing({...offer,namespace,purpose,role,now:now()});
  const bytes=new TextEncoder().encode(JSON.stringify(session));const fragment=btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
  $('link').href=`${location.origin}/#${fragment}`;$('link').textContent=$('link').href;$('secret').textContent=offer.secretWords;$('offer').hidden=false;$('create').disabled=true;void connect();
} catch{status('Could not create pairing');}};
if(location.hash){try{
  const fragment=location.hash.slice(1);if(fragment.length>1400)throw Error();
  session=JSON.parse(atob(fragment.replaceAll('-','+').replaceAll('_','/')));role='recipient';history.replaceState(null,'',location.pathname);$('host').hidden=true;$('guest').hidden=false;
} catch{status('Invalid pairing link');}}
$('pair').onclick=()=>{try{gate=createLivePairing({session,secretWords:$('code').value,namespace,purpose,role,now:now()});$('code').value='';$('pair').disabled=true;void connect();}catch{status('Check the pairing link and words');}};
$('transfer').onclick=async()=>{try{const payload=new TextEncoder().encode($('invitation').value);const packet=channel.seal({payload,now:now()});payload.fill(0);await put('payload',JSON.parse(packet));$('transfer').disabled=true;status('Encrypted invitation sent for review');}catch{status('Transfer failed');}};
addEventListener('pagehide',()=>{active=false;gate?.dispose();channel?.dispose();});
