# Ergalics Studio 插件脚手架（SDK v1）

官方插件起步模板：零宿主依赖、零运行时依赖，只有 TypeScript 做类型检查。
契约的唯一事实来源是宿主的 `src/types/plugin.ts`，本目录的 `sdk.d.ts` 是它的
全局声明副本（宿主契约演进时同步一次即可）。

## 目录结构

```
plugin-starter/
├── manifest.json          # 包清单源文件（构建时复制进 package/）
├── sdk.d.ts               # SDK v1 契约（全局 ambient，勿加 import/export）
├── src/
│   └── index.ts           # 插件入口（编译为「函数体」，见文件头注释）
├── build.mjs              # 构建后处理：组装 package/ 目录
├── tsconfig.json          # 类型检查（noEmit）
├── tsconfig.build.json    # 实际编译（emit 到 dist/）
└── package.json           # 独立包，devDeps 只有 typescript
```

## 四步流程：开发 → 构建 → 签名 → 发布

### 1. 开发

```bash
npm.cmd install          # 只装 typescript
npm.cmd run check        # 类型检查（sdk.d.ts + src/index.ts）
```

改 `src/index.ts` 实现你的逻辑，同步改 `manifest.json`（id、名称、描述等）。
要点（完整约束见 [v1 契约](../../docs/sdk/v1-contract.md)）：

- 入口不是 ESM：不要写 `import` / `export`，构建产物是宿主
  `new Function('api', source)` 执行的函数体，必须以 `return plugin;` 结尾
  （build.mjs 自动追加）。
- `isolated` 沙箱（缺省）里没有 DOM / window / three / gpu；
  `getParam` / `setParam` / `cache.*` 一律 `await`。
- 生命周期只有 `manifest` / `init` / `getParams` 必需，其余按需实现。

### 2. 构建

```bash
npm.cmd run build        # tsc 编译 + build.mjs 组装 package/
```

产出：

```
package/
├── manifest.json
└── dist/index.js
```

### 3. 签名（可选，但发布到市场前建议）

签名 CLI 位于 Ergalics Studio 仓库（Node ≥ 23.6）：

```bash
# 生成密钥对（seed 保密并妥善备份；指纹公开给你的用户）
node <studio仓库>/scripts/sign-cspkg.mjs --genkey my-key.json

# 签名 package/ → 产出 .cspkg（自动把 signature 写回 package/manifest.json）
node <studio仓库>/scripts/sign-cspkg.mjs ./package --key my-key.json --out starter.cspkg --signer "你的名字"

# 校验
node <studio仓库>/scripts/sign-cspkg.mjs --verify starter.cspkg --trust my-key.json
```

未签名的 `.cspkg` 也能安装，但会弹「信任此来源」确认框；篡改包永远被拒绝。

### 4. 发布 / 本地试用

- **本地试用**：在 Ergalics Studio 的插件市场页导入 `.cspkg` 即可安装。
- **发布**：将 `.cspkg` 分发到你的仓库 /  Releases / 市场目录；签名者名称会展示
  在安装确认里。

## 参考文档

- [SDK v1 契约（冻结范围与承诺）](../../docs/sdk/v1-contract.md)
- [v0 → v1 迁移指南](../../docs/sdk/migration.md)
- [插件开发教程](../../docs/guide/plugins.md)
