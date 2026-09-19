#!/usr/bin/env node
// ==========================================================================
// Ergalics Studio — compendium assembler
//
// Builds docs/technical/"Ergalics Studio.md" out of the eight numbered
// chapter documents, plus a hand-written usage guide and a generated
// document index. The compendium is therefore a *derived* artefact: it can
// never drift from the chapters it summarises, which is how the previous
// hand-maintained version ended up quoting 40 plugins and 417 tests long
// after both numbers had changed.
//
// Usage: node scripts/build-tech-summary.mjs
// ==========================================================================

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DOCS_DIR = path.join(ROOT, 'docs', 'technical');

const read = (name) => readFileSync(path.join(DOCS_DIR, `${name}.md`), 'utf8');

/** Split a chapter document into its `## ` sections, dropping the H1 preamble. */
function sections(md) {
  const lines = md.replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let current = null;
  for (const line of lines) {
    const h2 = /^##\s+(.*)$/.exec(line);
    if (h2) {
      if (current) out.push(current);
      current = { title: h2[1].trim(), body: [] };
      continue;
    }
    if (!current) continue; // H1 / intro prose is dropped
    current.body.push(line);
  }
  if (current) out.push(current);
  // drop trailing blank lines
  for (const s of out) {
    while (s.body.length && !s.body[s.body.length - 1].trim()) s.body.pop();
  }
  return out;
}

/** "一、总体分层" → "总体分层" */
function stripCjkNumeral(title) {
  return title.replace(/^[一二三四五六七八九十]+\s*[、.]\s*/, '');
}

const CN = '一二三四五六七八九十';

/** 1 → 一 … 10 → 十, 11 → 十一 (the compendium has eleven chapters). */
function cnNum(n) {
  if (n <= 10) return CN[n - 1];
  if (n < 20) return '十' + CN[n - 11];
  return String(n);
}

/**
 * Re-level one source section into `### <ch>.<k> <title>`, rewriting its own
 * `### a.b` sub-headings to `#### <ch>.<k>.<b>` so the compendium numbering
 * stays internally consistent.
 */
function emitSection(ch, k, section) {
  const out = [`### ${ch}.${k} ${stripCjkNumeral(section.title)}`, ''];
  for (const line of section.body) {
    const h3 = /^###\s+(\d+(?:\.\d+)*)\s+(.*)$/.exec(line);
    if (h3) {
      const tail = h3[1].split('.').slice(-1)[0];
      out.push(`#### ${ch}.${k}.${tail} ${h3[2]}`);
      continue;
    }
    const h3plain = /^###\s+(.*)$/.exec(line);
    if (h3plain) {
      out.push(`#### ${h3plain[1]}`);
      continue;
    }
    const h4 = /^####\s+(.*)$/.exec(line);
    if (h4) {
      out.push(`##### ${h4[1]}`);
      continue;
    }
    out.push(line);
  }
  out.push('');
  return out;
}

function emitChapter(ch, title, sourceName, pick) {
  const src = sections(read(sourceName));
  const picked = pick ? src.filter((s, i) => pick(s, i + 1)) : src;
  const lines = [`## 第${cnNum(ch)}章 ${title}`, ''];
  picked.forEach((s, i) => lines.push(...emitSection(ch, i + 1, s)));
  return lines;
}

// ---- usage guide (unique to the compendium) -------------------------------

const USAGE = `## 第九章 使用指南

### 9.1 技术栈与环境要求

Ergalics Studio 是纯前端的单页应用，唯一的强依赖是一个现代浏览器；唯一可选的本地工具链是 Rust（只用于把原生核心编译成 WebAssembly，缺失时前端优雅降级）。

| 层级 | 选型 |
| --- | --- |
| 界面 | React 18、react-router-dom 7、Zustand 5 |
| 语言 | TypeScript 5.7（strict 模式） |
| 构建 | Vite 6 + Vitest |
| 可视化 | 原生 Canvas/WebGL、Three.js、WGSL 计算着色器 |
| 编辑器 | Monaco Editor、Blockly 13 |
| 运行时 | Pyodide（CPython）、DuckDB-WASM、TensorFlow.js |
| 科研 I/O | h5wasm、netcdfjs、fitsjs、zarrita、parquet-wasm（配 apache-arrow） |
| 打包与压缩 | fflate、lz-string |
| 原生核心 | Rust（wasm32-unknown-unknown）+ wasm-bindgen 0.2 |
| 端到端测试 | playwright-core 驱动无头 Edge |
| 协议 | MIT |

浏览器侧要求 WebGPU / WebAssembly / Web Worker / IndexedDB。WebGPU 与 WASM 均为可选：缺失时应用在欢迎页如实自检报告，并把计算回退到 CPU 实现。

### 9.2 安装、运行与构建

\`\`\`bash
npm install          # 安装依赖
npm run dev          # 启动开发服务器
npm run build        # 完整构建：WASM 核心 → 类型检查 → 打包 → 文档站
npm run build:web    # 只构建前端（跳过 Rust 步骤）
npm run preview      # 预览生产构建
\`\`\`

质量检查：

\`\`\`bash
npm test             # Vitest 单元测试
npm run verify       # 类型检查（tsc --noEmit）+ 单元测试
npm run test:e2e     # Playwright 端到端套件（需本机浏览器）
npm run bench        # 性能基准并对基线
\`\`\`

\`npm run build\` 自带门禁：WASM 编译、类型检查、打包、文档站拷贝任一步失败即中止。类型检查同时充当 lint——代码库不引入额外的 lint 规则集，而是把约束交给 TypeScript 严格模式。

### 9.3 数据格式支持

| 类别 | 格式 | 说明 |
| --- | --- | --- |
| 文本与表格 | CSV、TSV、DAT、TXT | 按分隔符推断列类型 |
| 结构数据 | JSON（点集、网格、网络、天体、桁架等） | 各插件声明自己接受的结构 |
| 点云与网格 | XYZ | 2D 与 3D 点云 |
| 图像 | PNG | 图像查看器与示例资源 |
| 地理 | GeoJSON | 离线矢量地图分级设色 |
| 科研二进制 | HDF5、NetCDF、FITS、Zarr、Parquet | 纯 TypeScript 调度器按魔数分派到各加载器 |
| 项目 | .clproj | 工程自有格式，lz-string 压缩 |
| 插件包 | .cspkg | fflate 打包，加载时校验清单与可选签名 |
| 主题包 | .cstheme | 纯声明式数据，绝不携带可执行内容 |

大文件先经分块读取与内容指纹，再交由 Worker 池并行解析。

### 9.4 示例资源一览

| 位置 | 内容 |
| --- | --- |
| examples/data | 每个内置插件附带的可加载示例数据集 |
| examples/projects | 11 个真实 .clproj 流程管线（信号分析、分箱统计、双管线对比等） |
| examples/code | 9 个 Python 示例程序（EDA 管线、蒙特卡洛估圆、信号平滑等） |
| src/editor/block/samples.ts | 5 个积木示例程序（星系散点、遥测折线、随机直方图等） |
| src/core/templates | 学科模板目录，附确定性数据集与 3–6 步引导 |

### 9.5 参与贡献

贡献流程要求：改动前先阅读仓库根目录的 ARCHITECTURE.md 与 REQUIREMENTS.md；新增插件或功能需附带端到端检查；提交前保持 \`npm run verify\` 绿色。已修复的缺陷应沉淀为回归用例，而不是只改代码。

### 9.6 许可证

MIT。软件引用与归档元数据由 \`CITATION.cff\` 维护（由脚本从 package.json 生成并在 CI 中校验），打标签发版时会自动归档到 Zenodo 并铸造 DOI。
`;

const APPENDIX = `## 附录 文档索引

| 文档 | 内容 |
| --- | --- |
| 01-产品介绍 | 项目背景、设计目标、技术架构概述、功能全景、应用场景与创新点（产品视角） |
| 02-系统架构 | 分层架构、路由与页面组织、启动时序、状态管理、渲染管线、目录结构与依赖规则 |
| 03-插件系统 | 插件契约、42 个内置插件明细、市场目录与两级加载、cspkg 沙箱与 Ed25519 签名、文件路由 |
| 04-四大工作模式 | 标准、流程、积木、代码四种模式的设计与三模式互转（共享 IR） |
| 05-科研工具集 | 19 个科研工具的统一注册表、五个分组与逐项职责、入口导航与工具间流转 |
| 06-GPU计算与原生核心 | Rust/WASM 原生核心、WebGPU 计算管线、13 个可复用 WGSL 内核与 CPU 回退 |
| 07-科学计算子系统 | 统计内核、科研二进制 I/O、出版级绘图与组图、可复现性、不确定度、建模与推断等 33 个子系统 |
| 08-测试与质量保障 | 单元测试、端到端测试、性能基准与体积预算、五条 CI 工作流与工程脚本 |
| README | 本目录的文档索引与三条推荐阅读路径 |
| docs/guide（VitePress 站点） | 面向使用者的在线文档：导言、架构、各模式指南、测试、路线图、插件等 |

本文与上述文档随仓库代码一同演进：代码、配置或测试发生变化时，请一并核对与更新对应章节中的数字与描述。
`;

// ---- assemble -------------------------------------------------------------

const intro = `# Ergalics Studio

Ergalics Studio 是一款完全运行在浏览器中的科学计算工作站：无需安装，打开即用，数据保存在本机。四种工作模式共享同一份数据，从看图、搭流程到写代码连贯不换工具，并可交付可复现的研究成果。

> 文档说明：本文是 Ergalics Studio 的完整技术总结，由 \`docs/technical\` 下八篇分篇文档（产品介绍、系统架构、插件系统、四大工作模式、科研工具集、GPU 计算与原生核心、科学计算子系统、测试与质量保障）逐章整合而成，另附使用指南、应用场景、创新点与文档索引。全文由脚本从分篇源码自动汇编（\`scripts/build-tech-summary.mjs\`），因此与分篇永远一致；数字基线为 42 个内置插件、42 个流程区块、19 个科研工具、33 个领域子系统、106 个测试文件 / 1761 个单元测试、13 套端到端套件、5 条 CI 工作流。
`;

const lines = [intro];

const pick01 = (s, i) => i <= 3; // §一 背景与目标 / §二 技术架构 / §三 功能全景
const pick01Scenario = (s, i) => i === 4; // §四 应用场景
const pick01Innovation = (s, i) => i === 5; // §五 创新点

lines.push(...emitChapter(1, '项目概览', '01-产品介绍', pick01));
lines.push(...emitChapter(2, '系统架构', '02-系统架构'));
lines.push(...emitChapter(3, '插件系统', '03-插件系统'));
lines.push(...emitChapter(4, '四大工作模式', '04-四大工作模式'));
lines.push(...emitChapter(5, '科研工具集', '05-科研工具集'));
lines.push(...emitChapter(6, 'GPU 计算与原生核心', '06-GPU计算与原生核心'));
lines.push(...emitChapter(7, '科学计算子系统', '07-科学计算子系统'));
lines.push(...emitChapter(8, '测试与质量保障', '08-测试与质量保障'));
lines.push(USAGE);
lines.push(...emitChapter(10, '应用场景', '01-产品介绍', pick01Scenario));
lines.push(...emitChapter(11, '创新点', '01-产品介绍', pick01Innovation));
lines.push(APPENDIX);

const out = lines
  .join('\n')
  .replace(/\n{3,}/g, '\n\n')
  .replace(/\s*$/, '\n');

writeFileSync(path.join(DOCS_DIR, 'Ergalics Studio.md'), out, 'utf8');
console.log(
  `assembled: Ergalics Studio.md (${out.split('\n').length} lines, ${out.length} chars)`,
);
