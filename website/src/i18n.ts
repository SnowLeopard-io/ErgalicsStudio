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
    zh: '为需要可复现分析的研究者与学生而做：163 个内置插件、33 个科研工具、14 个 WGSL 内核与 Python / R 运行时全部在本地页面内运行——数据不上传，也无需安装。',
    en: 'Built for researchers and students who need reproducible analysis: 163 built-in plugins, 33 research tools, 14 WGSL kernels and the Python / R runtimes all run locally in the page — no uploads, no installs.',
  },
  'hero.cta': { zh: '进入工作台', en: 'Enter the Workbench' },
  'hero.cta2': { zh: '浏览示例画廊', en: 'Browse the examples' },
  'features.title': { zh: '为真实科研链路而设计', en: 'Designed for the real research chain' },
  'f1.t': { zh: '四种模式 · 一份 IR', en: 'Four modes · one IR' },
  'f1.d': {
    zh: '标准、流程、积木与 Python / R / JavaScript 代码模式围绕同一中间表示互转，切换语言不丢语义。',
    en: 'Standard, flow, blocks and the Python / R / JavaScript code mode interconvert over one shared IR — switch languages without losing semantics.',
  },
  'f2.t': { zh: '33 个科研工具 · 7 个分组', en: '33 research tools · 7 groups' },
  'f2.d': {
    zh: '测量与不确定性、模型与贝叶斯推断、SQL / ETL / 数据画像、信号实验室、Figure Studio、报告与复现锁、文献与协作……统一外壳，随取随用。',
    en: 'Measurement and uncertainty, modeling and Bayesian inference, SQL / ETL / profiling, signal lab, Figure Studio, reports and repro locks, citation and collaboration — one consistent shell for every tool.',
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
    zh: '内置插件共 163 个，按 19 个学科组织。本页提供 12 个可下载、经 ed25519 签名的 .cspkg 演示包，可在工作站的沙箱内安装运行。',
    en: 'The workstation ships with 163 built-in plugins across 19 disciplines. This page offers 12 downloadable, ed25519-signed .cspkg demo packages that install and run inside its sandbox.',
  },
  'plugins.countline': { zh: '163 个内置插件 · 19 个学科 · 12 个演示包', en: '163 built-in plugins · 19 disciplines · 12 demo packages' },
  'plugins.sort.installs': { zh: '演示热度', en: 'Demo score' },
  'plugins.sort.updated': { zh: '最近更新', en: 'Recently updated' },
  'plugins.search': { zh: '搜索插件名称、标签…', en: 'Search plugins by name, tag…' },
  'plugins.category': { zh: '分类', en: 'Category' },
  'plugins.cat.scientific': { zh: '科学', en: 'Scientific' },
  'plugins.cat.fun': { zh: '趣味', en: 'Fun' },
  'plugins.cat.utility': { zh: '工具', en: 'Utility' },
  'plugins.installs': { zh: '演示热度 {n}', en: 'demo score {n}' },
  'plugins.download': { zh: '下载 .cspkg', en: 'Download .cspkg' },
  'plugins.install': { zh: '在 Studio 中安装', en: 'Install in Studio' },
  'plugins.signed': { zh: '已签名', en: 'Signed' },
  'plugins.author': { zh: '作者', en: 'Author' },
  'plugins.version': { zh: '版本', en: 'Version' },
  'plugins.empty': { zh: '没有匹配的插件', en: 'No plugins match' },
  'common.by': { zh: '作者 {name}', en: 'by {name}' },
  // ---- home v2: stats strip ------------------------------------------------
  'stats.plugins': { zh: '内置插件', en: 'Built-in plugins' },
  'stats.disciplines': { zh: '学科分组', en: 'Disciplines' },
  'stats.tools': { zh: '科研工具', en: 'Research tools' },
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
    en: 'Drag CSV, JSON, HDF5, NetCDF, FITS, Zarr or Parquet straight onto the canvas — a chart appears at once and redraws as a slider moves. The first pass from raw file to publication-ready figure, with no code.',
  },
  'modes.standard.p1': { zh: '拖放导入 7 类科学数据格式', en: 'Drag-and-drop import for 7 scientific formats' },
  'modes.standard.p2': { zh: '33 个科研工具嵌入画布随开随用', en: '33 research tools open inside the canvas' },
  'modes.standard.p3': { zh: '参数即调即看，改动即时重绘', en: 'Every parameter change redraws instantly' },
  'modes.standard.p4': { zh: '结果存回项目，导出 .clproj 随身携带', en: 'Save back to the project, carry away as .clproj' },
  'modes.flow.tab': { zh: '流程', en: 'Flow' },
  'modes.flow.desc': {
    zh: '把一次完整分析搭成可视化的数据管线：从 53 个区块里取数据源、变换、过滤、数学、统计、单位、可视化与绘图，连线定义数据流向，每个节点都能逐步预览中间结果。改一处参数，管线自该处向后局部重算，不必整体重跑。',
    en: 'Build a whole analysis as a visual pipeline: pick sources, transforms, filters, math, statistics, units, views and plotting from 53 blocks, wire them up, and preview the intermediate result at every node. Change one parameter and only the affected part recomputes.',
  },
  'modes.flow.p1': { zh: '53 个区块覆盖八类处理步骤', en: '53 blocks across 8 processing stages' },
  'modes.flow.p2': { zh: '逐节点预览，中间结果看得见', en: 'Node-by-node preview of intermediate results' },
  'modes.flow.p3': { zh: '参数改动局部重算，无需整体重跑', en: 'Local recompute after a parameter change' },
  'modes.flow.p4': { zh: '管线随项目保存，随时继续编辑', en: 'Pipelines save with the project, editable anytime' },
  'modes.blocks.tab': { zh: '积木', en: 'Blocks' },
  'modes.blocks.desc': {
    zh: '为编程课堂设计：像拼积木一样搭出绘图与计算逻辑，同一份程序可一键切换成真实可运行的 Python / R 脚本。图形化不是终点，而是通向写代码的过渡——积木与代码一一对应，随时互切。',
    en: 'Designed for the classroom: snap blocks into plotting and computation logic, then flip the same program into real, runnable Python / R code. Visual programming is the on-ramp, not the destination — blocks and code map one-to-one.',
  },
  'modes.blocks.p1': { zh: '积木与代码一一对应，随时互切', en: 'Blocks and code map one-to-one, switch anytime' },
  'modes.blocks.p2': { zh: '生成的是能直接运行的脚本', en: 'Generated scripts actually run' },
  'modes.blocks.p3': { zh: '覆盖绘图、数学与统计入门场景', en: 'Covers plotting, math and stats starters' },
  'modes.blocks.p4': { zh: '与项目数据、运行记录共享同一环境', en: 'Shares one environment with project data' },
  'modes.code.tab': { zh: '代码', en: 'Code' },
  'modes.code.desc': {
    zh: '熟悉 Python 或 R 的研究者直接写脚本：studio.load() 读入项目数据集，studio.plot() 出图，CPython（Pyodide）与 webR 解释器随应用自托管、就跑在页面里，DuckDB-WASM 负责 SQL 查询。控制台即时反馈，每次运行自动留痕、可复现。',
    en: 'Researchers who already write Python or R work in a real script: studio.load() pulls project datasets, studio.plot() draws figures — CPython (Pyodide) and webR ship with the app and run in the page, with DuckDB-WASM for SQL. Console feedback is immediate, and every run leaves a reproducible record.',
  },
  'modes.code.p1': { zh: 'CPython（Pyodide）/ webR 0.6.0 / DuckDB-WASM', en: 'CPython (Pyodide) / webR 0.6.0 / DuckDB-WASM' },
  'modes.code.p2': { zh: 'studio API 直连项目数据与图表', en: 'studio API wired straight to project data' },
  'modes.code.p3': { zh: '控制台即时反馈，补全随输入出现', en: 'Live console feedback and input completion' },
  'modes.code.p4': { zh: '运行记录自动留痕，结果可复现', en: 'Reproducible run records, kept automatically' },
  // ---- home v2: research toolbelt ------------------------------------------
  'toolbelt.title': { zh: '33 个科研工具，七个分组', en: '33 research tools, seven groups' },
  'toolbelt.desc': {
    zh: '全部内建、随开随用，可嵌入画布，也可作为独立页面打开。',
    en: 'All built in and ready to open — embed them in the canvas or launch them standalone.',
  },
  'toolbelt.g.measure': { zh: '测量', en: 'Measure' },
  'toolbelt.g.model': { zh: '建模', en: 'Model' },
  'toolbelt.g.data': { zh: '数据', en: 'Data' },
  'toolbelt.g.signal': { zh: '信号', en: 'Signal' },
  'toolbelt.g.deliver': { zh: '交付', en: 'Deliver' },
  'toolbelt.g.publish': { zh: '出版与协作', en: 'Publish' },
  'toolbelt.g.utils': { zh: '常用', en: 'Utilities' },
  'toolbelt.tool.uncertainty': { zh: '不确定性套件', en: 'Uncertainty suite' },
  'toolbelt.tool.profiler': { zh: '数据画像', en: 'Data Profiler' },
  'toolbelt.tool.model-lab': { zh: '模型工作台', en: 'Model Lab' },
  'toolbelt.tool.inference': { zh: '贝叶斯推断', en: 'Inference Forge' },
  'toolbelt.tool.model-inference': { zh: '模型推理', en: 'Model Inference' },
  'toolbelt.tool.sweeps': { zh: '参数扫描', en: 'Parameter Sweeps' },
  'toolbelt.tool.sql': { zh: 'SQL 数据工作台', en: 'SQL Data Workbench' },
  'toolbelt.tool.etl': { zh: 'ETL 管线', en: 'ETL Pipeline' },
  'toolbelt.tool.schema': { zh: '模式设计器', en: 'Schema Designer' },
  'toolbelt.tool.synth': { zh: '合成数据', en: 'Synthetic Data' },
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
  'toolbelt.tool.latex-editor': { zh: 'LaTeX 编辑器', en: 'LaTeX Editor' },
  'toolbelt.tool.citation-manager': { zh: '文献管理', en: 'Citation Manager' },
  'toolbelt.tool.collab-notebook': { zh: '协作 Notebook', en: 'Collaborative Notebook' },
  'toolbelt.tool.preprint': { zh: '预印本导出', en: 'Preprint Export' },
  'toolbelt.tool.unit-convert': { zh: '单位换算', en: 'Unit Converter' },
  'toolbelt.tool.calc': { zh: '公式计算器', en: 'Formula Calculator' },
  'toolbelt.tool.format-convert': { zh: '格式转换器', en: 'Format Converter' },
  'toolbelt.tool.sigfig': { zh: '有效数字修约', en: 'Significant Figures' },
  'toolbelt.tool.molar-mass': { zh: '摩尔质量计算', en: 'Molar Mass' },
  'toolbelt.tool.quick-stats': { zh: '统计速算', en: 'Quick Stats' },
  'toolbelt.more': { zh: '在插件市场查看相关插件', en: 'Browse related plugins' },
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
  // ---- home v2: overview -----------------------------------------------------
  'overview.kicker': { zh: '它是什么', en: 'What it is' },
  'overview.title': { zh: '把完整科研链路收进一个浏览器标签页', en: 'A complete research chain in one browser tab' },
  'overview.lead': {
    zh: 'Ergalics Studio 是一个本地优先的浏览器科研工作台。它把数据导入、可视化、统计检验、数值模拟与出版绘图集中到同一份可复现的项目中，减少在多个工具之间搬运数据与重复配置的环节。',
    en: 'Ergalics Studio is a local-first research workbench in the browser. It brings data import, visualization, statistical testing, numerical simulation and publication figures into a single reproducible project, reducing the data hand-offs and repeated setup that otherwise span several tools.',
  },
  'overview.p1.t': { zh: '数据不出本机', en: 'Data stays local' },
  'overview.p1.d': {
    zh: '文件在工作区 VFS 内解析；Python / R 与 DuckDB 运行时随应用自托管，分析过程不依赖远端服务器。',
    en: 'Files are parsed inside the workspace VFS; Python / R and DuckDB runtimes are self-hosted with the app, so analysis does not depend on a remote server.',
  },
  'overview.p2.t': { zh: '一条链路贯通', en: 'One chain, end to end' },
  'overview.p2.d': {
    zh: '从 7 类科学数据格式进入统一 DataTable，交由插件、流程、积木或代码处理，再导出图像、报告与 .clproj 项目。',
    en: 'Seven scientific data formats feed one DataTable, which is then handled by plugins, flows, blocks or code, and exported as figures, reports or .clproj projects.',
  },
  'overview.p3.t': { zh: '可复现可归档', en: 'Reproducible and archivable' },
  'overview.p3.d': {
    zh: '运行记录、数据血缘与 repro.lock 固化参数、随机种子和代码版本；单文件项目便于归档与协作。',
    en: 'Run records, lineage and repro.lock pin parameters, seeds and code versions; a single-file project keeps archiving and collaboration straightforward.',
  },
  'overview.pipe.label': { zh: '一次分析的主路径', en: 'The main path of one analysis' },
  'overview.step1': { zh: '导入', en: 'Import' },
  'overview.step2': { zh: '探索', en: 'Explore' },
  'overview.step3': { zh: '计算', en: 'Compute' },
  'overview.step4': { zh: '验证', en: 'Verify' },
  'overview.step5': { zh: '出版', en: 'Publish' },

  // ---- home v2: capability matrix -------------------------------------------
  'cap.title': { zh: '能力总览', en: 'Capabilities at a glance' },
  'cap.desc': {
    zh: '下列数字按当前源码清单统计：插件、工具与区块取自注册表，测试取自 vitest 清单。',
    en: 'Counts below are taken from the current source catalog: plugins, tools and blocks come from their registries; tests come from the vitest list.',
  },
  'cap.col.item': { zh: '项目', en: 'Item' },
  'cap.col.value': { zh: '当前实现', en: 'Current implementation' },
  'cap.row.plugins': { zh: '内置插件', en: 'Built-in plugins' },
  'cap.row.tools': { zh: '科研工具', en: 'Research tools' },
  'cap.row.flow': { zh: '流程区块', en: 'Flow blocks' },
  'cap.row.blocks': { zh: '积木区块', en: 'Block-mode blocks' },
  'cap.row.formats': { zh: '数据格式', en: 'Data formats' },
  'cap.row.runtimes': { zh: '脚本运行时', en: 'Script runtimes' },
  'cap.row.gpu': { zh: 'GPU 内核', en: 'GPU kernels' },
  'cap.row.tests': { zh: '自动化测试', en: 'Automated tests' },
  'cap.row.samples': { zh: '示例资产', en: 'Sample assets' },
  'cap.v.plugins': { zh: '163 个 · 19 个学科', en: '163 plugins · 19 disciplines' },
  'cap.v.tools': { zh: '33 个 · 7 个分组', en: '33 tools · 7 groups' },
  'cap.v.flow': { zh: '53 个 · 8 个类别', en: '53 blocks · 8 categories' },
  'cap.v.blocks': { zh: '40 个 · 10 个类别', en: '40 blocks · 10 categories' },
  'cap.v.formats': { zh: 'CSV、JSON、HDF5、NetCDF、FITS、Zarr、Parquet（7 类）', en: 'CSV, JSON, HDF5, NetCDF, FITS, Zarr, Parquet (7 formats)' },
  'cap.v.runtimes': { zh: 'Python（Pyodide）· R（webR 0.6.0）· JavaScript · SQL（DuckDB-WASM）', en: 'Python (Pyodide) · R (webR 0.6.0) · JavaScript · SQL (DuckDB-WASM)' },
  'cap.v.gpu': { zh: '14 个 WGSL 内核 · CPU 对照实现', en: '14 WGSL kernels · CPU counterparts' },
  'cap.v.tests': { zh: '3,878 个用例 · 241 个测试文件', en: '3,878 cases · 241 test files' },
  'cap.v.samples': { zh: '11 个示例项目 · 193 个示例数据文件', en: '11 sample projects · 193 sample data files' },

  // ---- home v2: disciplines -------------------------------------------------
  'disc.title': { zh: '19 个学科，163 个插件', en: '19 disciplines, 163 plugins' },
  'disc.desc': {
    zh: '插件按学科进入侧栏，同一套面板与数据模型贯穿所有领域；学科之间的差别落在数据与算法，而不是交互习惯。',
    en: 'Plugins are grouped into disciplines in the sidebar, and the same panels and data model span every field; what changes between disciplines is data and algorithms, not interaction habits.',
  },
  'disc.note': { zh: '横条长度按插件数量等比绘制，数字来自内置插件清单。', en: 'Bar length is proportional to plugin count, taken from the built-in plugin catalog.' },
  'disc.unit': { zh: '个插件', en: 'plugins' },
  'disc.charts': { zh: '图表', en: 'Charts' },
  'disc.math': { zh: '数学', en: 'Mathematics' },
  'disc.physics': { zh: '物理', en: 'Physics' },
  'disc.geo': { zh: '地球科学', en: 'Earth science' },
  'disc.engineering': { zh: '工程', en: 'Engineering' },
  'disc.fun': { zh: '趣味', en: 'Fun' },
  'disc.data': { zh: '数据', en: 'Data' },
  'disc.env': { zh: '环境', en: 'Environment' },
  'disc.cs': { zh: '计算机', en: 'Computer science' },
  'disc.fx': { zh: '特效', en: 'Effects' },
  'disc.bio': { zh: '生物', en: 'Biology' },
  'disc.med': { zh: '医学', en: 'Medicine' },
  'disc.artsci': { zh: '艺术科学', en: 'Art science' },
  'disc.chem': { zh: '化学', en: 'Chemistry' },
  'disc.socio': { zh: '社会科学', en: 'Social science' },
  'disc.astro': { zh: '天文', en: 'Astronomy' },
  'disc.materials': { zh: '材料', en: 'Materials' },
  'disc.econ': { zh: '经济', en: 'Economics' },
  'disc.psych': { zh: '心理', en: 'Psychology' },

  // ---- home v2: scenarios ---------------------------------------------------
  'scen.title': { zh: '适用场景', en: 'Where it fits' },
  'scen.desc': {
    zh: '同一套环境覆盖从课程演示到论文归档的不同环节，规模由数据与计算决定，而不是由软件授权决定。',
    en: 'One environment covers everything from a classroom demonstration to paper archiving; scale is set by data and computation, not by software licensing.',
  },
  'scen.research.t': { zh: '研究分析', en: 'Research analysis' },
  'scen.research.d': {
    zh: '导入 HDF5、NetCDF 或 FITS，完成清洗、统计检验与多元分析，再用 Figure Studio 生成出版图。',
    en: 'Import HDF5, NetCDF or FITS, clean and test the data, run multivariate analysis, then produce publication figures in Figure Studio.',
  },
  'scen.research.eg': { zh: 'HDF5 / NetCDF / FITS · 统计检验 · Figure Studio', en: 'HDF5 / NetCDF / FITS · statistical tests · Figure Studio' },
  'scen.teaching.t': { zh: '教学与演示', en: 'Teaching and demonstration' },
  'scen.teaching.d': {
    zh: '同一份数据在标准、流程、积木与代码模式之间切换；积木可直接生成 Python / R 代码，便于拆解计算过程。',
    en: 'The same data moves between standard, flow, block and code modes; blocks generate runnable Python / R so the computation can be taken apart.',
  },
  'scen.teaching.eg': { zh: '标准模式 · 积木 · Python / R 代码', en: 'Standard mode · blocks · Python / R' },
  'scen.simulation.t': { zh: '数值模拟', en: 'Numerical simulation' },
  'scen.simulation.d': {
    zh: 'N 体引力、LBM 流体、热传导、结构 FEM 与 1D–3D CFD 耦合；GPU 不可用时回退到 CPU 实现。',
    en: 'N-body gravity, LBM fluids, heat conduction, structural FEM and 1D–3D CFD coupling; CPU implementations take over when GPU is unavailable.',
  },
  'scen.simulation.eg': { zh: 'N 体引力 · LBM 流体 · 波动方程 · CFD 耦合', en: 'N-body · LBM fluid · wave equation · CFD coupling' },
  'scen.open.t': { zh: '开放科学与归档', en: 'Open science and archiving' },
  'scen.open.d': {
    zh: '单文件 .clproj、工作区 Git、repro.lock、补充材料打包与 CITATION.cff 构成完整归档路径。',
    en: 'A single-file .clproj, workspace Git, repro.lock, supplementary packaging and CITATION.cff form a complete archiving path.',
  },
  'scen.open.eg': { zh: '.clproj · repro.lock · Git · CITATION.cff', en: '.clproj · repro.lock · Git · CITATION.cff' },

  // ---- home v2: getting started ---------------------------------------------
  'start.title': { zh: '获取与参与', en: 'Get started and contribute' },
  'start.desc': {
    zh: '在线打开，或从源码构建；文档、SDK 与协作入口都在同一个仓库。',
    en: 'Open it online or build from source; documentation, the SDK and collaboration entry points all live in the same repository.',
  },
  'start.s1.t': { zh: '在线使用', en: 'Use it online' },
  'start.s1.d': { zh: '现代浏览器直接打开；WebGPU 在 Chrome / Edge 上启用，其余能力自动回退。', en: 'Open it in a modern browser; WebGPU is enabled on Chrome / Edge and other capabilities fall back automatically.' },
  'start.s1.cta': { zh: '进入工作台', en: 'Open the workbench' },
  'start.s2.t': { zh: '阅读文档', en: 'Read the documentation' },
  'start.s2.d': { zh: '快速开始、架构说明、四种工作模式、插件 SDK v1 契约与十章技术文档。', en: 'Quick start, architecture, four work modes, the plugin SDK v1 contract and ten technical chapters.' },
  'start.s2.cta': { zh: '浏览文档', en: 'Browse docs' },
  'start.s3.t': { zh: '参与贡献', en: 'Contribute' },
  'start.s3.d': { zh: '源码、Issue 与插件模板位于 GitHub / Gitee；项目以 MIT 许可发布。', en: 'Source, issues and plugin templates live on GitHub / Gitee; the project is released under MIT.' },
  'start.s3.cta': { zh: 'GitHub · Gitee', en: 'GitHub · Gitee' },
  'start.s4.t': { zh: '引用与归档', en: 'Cite and archive' },
  'start.s4.d': { zh: '每版发布附带 CITATION.cff、SBOM 与 Zenodo DOI 归档。', en: 'Each release ships with CITATION.cff, an SBOM and a Zenodo DOI archive.' },
  'start.s4.cta': { zh: 'CITATION.cff', en: 'CITATION.cff' },

  // ---- home v2: closing ------------------------------------------------------
  'closing.title': {
    zh: '一个装好 163 个插件、33 个工具、14 个内核和 Python / R 的浏览器标签页，从第一个数据文件开始。',
    en: 'One browser tab with 163 plugins, 33 tools, 14 kernels, Python and R — starting with a first data file.',
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
