import {init,createLiveOffer,createLivePairing,createCharacterOffer,createCharacterPairing,canonicalRendezvousCode} from '/pkg/index.mjs';
await init();
const namespace='demo.live',purpose='invitation',now=()=>Math.floor(Date.now()/1000),$=id=>document.getElementById(id);
let gate,channel,session,role,secretFormat='words',active=false;
function status(value){$('status').textContent=value;}
async function put(kind,value){const r=await fetch(`/relay/${session.locator}/${role}/${kind}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value),credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(5000)});if(r.status!==201)throw Error('Relay refused message');}
async function get(kind){const peer=role==='inviter'?'recipient':'inviter';while(active&&now()<session.expires){const r=await fetch(`/relay/${session.locator}/${peer}/${kind}`,{credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(5000)});if(r.ok){const reader=r.body.getReader();let size=0;const chunks=[];try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>24576){await reader.cancel();throw Error('Oversized relay response');}chunks.push(value);}const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}finally{reader.releaseLock();}}if(r.status!==404)throw Error('Relay failed');await new Promise(resolve=>setTimeout(resolve,100));}throw Error('Pairing expired');}
async function connect(){active=true;let exchange,pending;try{
  exchange=gate.start({now:now()});await put('hello',exchange.hello());status('Waiting for the other client');
  pending=exchange.finish({peerHello:await get('hello'),now:now()});await put('proof',pending.proof());
  channel=pending.confirm({peerProof:await get('proof'),now:now()});gate.dispose();$('secret').textContent='Secret used';
  $('verification').textContent=channel.verificationWords({now:now()});$('confirmed').hidden=false;status('Paired — compare the verification words');
  if(role==='inviter')$('send').hidden=false;
  else {const packet=await get('payload');const payload=channel.open({packet:JSON.stringify(packet),now:now()});$('payload').textContent=new TextDecoder('utf-8',{fatal:true}).decode(payload);payload.fill(0);$('received').hidden=false;status('Invitation received for review');}
} catch {active=false;channel?.dispose();gate?.dispose();status('Pairing failed or expired. Create a fresh code to retry.');} finally{exchange?.dispose();pending?.dispose();}}
function pairing(secret) {
  const input={session,namespace,purpose,role,now:now()};
  return secretFormat==='characters'?createCharacterPairing({...input,secretCode:secret}):createLivePairing({...input,secretWords:secret});
}
async function publicJson(url,options) {
  const response=await fetch(url,{...options,credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(5000)});
  if(!response.ok){await response.body?.cancel();throw Error('Lookup failed');}
  const reader=response.body.getReader();let size=0;const chunks=[];
  try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>1024)throw Error('Oversized lookup');chunks.push(value);}
    const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  }catch(error){await reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}
}
function recipient(room) {
  if(!room||!['words','characters'].includes(room.secretFormat)||!room.session)throw Error('Invalid pairing');
  session=room.session;secretFormat=room.secretFormat;role='recipient';
  history.replaceState(null,'',location.pathname);$('host').hidden=true;$('lookup').hidden=true;$('guest').hidden=false;
  document.querySelector('label[for="code"]').textContent=secretFormat==='characters'?'Enter the separate secret characters':'Enter the separate secret words';
}
$('format').onchange=()=>{const characters=$('format').value==='characters';$('length').min=characters?'6':'2';$('length').max=characters?'32':'16';$('length').value=characters?'6':'4';document.querySelector('label[for="length"]').textContent=characters?'Number of characters':'Number of words';};
$('create').onclick=async()=>{try{
  if(!$('length').reportValidity())return;
  $('create').disabled=true;secretFormat=$('format').value;
  const count=Number($('length').value);
  const offer=secretFormat==='characters'?createCharacterOffer({namespace,purpose,characterCount:count,now:now()}):createLiveOffer({namespace,purpose,wordCount:count,now:now()});
  session=offer.session;role='inviter';gate=pairing(secretFormat==='characters'?offer.secretCode:offer.secretWords);
  const room={session,secretFormat};
  const allocation=await publicJson('/rooms',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(room)});
  const roomCode=canonicalRendezvousCode(allocation.roomCode);if(roomCode.length!==6)throw Error('Invalid public code');
  const bytes=new TextEncoder().encode(JSON.stringify(room));const fragment=btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
  $('link').href=`${location.origin}/#${fragment}`;$('link').textContent=$('link').href;
  $('room-code').textContent=roomCode;$('secret-label').textContent=secretFormat==='characters'?'Share these secret characters separately:':'Share these secret words separately:';
  $('secret').textContent=secretFormat==='characters'?offer.secretCode:offer.secretWords;$('offer').hidden=false;$('lookup').hidden=true;$('format').disabled=true;$('length').disabled=true;void connect();
} catch{gate?.dispose();status('Could not create pairing. Reload to create a fresh pairing.');}};
if(location.hash){try{
  const fragment=location.hash.slice(1);if(fragment.length>1400)throw Error();
  const publicValue=JSON.parse(atob(fragment.replaceAll('-','+').replaceAll('_','/')));
  // Retain the original public-session link form for word-mode compatibility.
  recipient(publicValue.session?publicValue:{session:publicValue,secretFormat:'words'});
} catch{status('Invalid pairing link');}}
$('find').onclick=async()=>{try{
  const code=canonicalRendezvousCode($('room').value);if(code.length!==6)throw Error();
  $('find').disabled=true;recipient(await publicJson(`/rooms/${code}`,{method:'GET'}));status('Pairing found — enter the separate secret');
} catch{$('find').disabled=false;status('Pairing not found or expired. Check the public room code.');}};
$('pair').onclick=()=>{try{gate=pairing($('code').value);$('code').value='';$('pair').disabled=true;void connect();}catch{status('Check the pairing link and secret');}};
$('transfer').onclick=async()=>{try{const payload=new TextEncoder().encode($('invitation').value);const packet=channel.seal({payload,now:now()});payload.fill(0);await put('payload',JSON.parse(packet));$('transfer').disabled=true;status('Encrypted invitation sent for review');}catch{status('Transfer failed');}};
addEventListener('pagehide',()=>{active=false;gate?.dispose();channel?.dispose();});
