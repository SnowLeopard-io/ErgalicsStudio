import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { Link } from 'react-router-dom';
import { useT } from '../i18n-react';
import { studioUrl } from '../studio-link';
import { GALLERY } from '../data/gallery';
import { CoverArt } from '../components/CoverArt';
import { pickLocal } from '../i18n';
import modeStandardShot from '../../../docs/assets/screenshots/platform/mode-standard-welcome.png';
import modeFlowShot from '../../../docs/assets/screenshots/platform/mode-flow.png';
import modeBlockShot from '../../../docs/assets/screenshots/platform/mode-block.png';
import modeCodeShot from '../../../docs/assets/screenshots/platform/mode-code.png';

const MODES = ['standard', 'flow', 'blocks', 'code'] as const;
type ModeId = (typeof MODES)[number];

/** Real product screenshots (docs/assets) shown in each mode panel. */
const MODE_SHOTS: Record<ModeId, string> = {
  standard: modeStandardShot,
  flow: modeFlowShot,
  blocks: modeBlockShot,
  code: modeCodeShot,
};

/** 26 built-in research tools in six groups — names mirrored from the
 *  workstation's src/pages/research/toolRegistry.ts (single source of truth)
 *  and its i18n dicts. Group counts: 2 + 4 + 6 + 3 + 5 + 6 = 26. */
const TOOL_GROUPS: { id: string; count: string; tools: string[] }[] = [
  { id: 'measure', count: '02', tools: ['uncertainty', 'profiler'] },
  { id: 'model', count: '04', tools: ['model-lab', 'inference', 'model-inference', 'sweeps'] },
  { id: 'data', count: '06', tools: ['sql', 'lineage', 'figures', 'analysis', 'cleaning', 'files'] },
  { id: 'signal', count: '03', tools: ['signal', 'notebook', 'runs'] },
  { id: 'deliver', count: '05', tools: ['report', 'reprolock', 'supplement', 'course', 'gallery'] },
  { id: 'utils', count: '06', tools: ['unit-convert', 'calc', 'format-convert', 'sigfig', 'molar-mass', 'quick-stats'] },
];

const FORMATS = ['CSV', 'JSON', 'HDF5', 'NetCDF', 'FITS', 'Zarr', 'Parquet'];

const REPRO_STEPS = ['s1', 's2', 's3'] as const;

/** Hand-drawn per-mode schematic. Neutral strokes follow currentColor; teal
 *  marks only the one "live" element of each mode. */
function ModeArt({ mode }: { mode: ModeId }) {
  const T = 'var(--color-text-tertiary)';
  const A = 'var(--color-accent)';
  switch (mode) {
    case 'standard':
      return (
        <svg viewBox="0 0 320 180" fill="none" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="98" y="26" width="204" height="130" rx="10" stroke="currentColor" strokeDasharray="5 6" />
          <path d="M118 134 V56 M118 134 H286" stroke={T} />
          <rect x="134" y="96" width="14" height="38" rx="2" fill="currentColor" opacity="0.25" stroke="none" />
          <rect x="158" y="84" width="14" height="50" rx="2" fill="currentColor" opacity="0.25" stroke="none" />
          <rect x="182" y="104" width="14" height="30" rx="2" fill="currentColor" opacity="0.25" stroke="none" />
          <rect x="206" y="72" width="14" height="62" rx="2" fill="currentColor" opacity="0.25" stroke="none" />
          <path d="M136 96 C 162 88 176 60 202 66 S 252 84 278 52" stroke={A} strokeWidth="2" />
          <circle cx="202" cy="66" r="3" fill={A} stroke="none" />
          <rect x="16" y="48" width="54" height="70" rx="7" stroke="currentColor" />
          <path d="M52 48 v16 h18" stroke="currentColor" />
          <path d="M26 78 h30 M26 90 h30 M26 102 h20" stroke={T} />
          <path d="M78 83 H 92" stroke={A} />
          <path d="M87 78 l7 5 -7 5" stroke={A} />
          <path d="M80 66 h8 M80 100 h8" stroke={T} strokeDasharray="2 4" />
        </svg>
      );
    case 'flow':
      return (
        <svg viewBox="0 0 320 180" fill="none" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="14" y="58" width="48" height="32" rx="7" stroke="currentColor" />
          <path d="M24 70 h26 M24 80 h16" stroke={T} />
          <rect x="92" y="58" width="48" height="32" rx="7" stroke="currentColor" />
          <path d="M102 70 h26 M102 80 h16" stroke={T} />
          <rect x="170" y="58" width="48" height="32" rx="7" stroke={A} fill="var(--color-accent-soft)" />
          <path d="M180 70 h26 M180 80 h18" stroke={A} />
          <rect x="248" y="58" width="48" height="32" rx="7" stroke="currentColor" />
          <path d="M258 70 h26 M258 80 h16" stroke={T} />
          <path d="M62 74 H 88 M84 70 l6 4 -6 4" stroke="currentColor" />
          <path d="M140 74 H 166 M162 70 l6 4 -6 4" stroke="currentColor" />
          <path d="M218 74 H 244 M240 70 l6 4 -6 4" stroke="currentColor" />
          <path d="M272 90 V 108" stroke={T} strokeDasharray="3 4" />
          <rect x="238" y="112" width="72" height="46" rx="7" stroke="currentColor" />
          <path d="M246 148 L262 128 L276 138 L300 120" stroke={A} strokeWidth="2" />
          <path d="M14 132 h34 M14 142 h24" stroke={T} strokeDasharray="2 4" />
        </svg>
      );
    case 'blocks':
      return (
        <svg viewBox="0 0 320 180" fill="none" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="18" y="34" width="96" height="30" rx="7" stroke="currentColor" />
          <path d="M30 49 h48" stroke={T} />
          <path d="M114 44 a6 6 0 0 1 0 10" stroke="currentColor" />
          <rect x="18" y="74" width="96" height="30" rx="7" stroke="currentColor" />
          <path d="M30 89 h56" stroke={T} />
          <path d="M114 84 a6 6 0 0 1 0 10" stroke="currentColor" />
          <rect x="18" y="114" width="96" height="30" rx="7" stroke={A} fill="var(--color-accent-soft)" />
          <path d="M32 129 h52" stroke={A} />
          <path d="M114 124 a6 6 0 0 1 0 10" stroke={A} />
          <path d="M126 129 C 156 129 152 98 176 98" stroke={T} strokeDasharray="3 4" />
          <rect x="178" y="52" width="120" height="92" rx="9" stroke="currentColor" />
          <circle cx="191" cy="63" r="2.5" fill={T} stroke="none" />
          <circle cx="201" cy="63" r="2.5" fill={T} stroke="none" />
          <circle cx="211" cy="63" r="2.5" fill={T} stroke="none" />
          <path d="M178 72 h120" stroke="currentColor" opacity="0.45" />
          <path d="M192 86 h56 M192 100 h72" stroke={T} />
          <path d="M192 116 h64" stroke={A} />
          <rect x="260" y="110" width="7" height="11" fill={A} stroke="none" />
        </svg>
      );
    case 'code':
      return (
        <svg viewBox="0 0 320 180" fill="none" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="42" y="28" width="236" height="126" rx="10" stroke="currentColor" />
          <path d="M42 50 h236" stroke="currentColor" opacity="0.45" />
          <circle cx="56" cy="39" r="3" fill={T} stroke="none" />
          <circle cx="68" cy="39" r="3" fill={T} stroke="none" />
          <circle cx="80" cy="39" r="3" fill={T} stroke="none" />
          <path d="M58 66 l8 6 -8 6" stroke={T} />
          <path d="M74 72 h84" stroke="currentColor" />
          <path d="M58 92 l8 6 -8 6" stroke={T} />
          <path d="M74 98 h44" stroke={A} strokeWidth="2" />
          <path d="M124 98 h60" stroke="currentColor" />
          <path d="M58 118 l8 6 -8 6" stroke={T} />
          <rect x="74" y="122" width="9" height="12" fill={A} stroke="none" />
          <rect x="186" y="84" width="80" height="52" rx="6" stroke={T} strokeDasharray="3 4" />
          <path d="M194 126 L212 104 L228 116 L258 92" stroke={A} strokeWidth="1.8" />
        </svg>
      );
  }
}

const varI = (i: number) => ({ '--i': i }) as CSSProperties;

export function Home() {
  const t = useT();
  const rootRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<Partial<Record<ModeId, HTMLButtonElement | null>>>({});
  const [mode, setMode] = useState<ModeId>('standard');
  const featured = GALLERY.slice(0, 4);

  // Scroll reveal. Fail-open by construction: the initial hidden state only
  // applies under `.home--animated` (added here, i.e. only with JS) and under
  // `prefers-reduced-motion: no-preference`. Without JS everything is visible.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    root.classList.add('home--animated');
    const els = root.querySelectorAll('.reveal');
    if (typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const en of entries) {
          if (en.isIntersecting) {
            en.target.classList.add('in');
            io.unobserve(en.target);
          }
        }
      },
      { threshold: 0.12, rootMargin: '0px 0px -32px 0px' },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  function onTabKey(e: KeyboardEvent<HTMLButtonElement>, id: ModeId) {
    const idx = MODES.indexOf(id);
    let next: number | null = null;
    if (e.key === 'ArrowRight') next = (idx + 1) % MODES.length;
    else if (e.key === 'ArrowLeft') next = (idx + MODES.length - 1) % MODES.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = MODES.length - 1;
    if (next === null) return;
    e.preventDefault();
    const m = MODES[next];
    setMode(m);
    tabRefs.current[m]?.focus();
  }

  return (
    <div className="home" ref={rootRef}>
      {/* 1 — hero: claim + evidence strip + live console */}
      <section className="hero" aria-labelledby="hero-title">
        <div className="hero-inner">
          <span className="hero-badge reveal">{t('hero.badge')}</span>
          <h1 className="hero-title reveal" id="hero-title">
            {t('hero.title.a')}
            <br />
            <span className="hero-title-hl">{t('hero.title.b')}</span>
          </h1>
          <p className="hero-desc reveal">{t('hero.desc')}</p>
          <div className="hero-actions reveal">
            <a href={studioUrl('/')} className="btn btn-primary btn-lg">{t('hero.cta')}</a>
            <Link to="/gallery" className="btn btn-ghost btn-lg">{t('hero.cta2')}</Link>
          </div>
          <dl className="hero-stats reveal">
            <div className="hs"><dt className="hs-label">{t('stats.tools')}</dt><dd className="hs-num">26</dd></div>
            <div className="hs"><dt className="hs-label">{t('stats.modes')}</dt><dd className="hs-num">4</dd></div>
            <div className="hs"><dt className="hs-label">{t('stats.blocks')}</dt><dd className="hs-num">38</dd></div>
            <div className="hs"><dt className="hs-label">{t('stats.tests')}</dt><dd className="hs-num">2815</dd></div>
          </dl>
        </div>
        <div className="hero-art reveal" aria-hidden="true">
          <div className="console">
            <div className="console-bar"><i /><i /><i /></div>
            <div className="console-body">
              <div className="console-lines">
                <span className="cl" style={varI(0)}><span className="cl-cl">studio</span><span className="cl-fn">.load</span>(<span className="cl-str">&quot;measurements.h5&quot;</span>)</span>
                <span className="cl" style={varI(1)}><span className="cl-cl">studio</span><span className="cl-fn">.ttest</span>(a, b)&nbsp;&nbsp;<span className="cl-cm"># t(28)=2.31, p=.028</span></span>
                <span className="cl" style={varI(2)}><span className="cl-cl">studio</span><span className="cl-fn">.plot</span>(<span className="cl-str">&quot;scatter&quot;</span>, x, y)</span>
                <span className="cl" style={varI(3)}><span className="cl-cl">studio</span><span className="cl-fn">.repro</span>.<span className="cl-fn">lock</span>()&nbsp;<span className="cl-cm"># ✓ locked</span></span>
              </div>
              <svg viewBox="0 0 200 80" className="console-plot">
                <path className="draw" d="M5 60 C 40 55, 55 20, 90 30 S 150 60, 195 15" fill="none" stroke="var(--color-accent)" strokeWidth="2" />
                <path className="draw2" d="M5 68 C 45 62, 60 40, 95 44 S 155 66, 195 30" fill="none" stroke="var(--cat-fun)" strokeWidth="1.4" opacity="0.7" />
                <circle cx="90" cy="30" r="3" fill="var(--color-accent)" />
              </svg>
            </div>
          </div>
        </div>
      </section>

      {/* 2 — four work modes (keyboard-accessible tabs) */}
      <section className="modes" aria-labelledby="modes-title">
        <div className="section-head reveal">
          <h2 className="section-title" id="modes-title">{t('modes.title')}</h2>
          <p className="section-desc">{t('modes.desc')}</p>
        </div>
        <div className="tabs reveal">
          <div className="tablist" role="tablist" aria-label={t('modes.title')}>
            {MODES.map((m) => (
              <button
                key={m}
                ref={(el) => { tabRefs.current[m] = el; }}
                type="button"
                role="tab"
                id={`tab-${m}`}
                aria-selected={mode === m}
                aria-controls={`panel-${m}`}
                tabIndex={mode === m ? 0 : -1}
                className={`mode-tab${mode === m ? ' active' : ''}`}
                onClick={() => setMode(m)}
                onKeyDown={(e) => onTabKey(e, m)}
              >
                <span className="mode-glyph" aria-hidden="true"><ModeArt mode={m} /></span>
                <span className="mode-tab-label">{t(`modes.${m}.tab`)}</span>
              </button>
            ))}
          </div>
          {MODES.map((m) => (
            <div
              key={m}
              role="tabpanel"
              id={`panel-${m}`}
              aria-labelledby={`tab-${m}`}
              hidden={mode !== m}
              className="mode-panel"
            >
              <div className="mode-art" aria-hidden="true">
                {mode === m && (
                  <img src={MODE_SHOTS[m]} alt="" loading="lazy" decoding="async" />
                )}
              </div>
              <p className="mode-desc">{t(`modes.${m}.desc`)}</p>
            </div>
          ))}
        </div>
      </section>

      {/* 3 — research toolbelt: 26 tools in six groups */}
      <section className="toolbelt" aria-labelledby="toolbelt-title">
        <div className="section-head reveal">
          <h2 className="section-title" id="toolbelt-title">{t('toolbelt.title')}</h2>
          <p className="section-desc">{t('toolbelt.desc')}</p>
        </div>
        <div className="tb-list reveal">
          {TOOL_GROUPS.map((g) => (
            <div key={g.id} className="tb-row">
              <h3 className="tb-group">
                {t(`toolbelt.g.${g.id}`)}
                <span className="tb-count" aria-hidden="true">{g.count}</span>
              </h3>
              <p className="tb-tools">
                {g.tools.map((toolId, i) => (
                  <span key={toolId}>
                    {i > 0 && <span className="tb-sep" aria-hidden="true">·</span>}
                    {t(`toolbelt.tool.${toolId}`)}
                  </span>
                ))}
              </p>
            </div>
          ))}
        </div>
        <Link to="/plugins" className="tb-more reveal">{t('toolbelt.more')} →</Link>
      </section>

      {/* 4 — kernels & runtimes: spec-sheet split */}
      <section className="kernel" aria-labelledby="kernel-title">
        <div className="section-head reveal">
          <h2 className="section-title" id="kernel-title">{t('kernel.title')}</h2>
          <p className="section-desc">{t('kernel.desc')}</p>
        </div>
        <div className="spec reveal">
          <div className="spec-kernel">
            <div className="spec-big">
              <span className="spec-num">14</span>
              <span className="spec-unit">WGSL</span>
            </div>
            <h3 className="spec-k">{t('kernel.wgsl.t')}</h3>
            <p className="spec-d">{t('kernel.wgsl.d')}</p>
          </div>
          <div className="spec-rt">
            <h3 className="spec-k">{t('kernel.rt.t')}</h3>
            <ul className="rt-list">
              <li><span className="rt-name">CPython (Pyodide)</span><span className="rt-d">{t('kernel.rt.py')}</span></li>
              <li><span className="rt-name">webR 0.6.0</span><span className="rt-d">{t('kernel.rt.r')}</span></li>
              <li><span className="rt-name">DuckDB-WASM</span><span className="rt-d">{t('kernel.rt.sql')}</span></li>
            </ul>
            <div className="fmt">
              <span className="fmt-t">{t('kernel.fmt.t')}</span>
              <ul className="fmt-tags">
                {FORMATS.map((f) => <li key={f}><code>{f}</code></li>)}
              </ul>
              <p className="fmt-d">{t('kernel.fmt.d')}</p>
            </div>
          </div>
        </div>
      </section>

      {/* 5 — reproducibility: three-step band */}
      <section className="repro" aria-labelledby="repro-title">
        <div className="section-head reveal">
          <h2 className="section-title" id="repro-title">{t('repro.title')}</h2>
          <p className="section-desc">{t('repro.desc')}</p>
        </div>
        <ol className="repro-steps">
          {REPRO_STEPS.map((s, i) => (
            <li key={s} className="repro-step reveal">
              <span className="rs-num" aria-hidden="true">0{i + 1}</span>
              <h3 className="rs-t">{t(`repro.${s}.t`)}</h3>
              <p className="rs-d">{t(`repro.${s}.d`)}</p>
            </li>
          ))}
        </ol>
        <p className="repro-gate reveal">{t('repro.gate')}</p>
      </section>

      {/* 6 — gallery excerpt */}
      <section className="showcase" aria-labelledby="showcase-title">
        <div className="featured-head reveal">
          <h2 className="section-title" id="showcase-title">{t('gallery.title')}</h2>
          <Link to="/gallery" className="btn btn-ghost">{t('hero.cta2')} →</Link>
        </div>
        <div className="gallery-grid gallery-grid-4">
          {featured.map((g) => (
            <Link key={g.id} to="/gallery" className="gallery-card">
              <CoverArt seed={g.seed} chartType={g.chartType} />
              <div className="card-body">
                <div className="card-tags">
                  <span className="tag">{g.subject}</span>
                  <span className="tag chart">{g.chartType}</span>
                </div>
                <h3>{pickLocal(g.title)}</h3>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* 7 — closing CTA */}
      <section className="closing" aria-labelledby="closing-title">
        <div className="closing-inner reveal">
          <p className="closing-note">{t('closing.note')}</p>
          <h2 className="closing-title" id="closing-title">{t('closing.title')}</h2>
          <div className="hero-actions">
            <a href={studioUrl('/')} className="btn btn-primary btn-lg">{t('hero.cta')}</a>
            <Link to="/gallery" className="btn btn-ghost btn-lg">{t('hero.cta2')}</Link>
          </div>
        </div>
      </section>
    </div>
  );
}
