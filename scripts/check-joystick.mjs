// Explicit consumer checkout; no automatic discovery or application authority here.
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createServer as httpServer} from 'node:http';
import {createServer as netServer} from 'node:net';
import {readFileSync,mkdtempSync,rmSync,readdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {randomBytes} from 'node:crypto';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {init,createLiveOffer,createLiveRelayClient} from '../packages/browser/dist/index.mjs';
if(!process.argv[2])throw Error('Pass a built Joystick checkout explicitly');const peer=resolve(process.argv[2]);
await init({module_or_path:readFileSync(new URL('../packages/browser/dist/foregather_wasm_bg.wasm',import.meta.url))});
const directory=mkdtempSync(join(tmpdir(),'foregather-joystick-')),operatorToken=randomBytes(32).toString('base64url');
let relay,broker,server,browser,origin,upstream;
function ready(child,pattern) {return new Promise((resolve,reject)=>{let output='';const timer=setTimeout(()=>reject(Error('Fixture startup timed out')),10000);
  const read=chunk=>{output+=chunk;const match=pattern.exec(output);if(match){clearTimeout(timer);resolve(match[1]);}};child.stdout?.on('data',read);child.stderr?.on('data',read);child.once('error',error=>{clearTimeout(timer);reject(error);});child.once('exit',()=>{clearTimeout(timer);reject(Error('Fixture exited'));});});}
async function stop(child,signal){if(child&&child.exitCode===null&&child.signalCode===null){const exited=once(child,'exit');child.kill(signal);await exited;}}
const namespace='joystick.controller',purpose='controller-invitation',now=()=>Math.floor(Date.now()/1000);
try {
  relay=spawn(fileURLToPath(new URL('../target/debug/foregather-server',import.meta.url)),[],{env:{...process.env,FOREGATHER_DB:join(directory,'db'),FOREGATHER_CREATE_TOKEN:operatorToken,FOREGATHER_BIND:'127.0.0.1:0',FOREGATHER_ENABLE_LIVE:'1'},stdio:['ignore','pipe','pipe']});upstream='http://'+await ready(relay,/listening on (127\.0\.0\.1:\d+)/);
  const reservation=netServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  broker=spawn(process.execPath,[join(peer,'packages/broker/server.js')],{env:{...process.env,PORT:String(port),HOST:'127.0.0.1'},stdio:['ignore','pipe','pipe']});await ready(broker,/listening on (127\.0\.0\.1:\d+)/);const ws=`ws://127.0.0.1:${port}`;
  const assets=new Map(readdirSync(new URL('../packages/browser/dist/',import.meta.url)).filter(name=>/^[a-zA-Z0-9_-]+\.(?:mjs|js|wasm)$/.test(name)).map(name=>['/pkg/'+name,new URL('../packages/browser/dist/'+name,import.meta.url)]));
  for(const [name,path] of [['host','host'],['mobile','mobile'],['protocol','protocol']])assets.set('/joystick/'+name+'.js',join(peer,'packages',path,'dist/index.js'));
  server=httpServer(async(req,res)=>{
    const path=new URL(req.url,'http://localhost').pathname;res.setHeader('Cache-Control','no-store');
    if(path==='/'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Joystick Foregather consumer</title><script type="importmap">{"imports":{"@forgesworn/joystick-protocol":"/joystick/protocol.js"}}</script><p id="state"></p><button id="accept" hidden>Join game</button><button id="decline" hidden>Decline invitation</button><button id="input" hidden>Send game input</button>');return;}
    try {
      if(path.startsWith('/v1/live-sessions/')){const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>24576){res.writeHead(413).end();return;}chunks.push(chunk);}
        const response=await fetch(upstream+path,{method:req.method,headers:{...(req.headers.authorization?{Authorization:req.headers.authorization}:{}),'Content-Type':'application/json'},body:['POST','PUT'].includes(req.method)?Buffer.concat(chunks):undefined,redirect:'error',signal:AbortSignal.timeout(10000)});res.writeHead(response.status,{'Content-Type':'application/json'}).end(Buffer.from(await response.arrayBuffer()));return;}
      const file=assets.get(path);if(!file){res.writeHead(404).end();return;}res.setHeader('Content-Type',path.endsWith('.wasm')?'application/wasm':'text/javascript');res.end(readFileSync(file));
    }catch{res.writeHead(502).end();}
  });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin=`http://127.0.0.1:${server.address().port}`;
  browser=await chromium.launch({headless:true});const host=await browser.newPage(),phone=await browser.newPage({viewport:{width:375,height:812}}),requests=[];
  for(const page of [host,phone])page.on('request',request=>{if(request.url().includes('/v1/'))requests.push(request.postData()??'');});
  await host.goto(origin);await phone.goto(origin);
  await host.evaluate(async({ws,sessionId})=>{const sdk=await import('/joystick/host.js');const game=sdk.startControllerHost({ws,sessionId,pwaUrl:location.origin+'/controller'});game.setSpec({name:'Synthetic Foregather game',version:1,slots:{A:{label:'Action'}}});window.game=game;window.sdk=sdk;window.inputFrames=[];game.onInput(frame=>window.inputFrames.push(frame));}, {ws,sessionId:randomBytes(16).toString('base64url')});
  const invitation=await host.evaluate(()=>window.game.pairingUrl);const client=createLiveRelayClient({apiUrl:upstream+'/v1/',allowLoopbackHttp:true});
  for(const accept of [false,true]) {
    const offer=createLiveOffer({namespace,purpose,now:now()}),allocation=await client.allocate({room:{session:offer.session,secret_format:'words'},createToken:operatorToken});
    const setup=async(page,role)=>page.evaluate(async({offer,allocation,role,namespace,purpose})=>{const fg=await import('/pkg/index.mjs');await fg.init();const relay=fg.createLiveRelayClient({apiUrl:location.origin+'/v1/',allowLoopbackHttp:true});const transport=role==='inviter'?relay.inviter({allocation}):await relay.recipient({locator:offer.session.locator});window.flow=fg.createPairingFlow({...offer,namespace,purpose,role,now:()=>Math.floor(Date.now()/1000),transport});window.words=await window.flow.pair();},{offer,allocation,role,namespace,purpose});
    await Promise.all([setup(host,'inviter'),setup(phone,'recipient')]);assert.equal(await host.evaluate(()=>window.words),await phone.evaluate(()=>window.words));await host.evaluate(()=>window.flow.verify({matches:true}));await phone.evaluate(()=>window.flow.verify({matches:true}));
    await phone.evaluate(async expectedWs=>{const mobile=await import('/joystick/mobile.js'),host=await import('/joystick/host.js');window.controller=undefined;window.receiving=mobile.receiveControllerInvitation({flow:window.flow,parseInvitation:url=>{const token=host.decodePairingUrl(url);return token?.ws===expectedWs?token:null;},review:()=>new Promise(resolve=>{document.getElementById('state').textContent='Review invitation before joining';for(const id of ['accept','decline'])document.getElementById(id).hidden=false;document.getElementById('accept').onclick=()=>resolve(true);document.getElementById('decline').onclick=()=>resolve(false);})}).then(client=>{window.controller=client;document.getElementById('state').textContent=client?'Controller connecting':'Invitation declined';if(client){client.onSpec(()=>{document.getElementById('input').hidden=false;});document.getElementById('input').onclick=()=>client.sendInput('A','1');}});},ws);
    await host.evaluate(()=>{window.sending=window.sdk.transferControllerInvitation({host:window.game,flow:window.flow,authorise:()=>!window.game.closed});});
    await phone.getByText('Review invitation before joining',{exact:true}).waitFor();await host.evaluate(()=>window.sending);assert.equal(await host.evaluate(()=>window.game.paired),false);
    if(accept){await phone.locator('#accept').click();await phone.locator('#input').waitFor({state:'visible'});await phone.locator('#input').click();await host.waitForFunction(()=>window.inputFrames.some(frame=>frame.k==='A'&&frame.v==='1'));assert.equal(await host.evaluate(()=>window.game.paired),true);await phone.evaluate(()=>window.controller.close());await host.waitForFunction(()=>!window.game.paired);}
    else {await phone.locator('#decline').click();await phone.evaluate(()=>window.receiving);assert.equal(await host.evaluate(()=>window.game.paired),false);}
    await client.delete({locator:offer.session.locator,deleteToken:allocation.delete_token});
  }
  for(const body of requests)assert.equal(body.includes(invitation),false);
  await host.evaluate(()=>window.game.close());assert.equal(await host.evaluate(()=>window.game.closed),true);
  console.log(JSON.stringify({passed:true,realJoystickSDKs:true,realBroker:true,realRustRelay:true,twoBrowsers:true,receiptCreatesNoMembership:true,declinedReviewCreatesNoController:true,explicitReviewBeforeConnection:true,gameInputReceived:true,disconnectRecovery:true}));
}finally{await browser?.close();if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}await stop(broker,'SIGTERM');await stop(relay,'SIGINT');rmSync(directory,{recursive:true,force:true});}
