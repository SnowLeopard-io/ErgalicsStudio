// Technical documents listed on the Downloads page. Single source of truth is
// docs/technical/: website/vite.config.ts streams them in dev (the /technical
// middleware) and copies them into dist/technical on closeBundle — there is no
// separate copy script. The `file` values must match the real filenames
// exactly — they get URL-encoded when linked. `formats` declares which
// renderings actually exist for each document.

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
  {
    file: '09-电磁谐振特征值求解器.md',
    title: { zh: '09 · 电磁谐振特征值求解器', en: '09 · EM Resonance Eigensolver' },
    desc: {
      zh: '十万阶非正定厄密稀疏矩阵特征值求解：厚重启 Lanczos、块 LOBPCG、Jacobi-Davidson 与 MINRES 位移逆变换。',
      en: 'Large-scale sparse Hermitian (indefinite) eigenpairs: thick-restart Lanczos, block LOBPCG, Jacobi-Davidson and MINRES shift-invert.',
    },
    formats: ['pdf', 'html', 'md'],
  },
  {
    file: '10-流体双向耦合求解器.md',
    title: { zh: '10 · 流体双向耦合求解器', en: '10 · Bidirectional Fluid-Coupling Solver' },
    desc: {
      zh: '1D 管网与 3D 场的双向耦合：多速率子循环、正反向边界耦合、毫秒级控制逻辑与守恒性审计。',
      en: 'Bidirectional coupling of a 1-D pipe network with a 3-D field solver: multi-rate sub-cycling, forward/reverse boundary coupling, millisecond control logic and conservation auditing.',
    },
    formats: ['pdf', 'html', 'md'],
  },
];

export const TECH_DOC_GROUPS: TechDocGroup[] = [
  {
    id: 'overview',
    title: { zh: '总览', en: 'Overview' },
    desc: {
      zh: '完整技术总结，适合首次系统了解 Ergalics Studio。',
      en: 'The full technical summary — the best starting point.',
    },
    docs: overview,
  },
  {
    id: 'chapters',
    title: { zh: '技术章节', en: 'Technical Chapters' },
    desc: {
      zh: '十章技术细节，从产品定位讲到流体双向耦合求解器。',
      en: 'Ten chapters of technical detail, from product positioning to the bidirectional fluid-coupling solver.',
    },
    docs: chapters,
  },
];
