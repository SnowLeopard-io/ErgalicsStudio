#!/usr/bin/env node
// ==========================================================================
// 生成《插件全表》附录（中英双语）
//
// 数据源（唯一的权威来源）：
//   - src/plugins/builtin/index.ts   BUILTIN_PLUGINS 的注册顺序与 autoload
//   - src/plugins/builtin/**/manifest.ts  id / nameI18n / descriptionI18n
//   - src/plugins/categories.ts      DISCIPLINE_BY_PLUGIN 学科归属
//
// 输出：
//   - docs/zh-CN/technical/12-插件全表.md（中文名 + 中文说明）
//   - docs/technical/12-plugin-catalog.md（英文名 + 英文说明）
//
// 用法：node docs/scripts/gen-plugin-catalog.mjs
// 插件增删改后重新运行即可，不要手改生成的两个页面。
// ==========================================================================

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BUILTIN_DIR = path.join(ROOT, 'src', 'plugins', 'builtin');
const INDEX_FILE = path.join(BUILTIN_DIR, 'index.ts');
const CATEGORIES_FILE = path.join(ROOT, 'src', 'plugins', 'categories.ts');

const read = (file) => readFileSync(file, 'utf8').replace(/\r\n?/g, '\n');

// ---- 1. BUILTIN_PLUGINS：注册顺序与 autoload ------------------------------

const indexSource = read(INDEX_FILE);

/** manifest 变量名 → manifest.ts 绝对路径 */
const manifestFiles = new Map();
for (const m of indexSource.matchAll(
  /import\s*\{\s*(\w+Manifest)(?:\s+as\s+(\w+))?\s*\}\s*from\s*'([^']+)'/g,
)) {
  const [, original, alias, spec] = m;
  manifestFiles.set(alias ?? original, path.resolve(BUILTIN_DIR, spec.replace(/^\.\//, '') + '.ts'));
}

const entries = [];
for (const m of indexSource.matchAll(/manifest:\s*(\w+)\s*,([\s\S]*?)load:\s*async/g)) {
  const [, symbol, middle] = m;
  const autoload = !/autoload:\s*false/.test(middle);
  entries.push({ symbol, autoload });
}

// ---- 2. manifest 字段 -----------------------------------------------------

function parseI18nBlock(source, field) {
  const start = source.search(new RegExp(`${field}:\\s*\\{`));
  if (start < 0) return {};
  const open = source.indexOf('{', start);
  let depth = 0;
  let end = open;
  for (; end < source.length; end += 1) {
    if (source[end] === '{') depth += 1;
    else if (source[end] === '}') {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  if (end <= open) return {};
  const out = {};
  for (const m of source.slice(open + 1, end).matchAll(/'([a-zA-Z-]+)':\s*(['"])((?:\\.|(?!\2).)*)\2/g)) {
    out[m[1]] = m[3].replace(/\\(['"])/g, '$1');
  }
  return out;
}

const plugins = entries.map((entry) => {
  const file = manifestFiles.get(entry.symbol);
  if (!file || !existsSync(file)) throw new Error(`manifest not found for ${entry.symbol}`);
  const source = read(file);
  const id = /^\s{2}id:\s*'([^']+)'/m.exec(source)?.[1];
  const fallbackName = /^\s{2}name:\s*'([^']+)'/m.exec(source)?.[1] ?? id;
  const nameI18n = parseI18nBlock(source, 'nameI18n');
  const descI18n = parseI18nBlock(source, 'descriptionI18n');
  const zhDesc =
    descI18n['zh-CN'] ??
    /^\s{2}description:\s*\n?\s*'([\s\S]*?)',\n/m.exec(source)?.[1]?.trim() ??
    '';
  return {
    id,
    autoload: entry.autoload,
    zh: nameI18n['zh-CN'] ?? fallbackName ?? id,
    en: nameI18n['en-US'] ?? fallbackName ?? id,
    zhDesc,
    enDesc: descI18n['en-US'] ?? zhDesc,
  };
});

// ---- 3. 学科分组 ----------------------------------------------------------

const categoriesSource = read(CATEGORIES_FILE);

/** 仅取 PLUGIN_DISCIPLINES 声明（显示顺序与中英文组名） */
const disciplines = [];
const listBlock = /export const PLUGIN_DISCIPLINES[\s\S]*?=\s*\[([\s\S]*?)\n\];/.exec(categoriesSource)?.[1] ?? '';
for (const m of listBlock.matchAll(/id:\s*'([a-z]+)'[\s\S]*?nameI18n:\s*\{([\s\S]*?)\}/g)) {
  const names = {};
  for (const n of m[2].matchAll(/'([a-zA-Z-]+)':\s*'([^']*)'/g)) names[n[1]] = n[2];
  disciplines.push({ id: m[1], zh: names['zh-CN'] ?? m[1], en: names['en-US'] ?? m[1] });
}

const disciplineBlock = /const DISCIPLINE_BY_PLUGIN[\s\S]*?=\s*\{([\s\S]*?)\n\};/.exec(categoriesSource)?.[1] ?? '';
const disciplineByPlugin = new Map();
for (const m of disciplineBlock.matchAll(/'([^']+)':\s*'([a-z]+)'/g)) {
  disciplineByPlugin.set(m[1], m[2]);
}

const grouped = new Map(disciplines.map((d) => [d.id, []]));
for (const plugin of plugins) {
  const id = disciplineByPlugin.get(plugin.id) ?? 'charts';
  if (!grouped.has(id)) grouped.set(id, []);
  grouped.get(id).push(plugin);
}

const total = plugins.length;
const autoload = plugins.filter((p) => p.autoload).length;
const manual = total - autoload;

// ---- 4. 统计测试文件（文档口径用） ---------------------------------------

function countTestFiles(dir) {
  if (!existsSync(dir)) return 0;
  let n = 0;
  for (const item of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, item.name);
    if (item.isDirectory()) n += countTestFiles(full);
    else if (/\.test\.(ts|tsx)$/.test(item.name)) n += 1;
  }
  return n;
}

const testFiles = countTestFiles(path.join(ROOT, 'tests'));

// ---- 5. 输出 markdown -----------------------------------------------------

// Markdown-table cell escaping in a single forward pass: every special
// character is mapped exactly once, so escape output is never re-processed
// (a multi-pass replace chain is reported by CodeQL as
// js/incomplete-sanitization).
function cell(text) {
  let out = '';
  for (const ch of String(text ?? '')) {
    if (ch === '&') out += '&amp;';
    else if (ch === '<') out += '&lt;';
    else if (ch === '>') out += '&gt;';
    else if (ch === '|') out += '\\|';
    else if (ch === '\n') out += ' ';
    else out += ch;
  }
  return out.trim();
}

const banner = (zh) =>
  zh
    ? '> 本页由 `docs/scripts/gen-plugin-catalog.mjs` 从 `src/plugins/builtin/**/manifest.ts`、`src/plugins/builtin/index.ts` 与 `src/plugins/categories.ts` 自动生成，请勿手改。增删插件或调整学科归属后，运行 `node docs/scripts/gen-plugin-catalog.mjs` 重新生成。'
    : '> Generated by `docs/scripts/gen-plugin-catalog.mjs` from `src/plugins/builtin/**/manifest.ts`, `src/plugins/builtin/index.ts` and `src/plugins/categories.ts`. Do not edit by hand — rerun `node docs/scripts/gen-plugin-catalog.mjs` after changing plugins or disciplines.';

function tableOfContents(zh) {
  const lines = [zh ? '## 一、学科分组概览' : '## I. Discipline overview', ''];
  lines.push(
    zh
      ? '| 学科分组 | 分组 ID | 插件数 | 自动加载 | 手动加载 |\n| --- | --- | ---: | ---: | ---: |'
      : '| Discipline | Group ID | Plugins | Autoload | Manual |\n| --- | --- | ---: | ---: | ---: |',
  );
  for (const d of disciplines) {
    const list = grouped.get(d.id) ?? [];
    if (!list.length) continue;
    const auto = list.filter((p) => p.autoload).length;
    lines.push(`| ${cell(zh ? d.zh : d.en)} | \`${d.id}\` | ${list.length} | ${auto} | ${list.length - auto} |`);
  }
  lines.push(
    `| ${zh ? '**合计**' : '**Total**'} | ${disciplines.filter((d) => (grouped.get(d.id) ?? []).length).length} ${zh ? '组' : 'groups'} | **${total}** | **${autoload}** | **${manual}** |`,
  );
  lines.push('');
  return lines;
}

function catalogSections(zh) {
  const lines = [zh ? '## 二、按学科分组的完整清单' : '## II. Complete catalog by discipline', ''];
  let index = 0;
  for (const d of disciplines) {
    const list = grouped.get(d.id) ?? [];
    if (!list.length) continue;
    const auto = list.filter((p) => p.autoload).length;
    const manualCount = list.length - auto;
    const summary = zh
      ? `${d.zh}（${d.id}，${list.length} 个${manualCount ? `，其中 ${manualCount} 个手动加载` : ''}）`
      : `${d.en} (${d.id}, ${list.length} plugins${manualCount ? `, ${manualCount} manual` : ''})`;
    lines.push(`### 2.${index + 1} ${cell(summary)}`, '');
    index += 1;
    lines.push(
      zh
        ? '| 插件 ID | 中文名 | 英文名 | 说明 | 自动加载 |\n| --- | --- | --- | --- | :---: |'
        : '| Plugin ID | Chinese name | English name | Description | Autoload |\n| --- | --- | --- | --- | :---: |',
    );
    for (const p of list) {
      lines.push(
        `| \`${p.id}\` | ${cell(p.zh)} | ${cell(p.en)} | ${cell(zh ? p.zhDesc : p.enDesc)} | ${p.autoload ? (zh ? '是' : 'yes') : (zh ? '否' : 'no')} |`,
      );
    }
    lines.push('');
  }
  return lines;
}

const zhPage = [
  '# 12 插件全表',
  '',
  banner(true),
  '',
  `截至当前版本，\`BUILTIN_PLUGINS\` 共登记 **${total} 个内置插件**：**${autoload} 个**科学/分析类插件随启动自动加载，**${manual} 个**趣味工具声明 \`autoload: false\` 手动加载；按 \`src/plugins/categories.ts\` 的 \`DISCIPLINE_BY_PLUGIN\` 分为 **${disciplines.filter((d) => (grouped.get(d.id) ?? []).length).length} 个学科分组**。插件系统契约、生命周期与第三方包机制见《[03 插件系统](./03-插件系统.md)》。`,
  '',
  ...tableOfContents(true),
  ...catalogSections(true),
  '本页数据与 `npm test` 无关，仅反映插件注册表；测试与质量口径见《[08 测试与质量保障](./08-测试与质量保障.md)》。',
  '',
].join('\n');

const enPage = [
  '# 12 Plugin Catalog',
  '',
  banner(false),
  '',
  `\`BUILTIN_PLUGINS\` currently registers **${total} built-in plugins**: **${autoload}** scientific/analysis plugins load automatically at startup, and **${manual}** fun tools declare \`autoload: false\` and load on demand. \`DISCIPLINE_BY_PLUGIN\` in \`src/plugins/categories.ts\` groups them into **${disciplines.filter((d) => (grouped.get(d.id) ?? []).length).length} disciplines**. For the plugin contract, lifecycle and third-party packaging, see [03 Plugin System](./03-plugin-system.md).`,
  '',
  ...tableOfContents(false),
  ...catalogSections(false),
  'This page reflects the plugin registry only; testing and quality metrics live in [08 Testing and Quality Assurance](./08-testing-and-quality-assurance.md).',
  '',
].join('\n');

writeFileSync(path.join(ROOT, 'docs', 'zh-CN', 'technical', '12-插件全表.md'), zhPage, 'utf8');
writeFileSync(path.join(ROOT, 'docs', 'technical', '12-plugin-catalog.md'), enPage, 'utf8');

// ---- 6. 控制台摘要（供文档核对） -----------------------------------------

const summary = {
  total,
  autoload,
  manual,
  disciplines: disciplines
    .map((d) => ({ id: d.id, zh: d.zh, en: d.en, count: (grouped.get(d.id) ?? []).length }))
    .filter((d) => d.count > 0),
  testFiles,
};
console.log(JSON.stringify(summary, null, 2));
console.log(`\nwritten: docs/zh-CN/technical/12-插件全表.md, docs/technical/12-plugin-catalog.md`);
