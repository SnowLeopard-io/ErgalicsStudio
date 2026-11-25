import { describe, expect, it } from 'vitest';
import { canonicalJSON } from '@/core/result/canonical';
import { sha256Blob, sha256Hex, sha256Text, Sha256Stream } from '@/core/result/hash';
import {
  compareResults,
  createLegacyResult,
  createResultRecord,
  recordFingerprint,
} from '@/core/result/record';
import { createEmptyProject, deserializeProject, serializeProject } from '@/types/project';

const VECTORS: Array<[string, string]> = [
  ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
  ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
  [
    'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq',
    '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
  ],
];

describe('streaming SHA-256', () => {
  it('matches FIPS 180-4 vectors', () => {
    for (const [text, hex] of VECTORS) expect(sha256Text(text)).toBe(hex);
  });

  it('is independent of chunk boundaries', () => {
    const text = 'x'.repeat(5000);
    const one = new Sha256Stream();
    one.update(new TextEncoder().encode(text));
    const many = new Sha256Stream();
    const bytes = new TextEncoder().encode(text);
    for (let i = 0; i < bytes.length; i += 17) many.update(bytes.subarray(i, i + 17));
    expect(many.digestHex()).toBe(one.digestHex());
    expect(sha256Hex(bytes)).toBe(one.digestHex());
  });

  it('hashes a Blob in bounded chunks', async () => {
    const text = 'provenance'.repeat(1000);
    const blob = new Blob([text], { type: 'text/plain' });
    expect(await sha256Blob(blob, 64)).toBe(sha256Text(text));
  });
});

describe('canonical snapshots', () => {
  it('sorts object keys recursively, preserves array order', () => {
    expect(canonicalJSON({ b: 1, a: { z: 2, y: [3, 1] } })).toBe(
      '{"a":{"y":[3,1],"z":2},"b":1}',
    );
  });
});

describe('ResultRecord', () => {
  it('mints a new id on every publish and never mutates old records', () => {
    const a = createResultRecord({ pluginId: 'stats.t', params: { b: 2, a: 1 } });
    const b = createResultRecord({ pluginId: 'stats.t', params: { b: 2, a: 1 } });
    expect(a.resultId).not.toBe(b.resultId);
    expect(Object.isFrozen(a)).toBe(true);
    expect(Object.isFrozen(a.params)).toBe(true);
    expect(new Date(a.createdAt).toISOString()).toBe(a.createdAt);
    expect(JSON.stringify(a.params)).toBe('{"a":1,"b":2}');
    expect(recordFingerprint(a)).toBe(recordFingerprint(b));
  });

  it('builds a legacy record with an explicit warning', () => {
    const legacy = createLegacyResult('p1');
    expect(legacy.pluginId).toBe('legacy.project');
    expect(legacy.metrics[0]?.severity).toBe('warn');
  });

  it('compares metrics key by key', () => {
    const base = createResultRecord({
      pluginId: 'p',
      metrics: [{ key: 'r2', label: 'R²', value: 0.9, display: '0.9' }],
    });
    const same = createResultRecord({
      pluginId: 'p',
      metrics: [{ key: 'r2', label: 'R²', value: 0.9, display: '0.9' }],
    });
    const diff = createResultRecord({
      pluginId: 'p',
      metrics: [{ key: 'r2', label: 'R²', value: 0.5, display: '0.5' }],
    });
    expect(compareResults(base, same)[0]?.matched).toBe(true);
    expect(compareResults(base, diff)[0]?.matched).toBe(false);
  });
});

describe('project persistence', () => {
  it('adds a legacy record when loading a pre-provenance project', () => {
    const project = createEmptyProject('legacy');
    delete project.state.results;
    const restored = deserializeProject(serializeProject(project));
    expect(restored.state.results).toHaveLength(1);
    expect(restored.state.results?.[0]?.pluginId).toBe('legacy.project');
  });

  it('round-trips published results through a .clproj snapshot', () => {
    const project = createEmptyProject('modern');
    project.state.results = [
      createResultRecord({ pluginId: 'stats.t', metrics: [{ key: 'n', label: 'n', value: 3 }] }),
    ];
    const restored = deserializeProject(serializeProject(project));
    expect(restored.state.results?.[0]?.resultId).toBe(project.state.results[0]?.resultId);
    expect(restored.state.results?.[0]?.metrics[0]?.value).toBe(3);
  });
});
