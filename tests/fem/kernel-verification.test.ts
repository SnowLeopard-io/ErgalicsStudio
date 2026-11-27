// ==========================================================================
// FEM 内核正确性校验 — 形状函数、本构、CSR 装配、边界条件、θ 时间积分与 CG。
//
// 目标：逐步核对数值转换/分支判断，并用解析参考值量化误差；同时覆盖空值、
// 零值、极大/极小数值、退化单元、奇异系统、非有限输入与并发调用。
// ==========================================================================

import { describe, expect, it } from 'vitest';
import { rectStructuredMesh } from '@ergalics/sci-kernels/fem/mesh/domain';
import { nodeCount, nodeX, nodeY, type PlanarMesh } from '@ergalics/sci-kernels/fem/mesh/types';
import { p1Basis, p1ShapeAt } from '@ergalics/sci-kernels/fem/assemble/basis';
import {
  CsrBuilder,
  assembleP1Mass,
  assembleP1Stiffness,
  csrDiagonal,
  csrMulVec,
  type CsrMatrix,
} from '@ergalics/sci-kernels/fem/assemble/stiffness';
import {
  assembleEdgeLoad,
  assemblePressureLoad,
  assembleSourceVector,
  selectBoundaryEdges,
} from '@ergalics/sci-kernels/fem/assemble/load';
import { applyDirichlet, applyDirichletPenalty } from '@ergalics/sci-kernels/fem/bc/dirichlet';
import { thetaOperators } from '@ergalics/sci-kernels/fem/solve/transient';
import { conjugateGradient } from '@ergalics/sci-kernels/fem/solve/cg';
import { constitutiveMatrix, solveElasticity, type PlaneState } from '@ergalics/sci-kernels/fem/physics/elasticity';

/** 读取 CSR 的单个条目（缺省为 0）。 */
function entry(A: CsrMatrix, row: number, col: number): number {
  for (let k = A.rowPtr[row]!; k < A.rowPtr[row + 1]!; k += 1) {
    if (A.colIdx[k] === col) return A.values[k]!;
  }
  return 0;
}

/** 小型稠密高斯消元（部分主元），仅用于给 CG 提供参考解。 */
function denseSolve(a: number[][], b: number[]): number[] {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i]!]);
  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < n; row += 1) {
      if (Math.abs(m[row]![col]!) > Math.abs(m[pivot]![col]!)) pivot = row;
    }
    const tmp = m[col]!;
    m[col] = m[pivot]!;
    m[pivot] = tmp;
    const diag = m[col]![col]!;
    for (let k = col; k <= n; k += 1) m[col]![k] = m[col]![k]! / diag;
    for (let row = 0; row < n; row += 1) {
      if (row === col) continue;
      const factor = m[row]![col]!;
      if (factor === 0) continue;
      for (let k = col; k <= n; k += 1) m[row]![k] = m[row]![k]! - factor * m[col]![k]!;
    }
  }
  return m.map((row) => row[n]!);
}

/** 一维 Laplacian（Dirichlet 边界由 b 承载）。 */
function laplacian1D(n: number): CsrMatrix {
  const builder = new CsrBuilder(n, n);
  for (let i = 0; i < n; i += 1) {
    builder.add(i, i, 2);
    if (i > 0) builder.add(i, i - 1, -1);
    if (i < n - 1) builder.add(i, i + 1, -1);
  }
  return builder.toCsr();
}

function diagonalMatrix(values: number[]): CsrMatrix {
  const builder = new CsrBuilder(values.length, values.length);
  values.forEach((value, i) => builder.add(i, i, value));
  return builder.toCsr();
}

/** 网格边界节点（x=0/x=W 或 y=0/y=H）。 */
function boundaryNodes(mesh: PlanarMesh, width: number, height: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < nodeCount(mesh); i += 1) {
    const x = nodeX(mesh, i);
    const y = nodeY(mesh, i);
    if (Math.abs(x) < 1e-9 || Math.abs(x - width) < 1e-9 || Math.abs(y) < 1e-9 || Math.abs(y - height) < 1e-9) {
      out.push(i);
    }
  }
  return out;
}

describe('P1 形状函数：几何量、梯度与退化分支', () => {
  it('单位直角三角形给出正确的面积、形心与常量梯度', () => {
    const basis = p1Basis(0, 0, 1, 0, 0, 1);
    expect(basis.area).toBeCloseTo(0.5, 15);
    expect(basis.signedArea).toBeGreaterThan(0);
    expect(basis.centroid[0]).toBeCloseTo(1 / 3, 15);
    expect(basis.centroid[1]).toBeCloseTo(1 / 3, 15);
    // λ0 = 1 − x − y, λ1 = x, λ2 = y
    expect(basis.grad[0]).toBeCloseTo(-1, 15);
    expect(basis.grad[1]).toBeCloseTo(-1, 15);
    expect(basis.grad[2]).toBeCloseTo(1, 15);
    expect(basis.grad[3]).toBeCloseTo(0, 15);
    expect(basis.grad[4]).toBeCloseTo(0, 15);
    expect(basis.grad[5]).toBeCloseTo(1, 15);
    // 三个梯度之和为 0（分片常值场可精确表示）。
    expect(basis.grad[0]! + basis.grad[2]! + basis.grad[4]!).toBeCloseTo(0, 15);
    expect(basis.grad[1]! + basis.grad[3]! + basis.grad[5]!).toBeCloseTo(0, 15);
  });

  it('顺时针单元的 signedArea 变号但面积与梯度方向保持正确', () => {
    const ccw = p1Basis(0, 0, 1, 0, 0, 1);
    const cw = p1Basis(0, 0, 0, 1, 1, 0);
    expect(cw.signedArea).toBeLessThan(0);
    expect(cw.area).toBeCloseTo(ccw.area, 15);
    // 同一几何单元，梯度必须与方向无关（只跟随节点编号）。
    expect(cw.grad[0]).toBeCloseTo(-1, 15);
    expect(cw.grad[1]).toBeCloseTo(-1, 15);
  });

  it('形函数在顶点满足 δij，形心处三者均为 1/3', () => {
    const at0 = p1ShapeAt(0, 0, 1, 0, 0, 1, 0, 0);
    const at1 = p1ShapeAt(0, 0, 1, 0, 0, 1, 1, 0);
    const at2 = p1ShapeAt(0, 0, 1, 0, 0, 1, 0, 1);
    const centre = p1ShapeAt(0, 0, 1, 0, 0, 1, 1 / 3, 1 / 3);
    expect(at0).toEqual([1, 0, 0]);
    expect(at1).toEqual([0, 1, 0]);
    expect(at2).toEqual([0, 0, 1]);
    expect(centre[0]).toBeCloseTo(1 / 3, 14);
    expect(centre[1]).toBeCloseTo(1 / 3, 14);
    expect(centre[2]).toBeCloseTo(1 / 3, 14);
  });

  it('零面积三角形在形函数求值时返回 NaN（显式退化分支）', () => {
    const degenerate = p1ShapeAt(0, 0, 1, 0, 2, 0, 0.5, 0);
    expect(degenerate.every((value) => Number.isNaN(value))).toBe(true);
  });
});

describe('本构矩阵：平面应力/应变的分支与已知值', () => {
  it('平面应力 ν=0.3 与解析 D 矩阵逐项一致', () => {
    const E = 200e9;
    const nu = 0.3;
    const D = constitutiveMatrix(E, nu, 'plane-stress');
    const f = E / (1 - nu * nu);
    expect(D[0]).toBeCloseTo(f, 6);
    expect(D[1]).toBeCloseTo(f * nu, 6);
    expect(D[3]).toBeCloseTo(f * nu, 6);
    expect(D[4]).toBeCloseTo(f, 6);
    expect(D[8]).toBeCloseTo((f * (1 - nu)) / 2, 6);
    expect(D[2]).toBe(0);
    expect(D[5]).toBe(0);
    expect(D[6]).toBe(0);
    expect(D[7]).toBe(0);
  });

  it('ν=0 时两种平面状态都退化为 E 与 E/2（无耦合）', () => {
    for (const state of ['plane-stress', 'plane-strain'] as const) {
      const D = constitutiveMatrix(100, 0, state);
      expect(D[0]).toBeCloseTo(100, 12);
      expect(D[4]).toBeCloseTo(100, 12);
      expect(D[1]).toBeCloseTo(0, 12);
      expect(D[3]).toBeCloseTo(0, 12);
      expect(D[8]).toBeCloseTo(50, 12);
    }
  });

  it('平面应变 ν=0.3 的 σx/σy 比值符合 1−ν : ν', () => {
    const D = constitutiveMatrix(200e9, 0.3, 'plane-strain');
    const eps = 1e-3;
    const sx = D[0]! * eps;
    const sy = D[3]! * eps;
    expect(sy / sx).toBeCloseTo(0.3 / 0.7, 12);
  });
});

describe('CSR 装配：重复项合并、零值保留与乘法一致性', () => {
  it('重复三元组合并求和，零值条目保留以共享稀疏模式', () => {
    const builder = new CsrBuilder(2, 2);
    builder.add(0, 0, 1);
    builder.add(0, 0, 2);
    builder.add(0, 1, 0);
    builder.add(1, 1, 5);
    const A = builder.toCsr();
    expect(entry(A, 0, 0)).toBe(3);
    expect(entry(A, 0, 1)).toBe(0);
    expect(entry(A, 1, 1)).toBe(5);
    expect(A.values.length).toBe(3);
    expect(A.rowPtr[2]).toBe(3);
  });

  it('csrMulVec 与稠密乘法逐项一致', () => {
    const builder = new CsrBuilder(3, 3);
    const dense = [
      [2, -1, 0],
      [-1, 2, -1],
      [0, -1, 2],
    ];
    dense.forEach((row, r) => row.forEach((value, c) => builder.add(r, c, value)));
    const A = builder.toCsr();
    const x = [1, -2, 3];
    const y = new Float64Array(3);
    csrMulVec(A, x, y);
    for (let r = 0; r < 3; r += 1) {
      const expected = dense[r]!.reduce((sum, value, c) => sum + value * x[c]!, 0);
      expect(y[r]).toBeCloseTo(expected, 14);
    }
  });
});

describe('刚度/质量/载荷装配：守恒性与符号约定', () => {
  const mesh = rectStructuredMesh(1, 1, 4, 4);

  it('刚度阵对称、行和为 0（常值场属于核空间）', () => {
    const K = assembleP1Stiffness(mesh, 1);
    for (let row = 0; row < K.rows; row += 1) {
      let sum = 0;
      for (let k = K.rowPtr[row]!; k < K.rowPtr[row + 1]!; k += 1) {
        sum += K.values[k]!;
        expect(entry(K, K.colIdx[k]!, row)).toBeCloseTo(K.values[k]!, 12);
      }
      expect(Math.abs(sum)).toBeLessThan(1e-10);
    }
    const diag = csrDiagonal(K);
    expect(Math.max(...diag)).toBeGreaterThan(0);
  });

  it('按 tag 的导热系数线性缩放刚度阵', () => {
    const K1 = assembleP1Stiffness(mesh, { 0: 1 });
    const K2 = assembleP1Stiffness(mesh, { 0: 7.5 });
    for (let i = 0; i < K1.values.length; i += 1) {
      expect(K2.values[i]).toBeCloseTo(K1.values[i]! * 7.5, 10);
    }
  });

  it('质量阵总质量等于域面积，单元内每行和为 A/3', () => {
    const M = assembleP1Mass(mesh);
    let total = 0;
    for (let i = 0; i < M.values.length; i += 1) total += M.values[i]!;
    expect(total).toBeCloseTo(1, 10);
    // 单三角形单元：3×3 块的行和为 A/3。
    const single: PlanarMesh = {
      nodes: Float64Array.from([0, 0, 1, 0, 0, 1]),
      nodeTags: new Int32Array(3),
      elements: [{ a: 0, b: 1, c: 2, tag: 0 }],
      boundaryEdges: [],
    };
    const Ms = assembleP1Mass(single);
    const area = 0.5;
    for (let row = 0; row < Ms.rows; row += 1) {
      let sum = 0;
      for (let k = Ms.rowPtr[row]!; k < Ms.rowPtr[row + 1]!; k += 1) sum += Ms.values[k]!;
      expect(sum).toBeCloseTo(area / 3, 12);
    }
  });

  it('常量源项的总载荷等于 f·面积', () => {
    const load = assembleSourceVector(mesh, () => 2);
    const total = load.reduce((sum, value) => sum + value, 0);
    expect(total).toBeCloseTo(2, 10);
  });

  it('边界积分对常量与线性分布均精确（2 点梯形精确）', () => {
    const right = selectBoundaryEdges(mesh, [2]);
    expect(right.length).toBeGreaterThan(0);
    const constant = assembleEdgeLoad(mesh, right, 3);
    expect(constant.reduce((sum, value) => sum + value, 0)).toBeCloseTo(3, 12);
    // 右边 x=1，g = x + y ⇒ ∫₀¹(1+y)dy = 1.5
    const linear = assembleEdgeLoad(mesh, right, (x, y) => x + y);
    expect(linear.reduce((sum, value) => sum + value, 0)).toBeCloseTo(1.5, 12);
  });

  it('正压力为压向内部：右边界合力 −p·L·t，左边界反向', () => {
    const right = selectBoundaryEdges(mesh, [2]);
    const left = selectBoundaryEdges(mesh, [4]);
    const pr = assemblePressureLoad(mesh, right, 5, 2);
    const pl = assemblePressureLoad(mesh, left, 5, 2);
    let fxRight = 0;
    let fyRight = 0;
    let fxLeft = 0;
    for (let i = 0; i < nodeCount(mesh); i += 1) {
      fxRight += pr[i * 2]!;
      fyRight += pr[i * 2 + 1]!;
      fxLeft += pl[i * 2]!;
    }
    expect(fxRight).toBeCloseTo(-10, 12);
    expect(Math.abs(fyRight)).toBeLessThan(1e-12);
    expect(fxLeft).toBeCloseTo(10, 12);
  });
});

describe('Dirichlet 边界：消元、RHS 修正与罚函数近似', () => {
  function system(): { A: CsrMatrix; f: Float64Array } {
    const builder = new CsrBuilder(2, 2);
    builder.add(0, 0, 4);
    builder.add(0, 1, 1);
    builder.add(1, 0, 1);
    builder.add(1, 1, 3);
    return { A: builder.toCsr(), f: Float64Array.from([1, 2]) };
  }

  it('消元后约束行/列为单位行，RHS 已扣除 K_id·g 且保持对称', () => {
    const { A, f } = system();
    applyDirichlet(A, f, [{ dof: 0, value: 2 }]);
    expect(entry(A, 0, 0)).toBe(1);
    expect(entry(A, 0, 1)).toBe(0);
    expect(entry(A, 1, 0)).toBe(0);
    expect(entry(A, 1, 1)).toBe(3);
    expect(f[0]).toBe(2);
    expect(f[1]).toBe(0);
  });

  it('约束值与 RHS 冲突时以约束值为准（无 NaN、无残留耦合）', () => {
    const { A, f } = system();
    applyDirichlet(A, f, [
      { dof: 0, value: 2 },
      { dof: 0, value: -1 },
    ]);
    expect(f[0]).toBe(-1);
    const solved = conjugateGradient(A, f, { tol: 1e-14 });
    expect(solved.converged).toBe(true);
    expect(solved.solution[0]).toBeCloseTo(-1, 12);
  });

  it('罚函数法在大罚数下逼近强约束解', () => {
    const { A, f } = system();
    applyDirichletPenalty(A, f, [{ dof: 0, value: 2 }], 1e12);
    const solved = conjugateGradient(A, f, { tol: 1e-14, maxIter: 100 });
    expect(solved.converged).toBe(true);
    expect(solved.solution[0]).toBeCloseTo(2, 9);
    expect(solved.solution[1]).toBeCloseTo(0, 9);
  });
});

describe('θ 时间积分算子：精确组合与模式校验', () => {
  it('LHS = M + θΔtK，RHS = M − (1−θ)ΔtK', () => {
    // M/K 必须共享稀疏模式（零值也要保留），与真实装配器的约定一致。
    const Mb = new CsrBuilder(2, 2);
    Mb.add(0, 0, 1);
    Mb.add(0, 1, 0);
    Mb.add(1, 0, 0);
    Mb.add(1, 1, 1);
    const M = Mb.toCsr();
    const K = new CsrBuilder(2, 2);
    K.add(0, 0, 1);
    K.add(0, 1, -1);
    K.add(1, 0, -1);
    K.add(1, 1, 1);
    const { lhs, rhsOp } = thetaOperators(M, K.toCsr(), 2, 0.5);
    expect(entry(lhs, 0, 0)).toBeCloseTo(2, 15);
    expect(entry(lhs, 0, 1)).toBeCloseTo(-1, 15);
    expect(entry(rhsOp, 0, 0)).toBeCloseTo(0, 15);
    expect(entry(rhsOp, 0, 1)).toBeCloseTo(1, 15);
  });

  it('M/K 稀疏模式不一致时显式抛错，而非静默丢项', () => {
    const M = diagonalMatrix([1, 1]);
    const K = new CsrBuilder(2, 2);
    K.add(0, 0, 1);
    K.add(0, 1, -1);
    K.add(1, 0, -1);
    K.add(1, 1, 1);
    expect(() => thetaOperators(M, K.toCsr(), 1, 0.5)).toThrow(/pattern mismatch/);
  });
});

describe('共轭梯度：精确性、奇异系统与极端量级', () => {
  it('零 RHS 直接返回零解，0 次迭代', () => {
    const A = laplacian1D(5);
    const result = conjugateGradient(A, new Float64Array(5), { tol: 1e-12 });
    expect(result.converged).toBe(true);
    expect(result.iterations).toBe(0);
    expect(Array.from(result.solution)).toEqual([0, 0, 0, 0, 0]);
  });

  it('单位阵一次迭代得到精确解', () => {
    const A = diagonalMatrix([1, 1, 1]);
    const result = conjugateGradient(A, Float64Array.from([2, -3, 4]), { tol: 1e-12 });
    expect(result.converged).toBe(true);
    expect(result.iterations).toBe(1);
    expect(result.solution[0]).toBeCloseTo(2, 12);
    expect(result.solution[1]).toBeCloseTo(-3, 12);
    expect(result.solution[2]).toBeCloseTo(4, 12);
  });

  it('一维 Laplacian 解与稠密高斯消元参考值一致（误差 < 1e-10）', () => {
    const n = 24;
    const A = laplacian1D(n);
    const b = Array.from({ length: n }, (_, i) => Math.sin((i + 1) * 0.37) + 0.1 * (i % 3));
    const dense = denseSolve(
      Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => entry(A, r, c))),
      b,
    );
    const result = conjugateGradient(A, Float64Array.from(b), { tol: 1e-14, maxIter: 2000 });
    expect(result.converged).toBe(true);
    let maxErr = 0;
    for (let i = 0; i < n; i += 1) maxErr = Math.max(maxErr, Math.abs(result.solution[i]! - dense[i]!));
    expect(maxErr).toBeLessThan(1e-10);
  });

  it('零矩阵（奇异）返回未收敛而不是错误的零解', () => {
    const A = new CsrBuilder(3, 3).toCsr();
    const result = conjugateGradient(A, Float64Array.from([1, 2, 3]), { tol: 1e-12 });
    expect(result.converged).toBe(false);
    expect(result.residual).toBeCloseTo(Math.sqrt(14), 12);
  });

  it('非有限 RHS 返回未收敛 + NaN 残差，不抛异常', () => {
    const A = diagonalMatrix([1, 1, 1]);
    const result = conjugateGradient(A, Float64Array.from([1, Number.NaN, 0]), { tol: 1e-12 });
    expect(result.converged).toBe(false);
    expect(Number.isNaN(result.residual)).toBe(true);
  });

  it('非有限矩阵条目不会静默给出有效解', () => {
    const builder = new CsrBuilder(2, 2);
    builder.add(0, 0, 1);
    builder.add(0, 1, Number.POSITIVE_INFINITY);
    builder.add(1, 0, 0);
    builder.add(1, 1, 1);
    const result = conjugateGradient(builder.toCsr(), Float64Array.from([1, 1]), { tol: 1e-12 });
    expect(result.converged).toBe(false);
  });

  it('maxIter=0 时不做迭代，明确返回未收敛', () => {
    const A = diagonalMatrix([2, 2]);
    const result = conjugateGradient(A, Float64Array.from([2, 2]), { tol: 1e-12, maxIter: 0 });
    expect(result.iterations).toBe(0);
    expect(result.converged).toBe(false);
    expect(result.residual).toBeCloseTo(2 * Math.sqrt(2), 12);
  });

  it('1e±200 量级 RHS 不溢出/下溢（缩放后仍然精确）', () => {
    const A = diagonalMatrix([1, 1]);
    const huge = conjugateGradient(A, Float64Array.from([1e200, -2e200]), { tol: 1e-12 });
    expect(huge.converged).toBe(true);
    expect(huge.solution[0]! / 1e200).toBeCloseTo(1, 10);
    expect(huge.solution[1]! / -2e200).toBeCloseTo(1, 10);

    const tiny = conjugateGradient(A, Float64Array.from([1e-200, -2e-200]), { tol: 1e-12 });
    expect(tiny.converged).toBe(true);
    expect(tiny.solution[0]! / 1e-200).toBeCloseTo(1, 10);
    expect(tiny.solution[1]! / -2e-200).toBeCloseTo(1, 10);
  });

  it('矩阵 1e±200 量级与 RHS 同阶时仍得到 O(1) 解', () => {
    const huge = conjugateGradient(diagonalMatrix([1e200]), Float64Array.from([1e200]), { tol: 1e-12 });
    expect(huge.converged).toBe(true);
    expect(huge.solution[0]).toBeCloseTo(1, 6);
    const tiny = conjugateGradient(diagonalMatrix([1e-200]), Float64Array.from([1e-200]), { tol: 1e-12 });
    expect(tiny.converged).toBe(true);
    expect(tiny.solution[0]).toBeCloseTo(1, 6);
  });
});

describe('平面弹性：线性场重构、刚体模态与极端材料参数', () => {
  const E = 2e11;
  const nu = 0.3;

  it('仿射位移场补丁测试：内部节点与常应变/常应力精确重构', () => {
    const mesh = rectStructuredMesh(2, 2, 2, 2);
    const ex = 1e-3;
    const ey = 8e-4;
    const gxy = -1e-4;
    const ux = (x: number, y: number): number => ex * x + 0.5 * gxy * y + 5e-3;
    const uy = (x: number, y: number): number => 0.5 * gxy * x + ey * y - 2e-3;
    const constraints = boundaryNodes(mesh, 2, 2).map((node) => ({
      nodes: [node],
      ux: ux(nodeX(mesh, node), nodeY(mesh, node)),
      uy: uy(nodeX(mesh, node), nodeY(mesh, node)),
    }));
    const result = solveElasticity({
      mesh, E, nu, state: 'plane-stress', constraints,
      cg: { tol: 1e-13, maxIter: 5000 },
    });

    let maxErr = 0;
    for (let i = 0; i < nodeCount(mesh); i += 1) {
      const x = nodeX(mesh, i);
      const y = nodeY(mesh, i);
      maxErr = Math.max(
        maxErr,
        Math.abs(result.displacement[2 * i]! - ux(x, y)),
        Math.abs(result.displacement[2 * i + 1]! - uy(x, y)),
      );
    }
    expect(maxErr).toBeLessThan(1e-12);

    const D = constitutiveMatrix(E, nu, 'plane-stress');
    const sx = D[0]! * ex + D[1]! * ey;
    const sy = D[3]! * ex + D[4]! * ey;
    const txy = D[8]! * gxy;
    for (let e = 0; e < mesh.elements.length; e += 1) {
      expect(result.elementStress[e * 3]).toBeCloseTo(sx, 3);
      expect(result.elementStress[e * 3 + 1]).toBeCloseTo(sy, 3);
      expect(result.elementStress[e * 3 + 2]).toBeCloseTo(txy, 6);
    }
  });

  it('纯剪切：唯一非零应力为 τxy = G·γ', () => {
    const mesh = rectStructuredMesh(1, 1, 2, 2);
    const gamma = 2e-3;
    const constraints = boundaryNodes(mesh, 1, 1).map((node) => ({
      nodes: [node],
      ux: gamma * nodeY(mesh, node),
      uy: 0,
    }));
    const result = solveElasticity({
      mesh, E, nu, state: 'plane-stress', constraints,
      cg: { tol: 1e-13, maxIter: 5000 },
    });
    const G = E / (2 * (1 + nu));
    for (let e = 0; e < mesh.elements.length; e += 1) {
      expect(Math.abs(result.elementStress[e * 3]!)).toBeLessThan(1e-6);
      expect(Math.abs(result.elementStress[e * 3 + 1]!)).toBeLessThan(1e-6);
      expect(result.elementStress[e * 3 + 2]).toBeCloseTo(G * gamma, 6);
    }
  });

  it('刚体平移：边界统一给定位移，内部节点精确复现且应力为零', () => {
    const mesh = rectStructuredMesh(2, 1, 3, 2);
    const constraints = boundaryNodes(mesh, 2, 1).map((node) => ({
      nodes: [node], ux: 3, uy: -2,
    }));
    const result = solveElasticity({
      mesh, E, nu, state: 'plane-stress', constraints,
      cg: { tol: 1e-13, maxIter: 5000 },
    });
    for (let i = 0; i < nodeCount(mesh); i += 1) {
      expect(result.displacement[2 * i]).toBeCloseTo(3, 12);
      expect(result.displacement[2 * i + 1]).toBeCloseTo(-2, 12);
    }
    for (let e = 0; e < mesh.elements.length; e += 1) {
      // 零应力只能验证到机器精度量级：E≈2e11 时 1e-3 Pa 已远低于应变舍入误差。
      expect(Math.abs(result.elementStress[e * 3]!)).toBeLessThan(1e-3);
      expect(Math.abs(result.elementStress[e * 3 + 1]!)).toBeLessThan(1e-3);
      expect(Math.abs(result.elementStress[e * 3 + 2]!)).toBeLessThan(1e-3);
    }
  });

  it('非法材料参数（E≤0、ν 越界、厚度≤0）在装配前被拒绝', () => {
    const mesh = rectStructuredMesh(1, 1, 1, 1);
    const constraints = [{ nodes: [0, 1], ux: 0 }, { nodes: [0], uy: 0 }];
    expect(() => solveElasticity({ mesh, E: 0, nu, constraints })).toThrow(/Young/);
    expect(() => solveElasticity({ mesh, E: -1, nu, constraints })).toThrow(/Young/);
    expect(() => solveElasticity({ mesh, E: Number.NaN, nu, constraints })).toThrow(/Young/);
    expect(() => solveElasticity({ mesh, E, nu: 0.5, constraints })).toThrow(/Poisson/);
    expect(() => solveElasticity({ mesh, E, nu: -1, constraints })).toThrow(/Poisson/);
    expect(() => solveElasticity({ mesh, E, nu: Number.NaN, constraints })).toThrow(/Poisson/);
    expect(() => solveElasticity({ mesh, E, nu, thickness: 0, constraints })).toThrow(/thickness/);
    expect(() => solveElasticity({ mesh, E, nu, thickness: -1, constraints })).toThrow(/thickness/);
    expect(() => solveElasticity({
      mesh, E, nu, constraints, state: 'axisymmetric' as PlaneState,
    })).toThrow(/plane state/);
  });

  it('退化单元（共线节点）不会返回伪有效解', () => {
    const mesh: PlanarMesh = {
      nodes: Float64Array.from([0, 0, 1, 0, 2, 0]),
      nodeTags: new Int32Array(3),
      elements: [{ a: 0, b: 1, c: 2, tag: 0 }],
      boundaryEdges: [],
    };
    expect(() => solveElasticity({
      mesh, E, nu,
      constraints: [{ nodes: [0, 1], ux: 0 }, { nodes: [0], uy: 0 }],
      cg: { tol: 1e-10, maxIter: 50 },
    })).toThrow(/converge|non-finite/);
  });

  it('并发/交错调用互不影响，结果与顺序调用逐位一致', async () => {
    const mesh = rectStructuredMesh(2, 1, 6, 3);
    const left = Array.from({ length: nodeCount(mesh) }, (_, i) => i)
      .filter((i) => Math.abs(nodeX(mesh, i)) < 1e-9);
    const run = (modulus: number) => solveElasticity({
      mesh, E: modulus, nu, state: 'plane-stress',
      tractions: [{ edges: [2], tx: 100 }],
      constraints: [{ nodes: left, ux: 0 }, { nodes: [0], uy: 0 }],
      cg: { tol: 1e-12 },
    });
    const moduli = [1e9, 2e9, 5e9, 1e10, 2e10, 5e10, 1e11, 2e11];
    const sequential = moduli.map(run);
    const parallel = await Promise.all(
      moduli.map((modulus) => Promise.resolve().then(() => run(modulus))),
    );
    parallel.forEach((result, index) => {
      const reference = sequential[index]!;
      expect(Array.from(result.displacement)).toEqual(Array.from(reference.displacement));
      expect(result.iterations).toBe(reference.iterations);
    });
  });
});
