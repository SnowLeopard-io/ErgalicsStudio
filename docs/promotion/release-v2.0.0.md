# Ergalics Studio v2.0.0 · First Official Release

Ergalics Studio is an open-source scientific computing workstation that runs in the browser: without installing any software, open the website to import data, visualize it, perform statistical tests and numerical simulations, and create scientific plots. The project is designed as a “plugin-based scientific research operating system” — its sandboxed plugin system, unified scientific metadata, GPU-accelerated computation, and reproducibility kernel enable analyses ranging from classroom demonstrations to near-research-grade work in the same environment.

After a year of iteration and three stages of architectural evolution, v0 → v1 → v2, v2.0.0 is the first official public release.

## Key Features {#核心特性}

### Four-mode workbench {#四模式工作台}
- **Standard mode**: Drag in data to produce a plot, adjust parameters in real time, and complete an analysis without code.
- **Flow mode**: Visually build data pipelines using 53 built-in blocks (data sources / transforms / filters / math / statistics / units / visualization / plotting), with topological execution and per-node inspection.
- **Code mode**: Python (full Pyodide runtime), R (full webR R runtime), and JavaScript, with bidirectional integration with canvas plugins (`studio.plot(...)` goes directly to a plotting plugin).
- **Block mode**: A Scratch-like scientific block editor suitable for introductory programming education.
- Left activity bar (Files / Git / Plugins), central tab area, and editors for each file type; command palette (Ctrl+K) and global shortcuts.

### 163 built-in plugins · 19 discipline groups {#_163-个内置插件-·-19-个学科分组}
- Covers charts / statistics / mathematics / physics / engineering / astronomy / effects / chemistry / biology / medicine / geography / environment / materials / economics / psychology / society / art and science / computing / data / fun tools.
- Two-level loading: 153 product plugins load automatically and 10 load on demand, keeping the initial screen lean.
- All plugins integrate with a unified scientific metadata system: readiness levels, physical quantity units, reproducibility markers, and a structured scientific output strip (ScienceOutputStrip).
- One-click “Send to Figure Studio” to assemble publication-grade multi-panel figures.

### GPU computing and real physics simulations {#gpu-计算与真实物理模拟}
- 14 reusable WGSL compute kernels (WebGPU), with automatic CPU fallback.
- Real-time black-hole ray tracing using general relativity (RK4 integration of geodesics in Binet form, ISCO accretion disk, Doppler beaming, and gravitational redshift).
- Wave-equation FDTD water-wave solver, Nishita atmospheric scattering, and a night-sky renderer based on GMST and the Bortle scale.
- Bidirectional fluid CFD coupling solver (1D pipe network × 3D field).

### 33 standalone research tools {#_33-个独立科研工具}
- Uncertainty (Bootstrap CI / Monte Carlo propagation / MCMC, including R-hat and ESS convergence diagnostics).
- Dimensionally safe units and chunked ingestion of large datasets (formats including HDF5).
- File explorer, workspace Git (automatic commits), and reproducibility kernel (`repro.lock`).
- Embedded in the workbench canvas as ToolShell interfaces.

### Workspace file system {#工作区文件系统}
- In-browser VFS (LightningFS / IndexedDB); flow graphs and block programs are persisted as `.flow.json` / `.block.json`.
- Project export logs, data-cluster badges, and recent project management.
- Unified canvas export: download PNGs or save them to the workspace `figures/`; 3D scenes support transparent backgrounds.

### Engineering quality {#工程质量}
- TypeScript strict mode, sandboxed plugin RPC protocol, and `.cspkg` plugin package-signing gate.
- 241 test files, 3,878 unit test cases, Playwright E2E (headless Edge), and a `pre-push` hook that runs tests automatically.
- Zero `npm audit` findings (2026-10-13 security upgrade window; see SECURITY.md).
- Fully bilingual community documentation: CONTRIBUTING / CODE_OF_CONDUCT / SECURITY / CHANGELOG / PR and Issue templates.

## Getting Started {#快速开始}

**Use online (recommended)**: Open and use, no installation required.  
https://snowleopard-io.github.io/ErgalicsStudio/app/

**Build locally**:

```bash
git clone https://gitee.com/cnt-code/ergalics-studio.git
cd ergalics-studio
npm install
npm run dev
```

Requirements: A modern browser (Chrome / Edge recommended for WebGPU support).

## Links {#链接}

- Chinese documentation: https://snowleopard-io.github.io/ErgalicsStudio/
- GitHub: https://github.com/SnowLeopard-io/ErgalicsStudio
- Gitee: https://gitee.com/cnt-code/ergalics-studio
- Issue tracker: https://gitee.com/cnt-code/ergalics-studio/issues

---

**English Summary**

Ergalics Studio is an open-source, browser-based scientific computing workstation. v2.0.0 is its first official release: a 4-mode workbench (interactive canvas / visual flow / multi-language code / block editor), 163 built-in plugins across 19 disciplines, 33 standalone research tools, live WebGPU compute with 14 reusable WGSL kernels (including a real-time Schwarzschild ray tracer, FDTD wave solver and Nishita atmosphere), a browser workspace VFS with Git integration, reproducibility kernels, and a sandboxed plugin SDK with signed packages. No installation required — open the URL above and start computing.

**Full Changelog**: https://gitee.com/cnt-code/ergalics-studio/blob/main/CHANGELOG.md
