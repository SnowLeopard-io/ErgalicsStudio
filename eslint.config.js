/**
 * 精简版 ESLint flat config（Monorepo 全仓 + 依赖边界约束）。
 *
 * 定位：只保留 tsc 结构上抓不到的高价值规则与 Monorepo 包边界约束，目标是秒级速度。
 */
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      'dist/',
      '.turbo/',
      'apps/*/dist/',
      'apps/docs/.vitepress/dist/',
      'apps/docs/.vitepress/cache/',
      // VitePress builds in place at the repo root; its generated chunks are
      // not source and must not be linted after a local docs build.
      'docs/.vitepress/dist/',
      'docs/.vitepress/cache/',
      'packages/*/dist/',
      'node_modules/',
      'coverage/',
      'apps/website/',
      'apps/docs/',
      'website/', // stale pre-monorepo build output, kept only locally
      'apps/studio/public/',
      'public/',
      'scripts/', // 一次性 mjs 脚本，不做 lint
      '**/*.min.*',
      'tmp/', // 临时实验产物（py/json/cjs 抓取物），非源码
      'industrial-capability-benchmark/', // 生成的工业能力对标报告（gitignored 产物）
      'pages-out/', // 合并部署产物
      'deploy/*/node_modules/',
      'deploy/*/app-dist/',
      'deploy/*/dist-electron/',
      'deploy/*/release/',
      'deploy/windows/resources/python/',
      'deploy/android/android/',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': reactHooks,
    },
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.es2022,
      },
    },
    rules: {
      // React Hooks 正确性是 tsc 抓不到的高价值规则
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      // 动态 import 兼容层大量使用 as any，属有意为之
      '@typescript-eslint/no-explicit-any': 'off',
      // tsc 的 noUnusedLocals/noUnusedParameters 已覆盖且更严格，避免双报
      '@typescript-eslint/no-unused-vars': 'off',
      // 代码库惯例：catch {} 空块配合注释跳过是允许的
      'no-empty': ['error', { allowEmptyCatch: true }],
      // 代码库大量使用非空断言 `!`（测试里更多），属既定风格
      '@typescript-eslint/no-non-null-assertion': 'off',
      // `const self = this` 是代码库既有的 this 捕获写法，降为 warn
      '@typescript-eslint/no-this-alias': 'warn',
      // ESLint v10 新纳入 recommended 的规则，精简版刻意不纳入：
      'preserve-caught-error': 'off',
      'no-useless-assignment': 'off',
    },
  },
  {
    // Monorepo 边界约束：packages/* 严禁反向引用 apps/* 或宿主 @/* 别名，
    // 为未来将 packages/plugins 拆离独立仓库提供静态保障。
    files: ['packages/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/*', '@/**'],
              message: 'packages/* 禁止使用宿主路径别名 @/*，请通过 @ergalics/* 工作区包导入。',
            },
            {
              group: ['**/apps/**', '@ergalics/studio', '@ergalics/website', '@ergalics/docs'],
              message: 'packages/* 禁止反向依赖 apps/*。',
            },
          ],
        },
      ],
    },
  },
  {
    // 声明文件里的空 interface（如 webgpu.d.ts 的 GPU 句柄类型）是 ambient 类型契约的惯用写法
    files: ['**/*.d.ts'],
    rules: {
      '@typescript-eslint/no-empty-object-type': 'off',
    },
  },
  {
    // 根目录下的独立 JS 配置/工具文件
    files: ['**/*.{js,mjs,cjs}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.node,
        ...globals.browser,
      },
    },
  },
  {
    // CommonJS 文件（Electron builder 钩子等）只能通过 require 加载依赖
    files: ['**/*.cjs'],
    languageOptions: {
      sourceType: 'commonjs',
    },
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
);
