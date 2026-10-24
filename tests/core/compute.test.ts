// GPU-activity subscription tests — the host indicator that lights up the
// status bar on real device dispatches.
import { describe, it, expect, vi } from 'vitest';
import { subscribeGpuActivity, notifyGpuDispatch } from '@/core/compute';

describe('gpu activity subscription', () => {
  it('notifies subscribers once per dispatch', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeGpuActivity(listener);
    notifyGpuDispatch();
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    notifyGpuDispatch();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('does not notify after every subscriber unsubscribes', () => {
    const a = vi.fn();
    const b = vi.fn();
    const unsubA = subscribeGpuActivity(a);
    const unsubB = subscribeGpuActivity(b);
    notifyGpuDispatch();
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    unsubA();
    unsubB();
    notifyGpuDispatch();
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });
});