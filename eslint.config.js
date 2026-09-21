/**
 * 精简版 ESLint flat config。
 *
 * 定位：只保留 tsc 结构上抓不到的高价值规则，目标是秒级速度。
 * 取舍理由：
 * - 不启用 type-checked 规则（不设 parserOptions.project）：类型感知 lint 太慢，且
 *   tsc --noEmit 已在 lint 脚本中做全量类型检查，双跑得不偿失。
 * - 关闭与 tsc 重复/冲突的规则：no-unused-vars 交给 tsc 的 noUnusedLocals/noUnusedParameters；
 *   no-explicit-any / no-non-null-assertion 是本代码库（动态 import 兼容层、数值计算）的有意模式。
 * - 保留正确性规则：react-hooks 两条、no-empty（允许空 catch）、recommended 其余默认。
 * - 引入 Prettier 与全仓 reformat 均不在本次范围内。
 */
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      'dist/',
      'node_modules/',
      'coverage/',
      'website/',
      'docs/',
      'public/',
      'scripts/', // 一次性 mjs 脚本，不做 lint
      '**/*.min.*',
      'tmp/', // 临时实验产物（py/json/cjs 抓取物），非源码
      // WIP by a parallel session — remove from ignores once it stabilizes
      'src/plugins/builtin/fluid-cfd-coupler/**',
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
      // `const self = this` 是代码库既有的 this 捕获写法（对象字面量方法/构造器捕获实例），
      // 改写成箭头函数有行为风险，降为 warn
      '@typescript-eslint/no-this-alias': 'warn',
      // ESLint v10 新纳入 recommended 的规则，精简版刻意不纳入：
      'preserve-caught-error': 'off', // 要求重抛时附 cause，补齐会改变错误对象结构，违背零行为变更约束
      'no-useless-assignment': 'off', // dead-store 检查，机械移除初始化值可能破坏 tsc 定值分析
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
);
