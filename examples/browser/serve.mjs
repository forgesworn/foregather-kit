// Local demonstration gateway. Never deploy this operator-authorised demo publicly.
import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
const token=process.env.FOREGATHER_CREATE_TOKEN;
if(!token)throw Error('Set FOREGATHER_CREATE_TOKEN to the resolver creation token');
const upstream=new URL(process.env.FOREGATHER_RESOLVER_URL??'http://127.0.0.1:8787');
if(upstream.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(upstream.hostname)||upstream.username||upstream.password||upstream.search||upstream.hash||upstream.pathname!=='/')throw Error('Demo resolver must be loopback HTTP');
const files=new Map([
  ['/demo.mjs',new URL('demo.mjs',import.meta.url)],
  ...['index.mjs','foregather_wasm.js','foregather_wasm_bg.wasm'].map(name=>[`/pkg/${name}`,new URL(`../../packages/browser/dist/${name}`,import.meta.url)]),
]);
let origin;
const server=createServer(async(req,res)=>{
  for(const [name,value] of [['Cache-Control','no-store'],['Referrer-Policy','no-referrer'],['X-Content-Type-Options','nosniff'],
    ['Content-Security-Policy',"default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"]])res.setHeader(name,value);
  if(req.headers.host!==new URL(origin).host){res.writeHead(403).end();return;}
  const url=new URL(req.url,origin);
  if(url.search){res.writeHead(400).end();return;}
  try {
    if(url.pathname.startsWith('/v1/')) {
      if(!/^\/v1\/invitations(?:\/[A-Za-z0-9_-]{22})?$/.test(url.pathname)||!['GET','POST','PUT','DELETE'].includes(req.method)){res.writeHead(404).end();return;}
      if(req.method!=='GET'&&req.headers.origin!==origin){res.writeHead(403).end();return;}
      const chunks=[];let size=0;
      for await(const chunk of req){size+=chunk.length;if(size>32768){res.writeHead(413).end();return;}chunks.push(chunk);}
      const headers={'Content-Type':'application/json'};
      if(req.method==='POST')headers.Authorization=`Bearer ${token}`;
      else if(req.headers.authorization)headers.Authorization=req.headers.authorization;
      const response=await fetch(new URL(url.pathname,upstream),{method:req.method,headers,body:['POST','PUT'].includes(req.method)?Buffer.concat(chunks):undefined,redirect:'error',signal:AbortSignal.timeout(10000)});
      res.writeHead(response.status,{'Content-Type':'application/json'});
      res.end(Buffer.from(await response.arrayBuffer()));return;
    }
    if(req.method!=='GET'){res.writeHead(405).end();return;}
    if(url.pathname==='/'||/^\/i\/[A-Za-z0-9_-]{22}$/.test(url.pathname)) {
      res.setHeader('Content-Type','text/html; charset=utf-8');res.end(readFileSync(new URL('index.html',import.meta.url)));return;
    }
    const file=files.get(url.pathname);
    if(!file){res.writeHead(404).end();return;}
    res.setHeader('Content-Type',url.pathname.endsWith('.wasm')?'application/wasm':'text/javascript');res.end(readFileSync(file));
  } catch {if(!res.headersSent)res.writeHead(502);res.end();}
});
server.requestTimeout=15000;server.headersTimeout=10000;
server.listen(Number(process.env.FOREGATHER_DEMO_PORT??8788),'127.0.0.1',()=>{
  origin=`http://127.0.0.1:${server.address().port}`;console.error(`Foregather demo listening on ${origin}`);
});
process.on('SIGINT',()=>server.close(()=>process.exit(0)));
