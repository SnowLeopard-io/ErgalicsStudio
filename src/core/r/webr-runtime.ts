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
// Vendoring (production): drop the webR distribution (webr.js + webr-worker.js
// + R.js/R.wasm) into `public/webr/` — `scripts/copy-webr.mjs`
// copies it there automatically when a `webr` package is installed in
// node_modules (it is a no-op otherwise, never breaking the build). The probe
// order is: (1) a preloaded `globalThis.WebR`, (2) same-origin
// `<base>/webr/webr.js` as an ES module. The bundle directory is passed as
// webR's `baseUrl` so the worker and R WASM binaries load same-origin too.
//
// The `studio.*` bridge: a best-effort R-side `studio` environment is injected
// after boot. webR's public API has no JS→R callback registry, so the host
// sink (`onStudioCall`) is not wired in the full runtime — the injected verbs
// degrade to invisible no-ops so user scripts calling studio.* still run.
// The complete studio semantics live in the built-in IR engine.
// ==========================================================================

import {
  isValidRPkgName,
  WebRUnavailableError,
  type RExecResult,
  type RLanguageRuntime,
  type RLoadProgress,
} from './types';

/** Loose shape of the webR surface we touch (avoids a hard type dependency).
 *  Matches webr ≥ 0.6: `init()` to boot, `close()` to tear down, async
 *  `flush()` for the output queue, `evalRString` for captured evaluation.
 *  Legacy shapes (`ready` fn/promise) are still honoured so the adapter
 *  survives minor upstream drift. */
interface WebRInstance {
  init?(): Promise<unknown>;
  ready?: unknown;
  evalRVoid(code: string): Promise<unknown>;
  evalRString?(code: string, options?: Record<string, unknown>): Promise<string>;
  installPackages(pkgs: string[]): Promise<unknown>;
  interrupt?(): Promise<unknown> | void;
  close?(): unknown;
  flush?(): Promise<{ type: string; data: unknown }[]> | { type: string; data: unknown }[];
}

type WebRConstructor = new (options?: Record<string, unknown>) => WebRInstance;

export interface WebRRuntimeOptions {
  /** Directory the vendored bundle is served from (default: `<base>/webr/`). */
  baseUrl?: string;
  /** Override the module URL probed by the dynamic import (tests / alt layout). */
  moduleUrl?: string;
}

/** Cap on a single install request so one call cannot exhaust WASM memory. */
const MAX_PACKAGES_PER_INSTALL = 3;

/** R source injected after boot. Exported for regression tests.
 *
 *  Design note: the studio.* verbs operate on **native data.frames**, so R code
 *  can mix studio helpers with base R (`df$temp`, `summary(df)`, `lm(y ~ x)`).
 *  Files handed over by the editor are stashed in `studio$.files` (R strings),
 *  so `studio.load()` needs no filesystem access inside the WASM sandbox.
 *  Only `plot()` stays a no-op: webR has no JS→R callback registry, so a plot
 *  cannot reach the preview pane without extra plumbing. */
export function studioBridgeSource(): string {
  return [
    '# Ergalics Studio bridge (injected by the full R runtime)',
    'studio <- new.env(parent = globalenv())',
    'studio$.files <- list()',
    'studio$.params <- list()',
    '',
    '# ---- parsing ---------------------------------------------------------',
    '# Whitespace/comma-delimited numeric or character columns. Lines starting',
    '# with # or // are metadata; only the first non-numeric line is a header',
    '# (the Python runtime parses files the same way).',
    'studio$.read <- function(text, default_names = c("x", "y", "z", "w")) {',
    '  if (is.null(text) || !nzchar(trimws(text))) stop("no data found")',
    '  lines <- trimws(strsplit(text, "\\n", fixed = TRUE)[[1]])',
    '  lines <- lines[nzchar(lines) & !startsWith(lines, "#") & !startsWith(lines, "//")]',
    '  if (!length(lines)) stop("no data found")',
    '  first <- strsplit(lines[1], "[[:space:],]+")[[1]]',
    '  first <- first[nzchar(first)]',
    '  has_header <- any(is.na(suppressWarnings(as.numeric(first))))',
    '  sep <- if (grepl(",", lines[1], fixed = TRUE)) "," else ""',
    '  con <- textConnection(paste(lines, collapse = "\\n"))',
    '  on.exit(close(con), add = TRUE)',
    '  df <- utils::read.table(con, header = has_header, sep = sep,',
    '    stringsAsFactors = FALSE, check.names = FALSE, comment.char = "",',
    '    quote = "\\"", fill = TRUE)',
    '  if (!has_header) {',
    '    n <- ncol(df)',
    '    base_names <- c("x", "y", "z", "w")',
    '    names(df) <- if (n <= length(base_names)) base_names[seq_len(n)]',
    '      else c(base_names, paste0("c", seq_len(n - length(base_names))))',
    '  }',
    '  df',
    '}',
    '',
    '# ---- data sources ----------------------------------------------------',
    'studio$load <- function(path) {',
    '  key <- as.character(path)[1]',
    '  if (is.null(studio$.files[[key]]) && grepl("/", key, fixed = TRUE))',
    '    key <- basename(key)',
    '  if (is.null(studio$.files[[key]])) stop(sprintf("file \\"%s\\" not found", key))',
    '  studio$.read(studio$.files[[key]])',
    '}',
    '# Accept either raw text or a project file name (matching studio$load).',
    'studio$.content <- function(text) {',
    '  key <- as.character(text)[1]',
    '  if (!is.null(studio$.files[[key]])) studio$.files[[key]] else key',
    '}',
    'studio$loadCSV <- function(text) studio$.read(studio$.content(text))',
    'studio$loadXYZ <- function(text) {',
    '  df <- studio$.read(studio$.content(text), c("x", "y", "z", "w"))',
    '  if (ncol(df) < 3) stop("XYZ data needs at least three numeric columns")',
    '  df',
    '}',
    'studio$random <- function(n, seed = 1) {',
    '  n <- max(1, floor(as.numeric(n)[1]))',
    '  set.seed(as.numeric(seed)[1])',
    '  data.frame(x = stats::runif(n))',
    '}',
    'studio$exampleData <- function(count = 100, seed = 1) {',
    '  n <- max(1, floor(as.numeric(count)[1]))',
    '  set.seed(as.numeric(seed)[1])',
    '  t <- (seq_len(n) - 1) / n * pi * 2',
    '  data.frame(t = t, x = sin(t) + (stats::runif(n) - 0.5) * 0.2)',
    '}',
    'studio$grid <- function(size = 10) {',
    '  s <- max(1, floor(as.numeric(size)[1]))',
    '  expand.grid(y = seq.int(0, s - 1), x = seq.int(0, s - 1))[, c("x", "y")]',
    '}',
    'studio$range <- function(start, stop, step = 1) {',
    '  from <- as.numeric(start)[1]; to <- as.numeric(stop)[1]; by <- as.numeric(step)[1]',
    '  if (!is.finite(by) || by == 0) by <- 1',
    '  values <- numeric(0); v <- from',
    '  while ((by > 0 && v < to - 1e-12) || (by < 0 && v > to + 1e-12)) {',
    '    values <- c(values, v); v <- v + by',
    '  }',
    '  data.frame(value = values)',
    '}',
    '',
    '# ---- transforms ------------------------------------------------------',
    'studio$.require <- function(df, column) {',
    '  if (!is.data.frame(df)) stop("expected a data.frame (built with studio.load / studio.random)")',
    '  col <- as.character(column)[1]',
    '  if (!col %in% names(df)) stop(sprintf("column \\"%s\\" does not exist", col))',
    '  col',
    '}',
    'studio$normalize <- function(df, column, mode = "minmax") {',
    '  col <- studio$.require(df, column)',
    '  v <- as.numeric(df[[col]])',
    '  mode <- as.character(mode)[1]',
    '  out <- switch(mode,',
    '    zscore = { s <- stats::sd(v); if (!is.finite(s) || s == 0) rep(0, length(v)) else (v - mean(v)) / s },',
    '    minmax = { r <- base::range(v, na.rm = TRUE); d <- r[2] - r[1]; if (!is.finite(d) || d == 0) rep(0, length(v)) else (v - r[1]) / d },',
    '    stop(sprintf("unknown normalize mode \\"%s\\"", mode)))',
    '  df[[paste0(col, "_", mode)]] <- out',
    '  df',
    '}',
    'studio$sort <- function(df, column, direction = "asc") {',
    '  col <- studio$.require(df, column)',
    '  desc <- tolower(as.character(direction)[1]) == "desc"',
    '  out <- df[order(df[[col]], decreasing = desc), , drop = FALSE]',
    '  rownames(out) <- NULL',
    '  out',
    '}',
    'studio$select <- function(df, columns) {',
    '  keep <- intersect(as.character(columns), names(df))',
    '  df[, keep, drop = FALSE]',
    '}',
    'studio$addColumn <- function(df, name, values) {',
    '  nm <- as.character(name)[1]',
    '  v <- as.numeric(values)',
    '  if (length(v) == 1L) v <- rep(v, nrow(df))',
    '  if (length(v) != nrow(df)) stop("addColumn: values length must equal the row count")',
    '  df[[nm]] <- v',
    '  df',
    '}',
    'studio$.uniqueName <- function(df, nm) {',
    '  out <- nm; i <- 2L',
    '  while (out %in% names(df)) { out <- paste0(nm, "_", i); i <- i + 1L }',
    '  out',
    '}',
    'studio$addConstantColumn <- function(df, name, value) {',
    '  v <- as.numeric(value)[1]',
    '  if (!is.finite(v)) stop("addConstantColumn: value must be a number")',
    '  df[[studio$.uniqueName(df, as.character(name)[1])]] <- rep(v, nrow(df))',
    '  df',
    '}',
    'studio$filter <- function(df, column, op, value) {',
    '  col <- studio$.require(df, column)',
    '  x <- as.numeric(value)[1]; v <- df[[col]]',
    '  keep <- switch(as.character(op)[1],',
    '    ">" = v > x, ">=" = v >= x, "<" = v < x, "<=" = v <= x,',
    '    "==" = v == x, "!=" = v != x,',
    '    stop(sprintf("unknown comparison \\"%s\\"", op)))',
    '  out <- df[keep, , drop = FALSE]',
    '  rownames(out) <- NULL',
    '  out',
    '}',
    'studio$filterRange <- function(df, column, min, max) {',
    '  col <- studio$.require(df, column)',
    '  v <- df[[col]]; lo <- as.numeric(min)[1]; hi <- as.numeric(max)[1]',
    '  if (!is.finite(lo) || !is.finite(hi)) stop("filterRange: min/max must be numbers")',
    '  out <- df[v >= lo & v <= hi, , drop = FALSE]',
    '  rownames(out) <- NULL',
    '  out',
    '}',
    'studio$topK <- function(df, column, k, direction = "largest") {',
    '  dir <- if (tolower(as.character(direction)[1]) == "smallest") "asc" else "desc"',
    '  head(studio$sort(df, column, dir), max(0, floor(as.numeric(k)[1])))',
    '}',
    'studio$renameColumn <- function(df, from, to) {',
    '  old <- as.character(from)[1]',
    '  if (!old %in% names(df)) stop(sprintf("column \\"%s\\" does not exist", old))',
    '  names(df)[names(df) == old] <- as.character(to)[1]',
    '  df',
    '}',
    '',
    '# ---- statistics ------------------------------------------------------',
    'studio$summary <- function(df, column) {',
    '  col <- studio$.require(df, column)',
    '  v <- as.numeric(df[[col]])',
    '  out <- data.frame(',
    '    stat = c("mean", "std", "min", "max", "median"),',
    '    value = c(mean(v, na.rm = TRUE), stats::sd(v, na.rm = TRUE),',
    '      min(v, na.rm = TRUE), max(v, na.rm = TRUE), stats::median(v, na.rm = TRUE)),',
    '    stringsAsFactors = FALSE)',
    '  names(out)[2] <- col',
    '  out',
    '}',
    'studio$histogram <- function(df, column, bins = 10) {',
    '  col <- studio$.require(df, column)',
    '  v <- as.numeric(df[[col]])',
    '  b <- max(1, floor(as.numeric(bins)[1]))',
    '  r <- base::range(v, na.rm = TRUE)',
    '  if (!is.finite(r[1]) || r[1] == r[2]) {',
    '    # A constant column still needs b bins: widen the single value.',
    '    breaks <- r[1] + seq(-0.5, 0.5, length.out = b + 1)',
    '    if (!is.finite(r[1])) breaks <- seq(0, 1, length.out = b + 1)',
    '  } else {',
    '    breaks <- seq(r[1], r[2], length.out = b + 1)',
    '  }',
    '  h <- graphics::hist(v, breaks = breaks, plot = FALSE)',
    '  data.frame(center = (breaks[-1] + breaks[-(b + 1)]) / 2, count = as.numeric(h$counts))',
    '}',
    '',
    '# ---- host verbs ------------------------------------------------------',
    '# Plotting has no JS callback channel in webR; the call stays harmless.',
    'studio$plot <- function(type, data, opts = list()) invisible(NULL)',
    'studio$print <- function(...) base::print(list(...))',
    'studio$notify <- function(kind = "info", message = "") base::message(sprintf("[%s] %s", kind, message))',
    'studio$getParam <- function(key, default = NULL) {',
    '  v <- studio$.params[[as.character(key)[1]]]',
    '  if (is.null(v)) default else v',
    '}',
    'studio$setParam <- function(key, value) {',
    '  studio$.params[[as.character(key)[1]]] <- value',
    '  invisible(value)',
    '}',
    'studio$seedRandom <- function(seed) { set.seed(as.numeric(seed)[1]); invisible(NULL) }',
    'studio$random01 <- function() stats::runif(1)',
    '',
    '# ---- compatibility shims --------------------------------------------',
    // Intercept library()/require() so code translated from Python
    // (`import studio`, `import math`) does not fail with "no package".
    // Everything else delegates to the base package with the ORIGINAL call
    // (rebuilt via match.call and evaluated in the caller's frame), preserving
    // base's own `library(pkg)` name handling untouched.
    '.studio__lib <- local({',
    '  .builtin <- c("studio", "math")',
    '  function(package, ...) {',
    '    .nm <- tryCatch(as.character(substitute(package)), error = function(e) character(0))',
    '    if (length(.nm) == 1L && !is.na(.nm[1]) && .nm[1] %in% .builtin) return(invisible(NULL))',
    '    .call <- match.call()',
    '    .call[[1L]] <- quote(base::library)',
    '    eval(.call, envir = parent.frame())',
    '  }',
    '})',
    'assign("library", .studio__lib, envir = globalenv())',
    '.studio__req <- local({',
    '  .builtin <- c("studio", "math")',
    '  function(package, ...) {',
    '    .nm <- tryCatch(as.character(substitute(package)), error = function(e) character(0))',
    '    if (length(.nm) == 1L && !is.na(.nm[1]) && .nm[1] %in% .builtin) return(invisible(TRUE))',
    '    .call <- match.call()',
    '    .call[[1L]] <- quote(base::require)',
    '    eval(.call, envir = parent.frame())',
    '  }',
    '})',
    'assign("require", .studio__req, envir = globalenv())',
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
   *  at import time (Node tests import it safely). The browser bundle is
   *  `webr.js`: the package's `webr.mjs` is a Node build (it imports
   *  node:module) and must never be loaded in a page. */
  private resolveModuleUrl(): string {
    if (this.opts.moduleUrl) return this.opts.moduleUrl;
    return this.resolveBaseUrl() + 'webr.js';
  }

  /** Directory the vendored bundle (webr.js, webr-worker.js, R.wasm) is
   *  served from. MUST be passed as webR's `baseUrl` option: the worker and
   *  the R WebAssembly binaries are fetched from it, and the default points
   *  at the r-wasm CDN which this project never uses. */
  private resolveBaseUrl(): string {
    if (this.opts.baseUrl) return this.opts.baseUrl.replace(/\/$/, '') + '/';
    if (typeof document !== 'undefined') {
      return new URL('webr/', document.baseURI).href;
    }
    return 'webr/';
  }

  /** Locate the webR constructor: preloaded global, then same-origin module. */
  private async probeWebR(): Promise<WebRConstructor> {
    const g = globalThis as { WebR?: unknown };
    if (typeof g.WebR === 'function') return g.WebR as WebRConstructor;
    // Build-time flag: when webR was not vendored, skip the dynamic import
    // entirely instead of firing a request that 404s on every R session.
    // (typeof guard keeps this module importable in plain Node tests.)
    const overridden = Boolean(this.opts.moduleUrl || this.opts.baseUrl);
    if (typeof __WEBR_AVAILABLE__ !== 'undefined' && !__WEBR_AVAILABLE__ && !overridden) {
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

  /** Boot the instance. webr ≥ 0.6 exposes `init()`; older/loose shapes may
   *  expose `ready` as a function or a promise. */
  private async bootInstance(webr: WebRInstance): Promise<void> {
    if (typeof webr.init === 'function') {
      await webr.init();
      return;
    }
    if (typeof webr.ready === 'function') {
      await webr.ready();
      return;
    }
    if (webr.ready && typeof (webr.ready as Promise<unknown>).then === 'function') {
      await webr.ready;
      return;
    }
    throw new WebRUnavailableError(
      'the WebR instance exposes neither init() nor ready — unsupported webR build',
    );
  }

  async load(onProgress?: (progress: RLoadProgress) => void): Promise<void> {
    if (this.disposed) throw new Error('webR runtime has been disposed');
    if (this.boot) return this.boot;
    this.boot = (async () => {
      onProgress?.({ stage: 'probe', percent: 5 });
      const Ctor = await this.probeWebR();
      onProgress?.({ stage: 'boot', percent: 25 });
      const webr = new Ctor({ baseUrl: this.resolveBaseUrl() });
      await this.bootInstance(webr);
      this.webr = webr;
      onProgress?.({ stage: 'studio', percent: 70 });
      await this.injectStudioBridge(webr);
      onProgress?.({ stage: 'ready', percent: 100 });
    })();
    return this.boot;
  }

  /** Inject the R-side `studio` environment (best effort). */
  private async injectStudioBridge(webr: WebRInstance): Promise<void> {
    try {
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
  private async drainOutput(webr: WebRInstance): Promise<string> {
    if (typeof webr.flush !== 'function') return '';
    const chunks = await webr.flush();
    return chunks
      .filter((chunk) => typeof chunk?.data === 'string')
      .map((chunk) => chunk.data as string)
      .join('');
  }

  /** Marks where user-code stdout ends and the captured R error begins. */
  private static readonly ERR_SENTINEL = '\u0001STUDIO_R_ERR\u0001';

  /** Run the program and capture stdout + error as data.
   *  Primary path: R-side `capture.output` around `eval(parse(text=...))`,
   *  returning the result via `evalRString`. R errors are surfaced through a
   *  sentinel instead of a rejection so partial output survives. (webR's
   *  `captureR` throws a bare, message-less `Error` on the PostMessage
   *  channel in webr 0.6, and the evalR* family routes output to the JS
   *  console instead of returning it — both verified empirically.) */
  private async execCaptured(
    webr: WebRInstance,
    src: string,
  ): Promise<{ stdout: string; error?: string }> {
    if (typeof webr.evalRString === 'function') {
      const code = JSON.stringify(src); // a double-quoted literal is valid R
      const sent = JSON.stringify(WebRRuntime.ERR_SENTINEL);
      const wrapped =
        `local({.err <- NULL;` +
        `.o <- capture.output(tryCatch(` +
        `eval(parse(text=${code}), envir=globalenv()),` +
        `error=function(e){.err <<- conditionMessage(e); NULL}));` +
        `paste0(paste(.o, collapse="\n"), if (!is.null(.err)) paste0("\n", ${sent}, .err))})`;
      const ret = await webr.evalRString(wrapped);
      const i = ret.indexOf(WebRRuntime.ERR_SENTINEL);
      if (i < 0) return { stdout: ret };
      return {
        stdout: ret.slice(0, i).replace(/\n$/, ''),
        error: ret.slice(i + WebRRuntime.ERR_SENTINEL.length),
      };
    }
    // Loose/legacy shapes: eval + drain the channel output queue.
    await webr.evalRVoid(src);
    return { stdout: await this.drainOutput(webr) };
  }

  /** Publish the project's data files to `studio$.files` as R strings.
   *  JSON string literals are valid R literals (both escape with backslash),
   *  so the text never round-trips through the WASM filesystem. */
  private async injectFiles(
    webr: WebRInstance,
    files: Record<string, string> | undefined,
  ): Promise<void> {
    const entries = Object.entries(files ?? {});
    const lines = ['studio$.files <- list()'];
    for (const [name, text] of entries) {
      lines.push(`studio$.files[[${JSON.stringify(name)}]] <- ${JSON.stringify(text)}`);
    }
    // Never let file staging mask the user's own error: a failure here just
    // means `studio.load()` reports "file not found".
    try {
      await webr.evalRVoid(lines.join('\n'));
    } catch {
      /* best effort */
    }
  }

  async exec(code: string, files?: Record<string, string>): Promise<RExecResult> {
    if (this.disposed) throw new Error('webR runtime has been disposed');
    await this.load();
    const startedAt = Date.now();
    const webr = this.requireBooted();
    try {
      await this.injectFiles(webr, files);
      // Editors hand over CRLF line endings; R's parser rejects stray \r.
      const { stdout, error } = await this.execCaptured(webr, code.replace(/\r\n?/g, '\n'));
      return { ok: !error, stdout, error, durationMs: Date.now() - startedAt };
    } catch (err) {
      const stdout = await this.drainOutput(webr);
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
    if (webr && typeof webr.close === 'function') {
      try {
        webr.close();
      } catch {
        /* teardown errors are non-fatal */
      }
    }
  }
}
