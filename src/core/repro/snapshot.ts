// ==========================================================================
// Ergalics Studio — reproducible snapshot (FR-09, pure TS)
//
// buildReproSnapshot renders ONE self-contained HTML file (inline CSS, inline
// SVG, embedded repro.lock JSON) that a recipient can open offline — no
// install, no server. It carries the data fingerprints, the locked runs'
// params/metrics summaries and a tiny in-page verifier that re-computes the
// checkable lock items (params hash, code aggregate hash, fingerprint shape)
// and shows pass/fail, plus a reproduction guide. Raw data files are NEVER
// embedded — only fingerprints and summaries — and the function is pure, so
// generating a snapshot cannot mutate the source project.
// ==========================================================================

import type { Project } from '@/types/project';
import type { RunRecord } from '@/core/experiment/record';
import type { ReproLock } from './lock';

export const SNAPSHOT_SCHEMA = 'ergalics.repro-snapshot';
export const SNAPSHOT_FORMAT_VERSION = 1;

export interface SnapshotProjectSummary {
  id: string;
  name: string;
  description?: string | null;
  tags?: string[];
  createdAt?: number;
  updatedAt?: number;
}

export interface SnapshotChart {
  title?: string;
  /** Pre-rendered SVG markup (sanitized before embedding). */
  svg: string;
}

export interface SnapshotInput {
  /** Project identity summary (never the data files themselves). */
  project: Project | SnapshotProjectSummary;
  /** The v1/v2 repro lock to embed verbatim. */
  lock: ReproLock;
  /**
   * Run records backing the locked runs — only the repro-relevant scalar
   * fields (params/metrics/seed/hashes) are embedded, never outputs.
   */
  runs?: RunRecord[];
  /** Result figures rendered as inline SVG. */
  charts?: SnapshotChart[];
  lang?: 'zh' | 'en';
  /** Studio app version shown in the footer + used by the guide text. */
  studioVersion?: string;
  now?: Date;
}

// --------------------------------------------------------------------------
// Escaping (same discipline as core/report/builder.ts)
// --------------------------------------------------------------------------

function escapeHtml(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** JSON safe for <script> transport: `<`/`>` unicode-escaped (no breakout). */
function safeJson(data: unknown): string {
  return JSON.stringify(data).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
}

/** Strip executable content from externally produced SVG before embedding. */
function sanitizeSvg(svg: string): string {
  return svg
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son[a-z]+\s*=\s*'[^']*'/gi, '');
}

// --------------------------------------------------------------------------
// Labels
// --------------------------------------------------------------------------

const LABELS = {
  en: {
    heading: 'Reproducible Snapshot',
    generated: 'Generated',
    project: 'Project',
    lockVersion: 'Lock format',
    studio: 'Studio',
    fingerprintTitle: 'Data fingerprints',
    colFile: 'File',
    colSize: 'Bytes',
    colHash: 'Fingerprint',
    checkTitle: 'Reproduction checks',
    checkIntro: 'Re-computed in your browser when this page opens:',
    checkParams: (n: number) => `run parameters match their locked hashes (${n} runs)`,
    checkCode: 'code snapshot aggregate hash matches the lock',
    checkShape: 'data fingerprint table is consistent with the embedded lock',
    pass: 'PASS',
    fail: 'FAIL',
    runsTitle: 'Locked runs',
    colRun: 'Run',
    colSource: 'Source',
    colSeed: 'Seed',
    colCreated: 'Created',
    colMetrics: 'Metrics',
    chartsTitle: 'Result figures',
    guideTitle: 'How to reproduce',
    guide: [
      '1. Import the original data files into Ergalics Studio (same versions as the fingerprints above).',
      '2. Open the project and load this snapshot\u2019s repro.lock on the Repro Lock page (import & verify).',
      '3. All six drift categories must read pass; rebuild the lock if a fingerprint drifted.',
      '4. Use "Reproduce from lock" to re-run the locked computations and assert every metric within tolerance.',
    ],
    depsTitle: 'Dependency fingerprint',
    colDep: 'Dependency',
    colDepVersion: 'Version',
    noData: 'This snapshot contains no raw data \u2014 only fingerprints and summaries.',
    offline: 'Self-contained \u00b7 works offline \u00b7 open this file directly',
  },
  zh: {
    heading: '可复现快照',
    generated: '生成于',
    project: '项目',
    lockVersion: '锁格式',
    studio: '工作室',
    fingerprintTitle: '数据指纹',
    colFile: '文件',
    colSize: '字节',
    colHash: '指纹',
    checkTitle: '复现检查',
    checkIntro: '本页在浏览器打开时即时重算以下校验项：',
    checkParams: (n: number) => `运行参数与锁定哈希一致（${n} 个运行）`,
    checkCode: '代码快照聚合哈希与锁一致',
    checkShape: '数据指纹表与内嵌锁一致',
    pass: '通过',
    fail: '失败',
    runsTitle: '锁定运行',
    colRun: '运行',
    colSource: '来源',
    colSeed: '种子',
    colCreated: '时间',
    colMetrics: '指标',
    chartsTitle: '结果图',
    guideTitle: '复现指引',
    guide: [
      '1. 将原始数据文件导入 Ergalics Studio（与上方指纹一致的文件版本）。',
      '2. 打开项目，在「可复现锁」页面导入并校验本快照内嵌的 repro.lock。',
      '3. 六类漂移检查须全部通过；若指纹漂移请重新生成锁。',
      '4. 使用「按锁复现」重跑锁定的计算，并在容差内断言每一项指标。',
    ],
    depsTitle: '依赖指纹',
    colDep: '依赖',
    colDepVersion: '版本',
    noData: '本快照不含原始数据文件——仅含指纹与摘要。',
    offline: '自包含 · 可离线打开 · 直接双击本文件即可查看',
  },
} as const;

// --------------------------------------------------------------------------
// In-page verifier (kept intentionally small: < 5 KB, no re-execution)
// --------------------------------------------------------------------------

function verifierJs(): string {
  // Mirrors lock.ts: FNV-1a hashString, canonicalJson, aggregate code hash.
  return `(function(){
function hs(s){var h=0x811c9dc5;for(var i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,0x01000193);}return(h>>>0).toString(16).padStart(8,'0');}
function cj(v){if(v===null||typeof v!=='object')return JSON.stringify(v==null?null:v);if(Array.isArray(v))return'['+v.map(cj).join(',')+']';var k=Object.keys(v).sort();return'{'+k.map(function(x){return JSON.stringify(x)+':'+cj(v[x]);}).join(',')+'}';}
function ch(v){return hs(cj(v));}
function agg(a){return hs(a.map(function(x){return x.kind+':'+x.id+':'+(x.language||'')+':'+x.hash;}).sort().join('\\n'));}
function read(id){try{return JSON.parse(document.getElementById(id).textContent||'{}');}catch(e){return null;}}
function mark(id,ok,detail){var li=document.getElementById(id);if(!li)return;li.className=ok?'chk-pass':'chk-fail';li.textContent=(ok?'\\u2713 ':'\\u2717 ')+li.textContent+(detail?' \\u2014 '+detail:'');}
var lock=read('repro-lock-json');var runs=read('repro-runs-json');
if(!lock||!runs){return;}
var byId={};runs.forEach(function(r){byId[r.id]=r;});
var allOk=true,checked=0;
(lock.runs||[]).forEach(function(lr){var r=byId[lr.id];if(!r)return;checked++;var ok=ch(r.params||{})===lr.paramsHash;if(!ok)allOk=false;});
mark('chk-params',allOk&&checked>0,checked+'/'+(lock.runs||[]).length);
mark('chk-code',agg(lock.code.artifacts||[])===lock.code.hash);
mark('chk-data',(lock.data||[]).every(function(d){return /^[0-9a-f]{8}$/.test(d.hash)&&typeof d.size==='number';}));
})();`;
}

// --------------------------------------------------------------------------
// CSS
// --------------------------------------------------------------------------

function snapshotCss(): string {
  return `:root{--bg:#ffffff;--fg:#1a1c1e;--muted:#5f6368;--card:#f7f8fa;--border:#dfe1e5;--accent:#1a56c4;--pass:#0f7b3f;--fail:#c5221f}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.6 -apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,"PingFang SC","Microsoft YaHei",sans-serif}
.wrap{max-width:860px;margin:0 auto;padding:40px 24px 80px}
header{border-bottom:1px solid var(--border);margin-bottom:24px;padding-bottom:16px}
h1{font-size:24px;margin:0 0 6px}
.badge{display:inline-block;font-size:12px;color:var(--muted);border:1px solid var(--border);border-radius:999px;padding:2px 10px;margin-right:6px}
.meta{color:var(--muted);font-size:13px;margin-top:8px}
h2{font-size:19px;margin:28px 0 10px}
table{border-collapse:collapse;width:100%;font-size:13px;margin:8px 0}
th,td{border:1px solid var(--border);padding:5px 9px;text-align:left;word-break:break-all}
th{background:var(--card)}
code{background:var(--card);border:1px solid var(--border);border-radius:4px;padding:1px 5px;font-size:12px}
ul#checks{list-style:none;padding:0;margin:8px 0}
ul#checks li{padding:6px 10px;border-radius:6px;margin:4px 0;font-size:14px}
.chk-pass{background:#e6f4ea;color:var(--pass)}
.chk-fail{background:#fce8e6;color:var(--fail)}
figure{margin:16px 0;padding:12px;background:var(--card);border:1px solid var(--border);border-radius:8px}
figure svg{max-width:100%;height:auto;display:block}
figcaption{color:var(--muted);font-size:13px;margin-top:8px;text-align:center}
.guide ol{padding-left:20px;color:var(--fg)}
.note{color:var(--muted);font-size:13px}
footer{margin-top:36px;border-top:1px solid var(--border);padding-top:12px;color:var(--muted);font-size:12px}`;
}

// --------------------------------------------------------------------------
// buildReproSnapshot
// --------------------------------------------------------------------------

function isFullProject(p: Project | SnapshotProjectSummary): p is Project {
  return Array.isArray((p as { data?: { files?: unknown } }).data?.files);
}

/**
 * Render the reproducible snapshot as a single self-contained HTML string.
 * Pure: the inputs are only read, never mutated.
 */
export function buildReproSnapshot(input: SnapshotInput): string {
  const lang: 'zh' | 'en' = input.lang === 'zh' ? 'zh' : 'en';
  const labels = LABELS[lang];
  const now = (input.now ?? new Date()).toISOString();
  const { lock } = input;
  const summary: SnapshotProjectSummary = isFullProject(input.project)
    ? {
        id: input.project.id,
        name: input.project.name,
        description: input.project.metadata?.description ?? null,
        tags: input.project.metadata?.tags ?? [],
        createdAt: input.project.createdAt,
        updatedAt: input.project.updatedAt,
      }
    : input.project;

  const lockedIds = new Set(lock.runs.map((r) => r.id));
  const embeddedRuns = (input.runs ?? [])
    .filter((r) => lockedIds.has(r.id))
    .map((r) => ({
      id: r.id,
      label: r.label ?? null,
      source: r.source,
      seed: r.seed,
      params: r.params ?? {},
      metrics: r.metrics ?? {},
      inputsHash: r.inputsHash ?? null,
      createdAt: r.createdAt,
    }));

  const fmtNum = (v: number): string =>
    Number.isFinite(v) ? String(Number(v.toPrecision(6))) : String(v);

  const dataRows = lock.data
    .map(
      (d) =>
        `<tr><td>${escapeHtml(d.name)}</td><td>${escapeHtml(d.size)}</td><td><code>${escapeHtml(d.hash)}</code></td></tr>`,
    )
    .join('\n');

  const depRows = (lock.dependencies ?? [])
    .map(
      (d) =>
        `<tr><td>${escapeHtml(d.name)}</td><td><code>${escapeHtml(d.version)}</code>${d.hash ? `#${escapeHtml(d.hash)}` : ''}</td></tr>`,
    )
    .join('\n');

  const runRows = embeddedRuns
    .map((r) => {
      const metrics = Object.entries(r.metrics)
        .map(([k, v]) => `${escapeHtml(k)}=${escapeHtml(fmtNum(v))}`)
        .join(', ');
      return `<tr><td><code>${escapeHtml(r.id.slice(0, 8))}</code> ${escapeHtml(r.label ?? '')}</td><td>${escapeHtml(r.source)}</td><td>${escapeHtml(r.seed ?? '')}</td><td>${escapeHtml(new Date(r.createdAt).toISOString())}</td><td>${metrics}</td></tr>`;
    })
    .join('\n');

  const charts = (input.charts ?? [])
    .map(
      (c) =>
        `<figure>${sanitizeSvg(c.svg)}${c.title ? `<figcaption>${escapeHtml(c.title)}</figcaption>` : ''}</figure>`,
    )
    .join('\n');

  const runtimeLine = lock.versions.runtime
    ? [
        lock.versions.runtime.browser && `browser ${lock.versions.runtime.browser}`,
        lock.versions.runtime.wasm && `wasm ${lock.versions.runtime.wasm}`,
        lock.versions.runtime.pyodide && `pyodide ${lock.versions.runtime.pyodide}`,
      ]
        .filter(Boolean)
        .join(' · ')
    : '';

  const checkItems: Array<[string, string]> = [
    ['chk-params', labels.checkParams(embeddedRuns.length)],
    ['chk-code', labels.checkCode],
    ['chk-data', labels.checkShape],
  ];

  const html = `<!doctype html>
<html lang="${lang === 'zh' ? 'zh-CN' : 'en'}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(labels.heading)} · ${escapeHtml(summary.name)}</title>
<style>${snapshotCss()}</style>
</head>
<body>
<div class="wrap">
<header>
<h1>${escapeHtml(labels.heading)}</h1>
<div>
<span class="badge">${escapeHtml(labels.project)}: ${escapeHtml(summary.name)}</span>
<span class="badge">${escapeHtml(labels.lockVersion)}: v${escapeHtml(lock.lockVersion)}</span>
<span class="badge">${escapeHtml(labels.studio)}: ${escapeHtml(input.studioVersion ?? lock.versions.studio)}</span>
</div>
<p class="meta">${escapeHtml(labels.generated)} ${escapeHtml(now)} · ${escapeHtml(lock.createdAt)} · ${escapeHtml(labels.offline)}</p>
${runtimeLine ? `<p class="meta">${escapeHtml(runtimeLine)}</p>` : ''}
</header>

<h2>${escapeHtml(labels.checkTitle)}</h2>
<p class="note">${escapeHtml(labels.checkIntro)}</p>
<ul id="checks">
${checkItems.map(([id, text]) => `<li id="${id}" class="chk-pass">${escapeHtml(text)}</li>`).join('\n')}
</ul>

<h2>${escapeHtml(labels.fingerprintTitle)}</h2>
<table><thead><tr><th>${escapeHtml(labels.colFile)}</th><th>${escapeHtml(labels.colSize)}</th><th>${escapeHtml(labels.colHash)}</th></tr></thead><tbody>
${dataRows}
</tbody></table>
<p class="note">${escapeHtml(labels.noData)}</p>

${depRows ? `<h2>${escapeHtml(labels.depsTitle)}</h2>\n<table><thead><tr><th>${escapeHtml(labels.colDep)}</th><th>${escapeHtml(labels.colDepVersion)}</th></tr></thead><tbody>\n${depRows}\n</tbody></table>` : ''}

<h2>${escapeHtml(labels.runsTitle)}</h2>
<table><thead><tr><th>${escapeHtml(labels.colRun)}</th><th>${escapeHtml(labels.colSource)}</th><th>${escapeHtml(labels.colSeed)}</th><th>${escapeHtml(labels.colCreated)}</th><th>${escapeHtml(labels.colMetrics)}</th></tr></thead><tbody>
${runRows}
</tbody></table>

${charts ? `<h2>${escapeHtml(labels.chartsTitle)}</h2>\n${charts}` : ''}

<h2>${escapeHtml(labels.guideTitle)}</h2>
<div class="guide"><ol>
${labels.guide.map((g) => `<li>${escapeHtml(g.replace(/^\d+\.\s*/, ''))}</li>`).join('\n')}
</ol></div>

<footer>Ergalics Studio · ${escapeHtml(SNAPSHOT_SCHEMA)} v${SNAPSHOT_FORMAT_VERSION} · lock ${escapeHtml(lock.schema)} v${escapeHtml(lock.lockVersion)} · ${escapeHtml(now)}</footer>
</div>
<script type="application/json" id="repro-lock-json">${safeJson(lock)}</script>
<script type="application/json" id="repro-runs-json">${safeJson(embeddedRuns)}</script>
<script>${verifierJs()}</script>
</body>
</html>`;

  return html;
}
