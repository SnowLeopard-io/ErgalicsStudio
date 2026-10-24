# =============================================================================
# CFD 双向耦合求解器 — CLI 复现容器
#
# 用途：在容器内逐字节复现赛题"核心算例 + 权衡曲线 + 最小可行交换周期"，
# 与浏览器插件共用同一份 fluid_cfd 纯 NumPy 内核（driver.py）。
# 运行方式见 docker-compose.yml 的 cfd-verify 服务 / 部署手册 §3.2。
# =============================================================================

FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /fluid

COPY src/plugins/builtin/fluid-cfd-coupler/python/requirements.txt .
RUN pip install --no-cache-dir --progress-bar off -r requirements.txt

COPY src/plugins/builtin/fluid-cfd-coupler/python/ .

# 默认执行完整验证套件；可用 docker compose run cfd-verify <入口> 覆盖
CMD ["python", "run_tests.py"]