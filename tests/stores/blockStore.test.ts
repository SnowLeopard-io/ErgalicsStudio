import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useBlockStore, FLOW_RUN_FINISHED } from '@/stores/blockStore';
import { blockRegistry } from '@/blocks/registry';
import { block } from '../blocks/fixtures';
import { on } from '@/core/events';
import type { DataValue } from '@/types/datatable';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const empty = { instances: [], connections: [], viewport: { x: 0, y: 0, zoom: 1 } };
const meta = block({
  id: 'test.lifecycle.slow', category: 'data_source', inputs: [],
  outputs: [{ id: 'out', label: 'out', type: 'data', dataType: 'Scalar', required: false }],
});
beforeEach(() => {
  vi.useFakeTimers();
  useBlockStore.getState().fromJSON(empty);
});
afterEach(() => {
  useBlockStore.getState().stop();
  blockRegistry.blocks.delete(meta.id);
  blockRegistry.executors.delete(meta.id);
  const bucket = blockRegistry.categories[meta.category];
  const index = bucket.indexOf(meta);
  if (index >= 0) bucket.splice(index, 1);
  vi.clearAllTimers();
  vi.useRealTimers();
});

it.each(['clear', 'fromJSON'] as const)('prevents late output/status/events after %s', async (action) => {
  const result = deferred<DataValue>();
  const started = deferred<void>();
  blockRegistry.register(meta, () => { started.resolve(); return result.promise; });
  useBlockStore.getState().addInstance(meta.id, { x: 0, y: 0 });
  const event = vi.fn();
  const sub = on(FLOW_RUN_FINISHED, event);
  try {
    const running = useBlockStore.getState().run();
    await started.promise;
    if (action === 'clear') useBlockStore.getState().clear();
    else useBlockStore.getState().fromJSON(empty);
    expect(useBlockStore.getState().isRunning).toBe(false);
    result.resolve({ kind: 'scalar', value: 42 });
    await running;
    expect(useBlockStore.getState().nodeOutputs).toEqual({});
    expect(useBlockStore.getState().nodeStatus).toEqual({});
    expect(event).not.toHaveBeenCalled();
  } finally { sub.unsubscribe(); }
});

it('does not let a stale failure erase results from a new graph run', async () => {
  const result = deferred<DataValue>();
  const started = deferred<void>();
  let first = true;
  blockRegistry.register(meta, async (): Promise<DataValue> => {
    if (first) { first = false; started.resolve(); return result.promise; }
    return { kind: 'scalar', value: 7 };
  });
  useBlockStore.getState().addInstance(meta.id, { x: 0, y: 0 });
  const graph = useBlockStore.getState().toJSON();
  const old = useBlockStore.getState().run();
  await started.promise;
  useBlockStore.getState().fromJSON(graph);
  await useBlockStore.getState().run();
  result.reject(new Error('old run failed'));
  await old;
  expect(Object.values(useBlockStore.getState().nodeOutputs)).toEqual([{ kind: 'scalar', value: 7 }]);
  expect(useBlockStore.getState().executionErrors).toEqual({});
  expect(useBlockStore.getState().isRunning).toBe(false);
});
