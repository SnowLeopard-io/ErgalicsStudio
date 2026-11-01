// ==========================================================================
// eng-vibration — structural vibration analysis laboratory — manifest
//
// SDOF/MDOF vibration laboratory in four modes. SDOF: free decay (fixed-step
// RK4 vs the exact closed form, phase plane) and harmonic forced response with
// half-power identification of zeta and wn. MDOF: N-DOF spring chain from
// editable m/k/c lists (plus a lumped simply supported beam), generalized
// Jacobi eigenanalysis with mass-normalized modes and modal/Rayleigh damping.
// FRF & transmissibility: Bode-style receptance sweep with a damping-ratio
// family overlay, base-isolation T(r) with the sqrt(2) boundary and isolation
// band shading. Rotating unbalance: normalized amplitude/phase and shaft
// orbit. Validation documented in tests/eng-vibration.test.ts.
// ==========================================================================

import type { PluginManifest } from '@/types/plugin';

export const engVibrationManifest: PluginManifest = {
  id: 'example.eng-vibration',
  name: 'Vibration Analysis',
  nameI18n: { 'zh-CN': '振动分析', 'en-US': 'Vibration Analysis' },
  version: '1.0.0',
  author: 'Ergalics',
  description:
    'SDOF/MDOF vibration laboratory: RK4 free decay (log-decrement delta, phase plane) vs the exact closed form, harmonic receptance with half-power identification of zeta and wn, generalized Jacobi eigenanalysis of N-DOF chains from editable m/k/c lists (mass-normalized modes, modal damping from the c list or Rayleigh), Bode-style FRF with a damping-ratio family sweep, base-isolation transmissibility (T(sqrt2) = 1 boundary, shaded T < 1 isolation band) and rotating unbalance (peak at wn/sqrt(1-2*zeta^2), exact 90 deg resonance phase, shaft orbit).',
  descriptionI18n: {
    'zh-CN':
      '单/多自由度振动实验室：RK4 自由衰减（对数衰减率 δ、相平面）对比精确闭式解，谐波导纳与半功率法识别 ζ、ωn；由可编辑 m/k/c 列表构建 N 自由度弹簧链的广义 Jacobi 特征值求解（质量归一振型，c 列表模态阻尼或 Rayleigh 阻尼）；Bode 式频响叠加阻尼比曲线族，基础隔振传递率（T(√2)=1 分界、T<1 隔振区着色）；旋转不平衡（峰值位于 ωn/√(1−2ζ²)、共振相位精确 90°、轴心轨迹）。',
    'en-US':
      'SDOF/MDOF vibration laboratory: RK4 free decay (log-decrement delta, phase plane) vs the exact closed form, harmonic receptance with half-power identification of zeta and wn, generalized Jacobi eigenanalysis of N-DOF chains from editable m/k/c lists (mass-normalized modes, modal damping from the c list or Rayleigh), Bode-style FRF with a damping-ratio family sweep, base-isolation transmissibility (T(sqrt2) = 1 boundary, shaded T < 1 isolation band) and rotating unbalance (peak at wn/sqrt(1-2*zeta^2), exact 90 deg resonance phase, shaft orbit).',
  },
  license: 'MIT',
  entry: 'example.eng-vibration',
  category: 'scientific',
  sandbox: 'trusted',
  formats: [
    {
      extension: '.csv',
      mimeTypes: ['text/csv'],
      description:
        'Parameter table (columns m,k[,c]), frequency sweep (w/frequency + amp/magnitude[, phase]) or free-decay time history (columns t,x)',
    },
  ],
  research: {
    tier: 'research',
    units: { time: 's', frequency: 'rad/s', mass: 'kg', stiffness: 'N/m', damping: 'N*s/m', displacement: 'm' },
    benchmarks: [
      'eng-vib-sdof-log-decrement',
      'eng-vib-sdof-damped-frequency',
      'eng-vib-sdof-rk4-vs-exact',
      'eng-vib-chain-eigen',
      'eng-vib-frf-resonance-peak',
      'eng-vib-half-power-identification',
      'eng-vib-isolation-sqrt2-boundary',
      'eng-vib-transmissibility-peak',
      'eng-vib-unbalance-resonance-peak',
      'eng-vib-determinism',
    ],
    reproducible: true,
    notes:
      'Pure numeric core with self-implemented cyclic Jacobi eigensolver, RK4 integration and complex arithmetic (no external numerics dependency). Benchmarks (unified yardstick |computed - analytic|/|analytic| unless stated): SDOF under-damped log decrement recovered from successive RK4 peaks vs delta = 2*pi*zeta/sqrt(1-zeta^2) (< 0.5%) and damped frequency from the peak spacing vs wd = wn*sqrt(1-zeta^2) (< 1e-3); RK4 trace vs the exact underdamped closed form, max relative deviation < 1e-5 (observed ~1e-8 at 4800 steps); chain eigenfrequencies from the generalized Jacobi solve vs the exact fixed-fixed uniform spectrum 2*sqrt(k/m)*sin(r*pi/(2*(n+1))) < 1e-9 — for the 2-DOF chain f = sqrt(k/m)*{1, sqrt(3)}/(2*pi), and the uniform 3-DOF chain carries the reference pair f = sqrt(k/m)*{sqrt(2-sqrt2), sqrt(2+sqrt2)}/(2*pi) (modes 1 and 3); receptance resonance peak from the sweep argmax vs wn*sqrt(1-2*zeta^2) (< 1e-3) with half-power recovery of zeta (< 2%, the estimator carries an O(zeta^2) bias) and wn (< 0.5%); T(sqrt2) = 1 EXACTLY for every zeta (algebraic identity) with T < 1 across the shaded isolation band r > sqrt(2); transmissibility peak vs the exact closed form r_peak = sqrt(sqrt(1+8*zeta^2)-1)/(2*zeta) (< 1e-6) and T_max vs 1/(2*zeta) (< 1% at zeta = 0.05); rotating-unbalance peak from a dense scan vs r_peak = 1/sqrt(1-2*zeta^2) and A_peak = 1/(2*zeta*sqrt(1-zeta^2)) (< 1e-3) with exactly 90 deg phase lag at r = 1.',
    notesI18n: {
      'zh-CN':
        '纯数值核：自实现循环 Jacobi 特征值求解、RK4 积分与复数运算，不依赖外部数值库。基准（统一相对误差口径 |计算−解析|/|解析|，另注明者除外）：SDOF 欠阻尼对数衰减率由 RK4 相邻正峰恢复，对照 δ = 2πζ/√(1−ζ²)（< 0.5%），阻尼频率由峰间距恢复，对照 ωd = ωn√(1−ζ²)（< 1e-3）；RK4 轨迹对比欠阻尼精确闭式解，最大相对偏差 < 1e-5（4800 步实测约 1e-8）；广义 Jacobi 求解的链特征频率对照两端固支均匀链精确谱 2√(k/m)·sin(rπ/(2(n+1)))（< 1e-9）——2 自由度链 f = √(k/m)·{1, √3}/(2π)，均匀 3 自由度链含参考对 f = √(k/m)·{√(2−√2), √(2+√2)}/(2π)（第 1、3 阶）；导纳共振峰由扫频 argmax 对照 ωn√(1−2ζ²)（< 1e-3），半功率法恢复 ζ（< 2%，估计器自带 O(ζ²) 偏差）与 ωn（< 0.5%）；T(√2) = 1 对一切 ζ 精确成立（代数恒等式），着色隔振区 r > √2 内 T < 1；传递率峰对照精确闭式 r_peak = √(√(1+8ζ²)−1)/(2ζ)（< 1e-6），T_max 对照 1/(2ζ)（ζ=0.05 时 < 1%）；不平衡峰值稠密扫描对照 r_peak = 1/√(1−2ζ²) 与 A_peak = 1/(2ζ√(1−ζ²))（< 1e-3），r = 1 处相位滞后精确 90°。',
      'en-US':
        'Pure numeric core with self-implemented cyclic Jacobi eigensolver, RK4 integration and complex arithmetic (no external numerics dependency). Benchmarks (unified yardstick |computed - analytic|/|analytic| unless stated): SDOF under-damped log decrement recovered from successive RK4 peaks vs delta = 2*pi*zeta/sqrt(1-zeta^2) (< 0.5%) and damped frequency from the peak spacing vs wd = wn*sqrt(1-zeta^2) (< 1e-3); RK4 trace vs the exact underdamped closed form, max relative deviation < 1e-5 (observed ~1e-8 at 4800 steps); chain eigenfrequencies from the generalized Jacobi solve vs the exact fixed-fixed uniform spectrum 2*sqrt(k/m)*sin(r*pi/(2*(n+1))) < 1e-9 — for the 2-DOF chain f = sqrt(k/m)*{1, sqrt(3)}/(2*pi), and the uniform 3-DOF chain carries the reference pair f = sqrt(k/m)*{sqrt(2-sqrt2), sqrt(2+sqrt2)}/(2*pi) (modes 1 and 3); receptance resonance peak from the sweep argmax vs wn*sqrt(1-2*zeta^2) (< 1e-3) with half-power recovery of zeta (< 2%) and wn (< 0.5%); T(sqrt2) = 1 EXACTLY for every zeta (algebraic identity) with T < 1 across the isolation band r > sqrt(2); transmissibility peak vs the exact closed form r_peak = sqrt(sqrt(1+8*zeta^2)-1)/(2*zeta) (< 1e-6) and T_max vs 1/(2*zeta) (< 1% at zeta = 0.05); rotating-unbalance peak from a dense scan vs r_peak = 1/sqrt(1-2*zeta^2) and A_peak = 1/(2*zeta*sqrt(1-zeta^2)) (< 1e-3) with exactly 90 deg phase lag at r = 1.',
    },
  },
};
