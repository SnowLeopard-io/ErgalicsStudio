// ==========================================================================
// Streaming SHA-256 for result provenance (FR-1)
//
// `crypto.subtle.digest` is one-shot: feeding it a whole large input file
// means materialising the file in the main thread. This incremental FIPS
// 180-4 implementation processes 64-byte blocks as they arrive, so a Blob is
// hashed chunk by chunk and memory stays flat regardless of file size.
// It is pure TypeScript and therefore runs identically in the browser,
// a worker, and Node tests.
// ==========================================================================

import { bytesToHex } from '@ergalics/plugin-signing/crypto';

const SHA_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotr32(x: number, n: number): number {
  return (x >>> n) | (x << (32 - n));
}

export class Sha256Stream {
  private readonly state = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  private readonly block = new Uint8Array(64);
  private filled = 0;
  private totalBytes = 0;

  update(input: Uint8Array): this {
    this.totalBytes += input.length;
    let offset = 0;
    while (offset < input.length) {
      const take = Math.min(64 - this.filled, input.length - offset);
      this.block.set(input.subarray(offset, offset + take), this.filled);
      this.filled += take;
      offset += take;
      if (this.filled === 64) {
        this.compress(this.state, this.block, 0);
        this.filled = 0;
      }
    }
    return this;
  }

  private compress(state: Uint32Array, bytes: Uint8Array, offset: number): void {
    const view = new DataView(bytes.buffer, bytes.byteOffset + offset, 64);
    const w = new Uint32Array(64);
    for (let i = 0; i < 16; i += 1) w[i] = view.getUint32(i * 4);
    for (let i = 16; i < 64; i += 1) {
      const s0 = rotr32(w[i - 15]!, 7) ^ rotr32(w[i - 15]!, 18) ^ (w[i - 15]! >>> 3);
      const s1 = rotr32(w[i - 2]!, 17) ^ rotr32(w[i - 2]!, 19) ^ (w[i - 2]! >>> 10);
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) >>> 0;
    }
    const h = state;
    let a = h[0]!, b = h[1]!, c = h[2]!, d = h[3]!;
    let e = h[4]!, f = h[5]!, g = h[6]!, hh = h[7]!;
    for (let i = 0; i < 64; i += 1) {
      const s1 = rotr32(e, 6) ^ rotr32(e, 11) ^ rotr32(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (hh + s1 + ch + SHA_K[i]! + w[i]!) >>> 0;
      const s0 = rotr32(a, 2) ^ rotr32(a, 13) ^ rotr32(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + maj) >>> 0;
      hh = g; g = f; f = e;
      e = (d + temp1) >>> 0;
      d = c; c = b; b = a;
      a = (temp1 + temp2) >>> 0;
    }
    h[0] = (h[0]! + a) >>> 0;
    h[1] = (h[1]! + b) >>> 0;
    h[2] = (h[2]! + c) >>> 0;
    h[3] = (h[3]! + d) >>> 0;
    h[4] = (h[4]! + e) >>> 0;
    h[5] = (h[5]! + f) >>> 0;
    h[6] = (h[6]! + g) >>> 0;
    h[7] = (h[7]! + hh) >>> 0;
  }

  digest(): Uint8Array {
    const bitLen = this.totalBytes * 8;
    const tailLen = ((this.filled + 9 + 63) >> 6) << 6;
    const tail = new Uint8Array(tailLen);
    tail.set(this.block.subarray(0, this.filled));
    tail[this.filled] = 0x80;
    const view = new DataView(tail.buffer);
    view.setUint32(tailLen - 8, Math.floor(bitLen / 0x100000000));
    view.setUint32(tailLen - 4, bitLen >>> 0);
    // Finalize into a copy: digest() must be idempotent so callers can read
    // the same result twice without silently corrupting the hasher.
    const state = this.state.slice();
    for (let i = 0; i < tailLen; i += 64) this.compress(state, tail, i);

    const out = new Uint8Array(32);
    const outView = new DataView(out.buffer);
    for (let i = 0; i < 8; i += 1) outView.setUint32(i * 4, state[i]!);
    return out;
  }

  digestHex(): string {
    return bytesToHex(this.digest());
  }
}

const encoder = new TextEncoder();

export function sha256Hex(data: Uint8Array): string {
  return new Sha256Stream().update(data).digestHex();
}

export function sha256Text(text: string): string {
  return sha256Hex(encoder.encode(text));
}

/**
 * SHA-256 of a text payload, using the platform's native digest when it is
 * available. `crypto.subtle` is orders of magnitude faster than the pure
 * TypeScript implementation, which matters for the ingestion path where a
 * large CSV is hashed on every keystroke-driven live sync.
 */
export async function sha256TextAsync(text: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return sha256Text(text);
  try {
    const digest = await subtle.digest('SHA-256', encoder.encode(text));
    return bytesToHex(new Uint8Array(digest));
  } catch {
    return sha256Text(text);
  }
}

/** Hash a Blob in bounded chunks; never materialises the whole file at once. */
export async function sha256Blob(blob: Blob, chunkSize = 1024 * 1024): Promise<string> {
  const size = Math.max(1, Math.floor(chunkSize));
  const hasher = new Sha256Stream();
  for (let offset = 0; offset < blob.size; offset += size) {
    const chunk = await blob.slice(offset, Math.min(offset + size, blob.size)).arrayBuffer();
    hasher.update(new Uint8Array(chunk));
  }
  return hasher.digestHex();
}
