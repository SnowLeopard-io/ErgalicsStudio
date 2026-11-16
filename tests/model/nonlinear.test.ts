import { describe, expect, it } from 'vitest';
import {
  fitNonlinearModel,
  levenbergMarquardt,
  NONLINEAR_MODELS,
} from '@/core/model/nonlinear';

const close = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps;

describe('model/nonlinear — Levenberg–Marquardt', () => {
  it('recovers Michaelis–Menten parameters from noise-free data', () => {
    const S = [0.5, 1, 2, 4, 8, 16, 32];
    const y = S.map((s) => (10 * s) / (2 + s));
    const fit = fitNonlinearModel('michaelis-menten', S, y);
    expect(fit.converged).toBe(true);
    expect(close(fit.params.Vmax!, 10, 1e-4)).toBe(true);
    expect(close(fit.params.Km!, 2, 1e-4)).toBe(true);
    expect(fit.rSquared).toBeGreaterThan(0.999999);
    expect(fit.coefficients).toHaveLength(2);
    expect(fit.coefficients[0]!.name).toBe('Vmax');
    expect(fit.dof).toBe(S.length - 2);
  });

  it('fits exponential decay with an offset', () => {
    const x = [0, 1, 2, 3, 4, 5, 6, 7];
    const y = x.map((t) => 5 * Math.exp(-0.7 * t) + 2);
    const fit = fitNonlinearModel('exponential', x, y);
    expect(close(fit.params.A!, 5, 1e-4)).toBe(true);
    expect(close(fit.params.k!, 0.7, 1e-4)).toBe(true);
    expect(close(fit.params.C!, 2, 1e-4)).toBe(true);
  });

  it('recovers a Gaussian peak position and width', () => {
    const x = Array.from({ length: 41 }, (_, i) => i * 0.25);
    const y = x.map((t) => 1 + 3 * Math.exp(-((t - 5) ** 2) / (2 * 1.2 ** 2)));
    const fit = fitNonlinearModel('gaussian', x, y);
    expect(close(fit.params.mu!, 5, 1e-3)).toBe(true);
    expect(close(fit.params.sigma!, 1.2, 1e-3)).toBe(true);
    expect(close(fit.params.A!, 3, 1e-3)).toBe(true);
  });

  it('handles a user model with a custom Jacobian path', () => {
    const model = (x: number[], p: number[]) => p[0]! * x[0]! + p[1]! * x[0]! ** 2;
    const xData = [[1], [2], [3], [4], [5]];
    const y = [2 * 1 + 3 * 1, 2 * 2 + 3 * 4, 2 * 3 + 3 * 9, 2 * 4 + 3 * 16, 2 * 5 + 3 * 25];
    const fit = levenbergMarquardt(model, xData, y, [0, 0], ['linear', 'quadratic']);
    expect(close(fit.params.linear!, 2, 1e-6)).toBe(true);
    expect(close(fit.params.quadratic!, 3, 1e-6)).toBe(true);
    expect(fit.sse).toBeLessThan(1e-16);
  });

  it('validates inputs and reports the model library', () => {
    expect(() => levenbergMarquardt(() => 0, [[1]], [1], [1], ['a'])).toThrow();
    expect(() => fitNonlinearModel('michaelis-menten', [1, 2], [1], {})).toThrow();
    const ids = Object.keys(NONLINEAR_MODELS);
    expect(ids).toContain('michaelis-menten');
    expect(ids).toContain('sigmoid4');
    expect(ids).toContain('arrhenius');
  });
});
