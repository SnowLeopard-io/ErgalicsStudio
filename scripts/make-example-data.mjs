// Regenerates the derived example assets:
//   examples/data/distribution.dat  — 1-D sample distribution (histogram demo)
//   examples/data/field.json        — 48x48 2-D field (heatmap demo)
//   src/core/exampleAssets.ts       — base64 test-pattern PNG (image viewer demo)
// Run: node scripts/make-example-data.mjs
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

// ---------- distribution.dat ----------
const gauss = () => {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};
const lines = [];
for (let i = 0; i < 2400; i += 1) {
  const r = Math.random();
  let v;
  if (r < 0.4) v = -2.2 + gauss() * 0.5;
  else if (r < 0.75) v = 1.8 + gauss() * 0.7;
  else v = Math.random() * 10 - 5;
  lines.push(v.toFixed(4));
}
const distPath = join(root, 'examples', 'data', 'distribution.dat');
writeFileSync(distPath, lines.join('\n') + '\n');

// ---------- field.json ----------
const N = 48;
const field = [];
for (let y = 0; y < N; y += 1) {
  const row = [];
  for (let x = 0; x < N; x += 1) {
    const u = (x / (N - 1)) * 2 - 1;
    const v = (y / (N - 1)) * 2 - 1;
    const r = Math.sqrt(u * u + v * v);
    const th = Math.atan2(v, u);
    const val = Math.sin(4.5 * r) * Math.cos(6 * th) + 0.65 * Math.exp(-r * r * 2.2);
    row.push(Math.round(val * 1000) / 1000);
  }
  field.push(row);
}
const fieldPath = join(root, 'examples', 'data', 'field.json');
writeFileSync(fieldPath, JSON.stringify(field));

// ---------- tornado.xyz ----------
// Helical vortex point cloud (3D point cloud demo). Deterministic LCG so
// regenerating produces byte-identical output.
function lcg(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
const tornado = [];
{
  const rnd = lcg(42);
  const N = 2000;
  for (let i = 0; i < N; i += 1) {
    const t = (i / N) * 6.28 * 3.2;
    const h = (i / (N - 1)) * 9 - 4.5;
    const r = 1.6 * Math.exp(-0.14 * (i / N) * 6.28 * 0.9);
    const x = r * Math.cos(t) + (rnd() - 0.5) * 0.06;
    const y = r * Math.sin(t) + (rnd() - 0.5) * 0.06;
    const z = h + Math.sin(t * 3) * 0.06;
    tornado.push(`${x.toFixed(4)} ${y.toFixed(4)} ${z.toFixed(4)}`);
  }
}
writeFileSync(join(root, 'examples', 'data', 'tornado.xyz'), tornado.join('\n') + '\n');

// ---------- scatter-clusters.dat ----------
// Three gaussian clusters with an intensity column (scatter demo).
const clusters = [];
{
  const rnd = lcg(7);
  const centers = [
    [0, 0],
    [4.2, 2.3],
    [-3.4, 3.1],
  ];
  for (let k = 0; k < centers.length; k += 1) {
    const [cx, cy] = centers[k];
    for (let i = 0; i < 320; i += 1) {
      const x = cx + (rnd() + rnd() + rnd() - 1.5) * 0.85;
      const y = cy + (rnd() + rnd() + rnd() - 1.5) * 0.85;
      const c = (k + 1) * 0.35 + rnd() * 0.3;
      clusters.push(`${x.toFixed(4)} ${y.toFixed(4)} ${c.toFixed(4)}`);
    }
  }
}
writeFileSync(join(root, 'examples', 'data', 'scatter-clusters.dat'), clusters.join('\n') + '\n');

// ---------- test pattern PNG ----------
const W = 128;
const H = 128;
function crcTable() {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
}
const CRC = crcTable();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
function mix(a, b, t) {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}
const darkTeal = [13, 118, 108];
const amber = [251, 191, 36];
const cyan = [94, 234, 212];
const raw = Buffer.alloc((W * 3 + 1) * H);
for (let y = 0; y < H; y += 1) {
  const rowStart = y * (W * 3 + 1);
  raw[rowStart] = 0; // filter: none
  for (let x = 0; x < W; x += 1) {
    const o = rowStart + 1 + x * 3;
    const t = (x + y) / (W + H - 2);
    let c = mix(darkTeal, amber, t);
    const dx = x - W / 2;
    const dy = y - H / 2;
    const ring = Math.abs(Math.sqrt(dx * dx + dy * dy) - 34) < 2;
    if (ring) c = cyan;
    else if (x % 16 === 0 || y % 16 === 0) c = mix(c, [210, 230, 235], 0.45);
    raw[o] = c[0];
    raw[o + 1] = c[1];
    raw[o + 2] = c[2];
  }
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 2; // color type RGB
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw)),
  chunk('IEND', Buffer.alloc(0)),
]);
const base64 = png.toString('base64');

const assetsDir = join(root, 'src', 'core');
mkdirSync(assetsDir, { recursive: true });
writeFileSync(
  join(assetsDir, 'exampleAssets.ts'),
  `// Auto-generated by scripts/make-example-data.mjs — do not edit by hand.\n` +
    `// 128x128 test-pattern PNG for the Image Viewer example.\n` +
    `export const TEST_PATTERN_PNG_BASE64 =\n  '${base64}';\n`,
);

console.log('generated:');
console.log('  distribution.dat', lines.length, 'values');
console.log('  field.json', N + 'x' + N);
console.log('  tornado.xyz', tornado.length, 'points');
console.log('  scatter-clusters.dat', clusters.length, 'points');
console.log('  exampleAssets.ts', base64.length, 'base64 chars');