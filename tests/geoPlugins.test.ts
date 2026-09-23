// Geography plugin suite — pure-function unit + sample-data integration tests.
import { describe, it, expect } from 'vitest';

import {
  haversineKm,
  sphericalAreaKm2,
  parseDelimited,
  marchingSquares,
} from '@/plugins/builtin/geo/geoCore';
import {
  solarDeclination,
  noonElevation,
  dayLengthHours,
  polarState,
  sunriseSunset,
  monthDayToDoy,
  extraterrestrialRadiation,
  clearSkyRadiation,
  solarFigurePanels,
} from '@/plugins/builtin/geo/solar';
import { parseClimateCsv, summarizeClimate, climographFigurePanels } from '@/plugins/builtin/geo/climograph';
import { parsePyramidCsv, summarizePyramid, pyramidFigurePanels } from '@/plugins/builtin/geo/popPyramid';
import {
  parsePointsCsv,
  boundsOf,
  idwGrid,
  fitVariogram,
  krigingGrid,
  solveLinear,
  loocvValidate,
  moransI,
  interpFigurePanels,
} from '@/plugins/builtin/geo/spatialInterp';
import {
  parseWaypoints,
  chainLengthKm,
  polygonAreaKm2,
  standardDeviationalEllipse,
  measureFigurePanels,
} from '@/plugins/builtin/geo/geoMeasure';
import {
  projectMercator,
  projectMollweide,
  projectSinusoidal,
  projectOrthographic,
  projectOrthographicRot,
  tissotCircle,
  latLonToVec,
  distortionAt,
  tissotFigurePanels,
} from '@/plugins/builtin/geo/tissot';
import {
  parseAsciiGrid,
  hornSlopeAspect,
  hillshadeFromSlope,
  fillDepressions,
  d8FlowDirections,
  flowAccumulation,
  D8_NODIR,
  terrainFigurePanels,
} from '@/plugins/builtin/geo/terrain';
import { parseGpx, trackDistanceKm, trackAscentDescent, trackStats, gpxFigurePanels } from '@/plugins/builtin/geo/gpxTrack';
import { downsampleGrid, buildTerrainMesh } from '@/plugins/builtin/geo/terrain3d';
import type { AscGrid } from '@/plugins/builtin/geo/terrain';
import { lonLatToVec3, angularDistance } from '@/plugins/builtin/geo/globe';

import fellsGpx from '../examples/data/geo-fells-loop.gpx?raw';
import stationsCsv from '../examples/data/geo-interp-stations.csv?raw';
import popChinaCsv from '../examples/data/geo-pop-china.csv?raw';
import popJapanCsv from '../examples/data/geo-pop-japan.csv?raw';
import popNigeriaCsv from '../examples/data/geo-pop-nigeria.csv?raw';
import climateBeijingCsv from '../examples/data/geo-climate-beijing.csv?raw';
import measurePointsJson from '../examples/data/geo-measure-points.json?raw';
import terrainAsc from '../examples/data/geo-terrain-demo-synthetic.asc?raw';
import { BUILTIN_PLUGINS } from '@/plugins/builtin';
import { disciplineOf } from '@/plugins/categories';

const closeTo = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

// ---- geoCore ---------------------------------------------------------------

describe('geoCore', () => {
  it('haversineKm: Beijing→Shanghai ≈ 1068 km', () => {
    const d = haversineKm(39.9, 116.4, 31.2, 121.5);
    expect(closeTo(d, 1068, 20)).toBe(true);
  });
  it('sphericalAreaKm2: 1°×1° quadrilateral at the equator ≈ 1.23×10⁴ km²', () => {
    const area = sphericalAreaKm2([
      [0, 0],
      [0, 1],
      [1, 1],
      [1, 0],
    ]);
    expect(closeTo(area, 12300, 350)).toBe(true);
  });
  it('parseDelimited skips # comments and splits on commas/semicolons', () => {
    const rows = parseDelimited('# c\na,b;c\n\nd,\tt\n');
    expect(rows).toEqual([['a', 'b', 'c'], ['d', 't']]);
  });
  it('marchingSquares: one cell above level yields boundary segments', () => {
    const field = new Float64Array([1, 1, 1, 1, 1, 0, 0, 0, 0]);
    const segs = marchingSquares(field, 3, 3, 0.5);
    expect(segs.length).toBeGreaterThan(0);
  });
});

// ---- solar ------------------------------------------------------------------

describe('solar', () => {
  it('June solstice declination ≈ +23.44°', () => {
    expect(closeTo(solarDeclination(monthDayToDoy(6, 22)), 23.44, 0.1)).toBe(true);
  });
  it('noon elevation at φ=40° on the solstice ≈ 73.5°', () => {
    expect(closeTo(noonElevation(40, 23.44), 73.44, 0.01)).toBe(true);
  });
  it('equator has ~12 h days year-round', () => {
    for (const doy of [1, 80, 173, 266, 355]) {
      expect(closeTo(dayLengthHours(0, solarDeclination(doy)), 12, 0.1)).toBe(true);
    }
  });
  it('polar day / night classification', () => {
    expect(polarState(75, 23.44)).toBe('polar-day');
    expect(polarState(75, -23.44)).toBe('polar-night');
    expect(polarState(40, 23.44)).toBe('normal');
    expect(dayLengthHours(75, 23.44)).toBe(24);
    expect(dayLengthHours(75, -23.44)).toBe(0);
  });
  it('sunrise/sunset symmetric around local noon', () => {
    const ss = sunriseSunset(40, 23.44);
    expect(ss).toBeDefined();
    expect(closeTo(ss![0]! + ss![1]!, 24, 1e-9)).toBe(true);
  });
  it('monthDayToDoy mapping', () => {
    expect(monthDayToDoy(1, 1)).toBe(1);
    expect(monthDayToDoy(6, 22)).toBe(173);
    expect(monthDayToDoy(12, 31)).toBe(365);
  });
});

// ---- climograph -------------------------------------------------------------

describe('climograph', () => {
  it('parses header CSV (Beijing sample)', () => {
    const st = parseClimateCsv(climateBeijingCsv);
    expect(st).not.toBeNull();
    expect(st!.station).toContain('Beijing');
    expect(st!.months.length).toBe(12);
    expect(st!.months[6]!.temp).toBeCloseTo(26.8, 1);
  });
  it('parses headerless CSV', () => {
    const text = Array.from({ length: 12 }, (_, i) => `${i + 1},${10 + i},${50 + i}`).join('\n');
    const st = parseClimateCsv(text);
    expect(st).not.toBeNull();
    expect(st!.months.length).toBe(12);
  });
  it('classifies Beijing: D, summer-wet', () => {
    const st = parseClimateCsv(climateBeijingCsv)!;
    const s = summarizeClimate(st.months);
    expect(s.group).toBe('D');
    expect(s.regime).toBe('summer');
    expect(closeTo(s.annualPrecip, 527, 1)).toBe(true);
  });
  it('classifies synthetic A / B / E regimes', () => {
    const a = summarizeClimate(Array.from({ length: 12 }, (_, i) => ({ month: i + 1, temp: 27, precip: 200 })));
    expect(a.group).toBe('A');
    // temp must stay below the 18 °C tropical floor or group A wins first.
    const b = summarizeClimate(Array.from({ length: 12 }, (_, i) => ({ month: i + 1, temp: 15, precip: 10 })));
    expect(b.group).toBe('B');
    expect(b.regime).toBe('arid');
    const e = summarizeClimate(Array.from({ length: 12 }, (_, i) => ({ month: i + 1, temp: -20, precip: 100 })));
    expect(e.group).toBe('E');
  });
});

// ---- population pyramid ------------------------------------------------------

describe('population pyramid', () => {
  it('parses the China 2020 sample with 20 age groups', () => {
    const data = parsePyramidCsv(popChinaCsv);
    expect(data).not.toBeNull();
    expect(data!.rows.length).toBe(20);
    expect(data!.rows[0]!.label).toBe('0-4');
    expect(data!.rows[data!.rows.length - 1]!.ageHi).toBe(Infinity);
  });
  it('shape readings: Nigeria expansive, Japan contractive, China stable', () => {
    const nigeria = summarizePyramid(parsePyramidCsv(popNigeriaCsv)!.rows);
    expect(nigeria.shape).toBe('expansive');
    const japan = summarizePyramid(parsePyramidCsv(popJapanCsv)!.rows);
    expect(japan.shape).toBe('contractive');
    const china = summarizePyramid(parsePyramidCsv(popChinaCsv)!.rows);
    expect(china.shape).toBe('stable');
  });
  it('summary shares sum to ~100 % and sex ratio is plausible', () => {
    const s = summarizePyramid(parsePyramidCsv(popChinaCsv)!.rows);
    expect(closeTo(s.youngPct + s.workingPct + s.oldPct, 100, 0.5)).toBe(true);
    expect(s.sexRatio).toBeGreaterThan(100);
    expect(s.sexRatio).toBeLessThan(110);
  });
});

// ---- spatial interpolation ---------------------------------------------------

describe('spatial interpolation', () => {
  const stations = parsePointsCsv(stationsCsv);
  it('parses the 31-station sample (header dropped)', () => {
    expect(stations.length).toBe(31);
    expect(stations.every((p) => Number.isFinite(p.lon) && Number.isFinite(p.lat) && Number.isFinite(p.value))).toBe(true);
  });

  const box = [
    { lon: 100, lat: 30, value: 10 },
    { lon: 110, lat: 30, value: 20 },
    { lon: 100, lat: 40, value: 30 },
    { lon: 110, lat: 40, value: 40 },
  ];
  const bounds = boundsOf(box, 0);

  it('IDW is exact at station locations', () => {
    const field = idwGrid(box, 5, 5, bounds, 2);
    // Grid node (c=0, r=4) coincides with the SW station (lon 100, lat 30).
    expect(closeTo(field[4 * 5 + 0]!, 10, 1e-6)).toBe(true);
    // All interpolated values lie within the data range.
    for (const v of field) {
      expect(v).toBeGreaterThanOrEqual(10 - 1e-6);
      expect(v).toBeLessThanOrEqual(40 + 1e-6);
    }
  });

  it('variogram fit returns a finite model close to the sample sill', () => {
    const vario = fitVariogram(stations);
    expect(['spherical', 'exponential']).toContain(vario.model);
    expect(Number.isFinite(vario.sse)).toBe(true);
    expect(vario.range).toBeGreaterThan(0);
    expect(vario.sill).toBeGreaterThanOrEqual(vario.nugget);
  });

  it('ordinary kriging is exact at station locations', () => {
    // A nugget-free variogram makes ordinary kriging reproduce the data
    // exactly; a fitted variogram may carry a nugget and then it should not.
    const vario = { model: 'spherical' as const, nugget: 0, sill: 200, range: 20000, sse: 0 };
    const field = krigingGrid(box, 5, 5, bounds, vario);
    expect(field).not.toBeNull();
    expect(closeTo(field![4 * 5 + 0]!, 10, 1e-6)).toBe(true);
  });

  it('solveLinear solves a 2×2 system', () => {
    const x = solveLinear([[2, 1], [1, 3]], [5, 10]);
    expect(x).not.toBeNull();
    expect(closeTo(x![0]!, 1, 1e-9)).toBe(true);
    expect(closeTo(x![1]!, 3, 1e-9)).toBe(true);
  });
  it('solveLinear returns null for singular systems', () => {
    expect(solveLinear([[1, 2], [2, 4]], [1, 2])).toBeNull();
  });
});

// ---- measure ----------------------------------------------------------------

describe('measure', () => {
  it('parses the Yangtze waypoints sample', () => {
    const pts = parseWaypoints(measurePointsJson);
    expect(pts.length).toBe(6);
    expect(pts[0]!.name).toBe('Shanghai');
  });
  it('chainLengthKm sums great-circle segments', () => {
    const d = chainLengthKm([
      { lat: 39.9, lon: 116.4 },
      { lat: 31.2, lon: 121.5 },
    ]);
    expect(closeTo(d, 1068, 20)).toBe(true);
  });
  it('polygonAreaKm2 measures a 1°×1° near-equatorial quadrilateral', () => {
    const { area, perimeter } = polygonAreaKm2([
      { lat: 0, lon: 0 },
      { lat: 0, lon: 1 },
      { lat: 1, lon: 1 },
      { lat: 1, lon: 0 },
    ]);
    expect(closeTo(area, 12300, 350)).toBe(true);
    expect(closeTo(perimeter, 4 * 111, 4)).toBe(true);
  });
  it('polygonAreaKm2 needs ≥ 3 points', () => {
    expect(polygonAreaKm2([{ lat: 0, lon: 0 }, { lat: 1, lon: 1 }]).area).toBe(0);
  });
});

// ---- Tissot / projections ----------------------------------------------------

describe('projections & Tissot circles', () => {
  it('Mercator matches ln tan(π/4 + φ/2)', () => {
    const [x, y] = projectMercator(90, 45);
    expect(closeTo(x, Math.PI / 2, 1e-9)).toBe(true);
    expect(closeTo(y, Math.log(Math.tan(Math.PI / 4 + Math.PI / 8)), 1e-9)).toBe(true);
  });
  it('Mollweide equator maps to y=0, x=√2 at λ=90°; pole to y=√2', () => {
    const [x0] = projectMollweide(90, 0);
    expect(closeTo(x0!, Math.SQRT2, 1e-9)).toBe(true);
    const [, y90] = projectMollweide(0, 90);
    expect(closeTo(y90!, Math.SQRT2, 1e-9)).toBe(true);
  });
  it('Sinusoidal compresses x by cos φ (equal-area pseudocylindrical)', () => {
    const [x] = projectSinusoidal(180, 60);
    expect(closeTo(x!, (Math.PI * Math.cos((60 * Math.PI) / 180)), 1e-9)).toBe(true);
  });
  it('Orthographic hides the far hemisphere', () => {
    expect(projectOrthographic(0, 0)).toEqual([0, 0]);
    expect(projectOrthographic(179, 0)).toBeNull();
    expect(projectOrthographic(-179, 10)).toBeNull();
  });
  it('Tissot circle samples all lie at angular radius ε from the centre', () => {
    const eps = 7;
    const centre = latLonToVec(40, 116);
    // Max longitude excursion of the small circle: asin(sin ε / cos φ0).
    const maxDlon = (Math.asin(Math.sin((eps * Math.PI) / 180) / Math.cos((40 * Math.PI) / 180)) * 180) / Math.PI;
    for (const [lon, lat] of tissotCircle(40, 116, eps, 24)) {
      // (lon, lat) order — the same convention traceLine feeds to proj();
      // a swap would pile every circle onto the central meridian.
      expect(Math.abs(lon - 116)).toBeLessThanOrEqual(maxDlon + 1e-6);
      expect(Math.abs(lat - 40)).toBeLessThanOrEqual(eps + 1e-6);
      const v = latLonToVec(lat, lon);
      const dot = centre[0] * v[0] + centre[1] * v[1] + centre[2] * v[2];
      expect(closeTo(dot, Math.cos((eps * Math.PI) / 180), 1e-9)).toBe(true);
    }
  });
  it('generalized orthographic: centre → origin, equator view ≡ fixed orthographic, far side hidden', () => {
    const [xc, yc] = projectOrthographicRot(105, 30, 30, 105)!;
    expect(closeTo(xc!, 0, 1e-9)).toBe(true);
    expect(closeTo(yc!, 0, 1e-9)).toBe(true);
    // Unit-sphere coords: equator point at λ−λ0 = 90° rides the limb at x = 1.
    const [x, y] = projectOrthographicRot(90, 0, 0, 0)!;
    expect(closeTo(x!, 1, 1e-9)).toBe(true);
    expect(closeTo(y!, 0, 1e-9)).toBe(true);
    const [, yn] = projectOrthographicRot(0, 90, 0, 0)!;
    expect(closeTo(yn!, 1, 1e-9)).toBe(true);
    // antipodal point never shows up
    expect(projectOrthographicRot(-75, -30, 30, 105)).toBeNull();
  });
});

// ---- terrain ----------------------------------------------------------------

describe('DEM terrain', () => {
  it('parses an ESRI ASCII Grid with NoData replacement', () => {
    const text = [
      'ncols 3',
      'nrows 3',
      'xllcorner 10',
      'yllcorner 20',
      'cellsize 2',
      'NODATA_value -9999',
      '1 2 3',
      '4 -9999 6',
      '7 8 9',
    ].join('\n');
    const grid = parseAsciiGrid(text)!;
    expect(grid.ncols).toBe(3);
    expect(grid.nrows).toBe(3);
    expect(grid.cellsize).toBe(2);
    expect(grid.values[4]!).toBeNaN();
    expect(grid.values[8]!).toBe(9);
  });
  it('rejects malformed grids', () => {
    expect(parseAsciiGrid('hello world')).toBeNull();
    expect(parseAsciiGrid('ncols 3\nnrows 3\n1 2')).toBeNull();
  });
  it('Horn slope: 45° ramp with cellsize 1, aspect west', () => {
    const values = new Float64Array([0, 1, 2, 0, 1, 2, 0, 1, 2]);
    const { slope, aspect } = hornSlopeAspect(values, 3, 3, 1);
    expect(closeTo(slope[4]!, 45, 1e-9)).toBe(true);
    expect(closeTo(aspect[4]!, 270, 1e-9)).toBe(true);
  });
  it('flat terrain → zero slope, shade = cos 45°', () => {
    const values = new Float64Array(9).fill(100);
    const { slope } = hornSlopeAspect(values, 3, 3, 1);
    expect(closeTo(slope[4]!, 0, 1e-9)).toBe(true);
    const shade = hillshadeFromSlope(slope, new Float64Array(9).fill(0));
    expect(closeTo(shade[4]!, Math.cos(Math.PI / 4), 1e-9)).toBe(true);
  });
  it('synthetic 256×256 DEM sample parses with cellsize 30', () => {
    const grid = parseAsciiGrid(terrainAsc)!;
    expect(grid.ncols).toBe(256);
    expect(grid.nrows).toBe(256);
    expect(grid.cellsize).toBe(30);
    let finite = 0;
    for (const v of grid.values) if (Number.isFinite(v)) finite += 1;
    expect(finite).toBe(256 * 256);
  });
});

// ---- GPX --------------------------------------------------------------------

describe('GPX track', () => {
  const snippet = `<?xml version="1.0"?>
<gpx version="1.1" creator="test">
  <trk><name>Test Track</name>
    <trkseg>
      <trkpt lat="47.644" lon="-122.13"><ele>100</ele><time>2024-01-01T10:00:00Z</time></trkpt>
      <trkpt lat="47.645" lon="-122.129"><ele>100.5</ele><time>2024-01-01T10:10:00Z</time></trkpt>
      <trkpt lat="47.646" lon="-122.128"><ele>103</ele><time>2024-01-01T11:00:00Z</time></trkpt>
      <trkpt lat="47.647" lon="-122.127"><ele>99</ele><time>2024-01-01T12:00:00Z</time></trkpt>
    </trkseg>
  </trk>
</gpx>`;
  it('parses trkpt with ele/time via regex', () => {
    const pts = parseGpx(snippet);
    expect(pts.length).toBe(4);
    expect(pts[0]!.lat).toBeCloseTo(47.644, 6);
    expect(pts[0]!.ele).toBe(100);
    expect(pts[0]!.time).toBe('2024-01-01T10:00:00Z');
  });
  it('distance is positive; hysteresis filter gives ascent 3 m, descent 4 m', () => {
    const pts = parseGpx(snippet);
    expect(trackDistanceKm(pts)).toBeGreaterThan(0);
    const { ascent, descent } = trackAscentDescent(pts);
    expect(closeTo(ascent, 3, 1e-9)).toBe(true);
    expect(closeTo(descent, 4, 1e-9)).toBe(true);
  });
  it('stats include duration and elevation extremes', () => {
    const stats = trackStats(parseGpx(snippet));
    expect(stats.durationSec).toBe(2 * 3600);
    expect(stats.minEle).toBe(99);
    expect(stats.maxEle).toBe(103);
  });
  it('the downloaded Fells Loop sample parses to a real track', () => {
    const pts = parseGpx(fellsGpx);
    // The sample is a GPX 1.0 file: 46 <rtept> (route points) + waypoints.
    expect(pts.length).toBeGreaterThan(10);
    const stats = trackStats(pts);
    expect(stats.totalKm).toBeGreaterThan(1);
  });
});

// ---- 3D globe ----------------------------------------------------------------

describe('3D globe', () => {
  it('lonLatToVec3: λ=0 faces +X, north pole is +Y, λ=90°E faces −Z, radius respected', () => {
    const eq = lonLatToVec3(0, 0);
    expect(closeTo(eq[0]!, 1, 1e-9)).toBe(true);
    expect(closeTo(eq[1]!, 0, 1e-9)).toBe(true);
    const pole = lonLatToVec3(0, 90);
    expect(closeTo(pole[1]!, 1, 1e-9)).toBe(true);
    const east = lonLatToVec3(90, 0);
    expect(closeTo(east[2]!, -1, 1e-9)).toBe(true);
    const v = lonLatToVec3(123, -45, 2);
    expect(closeTo(Math.hypot(v[0], v[1], v[2]), 2, 1e-9)).toBe(true);
  });
  it('angularDistance: quarter circle on the equator, zero for identical points', () => {
    expect(closeTo(angularDistance(0, 0, 90, 0), Math.PI / 2, 1e-9)).toBe(true);
    expect(closeTo(angularDistance(40, 30, 40, 30), 0, 1e-12)).toBe(true);
    // ~half a great circle for antipodal equatorial points
    expect(closeTo(angularDistance(0, 0, 180, 0), Math.PI, 1e-9)).toBe(true);
  });
  it('3D Tissot circles stay at angular radius ε on the sphere', () => {
    const eps = 8;
    const centre = lonLatToVec3(116, 40);
    for (const [lon, lat] of tissotCircle(40, 116, eps, 24)) {
      const v = lonLatToVec3(lon, lat);
      const dot = centre[0] * v[0] + centre[1] * v[1] + centre[2] * v[2];
      expect(closeTo(dot, Math.cos((eps * Math.PI) / 180), 1e-9)).toBe(true);
    }
  });
});

// ---- 3D terrain mesh ----------------------------------------------------------

describe('terrain 3D mesh', () => {
  it('downsampleGrid shrinks large grids by integer stride and scales cellsize', () => {
    const big: AscGrid = {
      ncols: 10,
      nrows: 10,
      xllcorner: 0,
      yllcorner: 0,
      cellsize: 30,
      nodata: -9999,
      values: new Float64Array(100).map((_, i) => i),
    };
    const small = downsampleGrid(big, 5);
    expect(small.ncols).toBe(5);
    expect(small.nrows).toBe(5);
    expect(small.cellsize).toBe(60);
    expect(small.values[0]).toBe(0);
    expect(small.values[small.values.length - 1]).toBe(big.values[8 * 10 + 8]); // sampled (8,8)
    expect(downsampleGrid(big, 20)).toBe(big); // stride 1 → same object
  });
  it('buildTerrainMesh: one vertex per cell, heights normalised to 0.55·exaggeration', () => {
    const grid: AscGrid = {
      ncols: 4,
      nrows: 3,
      xllcorner: 0,
      yllcorner: 0,
      cellsize: 10,
      nodata: -9999,
      values: new Float64Array([0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110]),
    };
    const mesh = buildTerrainMesh(grid, 1);
    const pos = mesh.geometry.getAttribute('position');
    expect(pos.count).toBe(12);
    let yMax = -Infinity;
    let yMin = Infinity;
    for (let i = 0; i < pos.count; i += 1) {
      const y = pos.getY(i);
      if (y > yMax) yMax = y;
      if (y < yMin) yMin = y;
    }
    expect(closeTo(yMin, 0, 1e-9)).toBe(true);
    expect(closeTo(yMax, 0.55, 1e-6)).toBe(true); // Float32 vertex storage
    // colour attribute present and unit-interval
    const col = mesh.geometry.getAttribute('color');
    expect(col.count).toBe(12);
    mesh.geometry.dispose();
    (mesh.material as { dispose(): void }).dispose();
  });
});

// ---- research upgrades: FAO-56 radiation --------------------------------------

describe('solar radiation (FAO-56)', () => {
  it('R_a at the equator on an equinox ≈ 37.6 MJ·m⁻²·day⁻¹', () => {
    const ra = extraterrestrialRadiation(0, 0, 91);
    expect(closeTo(ra, 37.6, 0.15)).toBe(true);
  });
  it('polar night → zero extraterrestrial radiation', () => {
    expect(extraterrestrialRadiation(80, -23.44, 173)).toBe(0);
  });
  it('clear-sky R_so scales with elevation transmission', () => {
    expect(closeTo(clearSkyRadiation(30, 0), 22.5, 1e-9)).toBe(true);
    expect(closeTo(clearSkyRadiation(30, 1000), 0.77 * 30, 1e-9)).toBe(true);
  });
});

// ---- research upgrades: LOOCV & Moran's I --------------------------------------

describe("LOOCV cross-validation & Moran's I", () => {
  // 5×5 regular grid with a linear trend: symmetric IDW neighbours make
  // interior predictions exact, so RMSE stays a small fraction of the span.
  const trend: Array<{ lon: number; lat: number; value: number }> = [];
  for (let j = 0; j < 5; j += 1) {
    for (let i = 0; i < 5; i += 1) {
      trend.push({ lon: 100 + i * 0.25, lat: 30 + j * 0.25, value: 10 * i + 100 * j });
    }
  }
  it('LOOCV on a smooth trend field keeps RMSE well below the data span', () => {
    const res = loocvValidate(trend, 'idw', 2)!;
    expect(res.n).toBe(25);
    expect(res.rows.length).toBe(25);
    expect(res.mae).toBeLessThan(res.rmse + 1e-9);
    expect(res.rmse).toBeLessThan(0.25 * 440); // span = 10·4 + 100·4
  });
  it('LOOCV needs ≥ 4 stations; kriging LOOCV runs on small sets', () => {
    expect(loocvValidate(trend.slice(0, 3), 'idw', 2)).toBeNull();
    const res = loocvValidate(trend.slice(0, 9), 'kriging', 2);
    expect(res).not.toBeNull();
    expect(Number.isFinite(res!.rmse)).toBe(true);
  });
  it("Moran's I: clustered values → positive I, alternating → negative I", () => {
    const clustered: Array<{ lon: number; lat: number; value: number }> = [];
    for (let i = 0; i < 5; i += 1) {
      clustered.push({ lon: 110 + i * 0.02, lat: 30 + i * 0.02, value: 100 });
      clustered.push({ lon: 112 + i * 0.02, lat: 32 + i * 0.02, value: 0 });
    }
    const pos = moransI(clustered)!;
    expect(pos.i).toBeGreaterThan(0.5);
    expect(pos.z).toBeGreaterThan(0);
    const shuffled = clustered.map((p, k) => ({ ...p, value: k % 2 === 0 ? 100 : 0 }));
    expect(moransI(shuffled)!.i).toBeGreaterThan(0); // same pattern → still clustered
    // Alternating values along one tight line: close neighbours disagree → I < 0.
    const dispersed: Array<{ lon: number; lat: number; value: number }> = [];
    for (let i = 0; i < 10; i += 1) {
      dispersed.push({ lon: 110 + i * 0.01, lat: 30 + i * 0.01, value: i % 2 === 0 ? 100 : 0 });
    }
    expect(moransI(dispersed)!.i).toBeLessThan(0);
  });
  it("Moran's I needs ≥ 4 points", () => {
    expect(moransI(trend.slice(0, 3))).toBeNull();
  });
});

// ---- research upgrades: standard deviational ellipse ---------------------------

describe('standard deviational ellipse', () => {
  it('E-W stretched pattern → major axis bearing 90°, a > b, closed-form axes', () => {
    const pts = [
      { lat: 30, lon: 100 },
      { lat: 30, lon: 102 },
      { lat: 30, lon: 104 },
      { lat: 31, lon: 101 },
      { lat: 29, lon: 101 },
    ];
    const sde = standardDeviationalEllipse(pts)!;
    expect(closeTo(sde.centerLon, 101.6, 1e-9)).toBe(true);
    expect(closeTo(sde.centerLat, 30, 1e-9)).toBe(true);
    expect(sde.azimuthDeg > 89 && sde.azimuthDeg < 91).toBe(true);
    expect(sde.semiMajorKm).toBeGreaterThan(sde.semiMinorKm);
    // Closed form: a = √(Σx²/n) = K·√1.38, b = K·√0.4 with K = 110.574.
    expect(closeTo(sde.semiMajorKm, 130.8, 3)).toBe(true);
    expect(closeTo(sde.semiMinorKm, 69.9, 3)).toBe(true);
  });
  it('needs ≥ 3 points', () => {
    expect(standardDeviationalEllipse([{ lat: 0, lon: 0 }, { lat: 1, lon: 1 }])).toBeNull();
  });
});

// ---- research upgrades: Mercator distortion -------------------------------------

describe('local distortion metrics', () => {
  it('Mercator is conformal with h = k = sec φ (×2 at 60°)', () => {
    const d = distortionAt(projectMercator, 0, 60)!;
    expect(closeTo(d.h, 2, 0.01)).toBe(true);
    expect(closeTo(d.k, 2, 0.01)).toBe(true);
    expect(closeTo(d.areaRatio, 4, 0.05)).toBe(true);
    expect(closeTo(d.flattening, 1, 0.01)).toBe(true);
  });
});

// ---- research upgrades: watershed ------------------------------------------------

describe('watershed: priority-flood / D8 / accumulation', () => {
  it('priority-flood raises an interior depression just above its spill level', () => {
    const values = new Float64Array([5, 5, 5, 5, 1, 5, 5, 5, 5]);
    const filled = fillDepressions(values, 3, 3);
    expect(filled[4]!).toBeGreaterThan(5);
    expect(filled[4]!).toBeLessThan(5.001);
    expect(filled[0]!).toBe(5); // boundary cells are untouched
  });
  it('interior NoData stays NaN and acts as a drain', () => {
    const values = new Float64Array([5, 5, 5, 5, NaN, 5, 5, 5, 5]);
    const filled = fillDepressions(values, 3, 3);
    expect(Number.isNaN(filled[4]!)).toBe(true);
    expect(filled[1]!).toBe(5);
  });
  it('D8 directions descend a tilted plane toward the corner; accumulation sums to n²', () => {
    // A closed cone would be an endoreic basin that priority-flood fills
    // completely; a plane draining to the (0,0) corner is the clean case.
    const n = 5;
    const values = new Float64Array(n * n);
    for (let y = 0; y < n; y += 1) {
      for (let x = 0; x < n; x += 1) values[y * n + x] = x + y;
    }
    const filled = fillDepressions(values, n, n);
    const dir = d8FlowDirections(filled, n, n, 1);
    const acc = flowAccumulation(filled, dir);
    expect(dir[0]!).toBe(D8_NODIR); // (0,0) is the outlet
    expect(closeTo(acc[0]!, 25, 1e-9)).toBe(true);
    for (let i = 1; i < n * n; i += 1) {
      const d = dir[i]!;
      expect(d).toBeGreaterThanOrEqual(0);
      expect(filled[d]!).toBeLessThan(filled[i]!);
    }
    expect(acc[0]!).toBeGreaterThan(acc[n * n - 1]!);
  });
  it('figure panels: three field rasters sized to the grid', () => {
    const grid: AscGrid = {
      ncols: 5,
      nrows: 5,
      xllcorner: 0,
      yllcorner: 0,
      cellsize: 1,
      nodata: -9999,
      values: new Float64Array(25).map((_, i) => Math.hypot((i % 5) - 2, Math.floor(i / 5) - 2)),
    };
    const panels = terrainFigurePanels(grid);
    expect(panels.length).toBe(3);
    for (const p of panels) {
      const series = p.spec.series[0]!;
      expect(series.kind).toBe('field');
      expect(series.field!.values.length).toBe(25);
    }
  });
});

// ---- Figure Studio panel exports -------------------------------------------------

describe('geo Figure Studio panels', () => {
  it('solar: three annual-curve panels with row-major placement', () => {
    const panels = solarFigurePanels(40);
    expect(panels.length).toBe(3);
    panels.forEach((p, i) => {
      expect(p.spec.series.length).toBeGreaterThan(0);
      expect(p.row).toBe(Math.floor(i / 3));
      expect(p.col).toBe(i % 3);
    });
  });
  it('climograph: temperature line + precipitation bars', () => {
    const panels = climographFigurePanels(parseClimateCsv(climateBeijingCsv)!);
    expect(panels.length).toBe(2);
    expect(panels[0]!.spec.series[0]!.kind).toBe('line');
    expect(panels[1]!.spec.series[0]!.kind).toBe('bar');
  });
  it('pyramid: male + female bar panels', () => {
    const panels = pyramidFigurePanels(parsePyramidCsv(popChinaCsv)!);
    expect(panels.length).toBe(2);
    for (const p of panels) expect(p.spec.series[0]!.kind).toBe('bar');
  });
  it('interp: field surface (+ variogram for kriging) + LOOCV scatter', () => {
    const stations = parsePointsCsv(stationsCsv);
    const idw = interpFigurePanels(stations, 'idw', 2);
    expect(idw.length).toBe(2);
    expect(idw[0]!.spec.series[0]!.kind).toBe('field');
    expect(interpFigurePanels(stations, 'kriging', 2).length).toBe(3);
  });
  it('measure: segment bars + cumulative distance line', () => {
    expect(measureFigurePanels(parseWaypoints(measurePointsJson)).length).toBe(2);
  });
  it('tissot: area + axis-ratio profiles', () => {
    expect(tissotFigurePanels('mercator').length).toBe(2);
  });
  it('terrain: three field panels from the sample DEM', () => {
    expect(terrainFigurePanels(parseAsciiGrid(terrainAsc)!).length).toBe(3);
  });
  it('gpx: elevation + gradient panels; no-elevation track → []', () => {
    const pts = parseGpx(fellsGpx);
    const panels = gpxFigurePanels(pts);
    expect(panels.length).toBe(2);
    expect(panels[0]!.spec.series[0]!.points!.length).toBeGreaterThan(0);
    expect(panels[1]!.spec.series[0]!.points!.length).toBeGreaterThan(0);
    expect(closeTo(panels[1]!.spec.xDomain![1]!, trackStats(pts).totalKm, 1e-6)).toBe(true);
    expect(gpxFigurePanels([{ lat: 47, lon: 7 }, { lat: 47.1, lon: 7.1 }])).toEqual([]);
  });
});

// ---- registration -----------------------------------------------------------

describe('geo plugin registration', () => {
  const ids = BUILTIN_PLUGINS.map((p) => p.manifest.id);
  it('all 10 geography plugins are registered (geomap + 8 new + 3D globe)', () => {
    for (const id of [
      'example.geomap',
      'example.geo-solar',
      'example.geo-climograph',
      'example.geo-pop-pyramid',
      'example.geo-interp',
      'example.geo-measure',
      'example.geo-tissot',
      'example.geo-terrain',
      'example.geo-gpx',
      'example.geo-globe',
    ]) {
      expect(ids).toContain(id);
    }
  });
  it('geo plugins map to the geo discipline', () => {
    expect(disciplineOf('example.geo-solar')).toBe('geo');
    expect(disciplineOf('example.geo-gpx')).toBe('geo');
  });
});
