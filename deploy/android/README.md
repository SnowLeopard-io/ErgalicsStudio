# Ergalics Studio — Android 打包

本目录是 Android 端完整打包工程（不再是占位）。方案为 **Capacitor 8 + Android WebView**：
把仓库根目录 `dist/` 里的同一份 Web 渲染层装进原生壳，出可安装的 APK。

## 为什么是 Capacitor

项目前端是纯 Web（TypeScript、零服务端），`src/core/platform/index.ts` 已经把桌面桥接
隔离成可选的 `window.ergalicsDesktop`；不注入这个桥接时，应用自动走 Web 路径
（Pyodide/WASM、浏览器存储）。因此 Android 端不需要复刻 Electron 的 fs/git/python/pty IPC。

| 路线 | 本项目的代价 |
| --- | --- |
| **Capacitor（采用）** | 前端零改动；只需 Node + JDK 21 + Android SDK；构建链与 PWA/自托管同源 |
| Tauri 2 | 需 Rust + Android NDK；Rust 侧能力在本项目里没有对应消费者，纯属额外负担 |
| PWA / TWA | 不出完整 APK，且无法处理导出文件到 Downloads |

## 目录结构

```
deploy/android/
├── package.json              # 独立依赖（Capacitor core/cli/android）
├── capacitor.config.ts       # appId、webDir=app-dist、WebView 行为
├── android/                  # Capacitor 生成的原生 Gradle 工程（入库）
│   ├── app/src/main/java/io/snowleopard/ergalics/mobile/MainActivity.java
│   │                         # WebView 宿主 + blob 导出落 Downloads 的桥接
│   ├── app/src/main/res/     # 应用名、主题、各密度启动图标（来自 icon.png）
│   └── ...                   # gradle wrapper / manifest / 生成配置
├── app-dist/                 # 构建时暂存的 Web 产物（不入库）
└── release/                  # APK 输出（不入库）
```

## 前置条件

- Node.js 22、npm 10
- JDK 21（`capacitor.build.gradle` 指定 Java 21 兼容级别）
- Android SDK Platform 36 + Build Tools（`ANDROID_HOME` 或 `ANDROID_SDK_ROOT`）
- 仅在本机打包时：进入本目录执行一次 `npm install`

## 打包

在仓库根目录执行：

```powershell
npm run build:android              # debug APK（未签名，可直接安装）
npm run build:android:release      # release APK（未签名）
```

脚本 `scripts/android-build.mjs` 依次完成：

1. 同步根目录 `package.json` 的版本号到 `deploy/android/package.json` 与 Gradle
   （`versionName` = 语义版本，`versionCode` = `major*10000 + minor*100 + patch`）
2. `npm run build:web` —— 与 Web 版完全相同的渲染层构建
3. 把 `dist/` 拷贝到 `app-dist/`
4. `npm run cap:sync` —— 把 Web 资源与配置写入原生工程
5. `gradlew assembleDebug`（或 `assembleRelease`）
6. APK 拷到 `deploy/android/release/Ergalics-Studio-<version>-debug.apk`，
   Windows 上同时拷一份到桌面

常用可选项：

```powershell
node scripts/android-build.mjs --from-dist     # 复用已有 dist/，跳过 Web 构建
node scripts/android-build.mjs --no-gradle     # 只做暂存 + cap sync
node scripts/android-build.mjs --dry-run       # 只打印计划
```

本地开发调试可先 `npm run dev`，再用 Capacitor 的 `server.url` 指向 dev server
（不要把这种配置提交到仓库）。

`capacitor-cordova-android-plugins/` 与 `app/src/main/assets/public/` 由 `cap sync`
生成、不入库；所以直接在 Android Studio 里打开 `android/` 前，先跑一次
`npm run build:android -- --no-gradle`（或 `npm run cap:sync --prefix deploy/android`）。

## 功能边界（Web 路径，非 Electron）

| 能力 | Android 表现 |
| --- | --- |
| DuckDB / Pyodide / 统计 WASM | 可运行；低端机注意内存，建议缩小数据集 |
| WebGPU 渲染 | 取决于 WebView 版本，老设备需回退到 Canvas |
| 终端 / PTY | 不提供（移动端没有 shell） |
| 便携 CPython | 不提供，使用 Pyodide |
| 本地文件打开 | WebView 文件选择器走 Capacitor 默认处理 |
| 文件导出 | `MainActivity` 捕获 blob 下载并写入公共 Downloads 目录 |
| Git / 工程同步 | 走 Web 版浏览器实现，不依赖 Electron git 桥 |

## 签名与分发

当前交付的是**未签名 APK**，适合开发验证和 CI artifact。正式分发需要你自己准备
keystore（不要提交进仓库），然后在 `android/app/build.gradle` 的 `android {}` 内加入
`signingConfigs`，并在 `buildTypes.release` 中引用；CI 可通过 repository secrets
注入 keystore base64 与密码后启用签名。Google Play 上架还需对应签名密钥的保管策略。

## GitHub Actions

`.github/workflows/android.yml` 在 push 到 `main`、PR 和手动触发时构建 debug APK并上传
artifact；打 `v*` tag 时 APK 会附加到同一次 GitHub Release（未签名）。详见该文件注释。
