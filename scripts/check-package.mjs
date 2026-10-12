import {execFileSync} from 'node:child_process';
import {mkdtempSync,rmSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const root=fileURLToPath(new URL('../',import.meta.url)),dir=mkdtempSync(join(tmpdir(),'foregather-package-'));
try {
  const packed=JSON.parse(execFileSync('npm',['pack','./packages/browser','--json','--pack-destination',dir],{cwd:root,encoding:'utf8'}))[0];
  assert.ok(packed.files.some(f=>f.path==='dist/foregather_wasm_bg.wasm'));
  assert.ok(packed.files.some(f=>f.path==='dist/index.d.ts'));
  assert.ok(packed.files.some(f=>f.path==='THIRD_PARTY_LICENSES.txt'));
  writeFileSync(join(dir,'package.json'),JSON.stringify({type:'module',private:true}));
  execFileSync('npm',['install','--ignore-scripts','--no-audit','--no-fund',join(dir,packed.filename)],{cwd:dir,stdio:'pipe'});
  const script=`import {readFileSync} from 'node:fs';
import {init,createStoredCodec} from '@forgesworn/foregather-kit';
await init({module_or_path:readFileSync('node_modules/@forgesworn/foregather-kit/dist/foregather_wasm_bg.wasm')});
const codec=createStoredCodec({namespace:'installed.example',baseUrl:'https://resolver.example/i/'});
const now=1800000000,payload=new TextEncoder().encode('installed package');
const sealed=codec.seal({id:'BwcHBwcHBwcHBwcHBwcHBw',payload,expires:now+3600,now});
if(new TextDecoder().decode(codec.open({url:sealed.url,envelope:JSON.stringify(sealed.envelope),now}))!=='installed package')throw Error('Package failed');
`;
  writeFileSync(join(dir,'check.mjs'),script);
  execFileSync(process.execPath,['check.mjs'],{cwd:dir,stdio:'pipe'});
  const manifest=JSON.parse(readFileSync(join(dir,'node_modules/@forgesworn/foregather-kit/package.json')));
  assert.equal(manifest.license,'MIT');assert.equal(manifest.author,'TheCryptoDonkey');assert.equal(manifest.dependencies,undefined);
  console.log(JSON.stringify({passed:true,isolatedTarballInstall:true,typesIncluded:true,licencesIncluded:true,packageBytes:packed.size,runtimeJsDependencies:0}));
} finally {rmSync(dir,{recursive:true,force:true});}
