import {init,createLiveOffer,createLivePairing,createCharacterOffer,createCharacterPairing,canonicalRendezvousCode} from '/pkg/index.mjs';
await init();
const namespace='demo.live',purpose='invitation',now=()=>Math.floor(Date.now()/1000),$=id=>document.getElementById(id);
let gate,channel,session,role,secretFormat='words',active=false,countdown;
function phase(value) {
  $('shell').dataset.phase=value;
  $('shell').classList.toggle('in-session',Boolean(session));
  const step=value==='connected'?2:['sent','received'].includes(value)?3:1;
  for(let i=1;i<=3;i++) {
    const item=$(`step-${i}`);item.dataset.state=i<step?'done':i===step?'current':'pending';
    if(i===step)item.setAttribute('aria-current','step');else item.removeAttribute('aria-current');
  }
  $('restart').hidden=value==='ready';
}
function status(value,state){$('status').textContent=value;if(state)phase(state);}
function showExpiry() {
  clearInterval(countdown);
  const update=()=>{
    const remaining=Math.max(0,session.expires-now());
    $('expiry').textContent=remaining?`${Math.floor(remaining/60)}:${String(remaining%60).padStart(2,'0')} left`:'Expired';
    if(!remaining){clearInterval(countdown);for(const id of ['copy-room','copy-link','copy-secret'])$(id).disabled=true;}
  };
  update();countdown=setInterval(update,1000);
}
async function copy(value,label) {
  try {await navigator.clipboard.writeText(value);$('copy-feedback').textContent=`${label} copied.`;}
  catch {$('copy-feedback').textContent='Could not copy. Select the text and copy it manually.';}
}
async function put(kind,value){const r=await fetch(`/relay/${session.locator}/${role}/${kind}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value),credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(5000)});if(r.status!==201)throw Error('Relay refused message');}
async function get(kind){const peer=role==='inviter'?'recipient':'inviter';while(active&&now()<session.expires){const r=await fetch(`/relay/${session.locator}/${peer}/${kind}`,{credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(5000)});if(r.ok){const reader=r.body.getReader();let size=0;const chunks=[];try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>24576){await reader.cancel();throw Error('Oversized relay response');}chunks.push(value);}const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}finally{reader.releaseLock();}}if(r.status!==404)throw Error('Relay failed');await new Promise(resolve=>setTimeout(resolve,100));}throw Error('Pairing expired');}
async function connect(){active=true;let exchange,pending;try{
  exchange=gate.start({now:now()});await put('hello',exchange.hello());status('Waiting for the other client','waiting');
  pending=exchange.finish({peerHello:await get('hello'),now:now()});await put('proof',pending.proof());
  channel=pending.confirm({peerProof:await get('proof'),now:now()});gate.dispose();$('secret').textContent='Secret used';$('secret').dataset.format='words';$('copy-secret').hidden=true;$('copy-feedback').textContent='';$('guest').hidden=true;$('host').hidden=true;
  $('verification').textContent=channel.verificationWords({now:now()});$('confirmed').hidden=false;status('Paired — compare the verification words','connected');$('verification-title').focus();
  if(role==='inviter')$('send').hidden=false;
  else {const packet=await get('payload');const payload=channel.open({packet:JSON.stringify(packet),now:now()});$('payload').textContent=new TextDecoder('utf-8',{fatal:true}).decode(payload);payload.fill(0);$('received').hidden=false;status('Invitation received for review','received');}
} catch {active=false;channel?.dispose();gate?.dispose();$('send').hidden=true;$('confirmed').hidden=true;$('copy-secret').hidden=true;$('secret').textContent='Secret no longer usable';status('Pairing failed or expired. Create a fresh code to retry.','error');} finally{exchange?.dispose();pending?.dispose();}}
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
  document.querySelector('label[for="code"]').textContent=secretFormat==='characters'?'Secret characters':'Secret words';
  $('code').placeholder=secretFormat==='characters'?'e.g. ABC234':'Enter the words in order';
  phase('invited');$('code').focus();
}
$('format').onchange=()=>{const characters=$('format').value==='characters';$('length').min=characters?'6':'2';$('length').max=characters?'32':'16';$('length').value=characters?'6':'4';document.querySelector('label[for="length"]').textContent=characters?'Number of characters':'Number of words';$('format-help').textContent=characters?'6–32 characters. Compact and easy to type.':'2–16 words. Easy to read aloud.';};
$('create-form').onsubmit=async event=>{event.preventDefault();try{
  if(!$('length').reportValidity())return;
  $('create').disabled=true;secretFormat=$('format').value;
  const count=Number($('length').value);
  const offer=secretFormat==='characters'?createCharacterOffer({namespace,purpose,characterCount:count,now:now()}):createLiveOffer({namespace,purpose,wordCount:count,now:now()});
  session=offer.session;role='inviter';gate=pairing(secretFormat==='characters'?offer.secretCode:offer.secretWords);
  const room={session,secretFormat};
  const allocation=await publicJson('/rooms',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(room)});
  const roomCode=canonicalRendezvousCode(allocation.roomCode);if(roomCode.length!==6)throw Error('Invalid public code');
  const bytes=new TextEncoder().encode(JSON.stringify(room));const fragment=btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
  $('link').href=`${location.origin}/#${fragment}`;
  $('room-code').textContent=roomCode;$('secret-label').textContent=secretFormat==='characters'?'Private secret characters':'Private secret words';
  $('secret').textContent=secretFormat==='characters'?offer.secretCode:offer.secretWords;$('secret').dataset.format=secretFormat;$('setup').hidden=true;$('host').setAttribute('aria-labelledby','offer-title');$('offer').hidden=false;$('lookup').hidden=true;$('format').disabled=true;$('length').disabled=true;showExpiry();void connect();
} catch{gate?.dispose();status('Could not create pairing. Start again to create a fresh pairing.','error');}};
if(location.hash){try{
  const fragment=location.hash.slice(1);if(fragment.length>1400)throw Error();
  const publicValue=JSON.parse(atob(fragment.replaceAll('-','+').replaceAll('_','/')));
  // Retain the original public-session link form for word-mode compatibility.
  recipient(publicValue.session?publicValue:{session:publicValue,secretFormat:'words'});
} catch{status('Invalid pairing link','error');}}
$('find-form').onsubmit=async event=>{event.preventDefault();try{
  const code=canonicalRendezvousCode($('room').value);if(code.length!==6)throw Error();
  $('find').disabled=true;recipient(await publicJson(`/rooms/${code}`,{method:'GET'}));status('Pairing found — enter the separate secret');
} catch{$('find').disabled=false;status('Pairing not found or expired. Check the public room code.','error');}};
$('pair-form').onsubmit=event=>{event.preventDefault();try{gate=pairing($('code').value);$('code').value='';$('code').disabled=true;$('pair').disabled=true;void connect();}catch{status('Check the pairing link and secret','error');}};
$('transfer').onclick=async()=>{try{$('transfer').disabled=true;const payload=new TextEncoder().encode($('invitation').value);const packet=channel.seal({payload,now:now()});payload.fill(0);await put('payload',JSON.parse(packet));$('transfer').textContent='Invitation sent';$('invitation').disabled=true;status('Encrypted invitation sent for review','sent');}catch{status('Transfer failed','error');}};
$('copy-room').onclick=()=>copy($('room-code').textContent,'Public room code');
$('copy-secret').onclick=()=>copy($('secret').textContent,'Private secret');
$('copy-link').onclick=()=>copy($('link').href,'Pairing link');
$('restart').onclick=()=>{active=false;clearInterval(countdown);gate?.dispose();channel?.dispose();location.assign(location.pathname);};
addEventListener('pagehide',()=>{active=false;clearInterval(countdown);gate?.dispose();channel?.dispose();});
