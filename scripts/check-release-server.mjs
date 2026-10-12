// Exercise the packaged executable, not a binary left in target/debug/.
import {spawn,execFileSync} from 'node:child_process';
import {mkdtempSync,rmSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {randomBytes} from 'node:crypto';
import {once} from 'node:events';
import assert from 'node:assert/strict';
const archive=resolve(process.argv[2]??''),dir=mkdtempSync(join(tmpdir(),'foregather-release-server-'));
let child;
try {
  const files=execFileSync('tar',['-tzf',archive],{encoding:'utf8'}).trim().split('\n');
  if(files.some(name=>name.startsWith('/')||name.split('/').includes('..')))throw Error('Invalid archive path');
  execFileSync('tar',['-xzf',archive,'-C',dir]);
  const folder=readdirSync(dir).find(name=>name.startsWith('foregather-server-v'));
  if(!folder)throw Error('Missing packaged executable');
  const token=randomBytes(32).toString('base64url');
  child=spawn(join(dir,folder,'foregather-server'),[],{env:{...process.env,FOREGATHER_BIND:'127.0.0.1:0',FOREGATHER_DB:join(dir,'private','db.sqlite'),FOREGATHER_CREATE_TOKEN:token},stdio:['ignore','ignore','pipe']});
  const origin=await new Promise((resolve,reject)=>{let output='';const timer=setTimeout(()=>reject(Error('Packaged resolver startup timed out')),10000);child.stderr.on('data',chunk=>{output+=chunk;const m=/listening on (127\.0\.0\.1:\d+)/.exec(output);if(m){clearTimeout(timer);resolve(`http://${m[1]}`);}});child.on('error',()=>{clearTimeout(timer);reject(Error('Packaged resolver could not execute'));});child.on('exit',()=>{clearTimeout(timer);reject(Error('Packaged resolver stopped'));});});
  assert.equal(await (await fetch(`${origin}/health`)).text(),'ok');
  const response=await fetch(`${origin}/v1/invitations`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({expires:Math.floor(Date.now()/1000)+120})});
  assert.equal(response.status,201);const allocation=await response.json();assert.equal(allocation.id.length,22);
  assert.equal((await fetch(`${origin}/v1/invitations/${allocation.id}`,{method:'DELETE',headers:{Authorization:`Bearer ${allocation.upload_token}`}})).status,404);
  assert.equal((await fetch(`${origin}/v1/invitations/${allocation.id}`,{method:'DELETE',headers:{Authorization:`Bearer ${allocation.delete_token}`}})).status,204);
  console.log(JSON.stringify({passed:true,packagedResolverExecutes:true,health:true,allocation:true,independentDeletion:true}));
} finally {
  if(child?.pid&&child.exitCode===null&&child.signalCode===null){const exit=once(child,'exit');child.kill('SIGINT');await exit;}
  rmSync(dir,{recursive:true,force:true});
}
