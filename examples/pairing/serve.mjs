// Loopback demonstration gateway. Creation authority stays on this server.
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {readFileSync,mkdtempSync,rmSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes} from 'node:crypto';
import {createCreationGrantClient,createLiveRelayClient} from '../../packages/browser/dist/transport.mjs';
const directory=mkdtempSync(join(tmpdir(),'foregather-pairing-demo-')),operatorToken=randomBytes(32).toString('base64url');
let relay,server,origin,closing=false;
async function cleanup() {
  if(closing)return;closing=true;
  if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
  if(relay&&relay.exitCode===null&&relay.signalCode===null){const exited=once(relay,'exit');relay.kill('SIGINT');await exited;}
  rmSync(directory,{recursive:true,force:true});
}
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{void cleanup().then(()=>process.exit(0));});
try {
  relay=spawn(fileURLToPath(new URL('../../target/debug/foregather-server',import.meta.url)),[],{env:{...process.env,FOREGATHER_DB:join(directory,'db'),FOREGATHER_CREATE_TOKEN:operatorToken,FOREGATHER_BIND:'127.0.0.1:0',FOREGATHER_ENABLE_LIVE:'1'},stdio:['ignore','ignore','pipe']});
  const upstream=await new Promise((resolve,reject)=>{let text='';const timer=setTimeout(()=>reject(Error('Build the resolver before starting the demo')),10000);
    relay.stderr.on('data',chunk=>{text+=chunk;const match=/listening on (127\.0\.0\.1:\d+)/.exec(text);if(match){clearTimeout(timer);resolve('http://'+match[1]);}});
    relay.once('error',error=>{clearTimeout(timer);reject(error);});relay.once('exit',()=>{clearTimeout(timer);reject(Error('Demo resolver exited'));});
  });
  const grants=createCreationGrantClient({apiUrl:upstream+'/v1/',allowLoopbackHttp:true}),client=createLiveRelayClient({apiUrl:upstream+'/v1/',allowLoopbackHttp:true});
  const assets=new Map(readdirSync(new URL('../../packages/browser/dist/',import.meta.url)).filter(name=>/^[a-zA-Z0-9_-]+\.(?:mjs|js|wasm)$/.test(name)).map(name=>['/pkg/'+name,new URL('../../packages/browser/dist/'+name,import.meta.url)]));
  server=createServer(async(req,res)=>{
    for(const [name,value] of [['Cache-Control','no-store'],['Referrer-Policy','no-referrer'],['X-Content-Type-Options','nosniff'],['Content-Security-Policy',"default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; connect-src 'self'; img-src 'self' blob:; media-src 'self' blob:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"]])res.setHeader(name,value);
    if(req.headers.host!==new URL(origin).host){res.writeHead(403).end();return;}
    const url=new URL(req.url,origin);if(url.search){res.writeHead(400).end();return;}
    try {
      if(url.pathname==='/allocate'||url.pathname.startsWith('/v1/')) {
        if(req.method!=='GET'&&req.headers.origin!==origin){res.writeHead(403).end();return;}
        const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>24576){res.writeHead(413).end();return;}chunks.push(chunk);}
        if(url.pathname==='/allocate') {
          if(req.method!=='POST'){res.writeHead(405).end();return;}
          const room=JSON.parse(Buffer.concat(chunks).toString());
          if(room?.session?.namespace!=='demo.pairing'||room.session.purpose!=='invitation'){res.writeHead(400).end();return;}
          const grant=await grants.issue({operatorToken,resource:'live',expires:Math.floor(Date.now()/1000)+60,maxUses:1,maxInvitationLifetime:120});
          try {const allocation=await client.allocate({room,createToken:grant.token});res.writeHead(201,{'Content-Type':'application/json'}).end(JSON.stringify(allocation));}
          finally {await grants.revoke({operatorToken,grantId:grant.id});}return;
        }
        if(!/^\/v1\/live-sessions\/(?:rooms\/[0-9A-HJKMNP-TV-Z]{6}|[A-Za-z0-9_-]{22}(?:\/claim|\/messages\/(?:inviter|recipient)\/(?:hello|proof|packet-[0-9]+))?)$/.test(url.pathname)||!['GET','POST','PUT','DELETE'].includes(req.method)){res.writeHead(404).end();return;}
        const headers={};if(req.headers.authorization)headers.Authorization=req.headers.authorization;if(size)headers['Content-Type']='application/json';
        const response=await fetch(upstream+url.pathname,{method:req.method,headers,body:['POST','PUT'].includes(req.method)?Buffer.concat(chunks):undefined,credentials:'omit',redirect:'error',signal:AbortSignal.timeout(10000)});
        const body=Buffer.from(await response.arrayBuffer());if(body.length>24576)throw Error('Oversized resolver response');res.writeHead(response.status,{'Content-Type':'application/json'}).end(body);return;
      }
      if(req.method!=='GET'){res.writeHead(405).end();return;}
      const path=url.pathname==='/'?'index.html':url.pathname==='/pairing.mjs'?'pairing.mjs':url.pathname==='/pairing.css'?'pairing.css':null;
      const file=path?new URL(path,import.meta.url):assets.get(url.pathname);if(!file){res.writeHead(404).end();return;}
      res.setHeader('Content-Type',url.pathname==='/'?'text/html':url.pathname.endsWith('.css')?'text/css':url.pathname.endsWith('.wasm')?'application/wasm':'text/javascript');res.end(readFileSync(file));
    }catch{if(!res.headersSent)res.writeHead(502);res.end();}
  });
  server.requestTimeout=10000;server.headersTimeout=5000;
  await new Promise(resolve=>server.listen(Number(process.env.FOREGATHER_PAIRING_PORT??8790),'127.0.0.1',resolve));origin=`http://127.0.0.1:${server.address().port}`;console.error(`Foregather pairing demo listening on ${origin}`);
}catch(error){await cleanup();throw error;}
