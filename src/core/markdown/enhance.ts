// ==========================================================================
// Ergalics Studio — markdown DOM enhancement (mermaid + KaTeX)
//
// Upgrades the placeholder nodes emitted by mdToHtml() in place:
//   <div class="md-mermaid" data-mermaid="…">  → rendered SVG diagram
//   <span class="md-tex"    data-tex="…">      → KaTeX typeset math
// Both libraries are dynamically imported so the first plain-markdown render
// never pays their bundle cost, and both ship their assets locally (npm) —
// fully offline, no CDN.
// ==========================================================================

// KaTeX fonts + CSS are bundled by Vite from the npm package (offline safe).
// A side-effect import: loaded once when this module is first used.
import 'katex/dist/katex.min.css';

type MermaidApi = (typeof import('mermaid'))['default'];

let mermaidPromise: Promise<MermaidApi> | null = null;
let mermaidThemeInited: 'dark' | 'light' | null = null;
let mermaidRenderSeq = 0;

function loadMermaid(): Promise<MermaidApi> {
  mermaidPromise ??= import('mermaid').then((m) => m.default);
  return mermaidPromise;
}

/**
 * Upgrade every md-mermaid / md-tex placeholder under `root`. Safe to call
 * repeatedly: upgraded nodes are marked with -done classes and skipped.
 * `dark` defaults to the current document theme (mermaid needs a re-init
 * when the theme flips so diagrams re-color accordingly).
 */
export async function enhanceMarkdownDom(root: HTMLElement, dark?: boolean): Promise<void> {
  // ---- KaTeX ---------------------------------------------------------------
  const texEls = Array.from(root.querySelectorAll<HTMLElement>('.md-tex[data-tex]'));
  if (texEls.length > 0) {
    try {
      const { default: katex } = await import('katex');
      for (const el of texEls) {
        if (el.classList.contains('md-tex-done')) continue;
        const tex = decodeURIComponent(el.dataset.tex ?? '');
        try {
          el.innerHTML = katex.renderToString(tex, {
            throwOnError: false,
            displayMode: el.dataset.display === '1',
          });
        } catch {
          // TeX syntax error — show the source instead of losing the cell.
          el.textContent = tex;
        }
        el.classList.add('md-tex-done');
      }
    } catch {
      // KaTeX failed to load (should not happen offline) — placeholders stay.
    }
  }

  // ---- Mermaid ---------------------------------------------------------------
  const mmEls = Array.from(root.querySelectorAll<HTMLElement>('.md-mermaid[data-mermaid]'));
  if (mmEls.length > 0) {
    try {
      const mermaid = await loadMermaid();
      const isDark = dark ?? document.documentElement.dataset.theme === 'dark';
      if (mermaidThemeInited !== (isDark ? 'dark' : 'light')) {
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          theme: isDark ? 'dark' : 'neutral',
        });
        mermaidThemeInited = isDark ? 'dark' : 'light';
      }
      for (const el of mmEls) {
        if (el.classList.contains('md-mermaid-done')) continue;
        const code = decodeURIComponent(el.dataset.mermaid ?? '');
        // Unique DOM id per render — mermaid uses it for the intermediate svg.
        const id = `md-mermaid-${(mermaidRenderSeq += 1).toString(36)}`;
        try {
          const { svg } = await mermaid.render(id, code);
          el.innerHTML = svg;
        } catch {
          // Syntax error in the diagram — fall back to the raw source.
          el.textContent = code;
          el.classList.add('md-mermaid-error');
        }
        el.classList.add('md-mermaid-done');
      }
    } catch {
      // Mermaid failed to load — placeholders stay as source text.
    }
  }
}
