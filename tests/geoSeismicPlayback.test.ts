import { describe, expect, it, vi } from 'vitest';
import { SeismicPlugin } from '../src/plugins/builtin/geo/seismic/plugin';
import { isParamVisible } from '../src/types/plugin';

describe('seismic wave-field playback', () => {
  it('schedules frames and advances the simulation while playing', () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      frames.push(cb);
      return frames.length;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {});
    try {
      const plugin = new SeismicPlugin();
      const p = plugin as unknown as {
        ctx: unknown;
        state: { playing: boolean; mode: string };
        sim: { steps: number } | null;
        draw: () => void;
      };
      p.ctx = { canvas2d: {} };
      p.state.playing = false;
      p.state.mode = 'wavefield';
      p.draw = () => {};
      plugin.updateParams({ play: { action: 'play' } });
      expect(p.state.playing).toBe(true);
      expect(frames.length).toBe(1);
      const before = p.sim!.steps;
      frames.shift()!(1000);
      expect(p.sim!.steps).toBe(before + 2);
      expect(frames.length).toBe(1);
      plugin.updateParams({ play: { action: 'play' } });
      expect(p.state.playing).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('does not start a loop outside the wave-field view', () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      frames.push(cb);
      return frames.length;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {});
    try {
      const plugin = new SeismicPlugin();
      const p = plugin as unknown as {
        ctx: unknown;
        state: { playing: boolean; mode: string };
        draw: () => void;
      };
      p.ctx = { canvas2d: {} };
      p.state.mode = 'beachball';
      p.draw = () => {};
      plugin.updateParams({ play: { action: 'play' } });
      expect(frames.length).toBe(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('only exposes the controls that the active view uses', () => {
    const plugin = new SeismicPlugin();
    const shown = (key: string) => {
      const defs = plugin.getParams();
      return isParamVisible(defs.find((d) => d.key === key)!, defs);
    };
    // Wave field: only transport buttons, no physics sliders.
    expect(shown('play')).toBe(true);
    expect(shown('step')).toBe(true);
    expect(shown('magnitude')).toBe(false);
    expect(shown('distanceDeg')).toBe(false);
    expect(shown('strike')).toBe(false);

    plugin.updateParams({ mode: 'beachball' });
    expect(shown('play')).toBe(false);
    expect(shown('step')).toBe(false);
    expect(shown('resetField')).toBe(false);
    expect(shown('strike')).toBe(true);
    expect(shown('dip')).toBe(true);
    expect(shown('rake')).toBe(true);
    expect(shown('magnitude')).toBe(false);

    plugin.updateParams({ mode: 'seismogram' });
    expect(shown('magnitude')).toBe(true);
    expect(shown('distanceDeg')).toBe(true);
    expect(shown('depthKm')).toBe(true);
    expect(shown('strike')).toBe(false);

    plugin.updateParams({ mode: 'traveltime' });
    expect(shown('distanceDeg')).toBe(true);
    expect(shown('magnitude')).toBe(false);
    expect(shown('depthKm')).toBe(false);

    plugin.updateParams({ mode: 'magnitudes' });
    expect(shown('magnitude')).toBe(true);
    expect(shown('distanceDeg')).toBe(false);
  });
});
