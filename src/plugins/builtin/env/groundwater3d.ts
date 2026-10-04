// ==========================================================================
// Example plugin: 3-D groundwater contaminant transport
//
// Physics (teaching model — Darcy flow + advection–dispersion is the
// physically correct description of contaminant migration in a porous
// medium; turbulence/Navier–Stokes would be wrong here):
//
//   Flow — Darcy's law. The regional hydraulic gradient drives a uniform
//   seepage velocity v0 = K·i/φ along +x, superposed with point
//   potential-flow kernels: the injection source diverges (∝ Q/r²) and the
//   pumping well converges (−∝ Q/r²), both regularised at a well-bore-style
//   radius and clamped. (A fully penetrating well would use a ∝ 1/r kernel;
//   the clamped point kernel preserves the same converge/diverge streamline
//   geometry at teaching scale.) The result is a spatially variable Darcy
//   velocity field — streamlines fan out around the injector and bend into
//   the well, exactly as around real wells.
//
//   Transport — advection–dispersion equation ∂C/∂t = −∇·(vC) + ∇·(D∇C)
//   with velocity-dependent dispersivity D = α·|v| (Bear/Scheidegger) and
//   the vertical (transverse) component scaled by αT/αL ≈ 0.1. The aquifer
//   is 2.5-D: horizontal advection in the flow plane (no vertical
//   advection), dispersion in all three dimensions. Stepped explicitly in
//   conservation (flux) form: first-order upwind advection (mass
//   conservative by telescoping) plus central-difference dispersion, time
//   step clamped to the joint CFL + Neumann stability limit, concentrations
//   clamped at zero. envCore.groundwaterStep (the uniform-velocity variant
//   used by the unit tests) is intentionally left untouched — this file
//   carries its own variable-velocity stepper.
//
//   Rendering — the plume is a continuous concentration iso-surface
//   (three.js MarchingCubes), not voxels: each frame the grid field is
//   trilinearly resampled into the marching-cubes field, and two nested
//   warm-coloured contours (low = amber outer shell, high = deep red core)
//   read as a concentration ramp through the plume — the same amber→deep-red
//   ramp as the vertical colour bar in the 2-D legend. The default iso-value
//   sits above the thin dispersion skirt so the surface traces the physical
//   plume core (teardrop from source to well), not numerical noise. Darcy
//   arrows are oriented and sized by the synthesised velocity field itself,
//   so the converging/diverging flow around the wells is visible directly.
//   Readability: bilingual camera-facing labels (LabelSet) annotate the well,
//   source, plume and aquifer; the 2-D legend carries the story line
//   (source releases → migrates with the flow → well captures) and the flow
//   direction key; the first-fit camera frames source-left / well-right.
//
// The source injects continuously at the user-set (x, depth); first arrival
// of the front (≥ 1 mg/L) at the well is recorded and announced once. A NaN
// guard resets the concentration field (one-time notice) if the explicit
// scheme is ever pushed past its stability envelope. Time stepping runs
// through the host render loop (≤ 4 steps per frame).
// ==========================================================================

import * as THREE from 'three';
import { MarchingCubes } from 'three/examples/jsm/objects/MarchingCubes.js';
import type { ContainerCapabilities, ParamDefinition, Plugin, PluginApi, Scene3DHandle } from '@/types/plugin';
import { pumpWell, type GroundwaterGrid } from './envCore';
import { LabelSet } from './label3d';
import { actionButton, actionFired, exportSnapshotPng, notify } from '@/core/plugin-tools/enhance';
import { isZh } from '@/core/plugin-tools/locale';
import { groundwater3dManifest } from './groundwater3dManifest';

const NX = 40;
const NY = 18;
const NZ = 10;
const DX = 12.5; // m per cell → 500 m aquifer length
const K_MIN = 0.1;
const K_MAX = 100; // m/d, PRD range
const POROSITY = 0.3;
const TRANSVERSE_RATIO = 0.1; // αT/αL — typical teaching ratio for vertical vs longitudinal dispersivity
const V_ABS_MAX = 30; // m/d — hard clamp on the synthesised velocity magnitude
const DT_DAYS = 5; // nominal time step (d); the stepper clamps for stability
const MC_RES = 40; // marching-cubes resolution (≤ 40 per PRD)
const ISO_MIN = 0.5;
const ISO_MAX = 30;

// ---- Plugin ----------------------------------------------------------------

interface State {
  k: number; // hydraulic conductivity m/d
  gradient: number; // dimensionless
  dispL: number; // longitudinal dispersivity m
  srcX: number; // 0–1 normalised (along flow)
  srcZ: number; // 0–1 normalised (vertical depth)
  srcRate: number; // mg/L held at the source cells (sets the mass flux)
  isovalue: number; // mg/L — plume iso-surface threshold
  playing: boolean;
}

const DEFAULTS: State = {
  k: 10,
  gradient: 0.005,
  dispL: 10,
  srcX: 0.25,
  srcZ: 0.5,
  srcRate: 100,
  // Default raised from 2 mg/L: at very low thresholds the surface follows the
  // thin dispersion skirt (numerical noise halo) and reads as a wavy flag
  // instead of the physical plume. ~6% of C₀ traces the teardrop core that
  // migrates from the source toward the well.
  isovalue: 6,
  playing: true,
};

export class Groundwater3DPlugin implements Plugin {
  readonly manifest = groundwater3dManifest;
  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  private three: Scene3DHandle | null = null;
  private group: THREE.Group | null = null;
  /** Bilingual camera-facing text annotations (well / source / plume / aquifer). */
  private labels = new LabelSet();
  private offLocale: (() => void) | null = null;
  /** Fit the camera only on first show / re-activation — never yank it back
   * while the user is orbiting or dragging parameter sliders. */
  private needsFit = true;
  private mcOuter: MarchingCubes | null = null;
  private mcInner: MarchingCubes | null = null;
  private state: State = { ...DEFAULTS };
  private grid: GroundwaterGrid | null = null;
  /**
   * Plan-view Darcy velocity components (m/d), indexed [y * NX + x] over the
   * flow plane: vx along the flow (grid x) and vz lateral (grid y = world z).
   * The aquifer is 2.5-D — horizontal advection only; grid z (vertical)
   * carries no advection, just dispersion.
   */
  private vx = new Float32Array(NX * NY);
  private vz = new Float32Array(NX * NY);
  private simDays = 0;
  private arrivalDays: number | null = null;
  private rafId = 0;
  private lastT = 0;
  private clampedWarned = false;
  private nanWarned = false;
  /** Concentration field changed since the last iso-surface field upload. */
  private dirtyField = true;

  async init(api: PluginApi) {
    this.api = api;
    // Locale switch: re-render the bilingual 3-D labels + 2-D legend in place.
    this.offLocale = api.onLocaleChange((l) => {
      this.labels.refresh(isZh(l) ? 'zh-CN' : 'en-US');
      this.drawLegend();
      this.three?.render();
    });
  }

  async destroy() {
    this.offLocale?.();
    this.offLocale = null;
    this.stopTick();
    this.clearGroup();
    this.grid = null;
    this.three = null;
    this.ctx = null;
  }

  async activate(context: { container: ContainerCapabilities }) {
    this.ctx = context.container;
    if (context.container.three) this.three = context.container.three;
    this.needsFit = true;
    this.resetSim();
    this.rebuild();
  }

  async deactivate() {
    this.stopTick();
    this.clearGroup();
    this.three?.setVisible(false);
  }

  render(container: ContainerCapabilities) {
    this.ctx = container;
    if (container.three) this.three = container.three;
    this.resetSim();
    this.rebuild();
  }

  renderToScene(scene: Scene3DHandle) {
    this.three = scene;
    this.resetSim();
    this.rebuild();
  }

  getParams(): ParamDefinition[] {
    const zh = isZh(this.api.locale);
    const kOutOfRange = this.state.k < K_MIN || this.state.k > K_MAX;
    return [
      {
        key: 'k',
        label: 'Hydraulic conductivity K (m/d)',
        labelI18n: { 'zh-CN': '渗透系数 K（m/d）', 'en-US': 'Hydraulic conductivity K (m/d)' },
        type: 'number',
        min: 0,
        max: 200,
        step: 1,
        value: this.state.k,
        hint: zh ? `合理范围 ${K_MIN}–${K_MAX} m/d，越界禁用计算` : `Valid ${K_MIN}–${K_MAX} m/d; out of range disables the model`,
      },
      { key: 'gradient', label: 'Hydraulic gradient i', labelI18n: { 'zh-CN': '水力梯度 i', 'en-US': 'Hydraulic gradient i' }, type: 'range', min: 0.001, max: 0.02, step: 0.001, value: this.state.gradient },
      { key: 'dispL', label: 'Longitudinal dispersivity (m)', labelI18n: { 'zh-CN': '纵向弥散度（m）', 'en-US': 'Longitudinal dispersivity (m)' }, type: 'number', min: 0, max: 50, step: 1, value: this.state.dispL },
      { key: 'srcX', label: 'Source x (0–1)', labelI18n: { 'zh-CN': '污染源位置 x（0–1）', 'en-US': 'Source x (0–1)' }, type: 'range', min: 0.05, max: 0.5, step: 0.05, value: this.state.srcX },
      { key: 'srcZ', label: 'Source z (0–1)', labelI18n: { 'zh-CN': '污染源位置 z（0–1）', 'en-US': 'Source z (0–1)' }, type: 'range', min: 0.1, max: 0.9, step: 0.05, value: this.state.srcZ },
      {
        key: 'srcRate',
        label: 'Injection rate C₀ (mg/L)',
        labelI18n: { 'zh-CN': '注入速率 C₀（mg/L）', 'en-US': 'Injection rate C₀ (mg/L)' },
        type: 'number',
        min: 10,
        max: 500,
        step: 10,
        value: this.state.srcRate,
        hint: zh ? '注入源单元格持续维持的浓度，决定进入含水层的质量通量' : 'Concentration held at the source cells; sets the mass flux into the aquifer',
      },
      {
        key: 'isovalue',
        label: 'Iso-surface threshold (mg/L)',
        labelI18n: { 'zh-CN': '等值面阈值（mg/L）', 'en-US': 'Iso-surface threshold (mg/L)' },
        type: 'range',
        min: ISO_MIN,
        max: ISO_MAX,
        step: 0.5,
        value: this.state.isovalue,
        hint: zh ? '污染羽等值面的浓度阈值，越低羽流显示越大' : 'Concentration threshold of the plume iso-surface; lower → larger plume',
      },
      { key: 'play', label: zh ? '播放' : 'Play', offLabelI18n: { 'zh-CN': '播放', 'en-US': 'Play' }, onLabelI18n: { 'zh-CN': '暂停', 'en-US': 'Pause' }, labelI18n: { 'zh-CN': '播放 / 暂停', 'en-US': 'Play / Pause' }, type: 'toggle', value: this.state.playing, offLabel: zh ? '播放' : 'Play', onLabel: zh ? '暂停' : 'Pause' },
      actionButton('resetSim', 'Restart simulation', '重置仿真'),
      { key: 'reset', label: 'Reset to defaults', labelI18n: { 'zh-CN': '回到初始参数', 'en-US': 'Reset to defaults' }, type: 'button', action: 'reset' },
      actionButton('fitView', 'Fit view', '重置视角'),
      actionButton('exportPng', 'Snapshot PNG', '快照 PNG'),
      actionButton('exportPngTransparent', 'Snapshot PNG (transparent)', '快照 PNG（透明）'),
      actionButton('reloadPlugin', 'Reset Plugin', '重置插件'),
      ...(kOutOfRange
        ? [
            {
              key: 'kWarn',
              label: zh ? `K 越界 — 已禁用（${K_MIN}–${K_MAX} m/d）` : `K out of range — disabled (${K_MIN}–${K_MAX} m/d)`,
              labelI18n: { 'zh-CN': `K 越界 — 已禁用（${K_MIN}–${K_MAX} m/d）`, 'en-US': `K out of range — disabled (${K_MIN}–${K_MAX} m/d)` },
              type: 'checkbox' as const,
              value: true,
            },
          ]
        : []),
    ];
  }

  updateParams(params: Record<string, unknown>) {
    if (actionFired(params, 'exportPng')) {
      exportSnapshotPng(this.api, this.three?.snapshot() ?? null, 'env-groundwater3d');
      return;
    }
    if (actionFired(params, 'exportPngTransparent')) {
      exportSnapshotPng(this.api, this.three?.snapshot({ transparent: true }) ?? null, 'env-groundwater3d');
      return;
    }
    if (actionFired(params, 'fitView')) {
      this.fitCamera();
      return;
    }
    if (actionFired(params, 'reloadPlugin')) {
      notify(this.api, 'info', 'Resetting plugin…', '正在重置插件…');
      void this.api.reload?.();
      return;
    }
    if (actionFired(params, 'reset')) {
      this.state = { ...DEFAULTS };
      this.resetSim();
      this.rebuild();
      return;
    }
    if (actionFired(params, 'resetSim')) {
      this.resetSim();
      this.refreshSurfaces(true);
      notify(this.api, 'info', 'Simulation restarted.', '仿真已重置。');
      return;
    }
    let simReset = false;
    let fieldReset = false;
    if (typeof params.k === 'number' && params.k !== this.state.k) {
      this.state.k = params.k;
      simReset = true;
    }
    if (typeof params.gradient === 'number' && params.gradient !== this.state.gradient) {
      this.state.gradient = params.gradient;
      simReset = true;
    }
    if (typeof params.dispL === 'number' && params.dispL >= 0 && params.dispL !== this.state.dispL) {
      this.state.dispL = Math.min(50, params.dispL);
      simReset = true;
    }
    if (typeof params.srcX === 'number' && params.srcX !== this.state.srcX) {
      this.state.srcX = params.srcX;
      simReset = true;
    }
    if (typeof params.srcZ === 'number' && params.srcZ !== this.state.srcZ) {
      this.state.srcZ = params.srcZ;
      simReset = true;
    }
    if (typeof params.srcRate === 'number' && params.srcRate >= 10 && params.srcRate !== this.state.srcRate) {
      this.state.srcRate = Math.min(500, params.srcRate);
      fieldReset = true;
    }
    if (typeof params.isovalue === 'number' && Number.isFinite(params.isovalue) && params.isovalue !== this.state.isovalue) {
      this.state.isovalue = Math.min(ISO_MAX, Math.max(ISO_MIN, params.isovalue));
    }
    if (typeof params.play === 'boolean' && params.play !== this.state.playing) {
      this.state.playing = params.play;
    }
    if (simReset) {
      // Flow / transport parameters changed → rebuild the velocity field,
      // restart the plume and refresh the static furniture (arrows).
      this.resetSim();
      this.rebuild();
    } else if (fieldReset) {
      this.resetSim();
      this.refreshSurfaces(true);
      this.drawLegend();
    } else {
      // Isovalue (and other render-only) changes: cheap isolation update,
      // also renders one frame while paused.
      this.refreshSurfaces();
      this.drawLegend();
    }
    if (this.state.playing) this.ensureTick();
  }

  getSupportedFormats() {
    return this.manifest.formats ?? [];
  }

  /** Regional Darcy seepage velocity (m/d) — teaching value with fixed porosity. */
  private velocity(): number {
    return (this.state.k * this.state.gradient) / POROSITY;
  }

  private kOutOfRange(): boolean {
    return this.state.k < K_MIN || this.state.k > K_MAX;
  }

  // ---- flow field ------------------------------------------------------------
  // (Darcy potential-flow superposition — see the file header for the model.)

  /** Injector plan position in metres (cell centre; lateral fixed mid-plane). */
  private srcPlanMetres(): [number, number] {
    const [sx, sy] = this.srcCell();
    return [(sx + 0.5) * DX, (sy + 0.5) * DX];
  }

  /** Pumping-well plan position in metres (cell centre). */
  private wellPlanMetres(): [number, number] {
    const [wx, wy] = this.wellCell();
    return [(wx + 0.5) * DX, (wy + 0.5) * DX];
  }

  /**
   * Synthesise the plan-view Darcy velocity field: regional gradient flow
   * plus clamped point-source (diverging ∝ Q/r²) and well (converging)
   * kernels, regularised at r ≥ 2·DX so nothing divides by zero.
   */
  private computeVelocityField() {
    const v0 = this.velocity();
    const [scx, scz] = this.srcPlanMetres();
    const [wcx, wcz] = this.wellPlanMetres();
    // Kernel speed scales: track the regional flow when it is strong, keep a
    // floor so wells still draw in near-stagnant aquifers, and a ceiling so
    // the explicit transport step stays well-behaved.
    const vSrc = Math.min(Math.max(4 * v0, 0.5), 25);
    const vWell = Math.min(Math.max(2 * v0, 0.25), 20);
    const rSrc0 = 3 * DX; // reference radius: kernel speed equals its scale there
    const rWell0 = 4 * DX;
    const rEps = 2 * DX; // well-bore-style regularisation radius
    for (let gy = 0; gy < NY; gy += 1) {
      for (let gx = 0; gx < NX; gx += 1) {
        const px = (gx + 0.5) * DX;
        const pz = (gy + 0.5) * DX;
        let vx = v0;
        let vz = 0;
        // Injector: radially diverging ∝ Q/r² (clamped).
        let dx = px - scx;
        let dz = pz - scz;
        let r = Math.max(Math.hypot(dx, dz), rEps);
        let s = Math.min((vSrc * rSrc0 * rSrc0) / (r * r), V_ABS_MAX);
        vx += (s * dx) / r;
        vz += (s * dz) / r;
        // Pumping well: radially converging.
        dx = px - wcx;
        dz = pz - wcz;
        r = Math.max(Math.hypot(dx, dz), rEps);
        s = Math.min((vWell * rWell0 * rWell0) / (r * r), V_ABS_MAX);
        vx -= (s * dx) / r;
        vz -= (s * dz) / r;
        // Final clamp on the speed magnitude (keeps the CFL sane).
        const sp = Math.hypot(vx, vz);
        if (sp > V_ABS_MAX) {
          vx *= V_ABS_MAX / sp;
          vz *= V_ABS_MAX / sp;
        }
        this.vx[gy * NX + gx] = vx;
        this.vz[gy * NX + gx] = vz;
      }
    }
  }

  // ---- transport -------------------------------------------------------------

  private resetSim() {
    this.computeVelocityField();
    this.grid = { nx: NX, ny: NY, nz: NZ, c: new Float64Array(NX * NY * NZ) };
    this.simDays = 0;
    this.arrivalDays = null;
    this.clampedWarned = false;
    this.nanWarned = false;
    this.inject();
    this.stepSim(30); // pre-run a little so the plume is visible on load
    this.dirtyField = true;
  }

  private srcCell(): [number, number, number] {
    return [
      Math.min(NX - 2, Math.max(1, Math.round(this.state.srcX * NX))),
      Math.round(NY / 2),
      Math.min(NZ - 2, Math.max(1, Math.round(this.state.srcZ * NZ))),
    ];
  }

  private inject() {
    if (!this.grid) return;
    const [sx, sy, sz] = this.srcCell();
    const r = 1;
    for (let dz = -r; dz <= r; dz += 1) {
      for (let dy = -r; dy <= r; dy += 1) {
        const idx = ((sz + dz) * NY + sy + dy) * NX + sx;
        this.grid.c[idx] = this.state.srcRate; // source held at C₀ each step (Dirichlet)
      }
    }
  }

  private wellCell(): [number, number, number] {
    return [NX - 4, Math.round(NY / 2), Math.round(NZ / 2)];
  }

  /**
   * One explicit advection–dispersion step with the spatially variable Darcy
   * velocity field (self-written variant of envCore.groundwaterStep, which is
   * kept untouched for the uniform-velocity tests).
   *
   * Flux (conservation) form: the upwind advective flux across each face is
   * moved between neighbour cells, so Σc is preserved up to boundary fluxes,
   * the injector and the well — the telescoping property of conservative
   * schemes. Dispersion uses central differences with per-cell
   * velocity-dependent D (longitudinal × dispersivity; vertical scaled by
   * αT/αL). The step is clamped to the joint CFL (advection) + Neumann
   * (dispersion, Σ D_i·dt/dx² ≤ 1/2) limit.
   */
  private stepTransport(dtNominal: number): { clamped: boolean; dt: number } {
    const grid = this.grid;
    if (!grid) return { clamped: false, dt: 0 };
    const { nx, ny, nz, c } = grid;
    const alphaL = this.state.dispL;
    const alphaT = alphaL * TRANSVERSE_RATIO;
    // Peak plan speed → joint stability limit.
    let vmax = 1e-6;
    for (let i = 0; i < this.vx.length; i += 1) {
      const ax = Math.abs(this.vx[i]!);
      if (ax > vmax) vmax = ax;
      const az = Math.abs(this.vz[i]!);
      if (az > vmax) vmax = az;
    }
    const dtAdv = DX / vmax; // CFL: |v|·dt/dx ≤ 1
    const dMax = alphaL * vmax;
    // Neumann: dt ≤ dx² / (2·ΣD_i) over the three dispersion directions.
    const dtDisp = (DX * DX) / (2 * (dMax + dMax + alphaT * dMax) + 1e-9);
    const dt = Math.min(dtNominal, dtAdv, dtDisp);
    const clamped = dt < dtNominal * 0.999;

    const next = new Float64Array(c.length);
    next.set(c);
    const adv = dt / DX;
    const dif = dt / (DX * DX);

    for (let z = 0; z < nz; z += 1) {
      for (let y = 0; y < ny; y += 1) {
        const prow = y * nx;
        for (let x = 0; x < nx; x += 1) {
          const i = (z * ny + y) * nx + x;
          const p = prow + x; // plan (flow-plane) velocity index
          const cur = c[i]!;
          // — advection: upwind flux form (closed boundaries → face skipped) —
          if (x + 1 < nx) {
            const v = this.vx[p]!;
            const f = v * (v >= 0 ? cur : c[i + 1]!) * adv;
            next[i] = next[i]! - f;
            next[i + 1] = next[i + 1]! + f;
          }
          if (y + 1 < ny) {
            const v = this.vz[p]!; // lateral plan component (grid y axis)
            const f = v * (v >= 0 ? cur : c[i + nx]!) * adv;
            next[i] = next[i]! - f;
            next[i + nx] = next[i + nx]! + f;
          }
          // — dispersion: central differences, velocity-dependent D —
          const sp = Math.hypot(this.vx[p]!, this.vz[p]!);
          if (alphaL > 0 && sp > 1e-12) {
            const dh = alphaL * sp;
            const dv = alphaT * sp;
            let lap = 0;
            if (x > 0 && x + 1 < nx) lap += dh * (c[i - 1]! - 2 * cur + c[i + 1]!);
            if (y > 0 && y + 1 < ny) lap += dh * (c[i - nx]! - 2 * cur + c[i + nx]!);
            if (z > 0 && z + 1 < nz) lap += dv * (c[i - nx * ny]! - 2 * cur + c[i + nx * ny]!);
            next[i] = next[i]! + dif * lap;
          }
          // Zero floor: clean up rounding-level undershoot (c ≥ 0 physically).
          const val = next[i]!;
          if (val < 0 && val > -1e-6) next[i] = 0;
        }
      }
    }
    grid.c.set(next);
    return { clamped, dt };
  }

  private hasNaN(): boolean {
    const c = this.grid?.c;
    if (!c) return false;
    for (let i = 0; i < c.length; i += 1) {
      if (!Number.isFinite(c[i]!)) return true;
    }
    return false;
  }

  /** Advance the simulation by ~`frames` explicit steps (called each tick). */
  private stepSim(frames = 1) {
    if (!this.grid || this.kOutOfRange()) return;
    const [wx, wy, wz] = this.wellCell();
    const wIdx = (wz * NY + wy) * NX + wx;
    for (let f = 0; f < frames; f += 1) {
      const { clamped, dt } = this.stepTransport(DT_DAYS);
      if (clamped && !this.clampedWarned) {
        this.clampedWarned = true;
        this.api.log('warn', 'Time step clamped to the CFL/Neumann stability limit');
      }
      this.inject();
      pumpWell(this.grid, wx, wy, wz, 0.25);
      this.simDays += dt;
      // NaN guard: reset the concentration field (once) if the explicit step
      // is ever pushed past its stability envelope.
      if (this.hasNaN()) {
        this.grid.c.fill(0);
        this.inject();
        this.arrivalDays = null;
        if (!this.nanWarned) {
          this.nanWarned = true;
          notify(this.api, 'warning', 'Numerical instability detected — concentration field reset.', '检测到数值发散 — 浓度场已重置。');
          this.api.log('warn', 'NaN detected in the concentration field; field reset');
        }
      } else if (this.arrivalDays === null && this.grid.c[wIdx]! >= 1) {
        // First arrival: the front (≥ 1 mg/L) has reached the well cell.
        this.arrivalDays = this.simDays;
        notify(
          this.api,
          'success',
          `Plume front reached the well at day ${Math.round(this.arrivalDays)}.`,
          `污染羽前锋于第 ${Math.round(this.arrivalDays)} 天到达抽水井。`,
        );
        this.api.log('info', `First arrival at the well: ${this.arrivalDays.toFixed(1)} d (front ≥ 1 mg/L)`);
      }
    }
    this.dirtyField = true;
  }

  // ---- render loop -----------------------------------------------------------

  private tick = (t: number) => {
    this.rafId = 0;
    const three = this.three;
    if (!three || !this.state.playing) return;
    const dt = this.lastT ? (t - this.lastT) / 1000 : 0;
    this.lastT = t;
    const steps = Math.min(4, Math.max(1, Math.round(dt * 60))); // ≤ 4 explicit steps per frame
    this.stepSim(steps);
    this.refreshSurfaces();
    this.rafId = requestAnimationFrame(this.tick);
  };

  private ensureTick() {
    if (!this.rafId && this.three && this.state.playing) this.rafId = requestAnimationFrame(this.tick);
  }

  private stopTick() {
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
    this.lastT = 0;
  }

  // ---- scene ---------------------------------------------------------------

  /** Remove the group from the SHARED host scene and dispose everything. */
  private clearGroup() {
    // Labels first: they own canvas textures + sprite materials and keep
    // bookkeeping state — dispose() also empties labels.group so a rebuild
    // starts clean (no duplicates, no leaks).
    this.labels.dispose();
    if (!this.group) return;
    this.group.parent?.remove(this.group);
    this.group.traverse((obj) => {
      const withGeo = obj as THREE.Mesh;
      withGeo.geometry?.dispose();
      const mat = (withGeo as unknown as { material?: THREE.Material | THREE.Material[] }).material;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else mat?.dispose();
    });
    this.group = null;
    this.mcOuter = null;
    this.mcInner = null;
  }

  private fitCamera() {
    if (!this.three) return;
    // Story framing: injection source on the LEFT, pumping well on the RIGHT,
    // seen from an oblique angle that faces the flow plane so the Darcy
    // arrows run left → right into the well — source releases → contaminant
    // migrates with the flow → well captures.
    this.three.camera.position.set(1.9, 1.3, 3.2);
    this.three.camera.lookAt(0.1, 0.2, 0);
    this.three.controls.update?.();
    this.three.render();
  }

  /** Full rebuild: static furniture (arrows, well, source, grid) + iso-surfaces. */
  private rebuild() {
    const three = this.three;
    if (!three) return;
    this.stopTick();
    this.clearGroup();
    const group = new THREE.Group();
    group.add(new THREE.AmbientLight(0x9fb4cc, 1.05));
    const sun = new THREE.DirectionalLight(0xffffff, 1.2);
    sun.position.set(2.4, 3.0, 1.6);
    group.add(sun);

    // Aquifer bounding box (wireframe).
    const box = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(1.9, 0.5, 0.9)),
      new THREE.LineBasicMaterial({ color: 0x5a6b80, transparent: true, opacity: 0.7 }),
    );
    box.position.y = 0.28;
    group.add(box);

    // Water-table ground grid just above the aquifer top face.
    const ground = new THREE.GridHelper(2.3, 23, 0x44566b, 0x2e3c4c);
    const gmat = ground.material as THREE.LineBasicMaterial;
    gmat.transparent = true;
    gmat.opacity = 0.28;
    ground.position.y = 0.535;
    group.add(ground);

    // Darcy flow arrows: samples of the synthesised velocity field (every 3rd
    // plan cell), oriented along the local Darcy velocity with length ∝ speed
    // — the diverging cone at the injector and the converging cone at the well
    // are visible directly. Kept slim (small heads, translucent) so the field
    // reads as a flow texture, not a wall of grey icons; direction is also
    // explained in the 2-D legend instead of a floating 3-D label.
    const vRef = Math.max(this.velocity(), 0.5);
    const arrowMat = new THREE.LineBasicMaterial({ color: 0x8fa8c0, transparent: true, opacity: 0.65 });
    for (let gy = 2; gy < NY; gy += 3) {
      for (let gx = 2; gx < NX; gx += 3) {
        const p = gy * NX + gx;
        const vx = this.vx[p]!;
        const vz = this.vz[p]!;
        const sp = Math.hypot(vx, vz);
        if (sp < 0.02) continue;
        const len = 0.05 + 0.09 * Math.min(sp / vRef, 2);
        const arrow = new THREE.ArrowHelper(
          new THREE.Vector3(vx / sp, 0, vz / sp),
          new THREE.Vector3(((gx + 0.5) / NX) * 1.9 - 0.95, 0.28, ((gy + 0.5) / NY) * 0.9 - 0.45),
          len,
          0x8fa8c0,
          len * 0.16, // head length — halved from the old chunky look
          len * 0.08, // head width — halved
        );
        (arrow.line as THREE.Line).material = arrowMat;
        (arrow.cone as THREE.Mesh).material = arrowMat;
        group.add(arrow);
      }
    }

    // Source marker (pink — kept distinct from the red plume surface) + well
    // (blue cylinder), each annotated with a camera-facing bilingual label.
    const [sx, , sz] = this.srcCell();
    const source = new THREE.Mesh(
      new THREE.SphereGeometry(0.045, 16, 12),
      new THREE.MeshStandardMaterial({ color: 0xef5f9a, emissive: 0x4a0f2a }),
    );
    source.position.set((sx / NX) * 1.9 - 0.95, 0.28, (sz / NZ) * 0.9 - 0.45);
    group.add(source);
    const [wx, , wz] = this.wellCell();
    const well = new THREE.Mesh(
      new THREE.CylinderGeometry(0.035, 0.035, 0.56, 12),
      new THREE.MeshStandardMaterial({ color: 0x7ec8e3, emissive: 0x0f2f3d }),
    );
    well.position.set((wx / NX) * 1.9 - 0.95, 0.28, (wz / NZ) * 0.9 - 0.45);
    group.add(well);

    // Text annotations (bilingual, always camera-facing) so the user can read
    // the scene at a glance. Flow direction gets a legend line instead of a
    // floating label — the arrows span the whole domain, one label there would
    // be more confusing than helpful.
    const locale: 'zh-CN' | 'en-US' = isZh(this.api.locale) ? 'zh-CN' : 'en-US';
    this.labels.add('抽水井', 'Pumping well', locale, [(wx / NX) * 1.9 - 0.95, 0.68, (wz / NZ) * 0.9 - 0.45], { font: 42 });
    this.labels.add('注入源', 'Injection source', locale, [(sx / NX) * 1.9 - 0.95, 0.44, (sz / NZ) * 0.9 - 0.45], { font: 42 });
    this.labels.add('污染羽', 'Contaminant plume', locale, [((sx / NX) * 1.9 - 0.95 + (wx / NX) * 1.9 - 0.95) / 2, 0.74, 0], { font: 42 });
    this.labels.add('含水层', 'Aquifer', locale, [-0.9, 0.06, 0.42], { font: 34 });
    group.add(this.labels.group);

    // Plume iso-surfaces (MarchingCubes, replaces the voxel cloud): two
    // nested warm contours on one scientific ramp — an amber outer shell at
    // the isovalue and a deep-red core at ~3× — matching the colour bar in
    // the 2-D legend (amber = low, deep red = high concentration).
    // Translucent, depthWrite off so the interior stays visible.
    const mcOuter = new MarchingCubes(
      MC_RES,
      new THREE.MeshStandardMaterial({
        color: 0xf0a24a,
        transparent: true,
        opacity: 0.35,
        depthWrite: false,
        side: THREE.DoubleSide,
        roughness: 0.7,
        metalness: 0.05,
      }),
      false,
      false,
      60000,
    );
    // MC local space spans [−1, 1]³ → scale onto the aquifer box; local axes
    // map (x, y, z) = (flow, vertical, lateral) to match writeField().
    mcOuter.scale.set(0.95, 0.25, 0.45);
    mcOuter.position.y = 0.28;
    mcOuter.renderOrder = 1;
    group.add(mcOuter);
    const mcInner = new MarchingCubes(
      MC_RES,
      new THREE.MeshStandardMaterial({
        color: 0x9c1408, // deep red — clearly "hotter" than the amber shell
        transparent: true,
        opacity: 0.62,
        depthWrite: false,
        side: THREE.DoubleSide,
        roughness: 0.55,
        metalness: 0.05,
      }),
      false,
      false,
      60000,
    );
    mcInner.scale.set(0.95, 0.25, 0.45);
    mcInner.position.y = 0.28;
    mcInner.renderOrder = 2;
    group.add(mcInner);
    this.mcOuter = mcOuter;
    this.mcInner = mcInner;

    this.group = group;
    three.scene.add(group);
    this.refreshSurfaces(true);
    if (this.needsFit) {
      this.fitCamera();
      this.needsFit = false;
    }
    three.setVisible(true);
    this.drawLegend();
    three.render();
    if (this.state.playing) this.ensureTick();
  }

  /**
   * 2-D overlay legend (when a canvas2d exists): a one-line story caption
   * (source releases → migrates with the flow → well captures) plus a
   * vertical concentration colour bar — amber (low) → deep red (high),
   * matching the plume contours — titled 「浓度 (mg/L) / Concentration (mg/L)」
   * with the outer iso-surface threshold ticked on the ramp.
   */
  private drawLegend() {
    const canvas = this.ctx?.canvas2d;
    if (!canvas) return;
    const g = canvas.getContext('2d');
    if (!g) return;
    const zh = isZh(this.api.locale);
    canvas.width = canvas.clientWidth || 760;
    canvas.height = canvas.clientHeight || 460;
    const bg = getComputedStyle(canvas).backgroundColor || '#0a0e13';
    g.fillStyle = bg;
    g.fillRect(0, 0, canvas.width, canvas.height);

    // Story caption + furniture key (flow direction is explained here rather
    // than by a floating 3-D label — the arrows span the whole domain).
    g.font = "12px 'Microsoft YaHei', Consolas, monospace";
    g.textAlign = 'left';
    g.textBaseline = 'alphabetic';
    g.fillStyle = 'rgba(230, 238, 248, 0.95)';
    g.fillText(
      zh ? '地下水污染运移 — 注入源释放 → 随水流迁移 → 抽水井捕获' : 'Contaminant transport — source releases → migrates with the flow → well captures',
      16,
      24,
    );
    g.fillStyle = 'rgba(150, 168, 190, 0.9)';
    g.fillText(
      zh
        ? '灰箭头：地下水流向（达西流速，长度∝流速） · 蓝圆柱：抽水井 · 粉球：注入源'
        : 'Grey arrows: flow direction (Darcy velocity, length ∝ speed) · Blue cylinder: pumping well · Pink sphere: injection source',
      16,
      42,
    );

    // Vertical colour bar: low (amber, bottom) → high (deep red, top).
    const barW = 14;
    const barH = Math.min(150, Math.max(90, canvas.height * 0.32));
    const bx = canvas.width - barW - 24;
    const by = canvas.height - barH - 34;
    const grad = g.createLinearGradient(0, by + barH, 0, by);
    grad.addColorStop(0, '#f0a24a');
    grad.addColorStop(0.55, '#c23a12');
    grad.addColorStop(1, '#9c1408');
    g.fillStyle = grad;
    g.fillRect(bx, by, barW, barH);
    g.strokeStyle = 'rgba(150, 168, 190, 0.55)';
    g.lineWidth = 1;
    g.strokeRect(bx + 0.5, by + 0.5, barW - 1, barH - 1);
    // Title above the bar.
    g.fillStyle = 'rgba(230, 238, 248, 0.95)';
    g.textAlign = 'center';
    g.fillText(zh ? '浓度 (mg/L)' : 'Concentration (mg/L)', bx + barW / 2, by - 10);
    // Range labels: 0 at the bottom, C₀ (the held source concentration) on top.
    g.fillStyle = 'rgba(150, 165, 185, 0.9)';
    g.textAlign = 'right';
    g.fillText('0', bx - 6, by + barH);
    g.fillText(String(Math.round(this.state.srcRate)), bx - 6, by + 10);
    // Tick where the outer iso-surface sits on the ramp.
    const iso = this.state.isovalue;
    if (iso > 0 && iso < this.state.srcRate) {
      const ty = by + barH * (1 - iso / this.state.srcRate);
      g.strokeStyle = 'rgba(255, 255, 255, 0.85)';
      g.beginPath();
      g.moveTo(bx - 4, ty);
      g.lineTo(bx + barW + 4, ty);
      g.stroke();
      g.fillStyle = 'rgba(230, 238, 248, 0.95)';
      g.fillText(String(iso), bx - 6, ty + 4);
    }
  }

  /**
   * Push the current isolation values to the iso-surfaces and, when the
   * concentration field changed (or `force`), resample it into the
   * marching-cubes fields and re-polygonise. Renders one frame.
   */
  private refreshSurfaces(force = false) {
    const three = this.three;
    const mcOuter = this.mcOuter;
    const mcInner = this.mcInner;
    if (!three || !mcOuter || !mcInner) return;
    const iso = this.state.isovalue;
    const srcCap = this.state.srcRate * 0.8;
    const innerIso = Math.max(iso * 1.5, Math.min(iso * 3, srcCap));
    const isoChanged = mcOuter.isolation !== iso || mcInner.isolation !== innerIso;
    mcOuter.isolation = iso;
    mcInner.isolation = innerIso;
    mcInner.visible = innerIso > iso;
    if (force || this.dirtyField || isoChanged) {
      if (force || this.dirtyField) {
        mcOuter.reset();
        const above = this.writeField(mcOuter);
        this.api.reportDataScale(above);
        mcInner.reset();
        mcInner.field.set(mcOuter.field); // same field, different isolation
        this.dirtyField = false;
      }
      mcOuter.update();
      mcInner.update();
      three.render();
    }
  }

  /**
   * Trilinearly resample the simulation grid into a marching-cubes field.
   *
   * Axis mapping — sim (x, y, z) = (flow, lateral, vertical); MC local axes
   * (x, y, z) = (flow, vertical→world y, lateral→world z), matching the mesh
   * scale (0.95, 0.25, 0.45) and the aquifer box. MC field index is
   * size²·z + size·y + x. Returns the number of MC cells at/above the outer
   * isovalue (reported to the perf panel as the rendered data scale).
   */
  private writeField(mc: MarchingCubes): number {
    const grid = this.grid;
    if (!grid) return 0;
    const { nx, ny, nz, c } = grid;
    const size = mc.size;
    const size2 = mc.size2;
    const field = mc.field;
    const rm = size - 1;
    const iso = this.state.isovalue;
    let above = 0;

    // Per-axis resample tables: MC cell k → sim cell pair (i0, i1) + weight.
    const axis = (n: number) => {
      const i0 = new Int32Array(size);
      const i1 = new Int32Array(size);
      const t = new Float32Array(size);
      for (let k = 0; k < size; k += 1) {
        const f = (k / rm) * (n - 1);
        const a = Math.min(Math.floor(f), n - 2);
        i0[k] = a;
        i1[k] = a + 1;
        t[k] = f - a;
      }
      return { i0, i1, t };
    };
    const axX = axis(nx); // MC x = sim x (flow)
    const axY = axis(ny); // MC z = sim y (lateral)
    const axZ = axis(nz); // MC y = sim z (vertical)

    for (let d = 0; d < size; d += 1) {
      const y0 = axY.i0[d]!;
      const y1 = axY.i1[d]!;
      const ty = axY.t[d]!;
      for (let b = 0; b < size; b += 1) {
        const z0 = axZ.i0[b]!;
        const z1 = axZ.i1[b]!;
        const tz = axZ.t[b]!;
        const zo0 = z0 * ny;
        const zo1 = z1 * ny;
        let mcIdx = d * size2 + b * size;
        for (let a = 0; a < size; a += 1, mcIdx += 1) {
          const x0 = axX.i0[a]!;
          const x1 = axX.i1[a]!;
          const tx = axX.t[a]!;
          const v000 = c[(zo0 + y0) * nx + x0]!;
          const v100 = c[(zo0 + y0) * nx + x1]!;
          const v010 = c[(zo0 + y1) * nx + x0]!;
          const v110 = c[(zo0 + y1) * nx + x1]!;
          const v001 = c[(zo1 + y0) * nx + x0]!;
          const v101 = c[(zo1 + y0) * nx + x1]!;
          const v011 = c[(zo1 + y1) * nx + x0]!;
          const v111 = c[(zo1 + y1) * nx + x1]!;
          const va = v000 + tx * (v100 - v000);
          const vb = v010 + tx * (v110 - v010);
          const vc = v001 + tx * (v101 - v001);
          const vd = v011 + tx * (v111 - v011);
          const ve = va + ty * (vb - va);
          const vf = vc + ty * (vd - vc);
          const val = ve + tz * (vf - ve);
          field[mcIdx] = val;
          if (val >= iso) above += 1;
        }
      }
    }
    return above;
  }
}

export default function createGroundwater3DPlugin(): Plugin {
  return new Groundwater3DPlugin();
}
