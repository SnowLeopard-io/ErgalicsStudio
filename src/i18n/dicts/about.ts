// Settings "About" section — development team & project status (zh-CN / en-US).
// Merged into the base catalogs by src/i18n/modules.ts; keys use the
// `about.` prefix.
import type { LocaleDictionary } from '../types';

export const aboutZh: LocaleDictionary = {
  'about.repo_heading': '代码仓库',
  'about.status_heading': '项目状态',
  'about.status_text':
    'Ergalics Studio 正处于活跃开发阶段，正按路线图收口 V0.2 并推进浏览器端科学计算生态。核心能力在浏览器内离线运行，遵循 MIT 开源许可。欢迎以 Issue、Pull Request 或贡献示例/插件的方式参与共建。',
  'about.team_heading': '开发团队',
  'about.team_lead_role': '项目发起人 · 架构负责人',
  'about.team_lead_intro':
    '主导 Ergalics Studio 的整体路线与架构设计，负责应用外壳、核心框架与开放生态（插件、模板、可复现）建设。',
  'about.team_dev_role': '核心开发者',
  'about.team_dev_intro':
    '负责科研工具矩阵与数据、可视化、推理等核心模块的开发与打磨，保障功能与代码质量。',
};

export const aboutEn: LocaleDictionary = {
  'about.repo_heading': 'Repositories',
  'about.status_heading': 'Project status',
  'about.status_text':
    'Ergalics Studio is under active development: closing out the V0.2 line per the roadmap while pushing the browser-based scientific-computing ecosystem forward. Its core capabilities run offline in the browser under the MIT license. Contributions are welcome via issues, pull requests, or example/plugin submissions.',
  'about.team_heading': 'Development team',
  'about.team_lead_role': 'Project lead · Architect',
  'about.team_lead_intro':
    'owns the overall roadmap and architecture of Ergalics Studio — the app shell, the core framework, and the open-ecosystem efforts (plugins, templates, reproducibility).',
  'about.team_dev_role': 'Core developer',
  'about.team_dev_intro':
    'builds and refines the research-tool matrix and the data, visualization and inference modules, keeping features and code quality high.',
};