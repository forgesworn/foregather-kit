import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createResolverClient } from '../packages/browser/dist/index.mjs';
const id = Buffer.alloc(16,7).toString('base64url'), token = Buffer.alloc(32,9).toString('base64url');
const apiUrl = 'https://resolver.example/prefix/v1/invitations/';

test('resolver requests contain only public IDs, explicit capabilities and no ambient credentials',async()=>{
  const requests=[];
  const client = createResolverClient({apiUrl,fetch:async(url,options)=>{
    requests.push({url:String(url),options});
    if(options.method==='POST') return Response.json({id,expires:1800003600,upload_token:token,delete_token:token},{status:201});
    if(options.method==='GET') return new Response('{}');
    return new Response(null,{status:204});
  }});
  await client.allocate({expires:1800003600,createToken:token});
  await client.upload({id,uploadToken:token,envelope:'{}'});
  await client.fetch({id});
  await client.delete({id,deleteToken:token});
  assert.equal(requests[0].url,'https://resolver.example/prefix/v1/invitations');
  for(const {url,options} of requests) {
    assert.ok(!url.includes(token)); assert.ok(!url.includes('#'));
    assert.equal(options.credentials,'omit'); assert.equal(options.redirect,'error');
    assert.equal(options.cache,'no-store'); assert.equal(options.referrerPolicy,'no-referrer');
  }
  assert.equal(requests[2].options.headers.Authorization,undefined);
  await assert.rejects(()=>client.fetch({id:`${id}#${token}`}));
  assert.equal(requests.length,4);
});

test('hostile streamed responses are bounded and cancelled before parsing',async()=>{
  let cancelled=false;
  const client=createResolverClient({apiUrl,fetch:async()=>new Response(new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(32769)); },
    cancel() { cancelled=true; },
  }))});
  await assert.rejects(()=>client.fetch({id})); assert.equal(cancelled,true);
});

test('invalid endpoints and capabilities never reach fetch',async()=>{
  for(const endpoint of ['http://evil.example/v1/invitations/','https://user@resolver.example/v1/invitations/','https://resolver.example/v1/invitations/?key=x']) {
    assert.throws(()=>createResolverClient({apiUrl:endpoint}));
  }
  let requests=0;
  const client=createResolverClient({apiUrl,fetch:async()=>{requests++;return new Response('{}');}});
  await assert.rejects(()=>client.allocate({expires:1800003600,createToken:'invalid'}));
  await assert.rejects(()=>client.upload({id,uploadToken:token,envelope:' '.repeat(32769)}));
  assert.equal(requests,0);
});

test('caller cancellation is propagated to the explicit transport',async()=>{
  const controller=new AbortController(); controller.abort();
  const client=createResolverClient({apiUrl,fetch:async(_url,options)=>{assert.equal(options.signal.aborted,true);throw new DOMException('Aborted','AbortError');}});
  await assert.rejects(()=>client.fetch({id,signal:controller.signal}),{name:'AbortError'});
});
