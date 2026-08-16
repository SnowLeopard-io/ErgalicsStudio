// ==========================================================================
// Ergalics Studio — Blockly "studio-kids" theme
//
// Large, high-contrast theme for young learners (block-code-modes.md §6.6).
// Font size is bumped and the workspace background follows the app's
// dark/light theme so the canvas feels native to Ergalics Studio.
// ==========================================================================

export interface KidsTheme {
  name: string;
  fontStyle?: { family?: string; weight?: string; size?: number };
  componentStyles?: Record<string, string | number>;
  startHats?: boolean;
}

export function createKidsTheme(dark: boolean): KidsTheme {
  return {
    name: 'studio-kids',
    startHats: true,
    fontStyle: {
      family: "'PingFang SC', 'Microsoft YaHei', 'Segoe UI', sans-serif",
      weight: '400',
      size: 12,
    },
    componentStyles: dark
      ? {
          workspaceBackgroundColour: '#0d1117',
          toolboxBackgroundColour: '#11151c',
          toolboxForegroundColour: '#e6edf3',
          flyoutBackgroundColour: '#11151c',
          flyoutForegroundColour: '#e6edf3',
          flyoutOpacity: 0.97,
          scrollbarColour: '#30363d',
          scrollbarOpacity: 0.6,
          insertionMarkerColour: '#2dd4bf',
          insertionMarkerOpacity: 0.4,
          cursorColour: '#e6edf3',
          selectedGlowColour: '#2dd4bf',
          selectedGlowOpacity: 0.4,
        }
      : {
          workspaceBackgroundColour: '#f6f8fa',
          toolboxBackgroundColour: '#ffffff',
          toolboxForegroundColour: '#0f172a',
          flyoutBackgroundColour: '#ffffff',
          flyoutForegroundColour: '#0f172a',
          flyoutOpacity: 0.97,
          scrollbarColour: '#cbd5e1',
          scrollbarOpacity: 0.6,
          insertionMarkerColour: '#14b8a6',
          insertionMarkerOpacity: 0.4,
          cursorColour: '#0f172a',
          selectedGlowColour: '#14b8a6',
          selectedGlowOpacity: 0.4,
        },
  };
}
