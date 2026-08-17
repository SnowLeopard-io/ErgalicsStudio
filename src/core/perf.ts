// ==========================================================================
// Performance monitor (spec §7): FPS / frame time via rAF sampling, GPU
// memory estimate from the WebGPU device, JS heap usage, and cumulative
// lifetime stats (total frames, average FPS, worst frame, uptime).
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
  private windowMaxFrameMs = 0;
  private totalFrames = 0;
  private startTs = 0;
  private memoryTimer: ReturnType<typeof setInterval> | null = null;

  start() {
    if (this.running) return;
    this.running = true;
    this.startTs = performance.now();
    this.windowStart = this.startTs;
    this.lastFrameTs = this.startTs;
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
    const dt = now - this.lastFrameTs;
    this.frameMsAccum += dt;
    if (dt > this.windowMaxFrameMs) this.windowMaxFrameMs = dt;
    this.lastFrameTs = now;

    const elapsed = now - this.windowStart;
    if (elapsed >= SAMPLE_WINDOW) {
      const fps = (this.frameCount * 1000) / elapsed;
      const frameMs = this.frameMsAccum / this.frameCount;
      this.totalFrames += this.frameCount;
      const uptimeSec = (now - this.startTs) / 1000;
      useAppStore.getState().setFps(Math.round(fps), Math.round(frameMs * 100) / 100);
      useAppStore.getState().setPerfTotals({
        totalFrames: this.totalFrames,
        avgFps: Math.round((this.totalFrames * 1000) / (now - this.startTs)),
        maxFrameMs: Math.round(this.windowMaxFrameMs * 100) / 100,
        uptimeSec: Math.round(uptimeSec),
      });
      this.frameCount = 0;
      this.frameMsAccum = 0;
      this.windowMaxFrameMs = 0;
      this.windowStart = now;
    }
    this.rafId = requestAnimationFrame(this.tick);
  };

  private async sampleMemory() {
    const gpu = getGpuBackend();
    const mb = await queryDeviceMemory(gpu.device);
    const heap = queryJsHeap();
    useAppStore.getState().setMemoryMb(Math.round(mb));
    useAppStore.getState().setPerfMemory(heap, Math.round(mb));
  }
}

async function queryDeviceMemory(device: GPUDevice | null): Promise<number> {
  if (!device) return 0;
  // WebGPU's GPUDevice has no `.adapter` member and the spec does not expose
  // adapter memory, so the old `device.adapter?.info` path always returned 0.
  // Fall back to the coarse device-RAM heuristic where it is available.
  try {
    const nav = navigator as Navigator & { deviceMemory?: number };
    const gb = nav.deviceMemory;
    if (typeof gb === 'number' && Number.isFinite(gb) && gb > 0) {
      return gb * 1024; // deviceMemory is reported in GiB → MiB
    }
    return 0;
  } catch {
    return 0;
  }
}

/** JS heap usage in MiB (Chromium-only), or 0 when unsupported. */
function queryJsHeap(): number {
  try {
    const mem = (performance as Performance & { memory?: { usedJSHeapSize?: number } }).memory;
    if (mem?.usedJSHeapSize && Number.isFinite(mem.usedJSHeapSize)) {
      return Math.round(mem.usedJSHeapSize / (1024 * 1024));
    }
    return 0;
  } catch {
    return 0;
  }
}

export const perfMonitor = new PerformanceMonitor();