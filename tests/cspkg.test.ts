// .cspkg package parsing & loading tests (spec §6.3)
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { parseCspkg, loadCspkg, trustedModeAllowedForKey } from '@/core/cspkg';
import { signPackage, TRUSTED_KEYS } from '@/core/plugin-signing';
import type { PluginApi, PluginManifest } from '@/types/plugin';

// storage (IndexedDB) is not available in node; the loader already swallows
// persistence failures, but we stub it for deterministic behavior.
vi.mock('@/core/storage', () => ({
  savePluginPackage: vi.fn(async () => undefined),
}));

beforeEach(() => {
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: vi.fn(() => 'blob:mock-url'),
    revokeObjectURL: vi.fn(),
  });
});

const VALID_MANIFEST: PluginManifest = {
  id: 'com.example.analyzer',
  name: 'Analyzer',
  version: '1.2.0',
  author: 'Example Corp',
  description: 'Sample analysis plugin',
  entry: 'dist/index.js',
};

function makeCspkg(manifest: Partial<PluginManifest>, entries: Record<string, string> = {}): ArrayBuffer {
  const files: Record<string, Uint8Array> = {
    'manifest.json': strToU8(JSON.stringify({ ...VALID_MANIFEST, ...manifest })),
  };
  for (const [path, content] of Object.entries(entries)) {
    files[path] = strToU8(content);
  }
  const zipped = zipSync(files);
  return zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength);
}

describe('parseCspkg', () => {
  it('parses a valid package', async () => {
    const { manifest, files } = await parseCspkg(makeCspkg({}, { 'dist/index.js': 'export default 1;' }));
    expect(manifest.id).toBe('com.example.analyzer');
    expect(files['dist/index.js']).toBeTruthy();
  });

  it('rejects a package without manifest.json', async () => {
    const zipped = zipSync({ 'dist/index.js': strToU8('x') });
    const buffer = zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength);
    await expect(parseCspkg(buffer)).rejects.toThrow('missing manifest.json');
  });

  it('rejects invalid manifest JSON', async () => {
    const zipped = zipSync({ 'manifest.json': strToU8('{not json') });
    const buffer = zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength);
    await expect(parseCspkg(buffer)).rejects.toThrow('invalid manifest.json');
  });

  it('rejects manifest missing required fields', async () => {
    await expect(parseCspkg(makeCspkg({ id: undefined }))).rejects.toThrow('id');
    await expect(parseCspkg(makeCspkg({ entry: undefined }))).rejects.toThrow('entry');
  });

  it('rejects malformed plugin ids', async () => {
    await expect(parseCspkg(makeCspkg({ id: '../evil' }))).rejects.toThrow('invalid plugin id');
    await expect(parseCspkg(makeCspkg({ id: 'has space' }))).rejects.toThrow('invalid plugin id');
  });

  it('rejects path-traversal entry paths', async () => {
    await expect(parseCspkg(makeCspkg({ entry: '../outside.js' }))).rejects.toThrow('entry path');
    await expect(parseCspkg(makeCspkg({ entry: '/abs/path.js' }))).rejects.toThrow('entry path');
  });

  it('rejects unknown sandbox modes', async () => {
    await expect(
      parseCspkg(makeCspkg({ sandbox: 'root' as 'isolated' })),
    ).rejects.toThrow('sandbox mode');
  });

  it('rejects unknown research tiers', async () => {
    await expect(
      parseCspkg(makeCspkg({ research: { tier: 'gold-plated' as 'research' } })),
    ).rejects.toThrow('research tier');
  });

  it('requires benchmarks for research tier (and reproducible research)', async () => {
    // research tier without benchmarks is a malformed claim.
    await expect(
      parseCspkg(makeCspkg({ research: { tier: 'research' } })),
    ).rejects.toThrow('must declare non-empty benchmarks');
    // research + reproducible still needs benchmarks to back the claim.
    await expect(
      parseCspkg(makeCspkg({ research: { tier: 'research', reproducible: true } })),
    ).rejects.toThrow('must declare non-empty benchmarks');
  });

  it('accepts a research tier with benchmarks and a quasi-research without', async () => {
    const ok = await parseCspkg(
      makeCspkg({
        research: { tier: 'research', reproducible: true, benchmarks: ['synthetic recovery < 5 %'] },
      }),
    );
    expect(ok.manifest.research?.tier).toBe('research');
    const quasi = await parseCspkg(makeCspkg({ research: { tier: 'quasi-research', reproducible: true } }));
    expect(quasi.manifest.research?.tier).toBe('quasi-research');
  });

  it('normalizes backslash zip keys (Windows tooling) so the entry resolves', async () => {
    const files: Record<string, Uint8Array> = {
      'manifest.json': strToU8(JSON.stringify(VALID_MANIFEST)),
      'dist\\index.js': strToU8('export default 1;'),
    };
    const zipped = zipSync(files);
    const buffer = zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength);
    const { manifest, files: out } = await parseCspkg(buffer);
    expect(out['dist/index.js']).toBeTruthy();
    expect(out[manifest.entry]).toBeTruthy();
  });

  it('neutralizes prototype-shadowing zip keys', async () => {
    // `__proto__` entries are inherently neutralized (fflate's assignment
    // sets the intermediate object's prototype rather than an own property),
    // so `constructor` is the reachable shadowing key to defend against.
    const files: Record<string, Uint8Array> = {
      'manifest.json': strToU8(JSON.stringify(VALID_MANIFEST)),
      constructor: strToU8('evil'),
    };
    const zipped = zipSync(files);
    const buffer = zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength);
    const { manifest, files: out } = await parseCspkg(buffer);
    expect(manifest.id).toBe(VALID_MANIFEST.id);
    expect(Object.getPrototypeOf(out)).toBeNull();
    expect(out['constructor']).toBeUndefined();
  });

  it('rejects archives with too many files before decompressing', async () => {
    const files: Record<string, Uint8Array> = {
      'manifest.json': strToU8(JSON.stringify(VALID_MANIFEST)),
    };
    for (let i = 0; i < 600; i += 1) files[`f${i}.bin`] = strToU8('x');
    const zipped = zipSync(files);
    const buffer = zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength);
    await expect(parseCspkg(buffer)).rejects.toThrow('too many files');
  });

  it('rejects a decompression bomb before materializing the archive', async () => {
    // 70 MB of zeros compresses to a few KB, so the *input* stays under the
    // 16 MB cap while the *decompressed* size exceeds the 64 MB limit. The
    // central-directory pre-scan must catch this without unzipping.
    const files: Record<string, Uint8Array> = {
      'manifest.json': strToU8(JSON.stringify(VALID_MANIFEST)),
      'data.bin': new Uint8Array(70 * 1024 * 1024),
    };
    const zipped = zipSync(files);
    expect(zipped.byteLength).toBeLessThan(16 * 1024 * 1024);
    const buffer = zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength);
    await expect(parseCspkg(buffer)).rejects.toThrow('decompressed size exceeds');
  });
});

describe('loadCspkg (trusted mode)', () => {
  const ENTRY = `
    return {
      manifest: { id: 'unused', name: 'x', version: '0', author: 'a', description: 'd', entry: 'e' },
      init() {},
      destroy() {},
      activate() {},
      deactivate() {},
      getParams() {
        return [{ key: 'api_locale', label: 'api', type: 'text', value: api && api.locale }];
      },
    };
  `;

  // These fixtures are unsigned; FR-05 refuses them by default, so the tests
  // pass the explicit trust override the UI confirmation would supply.
  it('executes entry with the real host api (regression: api was undefined)', async () => {
    const fakeApi = { locale: 'zh-CN' } as unknown as PluginApi;
    const { plugin, mode } = await loadCspkg(
      new File([makeCspkg({ sandbox: 'trusted' }, { 'dist/index.js': ENTRY })], 'a.cspkg'),
      () => fakeApi,
      { trustUnsigned: true },
    );
    expect(mode).toBe('trusted');
    const params = await plugin.getParams();
    expect((params[0] as { value: string }).value).toBe('zh-CN');
  });

  it('throws when the entry does not return a plugin object', async () => {
    const badEntry = 'return 42;';
    await expect(
      loadCspkg(
        new File([makeCspkg({ sandbox: 'trusted' }, { 'dist/index.js': badEntry })], 'a.cspkg'),
        () => ({} as PluginApi),
        { trustUnsigned: true },
      ),
    ).rejects.toThrow('plugin object');
  });

  it('throws when the entry file is missing', async () => {
    await expect(
      loadCspkg(new File([makeCspkg({ sandbox: 'trusted' })], 'a.cspkg'), () => ({} as PluginApi), {
        trustUnsigned: true,
      }),
    ).rejects.toThrow('not found');
  });
});

// ---- FR-05 trusted-mode gating ------------------------------------------
//
// The website demo-publisher seed is public (it ships in the website bundle),
// so anyone can produce a correctly-signed package with it. Such a signature
// proves origin, not intent — the key is only allowed to publish sandboxed
// packages and can NEVER opt into host (`trusted`) execution.

const WEBSITE_PUBLISHER_SEED =
  '66fd265b1796c7283d5d8d254fa13b9b078e23414f3e64bb1cc6b49556b80090';

function makeSignedCspkg(manifest: Partial<PluginManifest>, entry: string): ArrayBuffer {
  const entryBytes = strToU8(entry);
  const base: PluginManifest = { ...VALID_MANIFEST, ...manifest } as PluginManifest;
  const signature = signPackage(base, entryBytes, {
    seedHex: WEBSITE_PUBLISHER_SEED,
    signer: 'website-demo',
  });
  const withSig = { ...base, signature };
  const zipped = zipSync({
    'manifest.json': strToU8(JSON.stringify(withSig)),
    'dist/index.js': entryBytes,
  });
  return zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength) as ArrayBuffer;
}

describe('trusted-mode gating (allowTrustedMode)', () => {
  const ENTRY = `
    return {
      manifest: { id: 'unused', name: 'x', version: '0', author: 'a', description: 'd', entry: 'e' },
      init() {}, destroy() {}, activate() {}, deactivate() {}, getParams() { return []; },
    };
  `;

  it('trustedModeAllowedForKey: website demo key may not request trusted mode', () => {
    const demoFp = TRUSTED_KEYS.find((k) => k.label.includes('Website'))!.fingerprint;
    expect(trustedModeAllowedForKey(demoFp, true)).toBe(false);
    // The official release key keeps the ability.
    const officialFp = TRUSTED_KEYS.find((k) => k.label.includes('Official'))!.fingerprint;
    expect(trustedModeAllowedForKey(officialFp, true)).toBe(true);
  });

  it('trustedModeAllowedForKey: explicit trustUnsigned confirmation keeps the manifest choice', () => {
    const demoFp = TRUSTED_KEYS.find((k) => k.label.includes('Website'))!.fingerprint;
    // signatureOk === false means the user hand-confirmed the source, so the
    // key's allowTrustedMode no longer applies.
    expect(trustedModeAllowedForKey(demoFp, false)).toBe(true);
  });

  it('refuses a website-signed package that requests sandbox: "trusted"', async () => {
    const buffer = makeSignedCspkg({ sandbox: 'trusted' }, ENTRY);
    // Signature verifies against the built-in demo key (signature.ok === true),
    // but the key may only publish sandboxed packages — installation must fail
    // with a clear explanation instead of silently running in the host.
    await expect(
      loadCspkg(new File([buffer], 'trusted-demo.cspkg'), () => ({} as PluginApi)),
    ).rejects.toThrow(/only allowed to publish sandboxed packages/);
  });

  it('still installs a website-signed sandboxed package', async () => {
    // Same key + entry, but sandbox: 'isolated' — the normal website download
    // path — must keep installing (falls back to legacy in node, no Worker).
    const buffer = makeSignedCspkg({ sandbox: 'isolated' }, ENTRY);
    const { mode } = await loadCspkg(
      new File([buffer], 'isolated-demo.cspkg'),
      () => ({} as PluginApi),
    );
    expect(['isolated', 'legacy-fallback']).toContain(mode);
  });
});

// ---- sandbox fallback hardening ------------------------------------------
//
// When the Worker API IS available but a plugin's entry throws inside its
// worker, the old loader re-ran the entry unsandboxed (legacy `new Function`),
// letting a plugin escape the security boundary simply by throwing on boot.
// The loader must refuse that fallback; only a genuinely absent Worker API may
// fall back to the restricted scope.

describe('loadCspkg sandbox fallback hardening', () => {
  const GOOD_ENTRY = `
    return {
      manifest: { id: 'unused', name: 'x', version: '0', author: 'a', description: 'd', entry: 'e' },
      init() {}, destroy() {}, activate() {}, deactivate() {}, getParams() { return []; },
    };
  `;

  it('refuses to re-run an entry unsandboxed when a worker exists but boot failed', async () => {
    // FakeWorker that reports a boot failure (worker API present).
    class FailingBootWorker {
      onmessage: ((ev: { data: unknown }) => void) | null = null;
      constructor(_u: string | URL, _o?: WorkerOptions) {}
      postMessage(msg: unknown) {
        const id = (msg as { id: number }).id;
        queueMicrotask(() =>
          this.onmessage?.({ data: { id, ok: false, error: 'boot failed: hostile' } }),
        );
      }
      terminate() {}
    }
    vi.stubGlobal('Worker', FailingBootWorker);
    try {
      const buffer = (() => {
        const zipped = zipSync({
          'manifest.json': strToU8(JSON.stringify({ ...VALID_MANIFEST, sandbox: 'isolated' })),
          'dist/index.js': strToU8(GOOD_ENTRY),
        });
        return zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength) as ArrayBuffer;
      })();
      // Worker API is now present, so a boot failure must NOT fall back to
      // legacy evaluation — it must be refused outright.
      await expect(
        loadCspkg(new File([buffer], 'boot-fail.cspkg'), () => ({} as PluginApi), {
          trustUnsigned: true,
        }),
      ).rejects.toThrow(/refusing to re-run its entry code unsandboxed/);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
