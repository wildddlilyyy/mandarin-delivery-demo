// Demo order numbers are exactly 17 digits. Keep them as strings, never Numbers.
export function orderCandidate(text) {
  const matches = String(text).normalize('NFKC').split(/\r?\n/)
    .map(line => line.replace(/[ \t]/g, ''))
    .filter(line => /^\d{17}$/.test(line));
  return matches.length === 1 ? matches[0] : null;
}
export class StableDigits {
  constructor(required = 3, minimumConfidence = 75) {
    this.required = required; this.minimumConfidence = minimumConfidence; this.reset();
  }
  reset() { this.number = null; this.hits = 0; this.lastAt = 0; this.emitted = null; }
  observe(text, confidence, now = Date.now()) {
    const number = orderCandidate(text);
    if (!number || !Number.isFinite(confidence) || confidence < this.minimumConfidence) {
      this.number = null; this.hits = 0; return { number, hits: 0, ready: false };
    }
    if (number !== this.number || now - this.lastAt > 6000) { this.number = number; this.hits = 0; }
    this.lastAt = now; this.hits = Math.min(this.required, this.hits + 1);
    const ready = this.hits >= this.required && this.emitted !== number;
    if (ready) this.emitted = number;
    return { number, hits: this.hits, ready };
  }
}
let scriptPromise;
function loadRuntime() {
  if (globalThis.Tesseract) return Promise.resolve();
  if (!scriptPromise) scriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = new URL('./vendor/ocr/tesseract.min.js', import.meta.url).href;
    script.onload = resolve;
    script.onerror = () => { script.remove(); scriptPromise = null; reject(new Error('數字辨識程式載入失敗，請檢查網路並重試。')); };
    document.head.appendChild(script);
  });
  return scriptPromise;
}
export function numberFrame(source, region) {
  const canvas = document.createElement('canvas');
  const scale = Math.min(3, 1600 / region.width);
  canvas.width = Math.max(1, Math.round(region.width * scale)) + 40;
  canvas.height = Math.max(1, Math.round(region.height * scale)) + 40;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(source, region.x, region.y, region.width, region.height, 20, 20, canvas.width - 40, canvas.height - 40);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  // Grayscale preserves anti-aliased digit edges rather than erasing thin strokes.
  for (let i=0;i<pixels.data.length;i+=4) {
    const gray = pixels.data[i] * .299 + pixels.data[i+1] * .587 + pixels.data[i+2] * .114;
    const value = Math.max(0, Math.min(255, (gray - 128) * 1.35 + 128));
    pixels.data[i] = pixels.data[i+1] = pixels.data[i+2] = value;
  }
  context.putImageData(pixels,0,0);
  return canvas;
}
export class RealtimeDigits {
  constructor(onStatus = () => {}) { this.onStatus = onStatus; this.gate = new StableDigits(); this.cancelled = false; this.worker = null; }
  async init() {
    this.onStatus({ message: '首次啟動正在載入數字辨識模型，請稍候…' });
    await loadRuntime();
    if (this.cancelled) return;
    const base = new URL('./vendor/ocr/', import.meta.url);
    const worker = await Tesseract.createWorker('eng', 1, {
      workerPath: new URL('worker.min.js',base).href,
      corePath: new URL('core/',base).href,
      langPath: new URL('lang/',base).href,
      gzip: true,
      logger: event => { if (!this.cancelled && event.status !== 'recognizing text') this.onStatus({ message: `正在準備數字辨識… ${Math.round((event.progress || 0) * 100)}%` }); },
    });
    if (this.cancelled) { await worker.terminate(); return; }
    this.worker = worker;
    await worker.setParameters({ tessedit_char_whitelist: '0123456789', tessedit_pageseg_mode: '7', user_defined_dpi: '300' });
    if (!this.cancelled) this.onStatus({ message: '請只將 17 碼訂單數字放進框內，不要包含條碼。' });
  }
  async read(source, region) {
    if (this.cancelled || !this.worker) return null;
    const { data } = await this.worker.recognize(numberFrame(source,region));
    if (this.cancelled) return null;
    return { ...this.gate.observe(data.text, data.confidence), confidence: data.confidence };
  }
  close() { this.cancelled = true; if (this.worker) { this.worker.terminate().catch(()=>{}); this.worker = null; } }
}
