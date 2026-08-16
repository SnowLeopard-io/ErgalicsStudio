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
  - icon: 🖥️
    title: Workbench
    details: "Four-region layout — projects, plugins, viewport, parameters — with drag-and-drop file routing and IndexedDB project storage."
  - icon: 🔀
    title: Flow mode
    details: "A second workbench mode next to Standard — compose a visual dataflow pipeline from 24+ built-in blocks, with an incremental executor and a live result preview."
  - icon: 🧩
    title: Sandboxed plugins
    details: "A .cspkg package format with manifest validation, and real isolation — third-party code runs in a Web Worker behind an RPC bridge."
  - icon: 🎲
    title: 2D + 3D rendering
    details: "Shared 2D canvas plus a host-managed Three.js scene that is created lazily and never bleeds into 2D viewports."
  - icon: ⚡
    title: WebGPU compute
    details: "A Rust core compiles WGSL kernels with real bind-group layouts, dispatches workgroups, and reports shader diagnostics."
  - icon: 🧪
    title: Testable by design
    details: "126 unit tests (Vitest) and five Playwright E2E suites, all wired into npm scripts and kept green on every change."
  - icon: 🌍
    title: i18n & theming
    details: "Chinese/English localization with reactive switching, and dark/light themes driven by CSS variables."
---
