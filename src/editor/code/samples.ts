// ==========================================================================
// Ergalics Studio — code-mode sample programs (代码示例)
//
// The Python sources live as real files under examples/code/*.py and are
// discovered at build time via import.meta.glob, mirroring how flow-mode
// pipelines live under examples/projects/*.clproj. Display text (name /
// description) is a curated metadata table keyed by the file's basename.
// ==========================================================================

export interface CodeSample {
  id: string;
  /** File basename, e.g. "telemetry-explore.py". */
  filename: string;
  /** Python source (Pyodide, `import studio`). */
  python: string;
  name: string;
  nameI18n: Record<string, string>;
  description: string;
  descriptionI18n: Record<string, string>;
}

/** Curated display metadata keyed by sample id (file basename minus .py). */
const CODE_SAMPLE_META: Record<string, Pick<CodeSample, 'name' | 'nameI18n' | 'description' | 'descriptionI18n'>> = {
  'telemetry-explore': {
    name: '遥测数据分析',
    nameI18n: { 'en-US': 'Telemetry Analysis' },
    description: '载入 telemetry.csv，打印统计摘要并绘制温度随时间变化的折线',
    descriptionI18n: { 'en-US': 'Load telemetry.csv, print a summary, and plot temperature over time' },
  },
  'galaxy-scatter': {
    name: '星系散点图',
    nameI18n: { 'en-US': 'Galaxy Scatter' },
    description: '载入 galaxy.dat 并绘制星系位置的二维散点图',
    descriptionI18n: { 'en-US': 'Load galaxy.dat and scatter the positions' },
  },
  'random-histogram': {
    name: '随机数直方图',
    nameI18n: { 'en-US': 'Random Histogram' },
    description: '生成 1000 个随机数并绘制直方图，验证分布形态',
    descriptionI18n: { 'en-US': 'Generate 1000 random numbers and histogram them' },
  },
  'normalize-filter': {
    name: '标准化与过滤管线',
    nameI18n: { 'en-US': 'Normalize & Filter' },
    description: '对温度做 min-max 标准化，再过滤出高温样本并散点展示',
    descriptionI18n: { 'en-US': 'Min-max normalize temperature, filter hot samples, scatter the rest' },
  },
  'range-loop': {
    name: '区间与循环',
    nameI18n: { 'en-US': 'Range & Loop' },
    description: '演示 Python 循环与 studio.range 生成等差数列',
    descriptionI18n: { 'en-US': 'Python loops plus studio.range for an arithmetic sequence' },
  },
  'add-column-plot': {
    name: '派生列与散点',
    nameI18n: { 'en-US': 'Derived Column & Scatter' },
    description: '用 Python 计算正弦派生列，addColumn 写回表并散点绘制',
    descriptionI18n: { 'en-US': 'Compute a sine column in Python, addColumn it back, and scatter' },
  },
  'eda-pipeline': {
    name: '数据探索流水线',
    nameI18n: { 'en-US': 'EDA Pipeline' },
    description: '完整探索流程：逐列统计、z-score 标准化、相关性散点、过滤极端样本',
    descriptionI18n: { 'en-US': 'Full EDA: per-column stats, z-score normalization, correlation scatter, extreme-sample filtering' },
  },
  'monte-carlo-pi': {
    name: '蒙特卡洛估算圆周率',
    nameI18n: { 'en-US': 'Monte-Carlo Pi' },
    description: '用 2000 个均匀随机点估算 π，按命中/未命中着色散点，并观察收敛趋势',
    descriptionI18n: { 'en-US': 'Estimate pi from 2000 uniform random points, color-coded hit/miss scatter, plus convergence' },
  },
  'signal-analysis': {
    name: '信号分析与平滑',
    nameI18n: { 'en-US': 'Signal Analysis & Smoothing' },
    description: '合成正弦波加噪声，用移动平均平滑，对比三条曲线并量化噪声抑制比',
    descriptionI18n: { 'en-US': 'Synthesize a sine wave, add noise, smooth with a moving average, compare series and quantify noise reduction' },
  },
};

// Raw-text imports of every examples/code/*.py at build time (Vite 6).
const sampleModules = import.meta.glob<string>('../../../examples/code/*.py', {
  query: '?raw',
  import: 'default',
  eager: true,
});

export const CODE_SAMPLES: CodeSample[] = Object.entries(sampleModules).map(([path, python]) => {
  const filename = path.split('/').pop() ?? '';
  const id = filename.replace(/\.py$/, '');
  const meta = CODE_SAMPLE_META[id];
  if (!meta) {
    throw new Error(`missing CODE_SAMPLE_META for ${id} (${path})`);
  }
  return { id, filename, python, ...meta };
});

export function codeSampleName(sample: CodeSample, locale: string): string {
  return sample.nameI18n[locale] ?? sample.name;
}

export function codeSampleDescription(sample: CodeSample, locale: string): string {
  return sample.descriptionI18n[locale] ?? sample.description;
}
