// ==========================================================================
// Plugin package signing & trust registry (FR-05)
//
// Pure-TS ed25519 over the canonical package payload (sorted-key manifest
// JSON + entry bytes). Kept free of DOM/IndexedDB at the module top level so
// the same code runs in the browser installer, the signing CLI (Node), and
// unit tests. Persistence of user-added trusted keys goes through
// `src/core/storage.ts` lazily and degrades gracefully when IndexedDB is
// unavailable.
//
// Trust model: signing answers "who published this package", the worker
// sandbox answers "what may it do at runtime" — the two are independent and
// a valid signature never weakens sandbox isolation (spec §6.2, FR-05).
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
import type { PluginManifest, PluginSignature } from '@/types/plugin';

export type { PluginSignature };
export { generateKeyPair, generateKeyPairFromSeed, getPublicKey, bytesToHex, hexToBytes };

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
 * signature payload must be byte-identical between the signing CLI and the
 * browser verifier, which raw `JSON.stringify` cannot guarantee once a
 * manifest round-trips through different tooling.
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
export function canonicalizeForSigning(manifest: PluginManifest, entryBytes: Uint8Array): Uint8Array {
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
  manifest: PluginManifest,
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

/**
 * Verify a package signature against the trusted-key registry.
 *
 * `ok === true` requires both a cryptographically valid signature *and* a
 * fingerprint present in `trustedKeys` — a valid signature from an unknown
 * key is reported as `untrusted-key` so the UI can offer the explicit
 * "trust this source" confirmation (FR-05 rule: unsigned/unknown sources are
 * refused by default, never silently accepted).
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

// ---- trusted key registry --------------------------------------------------

export interface TrustedKey {
  /** `ed25519:<hex16>` */
  fingerprint: string;
  /** Hex-encoded 32-byte public key. */
  publicKey: string;
  /** Human-readable source label (publisher / channel). */
  label: string;
  /** Built-in keys cannot be removed by the user. */
  builtin?: boolean;
  addedAt?: number;
}

/**
 * Official Ergalics Studio release key (public half only). Packages shipped
 * through the official channel are signed by the matching secret held by the
 * release tooling; this constant is what the installer trusts out of the box.
 */
export const OFFICIAL_TRUSTED_KEYS: readonly TrustedKey[] = Object.freeze([
  {
    fingerprint: 'ed25519:89f151bd5a755187286542baf266d716',
    publicKey: '816c0a99bc0760a4eb001a518264344f6cafb483f583105c7f5ac0f99c682d8c',
    label: 'Ergalics Studio Official',
    builtin: true,
  },
  {
    // Website marketplace publisher. The official website builds downloadable
    // `.cspkg` demo packages client-side, so its signing seed ships in the
    // public website bundle — this key therefore carries the SAME trust tier
    // as the in-app community demo packages, NOT the offline release secret
    // above. It exists so a website download installs without the manual
    // "trust this source" prompt; its packages still run sandboxed and are
    // clearly labelled as marketplace demos in the install dialog.
    fingerprint: 'ed25519:0d308887c4734e3abd465dcee1195425',
    publicKey: 'd13f151cb3b44e8a17c9e738c8b49f0ad8db44ac0fe151a2b285196ad67a3b3a',
    label: 'Ergalics Studio Website (demo publisher)',
    builtin: true,
  },
]);

/** Live registry: built-in keys plus sources the user explicitly trusted. */
export const TRUSTED_KEYS: TrustedKey[] = [...OFFICIAL_TRUSTED_KEYS];

/**
 * Storage adapter is injected lazily via dynamic import so this module never
 * touches IndexedDB at load time (Node/CLI/test environments must be able to
 * import it), and persistence failures degrade to memory-only.
 */
async function persistKey(key: TrustedKey): Promise<void> {
  try {
    const storage = await import('./storage');
    await storage.saveTrustedKey({
      fingerprint: key.fingerprint,
      publicKey: key.publicKey,
      label: key.label,
      addedAt: key.addedAt ?? Date.now(),
    });
  } catch {
    /* IndexedDB unavailable (node, private mode) — memory-only is fine. */
  }
}

/** Add (or replace) a user-trusted source key. */
export async function addTrustedKey(key: TrustedKey): Promise<TrustedKey> {
  if (!isFingerprintFormat(key.fingerprint)) {
    throw new Error(`addTrustedKey: invalid fingerprint format "${key.fingerprint}"`);
  }
  hexToBytes(key.publicKey); // throws on non-hex
  if (computeFingerprint(hexToBytes(key.publicKey)) !== key.fingerprint) {
    throw new Error('addTrustedKey: fingerprint does not match the public key');
  }
  const entry: TrustedKey = { ...key, builtin: false, addedAt: key.addedAt ?? Date.now() };
  const existing = TRUSTED_KEYS.findIndex((k) => k.fingerprint === entry.fingerprint);
  if (existing >= 0) TRUSTED_KEYS.splice(existing, 1, entry);
  else TRUSTED_KEYS.push(entry);
  await persistKey(entry);
  return entry;
}

/** Current trusted keys (built-in + user-added). */
export function listTrustedKeys(): TrustedKey[] {
  return TRUSTED_KEYS.map((k) => ({ ...k }));
}

/** Remove a user-added key. Built-in keys are protected. */
export async function removeTrustedKey(fingerprint: string): Promise<boolean> {
  const index = TRUSTED_KEYS.findIndex((k) => k.fingerprint === fingerprint);
  if (index < 0 || TRUSTED_KEYS[index]?.builtin) return false;
  TRUSTED_KEYS.splice(index, 1);
  try {
    const storage = await import('./storage');
    await storage.deleteTrustedKey(fingerprint);
  } catch {
    /* ignore persistence failure */
  }
  return true;
}

/**
 * Restore user-added keys from IndexedDB into the live registry. Safe to call
 * repeatedly; returns the full trusted list.
 */
export async function loadTrustedKeysFromStorage(): Promise<TrustedKey[]> {
  try {
    const storage = await import('./storage');
    const stored = await storage.listTrustedKeys();
    for (const key of stored) {
      if (!TRUSTED_KEYS.some((k) => k.fingerprint === key.fingerprint)) {
        TRUSTED_KEYS.push({ ...key, builtin: false });
      }
    }
  } catch {
    /* storage unavailable — keep built-in keys only */
  }
  return listTrustedKeys();
}
