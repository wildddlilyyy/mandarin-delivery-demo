export class CameraScanner {
  constructor(onResult, onError, onEvent) { this.onResult=onResult;this.onError=onError;this.onEvent=onEvent;this.active=false;this.pending=false;this.generation=0;this.lastText='';this.lastSeen=0;this.stream=null; }
  async start(video) {
    if(this.active||this.pending)return;const generation=++this.generation;this.pending=true;this.lastText='';this.lastSeen=0;
    try {
      if(!globalThis.isSecureContext||!navigator.mediaDevices?.getUserMedia)throw new Error('相機需要 HTTPS 網址與支援相機的瀏覽器。你仍可手動輸入。');
      if(!globalThis.ZXingBrowser)throw new Error('條碼辨識套件載入失敗，請重新整理或使用手動輸入。');
      const stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:720}}});
      if(generation!==this.generation){stream.getTracks().forEach(t=>t.stop());return;}
      this.stream=stream;
      this.active=true;this.onEvent('camera_start');
      if(generation!==this.generation)return;
      const reader=new ZXingBrowser.BrowserMultiFormatReader(undefined,{delayBetweenScanAttempts:180,delayBetweenScanSuccess:250});
      const controls=await reader.decodeFromStream(this.stream,video,(result,error,ctrl)=>{
        if(generation!==this.generation){ctrl?.stop();return;}
        if(result){const text=result.getText();const now=Date.now();if(text!==this.lastText || now-this.lastSeen>1800){this.lastText=text;this.onResult(text);}this.lastSeen=now;}
      });
      if(generation!==this.generation){controls.stop();return;}this.controls=controls;
    }catch(e){if(generation!==this.generation)return;this.stop(false);const messages={NotAllowedError:'未取得相機權限。請在瀏覽器設定允許相機，或使用手動輸入。',NotFoundError:'找不到相機，請使用手動輸入。',NotReadableError:'相機被其他程式使用，請關閉其他相機程式。',OverconstrainedError:'相機不支援此設定，請使用手動輸入。'};this.onEvent('camera_failed',{result:'failed',message:messages[e.name]||e.message});this.onError(messages[e.name]||e.message||'無法啟動相機，請使用手動輸入。');}
    finally{if(generation===this.generation)this.pending=false;}
  }
  stop(record=true) {
    const running=this.active||this.pending;this.generation++;this.controls?.stop();this.controls=null;this.stream?.getTracks().forEach(t=>t.stop());this.stream=null;this.active=false;this.pending=false;if(running&&record)this.onEvent('camera_stop');
  }
}
