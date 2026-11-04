// ==========================================================================
// eng-control — linear system & PID control laboratory — manifest
//
// Time-domain (fixed-step RK4 unit-step response) and frequency-domain
// (direct s = jω evaluation) analysis of first-/second-order plants with
// optional ideal PID control in unity feedback. Validation: closed-form
// step-response benchmarks, analytic Bode corner/roll-off checks and the
// Franklin closed-form −3 dB bandwidth; documented in tests/eng-control.test.ts.
// ==========================================================================

import type { PluginManifest } from '@/types/plugin';

export const engControlManifest: PluginManifest = {
  id: 'example.eng-control',
  name: 'Control Systems Lab',
  nameI18n: { 'zh-CN': '控制系统实验室', 'en-US': 'Control Systems Lab' },
  version: '1.0.0',
  author: 'Ergalics',
  description:
    'First/second-order plant + PID unity-feedback analysis: RK4 unit-step response with σ%/tp/ts/e_ss metrics, direct s = jω Bode sweeps and the closed-loop −3 dB (half-power) bandwidth, each checked against closed-form references.',
  descriptionI18n: {
    'zh-CN':
      '一阶/二阶系统 + PID 闭环分析：RK4 定步长单位阶跃响应（超调 σ%、峰值时间 tp、调节时间 ts、稳态误差 e_ss），s = jω 直接扫频绘制 Bode 图并计算闭环 −3 dB（半功率）带宽，全部指标与解析解对照。',
    'en-US':
      'First/second-order plant + PID unity-feedback analysis: RK4 unit-step response with σ%/tp/ts/e_ss metrics, direct s = jω Bode sweeps and the closed-loop −3 dB (half-power) bandwidth, each checked against closed-form references.',
  },
  license: 'MIT',
  entry: 'example.eng-control',
  category: 'scientific',
  sandbox: 'trusted',
  research: {
    tier: 'research',
    units: { time: 's', omega: 'rad/s', gain: 'dB' },
    benchmarks: [
      'eng-control-second-order-step',
      'eng-control-first-order-time-constants',
      'eng-control-pid-steady-state',
      'eng-control-first-order-bode',
      'eng-control-second-order-bandwidth',
    ],
    reproducible: true,
    notes:
      'RK4 fixed-step integration (Stoer & Bulirsch) of the explicit state-space plant/controller; frequency response by direct evaluation at s = jω with self-implemented complex arithmetic. Benchmarks (unified yardstick |computed − analytic|/|analytic|): ζ=0.3, ωn=2 step vs closed form (σ%, tp, ts < 2%); first-order 63.2% point at t = τ and ts = τ·ln 50 (< 0.5%); integral action drives e_ss → 0 while P-only leaves exactly 1/(1+Kp); first-order Bode −3.01 dB / −45° at ω = 1/τ (exact) and −20 dB/decade roll-off; half-power bandwidth vs the Franklin closed form ω_b = ωn·√(1−2ζ²+√(4ζ⁴−4ζ²+2)) (< 1e-3). The settling-time yardstick is the EXACT last exit of the ±2% band on the analytic solution (grid scan + bisection) — the textbook 4/(ζωn) (and 4τ) envelope is only a coarse screen (~19% high at ζ = 0.3), so it is never used as the accuracy reference.',
    notesI18n: {
      'zh-CN':
        '时域为显式状态空间的 RK4 定步长积分（Stoer & Bulirsch），频域在 s = jω 直接求值（自实现复数运算）。基准（统一相对误差口径 |计算−解析|/|解析|）：ζ=0.3、ωn=2 的阶跃响应对闭式解（σ%、tp、ts < 2%）；一阶系统 63.2% 时刻 = τ、ts = τ·ln 50（< 0.5%）；积分作用使 e_ss → 0，纯比例闭环恰好留下 1/(1+Kp)；一阶 Bode 在 ω = 1/τ 处恰为 −3.01 dB / −45°，高频 −20 dB/十倍程；半功率带宽对照 Franklin 闭式 ω_b = ωn·√(1−2ζ²+√(4ζ⁴−4ζ²+2))（< 1e-3）。调节时间的解析基准是解析解最后一次越出 ±2% 带的精确时刻（网格扫描 + 二分法）；教科书包络式 4/(ζωn)（及 4τ）在 ζ=0.3 时偏高约 19%，仅作粗筛、绝不作为精度基准。',
      'en-US':
        'RK4 fixed-step integration (Stoer & Bulirsch) of the explicit state-space plant/controller; frequency response by direct evaluation at s = jω with self-implemented complex arithmetic. Benchmarks (unified yardstick |computed − analytic|/|analytic|): ζ=0.3, ωn=2 step vs closed form (σ%, tp, ts < 2%); first-order 63.2% point at t = τ and ts = τ·ln 50 (< 0.5%); integral action drives e_ss → 0 while P-only leaves exactly 1/(1+Kp); first-order Bode −3.01 dB / −45° at ω = 1/τ (exact) and −20 dB/decade roll-off; half-power bandwidth vs the Franklin closed form (< 1e-3). The settling-time yardstick is the EXACT last exit of the ±2% band on the analytic solution (grid scan + bisection) — the textbook 4/(ζωn) (and 4τ) envelope is only a coarse screen (~19% high at ζ = 0.3).',
    },
  },
};
