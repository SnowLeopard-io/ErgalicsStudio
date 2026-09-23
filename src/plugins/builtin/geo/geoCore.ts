// ==========================================================================
// Shared numeric / parsing helpers for the geography plugin suite.
//
// Small, dependency-free utilities reused across several geo plugins
// (measure, GPX, interp, terrain): spherical geometry, a relaxed
// delimited-text reader and marching-squares contour tracing. Pure
// functions only so they unit-test without a canvas.
// ==========================================================================

export const EARTH_RADIUS_KM = 6371.0088;
const D2R = Math.PI / 180;

/** Great-circle distance between two (lat, lon) points in kilometres. */
export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const p1 = lat1 * D2R;
  const p2 = lat2 * D2R;
  const dp = (lat2 - lat1) * D2R;
  const dl = (lon2 - lon1) * D2R;
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * Geodesic area of a polygon given as [ [lat, lon], ... ] (closed or open
 * ring; the closure is implied) via the Chamberlain–Duquette line integral
 * (the same formulation turf.js uses). Exact in the limit of short edges and
 * numerically robust down to classroom-scale shapes — unlike the interior-
 * angle-sum method, whose excess vanishes below double-precision noise for
 * small polygons. Rings enclosing a pole are out of scope for this studio.
 */
export function sphericalAreaKm2(ring: Array<[number, number]>): number {
  const n = ring.length;
  if (n < 3) return 0;
  let total = 0;
  for (let i = 0; i < n; i += 1) {
    const [lat1, lon1] = ring[i]!;
    const [lat2, lon2] = ring[(i + 1) % n]!;
    total += (lon2 - lon1) * D2R * (2 + Math.sin(lat1 * D2R) + Math.sin(lat2 * D2R));
  }
  return (Math.abs(total) * EARTH_RADIUS_KM * EARTH_RADIUS_KM) / 2;
}

/**
 * Relaxed delimited-text reader: splits into rows on newlines, cells on
 * commas (semicolon/tab also accepted), skips blank lines and `#` comments.
 * Returns trimmed string cells; the caller converts types.
 */
export function parseDelimited(text: string): string[][] {
  const rows: string[][] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith('//')) continue;
    const cells = line.split(/[,;\t]+/).map((c) => c.trim());
    rows.push(cells);
  }
  return rows;
}

/** Drop a leading header row when its first cell is not a finite number. */
export function stripHeaderIfNonNumeric(rows: string[][]): string[][] {
  if (rows.length === 0) return rows;
  const first = rows[0]!;
  const looksNumeric = first.some((c) => c !== '' && Number.isFinite(Number(c)));
  return looksNumeric ? rows : rows.slice(1);
}

export interface ContourSeg {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/**
 * Marching-squares contour segments for one level over a row-major field.
 * Cell size is 1 in field units — the caller maps to screen space.
 * Degenerate saddle cells resolve deterministically by averaging.
 */
export function marchingSquares(field: Float64Array, cols: number, rows: number, level: number): ContourSeg[] {
  const segs: ContourSeg[] = [];
  const at = (x: number, y: number): number => field[y * cols + x]!;
  const interp = (va: number, vb: number): number => {
    const d = va - vb;
    return Math.abs(d) < 1e-12 ? 0.5 : (va - level) / d;
  };
  for (let y = 0; y + 1 < rows; y += 1) {
    for (let x = 0; x + 1 < cols; x += 1) {
      const tl = at(x, y);
      const tr = at(x + 1, y);
      const br = at(x + 1, y + 1);
      const bl = at(x, y + 1);
      let idx = 0;
      if (tl > level) idx |= 8;
      if (tr > level) idx |= 4;
      if (br > level) idx |= 2;
      if (bl > level) idx |= 1;
      if (idx === 0 || idx === 15) continue;
      const topX = x + interp(tl, tr);
      const topY = y;
      const botX = x + interp(bl, br);
      const botY = y + 1;
      const leftX = x;
      const leftY = y + interp(tl, bl);
      const rightX = x + 1;
      const rightY = y + interp(tr, br);
      const push = (x1: number, y1: number, x2: number, y2: number) => segs.push({ x1, y1, x2, y2 });
      switch (idx) {
        case 1:
        case 14:
          push(leftX, leftY, botX, botY);
          break;
        case 2:
        case 13:
          push(botX, botY, rightX, rightY);
          break;
        case 3:
        case 12:
          push(leftX, leftY, rightX, rightY);
          break;
        case 4:
        case 11:
          push(topX, topY, rightX, rightY);
          break;
        case 6:
        case 9:
          push(topX, topY, botX, botY);
          break;
        case 7:
        case 8:
          push(leftX, leftY, topX, topY);
          break;
        case 5:
          push(leftX, leftY, topX, topY);
          push(botX, botY, rightX, rightY);
          break;
        case 10:
          push(topX, topY, rightX, rightY);
          push(leftX, leftY, botX, botY);
          break;
        default:
          break;
      }
    }
  }
  return segs;
}

/** Canvas-friendly empty-state message (shared look across geo plugins). */
export function drawEmptyMessage(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement, msg: string): void {
  g.fillStyle = 'rgba(150, 165, 185, 0.85)';
  g.font = "12px 'Microsoft YaHei', Consolas, monospace";
  g.textAlign = 'center';
  g.fillText(msg, canvas.width / 2, canvas.height / 2);
}

/** Locale helper used by every geo plugin. */
export function isZh(locale: string): boolean {
  return locale === 'zh-CN';
}
