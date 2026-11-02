import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  getScienceOutputs,
  subscribeScienceOutputs,
  type ScienceOutputEntry,
} from '@/core/research/scienceOutput';
import { resolveDataFile } from '@/core/dataFiles';
import { stageLabHandoff } from '@/core/labHandoff';
import { openToolEmbedded } from '@/pages/research/toolRegistry';
import { usePluginStore } from '@/stores/pluginStore';
import { useProjectStore } from '@/stores/projectStore';
import { useT } from '@/i18n';

/** Research suites the staged data file can be deep-linked into. */
const DEEP_LINKS = [
  { tool: 'model-lab', titleKey: 'model.title' },
  { tool: 'uncertainty', titleKey: 'uncertainty.title' },
  { tool: 'signal', titleKey: 'signal.title' },
] as const;

/** Count-up for numeric metric values: when a fresh number arrives it grows
 *  from zero over ~650 ms (ease-out). Non-numeric values ("converged", dates,
 *  strings with no leading number) render statically. Motion-safe by nature:
 *  a CSS class gates the strip entrance, and a JS-driven 650 ms count is
 *  short enough not to bother reduced-motion users — but we skip it anyway. */
function AnimatedMetricValue({ text }: { text: string }) {
  const match = useMemo(() => text.match(/^\s*-?\d+(?:\.\d+)?/), [text]);
  const target = useMemo(() => (match ? Number.parseFloat(match[0]) : null), [match]);
  const [display, setDisplay] = useState(target);
  const rafRef = useRef(0);

  useEffect(() => {
    if (target === null || !Number.isFinite(target)) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setDisplay(target);
      return;
    }
    const t0 = performance.now();
    const dur = 650;
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      setDisplay(target * eased);
      if (p < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [target]);

  if (target === null) return <>{text}</>;
  const decimals = (match![0].split('.')[1] ?? '').length;
  const current = display === null ? target : display;
  return <>{current.toFixed(decimals)}{text.slice(match![0].length)}</>;
}

/**
 * Unified scientific-output strip rendered under the workbench viewport.
 * Shows the active plugin's published metrics (R², residuals, CIs,
 * convergence / conservation diagnostics…) so every plot is paired with its
 * numerical conclusions. When the plugin's data came from a project data
 * file, a "continue in a research suite" cluster stages that file through
 * the lab handoff and opens Model Lab / Uncertainty / Signal embedded —
 * the numbers on screen arrive next to their source data. Hidden entirely
 * when the active plugin has published nothing.
 */
export function ScienceOutputStrip() {
  const t = useT();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const activeId = usePluginStore((s) => s.activeId);
  const runHistory = usePluginStore((s) => s.runHistory);
  const projectFiles = useProjectStore((s) => s.project?.data.files);
  const [outputs, setOutputs] = useState<Record<string, ScienceOutputEntry>>(() =>
    getScienceOutputs(),
  );

  useEffect(() => subscribeScienceOutputs(setOutputs), []);

  // Deep-link source: the active plugin's latest data-import run record, but
  // only when that file actually lives in the project's data-file registry —
  // the research suites resolve tables by name through that registry (binary
  // imports that bypass the registry cannot be handed off).
  const sourceFile = useMemo(() => {
    if (!activeId) return null;
    const imports = runHistory.filter(
      (r) => r.pluginId === activeId && r.kind === 'data-import',
    );
    const name = imports[imports.length - 1]?.label;
    if (!name) return null;
    return projectFiles?.some((f) => f.name === name) ? name : null;
  }, [activeId, runHistory, projectFiles]);

  const entry = activeId ? outputs[activeId] : undefined;
  if (!entry || entry.metrics.length === 0) return null;

  // Remount key: when the active plugin publishes new numbers, the strip
  // replays its entrance and the values count up again.
  const seq = entry.seq ?? 0;

  const handoff = async (tool: (typeof DEEP_LINKS)[number]['tool']) => {
    if (!sourceFile) return;
    const text = await resolveDataFile(sourceFile);
    if (text === undefined) return;
    stageLabHandoff({ name: sourceFile, csv: text, target: tool });
    openToolEmbedded(navigate, tool, pathname);
  };

  return (
    <div className="science-strip" role="status">
      <span className="science-strip-title">Σ</span>
      <div className="science-strip-items">
        {entry.metrics.map((m, i) => (
          <span
            key={`${m.key}-${seq}`}
            className={`science-metric sev-${m.severity ?? 'info'}`}
            title={m.hint ?? m.label}
            style={{ animationDelay: `${Math.min(i * 60, 300)}ms` }}
          >
            <span className="science-metric-label">{m.label}</span>
            <span className="science-metric-value">
              <AnimatedMetricValue text={String(m.value)} />
              {m.unit ? <span className="science-metric-unit"> {m.unit}</span> : null}
            </span>
          </span>
        ))}
      </div>
      {sourceFile && (
        <div className="science-strip-actions">
          <span className="science-strip-hint">{t('science.deep_link')}</span>
          {DEEP_LINKS.map(({ tool, titleKey }) => (
            <button
              key={tool}
              type="button"
              className="btn btn-sm"
              onClick={() => void handoff(tool)}
            >
              {t(titleKey)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
