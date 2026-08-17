# Architecture

## Layers

```mermaid
flowchart TB
    subgraph UI["React UI (src/pages · src/components)"]
        A1["Welcome · Workbench<br/>(TopBar/Sidebar/Central/Right/Status)"]
        A2["Settings · Share ·<br/>Plugin dialogs · Example-data dialogs"]
        A3["Flow mode canvas<br/>Palette · Canvas · Node · Param editor<br/>Toolbar · Result preview"]
        A4["Block mode<br/>Blockly workspace · Toolbar<br/>Preview / Variables / Console cards"]
    end

    subgraph State["State & Core Services"]
        B1["Zustand stores<br/>app / project / plugin / settings / block / editor"]
        B2["Core services<br/>storage (IndexedDB) · events (bus)<br/>i18n · theming · perf<br/>fileFormat · wasm · gpu<br/>scene3d · sandbox"]
    end

    subgraph Blocks["Block system (Flow mode, src/blocks)"]
        D1["Catalog<br/>data_source · transform · filter<br/>math · statistics · visualize"]
        D2["Compiler<br/>pure · validates ports/types<br/>topological sort · diagnostics"]
        D3["Executor<br/>incremental cache<br/>dirty propagation · run()"]
        D4["Render bridge<br/>viz.* RenderedView → plugin.loadData"]
    end

    subgraph Editor["Block mode (src/editor)"]
        E1["IR<br/>shared node union · validate · hash<br/>(also powers Code mode)"]
        E2["Blockly engine + block definitions<br/>workspace JSON ⇄ IR convert"]
        E3["Interpreter<br/>walks IR · calls studio.*"]
        E4["Codegen<br/>IR → JS · IR → Python"]
        E5["StudioApi<br/>load / transform / stats / plot / print<br/>(reuses src/blocks/ops)"]
    end

    subgraph Runtime["Runtime Layer"]
        C1["Plugin runtime<br/>builtin/* (22 core + 10 fun)<br/>marketplace catalog<br/>cspkg loader (sandbox)<br/>registry & lifecycle"]
        C2["Native core (Rust→WASM)<br/>device mgmt · compute<br/>kernel scheduling<br/>file-kind detection"]
    end

    UI --> B1
    UI --> B2
    B1 <--> B2
    B1 --> C1
    B2 --> C1
    B2 --> C2
    A3 --> B1
    B1 --> D2
    B1 --> D3
    D1 --> D2
    D3 --> D4
    D4 --> C1
    A4 --> E2
    E2 --> E1
    E1 --> E3
    E1 --> E4
    E3 --> E5
    E5 --> D4
```

> **One plugin bridge, two callers.** `D4` (Flow's `RenderedView` →
> `plugin.loadData`) and `E5 → D4` (Block mode's `studio.plot` →
> `RenderedView`) collapse onto the same code path. Adding a
> visualisation in Flow mode lights up a `studio.plot(...)` variant in
> Block mode for free. See [Block Mode](block-mode.md) for the editor
> layer in detail, and [Flow Mode](flow-mode.md) for the block system.

## State management

Five Zustand stores hold all application state:

| Store          | Responsibility                                                        |
| -------------- | --------------------------------------------------------------------- |
| `appStore`     | host status, banners, notifications, perf metrics, panel toggles      |
| `projectStore` | current project, recent list, save/autosave, share, param persistence |
| `pluginStore`  | registry, load/activate lifecycle, file dispatch, host containers     |
| `settingsStore`| GPU mode, autosave interval, and other preferences                    |
| `editorStore`  | Block / Code mode sessions (IR, code, variables, console)              |

Cross-cutting UI communication uses a small typed event bus
(`src/core/events.ts`) — e.g. `plugin:<id>:params`, `host:params:changed`,
`host:file:choose-plugin`.

## Rendering pipeline

The central viewport owns three surfaces:

1. **`central-canvas`** — the shared 2D canvas every 2D plugin draws into.
2. **`central-dom-host`** — a DOM container for plugins that need elements
   (also where the sandboxed canvas surfaces are mounted).
3. **Three.js scene** — created lazily by `scene3d.ts` **only** when a
   plugin declares `renderToScene`. The plugin store decides visibility
   centrally on every activation:

   - plugin declares 3D → show the scene, clear any stale 2D frame;
   - anything else → hide the scene immediately.

   This guarantees a 3D coordinate system can never appear over a 2D
   viewport (and vice versa).

## Native core

`native/ergalics-core` (Rust) compiles to `wasm32-unknown-unknown` and is
bound with wasm-bindgen into `src/native/`. It requires the unstable web-sys
WebGPU bindings, enabled via `rustflags = ["--cfg=web_sys_unstable_apis"]`
in `native/.cargo/config.toml`. See [Native Core & WebGPU](native-core) for
the exact API surface and the calling conventions.

## Dependency rules

- `pages → stores → core` — lower layers never import higher ones.
- `core` must stay DOM-light: pure services (i18n, fileFormat, storage
  adapters) are unit-testable in a node environment.
- The plugin contract (`src/types/plugin.ts`) is the only shared vocabulary
  between the host and third-party code.
