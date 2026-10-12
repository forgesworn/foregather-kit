import {spawn,execFileSync} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {init,createStoredCodec,createResolverClient} from '../packages/browser/dist/index.mjs';
await init({module_or_path:readFileSync(new URL('../packages/browser/dist/foregather_wasm_bg.wasm',import.meta.url))});
const dir=mkdtempSync(join(tmpdir(),'foregather-check-')),creation=randomBytes(32).toString('base64url');
let child;
async function start() {
  child=spawn(fileURLToPath(new URL('../target/debug/foregather-server',import.meta.url)),[],{env:{...process.env,FOREGATHER_DB:join(dir,'db'),FOREGATHER_BIND:'127.0.0.1:0',FOREGATHER_CREATE_TOKEN:creation,FOREGATHER_CREATES_PER_MINUTE:'2'},stdio:['ignore','ignore','pipe']});
  return new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>reject(Error('Resolver startup timed out')),10000);
    let output='';child.stderr.on('data',chunk=>{output+=chunk;const match=output.match(/listening on (127\.0\.0\.1:\d+)/);if(match){clearTimeout(timeout);resolve(`http://${match[1]}`);}});
    child.once('exit',()=>{clearTimeout(timeout);reject(Error('Resolver stopped before startup'));});
    child.once('error',()=>{clearTimeout(timeout);reject(Error('Build the resolver binary before running this check'));});
  });
}
async function stop(){if(child?.pid&&child.exitCode===null&&child.signalCode===null){const exited=once(child,'exit');child.kill('SIGINT');await exited;}child=undefined;}
try {
  let origin=await start();
  const options=()=>({apiUrl:`${origin}/v1/invitations/`,allowLoopbackHttp:true});
  const owner=createResolverClient(options());
  const now=Math.floor(Date.now()/1000), expires=now+3600;
  const allocated=await owner.allocate({expires,createToken:creation});
  // The native inviter and WASM recipient share the library's wire protocol.
  const original='synthetic room capability for explicit review';
  const sealed=JSON.parse(execFileSync(fileURLToPath(new URL('../target/debug/examples/codec',import.meta.url)),[],{input:JSON.stringify({action:'seal',profile:'v1:demo.rooms',base:'https://demo.example/i/',id:allocated.id,payload:Buffer.from(original).toString('base64url'),now,expires}),encoding:'utf8'}));
  await owner.upload({id:allocated.id,uploadToken:allocated.upload_token,envelope:sealed.envelope});
  await stop();origin=await start();
  const guest=createResolverClient(options());
  const codec=createStoredCodec({namespace:'demo.rooms',baseUrl:'https://demo.example/i/'});
  const response=await guest.fetch({id:codec.locator(sealed.url)});
  assert.equal(new TextDecoder().decode(codec.open({url:sealed.url,envelope:response,now:Math.floor(Date.now()/1000)})),original);
  await assert.rejects(()=>guest.delete({id:allocated.id,deleteToken:allocated.upload_token}),/404/);
  await guest.delete({id:allocated.id,deleteToken:allocated.delete_token});
  await assert.rejects(()=>guest.fetch({id:allocated.id}),/404/);
  await guest.allocate({expires,createToken:creation});
  await assert.rejects(()=>guest.allocate({expires,createToken:creation}),/429/);
  console.log(JSON.stringify({passed:true,nativeToWasm:true,durableRestart:true,independentDeletion:true,creationBudgetSurvivesRestart:true}));
} finally {await stop();rmSync(dir,{recursive:true,force:true});}
