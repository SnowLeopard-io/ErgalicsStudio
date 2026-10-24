// App store tests — banners, notifications, perf warnings (spec §7.3)
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useAppStore } from '@/stores/appStore';

describe('appStore', () => {
  beforeEach(() => {
    useAppStore.setState({
      banners: [],
      notifications: [],
      perf: {
        fps: 0,
        frameMs: 0,
        gpuMs: 0,
        memoryMb: 0,
        dataScale: 0,
        jsHeapMb: 0,
        deviceMemoryMb: 0,
        totalFrames: 0,
        avgFps: 0,
        maxFrameMs: 0,
        uptimeSec: 0,
        warnings: { fps: false, memory: false, compute: false },
      },
    });
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('setError strips the plugin: prefix and records the plugin id', () => {
    useAppStore.getState().setError('plugin:com.example.demo');
    const banner = useAppStore.getState().banners[0];
    expect(banner).toMatchObject({ kind: 'error', messageKey: 'error.plugin_crash' });
    expect(banner?.pluginId).toBe('com.example.demo');
  });

  it('setError keeps unprefixed ids as-is', () => {
    useAppStore.getState().setError('com.example.demo');
    expect(useAppStore.getState().banners[0]?.pluginId).toBe('com.example.demo');
  });

  it('addBanner deduplicates identical message keys', () => {
    useAppStore.getState().addBanner('warning', 'error.webgpu_unavailable');
    useAppStore.getState().addBanner('warning', 'error.webgpu_unavailable');
    expect(useAppStore.getState().banners).toHaveLength(1);
  });

  it('notify auto-dismisses after 4s', () => {
    useAppStore.getState().notify('success', 'hello');
    expect(useAppStore.getState().notifications).toHaveLength(1);
    vi.advanceTimersByTime(4001);
    expect(useAppStore.getState().notifications).toHaveLength(0);
  });

  it('warns on low fps and high gpu ms', () => {
    useAppStore.getState().setFps(20, 40);
    expect(useAppStore.getState().perf.warnings.fps).toBe(true);
    useAppStore.getState().setGpuMs(120);
    expect(useAppStore.getState().perf.warnings.compute).toBe(true);
  });

  it('warns when memory exceeds the 80% budget', () => {
    useAppStore.getState().setMemoryMb(0.8 * 512 + 1);
    expect(useAppStore.getState().perf.warnings.memory).toBe(true);
    useAppStore.getState().setMemoryMb(100);
    expect(useAppStore.getState().perf.warnings.memory).toBe(false);
  });

  it('tracks status', () => {
    useAppStore.getState().setStatus('computing');
    expect(useAppStore.getState().status).toBe('computing');
  });

  it('stores cumulative perf totals', () => {
    useAppStore.getState().setPerfTotals({ totalFrames: 1200, avgFps: 59, maxFrameMs: 22.5, uptimeSec: 20 });
    const p = useAppStore.getState().perf;
    expect(p.totalFrames).toBe(1200);
    expect(p.avgFps).toBe(59);
    expect(p.maxFrameMs).toBe(22.5);
    expect(p.uptimeSec).toBe(20);
  });

  it('stores heap + device memory readings', () => {
    useAppStore.getState().setPerfMemory(320, 8192);
    const p = useAppStore.getState().perf;
    expect(p.jsHeapMb).toBe(320);
    expect(p.deviceMemoryMb).toBe(8192);
  });
});
