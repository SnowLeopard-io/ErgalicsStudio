# Ergalics Studio — macOS 打包（占位目录）

此目录为 macOS 打包的占位，尚未实现。Windows 打包在 `deploy/windows/`（Electron + NSIS），
各平台打包目标统一放在仓库根目录的 `deploy/` 下。

## 结论

复用现有 Electron 应用代码即可：给 electron-builder 增加 `mac` target
（`dmg`），产物分 Apple Silicon（arm64）与 Intel（x64）两个包（或 x64 +
Rosetta 通用包，体积翻倍，不推荐）。

## 构建要求

- macOS target **必须在一台 Mac（或 GitHub Actions `macos-latest`）上构建**，
  不能从 Windows/Linux 交叉编译
- CI 是三端里最省配置的：`macos-latest` 直接出 arm64

## 兼容性

- DuckDB（WASM）、Pyodide、全部统计内核：✅ 与桌面/网页完全一致
- WebGPU 渲染：✅ Chromium 走 Metal 后端，Apple Silicon 上性能最好
- node-pty 终端：✅ 原生支持
- simple-git：✅ 系统自带 git
- 便携 Python（`resources/python/`）：⚠️ 目前是 Windows 版 CPython，macOS
  需按 `process.platform` 分发，且区分 arm64 / x86_64（见
  `src/main/python-host.ts`）

## 分发门槛（macOS 特有）

- **不签名**：用户打开被 Gatekeeper 拦截（"无法验证开发者"），需手动在
  系统设置放行——自用/小范围可用，体验差但免费
- **正式分发**：Apple Developer 账号（$99/年）+ codesign + notarize；
  electron-builder 配好 `CSC_LINK` / `APPLE_ID` 等环境变量后自动化

## 计划中的目录约定

```
deploy/
├── windows/   # Electron + NSIS Windows 打包（现状）
├── linux/     # Linux 打包（占位，待实现：AppImage/deb）
├── macos/     # macOS 打包（本目录，待实现：dmg，arm64 + x64）
└── android/   # Android 打包（占位，待实现）
```

实现时本目录预期放入：electron-builder mac 配置、签名/公证脚本（可选）、
平台化的 Python 分发逻辑与 CI workflow。
