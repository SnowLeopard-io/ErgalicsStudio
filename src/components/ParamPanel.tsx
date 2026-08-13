import { useState } from 'react';
import type {
  ParamDefinition,
  PluginApi,
  SelectOption,
} from '@/types/plugin';
import { useT } from '@/i18n';

interface ParamPanelProps {
  params: ParamDefinition[];
  api: PluginApi;
  onChange: (key: string, value: unknown) => void;
}

export function ParamPanel({ params, api, onChange }: ParamPanelProps) {
  const label = (def: ParamDefinition) =>
    def.labelI18n?.[api.locale] ?? def.label;

  return (
    <div className="param-panel">
      {params.map((def) => (
        <div className="field" key={def.key}>
          <label className="field-label">{label(def)}</label>
          <Control def={def} api={api} onChange={onChange} />
          {def.hint && <span className="empty-hint">{def.hint}</span>}
        </div>
      ))}
    </div>
  );
}

function Control({
  def,
  api,
  onChange,
}: {
  def: ParamDefinition;
  api: PluginApi;
  onChange: (key: string, value: unknown) => void;
}) {
  const t = useT();
  const [file, setFile] = useState<string | null>(null);

  const emit = (value: unknown) => onChange(def.key, value);

  const label = (d: ParamDefinition) => d.labelI18n?.[api.locale] ?? d.label;

  switch (def.type) {
    case 'range':
      return (
        <div className="param-range">
          <input
            type="range"
            min={def.min}
            max={def.max}
            step={def.step}
            value={def.value}
            onChange={(e) => emit(Number(e.target.value))}
          />
          <span className="param-value">{def.value}</span>
        </div>
      );
    case 'select':
      return (
        <select
          className="select"
          value={def.value}
          onChange={(e) => emit(e.target.value)}
        >
          {def.options.map((o: SelectOption) => (
            <option key={o.value} value={o.value}>
              {o.labelI18n?.[api.locale] ?? o.label}
            </option>
          ))}
        </select>
      );
    case 'number':
      return (
        <input
          className="input"
          type="number"
          min={def.min}
          max={def.max}
          step={def.step}
          value={def.value}
          onChange={(e) => emit(Number(e.target.value))}
        />
      );
    case 'checkbox':
      return (
        <label className="param-checkbox">
          <input
            type="checkbox"
            checked={def.value}
            onChange={(e) => emit(e.target.checked)}
          />
          <span>{def.value ? t('common.yes') : t('common.no')}</span>
        </label>
      );
    case 'text':
      return (
        <input
          className="input"
          type="text"
          placeholder={def.placeholder}
          value={def.value}
          onChange={(e) => emit(e.target.value)}
        />
      );
    case 'file':
      return (
        <div className="param-file">
          <input
            className="input"
            type="text"
            readOnly
            value={file ?? ''}
            placeholder={t('plugin.load')}
          />
          <button
            type="button"
            className="btn btn-sm"
            onClick={async () => {
              const f = await api.openFile();
              if (f) {
                setFile(f.name);
                emit(f);
              }
            }}
          >
            {t('common.load')}
          </button>
        </div>
      );
    case 'button':
      return (
        <button
          type="button"
          className={`btn ${def.variant === 'danger' ? 'btn-danger' : def.variant === 'primary' ? 'btn-primary' : ''}`}
          onClick={() => emit({ action: def.action ?? def.key })}
        >
          {label(def)}
        </button>
      );
    case 'toggle':
      return (
        <button
          type="button"
          className={`btn btn-block ${def.value ? 'btn-toggle-on' : 'btn-primary'}`}
          onClick={() => emit(!def.value)}
        >
          {def.value
            ? def.onLabelI18n?.[api.locale] ?? def.onLabel ?? t('common.stop')
            : def.offLabelI18n?.[api.locale] ?? def.offLabel ?? t('common.start')}
        </button>
      );
    default:
      return null;
  }
}