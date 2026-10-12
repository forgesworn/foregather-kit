import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const root = new URL('../packages/browser/dist/',import.meta.url);
const vectors=JSON.parse(readFileSync(new URL('../crates/foregather-kit/vectors/kithmoot-short-invitation-v1.json',import.meta.url)));
const allowed=new Set(['index.mjs','foregather_wasm.js','foregather_wasm_bg.wasm']);
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
  page.on('request',request=>{if(!request.url().startsWith(origin))external.push(request.url());});
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
  // Independently authenticate Chromium-produced ciphertext with Node.
  const {createDecipheriv}=await import('node:crypto');
  const e=result.sealed.envelope,key=Buffer.from(new URL(result.sealed.url).hash.slice(1),'base64url'),encrypted=Buffer.from(e.ciphertext,'base64url');
  const decipher=createDecipheriv('aes-256-gcm',key,Buffer.from(e.nonce,'base64url'));
  decipher.setAAD(Buffer.from(`foregather-envelope/v1:browser.example:BwcHBwcHBwcHBwcHBwcHBw:${e.expires}`));
  decipher.setAuthTag(encrypted.subarray(-16));
  assert.equal(Buffer.from(JSON.parse(Buffer.concat([decipher.update(encrypted.subarray(0,-16)),decipher.final()])).data,'base64url').toString(),'browser-generated payload');
  const wasm=readFileSync(new URL('foregather_wasm_bg.wasm',root));
  console.log(JSON.stringify({passed:true,browser:browser.version(),externalRequests:external.length,wasmBytes:statSync(new URL('foregather_wasm_bg.wasm',root)).size,wasmGzipBytes:gzipSync(wasm).length,startupMs:Math.round(result.startupMs*100)/100}));
} finally {await browser?.close();await new Promise(resolve=>server.close(resolve));}
