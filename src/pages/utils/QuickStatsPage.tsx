// ==========================================================================
// Ergalics Studio — Quick Stats (utility toolkit)
//
// Paste a numeric sample, get n / mean / median / SD / SEM / 95% CI
// (t critical values, df ≤ 30) plus a histogram preview. The dataset can be
// handed off to the uncertainty lab (Bootstrap / MCMC) via labHandoff —
// that suite is the deep-analysis surface, this page stays the quick one.
// ==========================================================================

import { useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useT } from '@/i18n';
import { ToolShell } from '@/components/ToolShell';
import { renderSVG, dataTableToHistogram } from '@/core/plot';
import { createDataTable } from '@/types/datatable';
import { openToolEmbedded } from '@/pages/research/toolRegistry';
import { stageLabHandoff } from '@/core/labHandoff';

/** Two-tailed t critical values at α = 0.05, df 1…30; beyond that, z. */
const T_CRIT_95: number[] = [
  12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228,
  2.201, 2.179, 2.16, 2.145, 2.131, 2.12, 2.11, 2.101, 2.093, 2.086,
  2.08, 2.074, 2.069, 2.064, 2.06, 2.056, 2.052, 2.048, 2.045, 2.042,
];
const Z_CRIT_95 = 1.959964;

function tCrit95(df: number): number {
  if (df < 1) return NaN;
  if (df <= 30) return T_CRIT_95[df - 1] ?? Z_CRIT_95;
  return Z_CRIT_95;
}

function fmt(v: number): string {
  return Number.isFinite(v) ? String(Number(v.toPrecision(6))) : '—';
}

interface Stats {
  n: number;
  mean: number;
  median: number;
  sd: number;
  sdPop: number;
  sem: number;
  ciLo: number;
  ciHi: number;
  min: number;
  max: number;
  range: number;
}

function computeStats(xs: number[]): Stats {
  const n = xs.length;
  const sorted = [...xs].sort((a, b) => a - b);
  const mean = xs.reduce((a, b) => a + b, 0) / n;
  const median = n % 2 === 1
    ? sorted[(n - 1) / 2] ?? NaN
    : ((sorted[n / 2 - 1] ?? NaN) + (sorted[n / 2] ?? NaN)) / 2;
  const ss = xs.reduce((a, b) => a + (b - mean) ** 2, 0);
  const varSample = n > 1 ? ss / (n - 1) : NaN;
  const sd = Math.sqrt(varSample);
  const sdPop = Math.sqrt(ss / n);
  const sem = n > 1 ? sd / Math.sqrt(n) : NaN;
  const half = sem * tCrit95(n - 1);
  const min = sorted[0] ?? NaN;
  const max = sorted[n - 1] ?? NaN;
  return { n, mean, median, sd, sdPop, sem, ciLo: mean - half, ciHi: mean + half, min, max, range: max - min };
}

export default function QuickStatsPage() {
  const t = useT();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [raw, setRaw] = useState('');

  const values = useMemo<number[]>(() => {
    if (raw.trim() === '') return [];
    return raw
      .split(/[\s,;]+/)
      .map((s) => s.replace(/[%,]$/g, ''))
      .map((s) => Number(s))
      .filter((v) => Number.isFinite(v));
  }, [raw]);

  const stats = useMemo(() => (values.length > 0 ? computeStats(values) : null), [values]);

  const histogram = useMemo(() => {
    if (!stats || stats.n < 2) return null;
    const table = createDataTable(
      'quick-stats',
      [{ name: 'x', type: 'f64', data: Float64Array.from(values) }],
      { provenance: 'quick-stats' },
    );
    const spec = dataTableToHistogram(table, 'x', { title: t('qs.histogram'), bins: 24 });
    return renderSVG(spec);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stats, values]);

  const handoff = () => {
    if (!stats) return;
    stageLabHandoff({ name: 'quick-stats', csv: `x\n${values.join('\n')}\n`, target: 'uncertainty' });
    openToolEmbedded(navigate, 'uncertainty', pathname);
  };

  const cells: Array<{ label: string; value: string }> = stats
    ? [
        { label: t('qs.n'), value: String(stats.n) },
        { label: t('qs.mean'), value: fmt(stats.mean) },
        { label: t('qs.median'), value: fmt(stats.median) },
        { label: t('qs.sd'), value: fmt(stats.sd) },
        { label: t('qs.sd_pop'), value: fmt(stats.sdPop) },
        { label: t('qs.sem'), value: fmt(stats.sem) },
        {
          label: t('qs.ci95'),
          value: Number.isFinite(stats.ciLo) ? `[${fmt(stats.ciLo)}, ${fmt(stats.ciHi)}]` : '—',
        },
        { label: t('qs.min'), value: fmt(stats.min) },
        { label: t('qs.max'), value: fmt(stats.max) },
        { label: t('qs.range'), value: fmt(stats.range) },
      ]
    : [];

  return (
    <ToolShell toolId="quick-stats">
      <div className="util-page">
        <div className="util-card">
          <div className="util-row util-between">
            <h2 className="util-card-title">{t('qs.data')}</h2>
            {values.length > 0 && (
              <span className="util-note">{t('qs.parsed', { count: values.length })}</span>
            )}
          </div>
          <textarea
            className="input util-mono qs-input"
            value={raw}
            placeholder={t('qs.placeholder')}
            spellCheck={false}
            onChange={(e) => setRaw(e.target.value)}
            aria-label={t('qs.data')}
          />
          {raw.trim() !== '' && !stats && <p className="util-error">{t('qs.error_empty')}</p>}
        </div>

        {stats && (
          <div className="util-card">
            <h2 className="util-card-title">{t('qs.mean')} · {t('qs.sd')} · {t('qs.ci95')}</h2>
            <div className="qs-grid">
              {cells.map((c) => (
                <div key={c.label} className="qs-stat">
                  <span className="qs-stat-label">{c.label}</span>
                  <span className="util-mono qs-stat-value">{c.value}</span>
                </div>
              ))}
            </div>
            {histogram && (
              <div className="qs-histogram" dangerouslySetInnerHTML={{ __html: histogram }} />
            )}
            <div className="util-row">
              <button
                type="button"
                className="btn btn-primary"
                onClick={handoff}
                title={t('qs.handoff_hint')}
              >
                {t('qs.handoff')} →
              </button>
              <span className="util-note">{t('qs.handoff_hint')}</span>
            </div>
          </div>
        )}
      </div>
    </ToolShell>
  );
}
