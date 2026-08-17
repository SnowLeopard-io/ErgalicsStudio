# Security Policy

Ergalics Studio runs entirely in the browser and loads third-party plugin
code through a sandboxed worker; the security model is described in
`docs/guide/plugins.md`. We take security reports seriously and respond as
quickly as we can.

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

## Security hardening on the roadmap

The public roadmap (`docs/guide/roadmap.md`) tracks the following
hardening work: content security policy headers, worker resource limits
(memory / CPU), package signing (Ed25519) for the marketplace, and an audit
log system.

## No bounty program

This project does not currently offer a bug bounty or other financial reward.
We do, with your permission, credit researchers in the security advisory.
