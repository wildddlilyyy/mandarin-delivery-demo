// Packing-slip barcodes are Code 39 with ~0.17 mm narrow bars. Laser-printed copies and phone video
// frames blur those bars together, so every frame is contrast-enhanced and sharpened before decoding.
const FORMATS = ['Code39', 'Code128'];
// Order matters: the enhanced fixed-threshold read was the most reliable on blurred, toner-spread bars.
const ATTEMPTS = [
  { enhance: true, binarizer: 'FixedThreshold' },
  { enhance: true, binarizer: 'LocalAverage' },
  { enhance: false, binarizer: 'FixedThreshold' },
];

export function toGray(image) {
  const n = image.width * image.height, gray = new Uint8ClampedArray(n);
  for (let i = 0, p = 0; i < n; i++, p += 4) gray[i] = image.data[p] * .299 + image.data[p + 1] * .587 + image.data[p + 2] * .114;
  return gray;
}

// Tile-based contrast limited adaptive histogram equalisation with bilinear blending between tiles.
export function clahe(gray, w, h, tilesX = 4, tilesY = 4, clip = 2) {
  const tw = w / tilesX, th = h / tilesY, luts = [];
  for (let j = 0; j < tilesY; j++) for (let i = 0; i < tilesX; i++) {
    const x0 = Math.floor(i * tw), x1 = Math.floor((i + 1) * tw), y0 = Math.floor(j * th), y1 = Math.floor((j + 1) * th);
    const hist = new Float32Array(256); let area = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { hist[gray[y * w + x]]++; area++; }
    const lut = new Uint8ClampedArray(256);
    if (area) {
      const limit = Math.max(1, clip * area / 256); let excess = 0;
      for (let k = 0; k < 256; k++) if (hist[k] > limit) { excess += hist[k] - limit; hist[k] = limit; }
      const add = excess / 256; let sum = 0;
      for (let k = 0; k < 256; k++) { sum += hist[k] + add; lut[k] = Math.round(sum / area * 255); }
    }
    luts.push(lut);
  }
  const out = new Uint8ClampedArray(w * h);
  for (let y = 0; y < h; y++) {
    const fy = Math.min(tilesY - 1, Math.max(0, y / th - .5)), j0 = Math.floor(fy), j1 = Math.min(tilesY - 1, j0 + 1), wy = fy - j0;
    for (let x = 0; x < w; x++) {
      const fx = Math.min(tilesX - 1, Math.max(0, x / tw - .5)), i0 = Math.floor(fx), i1 = Math.min(tilesX - 1, i0 + 1), wx = fx - i0, v = gray[y * w + x];
      const top = luts[j0 * tilesX + i0][v] * (1 - wx) + luts[j0 * tilesX + i1][v] * wx;
      const bottom = luts[j1 * tilesX + i0][v] * (1 - wx) + luts[j1 * tilesX + i1][v] * wx;
      out[y * w + x] = top * (1 - wy) + bottom * wy;
    }
  }
  return out;
}

function boxBlur(src, w, h, r) {
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h), size = 2 * r + 1;
  for (let y = 0; y < h; y++) {
    let sum = 0; const row = y * w;
    for (let x = -r; x <= r; x++) sum += src[row + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = sum / size;
      sum += src[row + Math.min(w - 1, x + r + 1)] - src[row + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let y = -r; y <= r; y++) sum += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = sum / size;
      sum += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
    }
  }
  return out;
}

// Three box-blur passes approximate a Gaussian (sigma ~3); amount 1.5 matches the tested 2.5x / -1.5x mix.
export function unsharp(gray, w, h, radius = 3, amount = 1.5) {
  let blur = Float32Array.from(gray);
  for (let i = 0; i < 3; i++) blur = boxBlur(blur, w, h, radius);
  const out = new Uint8ClampedArray(w * h);
  for (let i = 0; i < out.length; i++) out[i] = gray[i] * (1 + amount) - blur[i] * amount;
  return out;
}

export function enhance(image) {
  const { width: w, height: h } = image;
  return unsharp(clahe(toGray(image), w, h), w, h);
}

function rgbaFromGray(gray, width, height) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0, p = 0; i < gray.length; i++, p += 4) { data[p] = data[p + 1] = data[p + 2] = gray[i]; data[p + 3] = 255; }
  return { data, width, height, colorSpace: 'srgb' };
}

let engine = null, enginePromise = null;
export function setEngine(value) { engine = value; enginePromise = null; }
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src; script.onload = resolve;
    script.onerror = () => { script.remove(); reject(new Error('條碼辨識引擎載入失敗，請檢查網路並重試。')); };
    document.head.appendChild(script);
  });
}
export function loadEngine() {
  if (engine) return Promise.resolve(engine);
  if (!enginePromise) enginePromise = (async () => {
    if (!globalThis.ZXingWASM) await loadScript(new URL('./vendor/zxing-wasm/reader.iife.js', import.meta.url).href);
    const wasm = new URL('./vendor/zxing-wasm/zxing_reader.wasm', import.meta.url).href;
    globalThis.ZXingWASM.setZXingModuleOverrides({ locateFile: (path, prefix) => path.endsWith('.wasm') ? wasm : prefix + path });
    await globalThis.ZXingWASM.prepareZXingModule({ fireImmediately: true });
    engine = globalThis.ZXingWASM;
    return engine;
  })().catch(error => { enginePromise = null; throw error; });
  return enginePromise;
}

// Returns the decoded text, or null when no barcode could be read.
export async function decodeImage(image) {
  const zxing = engine || await loadEngine();
  let enhanced = null;
  for (const attempt of ATTEMPTS) {
    const source = attempt.enhance ? (enhanced ||= rgbaFromGray(enhance(image), image.width, image.height)) : image;
    const results = await zxing.readBarcodes(source, { formats: FORMATS, binarizer: attempt.binarizer, tryHarder: true, tryDownscale: true, tryRotate: false });
    const hit = results.find(result => result.text);
    if (hit) return hit.text.trim();
  }
  return null;
}

export function decodeCanvas(canvas) {
  const context = canvas.getContext('2d', { willReadFrequently: true });
  return decodeImage(context.getImageData(0, 0, canvas.width, canvas.height));
}
