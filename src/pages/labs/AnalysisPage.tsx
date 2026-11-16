import { useMemo, useRef, useState } from 'react';
import { useT } from '@/i18n';
import { useProjectStore } from '@/stores/projectStore';
import { useAppStore } from '@/stores/appStore';
import { saveBinaryArtifact, saveTextArtifact } from '@/core/workspace-artifacts';
import { useAnalysisStore } from '@/stores/analysisStore';
import { listDataFilesGrouped, resolveDataFile, DATA_EXTS_SERIES } from '@/core/dataFiles';
import { parseDataText } from '@/blocks/fileData';
import { asFloat64, isNumericType } from '@/blocks/ops';
import {
  renderSVG,
  dataTableToLine,
  dataTableToScatter,
  dataTableToHistogram,
  dataTableToBar,
  exportSVG,
  exportPDF,
  buildPDF,
} from '@/core/plot';
import { summary } from '@/core/stats/descriptive';
import { tTestOneSample, tTestTwoSample, mannWhitney } from '@/core/stats/tests';
import { pearson, studentTCdf, cohensD, mean, std } from '@/core/stats';
import { tukeyHSD, dunnettTest } from '@/core/stats/posthoc';
import { kruskalWallis, dunnPostHoc } from '@/core/stats/nonparametric';
import { kaplanMeier, logRankTest, type KMPoint } from '@/core/stats/survival';
import { cronbachAlpha, kmo, bartlettTest } from '@/core/stats/psychometrics';
import { pivotLonger, pivotWider } from '@/core/dataeng/reshape';
import { toCsvTable } from '@/blocks/ops';
import type { NarrativeInput } from '@/core/stats/narrative';
import type { DataTable } from '@/types/datatable';
import type { SvgPlotPayload } from '@/core/plot/types';
import type { PlotSpec } from '@/core/plot';
import { sendSpecToFigure } from '../research/researchUi';
import { ToolShell } from '@/components/ToolShell';
import { NarrativePanel } from '@/components/NarrativePanel';

type ChartKind = 'line' | 'scatter' | 'histogram' | 'bar';
type TestKind = 't1' | 't2' | 'mw' | 'pearson';
type AdvKind = 'tukey' | 'dunnett' | 'kruskal';
type PsyKind = 'alpha' | 'kmo' | 'bartlett';
type ReshapeKind = 'longer' | 'wider';

function safeName(s: string): string {
  return s.replace(/[^\w.-]+/g, '-').slice(0, 60) || 'chart';
}

/** Fixed-width number formatting for the text result panels. */
function num(v: number, digits = 4): string {
  if (!Number.isFinite(v)) return '—';
  return v.toFixed(digits);
}

/** Journal-style p-value: three decimals, inequality below .001. */
function pval(p: number): string {
  if (!Number.isFinite(p)) return '—';
  if (p < 0.001) return '< .001';
  return p.toFixed(3).replace(/^0/, '');
}

/** Parse a comma-separated column list from an input field. */
function columnList(text: string): string[] {
  return text
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '');
}

/** Coerce any column (string / numeric / boolean) to display labels. */
function labelsOf(table: DataTable, name: string): string[] {
  const col = table.getColumn(name);
  if (!col) throw new Error(`column "${name}" does not exist`);
  const out: string[] = [];
  for (let i = 0; i < table.length; i += 1) {
    const v = col[i];
    out.push(v === null || v === undefined ? '' : String(v));
  }
  return out;
}

/** Split a numeric column into groups keyed by an arbitrary label column. */
function groupSamples(
  table: DataTable,
  valueCol: string,
  groupCol: string,
): { names: string[]; groups: number[][] } {
  const values = asFloat64(table, valueCol);
  const labels = labelsOf(table, groupCol);
  const map = new Map<string, number[]>();
  for (let i = 0; i < table.length; i += 1) {
    const g = labels[i]!;
    let bucket = map.get(g);
    if (!bucket) {
      bucket = [];
      map.set(g, bucket);
    }
    bucket.push(values[i]!);
  }
  return { names: [...map.keys()], groups: [...map.values()] };
}

/**
 * Coerce an event / status column to booleans with the same vocabulary the
 * statistics blocks accept (1/0, true/false, yes/no, event/censored).
 */
function eventFlags(table: DataTable, name: string): boolean[] {
  if (!name) throw new Error('pick the event/status column');
  const col = table.getColumn(name);
  if (!col) throw new Error(`column "${name}" does not exist`);
  const out: boolean[] = [];
  for (let i = 0; i < table.length; i += 1) {
    const v = col[i];
    if (typeof v === 'boolean') out.push(v);
    else if (typeof v === 'number') out.push(v !== 0);
    else {
      const s = String(v).trim().toLowerCase();
      if (['1', 'true', 'yes', 'y', 'event', 'dead', 'died'].includes(s)) out.push(true);
      else if (['0', 'false', 'no', 'n', 'censored', 'alive'].includes(s)) out.push(false);
      else throw new Error(`event column "${name}" has an unrecognised value "${String(v)}"`);
    }
  }
  return out;
}

/** n × k item matrix for the psychometric routines. */
function itemMatrix(table: DataTable, names: string[]): number[][] {
  const chosen =
    names.length > 0
      ? names
      : table.columns.filter((c) => isNumericType(c.type)).map((c) => c.name);
  if (chosen.length < 2) throw new Error('select at least two numeric item columns');
  const cols = chosen.map((n) => asFloat64(table, n));
  const rows: number[][] = [];
  for (let i = 0; i < table.length; i += 1) rows.push(cols.map((c) => c[i]!));
  return rows;
}

/** Step points for one Kaplan–Meier curve. */
function kmPoints(curve: KMPoint[]): Array<{ x: number; y: number }> {
  return curve.map((p) => ({ x: p.time, y: p.survival }));
}

export default function AnalysisPage() {
  const t = useT();
  const project = useProjectStore((s) => s.project);
  const notify = useAppStore((s) => s.notify);

  // project?.data.files is an intentional invalidation trigger for the
  // registry-backed file list (listDataFilesGrouped reads store state directly).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const fileGroups = useMemo(() => listDataFilesGrouped(DATA_EXTS_SERIES), [project?.data.files]);

  const [file, setFile] = useState('');
  const [table, setTable] = useState<DataTable | null>(null);
  const [parseError, setParseError] = useState('');

  const [chartKind, setChartKind] = useState<ChartKind>('line');
  const [xCol, setXCol] = useState('');
  const [yCol, setYCol] = useState('');
  const [col, setCol] = useState('');
  const [chartTitle, setChartTitle] = useState('');
  const [preview, setPreview] = useState<SvgPlotPayload | null>(null);
  /** Live spec behind `preview`, kept for the Figure Studio handoff. */
  const [previewSpec, setPreviewSpec] = useState<PlotSpec | null>(null);

  const [descCol, setDescCol] = useState('');
  const [descText, setDescText] = useState('');

  const [testKind, setTestKind] = useState<TestKind>('t2');
  const [testA, setTestA] = useState('');
  const [testB, setTestB] = useState('');
  const [mu0, setMu0] = useState('0');
  const [testResult, setTestResult] = useState('');
  const [narrativeInput, setNarrativeInput] = useState<NarrativeInput | null>(null);

  // ---- advanced multi-group comparisons (Tukey / Dunnett / Kruskal-Wallis) --
  const [advKind, setAdvKind] = useState<AdvKind>('tukey');
  const [advValue, setAdvValue] = useState('');
  const [advGroup, setAdvGroup] = useState('');
  const [advControl, setAdvControl] = useState('');
  const [advAlpha, setAdvAlpha] = useState('0.05');
  const [advCorrection, setAdvCorrection] = useState<'bonferroni' | 'bh'>('bonferroni');
  const [advResult, setAdvResult] = useState('');

  // ---- survival (Kaplan-Meier + log-rank) ---------------------------------
  const [survTime, setSurvTime] = useState('');
  const [survEvent, setSurvEvent] = useState('');
  const [survGroup, setSurvGroup] = useState('');
  const [survResult, setSurvResult] = useState('');
  const [survChart, setSurvChart] = useState<SvgPlotPayload | null>(null);
  const [survSpec, setSurvSpec] = useState<PlotSpec | null>(null);

  // ---- psychometrics (Cronbach / KMO / Bartlett) --------------------------
  const [psyKind, setPsyKind] = useState<PsyKind>('alpha');
  const [itemCols, setItemCols] = useState<string[]>([]);
  const [psyResult, setPsyResult] = useState('');

  // ---- long / wide reshaping ----------------------------------------------
  const [reshKind, setReshKind] = useState<ReshapeKind>('longer');
  const [reshIds, setReshIds] = useState('');
  const [reshMeasures, setReshMeasures] = useState('');
  const [reshNamesFrom, setReshNamesFrom] = useState('');
  const [reshValuesFrom, setReshValuesFrom] = useState('');
  const [reshNamesTo, setReshNamesTo] = useState('variable');
  const [reshValuesTo, setReshValuesTo] = useState('value');
  const [reshPrefix, setReshPrefix] = useState('');
  const [reshTable, setReshTable] = useState<DataTable | null>(null);
  const [reshError, setReshError] = useState('');

  /** Generation counter: lets a superseded async file load discard its result. */
  const loadGen = useRef(0);

  const numericCols = useMemo(
    () => (table ? table.columns.filter((c) => isNumericType(c.type)).map((c) => c.name) : []),
    [table],
  );
  const allCols = useMemo(() => (table ? table.columns.map((c) => c.name) : []), [table]);

  const loadFile = async (name: string) => {
    setFile(name);
    setPreview(null);
    setPreviewSpec(null);
    setParseError('');
    // The derived results belong to the PREVIOUS file. Keeping them would
    // let the save action stamp the new file's name onto the old file's
    // numbers (the artifact claimed the wrong source).
    setDescText('');
    setTestResult('');
    setNarrativeInput(null);
    setAdvResult('');
    setSurvResult('');
    setSurvChart(null);
    setSurvSpec(null);
    setPsyResult('');
    setReshTable(null);
    setReshError('');
    if (!name) {
      loadGen.current += 1;
      setTable(null);
      return;
    }
    // Only the newest selection may apply its parse — a slow resolve of an
    // earlier pick must not overwrite the table of the file now selected.
    const gen = ++loadGen.current;
    const text = await resolveDataFile(name);
    if (gen !== loadGen.current) return;
    if (text === undefined) {
      setTable(null);
      setParseError(t('analysis.no_data'));
      return;
    }
    try {
      const tbl = parseDataText(text, name);
      const nums = tbl.columns.filter((c) => isNumericType(c.type)).map((c) => c.name);
      if (nums.length === 0) {
        setTable(null);
        setParseError(t('analysis.numeric_only'));
        return;
      }
      setTable(tbl);
      const [c0, c1] = nums;
      setXCol(c0 ?? '');
      setYCol(c1 ?? c0 ?? '');
      setCol(c0 ?? '');
      setDescCol(c0 ?? '');
      setTestA(c0 ?? '');
      setTestB(c1 ?? c0 ?? '');
      setAdvValue(nums[0] ?? '');
      setAdvGroup(tbl.columns.find((c) => !isNumericType(c.type))?.name ?? '');
      setAdvControl('');
      setSurvTime(nums[0] ?? '');
      setSurvEvent(nums[1] ?? '');
      setSurvGroup(tbl.columns.find((c) => !isNumericType(c.type))?.name ?? '');
      setItemCols([]);
      setReshIds(tbl.columns[0]?.name ?? '');
      setReshMeasures('');
      setReshNamesFrom(tbl.columns.find((c) => !isNumericType(c.type))?.name ?? '');
      setReshValuesFrom(nums[0] ?? '');
    } catch (err) {
      setTable(null);
      setParseError(err instanceof Error ? err.message : String(err));
    }
  };

  const generateChart = () => {
    if (!table) return;
    const opts = { title: chartTitle || undefined };
    try {
      const spec =
        chartKind === 'line'
          ? dataTableToLine(table, xCol, yCol, opts)
          : chartKind === 'scatter'
            ? dataTableToScatter(table, xCol, yCol, opts)
            : chartKind === 'histogram'
              ? dataTableToHistogram(table, col, opts)
              : dataTableToBar(table, col, opts);
      const markup = renderSVG(spec);
      const payload: SvgPlotPayload = { svg: true, markup, title: chartTitle || undefined };
      setPreview(payload);
      setPreviewSpec(spec);
      useAnalysisStore.getState().setCurrentPlot(payload);
    } catch (err) {
      setParseError(err instanceof Error ? err.message : String(err));
    }
  };

  const sendToFigure = () => {
    if (!previewSpec) return;
    const ok = sendSpecToFigure(t('analysis.title'), previewSpec, chartTitle || undefined);
    notify(
      ok ? 'success' : 'error',
      ok ? t('figure.sent') : t('figure.send_failed'),
    );
  };

  const baseName = () => {
    const p = useProjectStore.getState().project?.name ?? 'ergalics';
    return chartTitle ? `${p}-${chartTitle}` : `${p}-chart`;
  };

  const onExportSvg = () => {
    if (preview) exportSVG(preview.markup, `${safeName(baseName())}.svg`);
  };
  const onExportPdf = () => {
    if (preview) void exportPDF(preview.markup, `${safeName(baseName())}.pdf`);
  };

  /** Save the chart into the project workspace as SVG + PDF (figures/). */
  const onSaveToWorkspace = async () => {
    if (!preview) return;
    const p = useProjectStore.getState().project;
    if (!p) {
      setParseError(t('labs.no_project'));
      return;
    }
    const base = safeName(baseName());
    try {
      const written = [await saveTextArtifact(p, 'figures', `${base}.svg`, preview.markup)];
      // The chart's PDF export belongs beside the SVG, exactly like the
      // figure studio's "save all formats" action.
      try {
        written.push(
          await saveBinaryArtifact(p, 'figures', `${base}.pdf`, await buildPDF(preview.markup)),
        );
      } catch {
        // A layout failure must not lose the SVG that was already written.
      }
      notify('success', t('labs.saved_ws', { path: written.join(', ') }));
    } catch (err) {
      setParseError(err instanceof Error ? err.message : String(err));
    }
  };

  /** Save the statistical test result into the workspace (runs/) as a JSON
   *  snapshot — one file per run, matching the repo's runs/ convention. */
  const onSaveTestResult = () => {
    const p = useProjectStore.getState().project;
    if (!p) {
      notify('error', t('labs.no_project'));
      return;
    }
    const snapshot = {
      kind: 'stats-test',
      savedAt: new Date().toISOString(),
      source: file,
      test: testKind,
      columns: testB ? [testA, testB] : [testA],
      result: testResult,
    };
    const name = `${safeName(baseName())}-${testKind}.json`;
    void saveTextArtifact(p, 'runs', name, JSON.stringify(snapshot, null, 2))
      .then((path) => notify('success', t('labs.saved_ws', { path })))
      .catch(() => notify('error', t('labs.save_failed')));
  };

  const showSummary = () => {
    if (!table || !descCol) return;
    try {
      const arr = Array.from(asFloat64(table, descCol));
      const s = summary(arr);
      const f = (v: number) => (Number.isNaN(v) ? '—' : v.toFixed(4));
      setDescText(
        [
          `n = ${s.n}`,
          `mean = ${f(s.mean)}`,
          `median = ${f(s.median)}`,
          `std = ${f(s.std)}`,
          `min = ${f(s.min)}`,
          `max = ${f(s.max)}`,
          `Q1 = ${f(s.q1)}`,
          `Q3 = ${f(s.q3)}`,
        ].join('\n'),
      );
    } catch (err) {
      setDescText(err instanceof Error ? err.message : String(err));
    }
  };

  const runTest = () => {
    if (!table) return;
    setNarrativeInput(null);
    try {
      const a = Array.from(asFloat64(table, testA));
      const b = testB ? Array.from(asFloat64(table, testB)) : [];
      const mu = Number(mu0);
      const f = (v: number) => (Number.isNaN(v) ? '—' : v.toFixed(4));
      if (testKind === 't1') {
        const r = tTestOneSample(a, mu);
        setTestResult(`t = ${f(r.statistic)}, df = ${r.df ?? '—'}, p = ${f(r.pValue)}`);
        const sd = std(a);
        setNarrativeInput({
          kind: 'ttest',
          variant: 'one',
          result: r,
          d: sd > 0 ? (mean(a) - mu) / sd : undefined,
        });
      } else if (testKind === 't2') {
        const r = tTestTwoSample(a, b);
        setTestResult(`t = ${f(r.statistic)}, df = ${f(Number(r.df))}, p = ${f(r.pValue)}`);
        setNarrativeInput({
          kind: 'ttest',
          variant: 'two',
          result: r,
          d: a.length > 1 && b.length > 1 ? cohensD(a, b) : undefined,
          groupA: testA,
          groupB: testB,
        });
      } else if (testKind === 'mw') {
        const r = mannWhitney(a, b);
        setTestResult(`U = ${r.u}, z = ${f(r.z)}, p = ${f(r.pValue)}`);
      } else {
        const r = pearson(a, b);
        const n = Math.min(a.length, b.length);
        let p = NaN;
        if (n > 2 && Math.abs(r) < 1) {
          const tv = r * Math.sqrt((n - 2) / (1 - r * r));
          p = 2 * (1 - studentTCdf(Math.abs(tv), n - 2));
        }
        setTestResult(`r = ${f(r)}, p = ${f(p)}`);
        setNarrativeInput({ kind: 'correlation', r, pValue: p, n, xName: testA, yName: testB });
      }
    } catch (err) {
      setTestResult(err instanceof Error ? err.message : String(err));
    }
  };

  // ---- advanced multi-group comparisons -----------------------------------

  const runAdvanced = () => {
    if (!table) return;
    setAdvResult('');
    try {
      const alpha = Math.min(0.5, Math.max(1e-4, Number(advAlpha) || 0.05));
      const { names, groups } = groupSamples(table, advValue, advGroup);
      if (groups.length < 2) throw new Error(t('analysis.adv_need_groups'));
      const lines: string[] = [];
      if (advKind === 'tukey') {
        const r = tukeyHSD(groups, names, alpha);
        lines.push(
          `Tukey HSD  α=${alpha}  k=${r.k}  df=${r.dfError}  MSW=${num(r.msWithin)}  q*=${num(r.qCrit, 3)}`,
        );
        for (const c of r.comparisons) {
          lines.push(
            `${c.groupA} vs ${c.groupB}: Δ=${num(c.meanDiff)}  SE=${num(c.se)}  q=${num(c.statistic, 3)}  p=${pval(c.pValue)}  CI [${num(c.ciLow)}, ${num(c.ciHigh)}]${c.significant ? '  *' : ''}`,
          );
        }
      } else if (advKind === 'dunnett') {
        const control = advControl || names[0]!;
        const at = names.indexOf(control);
        if (at < 0) throw new Error(t('analysis.adv_no_control'));
        const treatments = groups.filter((_, i) => i !== at);
        const treatmentNames = names.filter((_, i) => i !== at);
        const r = dunnettTest(groups[at]!, treatments, [control, ...treatmentNames], alpha);
        lines.push(
          `Dunnett  control=${r.control}  α=${alpha}  k=${r.k}  df=${r.dfError}  MSW=${num(r.msWithin)}  t*=${num(r.tCrit, 3)}`,
        );
        for (const c of r.comparisons) {
          lines.push(
            `${c.groupB} vs ${c.groupA}: Δ=${num(c.meanDiff)}  SE=${num(c.se)}  t=${num(c.statistic, 3)}  p=${pval(c.pValue)}  CI [${num(c.ciLow)}, ${num(c.ciHigh)}]${c.significant ? '  *' : ''}`,
          );
        }
      } else {
        const kw = kruskalWallis(groups);
        const dunn = dunnPostHoc(groups, names, advCorrection, alpha);
        lines.push(
          `Kruskal–Wallis  H(${kw.df}) = ${num(kw.H, 3)}  p = ${pval(kw.pValue)}  ε² = ${num(kw.epsilonSquared, 3)}  N = ${kw.n}`,
          `Dunn (${advCorrection === 'bh' ? 'Benjamini–Hochberg' : 'Bonferroni'}):`,
        );
        for (const c of dunn.comparisons) {
          lines.push(
            `${c.groupA} vs ${c.groupB}: z=${num(c.z, 3)}  p=${pval(c.pValue)}  p_adj=${pval(c.adjustedP)}${c.significant ? '  *' : ''}`,
          );
        }
      }
      setAdvResult(lines.join('\n'));
    } catch (err) {
      setAdvResult(err instanceof Error ? err.message : String(err));
    }
  };

  // ---- survival ------------------------------------------------------------

  const runSurvival = () => {
    if (!table) return;
    setSurvResult('');
    setSurvChart(null);
    setSurvSpec(null);
    try {
      const times = Array.from(asFloat64(table, survTime));
      const events = eventFlags(table, survEvent);
      const bucket = new Map<string, { times: number[]; events: boolean[] }>();
      if (survGroup) {
        const labels = labelsOf(table, survGroup);
        for (let i = 0; i < table.length; i += 1) {
          const key = labels[i]!;
          let b = bucket.get(key);
          if (!b) {
            b = { times: [], events: [] };
            bucket.set(key, b);
          }
          b.times.push(times[i]!);
          b.events.push(events[i]!);
        }
      } else {
        bucket.set('', { times, events });
      }
      const curves = [...bucket.entries()].map(([group, data]) => ({
        group,
        km: kaplanMeier(data.times, data.events),
      }));
      const lines: string[] = [];
      for (const { group, km } of curves) {
        const med =
          km.median === null
            ? t('analysis.surv_no_median')
            : `${num(km.median)}${km.ci95 ? ` (95% CI ${num(km.ci95[0])}–${num(km.ci95[1])})` : ''}`;
        lines.push(
          `${group || t('analysis.surv_all')}: n=${km.n}  events=${km.events}  censored=${km.censored}  median=${med}`,
        );
      }
      if (curves.length === 2) {
        // The log-rank test needs the raw observations, not the curve points.
        const a = bucket.get(curves[0]!.group)!;
        const b = bucket.get(curves[1]!.group)!;
        const lr = logRankTest(a, b);
        lines.push(
          `Log-rank: χ²(${lr.df}) = ${num(lr.chiSquare, 3)}  p = ${pval(lr.pValue)}  HR = ${num(lr.hazardRatio, 3)}${
            lr.hazardRatioCi95 ? ` (95% CI ${num(lr.hazardRatioCi95[0], 3)}–${num(lr.hazardRatioCi95[1], 3)})` : ''
          }  [${curves[0]!.group} vs ${curves[1]!.group}]`,
        );
      } else if (curves.length > 2) {
        lines.push(t('analysis.surv_two_groups'));
      }

      const COLORS = ['#0072B2', '#D55E00', '#009E73', '#CC79A7', '#E69F00', '#56B4E9'];
      const spec: PlotSpec = {
        width: 560,
        height: 360,
        title: `Kaplan–Meier${curves.length === 1 ? ` — ${file}` : ''}`,
        xLabel: t('analysis.surv_time'),
        yLabel: t('analysis.surv_prob'),
        grid: true,
        legend: curves.length > 1,
        series: curves.map((c, i) => ({
          name: c.group || t('analysis.surv_all'),
          kind: 'line' as const,
          color: COLORS[i % COLORS.length]!,
          points: kmPoints(c.km.curve),
        })),
      };
      setSurvSpec(spec);
      setSurvChart({ svg: true, markup: renderSVG(spec), title: spec.title });
      setSurvResult(lines.join('\n'));
    } catch (err) {
      setSurvResult(err instanceof Error ? err.message : String(err));
    }
  };

  const sendSurvivalToFigure = () => {
    if (!survSpec) return;
    const ok = sendSpecToFigure(t('analysis.survival'), survSpec, `${file} — Kaplan–Meier`);
    notify(ok ? 'success' : 'error', ok ? t('figure.sent') : t('figure.send_failed'));
  };

  // ---- psychometrics -------------------------------------------------------

  const runPsychometrics = () => {
    if (!table) return;
    setPsyResult('');
    try {
      const items = itemMatrix(table, itemCols);
      if (psyKind === 'alpha') {
        const r = cronbachAlpha(items);
        const lines = [
          `Cronbach's α = ${num(r.alpha, 3)} (${r.interpretation})  n = ${r.nSubjects} × ${r.nItems}`,
          `mean inter-item r = ${num(r.meanInterItemCorrelation, 3)}`,
          'alpha if item deleted:',
        ];
        r.alphaIfDeleted.forEach((a, i) => {
          lines.push(`  item ${i + 1}: α = ${num(a, 3)}  r(item–total) = ${num(r.itemTotalCorrelation[i]!, 3)}`);
        });
        setPsyResult(lines.join('\n'));
      } else if (psyKind === 'kmo') {
        const r = kmo(items);
        const lines = [`KMO = ${num(r.overall, 3)} (${r.interpretation})`];
        r.perItem.forEach((v, i) => lines.push(`  item ${i + 1}: ${num(v, 3)}`));
        setPsyResult(lines.join('\n'));
      } else {
        const r = bartlettTest(items);
        setPsyResult(
          `Bartlett's test: χ²(${r.df}) = ${num(r.chiSquare, 3)}  p = ${pval(r.pValue)}  |R| = ${num(r.determinant, 4)}`,
        );
      }
    } catch (err) {
      setPsyResult(err instanceof Error ? err.message : String(err));
    }
  };

  // ---- long / wide reshaping ----------------------------------------------

  const runReshape = () => {
    if (!table) return;
    setReshTable(null);
    setReshError('');
    try {
      const idCols = columnList(reshIds);
      if (idCols.length === 0) throw new Error(t('analysis.reshape_need_ids'));
      if (reshKind === 'longer') {
        setReshTable(
          pivotLonger(table, {
            idCols,
            measureCols: columnList(reshMeasures),
            namesTo: reshNamesTo.trim() || 'variable',
            valuesTo: reshValuesTo.trim() || 'value',
            id: 'analysis.pivot_longer',
          }),
        );
      } else {
        if (!reshNamesFrom || !reshValuesFrom) throw new Error(t('analysis.reshape_need_cols'));
        setReshTable(
          pivotWider(table, {
            idCols,
            namesFrom: reshNamesFrom,
            valuesFrom: reshValuesFrom,
            namesPrefix: reshPrefix,
            id: 'analysis.pivot_wider',
          }),
        );
      }
    } catch (err) {
      setReshError(err instanceof Error ? err.message : String(err));
    }
  };

  const saveReshaped = () => {
    if (!reshTable) return;
    const p = useProjectStore.getState().project;
    if (!p) {
      setReshError(t('labs.no_project'));
      return;
    }
    const base = safeName(
      `${(file || 'table').replace(/\.[^.]+$/, '')}-${reshKind === 'longer' ? 'long' : 'wide'}`,
    );
    void saveTextArtifact(p, 'data', `${base}.csv`, toCsvTable(reshTable))
      .then((path) => notify('success', t('labs.saved_ws', { path })))
      .catch((err) => setReshError(err instanceof Error ? err.message : String(err)));
  };

  return (
    <ToolShell toolId="analysis">
      <div className="analysis-body">
        {/* ---- Data source ---- */}
        <div className="analysis-row">
          <label className="analysis-label">{t('analysis.data_file')}</label>
          {fileGroups.project.length === 0 && fileGroups.examples.length === 0 ? (
            <span className="analysis-note">{t('analysis.no_data')}</span>
          ) : (
            <select className="input" value={file} onChange={(e) => void loadFile(e.target.value)}>
              <option value="">{t('analysis.select_file')}</option>
              {fileGroups.project.length > 0 && (
                <optgroup label={t('datafiles.group_project')}>
                  {fileGroups.project.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </optgroup>
              )}
              {fileGroups.examples.length > 0 && (
                <optgroup label={t('datafiles.group_examples')}>
                  {fileGroups.examples.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          )}
        </div>
        {parseError && <p className="analysis-error">{parseError}</p>}

        {table && (
          <>
            {/* ---- Chart builder ---- */}
            <h4 className="share-section-title">{t('analysis.chart')}</h4>
            <div className="analysis-row">
              <label className="analysis-label">{t('analysis.chart_type')}</label>
              <select
                className="input"
                value={chartKind}
                onChange={(e) => setChartKind(e.target.value as ChartKind)}
              >
                <option value="line">{t('analysis.kind_line')}</option>
                <option value="scatter">{t('analysis.kind_scatter')}</option>
                <option value="histogram">{t('analysis.kind_histogram')}</option>
                <option value="bar">{t('analysis.kind_bar')}</option>
              </select>
              {chartKind === 'line' || chartKind === 'scatter' ? (
                <>
                  <select className="input" value={xCol} onChange={(e) => setXCol(e.target.value)}>
                    {numericCols.map((c) => (
                      <option key={c} value={c}>
                        {t('analysis.x_column')}: {c}
                      </option>
                    ))}
                  </select>
                  <select className="input" value={yCol} onChange={(e) => setYCol(e.target.value)}>
                    {numericCols.map((c) => (
                      <option key={c} value={c}>
                        {t('analysis.y_column')}: {c}
                      </option>
                    ))}
                  </select>
                </>
              ) : (
                <select className="input" value={col} onChange={(e) => setCol(e.target.value)}>
                  {numericCols.map((c) => (
                    <option key={c} value={c}>
                      {t('analysis.column')}: {c}
                    </option>
                  ))}
                </select>
              )}
              <input
                className="input"
                placeholder={t('analysis.title_opt')}
                value={chartTitle}
                onChange={(e) => setChartTitle(e.target.value)}
              />
              <button type="button" className="btn btn-primary" onClick={generateChart}>
                {t('analysis.generate')}
              </button>
            </div>

            {preview && (
              <div className="analysis-preview">
                <div
                  className="analysis-svg"
                  dangerouslySetInnerHTML={{ __html: preview.markup }}
                />
                <div className="analysis-actions">
                  <button type="button" className="btn" onClick={onExportSvg}>
                    {t('analysis.export_svg')}
                  </button>
                  <button type="button" className="btn" onClick={onExportPdf}>
                    {t('analysis.export_pdf')}
                  </button>
                  <button type="button" className="btn" onClick={sendToFigure}>
                    {t('figure.send_to')}
                  </button>
                  <button type="button" className="btn btn-primary" onClick={onSaveToWorkspace}>
                    {t('labs.save_ws')}
                  </button>
                </div>
              </div>
            )}

            {/* ---- Descriptive ---- */}
            <h4 className="share-section-title">{t('analysis.descriptive')}</h4>
            <div className="analysis-row">
              <label className="analysis-label">{t('analysis.column')}</label>
              <select className="input" value={descCol} onChange={(e) => setDescCol(e.target.value)}>
                {numericCols.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <button type="button" className="btn" onClick={showSummary}>
                {t('analysis.compute')}
              </button>
            </div>
            {descText && <pre className="analysis-output">{descText}</pre>}

            {/* ---- Hypothesis test ---- */}
            <h4 className="share-section-title">{t('analysis.test_section')}</h4>
            <div className="analysis-row">
              <label className="analysis-label">{t('analysis.test_type')}</label>
              <select
                className="input"
                value={testKind}
                onChange={(e) => setTestKind(e.target.value as TestKind)}
              >
                <option value="t1">{t('analysis.t_test_one')}</option>
                <option value="t2">{t('analysis.t_test_two')}</option>
                <option value="mw">{t('analysis.mann_whitney')}</option>
                <option value="pearson">{t('analysis.pearson')}</option>
              </select>
              <select className="input" value={testA} onChange={(e) => setTestA(e.target.value)}>
                {numericCols.map((c) => (
                  <option key={c} value={c}>
                    A: {c}
                  </option>
                ))}
              </select>
              {testKind !== 't1' && (
                <select className="input" value={testB} onChange={(e) => setTestB(e.target.value)}>
                  {numericCols.map((c) => (
                    <option key={c} value={c}>
                      B: {c}
                    </option>
                  ))}
                </select>
              )}
              {testKind === 't1' && (
                <input
                  className="input"
                  style={{ maxWidth: 90 }}
                  aria-label={t('inference.mean')}
                  value={mu0}
                  onChange={(e) => setMu0(e.target.value)}
                />
              )}
              <button type="button" className="btn" onClick={runTest}>
                {t('analysis.run')}
              </button>
            </div>
            {testResult && (
              <>
                <pre className="analysis-output">{`${t('analysis.result')}: ${testResult}`}</pre>
                <div className="analysis-actions">
                  <button type="button" className="btn btn-primary" onClick={onSaveTestResult}>
                    {t('labs.save_ws')}
                  </button>
                </div>
              </>
            )}
            <NarrativePanel input={narrativeInput} />

            {/* ---- Multi-group comparisons / post-hoc ---- */}
            <h4 className="share-section-title">{t('analysis.adv_section')}</h4>
            <div className="analysis-row">
              <label className="analysis-label">{t('analysis.adv_method')}</label>
              <select
                className="input"
                value={advKind}
                onChange={(e) => {
                  setAdvKind(e.target.value as AdvKind);
                  setAdvResult('');
                }}
              >
                <option value="tukey">{t('analysis.adv_tukey')}</option>
                <option value="dunnett">{t('analysis.adv_dunnett')}</option>
                <option value="kruskal">{t('analysis.adv_kruskal')}</option>
              </select>
              <select
                className="input"
                value={advValue}
                onChange={(e) => {
                  setAdvValue(e.target.value);
                  setAdvResult('');
                }}
              >
                {numericCols.map((c) => (
                  <option key={c} value={c}>
                    {t('analysis.adv_value')}: {c}
                  </option>
                ))}
              </select>
              <select
                className="input"
                value={advGroup}
                onChange={(e) => {
                  setAdvGroup(e.target.value);
                  setAdvResult('');
                }}
              >
                <option value="">— {t('analysis.adv_group')} —</option>
                {allCols.map((c) => (
                  <option key={c} value={c}>
                    {t('analysis.adv_group')}: {c}
                  </option>
                ))}
              </select>
              {advKind === 'dunnett' && (
                <input
                  className="input"
                  placeholder={t('analysis.adv_control')}
                  value={advControl}
                  onChange={(e) => {
                    setAdvControl(e.target.value);
                    setAdvResult('');
                  }}
                />
              )}
              {advKind === 'kruskal' && (
                <select
                  className="input"
                  value={advCorrection}
                  onChange={(e) => {
                    setAdvCorrection(e.target.value as 'bonferroni' | 'bh');
                    setAdvResult('');
                  }}
                >
                  <option value="bonferroni">{t('analysis.adv_bonferroni')}</option>
                  <option value="bh">{t('analysis.adv_bh')}</option>
                </select>
              )}
              <input
                className="input research-num"
                title={t('analysis.adv_alpha')}
                aria-label={t('analysis.adv_alpha')}
                value={advAlpha}
                onChange={(e) => {
                  setAdvAlpha(e.target.value);
                  setAdvResult('');
                }}
              />
              <button type="button" className="btn" onClick={runAdvanced}>
                {t('analysis.run')}
              </button>
            </div>
            {advResult && <pre className="analysis-output">{advResult}</pre>}

            {/* ---- Survival ---- */}
            <h4 className="share-section-title">{t('analysis.survival')}</h4>
            <div className="analysis-row">
              <select className="input" value={survTime} onChange={(e) => setSurvTime(e.target.value)}>
                {numericCols.map((c) => (
                  <option key={c} value={c}>
                    {t('analysis.surv_time')}: {c}
                  </option>
                ))}
              </select>
              <select className="input" value={survEvent} onChange={(e) => setSurvEvent(e.target.value)}>
                <option value="">— {t('analysis.surv_event')} —</option>
                {allCols.map((c) => (
                  <option key={c} value={c}>
                    {t('analysis.surv_event')}: {c}
                  </option>
                ))}
              </select>
              <select className="input" value={survGroup} onChange={(e) => setSurvGroup(e.target.value)}>
                <option value="">{t('analysis.surv_no_group')}</option>
                {allCols.map((c) => (
                  <option key={c} value={c}>
                    {t('analysis.surv_group')}: {c}
                  </option>
                ))}
              </select>
              <button type="button" className="btn" onClick={runSurvival}>
                {t('analysis.run')}
              </button>
            </div>
            {survResult && <pre className="analysis-output">{survResult}</pre>}
            {survChart && (
              <div className="analysis-preview">
                <div
                  className="analysis-svg"
                  dangerouslySetInnerHTML={{ __html: survChart.markup }}
                />
                <div className="analysis-actions">
                  <button type="button" className="btn" onClick={sendSurvivalToFigure}>
                    {t('figure.send_to')}
                  </button>
                </div>
              </div>
            )}

            {/* ---- Psychometrics ---- */}
            <h4 className="share-section-title">{t('analysis.psy_section')}</h4>
            <div className="analysis-row">
              <label className="analysis-label">{t('analysis.psy_method')}</label>
              <select
                className="input"
                value={psyKind}
                onChange={(e) => {
                  setPsyKind(e.target.value as PsyKind);
                  setPsyResult('');
                }}
              >
                <option value="alpha">{t('analysis.psy_alpha')}</option>
                <option value="kmo">{t('analysis.psy_kmo')}</option>
                <option value="bartlett">{t('analysis.psy_bartlett')}</option>
              </select>
              <button type="button" className="btn" onClick={runPsychometrics}>
                {t('analysis.run')}
              </button>
            </div>
            <div className="model-predictors" title={t('analysis.psy_items')}>
              {numericCols.map((c) => (
                <label key={c} className="research-check">
                  <input
                    type="checkbox"
                    checked={itemCols.includes(c)}
                    onChange={() =>
                      setItemCols((prev) =>
                        prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c],
                      )
                    }
                  />
                  {c}
                </label>
              ))}
            </div>
            <p className="analysis-note">{t('analysis.psy_items_hint')}</p>
            {psyResult && <pre className="analysis-output">{psyResult}</pre>}

            {/* ---- Long / wide reshaping ---- */}
            <h4 className="share-section-title">{t('analysis.reshape_section')}</h4>
            <div className="analysis-row">
              <label className="analysis-label">{t('analysis.reshape_mode')}</label>
              <select
                className="input"
                value={reshKind}
                onChange={(e) => {
                  setReshKind(e.target.value as ReshapeKind);
                  setReshTable(null);
                  setReshError('');
                }}
              >
                <option value="longer">{t('analysis.reshape_longer')}</option>
                <option value="wider">{t('analysis.reshape_wider')}</option>
              </select>
              <input
                className="input"
                placeholder={t('analysis.reshape_ids')}
                value={reshIds}
                onChange={(e) => {
                  setReshIds(e.target.value);
                  setReshTable(null);
                }}
              />
              {reshKind === 'longer' ? (
                <>
                  <input
                    className="input"
                    placeholder={t('analysis.reshape_measures')}
                    value={reshMeasures}
                    onChange={(e) => {
                      setReshMeasures(e.target.value);
                      setReshTable(null);
                    }}
                  />
                  <input
                    className="input"
                    placeholder={t('analysis.reshape_names_to')}
                    value={reshNamesTo}
                    onChange={(e) => setReshNamesTo(e.target.value)}
                  />
                  <input
                    className="input"
                    placeholder={t('analysis.reshape_values_to')}
                    value={reshValuesTo}
                    onChange={(e) => setReshValuesTo(e.target.value)}
                  />
                </>
              ) : (
                <>
                  <select
                    className="input"
                    value={reshNamesFrom}
                    onChange={(e) => {
                      setReshNamesFrom(e.target.value);
                      setReshTable(null);
                    }}
                  >
                    <option value="">{t('analysis.reshape_names_from')}</option>
                    {allCols.map((c) => (
                      <option key={c} value={c}>
                        {t('analysis.reshape_names_from')}: {c}
                      </option>
                    ))}
                  </select>
                  <select
                    className="input"
                    value={reshValuesFrom}
                    onChange={(e) => {
                      setReshValuesFrom(e.target.value);
                      setReshTable(null);
                    }}
                  >
                    <option value="">{t('analysis.reshape_values_from')}</option>
                    {allCols.map((c) => (
                      <option key={c} value={c}>
                        {t('analysis.reshape_values_from')}: {c}
                      </option>
                    ))}
                  </select>
                  <input
                    className="input"
                    placeholder={t('analysis.reshape_prefix')}
                    value={reshPrefix}
                    onChange={(e) => setReshPrefix(e.target.value)}
                  />
                </>
              )}
              <button type="button" className="btn" onClick={runReshape}>
                {t('analysis.run')}
              </button>
            </div>
            {reshError && <p className="analysis-error">{reshError}</p>}
            {reshTable && (
              <>
                <div className="analysis-actions">
                  <button type="button" className="btn btn-primary" onClick={saveReshaped}>
                    {t('labs.save_ws')}
                  </button>
                </div>
                <div className="sweep-table-wrap">
                  <table className="sweep-table">
                    <thead>
                      <tr>
                        {reshTable.columnNames().map((c) => (
                          <th key={c}>{c}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {Array.from({ length: Math.min(20, reshTable.length) }, (_, i) => (
                        <tr key={i}>
                          {reshTable.columnNames().map((c) => {
                            const v = reshTable.getColumn(c)![i];
                            return (
                              <td key={c}>
                                {typeof v === 'number' ? num(v, 6) : v === undefined ? '—' : String(v)}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </ToolShell>
  );
}
