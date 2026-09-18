// ==========================================================================
// FR-23 — benchmark report page generator.
//
// Produces a self-contained single-file HTML report (bench-report.html) from
// bench-results.json (+ optional bench/baseline.json for pass/regression
// markers). Attached to GitHub releases by .github/workflows/bench.yml.
//
//   node scripts/bench-report.mjs
// ==========================================================================

import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const resultsFile = path.join(root, 'bench-results.json');
const baselineFile = path.join(root, 'bench', 'baseline.json');
const outFile = path.join(root, 'bench-report.html');

const TOLERANCE = 0.10;

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const results = JSON.parse(await readFile(resultsFile, 'utf8'));
const baseline = existsSync(baselineFile) ? JSON.parse(await readFile(baselineFile, 'utf8')) : null;

const baseMap = new Map(Object.entries(baseline?.metrics ?? {}));

function statusOf(cur, dir) {
  const ref = baseMap.get(cur.id);
  if (!ref) return { cls: 'new', text: '新增' };
  if (ref.value === 0) return cur.value === 0 ? { cls: 'ok', text: '通过' } : { cls: 'bad', text: '回归' };
  const change = (cur.value - ref.value) / Math.abs(ref.value);
  const bad = dir === 'up' ? -change : change;
  if (bad > TOLERANCE) return { cls: 'bad', text: `回归 ${(change * 100).toFixed(1)}%` };
  if (bad < -TOLERANCE) return { cls: 'good', text: `改善 ${(change * 100).toFixed(1)}%` };
  return { cls: 'ok', text: '通过' };
}

const SUITE_TITLES = {
  import: '数据导入',
  compute: 'GPU 内核（CPU 回退路径）',
  render: '渲染管线数据准备',
  memory: '内存占用',
};

let anyBad = false;
const suiteHtml = results.suites
  .map((suite) => {
    const rows = suite.metrics
      .map((m) => {
        const st = statusOf(m, m.direction);
        if (st.cls === 'bad') anyBad = true;
        const ref = baseMap.get(m.id);
        return `<tr>
  <td><code>${esc(m.id)}</code><div class="label">${esc(m.label)}</div></td>
  <td class="num">${esc(m.value.toLocaleString('en-US'))}<span class="unit">${esc(m.unit)}</span></td>
  <td class="num">${ref ? esc(ref.value.toLocaleString('en-US')) : '—'}</td>
  <td class="num">${esc(m.workload)}</td>
  <td><span class="pill ${st.cls}">${esc(st.text)}</span></td>
</tr>`;
      })
      .join('\n');
    return `<section>
<h2>${esc(SUITE_TITLES[suite.name] ?? suite.name)} <small>(${suite.duration_ms} ms)</small></h2>
<table>
<thead><tr><th>指标</th><th class="num">当前值</th><th class="num">基线值</th><th class="num">工作负载</th><th>状态</th></tr></thead>
<tbody>${rows}</tbody>
</table>
</section>`;
  })
  .join('\n');

const env = results.environment;
const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Ergalics Studio — 性能基准报告 (FR-23)</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: system-ui, -apple-system, "Segoe UI", sans-serif; margin: 2rem auto; max-width: 60rem; padding: 0 1rem; color: #1a1a1a; background: #fafafa; }
  @media (prefers-color-scheme: dark) { body { color: #e6e6e6; background: #16181d; } .card, table th { background: #1f232b; } table td, table th { border-color: #333a46; } .pill { border-color: currentColor; } }
  h1 { font-size: 1.6rem; } h2 { font-size: 1.15rem; margin-top: 2rem; } h2 small { color: #888; font-weight: normal; }
  .card { background: #fff; border: 1px solid #e2e2e2; border-radius: 8px; padding: 1rem 1.25rem; margin: 1rem 0; }
  table { border-collapse: collapse; width: 100%; margin: .5rem 0 1rem; }
  th, td { border-bottom: 1px solid #e2e2e2; padding: .45rem .6rem; text-align: left; vertical-align: top; }
  th { background: #f1f1f1; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .unit { color: #888; font-size: .8em; margin-left: .3em; }
  .label { color: #777; font-size: .82em; margin-top: .15rem; }
  code { font-size: .85em; }
  .pill { display: inline-block; padding: .1rem .55rem; border-radius: 999px; font-size: .8em; border: 1px solid #ccc; }
  .pill.ok { color: #1a7f37; border-color: #1a7f37; }
  .pill.good { color: #0969da; border-color: #0969da; }
  .pill.bad { color: #cf222e; border-color: #cf222e; font-weight: 600; }
  .pill.new { color: #8250df; border-color: #8250df; }
  .verdict { font-weight: 600; }
  .verdict.pass { color: #1a7f37; } .verdict.fail { color: #cf222e; }
  footer { margin-top: 3rem; color: #888; font-size: .85em; }
</style>
</head>
<body>
<h1>Ergalics Studio — 性能基准报告</h1>
<p>FR-23 基准套件：数据导入 / GPU 内核（CPU 回退）/ 渲染管线数据准备 / 内存占用。判定规则：相对基线波动 ±10% 超限视为回归。</p>
<div class="card">
  <strong>执行环境</strong>
  <ul>
    <li>Runtime: ${esc(env.runtime)} ${esc(env.node)}</li>
    <li>Platform: ${esc(env.platform)} / ${esc(env.arch)}</li>
    <li>CPU: ${esc(env.cpu)}</li>
    <li>日期: ${esc(env.date)}</li>
    <li>基线: ${baseline ? `bench/baseline.json（更新于 ${esc(baseline.updated_from_environment?.date ?? '未知')}）` : '无（首次运行）'}</li>
  </ul>
  <p class="verdict ${anyBad ? 'fail' : 'pass'}">${anyBad ? '✗ 检测到回归（超出 ±10% 容差）' : baseline ? '✓ 全部指标通过' : '— 无基线，仅记录数值'}</p>
  <p style="color:#777;font-size:.85em">浏览器端真实 FPS 由工作台性能看板（workbench.perf）人工采样；本页指标为 Node 固定环境下的可复现数据准备耗时。</p>
</div>
${suiteHtml}
<footer>Generated by scripts/bench-report.mjs · Ergalics Studio FR-23</footer>
</body>
</html>
`;

await writeFile(outFile, html, 'utf8');
process.stdout.write(`[bench] report written: ${path.relative(root, outFile)}\n`);
