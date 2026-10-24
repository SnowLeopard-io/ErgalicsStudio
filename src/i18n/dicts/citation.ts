// FR-10 software citation & archival — module dictionary (zh-CN / en-US).
// Merged into the base catalogs by src/i18n/modules.ts; keys use the
// `cite.` prefix.
import type { LocaleDictionary } from '../types';

export const citationZh: LocaleDictionary = {
  'cite.section_title': '引用本软件',
  'cite.intro': '在论文或报告中使用本软件时，请引用以下条目。引用信息与当前版本（{version}）一致。',
  'cite.bibtex_label': 'BibTeX',
  'cite.plain_label': '纯文本',
  'cite.copy_bibtex': '复制 BibTeX',
  'cite.copy_plain': '复制纯文本引用',
  'cite.copied': '引用条目已复制到剪贴板',
  'cite.copy_failed': '复制失败，请手动选择文本复制',
  'cite.doi_note': 'DOI 在发布 tagged release 并由 CI 完成 Zenodo 归档后自动生成。',
};

export const citationEn: LocaleDictionary = {
  'cite.section_title': 'Cite this software',
  'cite.intro': 'When using this software in a paper or report, please cite the entry below. It matches the current version ({version}).',
  'cite.bibtex_label': 'BibTeX',
  'cite.plain_label': 'Plain text',
  'cite.copy_bibtex': 'Copy BibTeX',
  'cite.copy_plain': 'Copy plain-text citation',
  'cite.copied': 'Citation copied to clipboard',
  'cite.copy_failed': 'Copy failed — select the text and copy it manually',
  'cite.doi_note': 'The DOI is minted automatically once a tagged release is archived to Zenodo by CI.',
};
