// ==========================================================================
// @ergalics/plugin-signing — Pure-TS ed25519 signing & verification (FR-05)
//
// Zero runtime dependencies, zero DOM/IndexedDB usage. Safe to run in:
//   - apps/studio (browser installer)
//   - apps/website (marketplace demo package signer)
//   - packages/plugins (in-app community demo packages)
//   - scripts/sign-cspkg.mjs (Node >= 22.6 native TypeScript type stripping)
// ==========================================================================

import {
  bytesToHex,
  concatBytes,
  generateKeyPair,
  generateKeyPairFromSeed,
  getPublicKey,
  hexToBytes,
  sha256,
  sign as ed25519Sign,
  utf8Bytes,
  verify as ed25519Verify,
} from './crypto-primitives.ts';
import type { PluginManifest, PluginSignature } from '@ergalics/plugin-sdk';

export type { PluginSignature };
export {
  bytesToHex,
  concatBytes,
  generateKeyPair,
  generateKeyPairFromSeed,
  getPublicKey,
  hexToBytes,
  sha256,
  utf8Bytes,
};

// ---- fingerprint -----------------------------------------------------------

export const FINGERPRINT_PREFIX = 'ed25519:';

/** `ed25519:<hex16>` — first 16 bytes of SHA-256(publicKey), hex encoded. */
export function computeFingerprint(publicKey: Uint8Array): string {
  return FINGERPRINT_PREFIX + bytesToHex(sha256(publicKey)).slice(0, 32);
}

export function isFingerprintFormat(value: unknown): value is string {
  return typeof value === 'string' && /^ed25519:[0-9a-f]{32}$/.test(value);
}

// ---- canonical payload -----------------------------------------------------

/**
 * Deterministic JSON: object keys sorted recursively, no whitespace,
 * `undefined` members dropped (matching JSON.stringify semantics). The
 * signature payload must be byte-identical between the signing CLI, the
 * website publisher, and the browser verifier.
 */
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

/**
 * Signing payload = canonical manifest JSON (with the `signature` field
 * stripped) followed by the raw entry-file bytes.
 */
export function canonicalizeForSigning(
  manifest: PluginManifest | Record<string, unknown>,
  entryBytes: Uint8Array,
): Uint8Array {
  const clone: Record<string, unknown> = { ...(manifest as unknown as Record<string, unknown>) };
  delete clone.signature;
  return concatBytes(utf8Bytes(stableStringify(clone)), entryBytes);
}

// ---- sign / verify ---------------------------------------------------------

export interface SignPackageOptions {
  /** Hex-encoded 32-byte ed25519 seed (the CLI's secret key). */
  seedHex: string;
  signer: string;
  signedAt?: string;
  permissions?: string[];
  /** Embed the public key so verifiers can check without a prior lookup. */
  includePublicKey?: boolean;
}

/** Produce the signature object for a package (manifest + entry bytes). */
export function signPackage(
  manifest: PluginManifest | Record<string, unknown>,
  entryBytes: Uint8Array,
  options: SignPackageOptions,
): PluginSignature {
  const seed = hexToBytes(options.seedHex);
  const publicKey = getPublicKey(seed);
  const payload = canonicalizeForSigning(manifest, entryBytes);
  const sig = ed25519Sign(payload, seed);
  const signature: PluginSignature = {
    alg: 'ed25519',
    fingerprint: computeFingerprint(publicKey),
    sig: bytesToHex(sig),
    signer: options.signer,
    signedAt: options.signedAt ?? new Date().toISOString(),
  };
  if (options.permissions && options.permissions.length > 0) {
    signature.permissions = [...options.permissions];
  }
  if (options.includePublicKey !== false) {
    signature.pub = bytesToHex(publicKey);
  }
  return signature;
}

export interface PackageToVerify {
  manifest: PluginManifest;
  entryBytes: Uint8Array;
}

export type SignatureFailureReason =
  | 'missing'
  | 'malformed'
  | 'fingerprint-mismatch'
  | 'signature-invalid'
  | 'untrusted-key';

export interface SignatureCheckResult {
  ok: boolean;
  reason?: SignatureFailureReason;
  /** Human-readable explanation (English; UI localizes per `reason`). */
  message: string;
  fingerprint?: string;
  signer?: string;
}

function isSignatureShape(sig: unknown): sig is PluginSignature {
  if (!sig || typeof sig !== 'object') return false;
  const s = sig as Record<string, unknown>;
  return (
    s.alg === 'ed25519' &&
    typeof s.sig === 'string' &&
    /^[0-9a-fA-F]{128}$/.test(s.sig) &&
    isFingerprintFormat(s.fingerprint) &&
    typeof s.signer === 'string' &&
    typeof s.signedAt === 'string'
  );
}

export interface TrustedKey {
  /** `ed25519:<hex16>` */
  fingerprint: string;
  /** Hex-encoded 32-byte public key. */
  publicKey: string;
  /** Human-readable source label (publisher / channel). */
  label: string;
  /** Built-in keys cannot be removed by the user. */
  builtin?: boolean;
  /**
   * Whether packages signed by this key may opt into host execution
   * (`sandbox: "trusted"`). Defaults to `true`.
   */
  allowTrustedMode?: boolean;
  addedAt?: number;
}

/**
 * Official Ergalics Studio release key (public half only) plus the website
 * demo publisher key.
 */
export const OFFICIAL_TRUSTED_KEYS: readonly TrustedKey[] = Object.freeze([
  {
    fingerprint: 'ed25519:89f151bd5a755187286542baf266d716',
    publicKey: '816c0a99bc0760a4eb001a518264344f6cafb483f583105c7f5ac0f99c682d8c',
    label: 'Ergalics Studio Official',
    builtin: true,
  },
  {
    fingerprint: 'ed25519:0d308887c4734e3abd465dcee1195425',
    publicKey: 'd13f151cb3b44e8a17c9e738c8b49f0ad8db44ac0fe151a2b285196ad67a3b3a',
    label: 'Ergalics Studio Website (demo publisher)',
    builtin: true,
    allowTrustedMode: false,
  },
]);

/**
 * Verify a package signature against a trusted-key registry.
 */
export function verifyPackageSignature(
  pkg: PackageToVerify,
  trustedKeys: readonly TrustedKey[],
): SignatureCheckResult {
  const { manifest, entryBytes } = pkg;
  const sig = manifest.signature;
  if (!sig) {
    return {
      ok: false,
      reason: 'missing',
      message: `Package "${manifest.id}" is not signed. Unsigned packages are refused by default — review the source and confirm the trust prompt to install anyway.`,
    };
  }
  if (!isSignatureShape(sig)) {
    return {
      ok: false,
      reason: 'malformed',
      message: `Package "${manifest.id}" carries a malformed signature block (expected alg "ed25519", a 128-hex-digit signature and an "ed25519:<32 hex>" fingerprint). The package was probably modified after signing or produced by an outdated tool — re-sign it with the current CLI.`,
    };
  }
  const fingerprint = sig.fingerprint;
  const signer = sig.signer;

  let publicKey: Uint8Array;
  if (typeof sig.pub === 'string') {
    try {
      publicKey = hexToBytes(sig.pub);
    } catch {
      return {
        ok: false,
        reason: 'malformed',
        message: `Package "${manifest.id}" embeds an invalid hex public key.`,
        fingerprint,
        signer,
      };
    }
    if (publicKey.length !== 32) {
      return {
        ok: false,
        reason: 'malformed',
        message: `Package "${manifest.id}" embeds a public key that is not 32 bytes.`,
        fingerprint,
        signer,
      };
    }
    if (computeFingerprint(publicKey) !== fingerprint) {
      return {
        ok: false,
        reason: 'fingerprint-mismatch',
        message: `The public key embedded in package "${manifest.id}" does not hash to the fingerprint claimed by its manifest (${fingerprint}). Treat this as tampering — do not install.`,
        fingerprint,
        signer,
      };
    }
  } else {
    const trusted = trustedKeys.find((k) => k.fingerprint === fingerprint);
    if (!trusted) {
      return {
        ok: false,
        reason: 'untrusted-key',
        message: `Package "${manifest.id}" is signed by an unknown key (${fingerprint}). Verify the fingerprint with the publisher, then add it as a trusted source to install.`,
        fingerprint,
        signer,
      };
    }
    try {
      publicKey = hexToBytes(trusted.publicKey);
    } catch {
      return {
        ok: false,
        reason: 'malformed',
        message: `Trusted key entry for ${fingerprint} is corrupt (invalid hex public key).`,
        fingerprint,
        signer,
      };
    }
  }

  let ok: boolean;
  try {
    ok = ed25519Verify(canonicalizeForSigning(manifest, entryBytes), hexToBytes(sig.sig), publicKey);
  } catch {
    ok = false;
  }
  if (!ok) {
    return {
      ok: false,
      reason: 'signature-invalid',
      message: `The ed25519 signature of package "${manifest.id}" does not match its content (signer: ${signer}, fingerprint: ${fingerprint}). The package was modified after signing — re-download it from the official source.`,
      fingerprint,
      signer,
    };
  }

  const trusted = trustedKeys.some((k) => k.fingerprint === fingerprint);
  if (!trusted) {
    return {
      ok: false,
      reason: 'untrusted-key',
      message: `Package "${manifest.id}" has a valid signature, but key ${fingerprint} is not in the trusted registry. Verify the fingerprint with the publisher before trusting this source.`,
      fingerprint,
      signer,
    };
  }

  return { ok: true, message: 'Signature verified.', fingerprint, signer };
}

/**
 * Verify the pinned signature on a bundled (built-in) manifest.
 */
export function verifyBundledManifestSignature(manifest: PluginManifest): SignatureCheckResult {
  const sig = manifest.signature;
  if (!sig) {
    return { ok: false, reason: 'missing', message: `Bundled manifest "${manifest.id}" has no pinned signature.` };
  }
  if (!sig.pub) {
    return {
      ok: false,
      reason: 'malformed',
      message: `Bundled manifest "${manifest.id}" must embed its public key (signature.pub) to be self-verifiable.`,
      fingerprint: sig.fingerprint,
      signer: sig.signer,
    };
  }
  return verifyPackageSignature(
    { manifest, entryBytes: utf8Bytes(manifest.entry) },
    [{ fingerprint: sig.fingerprint, publicKey: sig.pub, label: 'bundled manifest' }],
  );
}
