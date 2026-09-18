// ==========================================================================
// FR-01 — Subject template catalog (pure TS, no store / React imports)
//
// Turns the old "feature demo" samples into discipline-scenario templates:
// each one starts from a real research question, ships a deterministic
// example dataset (see ./data.ts) and a 3–6 step guided tour that explains
// what the project analyses and what every step computes.
//
// Bilingual rule: template content (titles, descriptions, guide steps) is
// embedded here as { zh, en } pairs — it does NOT go through the global
// i18n dictionaries. Only the surrounding UI chrome uses `tpl.` keys.
//
// Template ids are aligned with the marketing-site gallery
// (website/src/data/gallery.ts `template` fields) so "Open in Studio"
// deep links resolve to a real template.
// ==========================================================================

import type { FileEntry, Project } from '@/types/project';
import { createEmptyProject } from '@/types/project';
import {
  doseResponseCsv,
  enzymeCsv,
  freefallCsv,
  heatFieldJson,
  kineticsCsv,
  lightcurveCsv,
  microbiomeCsv,
  returnsCsv,
  survivalCsv,
  spectrumCsv,
  terrainCsv,
  vibrationCsv,
} from './data';

export type TemplateSubject =
  | 'physics'
  | 'biology'
  | 'astronomy'
  | 'engineering'
  | 'chemistry'
  | 'geoscience'
  | 'medicine'
  | 'mathematics';

export type TemplateDifficulty = 'beginner' | 'intermediate' | 'advanced';

export interface LocalizedText {
  zh: string;
  en: string;
}

/** One guided-tour step: what this stage of the analysis computes. */
export interface TemplateStep {
  title: LocalizedText;
  body: LocalizedText;
  /** Optional tool route ('/studio/<id>' or '/workbench') this step points at. */
  toolRoute?: string;
}

export interface SubjectTemplate {
  /** Stable id — matches the website gallery `template` field. */
  id: string;
  subject: TemplateSubject;
  difficulty: TemplateDifficulty;
  /** Estimated time to first result, minutes. */
  minutes: number;
  /** RESEARCH_TOOLS ids the template walks the user through. */
  tools: string[];
  title: LocalizedText;
  /** One-line card description. */
  summary: LocalizedText;
  /** The research question the template answers (tour step 0 framing). */
  question: LocalizedText;
  /** 3–6 guided steps, loaded with the project. */
  steps: TemplateStep[];
  /** Fresh, fully valid Project with embedded example data. Deterministic data. */
  buildProject(): Project;
}

// ---- helpers ---------------------------------------------------------------

/** Wrap generated text into a project FileEntry. */
function fileFromText(name: string, content: string, mimeType: string): FileEntry {
  const dot = name.lastIndexOf('.');
  return {
    id: `${name.replace(/[^\w.-]/g, '_')}-${Math.abs(hashCode(content)).toString(16)}`,
    name,
    size: content.length,
    mimeType,
    format: dot < 0 ? 'txt' : name.slice(dot + 1).toLowerCase(),
    content,
  };
}

/** FNV-1a-ish 32-bit string hash (stable across runs, no crypto needed). */
function hashCode(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h | 0;
}

/**
 * Assemble a template project. Locale-free by design: the display name uses
 * the English title so a template loaded in one language stays readable when
 * the UI language later switches (the project name is user-editable anyway).
 */
function makeProject(
  tpl: Omit<SubjectTemplate, 'buildProject'>,
  files: FileEntry[],
): Project {
  const project = createEmptyProject(tpl.title.en);
  project.data.files = files;
  project.metadata.description = tpl.summary.en;
  project.metadata.tags = ['template', tpl.subject, tpl.difficulty];
  return project;
}

const step = (
  zhT: string,
  enT: string,
  zhB: string,
  enB: string,
  toolRoute?: string,
): TemplateStep => ({
  title: { zh: zhT, en: enT },
  body: { zh: zhB, en: enB },
  ...(toolRoute ? { toolRoute } : {}),
});

// ---- template definitions ---------------------------------------------------

const physicsError: SubjectTemplate = {
  id: 'physics-error',
  subject: 'physics',
  difficulty: 'beginner',
  minutes: 8,
  tools: ['uncertainty', 'analysis'],
  title: { zh: '自由落体测重力加速度', en: 'Free-Fall Measurement of g' },
  summary: {
    zh: '从 24 组落体计时数据出发，用误差传播评估 g 的测量不确定度。',
    en: 'Estimate g from 24 drop-timing trials and propagate the measurement uncertainty.',
  },
  question: {
    zh: '实验室问题：仅凭秒表与米尺，我们能否在 ±1% 内测出重力加速度 g？',
    en: 'Lab question: with only a stopwatch and a meter stick, can we measure g within ±1%?',
  },
  steps: [
    step(
      '这个项目在算什么',
      'What this project computes',
      'freefall-timing.csv 记录 24 次自由落体的计时。公式 g = 2h/t² 把每次下落换算成一个 g 值；数据带秒表反应误差，我们要合并 24 次测量并给出置信区间。',
      'freefall-timing.csv logs 24 timed drops. The free-fall law g = 2h/t² turns every drop into an estimate of g; the data carries stopwatch reaction error, so we combine 24 trials and report a confidence interval.',
      '/workbench',
    ),
    step(
      '第 1 步 · 查看测量数据',
      'Step 1 · Inspect the measurements',
      'freefall-timing.csv 每行一次实验：trial 序号、height_m 下落高度、time_s 下落时间。先在分析工具里画出 t 与 h 的关系，确认符合抛物线规律。',
      'freefall-timing.csv holds one row per trial: trial index, drop height (m) and fall time (s). Plot time against height in the analysis tool and confirm the parabolic trend.',
      '/studio/analysis',
    ),
    step(
      '第 2 步 · 逐次计算 g 并合并',
      'Step 2 · Compute and combine g',
      '对每次测量算 gᵢ = 2hᵢ/tᵢ²，取平均得到 ḡ；平均值的实验标准差（标准不确定度 A 类）刻画随机误差。',
      'Compute gᵢ = 2hᵢ/tᵢ² per trial, average them for ḡ; the standard deviation of the mean is the Type-A standard uncertainty.',
      '/studio/analysis',
    ),
    step(
      '第 3 步 · 误差传播与结论',
      'Step 3 · Propagate and conclude',
      '在不确定度实验室用蒙特卡洛/误差传播合成计时与尺读误差，输出 g = …±… m/s² 并判断是否落入 9.78–9.83 的物理区间。',
      'In the uncertainty lab, combine timing and length errors via propagation / Monte-Carlo, report g = …±… m/s² and check it covers the physical range 9.78–9.83.',
      '/studio/uncertainty',
    ),
  ],
  buildProject: () =>
    makeProject(physicsError, [fileFromText('freefall-timing.csv', freefallCsv(), 'text/csv')]),
};

const bioStats: SubjectTemplate = {
  id: 'bio-stats',
  subject: 'biology',
  difficulty: 'beginner',
  minutes: 10,
  tools: ['analysis', 'report'],
  title: { zh: '两样本 t 检验：酶活比较', en: 'Two-Sample t-Test: Enzyme Activity' },
  summary: {
    zh: '对照组与处理组各 30 个酶活样本，检验抑制剂是否显著降低活性。',
    en: '30 enzyme assays per group — test whether the inhibitor significantly lowers activity.',
  },
  question: {
    zh: '生物学问题：新型抑制剂处理 24h 后，细胞裂解液的酶活是否显著低于对照组？',
    en: 'Bio question: after 24 h of inhibitor treatment, is lysate enzyme activity significantly below control?',
  },
  steps: [
    step(
      '这个项目在算什么',
      'What this project computes',
      'enzyme-activity.csv 记录 control / treatment 两组各 30 个酶活样本。先可视化（箱线图），再做两样本 t 检验，报告 p 值、效应量（Cohen d）与均值差的置信区间。',
      'enzyme-activity.csv holds 30 enzyme assays per group (control vs treatment). Visualise with box plots, run a two-sample t-test, and report the p-value, effect size (Cohen d) and CI of the mean difference.',
      '/workbench',
    ),
    step(
      '第 1 步 · 分组与可视化',
      'Step 1 · Group and plot',
      'enzyme-activity.csv 的 group 列标记对照/处理。按 group 分组画箱线图，检查中位数差与离群点——t 检验前先看数据形状。',
      'The group column in enzyme-activity.csv labels control/treatment. Draw grouped box plots and inspect the median gap and outliers — look before you test.',
      '/studio/analysis',
    ),
    step(
      '第 2 步 · 执行 t 检验',
      'Step 2 · Run the t-test',
      '在分析工具对 activity_U_per_mL 按 group 做 Welch t 检验（不假设方差相等），读出 t 统计量与双尾 p 值。',
      'Run a Welch t-test (unequal variances) on activity_U_per_mL grouped by sample, and read off the t statistic and two-sided p-value.',
      '/studio/analysis',
    ),
    step(
      '第 3 步 · 效应量与报告',
      'Step 3 · Effect size and report',
      'p 值只说“有无差异”，Cohen d 才说“差多少”。把检验结果 + 箱线图交给报告工具，生成一句 APA 格式的结论。',
      'A p-value says whether groups differ; Cohen d says by how much. Hand the test and the box plot to the report builder for one APA-style sentence.',
      '/studio/report',
    ),
  ],
  buildProject: () =>
    makeProject(bioStats, [fileFromText('enzyme-activity.csv', enzymeCsv(), 'text/csv')]),
};

const astroFits: SubjectTemplate = {
  id: 'astro-fits',
  subject: 'astronomy',
  difficulty: 'intermediate',
  minutes: 15,
  tools: ['model-lab', 'figures'],
  title: { zh: '光谱发射线的高斯拟合', en: 'Gaussian Fits to Emission Lines' },
  summary: {
    zh: '从提取好的 300 点光谱中拟合三条发射线，量化线心波长与流量误差。',
    en: 'Fit three emission lines in a 300-point extracted spectrum; quantify centroids and flux errors.',
  },
  question: {
    zh: '天文问题：这段光谱里的 [O III] 5007 线心偏移了多少？红移对应的退行速度是多少？',
    en: 'Astro question: how far is the [O III] 5007 line centroid shifted, and what recession velocity does that redshift imply?',
  },
  steps: [
    step(
      '这个项目在算什么',
      'What this project computes',
      'spectrum.csv 是从数据立方体提取的一维光谱（波长/流量/误差）。对 Hβ、[O III] 4959、[O III] 5007 三条线各拟合一个高斯，得到线心、强度、宽度，再由 5007 的偏移算红移。',
      'spectrum.csv is the 1-D spectrum extracted from the cube (wavelength/flux/error). Fit one gaussian per line — Hβ, [O III] 4959, [O III] 5007 — then derive the redshift from the 5007 centroid shift.',
      '/workbench',
    ),
    step(
      '第 1 步 · 观察谱线',
      'Step 1 · Look at the spectrum',
      '先画 flux–wavelength 曲线：连续谱近似线性抬升，三个尖峰就是要拟合的目标。误差列 flux_err 决定后续拟合的权重。',
      'Plot flux vs wavelength: a nearly linear continuum with three spikes to fit. The flux_err column will weight the fit.',
      '/studio/model-lab',
    ),
    step(
      '第 2 步 · 多峰高斯拟合',
      'Step 2 · Fit the multi-gaussian model',
      '在模型实验室用「连续谱 + 3 高斯」模型拟合 4800–5050 Å 区间；加权最小二乘让误差大的点贡献更小。',
      'In the model lab, fit continuum + 3 gaussians over 4800–5050 Å; weighted least squares down-weights noisy points.',
      '/studio/model-lab',
    ),
    step(
      '第 3 步 · 红移与不确定度',
      'Step 3 · Redshift and uncertainty',
      'z = (λ_obs − 5006.84)/5006.84，v ≈ c·z。用拟合协方差给出 z 的误差棒，判断红移是否显著非零。',
      'z = (λ_obs − 5006.84)/5006.84, v ≈ c·z. Use the fit covariance for the error bar on z and decide whether the redshift is significantly non-zero.',
      '/studio/model-lab',
    ),
    step(
      '第 4 步 · 出版级图',
      'Step 4 · Publication figure',
      '把数据点、拟合曲线与残差面板排进图版（Figure Studio），标注三条线的拟合参数表。',
      'Lay data, fit and a residual panel into a Figure Studio sheet, annotated with the fitted line parameters.',
      '/studio/figures',
    ),
  ],
  buildProject: () =>
    makeProject(astroFits, [fileFromText('spectrum.csv', spectrumCsv(), 'text/csv')]),
};

const engSignal: SubjectTemplate = {
  id: 'eng-signal',
  subject: 'engineering',
  difficulty: 'intermediate',
  minutes: 12,
  tools: ['signal', 'sweeps'],
  title: { zh: '振动信号的 PSD 与带通滤波', en: 'Vibration PSD and Band-Pass Filtering' },
  summary: {
    zh: '对加速度计信号做 Welch 功率谱估计，定位固有频率后带通滤波复测。',
    en: 'Welch PSD of an accelerometer trace to locate natural frequencies, then band-pass re-measure.',
  },
  question: {
    zh: '工程问题：这台结构的固有频率到底在 49 Hz 还是 52 Hz？噪声里如何把它挑出来？',
    en: 'Eng question: is the structure’s natural frequency at 49 Hz or 52 Hz? How do we pull it out of the noise?',
  },
  steps: [
    step(
      '这个项目在算什么',
      'What this project computes',
      'vibration-accel.csv 是 2048 Hz 采样、1024 点的衰减振动信号。用 Welch 法估计功率谱密度找到固有频率，再用带通滤波分离两个振动模态。',
      'vibration-accel.csv is a 1024-point damped vibration record sampled at 2048 Hz. Estimate the PSD with Welch’s method to find the natural frequency, then band-pass to separate the two modes.',
      '/workbench',
    ),
    step(
      '第 1 步 · 看时域波形',
      'Step 1 · Watch the time domain',
      '信号实验室里先看原始波形：快衰减的主振铃 + 慢衰减的次振动混在一起，肉眼分不清频率成分。',
      'Open the signal lab and view the raw trace: a fast-decaying main ring-down mixed with a slower secondary mode — indistinguishable by eye.',
      '/studio/signal',
    ),
    step(
      '第 2 步 · Welch PSD 估计',
      'Step 2 · Welch PSD estimate',
      '把信号分窗做 FFT 再平均，得到噪声底下的两个谱峰：≈49 Hz 与 ≈123 Hz，即一阶与二阶固有频率。',
      'Window the signal, FFT each segment and average: two peaks at ≈49 Hz and ≈123 Hz emerge from the noise floor — the first and second natural frequencies.',
      '/studio/signal',
    ),
    step(
      '第 3 步 · 带通滤波复测',
      'Step 3 · Band-pass and re-measure',
      '对 49 Hz 分量做带通滤波，从滤波结果拟合衰减包络，得到阻尼比 ζ；再用参数扫描看窗长/重叠率对谱分辨率的影响。',
      'Band-pass the 49 Hz component, fit its decay envelope for the damping ratio ζ; then sweep window length / overlap to see how spectral resolution changes.',
      '/studio/sweeps',
    ),
  ],
  buildProject: () =>
    makeProject(engSignal, [fileFromText('vibration-accel.csv', vibrationCsv(), 'text/csv')]),
};

const chemKinetics: SubjectTemplate = {
  id: 'chem-kinetics',
  subject: 'chemistry',
  difficulty: 'intermediate',
  minutes: 14,
  tools: ['sweeps', 'figures'],
  title: { zh: '阿伦尼乌斯动力学参数扫描', en: 'Arrhenius Kinetics Parameter Sweep' },
  summary: {
    zh: '从变温浓度衰减曲线估计活化能，再扫描温度–时间转化率响应面。',
    en: 'Estimate the activation energy from temperature-programmed decay, then sweep the conversion response surface.',
  },
  question: {
    zh: '化学问题：这个一级反应的活化能有多大？反应器和工艺温度该怎么选？',
    en: 'Chem question: how large is this first-order reaction’s activation energy, and what process temperature should the reactor run at?',
  },
  steps: [
    step(
      '这个项目在算什么',
      'What this project computes',
      'kinetics-tpd.csv 记录程序升温下一阶反应物浓度 c(t)。用 k(T)=A·exp(−Ea/RT) 拟合速率常数，得到活化能 Ea，再扫描温度与停留时间求转化率响应面。',
      'kinetics-tpd.csv tracks first-order reactant concentration under a temperature ramp. Fit k(T) = A·exp(−Ea/RT) for the activation energy, then sweep temperature and residence time for a conversion surface.',
      '/workbench',
    ),
    step(
      '第 1 步 · 浓度衰减曲线',
      'Step 1 · The decay curve',
      '画 conc_mM–time_s：升温使衰减越来越快。对 ln(c) 做数值差分即可估出瞬时速率 k(t)=−d ln c/dt。',
      'Plot conc_mM vs time_s: decay accelerates as the ramp heats up. Numerically differentiate ln(c) for the instantaneous rate k(t) = −d ln c/dt.',
      '/studio/analysis',
    ),
    step(
      '第 2 步 · Arrhenius 回归',
      'Step 2 · Arrhenius regression',
      '把 k(t) 对 1/T 作图应近似直线，斜率 = −Ea/R。用模型实验室线性拟合读出活化能 Ea ≈ 40–60 kJ/mol 量级。',
      'Plot k(t) against 1/T — it should be nearly linear with slope −Ea/R. A model-lab linear fit gives Ea in the 40–60 kJ/mol ballpark.',
      '/studio/model-lab',
    ),
    step(
      '第 3 步 · 转化率响应面',
      'Step 3 · Conversion response surface',
      '在扫描工作室以温度×停留时间为轴计算转化率 1−exp(−k·t)，等高线图直接指出达标 90% 转化所需的最低工艺温度。',
      'In Sweeps Studio, compute conversion 1−exp(−k·t) over temperature × residence time; the contour map shows the lowest process temperature hitting 90% conversion.',
      '/studio/sweeps',
    ),
    step(
      '第 4 步 · 图形交付',
      'Step 4 · Deliver the figure',
      '把衰减曲线、Arrhenius 图与响应面排成一张三联图版，附拟合参数。',
      'Compose the decay curve, Arrhenius plot and response surface into a three-panel figure sheet with the fitted parameters.',
      '/studio/figures',
    ),
  ],
  buildProject: () =>
    makeProject(chemKinetics, [fileFromText('kinetics-tpd.csv', kineticsCsv(), 'text/csv')]),
};

const geoHdf5: SubjectTemplate = {
  id: 'geo-hdf5',
  subject: 'geoscience',
  difficulty: 'advanced',
  minutes: 18,
  tools: ['profiler', 'figures'],
  title: { zh: '地形高程网格的分块统计', en: 'Chunked Statistics on a Terrain Elevation Grid' },
  summary: {
    zh: '对 30×30 高程点云做数据画像与分块聚合，评估坡度分布与极值区。',
    en: 'Profile and aggregate a 30×30 elevation grid; assess slope distribution and extreme zones.',
  },
  question: {
    zh: '地学问题：这片测绘网格的高程分布是否呈双峰（河谷 vs 台地）？最大坡度出现在哪里？',
    en: 'Geo question: is this survey grid bimodal (valley vs plateau), and where does the maximum slope occur?',
  },
  steps: [
    step(
      '这个项目在算什么',
      'What this project computes',
      'terrain-elev.csv 是 10 m 网格的高程点（真实工作流里它来自 HDF5 分块数据集，这里用等价文本网格）。先做数据画像，再按块统计高程与坡度。',
      'terrain-elev.csv is a 10 m elevation grid (in a real workflow it streams out of a chunked HDF5 dataset; the text grid here is equivalent). Profile it, then block-statistics on elevation and slope.',
      '/workbench',
    ),
    step(
      '第 1 步 · 数据画像',
      'Step 1 · Profile the grid',
      '数据画像工具给出高程直方图、分位数与缺失检查：双峰结构 = 河谷/台地两带；离群值提示测绘伪影。',
      'The profiler returns an elevation histogram, quantiles and completeness check: bimodality marks the valley/plateau bands; outliers hint at survey artefacts.',
      '/studio/profiler',
    ),
    step(
      '第 2 步 · 坡度场计算',
      'Step 2 · Compute the slope field',
      '用中心差分 ∂z/∂x、∂z/∂y 合成坡度 |∇z|，统计其分布——工程选线关心的是最大坡度而非平均坡度。',
      'Central differences ∂z/∂x and ∂z/∂y combine into slope |∇z|; its distribution matters — routing cares about the maximum, not the mean.',
      '/studio/analysis',
    ),
    step(
      '第 3 步 · 高程曲面出图',
      'Step 3 · Render the elevation surface',
      '把网格画成热力图/曲面图版，叠加坡度等值线，标注极值坐标，作为地貌判读的最终图。',
      'Render the grid as a heatmap/surface sheet with slope contours and annotated extremes — the final geomorphology figure.',
      '/studio/figures',
    ),
  ],
  buildProject: () =>
    makeProject(geoHdf5, [fileFromText('terrain-elev.csv', terrainCsv(), 'text/csv')]),
};

const medBayes: SubjectTemplate = {
  id: 'med-bayes',
  subject: 'medicine',
  difficulty: 'advanced',
  minutes: 20,
  tools: ['inference', 'runs'],
  title: { zh: 'Weibull 生存模型的贝叶斯拟合', en: 'Bayesian Weibull Survival Fit' },
  summary: {
    zh: '对 150 例含删失生存时间做 MCMC 拟合，检查形状参数的后验与收敛。',
    en: 'MCMC on 150 censored survival times; inspect the shape-parameter posterior and convergence.',
  },
  question: {
    zh: '医学问题：这批病人的风险函数是随时间上升还是下降（形状参数 k>1 还是 <1）？中位生存期多长？',
    en: 'Med question: does the hazard rise or fall with time (shape k > 1 or < 1), and what is the median survival?',
  },
  steps: [
    step(
      '这个项目在算什么',
      'What this project computes',
      'survival-times.csv 有 150 位病人的 time_days 与 event（0 = 删失）。用贝叶斯 Weibull 模型（似然含删失项）做 HMC/NUTS 采样，输出形状、尺度参数的后验分布。',
      'survival-times.csv gives time_days and event (0 = censored) for 150 patients. Fit a Bayesian Weibull model (censored likelihood) with HMC/NUTS and report posteriors for shape and scale.',
      '/workbench',
    ),
    step(
      '第 1 步 · 删失数据检查',
      'Step 1 · Check the censoring',
      '先统计删失比例（约 25%）：删失不是坏数据，而是「至少活到 t」的部分信息，似然里必须用生存函数项表达。',
      'Count the censoring share (≈25%): censoring is not missing data but partial information “survived at least to t”, which the likelihood must carry as survival-function terms.',
      '/studio/analysis',
    ),
    step(
      '第 2 步 · MCMC 后验采样',
      'Step 2 · Sample the posterior',
      '推理工坊选 Weibull 模板跑 NUTS：观察链的轨迹图与后验直方图，形状参数 k 的 95% credible interval 是否排除 1 决定风险走向。',
      'In Inference Forge, run NUTS on the Weibull template: from the trace and posterior histograms, whether k’s 95% credible interval excludes 1 decides the hazard direction.',
      '/studio/inference',
    ),
    step(
      '第 3 步 · 收敛诊断',
      'Step 3 · Diagnose convergence',
      'R-hat < 1.01 且 ESS > 400 才可信。在运行历史里对比不同采样设置（步数/适应期）的记录，确认结果稳定。',
      'Trust chains only with R-hat < 1.01 and ESS > 400. Compare runs with different sampler settings in the run history to confirm stability.',
      '/studio/runs',
    ),
    step(
      '第 4 步 · 中位生存期',
      'Step 4 · Posterior median survival',
      '从后验参数组计算每条样本的中位生存期，取后验分位数报告：这就是给临床的结论数字。',
      'Compute the median survival for each posterior draw and report its quantiles — that is the number handed to the clinic.',
      '/studio/inference',
    ),
  ],
  buildProject: () =>
    makeProject(medBayes, [fileFromText('survival-times.csv', survivalCsv(), 'text/csv')]),
};

const mathQq: SubjectTemplate = {
  id: 'math-qq',
  subject: 'mathematics',
  difficulty: 'beginner',
  minutes: 9,
  tools: ['analysis', 'figures'],
  title: { zh: '收益序列的正态性 QQ 诊断', en: 'Normality QQ Diagnostics for Returns' },
  summary: {
    zh: '240 个对数正态收益样本的 QQ 图与偏度峰度检验：尾部风险从何而来。',
    en: 'QQ plots, skewness and kurtosis on 240 log-normal returns: where tail risk comes from.',
  },
  question: {
    zh: '数学问题：这组收益数据能当作正态处理吗？若不能，尾部比正态厚多少？',
    en: 'Math question: can these returns be treated as normal? If not, how much fatter are the tails?',
  },
  steps: [
    step(
      '这个项目在算什么',
      'What this project computes',
      'returns.csv 是 240 个日收益观测。QQ 图把样本分位数对正态理论分位数作图：点贴对角线 = 正态；两端上翘/下弯 = 厚尾偏斜。',
      'returns.csv holds 240 daily return observations. A QQ plot compares sample quantiles to normal theoretical quantiles: points on the diagonal mean normality; lifted right ends mean skew and fat tails.',
      '/workbench',
    ),
    step(
      '第 1 步 · 直方图第一印象',
      'Step 1 · Histogram first',
      '先画收益直方图：右偏、峰值高于正态是 QQ 图之前的直觉体检。',
      'Plot the return histogram first: right skew and a sharper peak than gaussian is the eyeball check before any QQ plot.',
      '/studio/analysis',
    ),
    step(
      '第 2 步 · 构建 QQ 图',
      'Step 2 · Build the QQ plot',
      '样本排序后与 Φ⁻¹((i−0.5)/n) 作图。右尾点系统性高于参考线，说明极端收益被正态模型低估。',
      'Plot sorted samples against Φ⁻¹((i−0.5)/n). Points systematically above the reference line in the right tail show the normal model underestimates extreme returns.',
      '/studio/analysis',
    ),
    step(
      '第 3 步 · 偏度峰度与结论',
      'Step 3 · Skew, kurtosis, verdict',
      '报告偏度 >0 与超额峰度 >0 的数值，作为 QQ 图的定量注脚；结论进图版：该数据应改用对数正态/厚尾族建模。',
      'Report positive skewness and excess kurtosis as the numeric footnote to the QQ plot; the figure verdict: model these data with log-normal / heavy-tailed families.',
      '/studio/figures',
    ),
  ],
  buildProject: () =>
    makeProject(mathQq, [fileFromText('returns.csv', returnsCsv(), 'text/csv')]),
};

const engHeat: SubjectTemplate = {
  id: 'eng-heat',
  subject: 'engineering',
  difficulty: 'advanced',
  minutes: 16,
  tools: ['figures', 'sweeps'],
  title: { zh: '稳态热传导场与截面误差带', en: 'Steady-State Heat Field with Section Error Band' },
  summary: {
    zh: '32×32 温度网格的曲面渲染、截面提取与网格收敛性扫描。',
    en: 'Surface-render a 32×32 temperature grid, extract a section, sweep mesh convergence.',
  },
  question: {
    zh: '工程问题：散热构型下的最高温度点在哪里？数值解对网格分辨率足够鲁棒吗？',
    en: 'Eng question: where is the hot spot under this cooling layout, and is the numerical solution robust to mesh resolution?',
  },
  steps: [
    step(
      '这个项目在算什么',
      'What this project computes',
      'heat-field.json 是有限差分解 2-D 热方程的 32×32 温度场（含测量噪声）。渲染温度曲面找热点，沿中心截面提取剖面并给误差带。',
      'heat-field.json is a finite-difference 32×32 temperature field of the 2-D heat equation (with sensor noise). Render the surface to locate the hot spot, extract a centreline section with an error band.',
      '/workbench',
    ),
    step(
      '第 1 步 · 温度场画像',
      'Step 1 · Profile the field',
      '用画像工具看温度分布：双峰来自背景正弦调制 + 局部热源的叠加，min/max 定位热点坐标。',
      'Profile the temperature distribution: the bimodality comes from the sinusoidal background plus a local heat source; min/max give the hot-spot coordinates.',
      '/studio/profiler',
    ),
    step(
      '第 2 步 · 截面与误差带',
      'Step 2 · Section and error band',
      '取 j=16 行的 T(x) 剖面，按噪声水平 ±σ 画误差带——评估峰值温度不确定度是否吃掉设计裕量。',
      'Take the T(x) profile at row j=16 and draw a ±σ band from the noise level — does peak-temperature uncertainty eat the design margin?',
      '/studio/figures',
    ),
    step(
      '第 3 步 · 网格收敛扫描',
      'Step 3 · Mesh-convergence sweep',
      '在扫描工作室对网格密度 16/32/64 重解同边界问题，看热点温度随网格的变化曲线，判断解已收敛。',
      'In Sweeps Studio re-solve the same boundary problem at 16/32/64 grid densities; the hot-spot temperature vs mesh curve shows whether the solution has converged.',
      '/studio/sweeps',
    ),
    step(
      '第 4 步 · 曲面图版',
      'Step 4 · Surface figure sheet',
      '等高线 + 截面剖面双面板排入图版，标注热点与材料参数，作为热设计评审图。',
      'Lay contours plus the section profile into a two-panel sheet with the hot spot and material parameters annotated — the thermal design review figure.',
      '/studio/figures',
    ),
  ],
  buildProject: () =>
    makeProject(engHeat, [fileFromText('heat-field.json', heatFieldJson(), 'application/json')]),
};

const bioSankey: SubjectTemplate = {
  id: 'bio-sankey',
  subject: 'biology',
  difficulty: 'intermediate',
  minutes: 12,
  tools: ['figures', 'profiler'],
  title: { zh: '微生物组分类流向图', en: 'Microbiome Taxonomy Flow (Sankey)' },
  summary: {
    zh: '门→纲→属三级丰度流向桑基图，配多样性分布画像。',
    en: 'A phylum→class→genus abundance Sankey with a diversity profile.',
  },
  question: {
    zh: '生物学问题：肠道样本的丰度集中在哪条分类路径上？优势属是否只来自单一门？',
    en: 'Bio question: which taxonomic path carries the abundance in these gut samples, and does the dominant genus come from a single phylum?',
  },
  steps: [
    step(
      '这个项目在算什么',
      'What this project computes',
      'taxonomy-flow.csv 是分类层级边表（source→target, abundance）。桑基图把门→纲→属的丰度流可视化，画像工具检查各节点丰度分布。',
      'taxonomy-flow.csv is a hierarchy edge list (source→target, abundance). The Sankey visualises phylum→class→genus flow; the profiler checks node-level abundance distributions.',
      '/workbench',
    ),
    step(
      '第 1 步 · 边表画像',
      'Step 1 · Profile the edge list',
      '先看 abundance 的分布与每层节点数：确认三级结构完整、无孤立节点，桑基图才能闭合。',
      'Inspect the abundance distribution and per-level node counts: the three-level chain must be complete with no orphan nodes for the Sankey to close.',
      '/studio/profiler',
    ),
    step(
      '第 2 步 · 流向图渲染',
      'Step 2 · Render the flow',
      '在图版工作室选桑基模板：带宽 ∝ 丰度。目测最大流路径 = 优势分类通路。',
      'In Figure Studio pick the Sankey template: ribbon width ∝ abundance. The widest path is the dominant taxonomic route.',
      '/studio/figures',
    ),
    step(
      '第 3 步 · 归一化与结论',
      'Step 3 · Normalise and conclude',
      '把丰度按父节点归一化成百分比流，回答「优势属来自哪个门」；导出图版附相对丰度表。',
      'Normalise abundance by parent node into percentage flow to answer “which phylum the dominant genus belongs to”, then export the sheet with the relative-abundance table.',
      '/studio/figures',
    ),
  ],
  buildProject: () =>
    makeProject(bioSankey, [fileFromText('taxonomy-flow.csv', microbiomeCsv(), 'text/csv')]),
};

const astroSql: SubjectTemplate = {
  id: 'astro-sql',
  subject: 'astronomy',
  difficulty: 'advanced',
  minutes: 15,
  tools: ['sql', 'lineage'],
  title: { zh: '测光时序的 SQL 聚合', en: 'SQL Aggregation over Photometric Time Series' },
  summary: {
    zh: '用 SQL 对 400 点多波段测光按 band 聚合，周期信号与血缘记录一次完成。',
    en: 'Aggregate 400 multi-band photometric points by band in SQL; period signal and lineage in one pass.',
  },
  question: {
    zh: '天文问题：这颗变星在各波段的平均星等差多少？12.4 天周期能否用 SQL 直接验证？',
    en: 'Astro question: how far apart are the per-band mean magnitudes of this variable star, and can SQL alone confirm the 12.4-day period?',
  },
  steps: [
    step(
      '这个项目在算什么',
      'What this project computes',
      'photometry.csv 是 G/R/I 三波段混合的 400 条测光（等价于大 Parquet 档案的导出切片）。SQL 工作台做分组聚合，血缘图记录每次查询的输入输出。',
      'photometry.csv mixes 400 G/R/I-band measurements (a text slice of what would be a large Parquet archive). The SQL workbench aggregates by band; lineage records each query.',
      '/workbench',
    ),
    step(
      '第 1 步 · 按波段聚合',
      'Step 1 · Aggregate by band',
      'SELECT band, AVG(mag), STDDEV(mag), COUNT(*) GROUP BY band：三波段均值差即色指数，σ 反映测光噪声。',
      'SELECT band, AVG(mag), STDDEV(mag), COUNT(*) GROUP BY band: the per-band mean gaps are the colour indices; σ is the photometric noise.',
      '/studio/sql',
    ),
    step(
      '第 2 步 · 时间分箱光变曲线',
      'Step 2 · Binned light curve',
      '按 phase = mod(mjd, 12.4)/12.4 分箱再聚合：若周期假设正确，散点将收拢成单一正弦轮廓。',
      'Bin and aggregate on phase = mod(mjd, 12.4)/12.4: if the period guess is right, the scatter collapses onto one sinusoidal profile.',
      '/studio/sql',
    ),
    step(
      '第 3 步 · 血缘归档',
      'Step 3 · Record the lineage',
      '打开血缘视图确认「文件→查询→结果表」的链路完整，导出的聚合表可被后续拟合直接引用。',
      'Open the lineage view to confirm the file→query→result chain; the exported aggregate feeds any later fit directly.',
      '/studio/lineage',
    ),
  ],
  buildProject: () =>
    makeProject(astroSql, [fileFromText('photometry.csv', lightcurveCsv(), 'text/csv')]),
};

const medDose: SubjectTemplate = {
  id: 'med-dose',
  subject: 'medicine',
  difficulty: 'intermediate',
  minutes: 12,
  tools: ['model-lab', 'uncertainty'],
  title: { zh: '剂量–响应四参数拟合', en: 'Four-Parameter Dose–Response Fit' },
  summary: {
    zh: '对数-逻辑 4PL 曲线拟合 8 个剂量点，IC50 及其 bootstrap 置信区间。',
    en: 'Log-logistic 4PL fit over 8 dose levels; IC50 with a bootstrap confidence interval.',
  },
  question: {
    zh: '医学问题：候选药物的 IC50 是多少微摩尔？重复孔间的变异会不会让 IC50 结论翻转？',
    en: 'Med question: what is the candidate’s IC50 in µM, and could well-to-well noise flip that conclusion?',
  },
  steps: [
    step(
      '这个项目在算什么',
      'What this project computes',
      'dose-response.csv 是 8 个剂量 × 12 复孔的抑制率。用 4 参数逻辑模型 y = bottom + (top−bottom)/(1+(IC50/x)^hill) 拟合，IC50 是关键交付量。',
      'dose-response.csv gives inhibition % for 8 doses × 12 replicates. Fit the 4-parameter log-logistic curve; the IC50 is the deliverable.',
      '/workbench',
    ),
    step(
      '第 1 步 · 半对数目测',
      'Step 1 · Eyeball the semi-log plot',
      'x 轴取 log10(dose) 画散点：S 形上下平台是否清晰？平台不平时 top/bottom 要作为自由参数拟合而非固定 100/0。',
      'Scatter y against log10(dose): are the top/bottom plateaus flat? If not, fit top/bottom as free parameters instead of pinning 100/0.',
      '/studio/model-lab',
    ),
    step(
      '第 2 步 · 4PL 非线性拟合',
      'Step 2 · Fit the 4PL curve',
      '模型实验室选对数-逻辑模型拟合四参数，报告 IC50≈30 µM 与 Hill 斜率；残差应按剂量近似均匀。',
      'Fit the four log-logistic parameters in the model lab: expect IC50 ≈ 30 µM and a Hill slope near 1–2; residuals should look uniform across doses.',
      '/studio/model-lab',
    ),
    step(
      '第 3 步 · IC50 的 bootstrap 区间',
      'Step 3 · Bootstrap the IC50 interval',
      '对复孔重采样 1000 次，每次重拟合取 IC50，2.5%–97.5% 分位数即置信区间——报告「IC50 = … [ …, … ] µM」。',
      'Resample the replicate wells 1000×, refit each time, and take the 2.5%–97.5% percentiles of the IC50 draws — report “IC50 = … [ …, … ] µM”.',
      '/studio/uncertainty',
    ),
  ],
  buildProject: () =>
    makeProject(medDose, [fileFromText('dose-response.csv', doseResponseCsv(), 'text/csv')]),
};

export const SUBJECT_TEMPLATES: SubjectTemplate[] = [
  physicsError,
  bioStats,
  astroFits,
  engSignal,
  chemKinetics,
  geoHdf5,
  medBayes,
  mathQq,
  engHeat,
  bioSankey,
  astroSql,
  medDose,
];

const BY_ID = new Map(SUBJECT_TEMPLATES.map((t) => [t.id, t] as const));

export function getTemplate(id: string | undefined): SubjectTemplate | undefined {
  return id ? BY_ID.get(id) : undefined;
}

/**
 * Website gallery id → template id. Mirrors the `template` fields in
 * website/src/data/gallery.ts (the "Open in Studio" deep links send
 * `#/?gallery=<id>`; `#/?template=<id>` is also supported directly).
 */
export const GALLERY_ID_TO_TEMPLATE: Record<string, string> = {
  'pendulum-chaos': 'physics-error',
  'two-sample-t': 'bio-stats',
  'fits-spectrum': 'astro-fits',
  'vibration-fft': 'eng-signal',
  'reaction-kinetics': 'chem-kinetics',
  'terrain-hdf5': 'geo-hdf5',
  'survival-bayes': 'med-bayes',
  'copula-qq': 'math-qq',
  'heat-surface': 'eng-heat',
  'microbiome-sankey': 'bio-sankey',
  'parquet-timeseries': 'astro-sql',
  'dose-response': 'med-dose',
};

/** Pick the localized string for a text pair. */
export function pickLocale(text: LocalizedText, locale: string): string {
  return locale === 'en-US' ? text.en : text.zh;
}
