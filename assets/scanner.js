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
function capture(source,r,rotate=false) {
  const c=document.createElement('canvas'),scale=Math.min(2,1800/r.width),w=Math.max(1,Math.round(r.width*scale)),h=Math.max(1,Math.round(r.height*scale));
  c.width=(rotate?h:w)+48;c.height=(rotate?w:h)+48;
  const ctx=c.getContext('2d',{willReadFrequently:true});ctx.fillStyle='#fff';ctx.fillRect(0,0,c.width,c.height);ctx.imageSmoothingEnabled=false;ctx.translate(24,24);
  if(rotate){ctx.translate(h,0);ctx.rotate(Math.PI/2);}ctx.drawImage(source,r.x,r.y,r.width,r.height,0,0,w,h);return c;
}
export async function decodePhoto(file) {
  if(!file?.type.startsWith('image/'))throw new Error('請選擇出貨單圖片。');
  if(file.size>25*1024*1024)throw new Error('請選擇小於 25 MB 的照片。');
  const url=URL.createObjectURL(file),img=new Image();
  try {
    await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=()=>reject(new Error('無法開啟此照片，請改用 JPG／PNG。'));img.src=url;});
    const engine=createReader(),w=img.naturalWidth,h=img.naturalHeight,regions=[{x:0,y:0,width:w,height:h}];
    for(let i=0;i<5;i++)regions.push({x:0,y:h*i*.16,width:w,height:Math.min(h*.36,h-h*i*.16)});
    for(const region of regions){for(const rotate of [false,true]){try{return engine.decodeFromCanvas(capture(img,region,rotate)).getText();}catch{}}await new Promise(r=>setTimeout(r,0));}
    throw new Error('尚未讀到條碼。請只拍條碼、保留左右白邊，避免反光；也可手動輸入。');
  }finally{URL.revokeObjectURL(url);}
}
export class CameraScanner {
  constructor(onResult, onError, onEvent, onStatus=()=>{}) { this.onResult=onResult;this.onError=onError;this.onEvent=onEvent;this.onStatus=onStatus;this.active=false;this.pending=false;this.generation=0;this.lastText='';this.lastSeen=0;this.stream=null; }
  async start(video,deviceId='') {
    if(this.active||this.pending)return;const generation=++this.generation;this.pending=true;this.lastText='';this.lastSeen=0;
    try {
      if(!globalThis.isSecureContext||!navigator.mediaDevices?.getUserMedia)throw new Error('相機需要 HTTPS 網址與支援相機的瀏覽器。你仍可手動輸入。');
      const reader=createReader();
      const stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{...(deviceId?{deviceId:{exact:deviceId}}:{facingMode:{ideal:'environment'}}),width:{ideal:1920},height:{ideal:1080}}});
      if(generation!==this.generation){stream.getTracks().forEach(t=>t.stop());return;}
      this.stream=stream;this.video=video;video.muted=true;video.setAttribute('playsinline','');video.srcObject=stream;await video.play();
      if(generation!==this.generation)return;
      const track=stream.getVideoTracks()[0];
      try{if(track.getCapabilities?.().focusMode?.includes('continuous'))await track.applyConstraints({advanced:[{focusMode:'continuous'}]});}catch{}
      if(generation!==this.generation)return;
      this.active=true;this.onEvent('camera_start');
      if(generation!==this.generation)return;
      navigator.mediaDevices.enumerateDevices().then(devices=>{if(generation===this.generation)this.onStatus({cameras:devices.filter(d=>d.kind==='videoinput'),selected:track.getSettings().deviceId});}).catch(()=>{});
      const started=Date.now();let attempts=0;
      const tick=()=>{
        if(generation!==this.generation)return;
        if(video.readyState>=2&&video.videoWidth){
          const bounds=video.getBoundingClientRect(),target=video.parentElement.querySelector('.scan-target').getBoundingClientRect();
          const r=scanRegion(video.videoWidth,video.videoHeight,bounds.width,bounds.height,{x:target.left-bounds.left,y:target.top-bounds.top,width:target.width,height:target.height});
          attempts++;
          try{
            const actual=attempts%4===0?{x:0,y:0,width:video.videoWidth,height:video.videoHeight}:r;
            const text=reader.decodeFromCanvas(capture(video,actual)).getText(),now=Date.now();
            if(text!==this.lastText||now-this.lastSeen>1800){this.lastText=text;this.onResult(text);}this.lastSeen=now;this.onStatus({message:'已讀到條碼，可繼續掃描下一張。'});
          }catch(e){
            if(e instanceof TypeError||e.name==='SecurityError'){this.stop(false);this.onEvent('camera_failed',{result:'failed',message:e.message});this.onError('辨識中斷，請重開相機或改用照片辨識。');return;}
            if(!this.lastSeen||Date.now()-this.lastSeen>2500)this.onStatus({message:Date.now()-started>6000?'尚未讀到條碼。請讓條碼接近框寬、避免反光；也可改用拍照辨識。':'正在辨識框內條碼，請保持穩定。'});
          }
        }else this.onStatus({message:'等待相機畫面，請保持此頁開啟。'});
        if(generation===this.generation)this.timer=setTimeout(tick,250);
      };this.timer=setTimeout(tick,100);
    }catch(e){if(generation!==this.generation)return;this.stop(false);const messages={NotAllowedError:'未取得相機權限。請在瀏覽器設定允許相機，或使用手動輸入。',NotFoundError:'找不到相機，請使用手動輸入。',NotReadableError:'相機被其他程式使用，請關閉其他相機程式。',OverconstrainedError:'相機不支援此設定，請使用手動輸入。'};this.onEvent('camera_failed',{result:'failed',message:messages[e.name]||e.message});this.onError(messages[e.name]||e.message||'無法啟動相機，請使用手動輸入。');}
    finally{if(generation===this.generation)this.pending=false;}
  }
  stop(record=true) {
    const running=this.active||this.pending;this.generation++;clearTimeout(this.timer);this.stream?.getTracks().forEach(t=>t.stop());this.stream=null;if(this.video){this.video.pause();this.video.srcObject=null;this.video=null;}this.active=false;this.pending=false;if(running&&record)this.onEvent('camera_stop');
  }
}
