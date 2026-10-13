import {qrcodegen} from './qrcodegen.mjs';
import jsQR from './jsqr.mjs';
import {createPairingLink,parsePairingLink} from './handoff.mjs';
import {delay} from './transport.mjs';
function abortable(promise,signal) {
  return new Promise((resolve,reject)=>{
    const abort=()=>reject(signal.reason);
    if(signal.aborted){reject(signal.reason);return;}
    signal.addEventListener('abort',abort,{once:true});
    Promise.resolve(promise).then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));
  });
}
export function createPairingQr(input) {
  const url=createPairingLink(input);const scale=input.scale??4;
  if(!Number.isSafeInteger(scale)||scale<2||scale>12)throw new Error('Invalid QR scale');
  const qr=qrcodegen.QrCode.encodeText(url,qrcodegen.QrCode.Ecc.MEDIUM),border=4,size=qr.size+border*2,width=size*scale;
  if(width>2048)throw new Error('Invalid QR size');
  const rgba=new Uint8ClampedArray(width*width*4);rgba.fill(255);const path=[];
  for(let y=0;y<qr.size;y++)for(let x=0;x<qr.size;x++)if(qr.getModule(x,y)) {
    path.push(`M${x+border},${y+border}h1v1h-1z`);
    for(let sy=0;sy<scale;sy++)for(let sx=0;sx<scale;sx++){const offset=(((y+border)*scale+sy)*width+(x+border)*scale+sx)*4;rgba[offset]=rgba[offset+1]=rgba[offset+2]=0;}
  }
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${width}" height="${width}" role="img" aria-label="Public pairing link"><rect width="100%" height="100%" fill="#fff"/><path d="${path.join('')}" fill="#000"/></svg>`;
  return Object.freeze({url,svg,width,height:width,rgba});
}
export function decodePairingQr({rgba,width,height,...config}) {
  if(!(rgba instanceof Uint8ClampedArray)||!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1||width>2048||height>2048||rgba.length!==width*height*4)throw new Error('Invalid QR image');
  const decoded=jsQR(rgba,width,height,{inversionAttempts:'attemptBoth'});
  return decoded?parsePairingLink({url:decoded.data,...config}):null;
}
/** Call only after an explicit Scan action; browser camera consent remains required. */
export async function scanPairingCamera({video,now,signal,...config}) {
  if(!(video instanceof HTMLVideoElement)||typeof now!=='function')throw new Error('Invalid scanner');
  const combined=signal?AbortSignal.any([signal,AbortSignal.timeout(120000)]):AbortSignal.timeout(120000);
  combined.throwIfAborted();let stream;
  const release=()=>{stream?.getTracks().forEach(track=>track.stop());if(video.srcObject===stream){video.pause();video.srcObject=null;}};
  combined.addEventListener('abort',release,{once:true});
  try {
    const acquisition=navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:640},height:{ideal:480}},audio:false});
    // Permission UI cannot be forcibly dismissed; a late stream is still stopped.
    acquisition.then(value=>{if(combined.aborted)value.getTracks().forEach(track=>track.stop());},()=>{});
    stream=await abortable(acquisition,combined);
    combined.throwIfAborted();video.srcObject=stream;video.muted=true;video.playsInline=true;await abortable(video.play(),combined);
    const canvas=document.createElement('canvas'),context=canvas.getContext('2d',{willReadFrequently:true});
    if(!context)throw new Error('Camera unavailable');
    for(;;) {
      combined.throwIfAborted();
      if(video.videoWidth&&video.videoHeight) {
        const ratio=Math.min(1,640/video.videoWidth,640/video.videoHeight);
        canvas.width=Math.max(1,Math.floor(video.videoWidth*ratio));canvas.height=Math.max(1,Math.floor(video.videoHeight*ratio));
        context.drawImage(video,0,0,canvas.width,canvas.height);const image=context.getImageData(0,0,canvas.width,canvas.height);
        // Foreign, malformed and expired QR codes never trigger requests or admission.
        let room;try{room=decodePairingQr({rgba:image.data,width:image.width,height:image.height,...config,now:now()});}catch{}
        if(room)return room;
      }
      await delay(150,combined);
    }
  } finally {combined.removeEventListener('abort',release);release();}
}
