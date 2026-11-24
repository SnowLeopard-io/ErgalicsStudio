// ==========================================================================
// Ergalics Studio — Builtin Plugin Data Schema Registry (Phase 4 Rollout)
//
// Central pure-JSON mapping from builtin plugin IDs to their declarative
// `PluginDataSchemaSpec` (zero Zod import, zero bundle overhead, and zero
// tampering with ed25519-signed manifests).
//
// Precedence: `manifest.dataSchema` > `BUILTIN_PLUGIN_DATA_SCHEMAS[manifest.id]`.
// Plugins sharing a `preset` automatically gain cross-plugin compatibility
// detection and seamless dataset reuse across the workbench.
// ==========================================================================

import type { PluginDataSchemaSpec } from '@/types/dataSchema';

export const BUILTIN_PLUGIN_DATA_SCHEMAS: Readonly<
  Record<string, PluginDataSchemaSpec | PluginDataSchemaSpec[]>
> = {
  // ---- Charts (all 22 builtin charts covered; scatter/sankey/network also declare in manifest) ----
  'example.bar_chart': {
    preset: 'ergalics:tabular/category-value',
    overrides: {
      title: 'Bar Chart Table',
      titleI18n: { 'zh-CN': '柱状图分类数值表', 'en-US': 'Bar Chart Table' },
    },
  },
  'example.boxplot': { preset: 'ergalics:tabular/grouped-values' },
  'example.violin': { preset: 'ergalics:tabular/grouped-values' },
  'example.bubble': { preset: 'ergalics:tabular/bubble-xyz' },
  'example.errorband': { preset: 'ergalics:tabular/xy-error' },
  'example.histogram': {
    preset: 'ergalics:tabular/univariate',
    overrides: { minRows: 4 },
  },
  'example.qqplot': {
    preset: 'ergalics:tabular/univariate',
    overrides: { minRows: 4 },
  },
  'example.timeseries': { preset: 'ergalics:tabular/time-series' },
  'example.treemap': { preset: 'ergalics:tabular/label-size' },
  'example.parallel': { preset: 'ergalics:tabular/multi-numeric' },
  'example.polar': {
    preset: 'ergalics:tabular/multi-numeric',
    overrides: {
      title: 'Polar / Radar Dimensions',
      titleI18n: { 'zh-CN': '极坐标 / 雷达图维度表', 'en-US': 'Polar / Radar Table' },
      minRows: 3,
    },
  },
  'example.point-cloud': { preset: 'ergalics:tabular/xyz-points' },
  'example.point-cloud-3d': { preset: 'ergalics:tabular/xyz-points' },
  'example.heatmap': { preset: 'ergalics:json/grid-2d' },
  'example.contour': { preset: 'ergalics:json/grid-2d' },
  'example.surface-3d': { preset: 'ergalics:json/grid-2d' },
  'example.voxel-3d': { preset: 'ergalics:json/voxel-3d' },
  'example.image': { preset: 'ergalics:binary/image' },
  'example.model3d': { preset: 'ergalics:binary/model-3d' },

  // ---- Statistics (all 7 signed stats plugins) ----
  'example.stats-survival': { preset: 'ergalics:tabular/survival-table' },
  'example.stats-bayes': {
    preset: 'ergalics:tabular/univariate',
    overrides: {
      title: 'Bayesian Sample Table',
      titleI18n: { 'zh-CN': '贝叶斯推断样本表', 'en-US': 'Bayesian Sample Table' },
      minRows: 4,
      liveSync: false, // MCMC sampling is compute-intensive; apply manually
    },
  },
  'example.stats-doe': { preset: 'ergalics:tabular/doe-table' },
  'example.stats-meta': { preset: 'ergalics:tabular/meta-analysis' },
  'example.stats-multivariate': {
    preset: 'ergalics:tabular/multi-numeric',
    overrides: {
      title: 'Multivariate Observations',
      titleI18n: { 'zh-CN': '多元统计观测矩阵', 'en-US': 'Multivariate Observations' },
    },
  },
  'example.stats-nonparametric': { preset: 'ergalics:tabular/grouped-values' },
  'example.stats-timeseries': {
    preset: 'ergalics:tabular/time-series',
    overrides: {
      title: 'Time Series Observations',
      titleI18n: { 'zh-CN': '时间序列统计表', 'en-US': 'Time Series Table' },
      minRows: 6,
      sampleRows: [
        { time: 1, value: 102.4 },
        { time: 2, value: 105.1 },
        { time: 3, value: 103.8 },
        { time: 4, value: 109.2 },
        { time: 5, value: 111.5 },
        { time: 6, value: 114.0 },
        { time: 7, value: 112.9 },
        { time: 8, value: 118.4 },
      ],
    },
  },

  // ---- Astronomy ----
  'example.astro-transit': {
    preset: 'ergalics:tabular/xy-error',
    overrides: {
      title: 'Exoplanet Light Curve',
      titleI18n: { 'zh-CN': '凌星光变曲线 (time, flux, err)', 'en-US': 'Transit Light Curve' },
    },
  },
  'example.astro-hrdiagram': {
    preset: 'ergalics:tabular/xy-series',
    overrides: {
      title: 'HR Diagram Star Table',
      titleI18n: { 'zh-CN': '赫罗图恒星色-星等表', 'en-US': 'HR Diagram Star Table' },
    },
  },

  // ---- Biology & Medicine ----
  'example.bio-enzyme': {
    preset: 'ergalics:tabular/xy-series',
    overrides: {
      title: 'Enzyme Kinetics ([S], v₀)',
      titleI18n: { 'zh-CN': '酶动力学曲线 ([S], v₀)', 'en-US': 'Enzyme Kinetics ([S], v0)' },
    },
  },
  'example.bio-seqalign': { preset: 'ergalics:text/fasta' },
  'example.bio-pk': {
    preset: 'ergalics:tabular/xy-series',
    overrides: {
      title: 'Pharmacokinetics (time, conc)',
      titleI18n: { 'zh-CN': '药代动力学血药浓度表 (time, conc)', 'en-US': 'PK Concentration Series' },
    },
  },
  'example.bio-epidemic': {
    preset: 'ergalics:tabular/time-series',
    overrides: {
      title: 'Epidemic Case Series (day, cases)',
      titleI18n: { 'zh-CN': '流行病病例时序表 (day, cases)', 'en-US': 'Epidemic Case Series' },
    },
  },
  'example.med-ecg': {
    preset: 'ergalics:tabular/time-series',
    overrides: {
      title: 'ECG Waveform Series',
      titleI18n: { 'zh-CN': '心电波形时序表 (time, mV)', 'en-US': 'ECG Waveform Series' },
    },
  },
  'example.med-biostat': { preset: 'ergalics:tabular/grouped-values' },

  // ---- Chemistry & Materials ----
  'example.chem-reaction-order': {
    preset: 'ergalics:tabular/xy-series',
    overrides: {
      title: 'Reaction Kinetics (t, c)',
      titleI18n: { 'zh-CN': '反应级数浓度-时间表 (t, c)', 'en-US': 'Reaction Kinetics (t, c)' },
    },
  },
  'example.mats-mech': {
    preset: 'ergalics:tabular/xy-series',
    overrides: {
      title: 'Stress-Strain Curve',
      titleI18n: { 'zh-CN': '应力-应变曲线 (strain, stress)', 'en-US': 'Stress-Strain Curve' },
    },
  },
  'example.mats-thermal': {
    preset: 'ergalics:tabular/xy-series',
    overrides: {
      title: 'Thermal Analysis Curve',
      titleI18n: { 'zh-CN': '热分析曲线 (temperature, signal)', 'en-US': 'Thermal Analysis Curve' },
    },
  },
  'example.mats-xrd': {
    preset: 'ergalics:tabular/xy-series',
    overrides: {
      title: 'XRD Diffraction Pattern (2θ, I)',
      titleI18n: { 'zh-CN': 'X 射线衍射谱 (2θ, I)', 'en-US': 'XRD Pattern (2theta, I)' },
      extensions: ['.xy', '.xye', '.csv', '.dat', '.txt'],
    },
  },

  // ---- Geography & Environment ----
  'example.geomap': { preset: 'ergalics:json/geojson' },
  'example.geo-globe': { preset: 'ergalics:json/geojson' },
  'example.geo-tissot': { preset: 'ergalics:json/geojson' },
  'example.geo-gpx': { preset: 'ergalics:text/gpx' },
  'example.geo-interp': { preset: 'ergalics:tabular/geo-points' },
  'example.geo-measure': { preset: 'ergalics:tabular/geo-points' },
  'example.geo-hydrogeology': {
    preset: 'ergalics:tabular/xy-series',
    overrides: {
      title: 'Pumping Test (time, drawdown)',
      titleI18n: { 'zh-CN': '抽水试验数据 (时间, 降深)', 'en-US': 'Pumping Test Data' },
    },
  },
  'example.geo-hydrology': {
    preset: 'ergalics:tabular/time-series',
    overrides: {
      title: 'Hyetograph Rainfall Series',
      titleI18n: { 'zh-CN': '降雨过程线 (time_h, rain_mm)', 'en-US': 'Rainfall Hyetograph' },
    },
  },
  'example.geo-soilwater': {
    preset: 'ergalics:tabular/xy-series',
    overrides: {
      title: 'Soil Water Retention (h, theta)',
      titleI18n: { 'zh-CN': '土壤水分特征曲线 (吸力, 含水率)', 'en-US': 'Soil Water Retention' },
    },
  },
  'example.env-predator-prey': {
    preset: 'ergalics:tabular/multi-numeric',
    overrides: {
      title: 'Predator-Prey Population Series',
      titleI18n: { 'zh-CN': '捕食者-猎物种群时序表', 'en-US': 'Predator-Prey Series' },
    },
  },

  // ---- Physics, Engineering, Psychology, Sociology, Data ----
  'example.physics-trajectory': {
    preset: 'ergalics:tabular/xyz-points',
    overrides: {
      title: 'Trajectory Coordinates (t, x, y)',
      titleI18n: { 'zh-CN': '运动轨迹表 (t, x, y)', 'en-US': 'Trajectory Table (t, x, y)' },
    },
  },
  'example.fluid3d': { preset: 'ergalics:binary/model-3d' },
  'example.data-imageproc': { preset: 'ergalics:binary/image' },
  'example.eng-vibration': {
    preset: 'ergalics:tabular/time-series',
    overrides: {
      title: 'Vibration Acceleration Series',
      titleI18n: { 'zh-CN': '振动加速度时序表', 'en-US': 'Vibration Signal Series' },
    },
  },
  'example.eng-heat': {
    preset: 'ergalics:tabular/xy-series',
    overrides: {
      title: 'Heat Transfer Profile',
      titleI18n: { 'zh-CN': '传热温度分布表', 'en-US': 'Heat Transfer Profile' },
    },
  },
  'example.psych-rt': {
    preset: 'ergalics:tabular/grouped-values',
    overrides: {
      title: 'Reaction Time Trials (condition, rt)',
      titleI18n: { 'zh-CN': '反应时试次表 (condition, rt)', 'en-US': 'Reaction Time Trials' },
    },
  },
  'example.socio-sna': [
    { preset: 'ergalics:tabular/edge-list' },
    { preset: 'ergalics:json/node-link-graph' },
  ],
  'example.socio-opinion': [
    { preset: 'ergalics:tabular/edge-list' },
    { preset: 'ergalics:json/node-link-graph' },
  ],
  'example.socio-inequality': {
    preset: 'ergalics:tabular/univariate',
    overrides: {
      title: 'Income Distribution Sample',
      titleI18n: { 'zh-CN': '收入分布样本表', 'en-US': 'Income Distribution Sample' },
      minRows: 4,
    },
  },
  'example.socio-popforecast': {
    preset: 'ergalics:tabular/xy-series',
    overrides: {
      title: 'Age-Population Table',
      titleI18n: { 'zh-CN': '年龄-人口分布表', 'en-US': 'Age-Population Table' },
    },
  },
  'example.stats-zipf': {
    preset: 'ergalics:tabular/category-value',
    overrides: {
      title: 'Word Frequency Table',
      titleI18n: { 'zh-CN': '词频统计表 (word, count)', 'en-US': 'Word Frequency Table' },
    },
  },
};
