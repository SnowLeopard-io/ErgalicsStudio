// ==========================================================================
// Ergalics Studio — Causal Lab (research tool)
//
// The causal core (src/core/causal) answers two questions researchers ask
// before trusting an effect estimate:
//   1. Which covariates must be controlled?  → back-door adjustment sets.
//   2. How large is the effect?               → IPW / difference-in-differences.
// The DAG text decides (1); the pasted CSV supplies every number in (2).
// ==========================================================================

import { useMemo, useState } from 'react';
import { useT } from '@/i18n';
import { ToolShell } from '@/components/ToolShell';
import { DataFilePickField } from '@/components/DataFilePickerModal';
import { resolveDataFile } from '@/core/dataFiles';
import { parseDataRows } from '@/core/dataeng/schema';
import {
  backdoorPaths,
  findAdjustmentSets,
  type CausalGraph,
} from '@/core/causal';
import { didEstimate, ipwAte, type DidResult, type IpwResult } from '@/core/causal';

const SAMPLE_DAG = 'X -> T\nX -> Y\nT -> Y';
const SAMPLE_OUTCOME = 'Y';
const SAMPLE_TREATMENT = 'T';

function sampleCsv(): string {
  let state = 12345;
  const next = (): number => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
  const lines = ['X,T,Y,period,group'];
  for (let i = 0; i < 400; i += 1) {
    const x = next() < 0.5 ? 0 : 1;
    const period = i % 2;
    // The true effect of X on Y is 2 + 4 * E[period] = 4; the DiD ATT is 4.
    const y = 1 + 2 * x + 3 * period + (x === 1 && period === 1 ? 4 : 0) + (next() - 0.5);
    lines.push(`${x},${x},${y.toFixed(4)},${period},${x}`);
  }
  return lines.join('\n');
}

function parseGraph(text: string): CausalGraph {
  const edges: Array<[string, string]> = [];
  const nodes = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_]\w*)\s*->\s*([A-Za-z_]\w*)\s*$/.exec(line);
    if (!match) continue;
    const from = match[1]!;
    const to = match[2]!;
    edges.push([from, to]);
    nodes.add(from);
    nodes.add(to);
  }
  return { nodes: [...nodes], edges };
}

function fmt(value: number): string {
  return Number.isFinite(value) ? String(Number(value.toPrecision(6))) : '—';
}

interface Analysis {
  sets: string[][];
  paths: string[][];
  ipw: IpwResult | null;
  did: DidResult | null;
  usedSet: string[];
  rows: number;
  error: string | null;
}

const EMPTY: Analysis = { sets: [], paths: [], ipw: null, did: null, usedSet: [], rows: 0, error: null };

function analyze(dag: string, treatment: string, outcome: string, csv: string): Analysis {
  if (!treatment || !outcome) return { ...EMPTY, error: 'treatment/outcome' };
  const graph = parseGraph(dag);
  if (!graph.nodes.includes(treatment) || !graph.nodes.includes(outcome)) {
    return { ...EMPTY, error: 'unknown-node' };
  }
  const sets = findAdjustmentSets(graph, treatment, outcome, { maxSize: 2 });
  const paths = backdoorPaths(graph, treatment, outcome).map((path) => path.nodes);
  if (csv.trim() === '') return { ...EMPTY, sets, paths };

  try {
    const rows = parseDataRows(csv, 'csv');
    const usedSet = sets[0] ?? [];
    const missing = usedSet.filter((name) => !rows.some((row) => name in row));
    if (missing.length > 0) return { ...EMPTY, sets, paths, error: `missing-column:${missing[0]}` };

    const treatmentValues: number[] = [];
    const outcomes: number[] = [];
    const covariates: number[][] = [];
    const groups: { group: number; period: number; y: number }[] = [];
    const hasDid = rows.every((row) => 'group' in row && 'period' in row);
    for (const row of rows) {
      const tv = Number(row[treatment]);
      const yv = Number(row[outcome]);
      if (!Number.isFinite(tv) || !Number.isFinite(yv)) continue;
      const cov = usedSet.map((name) => Number(row[name]));
      if (cov.some((v) => !Number.isFinite(v))) continue;
      treatmentValues.push(tv);
      outcomes.push(yv);
      covariates.push(cov);
      if (hasDid) {
        groups.push({ group: Number(row['group']), period: Number(row['period']), y: yv });
      }
    }
    if (treatmentValues.length === 0) return { ...EMPTY, sets, paths, error: 'no-rows' };

    const ipw = ipwAte({ treatment: treatmentValues, outcomes, covariates });
    let did: DidResult | null = null;
    if (hasDid && groups.length > 0) {
      const pick = (group: number, period: number) =>
        groups.filter((g) => g.group === group && g.period === period).map((g) => g.y);
      const treatedBefore = pick(1, 0);
      const treatedAfter = pick(1, 1);
      const controlBefore = pick(0, 0);
      const controlAfter = pick(0, 1);
      if (
        treatedBefore.length > 0 && treatedAfter.length > 0 &&
        controlBefore.length > 0 && controlAfter.length > 0
      ) {
        did = didEstimate({
          treated: { before: treatedBefore, after: treatedAfter },
          control: { before: controlBefore, after: controlAfter },
        });
      }
    }
    return { sets, paths, ipw, did, usedSet, rows: treatmentValues.length, error: null };
  } catch (err) {
    return { ...EMPTY, sets, paths, error: err instanceof Error ? err.message : String(err) };
  }
}

export default function CausalLabPage() {
  const t = useT();
  const [dag, setDag] = useState(SAMPLE_DAG);
  const [treatment, setTreatment] = useState(SAMPLE_TREATMENT);
  const [outcome, setOutcome] = useState(SAMPLE_OUTCOME);
  const [csv, setCsv] = useState(sampleCsv);
  const [file, setFile] = useState('');
  const result = useMemo(() => analyze(dag, treatment, outcome, csv), [dag, treatment, outcome, csv]);

  // Project data files are loaded through the shared file-picker panel; the
  // CSV text is mirrored into the textarea so the user can still edit it.
  const loadProjectFile = async (name: string) => {
    setFile(name);
    if (!name) return;
    const text = await resolveDataFile(name);
    if (text !== undefined) setCsv(text);
  };

  const adjustmentRows = result.sets.map((set) => [set.length === 0 ? '∅' : set.join(', ')]);
  const ipwRows = result.ipw
    ? [
        [t('causalLab.ate'), fmt(result.ipw.ate)],
        [t('causalLab.ess'), fmt(result.ipw.effectiveSampleSize)],
        [t('causalLab.mean_weight'), fmt(result.ipw.meanWeight)],
      ]
    : [];
  const didRows = result.did
    ? [
        [t('causalLab.att'), fmt(result.did.att)],
        [t('causalLab.treated_change'), fmt(result.did.treatedChange)],
        [t('causalLab.control_change'), fmt(result.did.controlChange)],
        [t('causalLab.se'), fmt(result.did.standardError)],
        [t('causalLab.ci95'),
          `[${fmt(result.did.confidenceInterval[0])}, ${fmt(result.did.confidenceInterval[1])}]`],
      ]
    : [];

  return (
    <ToolShell toolId="causal-lab">
      <div className="analysis-body">
        <div className="analysis-row">
          <DataFilePickField
            value={file}
            placeholderKey="causalLab.data_file"
            onChange={(name) => void loadProjectFile(name)}
          />
          <span className="analysis-label">{t('causalLab.treatment')}</span>
          <input
            className="input research-num"
            value={treatment}
            aria-label={t('causalLab.treatment')}
            onChange={(e) => setTreatment(e.target.value.trim())}
          />
          <span className="analysis-label">{t('causalLab.outcome')}</span>
          <input
            className="input research-num"
            value={outcome}
            aria-label={t('causalLab.outcome')}
            onChange={(e) => setOutcome(e.target.value.trim())}
          />
          <button type="button" className="btn" onClick={() => setCsv(sampleCsv())}>
            {t('causalLab.sample')}
          </button>
        </div>

        <div className="analysis-row model-cols">
          <div className="causal-pane">
            <h4 className="share-section-title">{t('causalLab.graph')}</h4>
            <textarea
              className="input util-mono causal-input"
              value={dag}
              spellCheck={false}
              aria-label={t('causalLab.graph')}
              onChange={(e) => setDag(e.target.value)}
            />
          </div>
          <div className="causal-pane">
            <h4 className="share-section-title">{t('causalLab.data')}</h4>
            <textarea
              className="input util-mono causal-input"
              value={csv}
              spellCheck={false}
              aria-label={t('causalLab.data')}
              onChange={(e) => setCsv(e.target.value)}
            />
            <p className="analysis-note">
              {result.rows > 0 ? t('causalLab.rows', { count: result.rows }) : ''}
            </p>
          </div>
        </div>

        {result.error && <p className="analysis-error">{t('causalLab.error', { reason: result.error })}</p>}

        <h4 className="share-section-title">{t('causalLab.adjustment')}</h4>
        <div className="sweep-table-wrap">
          <table className="sweep-table">
            <thead><tr><th>{t('causalLab.adjustment')}</th></tr></thead>
            <tbody>
              {adjustmentRows.map((row, i) => (
                <tr key={i}><td><code>{row[0]}</code></td></tr>
              ))}
            </tbody>
          </table>
        </div>

        <h4 className="share-section-title">{t('causalLab.paths')}</h4>
        {result.paths.length === 0 ? (
          <p className="analysis-note">{t('causalLab.paths_none')}</p>
        ) : (
          <div className="sweep-table-wrap">
            <table className="sweep-table">
              <thead><tr><th>{t('causalLab.paths')}</th></tr></thead>
              <tbody>
                {result.paths.map((path) => (
                  <tr key={path.join('-')}><td className="util-mono">{path.join(' → ')}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <h4 className="share-section-title">{t('causalLab.ate')}</h4>
        {result.ipw ? (
          <>
            <div className="sweep-table-wrap">
              <table className="sweep-table">
                <tbody>
                  {ipwRows.map((row) => (
                    <tr key={row[0]}><th>{row[0]}</th><td className="util-mono">{row[1]}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <p className="analysis-note">—</p>
        )}

        <h4 className="share-section-title">{t('causalLab.did')}</h4>
        {result.did ? (
          <div className="sweep-table-wrap">
            <table className="sweep-table">
              <tbody>
                {didRows.map((row) => (
                  <tr key={row[0]}><th>{row[0]}</th><td className="util-mono">{row[1]}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="analysis-note">{t('causalLab.no_did')}</p>
        )}
      </div>
    </ToolShell>
  );
}
