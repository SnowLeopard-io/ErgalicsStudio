# Ergalics Studio — Linux 打包

本目录是 Linux 端完整打包工程（不再是占位）。继续沿用 Electron：
**主进程源码与 Windows 版共用 `deploy/windows/src`**，本目录只放 Linux 的构建脚本、
electron-builder 配置与产物；渲染层仍是仓库根目录同一份 `dist/`。

## 产物

| 产物 | 适用 | 备注 |
| --- | --- | --- |
| AppImage | 通用，免安装双击即跑 | 首选，不依赖发行版包管理器 |
| deb | Ubuntu / Debian 系 | 可直接 `sudo apt install ./...deb` |

rpm / snap / flatpak 未启用；需要时给 `electron-builder.yml` 的 `linux.target` 加项即可。

## 跨平台修正（已落地）

为了让共用的主进程在 Linux 上真正可用，调整了三处 Windows 专属假设：

- `python-host.ts`：便携环境查找从固定 `python.exe` 改为按平台尝试
  `python.exe`（Win）或 `bin/python3`/`bin/python`/`python3`（Unix），系统解释器回退
  从 `python` 改为 `python3`；Windows 行为不变。
- `pty-host.ts`：非 Windows 注册 POSIX shell provider（`$SHELL` 或 `/bin/sh`），
  PATH 分隔符改用 `path.delimiter`；不再尝试启动 `powershell.exe`。
- `index.ts`：窗口图标按平台选 `icon.ico`（Win）/ `icon.png`（Unix）。

便携 Python 环境仍需按发行版自行准备并放到 `resources/python/`；没有时桌面
Python 功能会自动回退到系统 `python3`，Web 版 Pyodide 不受影响。

## 目录结构

```
deploy/linux/
├── package.json             # 独立依赖（electron / electron-builder / esbuild）
├── build.mjs                # 用 esbuild 打包共享主进程 + preload
├── electron-builder.yml     # AppImage + deb 配置、共享 extraResources
├── app-dist/                # 构建时暂存的渲染层（不入库）
├── dist-electron/           # 主进程 bundle（不入库）
└── release/                 # AppImage / deb 产物（不入库）
```

## 前置条件

- Node.js 22、npm 10
- **必须在 Linux（或 Linux CI）上构建**，Windows 不能交叉出 AppImage/deb
- 系统装有 `git`（simple-git 依赖）与 `python3`（桌面 Python 回退路径）
- 仅在本机打包时：进入本目录执行一次 `npm install`

## 打包

在仓库根目录执行：

```bash
npm run build:linux
```

脚本 `scripts/linux-build.mjs` 依次完成：

1. 同步根目录版本号到 `deploy/linux/package.json`
2. `npm run build:web` —— 与 Web / Windows 版完全相同的渲染层构建
3. 把 `dist/` 拷贝到 `app-dist/`
4. `npm run build:main` —— esbuild 打包 `deploy/windows/src` 的主进程与 preload
5. `npm run dist` —— electron-builder 出 AppImage + deb
6. 列出 `deploy/linux/release/` 下的产物

常用可选项：

```bash
node scripts/linux-build.mjs --from-dist     # 复用已有 dist/，跳过 Web 构建
node scripts/linux-build.mjs --no-package    # 只做暂存 + 主进程打包
node scripts/linux-build.mjs --dry-run       # 只打印计划
```

## 已知坑：chrome-sandbox

部分发行版直接运行 AppImage 会报
`The SUID sandbox helper binary was found, but is not configured correctly`。
两种处理方式：

1. 启动参数加 `--no-sandbox`（省事，但降低沙箱保护）
2. 开启内核 user namespace：
   `sudo sysctl -w kernel.unprivileged_userns_clone=1`（Ubuntu/Debian），
   或确保 deb 包里 `chrome-sandbox` 的 SUID 权限正确

## GitHub Actions

`.github/workflows/linux.yml` 在 push 到 `main`、PR 和手动触发时构建 AppImage + deb
并上传 artifact；`v*` tag 时由 `release` workflow 的 linux job 把同一批产物附加到
GitHub Release。无需签名或公证。
