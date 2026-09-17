// ==========================================================================
// Ergalics Studio — Signal Lab (/signal, F3 / FR3.7–FR3.8)
//
// Data column → operation (FFT spectrum / Welch PSD / smoothing filter /
// ACF+PACF / additive decomposition) → result charts (pure SVG via the plot
// engine). Charts can be sent to Figure Studio and numeric outputs saved
// back as a new project CSV file (derived-from provenance in the file name).
// ==========================================================================

import { useMemo, useState } from 'react';
import { useT } from '@/i18n';
import { ToolShell } from '@/components/ToolShell';
import { useAppStore } from '@/stores/appStore';
import { useProjectStore } from '@/stores/projectStore';
import { renderSVG } from '@/core/plot';
import type { PlotSpec } from '@/core/plot';
import {
  spectrum,
  welch,
  peakFrequency,
  savitzkyGolay,
  movingAverage,
  diff,
  acf,
  pacf,
  decomposeAdditive,
  suggestPeriod,
  WINDOW_KINDS,
  type WindowKind,
} from '@/core/signal';
import { groupedDataFiles, loadTable, sendSpecToFigure, toCsv, fmt } from '../research/researchUi';
import { DATA_EXTS_SERIES } from '@/core/dataFiles';

type Op = 'spectrum' | 'welch' | 'filter' | 'correlation' | 'decompose';
type FilterKind = 'sg' | 'ma' | 'diff';

interface ChartOut {
  key: string;
  title: string;
  spec: PlotSpec;
}

interface ResultOut {
  charts: ChartOut[];
  summary: string;
  /** Derived columns offered for "save as data file". */
  columns: { name: string; values: number[] }[];
}

const MAX_POINTS = 1200;
const COLORS = ['#0072B2', '#D55E00', '#009E73', '#CC79A7'];

function downsample(xs: ArrayLike<number>, ys: ArrayLike<number>): Array<{ x: number; y: number }> {
  const n = Math.min(xs.length, ys.length);
  if (n <= MAX_POINTS) {
    return Array.from({ length: n }, (_, i) => ({ x: xs[i]!, y: ys[i]! }));
  }
  const step = n / MAX_POINTS;
  return Array.from({ length: MAX_POINTS }, (_, i) => {
    const j = Math.min(n - 1, Math.floor(i * step));
    return { x: xs[j]!, y: ys[j]! };
  });
}

function lineSpec(
  title: string,
  xLabel: string,
  yLabel: string,
  seriesDefs: Array<{ name: string; color: string; xs: ArrayLike<number>; ys: ArrayLike<number>; dash?: number[] }>,
): PlotSpec {
  return {
    width: 620,
    height: 300,
    title,
    xLabel,
    yLabel,
    grid: true,
    legend: seriesDefs.length > 1,
    series: seriesDefs.map((s) => ({
      name: s.name,
      kind: 'line' as const,
      color: s.color,
      dash: s.dash,
      points: downsample(s.xs, s.ys),
    })),
  };
}

export default function SignalLabPage() {
  const t = useT();
  const notify = useAppStore((s) => s.notify);
  const project = useProjectStore((s) => s.project);
  const addDataFile = useProjectStore((s) => s.addDataFile);
  const groups = useMemo(() => groupedDataFiles(DATA_EXTS_SERIES), [project?.data.files]);

  const [file, setFile] = useState('');
  const [timeCol, setTimeCol] = useState('');
  const [valueCol, setValueCol] = useState('');
  const [op, setOp] = useState<Op>('spectrum');
  const [sampleRate, setSampleRate] = useState('1');
  const [windowKind, setWindowKind] = useState<WindowKind>('hann');
  const [segLen, setSegLen] = useState('256');
  const [filterKind, setFilterKind] = useState<FilterKind>('sg');
  const [sgWindow, setSgWindow] = useState('11');
  const [sgPoly, setSgPoly] = useState('2');
  const [maWindow, setMaWindow] = useState('5');
  const [maCausal, setMaCausal] = useState(false);
  const [maxLag, setMaxLag] = useState('');
  const [period, setPeriod] = useState('0');
  const [error, setError] = useState('');
  const [result, setResult] = useState<ResultOut | null>(null);

  const cols = useMemo(() => {
    if (!file) return { numericCols: [] as string[], allCols: [] as string[] };
    try {
      const loaded = loadTable(file);
      return { numericCols: loaded.numericCols, allCols: loaded.allCols };
    } catch {
      return { numericCols: [] as string[], allCols: [] as string[] };
    }
  }, [file]);

  const numericOptions = cols.numericCols;

  const compute = () => {
    setError('');
    setResult(null);
    if (!file || !valueCol) {
      setError(t('analysis.no_data'));
      return;
    }
    try {
      const { table } = loadTable(file);
      const xRaw = Array.from(
        (table.getColumn(valueCol) as Float64Array | undefined) ?? [],
      ) as number[];
      const x = xRaw.filter(Number.isFinite);
      if (x.length < 4) throw new Error('need at least 4 finite samples');
      const tRaw = timeCol ? table.getColumn(timeCol) : undefined;
      const tVals: number[] = tRaw
        ? Array.from(tRaw as Iterable<number | string>, (v) => Number(v))
        : x.map((_, i) => i);
      const rate = Number(sampleRate) || 1;

      if (op === 'spectrum') {
        const r = spectrum(x, rate, windowKind);
        const peak = r.freqs[peakFrequency(r)]!;
        const spec = lineSpec(
          `${t('signal.op_spectrum')} — ${valueCol}`,
          t('signal.frequency'),
          t('signal.power'),
          [{ name: '|X(f)|', color: COLORS[0]!, xs: r.freqs, ys: r.magnitude }],
        );
        setResult({
          charts: [{ key: 'spectrum', title: t('signal.op_spectrum'), spec }],
          summary: `${t('signal.peak_freq')}: ${fmt(peak)} Hz`,
          columns: [
            { name: 'frequency_hz', values: Array.from(r.freqs) },
            { name: 'magnitude', values: Array.from(r.magnitude) },
            { name: 'power', values: Array.from(r.power) },
          ],
        });
        return;
      }

      if (op === 'welch') {
        const r = welch(x, rate, Math.max(4, Number(segLen) || 256), windowKind);
        const spec = lineSpec(
          `PSD (Welch) — ${valueCol}`,
          t('signal.frequency'),
          t('signal.power'),
          [{ name: 'PSD', color: COLORS[0]!, xs: r.freqs, ys: r.psd }],
        );
        setResult({
          charts: [{ key: 'welch', title: 'Welch PSD', spec }],
          summary: `nfft=${r.nfft}, segments=${r.segments}`,
          columns: [
            { name: 'frequency_hz', values: Array.from(r.freqs) },
            { name: 'psd', values: Array.from(r.psd) },
          ],
        });
        return;
      }

      if (op === 'filter') {
        let y: Float64Array;
        let label: string;
        if (filterKind === 'sg') {
          let win = Math.max(5, Math.min(51, Number(sgWindow) || 11));
          if (win % 2 === 0) win += 1;
          const poly = Math.min(4, Math.max(1, Number(sgPoly) || 2));
          y = savitzkyGolay(x, { window: win, poly: Math.min(poly, win - 1) });
          label = 'Savitzky–Golay';
        } else if (filterKind === 'ma') {
          y = movingAverage(x, Math.max(2, Number(maWindow) || 5), maCausal);
          label = maCausal ? 'MA (causal)' : 'MA (centred)';
        } else {
          y = diff(x);
          label = 'diff';
        }
        const outT = filterKind === 'diff' ? tVals.slice(1) : tVals;
        const spec = lineSpec(`${label} — ${valueCol}`, '', '', [
          { name: t('signal.original'), color: COLORS[1]!, xs: tVals, ys: x, dash: [4, 3] },
          { name: t('signal.filtered'), color: COLORS[0]!, xs: outT, ys: y },
        ]);
        setResult({
          charts: [{ key: 'filter', title: label, spec }],
          summary: `n=${y.length}`,
          columns: [{ name: `${valueCol}_${filterKind}`, values: Array.from(y) }],
        });
        return;
      }

      if (op === 'correlation') {
        const lag = Math.max(1, Number(maxLag) || Math.min(Math.floor(x.length / 4), 100));
        const a = acf(x, lag);
        const p = pacf(x, lag);
        const lags = Array.from({ length: a.length }, (_, i) => i);
        const spec = lineSpec(`ACF / PACF — ${valueCol}`, t('signal.lag'), '', [
          { name: t('signal.acf'), color: COLORS[0]!, xs: lags, ys: a },
          { name: t('signal.pacf'), color: COLORS[2]!, xs: lags, ys: p },
        ]);
        setResult({
          charts: [{ key: 'corr', title: 'ACF / PACF', spec }],
          summary: `maxLag=${lag}`,
          columns: [
            { name: 'lag', values: lags },
            { name: 'acf', values: Array.from(a) },
            { name: 'pacf', values: Array.from(p) },
          ],
        });
        return;
      }

      // decompose
      let m = Math.max(2, Math.floor(Number(period)) || 0);
      let autoPeriod = false;
      if (m === 0) {
        m = suggestPeriod(x) ?? Math.max(2, Math.floor(x.length / 4));
        autoPeriod = true;
      }
      const d = decomposeAdditive(x, m);
      const mk = (key: string, title: string, ys: Float64Array, color: string): ChartOut => ({
        key,
        title,
        spec: lineSpec(`${title} — ${valueCol}`, '', '', [
          { name: t('signal.original'), color: COLORS[1]!, xs: tVals, ys: x, dash: [4, 3] },
          { name: title, color, xs: tVals, ys },
        ]),
      });
      setResult({
        charts: [
          mk('trend', t('signal.trend'), d.trend, COLORS[0]!),
          mk('seasonal', t('signal.seasonal'), d.seasonal, COLORS[2]!),
          mk('residual', t('signal.residual'), d.residual, COLORS[3]!),
        ],
        summary:
          `${autoPeriod ? `${t('signal.suggested_period')}: m=${m}` : `m=${m}`}\n` +
          t('signal.resid_normality', {
            mean: fmt(d.residualSummary.mean),
            sd: fmt(d.residualSummary.sd),
            skew: fmt(d.residualSummary.skew),
            kurt: fmt(d.residualSummary.excessKurtosis),
          }),
        columns: [
          { name: 'trend', values: Array.from(d.trend) },
          { name: 'seasonal', values: Array.from(d.seasonal) },
          { name: 'residual', values: Array.from(d.residual) },
        ],
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const saveDerived = async () => {
    if (!result || !project) return;
    const n = result.columns[0]?.values.length ?? 0;
    const rows = Array.from({ length: n }, (_, i) =>
      result.columns.map((c) => c.values[i]),
    );
    const csv = toCsv(result.columns.map((c) => c.name), rows);
    const base = file.replace(/\.[^.]+$/, '') || 'signal';
    const blob = new File([csv], `${base}.${op}.csv`, { type: 'text/csv' });
    await addDataFile(blob);
    notify('success', t('signal.column_saved'));
  };

  const sendChart = (chart: ChartOut) => {
    if (sendSpecToFigure(t('signal.title'), chart.spec, `${file} — ${chart.title}`)) {
      notify('success', t('signal.figure_sent'));
    }
  };

  return (
    <ToolShell toolId="signal">
      {project && (
        <div className="research-toolbar">
          <select className="input" value={file} onChange={(e) => { setFile(e.target.value); setTimeCol(''); setValueCol(''); }}>
            <option value="">{t('analysis.select_file')}</option>
            {groups.project.map((n) => <option key={n} value={n}>{n}</option>)}
            {groups.examples.length > 0 && (
              <optgroup label={t('datafiles.group_examples')}>
                {groups.examples.map((n) => <option key={n} value={n}>{n}</option>)}
              </optgroup>
            )}
          </select>
          <select className="input" value={valueCol} onChange={(e) => setValueCol(e.target.value)}>
            <option value="">{t('signal.value_axis')}</option>
            {numericOptions.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select className="input" value={timeCol} onChange={(e) => setTimeCol(e.target.value)}>
            <option value="">{t('signal.time_axis')}</option>
            {numericOptions.filter((c) => c !== valueCol).map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select className="input" value={op} onChange={(e) => setOp(e.target.value as Op)}>
            <option value="spectrum">{t('signal.op_spectrum')}</option>
            <option value="welch">{t('signal.op_welch')}</option>
            <option value="filter">{t('signal.op_filter')}</option>
            <option value="correlation">{t('signal.op_correlation')}</option>
            <option value="decompose">{t('signal.op_decompose')}</option>
          </select>

          {(op === 'spectrum' || op === 'welch') && (
            <>
              <input className="input research-num" title={t('signal.sampling_rate')} value={sampleRate}
                onChange={(e) => setSampleRate(e.target.value)} />
              <select className="input" value={windowKind} onChange={(e) => setWindowKind(e.target.value as WindowKind)}>
                {WINDOW_KINDS.map((w) => <option key={w} value={w}>{w}</option>)}
              </select>
            </>
          )}
          {op === 'welch' && (
            <input className="input research-num" title={t('signal.segment')} value={segLen}
              onChange={(e) => setSegLen(e.target.value)} />
          )}
          {op === 'filter' && (
            <>
              <select className="input" value={filterKind} onChange={(e) => setFilterKind(e.target.value as FilterKind)}>
                <option value="sg">{t('signal.filter_sg')}</option>
                <option value="ma">{t('signal.filter_ma')}</option>
                <option value="diff">{t('signal.filter_diff')}</option>
              </select>
              {filterKind === 'sg' && (
                <>
                  <input className="input research-num" title={t('signal.sg_window')} value={sgWindow}
                    onChange={(e) => setSgWindow(e.target.value)} />
                  <input className="input research-num" title={t('signal.sg_poly')} value={sgPoly}
                    onChange={(e) => setSgPoly(e.target.value)} />
                </>
              )}
              {filterKind === 'ma' && (
                <>
                  <input className="input research-num" title={t('signal.ma_window')} value={maWindow}
                    onChange={(e) => setMaWindow(e.target.value)} />
                  <label className="research-check">
                    <input type="checkbox" checked={maCausal} onChange={(e) => setMaCausal(e.target.checked)} />
                    {t('signal.ma_causal')}
                  </label>
                </>
              )}
            </>
          )}
          {op === 'correlation' && (
            <input className="input research-num" title={t('signal.max_lag')} placeholder={t('signal.max_lag')}
              value={maxLag} onChange={(e) => setMaxLag(e.target.value)} />
          )}
          {op === 'decompose' && (
            <input className="input research-num" title={t('signal.period')} value={period}
              onChange={(e) => setPeriod(e.target.value)} />
          )}

          <button type="button" className="btn btn-primary" onClick={compute}>{t('signal.run')}</button>
        </div>
      )}

      {error && <p className="analysis-error">{error}</p>}

      {project && !result && !error && <div className="empty-hint">{t('signal.no_result')}</div>}

      {result && (
        <div className="research-results">
          {result.summary && <pre className="analysis-output research-summary">{result.summary}</pre>}
          <div className="research-charts">
            {result.charts.map((chart) => (
              <div key={chart.key} className="research-chart-card">
                <div className="analysis-svg" dangerouslySetInnerHTML={{ __html: renderSVG(chart.spec) }} />
                <button type="button" className="btn btn-sm" onClick={() => sendChart(chart)}>
                  {t('signal.to_figure')}
                </button>
              </div>
            ))}
          </div>
          <button type="button" className="btn" onClick={() => void saveDerived()}>
            {t('signal.save_column')}
          </button>
        </div>
      )}
    </ToolShell>
  );
}
