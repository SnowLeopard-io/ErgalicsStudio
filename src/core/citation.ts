// FR-10 — Software citation & archival metadata.
//
// Single source of truth for the citation card shown on the Settings "About"
// section. The version comes from the build-time `__APP_VERSION__` define
// (injected by vite from package.json). Author and license are hardcoded here
// and MUST stay in sync with package.json — `scripts/check-citation.mjs`
// (wired into .github/workflows/ci.yml) fails the build on any drift.
import type { Locale } from '@/i18n/types';

// `__APP_VERSION__` / `__ZENODO_DOI__` are declared globally in
// src/vite-env.d.ts and injected by vite `define`.

function injectedVersion(): string {
  // Vitest / node runs do not apply vite `define`, so guard with typeof and
  // fall back to the package.json version (kept in sync by check-citation).
  return typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '1.9.0';
}

function injectedDoi(): string {
  return typeof __ZENODO_DOI__ !== 'undefined' ? __ZENODO_DOI__ : '';
}

export const CITATION_META = {
  /** Human-readable software title used in citation entries. */
  title: 'Ergalics Studio',
  /**
   * Author as declared in package.json ("Name <email>").
   * Keep in sync with package.json — scripts/check-citation.mjs enforces this in CI.
   */
  author: 'SnowLeopard-io <1486853830@qq.com>',
  /**
   * SPDX license identifier as declared in package.json.
   * Keep in sync with package.json — scripts/check-citation.mjs enforces this in CI.
   */
  license: 'MIT',
  /** Upstream repository (GitHub). */
  repoUrl: 'https://github.com/SnowLeopard-io/ErgalicsStudio',
} as const;

/** GitHub release tag URL for a given version (tags are `v<semver>`). */
export function citationUrl(version: string): string {
  const v = version.startsWith('v') ? version : `v${version}`;
  return `${CITATION_META.repoUrl}/releases/tag/${v}`;
}

/**
 * DOI line for the current release. When `__ZENODO_DOI__` is configured at
 * build time (release workflow publishes it after the Zenodo archive job),
 * the real DOI is shown; otherwise a placeholder makes it clear the archive
 * DOI is pending a tagged release (FR-10: the release workflow owns DOI
 * minting, and CI fails loudly if archiving breaks).
 */
export function citationDoi(version: string = injectedVersion()): string {
  const doi = injectedDoi();
  if (doi) return `https://doi.org/${doi}`;
  // Placeholder pointing at the release archive for this exact version.
  return `DOI: pending release archive (${citationUrl(version)})`;
}

/** Reduce package.json-style author ("Name <email>") to a BibTeX-safe name. */
function authorForBibtex(author: string): string {
  const m = /^(.*?)\s*<(.+)>$/.exec(author);
  return (m?.[1] ?? author).trim();
}

/**
 * Standard BibTeX `@software` entry for this release.
 * Includes version, year, url and a note carrying the version/DOI line so
 * the citation stays consistent with the running build.
 */
export function softwareCitationBibtex(version: string = injectedVersion()): string {
  const year = new Date().getFullYear();
  return [
    '@software{ergalics_studio,',
    `  author  = {${authorForBibtex(CITATION_META.author)}},`,
    `  title   = {{${CITATION_META.title}}},`,
    `  version = {${version}},`,
    `  year    = {${year}},`,
    `  url     = {${citationUrl(version)}},`,
    `  note    = {License: ${CITATION_META.license}. ${citationDoi(version)}},`,
    '}',
  ].join('\n');
}

/** Plain-text (human-readable) citation in the requested locale. */
export function softwareCitationPlain(lang: Locale, version: string = injectedVersion()): string {
  const year = new Date().getFullYear();
  const authorName = CITATION_META.author.split(' <')[0] ?? CITATION_META.author;
  const url = citationUrl(version);
  const doi = citationDoi(version);
  if (lang === 'zh-CN') {
    return `${authorName}．（${year}）．${CITATION_META.title}（版本 ${version}）[计算机软件]．${doi}．${url}`;
  }
  return `${authorName}. (${year}). ${CITATION_META.title} (Version ${version}) [Computer software]. ${doi}. ${url}`;
}

/** Current build version (exported so the About card can reuse it). */
export function currentAppVersion(): string {
  return injectedVersion();
}
