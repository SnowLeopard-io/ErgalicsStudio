// FR-04 — built-in IR runtime contract tests.
import { describe, it, expect, vi } from 'vitest';
import { BuiltinIRRuntime } from '@/core/r/builtin-ir-runtime';
import { createStudioApi, type StudioApiHost } from '@/editor/runtime/studio-api';
import { isDataTable } from '@/types/datatable';
import type { RLoadProgress } from '@/core/r/types';

function makeStudioApi(): StudioApiHost {
  return {
    loadText: vi.fn(async () => 'x,y\n1,2\n3,4'),
    renderView: vi.fn(async () => undefined),
    notify: vi.fn(),
    print: vi.fn(),
  };
}

function makeRuntime(): BuiltinIRRuntime {
  return new BuiltinIRRuntime({ getStudioApi: () => createStudioApi(makeStudioApi()) });
}

describe('BuiltinIRRuntime (FR-04 contract)', () => {
  it('reports the builtin engine and is not a full runtime', () => {
    const rt = makeRuntime();
    expect(rt.engine).toBe('builtin-ir');
    expect(rt.isFullRuntime).toBe(false);
  });

  it('load() resolves immediately and emits progress to 100%', async () => {
    const rt = makeRuntime();
    const events: RLoadProgress[] = [];
    await rt.load((p) => events.push(p));
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events[events.length - 1]!.percent).toBe(100);
    expect(events[events.length - 1]!.stage).toBe('ready');
  });

  it('exec runs a studio DSL program and returns variables', async () => {
    const rt = makeRuntime();
    await rt.load();
    const result = await rt.exec('df <- studio.random(5)');
    expect(result.ok).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.variables).toBeDefined();
    const df = result.variables!['df'];
    expect(df && isDataTable(df)).toBe(true);
  });

  it('exec result carries a non-negative durationMs', async () => {
    const rt = makeRuntime();
    const result = await rt.exec('a <- 1');
    expect(result.ok).toBe(true);
    expect(typeof result.durationMs).toBe('number');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('exec counts statements degraded to RawCode', async () => {
    const rt = makeRuntime();
    // R formula syntax (`~`) is outside the IR subset → preserved as RawCode.
    // (The native pipe `|>` IS parseable now, so it no longer degrades.)
    const result = await rt.exec('df <- studio.random(5)\nmodel <- y ~ x');
    expect(result.ok).toBe(true);
    expect(result.skippedCount).toBeGreaterThanOrEqual(1);
  });

  it('exec reports a clean error result (no throw) for undefined variables', async () => {
    const rt = makeRuntime();
    const result = await rt.exec('y <- totally_undefined_var');
    expect(result.ok).toBe(false);
    expect(typeof result.error).toBe('string');
    expect(result.error).toContain('totally_undefined_var');
  });

  it('install() rejects — the builtin engine has no package manager', async () => {
    const rt = makeRuntime();
    await expect(rt.install('ggplot2')).rejects.toThrow(/built-in IR/);
  });

  it('interrupt() resolves without error (IR runs are synchronous)', async () => {
    const rt = makeRuntime();
    await expect(rt.interrupt()).resolves.toBeUndefined();
  });

  it('exec throws after dispose', async () => {
    const rt = makeRuntime();
    await rt.dispose();
    await expect(rt.exec('a <- 1')).rejects.toThrow(/disposed/);
  });

  it('exec handles a multi-statement pipeline (random → normalize)', async () => {
    const rt = makeRuntime();
    const result = await rt.exec(
      'df <- studio.random(6)\nn <- studio.normalize(df, "x", "minmax")',
    );
    expect(result.ok).toBe(true);
    const n = result.variables!['n'];
    expect(n && isDataTable(n)).toBe(true);
  });
});
