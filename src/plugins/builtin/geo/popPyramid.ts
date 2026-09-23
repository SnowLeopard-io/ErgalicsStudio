// ==========================================================================
// Example plugin: Population Pyramid
//
// The classic demographic back-to-back bar chart: male bars to the left of
// the centre axis, female bars to the right, age groups stacked bottom-up.
// Beside the drawing it computes the classroom summary — young (0-14),
// working-age (15-64) and elderly (65+) shares, the overall sex ratio and
// an expansive / stable / contractive shape reading from the young-vs-old
// balance (standard textbook heuristics).
//
// Input: CSV with an age-group label ("0-4" … "95+"), male, female columns.
// Values may be in any consistent unit (thousands or persons) — only
// percentages are plotted. A `# station:` comment names the title.
// ==========================================================================

import type { ContainerCapabilities, ParamDefinition, Plugin, PluginApi } from '@/types/plugin';
import { actionButton, exportCanvasPng, actionFired, notify } from '../shared/enhance';
import { isZh, parseDelimited } from './geoCore';
import { popPyramidManifest } from './popPyramidManifest';

export { popPyramidManifest } from './popPyramidManifest';

// ---- Parsing & demographic reading (exported for tests) --------------------

export interface PyramidRow {
  label: string;
  ageLo: number;
  ageHi: number; // Infinity for "95+"
  male: number;
  female: number;
}

export interface PyramidData {
  title: string;
  rows: PyramidRow[];
}

const AGE_RANGE = /^(\d+)\s*[-–—~到]\s*(\d+)$/;
const AGE_PLUS = /^(\d+)\s*\+$/;

export function parseAgeLabel(label: string): { lo: number; hi: number } | null {
  const s = label.trim();
  let m = AGE_RANGE.exec(s);
  if (m) return { lo: Number(m[1]), hi: Number(m[2]) };
  m = AGE_PLUS.exec(s);
  if (m) return { lo: Number(m[1]), hi: Infinity };
  const n = Number(s);
  if (Number.isFinite(n)) return { lo: n, hi: n + 4 };
  return null;
}

/** Parse an age/male/female CSV (header optional; `# station:` names it). */
export function parsePyramidCsv(text: string): PyramidData | null {
  // parseDelimited drops `#` comment lines, so pull the title from the raw
  // text first (accepted keys: station | title | name).
  let title = '';
  const st = /^#\s*(?:station|title|name)\s*[:=]\s*(.+)$/im.exec(text);
  if (st) title = st[1]!.trim();

  const dataRows = parseDelimited(text);
  if (dataRows.length < 3) return null;

  // Header detection: if any cell in the first row matches known keywords.
  const head = dataRows[0]!.map((c) => c.toLowerCase());
  const isHeader = head.some((c) => /^(age|年龄|age_group|group)$/.test(c)) || /^male/.test(head[1] ?? '');
  const body = isHeader ? dataRows.slice(1) : dataRows;

  const out: PyramidRow[] = [];
  for (const row of body) {
    const label = row[0] ?? '';
    const male = Number(row[1]);
    const female = Number(row[2]);
    const ages = parseAgeLabel(label);
    if (!ages || !Number.isFinite(male) || !Number.isFinite(female)) continue;
    if (male < 0 || female < 0) continue;
    out.push({ label: label.trim(), ageLo: ages.lo, ageHi: ages.hi, male, female });
  }
  if (out.length < 3) return null;
  out.sort((a, b) => a.ageLo - b.ageLo);
  return { title, rows: out };
}

export type PyramidShape = 'expansive' | 'stable' | 'contractive';

export interface PyramidSummary {
  total: number;
  male: number;
  female: number;
  /** Overall sex ratio: males per 100 females. */
  sexRatio: number;
  youngPct: number; // 0-14
  workingPct: number; // 15-64
  oldPct: number; // 65+
  shape: PyramidShape;
}

/** Population in a band [lo, hi) using the parsed age ranges. */
function bandPop(rows: PyramidRow[], lo: number, hi: number): number {
  let sum = 0;
  for (const r of rows) {
    if (r.ageHi > lo && r.ageLo < hi) sum += r.male + r.female;
  }
  return sum;
}

/**
 * Classroom shape reading: expansive when the base is broad (young ≥ 25 %
 * and ≥ 2× the elderly), contractive when the top outweighs the base
 * (elderly ≥ young or young < 15 %), stable otherwise.
 */
export function summarizePyramid(rows: PyramidRow[]): PyramidSummary {
  let male = 0;
  let female = 0;
  for (const r of rows) {
    male += r.male;
    female += r.female;
  }
  const total = male + female || 1;
  const young = bandPop(rows, 0, 15);
  const working = bandPop(rows, 15, 65);
  const old = bandPop(rows, 65, Infinity);
  const youngPct = (young / total) * 100;
  const workingPct = (working / total) * 100;
  const oldPct = (old / total) * 100;

  let shape: PyramidShape;
  if (youngPct >= 25 && young >= 2 * old) shape = 'expansive';
  else if (old >= young * 1.1 || youngPct < 15) shape = 'contractive';
  else shape = 'stable';

  return {
    total,
    male,
    female,
    sexRatio: (male / (female || 1)) * 100,
    youngPct,
    workingPct,
    oldPct,
    shape,
  };
}

// ---- Plugin ----------------------------------------------------------------

interface State {
  data: PyramidData | null;
}

export class PopPyramidPlugin implements Plugin {
  readonly manifest = popPyramidManifest;
  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  private state: State = { data: null };

  async init(api: PluginApi) {
    this.api = api;
  }

  async destroy() {
    this.ctx = null;
    this.state.data = null;
  }

  async activate(context: { container: ContainerCapabilities }) {
    this.ctx = context.container;
  }

  async deactivate() {}

  render(container: ContainerCapabilities) {
    this.ctx = container;
    this.draw();
  }

  updateParams(params: Record<string, unknown>) {
    if (actionFired(params, 'exportPng')) {
      exportCanvasPng(this.api, this.ctx?.canvas2d ?? null, 'geo-pop-pyramid');
    }
  }

  getParams(): ParamDefinition[] {
    return [actionButton('exportPng', 'Snapshot PNG', '快照 PNG')];
  }

  getSupportedFormats() {
    return this.manifest.formats ?? [];
  }

  async loadData(file: File) {
    const parsed = parsePyramidCsv(await file.text());
    if (!parsed) {
      notify(this.api, 'warning', 'No age/male/female rows found', '未找到 年龄/男/女 数据行');
      return;
    }
    this.state.data = parsed;
    this.api.reportDataScale(parsed.rows.length);
    notify(
      this.api,
      'success',
      `Loaded ${parsed.title || 'pyramid'} — ${parsed.rows.length} age groups`,
      `已加载 ${parsed.title || '人口金字塔'} — ${parsed.rows.length} 个年龄组`,
    );
    this.draw();
  }

  // ---- drawing -------------------------------------------------------------

  private draw() {
    const canvas = this.ctx?.canvas2d;
    if (!canvas) return;
    canvas.width = canvas.clientWidth || 640;
    canvas.height = canvas.clientHeight || 420;
    const g = canvas.getContext('2d');
    if (!g) return;
    g.fillStyle = getComputedStyle(canvas).backgroundColor || '#0a0e13';
    g.fillRect(0, 0, canvas.width, canvas.height);
    const zh = isZh(this.api.locale);
    const data = this.state.data;
    if (!data) {
      const msg = zh ? '请从示例或文件加载 年龄,男,女 CSV 数据' : 'Load an age,male,female CSV from samples or a file';
      drawCentered(g, canvas, msg);
      return;
    }

    const rows = data.rows;
    const s = summarizePyramid(rows);
    const W = canvas.width;
    const H = canvas.height;
    const padL = 44;
    const padR = 14;
    const padT = 46;
    const padB = 40;
    const cx = padL + ((W - padL - padR) * 46) / 100; // centre axis (male side slightly narrower)
    const halfW = Math.max(60, (W - padL - padR) / 2 - 8);
    const plotH = H - padT - padB;
    const rowH = plotH / rows.length;
    const maxPop = Math.max(...rows.map((r) => Math.max(r.male, r.female)), 1);

    // Title + summary line.
    g.textAlign = 'left';
    g.font = "13px 'Microsoft YaHei', Consolas, monospace";
    g.fillStyle = 'rgba(230, 238, 248, 0.95)';
    g.fillText(data.title || (zh ? '人口金字塔' : 'Population pyramid'), 14, 20);
    g.font = "12px 'Microsoft YaHei', Consolas, monospace";
    g.fillStyle = 'rgba(170, 182, 200, 0.95)';
    const shapeText = zh
      ? { expansive: '增长型', stable: '稳定型', contractive: '缩减型' }[s.shape]
      : { expansive: 'expansive', stable: 'stable', contractive: 'contractive' }[s.shape];
    g.fillText(
      zh
        ? `总人口 ${fmtN(s.total)} 千　0-14 ${s.youngPct.toFixed(1)}%　15-64 ${s.workingPct.toFixed(1)}%　65+ ${s.oldPct.toFixed(1)}%　性别比 ${s.sexRatio.toFixed(1)}　→ ${shapeText}`
        : `Total ${fmtN(s.total)} k　0-14 ${s.youngPct.toFixed(1)}%　15-64 ${s.workingPct.toFixed(1)}%　65+ ${s.oldPct.toFixed(1)}%　Sex ratio ${s.sexRatio.toFixed(1)}　→ ${shapeText}`,
      14,
      38,
    );

    // Bars.
    const maleColor = '#4d9de0';
    const femaleColor = '#e8896a';
    g.textAlign = 'center';
    for (let i = 0; i < rows.length; i += 1) {
      const r = rows[i]!;
      const yTop = padT + i * rowH;
      const barH = Math.max(1, rowH - 2);
      const wm = (r.male / maxPop) * halfW;
      const wf = (r.female / maxPop) * halfW;
      g.fillStyle = maleColor;
      g.fillRect(cx - wm, yTop, wm, barH);
      g.fillStyle = femaleColor;
      g.fillRect(cx, yTop, wf, barH);
      // Age label on the centre axis.
      g.fillStyle = 'rgba(200, 210, 224, 0.9)';
      g.font = "10px 'Microsoft YaHei', Consolas, monospace";
      if (rowH >= 9) g.fillText(r.label, cx, yTop + barH - 1);
      // Outlines.
      g.strokeStyle = 'rgba(10, 14, 19, 0.55)';
      g.lineWidth = 1;
      g.strokeRect(cx - wm, yTop, wm, barH);
      g.strokeRect(cx, yTop, wf, barH);
    }

    // Centre axis + frame.
    g.strokeStyle = 'rgba(140, 152, 170, 0.6)';
    g.beginPath();
    g.moveTo(cx, padT);
    g.lineTo(cx, padT + plotH);
    g.stroke();

    // Legend.
    g.textAlign = 'left';
    g.font = "11px 'Microsoft YaHei', Consolas, monospace";
    g.fillStyle = maleColor;
    g.fillRect(padL, H - padB + 10, 10, 10);
    g.fillStyle = 'rgba(200, 210, 224, 0.95)';
    g.fillText(zh ? '男 Male' : 'Male', padL + 14, H - padB + 19);
    g.fillStyle = femaleColor;
    g.fillRect(padL + 74, H - padB + 10, 10, 10);
    g.fillStyle = 'rgba(200, 210, 224, 0.95)';
    g.fillText(zh ? '女 Female' : 'Female', padL + 88, H - padB + 19);

    // Max scale hint on each side.
    g.fillStyle = 'rgba(150, 162, 180, 0.9)';
    g.textAlign = 'right';
    g.fillText(fmtN(maxPop), cx - 6, padT - 6);
    g.textAlign = 'left';
    g.fillText(fmtN(maxPop), cx + 6, padT - 6);
  }
}

function drawCentered(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement, msg: string) {
  g.fillStyle = 'rgba(150, 165, 185, 0.85)';
  g.font = "12px 'Microsoft YaHei', Consolas, monospace";
  g.textAlign = 'center';
  g.fillText(msg, canvas.width / 2, canvas.height / 2);
}

function fmtN(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}k`;
  return String(Math.round(n));
}

export default function createPopPyramidPlugin(): Plugin {
  return new PopPyramidPlugin();
}
