// FR-05 plugin signing & install pipeline tests.
//
// Deterministic fixtures: fixed seeds so every fingerprint/signature is
// reproducible; RFC 8032 vectors are covered in the primitives tests, so
// here we exercise the pipeline (canonicalize → sign → verify → gate).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import {
  addTrustedKey,
  bytesToHex,
  canonicalizeForSigning,
  computeFingerprint,
  generateKeyPairFromSeed,
  getPublicKey,
  hexToBytes,
  isFingerprintFormat,
  listTrustedKeys,
  OFFICIAL_TRUSTED_KEYS,
  removeTrustedKey,
  signPackage,
  stableStringify,
  TRUSTED_KEYS,
  verifyPackageSignature,
  type TrustedKey,
} from '@/core/plugin-signing';
import {
  CspkgSignatureError,
  inspectCspkg,
  loadCspkg,
  parseCspkg,
} from '@/core/cspkg';
import { savePluginPackage } from '@/core/storage';
import { buildDemoPackage } from '@/plugins/marketplace-demo-packages';
import type { PluginApi, PluginManifest } from '@/types/plugin';

vi.mock('@/core/storage', () => ({
  savePluginPackage: vi.fn(async () => undefined),
  saveTrustedKey: vi.fn(async () => undefined),
  listTrustedKeys: vi.fn(async () => []),
  deleteTrustedKey: vi.fn(async () => undefined),
}));

const savePkgMock = vi.mocked(savePluginPackage);

// ---- fixtures ---------------------------------------------------------------

const SEED_A = 'e9c1c6182d7f078904a950489567f734bfbcdd240ef78427767185751d583935';
const SEED_B = 'fb2d3794dfca5dec189d1d4c8256ecebab4adb7d829fada0a059304b099702ba';

const ENTRY = `
  return {
    manifest: { id: 'unused', name: 'x', version: '0', author: 'a', description: 'd', entry: 'e' },
    init() {},
    getParams() { return []; },
  };
`;

const VALID_MANIFEST: PluginManifest = {
  id: 'com.example.signed',
  name: 'Signed Analyzer',
  version: '1.0.0',
  author: 'Example Corp',
  description: 'Plugin used by the signing pipeline tests',
  entry: 'dist/index.js',
  sandbox: 'trusted',
};

function keyOf(seedHex: string): TrustedKey {
  const publicKey = getPublicKey(hexToBytes(seedHex));
  return {
    fingerprint: computeFingerprint(publicKey),
    publicKey: bytesToHex(publicKey),
    label: 'test key',
  };
}

/** Build a .cspkg whose manifest is signed over its entry bytes. */
function makeSignedCspkg(
  seedHex: string,
  manifestPatch: Partial<PluginManifest> = {},
  entrySrc: string = ENTRY,
  signOverrides: { includePublicKey?: boolean; tamperAfterSigning?: boolean } = {},
): { buffer: ArrayBuffer; signature: PluginManifest['signature'] } {
  const manifest: PluginManifest = { ...VALID_MANIFEST, ...manifestPatch };
  let entryBytes = strToU8(entrySrc);
  const signature = signPackage(manifest, entryBytes, {
    seedHex,
    signer: 'Test Publisher',
    signedAt: '2026-01-01T00:00:00.000Z',
    permissions: ['canvas:draw'],
    includePublicKey: signOverrides.includePublicKey,
  });
  if (signOverrides.tamperAfterSigning) {
    // Modify the entry *after* signing — exactly the tamper the verifier
    // must catch (the manifest still carries the original signature).
    entryBytes = strToU8(entrySrc + '\n/* injected */');
  }
  const zipped = zipSync({
    'manifest.json': strToU8(JSON.stringify({ ...manifest, signature })),
    'dist/index.js': entryBytes,
  });
  return {
    buffer: zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength),
    signature,
  };
}

function makeUnsignedCspkg(manifestPatch: Partial<PluginManifest> = {}): ArrayBuffer {
  const zipped = zipSync({
    'manifest.json': strToU8(JSON.stringify({ ...VALID_MANIFEST, ...manifestPatch })),
    'dist/index.js': strToU8(ENTRY),
  });
  return zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength);
}

const fakeApi = { locale: 'zh-CN' } as unknown as PluginApi;

// ---- ed25519 round-trip ------------------------------------------------------

describe('ed25519 sign/verify round-trip', () => {
  it('verifies a signature made with the matching key', () => {
    const { publicKey } = generateKeyPairFromSeed(hexToBytes(SEED_A));
    const sig = signPackage(VALID_MANIFEST, strToU8(ENTRY), { seedHex: SEED_A, signer: 'T' });
    const result = verifyPackageSignature(
      { manifest: { ...VALID_MANIFEST, signature: sig }, entryBytes: strToU8(ENTRY) },
      [{ fingerprint: computeFingerprint(publicKey), publicKey: bytesToHex(publicKey), label: 'a' }],
    );
    expect(result.ok).toBe(true);
    expect(result.fingerprint).toBe(computeFingerprint(publicKey));
    expect(result.signer).toBe('T');
  });

  it('rejects when a single message byte is tampered', () => {
    const pkg = { manifest: VALID_MANIFEST, entryBytes: strToU8(ENTRY) };
    const sig = signPackage(pkg.manifest, pkg.entryBytes, { seedHex: SEED_A, signer: 'T' });
    const tampered = strToU8(ENTRY.slice(0, -1) + ';');
    const result = verifyPackageSignature(
      { manifest: { ...VALID_MANIFEST, signature: sig }, entryBytes: tampered },
      listTrustedKeysFor([SEED_A]),
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('signature-invalid');
  });

  it('rejects when the manifest is altered after signing', () => {
    const sig = signPackage(VALID_MANIFEST, strToU8(ENTRY), { seedHex: SEED_A, signer: 'T' });
    const result = verifyPackageSignature(
      { manifest: { ...VALID_MANIFEST, version: '9.9.9', signature: sig }, entryBytes: strToU8(ENTRY) },
      listTrustedKeysFor([SEED_A]),
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('signature-invalid');
  });

  it('produces a deterministic signature (RFC 8032 has no randomness)', () => {
    const s1 = signPackage(VALID_MANIFEST, strToU8(ENTRY), { seedHex: SEED_A, signer: 'T', signedAt: 'x' });
    const s2 = signPackage(VALID_MANIFEST, strToU8(ENTRY), { seedHex: SEED_A, signer: 'T', signedAt: 'x' });
    expect(s1.sig).toBe(s2.sig);
  });

  it('a signature from key A never verifies under key B', () => {
    const sig = signPackage(VALID_MANIFEST, strToU8(ENTRY), { seedHex: SEED_A, signer: 'T' });
    const keyB = keyOf(SEED_B);
    const result = verifyPackageSignature(
      // Embed key A's public key but claim key B's fingerprint would be
      // caught earlier; here keep A consistent and check B's registry fails.
      { manifest: { ...VALID_MANIFEST, signature: { ...sig, pub: undefined } }, entryBytes: strToU8(ENTRY) },
      [keyB],
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('untrusted-key');
  });
});

function listTrustedKeysFor(seedHexes: string[]): TrustedKey[] {
  return seedHexes.map(keyOf);
}

// ---- fingerprints -------------------------------------------------------------

describe('computeFingerprint', () => {
  it('is stable across calls for the same key', () => {
    const pub = getPublicKey(hexToBytes(SEED_A));
    expect(computeFingerprint(pub)).toBe(computeFingerprint(pub));
  });

  it('has the ed25519:<32 hex> format', () => {
    const fp = computeFingerprint(getPublicKey(hexToBytes(SEED_A)));
    expect(isFingerprintFormat(fp)).toBe(true);
    expect(fp.startsWith('ed25519:')).toBe(true);
    expect(fp).toHaveLength('ed25519:'.length + 32);
  });

  it('differs between distinct keys', () => {
    expect(computeFingerprint(getPublicKey(hexToBytes(SEED_A)))).not.toBe(
      computeFingerprint(getPublicKey(hexToBytes(SEED_B))),
    );
  });

  it('isFingerprintFormat rejects malformed values', () => {
    expect(isFingerprintFormat('ed25519:abc')).toBe(false);
    expect(isFingerprintFormat('rsa:89f151bd5a755187286542baf266d716')).toBe(false);
    expect(isFingerprintFormat('ed25519:zzf151bd5a755187286542baf266d716')).toBe(false);
    expect(isFingerprintFormat(null)).toBe(false);
  });
});

// ---- canonicalization ----------------------------------------------------------

describe('canonicalizeForSigning / stableStringify', () => {
  it('is independent of object key insertion order', () => {
    const a = stableStringify({ b: 1, a: { d: 2, c: [3, { z: 4, y: 5 }] } });
    const b = stableStringify({ a: { c: [3, { y: 5, z: 4 }], d: 2 }, b: 1 });
    expect(a).toBe(b);
  });

  it('emits no whitespace and sorts nested keys', () => {
    expect(stableStringify({ b: { d: 1, c: 2 }, a: 3 })).toBe('{"a":3,"b":{"c":2,"d":1}}');
  });

  it('drops undefined members like JSON.stringify', () => {
    expect(stableStringify({ a: 1, b: undefined })).toBe('{"a":1}');
    expect(stableStringify([1, undefined, 3])).toBe('[1,null,3]');
  });

  it('payload excludes the signature field so signing is idempotent', () => {
    const sig = signPackage(VALID_MANIFEST, strToU8(ENTRY), { seedHex: SEED_A, signer: 'T' });
    const withSig = { ...VALID_MANIFEST, signature: sig };
    const p1 = canonicalizeForSigning(VALID_MANIFEST, strToU8(ENTRY));
    const p2 = canonicalizeForSigning(withSig, strToU8(ENTRY));
    expect(bytesToHex(p1)).toBe(bytesToHex(p2));
  });

  it('payload is manifest bytes followed by entry bytes', () => {
    const entry = strToU8('abc');
    const payload = canonicalizeForSigning(VALID_MANIFEST, entry);
    expect(payload.subarray(payload.length - 3)).toEqual(entry);
  });
});

// ---- verifyPackageSignature failure modes ---------------------------------------

describe('verifyPackageSignature', () => {
  it('reports missing for an unsigned manifest', () => {
    const result = verifyPackageSignature(
      { manifest: VALID_MANIFEST, entryBytes: strToU8(ENTRY) },
      listTrustedKeysFor([SEED_A]),
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('missing');
    expect(result.message).toContain(VALID_MANIFEST.id);
  });

  it('reports malformed for a bad signature shape', () => {
    const bad = {
      alg: 'ed25519',
      fingerprint: 'ed25519:short',
      sig: 'nothex',
      signer: 'T',
      signedAt: '2026-01-01',
    } as unknown as PluginManifest['signature'];
    const result = verifyPackageSignature(
      { manifest: { ...VALID_MANIFEST, signature: bad }, entryBytes: strToU8(ENTRY) },
      [],
    );
    expect(result.reason).toBe('malformed');
  });

  it('reports fingerprint-mismatch when the embedded key contradicts the claim', () => {
    const sig = signPackage(VALID_MANIFEST, strToU8(ENTRY), { seedHex: SEED_A, signer: 'T' });
    const foreignPub = keyOf(SEED_B).publicKey;
    const result = verifyPackageSignature(
      { manifest: { ...VALID_MANIFEST, signature: { ...sig, pub: foreignPub } }, entryBytes: strToU8(ENTRY) },
      listTrustedKeysFor([SEED_A]),
    );
    expect(result.reason).toBe('fingerprint-mismatch');
  });

  it('reports untrusted-key for a valid signature from an unknown key', () => {
    const sig = signPackage(VALID_MANIFEST, strToU8(ENTRY), {
      seedHex: SEED_A,
      signer: 'T',
      includePublicKey: false,
    });
    const result = verifyPackageSignature(
      { manifest: { ...VALID_MANIFEST, signature: sig }, entryBytes: strToU8(ENTRY) },
      listTrustedKeysFor([SEED_B]),
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('untrusted-key');
    expect(result.fingerprint).toBe(sig.fingerprint);
  });

  it('accepts a key-less signature once the key is in the registry', () => {
    const sig = signPackage(VALID_MANIFEST, strToU8(ENTRY), {
      seedHex: SEED_A,
      signer: 'T',
      includePublicKey: false,
    });
    const result = verifyPackageSignature(
      { manifest: { ...VALID_MANIFEST, signature: sig }, entryBytes: strToU8(ENTRY) },
      listTrustedKeysFor([SEED_A]),
    );
    expect(result.ok).toBe(true);
  });

  it('a valid signature from an unregistered key is never ok even with embedded pub', () => {
    const sig = signPackage(VALID_MANIFEST, strToU8(ENTRY), { seedHex: SEED_A, signer: 'T' });
    const result = verifyPackageSignature(
      { manifest: { ...VALID_MANIFEST, signature: sig }, entryBytes: strToU8(ENTRY) },
      listTrustedKeysFor([SEED_B]),
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('untrusted-key');
  });
});

// ---- trusted key registry --------------------------------------------------------

describe('trusted key registry', () => {
  it('addTrustedKey rejects an invalid fingerprint format', async () => {
    await expect(
      addTrustedKey({ fingerprint: 'nope', publicKey: 'aa', label: 'x' }),
    ).rejects.toThrow('invalid fingerprint format');
  });

  it('addTrustedKey rejects a fingerprint that does not match the public key', async () => {
    const key = keyOf(SEED_A);
    await expect(
      addTrustedKey({ ...key, fingerprint: keyOf(SEED_B).fingerprint }),
    ).rejects.toThrow('fingerprint does not match');
  });

  it('addTrustedKey then verifyPackageSignature succeeds; remove restores refusal', async () => {
    const key = keyOf(SEED_A);
    const sig = signPackage(VALID_MANIFEST, strToU8(ENTRY), {
      seedHex: SEED_A,
      signer: 'T',
      includePublicKey: false,
    });
    const pkg = { manifest: { ...VALID_MANIFEST, signature: sig }, entryBytes: strToU8(ENTRY) };
    expect(verifyPackageSignature(pkg, TRUSTED_KEYS).reason).toBe('untrusted-key');
    await addTrustedKey(key);
    try {
      expect(verifyPackageSignature(pkg, TRUSTED_KEYS).ok).toBe(true);
    } finally {
      expect(await removeTrustedKey(key.fingerprint)).toBe(true);
    }
    expect(verifyPackageSignature(pkg, TRUSTED_KEYS).reason).toBe('untrusted-key');
  });

  it('removeTrustedKey protects built-in keys', async () => {
    expect(await removeTrustedKey(OFFICIAL_TRUSTED_KEYS[0]!.fingerprint)).toBe(false);
    expect(TRUSTED_KEYS.some((k) => k.fingerprint === OFFICIAL_TRUSTED_KEYS[0]!.fingerprint)).toBe(true);
  });

  it('listTrustedKeys returns defensive copies', () => {
    const before = TRUSTED_KEYS.length;
    const copy = listTrustedKeys();
    copy.push({ fingerprint: 'ed25519:00000000000000000000000000000000', publicKey: '00', label: 'x' });
    expect(TRUSTED_KEYS).toHaveLength(before);
  });
});

// ---- cspkg integration ------------------------------------------------------------

describe('cspkg signature gate', () => {
  afterEach(() => {
    savePkgMock.mockClear();
  });

  it('parses an unsigned package unchanged (manifest backward compatibility)', async () => {
    const { manifest } = await parseCspkg(makeUnsignedCspkg());
    expect(manifest.signature).toBeUndefined();
    expect(manifest.id).toBe(VALID_MANIFEST.id);
  });

  it('inspectCspkg reports missing for unsigned packages', async () => {
    const { signature } = await inspectCspkg(makeUnsignedCspkg());
    expect(signature.ok).toBe(false);
    expect(signature.reason).toBe('missing');
  });

  it('loadCspkg refuses unsigned packages by default', async () => {
    await expect(
      loadCspkg(new File([makeUnsignedCspkg()], 'u.cspkg'), () => fakeApi),
    ).rejects.toBeInstanceOf(CspkgSignatureError);
    expect(savePkgMock).not.toHaveBeenCalled();
  });

  it('unsigned failures carry needsTrustConfirmation', async () => {
    const err = await loadCspkg(new File([makeUnsignedCspkg()], 'u.cspkg'), () => fakeApi).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(CspkgSignatureError);
    expect((err as CspkgSignatureError).needsTrustConfirmation).toBe(true);
  });

  it('trustUnsigned installs an unsigned package and records provenance', async () => {
    const { plugin, mode, signature } = await loadCspkg(
      new File([makeUnsignedCspkg()], 'u.cspkg'),
      () => fakeApi,
      { trustUnsigned: true, source: 'local' },
    );
    expect(mode).toBe('trusted');
    expect(typeof plugin.init).toBe('function');
    expect(signature.ok).toBe(false);
    const record = savePkgMock.mock.calls[0]![0];
    expect(record.id).toBe(VALID_MANIFEST.id);
    expect(record.source).toBe('local');
    expect(record.signed).toBe(false);
    expect(record.fingerprint).toBeUndefined();
  });

  it('tampered packages are refused even with trustUnsigned', async () => {
    const { buffer } = makeSignedCspkg(SEED_A, {}, ENTRY, { tamperAfterSigning: true });
    const err = (await loadCspkg(new File([buffer], 't.cspkg'), () => fakeApi, {
      trustUnsigned: true,
    }).catch((e: unknown) => e)) as CspkgSignatureError;
    expect(err).toBeInstanceOf(CspkgSignatureError);
    expect(err.result.reason).toBe('signature-invalid');
    expect(err.needsTrustConfirmation).toBe(false);
    expect(savePkgMock).not.toHaveBeenCalled();
  });

  it('a package signed by a trusted key installs with no override', async () => {
    const key = keyOf(SEED_A);
    await addTrustedKey(key);
    try {
      const { buffer } = makeSignedCspkg(SEED_A);
      const { plugin, mode, signature } = await loadCspkg(
        new File([buffer], 's.cspkg'),
        () => fakeApi,
        { source: 'marketplace' },
      );
      expect(mode).toBe('trusted');
      expect(typeof plugin.init).toBe('function');
      expect(signature.ok).toBe(true);
      const record = savePkgMock.mock.calls[0]![0];
      expect(record.id).toBe(VALID_MANIFEST.id);
      expect(record.signed).toBe(true);
      expect(record.fingerprint).toBe(key.fingerprint);
      expect(record.source).toBe('marketplace');
      expect(record.signer).toBe('Test Publisher');
    } finally {
      await removeTrustedKey(key.fingerprint);
    }
  });

  it('marketplace demo package verifies cryptographically but is untrusted until added', async () => {
    const { signature } = await inspectCspkg(buildDemoPackage('community.wordcloud'));
    expect(signature.ok).toBe(false);
    expect(signature.reason).toBe('untrusted-key');
    expect(isFingerprintFormat(signature.fingerprint ?? '')).toBe(true);
    expect(signature.signer).toBe('Community Demo Publisher');
  });
});
