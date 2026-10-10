// ==========================================================================
// Ergalics Studio — standalone Monaco editor hook (file editor tabs)
//
// A slim wrapper around monaco.editor.create for file-editing tabs in the
// standard-mode canvas (design doc P2). Owns: theme application, the shared
// `studio.*` completion providers, external value sync (disk reload), Ctrl+S
// save wiring and dispose. The code-mode editor (CodeEditor.tsx) keeps its
// own richer setup — sessions, runtimes and preview surfaces.
// ==========================================================================

import { useEffect, useRef, type RefObject } from 'react';
import type * as MonacoNS from 'monaco-editor';
import { useTheme } from '@/theme';
import { monaco, applyMonacoTheme, monacoThemeData } from '@/core/monaco/setup';
import { STUDIO_COMPLETIONS } from '@/core/monaco/completions';

interface UseMonacoEditorOptions {
  language: string;
  /** Authoritative buffer (store payload). Synced into the model whenever it
   *  changes from the outside (disk reload); local edits flow out via
   *  `onChange` instead. */
  value: string;
  readOnly?: boolean;
  onChange?: (value: string) => void;
  onSave?: () => void;
}

export function useMonacoEditor(
  containerRef: RefObject<HTMLElement | null>,
  opts: UseMonacoEditorOptions,
): RefObject<MonacoNS.editor.IStandaloneCodeEditor | null> {
  const editorRef = useRef<MonacoNS.editor.IStandaloneCodeEditor | null>(null);
  const { resolved } = useTheme();
  // Latest callbacks without re-creating the editor on parent re-renders.
  const optsRef = useRef(opts);
  optsRef.current = opts;
  /** True while this hook pushes a value INTO the model — the echo must not
   *  loop back through onChange (it would re-mark the tab dirty after a
   *  disk reload). */
  const silentRef = useRef(false);

  // Theme follows the app theme reactively (same 'ergalics' theme id the
  // code-mode editor registers; define+set is idempotent).
  useEffect(() => {
    applyMonacoTheme(resolved);
    monaco.editor.defineTheme('ergalics', monacoThemeData(resolved));
    monaco.editor.setTheme('ergalics');
  }, [resolved]);

  // Create once per mount; dispose + drop completion providers on unmount.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const o = optsRef.current;
    const editor = monaco.editor.create(el, {
      value: o.value,
      language: o.language,
      theme: 'ergalics',
      readOnly: o.readOnly,
      automaticLayout: true,
      fontSize: 14,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      insertSpaces: true,
      renderWhitespace: 'selection',
      wordWrap: 'on',
      padding: { top: 12, bottom: 12 },
    });
    editorRef.current = editor;

    editor.onDidChangeModelContent(() => {
      if (silentRef.current) return;
      optsRef.current.onChange?.(editor.getValue());
    });
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      optsRef.current.onSave?.();
    });

    // studio.* completions for every language this editor may host. Providers
    // are editor-independent — dispose them with the editor so remounts never
    // stack duplicate registrations.
    const providers = (['python', 'r', 'javascript'] as const).map((lang) =>
      monaco.languages.registerCompletionItemProvider(lang, {
        provideCompletionItems: (model, position) => {
          const word = model.getWordUntilPosition(position);
          const range: MonacoNS.IRange = {
            startLineNumber: position.lineNumber,
            endLineNumber: position.lineNumber,
            startColumn: word.startColumn,
            endColumn: word.endColumn,
          };
          return { suggestions: STUDIO_COMPLETIONS.map((c) => ({ ...c, range })) };
        },
      }),
    );

    return () => {
      providers.forEach((p) => p.dispose());
      editor.dispose();
      editorRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // External value sync: replace the model only when the incoming buffer
  // differs from what the user sees (never clobber mid-typing state).
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || editor.getValue() === opts.value) return;
    silentRef.current = true;
    editor.setValue(opts.value);
    window.requestAnimationFrame(() => {
      silentRef.current = false;
    });
  }, [opts.value]);

  // Language switch (rare: only after a rename to a different extension).
  useEffect(() => {
    const editor = editorRef.current;
    const model = editor?.getModel();
    if (editor && model) monaco.editor.setModelLanguage(model, opts.language);
  }, [opts.language]);

  return editorRef;
}
