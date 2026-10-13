// Reproducible release assets, built from this checkout's existing target/.
import {execFileSync} from 'node:child_process';
import {mkdirSync,copyFileSync,readFileSync,writeFileSync,rmSync,readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
const root=fileURLToPath(new URL('../',import.meta.url)),cwd={cwd:root,stdio:'inherit'};
const notices=new Set(['THIRD_PARTY_LICENSES.txt','packages/browser/THIRD_PARTY_LICENSES.txt']);
const changed=()=>execFileSync('git',['diff','--name-only','HEAD'],{cwd:root,encoding:'utf8'}).trim().split('\n').filter(Boolean);
const untracked=execFileSync('git',['ls-files','--others','--exclude-standard'],{cwd:root,encoding:'utf8'}).trim();
if(untracked||changed().some(name=>!notices.has(name)))throw Error('Commit source changes before generating release assets');
const sourceCommit=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
const version=JSON.parse(readFileSync(join(root,'packages/browser/package.json'))).version;
if(!/^\d+\.\d+\.\d+$/.test(version))throw Error('Expected release version');
const rustVersion=JSON.parse(execFileSync('cargo',['metadata','--locked','--offline','--no-deps','--format-version','1'],{cwd:root,encoding:'utf8'})).packages.find(item=>item.name==='foregather-kit').version;
const browserOnly=version!==rustVersion;
const out=join(root,'target/release-artifacts/current');
// This directory belongs exclusively to this generator; never clear target/.
rmSync(out,{recursive:true,force:true});mkdirSync(out,{recursive:true});
const packed=JSON.parse(execFileSync('npm',['pack','./packages/browser','--json','--pack-destination',out],{cwd:root,encoding:'utf8'}))[0];
const platform=process.platform==='linux'?'linux':process.platform==='darwin'?'macos':null;
if(!platform||!['x64','arm64'].includes(process.arch))throw Error('Unqualified binary target');
const arch=process.arch==='x64'?'x86_64':'aarch64',name=`foregather-server-v${version}-${platform}-${arch}`;
if(!browserOnly) {
execFileSync('cargo',['package','--locked','-p','foregather-kit','--all-features','--allow-dirty'],cwd);
copyFileSync(join(root,`target/package/foregather-kit-${version}.crate`),join(out,`foregather-kit-${version}.crate`));
execFileSync('cargo',['build','--locked','--release','-p','foregather-server'],cwd);
const staging=join(root,'target/release-artifacts/server-staging');
rmSync(staging,{recursive:true,force:true});mkdirSync(join(staging,name),{recursive:true});
const binary=join(root,'target/release/foregather-server');
copyFileSync(binary,join(staging,name,'foregather-server'));
for(const file of ['LICENSE','THIRD_PARTY_LICENSES.txt','SECURITY.md','README.md'])copyFileSync(join(root,file),join(staging,name,file));
copyFileSync(join(root,'docs/resolver.md'),join(staging,name,'resolver.md'));
execFileSync('tar',['-czf',join(out,`${name}.tar.gz`),'-C',staging,name],cwd);
rmSync(staging,{recursive:true,force:true});
}
copyFileSync(join(root,'LICENSE'),join(out,'LICENSE'));
copyFileSync(join(root,'THIRD_PARTY_LICENSES.txt'),join(out,'THIRD_PARTY_LICENSES.txt'));
const provenance={version,component:browserOnly?'browser':'all',unchangedRustRelease:browserOnly?`v${rustVersion}`:undefined,sourceCommit,sourceWorkingTreeClean:true,generatedNoticeChanges:changed(),sourceTree:execFileSync('git',['rev-parse','HEAD^{tree}'],{cwd:root,encoding:'utf8'}).trim(),rust:execFileSync('rustc',['--version'],{cwd:root,encoding:'utf8'}).trim(),node:process.version,platform,arch,browserPackage:packed.filename,experimentalLive:true};
if(changed().some(name=>!notices.has(name)))throw Error('Source changed during release build');
writeFileSync(join(out,'provenance.json'),JSON.stringify(provenance,null,2)+'\n');
const sums=readdirSync(out).sort().map(name=>`${createHash('sha256').update(readFileSync(join(out,name))).digest('hex')}  ${name}`).join('\n')+'\n';
writeFileSync(join(out,'SHA256SUMS'),sums);
execFileSync(process.execPath,['scripts/check-package.mjs',join(out,packed.filename)],cwd);
if(!browserOnly)execFileSync(process.execPath,['scripts/check-release-server.mjs',join(out,`${name}.tar.gz`)],cwd);
console.log(JSON.stringify({releaseAssets:out,...provenance}));
