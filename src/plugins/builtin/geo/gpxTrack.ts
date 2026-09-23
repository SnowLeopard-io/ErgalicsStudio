// ==========================================================================
// Example plugin: GPX Track Analysis
//
// Outdoor-lab companion: drop in a GPX recording and read back the numbers
// a hiking logbook cares about — total great-circle distance, accumulated
// ascent/descent with a 2 m hysteresis filter (so GPS jitter doesn't invent
// metres of climbing), elapsed time and elevation extremes — alongside a
// track map colour-coded by elevation and an elevation-distance profile.
//
// GPX parsing is deliberately regex-based (no DOMParser) so the same code
// runs in the worker sandbox and under vitest without a DOM.
// ==========================================================================

import type { ContainerCapabilities, ParamDefinition, Plugin, PluginApi } from '@/types/plugin';
import { actionButton, exportCanvasPng, actionFired, notify } from '../shared/enhance';
import { heatmapColor } from '@/core/wgsl';
import { isZh, haversineKm } from './geoCore';
import { pushPanelsToFigure, panelTag, panelPlace, GEO_PANEL_WIDTH, GEO_PANEL_HEIGHT } from './geoFigure';
import type { GeoFigurePanel, Bilingual } from './geoFigure';
import { gpxTrackManifest } from './gpxTrackManifest';

export { gpxTrackManifest } from './gpxTrackManifest';

// ---- Parsing & statistics (exported for tests) -----------------------------

export interface TrackPoint {
  lat: number;
  lon: number;
  ele?: number;
  time?: string;
}

const TRKPT_RE = /<(trkpt|rtept)\b([^>]*?)(?:\/>|>([\s\S]*?)<\/\1>)/g;

/** Regex-based GPX <trkpt>/<rtept> reader (DOM-free for worker/test parity). */
export function parseGpx(text: string): TrackPoint[] {
  const out: TrackPoint[] = [];
  for (const m of text.matchAll(TRKPT_RE)) {
    const attrs = m[2] ?? '';
    const lat = Number(/lat="([^"]+)"/.exec(attrs)?.[1]);
    const lon = Number(/lon="([^"]+)"/.exec(attrs)?.[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const body = m[3] ?? '';
    const eleM = /<ele>\s*([-\d.eE+]+)\s*<\/ele>/.exec(body);
    const timeM = /<time>\s*([^<]+?)\s*<\/time>/.exec(body);
    out.push({
      lat,
      lon,
      ele: eleM ? Number(eleM[1]) : undefined,
      time: timeM ? timeM[1] : undefined,
    });
  }
  return out;
}

export interface TrackStats {
  totalKm: number;
  /** Accumulated ascent/descent with hysteresis filtering (metres). */
  ascent: number;
  descent: number;
  /** Elapsed seconds between first and last timestamp (undefined if absent). */
  durationSec?: number;
  maxEle?: number;
  minEle?: number;
}

export const ASCENT_THRESHOLD_M = 2;

/** Great-circle chain length in kilometres. */
export function trackDistanceKm(points: TrackPoint[]): number {
  let sum = 0;
  for (let i = 1; i < points.length; i += 1) {
    sum += haversineKm(points[i - 1]!.lat, points[i - 1]!.lon, points[i]!.lat, points[i]!.lon);
  }
  return sum;
}

/**
 * Accumulated ascent/descent using a hysteresis filter: a running reference
 * only moves once the accumulated change exceeds `threshold` metres, which
 * discards GPS elevation jitter while keeping real climbs.
 */
export function trackAscentDescent(points: TrackPoint[], threshold = ASCENT_THRESHOLD_M): { ascent: number; descent: number } {
  let ascent = 0;
  let descent = 0;
  let ref: number | null = null;
  for (const p of points) {
    if (p.ele === undefined || !Number.isFinite(p.ele)) continue;
    if (ref === null) {
      ref = p.ele;
      continue;
    }
    const d = p.ele - ref;
    if (d >= threshold) {
      ascent += d;
      ref = p.ele;
    } else if (d <= -threshold) {
      descent += -d;
      ref = p.ele;
    }
  }
  return { ascent, descent };
}

export function trackStats(points: TrackPoint[]): TrackStats {
  const { ascent, descent } = trackAscentDescent(points);
  let maxEle: number | undefined;
  let minEle: number | undefined;
  for (const p of points) {
    if (p.ele === undefined || !Number.isFinite(p.ele)) continue;
    maxEle = maxEle === undefined ? p.ele : Math.max(maxEle, p.ele);
    minEle = minEle === undefined ? p.ele : Math.min(minEle, p.ele);
  }
  let durationSec: number | undefined;
  const t0 = points.find((p) => p.time)?.time;
  const t1 = [...points].reverse().find((p) => p.time)?.time;
  if (t0 && t1) {
    const a = Date.parse(t0);
    const b = Date.parse(t1);
    if (Number.isFinite(a) && Number.isFinite(b) && b >= a) durationSec = (b - a) / 1000;
  }
  return { totalKm: trackDistanceKm(points), ascent, descent, durationSec, maxEle, minEle };
}

// ---- Figure Studio panels (exported for tests) ------------------------------

const GRADIENT_BINS = 40;

/**
 * Research sheet for one track: (a) elevation–distance profile, (b) gradient
 * (%) aggregated into equal-distance bins so GPS jitter doesn't invent
 * cliffs. Returns [] when the track carries no elevation.
 */
export function gpxFigurePanels(points: TrackPoint[]): GeoFigurePanel[] {
  const cum: number[] = [0];
  for (let i = 1; i < points.length; i += 1) {
    cum.push(cum[i - 1]! + haversineKm(points[i - 1]!.lat, points[i - 1]!.lon, points[i]!.lat, points[i]!.lon));
  }
  const totalKm = cum[cum.length - 1] ?? 0;
  const hasEle = points.some((p) => p.ele !== undefined && Number.isFinite(p.ele));
  if (!hasEle || totalKm <= 0) return [];

  // (a) elevation–distance profile.
  const elevPts: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < points.length; i += 1) {
    const ele = points[i]!.ele;
    if (ele !== undefined && Number.isFinite(ele)) elevPts.push({ x: cum[i]!, y: ele });
  }
  const panels: GeoFigurePanel[] = [
    {
      ...panelPlace(0),
      tag: panelTag(0),
      spec: {
        width: GEO_PANEL_WIDTH,
        height: GEO_PANEL_HEIGHT,
        title: 'Elevation profile',
        xLabel: 'distance [km]',
        yLabel: 'elevation [m]',
        ticks: 4,
        grid: true,
        series: [{ name: 'elevation', kind: 'line', color: '#7FB2E8', points: elevPts }],
      },
    },
  ];

  // (b) gradient per equal-distance bin: grade = net Δelevation / run · 100.
  const nb = Math.max(8, Math.min(GRADIENT_BINS, points.length - 1));
  const binUp = new Float64Array(nb);
  const binDown = new Float64Array(nb);
  const binKm = new Float64Array(nb);
  for (let i = 1; i < points.length; i += 1) {
    const b = Math.min(nb - 1, Math.floor((cum[i]! / totalKm) * nb));
    binKm[b]! += cum[i]! - cum[i - 1]!;
    const e0 = points[i - 1]!.ele;
    const e1 = points[i]!.ele;
    if (e0 !== undefined && e1 !== undefined && Number.isFinite(e0) && Number.isFinite(e1)) {
      const d = e1 - e0;
      if (d >= 0) binUp[b]! += d;
      else binDown[b]! += -d;
    }
  }
  const gradPts: Array<{ x: number; y: number }> = [];
  for (let b = 0; b < nb; b += 1) {
    if (binKm[b]! <= 1e-9) continue;
    const grade = ((binUp[b]! - binDown[b]!) / (binKm[b]! * 1000)) * 100;
    gradPts.push({ x: ((b + 0.5) / nb) * totalKm, y: grade });
  }
  panels.push({
    ...panelPlace(panels.length),
    tag: panelTag(panels.length),
    spec: {
      width: GEO_PANEL_WIDTH,
      height: GEO_PANEL_HEIGHT,
      title: 'Gradient [%]',
      xLabel: 'distance [km]',
      yLabel: 'grade [%]',
      xDomain: [0, totalKm],
      ticks: 4,
      grid: true,
      legend: true,
      series: [
        { name: 'grade', kind: 'line', color: '#FF9E64', points: gradPts },
        { name: '0 %', kind: 'line', color: '#B07AA1', dash: [4, 2], points: [{ x: 0, y: 0 }, { x: totalKm, y: 0 }] },
      ],
    },
  });
  return panels;
}

// ---- Plugin ----------------------------------------------------------------

interface State {
  points: TrackPoint[];
  name: string;
}

export class GpxTrackPlugin implements Plugin {
  readonly manifest = gpxTrackManifest;
  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  private state: State = { points: [], name: '' };

  async init(api: PluginApi) {
    this.api = api;
  }

  async destroy() {
    this.ctx = null;
    this.state.points = [];
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
    if (actionFired(params, 'sendToFigure')) {
      void this.sendToFigure();
      return;
    }
    if (actionFired(params, 'exportPng')) {
      exportCanvasPng(this.api, this.ctx?.canvas2d ?? null, 'geo-gpx');
    }
  }

  getParams(): ParamDefinition[] {
    return [actionButton('sendToFigure', 'Send to Figure Studio', '发送到 Figure Studio'), actionButton('exportPng', 'Snapshot PNG', '快照 PNG')];
  }

  getSupportedFormats() {
    return this.manifest.formats ?? [];
  }

  async loadData(file: File) {
    const text = await file.text();
    const points = parseGpx(text);
    if (points.length < 2) {
      notify(this.api, 'warning', 'No <trkpt> points with lat/lon found', '未找到含经纬度的 <trkpt> 轨迹点');
      return;
    }
    const nameM = /<name>([^<]+)<\/name>/.exec(text);
    this.state = { points, name: nameM?.[1]?.trim() ?? '' };
    this.api.reportDataScale(points.length);
    notify(
      this.api,
      'success',
      `Loaded ${points.length} track points`,
      `已加载 ${points.length} 个轨迹点`,
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
    const points = this.state.points;
    if (points.length < 2) {
      g.fillStyle = 'rgba(150, 165, 185, 0.85)';
      g.font = "12px 'Microsoft YaHei', Consolas, monospace";
      g.textAlign = 'center';
      g.fillText(zh ? '请从示例或文件加载 GPX 轨迹' : 'Load a GPX track from samples or a file', canvas.width / 2, canvas.height / 2);
      return;
    }

    const stats = trackStats(points);
    const hasEle = stats.maxEle !== undefined;
    const eleRange = hasEle ? Math.max((stats.maxEle ?? 0) - (stats.minEle ?? 0), 1e-6) : 1;

    // Layout: map left (58%), profile right.
    const pad = 14;
    const mapW = (canvas.width - 3 * pad) * 0.56;
    const mapH = canvas.height - 2 * pad - 30;
    const profX = mapW + 2 * pad;
    const profW = canvas.width - profX - pad;
    const profH = canvas.height - 2 * pad - 30;

    let minLat = Infinity;
    let maxLat = -Infinity;
    let minLon = Infinity;
    let maxLon = -Infinity;
    for (const p of points) {
      minLat = Math.min(minLat, p.lat);
      maxLat = Math.max(maxLat, p.lat);
      minLon = Math.min(minLon, p.lon);
      maxLon = Math.max(maxLon, p.lon);
    }
    const cosLat = Math.max(0.1, Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180));
    const spanLon = Math.max((maxLon - minLon) * cosLat, 1e-6);
    const spanLat = Math.max(maxLat - minLat, 1e-6);
    const scale = Math.min(mapW / spanLon, mapH / spanLat) * 0.92;
    const mpx = (lon: number) => pad + mapW / 2 + (lon - (minLon + maxLon) / 2) * cosLat * scale;
    const mapPy = (lat: number) => pad + mapH / 2 - (lat - (minLat + maxLat) / 2) * scale;

    // Track segments coloured by elevation.
    g.lineWidth = 2.2;
    g.lineCap = 'round';
    for (let i = 1; i < points.length; i += 1) {
      const a = points[i - 1]!;
      const b = points[i]!;
      const t = hasEle && b.ele !== undefined ? (b.ele - (stats.minEle ?? 0)) / eleRange : 0.5;
      const [r, gg, bb] = heatmapColor(t);
      g.strokeStyle = `rgb(${Math.round(r * 255)},${Math.round(gg * 255)},${Math.round(bb * 255)})`;
      g.beginPath();
      g.moveTo(mpx(a.lon), mapPy(a.lat));
      g.lineTo(mpx(b.lon), mapPy(b.lat));
      g.stroke();
    }
    // Start / end markers.
    const start = points[0]!;
    const end = points[points.length - 1]!;
    g.fillStyle = '#7ee2a8';
    g.beginPath();
    g.arc(mpx(start.lon), mapPy(start.lat), 4.5, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#ff7a7a';
    g.beginPath();
    g.arc(mpx(end.lon), mapPy(end.lat), 4.5, 0, Math.PI * 2);
    g.fill();
    g.font = "11px 'Microsoft YaHei', Consolas, monospace";
    g.fillStyle = 'rgba(220, 228, 240, 0.95)';
    g.fillText(zh ? '起点' : 'Start', mpx(start.lon) + 7, mapPy(start.lat) + 4);
    g.fillText(zh ? '终点' : 'End', mpx(end.lon) + 7, mapPy(end.lat) + 4);
    if (hasEle) {
      // Map legend.
      const grad = g.createLinearGradient(pad, 0, pad + 120, 0);
      for (let i = 0; i <= 10; i += 1) {
        const [r, gg, bb] = heatmapColor(i / 10);
        grad.addColorStop(i / 10, `rgb(${Math.round(r * 255)},${Math.round(gg * 255)},${Math.round(bb * 255)})`);
      }
      g.fillStyle = grad;
      g.fillRect(pad, canvas.height - 30, 120, 8);
      g.fillText(`${(stats.minEle ?? 0).toFixed(0)} m`, pad + 126, canvas.height - 22);
    }

    // Elevation profile.
    const cum: number[] = [0];
    for (let i = 1; i < points.length; i += 1) {
      cum.push(cum[i - 1]! + haversineKm(points[i - 1]!.lat, points[i - 1]!.lon, points[i]!.lat, points[i]!.lon));
    }
    const totalKm = cum[cum.length - 1] || 1;
    const ppx = (km: number) => profX + (km / totalKm) * profW;
    const ele0 = stats.minEle ?? 0;
    const ppy = (ele: number) => pad + 18 + profH - ((ele - ele0) / eleRange) * (profH - 16);
    if (hasEle) {
      // Area under profile.
      g.beginPath();
      g.moveTo(ppx(0), ppy(points[0]!.ele ?? ele0));
      for (let i = 1; i < points.length; i += 1) {
        const ele = points[i]!.ele ?? ele0;
        g.lineTo(ppx(cum[i]!), ppy(ele));
      }
      g.lineTo(ppx(totalKm), pad + 18 + profH);
      g.lineTo(ppx(0), pad + 18 + profH);
      g.closePath();
      g.fillStyle = 'rgba(92, 148, 210, 0.22)';
      g.fill();
      g.beginPath();
      g.moveTo(ppx(0), ppy(points[0]!.ele ?? ele0));
      for (let i = 1; i < points.length; i += 1) {
        g.lineTo(ppx(cum[i]!), ppy(points[i]!.ele ?? ele0));
      }
      g.strokeStyle = '#7fb2e8';
      g.lineWidth = 1.6;
      g.stroke();
    } else {
      g.fillStyle = 'rgba(150, 165, 185, 0.85)';
      g.textAlign = 'center';
      g.fillText(zh ? '轨迹无海拔数据' : 'Track has no elevation data', profX + profW / 2, pad + 40 + profH / 2);
      g.textAlign = 'left';
    }

    // Header.
    g.textAlign = 'left';
    g.font = "12px 'Microsoft YaHei', Consolas, monospace";
    g.fillStyle = 'rgba(235, 242, 250, 0.95)';
    const title = this.state.name || (zh ? 'GPX 轨迹' : 'GPX track');
    g.fillText(
      zh
        ? `${title}\u3000${points.length} 点\u3000里程 ${stats.totalKm.toFixed(2)} km\u3000爬升 ${stats.ascent.toFixed(0)} m\u3000下降 ${stats.descent.toFixed(0)} m`
        : `${title}\u3000${points.length} pts\u3000${stats.totalKm.toFixed(2)} km\u3000+${stats.ascent.toFixed(0)} m / −${stats.descent.toFixed(0)} m`,
      14,
      20,
    );
    g.fillStyle = 'rgba(170, 182, 200, 0.9)';
    const dur = stats.durationSec !== undefined ? fmtDur(stats.durationSec) : '—';
    const range = hasEle ? `${(stats.minEle ?? 0).toFixed(0)}–${(stats.maxEle ?? 0).toFixed(0)} m` : '—';
    g.fillText(zh ? `用时 ${dur}\u3000海拔 ${range}\u3000右图为海拔-距离剖面` : `Duration ${dur}\u3000Elevation ${range}\u3000Right: elevation-distance profile`, 14, 38);
  }

  /** Stream the elevation / gradient research sheet to Figure Studio. */
  private async sendToFigure(): Promise<void> {
    const points = this.state.points;
    if (points.length < 2) return;
    const stats = trackStats(points);
    const caption: Bilingual = {
      zh: `GPX 轨迹分析（${points.length} 点）：海拔-距离剖面与等距分箱坡度（坡度 = 净海拔变化 ÷ 水平距离 × 100%）。总里程 ${stats.totalKm.toFixed(2)} km，迟滞滤波（阈值 ${ASCENT_THRESHOLD_M} m）后累计爬升 ${stats.ascent.toFixed(0)} m / 下降 ${stats.descent.toFixed(0)} m。`,
      en: `GPX track analysis (${points.length} points): elevation–distance profile and equal-distance-binned gradient (grade = net Δelevation ÷ run × 100%). Total ${stats.totalKm.toFixed(2)} km; hysteresis-filtered (threshold ${ASCENT_THRESHOLD_M} m) ascent ${stats.ascent.toFixed(0)} m / descent ${stats.descent.toFixed(0)} m.`,
    };
    await pushPanelsToFigure(
      this.api,
      { zh: 'GPX 轨迹分析', en: 'GPX track analysis' },
      caption,
      gpxFigurePanels(points),
    );
  }
}

function fmtDur(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
}

export default function createGpxTrackPlugin(): Plugin {
  return new GpxTrackPlugin();
}
