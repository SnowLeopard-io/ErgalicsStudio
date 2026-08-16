// ==========================================================================
// Ergalics Studio — block param editor (block system)
//
// Generic parameter editor for the selected block. Infers a control from the
// value's runtime type (number / string / boolean / array). Array values are
// edited as comma-separated text.
// ==========================================================================

import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocale, useT } from '@/i18n';
import { useBlockStore } from '@/stores/blockStore';
import { useProjectStore } from '@/stores/projectStore';
import { blockRegistry } from '@/blocks/registry';
import { blockName, blockParamLabel } from '@/blocks/l10n';
import { listDataFiles } from '@/core/dataFiles';

function parseArray(text: string): string[] {
  return text
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Draft-state wrapper shared by the number/array inputs. Editing a fully
 * controlled input bound to `Number(value)` made "0." collapse to "0" (so
 * decimals like 0.5 were untypeable) and "-"/"1e" collapse to NaN, which then
 * crashed executors via `new Float64Array(NaN)`. The draft keeps the raw text
 * while typing; a finite parsed value is committed on change, and invalid
 * drafts revert to the last committed value on blur. When the store value
 * changes externally (param reset / selection change / project open) the draft
 * re-syncs — keyed by `keyOf` (a canonical form) so the user's own commit of
 * e.g. "0.50" isn't mistaken for an external change.
 */
function useDraft(
  keyOf: (v: unknown) => string,
  format: (v: unknown) => string,
  value: unknown,
) {
  const [draft, setDraft] = useState(() => format(value));
  // lastCommit: display string to revert to on blur; lastKey: canonical form
  // of the last value we consider "committed".
  const lastCommit = useRef(format(value));
  const lastKey = useRef(keyOf(value));

  useEffect(() => {
    const key = keyOf(value);
    if (key !== lastKey.current) {
      const formatted = format(value);
      setDraft(formatted);
      lastKey.current = key;
      lastCommit.current = formatted;
    }
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps

  const commit = <T,>(parsed: T, display: string, key: string): T => {
    lastKey.current = key;
    lastCommit.current = display;
    return parsed;
  };

  return { draft, setDraft, commit, lastCommit, lastKey };
}

function NumberInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const keyOf = (v: unknown) => (Number.isFinite(Number(v)) ? String(Number(v)) : 'NaN');
  const fmt = (v: unknown) => String(v);
  const { draft, setDraft, commit, lastCommit } = useDraft(keyOf, fmt, value);

  const handleChange = (text: string) => {
    setDraft(text);
    if (text.trim() === '') return;
    const n = Number(text);
    if (Number.isFinite(n)) {
      onChange(commit(n, text, String(n)));
    }
  };

  const handleBlur = () => {
    const n = Number(draft);
    if (draft.trim() === '' || !Number.isFinite(n)) {
      setDraft(lastCommit.current);
    }
  };

  return (
    <input
      type="number"
      className="input"
      value={draft}
      onChange={(e) => handleChange(e.target.value)}
      onBlur={handleBlur}
    />
  );
}

function ArrayInput({ value, onChange }: { value: unknown[]; onChange: (v: unknown[]) => void }) {
  const keyOf = (v: unknown) => JSON.stringify(v ?? []);
  const fmt = (v: unknown) => (v as unknown[]).map(String).join(', ');
  const { draft, setDraft, commit, lastKey } = useDraft(keyOf, fmt, value);

  const handleCommit = () => {
    const arr = parseArray(draft);
    const key = JSON.stringify(arr);
    // Skip committing a value identical to what the store already holds
    // (e.g. a no-op blur right after the external-sync reset).
    if (key === lastKey.current) return;
    commit(arr, draft, key);
    onChange(arr);
  };

  return (
    <input
      type="text"
      className="input"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={handleCommit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
      }}
    />
  );
}

function ParamInput({ value, onChange }: { value: unknown; onChange: (v: unknown) => void }) {
  if (typeof value === 'boolean') {
    return (
      <input
        type="checkbox"
        checked={value}
        onChange={(e) => onChange(e.target.checked)}
      />
    );
  }
  if (typeof value === 'number') {
    return <NumberInput value={value} onChange={(n) => onChange(n)} />;
  }
  if (Array.isArray(value)) {
    return <ArrayInput value={value} onChange={(arr) => onChange(arr)} />;
  }
  if (typeof value === 'string') {
    return (
      <input
        type="text"
        className="input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }
  return <span className="empty-hint">{JSON.stringify(value)}</span>;
}

/**
 * A dropdown of every resolvable data file (project files first, then bundled
 * examples) for the `source.file` block's fileName parameter. Subscribes to the
 * project store so the list refreshes right after importing/removing a file.
 */
function FilePickInput({ value, onChange }: { value: unknown; onChange: (v: unknown) => void }) {
  const projectFiles = useProjectStore((s) => s.project?.data.files ?? []);
  const files = useMemo(() => listDataFiles(), [projectFiles]);
  return (
    <select
      className="input"
      value={String(value ?? '')}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">—</option>
      {files.map((f) => (
        <option key={f} value={f}>{f}</option>
      ))}
    </select>
  );
}

export function ParamEditor() {
  const t = useT();
  const { locale } = useLocale();
  const instances = useBlockStore((s) => s.instances);
  const selectedIds = useBlockStore((s) => s.selectedIds);
  const updateParams = useBlockStore((s) => s.updateParams);

  const selected = instances.find((i) => selectedIds.includes(i.id));
  if (!selected) {
    return (
      <div className="block-param-editor">
        <div className="empty-hint">{t('blocks.params.select_hint')}</div>
      </div>
    );
  }

  const meta = blockRegistry.get(selected.blockId);
  if (!meta) return null;
  const params = { ...meta.defaultParams, ...selected.params };
  const keys = Object.keys(params);

  return (
    <div className="block-param-editor">
      <div className="block-param-title">{blockName(meta, locale)}</div>
      <div className="block-param-id">{meta.id}</div>
      {keys.length === 0 && <div className="empty-hint">{t('blocks.params.none')}</div>}
      {keys.map((key) => {
        const isFilePick = meta.id === 'source.file' && key === 'fileName';
        return (
          <label key={key} className="block-param-field">
            <span className="block-param-label">{blockParamLabel(meta, key, locale)}</span>
            {isFilePick ? (
              <FilePickInput
                value={params[key]}
                onChange={(v) => updateParams(selected.id, { [key]: v })}
              />
            ) : (
              <ParamInput
                value={params[key]}
                onChange={(v) => updateParams(selected.id, { [key]: v })}
              />
            )}
          </label>
        );
      })}
    </div>
  );
}