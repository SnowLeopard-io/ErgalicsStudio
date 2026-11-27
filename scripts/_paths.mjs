// ==========================================================================
// Centralized Monorepo path constants for all scripts/*.mjs helpers.
// ==========================================================================
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const ROOT = resolve(__dirname, '..');
export const APPS_DIR = join(ROOT, 'apps');
export const PACKAGES_DIR = join(ROOT, 'packages');

export const STUDIO_DIR = join(APPS_DIR, 'studio');
export const STUDIO_SRC = join(STUDIO_DIR, 'src');
export const STUDIO_PUBLIC = join(STUDIO_DIR, 'public');
export const STUDIO_DIST = join(STUDIO_DIR, 'dist');
export const STUDIO_NATIVE = join(STUDIO_SRC, 'native');

export const WEBSITE_DIR = join(APPS_DIR, 'website');
export const WEBSITE_DIST = join(WEBSITE_DIR, 'dist');

export const DOCS_DIR = join(APPS_DIR, 'docs');
export const DOCS_DIST = join(DOCS_DIR, '.vitepress', 'dist');

export const PLUGINS_DIR = join(PACKAGES_DIR, 'plugins');
export const PLUGINS_SRC = join(PLUGINS_DIR, 'src');
export const PLUGINS_BUILTIN = join(PLUGINS_SRC, 'builtin');
