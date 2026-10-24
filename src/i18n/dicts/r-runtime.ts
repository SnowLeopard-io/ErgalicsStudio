// FR-04 full R runtime — module dictionary (zh-CN / en-US).
// Merged into the base catalogs by src/i18n/modules.ts; keys use the `r.`
// prefix. Covers the engine badge, boot progress, console channel labels,
// interrupt/restart feedback and the package-install affordances.
import type { LocaleDictionary } from '../types';

export const rRuntimeZh: LocaleDictionary = {
  'r.engine.badge.full': '完整 R',
  'r.engine.badge.builtin': '内置 IR',
  'r.engine.tooltip.full': 'R 引擎 · webR 完整运行时（自由语法 + 第三方包）',
  'r.engine.tooltip.builtin': 'R 引擎 · 内置 IR 解释器（studio DSL）',
  'r.loading.full': '正在加载完整 R 运行时… {percent}%',
  'r.fallback.notice': '完整 R 运行时不可用，已回退到内置 IR 引擎：{reason}',
  'r.console.full_prefix': '[完整 R]',
  'r.dsl.degraded': '[DSL 降级提示] 注意：{count} 条语句无法在内置 R 引擎中执行，已跳过（完整 R 语法请使用完整 R 运行时）',
  'r.interrupted': '运行已中断，R 运行时正在重启…',
  'r.restart.done': 'R 运行时已重启并就绪',
  'r.install.placeholder': '包名（CRAN）',
  'r.install.button': '安装包',
  'r.install.hint': '正在安装 {pkg}：一次仅限少量包且受内存/时间预算限制，大型包可能失败',
  'r.install.success': '包 {pkg} 安装完成',
  'r.install.failed': '安装包 {pkg} 失败：{error}',
  'r.install.unsupported': '内置 IR 引擎无法安装包 — 请加载完整 R 运行时',
};

export const rRuntimeEn: LocaleDictionary = {
  'r.engine.badge.full': 'Full R',
  'r.engine.badge.builtin': 'Built-in IR',
  'r.engine.tooltip.full': 'R engine · webR full runtime (free syntax + third-party packages)',
  'r.engine.tooltip.builtin': 'R engine · built-in IR interpreter (studio DSL)',
  'r.loading.full': 'Loading full R runtime… {percent}%',
  'r.fallback.notice': 'Full R runtime unavailable — fell back to the built-in IR engine: {reason}',
  'r.console.full_prefix': '[Full R]',
  'r.dsl.degraded': '[DSL degrade notice] Note: {count} statement(s) cannot run in the built-in R engine and were skipped (use the full R runtime for complete R syntax)',
  'r.interrupted': 'Run interrupted — restarting the R runtime…',
  'r.restart.done': 'R runtime restarted and ready',
  'r.install.placeholder': 'package name (CRAN)',
  'r.install.button': 'Install',
  'r.install.hint': 'Installing {pkg}: limited to a few packages within the memory/time budget — large packages may fail',
  'r.install.success': 'Package {pkg} installed',
  'r.install.failed': 'Failed to install package {pkg}: {error}',
  'r.install.unsupported': 'The built-in IR engine cannot install packages — load the full R runtime',
};
