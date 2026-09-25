# =============================================================================
# Ergalics Studio — 容器化部署（双向耦合求解器可运行原型）
#
# 采用 Vite dev server 作为运行入口：CFD 插件（fluid-cfd-coupler）是纯 Python
# + Pyodide，全部在浏览器端执行，无需服务器端 Rust/WASM 工具链，因此该镜像
# 构建快、体积可控，且能跑通完整工作台与双向耦合演示。
#
# 若需要"生产静态"形态（预构建产物 + nginx），见容器化部署手册 §3.3。
# =============================================================================

FROM node:20-alpine

WORKDIR /app

# 先装依赖，利用层缓存
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# 复制项目源码（排除项见 .dockerignore）
COPY . .

# 容器内以 Vite dev server 形式托管完整工作台
EXPOSE 5173

ENV HOST=0.0.0.0 \
    PORT=5173

CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0", "--port", "5173"]