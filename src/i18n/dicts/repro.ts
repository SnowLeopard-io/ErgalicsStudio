// FR-11 repro lock v2 + FR-09 reproducible snapshot — module dictionary
// (zh-CN / en-US). Keys use the `repro2.` prefix so they never collide with
// the legacy `repro.` / `reprolock.` catalogs. Merged into the base catalogs
// by src/i18n/modules.ts.
import type { LocaleDictionary } from '../types';

export const reproZh: LocaleDictionary = {
  // --- lock v2 (ReproLockPage) ---
  'repro2.category_dependency': '依赖',
  'repro2.status_unknown': '未知（v1 锁未记录）',
  'repro2.upgrade_hint': '这是 v1 锁文件，缺少运行时与依赖指纹。建议：重新生成并导出 v2 锁。',
  'repro2.export_v2': '导出 v2',
  'repro2.lock_version': '锁格式 v{version}',
  'repro2.runtime': '运行时：{runtime}',
  'repro2.dependencies': '依赖指纹',
  'repro2.dep_suggestion': '建议：恢复锁内记录的运行环境（固定依赖版本或重装对应构建）后再信任新结果。',
  'repro2.verify_now': '立即校验',
  // --- run diff (RunsPage) ---
  'repro2.compare': '对比',
  'repro2.compare_hint': '勾选两条运行记录后点击「对比」查看结构化差异。',
  'repro2.diff_params': '参数差异',
  'repro2.diff_metrics': '指标差异',
  'repro2.diff_config': '配置差异',
  'repro2.diff_none': '无差异',
  'repro2.within_tol': '容差内',
  'repro2.export_diff': '导出 diff JSON',
  'repro2.diff_exported': 'diff JSON 已导出',
  'repro2.tolerance': '容差',
  'repro2.delta': 'Δ',
  // --- snapshot (ShareDialog) ---
  'repro2.snapshot_section': '可复现快照',
  'repro2.snapshot_mode': '复现快照',
  'repro2.legacy_mode': '原有分享',
  'repro2.snapshot_desc': '生成单个自包含 HTML：内嵌数据指纹、repro.lock、结果图与复现指引，接收方无需安装即可离线核对。快照不含原始数据文件。',
  'repro2.snapshot_export': '导出复现快照',
  'repro2.snapshot_saved': '复现快照已导出',
  'repro2.progress_collect': '收集项目摘要…',
  'repro2.progress_lock': '构建 repro.lock…',
  'repro2.progress_render': '渲染快照 HTML…',
  'repro2.progress_save': '保存文件…',
};

export const reproEn: LocaleDictionary = {
  // --- lock v2 (ReproLockPage) ---
  'repro2.category_dependency': 'Dependency',
  'repro2.status_unknown': 'unknown (v1 lock)',
  'repro2.upgrade_hint': 'This is a v1 lock without runtime/dependency fingerprints. Rebuild and export a v2 lock.',
  'repro2.export_v2': 'Export v2',
  'repro2.lock_version': 'Lock format v{version}',
  'repro2.runtime': 'Runtime: {runtime}',
  'repro2.dependencies': 'Dependency fingerprint',
  'repro2.dep_suggestion': 'Suggestion: restore the environment recorded in the lock (pin dependency versions or reinstall the build) before trusting new results.',
  'repro2.verify_now': 'Verify now',
  // --- run diff (RunsPage) ---
  'repro2.compare': 'Compare',
  'repro2.compare_hint': 'Tick two runs, then press Compare to see a structured diff.',
  'repro2.diff_params': 'Parameter differences',
  'repro2.diff_metrics': 'Metric differences',
  'repro2.diff_config': 'Configuration differences',
  'repro2.diff_none': 'none',
  'repro2.within_tol': 'within tolerance',
  'repro2.export_diff': 'Export diff JSON',
  'repro2.diff_exported': 'Diff JSON exported',
  'repro2.tolerance': 'Tolerance',
  'repro2.delta': 'Δ',
  // --- snapshot (ShareDialog) ---
  'repro2.snapshot_section': 'Reproducible snapshot',
  'repro2.snapshot_mode': 'Repro snapshot',
  'repro2.legacy_mode': 'Classic share',
  'repro2.snapshot_desc': 'One self-contained HTML with data fingerprints, the repro.lock, result figures and a reproduction guide — recipients verify offline without installing anything. Raw data files are never included.',
  'repro2.snapshot_export': 'Export repro snapshot',
  'repro2.snapshot_saved': 'Reproducible snapshot exported',
  'repro2.progress_collect': 'Collecting project summary…',
  'repro2.progress_lock': 'Building repro.lock…',
  'repro2.progress_render': 'Rendering snapshot HTML…',
  'repro2.progress_save': 'Saving file…',
};
