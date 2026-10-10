// ==========================================================================
// Ergalics Studio — allowlist sanitizer for externally produced SVG
//
// Used by the report builder and the reproducible snapshot before an SVG is
// inlined into a standalone exported HTML document. The input can come from
// an untrusted `.clproj` project file (reports[].sections[].svg survives
// project serialization verbatim), so the sanitizer assumes the worst.
//
// Design (fail-closed, no DOM required):
//   1. Tokenize into tags / text / comments / CDATA / doctype / PI.
//   2. Re-emit ONLY allowlisted elements and ONLY allowlisted attributes;
//      everything else — comments, doctypes, SMIL animation, script/style,
//      foreignObject, unknown tags, unknown attributes — is dropped.
//   3. Every text node and attribute value is entity-decoded then fully
//      re-escaped on output, so any smuggling attempt (parse differentials,
//      unquoted `>` in attributes, encoded payloads) degrades to inert text.
//   4. `href`/`xlink:href` survive only as internal `#fragment` references;
//      `style` attributes survive without @import/expression/url().
//
// The output therefore can only contain: allowlisted tags, escaped
// allowlisted attributes, and escaped text — no `<` is ever emitted from
// input text, so the document cannot be re-broken by its own content.
// ==========================================================================

/** Elements an external renderer may contribute to a report figure. */
const ALLOWED_TAGS = new Set([
  // structure
  'svg', 'g', 'defs', 'symbol', 'use', 'switch', 'title', 'desc', 'metadata',
  // shapes
  'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon',
  // text
  'text', 'tspan', 'textPath',
  // paint servers / clipping
  'marker', 'lineargradient', 'radialgradient', 'stop', 'pattern',
  'clippath', 'mask',
  // filters (inert presentation primitives)
  'filter',
  'feblend', 'fecolormatrix', 'fecomponenttransfer', 'fecomposite',
  'feconvolvematrix', 'fediffuselighting', 'fedisplacementmap',
  'fedistantlight', 'fedropshadow', 'feflood', 'fefunca', 'fefuncb',
  'fefuncg', 'fefuncr', 'fegaussianblur', 'feimage', 'femerge',
  'femergenode', 'femorphology', 'feoffset', 'fepointlight',
  'fespecularlighting', 'fespotlight', 'fetile', 'feturbulence',
  // links (href is validated to be a #fragment)
  'a',
]);

/** Raw-text elements dropped together with their content. */
const DROP_WITH_CONTENT = new Set([
  'script', 'style', 'foreignobject', 'image', 'iframe', 'embed', 'object',
]);

/** Attributes any allowlisted element may carry. href/src are further
 *  constrained to #fragment values, style to inert CSS (see emitTag). */
const ALLOWED_ATTRS = new Set([
  // identity & namespace plumbing
  'id', 'class', 'xmlns', 'xmlns:xlink', 'version',
  // references & styling (special-cased in emitTag)
  'href', 'xlink:href', 'src', 'style',
  // geometry
  'x', 'y', 'x1', 'x2', 'y1', 'y2', 'cx', 'cy', 'r', 'rx', 'ry',
  'width', 'height', 'd', 'points', 'dx', 'dy', 'offset',
  'viewbox', 'preserveaspectratio',
  // transforms & paint
  'transform', 'transform-origin',
  'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width',
  'stroke-opacity', 'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray',
  'stroke-dashoffset', 'stroke-miterlimit', 'opacity', 'color',
  'stop-color', 'stop-opacity', 'flood-color', 'flood-opacity',
  'lighting-color', 'paint-order', 'shape-rendering', 'vector-effect',
  'display', 'visibility',
  // gradients / patterns / clips / markers
  'gradientunits', 'gradienttransform', 'spreadmethod',
  'patternunits', 'patterncontentunits', 'patterntransform',
  'clippathunits', 'clip-rule', 'maskunits', 'maskcontentunits',
  'markerunits', 'markerwidth', 'markerheight', 'refx', 'refy', 'orient',
  // filters
  'filterunits', 'primitiveunits', 'in', 'in2', 'result', 'values', 'type',
  'operator', 'k1', 'k2', 'k3', 'k4', 'stddeviation', 'numoctaves',
  'basefrequency', 'seed', 'stitchtiles', 'tablevalues', 'intercept',
  'slope', 'amplitude', 'exponent', 'azimuth', 'elevation', 'pointsatx',
  'pointsaty', 'pointsatz', 'specularconstant', 'specularexponent',
  'limitingconeangle', 'mode', 'radius', 'edgemode', 'order',
  'kernelmatrix', 'kernelunitlength', 'preservealpha', 'diffuseconstant',
  'surfacescale', 'xchannelselector', 'ychannelselector',
  // text
  'font-family', 'font-size', 'font-weight', 'font-style',
  'text-anchor', 'dominant-baseline', 'alignment-baseline',
  'letter-spacing', 'word-spacing', 'text-decoration',
  'textlength', 'lengthadjust', 'startoffset', 'writing-mode',
]);

/** Reference attributes — the value must be a pure internal fragment. */
const REF_ATTRS = new Set(['href', 'xlink:href', 'src']);

const ENTITY_MAP: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0',
};

function codePointToChar(cp: number): string {
  if (!Number.isFinite(cp) || cp < 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) {
    return '\uFFFD';
  }
  return String.fromCodePoint(cp);
}

function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, h: string) => codePointToChar(Number.parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_m, d: string) => codePointToChar(Number.parseInt(d, 10)))
    .replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (_m, name: string) => ENTITY_MAP[name] ?? _m);
}

function escapeXml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      default: return '&#39;';
    }
  });
}

/** Internal references only: url(#frag); anything reaching outside is dropped. */
function hasExternalUrlRef(value: string): boolean {
  return /url\s*\(\s*['"]?\s*(?!#)/i.test(value);
}

/** CSS that may only style — no imports, no bindings, no url() fetches. */
function safeStyleValue(value: string): string | null {
  const decoded = decodeEntities(value);
  if (/@import|expression\s*\(|-moz-binding|javascript\s*:/i.test(decoded)) return null;
  if (/url\s*\(/i.test(decoded)) return null;
  return decoded;
}

interface ParsedAttr {
  name: string;
  value: string | null;
}

function parseAttrs(raw: string): ParsedAttr[] {
  const out: ParsedAttr[] = [];
  const re = /([a-zA-Z_:][a-zA-Z0-9_:.-]*)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  for (const m of raw.matchAll(re)) {
    const name = m[1]?.toLowerCase() ?? '';
    const value = m[2] ?? m[3] ?? m[4] ?? null;
    out.push({ name, value });
  }
  return out;
}

/** Canonical camelCase spellings (SVG names are case-sensitive in XML and
 *  the HTML parser only auto-fixes a subset). */
const TAG_CANONICAL: Record<string, string> = {
  clippath: 'clipPath',
  lineargradient: 'linearGradient',
  radialgradient: 'radialGradient',
  textpath: 'textPath',
  feblend: 'feBlend',
  fecolormatrix: 'feColorMatrix',
  fecomponenttransfer: 'feComponentTransfer',
  fecomposite: 'feComposite',
  feconvolvematrix: 'feConvolveMatrix',
  fediffuselighting: 'feDiffuseLighting',
  fedisplacementmap: 'feDisplacementMap',
  fedistantlight: 'feDistantLight',
  fedropshadow: 'feDropShadow',
  feflood: 'feFlood',
  fefunca: 'feFuncA',
  fefuncb: 'feFuncB',
  fefuncg: 'feFuncG',
  fefuncr: 'feFuncR',
  fegaussianblur: 'feGaussianBlur',
  feimage: 'feImage',
  femerge: 'feMerge',
  femergenode: 'feMergeNode',
  femorphology: 'feMorphology',
  feoffset: 'feOffset',
  fepointlight: 'fePointLight',
  fespecularlighting: 'feSpecularLighting',
  fespotlight: 'feSpotLight',
  fetile: 'feTile',
  feturbulence: 'feTurbulence',
};

const ATTR_CANONICAL: Record<string, string> = {
  viewbox: 'viewBox',
  preserveaspectratio: 'preserveAspectRatio',
  gradientunits: 'gradientUnits',
  gradienttransform: 'gradientTransform',
  patternunits: 'patternUnits',
  patterncontentunits: 'patternContentUnits',
  patterntransform: 'patternTransform',
  clippathunits: 'clipPathUnits',
  maskunits: 'maskUnits',
  maskcontentunits: 'maskContentUnits',
  markerunits: 'markerUnits',
  markerwidth: 'markerWidth',
  markerheight: 'markerHeight',
  refx: 'refX',
  refy: 'refY',
  filterunits: 'filterUnits',
  primitiveunits: 'primitiveUnits',
  stddeviation: 'stdDeviation',
  numoctaves: 'numOctaves',
  basefrequency: 'baseFrequency',
  stitchtiles: 'stitchTiles',
  tablevalues: 'tableValues',
  limitingconeangle: 'limitingConeAngle',
  specularconstant: 'specularConstant',
  specularExponent: 'specularExponent',
  diffuseconstant: 'diffuseConstant',
  surfacescale: 'surfaceScale',
  xchannelselector: 'xChannelSelector',
  ychannelselector: 'yChannelSelector',
  kernelmatrix: 'kernelMatrix',
  kernelunitlength: 'kernelUnitLength',
  preservealpha: 'preserveAlpha',
  edgemode: 'edgeMode',
  textlength: 'textLength',
  lengthadjust: 'lengthAdjust',
  startoffset: 'startOffset',
  'xmlns:xlink': 'xmlns:xlink',
  'xlink:href': 'xlink:href',
};

/**
 * Whether the tag's attribute tail ends in an UNQUOTED `/` (self-closing),
 * and the attribute string without it. Quoted values may contain `/`, so a
 * trailing `/` only counts when it sits outside any quotes.
 */
function splitSelfClose(attrRaw: string): [attrs: string, selfClose: boolean] {
  let quote: string | null = null;
  for (let k = attrRaw.length - 1; k >= 0; k -= 1) {
    const ch = attrRaw[k]!;
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '/') return [attrRaw.slice(0, k), true];
    if (!/\s/.test(ch)) return [attrRaw, false];
  }
  return [attrRaw, false];
}

/**
 * Sanitize untrusted SVG markup down to an inert allowlisted subset.
 * Never throws; input that cannot be understood is dropped, not passed
 * through. Pure: the input string is never mutated.
 */
export function sanitizeSvg(svg: string): string {
  let out = '';
  let i = 0;
  const n = svg.length;
  // One combined scanner: comments/CDATA/doctype/PI and tags are consumed
  // structurally; everything between them is text (escaped on emit).
  const tokenRe =
    /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<\?[\s\S]*?\?>|<![^>]*>|<(\/?)([a-zA-Z][a-zA-Z0-9:._-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g;
  let m: RegExpExecArray | null;
  while ((m = tokenRe.exec(svg)) !== null) {
    if (m.index > i) out += escapeXml(decodeEntities(svg.slice(i, m.index)));
    i = tokenRe.lastIndex;
    const full = m[0];
    if (full.startsWith('<!--')) continue; // comment — dropped
    if (full.startsWith('<![CDATA[')) {
      out += escapeXml(decodeEntities(m[1] ?? ''));
      continue;
    }
    if (full.startsWith('<!') || full.startsWith('<?')) continue; // doctype / PI
    // Groups: 1 = CDATA body, 2 = closing slash, 3 = tag name, 4 = attrs.
    const name = (m[3] ?? '').toLowerCase();
    if (full.startsWith('</')) {
      // Closing tags: re-emit only for allowlisted elements.
      if (ALLOWED_TAGS.has(name)) out += `</${TAG_CANONICAL[name] ?? name}>`;
      continue;
    }
    const [attrRaw, selfClose] = splitSelfClose(m[4] ?? '');
    if (DROP_WITH_CONTENT.has(name)) {
      // Drop the whole raw-text element: skip to its real closing tag.
      const close = new RegExp(`</${name}\\s*>`, 'i').exec(svg.slice(i));
      if (close) {
        i += close.index + close[0].length;
        tokenRe.lastIndex = i;
      } else {
        return out; // unterminated raw element — nothing after it can be trusted
      }
      continue;
    }
    if (!ALLOWED_TAGS.has(name)) continue; // unknown tag — dropped, children still processed
    out += emitTag(name, attrRaw, selfClose);
  }
  if (i < n) out += escapeXml(decodeEntities(svg.slice(i)));
  return out;
}

function emitTag(name: string, attrRaw: string, selfClose: boolean): string {
  const canonical = TAG_CANONICAL[name] ?? name;
  const parts: string[] = [];
  for (const attr of parseAttrs(attrRaw)) {
    if (!ALLOWED_ATTRS.has(attr.name)) continue;
    let emitted: string | null = null;
    if (REF_ATTRS.has(attr.name)) {
      const value = attr.value === null ? '' : decodeEntities(attr.value).trim();
      if (value.startsWith('#') && !value.includes('\0')) emitted = value;
    } else if (attr.name === 'style') {
      const value = attr.value === null ? null : safeStyleValue(attr.value);
      if (value) emitted = value;
    } else if (attr.value !== null) {
      const value = decodeEntities(attr.value);
      if (!hasExternalUrlRef(value)) emitted = value;
    }
    if (emitted !== null) {
      parts.push(`${ATTR_CANONICAL[attr.name] ?? attr.name}="${escapeXml(emitted)}"`);
    }
  }
  const attrs = parts.length > 0 ? ` ${parts.join(' ')}` : '';
  return `<${canonical}${attrs}${selfClose ? '/' : ''}>`;
}
