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
import {
  pipePressureDrop,
  thermalStack,
  type PipeInput,
  type ThermalLayer,
} from '@/core/engineering/calc';
import { materialProperty } from '@/core/engineering/materials';
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
        <ThermalSection />
      </div>
    </Page>
  );
}

// --- thermal resistance stack -----------------------------------------------

const THERMAL_LAYER_DEFAULT: ThermalLayer = { name: '', k: 0.2, thicknessMm: 2, areaCm2: 4 };

function ThermalSection() {
  const t = useT();
  const study = useEngineeringStore((s) => s.study);
  const { outputText } = useIndustrialOutput();
  const [powerW, setPowerW] = useState(5);
  const [ambientC, setAmbientC] = useState(25);
  const [hExternal, setHExternal] = useState(0);
  const [layers, setLayers] = useState<ThermalLayer[]>([
    { ...THERMAL_LAYER_DEFAULT, name: 'Si', k: 148, thicknessMm: 0.5, areaCm2: 4 },
    { ...THERMAL_LAYER_DEFAULT, name: 'TIM', k: 4, thicknessMm: 0.2, areaCm2: 4 },
    { ...THERMAL_LAYER_DEFAULT, name: 'Cu', k: 390, thicknessMm: 2, areaCm2: 4 },
  ]);
  const setLayer = (index: number, patch: Partial<ThermalLayer>) =>
    setLayers((ls) => ls.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  const result = useMemo(() => thermalStack({ powerW, ambientC, hExternal, layers }), [powerW, ambientC, hExternal, layers]);
  const exportCsv = (target: 'download' | 'save') => {
    const rows = [['layer', 'k_W_mK', 'thickness_mm', 'area_cm2', 'R_K_W', 'hot_side_C']];
    layers.forEach((l, i) => {
      rows.push([
        l.name || `layer-${i + 1}`,
        String(l.k),
        String(l.thicknessMm),
        String(l.areaCm2),
        result ? String(result.layerR[i] ?? '') : '',
        result ? String(result.layerHotC[i] ?? '') : '',
      ]);
    });
    rows.push(['total_R', '', '', '', result ? String(result.totalR) : '', '']);
    void outputText('results', `${artifactBaseName(study)}-thermal-stack.csv`, rows.map((r) => r.join(',')).join('\n'), target);
  };
  return (
    <section className="ind-card">
      <h3 className="ind-card-title">{t('industrial.calc.thermal.title')}</h3>
      <p className="ind-hint">{t('industrial.calc.thermal.desc')}</p>
      <div className="ind-toolbar analysis-row">
        <NumField label={t('industrial.calc.thermal.power')} unit="W" value={powerW} onChange={setPowerW} />
        <NumField label={t('industrial.calc.thermal.ambient')} unit="°C" value={ambientC} onChange={setAmbientC} />
        <NumField label={t('industrial.calc.thermal.h_ext')} unit="W/(m²·K)" value={hExternal} onChange={setHExternal} />
      </div>
      <div className="ind-geometry-list">
        {layers.map((layer, i) => (
          <div key={i} className="ind-row">
            <span className="tag">{layer.name || `#${i + 1}`}</span>
            <NumField label="k" unit="W/(m·K)" value={layer.k} onChange={(v) => setLayer(i, { k: v })} />
            <NumField label={t('industrial.calc.thermal.thickness')} unit="mm" value={layer.thicknessMm} onChange={(v) => setLayer(i, { thicknessMm: v })} />
            <NumField label={t('industrial.calc.thermal.area')} unit="cm²" value={layer.areaCm2} onChange={(v) => setLayer(i, { areaCm2: v })} />
            <button
              type="button"
              className="btn btn-sm"
              title={t('industrial.delete')}
              disabled={layers.length <= 1}
              onClick={() => setLayers((ls) => ls.filter((_, j) => j !== i))}
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <div className="ind-toolbar analysis-row">
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => setLayers((ls) => [...ls, { ...THERMAL_LAYER_DEFAULT }])}
        >
          {t('industrial.calc.thermal.add_layer')}
        </button>
        {study && study.materials.length > 0 && (
          <label className="ind-field">
            <span>{t('industrial.calc.thermal.from_material')}</span>
            <select
              className="input input-sm"
              value=""
              onChange={(e) => {
                const material = study.materials.find((m) => m.name === e.target.value);
                const k = material ? materialProperty(material, 'k', NaN) : NaN;
                if (Number.isFinite(k)) setLayers((ls) => [...ls, { ...THERMAL_LAYER_DEFAULT, name: material!.name, k }]);
              }}
            >
              <option value="">{t('industrial.calc.thermal.pick_material')}</option>
              {study.materials.map((m) => (
                <option key={m.name} value={m.name}>{m.name}</option>
              ))}
            </select>
          </label>
        )}
      </div>
      <div className="ind-calc-results">
        {layers.map((layer, i) => (
          <ResultRow
            key={i}
            label={`${t('industrial.calc.thermal.hot_side')} · ${layer.name || `#${i + 1}`}`}
            value={result?.layerHotC[i] ?? null}
            unit="°C"
          />
        ))}
        <ResultRow label={t('industrial.calc.thermal.total_r')} value={result?.totalR ?? null} unit="K/W" />
        <ResultRow label={t('industrial.calc.thermal.cold')} value={result?.coldC ?? null} unit="°C" />
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
