---
layout: home

hero:
  name: Ergalics Studio
  text: A browser-based scientific computing workstation
  tagline: Interactive data exploration, GPU compute scheduling, and a sandboxed plugin system — with a Rust/WASM core.
  actions:
    - theme: brand
      text: Get Started
      link: /guide/getting-started
    - theme: alt
      text: Read the Guide
      link: /guide/introduction
    - theme: alt
      text: GitHub
      link: https://github.com/SnowLeopard-io/ErgalicsStudio

features:
  - icon: { svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="3" width="8" height="8" rx="1.5"/><rect x="3" y="13" width="8" height="8" rx="1.5"/><rect x="13" y="13" width="8" height="8" rx="1.5"/></svg>' }
    title: Workbench
    details: "Four-region layout — projects, plugins, viewport, parameters — with drag-and-drop file routing and IndexedDB project storage."
  - icon: { svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="5" cy="6" r="2.2"/><circle cx="19" cy="6" r="2.2"/><circle cx="12" cy="18" r="2.2"/><path d="M7.2 6H16.8M6 8.2 10.9 16M18 8.2 13.1 16"/></svg>' }
    title: Flow mode
    details: "A second workbench mode next to Standard — compose a visual dataflow DAG from the full block catalog (40+ block types) under a shared IR, with an incremental executor and a live result preview."
  - icon: { svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11V6.8a1.8 1.8 0 0 1 1.8-1.8H12"/><path d="M15 11v4.2a1.8 1.8 0 0 1-1.8 1.8H12"/><rect x="5" y="9" width="14" height="6" rx="1.8"/><path d="M12 3v6"/></svg>' }
    title: Block mode
    details: "A third mode — a Scratch-style block editor with a single Run hat, 40+ built-in blocks, shared IR, an interpreter and JS/Python codegen, and 5 sample programs."
  - icon: { svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 3h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-3l-4 4v-4H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"/><path d="M9 9h6M9 12h4"/></svg>' }
    title: Sandboxed plugins
    details: "A .cspkg package format with manifest validation, and real isolation — third-party code runs in a Web Worker behind an RPC bridge."
  - icon: { svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 5 6v6c0 4.5 3 7.5 7 9 4-1.5 7-4.5 7-9V6l-7-3Z"/><path d="M9.5 12l1.8 1.8 3.4-3.6"/></svg>' }
    title: Stable plugin SDK v1
    details: "A frozen, documented API contract with a compatibility policy, ed25519 package signing, and a zero-dependency starter template."
  - icon: { svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2 3 7v10l9 5 9-5V7l-9-5Z"/><path d="M12 12l9-5M12 12v10M12 12 3 7"/></svg>' }
    title: 2D + 3D rendering
    details: "Shared 2D canvas plus a host-managed Three.js scene that is created lazily and never bleeds into 2D viewports."
  - icon: { svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="7" y="7" width="10" height="10" rx="1.5"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/></svg>' }
    title: WebGPU compute
    details: "A Rust core compiles WGSL kernels with real bind-group layouts, dispatches workgroups, and reports shader diagnostics."
  - icon: { svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3h6l1 4-3.5 3.5L9 7z"/><path d="M10 8.5V5"/><path d="M5.5 21 10 15.5l2-3.4 2 3.4L18.5 21z"/></svg>' }
    title: Testable by design
    details: "2233 unit tests (Vitest) across 123 files plus Playwright E2E suites, all wired into npm scripts and kept green on every change."
  - icon: { svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.8 3.8 9S14.5 18.4 12 21M12 3c-2.5 2.6-3.8 5.8-3.8 9S9.5 18.4 12 21"/></svg>' }
    title: i18n & theming
    details: "Chinese/English localization with reactive switching (and Blockly BKY_* keys for Block mode), and dark/light themes driven by CSS variables."
  - icon: { svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 15l3-3 2 2 4-5"/><path d="M12 3v18"/></svg>' }
    title: Research toolset
    details: "19 standalone research tools (测量、建模、数据、信号、交付), Figure Studio publication plots, reproducibility lockfiles, and a teacher/student course mode."
  - icon: { svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>' }
    title: Scientific solvers
    details: "A sparse Hermitian eigensolver (Lanczos / LOBPCG / Jacobi-Davidson) and a 1D–3D bidirectional fluid-network coupler — both GPU/WASM-backed with Pyodide worker runtimes."
---