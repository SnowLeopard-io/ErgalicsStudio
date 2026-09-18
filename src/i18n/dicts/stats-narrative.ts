// FR-02 statistical narrative (report auto-writing) — module dictionary
// (zh-CN / en-US). Merged into the base catalogs by src/i18n/modules.ts;
// keys use the `narrative.` prefix.
import type { LocaleDictionary } from '../types';

export const statsNarrativeZh: LocaleDictionary = {
  'narrative.generate': '生成表述',
  'narrative.title': '结果表述',
  'narrative.copy': '复制',
  'narrative.insert': '插入报告',
  'narrative.copied': '已复制到剪贴板',
  'narrative.copy_failed': '复制失败，请手动选择文本复制。',
  'narrative.inserted': '已插入报告：{name}',
  'narrative.insert_failed': '插入失败：请先打开一个项目。',
  'narrative.default_report': '统计结果段落',
  'narrative.new_report': '新建报告',
};

export const statsNarrativeEn: LocaleDictionary = {
  'narrative.generate': 'Generate text',
  'narrative.title': 'Result narrative',
  'narrative.copy': 'Copy',
  'narrative.insert': 'Insert into report',
  'narrative.copied': 'Copied to clipboard',
  'narrative.copy_failed': 'Copy failed; select the text manually.',
  'narrative.inserted': 'Inserted into report: {name}',
  'narrative.insert_failed': 'Insert failed: open a project first.',
  'narrative.default_report': 'Statistical results',
  'narrative.new_report': 'New report',
};
