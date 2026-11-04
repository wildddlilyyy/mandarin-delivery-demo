import {RealtimeDigits} from './ocr.js?v=3';
import {loadEngine,decodeCanvas} from './barcode.js?v=4';
export function scanRegion(vw,vh,dw,dh,target) {
  const scale=Math.max(dw/vw,dh/vh),ox=(vw*scale-dw)/2,oy=(vh*scale-dh)/2;
  const x=Math.max(0,(target.x+ox)/scale),y=Math.max(0,(target.y+oy)/scale);
  return {x,y,width:Math.min(vw-x,target.width/scale),height:Math.min(vh-y,target.height/scale)};
}
export function createReader() {
  if(!globalThis.ZXingBrowser)throw new Error('條碼辨識套件載入失敗，請重新整理或手動輸入。');
  // TRY_HARDER = 3 in the pinned ZXing DecodeHintType enum.
  return new ZXingBrowser.BrowserMultiFormatReader(new Map([[3,true]]));
}
function capture(source,r,rotate=false,limit=1800) {
  const c=document.createElement('canvas'),scale=Math.min(2,limit/r.width),w=Math.max(1,Math.round(r.width*scale)),h=Math.max(1,Math.round(r.height*scale));
  c.width=(rotate?h:w)+48;c.height=(rotate?w:h)+48;
  const ctx=c.getContext('2d',{willReadFrequently:true});ctx.fillStyle='#fff';ctx.fillRect(0,0,c.width,c.height);ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';ctx.translate(24,24);
  if(rotate){ctx.translate(h,0);ctx.rotate(Math.PI/2);}ctx.drawImage(source,r.x,r.y,r.width,r.height,0,0,w,h);return c;
}
export async function decodePhoto(file) {
  if(!file?.type.startsWith('image/'))throw new Error('請選擇出貨單圖片。');
  if(file.size>25*1024*1024)throw new Error('請選擇小於 25 MB 的照片。');
  const url=URL.createObjectURL(file),img=new Image();
  try {
    await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=()=>reject(new Error('無法開啟此照片，請改用 JPG／PNG。'));img.src=url;});
    const wasm=await loadEngine().catch(()=>null);let engine=null;try{engine=createReader();}catch(e){if(!wasm)throw e;}
    const w=img.naturalWidth,h=img.naturalHeight,regions=[{x:0,y:0,width:w,height:h}];
    for(let i=0;i<5;i++)regions.push({x:0,y:h*i*.16,width:w,height:Math.min(h*.36,h-h*i*.16)});
    for(const region of regions){for(const rotate of [false,true]){const canvas=capture(img,region,rotate,3200);if(wasm){try{const text=await decodeCanvas(canvas);if(text)return text;}catch{}}if(engine){try{return engine.decodeFromCanvas(canvas).getText();}catch{}}}await new Promise(r=>setTimeout(r,0));}
    throw new Error('尚未讀到條碼。請只拍條碼、保留左右白邊，避免反光；也可手動輸入。');
  }finally{URL.revokeObjectURL(url);}
}
export class CameraScanner {
  constructor(onResult, onError, onEvent, onStatus=()=>{}) { this.onResult=onResult;this.onError=onError;this.onEvent=onEvent;this.onStatus=onStatus;this.active=false;this.pending=false;this.generation=0;this.lastText='';this.lastSeen=0;this.stream=null; }
  async start(video,deviceId='',mode='barcode') {
    if(this.active||this.pending)return;const generation=++this.generation;this.pending=true;this.lastText='';this.lastSeen=0;this.candidate=null;this.engine=null;
    try {
      if(!globalThis.isSecureContext||!navigator.mediaDevices?.getUserMedia)throw new Error('相機需要 HTTPS 網址與支援相機的瀏覽器。你仍可手動輸入。');
      this.mode=mode;
      let reader=null,readerError=null;if(mode!=='numbers'){try{reader=createReader();}catch(e){readerError=e;}}
      const stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{...(deviceId?{deviceId:{exact:deviceId}}:{facingMode:{ideal:'environment'}}),width:{ideal:3840},height:{ideal:2160}}});
      if(generation!==this.generation){stream.getTracks().forEach(t=>t.stop());return;}
      this.stream=stream;this.video=video;video.muted=true;video.setAttribute('playsinline','');video.srcObject=stream;await video.play();
      if(generation!==this.generation)return;
      const track=stream.getVideoTracks()[0];
      try{if(track.getCapabilities?.().focusMode?.includes('continuous'))await track.applyConstraints({advanced:[{focusMode:'continuous'}]});}catch{}
      if(generation!==this.generation)return;
      this.active=true;this.onEvent('camera_start');
      if(generation!==this.generation)return;
      navigator.mediaDevices.enumerateDevices().then(devices=>{if(generation===this.generation)this.onStatus({cameras:devices.filter(d=>d.kind==='videoinput'),selected:track.getSettings().deviceId});}).catch(()=>{});
      if(mode==='numbers'){
        const digits=new RealtimeDigits(status=>{if(generation===this.generation)this.onStatus(status);});this.digits=digits;
        await digits.init();
        if(generation!==this.generation){digits.close();return;}
      }else{
        this.onStatus({message:'正在準備條碼辨識引擎…'});
        const engine=await loadEngine().catch(()=>null);
        if(generation!==this.generation)return;
        if(!engine&&!reader)throw readerError||new Error('條碼辨識套件載入失敗，請重新整理或手動輸入。');
        this.engine=engine;
      }
      const started=Date.now();let attempts=0;
      const tick=async()=>{
        if(generation!==this.generation)return;
        if(video.readyState>=2&&video.videoWidth){
          const bounds=video.getBoundingClientRect(),target=video.parentElement.querySelector('.scan-target').getBoundingClientRect();
          const r=scanRegion(video.videoWidth,video.videoHeight,bounds.width,bounds.height,{x:target.left-bounds.left,y:target.top-bounds.top,width:target.width,height:target.height});
          attempts++;
          try{
            if(mode==='numbers'){
              const result=await this.digits.read(video,r);
              if(generation!==this.generation)return;
              if(result?.ready){this.onResult(result.number);this.onStatus({message:'已穩定讀到 '+result.number+'，可繼續對準下一張。'});}
              else if(result?.number&&result.hits>=3){this.onStatus({message:'已確認 '+result.number+'，請對準下一張。'});}
              else if(result?.number&&result.hits){this.onStatus({message:'讀到 '+result.number+' · 確認中 '+result.hits+'/3，請保持穩定。'});}
              else this.onStatus({message:'請只對準 17 碼數字，讓數字填滿框寬並保持清晰。'});
            }else{
            const actual=attempts%4===0?{x:0,y:0,width:video.videoWidth,height:video.videoHeight}:r,canvas=capture(video,actual,false,2600);
            const text=this.engine?await decodeCanvas(canvas):reader.decodeFromCanvas(canvas).getText();
            if(generation!==this.generation)return;
            if(!text)throw Object.assign(new Error('NotFound'),{name:'NotFoundException'});
            const now=Date.now();
            // Code 39 has no mandatory check digit, so require the same value twice in a row before accepting it.
            if(!this.confirmed(text,now)){this.lastSeen=now;this.onStatus({message:'讀到 '+text+' · 確認中 1/2，請保持穩定。'});}
            else{if(text!==this.lastText||now-this.lastSeen>1800){this.lastText=text;this.onResult(text);}this.lastSeen=now;this.onStatus({message:'已讀到條碼，可繼續掃描下一張。'});}
            }
          }catch(e){
            if(generation!==this.generation)return;
            if(mode==='numbers'){this.stop(false);this.onEvent('camera_failed',{result:'failed',message:e.message});this.onError('數字辨識中斷，請停止後重試；若持續失敗可手動輸入。');return;}
            if(e instanceof TypeError||e.name==='SecurityError'){this.stop(false);this.onEvent('camera_failed',{result:'failed',message:e.message});this.onError('辨識中斷，請重開相機或改用照片辨識。');return;}
            if(!this.lastSeen||Date.now()-this.lastSeen>2500)this.onStatus({message:Date.now()-started>6000?'尚未讀到條碼。請讓條碼接近框寬、避免反光；也可改用拍照辨識。':'正在辨識框內條碼，請保持穩定。'});
          }
        }else this.onStatus({message:'等待相機畫面，請保持此頁開啟。'});
        if(generation===this.generation)this.timer=setTimeout(tick,mode==='numbers'?450:250);
      };this.timer=setTimeout(tick,100);
    }catch(e){if(generation!==this.generation)return;this.stop(false);const messages={NotAllowedError:'未取得相機權限。請在瀏覽器設定允許相機，或使用手動輸入。',NotFoundError:'找不到相機，請使用手動輸入。',NotReadableError:'相機被其他程式使用，請關閉其他相機程式。',OverconstrainedError:'相機不支援此設定，請使用手動輸入。'};this.onEvent('camera_failed',{result:'failed',message:messages[e.name]||e.message});this.onError(messages[e.name]||e.message||'無法啟動相機，請使用手動輸入。');}
    finally{if(generation===this.generation)this.pending=false;}
  }
  confirmed(text,now) {const c=this.candidate;if(c&&c.text===text&&now-c.at<=4000)return true;this.candidate={text,at:now};return false;}
  stop(record=true) {
    const running=this.active||this.pending;this.generation++;clearTimeout(this.timer);this.digits?.close();this.digits=null;this.stream?.getTracks().forEach(t=>t.stop());this.stream=null;if(this.video){this.video.pause();this.video.srcObject=null;this.video=null;}this.active=false;this.pending=false;if(running&&record){this.onEvent('camera_stop');this.onStatus({message:'已停止辨識，點擊開始掃描可繼續。'});}
  }
}
