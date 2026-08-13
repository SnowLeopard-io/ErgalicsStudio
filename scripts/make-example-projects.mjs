// Build example .clproj project files from the sample data files.
// Run: node scripts/make-example-projects.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = join(root, 'examples', 'data');
const outDir = join(root, 'examples', 'projects');
mkdirSync(outDir, { recursive: true });

const now = Date.now();

function entry(name, format, mimeType) {
  const content = readFileSync(join(dataDir, name), 'utf8');
  return {
    id: randomUUID(),
    name,
    size: Buffer.byteLength(content, 'utf8'),
    mimeType,
    format,
    content,
  };
}

function project({ name, description, tags, files, state }) {
  return {
    id: randomUUID(),
    name,
    createdAt: now - 3600_000,
    updatedAt: now,
    data: { files, processed: null },
    state,
    metadata: {
      version: '1.0',
      description,
      tags,
    },
  };
}

const pointCloudDemo = project({
  name: 'Point Cloud Demo — 点云示例',
  description: 'A Fibonacci-sphere point cloud. 斐波那契球面点云示例。',
  tags: ['point-cloud', 'sample', 'xyz'],
  files: [entry('diamond.xyz', 'xyz', 'text/plain')],
  state: {
    activePlugin: 'example.point-cloud',
    parameters: {
      'example.point-cloud': { size: 2, color: '#2563eb', reset: false },
    },
    camera: { position: [0, 0, 12], target: [0, 0, 0], up: [0, 1, 0] },
    scene: null,
  },
});

const crystalDemo = project({
  name: 'Crystal Lattice — 晶体点阵示例',
  description: 'A simple-cubic crystal lattice. 简立方晶体点阵示例。',
  tags: ['point-cloud', 'crystal', 'sample'],
  files: [entry('crystal.xyz', 'xyz', 'text/plain')],
  state: {
    activePlugin: 'example.point-cloud',
    parameters: {
      'example.point-cloud': { size: 3, color: '#059669', reset: false },
    },
    camera: { position: [0, 0, 18], target: [0, 0, 0], up: [0, 1, 0] },
    scene: null,
  },
});

const particleDemo = project({
  name: 'Particle Simulator — 粒子模拟示例',
  description: 'Galaxy-style particle data for the particle simulator. 星系粒子模拟数据。',
  tags: ['particles', 'sample', 'dat'],
  files: [entry('galaxy.dat', 'dat', 'application/octet-stream')],
  state: {
    activePlugin: 'example.particles',
    parameters: {
      'example.particles': { count: 3000, speed: 1, start: true },
    },
    camera: null,
    scene: null,
  },
});

for (const [file, data] of [
  ['point-cloud-demo.clproj', pointCloudDemo],
  ['crystal-lattice-demo.clproj', crystalDemo],
  ['particles-demo.clproj', particleDemo],
]) {
  writeFileSync(join(outDir, file), JSON.stringify(data, null, 2));
  console.log('wrote', file, `${Buffer.byteLength(JSON.stringify(data), 'utf8')} bytes`);
}