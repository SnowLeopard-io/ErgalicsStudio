// ==========================================================================
// Allowlist SVG sanitizer (issue #25) — pure node, no DOM required.
//
// Covers the seven bypass vectors from the issue, quote/parse-differential
// smuggling, internal-reference handling and passthrough fidelity for the
// figures the plot engine itself renders.
// ==========================================================================

import { describe, expect, it } from 'vitest';
import { sanitizeSvg } from '@/core/sanitize/sanitizeSvg';

const CHART_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">' +
  '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="0">' +
  '<stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#000"/>' +
  '</linearGradient></defs>' +
  '<rect x="1" y="1" width="8" height="8" fill="url(#g)" stroke="#333"/>' +
  '<circle cx="5" cy="5" r="4"/>' +
  '<path d="M0 5 L10 5" stroke-dasharray="2,2"/>' +
  '<text x="5" y="9" text-anchor="middle" font-size="3">a &lt; b &amp; c</text>' +
  '</svg>';

describe('sanitizeSvg — issue #25 bypass vectors', () => {
  it('strips unquoted event handlers', () => {
    const out = sanitizeSvg('<svg onload=alert(document.domain)><circle r="2"/></svg>');
    expect(out).not.toContain('onload');
    expect(out).not.toContain('alert');
    expect(out).toContain('<circle r="2"/>');
  });

  it('strips quoted event handlers and javascript: hrefs', () => {
    const out = sanitizeSvg(
      '<svg><a href="javascript:alert(1)"><text>click</text></a></svg>',
    );
    expect(out).not.toContain('javascript:');
    expect(out).toContain('<text>click</text>');
  });

  it('drops foreignObject with its whole content', () => {
    const out = sanitizeSvg(
      '<svg><foreignObject><iframe src="javascript:alert(1)"></iframe></foreignObject></svg>',
    );
    expect(out).not.toContain('foreignObject');
    expect(out).not.toContain('iframe');
    expect(out).not.toContain('javascript:');
  });

  it('drops unquoted onerror inside foreignObject', () => {
    const out = sanitizeSvg(
      '<svg><foreignObject><img src=x onerror=alert(1)></foreignObject></svg>',
    );
    expect(out).not.toContain('img');
    expect(out).not.toContain('onerror');
    expect(out).not.toContain('alert');
  });

  it('drops SMIL animation that retargets href / event handlers', () => {
    const out = sanitizeSvg(
      '<svg><animate attributeName="href" values="javascript:alert(1)"/><a><text>x</text></a></svg>' +
        '<svg><set attributeName="onmouseover" to="alert(1)"/><rect width="1" height="1"/></svg>',
    );
    expect(out).not.toContain('animate');
    expect(out).not.toContain('<set');
    expect(out).not.toContain('onmouseover');
    expect(out).not.toContain('javascript:');
    expect(out).toContain('<rect width="1"');
  });

  it('drops style elements with @import', () => {
    const out = sanitizeSvg('<svg><style>@import url("https://evil.example/x.css");</style></svg>');
    expect(out).not.toContain('@import');
    expect(out).not.toContain('evil.example');
  });
});

describe('sanitizeSvg — smuggling attempts', () => {
  it('neutralizes a quoted ">" breaking out of an attribute into markup', () => {
    const out = sanitizeSvg(
      '<svg><a title="\\"><img src=x onerror=alert(1)>">click</a></svg>',
    );
    expect(out).not.toContain('<img');
    expect(out).not.toContain('onerror');
    expect(out).not.toContain('alert');
  });

  it('does not let encoded payloads re-form tags in text', () => {
    const out = sanitizeSvg('<svg><text>&lt;script&gt;alert(1)&lt;/script&gt;</text></svg>');
    expect(out).not.toContain('<script');
    expect(out).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('rejects entity-encoded javascript: hrefs', () => {
    const out = sanitizeSvg('<svg><a href="&#106;avascript:alert(1)"><text>x</text></a></svg>');
    expect(out).not.toContain('avascript');
  });

  it('drops external url() paint references but keeps internal ones', () => {
    const out = sanitizeSvg(
      '<svg><rect fill="url(http://evil.example/x)" width="2" height="2"/>' +
        '<rect fill="url(#grad)" width="2" height="2"/></svg>',
    );
    expect(out).not.toContain('evil.example');
    expect(out).toContain('url(#grad)');
  });

  it('drops use elements referencing outside resources', () => {
    const out = sanitizeSvg(
      '<svg><use href="https://evil.example/x.svg#p"/><use href="#local"/></svg>',
    );
    expect(out).not.toContain('evil.example');
    expect(out).toContain('href="#local"');
  });

  it('drops doctypes, comments and processing instructions', () => {
    const out = sanitizeSvg(
      '<!DOCTYPE svg [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><!-- secret --><?xml-stylesheet href="evil.css"?><svg><circle r="1"/></svg>',
    );
    expect(out).not.toContain('DOCTYPE');
    expect(out).not.toContain('xxe');
    expect(out).not.toContain('secret');
    expect(out).not.toContain('xml-stylesheet');
    expect(out).toContain('<circle r="1"/>');
  });

  it('is idempotent', () => {
    const once = sanitizeSvg(
      '<svg onload=alert(1)><style>x</style><g><text>p=0.031</text><circle r="1"/></g></svg>',
    );
    expect(sanitizeSvg(once)).toBe(once);
  });
});

describe('sanitizeSvg — legitimate markup survives', () => {
  it('keeps the plot engine figure byte-equivalent in structure', () => {
    const out = sanitizeSvg(CHART_SVG);
    expect(out).toContain('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">');
    expect(out).toContain('<linearGradient id="g"');
    expect(out).toContain('<stop offset="0" stop-color="#fff"/>');
    expect(out).toContain('fill="url(#g)"');
    expect(out).toContain('<circle cx="5" cy="5" r="4"/>');
    expect(out).toContain('<path d="M0 5 L10 5" stroke-dasharray="2,2"/>');
    expect(out).toContain('<text x="5" y="9" text-anchor="middle" font-size="3">a &lt; b &amp; c</text>');
    expect(out.endsWith('</svg>')).toBe(true);
  });

  it('keeps a style attribute that only styles', () => {
    const out = sanitizeSvg('<svg><rect style="fill: none; stroke: #333" width="2" height="2"/></svg>');
    expect(out).toContain('style="fill: none; stroke: #333"');
  });

  it('keeps class attributes and self-closing shapes', () => {
    const out = sanitizeSvg('<svg><g class="series"><line x1="0" y1="0" x2="1" y2="1"/></g></svg>');
    expect(out).toBe('<svg><g class="series"><line x1="0" y1="0" x2="1" y2="1"/></g></svg>');
  });
});
