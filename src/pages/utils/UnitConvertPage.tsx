// ==========================================================================
// Ergalics Studio — Unit Converter (utility toolkit)
//
// Linear categories convert through a base-unit factor; temperature uses
// offset formulas. Every conversion is pure string→number math, no project
// data involved.
// ==========================================================================

import { useMemo, useState } from 'react';
import { useT } from '@/i18n';
import { ToolShell } from '@/components/ToolShell';
import { SwapIcon } from '@/components/icons';

interface Unit {
  sym: string;
  /** Value in the category's base unit. */
  factor: number;
}

interface Category {
  id: string;
  base: string;
  units: Unit[];
  /** Temperature needs affine (offset) conversion, not a factor. */
  affine?: boolean;
}

const CATEGORIES: Category[] = [
  {
    id: 'length', base: 'm',
    units: [
      { sym: 'km', factor: 1000 }, { sym: 'm', factor: 1 },
      { sym: 'dm', factor: 0.1 }, { sym: 'cm', factor: 0.01 },
      { sym: 'mm', factor: 1e-3 }, { sym: 'µm', factor: 1e-6 },
      { sym: 'nm', factor: 1e-9 }, { sym: 'in', factor: 0.0254 },
      { sym: 'ft', factor: 0.3048 }, { sym: 'yd', factor: 0.9144 },
      { sym: 'mi', factor: 1609.344 }, { sym: 'nmi', factor: 1852 },
      { sym: 'au', factor: 1.495978707e11 }, { sym: 'ly', factor: 9.4607304725808e15 },
    ],
  },
  {
    id: 'mass', base: 'kg',
    units: [
      { sym: 't', factor: 1000 }, { sym: 'kg', factor: 1 },
      { sym: 'g', factor: 1e-3 }, { sym: 'mg', factor: 1e-6 },
      { sym: 'µg', factor: 1e-9 }, { sym: 'u', factor: 1.6605390666e-27 },
      { sym: 'lb', factor: 0.45359237 }, { sym: 'oz', factor: 0.028349523125 },
      { sym: 'ct', factor: 2e-4 },
    ],
  },
  {
    id: 'time', base: 's',
    units: [
      { sym: 'ns', factor: 1e-9 }, { sym: 'µs', factor: 1e-6 },
      { sym: 'ms', factor: 1e-3 }, { sym: 's', factor: 1 },
      { sym: 'min', factor: 60 }, { sym: 'h', factor: 3600 },
      { sym: 'd', factor: 86400 }, { sym: 'wk', factor: 604800 },
      { sym: 'yr', factor: 31557600 },
    ],
  },
  {
    id: 'temperature', base: 'K', affine: true,
    units: [
      { sym: 'K', factor: 1 }, { sym: '°C', factor: 1 }, { sym: '°F', factor: 1 },
    ],
  },
  {
    id: 'pressure', base: 'Pa',
    units: [
      { sym: 'Pa', factor: 1 }, { sym: 'hPa', factor: 100 },
      { sym: 'kPa', factor: 1e3 }, { sym: 'MPa', factor: 1e6 },
      { sym: 'bar', factor: 1e5 }, { sym: 'mbar', factor: 100 },
      { sym: 'atm', factor: 101325 }, { sym: 'mmHg', factor: 133.322387415 },
      { sym: 'psi', factor: 6894.757293168 }, { sym: 'inHg', factor: 3386.389 },
    ],
  },
  {
    id: 'energy', base: 'J',
    units: [
      { sym: 'J', factor: 1 }, { sym: 'kJ', factor: 1e3 },
      { sym: 'MJ', factor: 1e6 }, { sym: 'cal', factor: 4.184 },
      { sym: 'kcal', factor: 4184 }, { sym: 'Wh', factor: 3600 },
      { sym: 'kWh', factor: 3.6e6 }, { sym: 'eV', factor: 1.602176634e-19 },
      { sym: 'keV', factor: 1.602176634e-16 }, { sym: 'MeV', factor: 1.602176634e-13 },
      { sym: 'erg', factor: 1e-7 }, { sym: 'BTU', factor: 1055.05585262 },
    ],
  },
  {
    id: 'amount', base: 'mol',
    units: [
      { sym: 'kmol', factor: 1000 }, { sym: 'mol', factor: 1 },
      { sym: 'mmol', factor: 1e-3 }, { sym: 'µmol', factor: 1e-6 },
      { sym: 'nmol', factor: 1e-9 },
    ],
  },
  {
    id: 'volume', base: 'm³',
    units: [
      { sym: 'm³', factor: 1 }, { sym: 'L', factor: 1e-3 },
      { sym: 'mL', factor: 1e-6 }, { sym: 'µL', factor: 1e-9 },
      { sym: 'cm³', factor: 1e-6 }, { sym: 'ft³', factor: 0.028316846592 },
      { sym: 'gal(US)', factor: 0.003785411784 }, { sym: 'in³', factor: 1.6387064e-5 },
    ],
  },
];

/** Compact instrument-style number formatting (mono readouts). */
function fmtNum(v: number): string {
  if (!Number.isFinite(v)) return '—';
  const abs = Math.abs(v);
  if (abs !== 0 && (abs < 1e-4 || abs >= 1e7)) return v.toExponential(6).replace(/\.?0+e/, 'e');
  return String(Number(v.toPrecision(8)));
}

function toKelvin(v: number, sym: string): number {
  if (sym === '°C') return v + 273.15;
  if (sym === '°F') return ((v - 32) * 5) / 9 + 273.15;
  return v;
}

function fromKelvin(k: number, sym: string): number {
  if (sym === '°C') return k - 273.15;
  if (sym === '°F') return ((k - 273.15) * 9) / 5 + 32;
  return k;
}

/** Resolve a category id to a concrete category (ids only come from CATEGORIES). */
function catOf(id: string): Category {
  return CATEGORIES.find((c) => c.id === id) ?? CATEGORIES[0]!;
}

export default function UnitConvertPage() {
  const t = useT();
  const [catId, setCatId] = useState(CATEGORIES[0]!.id);
  const cat = catOf(catId);

  const [raw, setRaw] = useState('1');
  const [fromSym, setFromSym] = useState(cat.base);
  const [toSym, setToSym] = useState(cat.units[1]?.sym ?? cat.base);

  const pickCategory = (id: string) => {
    const next = catOf(id);
    setCatId(id);
    setFromSym(next.base);
    setToSym(next.units[1]?.sym ?? next.base);
  };

  const value = Number(raw.replace(',', '.'));
  const valid = raw.trim() !== '' && Number.isFinite(value);

  const converted = useMemo(() => {
    if (!valid) return null;
    const base = cat.affine ? toKelvin(value, fromSym) : value * (cat.units.find((u) => u.sym === fromSym)?.factor ?? 1);
    if (cat.affine) return fromKelvin(base, toSym);
    return base * (1 / (cat.units.find((u) => u.sym === toSym)?.factor ?? 1));
  }, [valid, value, cat, fromSym, toSym]);

  const swap = () => {
    setFromSym(toSym);
    setToSym(fromSym);
  };

  return (
    <ToolShell toolId="unit-convert">
      <div className="util-page">
        <div className="util-card">
          <div className="util-row">
            <label className="field-label" htmlFor="uc-cat">{t('uc.category')}</label>
            <select
              id="uc-cat"
              className="select util-grow"
              value={catId}
              onChange={(e) => pickCategory(e.target.value)}
            >
              {CATEGORIES.map((c) => (
                <option key={c.id} value={c.id}>{t(`uc.cat.${c.id}`)}</option>
              ))}
            </select>
          </div>

          <div className="uc-io">
            <div className="uc-side">
              <input
                className="input util-mono"
                type="text"
                inputMode="decimal"
                value={raw}
                onChange={(e) => setRaw(e.target.value)}
                aria-label={t('uc.value')}
              />
              <select
                className="select util-mono"
                value={fromSym}
                onChange={(e) => setFromSym(e.target.value)}
                aria-label={t('uc.value')}
              >
                {cat.units.map((u) => <option key={u.sym} value={u.sym}>{u.sym}</option>)}
              </select>
            </div>
            <button type="button" className="icon-btn uc-swap" title={t('uc.swap')} aria-label={t('uc.swap')} onClick={swap}>
              <SwapIcon size={15} />
            </button>
            <div className="uc-side">
              <div className={`util-readout uc-target${valid ? '' : ' util-dim'}`}>
                {converted === null ? '—' : fmtNum(converted)}
              </div>
              <select
                className="select util-mono"
                value={toSym}
                onChange={(e) => setToSym(e.target.value)}
                aria-label={t('uc.result')}
              >
                {cat.units.map((u) => <option key={u.sym} value={u.sym}>{u.sym}</option>)}
              </select>
            </div>
          </div>
          {!valid && raw.trim() !== '' && <p className="util-error">{t('uc.error_value')}</p>}
        </div>

        <div className="util-card">
          <h2 className="util-card-title">{t('uc.all_units')}</h2>
          <div className="util-table-wrap">
            <table className="util-table">
              <tbody>
                {cat.units.map((u) => {
                  const v = converted === null ? null : cat.affine
                    ? fromKelvin(toKelvin(value, fromSym), u.sym)
                    : value * (cat.units.find((x) => x.sym === fromSym)?.factor ?? 1) / u.factor;
                  return (
                    <tr key={u.sym}>
                      <td className="util-mono uc-sym">{u.sym}</td>
                      <td className="util-mono uc-val">{v === null ? '—' : fmtNum(v)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </ToolShell>
  );
}
