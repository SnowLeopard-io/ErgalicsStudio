// ==========================================================================
// Ergalics Studio — block param editor (block system)
//
// Generic parameter editor for the selected block. Infers a control from the
// value's runtime type (number / string / boolean / array). Array values are
// edited as comma-separated text.
// ==========================================================================

import { useLocale, useT } from '@/i18n';
import { useBlockStore } from '@/stores/blockStore';
import { blockRegistry } from '@/blocks/registry';
import { blockName } from '@/blocks/l10n';

function parseArray(text: string): string[] {
  return text
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
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
    return (
      <input
        type="number"
        className="input"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    );
  }
  if (Array.isArray(value)) {
    return (
      <input
        type="text"
        className="input"
        value={value.map(String).join(', ')}
        onChange={(e) => onChange(parseArray(e.target.value))}
      />
    );
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
      {keys.map((key) => (
        <label key={key} className="block-param-field">
          <span className="block-param-label">{key}</span>
          <ParamInput value={params[key]} onChange={(v) => updateParams(selected.id, { [key]: v })} />
        </label>
      ))}
    </div>
  );
}
