import {init,createStoredCodec,createResolverClient} from '/pkg/index.mjs';
const field=id=>document.getElementById(id);
let allocation;
try {
  await init();
  const codec=createStoredCodec({namespace:'demo.rooms',baseUrl:`${location.origin}/i/`,allowLoopbackHttp:true});
  const resolver=createResolverClient({apiUrl:`${location.origin}/v1/invitations/`,allowLoopbackHttp:true});
  if(location.pathname.startsWith('/i/')) field('received').value=location.href;
  field('create').disabled=false;field('review').disabled=false;
  async function operation(button,work) {
    button.disabled=true;field('status').textContent='Working…';
    try {await work();field('status').textContent='Done.';}
    catch {field('status').textContent='The invitation could not be processed. Check the link, expiry and connection.';}
    finally {button.disabled=button.id==='remove'&&!allocation;}
  }
  field('create').onclick=()=>operation(field('create'),async()=>{
    const payload=new TextEncoder().encode(field('payload').value);
    if(!payload.byteLength||payload.byteLength>18000)throw Error('Payload size');
    const now=Math.floor(Date.now()/1000);
    // Local demo gateway owns creation authority; no operator token enters the browser.
    const response=await fetch('/v1/invitations',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({expires:now+3600}),credentials:'omit',cache:'no-store',redirect:'error',signal:AbortSignal.timeout(10000)});
    if(!response.ok)throw Error('Allocation failed');
    allocation=await response.json();
    const sealed=codec.seal({id:allocation.id,payload,expires:allocation.expires,now});
    await resolver.upload({id:allocation.id,uploadToken:allocation.upload_token,envelope:sealed.envelope});
    field('share').value=sealed.url;field('remove').disabled=false;
  });
  field('review').onclick=()=>operation(field('review'),async()=>{
    field('candidate').textContent='';
    const url=field('received').value;
    const envelope=await resolver.fetch({id:codec.locator(url)});
    const payload=codec.open({url,envelope,now:Math.floor(Date.now()/1000)});
    try {field('candidate').textContent=new TextDecoder('utf-8',{fatal:true}).decode(payload);}
    finally {payload.fill(0);}
  });
  field('remove').onclick=()=>operation(field('remove'),async()=>{
    await resolver.delete({id:allocation.id,deleteToken:allocation.delete_token});
    allocation=undefined;field('share').value='';
  });
} catch {field('status').textContent='Foregather could not load.';}
