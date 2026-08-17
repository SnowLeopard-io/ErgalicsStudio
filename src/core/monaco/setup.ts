// ==========================================================================
// Ergalics Studio — Monaco worker bootstrap
//
// Monaco ships its own web workers for editor/language services. Vite bundles
// the editor worker through the `?worker` suffix and we point Monaco at it via
// `self.MonacoEnvironment`. Python is a *basic language* (tokenizer only, no
// language service), so the plain editor worker is all code mode needs.
// ==========================================================================

import * as monaco from 'monaco-editor';
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';

self.MonacoEnvironment = {
  getWorker: () => new editorWorker(),
};

/** Apply the resolved app theme to Monaco (code editor + dialogs). */
export function applyMonacoTheme(theme: 'light' | 'dark'): void {
  monaco.editor.setTheme(theme === 'dark' ? 'vs-dark' : 'vs');
}

/** Soft theme tokens so the editor blends with the app chrome.
 *
 * NOTE: Monaco's standalone theme service resolves every color with
 * `Color.fromHex()`, which accepts ONLY `#RRGGBB` / `#RRGGBBAA` and falls
 * back to pure red for anything else. All values below are therefore hex —
 * an `rgba(...)` string would render as bright red.
 */
export function monacoThemeData(theme: 'light' | 'dark'): monaco.editor.IStandaloneThemeData {
  return theme === 'dark'
    ? {
        base: 'vs-dark',
        inherit: true,
        rules: [],
        colors: {
          'editor.background': '#0a0e13',
          'editor.lineHighlightBackground': '#8a97a31a', // gray, not red
          'editor.selectionBackground': '#3884ff47',
          'editorWidget.background': '#141b24',
          'editorWidget.border': '#2b3542',
          'editorSuggestWidget.background': '#141b24',
          'editorSuggestWidget.selectedBackground': '#3884ff40',
          'editorCursor.foreground': '#4cc2c0',
          'editor.lineNumber.foreground': '#5a6b7d',
          'editor.lineNumber.activeForeground': '#93a4b6',
          'editorIndentGuide.background': '#7da0c81f',
          'editorIndentGuide.activeBackground': '#7da0c840',
          'scrollbarSlider.background': '#7da0c833',
          'scrollbarSlider.hoverBackground': '#7da0c84d',
          'scrollbarSlider.activeBackground': '#7da0c859',
        },
      }
    : {
        base: 'vs',
        inherit: true,
        rules: [],
        colors: {
          'editor.lineHighlightBackground': '#8a97a333',
          'editor.selectionBackground': '#1e88e52e',
          'editorCursor.foreground': '#0b8a87',
          'editorIndentGuide.background': '#7d8ca029',
          'editorIndentGuide.activeBackground': '#7d8ca04d',
          'scrollbarSlider.background': '#7d8ca040',
          'scrollbarSlider.hoverBackground': '#7d8ca059',
          'scrollbarSlider.activeBackground': '#7d8ca066',
        },
      };
}

export { monaco };