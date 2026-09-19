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
    zh: 'Ergalics Studio 技术文档与项目资料：完整技术总结、八章技术细节与双语项目说明，提供 PDF / HTML / Markdown 三种格式，可在线阅读或直接下载。',
    en: 'Technical documentation and project materials: the full technical summary, eight technical chapters and bilingual readmes in PDF / HTML / Markdown — read online or download.',
  },
  'nav.docs': { zh: '文档', en: 'Docs' },
  'nav.enter': { zh: '进入工作站', en: 'Enter Studio' },
  'footer.tagline': {
    zh: '浏览器端多模式科研计算工作站 · 零安装 · 本地隐私优先 · 开源免费',
    en: 'A browser-based multi-mode scientific computing workstation · zero install · privacy-first · open source',
  },
  'footer.links': { zh: '链接', en: 'Links' },
  'footer.license': { zh: 'MIT 许可', en: 'MIT License' },
  'hero.badge': { zh: 'v0.2 · WebGPU 原生加速', en: 'v0.2 · Native WebGPU acceleration' },
  'hero.title': {
    zh: '打开浏览器，开始一次可复现的科研分析',
    en: 'Open a browser. Run a reproducible scientific analysis.',
  },
  'hero.desc': {
    zh: 'Ergalics Studio 把统计、建模、信号处理、可视化与可复现性装进一个网页：积木、流程、代码、Notebook 四种模式共享同一份 IR，从导入数据到投稿材料一条链路完成。',
    en: 'Ergalics Studio packs statistics, modeling, signal processing, visualization and reproducibility into one web page: four modes (blocks, flow, code, notebook) share a single IR, taking you from raw data to submission-ready materials in one chain.',
  },
  'hero.cta': { zh: '立即进入工作站', en: 'Launch the workstation' },
  'hero.cta2': { zh: '浏览作品画廊', en: 'Browse the gallery' },
  'features.title': { zh: '为真实科研链路而设计', en: 'Designed for the real research chain' },
  'f1.t': { zh: '四种模式 · 一份 IR', en: 'Four modes · one IR' },
  'f1.d': {
    zh: '积木拖拽、流程编排、Python/JS 代码与混合 Notebook 围绕同一中间表示互转，切换语言不丢语义。',
    en: 'Block dragging, flow orchestration, Python/JS code and hybrid notebooks interconvert over one shared IR — switch languages without losing semantics.',
  },
  'f2.t': { zh: '15 个科研工具页', en: '15 research tool pages' },
  'f2.d': {
    zh: '不确定性传播、回归与贝叶斯推断、参数扫描、SQL 分析、信号实验室、Figure Studio、复现锁……统一外壳，随取随用。',
    en: 'Uncertainty propagation, regression & Bayesian inference, sweeps, SQL analytics, signal lab, Figure Studio, repro lock… one consistent shell for every tool.',
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
