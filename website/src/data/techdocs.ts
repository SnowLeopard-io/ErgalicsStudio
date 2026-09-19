// Technical documents listed on the Downloads page. Mirrors the files under
// docs/technical/, which scripts/copy-technical-docs.mjs copies into
// website/public/technical/ at build time. The `file` values must match the
// real filenames exactly — they get URL-encoded when linked. `formats`
// declares which renderings actually exist for each document.

export type DocFormat = 'pdf' | 'html' | 'md';

export interface TechDoc {
  /** Exact filename of one existing rendering (used to derive the others). */
  file: string;
  title: { zh: string; en: string };
  desc: { zh: string; en: string };
  formats: DocFormat[];
}

export interface TechDocGroup {
  id: string;
  title: { zh: string; en: string };
  desc: { zh: string; en: string };
  docs: TechDoc[];
}

const overview: TechDoc[] = [
  {
    file: 'Ergalics Studio.md',
    title: { zh: '完整技术总结', en: 'Full Technical Summary' },
    desc: {
      zh: '约十万字的完整技术文档：架构设计、四大模式、科研工具集、GPU 加速与测试体系一览。',
      en: 'The complete technical document: architecture, the four modes, research tools, GPU acceleration and testing in one file.',
    },
    formats: ['pdf', 'html', 'md'],
  },
  {
    file: 'README.md',
    title: { zh: '项目说明（英文）', en: 'Project README (English)' },
    desc: {
      zh: '项目主页说明：功能特性、快速上手与部署方式。',
      en: 'The project readme: features, quick start and deployment.',
    },
    formats: ['pdf', 'html', 'md'],
  },
  {
    file: 'README.zh-CN.html',
    title: { zh: '项目说明（中文）', en: 'Project README (Chinese)' },
    desc: {
      zh: '中文版项目说明文档。',
      en: 'The Chinese project readme.',
    },
    formats: ['pdf', 'html'],
  },
];

const chapters: TechDoc[] = [
  {
    file: '01-产品介绍.md',
    title: { zh: '01 · 产品介绍', en: '01 · Product Introduction' },
    desc: {
      zh: '产品定位、设计理念与整体功能概览。',
      en: 'Product positioning, design philosophy and the feature overview.',
    },
    formats: ['pdf', 'html', 'md'],
  },
  {
    file: '02-系统架构.md',
    title: { zh: '02 · 系统架构', en: '02 · System Architecture' },
    desc: {
      zh: '四模式共享 IR 的分层架构、模块划分与数据流。',
      en: 'The layered architecture behind the shared IR: modules and data flow.',
    },
    formats: ['pdf', 'html', 'md'],
  },
  {
    file: '03-插件系统.md',
    title: { zh: '03 · 插件系统', en: '03 · Plugin System' },
    desc: {
      zh: '.cspkg 插件包格式、ed25519 签名校验与沙箱运行时。',
      en: 'The .cspkg package format, ed25519 signature checks and the sandbox runtime.',
    },
    formats: ['pdf', 'html', 'md'],
  },
  {
    file: '04-四大工作模式.md',
    title: { zh: '04 · 四大工作模式', en: '04 · The Four Working Modes' },
    desc: {
      zh: '积木、流程、代码与 Notebook 模式的实现与互转机制。',
      en: 'How the blocks, flow, code and notebook modes are implemented and interconverted.',
    },
    formats: ['pdf', 'html', 'md'],
  },
  {
    file: '05-科研工具集.md',
    title: { zh: '05 · 科研工具集', en: '05 · Research Tool Suite' },
    desc: {
      zh: '15 个科研工具页的功能设计与使用方式。',
      en: 'The 15 research tool pages: design and usage.',
    },
    formats: ['pdf', 'html', 'md'],
  },
  {
    file: '06-GPU计算与原生核心.md',
    title: { zh: '06 · GPU 计算与原生核心', en: '06 · GPU Computing & Native Core' },
    desc: {
      zh: 'WebGPU 加速内核、CPU 回退策略与 Rust/WASM 核心。',
      en: 'WebGPU kernels, CPU fallback and the Rust/WASM core.',
    },
    formats: ['pdf', 'html', 'md'],
  },
  {
    file: '07-科学计算子系统.md',
    title: { zh: '07 · 科学计算子系统', en: '07 · Scientific Computing Subsystem' },
    desc: {
      zh: '统计、回归、贝叶斯推断与不确定性传播的实现。',
      en: 'Implementation of statistics, regression, Bayesian inference and uncertainty propagation.',
    },
    formats: ['pdf', 'html', 'md'],
  },
  {
    file: '08-测试与质量保障.md',
    title: { zh: '08 · 测试与质量保障', en: '08 · Testing & Quality Assurance' },
    desc: {
      zh: '测试金字塔、CI 门禁与基准回归防护。',
      en: 'The test pyramid, CI gates and benchmark regression guards.',
    },
    formats: ['pdf', 'html', 'md'],
  },
];

export const TECH_DOC_GROUPS: TechDocGroup[] = [
  {
    id: 'overview',
    title: { zh: '总览', en: 'Overview' },
    desc: {
      zh: '完整技术总结与项目说明，适合首次了解 Ergalics Studio。',
      en: 'The full technical summary and project readmes — best starting points.',
    },
    docs: overview,
  },
  {
    id: 'chapters',
    title: { zh: '技术章节', en: 'Technical Chapters' },
    desc: {
      zh: '八章技术细节，从产品定位讲到测试与质量保障。',
      en: 'Eight chapters of technical detail, from product positioning to testing & QA.',
    },
    docs: chapters,
  },
];
