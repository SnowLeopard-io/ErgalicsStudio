# Security Policy

Ergalics Studio runs entirely in the browser. Third-party plugin code is
isolated in a Web Worker by default; the security model is described in
`docs/guide/plugins.md`. We take security reports seriously and respond as
quickly as we can.

## Trust boundary (read this before assuming "sandbox = secure")

- **Worker-first isolation (§6.2)**: `sandbox: "isolated"` plugins run in a
  Web Worker with a typed postMessage RPC bridge — no host globals, DOM, or
  store access. This is an *isolation* mechanism, **not a hardened security
  sandbox**: it was not designed to contain a determined malicious author,
  and no such guarantee is claimed anywhere in this project's materials.
- **Main-thread fallback**: when Workers are unavailable, `loadCspkg`
  evaluates the entry with a best-effort restricted `new Function` scope
  (`evaluatePluginLegacy`, mode `"legacy-fallback"`). A determined escape
  (constructor chains, etc.) exists. This fallback never runs for packages
  that failed the signature gate — see below — but it is still the weakest
  execution mode and the UI warns when it engages.
- **Source constraint (FR-05)**: every `.cspkg` load passes an Ed25519
  signature gate (`src/core/plugin-signing.ts`) *independent of the sandbox
  decision*: tampered packages always throw; unsigned or unknown-key packages
  require an explicit user trust confirmation before they can install.
  `sandbox: "trusted"` packages run with full page access by design and only
  make sense for packages the user controls.
- Plugin authors are treated as semi-trusted collaborators, not adversaries.
  Do not install `.cspkg` files you do not trust; the browser's same-origin
  policy (not this sandbox) is the last line of defense for stored data.

## Reporting a vulnerability

**Please do not open a public issue for a security vulnerability.** Use
GitHub's private vulnerability reporting instead:

1. Go to the repository's **Security** tab.
2. Select **Report a vulnerability** (under "Private vulnerability
   reporting").
3. Fill in the details: affected component, a minimal repro, impact, and a
   suggested fix if you have one.

If you prefer email, contact the maintainers at
<1486853830@qq.com> and prefix the subject with `[SECURITY]`.

What helps us triage quickly:

- Component and file(s) involved (plugin sandbox, CSPKG loader, WebGPU/WASM
  path, file routing, etc.)
- A minimal, self-contained reproduction
- Whether the issue is exploitable from an untrusted `.cspkg` package, an
  untrusted data file, or a malicious website embedding the app
- Browser and platform versions

## Response expectations

- **Acknowledgment**: within 48 hours of receiving a report.
- **Triage / fix plan**: within one week, we confirm the issue and share a
  plan.
- **Fix**: critical issues are prioritized; we aim for a fix in a patch
  release. We coordinate disclosure timing with you if the issue is
  exploitable before the fix ships.

## Supported versions

| Version | Supported          |
| ------- | ------------------ |
| main    | Yes (latest)       |
| Released tags | Best effort |

The project is under active development and does not yet maintain a
long-term-support branch; fixes land on `main` first.

## Scope

In scope:

- The plugin sandbox and `.cspkg` loading pipeline
- The WebGPU / WASM compute path
- File parsing and file-routing logic (including sample data)
- Anything that lets an untrusted package or file affect the host page

Out of scope (no fix promised):

- Vulnerabilities in upstream dependencies already fixed upstream — upgrade
  the dependency instead
- Issues that require a user to already be running untrusted code with
  `sandbox: 'trusted'` plugins (trusted plugins run with page access by
  design)

## Dependency vulnerability ledger (A2)

`npm audit` findings are reviewed weekly by the scheduled `security.yml` run
and re-triaged by a human during a monthly **upgrade window** (first review
of each month; earlier if a scheduled run turns red). Blocking policy:
high/critical advisories fail CI unless explicitly allow-listed in
`security.yml` (`AUDIT_ALLOWLIST`) with a reason; moderate findings are
tracked here.

State as of **2026-10-10** (app workspace runs `vite@6.4.3`, which is
patched; every remaining finding is rooted in the docs workspace):

| Package | Severity | Advisory(s) | Status | Reason / plan |
| --- | --- | --- | --- | --- |
| `vite` — docs workspace only (vitepress@1.6.4 pins vite@5.4.21) | high | GHSA-fx2h-pf6j-xcff (`server.fs.deny` bypass, Windows alt paths) | Allow-listed in `security.yml` | Dev-server-only; vitepress@1.6.4 (latest) cannot consume vite ≥ 6.4.3 where the patch landed. Revisit on the vitepress 2.x line. The app/website workspaces run vite@6.4.3 (patched). |
| `vite` — same node | moderate | GHSA-4w7w-66w2-5vf9; GHSA-v6wh-96g9-6wx3 | Accepted (below blocking threshold) | Same root cause as above; dev server only, docs workspace, static deploy. |
| `esbuild` — transitive via vitepress → vite@5 | moderate | GHSA-67mh-4wv8-2f99 | Accepted | No upstream fix path until vitepress bumps its vite floor. |
| `vitepress` | moderate | aggregate node | Accepted | Placeholder carrying the vite/esbuild chain above. |

Cleared in the 2026-09-21 upgrade window:

- `@vitest/mocker` + `vitest` — GHSA-82fw-gwwq-j7x9 (path traversal via
  mocker redirect mock, dev/test only) — fixed by upgrading
  vitest 4.1.10 → 4.1.11.

Cleared in the 2026-10-01 upgrade window:

- `undici` — GHSA-rfgv-xxqx-mfg5 (DoS via unrequested WebSocket subprotocol)
  and GHSA-w293-vg96-wgc3 (TLS certificate validation bypass via dropped
  connect options in `BalancedPool`), plus nine further advisories on the
  same node — fixed by upgrading undici 7.29.0 → 7.30.0. Transitive via
  `jsdom` (vitest's optional peer, test environment only); jsdom's `^7.25.0`
  floor admits the patch, so no `overrides` entry was needed.
- `dompurify` — GHSA-p98j-92pf-mc4p (DOM XSS via `IN_PLACE` node-removing
  `afterSanitize` hook) — fixed by upgrading dompurify 3.4.14 → 3.4.16.
  Transitive via `jspdf`'s optional dependencies.

Cleared in the 2026-10-10 upgrade window:

- `vue` + `@vue/server-renderer` — GHSA-g2v6-rqmx-r4w6 (XSS via a missing CR
  in the attribute-name blacklist) — fixed by refreshing the lockfile so vue
  3.5.41 → 3.5.43. Transitive via the docs workspace's `vitepress@1.6.4`
  (`vue: ^3.5.13`); the patched release already satisfies that floor, so no
  manifest change was needed — the committed lockfile had simply gone stale.
- `source-map-js` — GHSA-68fv-2mgg-jv7q (event-loop DoS via indexed source-map
  section offsets) — fixed by refreshing source-map-js 1.2.1 → 1.2.2.
  Transitive via `@vue/compiler-core`, `@vue/compiler-sfc`, `css-tree` and
  `postcss` (`^1.2.1`); same stale-lockfile root cause.

Dependency-resolution fix shipped alongside the above (peer conflict, not an
advisory): `blockly@13.2.1` declares the required peer
`jsdom >=27.4.0 <30.0.0`, so the `jsdom: ^30.1.2` devDependency introduced in
the TRAE batch broke `npm ci` with ERESOLVE and failed the `verify` /
`e2e-smoke` / `audit` / `sbom` jobs before any step ran. jsdom is pinned back
to `^29.1.1` (the latest release blockly accepts; the test suite runs in the
`node` environment and never imports jsdom, so the downgrade has no runtime
impact). This also keeps undici at the patched 7.30.0 noted above.

## Security hardening on the roadmap

The public roadmap (`docs/guide/roadmap.md`) tracks the following
hardening work: content security policy headers, worker resource limits
(memory / CPU), and an audit log system. Package signing (Ed25519) for
`.cspkg` packages is already implemented and enforced (`FR-05`,
`src/core/plugin-signing.ts`).

## No bounty program

This project does not currently offer a bug bounty or other financial reward.
We do, with your permission, credit researchers in the security advisory.
