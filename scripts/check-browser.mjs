import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const root = new URL('../packages/browser/dist/',import.meta.url);
const vectors=JSON.parse(readFileSync(new URL('../crates/foregather-kit/vectors/kithmoot-short-invitation-v1.json',import.meta.url)));
const allowed=new Set(['index.mjs','foregather_wasm.js','foregather_wasm_bg.wasm','stored-api.mjs','resolver.mjs','transport.mjs','flow.mjs','handoff.mjs','qr.mjs','qrcodegen.mjs','jsqr.mjs','stored.mjs','foregather_stored.js','foregather_stored_bg.wasm']);
const server=createServer((request,response)=>{
  const name=new URL(request.url,'http://localhost').pathname.slice(1);
  response.setHeader('Cache-Control','no-store');
  if(name==='') {response.setHeader('Content-Type','text/html');response.end('<!doctype html><title>Foregather browser verification</title>');return;}
  if(!allowed.has(name)){response.writeHead(404).end();return;}
  response.setHeader('Content-Type',name.endsWith('.wasm')?'application/wasm':'text/javascript');
  response.end(readFileSync(new URL(name,root)));
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser=await chromium.launch({headless:true});
  const page=await browser.newPage(); const external=[];
  page.on('request',request=>{if(/^https?:/.test(request.url())&&new URL(request.url()).origin!==origin)external.push(request.url());});
  await page.goto(origin);
  const result=await page.evaluate(async vectors=>{
    const {init,createStoredCodec,createKithmootCodec}=await import('/index.mjs');
    const start=performance.now(); await init(); const startupMs=performance.now()-start;
    const kithmoot=createKithmootCodec({validateInvitation:value=>vectors.some(v=>v.fullInvitation===value)});
    for(const v of vectors) if(kithmoot.open({url:v.url,envelope:JSON.stringify(v.envelope),now:v.now})!==v.fullInvitation)throw Error('Vector mismatch');
    const codec=createStoredCodec({namespace:'browser.example',baseUrl:'https://resolver.example/i/'});
    const id='BwcHBwcHBwcHBwcHBwcHBw', now=1800000000;
    const sealed=codec.seal({id,payload:new TextEncoder().encode('browser-generated payload'),expires:now+3600,now});
    const recovered=new TextDecoder().decode(codec.open({url:sealed.url,envelope:JSON.stringify(sealed.envelope),now}));
    let tamperingRejected=false;
    try {codec.open({url:sealed.url,envelope:JSON.stringify({...sealed.envelope,expires:now+3599}),now});} catch {tamperingRejected=true;}
    return {recovered,tamperingRejected,startupMs,sealed};
  },vectors.vectors);
  assert.equal(result.recovered,'browser-generated payload');assert.equal(result.tamperingRejected,true);assert.deepEqual(external,[]);
  const qrResult=await page.evaluate(async()=>{
    const {createLiveOffer}=await import('/index.mjs');const {createPairingQr,decodePairingQr,scanPairingCamera}=await import('/qr.mjs');
    const config={namespace:'browser.example',purpose:'invitation',now:1800000000,baseUrl:'https://example.test/pair/'};
    const offer=createLiveOffer({namespace:config.namespace,purpose:config.purpose,now:config.now});
    const room={session:offer.session,secret_format:'words'},qr=createPairingQr({...config,room});
    const image=new Image(),objectUrl=URL.createObjectURL(new Blob([qr.svg],{type:'image/svg+xml'}));
    try {
      await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=reject;image.src=objectUrl;});
      const canvas=document.createElement('canvas');canvas.width=qr.width;canvas.height=qr.height;const context=canvas.getContext('2d');context.drawImage(image,0,0);
      const pixels=context.getImageData(0,0,canvas.width,canvas.height),decoded=decodePairingQr({...config,rgba:pixels.data,width:pixels.width,height:pixels.height});
      if(decoded?.session.locator!==offer.session.locator)throw Error('Painted QR failed');
      const original=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);let stream;
      navigator.mediaDevices.getUserMedia=async()=>{stream=canvas.captureStream(10);return stream;};
      const video=document.createElement('video');document.body.append(video);
      try {
        const scanned=await scanPairingCamera({...config,now:()=>config.now,video,signal:AbortSignal.timeout(5000)});
        if(scanned.session.locator!==offer.session.locator||stream.getTracks().some(track=>track.readyState!=='ended')||video.srcObject!==null)throw Error('Scanner cleanup failed');
        const cancelled=new AbortController();cancelled.abort();let rejected=false;
        try{await scanPairingCamera({...config,now:()=>config.now,video,signal:cancelled.signal});}catch{rejected=true;}
        if(!rejected)throw Error('Scanner cancellation failed');
        const activeCancellation=new AbortController();canvas.getContext('2d').fillStyle='#fff';canvas.getContext('2d').fillRect(0,0,canvas.width,canvas.height);
        const scanning=scanPairingCamera({...config,now:()=>config.now,video,signal:activeCancellation.signal});
        setTimeout(()=>activeCancellation.abort(),50);let activeRejected=false;try{await scanning;}catch{activeRejected=true;}
        if(!activeRejected||stream.getTracks().some(track=>track.readyState!=='ended')||video.srcObject!==null)throw Error('Active scanner cancellation failed');
        let permit;const lateStream=canvas.captureStream(10);navigator.mediaDevices.getUserMedia=()=>new Promise(resolve=>permit=resolve);
        const pendingPermission=new AbortController(),pendingScan=scanPairingCamera({...config,now:()=>config.now,video,signal:pendingPermission.signal});pendingPermission.abort();
        let permissionRejected=false;try{await pendingScan;}catch{permissionRejected=true;}if(!permissionRejected)throw Error('Pending permission did not cancel');
        permit(lateStream);await new Promise(resolve=>setTimeout(resolve,0));if(lateStream.getTracks().some(track=>track.readyState!=='ended'))throw Error('Late camera stream leaked');
      }finally{navigator.mediaDevices.getUserMedia=original;stream?.getTracks().forEach(track=>track.stop());video.remove();}
      return {paintedQrDecoded:true,simulatedCameraDecoded:true,cameraTracksStopped:true,cancellation:true};
    }finally{URL.revokeObjectURL(objectUrl);}
  });
  const storedPage=await browser.newPage(),storedRequests=[];storedPage.on('request',request=>storedRequests.push(request.url()));await storedPage.goto(origin);
  await storedPage.evaluate(async()=>{const stored=await import('/stored.mjs');await stored.init();const codec=stored.createStoredCodec({namespace:'browser.stored',baseUrl:'https://example.test/i/'}),now=1800000000;const sealed=codec.seal({id:'BwcHBwcHBwcHBwcHBwcHBw',payload:new Uint8Array([0,255]),expires:now+60,now});if(codec.open({url:sealed.url,envelope:JSON.stringify(sealed.envelope),now})[1]!==255)throw Error('Stored browser entry failed');});
  assert.equal(storedRequests.some(url=>url.endsWith('/foregather_wasm_bg.wasm')||url.endsWith('/index.mjs')),false);
  // Independently authenticate Chromium-produced ciphertext with Node.
  const {createDecipheriv}=await import('node:crypto');
  const e=result.sealed.envelope,key=Buffer.from(new URL(result.sealed.url).hash.slice(1),'base64url'),encrypted=Buffer.from(e.ciphertext,'base64url');
  const decipher=createDecipheriv('aes-256-gcm',key,Buffer.from(e.nonce,'base64url'));
  decipher.setAAD(Buffer.from(`foregather-envelope/v1:browser.example:BwcHBwcHBwcHBwcHBwcHBw:${e.expires}`));
  decipher.setAuthTag(encrypted.subarray(-16));
  assert.equal(Buffer.from(JSON.parse(Buffer.concat([decipher.update(encrypted.subarray(0,-16)),decipher.final()])).data,'base64url').toString(),'browser-generated payload');
  assert.deepEqual(external,[]);
  const wasm=readFileSync(new URL('foregather_wasm_bg.wasm',root));
  console.log(JSON.stringify({passed:true,browser:browser.version(),externalRequests:external.length,wasmBytes:statSync(new URL('foregather_wasm_bg.wasm',root)).size,wasmGzipBytes:gzipSync(wasm).length,startupMs:Math.round(result.startupMs*100)/100,storedOnlyLoaded:true,...qrResult}));
} finally {await browser?.close();await new Promise(resolve=>server.close(resolve));}
