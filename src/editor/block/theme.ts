// ==========================================================================
// Ergalics Studio — Blockly "studio-kids" theme
//
// Compact, modern theme tuned for the Ergalics Studio workbench (block-code-
// modes.md §6.6). The workspace background is a deep neutral so the colorful
// Scratch-style category colors stand out; the toolbox/flyout gets a softer
// accent scrollbar and a teal selection glow to match the app's accent.
// ==========================================================================

export interface KidsTheme {
  name: string;
  fontStyle?: { family?: string; weight?: string; size?: number };
  componentStyles?: Record<string, string | number>;
  startHats?: boolean;
}

export function createKidsTheme(dark: boolean): KidsTheme {
  return {
    // Keep the theme's own name aligned with the registration name used by the
    // engine (`studio-kids` vs `studio-kids-dark`); a hardcoded `studio-kids`
    // here left the dark theme labelled with the light name.
    name: dark ? 'studio-kids-dark' : 'studio-kids',
    startHats: true,
    fontStyle: {
      family: "'Inter', 'PingFang SC', 'Microsoft YaHei', 'Segoe UI', system-ui, sans-serif",
      weight: '500',
      size: 11,
    },
    componentStyles: dark
      ? {
          workspaceBackgroundColour: '#070b10',
          toolboxBackgroundColour: '#121820',
          toolboxForegroundColour: '#cbd5e1',
          flyoutBackgroundColour: '#121820',
          flyoutForegroundColour: '#cbd5e1',
          flyoutOpacity: 1,
          scrollbarColour: '#3aa8a0',
          scrollbarOpacity: 0.4,
          insertionMarkerColour: '#3aa8a0',
          insertionMarkerOpacity: 0.55,
          cursorColour: '#e6edf3',
          selectedGlowColour: '#3aa8a0',
          selectedGlowOpacity: 0.35,
          replacementGlowColour: '#6fd0c8',
          replacementGlowOpacity: 0.4,
        }
      : {
          workspaceBackgroundColour: '#fafbfc',
          toolboxBackgroundColour: '#ffffff',
          toolboxForegroundColour: '#1e293b',
          flyoutBackgroundColour: '#ffffff',
          flyoutForegroundColour: '#1e293b',
          flyoutOpacity: 1,
          scrollbarColour: '#0e6b74',
          scrollbarOpacity: 0.4,
          insertionMarkerColour: '#0e6b74',
          insertionMarkerOpacity: 0.55,
          cursorColour: '#0f172a',
          selectedGlowColour: '#0e6b74',
          selectedGlowOpacity: 0.35,
          replacementGlowColour: '#0e6b74',
          replacementGlowOpacity: 0.4,
        },
  };
}