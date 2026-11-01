// ==========================================================================
// eng-kin — mechanism kinematics laboratory — manifest
//
// Planar four-bar linkage kinematics (closed-form circle-intersection
// assembly in both branches, Grashof classification, analytic vector-loop
// velocities/accelerations, coupler curves, Kennedy instant centers), disk-cam
// profile design (motion-law library, theoretical/actual profiles, pressure
// angles, undercut screening), gear-train ratios (fixed-axis series trains and
// the 2K-H planetary via the Willis equation, involute contact ratio) and
// datafied velocity/acceleration polygons. Documented in tests/eng-kin.test.ts.
// ==========================================================================

import type { PluginManifest } from '@/types/plugin';

export const engKinematicsManifest: PluginManifest = {
  id: 'example.eng-kin',
  name: 'Mechanism Kinematics Lab',
  nameI18n: { 'zh-CN': '机构运动学实验室', 'en-US': 'Mechanism Kinematics Lab' },
  version: '1.0.0',
  author: 'Ergalics',
  description:
    'Planar mechanism kinematics: four-bar closed-loop assembly (both branches) with Grashof classification, coupler curves, vector-loop velocities/accelerations and Kennedy instant centers; disk-cam profile design with motion-law library, pressure angles and undercut screening; gear-train ratios (fixed-axis + Willis planetary) with involute contact ratio; velocity/acceleration polygons.',
  descriptionI18n: {
    'zh-CN':
      '平面机构运动学：四杆机构闭环解析装配（开式/交叉分支）与 Grashof 判别、连杆曲线、矢量法速度/加速度、瞬心 I13；凸轮轮廓设计（运动规律库、理论/实际廓线、压力角与根切校核）；轮系传动比（定轴 + Willis 行星轮系）与渐开线重合度 εα；速度/加速度多边形图解法数据化。',
    'en-US':
      'Planar mechanism kinematics: four-bar closed-loop assembly (both branches) with Grashof classification, coupler curves, vector-loop velocities/accelerations and Kennedy instant centers; disk-cam profile design with motion-law library, pressure angles and undercut screening; gear-train ratios (fixed-axis + Willis planetary) with involute contact ratio; velocity/acceleration polygons.',
  },
  license: 'MIT',
  entry: 'example.eng-kin',
  category: 'scientific',
  sandbox: 'trusted',
  formats: [
    {
      extension: '.csv',
      mimeTypes: ['text/csv'],
      description: 'Four-bar link sets (r1,r2,r3,r4) for batch Grashof / swing-angle analysis',
    },
  ],
  research: {
    tier: 'research',
    units: { length: 'm', angle: 'deg', omega: 'rad/s', ratio: '-' },
    benchmarks: [
      'eng-kin-grashof-classification',
      'eng-kin-fourbar-closure',
      'eng-kin-cam-motion-laws',
      'eng-kin-cam-pressure-angle',
      'eng-kin-gear-willis-planetary',
      'eng-kin-gear-contact-ratio',
    ],
    reproducible: true,
    notes:
      'All quantities are closed-form: four-bar assembly by circle intersection (position residual ~1e-15, benchmarked < 1e-9), angular velocities/accelerations from the differentiated vector-loop (cross-checked against numerical differentiation of the closure), Kennedy I13 = line(O2,A) ∩ line(O4,B). Cam motion laws are analytic on τ ∈ [0,1] (SHM, cycloidal, 3-4-5 polynomial, modified trapezoid with exact piecewise integration); pressure angle tan α = |s′ − e|/(s + √(r0² − e²)); actual profile = pitch curve inset by the roller radius. Gears: fixed-train ratio by the product rule (idler direction cancels), 2K-H planetary by the Willis equation ωs + ρωr − (1+ρ)ωH = 0 (e.g. zs=20, zp=30 → ring fixed gives i = 5), contact ratio εα from the standard involute formula. Deterministic: no randomness anywhere.',
    notesI18n: {
      'zh-CN':
        '全部闭式求解：四杆机构按圆交点解析装配（位置残差 ~1e-15，基准 < 1e-9），角速度/角加速度由矢量环路微分给出（并与闭环数值微分交叉验证），瞬心 I13 = 直线(O2,A) ∩ 直线(O4,B)。凸轮运动规律在 τ ∈ [0,1] 上解析（简谐、摆线、3-4-5 多项式、修正梯形精确分段积分）；压力角 tan α = |s′ − e|/(s + √(r0² − e²))；实际廓线为理论廓线沿法线内缩滚子半径。轮系：定轴按乘积法则（惰轮方向相互抵消），2K-H 行星轮系由 Willis 方程 ωs + ρωr − (1+ρ)ωH = 0 求解（如 zs=20、zp=30、太阳轮输入/齿圈固定时 i = 5），重合度 εα 用标准渐开线公式。全程确定性：不含任何随机量。',
      'en-US':
        'All quantities are closed-form: four-bar assembly by circle intersection (position residual ~1e-15, benchmarked < 1e-9), angular velocities/accelerations from the differentiated vector-loop (cross-checked against numerical differentiation), Kennedy I13 = line(O2,A) ∩ line(O4,B). Cam motion laws are analytic on τ ∈ [0,1] (SHM, cycloidal, 3-4-5, modified trapezoid with exact piecewise integration); pressure angle tan α = |s′ − e|/(s + √(r0² − e²)); actual profile = pitch curve inset by the roller radius. Gears: fixed-train ratio by the product rule (idler direction cancels), 2K-H planetary by the Willis equation (e.g. zs=20, zp=30, ring fixed → i = 5), contact ratio εα from the standard involute formula. Deterministic: no randomness anywhere.',
    },
  },
};
