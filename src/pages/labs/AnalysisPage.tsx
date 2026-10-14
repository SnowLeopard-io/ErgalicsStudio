import { useMemo, useRef, useState } from 'react';
import { useT } from '@/i18n';
import { useProjectStore } from '@/stores/projectStore';
import { useAppStore } from '@/stores/appStore';
import { saveTextArtifact } from '@/core/workspace-artifacts';
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
} from '@/core/plot';
import { summary } from '@/core/stats/descriptive';
import { tTestOneSample, tTestTwoSample, mannWhitney } from '@/core/stats/tests';
import { pearson, studentTCdf, cohensD, mean, std } from '@/core/stats';
import type { NarrativeInput } from '@/core/stats/narrative';
import type { DataTable } from '@/types/datatable';
import type { SvgPlotPayload } from '@/core/plot/types';
import type { PlotSpec } from '@/core/plot';
import { sendSpecToFigure } from '../research/researchUi';
import { ToolShell } from '@/components/ToolShell';
import { NarrativePanel } from '@/components/NarrativePanel';

type ChartKind = 'line' | 'scatter' | 'histogram' | 'bar';
type TestKind = 't1' | 't2' | 'mw' | 'pearson';

function safeName(s: string): string {
  return s.replace(/[^\w.-]+/g, '-').slice(0, 60) || 'chart';
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
  /** Generation counter: lets a superseded async file load discard its result. */
  const loadGen = useRef(0);

  const numericCols = useMemo(
    () => (table ? table.columns.filter((c) => isNumericType(c.type)).map((c) => c.name) : []),
    [table],
  );

  const loadFile = async (name: string) => {
    setFile(name);
    setPreview(null);
    setPreviewSpec(null);
    setParseError('');
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

  /** Save the chart SVG into the project workspace (figures/). */
  const onSaveToWorkspace = () => {
    if (!preview) return;
    const project = useProjectStore.getState().project;
    if (!project) {
      setParseError(t('labs.no_project'));
      return;
    }
    void saveTextArtifact(
      project,
      'figures',
      `${safeName(baseName())}.svg`,
      preview.markup,
    )
      .then((path) => notify('success', t('labs.saved_ws', { path })))
      .catch((err) =>
        setParseError(err instanceof Error ? err.message : String(err)),
      );
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
          </>
        )}
      </div>
    </ToolShell>
  );
}
