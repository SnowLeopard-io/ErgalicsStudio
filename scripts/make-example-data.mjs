// Regenerates the derived example assets:
//   examples/data/distribution.dat  — 1-D sample distribution (histogram demo)
//   examples/data/field.json        — 48x48 2-D field (heatmap demo)
//   src/core/exampleAssets.ts       — base64 test-pattern PNG (image viewer demo)
//                                     + base64 seeded 256x256 grayscale test-subject
//                                     PNG (image-processing demo; exact rasterization
//                                     of the kernel's makeTestImage, seed 20261011)
// Run: node scripts/make-example-data.mjs
import { deflateSync } from 'node:zlib';
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

// ---------- distribution.dat ----------
// Seeded like every other dataset here: regenerating must be byte-identical.
const distRng = mulberry32(12000);
const gauss = () => {
  let u = 0;
  let v = 0;
  while (u === 0) u = distRng();
  while (v === 0) v = distRng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};
const lines = [];
for (let i = 0; i < 12000; i += 1) {
  const r = distRng();
  let v;
  if (r < 0.4) v = -2.2 + gauss() * 0.5;
  else if (r < 0.75) v = 1.8 + gauss() * 0.7;
  else v = distRng() * 10 - 5;
  lines.push(v.toFixed(4));
}
const distPath = join(root, 'examples', 'data', 'distribution.dat');
writeFileSync(distPath, lines.join('\n') + '\n');

// ---------- field.json ----------
const N = 128;
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
  const N = 6000;
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
    for (let i = 0; i < 1000; i += 1) {
      const x = cx + (rnd() + rnd() + rnd() - 1.5) * 0.85;
      const y = cy + (rnd() + rnd() + rnd() - 1.5) * 0.85;
      const c = (k + 1) * 0.35 + rnd() * 0.3;
      clusters.push(`${x.toFixed(4)} ${y.toFixed(4)} ${c.toFixed(4)}`);
    }
  }
}
writeFileSync(join(root, 'examples', 'data', 'scatter-clusters.dat'), clusters.join('\n') + '\n');

// ---------- galaxy.dat ----------
// Spiral-galaxy particle field (4 columns: x y vx vy) for the particle plugin.
// Deterministic LCG so regeneration is byte-identical.
const galaxy = [];
{
  const rnd = lcg(11);
  const N = 6000;
  for (let i = 0; i < N; i += 1) {
    const arm = i % 4;
    const t = (i / N) * 6.2831853 * 3.0;
    const r = 0.05 + Math.sqrt(rnd()) * 0.95;
    const spread = (rnd() - 0.5) * (0.05 + rnd() * 0.04) * 6;
    const a = t + arm * (Math.PI / 2) + spread;
    const x = r * Math.cos(a) + (rnd() - 0.5) * 0.02;
    const y = r * Math.sin(a) + (rnd() - 0.5) * 0.02;
    const v = 0.02 + rnd() * 0.02;
    const vx = -Math.sin(a) * v;
    const vy = Math.cos(a) * v;
    galaxy.push(`${x.toFixed(5)} ${y.toFixed(5)} ${vx.toFixed(5)} ${vy.toFixed(5)}`);
  }
}
writeFileSync(join(root, 'examples', 'data', 'galaxy.dat'), galaxy.join('\n') + '\n');

// ---------- nbody.json ----------
// 3-D N-body initial conditions: a torus (ring) of orbiting bodies around a
// dominant central mass. Each body is [x, y, z, vx, vy, vz, mass].
const nbodyBodies = [];
{
  const G = 0.05;
  const centralMass = 50;
  const rnd = lcg(23);
  const N = 4096;
  const R = 0.9; // major (ring) radius
  const r = 0.18; // minor (tube) radius
  nbodyBodies.push([0, 0, 0, 0, 0, 0, centralMass]);
  for (let i = 1; i < N; i += 1) {
    const theta = (i / N) * 6.2831853 * 6; // several turns around the ring
    const phi = rnd() * 6.2831853; // position around the tube cross-section
    const px = (R + r * Math.cos(phi)) * Math.cos(theta);
    const py = r * Math.sin(phi);
    const pz = (R + r * Math.cos(phi)) * Math.sin(theta);
    const dist = Math.hypot(px, py, pz);
    const v = Math.sqrt((G * centralMass) / dist) * 0.95;
    // tangential velocity around the central mass (ring lies in the XZ plane)
    const rh = Math.hypot(px, pz) || 1e-6;
    nbodyBodies.push([
      Number(px.toFixed(5)),
      Number(py.toFixed(5)),
      Number(pz.toFixed(5)),
      Number(((pz / rh) * v).toFixed(5)),
      0,
      Number(((-px / rh) * v).toFixed(5)),
      1,
    ]);
  }
}
writeFileSync(
  join(root, 'examples', 'data', 'nbody.json'),
  JSON.stringify({ bodies: nbodyBodies }),
);

// ---------- protein.json ----------
// Modular protein-protein interaction network: proteins grouped into modules
// with dense intra-module edges and sparse inter-module edges.
const proteins = [];
const interactions = [];
{
  const rnd = lcg(31);
  const N = 560;
  const modules = 6;
  for (let i = 0; i < N; i += 1) {
    proteins.push({ id: `P${i}`, name: `Protein-${i}`, module: i % modules });
  }
  for (let i = 0; i < N; i += 1) {
    const mi = i % modules;
    for (let j = i + 1; j < N; j += 1) {
      const mj = j % modules;
      const p = mi === mj ? 0.06 : 0.001;
      if (rnd() < p) {
        interactions.push({
          source: `P${i}`,
          target: `P${j}`,
          weight: mi === mj ? 0.6 + rnd() * 0.4 : 0.2 + rnd() * 0.3,
        });
      }
    }
  }
}
writeFileSync(
  join(root, 'examples', 'data', 'protein.json'),
  JSON.stringify({ proteins, interactions }),
);

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
// Assemble a PNG from signature + chunks. `raw` must already contain per-row
// filter bytes; `colorType` 2 = RGB, 0 = 8-bit grayscale.
function buildPng(width, height, colorType, raw) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = colorType;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
const base64 = buildPng(W, H, 2, raw).toString('base64');

// ---------- imageproc subject PNG ----------
// Exact rasterization of makeTestImage(256, 256, 20261011) from the
// data-imageproc kernel: mulberry32 PRNG + Box-Muller normal noise, diagonal
// gradient + bright disc + vertical stripes. 8-bit grayscale PNG.
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
const IW = 256;
const IH = 256;
const irand = mulberry32(20261011);
const nextNormal = () => {
  let u = 0;
  do {
    u = irand();
  } while (u <= 1e-9);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * irand());
};
const gray = Buffer.alloc((IW + 1) * IH);
const icx = IW * 0.3;
const icy = IH * 0.58;
const ir = Math.min(IW, IH) * 0.22;
for (let y = 0; y < IH; y += 1) {
  gray[y * (IW + 1)] = 0; // filter: none
  for (let x = 0; x < IW; x += 1) {
    let v = 28 + 0.34 * x + 0.26 * y;
    const d = Math.hypot(x - icx, y - icy);
    if (d < ir) v += 88 * (1 - (d / ir) ** 2);
    if (Math.sin((2 * Math.PI * x) / 14) > 0.25) v += 26;
    gray[y * (IW + 1) + 1 + x] = Math.min(255, Math.max(0, Math.round(v + 9 * nextNormal())));
  }
}
const subjectBase64 = buildPng(IW, IH, 0, gray).toString('base64');

const assetsDir = join(root, 'src', 'core');
// exampleAssets.ts is hand-extended with exports this script does not generate
// (e.g. acoustics WAV, DICOM phantom slices). Regenerating must preserve them
// instead of silently dropping those assets.
const GENERATED_EXPORTS = ['TEST_PATTERN_PNG_BASE64', 'IMAGEPROC_SUBJECT_PNG_BASE64'];
let preserved = '';
try {
  // Line-based scan: a preserved block is a run of `//` comment lines followed
  // by an `export const NAME = '…';` value (the closing `;` ends the block).
  // This keeps each hand-added comment attached to the export it documents.
  const lines = readFileSync(join(assetsDir, 'exampleAssets.ts'), 'utf8').split(/\r?\n/);
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const start = i;
    let j = i;
    while (j < lines.length && lines[j].startsWith('//')) j += 1;
    if (j < lines.length && /^export const \w+/.test(lines[j])) {
      let k = j;
      while (k < lines.length && !lines[k].trimEnd().endsWith(';')) k += 1;
      blocks.push(lines.slice(start, k + 1).join('\n'));
      i = k + 1;
    } else {
      i = start + 1; // stray line (e.g. part of the generated header): skip
    }
  }
  preserved = blocks
    .filter((b) => !GENERATED_EXPORTS.some((name) => b.includes(`export const ${name}`)))
    .join('\n\n');
} catch {
  // First run: no existing asset file to preserve.
}
mkdirSync(assetsDir, { recursive: true });
writeFileSync(
  join(assetsDir, 'exampleAssets.ts'),
  `// Auto-generated by scripts/make-example-data.mjs — do not edit by hand.\n` +
    `// 128x128 test-pattern PNG for the Image Viewer example.\n` +
    `// 256x256 seeded test-subject PNG (rasterization of the kernel's makeTestImage\n` +
    `// with seed 20261011) for the Image Processing example.\n` +
    `export const TEST_PATTERN_PNG_BASE64 =\n  '${base64}';\n\n` +
    `export const IMAGEPROC_SUBJECT_PNG_BASE64 =\n  '${subjectBase64}';\n` +
    (preserved ? `\n${preserved}\n` : ''),
);

console.log('generated:');
console.log('  distribution.dat', lines.length, 'values');
console.log('  field.json', N + 'x' + N);
console.log('  tornado.xyz', tornado.length, 'points');
console.log('  scatter-clusters.dat', clusters.length, 'points');
console.log('  galaxy.dat', galaxy.length, 'particles');
console.log('  nbody.json', nbodyBodies.length, 'bodies');
console.log('  protein.json', proteins.length, 'proteins,', interactions.length, 'interactions');
console.log('  exampleAssets.ts', base64.length, '+', subjectBase64.length, 'base64 chars');