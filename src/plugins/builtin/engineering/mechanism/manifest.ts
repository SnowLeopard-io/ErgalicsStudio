// ==========================================================================
// eng-mechanism — mechanism kinematics studio — manifest
//
// Planar mechanism analysis in four modes: (1) four-bar linkage — Grashof
// classification, exact circle-intersection position analysis, animated
// mechanism with coupler-curve trace and transmission-angle chart; (2)
// velocity analysis — Kennedy instant centers, relative-velocity polygon and
// the coupler-point velocity validated against numeric differentiation of
// the position; (3) disk-cam profile synthesis — SHM/cycloidal/3-4-5 motion
// laws with editable dwell-rise-return-dwell timing, pitch curve, roller
// envelope, pressure-angle check and undercut screening; (4) gear trains —
// fixed-axis simple/compound stage ratios and the 2K-H planetary via the
// Willis equation with two driven members. Documented in
// tests/eng-mechanism.test.ts.
// ==========================================================================

import type { PluginManifest } from '@/types/plugin';

export const engMechanismManifest: PluginManifest = {
  id: 'example.eng-mechanism',
  name: 'Mechanism Kinematics',
  nameI18n: { 'zh-CN': '机构运动学', 'en-US': 'Mechanism Kinematics' },
  version: '1.0.0',
  author: 'Ergalics',
  description:
    'Planar mechanism studio: four-bar Grashof classification with exact circle-intersection position analysis, animated linkage + coupler curves and transmission-angle charts; Kennedy instant centers and coupler-point velocities cross-checked against numeric differentiation; disk-cam profile synthesis (SHM / cycloidal / 3-4-5 laws, pressure angle, undercut); gear-train ratios (simple, compound, 2K-H planetary via Willis equation with two driven members).',
  descriptionI18n: {
    'zh-CN':
      '平面机构工作室：四杆机构 Grashof 判别与圆交点精确位置分析、机构动画 + 连杆曲线与传动角图；Kennedy 瞬心与连杆点速度（与位置数值微分交叉验证）；盘形凸轮廓线综合（SHM/摆线/3-4-5 运动规律、压力角校核、根切筛查）；轮系传动比（定轴简单/复合轮系与 Willis 方程 2K-H 行星轮系双输入求解）。',
    'en-US':
      'Planar mechanism studio: four-bar Grashof classification with exact circle-intersection position analysis, animated linkage + coupler curves and transmission-angle charts; Kennedy instant centers and coupler-point velocities cross-checked against numeric differentiation; disk-cam profile synthesis (SHM / cycloidal / 3-4-5 laws, pressure angle, undercut); gear-train ratios (simple, compound, 2K-H planetary via Willis equation with two driven members).',
  },
  license: 'MIT',
  entry: 'example.eng-mechanism',
  category: 'scientific',
  sandbox: 'trusted',
  formats: [
    {
      extension: '.csv',
      mimeTypes: ['text/csv'],
      description: 'Four-bar link sets (a,b,c,d) for batch Grashof / transmission analysis',
    },
  ],
  research: {
    tier: 'research',
    units: { length: 'm', angle: 'deg', omega: 'rad/s', ratio: '-' },
    benchmarks: [
      'eng-mechanism-fourbar-closure',
      'eng-mechanism-coupler-velocity-vs-numeric',
      'eng-mechanism-cam-motion-laws',
      'eng-mechanism-cam-pressure-angle',
      'eng-mechanism-willis-planetary',
      'eng-mechanism-gear-compound-product',
    ],
    reproducible: true,
    notes:
      'All quantities are closed-form or deterministic bounded scans. Four-bar position: exact circle intersection of the coupler and rocker circles (closure residual ~1e-16, benchmarked < 1e-9 over full revolutions on both branches); angular velocities from the differentiated vector loop; coupler-point velocity validated against central differences of the position (< 1e-4 relative, typically ~1e-9); Kennedy I13 = line(O2,A) ∩ line(O4,B). Cam motion laws are analytic on tau ∈ [0,1] (SHM with continuous cosine acceleration; cycloidal and 3-4-5 with exactly zero end acceleration); pressure angle tan α = |ds/dθ − e|/(s + √(r0² − e²)); actual profile = pitch curve inset by the roller radius; undercut = convex pitch-curve radius of curvature < roller radius. Gears: fixed-train ratio = product of stage ratios (idler direction cancels); 2K-H planetary from the Willis equation ωs + ρ·ωr − (1+ρ)·ωH = 0 with ρ = zr/zs (ring fixed gives i = 1 + zr/zs), solved with two driven members for differential operation. Deterministic: no randomness anywhere.',
    notesI18n: {
      'zh-CN':
        '全部量为闭式解或确定性有界扫描。四杆机构位置：连杆圆与摇杆圆的精确圆交点（闭环残差 ~1e-16，两分支整周基准 < 1e-9）；角速度由矢量环路微分给出；连杆点速度与位置中心差分校核（相对误差 < 1e-4，典型 ~1e-9）；Kennedy 瞬心 I13 = 直线(O2,A) ∩ 直线(O4,B)。凸轮运动规律在 τ ∈ [0,1] 解析（SHM 加速度为连续余弦；摆线与 3-4-5 端点加速度恰为零）；压力角 tan α = |ds/dθ − e|/(s + √(r0² − e²))；实际廓线为理论廓线沿法线内缩滚子半径；根切判据为凸段理论廓线曲率半径 < 滚子半径。轮系：定轴传动比 = 各级传动比之积（惰轮方向抵消）；2K-H 行星轮系由 Willis 方程 ωs + ρ·ωr − (1+ρ)·ωH = 0 求解（ρ = zr/zs，齿圈固定时 i = 1 + zr/zs），并支持双主动件差动工况。全程确定性：不含任何随机量。',
      'en-US':
        'All quantities are closed-form or deterministic bounded scans. Four-bar position: exact circle intersection (closure residual ~1e-16, benchmarked < 1e-9 over full revolutions on both branches); velocities from the differentiated vector loop; coupler-point velocity validated against central differences (< 1e-4 relative); Kennedy I13 = line(O2,A) ∩ line(O4,B). Cam motion laws are analytic on tau ∈ [0,1] (SHM continuous cosine acceleration; cycloidal / 3-4-5 exactly zero end acceleration); pressure angle tan α = |ds/dθ − e|/(s + √(r0² − e²)); actual profile = pitch curve inset by the roller radius; undercut = convex pitch-curve radius of curvature < roller radius. Gears: fixed-train ratio = product of stage ratios; 2K-H planetary from the Willis equation with ρ = zr/zs (ring fixed gives i = 1 + zr/zs), solved with two driven members for differential operation. Deterministic: no randomness anywhere.',
    },
  },
};
