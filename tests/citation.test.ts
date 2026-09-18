// FR-10 — Software citation metadata tests.
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  CITATION_META,
  citationUrl,
  citationDoi,
  softwareCitationBibtex,
  softwareCitationPlain,
  currentAppVersion,
} from '@/core/citation';

const ROOT = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as {
  version: string;
  license: string;
  author: string;
};

describe('FR-10 citation', () => {
  it('CITATION_META author/license match package.json (single source of truth)', () => {
    expect(CITATION_META.author).toBe(pkg.author);
    expect(CITATION_META.license).toBe(pkg.license);
  });

  it('currentAppVersion falls back to the package.json version outside vite', () => {
    // Vitest does not apply vite `define`, so the fallback literal is used.
    expect(currentAppVersion()).toBe(pkg.version);
  });

  it('softwareCitationBibtex produces a @software entry with version/url/note', () => {
    const bib = softwareCitationBibtex('1.2.3');
    expect(bib.startsWith('@software{')).toBe(true);
    expect(bib).toContain('version = {1.2.3}');
    expect(bib).toContain('url     = {https://github.com/SnowLeopard-io/ErgalicsStudio/releases/tag/v1.2.3}');
    expect(bib).toContain('note    = {License: MIT.');
    expect(bib).toContain('year    = {');
    expect(bib.trimEnd().endsWith('}')).toBe(true);
  });

  it('softwareCitationBibtex embeds the current build version', () => {
    const bib = softwareCitationBibtex();
    expect(bib).toContain(`version = {${currentAppVersion()}}`);
  });

  it('softwareCitationBibtex author contains the package.json author name', () => {
    const bib = softwareCitationBibtex('0.1.0');
    expect(bib).toContain('SnowLeopard-io');
  });

  it('citationUrl builds the GitHub release tag URL for a version', () => {
    expect(citationUrl('2.0.1')).toBe('https://github.com/SnowLeopard-io/ErgalicsStudio/releases/tag/v2.0.1');
  });

  it('citationUrl does not double-prefix an already-tagged version', () => {
    expect(citationUrl('v2.0.1')).toBe(citationUrl('2.0.1'));
  });

  it('citationUrl is consistent with the version embedded in the BibTeX url field', () => {
    const v = currentAppVersion();
    const bib = softwareCitationBibtex(v);
    expect(bib).toContain(`url     = {${citationUrl(v)}}`);
  });

  it('citationDoi shows a pending placeholder when no DOI is configured', () => {
    // __ZENODO_DOI__ is not defined under vitest → placeholder branch.
    const doi = citationDoi('0.1.0');
    expect(doi).toContain('DOI: pending release archive');
    expect(doi).toContain(citationUrl('0.1.0'));
  });

  it('softwareCitationPlain (zh-CN) contains the version and release URL', () => {
    const plain = softwareCitationPlain('zh-CN', '3.4.5');
    expect(plain).toContain('3.4.5');
    expect(plain).toContain(citationUrl('3.4.5'));
    expect(plain).toContain('计算机软件');
    expect(plain).toContain(CITATION_META.title);
  });

  it('softwareCitationPlain (en-US) contains Version, DOI note and URL', () => {
    const plain = softwareCitationPlain('en-US', '3.4.5');
    expect(plain).toContain('Version 3.4.5');
    expect(plain).toContain('[Computer software]');
    expect(plain).toContain('pending release archive');
    expect(plain).toContain(citationUrl('3.4.5'));
  });

  it('softwareCitationPlain default version matches currentAppVersion', () => {
    const plain = softwareCitationPlain('en-US');
    expect(plain).toContain(`Version ${currentAppVersion()}`);
  });

  it('gen-citation-cff.mjs emits a valid CITATION.cff matching package.json', () => {
    const out = path.join(ROOT, 'CITATION.test.tmp.cff');
    try {
      execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'gen-citation-cff.mjs'), '--out', out], {
        cwd: ROOT,
        stdio: 'pipe',
      });
      const cff = readFileSync(out, 'utf8');
      expect(cff).toContain('cff-version: 1.2.0');
      expect(cff).toContain('title: "Ergalics Studio"');
      expect(cff).toContain(`version: "${pkg.version}"`);
      expect(cff).toContain(`license: "${pkg.license}"`);
      expect(cff).toContain('authors:');
      expect(cff).toContain('repository-code: "https://github.com/SnowLeopard-io/ErgalicsStudio"');
      // Minimal YAML sanity: every non-comment line is `key:`, a list item
      // (`- key:` or `- "value"`), or a nested `key:` under a list item.
      for (const line of cff.split('\n')) {
        if (line.trim() === '' || line.startsWith('#')) continue;
        const ok =
          /^[a-z][a-z-]*:/.test(line) || // top-level key
          /^\s+-\s+(\S+:|"[^"]*")/.test(line) || // list item (mapping or scalar)
          /^\s+\S+:\s*("?[^"]*"?)$/.test(line); // nested key under a list item
        expect(ok, `unexpected YAML line: ${JSON.stringify(line)}`).toBe(true);
      }
    } finally {
      rmSync(out, { force: true });
    }
  });

  it('committed CITATION.cff at the repo root matches package.json version', () => {
    const cff = readFileSync(path.join(ROOT, 'CITATION.cff'), 'utf8');
    expect(cff).toContain(`version: "${pkg.version}"`);
  });
});
