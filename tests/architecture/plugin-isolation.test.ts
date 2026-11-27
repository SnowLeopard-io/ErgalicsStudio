// ==========================================================================
// Monorepo architectural boundary guardrails
//
// Guarantees that `packages/*` — and especially `packages/plugins` — remain
// 100% decoupled from `apps/*` so `packages/plugins` can be extracted into a
// standalone repository at any time without refactoring.
// ==========================================================================

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PACKAGES_DIR = join(ROOT, 'packages');

function walkTs(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walkTs(full, out);
    else if (/\.(ts|tsx|mts)$/.test(entry.name)) out.push(full);
  }
  return out;
}

const IMPORT_RE = /(?:from\s+['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|import\s+['"]([^'"]+)['"])/g;

function extractSpecifiers(source: string): string[] {
  const specs: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = IMPORT_RE.exec(source))) {
    const spec = m[1] || m[2] || m[3];
    if (spec) specs.push(spec);
  }
  return specs;
}

describe('Monorepo architectural boundaries (plugin extraction readiness)', () => {
  it('packages/* contain zero host @/* aliases and zero imports into apps/*', () => {
    const files = walkTs(PACKAGES_DIR);
    expect(files.length).toBeGreaterThan(500);
    const violations: string[] = [];

    for (const file of files) {
      const rel = relative(ROOT, file).replace(/\\/g, '/');
      const specs = extractSpecifiers(readFileSync(file, 'utf8'));
      for (const spec of specs) {
        if (spec.startsWith('@/')) {
          violations.push(`${rel}: forbidden host alias "${spec}"`);
        }
        if (spec.includes('/apps/') || spec === '@ergalics/studio' || spec === '@ergalics/website' || spec === '@ergalics/docs') {
          violations.push(`${rel}: forbidden app import "${spec}"`);
        }
        if (spec.startsWith('.')) {
          const target = resolve(dirname(file), spec);
          const relTarget = relative(PACKAGES_DIR, target).replace(/\\/g, '/');
          if (relTarget.startsWith('..')) {
            violations.push(`${rel}: relative import escapes packages/: "${spec}"`);
          }
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it('packages/plugin-signing has zero runtime dependencies', () => {
    const pkg = JSON.parse(readFileSync(join(PACKAGES_DIR, 'plugin-signing', 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
    };
    expect(Object.keys(pkg.dependencies ?? {})).toEqual([]);
  });

  it('packages/plugins declares every external npm dependency explicitly in package.json', () => {
    const pkg = JSON.parse(readFileSync(join(PACKAGES_DIR, 'plugins', 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
    };
    const declared = new Set([
      ...Object.keys(pkg.dependencies ?? {}),
      ...Object.keys(pkg.peerDependencies ?? {}),
    ]);
    const files = walkTs(join(PACKAGES_DIR, 'plugins', 'src'));
    const undeclared = new Set<string>();

    for (const file of files) {
      for (const spec of extractSpecifiers(readFileSync(file, 'utf8'))) {
        if (spec.startsWith('.') || spec.startsWith('node:') || spec.startsWith('virtual:')) continue;
        const pkgName = spec.startsWith('@')
          ? spec.split('/').slice(0, 2).join('/')
          : spec.split('/')[0]!;
        if (!declared.has(pkgName)) {
          undeclared.add(`${relative(ROOT, file).replace(/\\/g, '/')} -> ${pkgName}`);
        }
      }
    }

    expect([...undeclared]).toEqual([]);
  });
});
