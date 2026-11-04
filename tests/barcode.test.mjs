import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import {enhance,setEngine,decodeImage} from '../assets/barcode.js';

const vendor = new URL('../assets/vendor/zxing-wasm/', import.meta.url);
vm.runInThisContext(fs.readFileSync(new URL('reader.iife.js', vendor), 'utf8'));
ZXingWASM.setZXingModuleOverrides({ wasmBinary: fs.readFileSync(new URL('zxing_reader.wasm', vendor)) });
setEngine(ZXingWASM);

// Code 39 digit patterns (bar, space, bar, ... ; w = wide) and the '*' start/stop character.
const PATTERNS = { 0:'nnnwwnwnn',1:'wnnwnnnnw',2:'nnwwnnnnw',3:'wnwwnnnnn',4:'nnnwwnnnw',5:'wnnwwnnnn',6:'nnwwwnnnn',7:'nnnwnnwnw',8:'wnnwnnwnn',9:'nnwwnnwnn','*':'nwnnwnwnn' };
function renderCode39(text, module, height) {
  const bars = []; // alternating bar / space widths in modules
  for (const ch of `*${text}*`) {
    for (const e of PATTERNS[ch]) bars.push(e === 'w' ? 3 : 1);
    bars.push(1); // inter-character gap
  }
  bars.pop();
  const quiet = 10 * module, width = bars.reduce((a, b) => a + b * module, 0) + quiet * 2;
  const gray = new Float32Array(width * height).fill(255);
  let x = quiet;
  bars.forEach((units, index) => {
    const end = x + units * module;
    if (index % 2 === 0) for (let y = 0; y < height; y++) for (let i = x; i < end; i++) gray[y * width + i] = 0;
    x = end;
  });
  return { gray, width, height };
}
function rng(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function gaussian(random) { return Math.sqrt(-2 * Math.log(random() || 1e-9)) * Math.cos(2 * Math.PI * random()); }
// Simulates toner spread (dark bars thicken), lens blur, low contrast and sensor noise.
function degrade({ gray, width, height }, { spread, sigma, seed }) {
  const random = rng(seed), out = Float32Array.from(gray);
  if (spread) for (let y = 0; y < height; y++) { const row = y * width, copy = out.slice(row, row + width); for (let x = 0; x < width; x++) { let v = 255; for (let k = -spread; k <= spread; k++) v = Math.min(v, copy[Math.min(width - 1, Math.max(0, x + k))]); out[row + x] = v; } }
  const radius = Math.ceil(sigma * 3), kernel = Array.from({ length: radius * 2 + 1 }, (_, i) => Math.exp(-((i - radius) ** 2) / (2 * sigma * sigma))), total = kernel.reduce((a, b) => a + b);
  for (let y = 0; y < height; y++) { const row = y * width, copy = out.slice(row, row + width); for (let x = 0; x < width; x++) { let v = 0; for (let k = -radius; k <= radius; k++) v += copy[Math.min(width - 1, Math.max(0, x + k))] * kernel[k + radius]; out[row + x] = v / total; } }
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < out.length; i++) { const v = out[i] * .75 + 30 + gaussian(random) * 8; data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = v; data[i * 4 + 3] = 255; }
  return { data, width, height, colorSpace: 'srgb' };
}
const NUMBER = '20261013100000001';
const cases = [];
for (const spread of [0, 1, 2]) for (const sigma of [2, 3, 4]) cases.push({ spread, sigma, seed: spread * 10 + sigma });

test('Code 39 order number decodes from a clean render', async () => {
  const { gray, width, height } = renderCode39(NUMBER, 4, 80);
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < gray.length; i++) { data.set([gray[i], gray[i], gray[i], 255], i * 4); }
  assert.equal(await decodeImage({ data, width, height, colorSpace: 'srgb' }), NUMBER);
});
test('enhancement keeps image size and increases bar contrast', () => {
  const image = degrade(renderCode39(NUMBER, 4, 60), { spread: 1, sigma: 3, seed: 1 });
  const out = enhance(image);
  assert.equal(out.length, image.width * image.height);
  const spread = pixels => { const s = [...pixels].sort((a, b) => a - b); return s[Math.floor(s.length * .95)] - s[Math.floor(s.length * .05)]; };
  const before = new Uint8ClampedArray(image.width * image.height).map((_, i) => image.data[i * 4]);
  assert(spread(out) > spread(before));
});
test('blurred, toner-spread bars: enhanced pipeline reads more than the plain decoder and never misreads', async () => {
  let plain = 0, enhanced = 0;
  for (const c of cases) {
    const image = degrade(renderCode39(NUMBER, 4, 60), c);
    const base = await ZXingWASM.readBarcodes(image, { formats: ['Code39', 'Code128'], tryHarder: true, tryDownscale: true });
    if (base[0]?.text === NUMBER) plain++;
    const text = await decodeImage(image);
    if (text) assert.equal(text, NUMBER);
    if (text === NUMBER) enhanced++;
  }
  console.log(`# plain ${plain}/${cases.length}, enhanced ${enhanced}/${cases.length}`);
  assert(enhanced > plain, `enhanced ${enhanced} should beat plain ${plain}`);
});
