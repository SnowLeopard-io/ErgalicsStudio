# Ergalics Studio — PWA（渐进 Web 应用）

## 定位

性价比最高的一端：项目本来就是纯 Web、零服务端（`npm run build:web` 产出
`dist/`），加 manifest + service worker 后浏览器即可"安装"到
Windows / macOS / Linux / ChromeOS / Android / iPadOS 全平台的桌面与主屏，
一份配置全平台受益。**建议排在所有原生打包之前实施。**

## 实施要点

- Vite 插件：`vite-plugin-pwa`（`npm i -D vite-plugin-pwa`，vite.config 增加配置）
- manifest：名称、图标（复用 `deploy/windows/build/icon.png` 512px 源）、
  `display: standalone`、主题色（跟随现有 CSS 变量的暗色基调）
- service worker 策略：
  - `precache`：index.html + 全部构建产物（应用壳离线可用）
  - 懒加载的插件/大资源（wasm、python 包）用 `RuntimeCaching` 按需缓存
- 数据不出本机：项目本身零服务端，PWA 化后依旧零服务端（SW 只是缓存层）

## 本目录预期放入

```
pwa/
├── manifest.webmanifest   # 或由 vite-plugin-pwa 生成，此处放源配置
├── sw-custom.ts           # 自定义 runtime caching 规则（如有）
└── README.md              # 本文件：实施清单
```

## 注意

- 离线缓存对大文件（Pyodide、DuckDB WASM ≈ 数十 MB）要设容量上限与版本
  失效策略，避免无限膨胀
- `File System Access API`（上传/保存本地文件）在已安装的 PWA 里与浏览器
  版行为一致，Safari iOS 有部分限制，属已知边界
