# Technical Documentation

This section is the engineering reference for Ergalics Studio. Each chapter is maintained as a standalone page; the collected *Ergalics Studio* compendium is assembled from them by `scripts/build-tech-summary.mjs` and should not be edited by hand.

| Chapter | Scope |
| --- | --- |
| [01 · Product Introduction](./01-product-introduction) | Positioning, innovation, feature map, application scenarios and open-source governance |
| [02 · System Architecture](./02-system-architecture) | Layering, routing, startup sequence, state, rendering pipeline and directory rules |
| [03 · Plugin System](./03-plugin-system) | Plugin contract, lifecycle, packaging and sandbox; registry overview with screenshots |
| [04 · Four Working Modes](./04-four-working-modes) | Standard, Flow, Block and Code, and lossless conversion through one IR |
| [05 · Research Toolset](./05-research-toolset) | 33 tools in seven groups, their responsibilities and entry points |
| [06 · GPU Computing and Native Core](./06-gpu-computing-and-native-core) | WebGPU / CPU fallback, compute pipeline and the 14 WGSL kernels |
| [07 · Scientific Computing Subsystems](./07-scientific-computing-subsystems) | The 54 `src/core` subsystems and 42 root modules |
| [08 · Testing and Quality Assurance](./08-testing-and-quality-assurance) | Unit and E2E tests, benchmarks, size budgets and CI |
| [09 · Electromagnetic Resonance Eigensolver](./09-electromagnetic-resonance-eigensolver) | Sparse Hermitian eigensolvers, shift-invert MINRES and 3D mode fields |
| [10 · Fluid Bidirectional Coupling Solver](./10-fluid-bidirectional-coupling-solver) | 1D network ↔ 3D field coupling with multirate stepping |
| [11 · Application Scenario Library](./11-application-scenario-library) | 81 scenarios mapped to real plugins and tools |
| [12 · Plugin Catalog](./12-plugin-catalog) | Generated per-plugin table for all 165 built-in plugins |
| [Ergalics Studio](./ergalics-studio) | Collected compendium assembled from chapters 01–11 |

Supporting material:

- [Ambience experience system design](../ambience-experience-design) — sound, motion and incentive design rules.
- [Container deployment manual](./10-fluid-bidirectional-coupling-solver-container-deployment) — Docker orchestration and CLI reproduction.
