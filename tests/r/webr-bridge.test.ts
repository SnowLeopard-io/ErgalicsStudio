// R bridge (studioBridgeSource) regression tests — we lock the *source* the
// adapter injects into the webR session. Real R (WASM) is not available under
// Node, so these guard the injected contract textually against regressions
// that would make translated R code fail at boot (e.g. "no such package 'studio'").
import { describe, it, expect } from 'vitest';
import { studioBridgeSource } from '@/core/r/webr-runtime';

const src = studioBridgeSource();

describe('R bridge source (FR-04)', () => {
  it('boots a studio environment with a data-table model', () => {
    expect(src).toContain('studio <- new.env(parent = emptyenv())');
    expect(src).toContain('studio$table <- function(cols)');
    expect(src).toContain('column_names = function() names(cols)');
  });

  it('provides the numeric verbs used by the built-in examples', () => {
    expect(src).toContain('studio$random <- function(n, seed = 1)');
    expect(src).toContain('studio$addColumn <- function(df, name, values)');
    expect(src).toContain('studio$print <- function(...) base::print(list(...))');
    // The table models columns as list(name, values) so `df$columns[[1]][[2]]`
    // (R codegen for `df.columns[0][1]`) selects the values of column 0.
    expect(src).toContain('list(.n, cols[[.n]])');
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