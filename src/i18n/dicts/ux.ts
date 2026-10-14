// UX 改进模块（命令面板 / 模式同步指示 / 状态栏性能弹层 / 面板拖拽 / 图表读出）
// Keys use the `ux.` prefix. Merged into the base catalogs by src/i18n/modules.ts.
import type { LocaleDictionary } from '../types';

export const uxZh: LocaleDictionary = {
  // ---- 全局命令面板 ----
  'ux.palette.title': '命令面板',
  'ux.palette.placeholder': '搜索命令…',
  'ux.palette.empty': '没有匹配的命令',
  'ux.palette.open': '命令面板 (Ctrl+K)',
  'ux.palette.groups.tools': '研究工具',
  'ux.palette.groups.actions': '操作',
  'ux.palette.groups.modes': '工作模式',
  'ux.palette.group.panel': '面板',
  'ux.palette.group.nav': '导航',
  // ---- 模式同步指示 ----
  'ux.mode.synced': 'Block / Code / Flow 三视图已同步',
  'ux.mode.diverged': '三视图内容不一致，切换模式后将自动同步',
  // ---- 状态栏性能弹层 ----
  'ux.perf.title': '性能详情',
  'ux.perf.fps': '帧率',
  'ux.perf.gpu': 'GPU 耗时',
  'ux.perf.memory': '存储占用',
  'ux.perf.jsheap': 'JS 堆',
  'ux.perf.scale': '数据规模',
  'ux.perf.warn_fps': '帧率偏低',
  'ux.perf.warn_memory': '存储占用偏高',
  'ux.perf.warn_compute': 'GPU 耗时偏高',
  'ux.perf.issues': '项告警',
  // ---- 长任务进度 ----
  'ux.progress.cancel': '取消',
  'ux.progress.computing': '计算中…',
  'ux.progress.loading': '加载中…',
  'ux.progress.saving': '保存中…',
  // ---- 面板拖拽 ----
  'ux.resize.sidebar': '拖拽调整侧栏宽度',
  'ux.resize.right': '拖拽调整参数栏宽度',
  // ---- 面板边缘收起/展开 ----
  'ux.panel.collapse_sidebar': '收起侧栏',
  'ux.panel.expand_sidebar': '展开侧栏',
  'ux.panel.collapse_right': '收起参数栏',
  'ux.panel.expand_right': '展开参数栏',
  // ---- AI 助手悬浮球 ----
  'ux.ai.open': '打开 AI 助手',
  // ---- 快捷键帮助 ----
  'ux.shortcuts.title': '快捷键',
  'ux.shortcuts.group.global': '全局',
  'ux.shortcuts.group.workbench': '工作台',
  'ux.shortcuts.group.palette': '命令面板',
  'ux.shortcuts.group.block': 'Block 编辑器',
  'ux.shortcuts.save': '保存项目',
  'ux.shortcuts.palette': '打开命令面板',
  'ux.shortcuts.help': '快捷键帮助',
  'ux.shortcuts.esc': '关闭对话框 / 面板',
  'ux.shortcuts.zoom': '缩放画布（以指针为中心）',
  'ux.shortcuts.reset_view': '重置 2D 视口',
  'ux.shortcuts.run_sql': '运行 SQL 查询',
  'ux.shortcuts.palette_nav': '选择命令',
  'ux.shortcuts.palette_go': '执行命令',
  'ux.shortcuts.palette_close': '关闭面板',
  'ux.shortcuts.block_delete': '删除选中节点',
  // ---- 2D 视口 ----
  'ux.view.reset': '滚轮缩放 · 双击画布或点击此处复位视图',
  // ---- 导航 ----
  'ux.nav.workbench': '工作台',
  'ux.nav.welcome': '欢迎页',
};

export const uxEn: LocaleDictionary = {
  // ---- global command palette ----
  'ux.palette.title': 'Command Palette',
  'ux.palette.placeholder': 'Type a command…',
  'ux.palette.empty': 'No matching commands',
  'ux.palette.open': 'Command palette (Ctrl+K)',
  'ux.palette.groups.tools': 'Research tools',
  'ux.palette.groups.actions': 'Actions',
  'ux.palette.groups.modes': 'Work modes',
  'ux.palette.group.panel': 'Panels',
  'ux.palette.group.nav': 'Navigate',
  // ---- mode sync indicator ----
  'ux.mode.synced': 'Block / Code / Flow views are in sync',
  'ux.mode.diverged': 'Views diverged — they re-sync when you switch modes',
  // ---- status-bar perf popover ----
  'ux.perf.title': 'Performance',
  'ux.perf.fps': 'Frame rate',
  'ux.perf.gpu': 'GPU time',
  'ux.perf.memory': 'Storage',
  'ux.perf.jsheap': 'JS heap',
  'ux.perf.scale': 'Data scale',
  'ux.perf.warn_fps': 'Low frame rate',
  'ux.perf.warn_memory': 'High memory',
  'ux.perf.warn_compute': 'High GPU time',
  'ux.perf.issues': 'issue(s)',
  // ---- long-task progress ----
  'ux.progress.cancel': 'Cancel',
  'ux.progress.computing': 'Computing…',
  'ux.progress.loading': 'Loading…',
  'ux.progress.saving': 'Saving…',
  // ---- panel resize ----
  'ux.resize.sidebar': 'Drag to resize sidebar',
  'ux.resize.right': 'Drag to resize parameter panel',
  // ---- panel edge collapse/expand ----
  'ux.panel.collapse_sidebar': 'Collapse sidebar',
  'ux.panel.expand_sidebar': 'Expand sidebar',
  'ux.panel.collapse_right': 'Collapse parameters panel',
  'ux.panel.expand_right': 'Expand parameters panel',
  // ---- AI assistant floating ball ----
  'ux.ai.open': 'Open AI assistant',
  // ---- keyboard shortcuts help ----
  'ux.shortcuts.title': 'Keyboard shortcuts',
  'ux.shortcuts.group.global': 'Global',
  'ux.shortcuts.group.workbench': 'Workbench',
  'ux.shortcuts.group.palette': 'Command palette',
  'ux.shortcuts.group.block': 'Block editor',
  'ux.shortcuts.save': 'Save project',
  'ux.shortcuts.palette': 'Open command palette',
  'ux.shortcuts.help': 'Keyboard shortcuts',
  'ux.shortcuts.esc': 'Close dialog / panel',
  'ux.shortcuts.zoom': 'Zoom canvas (around pointer)',
  'ux.shortcuts.reset_view': 'Reset 2D viewport',
  'ux.shortcuts.run_sql': 'Run SQL query',
  'ux.shortcuts.palette_nav': 'Select command',
  'ux.shortcuts.palette_go': 'Run command',
  'ux.shortcuts.palette_close': 'Close palette',
  'ux.shortcuts.block_delete': 'Delete selected node',
  // ---- 2D viewport ----
  'ux.view.reset': 'Wheel to zoom · double-click the canvas or click here to reset the view',
  // ---- navigation ----
  'ux.nav.workbench': 'Workbench',
  'ux.nav.welcome': 'Welcome',
};