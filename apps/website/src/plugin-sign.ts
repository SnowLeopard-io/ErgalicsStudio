// ==========================================================================
// Website-side FR-05 signing helpers — powered directly by `@ergalics/plugin-signing`.
//
// Previously duplicated canonical JSON + signPackage and reached across folders
// into `../../src/core/crypto-primitives`. Now both apps/studio and apps/website
// consume the exact same zero-dependency workspace package.
// ==========================================================================

import {
  canonicalizeForSigning,
  computeFingerprint,
  getPublicKey,
  hexToBytes,
  sha256,
  signPackage as sdkSignPackage,
  stableStringify,
  type PluginSignature,
  type SignPackageOptions,
} from '@ergalics/plugin-signing';

export type PackageSignature = PluginSignature;
export type { SignPackageOptions };
export { canonicalizeForSigning, computeFingerprint, sha256, stableStringify };

/** Public key derived from a hex-encoded 32-byte seed. */
export function getPublicKeyBytes(seedHex: string): Uint8Array {
  return getPublicKey(hexToBytes(seedHex));
}

/** Produce the signature block for a package (manifest + entry bytes). */
export function signPackage(
  manifest: Record<string, unknown>,
  entryBytes: Uint8Array,
  options: SignPackageOptions,
): PackageSignature {
  return sdkSignPackage(manifest, entryBytes, options);
}
