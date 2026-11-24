// ==========================================================================
// Ergalics Studio — Online JSON / Domain-Text Editor (Monaco + Zod, Lazy)
//
// Powers `kind: 'json'` (with Monaco JSON Schema autocomplete, hover docs &
// diagnostics) and `kind: 'text'` / schema-less text files, sharing the exact
// same live-sync and global project-data save-back contract as TabularDataEditor.
// ==========================================================================

import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocale } from '@/i18n';
import type { DataValidationIssue } from '@/types/dataSchema';
import { validatePluginDataText } from '@/core/data-schema/ingestion';
import { downloadText } from '@/core/plot/export';
import {
  buildSchemaTemplateText,
  useDataEditorStore,
  type DataEditorSession,
} from '@/stores/dataEditorStore';
import { useProjectStore } from '@/stores/projectStore';
import { usePluginStore } from '@/stores/pluginStore';
import { useAppStore } from '@/stores/appStore';
import { useSettingsStore } from '@/stores/settingsStore';
import type * as MonacoNS from 'monaco-editor';

export function TextDataEditor({ session }: { session: DataEditorSession }) {
  const { locale } = useLocale();
  const zh = locale.toLowerCase().startsWith('zh');
  const theme = useSettingsStore((s) => s.theme);
  const resolvedTheme: 'light' | 'dark' =
    theme === 'light' || theme === 'dark'
      ? theme
      : typeof window !== 'undefined' &&
          window.matchMedia('(prefers-color-scheme: light)').matches
        ? 'light'
        : 'dark';

  const updateEditorDraftText = useDataEditorStore((s) => s.updateEditorDraftText);
  const markEditorSaved = useDataEditorStore((s) => s.markEditorSaved);
  const ingestForPlugin = useDataEditorStore((s) => s.ingestForPlugin);
  const notify = useAppStore((s) => s.notify);

  const [text, setText] = useState(session.text);
  const [dirty, setDirty] = useState(false);
  const [saveAsMode, setSaveAsMode] = useState(false);
  const [saveAsName, setSaveAsName] = useState(session.fileName);
  const [saving, setSaving] = useState(false);

  const hostRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<MonacoNS.editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<typeof MonacoNS | null>(null);
  const liveTimerRef = useRef<number | null>(null);
  const sessionKeyRef = useRef(session.sessionKey);

  const isJson =
    session.schema?.kind === 'json' || session.fileName.toLowerCase().endsWith('.json');
  const language = isJson
    ? 'json'
    : session.schema?.kind === 'text'
      ? (session.schema.language ?? 'plaintext')
      : 'plaintext';

  // Reset buffer when switching to a brand-new editing session.
  useEffect(() => {
    if (sessionKeyRef.current !== session.sessionKey) {
      sessionKeyRef.current = session.sessionKey;
      setText(session.text);
      setDirty(false);
      setSaveAsMode(false);
      setSaveAsName(session.fileName);
      if (editorRef.current && editorRef.current.getValue() !== session.text) {
        editorRef.current.setValue(session.text);
      }
    }
  }, [session.sessionKey, session.text, session.fileName]);

  // Mount Monaco lazily + bind JSON Schema diagnostics when kind === 'json'.
  useEffect(() => {
    let disposed = false;
    let model: MonacoNS.editor.ITextModel | null = null;

    void import('@/core/monaco/setup').then(({ monaco, monacoThemeData }) => {
      if (disposed || !hostRef.current) return;
      monacoRef.current = monaco;

      const themeName = resolvedTheme === 'dark' ? 'ergalics-dark' : 'ergalics-light';
      monaco.editor.defineTheme(themeName, monacoThemeData(resolvedTheme));
      monaco.editor.setTheme(themeName);

      const uriStr = `inmemory://ergalics-data/${session.sessionKey}/${session.fileName}`;
      const uri = monaco.Uri.parse(uriStr);

      if (session.schema?.kind === 'json') {
        // Monaco 0.57 exposes jsonDefaults under languages.json (typed lazily).
        const jsonLang = (monaco.languages as unknown as {
          json?: {
            jsonDefaults?: {
              setDiagnosticsOptions: (opts: Record<string, unknown>) => void;
            };
          };
        }).json;
        jsonLang?.jsonDefaults?.setDiagnosticsOptions({
          validate: true,
          allowComments: false,
          schemas: [
            {
              uri: `inmemory://ergalics-schema/${session.schema.id}.json`,
              fileMatch: [uriStr],
              schema: session.schema.schema,
            },
          ],
        });
      }

      model = monaco.editor.createModel(text, language, uri);
      const ed = monaco.editor.create(hostRef.current, {
        model,
        automaticLayout: true,
        minimap: { enabled: false },
        fontSize: 13,
        lineNumbers: 'on',
        scrollBeyondLastLine: false,
        tabSize: 2,
        wordWrap: 'on',
      });
      editorRef.current = ed;

      if (session.focusRow) {
        ed.revealLineInCenter(session.focusRow);
        ed.setPosition({ lineNumber: session.focusRow, column: 1 });
      }

      ed.onDidChangeModelContent(() => {
        const nextVal = ed.getValue();
        setText(nextVal);
        setDirty(true);
        updateEditorDraftText(nextVal);
      });
    });

    return () => {
      disposed = true;
      editorRef.current?.dispose();
      editorRef.current = null;
      model?.dispose();
    };
    // Mount once per sessionKey/language; theme updates handled separately.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.sessionKey, language]);

  // Live Zod validation against schema (fast for JSON/text).
  const issues: DataValidationIssue[] = useMemo(() => {
    if (!session.schema) return [];
    const res = validatePluginDataText(text, session.schema, {
      fileName: session.fileName,
      locale,
    });
    return res.status === 'invalid' ? res.issues : [];
  }, [text, session.schema, session.fileName, locale]);

  // 300ms debounced Live-Sync.
  useEffect(() => {
    if (!dirty || !session.liveSync || !session.pluginId || issues.length > 0) return;
    if (liveTimerRef.current !== null) window.clearTimeout(liveTimerRef.current);
    liveTimerRef.current = window.setTimeout(() => {
      liveTimerRef.current = null;
      void ingestForPlugin({
        pluginId: session.pluginId!,
        schemaId: session.schema?.id,
        fileName: session.fileName,
        text,
        origin: 'online-editor',
        fileId: session.fileId,
        silent: true,
      });
    }, 300);
    return () => {
      if (liveTimerRef.current !== null) window.clearTimeout(liveTimerRef.current);
    };
  }, [
    dirty,
    text,
    issues.length,
    session.liveSync,
    session.pluginId,
    session.schema?.id,
    session.fileName,
    session.fileId,
    ingestForPlugin,
  ]);

  const handleLoadTemplate = () => {
    if (!session.schema) return;
    const tpl = buildSchemaTemplateText(session.schema);
    setText(tpl);
    setDirty(true);
    updateEditorDraftText(tpl);
    editorRef.current?.setValue(tpl);
  };

  const handleFormatJson = () => {
    if (!isJson) return;
    try {
      const pretty = JSON.stringify(JSON.parse(text), null, 2);
      setText(pretty);
      setDirty(true);
      updateEditorDraftText(pretty);
      editorRef.current?.setValue(pretty);
    } catch {
      notify('warning', zh ? '当前 JSON 存在语法错误，无法格式化' : 'Cannot format invalid JSON');
    }
  };

  const handleApply = async () => {
    if (!session.pluginId) return;
    await ingestForPlugin({
      pluginId: session.pluginId,
      schemaId: session.schema?.id,
      fileName: session.fileName,
      text,
      origin: 'online-editor',
      fileId: session.fileId,
    });
  };

  const handleSaveToProject = async (mode: 'overwrite' | 'save-as') => {
    setSaving(true);
    try {
      const projectStore = useProjectStore.getState();
      if (!projectStore.project) {
        const prevActiveId = usePluginStore.getState().activeId ?? session.pluginId;
        await projectStore.createProject('');
        if (prevActiveId && usePluginStore.getState().activeId !== prevActiveId) {
          await usePluginStore.getState().activate(prevActiveId);
          useAppStore.getState().showPluginCanvas();
        }
      }
      if (mode === 'overwrite' && session.fileId && session.origin === 'project-file') {
        const ok = await useProjectStore
          .getState()
          .updateDataFile(session.fileId, text, session.pluginId ?? undefined);
        if (ok) {
          markEditorSaved(session.fileId, session.fileName, text);
          setDirty(false);
          if (session.pluginId) {
            await ingestForPlugin({
              pluginId: session.pluginId,
              schemaId: session.schema?.id,
              fileName: session.fileName,
              text,
              origin: 'project-file',
              fileId: session.fileId,
              silent: true,
            });
          }
          notify('success', zh ? `已覆盖保存 ${session.fileName}` : `Saved ${session.fileName}`);
        }
        return;
      }
      const ext = isJson ? '.json' : '.txt';
      const rawName = saveAsName.trim() || session.fileName || `data${ext}`;
      const finalName = rawName.includes('.') ? rawName : `${rawName}${ext}`;
      const file = new File([text], finalName, {
        type: isJson ? 'application/json' : 'text/plain',
      });
      const newId = await useProjectStore.getState().addDataFile(file);
      if (newId) {
        markEditorSaved(newId, finalName, text);
        setDirty(false);
        setSaveAsMode(false);
        if (session.pluginId) {
          await ingestForPlugin({
            pluginId: session.pluginId,
            schemaId: session.schema?.id,
            fileName: finalName,
            text,
            origin: 'project-file',
            fileId: newId,
            silent: true,
          });
        }
        notify('success', zh ? `已保存到项目数据：${finalName}` : `Saved to project: ${finalName}`);
      }
    } catch (err) {
      notify(
        'error',
        `${zh ? '保存失败：' : 'Save failed: '}${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setSaving(false);
    }
  };

  const canOverwrite = Boolean(session.fileId && session.origin === 'project-file');
  const hasErrors = issues.length > 0;

  return (
    <div className="pds-editor-surface">
      <div className="pds-editor-toolbar">
        <div className="pds-editor-toolbar-group">
          {session.schema && (
            <button type="button" className="btn btn-xs" onClick={handleLoadTemplate}>
              {zh ? '填充示例' : 'Load Template'}
            </button>
          )}
          {isJson && (
            <button type="button" className="btn btn-xs" onClick={handleFormatJson}>
              {zh ? '格式化 JSON' : 'Format JSON'}
            </button>
          )}
        </div>
        <div className="pds-editor-toolbar-group">
          <button
            type="button"
            className="btn btn-xs"
            onClick={() =>
              downloadText(text, session.fileName, isJson ? 'application/json' : 'text/plain')
            }
          >
            {zh ? '↓ 导出文件' : '↓ Export'}
          </button>
        </div>
      </div>

      <div className="pds-monaco-wrap" ref={hostRef} />

      <div className="pds-editor-footer">
        <div className="pds-editor-status">
          {hasErrors ? (
            <button
              type="button"
              className="pds-status-err pds-status-btn"
              onClick={() => {
                const line = issues[0]?.row;
                if (line && editorRef.current) {
                  editorRef.current.revealLineInCenter(line);
                  editorRef.current.setPosition({ lineNumber: line, column: 1 });
                  editorRef.current.focus();
                }
              }}
            >
              ⚠ {issues[0]?.message}
              {issues.length > 1 ? ` (+${issues.length - 1})` : ''}
            </button>
          ) : (
            <span className="pds-status-ok">✓ {zh ? '校验通过' : 'Valid'}</span>
          )}
        </div>

        <div className="pds-editor-actions">
          {saveAsMode ? (
            <span className="pds-saveas-inline">
              <input
                type="text"
                className="input pds-saveas-input"
                aria-label="file name"
                value={saveAsName}
                onChange={(e) => setSaveAsName(e.target.value)}
              />
              <button
                type="button"
                className="btn btn-xs btn-primary"
                disabled={saving}
                onClick={() => void handleSaveToProject('save-as')}
              >
                {zh ? '确认保存' : 'Save'}
              </button>
              <button
                type="button"
                className="btn btn-xs"
                onClick={() => setSaveAsMode(false)}
              >
                {zh ? '取消' : 'Cancel'}
              </button>
            </span>
          ) : (
            <>
              {canOverwrite && (
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={hasErrors || saving}
                  onClick={() => void handleSaveToProject('overwrite')}
                >
                  {zh ? '覆盖原文件' : 'Overwrite File'}
                </button>
              )}
              <button
                type="button"
                className="btn btn-sm"
                disabled={hasErrors || saving}
                onClick={() => {
                  setSaveAsName(session.fileName);
                  setSaveAsMode(true);
                }}
              >
                {canOverwrite
                  ? zh
                    ? '另存为项目文件'
                    : 'Save As…'
                  : zh
                    ? '保存到项目数据'
                    : 'Save to Project'}
              </button>
              {session.pluginId && (
                <button
                  type="button"
                  className="btn btn-sm btn-primary"
                  disabled={hasErrors}
                  onClick={() => void handleApply()}
                >
                  {zh ? '应用到插件' : 'Apply to Plugin'}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
