// ==========================================================================
// Ergalics Studio — FR-14 data cleaning wizard tool page (ToolShell)
//
// Step-flow wizard over a project data file: add / reorder / undo cleaning
// steps (type conversion, missing policy, outlier flag, dedupe, rename),
// each step previewing its affected-row count and a sampled before/after
// table (navigation = applying a prefix of the step list). On finish the
// page shows the generated re-runnable `studio.*` Python script (editable)
// and offers two saves: into the project's code sessions (editor store) and
// the cleaned table as a NEW data file (the source file is never rewritten).
// All cleaning logic lives in @/core/cleaning; this file only orchestrates.
// ==========================================================================

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useT } from '@/i18n';
import { ToolShell } from '@/components/ToolShell';
import { useProjectStore } from '@/stores/projectStore';
import { useEditorStore } from '@/stores/editorStore';
import { listDataFilesGrouped, resolveDataFile, DATA_EXTS_SERIES } from '@/core/dataFiles';
import { parseCodeToIR } from '@/editor/code/parse';
import { hashString } from '@/core/repro/random';
import { useExperimentStore } from '@/stores/experimentStore';
import {
  parseTableText,
  tableToCsv,
  type CleaningTable,
} from '@/core/cleaning/table';
import {
  applySteps,
  previewStep,
  stepsToJson,
  validateSteps,
  DEFAULT_IQR_MULTIPLIER,
  DEFAULT_ZSCORE_CUTOFF,
  type CleaningStep,
  type CleaningStepError,
} from '@/core/cleaning/steps';
import { generateScript } from '@/core/cleaning/script';

const SAMPLE_ROWS = 5;

function newStepId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `step-${Math.random().toString(36).slice(2)}`;
}

function fmtCell(cell: unknown): string {
  if (cell === null || cell === undefined) return '';
  if (typeof cell === 'number') return Number.isInteger(cell) ? String(cell) : cell.toPrecision(6);
  return String(cell);
}

function isCleaningError(err: unknown): err is CleaningStepError {
  return err instanceof Error && 'code' in err && typeof (err as CleaningStepError).code === 'string';
}

export default function CleaningWizardPage() {
  const t = useT();
  const project = useProjectStore((s) => s.project);
  const addDataFile = useProjectStore((s) => s.addDataFile);

  const fileGroups = useMemo(
    () => listDataFilesGrouped(DATA_EXTS_SERIES),
    [project?.data.files],
  );
  const [fileName, setFileName] = useState('');
  const [source, setSource] = useState<CleaningTable | null>(null);
  const [parseError, setParseError] = useState('');

  const [steps, setSteps] = useState<CleaningStep[]>([]);
  const [current, setCurrent] = useState(0); // index of the step being reviewed
  const [script, setScript] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

  // ---- data source -----------------------------------------------------------

  const loadFile = useCallback(async (name: string) => {
    setFileName(name);
    setScript(null);
    setError('');
    setParseError('');
    if (!name) {
      setSource(null);
      return;
    }
    const text = await resolveDataFile(name);
    if (text === undefined) {
      setSource(null);
      setParseError(t('clean.error.parse', { msg: name }));
      return;
    }
    try {
      setSource(parseTableText(text, name));
      setSteps([]);
      setCurrent(0);
    } catch (err) {
      setSource(null);
      setParseError(t('clean.error.parse', { msg: err instanceof Error ? err.message : String(err) }));
    }
  }, [t]);

  useEffect(() => {
    if (fileName && !source && !parseError) void loadFile(fileName);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id]);

  // ---- step application state --------------------------------------------------

  const applied = useMemo(() => {
    if (!source) return null;
    try {
      return applySteps(source, steps.slice(0, current));
    } catch (err) {
      return { error: err } as const;
    }
  }, [source, steps, current]);

  const stepError = applied && 'error' in applied ? applied.error : null;
  const tableAt = applied && !('error' in applied) ? applied.table : null;

  const preview = useMemo(() => {
    if (!tableAt || !steps[current]) return null;
    try {
      return previewStep(tableAt, steps[current]!, SAMPLE_ROWS);
    } catch {
      return null;
    }
  }, [tableAt, steps, current]);

  const warnings = useMemo(
    () => (source ? validateSteps(steps, source.columns) : []),
    [source, steps],
  );

  // ---- step editing -----------------------------------------------------------

  const addStep = (step: CleaningStep) => {
    setSteps((prev) => [...prev.slice(0, current), step]);
    setCurrent((c) => c + 1);
    setScript(null);
    setError('');
  };

  const undoStep = (index: number) => {
    setSteps((prev) => prev.filter((_, i) => i !== index));
    setCurrent((c) => Math.min(c, index));
    setScript(null);
  };

  // ---- finish / save -----------------------------------------------------------

  const finish = () => {
    if (!source) return;
    try {
      applySteps(source, steps); // validate the full sequence before emitting
      setScript(generateScript(steps, { fileName }));
      setError('');
    } catch (err) {
      setError(isCleaningError(err) ? t(`clean.error.${err.code}`) : String(err));
    }
  };

  const saveSession = () => {
    if (script === null) return;
    const editor = useEditorStore.getState();
    const { program } = parseCodeToIR(script, 'python');
    const session = editor.createSession('code', 'python');
    editor.updateSessionIR(session.id, program, script);
    void useProjectStore.getState().save();
    setNote(t('clean.session_saved'));
  };

  const saveOutput = async () => {
    if (!source || !project) return;
    try {
      const result = applySteps(source, steps);
      const csv = tableToCsv(result.table);
      const base = fileName.replace(/\.[^.]+$/, '') || 'data';
      const name = `${base}-cleaned.csv`;
      const fileId = await addDataFile(new File([csv], name, { type: 'text/csv' }));
      await useExperimentStore.getState().recordRun({
        source: 'code',
        label: `cleaning: ${fileName}`,
        params: { steps: JSON.parse(stepsToJson(steps)), file: fileName },
        metrics: { rowsBefore: source.rows.length, rowsAfter: result.table.rows.length },
        durationMs: 0,
        inputsHash: hashString(fileName + source.rows.length),
        outputFileIds: fileId ? [fileId] : [],
      });
      setNote(t('clean.output_saved', { name }));
    } catch (err) {
      setError(isCleaningError(err) ? t(`clean.error.${err.code}`) : String(err));
    }
  };

  // ---- render ---------------------------------------------------------------

  const columns = tableAt?.columns ?? source?.columns ?? [];
  const step = steps[current];

  return (
    <ToolShell toolId="cleaning">
      <div className="analysis-body">
        {!project ? (
          <p className="analysis-note">{t('clean.need_project')}</p>
        ) : (
          <>
            {/* ---- source picker ---- */}
            <h4 className="share-section-title">{t('clean.source')}</h4>
            <div className="analysis-row">
              <select className="input" value={fileName} onChange={(e) => void loadFile(e.target.value)}>
                <option value="">{t('clean.pick_file')}</option>
                {fileGroups.project.length + fileGroups.examples.length === 0 && (
                  <option value="" disabled>{t('clean.no_files')}</option>
                )}
                {fileGroups.project.map((n) => (
                  <option key={`p:${n}`} value={n}>{n}</option>
                ))}
                {fileGroups.examples.map((n) => (
                  <option key={`e:${n}`} value={n}>{n}</option>
                ))}
              </select>
              {source && (
                <span className="analysis-note">
                  {t('clean.rows', { n: source.rows.length, m: source.columns.length })}
                </span>
              )}
            </div>
            {parseError && <p className="analysis-error">{parseError}</p>}

            {source && (
              <>
                {/* ---- stepper ---- */}
                <h4 className="share-section-title">{t('clean.steps')}</h4>
                <div className="clean-stepper">
                  {steps.map((s, i) => (
                    <button
                      key={s.id}
                      type="button"
                      className={`clean-step-dot ${i === current ? 'is-active' : ''} ${i < current ? 'is-done' : ''}`}
                      onClick={() => {
                        setCurrent(i);
                        setScript(null);
                      }}
                      title={t(`clean.step.${s.kind}`)}
                    >
                      {i + 1}
                    </button>
                  ))}
                  <button
                    type="button"
                    className={`clean-step-dot ${current >= steps.length ? 'is-active' : ''}`}
                    onClick={() => {
                      setCurrent(steps.length);
                      setScript(null);
                    }}
                    title={t('clean.done')}
                  >
                    ✓
                  </button>
                </div>
                {warnings.length > 0 && (
                  <p className="analysis-error">
                    {t('clean.warnings')}: {warnings.map((w) =>
                      t(`clean.warn.${w.code}`, { n: w.stepIndex + 1, col: w.column }),
                    ).join('; ')}
                  </p>
                )}
                {stepError && (
                  <p className="analysis-error">
                    {isCleaningError(stepError) ? t(`clean.error.${stepError.code}`) : String(stepError)}
                  </p>
                )}

                {/* ---- add step ---- */}
                <AddStepForm
                  columns={columns}
                  onAdd={addStep}
                />

                {/* ---- step list with undo ---- */}
                {steps.length === 0 ? (
                  <p className="analysis-note">{t('clean.no_steps')}</p>
                ) : (
                  <ul className="clean-step-list">
                    {steps.map((s, i) => (
                      <li key={s.id} className={i === current ? 'is-current' : undefined}>
                        <span>{t('clean.step_n', { n: i + 1 })} · {t(`clean.step.${s.kind}`)}</span>
                        <button type="button" className="btn btn-sm" onClick={() => undoStep(i)}>
                          {t('clean.undo_step')}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}

                {/* ---- current-step preview ---- */}
                {step && preview && (
                  <div className="clean-preview">
                    <h4 className="share-section-title">{t('clean.preview')}</h4>
                    <p className="analysis-note">
                      {t('clean.affected', { n: preview.affected })} · {t('clean.rows_change', { before: preview.rowsBefore, after: preview.rowsAfter })}
                    </p>
                    <p className="analysis-note">{t('clean.sample_note', { n: SAMPLE_ROWS })}</p>
                    <div className="clean-preview-grid">
                      <MiniTable title={t('clean.before')} columns={columns} rows={preview.before} />
                      <MiniTable title={t('clean.after')} columns={preview.afterColumns} rows={preview.after} />
                    </div>
                  </div>
                )}

                {/* ---- nav ---- */}
                <div className="analysis-row">
                  <button type="button" className="btn" disabled={current === 0} onClick={() => setCurrent((c) => Math.max(0, c - 1))}>
                    {t('clean.prev')}
                  </button>
                  <button
                    type="button"
                    className="btn"
                    disabled={current >= steps.length}
                    onClick={() => setCurrent((c) => Math.min(steps.length, c + 1))}
                  >
                    {t('clean.next')}
                  </button>
                  {current >= steps.length && steps.length > 0 && script === null && (
                    <button type="button" className="btn btn-primary" onClick={finish}>
                      {t('clean.done')}
                    </button>
                  )}
                </div>

                {/* ---- finish: script + saves ---- */}
                {script !== null && (
                  <div className="clean-done">
                    <h4 className="share-section-title">{t('clean.done')}</h4>
                    {tableAt && (
                      <p className="analysis-note">
                        {t('clean.summary', { n: steps.length, rows: tableAt.rows.length, cols: tableAt.columns.length })}
                      </p>
                    )}
                    <p className="analysis-note">{t('clean.script_hint')}</p>
                    <textarea
                      className="input clean-script"
                      rows={16}
                      spellCheck={false}
                      value={script}
                      onChange={(e) => setScript(e.target.value)}
                    />
                    <div className="analysis-row">
                      <button type="button" className="btn btn-primary" onClick={saveSession}>
                        {t('clean.save_session')}
                      </button>
                      <button type="button" className="btn" onClick={() => void saveOutput()}>
                        {t('clean.save_output')}
                      </button>
                    </div>
                  </div>
                )}
                {error && <p className="analysis-error">{error}</p>}
                {note && <p className="analysis-note">{note}</p>}
              </>
            )}
          </>
        )}
      </div>
    </ToolShell>
  );
}

// ---- mini table -------------------------------------------------------------

function MiniTable({ title, columns, rows }: { title: string; columns: string[]; rows: unknown[][] }) {
  return (
    <div className="clean-mini-table">
      <h5>{title}</h5>
      <table>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {columns.map((_, j) => (
                <td key={j}>{fmtCell(row[j])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---- add-step form ----------------------------------------------------------

type NewKind = 'convert' | 'missing' | 'outlier' | 'dedupe' | 'rename';

function AddStepForm({ columns, onAdd }: { columns: string[]; onAdd: (s: CleaningStep) => void }) {
  const t = useT();
  const [kind, setKind] = useState<NewKind>('convert');
  const [column, setColumn] = useState('');
  const [target, setTarget] = useState<'number' | 'string' | 'boolean'>('number');
  const [strategy, setStrategy] = useState<'drop' | 'mean' | 'median' | 'zero' | 'ffill'>('mean');
  const [method, setMethod] = useState<'iqr' | 'zscore'>('iqr');
  const [threshold, setThreshold] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [keys, setKeys] = useState<string[]>([]);

  useEffect(() => {
    if (!column && columns.length > 0) setColumn(columns[0]!);
    if (!from && columns.length > 0) setFrom(columns[0]!);
  }, [columns, column, from]);

  const needsColumn = kind !== 'dedupe' && kind !== 'rename';
  const valid =
    (kind === 'convert' || kind === 'missing' || kind === 'outlier' ? Boolean(column) : true) &&
    (kind === 'rename' ? Boolean(from) && to.trim().length > 0 : true);

  const apply = () => {
    const id = newStepId();
    switch (kind) {
      case 'convert':
        onAdd({ id, kind: 'convert', column, target });
        break;
      case 'missing':
        onAdd({ id, kind: 'missing', column, strategy });
        break;
      case 'outlier': {
        const parsed = Number(threshold);
        const def = method === 'iqr' ? DEFAULT_IQR_MULTIPLIER : DEFAULT_ZSCORE_CUTOFF;
        onAdd({
          id,
          kind: 'outlier',
          column,
          method,
          threshold: Number.isFinite(parsed) && parsed > 0 ? parsed : def,
        });
        break;
      }
      case 'dedupe':
        onAdd({ id, kind: 'dedupe', columns: keys });
        break;
      case 'rename':
        onAdd({ id, kind: 'rename', from, to: to.trim() });
        break;
    }
    setTo('');
    setKeys([]);
    setThreshold('');
  };

  return (
    <div className="clean-add">
      <div className="analysis-row">
        <select className="input" value={kind} onChange={(e) => setKind(e.target.value as NewKind)}>
          <option value="convert">{t('clean.step.convert')}</option>
          <option value="missing">{t('clean.step.missing')}</option>
          <option value="outlier">{t('clean.step.outlier')}</option>
          <option value="dedupe">{t('clean.step.dedupe')}</option>
          <option value="rename">{t('clean.step.rename')}</option>
        </select>

        {needsColumn && (
          <select className="input" value={column} onChange={(e) => setColumn(e.target.value)}>
            {columns.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        )}
        {kind === 'convert' && (
          <select className="input" value={target} onChange={(e) => setTarget(e.target.value as typeof target)}>
            <option value="number">{t('clean.convert.number')}</option>
            <option value="string">{t('clean.convert.string')}</option>
            <option value="boolean">{t('clean.convert.boolean')}</option>
          </select>
        )}
        {kind === 'missing' && (
          <select className="input" value={strategy} onChange={(e) => setStrategy(e.target.value as typeof strategy)}>
            <option value="drop">{t('clean.missing.drop')}</option>
            <option value="mean">{t('clean.missing.mean')}</option>
            <option value="median">{t('clean.missing.median')}</option>
            <option value="zero">{t('clean.missing.zero')}</option>
            <option value="ffill">{t('clean.missing.ffill')}</option>
          </select>
        )}
        {kind === 'outlier' && (
          <>
            <select className="input" value={method} onChange={(e) => setMethod(e.target.value as typeof method)}>
              <option value="iqr">{t('clean.outlier.iqr')}</option>
              <option value="zscore">{t('clean.outlier.zscore')}</option>
            </select>
            <input
              className="input"
              style={{ maxWidth: 100 }}
              type="number"
              min={0}
              step="0.1"
              value={threshold}
              placeholder={t('clean.outlier.threshold')}
              onChange={(e) => setThreshold(e.target.value)}
            />
          </>
        )}
        {kind === 'rename' && (
          <>
            <select className="input" value={from} onChange={(e) => setFrom(e.target.value)}>
              {columns.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            <input className="input" style={{ maxWidth: 160 }} value={to} placeholder={t('clean.rename.to')} onChange={(e) => setTo(e.target.value)} />
          </>
        )}
        {kind === 'dedupe' && (
          <select
            className="input"
            multiple
            size={Math.min(4, Math.max(1, columns.length))}
            value={keys}
            onChange={(e) => setKeys(Array.from(e.target.selectedOptions).map((o) => o.value))}
          >
            {columns.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        )}
        <button type="button" className="btn btn-primary" disabled={!valid} onClick={apply}>
          {t('clean.apply')}
        </button>
      </div>
      {kind === 'dedupe' && <p className="analysis-note">{t('clean.dedupe.keys')}</p>}
    </div>
  );
}
