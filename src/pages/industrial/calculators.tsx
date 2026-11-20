// ==========================================================================
// Ergalics Studio — engineering calculators page
//
// Mesh-free closed-form estimates for daily engineering checks (pipe
// pressure drop, thermal stacks, beam sizing, fatigue, tolerance chains,
// safety factors). Each section computes live from its inputs — no solve
// step, no study required. Kernels live in core/engineering/calc.ts.
// ==========================================================================

import { useMemo, useState, type ComponentType } from 'react';
import { useT } from '@/i18n';
import { EmptyState } from '@/components/EmptyState';
import {
  beamQuick,
  fatigueLife,
  pipePressureDrop,
  safetyFactor,
  thermalStack,
  toleranceChain,
  type BeamInput,
  type FatigueRow,
  type PipeInput,
  type ThermalLayer,
  type ToleranceItem,
} from '@/core/engineering/calc';
import { materialProperty } from '@/core/engineering/materials';
import { artifactBaseName, useIndustrialOutput } from './artifacts';
import { useEngineeringStore } from '@/stores/engineeringStore';
import { ExportGroups, IndustrialActions, Page, PageHead } from './shared';

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

// Registry of calculator sections. The sidebar renders the compact nav; the
// canvas empty state renders the card grid. Both pick the same entry.
const CALCULATORS: { id: string; titleKey: string; descKey: string; Section: ComponentType }[] = [
  { id: 'pipe', titleKey: 'industrial.calc.pipe.title', descKey: 'industrial.calc.pipe.desc', Section: PipeSection },
  { id: 'thermal', titleKey: 'industrial.calc.thermal.title', descKey: 'industrial.calc.thermal.desc', Section: ThermalSection },
  { id: 'beam', titleKey: 'industrial.calc.beam.title', descKey: 'industrial.calc.beam.desc', Section: BeamSection },
  { id: 'fatigue', titleKey: 'industrial.calc.fatigue.title', descKey: 'industrial.calc.fatigue.desc', Section: FatigueSection },
  { id: 'tolerance', titleKey: 'industrial.calc.tol.title', descKey: 'industrial.calc.tol.desc', Section: ToleranceSection },
  { id: 'safety', titleKey: 'industrial.calc.safety.title', descKey: 'industrial.calc.safety.desc', Section: SafetySection },
];

/** Compact vertical nav used in the sidebar action bar. */
function CalculatorList({ active, onPick }: { active: string | null; onPick: (id: string) => void }) {
  const t = useT();
  return (
    <div className="ind-calc-nav">
      {CALCULATORS.map(({ id, titleKey }) => (
        <button
          key={id}
          type="button"
          className={`ind-calc-nav-item${active === id ? ' is-active' : ''}`}
          onClick={() => onPick(id)}
        >
          {t(titleKey)}
        </button>
      ))}
    </div>
  );
}

/** Card grid shown on the canvas before an algorithm is chosen. */
function CalculatorGrid({ onPick }: { onPick: (id: string) => void }) {
  const t = useT();
  return (
    <div className="ind-calc-grid">
      {CALCULATORS.map(({ id, titleKey, descKey }) => (
        <button key={id} type="button" className="ind-calc-card" onClick={() => onPick(id)}>
          <span className="ind-calc-card-title">{t(titleKey)}</span>
          <span className="ind-calc-card-desc">{t(descKey)}</span>
        </button>
      ))}
    </div>
  );
}

export function CalculatorsPage() {
  const t = useT();
  const [active, setActive] = useState<string | null>(null);
  const current = CALCULATORS.find((c) => c.id === active) ?? null;
  return (
    <Page toolId="engineering-calc">
      <div className="ind-page analysis-body">
        <PageHead toolId="engineering-calc" title={t('tool.engineering-calc.title')} />
        <IndustrialActions toolId="engineering-calc">
          <CalculatorList active={active} onPick={setActive} />
        </IndustrialActions>
        {current ? (
          <current.Section />
        ) : (
          <div className="ind-calc-empty">
            <EmptyState
              title={t('industrial.calc.empty.title')}
              description={t('industrial.calc.empty.desc')}
            />
            <CalculatorGrid onPick={setActive} />
          </div>
        )}
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
              title={t('common.delete')}
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

// --- fatigue life (Basquin S-N + Miner) ----------------------------------------

const FATIGUE_ROW_DEFAULT: FatigueRow = { stressMPa: 150, cycles: 1e5 };

function FatigueSection() {
  const t = useT();
  const study = useEngineeringStore((s) => s.study);
  const { outputText } = useIndustrialOutput();
  const [ultimateMPa, setUltimateMPa] = useState(400);
  const [knockDown, setKnockDown] = useState(0.8);
  const [rows, setRows] = useState<FatigueRow[]>([{ ...FATIGUE_ROW_DEFAULT }]);
  const setRow = (index: number, patch: Partial<FatigueRow>) =>
    setRows((rs) => rs.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  const result = useMemo(() => fatigueLife({ ultimateMPa, knockDown, rows }), [ultimateMPa, knockDown, rows]);
  const exportCsv = (target: 'download' | 'save') => {
    const rowsCsv = [['stress_MPa', 'cycles', 'life_cycles', 'damage']];
    for (let i = 0; i < rows.length; i += 1) {
      const r = result?.rows[i];
      rowsCsv.push([
        String(rows[i]!.stressMPa),
        String(rows[i]!.cycles),
        r ? String(r.lifeCycles) : '',
        r ? String(r.damage) : '',
      ]);
    }
    rowsCsv.push(['endurance_MPa', result ? String(result.enduranceMPa) : '', '', '']);
    rowsCsv.push(['total_damage', result ? String(result.totalDamage) : '', '', '']);
    void outputText('results', `${artifactBaseName(study)}-fatigue.csv`, rowsCsv.map((r) => r.join(',')).join('\n'), target);
  };
  return (
    <section className="ind-card">
      <h3 className="ind-card-title">{t('industrial.calc.fatigue.title')}</h3>
      <p className="ind-hint">{t('industrial.calc.fatigue.desc')}</p>
      <div className="ind-toolbar analysis-row">
        <NumField label={t('industrial.calc.fatigue.ultimate')} unit="MPa" value={ultimateMPa} onChange={setUltimateMPa} />
        <NumField label={t('industrial.calc.fatigue.knockdown')} unit="×" value={knockDown} onChange={setKnockDown} step={0.05} />
      </div>
      <div className="ind-geometry-list">
        {rows.map((row, i) => (
          <div key={i} className="ind-row">
            <span className="tag">#{i + 1}</span>
            <NumField label={t('industrial.calc.fatigue.stress')} unit="MPa" value={row.stressMPa} onChange={(v) => setRow(i, { stressMPa: v })} />
            <NumField label={t('industrial.calc.fatigue.cycles')} unit="—" value={row.cycles} onChange={(v) => setRow(i, { cycles: v })} />
            <button
              type="button"
              className="btn btn-sm"
              title={t('common.delete')}
              disabled={rows.length <= 1}
              onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <div className="ind-toolbar analysis-row">
        <button type="button" className="btn btn-sm" onClick={() => setRows((rs) => [...rs, { ...FATIGUE_ROW_DEFAULT }])}>
          {t('industrial.calc.fatigue.add_row')}
        </button>
        {study && study.materials.length > 0 && (
          <label className="ind-field">
            <span>{t('industrial.calc.fatigue.from_material')}</span>
            <select
              className="input input-sm"
              value=""
              onChange={(e) => {
                const material = study.materials.find((m) => m.name === e.target.value);
                const sy = material ? materialProperty(material, 'sy', NaN) : NaN;
                // The library has no ultimate strength; σy is a conservative proxy.
                if (Number.isFinite(sy)) setUltimateMPa(sy / 1e6);
              }}
            >
              <option value="">{t('industrial.calc.fatigue.pick_material')}</option>
              {study.materials.map((m) => (
                <option key={m.name} value={m.name}>{m.name}</option>
              ))}
            </select>
          </label>
        )}
      </div>
      <div className="ind-calc-results">
        <ResultRow label={t('industrial.calc.fatigue.endurance')} value={result?.enduranceMPa ?? null} unit="MPa" />
        {result?.rows.map((row, i) => (
          <ResultRow
            key={i}
            label={`${t('industrial.calc.fatigue.life')} · #${i + 1}`}
            value={Number.isFinite(row.lifeCycles) ? row.lifeCycles.toPrecision(3) : t('industrial.calc.fatigue.runout')}
          />
        ))}
        <ResultRow label={t('industrial.calc.fatigue.damage')} value={result?.totalDamage ?? null} />
        <ResultRow
          label={t('industrial.calc.fatigue.verdict')}
          value={result ? (result.safe ? t('industrial.calc.fatigue.safe') : t('industrial.calc.fatigue.fail')) : null}
        />
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

// --- safety factor check ---------------------------------------------------------

function SafetySection() {
  const t = useT();
  const study = useEngineeringStore((s) => s.study);
  const { outputText } = useIndustrialOutput();
  const [appliedMPa, setAppliedMPa] = useState(120);
  const [allowableMPa, setAllowableMPa] = useState(250);
  const [requiredSf, setRequiredSf] = useState(1.5);
  const result = useMemo(
    () => safetyFactor({ appliedMPa, allowableMPa, requiredSf }),
    [appliedMPa, allowableMPa, requiredSf],
  );
  // The allowable defaults to the active study material's yield strength and
  // refreshes when the user picks another library material — the same
  // material state the case editor and solver use.
  const materials = study?.materials ?? [];
  const exportCsv = (target: 'download' | 'save') => {
    const rows = [
      ['quantity', 'value', 'unit'],
      ['applied', String(appliedMPa), 'MPa'],
      ['allowable', String(allowableMPa), 'MPa'],
      ['required_sf', String(requiredSf), '-'],
      ['safety_factor', result ? String(result.factor) : '', '-'],
      ['margin', result ? String(result.margin) : '', '-'],
      ['pass', result ? String(result.pass) : '', ''],
    ];
    void outputText('results', `${artifactBaseName(study)}-safety-factor.csv`, rows.map((r) => r.join(',')).join('\n'), target);
  };
  return (
    <section className="ind-card">
      <h3 className="ind-card-title">{t('industrial.calc.safety.title')}</h3>
      <p className="ind-hint">{t('industrial.calc.safety.desc')}</p>
      <div className="ind-toolbar analysis-row">
        <NumField label={t('industrial.calc.safety.applied')} unit="MPa" value={appliedMPa} onChange={setAppliedMPa} />
        <NumField label={t('industrial.calc.safety.allowable')} unit="MPa" value={allowableMPa} onChange={setAllowableMPa} />
        <NumField label={t('industrial.calc.safety.required')} unit="n" value={requiredSf} onChange={setRequiredSf} step={0.1} />
      </div>
      {materials.length > 0 && (
        <div className="ind-toolbar analysis-row">
          <label className="ind-field">
            <span>{t('industrial.calc.safety.from_material')}</span>
            <select
              className="input input-sm"
              value=""
              onChange={(e) => {
                const material = materials.find((m) => m.name === e.target.value);
                const sy = material ? materialProperty(material, 'sy', NaN) : NaN;
                if (Number.isFinite(sy)) setAllowableMPa(sy / 1e6);
              }}
            >
              <option value="">{t('industrial.calc.safety.pick_material')}</option>
              {materials.map((m) => (
                <option key={m.name} value={m.name}>{m.name}</option>
              ))}
            </select>
          </label>
        </div>
      )}
      <div className="ind-calc-results">
        <ResultRow label={t('industrial.calc.safety.factor')} value={result?.factor ?? null} />
        <ResultRow label={t('industrial.calc.safety.margin')} value={result?.margin ?? null} />
        <ResultRow
          label={t('industrial.calc.safety.verdict')}
          value={result ? (result.pass ? t('industrial.calc.safety.pass') : t('industrial.calc.safety.reject')) : null}
        />
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

const TOL_ITEM_DEFAULT: ToleranceItem = { name: '', nominalMm: 10, tolMm: 0.1, distribution: 'normal' };

function ToleranceSection() {
  const t = useT();
  const study = useEngineeringStore((s) => s.study);
  const { outputText } = useIndustrialOutput();
  const [items, setItems] = useState<ToleranceItem[]>([
    { ...TOL_ITEM_DEFAULT, name: 'A', nominalMm: 20, tolMm: 0.1, distribution: 'extreme' },
    { ...TOL_ITEM_DEFAULT, name: 'B', nominalMm: 15, tolMm: 0.05, distribution: 'normal' },
    { ...TOL_ITEM_DEFAULT, name: 'C', nominalMm: 8, tolMm: 0.05, distribution: 'normal' },
  ]);
  const setItem = (index: number, patch: Partial<ToleranceItem>) =>
    setItems((is) => is.map((it, i) => (i === index ? { ...it, ...patch } : it)));
  const result = useMemo(() => toleranceChain(items), [items]);
  const exportCsv = (target: 'download' | 'save') => {
    const rows = [['name', 'nominal_mm', 'tol_mm', 'distribution']];
    for (const it of items) rows.push([it.name || '-', String(it.nominalMm), String(it.tolMm), it.distribution]);
    rows.push(['nominal', result ? String(result.nominalMm) : '', '', '']);
    rows.push(['worst_tol', result ? String(result.worstCaseTolMm) : '', '', '']);
    rows.push(['statistical_tol_3sigma', result ? String(result.statisticalTolMm) : '', '', '']);
    void outputText('results', `${artifactBaseName(study)}-tolerance-chain.csv`, rows.map((r) => r.join(',')).join('\n'), target);
  };
  return (
    <section className="ind-card">
      <h3 className="ind-card-title">{t('industrial.calc.tol.title')}</h3>
      <p className="ind-hint">{t('industrial.calc.tol.desc')}</p>
      <div className="ind-geometry-list">
        {items.map((item, i) => (
          <div key={i} className="ind-row">
            <span className="tag">{item.name || `#${i + 1}`}</span>
            <NumField label={t('industrial.calc.tol.nominal')} unit="mm" value={item.nominalMm} onChange={(v) => setItem(i, { nominalMm: v })} />
            <NumField label={t('industrial.calc.tol.tol')} unit="±mm" value={item.tolMm} onChange={(v) => setItem(i, { tolMm: v })} step={0.01} />
            <label className="ind-field">
              <span>{t('industrial.calc.tol.dist')}</span>
              <select
                className="input input-sm"
                value={item.distribution}
                onChange={(e) => setItem(i, { distribution: e.target.value as ToleranceItem['distribution'] })}
              >
                <option value="extreme">{t('industrial.calc.tol.extreme')}</option>
                <option value="normal">{t('industrial.calc.tol.normal')}</option>
              </select>
            </label>
            <button
              type="button"
              className="btn btn-sm"
              title={t('common.delete')}
              disabled={items.length <= 1}
              onClick={() => setItems((is) => is.filter((_, j) => j !== i))}
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <div className="ind-toolbar analysis-row">
        <button type="button" className="btn btn-sm" onClick={() => setItems((is) => [...is, { ...TOL_ITEM_DEFAULT }])}>
          {t('industrial.calc.tol.add_item')}
        </button>
      </div>
      <div className="ind-calc-results">
        <ResultRow label={t('industrial.calc.tol.gap_nominal')} value={result?.nominalMm ?? null} unit="mm" />
        <ResultRow label={t('industrial.calc.tol.worst')} value={result ? `±${result.worstCaseTolMm}` : null} unit="mm" />
        <ResultRow label={t('industrial.calc.tol.statistical')} value={result ? `±${result.statisticalTolMm}` : null} unit="mm" />
        <ResultRow label={t('industrial.calc.tol.gain')} value={result ? `${result.gain.toFixed(2)}×` : null} />
        <ResultRow label={t('industrial.calc.tol.bounds')} value={result ? `${result.minMm.toFixed(3)} ~ ${result.maxMm.toFixed(3)}` : null} unit="mm" />
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

const BEAM_DEFAULT: BeamInput = {
  support: 'cantilever', load: 'point', spanMm: 200, pointLoadN: 100,
  udlNMm: 0.5, section: 'rect', widthMm: 20, heightMm: 10, elasticGPa: 210,
};

function BeamSection() {
  const t = useT();
  const study = useEngineeringStore((s) => s.study);
  const { outputText } = useIndustrialOutput();
  const [input, setInput] = useState<BeamInput>(BEAM_DEFAULT);
  const set = (patch: Partial<BeamInput>) => setInput((s) => ({ ...s, ...patch }));
  const result = useMemo(() => beamQuick(input), [input]);
  const exportCsv = (target: 'download' | 'save') => {
    const rows = [
      ['quantity', 'value', 'unit'],
      ['support', input.support, ''],
      ['load', input.load, ''],
      ['span', String(input.spanMm), 'mm'],
      ['section', input.section, ''],
      ['area', result ? String(result.areaMm2) : '', 'mm2'],
      ['inertia', result ? String(result.inertiaMm4) : '', 'mm4'],
      ['max_moment', result ? String(result.maxMomentNmm) : '', 'N.mm'],
      ['max_stress', result ? String(result.maxStressMPa) : '', 'MPa'],
      ['max_deflection', result ? String(result.maxDeflectionMm) : '', 'mm'],
    ];
    void outputText('results', `${artifactBaseName(study)}-beam-check.csv`, rows.map((r) => r.join(',')).join('\n'), target);
  };
  return (
    <section className="ind-card">
      <h3 className="ind-card-title">{t('industrial.calc.beam.title')}</h3>
      <p className="ind-hint">{t('industrial.calc.beam.desc')}</p>
      <div className="ind-toolbar analysis-row">
        <label className="ind-field">
          <span>{t('industrial.calc.beam.support')}</span>
          <select className="input input-sm" value={input.support}
            onChange={(e) => set({ support: e.target.value as BeamInput['support'] })}>
            <option value="cantilever">{t('industrial.calc.beam.cantilever')}</option>
            <option value="simple">{t('industrial.calc.beam.simple')}</option>
          </select>
        </label>
        <label className="ind-field">
          <span>{t('industrial.calc.beam.load')}</span>
          <select className="input input-sm" value={input.load}
            onChange={(e) => set({ load: e.target.value as BeamInput['load'] })}>
            <option value="point">{t('industrial.calc.beam.point')}</option>
            <option value="udl">{t('industrial.calc.beam.udl')}</option>
          </select>
        </label>
        <NumField label={t('industrial.calc.beam.span')} unit="mm" value={input.spanMm} onChange={(v) => set({ spanMm: v })} />
      </div>
      <div className="ind-toolbar analysis-row">
        {input.load === 'point'
          ? <NumField label={t('industrial.calc.beam.point_load')} unit="N" value={input.pointLoadN} onChange={(v) => set({ pointLoadN: v })} />
          : <NumField label={t('industrial.calc.beam.udl_load')} unit="N/mm" value={input.udlNMm} onChange={(v) => set({ udlNMm: v })} />}
        <label className="ind-field">
          <span>{t('industrial.calc.beam.section')}</span>
          <select className="input input-sm" value={input.section}
            onChange={(e) => set({ section: e.target.value as BeamInput['section'] })}>
            <option value="rect">{t('industrial.calc.beam.rect')}</option>
            <option value="circle">{t('industrial.calc.beam.circle')}</option>
          </select>
        </label>
        {input.section === 'rect'
          ? <NumField label={t('industrial.calc.beam.width')} unit="mm" value={input.widthMm} onChange={(v) => set({ widthMm: v })} />
          : null}
        <NumField label={input.section === 'rect' ? t('industrial.calc.beam.height') : t('industrial.calc.beam.diameter')} unit="mm" value={input.heightMm} onChange={(v) => set({ heightMm: v })} />
        <NumField label={t('industrial.calc.beam.e_modulus')} unit="GPa" value={input.elasticGPa} onChange={(v) => set({ elasticGPa: v })} />
      </div>
      {study && study.materials.length > 0 && (
        <div className="ind-toolbar analysis-row">
          <label className="ind-field">
            <span>{t('industrial.calc.thermal.from_material')}</span>
            <select
              className="input input-sm"
              value=""
              onChange={(e) => {
                const material = study.materials.find((m) => m.name === e.target.value);
                const ePa = material ? materialProperty(material, 'E', NaN) : NaN;
                if (Number.isFinite(ePa)) set({ elasticGPa: ePa / 1e9 });
              }}
            >
              <option value="">{t('industrial.calc.beam.pick_e')}</option>
              {study.materials.map((m) => (
                <option key={m.name} value={m.name}>{m.name}</option>
              ))}
            </select>
          </label>
        </div>
      )}
      <div className="ind-calc-results">
        <ResultRow label={t('industrial.calc.beam.area')} value={result?.areaMm2 ?? null} unit="mm²" />
        <ResultRow label={t('industrial.calc.beam.inertia')} value={result?.inertiaMm4 ?? null} unit="mm⁴" />
        <ResultRow label={t('industrial.calc.beam.max_moment')} value={result ? result.maxMomentNmm / 1000 : null} unit="N·m" />
        <ResultRow label={t('industrial.calc.beam.max_stress')} value={result?.maxStressMPa ?? null} unit="MPa" />
        <ResultRow label={t('industrial.calc.beam.max_deflection')} value={result?.maxDeflectionMm ?? null} unit="mm" />
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
