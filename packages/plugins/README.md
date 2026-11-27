# `@ergalics/plugins`

Official built-in plugin suite for **Ergalics Studio** (~140+ scientific, visualization, engineering, simulation, and utility plugins across 22 discipline directories).

## Architectural Boundary (Extraction-Ready)

This package is intentionally isolated from the workbench host (`apps/studio`) so that it can be extracted into a standalone repository (e.g. `SnowLeopard-io/ergalics-plugins`) with minimal friction:

1. **Zero host imports**: No `@/*` path alias in `tsconfig.json`, enforced statically by ESLint (`no-restricted-imports`) and automated by `tests/architecture/plugin-isolation.test.ts`.
2. **Strict dependency declaration**: Under `pnpm` (`shamefully-hoist=false`), every runtime dependency is explicitly listed in `packages/plugins/package.json`.
3. **IoC Host Bridges**: All host interactions (Figure Studio sheets, Science Output bus, ambient audio ducking, Pyodide boot status) go through `@ergalics/plugin-sdk/bridges`, registered once by the host at startup.
4. **Self-contained assets**: Bundled plugin fixtures live under `src/assets/fixtures/` rather than reaching outside the package directory.

## Future Repository Extraction Checklist

When moving `@ergalics/plugins` out of `ergalics-studio` into its own repository:

1. Publish `@ergalics/plugin-sdk`, `@ergalics/plugin-signing`, and `@ergalics/sci-kernels` (adding a `tsup`/`tsc` build step & `publishConfig.exports` for compiled JS + `.d.ts`).
2. Extract `packages/plugins/` into the new repository (preserving git history via `git filter-repo --subdirectory-filter packages/plugins`).
3. Replace `"workspace:*"` versions in `package.json` with semver ranges for `@ergalics/plugin-sdk`, `@ergalics/plugin-signing`, and `@ergalics/sci-kernels`.
4. In `ergalics-studio`, either:
   - consume `@ergalics/plugins` as a versioned npm dependency in `apps/studio/package.json`, OR
   - build each discipline/plugin as signed `.cspkg` bundles served from a registry and swap `apps/studio/src/core/plugin-host/pack-registry.ts` to load them dynamically.
