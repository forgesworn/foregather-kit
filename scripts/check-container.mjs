// Hosted Linux smoke: test the packaged entrypoint and clean only our container.
import {execFileSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import assert from 'node:assert/strict';
const name='foregather-check-'+randomBytes(6).toString('hex'),token=randomBytes(32).toString('base64url');
const docker=(args,env)=>execFileSync('docker',args,{encoding:'utf8',stdio:'pipe',env:env?{...process.env,...env}:process.env});
try {
  docker(['run','--detach','--name',name,'--read-only','--tmpfs','/data:rw,size=64m,uid=10001,gid=10001,mode=0700','--tmpfs','/tmp:rw,size=8m','--cap-drop','ALL','--security-opt','no-new-privileges:true','--publish','127.0.0.1::8787','--env','FOREGATHER_CREATE_TOKEN','--env','FOREGATHER_ENABLE_LIVE=1','foregather-check'],{FOREGATHER_CREATE_TOKEN:token});
  const port=docker(['port',name,'8787/tcp']).trim().split(':').at(-1),origin='http://127.0.0.1:'+port;
  let response;for(let attempt=0;attempt<50;attempt++){try{response=await fetch(origin+'/health',{signal:AbortSignal.timeout(1000)});if(response.ok)break;}catch{}await delay(100);}
  assert.equal(response?.status,200);
  const now=Math.floor(Date.now()/1000),headers={'Content-Type':'application/json',Authorization:'Bearer '+token};
  const grant=await fetch(origin+'/v1/creation-grants',{method:'POST',headers,body:JSON.stringify({resource:'live',expires:now+120,max_uses:1,max_invitation_lifetime:120})});assert.equal(grant.status,201);
  const {token:creation}=await grant.json();const session={profile:'foregather-live/spake2-ed25519/1',namespace:'container.test',purpose:'invitation',locator:randomBytes(16).toString('base64url'),issued:now,expires:now+120};
  const created=await fetch(origin+'/v1/live-sessions',{method:'POST',headers:{...headers,Authorization:'Bearer '+creation},body:JSON.stringify({session,secret_format:'words'})});assert.equal(created.status,201);
  const allocation=await created.json();assert.equal((await fetch(origin+'/v1/live-sessions/rooms/'+allocation.room_code)).status,200);
  assert.equal(docker(['inspect','--format','{{.Config.User}}',name]).trim(),'10001:10001');
  docker(['stop','--time','10',name]);assert.equal(docker(['inspect','--format','{{.State.ExitCode}}',name]).trim(),'0');
  console.log(JSON.stringify({passed:true,containerEntrypoint:true,unprivileged:true,scopedCreation:true,liveDirectory:true,gracefulSigterm:true}));
}finally{try{docker(['rm','--force',name]);}catch{}}
