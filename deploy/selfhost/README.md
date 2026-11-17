# Ergalics Studio — 自托管（实验室共享部署）

## 定位

不是打包另一份二进制，而是把 Web 版 `dist/` 用静态服务器（或 Docker）
部署在实验室自己的机器/NAS 上，供多人通过浏览器访问。适合：

- 机房统一环境（学生浏览器打开即用，无需各自安装）
- 内网共享数据集（可选：把示例数据放在服务器上由 fetch 加载）
- 离线内网环境（PWA 组合后可整体离线运行）

**运行语义与桌面版一致：零服务端——所有计算都在浏览器里跑，服务器只发
静态文件，不处理任何数据。**

## 实施要点

- Dockerfile：多阶段构建（node 构建 → nginx:alpine 托管 `dist/`）
- nginx 配置：SPA fallback（`try_files ... /index.html`）、
  wasm/大资源 `gzip` 或 `brotli`、长缓存（带 hash 的文件名）
- 可选：`docker-compose.yml`（映射端口 + 数据卷放示例数据集）
- 健康检查与镜像体积目标：< 100 MB（不含 WASM 资产，那些按需从镜像内提供）

## 本目录预期放入

```
selfhost/
├── Dockerfile
├── docker-compose.yml
├── nginx.conf
└── README.md              # 本文件
```

## 注意

- 浏览器端要访问服务器上的数据文件时，跨域与 MIME
  （`.wasm` 需 `application/wasm`）要在 nginx 里显式配置
- 若与 PWA 组合：同源部署即可，无需额外配置
