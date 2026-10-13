// Execute the packaged bindings on phone runtimes, one at a time. No new Cargo
// target, Gradle daemon or downloads of OS images; all owned devices are removed.
import {execFileSync,spawn} from 'node:child_process';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,writeFileSync,copyFileSync,rmSync,readdirSync,symlinkSync,chmodSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const root=fileURLToPath(new URL('../',import.meta.url));
const version=JSON.parse(readFileSync(join(root,'packages/browser/package.json'),'utf8')).version;
const mode=process.argv[2];
if(!['ios','android'].includes(mode))throw Error('Expected ios or android; build native packages first');
const stage=mkdtempSync(join(root,'target/foregather-mobile-check-'));
const evidence=join(root,'target/native-mobile-evidence');
mkdirSync(evidence,{recursive:true});
const run=(file,args,options={})=>execFileSync(file,args,{cwd:stage,stdio:'inherit',timeout:300000,...options});
const capture=(file,args,options={})=>run(file,args,{stdio:'pipe',encoding:'utf8',...options}).trim();
const hash=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
const delay=()=>new Promise(resolve=>setTimeout(resolve,500));
async function until(action,milliseconds=120000) {
  const deadline=Date.now()+milliseconds;
  while(Date.now()<deadline) {
    try {const value=action();if(value)return value;} catch {}
    await delay();
  }
  throw Error('Phone-runtime check timed out');
}
let device,avd,emulator,report;
const sdk=process.env.ANDROID_HOME??join(process.env.HOME,'Library/Android/sdk');
const adb=join(sdk,'platform-tools/adb');
let avdmanager=join(sdk,'cmdline-tools/latest/bin/avdmanager');
try {
  let result,archive,runtime;
  if(mode==='ios') {
    archive=join(root,`target/native-packages/foregather-apple-${version}.zip`);
    if(!existsSync(archive))throw Error('Run node scripts/build-native.mjs apple first');
    run('unzip',['-q',archive,'-d',join(stage,'package')]);
    const packagePath=join(stage,'package/apple');
    const source=readFileSync(join(root,'tests/native/consumer.swift'),'utf8');
    const end=source.lastIndexOf('\nprint(');
    if(end<0)throw Error('Expected the shared consumer result');
    writeFileSync(join(stage,'NativeChecks.swift'),`import Foregather\nimport Foundation\nfunc runNativeChecks() throws -> String {\n${source.slice(0,end).replace('import Foundation','')}\nreturn ${source.slice(end+7).trim().slice(0,-1)}\n}\n`);
    copyFileSync(join(root,'tests/native/mobile/AppDelegate.swift'),join(stage,'AppDelegate.swift'));
    writeFileSync(join(stage,'project.json'),JSON.stringify({name:'ForegatherSmoke',options:{deploymentTarget:{iOS:'15.0'}},packages:{Foregather:{path:packagePath}},targets:{ForegatherSmoke:{type:'application',platform:'iOS',sources:['AppDelegate.swift','NativeChecks.swift'],dependencies:[{package:'Foregather'}],settings:{base:{PRODUCT_BUNDLE_IDENTIFIER:'dev.forgesworn.foregather.smoke',MARKETING_VERSION:version,CURRENT_PROJECT_VERSION:'1',GENERATE_INFOPLIST_FILE:'YES',INFOPLIST_KEY_UILaunchScreen_Generation:'YES',TARGETED_DEVICE_FAMILY:'1',SWIFT_VERSION:'5.0',CODE_SIGNING_ALLOWED:'NO'}}}}}));
    run('xcodegen',['generate','--spec','project.json']);
    run('xcodebuild',['-project','ForegatherSmoke.xcodeproj','-scheme','ForegatherSmoke','-sdk','iphonesimulator','-destination','generic/platform=iOS Simulator','-configuration','Release','-derivedDataPath',join(stage,'build'),'build','CODE_SIGNING_ALLOWED=NO','ARCHS=arm64','-quiet']);
    const runtimes=JSON.parse(capture('xcrun',['simctl','list','runtimes','available','--json'])).runtimes;
    runtime=runtimes.find(r=>r.name.startsWith('iOS '));if(!runtime)throw Error('Install an iOS Simulator runtime first');
    device=capture('xcrun',['simctl','create',`Foregather smoke ${process.pid}`,'com.apple.CoreSimulator.SimDeviceType.iPhone-16-Pro',runtime.identifier]);
    run('xcrun',['simctl','boot',device]);run('xcrun',['simctl','bootstatus',device,'-b']);
    run('xcrun',['simctl','install',device,join(stage,'build/Build/Products/Release-iphonesimulator/ForegatherSmoke.app')]);
    run('xcrun',['simctl','launch',device,'dev.forgesworn.foregather.smoke']);
    const container=capture('xcrun',['simctl','get_app_container',device,'dev.forgesworn.foregather.smoke','data']);
    result=await until(()=>existsSync(join(container,'Documents/result.json'))&&JSON.parse(readFileSync(join(container,'Documents/result.json'),'utf8')));
    await delay();run('xcrun',['simctl','io',device,'screenshot',join(evidence,'ios.png')]);
    runtime=runtime.name;
  } else {
    archive=join(root,`target/native-packages/foregather-android-${version}.zip`);
    if(!existsSync(archive))throw Error('Run node scripts/build-native.mjs android first');
    run('unzip',['-q',archive,'-d',join(stage,'package')]);
    const aar=join(stage,`package/android/foregather-${version}.aar`);
    const jna=join(stage,'jna.aar');
    const response=await fetch('https://repo.maven.apache.org/maven2/net/java/dev/jna/jna/5.19.1/jna-5.19.1.aar',{redirect:'error',signal:AbortSignal.timeout(30000)});
    if(!response.ok)throw Error('Cannot fetch pinned JNA Android dependency');
    writeFileSync(jna,Buffer.from(await response.arrayBuffer()));
    if(hash(jna)!=='b57125cb7d16253f0d65a80f7d3a4c3664effa711b8bdbb7f87fb572ce1624ed')throw Error('JNA AAR checksum mismatch');
    const foreground=join(stage,'foregather'),jnaFiles=join(stage,'jna'),apk=join(stage,'apk');
    mkdirSync(foreground);mkdirSync(jnaFiles);mkdirSync(apk);
    run('unzip',['-q',aar,'-d',foreground]);run('unzip',['-q',jna,'-d',jnaFiles]);
    const androidJar=join(sdk,'platforms/android-35/android.jar'),tools=join(sdk,'build-tools/35.0.0');
    // Kotlin 2.4 metadata requires D8/R8 9.1.29; older installed build tools
    // produce metadata warnings. Pin the official standalone compiler.
    const r8=join(root,'target/native-tooling/r8-9.1.29.jar');
    if(!existsSync(r8)) {
      const response=await fetch('https://storage.googleapis.com/r8-releases/raw/9.1.29/r8.jar',{redirect:'error',signal:AbortSignal.timeout(60000)});
      if(!response.ok)throw Error('Cannot fetch pinned D8 compiler');
      mkdirSync(join(root,'target/native-tooling'),{recursive:true});writeFileSync(r8,Buffer.from(await response.arrayBuffer()));
    }
    if(hash(r8)!=='9a7d1e9e4c2d3ee05482b9695df5f4d8f92c22ebb74603d6be4eab0505467f1a')throw Error('D8 compiler checksum mismatch');
    const classpath=[androidJar,join(foreground,'classes.jar'),join(jnaFiles,'classes.jar')].join(':');
    writeFileSync(join(stage,'Consumer.kt'),`package dev.forgesworn.foregather.smoke\n${readFileSync(join(root,'tests/native/Consumer.kt'),'utf8')}`);
    run('kotlinc',[join(stage,'Consumer.kt'),join(root,'tests/native/mobile/SmokeActivity.kt'),'-cp',classpath,'-include-runtime','-jvm-target','1.8','-d',join(stage,'app.jar')]);
    const dex=join(stage,'dex');mkdirSync(dex);
    run('java',['-cp',r8,'com.android.tools.r8.D8','--min-api','23','--lib',androidJar,'--output',dex,join(stage,'app.jar'),join(foreground,'classes.jar'),join(jnaFiles,'classes.jar')]);
    writeFileSync(join(stage,'AndroidManifest.xml'),'<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="dev.forgesworn.foregather.smoke"><uses-sdk android:minSdkVersion="23" android:targetSdkVersion="35"/><application android:label="Foregather checks" android:debuggable="true" android:allowBackup="false" android:theme="@android:style/Theme.Material.Light.NoActionBar"><activity android:name="dev.forgesworn.foregather.smoke.SmokeActivity" android:exported="true"><intent-filter><action android:name="android.intent.action.MAIN"/><category android:name="android.intent.category.LAUNCHER"/></intent-filter></activity></application></manifest>');
    const unsigned=join(stage,'unsigned.apk'),aligned=join(stage,'aligned.apk'),installed=join(stage,'smoke.apk');
    run(join(tools,'aapt'),['package','-f','-M',join(stage,'AndroidManifest.xml'),'-I',androidJar,'-F',unsigned]);
    mkdirSync(join(apk,'lib/arm64-v8a'),{recursive:true});
    for(const input of [foreground,jnaFiles])for(const file of readdirSync(join(input,'jni/arm64-v8a')))copyFileSync(join(input,'jni/arm64-v8a',file),join(apk,'lib/arm64-v8a',file));
    run('zip',['-q','-j',unsigned,...readdirSync(dex).filter(f=>f.endsWith('.dex')).map(f=>join(dex,f))]);
    run('zip',['-q','-r',unsigned,'lib'],{cwd:apk});
    run(join(tools,'zipalign'),['-f','-p','4',unsigned,aligned]);
    run('keytool',['-genkeypair','-keystore',join(stage,'debug.keystore'),'-storepass','android','-keypass','android','-alias','debug','-keyalg','RSA','-keysize','2048','-validity','1','-dname','CN=Foregather synthetic test']);
    run(join(tools,'apksigner'),['sign','--ks',join(stage,'debug.keystore'),'--ks-pass','pass:android','--out',installed,aligned]);
    // A Homebrew-linked command launcher otherwise discovers Homebrew's SDK
    // instead of the configured one. Own only a small launcher and symlinks.
    const sdkLauncher=join(stage,'sdk'),launcherTools=join(sdkLauncher,'cmdline-tools/latest');
    mkdirSync(join(launcherTools,'bin'),{recursive:true});
    copyFileSync(avdmanager,join(launcherTools,'bin/avdmanager'));chmodSync(join(launcherTools,'bin/avdmanager'),0o755);
    symlinkSync(join(sdk,'cmdline-tools/latest/lib'),join(launcherTools,'lib'));
    for(const directory of ['platforms','system-images','emulator','licenses'])if(existsSync(join(sdk,directory)))symlinkSync(join(sdk,directory),join(sdkLauncher,directory));
    avdmanager=join(launcherTools,'bin/avdmanager');
    avd=`foregather-smoke-${process.pid}`;
    run(avdmanager,['create','avd','-n',avd,'-k','system-images;android-35;google_apis;arm64-v8a','-d','pixel_5'],{input:'no\n'});
    const configuration=join(process.env.HOME,'.android/avd',`${avd}.avd/config.ini`);
    writeFileSync(configuration,readFileSync(configuration,'utf8').replace(/^disk\.dataPartition\.size\s*=.*$/m,'disk.dataPartition.size=2G').replace(/^hw\.ramSize\s*=.*$/m,'hw.ramSize=1536'));
    // Select an unused console port; existing emulators are never stopped.
    const existing=capture(adb,['devices']);let port=5580;while(existing.includes(`emulator-${port}`))port+=2;
    device=`emulator-${port}`;
    const logfile=join(stage,'emulator.log');
    const {openSync,closeSync}=await import('node:fs');const fd=openSync(logfile,'w');
    emulator=spawn(join(sdk,'emulator/emulator'),['-avd',avd,'-port',String(port),'-no-window','-no-audio','-no-snapshot','-no-boot-anim','-memory','1536','-cores','2','-gpu','host'],{stdio:['ignore',fd,fd]});closeSync(fd);
    await until(()=>capture(adb,['-s',device,'shell','getprop','sys.boot_completed'],{timeout:10000})==='1',180000);
    runtime=`Android ${capture(adb,['-s',device,'shell','getprop','ro.build.version.release'])}, API ${capture(adb,['-s',device,'shell','getprop','ro.build.version.sdk'])}, ${capture(adb,['-s',device,'shell','getprop','ro.product.cpu.abi'])}`;
    run(adb,['-s',device,'install','-t',installed]);
    run(adb,['-s',device,'shell','am','start','-n','dev.forgesworn.foregather.smoke/.SmokeActivity']);
    result=await until(()=>JSON.parse(capture(adb,['-s',device,'shell','run-as','dev.forgesworn.foregather.smoke','cat','files/result.json'],{timeout:10000})));
    await delay();writeFileSync(join(evidence,'android.png'),run(adb,['-s',device,'exec-out','screencap','-p'],{stdio:'pipe'}));
  }
  if(!result.passed)throw Error(`${mode} native consumer failed`);
  report={...result,platform:mode,runtime,packageSha256:hash(archive),sourceCommit:capture('git',['rev-parse','HEAD'],{cwd:root}),physicalDeviceQualified:false,devicesAndStagingRemoved:true};
} finally {
  try {
    if(mode==='ios'&&device) {
      try {run('xcrun',['simctl','shutdown',device]);} catch {}
      run('xcrun',['simctl','delete',device]);
    }
    if(mode==='android'&&avd) {
      if(device)try {run(adb,['-s',device,'emu','kill'],{timeout:10000});} catch {}
      if(emulator&&emulator.exitCode===null&&emulator.signalCode===null) {
        await Promise.race([new Promise(resolve=>emulator.once('exit',resolve)),new Promise(resolve=>setTimeout(resolve,10000))]);
        if(emulator.exitCode===null&&emulator.signalCode===null) {
          emulator.kill('SIGTERM');
          await Promise.race([new Promise(resolve=>emulator.once('exit',resolve)),new Promise(resolve=>setTimeout(resolve,5000))]);
          if(emulator.exitCode===null&&emulator.signalCode===null){emulator.kill('SIGKILL');await new Promise(resolve=>emulator.once('exit',resolve));}
        }
      }
      if(existsSync(join(process.env.HOME,'.android/avd',`${avd}.ini`)))run(avdmanager,['delete','avd','-n',avd]);
    }
  } finally {rmSync(stage,{recursive:true,force:true});}
}
writeFileSync(join(evidence,`${mode}.json`),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report));
