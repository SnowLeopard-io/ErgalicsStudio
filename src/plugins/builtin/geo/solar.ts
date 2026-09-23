// ==========================================================================
// Example plugin: Solar Elevation & Day Length
//
// Textbook solar geometry for the geography classroom: declination via the
// Cooper approximation, noon elevation 90°−|φ−δ|, and day length from the
// sunrise hour angle arccos(−tanφ·tanδ). Two stacked panels plot the annual
// day-length and noon-elevation curves with a marker on the chosen date —
// polar day/night appears naturally as the flat 24 h / 0 h plateaus.
//
// Pure geometry, no ephemeris: it intentionally ignores atmospheric
// refraction and the equation of time (both ≲ a few minutes) so the
// classroom numbers match the formula sheet.
// ==========================================================================

import type { ContainerCapabilities, ParamDefinition, Plugin, PluginApi } from '@/types/plugin';
import { actionButton, exportCanvasPng, actionFired } from '../shared/enhance';
import { isZh } from './geoCore';
import { solarManifest } from './solarManifest';

export { solarManifest } from './solarManifest';

// ---- Solar geometry (exported for tests) -----------------------------------

const OBLIQUITY_DEG = 23.44;

/** Day of year (1-365) → solar declination in degrees (Cooper, 1969). */
export function solarDeclination(doy: number): number {
  const n = Math.max(1, Math.min(365, Math.round(doy)));
  return OBLIQUITY_DEG * Math.sin((2 * Math.PI * (284 + n)) / 365);
}

/** Noon solar elevation in degrees (≤ 0 in polar night). */
export function noonElevation(lat: number, declinationDeg: number): number {
  return 90 - Math.abs(lat - declinationDeg);
}

export type PolarState = 'polar-day' | 'polar-night' | 'normal';

/** Classify polar day / polar night for a latitude + declination. */
export function polarState(lat: number, declinationDeg: number): PolarState {
  const sinH = -Math.tan((lat * Math.PI) / 180) * Math.tan((declinationDeg * Math.PI) / 180);
  if (sinH >= 1) return 'polar-night';
  if (sinH <= -1) return 'polar-day';
  return 'normal';
}

/** Day length in hours from the sunrise hour angle (0 or 24 at the poles). */
export function dayLengthHours(lat: number, declinationDeg: number): number {
  const state = polarState(lat, declinationDeg);
  if (state === 'polar-day') return 24;
  if (state === 'polar-night') return 0;
  const cosH = -Math.tan((lat * Math.PI) / 180) * Math.tan((declinationDeg * Math.PI) / 180);
  const H = (Math.acos(Math.max(-1, Math.min(1, cosH))) * 180) / Math.PI;
  return (2 * H) / 15;
}

/** Local solar times of sunrise and sunset in hours (undefined at the poles). */
export function sunriseSunset(lat: number, declinationDeg: number): [number, number] | undefined {
  const len = dayLengthHours(lat, declinationDeg);
  if (len <= 0 || len >= 24) return undefined;
  return [12 - len / 2, 12 + len / 2];
}

/** Month (1-12) and day (1-31) → day of year 1-366 (non-leap mapping). */
export function monthDayToDoy(month: number, day: number): number {
  const cum = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  const m = Math.max(1, Math.min(12, Math.round(month)));
  const maxDay = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]!;
  const d = Math.max(1, Math.min(maxDay, Math.round(day)));
  return Math.min(365, cum[m - 1]! + d);
}

const MONTHS_ZH = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];
const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// ---- Plugin ----------------------------------------------------------------

interface State {
  lat: number;
  lon: number;
  month: number;
  day: number;
  place: string;
}

export class SolarPlugin implements Plugin {
  readonly manifest = solarManifest;
  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  private state: State = { lat: 40, lon: 116.4, month: 6, day: 22, place: '' };

  async init(api: PluginApi) {
    this.api = api;
  }

  async destroy() {
    this.ctx = null;
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
      exportCanvasPng(this.api, this.ctx?.canvas2d ?? null, 'geo-solar');
      return;
    }
    let redraw = false;
    if (typeof params.lat === 'number') {
      this.state.lat = Math.max(-66.5, Math.min(66.5, params.lat));
      redraw = true;
    }
    if (typeof params.lon === 'number') {
      this.state.lon = Math.max(-180, Math.min(180, params.lon));
      redraw = true;
    }
    const m = Number(params.month);
    if (Number.isFinite(m) && m >= 1 && m <= 12) {
      this.state.month = Math.round(m);
      redraw = true;
    }
    if (typeof params.day === 'number') {
      this.state.day = Math.max(1, Math.min(31, Math.round(params.day)));
      redraw = true;
    }
    if (redraw) this.draw();
  }

  getParams(): ParamDefinition[] {
    return [
      {
        key: 'lat',
        label: 'Latitude (°N, −66.5…66.5)',
        labelI18n: { 'zh-CN': '纬度（°N，−66.5…66.5）', 'en-US': 'Latitude (°N, −66.5…66.5)' },
        type: 'range',
        min: -66.5,
        max: 66.5,
        step: 0.5,
        value: this.state.lat,
      },
      {
        key: 'lon',
        label: 'Longitude (°E)',
        labelI18n: { 'zh-CN': '经度（°E）', 'en-US': 'Longitude (°E)' },
        type: 'range',
        min: -180,
        max: 180,
        step: 0.1,
        value: this.state.lon,
      },
      {
        key: 'month',
        label: 'Month',
        labelI18n: { 'zh-CN': '月份', 'en-US': 'Month' },
        type: 'select',
        value: String(this.state.month),
        options: MONTHS_ZH.map((m, i) => ({
          value: String(i + 1),
          label: m,
          labelI18n: { 'zh-CN': m, 'en-US': MONTHS_EN[i]! },
        })),
      },
      {
        key: 'day',
        label: 'Day of month',
        labelI18n: { 'zh-CN': '日', 'en-US': 'Day of month' },
        type: 'range',
        min: 1,
        max: 31,
        step: 1,
        value: this.state.day,
      },
      actionButton('exportPng', 'Snapshot PNG', '快照 PNG'),
    ];
  }

  getSupportedFormats() {
    return this.manifest.formats ?? [];
  }

  /** Accept a location preset `{"name": "...", "lat": 39.9, "lon": 116.4}`. */
  async loadData(file: File) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      this.api.notify('warning', isZh(this.api.locale) ? 'JSON 解析失败' : 'Invalid JSON');
      return;
    }
    const obj = parsed as Record<string, unknown> | null;
    const lat = Number(obj?.lat);
    if (!obj || !Number.isFinite(lat)) {
      this.api.notify(
        'warning',
        isZh(this.api.locale) ? '需要 {"name": …, "lat": …} 位置预设' : 'Expected a {"name": …, "lat": …} preset',
      );
      return;
    }
    this.state.lat = Math.max(-66.5, Math.min(66.5, lat));
    const lon = Number(obj.lon);
    if (Number.isFinite(lon)) this.state.lon = Math.max(-180, Math.min(180, lon));
    if (typeof obj.name === 'string') this.state.place = obj.name;
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
    const { lat, lon, month, day } = this.state;
    const doy = monthDayToDoy(month, day);
    const decl = solarDeclination(doy);
    const elev = noonElevation(lat, decl);
    const len = dayLengthHours(lat, decl);
    const ss = sunriseSunset(lat, decl);

    g.textAlign = 'left';
    g.font = "12px 'Microsoft YaHei', Consolas, monospace";
    const title = this.state.place
      ? zh
        ? `${this.state.place}（${fmt(lat)}°N, ${fmt(lon)}°E）`
        : `${this.state.place} (${fmt(lat)}°N, ${fmt(lon)}°E)`
      : zh
        ? `纬度 ${fmt(lat)}°N，经度 ${fmt(lon)}°E`
        : `Latitude ${fmt(lat)}°N, Longitude ${fmt(lon)}°E`;
    g.fillStyle = 'rgba(230, 238, 248, 0.95)';
    g.fillText(title, 14, 20);

    g.fillStyle = 'rgba(170, 182, 200, 0.95)';
    const dateStr = zh ? `${month}月${day}日` : `${MONTHS_EN[month - 1]} ${day}`;
    const info =
      zh
        ? `太阳赤纬 δ = ${fmt(decl)}°\u3000正午太阳高度 H = ${fmt(elev)}°\u3000昼长 = ${fmt(len)} h` +
          (ss ? `\u3000日出 ${fmtH(ss[0])} / 日落 ${fmtH(ss[1])}（地方时）` : '')
        : `Declination δ = ${fmt(decl)}°\u3000Noon elevation H = ${fmt(elev)}°\u3000Day length = ${fmt(len)} h` +
          (ss ? `\u3000Sunrise ${fmtH(ss[0])} / Sunset ${fmtH(ss[1])} (solar time)` : '');
    g.fillText(info, 14, 40);
    const polar = polarState(lat, decl);
    if (polar !== 'normal') {
      g.fillStyle = polar === 'polar-day' ? 'rgba(255, 200, 90, 0.95)' : 'rgba(120, 180, 255, 0.95)';
      g.fillText(
        polar === 'polar-day' ? `☀ ${dateStr}：${zh ? '极昼' : 'Polar day'}` : `☾ ${dateStr}：${zh ? '极夜' : 'Polar night'}`,
        14,
        60,
      );
    }

    if (canvas.height < 180) return;
    this.drawAnnualCurve(g, canvas, true, doy);
    this.drawAnnualCurve(g, canvas, false, doy);
  }

  /** One stacked annual curve panel: `upper` = day length, else noon elevation. */
  private drawAnnualCurve(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement, upper: boolean, doy: number) {
    const zh = isZh(this.api.locale);
    const padL = 46;
    const padR = 14;
    const gapTop = upper ? 74 : 0;
    const halfH = (canvas.height - gapTop) / (upper ? 2 : 1);
    const x0 = padL;
    const x1 = canvas.width - padR;
    const y0 = gapTop + 14;
    const y1 = gapTop + halfH - 26;
    if (y1 - y0 < 30) return;

    // Horizontal frame + y ticks.
    const yMax = upper ? 24 : 90;
    g.strokeStyle = 'rgba(255, 255, 255, 0.10)';
    g.fillStyle = 'rgba(150, 165, 185, 0.9)';
    g.lineWidth = 1;
    const yTicks = upper ? 6 : 3;
    for (let i = 0; i <= yTicks; i += 1) {
      const v = (yMax / yTicks) * i;
      const sy = y1 - ((y1 - y0) * v) / yMax;
      g.beginPath();
      g.moveTo(x0, sy);
      g.lineTo(x1, sy);
      g.stroke();
      g.textAlign = 'right';
      g.fillText(String(Math.round(v)), x0 - 6, sy + 4);
    }
    // Month ticks.
    g.textAlign = 'center';
    for (let m = 0; m < 12; m += 1) {
      const d = monthDayToDoy(m + 1, 1);
      const sx = x0 + ((x1 - x0) * (d - 1)) / 364;
      g.strokeStyle = 'rgba(255, 255, 255, 0.06)';
      g.beginPath();
      g.moveTo(sx, y0);
      g.lineTo(sx, y1);
      g.stroke();
      g.fillStyle = 'rgba(150, 165, 185, 0.75)';
      g.fillText(zh ? `${m + 1}` : MONTHS_EN[m]!, sx, y1 + 14);
    }

    // Curve.
    g.strokeStyle = upper ? 'rgba(255, 200, 90, 0.95)' : 'rgba(120, 200, 255, 0.95)';
    g.lineWidth = 2;
    g.beginPath();
    for (let d = 1; d <= 365; d += 1) {
      const decl = solarDeclination(d);
      const v = upper ? dayLengthHours(this.state.lat, decl) : Math.max(0, noonElevation(this.state.lat, decl));
      const sx = x0 + ((x1 - x0) * (d - 1)) / 364;
      const sy = y1 - ((y1 - y0) * v) / yMax;
      if (d === 1) g.moveTo(sx, sy);
      else g.lineTo(sx, sy);
    }
    g.stroke();

    // Date marker.
    const mx = x0 + ((x1 - x0) * (doy - 1)) / 364;
    const decl = solarDeclination(doy);
    const mv = upper ? dayLengthHours(this.state.lat, decl) : Math.max(0, noonElevation(this.state.lat, decl));
    const my = y1 - ((y1 - y0) * mv) / yMax;
    g.strokeStyle = 'rgba(255, 120, 120, 0.6)';
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(mx, y0);
    g.lineTo(mx, y1);
    g.stroke();
    g.fillStyle = 'rgba(255, 120, 120, 0.95)';
    g.beginPath();
    g.arc(mx, my, 4, 0, Math.PI * 2);
    g.fill();

    g.textAlign = 'left';
    g.fillStyle = upper ? 'rgba(255, 200, 90, 0.95)' : 'rgba(120, 200, 255, 0.95)';
    g.fillText(
      upper
        ? zh
          ? `全年昼长（小时）— 纬度 ${fmt(this.state.lat)}°`
          : `Annual day length (hours) — lat ${fmt(this.state.lat)}°`
        : zh
          ? `全年正午太阳高度（°）`
          : `Annual noon solar elevation (°)`,
      x0 + 4,
      y0 - 2,
    );
    void canvas;
  }

}

function fmt(v: number): string {
  return String(parseFloat(v.toFixed(2)));
}

/** Hours (decimal) → `HH:MM`. */
function fmtH(h: number): string {
  const hh = Math.floor(h);
  const mm = Math.round((h - hh) * 60);
  return `${String(hh).padStart(2, '0')}:${String(mm % 60).padStart(2, '0')}`;
}

export default function createSolarPlugin(): Plugin {
  return new SolarPlugin();
}
