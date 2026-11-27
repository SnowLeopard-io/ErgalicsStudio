// ==========================================================================
// Ergalics Studio — Host plugin signing & persistent trusted-key registry
//
// Pure cryptographic & canonical verification logic lives in
// `@ergalics/plugin-signing`. This host module layers browser IndexedDB
// persistence for user-added trusted publisher keys on top.
// ==========================================================================

import {
  computeFingerprint,
  hexToBytes,
  isFingerprintFormat,
  OFFICIAL_TRUSTED_KEYS,
  type TrustedKey,
} from '@ergalics/plugin-signing';

export * from '@ergalics/plugin-signing';

/** Live registry: built-in keys plus sources the user explicitly trusted. */
export const TRUSTED_KEYS: TrustedKey[] = [...OFFICIAL_TRUSTED_KEYS];

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
  hexToBytes(key.publicKey);
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
