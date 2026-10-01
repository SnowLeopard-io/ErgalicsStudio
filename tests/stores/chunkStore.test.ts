import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useChunkStore } from '@/stores/chunkStore';
import { previewSample } from '@/core/chunked/reader';
import { DATA_INGESTED, on } from '@/core/events';
import type { FileEntry } from '@/types/project';
import type { ParseResult } from '@/core/parse-tasks';

const pool = vi.hoisted(() => ({ exec: vi.fn() }));
vi.mock('@/core/worker-pool', () => ({ getSharedPool: () => pool }));
vi.mock('@/core/chunked/reader', async (original) => {
  const actual = await original<typeof import('@/core/chunked/reader')>();
  return { ...actual, previewSample: vi.fn(actual.previewSample) };
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
function file(content: string): FileEntry {
  return { id: 'test.file', name: 'data.csv', content, size: content.length, mimeType: 'text/csv', format: 'csv' };
}
const result: ParseResult = { columnNames: ['x'], columnData: [[1]], rows: 1, totalRows: 1, chunks: 1 };
beforeEach(() => {
  vi.useFakeTimers();
  pool.exec.mockReset();
  useChunkStore.getState().reset();
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

it('leaves cancelled ingestion stopped when the main-thread iterator exits early', async () => {
  const event = vi.fn();
  const sub = on(DATA_INGESTED, event);
  const unsubscribe = useChunkStore.subscribe((store) => {
    if (store.state?.totalRows === 1 && !store.state.cancelled) store.cancel();
  });
  try {
    const running = useChunkStore.getState().startIngest(file('x\n1\n2\n3'), 1);
    await vi.runAllTimersAsync();
    await running;
    expect(useChunkStore.getState().state).toMatchObject({ running: false, cancelled: true, done: false, totalRows: 1 });
    expect(event).not.toHaveBeenCalled();
  } finally { sub.unsubscribe(); unsubscribe(); }
});

it('finishes a normal main-thread ingestion', async () => {
  const running = useChunkStore.getState().startIngest(file('x\n1\n2'), 1);
  await vi.runAllTimersAsync();
  await running;
  expect(useChunkStore.getState().state).toMatchObject({ running: false, cancelled: false, done: true, totalRows: 2 });
});

it('stops the UI immediately while a cancelled worker task is still pending', async () => {
  const task = deferred<ParseResult>();
  pool.exec.mockReturnValueOnce(task.promise);
  const event = vi.fn();
  const sub = on(DATA_INGESTED, event);
  try {
    const running = useChunkStore.getState().startIngest(file('x'.repeat(8_000_001)));
    useChunkStore.getState().cancel();
    expect(useChunkStore.getState().state?.running).toBe(false);
    task.resolve(result);
    await running;
    expect(useChunkStore.getState().state).toMatchObject({ running: false, cancelled: true, done: false });
    expect(event).not.toHaveBeenCalled();
  } finally { sub.unsubscribe(); }
});

it.each(['cancel', 'reset', 'replace'] as const)('does not publish a worker result after %s during preview generation', async (action) => {
  const preview = deferred<Awaited<ReturnType<typeof previewSample>>>();
  const previewStarted = deferred<void>();
  pool.exec.mockResolvedValueOnce(result);
  vi.mocked(previewSample).mockImplementationOnce(() => { previewStarted.resolve(); return preview.promise; });
  const event = vi.fn();
  const sub = on(DATA_INGESTED, event);
  try {
    const running = useChunkStore.getState().startIngest(file('x'.repeat(8_000_001)));
    await previewStarted.promise;
    if (action === 'cancel') useChunkStore.getState().cancel();
    else if (action === 'reset') useChunkStore.getState().reset();
    else {
      const newer = useChunkStore.getState().startIngest(file('x\n7'), 1);
      await vi.runAllTimersAsync();
      await newer;
    }
    const before = useChunkStore.getState().state;
    event.mockClear();
    preview.resolve(null);
    await running;
    expect(useChunkStore.getState().state).toBe(before);
    expect(event).not.toHaveBeenCalled();
  } finally { sub.unsubscribe(); }
});
