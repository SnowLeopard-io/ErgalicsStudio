// ==========================================================================
// FR-21 theme market — .cstheme package schema (pure TS, no DOM)
//
// A theme package is *pure declarative data*: CSS custom-property overrides,
// a font preference, a density mode and an optional chart palette. It must
// never carry executable content. parseCsTheme() is the single validation
// gate — anything that reaches apply.ts has passed it.
//
// Validation strategy (mirrors the defensive style of core/cspkg.ts):
//   - strict unknown-key rejection at every nesting level
//   - dangerous prototype keys (__proto__ / constructor / prototype) rejected
//   - CSS custom-property names must match `--kebab-case`
//   - color values: hex / rgb() / rgba() / hsl() / hsla() literals ONLY
//   - font-family values: whitelist token cleaning (no url(), no functions)
//   - every other value: conservative charset that cannot open a new
//     declaration, a rule block, a comment or a URL/expression construct
// ==========================================================================

export interface CsThemeTokens {
  /** Overrides applied in BOTH light and dark mode. */
  common?: Record<string, string>;
  /** Overrides applied only while the app is in light mode. */
  light?: Record<string, string>;
  /** Overrides applied only while the app is in dark mode. */
  dark?: Record<string, string>;
}

export interface CsThemeFont {
  /** Sanitized CSS font-family stack (written to --font-sans). */
  family?: string;
  /** Multiplier applied to the base --font-size-* tokens (0.5–2). */
  scale?: number;
}

export type CsThemeDensity = 'comfortable' | 'compact';

export interface CsTheme {
  id: string;
  name: string;
  version: string;
  description?: string;
  author?: string;
  tokens: CsThemeTokens;
  font?: CsThemeFont;
  density?: CsThemeDensity;
  /** Recommended chart colors; consumers fall back to the default palette. */
  chartPalette?: string[];
  /** Minimum app version (semver) this theme was authored against. */
  minAppVersion?: string;
}

/** Structured parse/validation failure. `path` points at the offending
 *  field (e.g. `tokens.light[--color-accent]`) so the UI can surface a
 *  precise message. */
export class ThemeParseError extends Error {
  readonly path: string;
  constructor(message: string, path: string) {
    super(`cstheme: ${message} (at ${path})`);
    this.name = 'ThemeParseError';
    this.path = path;
  }
}

// ---------------------------------------------------------------------------
// Limits & literal patterns
// ---------------------------------------------------------------------------

const MAX_JSON_CHARS = 64 * 1024;
const MAX_TOKENS_PER_LAYER = 64;
const MAX_PALETTE = 12;
const MAX_NAME = 80;
const MAX_DESCRIPTION = 500;
const MAX_AUTHOR = 100;

const ID_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/i;
const VERSION_RE = /^\d+\.\d+\.\d+$/;
const CSS_VAR_RE = /^--[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

const HEX_RE = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const RGB_RE =
  /^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(?:,\s*(?:\d{1,3}|100(?:\.\d+)?%?|0?\.\d+)\s*)?\)$/i;
const HSL_RE =
  /^hsla?\(\s*\d{1,3}(?:deg)?\s*,\s*\d{1,3}%\s*,\s*\d{1,3}%\s*(?:,\s*(?:\d{1,3}|100(?:\.\d+)?%?|0?\.\d+)\s*)?\)$/i;
const LENGTH_RE = /^(?:0|\d+(?:\.\d+)?(?:px|rem|em|%))$/;

/** Conservative charset for "everything else" (shadows, transitions, plain
 *  numbers…). Deliberately excludes `; { } < > \` @ \ ' "` and any
 *  case-insensitive occurrence of the executable-ish keywords below. */
const GENERIC_VALUE_RE = /^[A-Za-z0-9 ,.\-/%#()]+$/;
// Substring blacklist: constructs that smuggle external resources or script
// URIs. Markup like `<script>` is caught separately by the character-class
// checks (GENERIC_VALUE_RE / requireString), so no word-level "script" ban —
// that would false-positive on legitimate prose such as "description".
const FORBIDDEN_SUBSTRINGS = ['url(', 'expression(', 'javascript:', 'data:', 'eval('];

const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

const TOP_LEVEL_KEYS = new Set([
  'id', 'name', 'version', 'description', 'author',
  'tokens', 'font', 'density', 'chartPalette', 'minAppVersion',
]);
const TOKEN_KEYS = new Set(['common', 'light', 'dark']);
const FONT_KEYS = new Set(['family', 'scale']);

const GENERIC_FAMILIES = new Set([
  'serif', 'sans-serif', 'monospace', 'cursive', 'fantasy',
  'system-ui', 'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded',
]);
const FONT_TOKEN_RE = /^[A-Za-z0-9 _.]+$/;

const FONT_FAMILY_KEYS = new Set(['--font-sans', '--font-mono', '--font-family']);

// ---------------------------------------------------------------------------
// Value validators
// ---------------------------------------------------------------------------

function hasForbiddenFragment(value: string): boolean {
  const lowered = value.toLowerCase();
  return FORBIDDEN_SUBSTRINGS.some((frag) => lowered.includes(frag));
}

export function isColorLiteral(value: string): boolean {
  return HEX_RE.test(value) || RGB_RE.test(value) || HSL_RE.test(value);
}

function requireColor(value: string, path: string): string {
  const v = value.trim();
  if (!isColorLiteral(v)) {
    throw new ThemeParseError(
      `color values must be hex/rgb/rgba/hsl/hsla literals, got ${JSON.stringify(value)}`,
      path,
    );
  }
  return v;
}

function requireLength(value: string, path: string): string {
  const v = value.trim();
  if (!LENGTH_RE.test(v)) {
    throw new ThemeParseError(`expected a px/rem/em/% length, got ${JSON.stringify(value)}`, path);
  }
  return v;
}

/** Whitelist-style font-family cleaning: split the stack, validate every
 *  family token (quoted names may contain letters/digits/space/./-/_ only;
 *  unquoted generic keywords must come from the known set), re-emit with
 *  quoted names normalized to single quotes. */
export function sanitizeFontStack(value: string, path: string): string {
  const v = value.trim();
  if (v.length === 0 || v.length > 200 || hasForbiddenFragment(v)) {
    throw new ThemeParseError(`invalid font-family stack ${JSON.stringify(value)}`, path);
  }
  const tokens = v.split(',').map((t) => t.trim()).filter((t) => t.length > 0);
  if (tokens.length === 0) {
    throw new ThemeParseError('font-family stack is empty', path);
  }
  const cleaned: string[] = [];
  for (const token of tokens) {
    const quoted = /^'([^']*)'$/.exec(token) ?? /^"([^"]*)"$/.exec(token);
    const name = quoted ? quoted[1]! : token;
    if (!FONT_TOKEN_RE.test(name)) {
      throw new ThemeParseError(`font family ${JSON.stringify(token)} contains illegal characters`, path);
    }
    if (!quoted && !GENERIC_FAMILIES.has(name.toLowerCase())) {
      throw new ThemeParseError(
        `unquoted font family ${JSON.stringify(token)} is not a generic keyword; quote it`,
        path,
      );
    }
    cleaned.push(`'${name}'`);
  }
  return cleaned.join(', ');
}

function requireGenericSafe(value: string, path: string): string {
  const v = value.trim();
  if (v.length === 0 || v.length > 200) {
    throw new ThemeParseError(`value length out of bounds: ${JSON.stringify(value)}`, path);
  }
  if (hasForbiddenFragment(v)) {
    throw new ThemeParseError(`value contains a forbidden construct: ${JSON.stringify(value)}`, path);
  }
  if (!GENERIC_VALUE_RE.test(v)) {
    throw new ThemeParseError(`value contains illegal characters: ${JSON.stringify(value)}`, path);
  }
  return v;
}

/** Validate one custom-property value by key class. Returns the cleaned
 *  value or throws ThemeParseError. */
export function sanitizeTokenValue(key: string, value: string, path: string): string {
  if (typeof value !== 'string') {
    throw new ThemeParseError('token value must be a string', path);
  }
  if (hasForbiddenFragment(value)) {
    throw new ThemeParseError(`value contains a forbidden construct: ${JSON.stringify(value)}`, path);
  }
  if (FONT_FAMILY_KEYS.has(key)) return sanitizeFontStack(value, path);
  const lowerKey = key.toLowerCase();
  if (lowerKey.includes('color') || lowerKey.startsWith('--cat-')) return requireColor(value, path);
  if (
    lowerKey.startsWith('--font-size-') ||
    lowerKey.startsWith('--space-') ||
    lowerKey.startsWith('--radius-') ||
    lowerKey.endsWith('-width') ||
    lowerKey.endsWith('-height')
  ) {
    return requireLength(value, path);
  }
  return requireGenericSafe(value, path);
}

// ---------------------------------------------------------------------------
// Object helpers
// ---------------------------------------------------------------------------

function asRecord(raw: unknown, path: string): Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new ThemeParseError('expected an object', path);
  }
  return raw as Record<string, unknown>;
}

function requireString(raw: unknown, path: string, max: number): string {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    throw new ThemeParseError('expected a non-empty string', path);
  }
  const v = raw.trim();
  if (v.length > max) {
    throw new ThemeParseError(`string longer than ${max} characters`, path);
  }
  // Strings must not smuggle markup or declaration separators anywhere.
  if (/[<>{};`\\]/.test(v) || hasForbiddenFragment(v)) {
    throw new ThemeParseError(`string contains forbidden characters: ${JSON.stringify(v)}`, path);
  }
  return v;
}

function rejectUnknownKeys(input: Record<string, unknown>, allowed: Set<string>, path: string): void {
  for (const key of Object.keys(input)) {
    if (DANGEROUS_KEYS.has(key)) {
      throw new ThemeParseError(`dangerous key ${JSON.stringify(key)}`, `${path}.${key}`);
    }
    if (!allowed.has(key)) {
      throw new ThemeParseError(`unknown key ${JSON.stringify(key)}`, `${path}.${key}`);
    }
  }
}

function parseTokenLayer(raw: unknown, path: string): Record<string, string> {
  const input = asRecord(raw, path);
  const out: Record<string, string> = {};
  const keys = Object.keys(input);
  if (keys.length > MAX_TOKENS_PER_LAYER) {
    throw new ThemeParseError(`too many tokens (max ${MAX_TOKENS_PER_LAYER})`, path);
  }
  for (const key of keys) {
    const keyPath = `${path}[${key}]`;
    if (DANGEROUS_KEYS.has(key)) throw new ThemeParseError(`dangerous key ${JSON.stringify(key)}`, keyPath);
    if (!CSS_VAR_RE.test(key)) {
      throw new ThemeParseError(`"${key}" is not a --kebab-case custom property`, keyPath);
    }
    out[key] = sanitizeTokenValue(key, input[key] as string, keyPath);
  }
  return out;
}

function parseTokens(raw: unknown, path: string): CsThemeTokens {
  const input = asRecord(raw, path);
  rejectUnknownKeys(input, TOKEN_KEYS, path);
  const out: CsThemeTokens = {};
  for (const layer of ['common', 'light', 'dark'] as const) {
    if (input[layer] !== undefined) {
      out[layer] = parseTokenLayer(input[layer], `${path}.${layer}`);
    }
  }
  return out;
}

function parseFont(raw: unknown, path: string): CsThemeFont {
  const input = asRecord(raw, path);
  rejectUnknownKeys(input, FONT_KEYS, path);
  const out: CsThemeFont = {};
  if (input.family !== undefined) out.family = sanitizeFontStack(String(input.family), `${path}.family`);
  if (input.scale !== undefined) {
    if (typeof input.scale !== 'number' || !Number.isFinite(input.scale) || input.scale < 0.5 || input.scale > 2) {
      throw new ThemeParseError('font.scale must be a number in [0.5, 2]', `${path}.scale`);
    }
    out.scale = input.scale;
  }
  return out;
}

function parseChartPalette(raw: unknown, path: string): string[] {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_PALETTE) {
    throw new ThemeParseError(`chartPalette must hold 1-${MAX_PALETTE} colors`, path);
  }
  return raw.map((c, i) => requireColor(String(c), `${path}[${i}]`));
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/** Strictly validate an arbitrary parsed-JSON value into a CsTheme.
 *  Throws ThemeParseError on any structural or safety violation. */
export function parseCsTheme(raw: unknown): CsTheme {
  if (typeof raw === 'string' && raw.length > MAX_JSON_CHARS) {
    throw new ThemeParseError(`package larger than ${MAX_JSON_CHARS} characters`, '$');
  }
  const input = asRecord(raw, '$');
  rejectUnknownKeys(input, TOP_LEVEL_KEYS, '$');

  const id = requireString(input.id, '$.id', 64);
  if (!ID_RE.test(id)) throw new ThemeParseError(`invalid theme id ${JSON.stringify(id)}`, '$.id');

  const name = requireString(input.name, '$.name', MAX_NAME);
  const version = requireString(input.version, '$.version', 20);
  if (!VERSION_RE.test(version)) {
    throw new ThemeParseError(`version must be major.minor.patch, got ${JSON.stringify(version)}`, '$.version');
  }

  const theme: CsTheme = { id, name, version, tokens: parseTokens(input.tokens, '$.tokens') };
  if (input.description !== undefined) theme.description = requireString(input.description, '$.description', MAX_DESCRIPTION);
  if (input.author !== undefined) theme.author = requireString(input.author, '$.author', MAX_AUTHOR);
  if (input.font !== undefined) theme.font = parseFont(input.font, '$.font');
  if (input.density !== undefined) {
    if (input.density !== 'comfortable' && input.density !== 'compact') {
      throw new ThemeParseError(`unknown density ${JSON.stringify(input.density)}`, '$.density');
    }
    theme.density = input.density;
  }
  if (input.chartPalette !== undefined) theme.chartPalette = parseChartPalette(input.chartPalette, '$.chartPalette');
  if (input.minAppVersion !== undefined) {
    const min = requireString(input.minAppVersion, '$.minAppVersion', 20);
    if (!VERSION_RE.test(min)) {
      throw new ThemeParseError(`minAppVersion must be major.minor.patch, got ${JSON.stringify(min)}`, '$.minAppVersion');
    }
    theme.minAppVersion = min;
  }
  return theme;
}

/** Accepts the raw text of a .cstheme file (JSON). */
export function parseCsThemeJson(text: string): CsTheme {
  if (text.length > MAX_JSON_CHARS) {
    throw new ThemeParseError(`package larger than ${MAX_JSON_CHARS} characters`, '$');
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (err) {
    throw new ThemeParseError(
      `invalid JSON — ${err instanceof Error ? err.message : String(err)}`,
      '$',
    );
  }
  return parseCsTheme(value);
}

/** Compare two `major.minor.patch` versions; returns <0, 0 or >0. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i += 1) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** True when the running app version satisfies the theme's minAppVersion.
 *  Themes without the field are always compatible. */
export function isThemeCompatible(theme: CsTheme, appVersion: string): boolean {
  if (!theme.minAppVersion) return true;
  return compareVersions(appVersion, theme.minAppVersion) >= 0;
}
