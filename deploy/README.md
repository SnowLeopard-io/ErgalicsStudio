# Ergalics Studio — 打包与部署总览

各平台打包工程统一放在本目录下。**应用本体是一套纯 Web 代码**（`src/`，
零服务端、零数据出本机），各端只是同一份前端的载体不同。

## 目录与状态

| 目录 | 平台 | 状态 | 载体 |
| --- | --- | --- | --- |
| `windows/` | Windows | ✅ 已实现 | Electron + NSIS 安装器 |
| `linux/` | Linux | ✅ 已实现 | Electron → AppImage / deb |
| `macos/` | macOS | 占位，待实现 | Electron → dmg（arm64 + x64） |
| `android/` | Android | ✅ 已实现 | Capacitor 8 → 未签名 APK |
| `pwa/` | 全平台"安装" | 占位，建议优先 | manifest + service worker |
| `selfhost/` | 内网共享部署 | 占位，待实现 | Dockerfile + nginx 静态托管 |

## 目前可用的打包命令（Windows）

前置：仓库根目录 `npm install`，以及 `deploy/windows/` 下 `npm install`
（Electron / electron-builder / esbuild 等独立依赖）。

```powershell
# 一条命令完成全部链路：
node scripts/windows-build.mjs
```

该脚本自动执行：

1. 与 `package.json` 同步版本号到 `deploy/windows/package.json`
2. `npm run build:web` —— 渲染层 Vite 构建（含 wasm stub、tsc 检查、docs）
3. `deploy/windows` 内 `npm run build:main` —— esbuild 打包 Electron 主进程
   + preload（`deploy/windows/build.mjs`）
4. 渲染产物拷贝到 `deploy/windows/app-dist`
5. `deploy/windows` 内 `npm run dist` —— electron-builder 出 NSIS 安装器
   （`Ergalics Studio Desktop-<version>-Setup.exe`）
6. 把生成的 `.exe` 拷贝到用户桌面

产物位置：`deploy/windows/release/*.exe`（另含 `win-unpacked/` 免安装目录，
可直接运行用于验证）。构建产物均不入库（见 `.gitignore`）。

GitHub Actions：`.github/workflows/windows.yml` 在 push main / PR / 手动触发时
于 `windows-latest` 上构建 NSIS 安装器并上传 artifact；打 `v*` tag 时
`release.yml` 把同一安装器附加到 GitHub Release。CI 用 `--from-dist`
复用已构建的 `dist/`，且不会把 `.exe` 复制到 runner 桌面。当前产物未签名。

### 手动分步执行

```powershell
npm run build:web                      # 渲染层
cd deploy/windows
npm run build:main                     # Electron 主进程
npm run dist                           # NSIS 安装器
```

### 本地开发

```powershell
npm run dev                            # Web 版 dev server（另开一个终端）
npm run dev:desktop                    # Electron 窗口连到这个 dev server（支持 HMR）
```

`scripts/desktop-dev.mjs` 会按需重建 Electron 主进程 / preload 包，然后用
`ERGALICS_DEV=1` 载入 `ERGALICS_DEV_URL`（默认 `http://127.0.0.1:5173/`）。
首次运行需要先在 `deploy/windows` 下 `npm install`（Electron 33 独立依赖）。
脚本会剥掉 `ELECTRON_RUN_AS_NODE`——该变量会让 Electron 退化成纯 Node 进程、
不创建窗口。要调主进程时加 `--remote-debugging-port=9222` 之类的 Chromium 参数：

```powershell
node scripts/desktop-dev.mjs -- --remote-debugging-port=9222
```

## Linux 打包命令

前置：Linux 构建机（CI 用 `ubuntu-latest`），并在 `deploy/linux/` 下 `npm install`。

```bash
npm run build:linux                # Web 构建 → 共享主进程打包 → AppImage + deb
```

产物：`deploy/linux/release/*.AppImage` 与 `*.deb`。完整说明见 `linux/README.md`。

## Android 打包命令

前置：JDK 21 + Android SDK Platform 36，并在 `deploy/android/` 下 `npm install`。

```powershell
npm run build:android              # Web 构建 → cap sync → assembleDebug → APK
npm run build:android:release      # 同上，出 release APK（未签名）
```

产物：`deploy/android/release/Ergalics-Studio-<version>-debug.apk`。
完整说明见 `android/README.md`；GitHub Actions 会自动构建并上传 APK。

## Web 版（所有端共用的基础）

```powershell
npm run build:web                      # 产出 dist/，可直接静态托管
npm run preview                        # 本地预览构建产物
```

`dist/` 即 `selfhost/`（静态托管/Docker）与 `pwa/`（加 manifest + SW）
的基础，也是 Electron 渲染层的来源——三端同源。

## 各待实现端的入口

- Linux：`npm run build:linux`；共享主进程 + AppImage/deb 配置见 `linux/README.md`
- macOS：给 `deploy/windows/electron-builder.yml` 加对应 target
  或复制配置；构建机必须是 Mac（或 CI）。详见 `macos/README.md`
- Android：`npm run build:android`；工程结构、前置条件与 CI 见 `android/README.md`
- PWA：`vite-plugin-pwa` 方案见 `pwa/README.md`
- 自托管：Dockerfile + nginx 要点见 `selfhost/README.md`

## 平台兼容速查

| 功能 | Win | Linux | macOS | Android |
| --- | --- | --- | --- | --- |
| WASM 内核（DuckDB/Pyodide/stats） | ✅ | ✅ | ✅ | ✅ |
| WebGPU 渲染 | ✅ | ✅ | ✅ (Metal) | ⚠️ 新版 WebView |
| node-pty 终端 | ✅ | ✅ | ✅ | ❌ 需降级 |
| 便携 Python | ✅ | ⚠️ 需平台分发 | ⚠️ 需平台分发 | ❌ |
| 签名/公证 | 可选 | 不需要 | 正式分发需 $99/年 | 可选 |
| 构建机 | 本机即可 | 需 Linux/CI | 需 Mac/CI | 需 Android SDK |
