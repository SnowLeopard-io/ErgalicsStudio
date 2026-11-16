---
layout: home

hero:
  name: Ergalics Studio
  text: 基于浏览器的科学计算工作站
  tagline: 交互式数据探索、GPU 计算调度与沙箱化插件系统，由 Rust/WASM 核心支持。
  actions:
    - theme: brand
      text: 快速开始
      link: /zh-CN/guide/getting-started
    - theme: alt
      text: 阅读指南
      link: /zh-CN/guide/introduction
    - theme: alt
      text: GitHub
      link: https://github.com/SnowLeopard-io/ErgalicsStudio

features:
  - icon: { svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="3" width="8" height="8" rx="1.5"/><rect x="3" y="13" width="8" height="8" rx="1.5"/><rect x="13" y="13" width="8" height="8" rx="1.5"/></svg>' }
    title: 工作台
    details: "顶栏、活动栏、多视图侧边栏（文件 / Git / 插件）、标签式中央区域和参数面板，并提供文件浏览器、逐文件编辑器及拖放文件路由。"
  - icon: { svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="5" cy="6" r="2.2"/><circle cx="19" cy="6" r="2.2"/><circle cx="12" cy="18" r="2.2"/><path d="M7.2 6H16.8M6 8.2 10.9 16M18 8.2 13.1 16"/></svg>' }
    title: 流程模式
    details: "与标准模式并列的第二种工作台模式——基于共享 IR，使用完整区块目录（八个类别共 63 种区块）组合可视化数据流 DAG，并提供增量执行器和实时结果预览。"
  - icon: { svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11V6.8a1.8 1.8 0 0 1 1.8-1.8H12"/><path d="M15 11v4.2a1.8 1.8 0 0 1-1.8 1.8H12"/><rect x="5" y="9" width="14" height="6" rx="1.8"/><path d="M12 3v6"/></svg>' }
    title: 积木模式
    details: "第三种模式——Scratch 风格的积木编辑器，包含一个“运行”帽子积木、40 个内置积木、共享 IR、解释器、JS/Python 代码生成以及 5 个示例程序。"
  - icon: { svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 3h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-3l-4 4v-4H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"/><path d="M9 9h6M9 12h4"/></svg>' }
    title: 沙箱化插件
    details: "19 个学科共 165 个内置插件，以及提供清单校验与真正隔离的 .cspkg 包格式——第三方代码通过 RPC 桥接在 Web Worker 中运行。"
  - icon: { svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 5 6v6c0 4.5 3 7.5 7 9 4-1.5 7-4.5 7-9V6l-7-3Z"/><path d="M9.5 12l1.8 1.8 3.4-3.6"/></svg>' }
    title: 稳定版插件 SDK v1
    details: "已冻结并形成文档的 API 契约，配有兼容性策略、ed25519 包签名和零依赖入门模板。"
  - icon: { svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2 3 7v10l9 5 9-5V7l-9-5Z"/><path d="M12 12l9-5M12 12v10M12 12 3 7"/></svg>' }
    title: 2D + 3D 渲染
    details: "共享 2D 画布以及由宿主管理的 Three.js 场景；该场景按需创建，不会影响 2D 视口。"
  - icon: { svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="7" y="7" width="10" height="10" rx="1.5"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/></svg>' }
    title: WebGPU 计算
    details: "Rust 核心使用实际的绑定组布局编译 WGSL 内核、调度工作组并报告着色器诊断信息。"
  - icon: { svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3h6l1 4-3.5 3.5L9 7z"/><path d="M10 8.5V5"/><path d="M5.5 21 10 15.5l2-3.4 2 3.4L18.5 21z"/></svg>' }
    title: 为测试而设计
    details: "263 个测试文件中的 4078 个单元测试（Vitest；4076 通过、2 个跳过），以及 Playwright 端到端测试套件，均已接入 npm 脚本和 CI。"
  - icon: { svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.8 3.8 9S14.5 18.4 12 21M12 3c-2.5 2.6-3.8 5.8-3.8 9S9.5 18.4 12 21"/></svg>' }
    title: 国际化与主题
    details: "支持响应式中英文切换（积木模式使用 Blockly BKY_* 键），以及由 CSS 变量驱动的深色/浅色主题。"
  - icon: { svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 15l3-3 2 2 4-5"/><path d="M12 3v18"/></svg>' }
    title: 科研工具集
    details: "七个分组（测量、建模、数据、信号、交付、出版、实用工具）共 33 个独立科研工具，可作为工作台标签页嵌入；提供 Figure Studio 出版绘图和可复现性锁文件。"
  - icon: { svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>' }
    title: 科学求解器
    details: "稀疏厄密特征值求解器（Lanczos / LOBPCG / Jacobi-Davidson）和 1D–3D 双向流体网络耦合器——两者均由 GPU/WASM 支持，并使用 Pyodide Worker 运行时。"
---