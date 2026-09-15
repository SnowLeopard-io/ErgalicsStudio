import { useEffect, useMemo, useState } from 'react';
import { useT } from '@/i18n';
import { parseUnitExpr } from '@/core/units/quantity';

export interface QuantityInputProps {
  /** Numeric value in the given unit. */
  value: number;
  /** Unit expression, e.g. "km/h" (empty = dimensionless). */
  unit: string;
  onChange: (value: number, unit: string) => void;
  disabled?: boolean;
  valuePlaceholder?: string;
}

/**
 * Controlled value+unit pair. The unit field keeps a local draft while being
 * edited (intermediate invalid states are allowed) and commits on blur or
 * Enter; invalid expressions are flagged via `--color-error` styling.
 */
export function QuantityInput({
  value,
  unit,
  onChange,
  disabled,
  valuePlaceholder,
}: QuantityInputProps) {
  const t = useT();
  const [unitDraft, setUnitDraft] = useState(unit);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (!editing) setUnitDraft(unit);
  }, [unit, editing]);

  const shownUnit = editing ? unitDraft : unit;
  const unitError = useMemo(() => {
    const u = shownUnit.trim();
    if (!u) return undefined; // dimensionless is valid
    try {
      parseUnitExpr(u);
      return undefined;
    } catch {
      return t('units.invalid_unit');
    }
  }, [shownUnit, t]);

  return (
    <span className={`qty-input${unitError ? ' qty-input-invalid' : ''}`}>
      <input
        className="input qty-input-value"
        type="number"
        step="any"
        inputMode="decimal"
        value={Number.isFinite(value) ? value : ''}
        placeholder={valuePlaceholder}
        disabled={disabled}
        aria-label={t('units.value')}
        onChange={(e) => {
          const text = e.target.value;
          if (text === '') return;
          const n = Number(text);
          if (Number.isFinite(n)) onChange(n, unit);
        }}
      />
      <input
        className="input qty-input-unit"
        type="text"
        value={shownUnit}
        placeholder="—"
        disabled={disabled}
        title={unitError ?? shownUnit}
        aria-label={t('units.unit')}
        onChange={(e) => {
          setEditing(true);
          setUnitDraft(e.target.value);
        }}
        onBlur={() => {
          setEditing(false);
          const next = unitDraft.trim();
          if (next !== unit) onChange(value, next);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
      />
    </span>
  );
}
