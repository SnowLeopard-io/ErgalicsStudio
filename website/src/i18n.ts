export type Locale = 'zh-CN' | 'en-US';

type Dict = Record<string, { zh: string; en: string }>;

const D: Dict = {
  'nav.home': { zh: '首页', en: 'Home' },
  'nav.gallery': { zh: '作品画廊', en: 'Gallery' },
  'nav.themes': { zh: '主题市场', en: 'Themes' },
  'nav.plugins': { zh: '插件市场', en: 'Plugins' },
  'nav.downloads': { zh: '资料下载', en: 'Downloads' },
  'downloads.title': { zh: '资料下载', en: 'Downloads' },
  'downloads.desc': {
    zh: 'Ergalics Studio 技术文档与项目资料：完整技术总结与十章技术细节，提供 PDF / HTML / Markdown 三种格式，可在线阅读或直接下载。',
    en: 'Technical documentation and project materials: the full technical summary and ten technical chapters in PDF / HTML / Markdown — read online or download.',
  },
  'nav.docs': { zh: '文档', en: 'Docs' },
  'nav.enter': { zh: '进入工作台', en: 'Enter the Workbench' },
  'footer.tagline': {
    zh: '浏览器端多模式科研计算工作站 · 零安装 · 本地隐私优先 · 开源免费',
    en: 'A browser-based multi-mode scientific computing workstation · zero install · privacy-first · open source',
  },
  'footer.links': { zh: '链接', en: 'Links' },
  'footer.license': { zh: 'MIT 许可', en: 'MIT License' },
  'hero.badge': { zh: 'v2.0.0 正式发布 · 2026-10-13', en: 'v2.0.0 · Released 2026-10-13' },
  'hero.title.a': {
    zh: 'Ergalics Studio',
    en: 'Ergalics Studio',
  },
  'hero.title.b': {
    zh: '让科学计算，回归触手可及',
    en: 'scientific computing, back within reach',
  },
  'hero.artBadge': {
    zh: '实时 WebGPU 渲染 · 与工作台黑洞插件同一套测地线数学',
    en: 'Live WebGPU render — the same geodesic math as the workbench black-hole plugin',
  },
  'hero.desc': {
    zh: '为需要可复现分析的学生与研究者而做：26 个科研工具、14 个 WGSL 内核与 Python / R 运行时全部在本地页面内运行——数据不上传，也无需安装。',
    en: 'Built for students and researchers who need reproducible analysis: 26 research tools, 14 WGSL kernels and the Python / R runtimes all run locally in the page — no uploads, no installs.',
  },
  'hero.cta': { zh: '进入工作台', en: 'Enter the Workbench' },
  'hero.cta2': { zh: '浏览示例画廊', en: 'Browse the examples' },
  'features.title': { zh: '为真实科研链路而设计', en: 'Designed for the real research chain' },
  'f1.t': { zh: '四种模式 · 一份 IR', en: 'Four modes · one IR' },
  'f1.d': {
    zh: '标准、流程、积木与 Python / R / JavaScript 代码模式围绕同一中间表示互转，切换语言不丢语义。',
    en: 'Standard, flow, blocks and the Python / R / JavaScript code mode interconvert over one shared IR — switch languages without losing semantics.',
  },
  'f2.t': { zh: '19 个科研工具页', en: '19 research tool pages' },
  'f2.d': {
    zh: '不确定性传播、回归与贝叶斯推断、参数扫描、SQL 分析、信号实验室、数据画像、清洗向导、Figure Studio、复现锁……统一外壳，随取随用。',
    en: 'Uncertainty propagation, regression & Bayesian inference, sweeps, SQL analytics, signal lab, data profiler, cleaning wizard, Figure Studio, repro lock… one consistent shell for every tool.',
  },
  'f3.t': { zh: '可复现是默认行为', en: 'Reproducibility by default' },
  'f3.d': {
    zh: '每次运行自动写入实验记录与数据血缘，repro.lock 冻结数据指纹、参数、种子与代码，导出物携带版本信息。',
    en: 'Every run is recorded with lineage; repro.lock freezes data fingerprints, params, seeds and code, and exports carry version info.',
  },
  'f4.t': { zh: 'WebGPU 加速 · CPU 回退', en: 'WebGPU accelerated · CPU fallback' },
  'f4.d': {
    zh: 'Bootstrap、MCMC 与渲染内核在 WebGPU 上运行，不可用时透明回退 CPU，引擎选择写入运行记录。',
    en: 'Bootstrap, MCMC and rendering kernels run on WebGPU with a transparent CPU fallback; the engine choice is written into the run record.',
  },
  'gallery.title': { zh: '作品画廊', en: 'Project Gallery' },
  'gallery.desc': {
    zh: '来自社区的可复现分析作品。每个作品附带复现状态与学科标签，点击即可在 Ergalics Studio 中打开。',
    en: 'Reproducible analyses from the community. Every entry carries a reproducibility status and subject tags, and opens directly in Ergalics Studio.',
  },
  'gallery.filter.subject': { zh: '学科', en: 'Subject' },
  'gallery.filter.chart': { zh: '图表类型', en: 'Chart type' },
  'gallery.filter.repro': { zh: '复现状态', en: 'Repro status' },
  'gallery.all': { zh: '全部', en: 'All' },
  'gallery.open': { zh: '在 Studio 中打开', en: 'Open in Studio' },
  'gallery.repro.ok': { zh: '可复现', en: 'Reproducible' },
  'gallery.repro.partial': { zh: '部分复现', en: 'Partial' },
  'gallery.repro.none': { zh: '仅展示', en: 'Display only' },
  'gallery.empty': { zh: '没有符合筛选条件的作品', en: 'No works match the current filters' },
  'themes.title': { zh: '主题市场', en: 'Theme Marketplace' },
  'themes.desc': {
    zh: '以 .cstheme 包分发的外观主题：配色、字体与密度，应用后全工作站一致生效，图表配色联动。',
    en: 'Appearance themes shipped as .cstheme packages: colors, fonts and density — applied consistently across the workstation, charts included.',
  },
  'themes.apply': { zh: '在 Studio 中应用', en: 'Apply in Studio' },
  'themes.preview': { zh: '预览', en: 'Preview' },
  'themes.dark': { zh: '深色基调', en: 'Dark base' },
  'themes.light': { zh: '浅色基调', en: 'Light base' },
  'plugins.title': { zh: '插件市场', en: 'Plugin Marketplace' },
  'plugins.desc': {
    zh: '经 ed25519 签名校验的 .cspkg 插件包。浏览、下载并在工作站中一键安装，全部运行于沙箱内。',
    en: 'ed25519-signed .cspkg plugin packages. Browse, download and install them in the workstation — everything runs inside a sandbox.',
  },
  'plugins.search': { zh: '搜索插件名称、标签…', en: 'Search plugins by name, tag…' },
  'plugins.category': { zh: '分类', en: 'Category' },
  'plugins.cat.scientific': { zh: '科学', en: 'Scientific' },
  'plugins.cat.fun': { zh: '趣味', en: 'Fun' },
  'plugins.cat.utility': { zh: '工具', en: 'Utility' },
  'plugins.installs': { zh: '{n} 次安装', en: '{n} installs' },
  'plugins.download': { zh: '下载 .cspkg', en: 'Download .cspkg' },
  'plugins.install': { zh: '在 Studio 中安装', en: 'Install in Studio' },
  'plugins.signed': { zh: '已签名', en: 'Signed' },
  'plugins.author': { zh: '作者', en: 'Author' },
  'plugins.version': { zh: '版本', en: 'Version' },
  'plugins.empty': { zh: '没有匹配的插件', en: 'No plugins match' },
  'common.by': { zh: '作者 {name}', en: 'by {name}' },
  // ---- home v2: stats strip ------------------------------------------------
  'stats.tools': { zh: '科研工具', en: 'Research tools' },
  'stats.modes': { zh: '工作模式', en: 'Work modes' },
  'stats.blocks': { zh: '流程区块', en: 'Flow blocks' },
  'stats.tests': { zh: '单元测试', en: 'Unit tests' },
  // ---- home v2: work modes -------------------------------------------------
  'modes.title': { zh: '四种工作模式', en: 'Four ways to work' },
  'modes.desc': {
    zh: '同一个外壳、同一份数据，按任务切换交互方式，随时可以来回。',
    en: 'One shell, one dataset — switch the interaction style per task and back again at any time.',
  },
  'modes.standard.tab': { zh: '标准', en: 'Standard' },
  'modes.standard.desc': {
    zh: '把 CSV、JSON 乃至 HDF5、NetCDF、FITS、Zarr、Parquet 直接拖进画布，图表立刻出现，参数滑块一动就重绘。不写一行代码，就能完成从原始数据到可发表图形的第一轮探索。',
    en: 'Drag CSV, JSON, HDF5, NetCDF, FITS, Zarr or Parquet straight onto the canvas — a chart appears at once and redraws as you move a slider. The first pass from raw file to publication-ready figure, with no code.',
  },
  'modes.standard.p1': { zh: '拖放导入 7 类科学数据格式', en: 'Drag-and-drop import for 7 scientific formats' },
  'modes.standard.p2': { zh: '26 个科研工具嵌入画布随开随用', en: '26 research tools open inside the canvas' },
  'modes.standard.p3': { zh: '参数即调即看，改动即时重绘', en: 'Every parameter change redraws instantly' },
  'modes.standard.p4': { zh: '结果存回项目，导出 .clproj 随身携带', en: 'Save back to the project, carry away as .clproj' },
  'modes.flow.tab': { zh: '流程', en: 'Flow' },
  'modes.flow.desc': {
    zh: '把一次完整分析搭成可视化的数据管线：从 38 个区块里取数据源、变换、过滤、数学、统计、单位与绘图，连线定义数据流向，每个节点都能逐步预览中间结果。改一处参数，管线自该处向后局部重算，不必整体重跑。',
    en: 'Build a whole analysis as a visual pipeline: pick sources, transforms, filters, math, statistics, units and plotting from 38 blocks, wire them up, and preview the intermediate result at every node. Change one parameter and only the affected part recomputes.',
  },
  'modes.flow.p1': { zh: '38 个区块覆盖七类处理步骤', en: '38 blocks across 7 processing stages' },
  'modes.flow.p2': { zh: '逐节点预览，中间结果看得见', en: 'Node-by-node preview of intermediate results' },
  'modes.flow.p3': { zh: '参数改动局部重算，无需整体重跑', en: 'Local recompute after a parameter change' },
  'modes.flow.p4': { zh: '管线随项目保存，随时继续编辑', en: 'Pipelines save with the project, editable anytime' },
  'modes.blocks.tab': { zh: '积木', en: 'Blocks' },
  'modes.blocks.desc': {
    zh: '为编程课堂设计：像拼积木一样搭出绘图与计算逻辑，同一份程序可一键切换成真实可运行的 Python / R 脚本。图形化不是终点，而是通向写代码的过渡——积木与代码一一对应，随时互切。',
    en: 'Designed for the classroom: snap blocks into plotting and computation logic, then flip the same program into real, runnable Python / R code. Visual programming is the on-ramp, not the destination — blocks and code map one-to-one.',
  },
  'modes.blocks.p1': { zh: '积木与代码一一对应，随时互切', en: 'Blocks and code map one-to-one, switch anytime' },
  'modes.blocks.p2': { zh: '生成的是能直接运行的脚本', en: 'What you generate actually runs' },
  'modes.blocks.p3': { zh: '覆盖绘图、数学与统计入门场景', en: 'Covers plotting, math and stats starters' },
  'modes.blocks.p4': { zh: '与项目数据、运行记录共享同一环境', en: 'Shares one environment with project data' },
  'modes.code.tab': { zh: '代码', en: 'Code' },
  'modes.code.desc': {
    zh: '熟悉 Python 或 R 的研究者直接写脚本：studio.load() 读入项目数据集，studio.plot() 出图，CPython（Pyodide）与 webR 解释器随应用自托管、就跑在页面里，DuckDB-WASM 负责 SQL 查询。控制台即时反馈，每次运行自动留痕、可复现。',
    en: 'Researchers who already write Python or R work in a real script: studio.load() pulls project datasets, studio.plot() draws figures — CPython (Pyodide) and webR ship with the app and run in the page, with DuckDB-WASM for SQL. Console feedback is immediate, and every run leaves a reproducible record.',
  },
  'modes.code.p1': { zh: 'CPython（Pyodide）/ webR 0.6.0 / DuckDB-WASM', en: 'CPython (Pyodide) / webR 0.6.0 / DuckDB-WASM' },
  'modes.code.p2': { zh: 'studio API 直连项目数据与图表', en: 'studio API wired straight to project data' },
  'modes.code.p3': { zh: '控制台即时反馈，补全随输入出现', en: 'Console feedback as you type' },
  'modes.code.p4': { zh: '运行记录自动留痕，结果可复现', en: 'Reproducible run records, kept automatically' },
  // ---- home v2: research toolbelt ------------------------------------------
  'toolbelt.title': { zh: '26 个科研工具，六个分组', en: '26 research tools, six groups' },
  'toolbelt.desc': {
    zh: '全部内建、随开随用，可嵌入画布，也可作为独立页面打开。',
    en: 'All built in and ready to open — embed them in the canvas or launch them standalone.',
  },
  'toolbelt.g.measure': { zh: '测量', en: 'Measure' },
  'toolbelt.g.model': { zh: '建模', en: 'Model' },
  'toolbelt.g.data': { zh: '数据', en: 'Data' },
  'toolbelt.g.signal': { zh: '信号', en: 'Signal' },
  'toolbelt.g.deliver': { zh: '交付', en: 'Deliver' },
  'toolbelt.g.utils': { zh: '常用', en: 'Utilities' },
  'toolbelt.tool.uncertainty': { zh: '不确定性套件', en: 'Uncertainty suite' },
  'toolbelt.tool.profiler': { zh: '数据画像', en: 'Data Profiler' },
  'toolbelt.tool.model-lab': { zh: '模型工作台', en: 'Model Lab' },
  'toolbelt.tool.inference': { zh: '贝叶斯推断', en: 'Inference Forge' },
  'toolbelt.tool.model-inference': { zh: '模型推理', en: 'Model Inference' },
  'toolbelt.tool.sweeps': { zh: '参数扫描', en: 'Parameter Sweeps' },
  'toolbelt.tool.sql': { zh: 'SQL 数据工作台', en: 'SQL Data Workbench' },
  'toolbelt.tool.lineage': { zh: '数据血缘', en: 'Data Lineage' },
  'toolbelt.tool.figures': { zh: '图表工作台', en: 'Figure Studio' },
  'toolbelt.tool.analysis': { zh: '数据分析', en: 'Data Analysis' },
  'toolbelt.tool.cleaning': { zh: '数据清洗向导', en: 'Data Cleaning Wizard' },
  'toolbelt.tool.files': { zh: '文件资源管理器', en: 'File Explorer' },
  'toolbelt.tool.signal': { zh: '信号实验室', en: 'Signal Lab' },
  'toolbelt.tool.notebook': { zh: 'Notebook', en: 'Notebook' },
  'toolbelt.tool.runs': { zh: '实验记录', en: 'Run History' },
  'toolbelt.tool.report': { zh: '报告生成器', en: 'Report Builder' },
  'toolbelt.tool.reprolock': { zh: '可复现锁', en: 'Reproducibility Lock' },
  'toolbelt.tool.supplement': { zh: '补充材料打包', en: 'Supplementary Materials' },
  'toolbelt.tool.course': { zh: '课程模式', en: 'Course Mode' },
  'toolbelt.tool.gallery': { zh: '作品画廊', en: 'Gallery' },
  'toolbelt.tool.unit-convert': { zh: '单位换算', en: 'Unit Converter' },
  'toolbelt.tool.calc': { zh: '公式计算器', en: 'Formula Calculator' },
  'toolbelt.tool.format-convert': { zh: '格式转换器', en: 'Format Converter' },
  'toolbelt.tool.sigfig': { zh: '有效数字修约', en: 'Significant Figures' },
  'toolbelt.tool.molar-mass': { zh: '摩尔质量计算', en: 'Molar Mass' },
  'toolbelt.tool.quick-stats': { zh: '统计速算', en: 'Quick Stats' },
  'toolbelt.more': { zh: '查看全部 26 个工具', en: 'View all 26 tools' },
  // ---- home v2: kernels & runtimes -----------------------------------------
  'kernel.title': { zh: '内核与运行时', en: 'Kernels & runtimes' },
  'kernel.desc': {
    zh: '计算不出浏览器：GPU 内核负责加速，CPU 对照实现负责校验，脚本运行时随应用自托管。',
    en: 'Compute stays in the browser: GPU kernels for speed, CPU counterparts for verification, script runtimes self-hosted with the app.',
  },
  'kernel.wgsl.t': { zh: 'WGSL 计算内核', en: 'WGSL compute kernels' },
  'kernel.wgsl.d': {
    zh: '重采样、随机模拟与渲染内核跑在 WebGPU 上逐帧调度；每个内核都配一条数学一致的 CPU 对照实现，可校验、可回退。',
    en: 'Resampling, simulation and rendering kernels run on WebGPU, scheduled per frame; each kernel ships a mathematically consistent CPU counterpart for verification and fallback.',
  },
  'kernel.rt.t': { zh: '脚本运行时', en: 'Script runtimes' },
  'kernel.rt.py': { zh: 'NumPy / SciPy 生态直接可用', en: 'The NumPy / SciPy ecosystem as-is' },
  'kernel.rt.r': { zh: '基础 R 统计与图形', en: 'Base R statistics and graphics' },
  'kernel.rt.sql': { zh: '就地查询 Parquet / CSV', en: 'Query Parquet / CSV in place' },
  'kernel.fmt.t': { zh: '统一导入', en: 'One import path' },
  'kernel.fmt.d': {
    zh: '七种格式走同一条导入链路，每次导入都写入数据血缘。',
    en: 'Seven formats through one import path, every import recorded in lineage.',
  },
  // ---- home v2: reproducibility --------------------------------------------
  'repro.title': { zh: '可复现，是默认行为', en: 'Reproducible by default' },
  'repro.desc': {
    zh: '从一次分析到可以发表，路径固定为三步。',
    en: 'From one analysis to something publishable, the path is the same three steps.',
  },
  'repro.s1.t': { zh: '分析', en: 'Analyze' },
  'repro.s1.d': {
    zh: '在任一模式下完成分析；参数、随机种子与数据指纹自动记入实验记录。',
    en: 'Do the analysis in any mode; parameters, seeds and data fingerprints land in the run history automatically.',
  },
  'repro.s2.t': { zh: '锁定', en: 'Lock' },
  'repro.s2.d': {
    zh: 'repro.lock 把环境、参数与代码冻结成一份记录，交给谁都跑得出同一结果。',
    en: 'repro.lock freezes environment, parameters and code into one record that re-runs to the same result.',
  },
  'repro.s3.t': { zh: '归档', en: 'Archive' },
  'repro.s3.d': {
    zh: '.clproj 单文件导出，数据不被私有格式包装；随附引用元数据，可交 Zenodo 归档铸 DOI。',
    en: 'Export as a single .clproj — data never wrapped in a proprietary format — with citation metadata ready for Zenodo archival and a DOI.',
  },
  'repro.gate': {
    zh: '供应链同样有门禁：插件经 .cspkg 签名校验安装，发布物附带 SBOM 与 CITATION.cff。',
    en: 'The supply chain is gated too: plugins install only through signed .cspkg checks, and releases ship with an SBOM and CITATION.cff.',
  },
  // ---- home v2: closing ------------------------------------------------------
  'closing.title': {
    zh: '一个装好 26 个工具、14 个内核和 Python / R 的浏览器标签页，等你拖入第一个数据文件。',
    en: 'One browser tab with 26 tools, 14 kernels, Python and R — waiting for your first data file.',
  },
  'closing.note': {
    zh: 'MIT 开源 · 零安装 · 数据本地处理 · OPFS / IndexedDB 本地持久化',
    en: 'MIT licensed · zero install · local data · persisted in OPFS / IndexedDB',
  },
  // ---- footer v2 --------------------------------------------------------------
  'footer.citation': { zh: '引用 CITATION.cff', en: 'Citation (CITATION.cff)' },
  'footer.sbom': { zh: 'SBOM 工作流', en: 'SBOM workflow' },
  'footer.doi': {
    zh: '发版经 Zenodo 归档铸 DOI · 插件 .cspkg 签名门禁',
    en: 'Releases archived on Zenodo with a DOI · signed .cspkg plugin gate',
  },
};

const STORAGE_KEY = 'ergalics-website:lang';

let current: Locale = (() => {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'zh-CN' || saved === 'en-US') return saved;
  } catch { /* ignore */ }
  return 'zh-CN';
})();

const listeners = new Set<() => void>();

export function getLocale(): Locale {
  return current;
}

export function setLocale(l: Locale) {
  current = l;
  try { localStorage.setItem(STORAGE_KEY, l); } catch { /* ignore */ }
  document.documentElement.lang = l;
  listeners.forEach((fn) => fn());
}

export function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function t(key: string, params?: Record<string, string | number>): string {
  const entry = D[key];
  let text = entry ? entry[current === 'zh-CN' ? 'zh' : 'en'] : key;
  if (params) for (const [k, v] of Object.entries(params)) text = text.replaceAll(`{${k}}`, String(v));
  return text;
}

export function pickLocal(v: { zh: string; en: string } | undefined): string {
  if (!v) return '';
  return current === 'zh-CN' ? v.zh : v.en;
}
