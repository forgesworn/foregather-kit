// Independent implementation; synthetic keys/nonces only. Never imported by production.
import {createCipheriv} from 'node:crypto';
import {writeFileSync} from 'node:fs';
const vectors=[];
for(const [name,payload,seed] of [['binary',Buffer.from([0,255,1,128,0,42]),7],['empty',Buffer.alloc(0),17]]) {
  const id=Buffer.alloc(16,seed).toString('base64url'), key=Buffer.alloc(32,seed+2), nonce=Buffer.alloc(12,seed+4);
  const namespace='example.rooms',now=1800000000,expires=now+3600;
  const cipher=createCipheriv('aes-256-gcm',key,nonce);
  cipher.setAAD(Buffer.from(`foregather-envelope/v1:${namespace}:${id}:${expires}`));
  const encrypted=Buffer.concat([cipher.update(JSON.stringify({v:1,data:payload.toString('base64url')})),cipher.final(),cipher.getAuthTag()]);
  vectors.push({name,namespace,now,base:'https://resolver.example/i/',url:`https://resolver.example/i/${id}#${key.toString('base64url')}`,
    payload:payload.toString('base64url'),envelope:{v:1,expires,nonce:nonce.toString('base64url'),ciphertext:encrypted.toString('base64url')}});
}
writeFileSync(new URL('../crates/foregather-kit/vectors/foregather-v1.json',import.meta.url),JSON.stringify({protocol:'foregather-envelope/v1',syntheticOnly:true,generatedBy:'Independent Node AES-256-GCM implementation',vectors},null,2)+'\n');
