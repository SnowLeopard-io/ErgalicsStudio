import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Android packaging for the plain Web renderer.
 *
 * The app deliberately does NOT expose the Electron `window.ergalicsDesktop`
 * bridge here: on mobile it runs the web edition, using Pyodide/WASM in the
 * WebView and browser storage for projects. That keeps one renderer source of
 * truth; the native layer only supplies a WebView host and file-export glue.
 */
const config: CapacitorConfig = {
  appId: 'io.snowleopard.ergalics.mobile',
  appName: 'Ergalics Studio',
  // Staged by scripts/android-build.mjs from the repository-wide dist/.
  webDir: 'app-dist',
  android: {
    // No mixed content: the renderer is bundled into the APK and loaded from
    // the local Capacitor scheme. Anything remote must be explicitly allowed.
    allowMixedContent: false,
    captureLogs: false,
    initialFocus: true,
  },
};

export default config;
