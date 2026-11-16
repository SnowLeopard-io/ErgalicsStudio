# 03 Plugin System

Ergalics Studio adopts “every visualization is a plugin” as a first-principles design. There is one contract between host and plugin; third-party extensions and built-in plugins use the same interface and lifecycle. There are currently **165 built-in plugins**: 155 scientific and analysis plugins load automatically at startup, and 10 fun tools declare `autoload: false` and load on demand. The sidebar divides the registry into 19 disciplines (the mapping `src/plugins/categories.ts` is the single source of truth). This chapter summarises the registry; the per-plugin list is in [12 Plugin Catalog](./12-plugin-catalog).

## I. Contract between host and plugin {#一、宿主与插件的契约}

Every plugin implements the common `Plugin` interface (`src/types/plugin.ts`). `manifest`, `init`, and `getParams` are required; all other methods are optional and probed by the host with optional calls, allowing a third-party package to run with only `render` implemented:

| Method | Purpose |
| --- | --- |
| init / destroy | Initialization and destruction; the host handles GPU-safe resource cleanup |
| activate / deactivate | Activation and deactivation, driving 2D/3D viewport switching and stale-frame cleanup |
| render / updateParams | Rendering and parameter updates (reactive form in the right panel) |
| getParams / compute | Read parameter definitions and compute (`compute` has a progress callback) |
| loadData / getSupportedFormats | Receive data dispatched by the host; declare supported file formats |
| renderToScene | Declare 3D capability and receive a host Three.js scene handle when activated |
| onProjectSave / onProjectLoad | Lifecycle hooks after project save and load |

### 1.1 Standard 3D plugin integration: renderToScene and Scene3DHandle {#_1-1-3d-插件标准接法-rendertoscene-与-scene3dhandle}

3D plugins do not create their own renderers. They implement `renderToScene(scene)` to obtain the centrally managed host `Scene3DHandle`: its members are actual Three.js objects (root `scene`, `camera` at a preset position, orbit `controls`, `renderer`). The plugin adds meshes and lights and drives the rendering loop through `render()`; `setVisible/isVisible` prevents the 3D coordinate system from bleeding into the 2D viewport when a non-3D plugin is active; `snapshot({ transparent: true })` exports a transparent PNG without background and reference objects; `dispose()` frees GPU resources and stops the rendering loop. When WebGL is unavailable it automatically falls back to a 2D notice.

### 1.2 PluginApi: host-provided capabilities {#_1-2-pluginapi-宿主提供的能力面}

| Capability group | Contents |
| --- | --- |
| Localization | `locale`, `t()`, and language-change subscription; the parameter panel is rebuilt with the language |
| Status reporting | `setStatus` reports ready/computing/paused/loading/saving/error to the status bar |
| Performance reporting | `reportGpuTime` and `reportDataScale` feed monitoring and warnings |
| Notifications | `notify` banners and notices by severity |
| Logging | `log` writes to the `plugin:<id>` scope and is exported with run history |
| Cancellation and activation | `onCancel` subscribes to status-bar cancellation; `isActive` prevents background plugins from drawing on the shared canvas |
| File access | `openFile / readText / readBinary` (project files, built-in samples and Code-mode files share the same logic) |
| Parameter read/write | `getParam / setParam` for project-level persistence; `reload` for instance self-recovery |
| Temporary cache | `cache`, an asynchronous plugin-scoped cache released on unload |
| File saving | `exportFile` saves text/binary to user downloads |
| GPU compute surface | `gpu` (createBuffer, write, read, compileKernel, run; see article 06) |

### 1.3 Parameter panel and controls {#_1-3-参数面板与控件}

Plugins declare a parameter table in the manifest; the host generates a localized reactive parameter panel supporting eight control types:

| Control | Example use |
| --- | --- |
| Range (slider) | Gravitational constant, damping coefficient |
| Dropdown | Scene preset, projection, palette |
| Number | Bin count, step size |
| Checkbox | Trails, grid visibility |
| Text | Column name, label |
| File | Additional data selection |
| Button | Reseed, export |
| Toggle | Boolean state other than run / pause |

Parameters can declare `group` and `inline`, placing controls in the same group side by side with automatic wrapping.

### 1.4 Lifecycle and lazy loading {#_1-4-生命周期与懒加载}

The plugin runtime orchestrates lifecycle centrally. Modules themselves are lazy-loaded: manifests are registered first, while module code is instantiated through dynamic `import()` only when the plugin is loaded; unloaded plugins consume no runtime resources:

```mermaid
flowchart LR
    A["注册（manifest 入注册表）"] --> B["加载（动态 import 模块实例化）"]
    B --> C["激活（视口判定 · 参数面板生成）"]
    C --> D["渲染与参数更新循环"]
    D --> E["去激活（资源保留 · 视口释放）"]
    E --> F["销毁（GPU 安全回收）"]
```

On destruction the host reclaims buffers and event listeners held by the plugin. Failed autoloads can be retried: the runtime treats “initialization complete” as a state-machine node, so the registry does not enter the ready state after failure and a user retry is not mistaken for duplicate loading.

### 1.5 Export {#_1-5-导出}

Export has two levels: **canvas-level** export is provided by the central area's unified “Export” menu, downloading the active plugin's 2D canvas or 3D scene as PNG (3D adds a transparent-background option), or saving it under workspace `figures/` through `src/core/vfs/`. **Data-level** export is declared by plugins as parameter-panel button actions (`exportCsv`), exporting their tabular data as RFC-4180 CSV (UTF-8 BOM; simulation plugins have row limits and sampling).

## II. 165 built-in plugins across 19 disciplines {#二、165-个内置插件-19-个学科分组}

`BUILTIN_PLUGINS` currently registers 165 plugins: 155 scientific and analysis plugins load automatically at startup, while 10 fun tools declare `autoload: false` and are loaded on demand. The sidebar groups the registry into 19 disciplines through `DISCIPLINE_BY_PLUGIN`; unmapped third-party plugin ids fall back to chart visualization.

The complete per-plugin table — id, Chinese and English names, a one-line description and the autoload flag — is generated from the manifests by `docs/scripts/gen-plugin-catalog.mjs` and published as [12 Plugin Catalog](./12-plugin-catalog). This section keeps only the registry overview and the runtime screenshots.

### 2.1 Discipline overview

| Discipline | Group ID | Plugins | Autoload | Manual |
| --- | --- | ---: | ---: | ---: |
| Charts | `charts` | 22 | 22 | 0 |
| Mathematics & Statistics | `math` | 21 | 21 | 0 |
| Physics | `physics` | 18 | 18 | 0 |
| Chemistry | `chem` | 5 | 5 | 0 |
| Biology | `bio` | 6 | 6 | 0 |
| Medicine & Public Health | `med` | 6 | 6 | 0 |
| Geography | `geo` | 16 | 16 | 0 |
| Environmental | `env` | 8 | 8 | 0 |
| Astronomy | `astro` | 3 | 3 | 0 |
| Materials | `materials` | 3 | 3 | 0 |
| Engineering | `engineering` | 11 | 11 | 0 |
| Economics | `econ` | 2 | 2 | 0 |
| Psychology | `psych` | 2 | 2 | 0 |
| Social Science | `socio` | 5 | 5 | 0 |
| Music & Art Science | `artsci` | 5 | 5 | 0 |
| Computer Science | `cs` | 7 | 7 | 0 |
| Data & AI | `data` | 8 | 8 | 0 |
| Visual FX | `fx` | 7 | 7 | 0 |
| Fun & Utility | `fun` | 10 | 0 | 10 |
| **Total** | 19 groups | **165** | **155** | **10** |

### 2.2 Runtime screenshot gallery

The 95 screenshots below show built-in plugins running with their sample data loaded; each caption states the input and the computation.

![Scatter plot: three point clusters](../assets/screenshots/plugins/scatter.png)

*Scatter plot: three point clusters, with the third column mapped to color.*

![Time series: trend line](../assets/screenshots/plugins/timeseries.png)

*Time series: trend with noise overlaid.*

![Sankey diagram: flow ribbons](../assets/screenshots/plugins/sankey.png)

*Sankey diagram: proportionally scaled colored flow ribbons.*

![Bubble chart: bubble encoding](../assets/screenshots/plugins/bubble.png)

*Bubble chart: position and size encode three numeric dimensions.*

![3D surface: gridded surface](../assets/screenshots/plugins/surface-3d.png)

*3D surface: a height-field grid.*

![Heatmap: Viridis color ramp](../assets/screenshots/plugins/heatmap.png)

*Viridis heatmap rendering a 2D numeric grid.*

![3D voxel rendering: translucent sphere](../assets/screenshots/plugins/voxel-3d.png)

*3D voxels: translucent spherical isosurface.*

![Bar chart: monthly data](../assets/screenshots/plugins/bar_chart.png)

*Bar chart of monthly data.*

![Radar chart: five-dimensional indicators](../assets/screenshots/plugins/polar.png)

*Radar chart comparing five-dimensional indicators.*

![Network graph: force-directed layout](../assets/screenshots/plugins/network.png)

*Force-directed network graph.*

![Parallel coordinates: iris](../assets/screenshots/plugins/parallel.png)

*Parallel coordinates: iris data.*

![Treemap: hierarchical data](../assets/screenshots/plugins/treemap.png)

*Treemap: hierarchical data.*

![Point-cloud viewer: 2D point cloud](../assets/screenshots/plugins/point-cloud.png)

*2D point-cloud rendering.*

![Markov chains: transition graph and trajectories](../assets/screenshots/plugins/stats-markov.png)

*Markov-chain analysis: transition graph and simulated trajectories.*

![Zipf's law: log–log fit](../assets/screenshots/plugins/stats-zipf.png)

*Zipf's law: log–log word-frequency fit.*

![Histogram: bimodal distribution](../assets/screenshots/plugins/histogram.png)

*Histogram: bimodal distribution.*

![Violin plot: built-in box overlay](../assets/screenshots/plugins/violin.png)

*Violin plot with built-in box overlay.*

![Box plot: outliers](../assets/screenshots/plugins/boxplot.png)

*Box plot: whiskers and outliers.*

![Error band: confidence interval of the mean](../assets/screenshots/plugins/errorband.png)

*Mean line with translucent error band.*

![QQ plot: deviation from reference line](../assets/screenshots/plugins/qqplot.png)

*QQ plot: sample deviates from the reference line.*

![Central limit theorem: normal overlay on means](../assets/screenshots/plugins/stats-clt.png)

*Sampling distribution of means with normal curve overlaid.*

![Fourier series: square-wave partial sum](../assets/screenshots/plugins/math-fourier.png)

*Fourier series: square-wave partial-sum approximation.*

![Complex-function domain coloring](../assets/screenshots/plugins/math-domaincolor.png)

*Domain coloring: per-pixel image of f(z).*

![ODE vector field and streamlines](../assets/screenshots/plugins/math-odefield.png)

*ODE vector field and streamline integration.*

![Electromagnetism: cyclotron example](../assets/screenshots/plugins/electromagnetism.png)

*Electromagnetism: drag and release charges; their cyclotron motion combines Coulomb and uniform-field Lorentz forces, with separately configurable magnetic-field strength and direction.*

![Optics lab: prism dispersion](../assets/screenshots/plugins/optics-prism.png)

*Optics lab: white light refracts and disperses through a triangular prism; convex/concave lenses and other elements are draggable for thin-lens imaging and dispersion demonstrations.*

![Structural mechanics: truss colored by force](../assets/screenshots/plugins/structure-truss.png)

*Structural mechanics: a pinned truss bears load in real time; members are colored by axial force and break successively under overload until overall collapse, illustrating material limits and failure propagation.*

![2D Ising model: spin configuration and heat-capacity peak](../assets/screenshots/plugins/physics-ising.png)

*2D Ising model: spin configuration and heat-capacity peak.*

![Diffusion equation: numerical and analytical comparison](../assets/screenshots/plugins/physics-diffusion.png)

*Diffusion equation: numerical versus analytical solution.*

![Diffraction lab: single-slit fringes](../assets/screenshots/plugins/physics-diffraction.png)

*Diffraction lab: single-slit fringes.*

![Trajectory kinematics: projectile fit and energy decomposition](../assets/screenshots/plugins/physics-trajectory.png)

*Trajectory kinematics: projectile fit and energy decomposition.*

![1D quantum solver: square-well wavefunctions](../assets/screenshots/plugins/physics-schrodinger.png)

*1D Schrödinger: square-well wavefunctions.*

![Heat-engine cycles: Otto p-V diagram](../assets/screenshots/plugins/physics-heatengine.png)

*Heat-engine cycles: Otto p-V diagram.*

![Particle simulation: GPU compute](../assets/screenshots/plugins/particles.png)

*GPU particle simulation.*

![Crystal · 3D unit cell (Rutile, COD 1530150)](../assets/screenshots/plugins/chem-crystal/cell3d.png)

*Crystal · 3D preview: load a CIF unit cell and view atoms, periodic bonds and cell frame as a ball-and-stick model; the Rutile example contains 8 atoms and can be combined with effective-composition and density estimates.*

![Reaction · free reaction dynamics 3D](../assets/screenshots/plugins/chem-reaction/md3d.png)

*Free reaction dynamics 3D: the built-in NumPy / Langevin engine integrates real trajectories at the specified temperature and catalyst conditions—in esterification (ethanol + acetic acid), bonds cross Arrhenius barriers and break, and radicals recombine to form bonds; atomic motion comes from real physics rather than scripted animation.*

![Titration curve: pH jump](../assets/screenshots/plugins/chem-titration.png)

*Titration curve: pH jump.*

![Reaction-order determination: integral-method fit](../assets/screenshots/plugins/chem-reaction-order.png)

*Reaction-order determination: linearized integral-method fit.*

![Gray–Scott Turing patterns](../assets/screenshots/plugins/chem-turing.png)

*Gray–Scott reaction–diffusion Turing patterns.*

![Enzyme kinetics: Michaelis-Menten saturation v=f(S)](../assets/screenshots/plugins/bio-enzyme/saturation.png)

*Enzyme kinetics: v=f([S]) saturation curves compare no inhibition / competitive / noncompetitive / uncompetitive cases; Levenberg-Marquardt recovers Vmax and Km from noisy initial velocities and reports kcat and catalytic efficiency.*

![Epidemic compartment model: SEIR (N=100,000, R₀=2.8)](../assets/screenshots/plugins/bio-epidemic/sirseir.png)

*Epidemic modeling: deterministic SIR / SEIR uses classical RK4. The SEIR example shows S/E/I/R over time, infection-peak time, total attack rate (92.1%) and herd-immunity threshold.*

![Sequence alignment: Needleman-Wunsch global alignment (BLOSUM62)](../assets/screenshots/plugins/bio-seqalign/alignment.png)

*Sequence alignment: BLOSUM62 global (NW) or local (SW) pairwise alignment with affine gap penalties; the example shows two protein sequences aligned, 46.4% identity, 9 gaps and GC analysis.*

![Population genetics: Hardy-Weinberg equilibrium test](../assets/screenshots/plugins/bio-popgen/hwe.png)

*HWE test: enter three genotype counts; the χ² test compares observations with HWE expectations (χ²=0.832, p=0.86 in the image), classifying p ≥ 0.05 as equilibrium.*

![Population genetics: Wright-Fisher drift (N=50, 40 replicates)](../assets/screenshots/plugins/bio-popgen/drift.png)

*Genetic drift: reproducible Wright-Fisher simulation with 40 allele-frequency random-walk trajectories, fixation/loss counts and mean fixation generation, with optional recessive / additive / dominant selection.*

![Enzyme kinetics: v–[S] inhibition fit](../assets/screenshots/plugins/bio-enzyme/inhibition.png)

*Enzyme kinetics: v–[S] inhibition fit.*

![Mendel F₂ χ² test](../assets/screenshots/plugins/bio-mendel.png)

*Mendel F₂ segregation-ratio χ² test.*

![Hodgkin–Huxley neuron: action potential and gating variables](../assets/screenshots/plugins/bio-neuron.png)

*Hodgkin–Huxley neuron: action potential and gating variables.*

![Wright–Fisher drift: 40 trajectories](../assets/screenshots/plugins/bio-popgen/drift-replicates.png)

*Wright–Fisher drift: 40 replicate trajectories.*

![Needleman-Wunsch global alignment](../assets/screenshots/plugins/bio-seqalign/nw-global.png)

*Needleman–Wunsch global sequence alignment.*

![SEIR epidemic model: compartment curves](../assets/screenshots/plugins/bio-epidemic/seir.png)

*SEIR epidemic model: compartment time curves.*

![Protein interactions: residue network](../assets/screenshots/plugins/protein-network.png)

*Protein interactions: residue interaction network.*

![Pharmacokinetics: concentration–time curve and therapeutic window](../assets/screenshots/plugins/bio-pk.png)

*Pharmacokinetics: concentration–time curve and therapeutic window.*

![Climatograph: Beijing monthly temperature and precipitation](../assets/screenshots/plugins/climatograph.png)

*Climatograph: monthly temperature line (left axis) + precipitation bars (right axis); Beijing is summarized as 12.7 ℃ annual mean, 527 mm precipitation, 29.9 ℃ annual range and a classified climate type.*

![Population pyramid: China 2020](../assets/screenshots/plugins/population-pyramid.png)

*Population pyramid: back-to-back age/sex groups (men left, women right), with 0-14 / 15-64 / 65+ proportions, sex ratio (105.7), and growing / stable / shrinking classification.*

![Spatial interpolation: IDW gridding 31 stations](../assets/screenshots/plugins/spatial-interpolation.png)

*Spatial interpolation: IDW (p=2) grids observations from 31 stations into a heatmap and isolines, with LOOCV RMSE / MAE and Moran's I spatial-autocorrelation test.*

![Projection distortion: Tissot indicatrices on Mollweide](../assets/screenshots/plugins/projection-distortion.png)

*Tissot indicatrices with world coastlines under seven projections: area ratio indicates area distortion and flattening indicates angular (shape) distortion; the image shows the equal-area Mollweide projection.*

![DEM terrain analysis: 3D mesh view](../assets/screenshots/plugins/terrain-3d-mesh.png)

*DEM terrain analysis (3D Mesh): ESRI ASCII Grid elevations form a height-colored 3D surface with adjustable vertical exaggeration and optional contours.*

![DEM terrain analysis: slope with contours](../assets/screenshots/plugins/terrain-slope.png)

*DEM terrain analysis (slope view): Horn-method slope (0-72°) with contours; another mode provides hillshade for extracting slope and aspect.*

![GPX track analysis: elevation-colored track and profile](../assets/screenshots/plugins/gpx-track.png)

*GPX analysis: parsed track points are colored by elevation on the left (46 points, 11.19 km, +217 m / −217 m); the right shows elevation against distance and totals for distance and ascent / descent.*

![Interactive globe (3D): Natural Earth coastlines and spherical Tissot indicatrices](../assets/screenshots/plugins/globe-3d.png)

*Interactive globe: true 3D drag rotation and scroll zoom, Natural Earth 110m coastlines on the sphere, spherical Tissot indicatrices and auto-rotation.*

![Distance and area: polyline distance and standard-deviation ellipse](../assets/screenshots/plugins/standard-deviation-ellipse.png)

*Distance and area: click points for segment great-circle and cumulative distances; for ≥3 points, also compute a standard-deviation ellipse (SDE a / b semi-axes and azimuth) and enclosed area. The image shows six Yangtze cities and their ellipse.*

![Solar elevation and day length](../assets/screenshots/plugins/geo-solar.png)

*Solar elevation and day length: annual day-length curve.*

![Distance and area measure](../assets/screenshots/plugins/geo-measure.png)

*Distance and area measurement.*

![Projection distortion: Tissot indicatrices on Mollweide](../assets/screenshots/plugins/tissot-mollweide.png)

*Projection distortion: Tissot indicatrices on the Mollweide projection.*

![Climatograph: Cairo](../assets/screenshots/plugins/climatograph-cairo.png)

*Climatograph: Cairo monthly temperature and precipitation.*

![Radiocarbon dating: calibration curve](../assets/screenshots/plugins/geo-carbondating.png)

*Radiocarbon dating: IntCal20 calibration curve.*

![Soil-water retention curve fitting](../assets/screenshots/plugins/geo-soilwater.png)

*Soil-water retention curve fitting.*

![SCS rainfall–runoff: hydrograph](../assets/screenshots/plugins/geo-hydrology.png)

*SCS rainfall–runoff hydrograph.*

![Air quality: daily AQI bars](../assets/screenshots/plugins/env-aqi.png)

*Daily AQI bar chart.*

![Biodiversity: stacked species abundance](../assets/screenshots/plugins/env-biodiversity.png)

*Stacked species abundance for three sites.*

![Pollutant dispersion: Gaussian plume concentration](../assets/screenshots/plugins/env-plume.png)

*Gaussian-plume ground concentration.*

![3D global environment: albedo layer](../assets/screenshots/plugins/env-earth3d.png)

*3D Earth albedo layer.*

![Water quality: indicator radar chart](../assets/screenshots/plugins/env-water.png)

*Water-quality radar chart and WQI rating.*

![Greenhouse effect: 0D energy balance](../assets/screenshots/plugins/env-greenhouse.png)

*Greenhouse simulation: zero-dimensional energy balance ΔT.*

![Carbon cycle: box model](../assets/screenshots/plugins/env-carbon.png)

*Carbon cycle: four-pool box model.*

![Predator–prey: phase trajectory](../assets/screenshots/plugins/env-predator-prey.png)

*Predator–prey: Lotka–Volterra phase trajectory.*

![Astronomy CCD pipeline: simulated star field and detection circles](../assets/screenshots/plugins/astro-pipeline.png)

*CCD pipeline: simulated star field and source-detection circles.*

![Transit fitting: light curve and phase folding](../assets/screenshots/plugins/astro-transit.png)

*Transit fitting: light curve and phase folding.*

![Hertzsprung–Russell diagram: color–magnitude scatter and main sequence](../assets/screenshots/plugins/astro-hrdiagram.png)

*Hertzsprung–Russell diagram: color–magnitude scatter and main-sequence reference.*

![XRD: diffraction peaks and d values](../assets/screenshots/plugins/mats-xrd.png)

*Silicon-sample XRD diffraction peaks and d-value annotations.*

![Thermal analysis: DSC/TGA curves](../assets/screenshots/plugins/mats-thermal.png)

*DSC/TGA weight-loss step curves.*

![Plane truss FEA: force coloring and deformation](../assets/screenshots/plugins/eng-truss.png)

*Plane truss FEM axial-force coloring and deformation overlay.*

![Control systems: step response and Bode plot](../assets/screenshots/plugins/eng-control.png)

*Control systems: step response and Bode plot.*

![DC circuit: node voltages and topology](../assets/screenshots/plugins/eng-circuit.png)

*DC circuit: node voltages and topology.*

![Black-Scholes: option value and MC convergence](../assets/screenshots/plugins/econ-blackscholes.png)

*BSM option-price curve and Monte Carlo convergence.*

![Spatial prisoner's dilemma: strategy grid](../assets/screenshots/plugins/econ-evogame.png)

*Spatial prisoner's dilemma strategy grid and cooperation rate.*

![Reaction time: histogram and box plot](../assets/screenshots/plugins/psych-rt.png)

*Reaction-time histogram and box plot.*

![Image processing: before/after sharpening](../assets/screenshots/plugins/data-imageproc.png)

*Image processing before and after sharpening.*

![Black hole · 3D ray tracing](../assets/screenshots/plugins/fx-blackhole.png)

*Black-hole 3D ray-traced rendering.*

![Water waves · 3D fluid: water surface](../assets/screenshots/plugins/fx-water.png)

*Water waves · 3D fluid: 3D surface waves.*

![Starfield · night sky: Milky Way](../assets/screenshots/plugins/fx-stars.png)

*Starfield · night sky: Milky Way rendering.*

![Palette explorer: color steps](../assets/screenshots/plugins/fun-palette.png)

*Palette with 12 color steps.*

![Koch snowflake: iterative fractal](../assets/screenshots/plugins/fun-koch.png)

*Koch snowflake, 6 iterations.*

![Barnsley fern: IFS fractal](../assets/screenshots/plugins/fun-barnsley.png)

*Barnsley fern, 300,000 points.*

![Harmonograph: pendulum art](../assets/screenshots/plugins/fun-harmonograph.png)

*Harmonograph winding pendulum curves.*

## III. Research metadata, scientific output and Figure Studio integration {#三、科研级元数据、科学输出与-figure-studio-联动}

### 3.1 Four research-readiness levels in manifest.research {#_3-1-manifest-research-四级研究就绪度}

A plugin manifest can declare `research` metadata (`PluginResearchMeta`), rendered as a tier badge in the marketplace and detail view. Without it there is no rating (third-party packages have no badge by default). The four tiers are:

| Tier | Meaning |
| --- | --- |
| research | Literature-based algorithm + reference-solution comparison + true-residual certification + benchmarks/tests |
| quasi-research | Real data input and correct kernel, but some scientific output / diagnostics / reproducibility hooks may be missing |
| demonstration | Can load data, but output is primarily visual, without numerical conclusions |
| educational | Parameter-slider driven, with built-in/approximate data or zero-dimensional model, solely for teaching demonstrations |

Fields include `tier` (one of the four), `units` (physical units of key quantities, e.g. `{ length: 'm', time: 's' }`), `benchmarks` (ids of validation benchmark scenarios runnable in the plugin), `reproducible` (deterministic results for the same seed and input), and `notes` (scope displayed with the badge). `.cspkg` manifest validation rejects unknown tiers; packages declaring research tier must provide nonempty `benchmarks` (also covering a `reproducible: true` declaration).

### 3.2 Unified scientific output bus {#_3-2-统一科学输出总线}

`src/core/research/scienceOutput.ts` is a pure-TypeScript structured scientific-output bus: in addition to “compute then draw,” plugins publish numerical conclusions such as fit quality, residuals, confidence intervals and convergence/conservation diagnostics as `ScienceMetric` (key/label/value/unit/severity/hint) through `setScienceOutputs`. `ScienceOutputStrip` subscribes and renders them in a dedicated strip beside the viewport. Metrics are stored by plugin id, so switching plugins automatically switches the displayed conclusions; a plugin without valid results clears its publication so stale conclusions do not remain. Numeric formatting uses adaptive precision (4 significant digits, exponential notation for extremes); NaN/Infinity display as “—” rather than silently disappearing.

### 3.3 Send to Figure Studio {#_3-3-发送到-figure-studio}

Research-grade suite plugins (32 total across nine suites: chemistry, physics, engineering, biology and environment, earth science, math, statistics, economics and psychology, astronomy and data) and 8 geography plugins provide a “Send to Figure Studio” button: assemble the current analysis into a multi-panel scientific figure (Chinese/English titles and captions, formula annotations) and send it to the figure workbench in one click. The two solver plugins (electromagnetic resonance eigensolver and 1D-3D bidirectional coupling solver) also support it. The central bridge is `pushPanelsToFigure` in `src/core/figure/sheet.ts`: create a figure sheet → add each panel (336×252 standard panels, three columns in row-major order, a/b/c labels) → attach bilingual caption → notify the user. If data or an open project is missing, an explicit notice is shown rather than silent failure.

## IV. Marketplace catalog and two-level loading {#四、市场目录与两级加载}

The marketplace catalog (`src/plugins/marketplace.ts`) presents each built-in with featured labels, popularity and category filters (scientific, fun, utility); community “coming soon” entries are placeholders. `marketplace-demo-packages.ts` provides signed sample packages that can actually be installed, allowing the full “sign → trust → sandbox install” flow to be practiced in the UI. Loading has two levels:

```mermaid
flowchart LR
    A["应用启动"] --> B["自动加载 155 个插件"]
    A --> C["10 个趣味工具插件保持未加载"]
    C --> D["用户从插件面板或市场标签页手动加载"]
    B --> E["注册表就绪<br/>首屏保持轻量"]
    D --> E
```

Every built-in registry entry declares a manifest, `autoload` flag and dynamic `import()` loader: module code is fetched only when the plugin is loaded; an unloaded plugin occupies only a manifest record.

## V. Third-party packages (.cspkg), sandbox and signing {#五、第三方包-cspkg-、沙箱与签名}

A `.cspkg` is a ZIP archive (packed with fflate) containing `manifest.json`, an entry module and assets. Before loading, `src/core/cspkg.ts` validates required fields, plugin id format, package-relative entry path (rejecting `..`, absolute paths and drive letters), and sandbox enum. Archive keys are normalized; traversal and absolute-path keys are discarded, and oversized archives are rejected before decompression (zip-bomb protection). The manifest declares `sandbox`:

```jsonc
{
  "id": "com.example.analyzer",
  "name": "Analyzer",
  "version": "1.2.0",
  "author": "Example Corp",
  "description": "…",
  "entry": "dist/index.js",
  "sandbox": "isolated",        // "isolated"（默认）| "trusted"
  "formats": [{ "extension": ".dat" }]
}
```

- **isolated (default)**: entry code runs in a Web Worker with its own global scope and cannot access host-page globals, DOM or stores; canvas rendering uses a transferred OffscreenCanvas, and host–Worker communication uses only typed RPC (`src/core/sandbox.ts` and `src/core/plugin-worker.ts`).
- **trusted**: executes in host context with full DOM access; recommended only for in-house packages.

Third-party plugin loading and communication:

```mermaid
sequenceDiagram
    participant U as 用户
    participant H as 宿主（cspkg 加载器）
    participant V as 清单与签名校验
    participant W as Worker 沙箱
    U->>H: 选择 .cspkg 文件
    H->>V: 解压并校验 manifest 与签名
    V-->>H: 校验通过（id 格式、入口路径、沙箱枚举、信任来源）
    H->>W: 在 Worker 内执行入口模块
    W-->>H: 通过 postMessage RPC 上报渲染与状态
    H-->>U: 画布经 OffscreenCanvas 呈现
```

### 5.1 Package signing and trust registry {#_5-1-包签名与信任注册表}

Signing answers “**who published this package**”; sandboxing answers “**what can it do at runtime**.” They are independent—a valid signature does not weaken isolation.

| Stage | Implementation |
| --- | --- |
| Algorithm | Ed25519 (RFC 8032) and SHA-256 (FIPS 180-4), self-implemented in pure TypeScript using BigInt without WebCrypto (Ed25519 support varies across browsers and Node) |
| Signature payload | Normalized package payload: stable JSON with recursively sorted manifest keys, no whitespace and undefined removed, plus entry bytes; signing CLI and browser verifier agree byte-for-byte |
| Fingerprint | `ed25519:<hex32>`—first 16 bytes of SHA-256 of the public key |
| Trust model | `verifyPackageSignature` returns structured results with `unsigned` / `untrusted-key` / pass; unsigned packages are rejected by default, while a valid signature from an unknown key prompts the user to check the fingerprint and explicitly trust it |
| Trust registry | Built-in official public-key constant `OFFICIAL_TRUSTED_KEYS`; user-added trusted keys persist via `storage.ts`, degrading gracefully if IndexedDB is unavailable |
| Toolchain | `node scripts/sign-cspkg.mjs --genkey <keyfile>` generates keys; `<package-dir> --key <keyfile>` signs and produces .cspkg; `--verify <file.cspkg> [--trust <keyfile>]` verifies again |

Known limits (recorded candidly): the Worker and page share same-origin IndexedDB. When Workers are unavailable, the legacy fallback (`new Function` with shadowed globals) is only a best-effort approximation, not a security boundary; the interface explicitly warns when it is enabled.

## VI. File routing and sample data {#六、文件路由与示例数据}

When a user drags any file into the central area or plugin list, the host identifies its format by magic number and extension (optionally aided by WASM) and routes it to a matching plugin:

```mermaid
flowchart TD
    A["文件拖入中央视口"] --> B["读取文件头（魔数）"]
    B --> C["扩展名辅助匹配"]
    C --> D{"科研二进制格式？"}
    D -- 是 --> E["科研数据调度器<br/>（HDF5 · NetCDF · FITS · Zarr · Parquet）"]
    D -- 否 --> F{"唯一匹配插件？"}
    E --> F
    F -- 是 --> G["直接路由并激活"]
    F -- 否 --> H["弹出选择对话框由用户决定"]
    G --> I["示例数据对话框可一键加载该插件附带的示例数据"]
    H --> I
```

The import dialog also filters by file format, so unrecognized files do not enter the parser. Before parsing, large files go through row-window reading and content fingerprints in `src/core/chunked/`; `parse-worker.ts` and `worker-pool.ts` run parsing in a Worker pool to avoid blocking the main thread.

Sample data is registered centrally by the `examples` module (`BUILTIN_EXAMPLES` in `src/core/examples.ts`, each record mapping a sample file to a plugin id) and shown by plugin in the top-bar sample-data dialog. `examples/data/` contains 189 data files, `examples/projects/` contains 11 `.clproj` sample projects, and `examples/code/` contains 9 Python examples. Content fingerprints (shared by `citation.ts` and storage) let repeated imports of the same data be recognized and reused.
