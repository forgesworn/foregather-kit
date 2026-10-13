// Loopback-only live demonstration. The relay carries public messages and ciphertext.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import {init,createRendezvousCode} from '../../packages/browser/dist/index.mjs';
await init({module_or_path:readFileSync(new URL('../../packages/browser/dist/foregather_wasm_bg.wasm',import.meta.url))});
const slots=new Map(),rooms=new Map();let origin;
let lookupWindow=0,lookups=0;
const files=new Map([
  ['/live.mjs',new URL('live.mjs',import.meta.url)],
  ['/live.css',new URL('live.css',import.meta.url)],
  ...['index.mjs','foregather_wasm.js','foregather_wasm_bg.wasm','stored-api.mjs','resolver.mjs','transport.mjs','flow.mjs','handoff.mjs','qr.mjs','qrcodegen.mjs','jsqr.mjs','stored.mjs','foregather_stored.js','foregather_stored_bg.wasm'].map(name=>[`/pkg/${name}`,new URL(`../../packages/browser/dist/${name}`,import.meta.url)]),
]);
const server=createServer(async(req,res)=>{
  for(const [k,v] of [['Cache-Control','no-store'],['Referrer-Policy','no-referrer'],['X-Content-Type-Options','nosniff'],['Content-Security-Policy',"default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"]])res.setHeader(k,v);
  if(req.headers.host!==new URL(origin).host){res.writeHead(403).end();return;}
  const url=new URL(req.url,origin);
  if(url.search){res.writeHead(400).end();return;}
  try {
    if(url.pathname==='/rooms'||url.pathname.startsWith('/rooms/')) {
      const now=Math.floor(Date.now()/1000);
      for(const [code,room] of rooms)if(room.session.expires<=now)rooms.delete(code);
      if(req.method==='GET'&&/^\/rooms\/[0-9A-HJKMNP-TV-Z]{6}$/.test(url.pathname)) {
        const window=Math.floor(now/60);if(window!==lookupWindow){lookupWindow=window;lookups=0;}
        if(++lookups>120){res.writeHead(429).end();return;}
        const room=rooms.get(url.pathname.slice(7));
        if(!room){res.writeHead(404).end();return;}
        res.setHeader('Content-Type','application/json');res.end(JSON.stringify(room));return;
      }
      if(req.method!=='POST'||url.pathname!=='/rooms'){res.writeHead(404).end();return;}
      if(req.headers.origin!==origin){res.writeHead(403).end();return;}
      const chunks=[];let size=0;
      for await(const chunk of req){size+=chunk.length;if(size>1024){res.writeHead(413).end();return;}chunks.push(chunk);}
      const room=JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if(!room||Object.keys(room).sort().join(',')!=='secretFormat,session'||!['words','characters'].includes(room.secretFormat)){res.writeHead(400).end();return;}
      const s=room.session;
      if(!s||Object.keys(s).sort().join(',')!=='expires,issued,locator,namespace,profile,purpose'
        ||s.profile!=='foregather-live/spake2-ed25519/1'||s.namespace!=='demo.live'||s.purpose!=='invitation'
        ||typeof s.locator!=='string'||!/^[A-Za-z0-9_-]{21}[AQgw]$/.test(s.locator)
        ||!Number.isSafeInteger(s.issued)||!Number.isSafeInteger(s.expires)||s.issued<0||s.issued>now||s.expires<=now||s.expires-s.issued>120){res.writeHead(400).end();return;}
      // Recheck after reads; allocation and collision checking are synchronous.
      if(rooms.size>=64){res.writeHead(429).end();return;}
      let code;
      for(let attempt=0;attempt<8;attempt++){const candidate=createRendezvousCode();if(!rooms.has(candidate)){code=candidate;break;}}
      if(!code){res.writeHead(503).end();return;}
      rooms.set(code,room);res.setHeader('Content-Type','application/json');res.writeHead(201).end(JSON.stringify({roomCode:code}));return;
    }
    if(url.pathname.startsWith('/relay/')) {
      const match=/^\/relay\/([A-Za-z0-9_-]{22})\/(inviter|recipient)\/(hello|proof|payload)$/.exec(url.pathname);
      if(!match||!['GET','POST'].includes(req.method)){res.writeHead(404).end();return;}
      const [,id,role,kind]=match;
      if(Buffer.from(id,'base64url').toString('base64url')!==id){res.writeHead(400).end();return;}
      const now=Date.now();for(const [key,value] of slots)if(value.expires<=now)slots.delete(key);
      let slot=slots.get(id);const key=`${role}/${kind}`;
      if(req.method==='GET'){
        if(!slot?.messages.has(key)){res.writeHead(404).end();return;}
        res.setHeader('Content-Type','application/json');res.end(slot.messages.get(key));return;
      }
      if(req.headers.origin!==origin){res.writeHead(403).end();return;}
      if(!slot&&slots.size>=64){res.writeHead(429).end();return;}
      const chunks=[];let size=0;
      for await(const chunk of req){size+=chunk.length;if(size>24576){res.writeHead(413).end();return;}chunks.push(chunk);}
      // Validate shape without interpreting or possessing a pairing secret.
      const body=Buffer.concat(chunks).toString('utf8');const parsed=JSON.parse(body);
      if(kind!=='payload'&&(typeof parsed!=='string'||parsed.length>(kind==='hello'?44:43))){res.writeHead(400).end();return;}
      // Recheck after asynchronous reads: simultaneous writes cannot replace a message.
      slot=slots.get(id);
      if(!slot){if(slots.size>=64){res.writeHead(429).end();return;}slot={expires:now+120000,messages:new Map()};slots.set(id,slot);}
      if(slot.messages.has(key)){res.writeHead(409).end();return;}
      slot.messages.set(key,body);res.writeHead(201).end();return;
    }
    if(req.method!=='GET'){res.writeHead(405).end();return;}
    if(url.pathname==='/'){res.setHeader('Content-Type','text/html');res.end(readFileSync(new URL('index.html',import.meta.url)));return;}
    const file=files.get(url.pathname);if(!file){res.writeHead(404).end();return;}
    res.setHeader('Content-Type',url.pathname.endsWith('.wasm')?'application/wasm':url.pathname.endsWith('.css')?'text/css':'text/javascript');res.end(readFileSync(file));
  } catch {res.writeHead(400).end();}
});
server.requestTimeout=10000;server.headersTimeout=5000;
server.listen(Number(process.env.FOREGATHER_LIVE_PORT??8789),'127.0.0.1',()=>{origin=`http://127.0.0.1:${server.address().port}`;console.error(`Foregather live demo listening on ${origin}`);});
process.on('SIGINT',()=>server.close(()=>process.exit(0)));
