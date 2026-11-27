/**
 * FR-18 — SBOM generator (CycloneDX 1.5, pure Node, zero dependencies).
 *
 * Reads root package.json + pnpm-lock.yaml (lockfileVersion 9) and emits a
 * CycloneDX JSON bill-of-materials covering the root monorepo component and
 * every locked external dependency (name / version / integrity). Runs in CI
 * via `node scripts/gen-sbom.mjs`; the artifact is uploaded by
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
const lockRaw = readFileSync(join(root, 'pnpm-lock.yaml'), 'utf8').replace(/\r\n?/g, '\n');

const versionMatch = /^lockfileVersion:\s*['"]?([^'"\n]+)['"]?/m.exec(lockRaw);
if (!versionMatch || !versionMatch[1].startsWith('9')) {
  console.error(`Unsupported pnpm lockfileVersion ${versionMatch?.[1] ?? 'unknown'} (expected 9.x).`);
  process.exit(1);
}

// purl spec: scope `@` is percent-encoded as %40; `/` separates namespace
// from name and stays a literal separator (CycloneDX purl grammar).
const purlOf = (name, version) =>
  `pkg:npm/${name.replace(/^@/, '%40')}${version ? `@${version}` : ''}`;

/**
 * Parse a pnpm v9 `packages:` key such as:
 *   '@eslint/js@10.0.1'
 *   'vite@8.3.8'
 *   'foo@1.2.3(bar@4.5.6)'
 */
function parsePkgKey(rawKey) {
  const key = rawKey.replace(/^['"]|['"]$/g, '');
  const paren = key.indexOf('(');
  const core = paren >= 0 ? key.slice(0, paren) : key;
  const at = core.lastIndexOf('@');
  if (at <= 0) return null;
  const name = core.slice(0, at);
  const version = core.slice(at + 1);
  if (!name || !version) return null;
  return { name, version };
}

const lockDocs = lockRaw.split(/^---\s*$/m).filter((d) => d.trim().length > 0);
const projectLock = lockDocs[lockDocs.length - 1] ?? lockRaw;

// Extract top-level `packages:` section from the project lockfile document.
const lines = projectLock.split('\n');
let inPackages = false;
let current = null;
const components = [];
const seen = new Set();

function flush() {
  if (!current) return;
  const dedupeKey = `${current.name}@${current.version}`;
  if (!seen.has(dedupeKey)) {
    seen.add(dedupeKey);
    const component = {
      type: 'library',
      'bom-ref': purlOf(current.name, current.version),
      purl: purlOf(current.name, current.version),
      name: current.name,
      version: current.version,
    };
    if (current.integrity) {
      const dash = current.integrity.indexOf('-');
      if (dash > 0) {
        component.hashes = [
          {
            alg: current.integrity.slice(0, dash).toUpperCase().replace(/^SHA(\d+)$/, 'SHA-$1'),
            content: current.integrity.slice(dash + 1),
          },
        ];
      }
    }
    components.push(component);
  }
  current = null;
}

for (const line of lines) {
  if (/^\S/.test(line)) {
    if (inPackages) {
      flush();
      break;
    }
    if (line.trim() === 'packages:') {
      inPackages = true;
    }
    continue;
  }
  if (!inPackages) continue;

  // Package key line: exactly 2 spaces indent followed by `<key>:`
  const pkgMatch = /^  ([^:\s][^:]*):$/.exec(line);
  if (pkgMatch) {
    flush();
    const parsed = parsePkgKey(pkgMatch[1].trim());
    if (parsed) current = { ...parsed, integrity: null };
    continue;
  }

  if (current) {
    const intMatch = /integrity:\s*['"]?([^'"}\s,]+)['"]?/.exec(line);
    if (intMatch) current.integrity = intMatch[1];
  }
}
flush();

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
      'bom-ref': purlOf(pkg.name, pkg.version),
      name: pkg.name,
      version: pkg.version,
      licenses: pkg.license ? [{ license: { id: pkg.license } }] : undefined,
    },
  },
  components,
};

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(bom, null, 2));
console.log(`SBOM (CycloneDX 1.5 from pnpm-lock.yaml): ${components.length} components → ${outPath}`);
