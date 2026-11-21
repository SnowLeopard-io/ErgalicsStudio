# Fluid Bidirectional Coupling Solver · Container Deployment Manual

> Accompanying deliverable: the **container deployment package** for the `Fluid Bidirectional Coupling Solver` plugin.
> This manual explains how to start the **working prototype** with one command on any machine with Docker installed, and reproduce the complete set of validation cases inside a container.
> It addresses competition deliverable requirement (4b), “provide an executable program in the form of a container deployment package.”

---

## 1. Deliverables {#_1-交付物清单}

The container deployment package is located at the project root and consists of five files:

| File | Purpose |
| --- | --- |
| `Dockerfile` | Working prototype image: Vite dev server hosts the complete workbench |
| `docker/cfd.Dockerfile` | CLI reproduction image: the same solver core (pure NumPy) + validation suite |
| `docker-compose.yml` | One-command orchestration of `studio` (browser demonstration) and `cfd-verify` (CLI reproduction) |
| `.dockerignore` | Build context exclusions (node_modules / build artifacts / Rust toolchain) |
| This manual | Deployment, operation, reproduction, and troubleshooting instructions |

> Relationship to the online experience: this project also provides an online GitHub Pages experience
> (`https://snowleopard-io.github.io/ErgalicsStudio/`). Container deployment is intended for situations requiring **local, offline, auditable** prototype operation; both use the same code and results.

---

## 2. Prerequisites {#_2-前置条件}

| Prerequisite | Requirement |
| --- | --- |
| Docker | Includes the Compose plugin; Docker Desktop or the corresponding Linux packages are both suitable; `docker --version` and `docker compose version` must both work |
| Network | Access to Docker Hub (to pull `node:20-alpine` / `python:3.11-slim`) and the npm registry (to install frontend dependencies during the first build) |
| Memory | ≥ 4 GB available recommended (Pyodide runs the 3D N–S solver in the browser); a 10³ grid typically requires only ~1 GB |
| Disk | ≥ 2 GB free (build cache) |

---

## 3. Quick start {#_3-快速开始}

### 3.1 Start the working prototype with one command {#_3-1-一键启动可运行原型}

```bash
# 在项目根目录执行
docker compose up -d --build studio
```

The first build installs frontend dependencies and takes 2–8 minutes; subsequent starts take seconds.

Visit **`http://localhost:5173`** in a browser, then select `物理模拟 → 1D-3D 双向耦合求解器` in the plugin sidebar:

1. Select a case (Case A steady choked flow / Case B millisecond-scale valve control / Case C energy channel / Case D subcritical flow / custom);
2. Click **Run Coupling** to run the 1D network ↔ 3D N–S bidirectional coupling;
3. Inspect the 1D flow / valve opening / back-pressure time series and **animated 3D field playback** (temperature / velocity magnitude channels, play/pause and frame-by-frame playback).

> The CFD solver is pure Python + Pyodide and runs **entirely in the browser**; no backend Python is required.
> The prototype container only hosts the workbench frontend, so the `studio` image does not need a Rust/WASM toolchain, builds quickly, and remains a manageable size.

### 3.2 Reproduce validation cases inside a container (CLI) {#_3-2-容器内复现验证算例-cli}

```bash
# 单元测试套件（26 项断言，run_tests.py）
docker compose run --rm cfd-verify

# 完整验证套件（Case A/B/C/D + 亚声速扫描 + 权衡 + 最小周期 + 归因；输出 JSON 到 stdout）
docker compose run --rm cfd-verify python -m fluid_cfd.driver verify

# 生成精度-效率基准 JSON（显式写回 /fluid；容器为一次性执行，如需保留可挂载卷或 docker cp）
docker compose run --rm cfd-verify python benchmarks/bench_coupling.py /fluid/fluid-cfd-results.json

# 单算例耦合（自定义 payload，见 config.example.json；CLI 子命令为 solve，后接 JSON 字符串）
docker compose run --rm cfd-verify python -m fluid_cfd.driver solve '{"case": "a"}'
```

These commands share **the same `fluid_cfd` source code** as the browser plugin, and their deterministic scientific fields agree (wall-clock quantities such as latency are machine-dependent and compared across environments with soft tolerances). The NumPy version in the image varies with build time; lock the version in `requirements.txt` if strict alignment is required.

### 3.3 Optional: production static mode (prebuild + nginx) {#_3-3-可选-生产静态模式-预构建-nginx}

By default, `studio` runs as a dev server, which is sufficient for demonstrations and quick to build. For a static form closer to “production deployment,” prebuild with the local toolchain and serve it with any static server (the build command used by this repository for GitHub Pages):

```bash
# 需要 Rust + wasm32-unknown-unknown 目标 + wasm-bindgen-cli 0.2.127
npm ci && npm run build          # → dist/
# 用 nginx/http-server/vite preview 托管 dist/ 即可
```

> This path matches deployment CI (`.github/workflows/deploy.yml`) and is usually chosen for online releases; for local review demonstrations, the dev container in §3.1 suffices and does not require Rust.

---

## 4. Common operations {#_4-常用运维}

| Need | Command |
| --- | --- |
| View service status | `docker compose ps` |
| Logs (frontend dev server) | `docker compose logs -f studio` |
| Stop and remove | `docker compose down` |
| Restart the prototype | `docker compose restart studio` |
| Change port (e.g. 8080) | Edit `ports: ["5173:5173"]` → `["8080:5173"]` in `docker-compose.yml`, then run `docker compose up -d` |

---

## 5. Mapping to this project's deliverables {#_5-与本项目交付体系的对应}

| Competition deliverable requirement | Corresponding item in this package |
| --- | --- |
| Working prototype (4b) | `studio` service: run bidirectional coupling + animated 3D playback directly in the browser |
| Reproducible materials (4d) | `cfd-verify` service: 26 assertions against the same core + benchmark generation |
| Convenient, scripted deployment | One command: `docker compose up -d --build studio` |
| Consistency with the proposal/case report | The results use exactly the same conventions as `docs/technical/10-fluid-bidirectional-coupling-solver.md` |

---

## 6. Troubleshooting {#_6-故障排查}

| Symptom | Action |
| --- | --- |
| `studio` repeatedly restarts because the port is occupied | Stop the process occupying 5173, or change the port as in §4 |
| Browser opens a blank page / plugin cannot load | Confirm that you are visiting `http://localhost:5173` and there are no compilation errors in the logs; `docker compose logs -f studio` |
| `cfd-verify` pulls NumPy slowly over the network | The first build must download a NumPy wheel; later builds use the layer cache |
| 3D demonstration is slow | Grid sizes are fixed by case presets (10³ for Case A/B/D, 8³ for Case C); the plugin provides no grid control. A custom case can shorten the simulation duration to reduce Pyodide computation |
| Build requires Rust | Only production static mode in §3.3 requires it; the default container in §3.1 does not |
