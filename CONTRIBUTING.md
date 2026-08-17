# Contributing to Ergalics Studio

Thanks for your interest in contributing. Ergalics Studio is a
browser-based scientific-computing workstation: a React + TypeScript
frontend, a Rust core compiled to WebAssembly, a WebGPU compute pipeline, and
a plugin architecture for third-party extensions.

This guide covers how to build the project, run the checks, and get a change
reviewed and merged.

---

## Table of Contents

- [Development setup](#development-setup)
- [Available scripts](#available-scripts)
- [Project layout](#project-layout)
- [Workflow](#workflow)
- [Commit conventions](#commit-conventions)
- [Code style](#code-style)
- [Testing](#testing)
- [Adding a plugin](#adding-a-plugin)
- [Adding sample data](#adding-sample-data)
- [Documentation](#documentation)
- [Pull request checklist](#pull-request-checklist)

---

## Development setup

### Prerequisites

- Node.js 22 or newer (the CI runs Node 22)
- npm 10 or newer
- A Chromium-based browser for the E2E suites (Playwright drives the locally
  installed Microsoft Edge)

### Install

```sh
npm install
```

### Native core (Rust to WebAssembly)

The GPU compute path ships a Rust core compiled to WebAssembly. The generated
bindings (`src/native/*.js`, `src/native/*.wasm`) are git-untracked build
artifacts — after a clean clone you must build them before the first
`npm run dev` / `npm run build`:

```sh
npm run build:wasm
```

The build requires a Rust toolchain with the `wasm32-unknown-unknown` target.
If Rust is unavailable, `npm run build:web` uses a stub module instead (the
raw WebGPU backend still works; see `scripts/make-wasm-stub.mjs`).

### Run in development

```sh
npm run dev
```

Open the printed URL (default `http://localhost:5173`).

### Docs site (VitePress)

```sh
npm run docs:dev
```

---

## Available scripts

| Script                | What it does                                                         |
| --------------------- | -------------------------------------------------------------------- |
| `npm run dev`         | Start the Vite dev server                                            |
| `npm run build`       | Full build: WASM bindings + typecheck + Vite + docs                  |
| `npm run build:web`   | Web-only build (typecheck + Vite + docs, no Rust step)               |
| `npm run build:wasm`  | Regenerate the Rust/WASM bindings                                    |
| `npm run typecheck`   | `tsc --noEmit` (strict mode)                                         |
| `npm run test`        | Unit tests (Vitest)                                                  |
| `npm run test:e2e`    | All E2E suites (Playwright + Edge)                                   |
| `npm run verify`      | `typecheck` + unit tests — the minimum bar before opening a PR       |

---

## Project layout

```
src/
├── core/                 # host services: GPU compute, wasm loader, sandbox,
│                         #   viewports, events, data files, examples
├── plugins/
│   ├── builtin/          # built-in plugins (core auto-loaded + fun/utility)
│   ├── marketplace.ts    # marketplace catalog (tags / popularity / filters)
│   └── ...               # third-party .cspkg loading
├── blocks/               # Flow mode: registry / compiler / executor / catalog
├── editor/               # Block + Code modes: shared IR, Blockly, codegen, runtime
├── components/           # React components (param panel, dialogs, editors)
├── pages/                # welcome, workbench, settings, share, plugin pages
├── stores/               # Zustand stores
├── types/                # plugin & project & editor contracts
├── native/               # generated WASM bindings (git-untracked)
examples/
├── data/                 # sample datasets (served to the sample dialog)
├── projects/             # sample Flow pipelines (.clproj)
└── code/                 # sample Python programs
docs/                     # VitePress site (guide/*.md)
scripts/                  # build, data generation, and E2E verification
tests/                    # unit tests (Vitest)
```

---

## Workflow

1. Check the open issues and the task list in `docs/guide/prd.md` before
   starting; comment on an issue if you plan to work on it.
2. Fork the repository and create a branch from `main`:
   ```sh
   git checkout -b feat/my-change
   ```
3. Make your changes, keeping them small and focused. One logical change per
   branch.
4. Run the local checks (see [Testing](#testing)).
5. Push the branch and open a pull request against `main`. Fill in the PR
   template, including the test evidence and screenshots.

---

## Commit conventions

Use [Conventional Commits](https://www.conventionalcommits.org/):

- `feat(scope): ...` — a new capability (plugin, block, mode, API)
- `fix(scope): ...` — a bug fix
- `chore(scope): ...` — tooling, dependencies, CI
- `docs(scope): ...` — documentation only
- `refactor(scope): ...` — behavior-preserving restructuring
- `test(scope): ...` — tests only

Examples:

```
feat(ai-training): train MNIST CNN with live loss curve
fix(compute): pass GPUBufferBinding object to createBindGroup
docs(plugins): document the AI Trainer plugin
```

Keep the subject under ~72 characters, in the imperative mood, without a
trailing period.

---

## Code style

- TypeScript, strict mode enabled (`strict`, `noUnusedLocals`,
  `noUnusedParameters`, `noUncheckedIndexedAccess`). The codebase type-checks
  cleanly with `tsc --noEmit`; keep it that way.
- All user-facing strings, comments, and docs are written in English; the UI
  is localized through `src/i18n/` (zh-CN / en-US) and block/plugin metadata
  through `nameI18n` / `descriptionI18n`.
- Prefer small, pure, testable modules. Side effects (events, stores) are
  injected or isolated at the edges.
- 2-space indentation, single quotes, no semicolons — match the surrounding
  code.

---

## Testing

### Unit tests (Vitest)

```sh
npm run test
```

Unit tests live in `tests/` and run in a Node environment. Keep tests
self-contained; for module-level state use `vi.resetModules()` + `vi.doMock`
+ a dynamic `import`.

### E2E suites (Playwright + Edge)

```sh
npm run test:e2e
```

The E2E suites in `scripts/verify-*.mjs` drive a real browser against a
`vite preview` build. They cover the core loop: welcome page, plugin
activation, sample loading, GPU compute, Block/Code modes, and the AI
Training plugin.

**When you add a feature, add (or extend) a `verify-*.mjs` script** and wire
it into the `test:e2e` script in `package.json`.

### CI

The CI workflow (`.github/workflows/ci.yml`) runs, on every push and pull
request:

1. `npm ci`
2. `npm run typecheck`
3. `npm test`
4. Stub native module (no Rust toolchain in CI)
5. `npm run build:web`

A pull request must be green on all of these.

---

## Adding a plugin

Built-in plugins live in `src/plugins/builtin/`. The plugin contract
(`getParams`, `loadData`, `compute`, `render`, `updateParams`) is documented
in depth in [`docs/guide/plugins.md`](docs/guide/plugins.md).

The minimal checklist for a new built-in plugin:

1. Create a module in `src/plugins/builtin/<name>/` exporting a manifest and a
   factory function.
2. Register it in `src/plugins/builtin/index.ts` (declare `autoload: false`
   unless startup cost is negligible).
3. Add its marketplace metadata in `src/plugins/marketplace.ts`.
4. Ship a sample dataset (see below) so the 示例 dialog can load it with one
   click.
5. Add an E2E script (`scripts/verify-*.mjs`) and include it in `test:e2e`.
6. Update `README.md` and `docs/guide/plugins.md`.

---

## Adding sample data

All built-in sample data lives under `examples/data/` and is bundled at build
time. Two rules matter:

- Keep per-plugin sample files in a **subdirectory** of `examples/data/`
  (e.g. `examples/data/ai/`). The registry glob in `src/core/dataFiles.ts`
  is non-recursive; a CSV dropped directly into `examples/data/` gets eagerly
  bundled into the main app and bloats the startup payload.
- Register the sample in `src/core/examples.ts` (`BUILTIN_EXAMPLES`). For
  large files, provide a lazy `loadContent` via `import.meta.glob` instead of
  an eager `?raw` import so it stays out of the main bundle.

Sample data should be generated deterministically by a script under
`scripts/` (seeded PRNG) and committed, so learners can inspect the files
directly and every build is reproducible.

---

## Documentation

- The user guide lives in `docs/guide/` (VitePress) and is served at
  `https://snowleopard-io.github.io/ErgalicsStudio/docs/`.
- `README.md` is the landing page: four workbench modes, the plugin list
  (updated when plugins are added), and architecture highlights.
- When you change behavior, update the relevant doc and, if the plugin count
  or capabilities change, the counts in `README.md` and
  `docs/guide/plugins.md`.
- Screenshots in `docs/` are organized by section (mode / plugin), not in one
  combined gallery.

---

## Pull request checklist

Before opening a pull request, confirm:

- [ ] `npm run verify` passes (typecheck + unit tests)
- [ ] New behavior has unit and/or E2E coverage, and E2E scripts are wired
      into `test:e2e`
- [ ] `npm run build:web` succeeds
- [ ] Screenshots, where visual, are attached and grouped under the affected
      mode / plugin section
- [ ] `README.md` / `docs/guide/*` are updated if the change affects them
- [ ] No unrelated changes are included
