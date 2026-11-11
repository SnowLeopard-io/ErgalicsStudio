// R bridge (studioBridgeSource) regression tests — we lock the *source* the
// adapter injects into the webR session. Real R (WASM) is not available under
// Node, so these guard the injected contract textually against regressions
// that would make translated R code fail at boot (e.g. "no such package 'studio'").
import { describe, it, expect } from 'vitest';
import { studioBridgeSource } from '@/core/r/webr-runtime';

const src = studioBridgeSource();

describe('R bridge source (FR-04)', () => {
  it('boots a studio environment with a data.frame model', () => {
    // The bridge operates on native data.frames so R code can mix studio
    // helpers with base R (df$temp, summary(df), lm(y ~ x)).
    expect(src).toContain('studio <- new.env(parent = globalenv())');
    expect(src).toContain('studio$.files <- list()');
    expect(src).toContain('studio$.read <- function(text');
    expect(src).toContain('utils::read.table(con, header = has_header');
  });

  it('provides the numeric verbs used by the built-in examples', () => {
    expect(src).toContain('studio$random <- function(n, seed = 1)');
    expect(src).toContain('studio$addColumn <- function(df, name, values)');
    expect(src).toContain('studio$print <- function(...) base::print(list(...))');
    // Columns live natively on the data.frame, so the verb contract requires
    // one (studio$addColumn appends via df[[nm]]).
    expect(src).toContain('studio$.require <- function(df, column)');
    expect(src).toContain('if (!is.data.frame(df)) stop("expected a data.frame');
  });

  it('intercepts library()/require() for studio and math instead of failing', () => {
    expect(src).toContain('assign("library", .studio__lib, envir = globalenv())');
    expect(src).toContain('assign("require", .studio__req, envir = globalenv())');
    expect(src).toContain('.builtin <- c("studio", "math")');
    // Non-builtin loads must delegate to the real base library, not be silenced.
    expect(src).toContain('quote(base::library)');
    expect(src).toContain('eval(.call, envir = parent.frame())');
  });

  it('does not reach for the muffleError restart (removed fix for boot errors)', () => {
    expect(src).not.toContain('invokeRestart');
  });
});