// ==========================================================================
// Performance monitor (spec §7): FPS / frame time via rAF sampling,
// plus GPU memory estimate from the WebGPU device.
// ==========================================================================

import { useAppStore } from '@/stores/appStore';
import { getGpuBackend } from './gpu';

const SAMPLE_WINDOW = 1_000;

class PerformanceMonitor {
  private rafId = 0;
  private running = false;
  private frameCount = 0;
  private windowStart = 0;
  private lastFrameTs = 0;
  private frameMsAccum = 0;
  private memoryTimer: ReturnType<typeof setInterval> | null = null;

  start() {
    if (this.running) return;
    this.running = true;
    this.windowStart = performance.now();
    this.lastFrameTs = this.windowStart;
    this.rafId = requestAnimationFrame(this.tick);
    this.memoryTimer = setInterval(() => this.sampleMemory(), 2000);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.rafId);
    if (this.memoryTimer) clearInterval(this.memoryTimer);
  }

  private tick = (now: number) => {
    if (!this.running) return;
    this.frameCount += 1;
    this.frameMsAccum += now - this.lastFrameTs;
    this.lastFrameTs = now;

    const elapsed = now - this.windowStart;
    if (elapsed >= SAMPLE_WINDOW) {
      const fps = (this.frameCount * 1000) / elapsed;
      const frameMs = this.frameMsAccum / this.frameCount;
      useAppStore.getState().setFps(Math.round(fps), Math.round(frameMs * 100) / 100);
      this.frameCount = 0;
      this.frameMsAccum = 0;
      this.windowStart = now;
    }
    this.rafId = requestAnimationFrame(this.tick);
  };

  private async sampleMemory() {
    const gpu = getGpuBackend();
    const mb = await queryDeviceMemory(gpu.device);
    useAppStore.getState().setMemoryMb(Math.round(mb));
  }
}

async function queryDeviceMemory(device: GPUDevice | null): Promise<number> {
  if (!device) return 0;
  try {
    const info = (device as unknown as { adapter?: { info?: { dedicated?: number; memory?: number } } })
      .adapter?.info;
    const mem = info?.dedicated ?? info?.memory ?? 0;
    return mem ? mem / (1024 * 1024) : 0;
  } catch {
    return 0;
  }
}

export const perfMonitor = new PerformanceMonitor();