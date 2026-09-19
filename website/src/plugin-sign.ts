// ==========================================================================
// Website-side mirror of the workstation's FR-05 signing helpers.
//
// Only the *pure* pieces are duplicated here (canonical JSON + payload
// assembly + signPackage); the ed25519/SHA primitives are imported straight
// from `src/core/crypto-primitives` so the byte-level behavior is literally
// shared. `tests/plugin-signing/website-cspkg.test.ts` verifies end-to-end
// that packages produced here pass the workstation's verifier — if the
// canonicalization below ever drifts from `src/core/plugin-signing.ts`,
// that test fails.
// ==========================================================================

import {
  bytesToHex,
  concatBytes,
  getPublicKey,
  hexToBytes,
  sha256,
  sign as ed25519Sign,
  utf8Bytes,
} from '../../src/core/crypto-primitives';

export interface PackageSignature {
  alg: 'ed25519';
  fingerprint: string;
  sig: string;
  signer: string;
  signedAt: string;
  permissions?: string[];
  pub?: string;
}

/** Deterministic JSON: keys sorted recursively, no whitespace. Must stay
 *  byte-identical with `stableStringify` in src/core/plugin-signing.ts. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) throw new Error('cannot canonicalize undefined');
    return encoded;
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => (item === undefined ? 'null' : stableStringify(item))).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
}

/** Signing payload = canonical manifest JSON (signature stripped) + entry bytes. */
export function canonicalizeForSigning(manifest: Record<string, unknown>, entryBytes: Uint8Array): Uint8Array {
  const clone: Record<string, unknown> = { ...manifest };
  delete clone.signature;
  return concatBytes(utf8Bytes(stableStringify(clone)), entryBytes);
}

/** `ed25519:<hex16>` — first 16 bytes of SHA-256(publicKey), hex encoded.
 *  Mirrors `computeFingerprint` in src/core/plugin-signing.ts. */
export function computeFingerprint(publicKey: Uint8Array): string {
  return 'ed25519:' + bytesToHex(sha256(publicKey)).slice(0, 32);
}

/** Public key derived from a hex-encoded 32-byte seed. */
export function getPublicKeyBytes(seedHex: string): Uint8Array {
  return getPublicKey(hexToBytes(seedHex));
}

export interface SignPackageOptions {
  /** Hex-encoded 32-byte ed25519 seed. */
  seedHex: string;
  signer: string;
  signedAt?: string;
  permissions?: string[];
}

/** Produce the signature block for a package (manifest + entry bytes). */
export function signPackage(
  manifest: Record<string, unknown>,
  entryBytes: Uint8Array,
  options: SignPackageOptions,
): PackageSignature {
  const seed = hexToBytes(options.seedHex);
  const publicKey = getPublicKey(seed);
  const payload = canonicalizeForSigning(manifest, entryBytes);
  const sig = ed25519Sign(payload, seed);
  const signature: PackageSignature = {
    alg: 'ed25519',
    fingerprint: computeFingerprint(publicKey),
    sig: bytesToHex(sig),
    signer: options.signer,
    signedAt: options.signedAt ?? new Date().toISOString(),
  };
  if (options.permissions && options.permissions.length > 0) {
    signature.permissions = [...options.permissions];
  }
  signature.pub = bytesToHex(publicKey);
  return signature;
}

// Re-exported so the fingerprint helper stays in one place.
export { sha256 };
