// Deterministically generate the four AI-Training example datasets as CSV
// files under examples/data/, so the plugin loads them from the examples
// folder instead of synthesizing data at runtime. Seeded PRNG => reproducible
// files that can be committed to the repo and inspected by learners.
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, '..', 'examples', 'data', 'ai');
mkdirSync(OUT, { recursive: true });

// Seeded PRNG (mulberry32) for reproducible datasets.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function gaussian(rng) {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
const r3 = (x) => Math.round(x * 1000) / 1000;

// --- Linear regression: y = 2.4x + 1 + noise ---
function genLinear() {
  const rng = mulberry32(101);
  const rows = [];
  for (let i = 0; i < 120; i += 1) {
    const x = rng() * 10 - 5;
    const y = 2.4 * x + 1.0 + gaussian(rng) * 1.2;
    rows.push(`${r3(x)},${r3(y)}`);
  }
  return 'x,y\n' + rows.join('\n') + '\n';
}

// --- Nonlinear regression: y = 0.6x^3 - 1.2x + sin(2x) + noise ---
function genNonlinear() {
  const rng = mulberry32(202);
  const rows = [];
  for (let i = 0; i < 140; i += 1) {
    const x = rng() * 6 - 3;
    const y = 0.6 * x ** 3 - 1.2 * x + Math.sin(x * 2) + gaussian(rng) * 1.0;
    rows.push(`${r3(x)},${r3(y)}`);
  }
  return 'x,y\n' + rows.join('\n') + '\n';
}

// --- Binary classification: two Gaussian blobs ---
function genLogistic() {
  const rng = mulberry32(303);
  const rows = [];
  for (let i = 0; i < 160; i += 1) {
    const label = rng() < 0.5 ? 0 : 1;
    const cx = label === 0 ? -2.2 : 2.2;
    const cy = label === 0 ? -1.5 : 1.8;
    const x1 = cx + gaussian(rng) * 0.9;
    const x2 = cy + gaussian(rng) * 0.9;
    rows.push(`${r3(x1)},${r3(x2)},${label}`);
  }
  return 'x1,x2,label\n' + rows.join('\n') + '\n';
}

// --- Synthetic MNIST: render 5x7 dot-matrix digit glyphs (0-9) with a
// distance-field anti-aliased stroke, random translation/scale and noise, so
// the samples actually look like handwritten digits instead of abstract discs.
const DIGITS = [
  ['01110', '10001', '10011', '10101', '11001', '10001', '01110'], // 0
  ['00100', '01100', '00100', '00100', '00100', '00100', '01110'], // 1
  ['01110', '10001', '00001', '00010', '00100', '01000', '11111'], // 2
  ['11111', '00010', '00100', '00010', '00001', '10001', '01110'], // 3
  ['00010', '00110', '01010', '10010', '11111', '00010', '00010'], // 4
  ['11111', '10000', '11110', '00001', '00001', '10001', '01110'], // 5
  ['00110', '01000', '10000', '11110', '10001', '10001', '01110'], // 6
  ['11111', '00001', '00010', '00100', '01000', '01000', '01000'], // 7
  ['01110', '10001', '10001', '01110', '10001', '10001', '01110'], // 8
  ['01110', '10001', '10001', '01111', '00001', '00010', '01100'], // 9
];

/** Render one digit (0-9) as a 28x28 float image (0..1). */
function renderDigit(label, rng) {
  const glyph = DIGITS[label];
  const size = 28;
  const stroke = 1.35; // half-width of the anti-aliased stroke in glyph units
  const scale = 3.4 + rng() * 0.6; // 5x7 glyph -> ~17-20 x 24-28 px
  const dx = (rng() - 0.5) * 3; // random horizontal shift
  const dy = (rng() - 0.5) * 2; // random vertical shift
  const x0 = (size - 5 * scale) / 2 + dx;
  const y0 = (size - 7 * scale) / 2 + dy;
  // Precompute the scaled stroke centers.
  const centers = [];
  for (let r = 0; r < 7; r += 1) {
    for (let c = 0; c < 5; c += 1) {
      if (glyph[r][c] === '1') centers.push([x0 + c * scale, y0 + r * scale]);
    }
  }
  const img = new Array(size * size).fill(0);
  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      let d = Infinity;
      for (const [cx, cy] of centers) {
        const dd = Math.hypot(px + 0.5 - cx, py + 0.5 - cy);
        if (dd < d) d = dd;
      }
      let v = 1 - d / (stroke * 2); // distance field: 1 at stroke center, 0 beyond edge
      v = Math.max(0, Math.min(1, v));
      v += gaussian(rng) * 0.05; // sensor noise
      img[py * size + px] = Math.max(0, Math.min(1, v));
    }
  }
  return img;
}

function genMnist() {
  const rng = mulberry32(404);
  const size = 28;
  const n = 200;
  const header = 'label,' + Array.from({ length: 784 }, (_, i) => `p${i}`).join(',');
  const lines = [header];
  for (let i = 0; i < n; i += 1) {
    const label = i % 10;
    const row = renderDigit(label, rng);
    lines.push(`${label},` + row.map((v) => r3(v)).join(','));
  }
  return lines.join('\n') + '\n';
}

writeFileSync(join(OUT, 'ai-linear.csv'), genLinear());
writeFileSync(join(OUT, 'ai-nonlinear.csv'), genNonlinear());
writeFileSync(join(OUT, 'ai-logistic.csv'), genLogistic());
writeFileSync(join(OUT, 'ai-mnist.csv'), genMnist());
console.log('AI example datasets written to', OUT);
