import { useEffect, useState } from 'react';

export interface NumFieldProps {
  /** Current numeric value, shown whenever the field is not focused. */
  value: number;
  /** Fires for every keystroke whose text parses to a finite number. */
  onChange: (value: number) => void;
  className?: string;
  style?: React.CSSProperties;
  id?: string;
  placeholder?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  ariaLabel?: string;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
}

/**
 * Plain-text numeric field (no native spinners — toolkit style rule: numeric
 * inputs are plain boxes, arrows invite blind nudging instead of deliberate
 * entry). The DOM keeps an editable draft while focused, so intermediate
 * states like "-", "1." or a trailing exponent never snap the caret to the
 * end (the classic bug of `value={num}` + `onChange={Number(text)}` controls,
 * where React rewrites the DOM with the normalized value on every keystroke).
 * The caller receives `onChange` for each finite parse; on blur the draft
 * resyncs from `value`, so invalid text simply reverts.
 */
export function NumField({
  value,
  onChange,
  className = 'input',
  style,
  id,
  placeholder,
  disabled,
  autoFocus,
  ariaLabel,
  onKeyDown,
}: NumFieldProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(Number.isFinite(value) ? String(value) : '');

  useEffect(() => {
    if (!editing) setDraft(Number.isFinite(value) ? String(value) : '');
  }, [value, editing]);

  return (
    <input
      type="text"
      inputMode="decimal"
      autoComplete="off"
      spellCheck={false}
      className={className}
      style={style}
      id={id}
      placeholder={placeholder}
      disabled={disabled}
      autoFocus={autoFocus}
      aria-label={ariaLabel}
      value={editing ? draft : Number.isFinite(value) ? String(value) : ''}
      onFocus={() => {
        setEditing(true);
        setDraft(Number.isFinite(value) ? String(value) : '');
      }}
      onChange={(e) => {
        const text = e.target.value;
        setDraft(text);
        const n = Number(text);
        if (text !== '' && Number.isFinite(n)) onChange(n);
      }}
      onBlur={() => setEditing(false)}
      onKeyDown={onKeyDown}
    />
  );
}
