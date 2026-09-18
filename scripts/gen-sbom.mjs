/**
 * FR-18 — SBOM generator (CycloneDX 1.5, pure Node, zero dependencies).
 *
 * Reads package.json + package-lock.json (lockfileVersion 3) and emits a
 * CycloneDX JSON bill-of-materials covering the app component and every
 * locked dependency (name / version / resolved / integrity). Runs in CI via
 * `node scripts/gen-sbom.mjs`; the artifact is uploaded by
 * .github/workflows/security.yml.
 *
 * Usage: node scripts/gen-sbom.mjs [outputPath]   (default: sbom/cyclonedx.sbom.json)
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outPath = resolve(process.argv[2] ?? join(root, 'sbom', 'cyclonedx.sbom.json'));

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));

if (lock.lockfileVersion !== 3) {
  console.error(`Unsupported lockfileVersion ${lock.lockfileVersion} (expected 3).`);
  process.exit(1);
}

const purlOf = (name) => `pkg:npm/${name.replace(/^@/, '').replace('/', '%2f')}`;

const components = [];
for (const [pathKey, entry] of Object.entries(lock.packages ?? {})) {
  if (!pathKey.startsWith('node_modules/')) continue;
  const name = entry.name ?? pathKey.slice('node_modules/'.length).split('/node_modules/').pop();
  if (!name) continue;
  const component = {
    type: 'library',
    'bom-ref': purlOf(name),
    name,
    version: entry.version ?? 'unknown',
  };
  if (entry.resolved) component.repository = { url: entry.resolved };
  const hashes = [];
  if (entry.integrity) {
    const [algo, digest] = entry.integrity.split('-');
    if (algo && digest) hashes.push({ alg: algo.toUpperCase(), content: digest });
  }
  if (hashes.length) component.hashes = hashes;
  if (entry.dev) component.properties = [{ name: 'cdx:npm:devDependency', value: 'true' }];
  components.push(component);
}

const bom = {
  bomFormat: 'CycloneDX',
  specVersion: '1.5',
  serialNumber: `urn:uuid:${crypto.randomUUID()}`,
  version: 1,
  metadata: {
    timestamp: new Date().toISOString(),
    tools: [{ vendor: 'ergalics-studio', name: 'gen-sbom.mjs', version: pkg.version }],
    component: {
      type: 'application',
      'bom-ref': purlOf(pkg.name),
      name: pkg.name,
      version: pkg.version,
      licenses: pkg.license ? [{ license: { id: pkg.license } }] : undefined,
    },
  },
  components,
};

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(bom, null, 2));
console.log(`SBOM (CycloneDX 1.5): ${components.length} components → ${outPath}`);
