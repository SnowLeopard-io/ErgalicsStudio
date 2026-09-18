// ==========================================================================
// Self-contained crypto primitives for plugin signing (FR-05)
//
// Pure TypeScript SHA-256 (FIPS 180-4) and Ed25519 (RFC 8032) on BigInt.
// Web Crypto's `crypto.subtle` does not support Ed25519 uniformly across
// browsers and Node, so a single deterministic implementation keeps the
// browser installer and the signing CLI byte-for-byte compatible — and
// unit-testable without any environment globals.
//
// Performance is adequate for one signature verification per install
// (tens of ms); these primitives are never on a hot path.
// ==========================================================================

// ---- byte / hex helpers ----------------------------------------------------

export function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

/** Strict hex decode: even length, hex digits only. Throws otherwise. */
export function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0 || /[^0-9a-fA-F]/.test(hex)) {
    throw new Error('invalid hex string');
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

const UTF8_ENCODER = new TextEncoder();

export function utf8Bytes(text: string): Uint8Array {
  return UTF8_ENCODER.encode(text);
}

// ---- SHA-256 (FIPS 180-4) --------------------------------------------------

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

export function sha256(data: Uint8Array): Uint8Array {
  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;

  const bitLen = data.length * 8;
  // Message + 0x80 terminator + zero pad + 64-bit big-endian length.
  const padded = new Uint8Array(((data.length + 9 + 63) >> 6) << 6);
  padded.set(data);
  padded[data.length] = 0x80;
  const view = new DataView(padded.buffer);
  // JS bit ops are 32-bit, so the 64-bit length is written as two halves.
  view.setUint32(padded.length - 8, Math.floor(bitLen / 0x100000000));
  view.setUint32(padded.length - 4, bitLen >>> 0);

  const w = new Uint32Array(64);
  for (let chunk = 0; chunk < padded.length; chunk += 64) {
    for (let i = 0; i < 16; i += 1) w[i] = view.getUint32(chunk + i * 4);
    for (let i = 16; i < 64; i += 1) {
      const s0 = rotr32(w[i - 15]!, 7) ^ rotr32(w[i - 15]!, 18) ^ (w[i - 15]! >>> 3);
      const s1 = rotr32(w[i - 2]!, 17) ^ rotr32(w[i - 2]!, 19) ^ (w[i - 2]! >>> 10);
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) >>> 0;
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let i = 0; i < 64; i += 1) {
      const S1 = rotr32(e, 6) ^ rotr32(e, 11) ^ rotr32(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + SHA_K[i]! + w[i]!) >>> 0;
      const S0 = rotr32(a, 2) ^ rotr32(a, 13) ^ rotr32(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e;
      e = (d + temp1) >>> 0;
      d = c; c = b; b = a;
      a = (temp1 + temp2) >>> 0;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0;
  }

  const out = new Uint8Array(32);
  const outView = new DataView(out.buffer);
  [h0, h1, h2, h3, h4, h5, h6, h7].forEach((value, i) => outView.setUint32(i * 4, value));
  return out;
}

// ---- Ed25519 (RFC 8032) ----------------------------------------------------

const P = 2n ** 255n - 19n;
const L = 2n ** 252n + 27742317777372353535851937790883648493n;
const D =
  (-121665n * modInvRaw(121666n, P) % P + P) % P;
const I = modPowRaw(2n, (P - 1n) / 4n, P);

function mod(a: bigint): bigint {
  return ((a % P) + P) % P;
}

function modPowRaw(base: bigint, exp: bigint, m: bigint): bigint {
  let result = 1n;
  let b = ((base % m) + m) % m;
  let e = exp;
  while (e > 0n) {
    if (e & 1n) result = (result * b) % m;
    b = (b * b) % m;
    e >>= 1n;
  }
  return result;
}

function modInvRaw(a: bigint, m: bigint): bigint {
  return modPowRaw(a, m - 2n, m);
}

/** Little-endian bytes → BigInt. */
function leToBigInt(bytes: Uint8Array): bigint {
  let value = 0n;
  for (let i = bytes.length - 1; i >= 0; i -= 1) value = (value << 8n) | BigInt(bytes[i]!);
  return value;
}

function bigIntToLe(value: bigint, length: number): Uint8Array {
  const out = new Uint8Array(length);
  let v = value;
  for (let i = 0; i < length; i += 1) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

/** Extended twisted-Edwards coordinates (x, y, z, t) with t = xy/z. */
type Point = [bigint, bigint, bigint, bigint];

function edwardsAdd(p1: Point, p2: Point): Point {
  const [x1, y1, z1, t1] = p1;
  const [x2, y2, z2, t2] = p2;
  const a = mod((y1 - x1) * (y2 - x2));
  const b = mod((y1 + x1) * (y2 + x2));
  const c = mod(t1 * 2n * D * t2);
  const dd = mod(z1 * 2n * z2);
  const e = b - a;
  const f = dd - c;
  const g = dd + c;
  const h = b + a;
  return [mod(e * f), mod(g * h), mod(f * g), mod(e * h)];
}

function pointMul(scalar: bigint, point: Point): Point {
  const identity: Point = [0n, 1n, 1n, 0n];
  let result = identity;
  let addend = point;
  let k = scalar;
  while (k > 0n) {
    if (k & 1n) result = edwardsAdd(result, addend);
    addend = edwardsAdd(addend, addend);
    k >>= 1n;
  }
  return result;
}

function recoverX(y: bigint, sign: bigint): bigint | null {
  const denom = mod(D * y % P * y + 1n);
  const xx = mod((y * y - 1n) * modInvRaw(denom, P));
  let x = modPowRaw(xx, (P + 3n) / 8n, P);
  if (mod(x * x - xx) !== 0n) {
    x = mod(x * I);
    if (mod(x * x - xx) !== 0n) return null; // xx is not a square
  }
  if (x === 0n && sign === 1n) return null;
  if ((x & 1n) !== sign) x = P - x;
  return x;
}

function encodePoint(p: Point): Uint8Array {
  const [x, y, z] = p;
  const zi = modInvRaw(mod(z), P);
  const ex = mod(x * zi);
  const ey = mod(y * zi);
  const bytes = bigIntToLe(ey, 32);
  bytes[31] = (bytes[31]! & 0x7f) | (Number(ex & 1n) << 7);
  return bytes;
}

function decodePoint(bytes: Uint8Array): Point {
  if (bytes.length !== 32) throw new Error('ed25519: point must be 32 bytes');
  const sign = BigInt(bytes[31]! >> 7);
  const y = leToBigInt(bytes) & (2n ** 255n - 1n);
  if (y >= P) throw new Error('ed25519: point y out of range');
  const x = recoverX(y, sign);
  if (x === null) throw new Error('ed25519: point is not on the curve');
  return [x, y, 1n, mod(x * y)];
}

function pointsEqual(p1: Point, p2: Point): boolean {
  const [x1, y1, z1] = p1;
  const [x2, y2, z2] = p2;
  return mod(x1 * z2 - x2 * z1) === 0n && mod(y1 * z2 - y2 * z1) === 0n;
}

const BY = mod(4n * modInvRaw(5n, P));
const BX = recoverX(BY, 0n);
if (BX === null) throw new Error('ed25519: base point recovery failed');
const BASE_POINT: Point = [BX, BY, 1n, mod(BX * BY)];

/** SHA-512 is required by RFC 8032; reuse SHA-256's machinery is *not*
 *  possible, so this small standalone implementation exists next to it. */
const SHA512_K = [
  0x428a2f98d728ae22n, 0x7137449123ef65cdn, 0xb5c0fbcfec4d3b2fn, 0xe9b5dba58189dbbcn,
  0x3956c25bf348b538n, 0x59f111f1b605d019n, 0x923f82a4af194f9bn, 0xab1c5ed5da6d8118n,
  0xd807aa98a3030242n, 0x12835b0145706fben, 0x243185be4ee4b28cn, 0x550c7dc3d5ffb4e2n,
  0x72be5d74f27b896fn, 0x80deb1fe3b1696b1n, 0x9bdc06a725c71235n, 0xc19bf174cf692694n,
  0xe49b69c19ef14ad2n, 0xefbe4786384f25e3n, 0x0fc19dc68b8cd5b5n, 0x240ca1cc77ac9c65n, 0x2de92c6f592b0275n, 0x4a7484aa6ea6e483n, 0x5cb0a9dcbd41fbd4n, 0x76f988da831153b5n,
  0x983e5152ee66dfabn, 0xa831c66d2db43210n, 0xb00327c898fb213fn, 0xbf597fc7beef0ee4n,
  0xc6e00bf33da88fc2n, 0xd5a79147930aa725n, 0x06ca6351e003826fn, 0x142929670a0e6e70n,
  0x27b70a8546d22ffcn, 0x2e1b21385c26c926n, 0x4d2c6dfc5ac42aedn, 0x53380d139d95b3dfn,
  0x650a73548baf63den, 0x766a0abb3c77b2a8n, 0x81c2c92e47edaee6n, 0x92722c851482353bn,
  0xa2bfe8a14cf10364n, 0xa81a664bbc423001n, 0xc24b8b70d0f89791n, 0xc76c51a30654be30n,
  0xd192e819d6ef5218n, 0xd69906245565a910n, 0xf40e35855771202an, 0x106aa07032bbd1b8n,
  0x19a4c116b8d2d0c8n, 0x1e376c085141ab53n, 0x2748774cdf8eeb99n, 0x34b0bcb5e19b48a8n,
  0x391c0cb3c5c95a63n, 0x4ed8aa4ae3418acbn, 0x5b9cca4f7763e373n, 0x682e6ff3d6b2b8a3n,
  0x748f82ee5defb2fcn, 0x78a5636f43172f60n, 0x84c87814a1f0ab72n, 0x8cc702081a6439ecn,
  0x90befffa23631e28n, 0xa4506cebde82bde9n, 0xbef9a3f7b2c67915n, 0xc67178f2e372532bn,
  0xca273eceea26619cn, 0xd186b8c721c0c207n, 0xeada7dd6cde0eb1en, 0xf57d4f7fee6ed178n,
  0x06f067aa72176fban, 0x0a637dc5a2c898a6n, 0x113f9804bef90daen, 0x1b710b35131c471bn,
  0x28db77f523047d84n, 0x32caab7b40c72493n, 0x3c9ebe0a15c9bebcn, 0x431d67c49c100d4cn,
  0x4cc5d4becb3e42b6n, 0x597f299cfc657e2an, 0x5fcb6fab3ad6faecn, 0x6c44198c4a475817n,
];

const MASK64 = (1n << 64n) - 1n;

function rotr64(x: bigint, n: bigint): bigint {
  return ((x >> n) | (x << (64n - n))) & MASK64;
}

export function sha512(data: Uint8Array): Uint8Array {
  let h: bigint[] = [
    0x6a09e667f3bcc908n, 0xbb67ae8584caa73bn, 0x3c6ef372fe94f82bn, 0xa54ff53a5f1d36f1n,
    0x510e527fade682d1n, 0x9b05688c2b3e6c1fn, 0x1f83d9abfb41bd6bn, 0x5be0cd19137e2179n,
  ];
  const bitLen = BigInt(data.length) * 8n;
  const padded = new Uint8Array(((data.length + 17 + 127) >> 7) << 7);
  padded.set(data);
  padded[data.length] = 0x80;
  const view = new DataView(padded.buffer);
  // 128-bit length field; inputs are far below 2^64 bits so the high half
  // stays zero (the padded buffer is pre-zeroed) and only the low 64 bits
  // are written.
  for (let j = 0; j < 2; j += 1) {
    view.setUint32(padded.length - 8 + j * 4, Number((bitLen >> BigInt(32 * (1 - j))) & 0xffffffffn));
  }
  const w = new Array<bigint>(80);
  for (let chunk = 0; chunk < padded.length; chunk += 128) {
    for (let i = 0; i < 16; i += 1) {
      const hi = BigInt(view.getUint32(chunk + i * 8) >>> 0);
      const lo = BigInt(view.getUint32(chunk + i * 8 + 4) >>> 0);
      w[i] = (hi << 32n) | lo;
    }
    for (let i = 16; i < 80; i += 1) {
      const s0 = rotr64(w[i - 15]!, 1n) ^ rotr64(w[i - 15]!, 8n) ^ (w[i - 15]! >> 7n);
      const s1 = rotr64(w[i - 2]!, 19n) ^ rotr64(w[i - 2]!, 61n) ^ (w[i - 2]! >> 6n);
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) & MASK64;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 80; i += 1) {
      const S1 = rotr64(e!, 14n) ^ rotr64(e!, 18n) ^ rotr64(e!, 41n);
      const ch = (e! & f!) ^ (~e! & MASK64 & g!);
      const temp1 = (hh! + S1 + ch + SHA512_K[i]! + w[i]!) & MASK64;
      const S0 = rotr64(a!, 28n) ^ rotr64(a!, 34n) ^ rotr64(a!, 39n);
      const maj = (a! & b!) ^ (a! & c!) ^ (b! & c!);
      const temp2 = (S0 + maj) & MASK64;
      hh = g; g = f; f = e;
      e = (d! + temp1) & MASK64;
      d = c; c = b; b = a; a = (temp1 + temp2) & MASK64;
    }
    const next = [a!, b!, c!, d!, e!, f!, g!, hh!];
    h = h.map((value, i) => (value + next[i]!) & MASK64);
  }
  const out = new Uint8Array(64);
  const outView = new DataView(out.buffer);
  h.forEach((value, i) => {
    outView.setUint32(i * 8, Number((value >> 32n) & MASK64 & 0xffffffffn));
    outView.setUint32(i * 8 + 4, Number(value & 0xffffffffn));
  });
  return out;
}

/** SHA-512 of `data`, interpreted as a little-endian integer (RFC 8032 `H`). */
function hashToInt(data: Uint8Array): bigint {
  return leToBigInt(sha512(data));
}

/** Expand a 32-byte seed into (scalar a, prefix) per RFC 8032 §5.1.5. */
function expandSeed(seed: Uint8Array): { a: bigint; prefix: Uint8Array } {
  if (seed.length !== 32) throw new Error('ed25519: seed must be 32 bytes');
  const h = sha512(seed);
  const aBytes = h.slice(0, 32);
  aBytes[0] = aBytes[0]! & 0xf8;
  aBytes[31] = (aBytes[31]! & 0x7f) | 0x40;
  return { a: leToBigInt(aBytes), prefix: h.slice(32) };
}

export interface Ed25519KeyPair {
  /** 32-byte RFC 8032 secret seed. */
  seed: Uint8Array;
  /** 32-byte compressed public key. */
  publicKey: Uint8Array;
}

/** Derive the key pair from a 32-byte seed (deterministic, RFC 8032 §5.1.5). */
export function generateKeyPairFromSeed(seed: Uint8Array): Ed25519KeyPair {
  const { a } = expandSeed(seed);
  return { seed, publicKey: encodePoint(pointMul(a, BASE_POINT)) };
}

/** Generate a fresh key pair from a CSPRNG. */
export function generateKeyPair(): Ed25519KeyPair {
  const seed = new Uint8Array(32);
  const g = globalThis as { crypto?: { getRandomValues?: (b: Uint8Array) => Uint8Array } };
  if (typeof g.crypto?.getRandomValues === 'function') {
    g.crypto.getRandomValues(seed);
  } else {
    // Non-browser/Node fallback: Math.random is weak but keeps the API usable
    // in exotic runtimes; production callers always have WebCrypto.
    for (let i = 0; i < 32; i += 1) seed[i] = Math.floor(Math.random() * 256);
  }
  return generateKeyPairFromSeed(seed);
}

/** Public key for a 32-byte seed. */
export function getPublicKey(seed: Uint8Array): Uint8Array {
  return generateKeyPairFromSeed(seed).publicKey;
}

/** Sign `message` with the seed's key pair. Returns a 64-byte signature. */
export function sign(message: Uint8Array, seed: Uint8Array): Uint8Array {
  const { a, prefix } = expandSeed(seed);
  const publicKey = encodePoint(pointMul(a, BASE_POINT));
  const r = hashToInt(concatBytes(prefix, message)) % L;
  const bigR = encodePoint(pointMul(r, BASE_POINT));
  const k = hashToInt(concatBytes(bigR, publicKey, message)) % L;
  const s = (r + k * a) % L;
  return concatBytes(bigR, bigIntToLe(s, 32));
}

/** Verify a 64-byte signature. Never throws on malformed input. */
export function verify(message: Uint8Array, signature: Uint8Array, publicKey: Uint8Array): boolean {
  try {
    if (signature.length !== 64 || publicKey.length !== 32) return false;
    const s = leToBigInt(signature.slice(32));
    if (s >= L) return false; // co-factorless check required by RFC 8032 §8.4
    const bigR = decodePoint(signature.slice(0, 32));
    const a = decodePoint(publicKey);
    const k = hashToInt(concatBytes(signature.slice(0, 32), publicKey, message)) % L;
    // [s]B == R + [k]A
    return pointsEqual(pointMul(s, BASE_POINT), edwardsAdd(bigR, pointMul(k, a)));
  } catch {
    return false;
  }
}
