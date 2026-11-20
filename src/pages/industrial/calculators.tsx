// ==========================================================================
// Ergalics Studio — engineering calculators page
//
// Mesh-free closed-form estimates for daily engineering checks (pipe
// pressure drop, thermal stacks, beam sizing, fatigue, tolerance chains,
// safety factors). Each section computes live from its inputs — no solve
// step, no study required. Kernels live in core/engineering/calc.ts.
// ==========================================================================

import { useMemo, useState } from 'react';
import { useT } from '@/i18n';
import { pipePressureDrop, type PipeInput } from '@/core/engineering/calc';
import { artifactBaseName, useIndustrialOutput } from './artifacts';
import { useEngineeringStore } from '@/stores/engineeringStore';
import { ExportGroups, Page, PageHead } from './shared';

/** One numeric input of a calculator form. */
function NumField({ label, unit, value, onChange, step = 'any' }: {
  label: string;
  unit: string;
  value: number;
  onChange: (v: number) => void;
  step?: string | number;
}) {
  return (
    <label className="ind-field">
      <span>{label}</span>
      <span className="ind-calc-field">
        <input className="input input-sm" type="number" step={step} value={value}
          onChange={(e) => onChange(Number(e.target.value))} />
        <span className="ind-calc-unit">{unit}</span>
      </span>
    </label>
  );
}

/** A named result row; `null` values render as em dashes. */
function ResultRow({ label, value, unit }: { label: string; value: number | string | null; unit?: string }) {
  const text = value === null
    ? '—'
    : typeof value === 'number'
      ? (Number.isFinite(value) ? (Math.abs(value) >= 1e5 || (Math.abs(value) > 0 && Math.abs(value) < 1e-3) ? value.toExponential(3) : value.toPrecision(4)) : '∞')
      : value;
  return (
    <div className="ind-row">
      <span>{label}</span>
      <span className="mono">{text}{unit && value !== null ? ` ${unit}` : ''}</span>
    </div>
  );
}

// --- pipe pressure drop ------------------------------------------------------

const PIPE_DEFAULTS: PipeInput = {
  flowM3h: 6,
  diameterMm: 40,
  lengthM: 12,
  roughnessUm: 50,
  densityKgM3: 998,
  viscosityPaS: 1.002e-3,
  fittingsK: 2.5,
};

function PipeSection() {
  const t = useT();
  const study = useEngineeringStore((s) => s.study);
  const { outputText } = useIndustrialOutput();
  const [input, setInput] = useState<PipeInput>(PIPE_DEFAULTS);
  const set = (key: keyof PipeInput) => (v: number) => setInput((s) => ({ ...s, [key]: v }));
  const result = useMemo(() => pipePressureDrop(input), [input]);
  const exportCsv = (target: 'download' | 'save') => {
    const rows = [
      ['quantity', 'value', 'unit'],
      ['flow', String(input.flowM3h), 'm3/h'],
      ['diameter', String(input.diameterMm), 'mm'],
      ['length', String(input.lengthM), 'm'],
      ['roughness', String(input.roughnessUm), 'um'],
      ['density', String(input.densityKgM3), 'kg/m3'],
      ['viscosity', String(input.viscosityPaS), 'Pa.s'],
      ['fittings_k', String(input.fittingsK), '-'],
      ['velocity', result ? String(result.velocity) : '', 'm/s'],
      ['reynolds', result ? String(result.reynolds) : '', '-'],
      ['friction_factor', result ? String(result.frictionFactor) : '', '-'],
      ['regime', result?.regime ?? '', '-'],
      ['dp_friction', result ? String(result.dpFriction) : '', 'Pa'],
      ['dp_fittings', result ? String(result.dpFittings) : '', 'Pa'],
      ['dp_total', result ? String(result.dpTotal) : '', 'Pa'],
    ];
    void outputText('results', `${artifactBaseName(study)}-pipe-dp.csv`, rows.map((r) => r.join(',')).join('\n'), target);
  };
  return (
    <section className="ind-card">
      <h3 className="ind-card-title">{t('industrial.calc.pipe.title')}</h3>
      <p className="ind-hint">{t('industrial.calc.pipe.desc')}</p>
      <div className="ind-toolbar analysis-row">
        <NumField label={t('industrial.calc.pipe.flow')} unit="m³/h" value={input.flowM3h} onChange={set('flowM3h')} />
        <NumField label={t('industrial.calc.pipe.diameter')} unit="mm" value={input.diameterMm} onChange={set('diameterMm')} />
        <NumField label={t('industrial.calc.pipe.length')} unit="m" value={input.lengthM} onChange={set('lengthM')} />
        <NumField label={t('industrial.calc.pipe.roughness')} unit="µm" value={input.roughnessUm} onChange={set('roughnessUm')} />
      </div>
      <div className="ind-toolbar analysis-row">
        <NumField label={t('industrial.calc.pipe.density')} unit="kg/m³" value={input.densityKgM3} onChange={set('densityKgM3')} />
        <NumField label={t('industrial.calc.pipe.viscosity')} unit="Pa·s" value={input.viscosityPaS} onChange={set('viscosityPaS')} />
        <NumField label={t('industrial.calc.pipe.fittings')} unit="ΣK" value={input.fittingsK} onChange={set('fittingsK')} />
      </div>
      <div className="ind-calc-results">
        <ResultRow label={t('industrial.calc.pipe.velocity')} value={result?.velocity ?? null} unit="m/s" />
        <ResultRow label={t('industrial.calc.pipe.reynolds')} value={result?.reynolds ?? null} />
        <ResultRow label={t('industrial.calc.pipe.friction')} value={result?.frictionFactor ?? null} />
        <ResultRow label={t('industrial.calc.pipe.regime')} value={result ? t(`industrial.calc.pipe.${result.regime}`) : null} />
        <ResultRow label={t('industrial.calc.pipe.dp_friction')} value={result ? result.dpFriction / 1000 : null} unit="kPa" />
        <ResultRow label={t('industrial.calc.pipe.dp_fittings')} value={result ? result.dpFittings / 1000 : null} unit="kPa" />
        <ResultRow label={t('industrial.calc.pipe.dp_total')} value={result ? result.dpTotal / 1000 : null} unit="kPa" />
      </div>
      <ExportGroups
        items={[{
          label: t('industrial.calc.export_csv'),
          onDownload: () => exportCsv('download'),
          onSave: () => exportCsv('save'),
        }]}
      />
    </section>
  );
}

export function CalculatorsPage() {
  const t = useT();
  return (
    <Page toolId="engineering-calc">
      <div className="ind-page analysis-body">
        <PageHead toolId="engineering-calc" title={t('tool.engineering-calc.title')} />
        <PipeSection />
      </div>
    </Page>
  );
}
