import { describe, it, expect } from 'vitest';
import {
  connectionPath,
  hitTestPoint,
  nodeHeight,
  pointInRect,
  portOffset,
  rectsIntersect,
  screenToWorld,
  worldToScreen,
} from '@/components/blocks/geometry';

describe('block canvas geometry', () => {
  it('screenToWorld and worldToScreen round-trip', () => {
    const vp = { x: 100, y: 50, zoom: 2 };
    const world = screenToWorld({ x: 200, y: 150 }, vp);
    expect(world).toEqual({ x: 50, y: 50 });
    expect(worldToScreen(world, vp)).toEqual({ x: 200, y: 150 });
  });

  it('connectionPath emits a cubic bezier', () => {
    const p = connectionPath({ x: 0, y: 0 }, { x: 100, y: 100 });
    expect(p.startsWith('M 0 0 C')).toBe(true);
    expect(p).toContain('100 100');
  });

  it('portOffset places ports on the correct side', () => {
    expect(portOffset(0, 'in').x).toBe(0);
    expect(portOffset(0, 'out').x).toBe(180);
  });

  it('nodeHeight grows with port count', () => {
    expect(nodeHeight(2, 2)).toBeGreaterThan(nodeHeight(1, 1));
  });

  it('hitTestPoint checks radial distance', () => {
    expect(hitTestPoint({ x: 3, y: 4 }, { x: 0, y: 0 }, 5)).toBe(true);
    expect(hitTestPoint({ x: 6, y: 0 }, { x: 0, y: 0 }, 5)).toBe(false);
  });

  it('pointInRect checks containment', () => {
    expect(pointInRect({ x: 5, y: 5 }, { x: 0, y: 0, width: 10, height: 10 })).toBe(true);
    expect(pointInRect({ x: 15, y: 5 }, { x: 0, y: 0, width: 10, height: 10 })).toBe(false);
  });

  it('rectsIntersect detects overlap', () => {
    const a = { x: 0, y: 0, width: 10, height: 10 };
    expect(rectsIntersect(a, { x: 5, y: 5, width: 10, height: 10 })).toBe(true);
    expect(rectsIntersect(a, { x: 20, y: 20, width: 10, height: 10 })).toBe(false);
  });
});
