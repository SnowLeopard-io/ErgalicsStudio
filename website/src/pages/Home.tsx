import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Link } from 'react-router-dom';
import { useT } from '../i18n-react';
import { docsUrl, studioUrl } from '../studio-link';
import { GALLERY } from '../data/gallery';
import { DISCIPLINES, FACTS } from '../data/facts';
import { CoverArt } from '../components/CoverArt';
import { BlackHole } from '../components/BlackHole';
import { Nebula } from '../components/Nebula';
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

/** 33 built-in research tools in seven groups — names mirrored from the
 *  workstation's src/pages/research/toolRegistry.ts (single source of truth)
 *  and its i18n dicts. Group counts: 2 + 4 + 9 + 3 + 5 + 4 + 6 = 33. */
const TOOL_GROUPS: { id: string; count: string; tools: string[] }[] = [
  { id: 'measure', count: '02', tools: ['uncertainty', 'profiler'] },
  { id: 'model', count: '04', tools: ['model-lab', 'inference', 'model-inference', 'sweeps'] },
  { id: 'data', count: '09', tools: ['sql', 'etl', 'schema', 'synth', 'lineage', 'figures', 'analysis', 'cleaning', 'files'] },
  { id: 'signal', count: '03', tools: ['signal', 'notebook', 'runs'] },
  { id: 'deliver', count: '05', tools: ['report', 'reprolock', 'supplement', 'course', 'gallery'] },
  { id: 'publish', count: '04', tools: ['latex-editor', 'citation-manager', 'collab-notebook', 'preprint'] },
  { id: 'utils', count: '06', tools: ['unit-convert', 'calc', 'format-convert', 'sigfig', 'molar-mass', 'quick-stats'] },
];

const CAPABILITY_ROWS = ['plugins', 'tools', 'flow', 'blocks', 'formats', 'runtimes', 'gpu', 'tests', 'samples'] as const;
const SCENARIOS = ['research', 'teaching', 'simulation', 'open'] as const;
const START_CARDS = ['s1', 's2', 's3', 's4'] as const;

const FORMATS = ['CSV', 'JSON', 'HDF5', 'NetCDF', 'FITS', 'Zarr', 'Parquet'];

const REPRO_STEPS = ['s1', 's2', 's3'] as const;

/** Hand-drawn per-mode schematic. Neutral strokes follow currentColor; the
 *  accent marks only the one "live" element of each mode. */
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
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (idx + 1) % MODES.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (idx + MODES.length - 1) % MODES.length;
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
        {/* live WebGPU black hole, full-bleed behind the hero content */}
        <div className="hero-bg" aria-hidden="true">
          <BlackHole className="bh-bg" />
        </div>
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
            <div className="hs"><dt className="hs-label">{t('stats.plugins')}</dt><dd className="hs-num">{FACTS.plugins}</dd></div>
            <div className="hs"><dt className="hs-label">{t('stats.disciplines')}</dt><dd className="hs-num">{FACTS.disciplines}</dd></div>
            <div className="hs"><dt className="hs-label">{t('stats.tools')}</dt><dd className="hs-num">{FACTS.tools}</dd></div>
            <div className="hs"><dt className="hs-label">{t('stats.blocks')}</dt><dd className="hs-num">{FACTS.flowBlocks}</dd></div>
            <div className="hs"><dt className="hs-label">{t('stats.tests')}</dt><dd className="hs-num">{FACTS.tests.toLocaleString('en-US')}</dd></div>
          </dl>
        </div>
        <span className="hero-art-badge">{t('hero.artBadge')}</span>
      </section>

      {/* 2 — what it is: statement, three pillars, one analysis path */}
      <section className="overview" aria-labelledby="overview-title">
        <div className="overview-body reveal">
          <div className="overview-lead-col">
            <p className="kicker">{t('overview.kicker')}</p>
            <h2 className="overview-title" id="overview-title">{t('overview.title')}</h2>
            <p className="overview-lead">{t('overview.lead')}</p>
          </div>
          <ol className="pillar-list">
            {(['p1', 'p2', 'p3'] as const).map((p, i) => (
              <li key={p} className="pillar">
                <span className="pillar-num" aria-hidden="true">0{i + 1}</span>
                <h3 className="pillar-t">{t(`overview.${p}.t`)}</h3>
                <p className="pillar-d">{t(`overview.${p}.d`)}</p>
              </li>
            ))}
          </ol>
        </div>
        <div className="overview-pipe reveal">
          <span className="pipe-label">{t('overview.pipe.label')}</span>
          <ol className="pipe-steps">
            {(['step1', 'step2', 'step3', 'step4', 'step5'] as const).map((s, i) => (
              <li key={s} className="pipe-step">
                <span className="pipe-dot" aria-hidden="true" />
                <span className="pipe-text">{t(`overview.${s}`)}</span>
                {i < 4 && <span className="pipe-line" aria-hidden="true" />}
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* 3 — four work modes (keyboard-accessible tabs) */}
      <section className="modes" aria-labelledby="modes-title">
        <div className="section-head reveal">
          <h2 className="section-title" id="modes-title">{t('modes.title')}</h2>
          <p className="section-desc">{t('modes.desc')}</p>
        </div>
        <div className="tabs modes-split reveal">
          <div className="mode-rail" role="tablist" aria-orientation="vertical" aria-label={t('modes.title')}>
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
          <div className="mode-stage">
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
                <ul className="mode-points">
                  {([1, 2, 3, 4] as const).map((i) => (
                    <li key={i}>{t(`modes.${m}.p${i}`)}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 4 — capability matrix: source-derived counts */}
      <section className="capability" aria-labelledby="cap-title">
        <div className="section-head reveal">
          <h2 className="section-title" id="cap-title">{t('cap.title')}</h2>
          <p className="section-desc">{t('cap.desc')}</p>
        </div>
        <div className="cap-wrap reveal">
          <table className="cap-table">
            <thead>
              <tr>
                <th scope="col">{t('cap.col.item')}</th>
                <th scope="col">{t('cap.col.value')}</th>
              </tr>
            </thead>
            <tbody>
              {CAPABILITY_ROWS.map((row) => (
                <tr key={row}>
                  <th scope="row">{t(`cap.row.${row}`)}</th>
                  <td>{t(`cap.v.${row}`)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* 5 — discipline atlas: plugin counts by field */}
      <section className="disciplines" aria-labelledby="disc-title">
        <div className="section-head reveal">
          <h2 className="section-title" id="disc-title">{t('disc.title')}</h2>
          <p className="section-desc">{t('disc.desc')}</p>
        </div>
        <div className="disc-layout reveal">
          <div className="disc-chart" role="list">
            {DISCIPLINES.map((d) => (
              <div key={d.id} className="disc-row" role="listitem">
                <span className="disc-name">{t(`disc.${d.id}`)}</span>
                <span className="disc-bar" aria-hidden="true">
                  <span style={{ width: `${(d.count / DISCIPLINES[0].count) * 100}%` }} />
                </span>
                <span className="disc-count">{d.count}</span>
              </div>
            ))}
          </div>
          <aside className="disc-meta">
            <div className="disc-big">
              <span className="disc-big-num">{FACTS.plugins}</span>
              <span className="disc-big-unit">{t('disc.unit')}</span>
            </div>
            <p className="disc-note">{t('disc.note')}</p>
            <p className="disc-scale" aria-hidden="true">
              <span>{DISCIPLINES[0].count}</span>
              <span className="disc-scale-line" />
              <span>0</span>
            </p>
          </aside>
        </div>
      </section>

      {/* 6 — research toolbelt: 33 tools in seven groups */}
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

      {/* 8 — scenarios: four concrete uses */}
      <section className="scenarios" aria-labelledby="scen-title">
        <div className="section-head reveal">
          <h2 className="section-title" id="scen-title">{t('scen.title')}</h2>
          <p className="section-desc">{t('scen.desc')}</p>
        </div>
        <div className="scenario-grid">
          {SCENARIOS.map((s, i) => (
            <article key={s} className="scenario-card reveal">
              <span className="scenario-num" aria-hidden="true">0{i + 1}</span>
              <h3 className="scenario-t">{t(`scen.${s}.t`)}</h3>
              <p className="scenario-d">{t(`scen.${s}.d`)}</p>
              <p className="scenario-eg">{t(`scen.${s}.eg`)}</p>
            </article>
          ))}
        </div>
      </section>

      {/* 9 — gallery excerpt */}
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

      {/* 10 — getting started and contributing */}
      <section className="start" aria-labelledby="start-title">
        <div className="section-head reveal">
          <h2 className="section-title" id="start-title">{t('start.title')}</h2>
          <p className="section-desc">{t('start.desc')}</p>
        </div>
        <div className="start-grid">
          {START_CARDS.map((s, i) => (
            <article key={s} className="start-card reveal">
              <span className="start-num" aria-hidden="true">0{i + 1}</span>
              <h3 className="start-t">{t(`start.${s}.t`)}</h3>
              <p className="start-d">{t(`start.${s}.d`)}</p>
              {s === 's1' && <a className="start-link" href={studioUrl('/')}>{t('start.s1.cta')} →</a>}
              {s === 's2' && <a className="start-link" href={docsUrl('/guide/introduction')}>{t('start.s2.cta')} →</a>}
              {s === 's3' && (
                <p className="start-links">
                  <a className="start-link" href="https://github.com/SnowLeopard-io/ErgalicsStudio" target="_blank" rel="noreferrer">GitHub</a>
                  <a className="start-link" href="https://gitee.com/cnt-code/ergalics-studio" target="_blank" rel="noreferrer">Gitee</a>
                </p>
              )}
              {s === 's4' && <a className="start-link" href="https://github.com/SnowLeopard-io/ErgalicsStudio/blob/main/CITATION.cff" target="_blank" rel="noreferrer">{t('start.s4.cta')} →</a>}
            </article>
          ))}
        </div>
      </section>

      {/* 11 — closing CTA */}
      <section className="closing" aria-labelledby="closing-title">
        {/* live Milky-Way nebula background, ported from the fx.stars plugin */}
        <div className="closing-bg" aria-hidden="true">
          <Nebula className="bh-bg" />
        </div>
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
