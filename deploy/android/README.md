# Ergalics Studio — Android 打包（占位目录）

此目录为 Android 打包的占位，尚未实现。Windows 打包在 `deploy/windows/`（Electron + NSIS），
各平台打包目标统一放在仓库根目录的 `deploy/` 下。

## 现状与可行性结论

项目前端是纯 Web（TypeScript、零服务端），核心计算都在浏览器内核里跑，
理论上可以装进 Android WebView 容器出 APK。三条候选路线：

| 路线 | 前端改动 | 包体 | 备注 |
| --- | --- | --- | --- |
| Tauri 2（倾向） | 几乎为零 | 小（几 MB） | `deploy/windows/src/main/*.ts` 的 IPC 桥需改写为 Tauri command；需 Rust 工具链 + Android SDK |
| Capacitor | 零 | 较大 | 上手最快，WebView 行为依赖设备 |
| PWA / TWA | 加 manifest + SW | — | 最省事，但非完整 APK 体验 |

## 移植时的功能约束（需做能力探测降级）

- DuckDB（SQL 工作台，WASM）：✅ 可跑
- Pyodide（Python 桥）：✅ 可跑，低端机内存吃力
- WebGPU 渲染：⚠️ 仅较新 Chrome/WebView，需回退
- 终端 / PTY（`deploy/windows/src/main/pty-host.ts`）：❌ 移动端没有，需砍掉或降级
- 本地文件读写：⚠️ 走容器桥，不能像桌面端自由访问

## 计划中的目录约定

```
deploy/
├── windows/   # Electron + NSIS Windows 打包（现状）
├── linux/     # Linux 打包（规划：AppImage/deb，见 electron-builder linux target）
└── android/   # Android 打包（本目录，待实现）
```

实现时本目录预期放入：容器工程（Tauri `src-tauri/` 或 Capacitor 工程）、
原生桥（文件访问、分享）、构建脚本与签名配置。
