# Ergalics Studio — Linux 打包（占位目录）

此目录为 Linux 打包的占位，尚未实现。Windows 打包在 `deploy/windows/`（Electron + NSIS），
各平台打包目标统一放在仓库根目录的 `deploy/` 下。

## 结论

复用现有 Electron 应用代码即可，不需要换框架：给
`deploy/windows/electron-builder.yml` 增加 `linux` target（或复制一份
`linux/electron-builder.yml`），产物为 AppImage + deb（可选 rpm）。

| 产物 | 适用 | 备注 |
| --- | --- | --- |
| AppImage | 通用，免安装双击即跑 | 首选，不依赖发行版 |
| deb | Ubuntu / Debian 系 | 走 apt 依赖 |
| rpm | Fedora / openSUSE | 可选 |

## 构建要求

- Linux target **必须在 Linux（或 CI）上构建**，Windows 无法交叉编译
- 建议加一条 GitHub Actions workflow（`ubuntu-latest`）跑
  `scripts/windows-build.mjs` 的 Linux 分支（脚本目前第 5 步"拷贝 exe 到
  用户桌面"是 Windows 专属，需按平台跳过）

## 兼容性

- DuckDB（WASM）、Pyodide、全部统计内核：✅ 与桌面/网页完全一致
- WebGPU 渲染：✅ Chromium 原生支持（X11 / Wayland）
- node-pty 终端：✅ Linux 上反而最省事（无预编译二进制匹配问题）
- simple-git：✅ 需系统装有 git
- 便携 Python（`resources/python/`）：⚠️ 目前打进安装包的是 Windows 版
  CPython，Linux 版需按 `process.platform` 单独下载分发（见
  `src/main/python-host.ts`）

## 已知坑：chrome-sandbox

很多发行版上 AppImage 直接跑会报
`The SUID sandbox helper binary was found, but is not configured correctly`。
解法二选一：

1. 启动参数加 `--no-sandbox`（省事，安全性略降）
2. 文档给用户命令：`sudo sysctl -w kernel.unprivileged_userns_clone=1`
   （Ubuntu/Debian），或在 deb 包里正确设置 `chrome-sandbox` 权限

## 计划中的目录约定

```
deploy/
├── windows/   # Electron + NSIS Windows 打包（现状）
├── linux/     # Linux 打包（本目录，待实现：electron-builder 配置 + CI workflow）
└── android/   # Android 打包（占位，待实现）
```

实现时本目录预期放入：electron-builder Linux 配置（或共享 windows 版加
target）、AppImage/deb 的额外资源、CI workflow 与平台化的 Python 分发逻辑。
