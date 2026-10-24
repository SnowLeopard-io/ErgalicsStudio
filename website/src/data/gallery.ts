import type { ChartType } from './gallery-types';

export type ReproStatus = 'ok' | 'partial' | 'none';

export interface GalleryItem {
  id: string;
  title: { zh: string; en: string };
  summary: { zh: string; en: string };
  /** Subject tag, e.g. physics / biology / astronomy / engineering. */
  subject: string;
  chartType: ChartType;
  author: string;
  /** Workstation route that reproduces this analysis (HashRouter path). */
  studioRoute: string;
  /** Template id to load when opened from the gallery. */
  template?: string;
  repro: ReproStatus;
  /** Deterministic seed for the generated cover art. */
  seed: number;
  tools: string[];
  updatedAt: string;
}

export const SUBJECTS = [
  'physics', 'biology', 'astronomy', 'engineering',
  'chemistry', 'geoscience', 'medicine', 'mathematics',
] as const;

export const CHART_TYPES = [
  'scatter', 'line', 'histogram', 'heatmap', 'contour',
  'boxplot', 'surface', 'pointcloud', 'sankey', 'qq',
] as const;

export const GALLERY: GalleryItem[] = [
  {
    id: 'pendulum-chaos',
    title: { zh: '双摆混沌：初值敏感性图谱', en: 'Double Pendulum: Sensitivity to Initial Conditions' },
    summary: {
      zh: '对 200 组微小扰动的初值做并行积分，用李雅普诺夫指数量化轨道发散速率。',
      en: '200 perturbed initial conditions integrated in parallel; Lyapunov exponents quantify how fast the orbits diverge.',
    },
    subject: 'physics', chartType: 'line', author: 'L. Wang',
    studioRoute: '/studio/uncertainty', template: 'physics-error', repro: 'ok', seed: 11,
    tools: ['uncertainty', 'signal'], updatedAt: '2026-08-30',
  },
  {
    id: 'two-sample-t',
    title: { zh: '两样本 t 检验：酶活比较', en: 'Two-Sample t-Test: Enzyme Activity' },
    summary: {
      zh: '对照组与处理组的酶活差异检验，附效应量与置信区间，一键生成 APA 表述。',
      en: 'Enzyme activity across control and treatment, with effect size, confidence interval and a one-click APA sentence.',
    },
    subject: 'biology', chartType: 'boxplot', author: 'M. Chen',
    studioRoute: '/studio/analysis', template: 'bio-stats', repro: 'ok', seed: 23,
    tools: ['analysis', 'report'], updatedAt: '2026-09-02',
  },
  {
    id: 'fits-spectrum',
    title: { zh: 'FITS 光谱提取与拟合', en: 'FITS Spectrum Extraction & Fitting' },
    summary: {
      zh: '从 FITS 数据立方体提取一维光谱，多峰高斯拟合并评估参数不确定性。',
      en: 'Extract a 1-D spectrum from a FITS cube, fit multiple Gaussians and assess parameter uncertainty.',
    },
    subject: 'astronomy', chartType: 'line', author: 'R. Iyer',
    studioRoute: '/studio/model-lab', template: 'astro-fits', repro: 'partial', seed: 37,
    tools: ['io', 'model-lab'], updatedAt: '2026-08-21',
  },
  {
    id: 'vibration-fft',
    title: { zh: '结构振动信号的 PSD 分析', en: 'Power Spectral Density of Structural Vibration' },
    summary: {
      zh: '加速度计采样信号的 Welch PSD 估计，识别固有频率并做带通滤波复测。',
      en: 'Welch PSD of accelerometer data to locate natural frequencies, then a band-pass re-measurement.',
    },
    subject: 'engineering', chartType: 'line', author: 'K. Sato',
    studioRoute: '/studio/signal', template: 'eng-signal', repro: 'ok', seed: 41,
    tools: ['signal', 'sweeps'], updatedAt: '2026-09-05',
  },
  {
    id: 'reaction-kinetics',
    title: { zh: '反应动力学的参数扫描', en: 'Parameter Sweeps for Reaction Kinetics' },
    summary: {
      zh: '拉丁超立方采样速率常数，网格化评估转化率响应面并输出等高线图。',
      en: 'Latin-hypercube sampling of rate constants, a grid of conversion response surfaces and contour output.',
    },
    subject: 'chemistry', chartType: 'contour', author: 'A. Duarte',
    studioRoute: '/studio/sweeps', template: 'chem-kinetics', repro: 'ok', seed: 53,
    tools: ['sweeps', 'figures'], updatedAt: '2026-08-27',
  },
  {
    id: 'terrain-hdf5',
    title: { zh: 'HDF5 地形点云降采样', en: 'Downsampling an HDF5 Terrain Point Cloud' },
    summary: {
      zh: '读取 1200 万点地形数据，分块流式聚合到 10 米网格并渲染体素高程。',
      en: 'A 12M-point terrain read through chunked streaming aggregation onto a 10 m grid with voxel elevation.',
    },
    subject: 'geoscience', chartType: 'pointcloud', author: 'T. Novak',
    studioRoute: '/studio/profiler', template: 'geo-hdf5', repro: 'partial', seed: 61,
    tools: ['io', 'profiler'], updatedAt: '2026-08-18',
  },
  {
    id: 'survival-bayes',
    title: { zh: '贝叶斯生存模型诊断', en: 'Bayesian Survival Model Diagnostics' },
    summary: {
      zh: 'NUTS 采样拟合 Weibull 生存模型，报告 R-hat、ESS 与后验预测检查。',
      en: 'NUTS fit of a Weibull survival model with R-hat, ESS and posterior predictive checks.',
    },
    subject: 'medicine', chartType: 'line', author: 'S. Ahmed',
    studioRoute: '/studio/inference', template: 'med-bayes', repro: 'ok', seed: 71,
    tools: ['inference', 'runs'], updatedAt: '2026-09-08',
  },
  {
    id: 'copula-qq',
    title: { zh: '尾部依赖的 QQ 诊断', en: 'Tail Dependence via QQ Diagnostics' },
    summary: {
      zh: '对金融收益序列做 Copula 拟合，用 QQ 图与极值指数评估尾部相依结构。',
      en: 'Copula fits on return series with QQ plots and extremal indices for tail dependence.',
    },
    subject: 'mathematics', chartType: 'qq', author: 'J. Park',
    studioRoute: '/studio/analysis', template: 'math-qq', repro: 'none', seed: 83,
    tools: ['stats', 'figures'], updatedAt: '2026-08-12',
  },
  {
    id: 'heat-surface',
    title: { zh: '稳态热传导三维曲面', en: 'Steady-State Heat Conduction Surface' },
    summary: {
      zh: '有限差分解二维热方程，输出温度分布曲面与沿截面的误差带。',
      en: 'Finite-difference solution of the 2-D heat equation, rendered as a surface with an error band along a section.',
    },
    subject: 'engineering', chartType: 'surface', author: 'E. Rossi',
    studioRoute: '/studio/figures', template: 'eng-heat', repro: 'ok', seed: 97,
    tools: ['sweeps', 'figures'], updatedAt: '2026-09-10',
  },
  {
    id: 'microbiome-sankey',
    title: { zh: '微生物组分类流向图', en: 'Microbiome Taxonomy Flow (Sankey)' },
    summary: {
      zh: '门→纲→属三级的丰度流向桑基图，附按样本的多样性箱线比较。',
      en: 'A phylum→class→genus abundance Sankey with per-sample diversity boxplots.',
    },
    subject: 'biology', chartType: 'sankey', author: 'N. Okafor',
    studioRoute: '/studio/figures', template: 'bio-sankey', repro: 'partial', seed: 103,
    tools: ['io', 'figures'], updatedAt: '2026-08-24',
  },
  {
    id: 'parquet-timeseries',
    title: { zh: 'Parquet 时序的 SQL 聚合', en: 'SQL Aggregation over Parquet Time Series' },
    summary: {
      zh: 'DuckDB-WASM 直接查询 300MB Parquet 观测档案，按小时聚合后写入血缘。',
      en: 'DuckDB-WASM queries a 300 MB Parquet observation archive directly, aggregated hourly and recorded in lineage.',
    },
    subject: 'astronomy', chartType: 'heatmap', author: 'F. Bauer',
    studioRoute: '/studio/sql', template: 'astro-sql', repro: 'ok', seed: 113,
    tools: ['sql', 'lineage'], updatedAt: '2026-09-01',
  },
  {
    id: 'dose-response',
    title: { zh: '剂量–响应四参数拟合', en: 'Four-Parameter Dose–Response Fit' },
    summary: {
      zh: '对数-逻辑四参数曲线拟合，报告 IC50 及其 bootstrap 置信区间。',
      en: 'Log-logistic 4-parameter fit reporting IC50 with a bootstrap confidence interval.',
    },
    subject: 'medicine', chartType: 'scatter', author: 'H. Kim',
    studioRoute: '/studio/model-lab', template: 'med-dose', repro: 'ok', seed: 127,
    tools: ['model-lab', 'uncertainty'], updatedAt: '2026-09-11',
  },
];
