// ==========================================================================
// Ergalics Studio — webR adapter for code-mode R (FR-04 full runtime)
//
// Talks to the real R interpreter compiled to WASM (webR). webR is NOT an npm
// dependency: the project forbids new deps and runtime CDN access, so the
// bundle must be vendored same-origin. This adapter therefore PROBES for webR
// at load time and throws a recognisable `WebRUnavailableError` when it is
// absent, which the runtime factory turns into a clean fallback to the
// built-in IR engine.
//
// Vendoring (production): drop the webR distribution (webr.mjs + webr-worker.js
// + webr-shims + the R base WASM) into `public/webr/` — `scripts/copy-webr.mjs`
// copies it there automatically when a `webr` package is installed in
// node_modules (it is a no-op otherwise, never breaking the build). The probe
// order is: (1) a preloaded `globalThis.WebR`, (2) same-origin
// `<base>/webr/webr.mjs` as an ES module.
//
// The `studio.*` bridge: a best-effort R-side `studio` environment is injected
// after boot. Where webR's JS interop (`globalthis`) is available, the verbs
// route back to the host through the `onStudioCall` callback (project data
// semantics shared with Python / blocks); otherwise they fall back to plain R
// base functions so user scripts still run.
// ==========================================================================

import {
  isValidRPkgName,
  WebRUnavailableError,
  type RExecResult,
  type RLanguageRuntime,
  type RLoadProgress,
} from './types';

/** Loose shape of the webR surface we touch (avoids a hard type dependency). */
interface WebRInstance {
  ready: Promise<unknown>;
  evalRVoid(code: string): Promise<unknown>;
  installPackages(pkgs: string[]): Promise<unknown>;
  interrupt?(): Promise<unknown> | void;
  destroy?(): Promise<unknown> | void;
  flush?(): { type: string; data: string }[];
  globalThis?: {
    set(name: string, value: unknown): Promise<unknown>;
    unset(name: string): Promise<unknown>;
  };
}

type WebRConstructor = new (options?: Record<string, unknown>) => WebRInstance;

export interface WebRRuntimeOptions {
  /** Directory the vendored bundle is served from (default: `<base>/webr/`). */
  baseUrl?: string;
  /** Host-side `studio.*` sink for the injected R bridge (best-effort). */
  onStudioCall?: (method: string, argsJson: string) => void;
  /** Override the module URL probed by the dynamic import (tests / alt layout). */
  moduleUrl?: string;
}

/** Cap on a single install request so one call cannot exhaust WASM memory. */
const MAX_PACKAGES_PER_INSTALL = 3;

/** R source defining the `studio` environment inside the webR session. */
function studioBridgeSource(): string {
  return [
    '# Ergalics Studio bridge (injected by the full R runtime, best effort)',
    'studio <- new.env(parent = emptyenv())',
    'studio$print <- function(...) base::print(list(...))',
    'studio$notify <- function(kind = "info", message = "") base::message(sprintf("[%s] %s", kind, message))',
    'if (requireNamespace("globalthis", quietly = TRUE)) {',
    '  .studio_host <- function(method, args_json) {',
    '    globalthis::js$__studio_call(method, args_json)',
    '    invisible(NULL)',
    '  }',
    '  for (.verb in c("load","loadCSV","loadXYZ","random","exampleData","grid","range",',
    '    "normalize","sort","select","addColumn","addConstantColumn","filter","filterRange",',
    '    "topK","renameColumn","summary","histogram","plot","getParam","setParam")) {',
    '    local({',
    '      .m <- .verb',
    '      assign(.m, function(...) .studio_host(.m, jsonlite::toJSON(list(...), auto_unbox = TRUE)),',
    '             envir = studio)',
    '    })',
    '  }',
    '}',
  ].join('\n');
}

export class WebRRuntime implements RLanguageRuntime {
  readonly isFullRuntime = true;
  readonly engine = 'webr' as const;

  private readonly opts: WebRRuntimeOptions;
  private webr: WebRInstance | null = null;
  private boot: Promise<void> | null = null;
  private disposed = false;

  constructor(opts: WebRRuntimeOptions = {}) {
    this.opts = opts;
  }

  /** Same-origin default — resolved lazily so this module never touches DOM
   *  at import time (Node tests import it safely). */
  private resolveModuleUrl(): string {
    if (this.opts.moduleUrl) return this.opts.moduleUrl;
    if (this.opts.baseUrl) return `${this.opts.baseUrl.replace(/\/$/, '')}/webr.mjs`;
    if (typeof document !== 'undefined') {
      return new URL('webr/webr.mjs', document.baseURI).href;
    }
    return 'webr/webr.mjs';
  }

  /** Locate the webR constructor: preloaded global, then same-origin module. */
  private async probeWebR(): Promise<WebRConstructor> {
    const g = globalThis as { WebR?: unknown };
    if (typeof g.WebR === 'function') return g.WebR as WebRConstructor;
    // Build-time flag: when webR was not vendored, skip the dynamic import
    // entirely instead of firing a request that 404s on every R session.
    // (typeof guard keeps this module importable in plain Node tests.)
    if (typeof __WEBR_AVAILABLE__ !== 'undefined' && !__WEBR_AVAILABLE__ && !this.opts.moduleUrl) {
      throw new WebRUnavailableError(
        'webR bundle is not vendored — install `webr` or drop the distribution into public/webr/ to enable the full R runtime',
      );
    }
    const url = this.resolveModuleUrl();
    let mod: unknown;
    try {
      // Variable specifier + @vite-ignore: the bundler must NOT try to resolve
      // 'webr' at build time (it is not in package.json); this stays a pure
      // runtime import that fails cleanly when nothing is vendored.
      mod = await import(/* @vite-ignore */ url);
    } catch (err) {
      throw new WebRUnavailableError(
        `webR bundle not found at "${url}" — vendor it into public/webr/ to enable the full R runtime`,
        { cause: err },
      );
    }
    const ctor = (mod as { WebR?: unknown }).WebR;
    if (typeof ctor !== 'function') {
      throw new WebRUnavailableError(`module "${url}" does not export a WebR constructor`);
    }
    return ctor as WebRConstructor;
  }

  async load(onProgress?: (progress: RLoadProgress) => void): Promise<void> {
    if (this.disposed) throw new Error('webR runtime has been disposed');
    if (this.boot) return this.boot;
    this.boot = (async () => {
      onProgress?.({ stage: 'probe', percent: 5 });
      const Ctor = await this.probeWebR();
      onProgress?.({ stage: 'boot', percent: 25 });
      const webr = new Ctor(
        this.opts.baseUrl ? { baseUrl: this.opts.baseUrl } : {},
      );
      await webr.ready;
      this.webr = webr;
      onProgress?.({ stage: 'studio', percent: 70 });
      await this.injectStudioBridge(webr);
      onProgress?.({ stage: 'ready', percent: 100 });
    })();
    return this.boot;
  }

  /** Register the JS callback and eval the R-side `studio` environment. */
  private async injectStudioBridge(webr: WebRInstance): Promise<void> {
    try {
      if (webr.globalThis && this.opts.onStudioCall) {
        await webr.globalThis.set('__studio_call', (method: string, argsJson: string) => {
          try {
            this.opts.onStudioCall?.(String(method), String(argsJson));
          } catch {
            /* host sink failures must never kill the R session */
          }
        });
      }
      await webr.evalRVoid(studioBridgeSource());
    } catch (err) {
      // The bridge is best-effort: without it user R code still runs, so do
      // not fail the boot — but surface why via the console callback below.
      throw new WebRUnavailableError(
        `webR booted but the studio bridge failed: ${err instanceof Error ? err.message : String(err)}`,
        { cause: err },
      );
    }
  }

  private requireBooted(): WebRInstance {
    if (!this.webr) throw new Error('webR runtime is not loaded — call load() first');
    return this.webr;
  }

  /** Collect any queued console output webR emitted during a call. */
  private drainOutput(webr: WebRInstance): string {
    if (typeof webr.flush !== 'function') return '';
    return webr
      .flush()
      .filter((chunk) => typeof chunk?.data === 'string')
      .map((chunk) => chunk.data)
      .join('');
  }

  async exec(code: string): Promise<RExecResult> {
    if (this.disposed) throw new Error('webR runtime has been disposed');
    await this.load();
    const startedAt = Date.now();
    const webr = this.requireBooted();
    try {
      await webr.evalRVoid(code);
      const stdout = this.drainOutput(webr);
      return { ok: true, stdout, durationMs: Date.now() - startedAt };
    } catch (err) {
      const stdout = this.drainOutput(webr);
      return {
        ok: false,
        stdout,
        error: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - startedAt,
      };
    }
  }

  async install(pkg: string): Promise<void> {
    if (!isValidRPkgName(pkg)) {
      throw new Error(`invalid R package name: "${pkg}"`);
    }
    await this.load();
    const webr = this.requireBooted();
    // WASM memory is finite: keep installs small and tell the user to expect
    // a pause (the UI surfaces `r.install.hint` around this call).
    if (/[,\s]/.test(pkg) || pkg.split(/[, ]+/).filter(Boolean).length > MAX_PACKAGES_PER_INSTALL) {
      throw new Error(
        `install one package at a time (max ${MAX_PACKAGES_PER_INSTALL}) to stay within the runtime's memory and time budget`,
      );
    }
    await webr.installPackages([pkg]);
  }

  async interrupt(): Promise<void> {
    // webR supports a cooperative interrupt; the caller restarts the runtime
    // afterwards so a wedged session can never freeze the page.
    const webr = this.webr;
    if (webr && typeof webr.interrupt === 'function') {
      try {
        await webr.interrupt();
      } catch {
        /* an interrupt racing with completion is fine */
      }
    }
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    const webr = this.webr;
    this.webr = null;
    this.boot = null;
    if (webr && typeof webr.destroy === 'function') {
      try {
        await webr.destroy();
      } catch {
        /* teardown errors are non-fatal */
      }
    }
  }
}
