// ==========================================================================
// Ergalics Studio — Right Panel Plugin Data Contract Card
//
// Surfaces a plugin's expected data structure (columns, types, units, ranges,
// JSON fields, or legacy format descriptions) right inside the RightPanel
// above parameters, with 4 direct actions: Online Edit, Pick Project Data,
// Upload File, and Load Template.
// ==========================================================================

import { useMemo, useRef, useState } from 'react';
import { useLocale } from '@/i18n';
import type { Plugin } from '@ergalics/plugin-sdk';
import type {
  ErgalicsJsonSchema,
  PluginDataSchema,
  TabularDataSchema,
} from '@ergalics/plugin-sdk/types';
import {
  columnLabel,
  extractTabularColumns,
  resolvePluginDataSchemas,
  type TabularColumnDescriptor,
} from '@/core/data-schema/presets';
import { resolveDataFile } from '@/core/dataFiles';
import { isSupportedDataFileName } from '@/core/fileFormat';
import { useDataEditorStore } from '@/stores/dataEditorStore';
import { useProjectStore } from '@/stores/projectStore';
import { useAppStore } from '@/stores/appStore';
import { DataFilePickerModal } from '@/components/DataFilePickerModal';

function formatTypeBadge(col: TabularColumnDescriptor, zh: boolean): string {
  switch (col.displayType) {
    case 'number':
      return zh ? '数值' : 'num';
    case 'integer':
      return zh ? '整数' : 'int';
    case 'boolean':
      return zh ? '布尔' : 'bool';
    case 'enum':
      return zh ? '枚举' : 'enum';
    case 'date':
      return zh ? '日期' : 'date';
    case 'string':
      return zh ? '文本' : 'str';
    default:
      return zh ? '任意' : 'any';
  }
}

function formatConstraints(schema: ErgalicsJsonSchema, zh: boolean): string {
  const parts: string[] = [];
  if (schema.enum && schema.enum.length > 0) {
    parts.push(schema.enum.map(String).join(' / '));
  }
  if (schema.exclusiveMinimum !== undefined) parts.push(`> ${schema.exclusiveMinimum}`);
  else if (schema.minimum !== undefined) parts.push(`≥ ${schema.minimum}`);
  if (schema.exclusiveMaximum !== undefined) parts.push(`< ${schema.exclusiveMaximum}`);
  else if (schema.maximum !== undefined) parts.push(`≤ ${schema.maximum}`);
  if (schema.minLength !== undefined && schema.minLength > 1) {
    parts.push(zh ? `长度≥${schema.minLength}` : `len≥${schema.minLength}`);
  }
  return parts.join(', ');
}

interface PluginDataSectionProps {
  pluginId: string;
  plugin: Plugin;
}

export function PluginDataSection({ pluginId, plugin }: PluginDataSectionProps) {
  const { locale } = useLocale();
  const zh = locale.toLowerCase().startsWith('zh');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [slotIndex, setSlotIndex] = useState(0);

  const schemas = useMemo(
    () => resolvePluginDataSchemas(plugin.manifest),
    [plugin.manifest],
  );
  const legacyFormats = plugin.manifest.formats ?? [];
  const hasLoadData =
    typeof plugin.loadData === 'function' || typeof plugin.loadValidatedData === 'function';

  const safeSlot = slotIndex < schemas.length ? slotIndex : 0;
  const activeSchema: PluginDataSchema | null = schemas[safeSlot] ?? null;

  const bindingKey = activeSchema ? `${pluginId}::${activeSchema.id}` : `${pluginId}::legacy`;
  const binding = useDataEditorStore((s) => s.bindings[bindingKey]);
  const stale = useDataEditorStore((s) => s.staleBindings[bindingKey]);
  const openEditor = useDataEditorStore((s) => s.openEditor);
  const ingestForPlugin = useDataEditorStore((s) => s.ingestForPlugin);
  const loadTemplateForPlugin = useDataEditorStore((s) => s.loadTemplateForPlugin);
  const reloadStaleBinding = useDataEditorStore((s) => s.reloadStaleBinding);
  const dismissStale = useDataEditorStore((s) => s.dismissStale);

  // Hide card completely for pure simulation/educational plugins with no data input.
  if (!hasLoadData && schemas.length === 0 && legacyFormats.length === 0) {
    return null;
  }

  const acceptExt = activeSchema
    ? activeSchema.extensions.join(',')
    : legacyFormats.map((f) => f.extension).join(',');

  const canOnlineEdit =
    activeSchema !== null
      ? activeSchema.kind !== 'binary'
      : legacyFormats.some((f) => isSupportedDataFileName(`x${f.extension}`));

  const handleUploadFile = async (file: File | undefined) => {
    if (!file) return;
    const isBinary = activeSchema?.kind === 'binary' || !isSupportedDataFileName(file.name);
    if (isBinary) {
      if (typeof plugin.loadData === 'function') {
        try {
          await plugin.loadData(file);
          useAppStore
            .getState()
            .notify('success', zh ? `已载入 ${file.name}` : `Loaded ${file.name}`);
        } catch (err) {
          useAppStore
            .getState()
            .notify('error', `${zh ? '载入失败：' : 'Load failed: '}${String(err)}`);
        }
      }
      return;
    }

    const text = await file.text();
    let fileId: string | undefined;
    const projectStore = useProjectStore.getState();
    if (projectStore.project && isSupportedDataFileName(file.name)) {
      try {
        fileId = (await projectStore.addDataFile(file)) ?? undefined;
      } catch {
        /* non-fatal */
      }
    }

    await ingestForPlugin({
      pluginId,
      schemaId: activeSchema?.id,
      fileName: file.name,
      text,
      origin: fileId ? 'project-file' : 'upload',
      fileId,
    });
  };

  const handlePickProjectFile = async (name: string) => {
    const project = useProjectStore.getState().project;
    const entry = project?.data.files.find((f) => f.name === name);
    const text = entry ? entry.content : await resolveDataFile(name);
    if (text === undefined) {
      useAppStore
        .getState()
        .notify('error', zh ? `无法读取文件 ${name}` : `Cannot read file ${name}`);
      return;
    }
    await ingestForPlugin({
      pluginId,
      schemaId: activeSchema?.id,
      fileName: name,
      text,
      origin: entry ? 'project-file' : 'example',
      fileId: entry?.id,
    });
  };

  const titleText = activeSchema
    ? activeSchema.titleI18n?.[locale] ?? activeSchema.title
    : zh
      ? '数据输入'
      : 'Data Input';

  const descText = activeSchema
    ? activeSchema.descriptionI18n?.[locale] ?? activeSchema.description
    : undefined;

  return (
    <section className="pds-card" aria-label={zh ? '插件数据契约' : 'Plugin data contract'}>
      <button
        type="button"
        className="pds-card-head"
        onClick={() => setCollapsed((c) => !c)}
        aria-expanded={!collapsed}
      >
        <span className="pds-card-title">
          <span className="pds-card-dot" aria-hidden="true" />
          <span>{titleText}</span>
        </span>
        <span className="pds-card-chevron">{collapsed ? '▸' : '▾'}</span>
      </button>

      {!collapsed && (
        <div className="pds-card-body">
          {schemas.length > 1 && (
            <div className="pds-slot-tabs" role="tablist">
              {schemas.map((s, idx) => (
                <button
                  key={s.id}
                  type="button"
                  role="tab"
                  aria-selected={idx === safeSlot}
                  className={`pds-slot-tab${idx === safeSlot ? ' is-active' : ''}`}
                  onClick={() => setSlotIndex(idx)}
                >
                  {s.kind === 'tabular' ? 'CSV/表格' : s.kind.toUpperCase()}
                </button>
              ))}
            </div>
          )}

          {binding && (
            <div className="pds-binding-bar">
              <span className="pds-binding-name" title={binding.fileName}>
                {binding.origin === 'draft' ? '✎ ' : binding.origin === 'example' ? '✦ ' : '▦ '}
                {binding.fileName}
              </span>
              <span className="pds-binding-badge">
                {binding.origin === 'project-file'
                  ? zh
                    ? '项目数据'
                    : 'Project'
                  : binding.origin === 'draft'
                    ? zh
                      ? '草稿'
                      : 'Draft'
                    : zh
                      ? '示例'
                      : 'Sample'}
              </span>
            </div>
          )}

          {stale && activeSchema && (
            <div className="pds-stale-banner">
              <span>
                {zh
                  ? `${stale.fileName} 已在外部更新`
                  : `${stale.fileName} was updated externally`}
              </span>
              <div className="pds-stale-actions">
                <button
                  type="button"
                  className="btn btn-xs btn-primary"
                  onClick={() => void reloadStaleBinding(pluginId, activeSchema.id)}
                >
                  {zh ? '刷新' : 'Reload'}
                </button>
                <button
                  type="button"
                  className="btn btn-xs"
                  onClick={() => dismissStale(pluginId, activeSchema.id)}
                >
                  {zh ? '忽略' : 'Ignore'}
                </button>
              </div>
            </div>
          )}

          {descText && <p className="pds-desc">{descText}</p>}

          {/* Structured schema preview */}
          {activeSchema?.kind === 'tabular' && (
            <TabularContractList schema={activeSchema} locale={locale} zh={zh} />
          )}

          {activeSchema?.kind === 'json' && (
            <div className="pds-json-meta">
              <div className="pds-schema-note">
                {zh ? 'JSON 结构字段：' : 'JSON fields:'}
              </div>
              <ul className="pds-col-list">
                {Object.entries(activeSchema.schema.properties ?? {}).map(([key, prop]) => {
                  const req = activeSchema.schema.required?.includes(key) ?? false;
                  const lbl = prop['x-ergalics']?.labelI18n?.[locale] ?? prop.title ?? key;
                  return (
                    <li key={key} className="pds-col-row">
                      <span className="pds-col-key">
                        <code>{key}</code>
                        {req && <span className="pds-req">*</span>}
                      </span>
                      <span className="pds-col-type">
                        {Array.isArray(prop.type) ? prop.type.join('|') : prop.type ?? 'any'}
                      </span>
                      <span className="pds-col-extra">{lbl !== key ? lbl : ''}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {activeSchema?.kind === 'text' && (
            <p className="pds-schema-note">
              {activeSchema.grammarSummaryI18n?.[locale] ??
                activeSchema.grammarSummary ??
                activeSchema.extensions.join(', ')}
            </p>
          )}

          {/* Legacy fallback when plugin hasn't declared dataSchema yet */}
          {!activeSchema && legacyFormats.length > 0 && (
            <div className="pds-legacy-formats">
              <div className="pds-ext-tags">
                {legacyFormats.map((f) => (
                  <span key={f.extension} className="tag tag-muted" title={f.description}>
                    {f.extension}
                  </span>
                ))}
              </div>
              {legacyFormats[0]?.description && (
                <p className="pds-schema-note">{legacyFormats[0].description}</p>
              )}
            </div>
          )}

          {/* 4 direct action buttons */}
          <div className="pds-actions">
            {canOnlineEdit && (
              <button
                type="button"
                className="btn btn-sm btn-primary"
                onClick={() =>
                  openEditor({
                    pluginId,
                    schema: activeSchema,
                    layout: 'docked',
                  })
                }
              >
                {zh ? '✎ 在线编辑' : '✎ Edit Data'}
              </button>
            )}
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => setPickerOpen(true)}
            >
              {zh ? '▦ 项目数据' : '▦ Project Data'}
            </button>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => fileInputRef.current?.click()}
            >
              {zh ? '↑ 上传文件' : '↑ Upload'}
            </button>
            {activeSchema && activeSchema.kind !== 'binary' && (
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => void loadTemplateForPlugin(pluginId, activeSchema)}
              >
                {zh ? '✦ 载入模板' : '✦ Template'}
              </button>
            )}
          </div>
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept={acceptExt || undefined}
        style={{ display: 'none' }}
        onChange={(e) => {
          void handleUploadFile(e.target.files?.[0]);
          e.target.value = '';
        }}
      />

      <DataFilePickerModal
        open={pickerOpen}
        mode="pick"
        value={binding?.fileName}
        onChoose={(name) => void handlePickProjectFile(name)}
        onClose={() => setPickerOpen(false)}
      />
    </section>
  );
}

function TabularContractList({
  schema,
  locale,
  zh,
}: {
  schema: TabularDataSchema;
  locale: string;
  zh: boolean;
}) {
  const cols = useMemo(() => extractTabularColumns(schema), [schema]);
  const notes: string[] = [];
  if (schema.minRows !== undefined) {
    notes.push(zh ? `至少 ${schema.minRows} 行` : `≥ ${schema.minRows} rows`);
  }
  if (schema.allowExtraColumns) {
    notes.push(zh ? '允许附加列' : 'extra cols allowed');
  }
  if (schema.allowHeaderless) {
    notes.push(zh ? '支持无表头数值' : 'headerless ok');
  }

  return (
    <div className="pds-tabular-meta">
      <ul className="pds-col-list">
        {cols.map((col) => {
          const label = columnLabel(col, locale);
          const constraint = formatConstraints(col.schema, zh);
          const tip = [
            col.meta.descriptionI18n?.[locale] ?? col.schema.description,
            col.meta.aliases?.length
              ? `${zh ? '别名：' : 'Aliases: '}${col.meta.aliases.join(', ')}`
              : '',
          ]
            .filter(Boolean)
            .join(' · ');

          return (
            <li key={col.key} className="pds-col-row" title={tip || undefined}>
              <span className="pds-col-key">
                <code>{col.key}</code>
                {col.required && (
                  <span className="pds-req" title={zh ? '必填' : 'Required'}>
                    *
                  </span>
                )}
              </span>
              <span className="pds-col-type">
                {formatTypeBadge(col, zh)}
                {col.meta.unit ? ` (${col.meta.unit})` : ''}
              </span>
              <span className="pds-col-extra">
                {constraint || (label !== col.key ? label : col.required ? '' : zh ? '可选' : 'opt')}
              </span>
            </li>
          );
        })}
      </ul>
      {notes.length > 0 && <div className="pds-schema-note">{notes.join(' · ')}</div>}
    </div>
  );
}
