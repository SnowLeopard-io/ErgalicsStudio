// ==========================================================================
// FR-09 Reproducible snapshot — self-contained HTML structure assertions
// ==========================================================================

import { describe, it, expect } from 'vitest';
import { buildReproSnapshot, SNAPSHOT_SCHEMA } from '@/core/repro/snapshot';
import { buildLock, canonicalJson, verifyLock } from '@/core/repro/lock';
import { hashString } from '@/core/repro/random';
import { createRunRecord, type RunRecord } from '@/core/experiment/record';
import { createEmptyProject, type Project } from '@/types/project';

function makeProject(): Project {
  const p = createEmptyProject('Snapshot Study');
  p.data.files = [
    { id: 'f1', name: 'measurements.csv', size: 12, mimeType: 'text/csv', format: 'csv', content: 'x,y\n1,2\n3,4\n' },
  ];
  return p;
}

function makeRun(projectId: string): RunRecord {
  return createRunRecord({
    projectId,
    source: 'flow',
    label: 'baseline',
    params: { k: 3 },
    inputFileIds: ['f1'],
    inputsHash: 'abcd1234',
    metrics: { r2: 0.95 },
    seed: 42,
    durationMs: 10,
  });
}

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>';

function build(project = makeProject()) {
  const run = makeRun(project.id);
  const lock = buildLock(project, { runs: [run] });
  const html = buildReproSnapshot({
    project,
    lock,
    runs: [run],
    charts: [{ title: 'Result', svg: SVG }],
    lang: 'en',
    now: new Date('2026-09-18T08:00:00Z'),
  });
  return { project, run, lock, html };
}

describe('FR-09 buildReproSnapshot', () => {
  it('produces a complete offline HTML document with inline CSS only', () => {
    const { html } = build();
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('<style>');
    // Self-contained: no external scripts, stylesheets, links or fetches.
    expect(html).not.toMatch(/<link\b/i);
    expect(html).not.toMatch(/<script[^>]+\bsrc=/i);
    expect(html).not.toMatch(/<img[^>]+\bsrc=/i);
    expect(html).not.toMatch(/\bhref=["']https?:/i);
    expect(html).not.toContain('fetch(');
  });

  it('embeds the repro.lock verbatim in an application/json script tag', () => {
    const { lock, html } = build();
    const match = html.match(/<script type="application\/json" id="repro-lock-json">([\s\S]*?)<\/script>/);
    expect(match).not.toBeNull();
    const embedded = JSON.parse(match![1]!);
    expect(embedded.projectId).toBe(lock.projectId);
    expect(embedded.lockVersion).toBe(2);
    expect(embedded.data[0].hash).toBe(lock.data[0]!.hash);
  });

  it('never embeds raw data file content — fingerprints only', () => {
    const { html } = build();
    expect(html).not.toContain('x,y\n1,2');
    expect(html).toContain('measurements.csv');
    expect(html).toMatch(/[0-9a-f]{8}/);
  });

  it('escapes JSON payloads so embedded data cannot break out of the script tag', () => {
    const project = makeProject();
    project.data.files[0]!.name = 'evil</script><script>alert(1)</script>.csv';
    const { html } = build(project);
    // The only executable <script> blocks are the two JSON carriers + verifier.
    const scriptOpens = html.match(/<script\b/g) ?? [];
    expect(scriptOpens.length).toBe(3);
    expect(html).not.toContain('</script>alert');
  });

  it('shows version info, generation time and the project identity', () => {
    const { project, html } = build();
    expect(html).toContain(SNAPSHOT_SCHEMA);
    expect(html).toContain('2026-09-18T08:00:00.000Z');
    expect(html).toContain('Snapshot Study');
    expect(html).toContain(project.id);
    expect(html).toContain('Lock format: v2');
  });

  it('renders the data fingerprint table and the locked-run summary', () => {
    const { html } = build();
    expect(html).toContain('Data fingerprints');
    expect(html).toContain('Locked runs');
    expect(html).toContain('baseline');
    expect(html).toContain('r2=0.95');
    expect(html).toContain('seed');
  });

  it('inlines result figure SVG and strips executable content from it', () => {
    const { html } = build();
    expect(html).toContain('<circle cx="5" cy="5" r="4"/>');
    expect(html).toContain('Result');

    const injected = buildWithSvg(
      makeProject(),
      `<svg onload="alert(1)"><script>bad()</script>${SVG}</svg>`,
    );
    expect(injected).not.toContain('onload');
    expect(injected).not.toContain('bad()');
  });

  it('includes the reproduction checks list and the in-page verifier', () => {
    const { html } = build();
    expect(html).toContain('Reproduction checks');
    expect(html).toContain('id="chk-params"');
    expect(html).toContain('id="chk-code"');
    expect(html).toContain('id="chk-data"');
    expect(html).toContain('How to reproduce');
    // The verifier is tiny (< 5 KB) and does not re-execute computations.
    const verifier = html.slice(html.lastIndexOf('<script>') + 8, html.lastIndexOf('</script>'));
    expect(verifier.length).toBeLessThan(5 * 1024);
    expect(verifier).not.toContain('fetch');
  });

  it('renders Chinese labels when lang=zh', () => {
    const project = makeProject();
    const run = makeRun(project.id);
    const lock = buildLock(project, { runs: [run] });
    const html = buildReproSnapshot({ project, lock, runs: [run], lang: 'zh' });
    expect(html).toContain('可复现快照');
    expect(html).toContain('数据指纹');
    expect(html).toContain('复现指引');
  });

  it('is pure — the same inputs and a frozen clock yield byte-identical HTML', () => {
    const project = makeProject();
    const run = makeRun(project.id);
    const lock = buildLock(project, { runs: [run] });
    const args = { project, lock, runs: [run], lang: 'en' as const, now: new Date(0) };
    expect(buildReproSnapshot(args)).toBe(buildReproSnapshot(args));
  });

  it('the embedded lock still verifies against the source project', () => {
    const { lock, project, run, html } = build();
    const match = html.match(/<script type="application\/json" id="repro-lock-json">([\s\S]*?)<\/script>/);
    const embedded = JSON.parse(match![1]!);
    const result = verifyLock(embedded, project, { runs: [run], dependencies: embedded.dependencies });
    expect(result.status).toBe('pass');
    // Normalise both sides through JSON.stringify: `undefined` fields are
    // dropped in transport, which is lossless for verification purposes.
    expect(canonicalJson(embedded)).toBe(canonicalJson(JSON.parse(JSON.stringify(lock))));
  });
});

function buildWithSvg(project: Project, svg: string): string {
  const run = makeRun(project.id);
  const lock = buildLock(project, { runs: [run] });
  return buildReproSnapshot({ project, lock, runs: [run], charts: [{ svg }], lang: 'en' });
}

// The verifier's hash must agree with the studio kernel (same FNV-1a).
describe('FR-09 snapshot verifier parity', () => {
  it('params hashes embedded in the lock match the kernel hashString of canonical params', () => {
    const project = makeProject();
    const run = makeRun(project.id);
    const lock = buildLock(project, { runs: [run] });
    expect(lock.runs[0]!.paramsHash).toBe(hashString(canonicalJson(run.params)));
  });
});
