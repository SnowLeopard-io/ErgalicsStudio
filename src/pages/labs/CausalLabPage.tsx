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
    const t = treatment;
    const y = outcome;
    const usedSet = sets[0] ?? [];
    const missing = usedSet.filter((name) => !rows.some((row) => name in row));
    if (missing.length > 0) return { ...EMPTY, sets, paths, error: `missing-column:${missing[0]}` };

    const treatmentValues: number[] = [];
    const outcomes: number[] = [];
    const covariates: number[][] = [];
    const groups: { group: number; period: number; y: number }[] = [];
    const hasDid = rows.every((row) => 'group' in row && 'period' in row);
    for (const row of rows) {
      const tv = Number(row[t]);
      const yv = Number(row[y]);
      if (!Number.isFinite(tv) || !Number.isFinite(yv)) continue;
      const cov = usedSet.map((name) => Number(row[name]));
      if (cov.some((v) => !Number.isFinite(v))) continue;
      treatmentValues.push(tv);
      outcomes.push(yv);
      covariates.push(cov);
      if (hasDid) {
        groups.push({
          group: Number(row['group']),
          period: Number(row['period']),
          y: yv,
        });
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
  const result = useMemo(() => analyze(dag, treatment, outcome, csv), [dag, treatment, outcome, csv]);

  return (
    <ToolShell toolId="causal-lab">
      <div className="util-page">
        <p className="analysis-note">{t('causalLab.intro')}</p>

        <div className="util-card">
          <h2 className="util-card-title">{t('causalLab.graph')}</h2>
          <p className="util-note">{t('causalLab.graph_hint')}</p>
          <textarea
            className="input util-mono causal-input"
            value={dag}
            spellCheck={false}
            aria-label={t('causalLab.graph')}
            onChange={(e) => setDag(e.target.value)}
          />
          <div className="util-row">
            <label>
              {t('causalLab.treatment')}{' '}
              <input
                className="input causal-small"
                value={treatment}
                onChange={(e) => setTreatment(e.target.value.trim())}
              />
            </label>
            <label>
              {t('causalLab.outcome')}{' '}
              <input
                className="input causal-small"
                value={outcome}
                onChange={(e) => setOutcome(e.target.value.trim())}
              />
            </label>
          </div>
        </div>

        <div className="util-card">
          <h2 className="util-card-title">{t('causalLab.data')}</h2>
          <p className="util-note">{t('causalLab.data_hint')}</p>
          <textarea
            className="input util-mono causal-input"
            value={csv}
            spellCheck={false}
            aria-label={t('causalLab.data')}
            onChange={(e) => setCsv(e.target.value)}
          />
          <div className="util-row util-between">
            <span className="util-note">
              {result.rows > 0 ? t('causalLab.rows', { count: result.rows }) : ''}
            </span>
            <button type="button" className="btn" onClick={() => setCsv(sampleCsv())}>
              {t('causalLab.sample')}
            </button>
          </div>
        </div>

        {result.error && <p className="util-error">{t('causalLab.error', { reason: result.error })}</p>}

        <div className="util-card">
          <h2 className="util-card-title">{t('causalLab.adjustment')}</h2>
          <p className="util-note">{t('causalLab.adjustment_hint')}</p>
          <div className="util-row">
            {result.sets.map((set) => (
              <code key={set.join(',')} className="causal-chip">
                {set.length === 0 ? '[]' : set.join(', ')}
              </code>
            ))}
          </div>
          <h3 className="util-card-title">{t('causalLab.paths')}</h3>
          {result.paths.length === 0 ? (
            <p className="util-note">{t('causalLab.paths_none')}</p>
          ) : (
            <ul>
              {result.paths.map((path) => (
                <li key={path.join('-')} className="util-mono">{path.join(' → ')}</li>
              ))}
            </ul>
          )}
        </div>

        {result.ipw && (
          <div className="util-card">
            <h2 className="util-card-title">{t('causalLab.ate')}</h2>
            <p className="util-note">
              {t('causalLab.ate_hint', {
                n: result.rows,
                set: result.usedSet.length === 0 ? '[]' : result.usedSet.join(', '),
              })}
            </p>
            <div className="qs-grid">
              <div className="qs-stat">
                <span className="qs-stat-label">{t('causalLab.ate')}</span>
                <span className="util-mono qs-stat-value">{fmt(result.ipw.ate)}</span>
              </div>
              <div className="qs-stat">
                <span className="qs-stat-label">{t('causalLab.ess')}</span>
                <span className="util-mono qs-stat-value">{fmt(result.ipw.effectiveSampleSize)}</span>
              </div>
              <div className="qs-stat">
                <span className="qs-stat-label">{t('causalLab.mean_weight')}</span>
                <span className="util-mono qs-stat-value">{fmt(result.ipw.meanWeight)}</span>
              </div>
            </div>
          </div>
        )}

        <div className="util-card">
          <h2 className="util-card-title">{t('causalLab.did')}</h2>
          <p className="util-note">{t('causalLab.did_hint')}</p>
          {result.did ? (
            <div className="qs-grid">
              <div className="qs-stat">
                <span className="qs-stat-label">{t('causalLab.att')}</span>
                <span className="util-mono qs-stat-value">{fmt(result.did.att)}</span>
              </div>
              <div className="qs-stat">
                <span className="qs-stat-label">{t('causalLab.treated_change')}</span>
                <span className="util-mono qs-stat-value">{fmt(result.did.treatedChange)}</span>
              </div>
              <div className="qs-stat">
                <span className="qs-stat-label">{t('causalLab.control_change')}</span>
                <span className="util-mono qs-stat-value">{fmt(result.did.controlChange)}</span>
              </div>
              <div className="qs-stat">
                <span className="qs-stat-label">{t('causalLab.se')}</span>
                <span className="util-mono qs-stat-value">{fmt(result.did.standardError)}</span>
              </div>
              <div className="qs-stat">
                <span className="qs-stat-label">{t('causalLab.ci95')}</span>
                <span className="util-mono qs-stat-value">
                  [{fmt(result.did.confidenceInterval[0])}, {fmt(result.did.confidenceInterval[1])}]
                </span>
              </div>
            </div>
          ) : (
            <p className="util-note">{t('causalLab.no_did')}</p>
          )}
        </div>
      </div>
    </ToolShell>
  );
}
