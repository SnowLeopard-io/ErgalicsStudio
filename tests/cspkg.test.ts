// .cspkg package parsing & loading tests (spec §6.3)
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { parseCspkg, loadCspkg } from '@/core/cspkg';
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

  it('executes entry with the real host api (regression: api was undefined)', async () => {
    const fakeApi = { locale: 'zh-CN' } as unknown as PluginApi;
    const { plugin, mode } = await loadCspkg(
      new File([makeCspkg({ sandbox: 'trusted' }, { 'dist/index.js': ENTRY })], 'a.cspkg'),
      () => fakeApi,
    );
    expect(mode).toBe('trusted');
    const params = await plugin.getParams();
    expect((params[0] as { value: string }).value).toBe('zh-CN');
  });

  it('throws when the entry does not return a plugin object', async () => {
    const badEntry = 'return 42;';
    await expect(
      loadCspkg(new File([makeCspkg({ sandbox: 'trusted' }, { 'dist/index.js': badEntry })], 'a.cspkg'), () =>
        ({} as PluginApi),
      ),
    ).rejects.toThrow('plugin object');
  });

  it('throws when the entry file is missing', async () => {
    await expect(
      loadCspkg(new File([makeCspkg({ sandbox: 'trusted' })], 'a.cspkg'), () => ({} as PluginApi)),
    ).rejects.toThrow('not found');
  });
});
