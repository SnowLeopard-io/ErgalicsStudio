// ==========================================================================
// Ergalics Studio — code file editor (canvas editor tab, design doc P2)
//
// Edits a `.py` / `.js` / `.r` file from the project working tree inside a
// standard-mode canvas tab. The buffer lives in appStore.editorFiles (the
// tab strip owns dirty state + save&close); this component mirrors edits
// into it (debounced), saves on Ctrl+S / toolbar button, and reloads from
// disk when the file changes externally while the buffer is clean.
// ==========================================================================

import { useCallback, useEffect, useRef } from 'react';
import { useT } from '@/i18n';
import { useAppStore, editorTabKey } from '@/stores/appStore';
import { useMonacoEditor } from './useMonacoEditor';
import { monacoLanguageFor, readRepoFileText } from './shared';
import { editorStoreOpenInMode } from './openInMode';

const PUSH_DEBOUNCE_MS = 300;

/** Monaco language → editorStore CodeLanguage ("open in code mode" bridge). */
function toCodeLanguage(monacoLang: string): 'python' | 'r' | 'js' {
  if (monacoLang === 'r') return 'r';
  if (monacoLang === 'javascript') return 'js';
  return 'python';
}

export function CodeFileEditor({ path }: { path: string }) {
  const t = useT();
  const state = useAppStore((s) => s.editorFiles[editorTabKey(path)]);
  const fileOpsVersion = useAppStore((s) => s.fileOpsVersion);
  const updateEditorFile = useAppStore((s) => s.updateEditorFile);
  const saveEditorFile = useAppStore((s) => s.saveEditorFile);

  const containerRef = useRef<HTMLDivElement>(null);
  const pushTimer = useRef<number | null>(null);
  const opsSnapshot = useRef(fileOpsVersion);
  const monacoLang = monacoLanguageFor(path);

  const flush = useCallback(
    (value: string) => {
      if (pushTimer.current !== null) {
        window.clearTimeout(pushTimer.current);
        pushTimer.current = null;
      }
      updateEditorFile(path, value);
    },
    [path, updateEditorFile],
  );

  const save = useCallback(() => {
    const editor = editorRef.current;
    if (editor) flush(editor.getValue());
    void saveEditorFile(path);
    // editorRef is a stable ref object returned by useMonacoEditor below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flush, saveEditorFile, path]);

  const editorRef = useMonacoEditor(containerRef, {
    language: monacoLang,
    value: state?.payload ?? '',
    onChange: (value) => {
      // Debounce so dragging a selection / holding a key doesn't spam the store.
      if (pushTimer.current !== null) window.clearTimeout(pushTimer.current);
      pushTimer.current = window.setTimeout(() => {
        pushTimer.current = null;
        updateEditorFile(path, value);
      }, PUSH_DEBOUNCE_MS);
    },
    onSave: save,
  });

  // External-change detection: when the working tree moves under a CLEAN
  // buffer (another surface saved this file), reload it. A dirty buffer wins
  // — the user's unsaved edits must never be silently replaced.
  useEffect(() => {
    if (fileOpsVersion === opsSnapshot.current) return;
    opsSnapshot.current = fileOpsVersion;
    const cur = useAppStore.getState().editorFiles[editorTabKey(path)];
    if (!cur || cur.dirty) return;
    void readRepoFileText(path).then((text) => {
      if (text === null || text === cur.payload) return;
      updateEditorFile(path, text);
      const after = useAppStore.getState().editorFiles[editorTabKey(path)];
      // updateEditorFile marks dirty — restore the clean flag after a reload.
      if (after && after.dirty) {
        useAppStore.setState((s) => ({
          editorFiles: {
            ...s.editorFiles,
            [editorTabKey(path)]: { ...after, dirty: false },
          },
        }));
      }
    });
  }, [fileOpsVersion, path, updateEditorFile]);

  // Flush a pending debounced push before the pane unmounts.
  useEffect(() => {
    return () => {
      if (pushTimer.current !== null) {
        window.clearTimeout(pushTimer.current);
        pushTimer.current = null;
      }
    };
  }, []);

  if (!state) return null;

  if (state.broken) {
    return <BrokenFileView name={state.name} payload={state.payload} />;
  }

  const openInCodeMode = () =>
    editorStoreOpenInMode({
      mode: 'code',
      language: toCodeLanguage(monacoLang),
      code: state.payload,
    });

  return (
    <div className="central-file-editor">
      <div className="central-file-editor-toolbar">
        <SaveButton dirty={state.dirty} onSave={save} />
        <button type="button" className="btn btn-sm" onClick={openInCodeMode} title={t('workbench.editor.open_in_mode_code')}>
          {t('workbench.editor.open_in_mode')}
        </button>
      </div>
      <div ref={containerRef} className="central-file-editor-monaco" />
    </div>
  );
}

/** Shared save chip (dirty dot + label) used by every file editor toolbar. */
export function SaveButton({ dirty, onSave }: { dirty: boolean; onSave: () => void }) {
  const t = useT();
  return (
    <button type="button" className="btn btn-sm central-editor-save" onClick={onSave} title={t('workbench.editor.save')}>
      {dirty && <span className="central-editor-dirty-dot" aria-hidden="true" />}
      {t('workbench.editor.save')}
    </button>
  );
}

/** Read-only degrade for content that failed to parse as its editor format. */
export function BrokenFileView({ name, payload }: { name: string; payload: string }) {
  const t = useT();
  return (
    <div className="central-file-editor">
      <div className="central-editor-broken-banner" role="alert">
        {t('workbench.editor.broken')}
      </div>
      <div className="central-editor-broken-head">{name}</div>
      <pre className="central-editor-broken-source">{payload}</pre>
    </div>
  );
}
