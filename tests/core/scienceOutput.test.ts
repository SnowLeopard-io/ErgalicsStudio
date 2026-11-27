// The strip subscribes with useSyncExternalStore: getSnapshot must be stable
// between publishes, otherwise React re-renders forever. This pins the bus
// contract that keeps a plugin switch from flashing a stale metric set.
import { describe, expect, it, vi } from 'vitest';
import {
  clearScienceOutputs,
  getScienceOutputs,
  setScienceOutputs,
  subscribeScienceOutputs,
} from '@ergalics/plugin-sdk/bridges';

describe('science output bus', () => {
  it('returns an identity-stable snapshot until a real publish or clear', () => {
    const id = 'test.science-output-stable';
    clearScienceOutputs(id);
    const initial = getScienceOutputs();
    expect(getScienceOutputs()).toBe(initial);

    const listener = vi.fn();
    const unsubscribe = subscribeScienceOutputs(listener);
    const metrics = [{ key: 'r2', label: 'R²', value: '0.9000' }];

    setScienceOutputs(id, metrics);
    const published = getScienceOutputs();
    expect(published).not.toBe(initial);
    expect(published[id]?.metrics).toEqual(metrics);
    expect(listener).toHaveBeenCalledWith(published);
    expect(getScienceOutputs()).toBe(published);

    // Identical re-publish is a no-op: no new snapshot, no extra subscriber call.
    setScienceOutputs(id, [{ key: 'r2', label: 'R²', value: '0.9000' }]);
    expect(getScienceOutputs()).toBe(published);
    expect(listener).toHaveBeenCalledTimes(1);

    clearScienceOutputs(id);
    expect(getScienceOutputs()[id]).toBeUndefined();
    unsubscribe();
  });
});
