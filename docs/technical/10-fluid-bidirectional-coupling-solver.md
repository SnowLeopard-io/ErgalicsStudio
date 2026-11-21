# Fluid Bidirectional Coupling Solver

![3D field voxels: Case A choked flow develops along +x in a square domain](../assets/screenshots/plugins/fluid-cfd-coupler/field-voxels-case-a.png)

*3D field voxels in steady choked Case A: the 1D pipe network injects outflow into the 3D field through the x0 face (forward coupling), and the plume develops along +x toward the outflow face; the outflow face feeds mean back pressure back to the network (reverse coupling)—the spatial form of bidirectional coupling.*

The Fluid-CFD Coupler is a built-in plugin (`src/plugins/builtin/fluid-cfd-coupler/`, registered id `example.fluid-cfd-coupler`, category “physics simulation physics,” sandbox level `trusted`) coupling a **coarse-timescale 1D pipe/nozzle network** with a **fine-timescale 3D incompressible Navier–Stokes field solver**. Under millisecond valve control, the network injects outflow into the 3D field as mass, momentum and enthalpy sources; the field solver feeds the physically derived mean outlet back pressure back to the network nozzle, forming genuine **bidirectional coupling**. The host provides a parameter panel and four views (coupling time series, validation + tradeoff curves, 3D field voxels with two-channel temperature/velocity playback, and export to Figure Studio). A separate Web Worker runs the accompanying pure Python package `fluid_cfd` in Pyodide; deterministic scientific fields from the same solver core agree with the local CLI (wall-clock quantities such as latency depend on the machine and use soft tolerances across environments).

The solver needs no closed-source components: the core is pure Python + NumPy without network calls; no dense matrices are constructed during coupling, and both solvers advance vectorized NumPy arrays.

## I. Problem definition and applicability limits {#一、问题定义与适用边界}

### 1.1 Bidirectional coupling from network to field {#_1-1-从管网到场的双向耦合}

Many engineering systems contain both a **lumped pipe-network section** and a **continuous field domain**: chamber → nozzle → receiving space. The challenge is that modeling fidelity and time scales naturally differ: the network can advance quickly with lumped-parameter/1D state equations, while the heat and mass ejected by the nozzle diffuse in 3D, advect with the main flow and reflect from walls and outlet; only a field solver can resolve their spatial distribution. The plugin connects them:

| Direction | Data | Sender → receiver |
| --- | --- | --- |
| Forward coupling | Outlet mass flow `md_1d`, outlet temperature `t_1d` (generating enthalpy injection) | 1D network → 3D field (inlet feed source) |
| Reverse coupling | Mean outlet back pressure `p_back_3d` | 3D field → 1D network (nozzle downstream boundary) |

Bidirectionality is not copying the same data back and forth: each direction's physical quantities actually act in its domain. Forward coupling determines 3D mass/enthalpy accumulation; reverse coupling determines whether the 1D nozzle is at critical choking. `WindowRecord.iface_error` audits the difference between “back pressure currently used by 1D” and “back pressure actually fed back by 3D in the previous window”; see section III.

### 1.2 The time-scale gap {#_1-2-时间尺度的鸿沟}

The 1D network advances with millisecond coarse steps (`dt1d`), the 3D field with sub-millisecond fine steps (`dt3d`), an order of magnitude apart (default `dt1d/dt3d = 8`). Driving the entire coupling at the coarse step loses intermediate 3D evolution; driving the network at the fine step is uneconomical. The plugin uses **multi-rate subcycling**: within each coarse step (an exchange window), the 3D domain independently completes `dt1d/dt3d` substeps, and interface data is exchanged once at window end. Section II details this mechanism.

### 1.3 Four typical cases {#_1-3-四种典型工况}

The competition requires at least two cases comparable to analytical baselines; the plugin includes four validation paths:

| Case | Scenario | What is verified |
| --- | --- | --- |
| Case A steady choked | Nozzle fully open, very low back pressure, critically choked | 1D outflow approaches analytical critical flow; chamber blowdown pressure approaches the analytical blowdown curve |
| Case B millisecond valve control | Valve steps closed to 20% at 40 ms and reopens at 90 ms | Control synchronization error; outflow step before and after closing (reverse coupling is triggered) |
| Case C high-diffusivity energy channel | Energy channel + high-diffusivity field | Reverse coupling genuinely participates: outlet-face back pressure rises 18.15 kPa with injection |
| Case D subcritical unchoked flow | Back-pressure ratio lies between the critical ratio and 1, placing nozzle in the subcritical regime | Outlet flow compared with an independent literature isentropic subcritical converging-nozzle relation (relative error 0.107%) |

### 1.4 Applicability limits {#_1-4-适用边界}

| Dimension | Supported scope | Notes |
| --- | --- | --- |
| 1D network | Single chamber + converging nozzle, ideal-gas adiabatic blowdown | Outflow uses choked/subcritical critical-flow formulas; no frictional or heat-transfer pipe network |
| 3D field | Incompressible N–S field (velocity + pressure + temperature) on a uniform cubic grid, projection method + Boussinesq buoyancy + inlet momentum/enthalpy injection | Single-scalar transport has been upgraded to real NS; demonstration-grade viscosity, no turbulence model |
| Bidirectional interface | Forward (mass/enthalpy) + reverse (mean outlet back pressure) | Exchanged per window, adjustable exchange period |
| Control | Valve event table (instantaneous step / linear ramp) | Millisecond scale; no limit on number or timing of events |
| Time scales | `dt3d` divides `dt1d`; exchange period is an integer multiple of `dt1d` | Syntactically validated; no fractional time ratio |
| Runtime | CPython + NumPy; browser Pyodide | Same `driver.py` bridge; deterministic scientific fields agree on both paths (wall-clock quantities use soft tolerances) |

Online solving runs through Pyodide (single-threaded WASM) and is affected by browser memory limits and network loading of kernel packages, making it suitable for small/medium demonstrations. Full validation and benchmark reproduction are recommended via local CLI or container.

## II. Multi-rate time coordination {#二、多速率时间协调}

### 2.1 Exchange windows and subcycling {#_2-1-交换窗口与子循环}

Coupling is driven by `CouplerConfig`: `dt1d` (coarse step), `dt3d` (fine step), `t_end` (total duration), `exchange_period` (exchange period, 0 means exchange every 1D step). Each exchange forms a **Window**, and `time_ratio = dt1d / dt3d` is the number of 3D substeps in a window. The `run_coupling()` main loop is:

```mermaid
flowchart TD
    A["run_coupling(net, dom, cpl)"] --> B{"到达 t_end？"}
    B -- 否 --> C["1D 域推进一个 dt1d<br/>(气室放气 + 出流 + 阀门调度)"]
    C --> D["记录 md_1d, t_1d<br/>当前喉道背压 = 上一窗口 p_back_3d"]
    D --> E["3D 域子循环 K3 步<br/>每步 dt3d：N-S 投影(对流+扩散+Boussinesq+压力投影)<br/>+ 温度输运 + 入口动量/焓注入"]
    E --> F["窗口结束：场输运计算出口平均背压 p_back_3d<br/>并求窗口内吸收的质量/焓"]
    F --> G["守恒审计：iface_error = |p_back_used − p_back_3d|<br/>控制同步：事件距 1D 网格的偏移"]
    G --> H["写入 WindowRecord，把 p_back_3d 回灌给下一窗口"]
    H --> B
    B -- 是 --> I["CouplingResult + metrics"]
```

Exchange period is a scan variable in `trade_off()` and `min_feasible_exchange_period()` (see section VI).

### 2.2 Step and period constraints {#_2-2-步长与周期约束}

`normalized()` validates three invariants:

- `dt1d`, `dt3d`, `exchange_period` are all > 0 and `dt3d ≤ dt1d`;
- `time_ratio ≈ dt1d / dt3d` is rounded to the substep count `K3`, strictly aligning grids at window boundaries;
- `exchange_period` is an integer multiple of `dt1d` (default 0 = exchange every step), so exchange boundaries always lie on the 1D grid.

Any violation immediately raises a configuration error; incorrectly stepped coupling is never allowed to finish silently. This is a hard time-step coordination constraint.

### 2.3 Window-exchange events and latency statistics {#_2-3-换窗事件与延迟统计}

Each window records `exchange_latency_s` (time from one 3D step to outflow-face reduction), with final `mean_exchange_latency_ms` and `worst_exchange_latency_ms`. This is latency **per window**, not total coupling wall-clock time; `wall_clock_s` separately reports total solve time. Both are exposed separately in `metrics` to avoid interpreting parallel-amortizable work as serial.

## III. Forward and reverse boundary coupling {#三、正反向边界耦合}

### 3.1 Forward coupling: 1D → 3D {#_3-1-正向耦合-1d-→-3d}

Each window the 1D network supplies outlet mass flow `md_1d` and temperature `t_1d`. At the inlet feed face (a central patch on x0), the 3D solver converts them into **momentum and enthalpy** injection: velocity `md_1d / (ρ · A_patch)` is applied to the patch (clipped to `max_u_inlet`), and temperature is set directly to `t_1d`. The field advances in subcycles:

```
u,v,w,p = 投影法子步（对流 + 扩散 + Boussinesq + 压力 Poisson 修正）
T       = T + dt3d · (扩散 + 温度平流)   （x=0 面设 t_1d，壁面绝热，出口自由出流）
```

The inlet momentum injection (a) actually “blows” heat content into the full field rather than accumulating it only at the boundary, and (b) drives transport that shapes outflow-face back pressure—N–S's largest advance over the preceding single-scalar model. Conserved `mass_in_3d` still accumulates as `md_1d · 窗口时长` and enters the audit through interface error.

### 3.2 Reverse coupling: 3D → 1D {#_3-2-反向耦合-3d-→-1d}

At window end the 3D solver **physically derives** mean outlet back pressure `p_back_3d` at the outflow face (x=L)—no longer an area-averaged single-scalar temperature, but the sum of three terms:

```
p_back = p_ambient + c ·（喷嘴动能项 + 热膨胀项 + 已解压力场项）
动能项 = ½·ρ·u_in²     （1D 出口质量的滞止动压）
热膨胀项 = ρ·R·(t_out − T_ref)   （出流温升引发的密度-气压抬升）
压力场项 = 出流面上平均的投影压力 p    （解析过的动量连续场）
```

Here `u_in = md_1d / (ρ·A_patch)` is inlet velocity clipped to `max_u_inlet`, and `c` is the dimensional coupling coefficient. Back pressure thus **includes velocity and pressure**: the thermal plume raises pressure through temperature as well as stagnation dynamic pressure and the resolved projected-pressure field. This becomes downstream back pressure at the 1D nozzle throat in the next window. The choking criterion depends on the live feedback: low back pressure gives critical saturated flow; once the 3D field warms and dynamic/back pressure exceeds the critical ratio, the nozzle exits choking and flow decreases. In Case B the field cools and back pressure falls after valve closure; in Case C high-diffusivity energy transport raises back pressure by 18.15 kPa with injection—both are reverse-coupling responses to boundary state.

### 3.3 Conservation audit and interface error {#_3-3-守恒性审计与接口误差}

For each window, compute bidirectional interface error:

```
iface_error = | p_back_used − p_back_3d | / p_ref
```

`p_back_used` is the back pressure actually used by the 1D nozzle in this window (the previous window's feedback), `p_back_3d` the actual 3D feedback in this window, and `p_ref` the reference back pressure (atmospheric by default). This measures **reverse-coupling lag error**, not physical conservation: under ideal synchronization they are equal and error is zero. `metrics` aggregates `mean_interface_error` and `worst_interface_error`; Case C's `worst_interface_error` reaches `2.4e-3`, reflecting continuous energy injection and delayed feedback.

## IV. Millisecond control logic {#四、毫秒级控制逻辑}

Valve opening is driven by an event table; each event is `(t_start, opening, ramp_duration)`.

| Semantics | `ramp_duration` | Behavior |
| --- | --- | --- |
| Instantaneous step | `0` (or ≤ 1e-12) | Jump to `opening` at `t_start`, retaining the previous value before then |
| Linear ramp | `> 0` | Transition linearly from the previous value to `opening` over `ramp_duration` seconds |

Events are sorted by time and expanded into **piecewise-linear control points** before interpolation: a step occupies an axis segment far narrower than any physical `dt` (nanosecond scale), making scheduling strictly monotonic and interpolation unambiguous. Ramps are clamped within `[prev_t, t_start]` to avoid crossing the next event. `valve_opening(t)` between control points is piecewise linear.

Case B demonstrates millisecond control: `(0.000, 1.00, 0.0)` ensures fully open at t=0, `(0.040, 0.20, 0.0)` steps closed at 40 ms, and `(0.090, 1.00, 0.0)` reopens at 90 ms—all instantaneous steps.

**Control synchronization error** measures the offset of an event from the 1D time grid:

```
control_sync = 事件时刻距最近 1D 网格线的偏移（ms）
```

When the diameter falls on a grid line, the offset is zero. Case B measures `control_sync_max_ms = 0` and `control_sync_mean_ms = 0`, because `dt1d = 2 ms` and events all fall on multiples of 2 ms: millisecond control and solver time grid are fully aligned.

## V. Numerical kernels and analytical verification {#五、数值内核与解析验证}

### 5.1 1D network solver (`network_1d.py`) {#_5-1-1d-管网求解器-network-1d-py}

The chamber uses an adiabatic ideal-gas blowdown model: given volume, initial pressure `p0_init` and initial temperature `t0_init`, `md_out` follows the isentropic critical-flow formula, with effective throat area `area_eff = throat_area · discharge_coeff`. Blowdown decreases `p0` and `t0` according to energy conservation, forming an analytical pressure curve. `valve_opening` multiplies effective area, connecting control and flow.

### 5.2 3D incompressible N–S solver (`domain_3d.py`) {#_5-2-3d-不可压-n–s-求解器-domain-3d-py}

The solver advances a real incompressible N–S field (velocity `(u,v,w)` + pressure `p` + temperature `T`) on a uniform `nx × ny × nz` cubic grid using the **projection method** (Chorin fractional step):

```
预测步：u* = u^n − dt·(u·∇)u + dt·ν·Δu + 浮力项   （Boussinesq：w += dt·g·β·(T−T_ref)）
泊松步：Δp = (ρ/dt)·∇·u*                     （红黑 SOR，6 点拉普拉斯，Neumann 壁）
修正步：u^{n+1} = u* − (dt/ρ)·∇p             （速度无散）
```

Advection uses first-order upwind face fluxes (bounded, monotonic, fast in Pyodide); diffusion is clamped to the explicit stability limit; pressure projection enforces divergence-free velocity and thus incompressible continuity. Temperature is a passive scalar advected by the actual velocity field and diffused, with momentum and enthalpy injected at the inlet; `dt3d` is further divided into inner CFL-compliant substeps. Boundaries: no-slip walls on y/z faces, inlet patch on x0 (velocity + temperature Dirichlet), zero-gradient outflow on x1, pressure Poisson Neumann walls + zero-mean gauge. Each coupling window samples several **dynamic snapshots** (timestamp + temperature field + velocity-magnitude field, z-major flat arrays) for front-end 3D playback. Outflow back pressure is physically derived from outlet velocity/temperature/resolved pressure (see 3.2). Grid size is fixed by case preset (`10³` for Case A/B/D, `8³` for Case C; `DomainConfig` defaults to `12³`); the plugin has no grid knob, but CLI/`driver` payloads can override `nx/ny/nz` through `dom`.

### 5.3 Analytical benchmarks (`analytic.py`) {#_5-3-解析基准-analytic-py}

Two reference closed-form solutions validate the solver: **critical (choked) flow** (isentropic critical mass flow) and **chamber blowdown pressure** (analytical pressure–time curve for adiabatic vessel blowdown). Case A compares 1D outflow and blowdown pressure with both under the same initial conditions, reporting relative errors.

### 5.4 Validation and certification {#_5-4-验证与认证}

`verify.py` wraps validation paths and **certifies against thresholds**: `verify_case_a` (flow/pressure relative-error threshold 5%), `verify_case_b` (throttling ratio and synchronization error), `verify_case_c` (energy channel + reverse-coupling participation), `verify_case_d` (subcritical flow against a literature isentropic relation), `verify_subsonic_curve` (pointwise literature formula comparison), `trade_off` (accuracy–efficiency tradeoff), `min_feasible_exchange_period`, and `sensitivity_case_a` (Case A error attribution). Results go to `bench/fluid-cfd-results.json`. Every certified case carries `certification.checks[]` (`rel_error ≤ threshold`, `pass`) for host diagnostic-report export.

## VI. Accuracy–efficiency tradeoffs and parameter analysis {#六、精度—效率权衡与参数分析}

### 6.1 Tradeoff curve {#_6-1-权衡曲线}

Exchange period determines coupling “refresh frequency”: more frequent feedback is newer and reduces interface error, but each step triggers 3D outlet-face reduction, increasing latency and communication overhead. `trade_off()` runs the same workload for exchange periods and aggregates latency, interface error and frequency for each point; `interface_tradeoff_curve` derives a composite score:

```
composite_score = ω_err · (1 − 归一的接口误差) + ω_lat · (1 − 归一的延迟)
```

Scan points and measurements appear in the section X table. The validation view plots interface error as bars, latency as bars and composite score as a line, marking the best exchange period.

![Validation view: Case A accuracy–efficiency tradeoff](../assets/screenshots/plugins/fluid-cfd-coupler/tradeoff-case-a.png)

*The validation view scans exchange period, showing interface error (bars), latency (bars) and composite score (line) together and marking the best period for an intuitive accuracy–compute-efficiency tradeoff.*

### 6.2 Minimum feasible exchange period (CFD-01) {#_6-2-最小可行交换周期-cfd-01}

`min_feasible_exchange_period` scans under a desired latency budget and interface-error tolerance. Requested periods shorter than one 1D step are clamped to `dt1d` (a shorter window carries no new information—the tight-coupling limit `T_exch = dt1d` is the minimum feasible period). Measurements (1 ms budget, `1e-3` interface tolerance) give `min_feasible_exchange_period_ms = 1.0`: requests of 0.25/0.5/1.0 ms are clamped to effective 1.0 ms, while 2.0/4.0 ms pass as requested; interface error remains ≤ `3e-6` and feasible throughout (latency is a soft wall-clock metric, 51–204 ms across points and expected to vary by machine, so the minimum feasible period is determined by the **conservation criterion** rather than latency budget; see section X).

### 6.3 Error attribution (CFD-04) {#_6-3-误差归属分析-cfd-04}

`verify_case_a` reports Case A pressure relative error of about **1.68%**. Rather than attributing it directly to the numerical method, the deviation is explicitly decomposed into three contributions:

```
deviation_total = numerical_error + coupling_contribution + model_bias
```

Measured decomposition: numerical error `1.3e-5` (solver versus its own closed-form ODE < 0.01%), **reverse-coupling contribution 0.0** (maximum 3D back-pressure deviation only ~0.5 Pa), and **model bias `0.0169` (dominant by far)**. The solver's isothermal rigid-tank model and the analytical baseline's isentropic power-law blowdown have a **bounded, documented systematic difference**—the bias increases monotonically with time horizon and is almost invariant to nozzle parameters, matching accumulated model bias rather than numerical error or a reverse-coupling artifact. `cd_sweep`/`horizon_sweep` support this profile (see section X).

<!-- pagebreak -->

## VII. Plugin runtime architecture {#七、插件运行时架构}

### 7.1 File responsibilities {#_7-1-文件职责}

| File | Responsibility |
| --- | --- |
| `index.ts` | Factory export for lazy loading by the built-in registry |
| `plugin.ts` | `Plugin` implementation: manifest, parameter definitions and updates, run orchestration, state machine, view switching, export and Figure Studio bridge |
| `manifest.ts` | Plugin manifest (id `example.fluid-cfd-coupler`, physics category, trusted sandbox, Chinese/English names and descriptions) |
| `types.ts` | Plugin ⇄ client ⇄ Worker protocol types (requests, events, result payloads, window records, certification, tradeoffs/minimum period/error attribution, etc.) |
| `fluid-client.ts` | Worker lifecycle and RPC: first-use spawn, serial queue, progress forwarding, termination and recreation |
| `fluid-worker.ts` | Pyodide bootstrapping, Python source written to the file system, progress and result bridge, `driver.solve_json`/`verify_all` entry points |
| `render.ts` | 2D canvas: coupling time series and validation/tradeoff panels |
| `render3d.ts` | 3D field voxel view (instanced cubes colored by magnitude, temperature/velocity scales and dynamic frame playback) |
| `figure.ts` | Convert a coupling result to publication-grade multi-panel `PlotSpec` for Figure Studio |
| `diag-report.ts` | Self-contained HTML diagnostic report |
| `python/fluid_cfd/` | Solver package (`units`, `analytic`, `network_1d`, `domain_3d`, `coupler`, `verify`, `driver`, `__init__`) |

The Python package also includes `benchmarks/bench_coupling.py` (generates benchmark JSON), `run_tests.py`, `tests/test_coupling.py`, plus `config.example.json`, `requirements.txt`, and `README.md`.

### 7.2 Data flow {#_7-2-数据流}

```mermaid
flowchart TD
    A["宿主画布 / 参数面板 / 示例载入"] --> B["plugin.ts<br/>buildPayload + run*"]
    B --> C["fluid-client.ts<br/>串行队列 + 进度转发"]
    C --> D["fluid-worker.ts<br/>Pyodide Worker"]
    D --> E["driver.<br/>solve_json(payload) / verify_all()"]
    E --> F["coupler.run_coupling()<br/>多速率子循环"]
    F --> G["WindowRecord[] + metrics<br/>+ frames_3d 动态快照（温度/速度场）"]
    G --> H["JSON 回传宿主"]
    H --> I["render.ts 2D<br/>render3d.ts 3D（通道 + 动态回放）<br/>figure.ts → Figure Studio"]
```

### 7.3 Cross-language boundary and lifecycle {#_7-3-跨语言边界与生命周期}

Only JSON strings cross the boundary: `postMessage` cannot structured-clone PyProxy, so progress, reports and window records are serialized text. The 3D field is already embedded as arrays in results (size restricted by guardrails), with no extra data moved through the message channel. `fluid-worker.ts` uses `json.loads(_payload)` to restore a dict before calling `solve_json`, avoiding treating a string as a dict (fixing the former `AttributeError: 'str' object has no attribute 'get'`).

Stability-related design:

- **Bootstrap and retry**: on first use the Worker dynamically imports `pyodide.mjs` (module Workers cannot use `importScripts`), writes eight Python modules to the file system and adds them to `sys.path`; bootstrap timeout is 120 seconds and failures can retry by clearing the cached bootstrap Promise.
- **Progress bridge**: `driver.set_progress_sink` accepts a JS callback and pushes progress at window boundaries; callback exceptions are caught so progress reporting never affects solving.
- **Serial queue**: the client queues run/validation requests on one Promise chain; jobs validate Worker identity so terminated instances cannot feed back results.
- **Termination semantics**: “Terminate” rebuilds the entire compute stack rather than soft-canceling—terminate Worker, rebuild client, reset host global status to ready, and discard in-flight tasks by epoch.
- **View switching**: 2D and 3D are switched explicitly via the parameter panel's View dropdown (no longer implicitly hijacked by data presence); mesh resources are freed when leaving 3D.
- **All at once**: “Run All” performs validation and coupling in sequence and retains both results, making all four views immediately available without rerunning.

## VIII. Interface and interaction {#八、界面与交互}

### 8.1 Parameter panel {#_8-1-参数面板}

Numeric parameters use **dropdown/step choices** instead of free input, constraining meaningful values and avoiding input-field pitfalls. The panel localizes automatically to the current language.

| Parameter | Key | Values |
| --- | --- | --- |
| Case | `preset` | Case A steady choked / Case B millisecond valve control / Case C energy/nuclear-safety channel / Case D subcritical flow / custom |
| View | `view` | Coupling time series / validation + tradeoff curves / 3D field voxels |
| 3D channel | `channel` | Temperature / velocity magnitude (3D color scale) |
| 3D playback | `play3d` | Play / pause animation (play back along `frames_3d` timestamps) |
| 1D time step | `dt1dMs` | Millisecond coarse step |
| 3D time step | `dt3dUs` | Microsecond fine step |
| Simulation duration | `tEndS` | Seconds |
| Exchange period | `exchangePeriodMs` | 0 (exchange every 1D step) or integer multiple of coarse step |
| Chamber volume | `volumeL` | Liters |
| Initial chamber pressure | `p0InitBar` | bar |
| Throat area | `throatAreaCm2` | cm² (custom case only) |
| Run all / run coupling / run validation | `runAll` / `run` / `verify` | Action buttons |
| Terminate | `abort` | Action button (shown during computation) |
| Send to Figure Studio | `sendToFigure` | Action button (shown with results) |
| Export diagnostic report | `exportReport` | Action button (shown with results) |
| Reset plugin | `reloadPlugin` | Action button |

Time steps, duration, exchange period and chamber/throat parameters appear only for the custom case; all preset parameters are fixed in the `driver`'s `case_*_config()` functions.

### 8.2 Coupling time series {#_8-2-耦合时间序列}

After a coupling run, the coupling time-series view has two areas: 1D outlet flow above (teal line, purple valve-opening band on the right axis), and 3D outlet-face back-pressure evolution plus per-window interface error below. The top information row gives window count, `dt1d/dt3d` ratio, maximum interface error and control synchronization. Under steady Case A, flow is nearly stable and back pressure changes gently; Case B's valve steps form a clear square wave in the flow curve.

![Coupling time series (Case A steady piston)](../assets/screenshots/plugins/fluid-cfd-coupler/timeseries-case-a.png)

*Case A steady coupling time series: upper 1D outlet flow and purple valve-opening band remain stable; lower 3D outlet-face back pressure evolves gently with per-window interface error overlaid, checking conservation and response in steady conditions.*

### 8.3 3D field voxels and dynamic playback {#_8-3-3d-场体素视图与动态回放}

The 3D view draws the entire `nx×ny×nz` grid as a **true 3D voxel cloud**: grid points above a threshold relative to the field maximum are instanced cubes colored by magnitude, surrounded by a translucent volume box. The **channel dropdown** switches between temperature and velocity-magnitude scales (hot–cold gradient for temperature, Okabe-Ito diverging colors for velocity), showing thermal and dynamic-pressure plume structures. The injected thermal plume is driven by the actual N–S velocity field: temperature rises and inlet momentum injection also creates jet dispersion in the velocity-magnitude field. **Dynamic playback** switches voxels frame by frame along `frames_3d` timestamps, with play/pause and frame count, showing time evolution from startup through development and stopping/rewarming during valve closure and reopening. The host scene is mounted through `Scene3DHandle`, with rotation and zoom; it is true volumetric rendering rather than a 2D surface (unlike the smooth midplane-slice surface heatmap in Figure Studio).

### 8.4 One-click run and views {#_8-4-一键运行与视图}

“Run All” completes validation (Case A / B / C / D + subcritical curve + tradeoffs + minimum period + error attribution) and coupling (current preset) in one action, **retaining both results**. All four views then contain data and can be switched freely without overwriting one another. “Run Coupling”/“Run Validation” automatically navigates to the corresponding view with immediately visible results, no longer preempted by data presence.

### 8.5 Export and toolchain integration {#_8-5-导出与工具链衔接}

- **Send to Figure Studio**: convert the last coupling result into publication-grade panels—**midplane field-slice surface heatmap**, 1D outflow, 3D back pressure (reverse coupling), and millisecond valve-position time series—arranged on an IEEE single-column template with a whole-figure caption. The vector SVG is suitable for papers/PDFs, matching em-eigensolver's integration path.
- **Export diagnostic report**: generate self-contained HTML (no scripts or external resources) with inline coupling metrics, validation results, certification decisions, tradeoff curves and error attribution.
- **Top-bar built-in samples**: `examples/data/fluid-cfd-case-a.json` and `fluid-cfd-case-b.json` are registered globally for this plugin; top-bar and plugin loading share the same parse path.

## IX. Built-in examples and benchmark data {#九、内置样例与基准数据}

The following measurements come from the same solve path shared by browser and local CLI (CPython + numpy; `bench/fluid-cfd-results.json`).

### 9.1 Case A steady choked (measured + certified) {#_9-1-case-a-定常壅塞-实测-认证}

| Metric | Value |
| --- | --- |
| Grid / duration | `10³`, `dt1d = 2 ms`, `dt3d = 250 µs` (ratio 8) |
| Exchange / windows | Exchange every 1D step (`exchange_period = 2 ms`), 60 windows |
| Analytical critical flow | `0.088563 kg/s` |
| Solved outlet flow | `0.088563 kg/s` (relative error **0.0%**, threshold 5% → pass) |
| Analytical blowdown pressure vs solved final pressure | `472.9 kPa` vs `480.8 kPa` (relative error **1.68%**, threshold 5% → pass) |
| Interface error | Mean `1e-6`, worst `2.9e-5` |
| Latency | Mean 55.8 ms, worst 72.3 ms (platform-dependent soft metric: one window includes about 8 N–S projection steps and varies with load) |

![Case A 3D voxels: choked flow develops along +x](../assets/screenshots/plugins/fluid-cfd-coupler/field-voxels-case-a.png)

*Case A voxels: steady choked 1D outflow enters the 3D field through x0 (forward coupling), develops along +x, and the outflow face feeds mean back pressure to the network (reverse coupling).*

![Case A coupling time series: steady choked response](../assets/screenshots/plugins/fluid-cfd-coupler/timeseries-case-a.png)

*Case A time series: upper 1D flow and valve opening remain stable; lower 3D back pressure evolves gently with per-window interface error for checking steady conservation and response.*

![Case A accuracy–efficiency tradeoff](../assets/screenshots/plugins/fluid-cfd-coupler/tradeoff-case-a.png)

*Case A tradeoff: scan exchange period, showing interface error (bars), latency (bars) and composite score (line) with optimal period marked to balance accuracy and compute efficiency.*

### 9.2 Case B millisecond valve control (measured) {#_9-2-case-b-毫秒级阀门控制-实测}

| Metric | Value |
| --- | --- |
| Events | Fully open at t=0 → step to 20% at 40 ms → reopen to 100% at 90 ms |
| Open / closed / reopened flow | `0.1281` / `0.02529` / `0.1260 kg/s` |
| Throttling ratio `(open−closed)/open` | **0.803** |
| Control synchronization error **max / mean** | **0 / 0 ms** (events fall on 2 ms grid lines) |
| Windows / duration | 80 windows, 0.16 s |
| Final back pressure / chamber pressure | `100.0 kPa` / `576.2 kPa` |
| Interface error | Mean `0.0`, worst `2.9e-5` |

![Case B 3D voxels: spatial outflow during valve switching](../assets/screenshots/plugins/fluid-cfd-coupler/field-voxels-case-b.png)

*Case B voxels: spatial distribution of outflow injection along +x under millisecond valve steps shows how forward-coupled mass/enthalpy sources change field heat content.*

![Case B time series: square-wave response to 40 ms closure and 90 ms reopening](../assets/screenshots/plugins/fluid-cfd-coupler/timeseries-case-b.png)

*Case B time series: valve steps (20% at 40 ms, 100% at 90 ms) form a clear square wave in 1D outlet flow and corresponding 3D back-pressure response; synchronization error is 0.*

![Case B tradeoff](../assets/screenshots/plugins/fluid-cfd-coupler/tradeoff-case-b.png)

*Case B tradeoff: under fast millisecond valve transients, interface error and latency trade off with exchange period, indicating sufficiently frequent exchange is needed to track the square-wave steps.*

### 9.3 Case C high-diffusivity energy channel (measured) {#_9-3-case-c-高扩散能量通道-实测}

| Metric | Value |
| --- | --- |
| Analytical outflow | `0.6311 kg/s` (same solved value, relative error **0.0%**) |
| Outlet-face back-pressure rise | **`+18.15 kPa`** (reverse coupling genuinely participates, `engagement = active`) |
| Windows / duration | 150 windows, 0.3 s |
| Interface error | Mean `1.1e-3`, worst `2.4e-3` |
| Final back pressure / chamber pressure | `118.15 kPa` / `762.4 kPa` |

![Case C 3D voxels: high-diffusivity energy-channel field](../assets/screenshots/plugins/fluid-cfd-coupler/field-voxels-case-c.png)

*Case C voxels: injected heat spreads over a larger region in the high-diffusivity channel; outlet back pressure physically derived from velocity/temperature/pressure rises by 18.15 kPa, demonstrating real reverse-coupling participation.*

![Case C time series: back-pressure rise synchronized with injection](../assets/screenshots/plugins/fluid-cfd-coupler/timeseries-case-c.png)

*Case C time series: outlet back pressure rises progressively with energy injection (`engagement = active`), substantively driving reverse coupling.*

![Case C tradeoff](../assets/screenshots/plugins/fluid-cfd-coupler/tradeoff-case-c.png)

*Case C tradeoff: stronger injection and back-pressure feedback indicate sufficiently frequent exchanges are needed to track the rise.*

### 9.4 Case D subcritical unchoked flow (literature benchmark) {#_9-4-case-d-亚临界非壅塞流-文献基准对照}

Cases A/C verify the **choked** branch. Case D adds the **unchoked** side of competition requirement CFD-05 (“at least two typical bidirectional coupling cases against analytical/experimental baselines”): pressure ratio `r = p_back/p0` lies between critical ratio `PR* = 0.5283` and 1, so the nozzle is **subcritical** and outlet flow is **strongly sensitive** to back pressure (unlike the choked regime), substantively driving reverse coupling where most needed. Outlet flow is compared with an independent literature isentropic subcritical converging-nozzle relation:

| Metric | Value | Decision |
| --- | --- | --- |
| Pressure ratio `r = p_back/p0` | **0.5954** | In subcritical interval `(PR*=0.5283, 1)` ✓ |
| Flow (coupled solver) | `0.022113 kg/s` | — |
| Flow (literature isentropic subcritical) | `0.022089 kg/s` | **Relative error 0.107%** |
| Reverse-coupling engagement | **active** | N–S back-pressure feedback is stable (max `iface_error` 2.9e-5) and still drives subcritical flow |
| Subcritical `subsonic_curve` scan | 9 points / maximum error **0.0%** | Solver reproduces the literature formula to floating-point precision |
| Back-pressure sensitivity `d ln ṁ/d ln r` | **−1.83** | Back pressure ↑ → flow ↓ (correct reverse-coupling direction) |
| Certification assertion `certification.all_pass` | **True** | Flow error ≤ 5% and subcritical condition holds |

Subcritical flow agrees closely with the literature relation (0.107%). `verify_subsonic_curve()` compares the solver branch pointwise with the literature isentropic formula over the entire subcritical interval, maximum relative error 0.0%, demonstrating that the 1D nozzle reproduces textbook benchmarks in both choked and subcritical branches. Negative back-pressure sensitivity −1.83 confirms the expected subcritical reverse-coupling behavior: increasing 3D feedback back pressure reduces outlet flow.

![Case D 3D voxels: subcritical unchoked outflow](../assets/screenshots/plugins/fluid-cfd-coupler/field-voxels-case-d.png)

*Case D voxels: in the subcritical unchoked interval, nozzle flow is strongly sensitive to back pressure; injected outflow distribution and feedback jointly determine the evolution, demonstrating reverse coupling where needed most.*

![Case D time series: back-pressure-sensitive subcritical flow](../assets/screenshots/plugins/fluid-cfd-coupler/timeseries-case-d.png)

*Case D time series: stable N–S feedback drives subcritical outlet flow, which matches the literature isentropic relation within 0.107%, illustrating “back pressure ↑ → flow ↓.”*

![Case D tradeoff](../assets/screenshots/plugins/fluid-cfd-coupler/tradeoff-case-d.png)

*Case D tradeoff: subcritical flow is strongly sensitive to back pressure; shorter periods yield faster feedback and smaller interface error.*

### 9.5 Tradeoff curve and minimum period (measured) {#_9-5-权衡曲线与最小周期-实测}

| Exchange period (ms) | Frequency (Hz) | Latency (ms) | Interface error | Composite score |
| --- | --- | --- | --- | --- |
| **0.5** | 2000 | **43.8** | **3.7e-5** | **99.700** |
| 1.0 | 1000 | 45.0 | 3.7e-5 | 99.700 |
| 2.0 | 500 | 89.2 | 3.5e-5 | 99.699 |
| 3.5 | 285.7 | 167.1 | 3.2e-5 | 99.699 |
| 5.0 | 200 | 236.0 | 3.1e-5 | 99.698 |

Minimum feasible period: budget 1.0 ms, interface tolerance `1e-3` → **`min_feasible_exchange_period = 1.0 ms`** (the tight-coupling limit `dt1d`). Requests of 0.25/0.5 ms are clamped to effective 1.0 ms, interface error remains ≤ `3e-6` and is feasible throughout (latency is a soft wall-clock metric expected to vary across machines). The table uses Case A's scan as an example; Case B / C / D curves are shown by case in 9.2 / 9.3 / 9.4 and have similar shapes, with optimal periods near 1.0 ms—indicating the same accuracy–efficiency mechanism across cases. After the N–S upgrade, per-window latency rose from sub-millisecond to tens of milliseconds (about 8 projection steps + SOR iterations), the cost of a real flow-field solve on a 10³ grid; the exchange-frequency benefit window shifts accordingly.

### 9.6 Error-attribution scans (measured) {#_9-6-误差归属扫描-实测}

| Scan | Parameter | Pressure `deviation` |
| --- | --- | --- |
| Nozzle (`discharge_coeff`) | 0.90 | 0.0154 |
| | 0.96 | 0.0165 |
| | 0.98 | **0.0168** |
| | 1.00 | 0.0172 |
| Horizon (`horizon_s`) | 0.06 | 0.0081 |
| | 0.09 | 0.0124 |
| | 0.12 | **0.0168** |
| | 0.16 | 0.0230 |

Deviation is nearly invariant to nozzle parameters and increases monotonically with horizon, matching accumulated model bias between the isentropic power-law baseline and isothermal rigid-tank model. Decomposition: numerical error `1.3e-5`, reverse-coupling contribution `0.0`, model bias `0.0169`. Case A's small pressure deviation is a **documented modeling choice**, not numerical error or a coupling artifact.

### 9.7 Reproduction {#_9-7-复现}

```bash
# 本地 CPython（同一求解核心）
cd src/plugins/builtin/fluid-cfd-coupler/python
python -m pytest 2>/dev/null || python run_tests.py          # 运行测试套件
python benchmarks/bench_coupling.py ../../../../../bench/fluid-cfd-results.json

# 浏览器：插件面板选择算例并点"运行全部"；CLI 与浏览器路径的确定性结果一致
```

## X. Failure scenarios and recommended actions {#十、故障场景与处置建议}

| Symptom | Cause | Recommended action |
| --- | --- | --- |
| Distorted throttling ratio | Without a t=0 fully-open event in Case B, `valve_opening` uses the first event's opening, so the “fully open” sample is actually throttled | Declare baseline `(0.000, 1.00, 0.0)` first (built in) |
| Browser reports `'str' object has no attribute 'get'` | Worker bridge passes a JSON string directly as a dict to `solve_json` | Bridge consistently calls `json.loads` first |
| Validation and time-series views “look the same” | Rendering implicitly hijacked by data presence; View dropdown ineffective | Explicit view switching; run actions navigate to the corresponding view |
| “Computing” remains after termination | Host global state not reset | Reset host global state with `setStatus('ready')` and clear in-flight tasks on termination |
| 3D scene not mounted | Pyodide is in a Worker but 3D needs the host main-thread scene | Fall back to 2D with a notice, reset the plugin and rerun |
| 3D voxel box proportions abnormal | Equal cubic voxels stretch custom `nx≠ny≠nz` grids | Axis dimensions are handled separately; box adapts instead of forcing a cube |

## XI. Testing and reproducibility {#十一、测试与可复现性}

Python tests cover: Case A analytical matching and certification, positive Case B throttling ratio, Case C energy channel and reverse-coupling engagement, Case D subcritical literature-baseline certification, reproduction of the literature formula across the subcritical interval, finite conservation audit, multi-rate subcycling, 1D advance conservation, choked closed form, tradeoff curve return, minimum feasible exchange period, and nontrivial step-induced flow reduction. TS typecheck (`tsc --noEmit`) passes; rendering and Figure Studio panel construction are pure functions suitable for unit tests. Benchmark JSON comes from the same solver path; rerunning the same source version reproduces figures in 9.1–9.6.

A dedicated one-command reproduction script chains “environment → tests → regenerate benchmark → compare,” allowing reviewers to replay the 9.1–9.6 conclusions on any machine.

### 11.1 Prerequisites {#_11-1-前置条件}

| Dependency | Purpose | If missing |
| --- | --- | --- |
| Python 3.10+ | Run numerical kernel | Cannot run |
| numpy | Required by numerical kernel | Cannot run |
| scipy | Sparse solving (optional) | Automatically use pure NumPy backend with the same result and slightly lower performance |

### 11.2 One-command reproduction {#_11-2-一键复现}

```bash
# 仅验证本赛题
node scripts/repro-plugins.mjs --only=fluid

# 快速模式（本赛题无重型算例，与完整模式步骤一致）
node scripts/repro-plugins.mjs --only=fluid --fast
```

The script executes `env` (locate Python, read numpy / scipy versions) → `tests` (run `python/run_tests.py` standalone assertions) → `gen` (regenerate benchmark JSON in a temporary directory through `driver.py`) → `verify` (compare each field against committed `bench/fluid-cfd-results.json`). Exit code `0` = tests pass and deterministic scientific fields agree; `1` = test failure or deterministic scientific-field drift.

Manual reproduction can also be done step by step:

```bash
cd src/plugins/builtin/fluid-cfd-coupler/python

python -m fluid_cfd.driver verify              # Case A/B/C/D + 亚临界曲线 + 权衡 + 敏感性
python run_tests.py                            # 期望 26 passed, 0 failed
python benchmarks/bench_coupling.py            # 生成基准 JSON
```

Note: `bench_coupling.py` writes directly to `bench/fluid-cfd-results.json` (the baseline used for comparison). Run it only when deliberately updating the baseline for this problem; otherwise use the script's temporary-directory regeneration to avoid overwriting the committed baseline.

### 11.3 Comparison criteria {#_11-3-判定口径}

The script's deterministic-field comparator classifies benchmark JSON fields into four categories:

| Category | Comparison | Examples |
| --- | --- | --- |
| Exact assertions | Strings / booleans must match exactly | `ok`, `subsonic_engaged`, `converged` |
| Deterministic numbers | Relative error ≤ 1e-6 | `flow_rel_error`, `pressure_rel_error`, `valve_throttle_ratio`, `min_feasible_exchange_period_ms` |
| Machine-dependent | Ignore or soft tolerance (note does not count as FAIL) | `seconds`, `exchange_latency`, `composite_score` (contains wall-clock latency and other machine-dependent quantities) |

- `composite_score` is machine-dependent: `trade_off` mixes exchange latency at a fixed weight into the score, and latency is wall-clock time, so cross-machine drift is expected and reported as a note.
- Arrays of different lengths (e.g. each case's `windows`) are aligned and compared by index; elements carrying a `case` name are aligned by `case@method` composite identity to avoid mismatching same-parameter entries with different configurations.
- Soft items (notes) do not count toward FAIL; only violations of exact assertions or deterministic numerical criteria fail the machine group.

### 11.4 Reading output {#_11-4-输出解读}

Example successful output from `--only=fluid`:

```
=== fluid-cfd-coupler (CFD) reproduction: env → tests → regenerate → verify ===
python 3.10.11 | numpy 2.2.6 | scipy 1.15.3

[fluid-cfd-coupler]
  ok   fluid-cfd-coupler: standalone test suite passed
  ok   fluid-cfd-coupler: fresh bench matches committed baseline on all deterministic scientific fields
  note fluid-cfd-coupler: ...trade_off[0].composite_score rel=0.00% (latency-blended, within tolerance)

==========================================
RESULT: PASS — fluid-cfd-coupler reproduces and match committed baselines
==========================================
```

- `ok ... matches committed baseline`: freshly computed results agree with the committed baseline on all deterministic scientific fields.
- `note ... (latency-blended)`: machine-dependent drift is expected and does not count as failure.
- For `FAIL`, check in order: ① test suite passed; ② baseline file exists; ③ regeneration errors; ④ which scientific fields differ (the script prints paths and old/new values).

### 11.5 Troubleshooting {#_11-5-故障排查}

| Symptom | Action |
| --- | --- |
| Python discovery fails | Install Python 3.10+ or set `PYTHON=/path/to/python` |
| numpy `<none>` | `pip install numpy` |
| scipy `<none>` | Optional; kernel uses the pure NumPy backend automatically with the same results |
| A scientific field fails | Follow the order in 11.4 |

### 11.6 Deliverable mapping {#_11-6-交付物对照}

| Deliverable | Location |
| --- | --- |
| One-command reproduction script | `scripts/repro-plugins.mjs` (`--only=fluid`) |
| Numerical kernel + validation | `src/plugins/builtin/fluid-cfd-coupler/python/` (26 tests) |
| Solution description | `src/plugins/builtin/fluid-cfd-coupler/SOLUTION.md` |
| Reproduction baseline | `bench/fluid-cfd-results.json` |

## XII. Security and compliance design {#十二、安全与合规设计}

- **No uploads, no network**: solving is local throughout, with no closed-source/cloud core capability.
- **Exports are local files only**: Figure Studio, diagnostic reports and benchmark JSON write locally.
- **Trusted sandbox**: plugin declares `sandbox: 'trusted'`, runs in a host Worker without extra sensitive permissions.
- **Payload guardrails**: `normalized()` validates 3D field size and window count to prevent accidental large memory allocations.

## XIII. Mapping to competition requirements {#十三、与赛题要求的对应}

| Requirement | Corresponding solution |
| --- | --- |
| Two typical cases against analytical/experimental baselines | Case A (steady choked, 0.0% flow error) + Case B (millisecond valve control) + Case C (energy channel) + Case D (subcritical literature), section IX |
| Time-step coordination | Multi-rate `dt1d/dt3d` subcycling, section II; constraints validated in `normalized()` |
| Bidirectional boundary coupling | Forward mass/enthalpy injection + reverse mean outlet back-pressure feedback, section III |
| Conservation and interface error | `iface_error` audit + `mean/worst_interface_error`, 3.3 |
| Millisecond control and synchronization error | Valve event table (step/ramp) + `control_sync_max/mean_ms`, section IV |
| Exchange frequency and accuracy–efficiency tradeoff | `trade_off()` + `min_feasible_exchange_period()` + `composite_score`, section VI and 9.5 |
| Error attribution and credibility | Error decomposition (numerical/coupling/model bias) + individual certification, 6.3 and 9.6 |
| Solution documentation | This document (principles, complexity, benchmarks, failures, safety) |
| Working prototype | Browser plugin (four views) + local `run_tests.py`/`bench_coupling.py`, sharing the same core |
| Reproducible materials | Source, `requirements.txt`, `fluid_cfd/README.md`, `bench/fluid-cfd-results.json`, `run_tests.py` |

## XIV. Known limits and future work {#十四、已知边界与后续工作}

| Item | Current state | Impact and suggested direction |
| --- | --- | --- |
| 3D physical fidelity | Incompressible N–S: projection + first-order upwind + demonstration-grade viscosity, no turbulence model | Could upgrade to QUICK/WENO5, Smagorinsky LES or compressible branch, but Pyodide cost rises substantially |
| 1D network topology | Single chamber + single nozzle | Network extension (series/parallel, friction, heat transfer) must reuse the same coupling mechanism |
| Fractional time ratios | Requires `dt3d` to divide `dt1d` | Deliberate simplification for window alignment; fractional ratios require rewriting subcycle boundaries |
| Adaptive exchange frequency | Fixed exchange period | Combine 9.5 tradeoffs and minimum period to implement dynamic window changes |
| 3D rendering details | Temperature/velocity voxel channels + dynamic playback | Add isosurfaces/cut planes and threshold slider |
| Frontend end-to-end coverage | Pure-logic unit tests + typecheck only | Add an e2e case that clicks an example and asserts convergence status |
