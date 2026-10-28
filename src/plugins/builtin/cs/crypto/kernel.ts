// ==========================================================================
// crypto — pure kernel
//
// Textbook RSA (BigInt), AES-128 (FIPS-197), SHA-256 (FIPS-180-4), an
// avalanche-effect sampler and short-Weierstrass ECC (including NIST P-256).
// Educational implementations: not constant-time, not for real secrets.
// ==========================================================================

export function mod(a: bigint, m: bigint): bigint {
  const r = a % m;
  return r < 0n ? r + m : r;
}

export function modPow(base: bigint, exponent: bigint, modulus: bigint): bigint {
  if (modulus <= 1n) return 0n;
  let result = 1n;
  let b = mod(base, modulus);
  let e = exponent;
  while (e > 0n) {
    if (e & 1n) result = (result * b) % modulus;
    b = (b * b) % modulus;
    e >>= 1n;
  }
  return result;
}

export function gcd(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y) {
    const t = x % y;
    x = y;
    y = t;
  }
  return x;
}

export function modInverse(a: bigint, m: bigint): bigint {
  let [oldR, r] = [mod(a, m), m];
  let [oldS, s] = [1n, 0n];
  while (r !== 0n) {
    const q = oldR / r;
    [oldR, r] = [r, oldR - q * r];
    [oldS, s] = [s, oldS - q * s];
  }
  if (oldR !== 1n) throw new Error('Inverse does not exist.');
  return mod(oldS, m);
}

const SMALL_PRIMES = [2n, 3n, 5n, 7n, 11n, 13n, 17n, 19n, 23n, 29n, 31n, 37n];

/** Miller–Rabin with the first 12 prime bases (deterministic below 3.3e24). */
export function isProbablePrime(n: bigint): boolean {
  if (n < 2n) return false;
  for (const p of SMALL_PRIMES) {
    if (n === p) return true;
    if (n % p === 0n) return false;
  }
  let d = n - 1n;
  let r = 0;
  while (d % 2n === 0n) {
    d /= 2n;
    r += 1;
  }
  for (const a of SMALL_PRIMES) {
    let x = modPow(a, d, n);
    if (x === 1n || x === n - 1n) continue;
    let composite = true;
    for (let i = 1; i < r; i += 1) {
      x = (x * x) % n;
      if (x === n - 1n) {
        composite = false;
        break;
      }
    }
    if (composite) return false;
  }
  return true;
}

export interface RsaKey {
  p: bigint;
  q: bigint;
  n: bigint;
  phi: bigint;
  e: bigint;
  d: bigint;
  bits: number;
}

export function rsaFromPrimes(p: bigint, q: bigint, e = 65537n): RsaKey {
  if (!isProbablePrime(p) || !isProbablePrime(q)) throw new Error('p and q must be prime.');
  if (p === q) throw new Error('p and q must differ.');
  const n = p * q;
  const phi = (p - 1n) * (q - 1n);
  if (gcd(e, phi) !== 1n) throw new Error('e must be coprime to φ(n).');
  const d = modInverse(e, phi);
  return { p, q, n, phi, e, d, bits: n.toString(2).length };
}

export function rsaEncryptInt(message: bigint, key: Pick<RsaKey, 'e' | 'n'>): bigint {
  return modPow(message, key.e, key.n);
}

export function rsaDecryptInt(cipher: bigint, key: Pick<RsaKey, 'd' | 'n'>): bigint {
  return modPow(cipher, key.d, key.n);
}

export const DEMO_RSA_PRIMES = { p: 61n, q: 53n, e: 17n };

// ---- AES-128 ---------------------------------------------------------------

function gfMul(a: number, b: number): number {
  let result = 0;
  let x = a;
  let y = b;
  for (let i = 0; i < 8; i += 1) {
    if (y & 1) result ^= x;
    const high = x & 0x80;
    x = (x << 1) & 0xff;
    if (high) x ^= 0x1b;
    y >>= 1;
  }
  return result & 0xff;
}

function gfPow(a: number, exponent: number): number {
  let result = 1;
  let base = a;
  let e = exponent;
  while (e > 0) {
    if (e & 1) result = gfMul(result, base);
    base = gfMul(base, base);
    e >>= 1;
  }
  return result;
}

const rotl8 = (x: number, n: number): number => ((x << n) | (x >>> (8 - n))) & 0xff;

export const AES_SBOX: number[] = Array.from({ length: 256 }, (_, i) => {
  const inv = i === 0 ? 0 : gfPow(i, 254);
  return (inv ^ rotl8(inv, 1) ^ rotl8(inv, 2) ^ rotl8(inv, 3) ^ rotl8(inv, 4) ^ 0x63) & 0xff;
});

const RCON = [0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0x1b, 0x36];

export function aesKeyExpansion(key: ArrayLike<number>): number[][] {
  if (key.length !== 16) throw new Error('AES-128 needs a 16-byte key.');
  const words: number[][] = [];
  for (let i = 0; i < 4; i += 1) words.push([key[4 * i]!, key[4 * i + 1]!, key[4 * i + 2]!, key[4 * i + 3]!]);
  for (let i = 4; i < 44; i += 1) {
    let temp = [...words[i - 1]!];
    if (i % 4 === 0) {
      temp = [temp[1]!, temp[2]!, temp[3]!, temp[0]!].map((b) => AES_SBOX[b]!);
      temp[0] = temp[0]! ^ RCON[i / 4 - 1]!;
    }
    words.push(temp.map((b, j) => b ^ words[i - 4]![j]!));
  }
  return words;
}

function addRoundKey(state: number[], words: number[][], round: number): void {
  for (let c = 0; c < 4; c += 1) {
    for (let r = 0; r < 4; r += 1) state[c * 4 + r] = state[c * 4 + r]! ^ words[round * 4 + c]![r]!;
  }
}

function shiftRows(state: number[]): void {
  const copy = [...state];
  for (let r = 1; r < 4; r += 1) {
    for (let c = 0; c < 4; c += 1) state[c * 4 + r] = copy[((c + r) % 4) * 4 + r]!;
  }
}

function mixColumns(state: number[]): void {
  for (let c = 0; c < 4; c += 1) {
    const [a0, a1, a2, a3] = [state[c * 4]!, state[c * 4 + 1]!, state[c * 4 + 2]!, state[c * 4 + 3]!];
    state[c * 4] = gfMul(a0, 2) ^ gfMul(a1, 3) ^ a2 ^ a3;
    state[c * 4 + 1] = a0 ^ gfMul(a1, 2) ^ gfMul(a2, 3) ^ a3;
    state[c * 4 + 2] = a0 ^ a1 ^ gfMul(a2, 2) ^ gfMul(a3, 3);
    state[c * 4 + 3] = gfMul(a0, 3) ^ a1 ^ a2 ^ gfMul(a3, 2);
  }
}

export interface AesRoundTrace {
  round: number;
  afterSubBytes: number[];
  afterShiftRows: number[];
  afterMixColumns: number[] | null;
  roundKey: number[];
}

export function aesEncryptBlock(plaintext: ArrayLike<number>, key: ArrayLike<number>): number[] {
  const words = aesKeyExpansion(key);
  const state = Array.from(plaintext);
  if (state.length !== 16) throw new Error('AES block must be 16 bytes.');
  addRoundKey(state, words, 0);
  for (let round = 1; round <= 10; round += 1) {
    for (let i = 0; i < 16; i += 1) state[i] = AES_SBOX[state[i]!]!;
    shiftRows(state);
    if (round !== 10) mixColumns(state);
    addRoundKey(state, words, round);
  }
  return state;
}

export function aesTrace(plaintext: ArrayLike<number>, key: ArrayLike<number>): AesRoundTrace[] {
  const words = aesKeyExpansion(key);
  const state = Array.from(plaintext);
  addRoundKey(state, words, 0);
  const trace: AesRoundTrace[] = [];
  for (let round = 1; round <= 10; round += 1) {
    for (let i = 0; i < 16; i += 1) state[i] = AES_SBOX[state[i]!]!;
    const afterSubBytes = [...state];
    shiftRows(state);
    const afterShiftRows = [...state];
    let afterMixColumns: number[] | null = null;
    if (round !== 10) {
      mixColumns(state);
      afterMixColumns = [...state];
    }
    addRoundKey(state, words, round);
    trace.push({
      round,
      afterSubBytes,
      afterShiftRows,
      afterMixColumns,
      roundKey: Array.from({ length: 16 }, (_, i) => words[round * 4 + (i >> 2)]![i & 3]!),
    });
  }
  return trace;
}

// ---- SHA-256 ---------------------------------------------------------------

const SHA_K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

export function sha256Bytes(input: ArrayLike<number>): number[] {
  const bytes = Array.from(input);
  const bitLength = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  const high = Math.floor(bitLength / 2 ** 32);
  const low = bitLength >>> 0;
  for (let i = 3; i >= 0; i -= 1) bytes.push((high >>> (i * 8)) & 0xff);
  for (let i = 3; i >= 0; i -= 1) bytes.push((low >>> (i * 8)) & 0xff);

  let [h0, h1, h2, h3, h4, h5, h6, h7] = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ];
  const rotr = (x: number, n: number): number => (x >>> n) | (x << (32 - n));

  for (let offset = 0; offset < bytes.length; offset += 64) {
    const w = new Array<number>(64).fill(0);
    for (let i = 0; i < 16; i += 1) {
      const j = offset + i * 4;
      w[i] = ((bytes[j]! << 24) | (bytes[j + 1]! << 16) | (bytes[j + 2]! << 8) | bytes[j + 3]!) >>> 0;
    }
    for (let i = 16; i < 64; i += 1) {
      const s0 = rotr(w[i - 15]!, 7) ^ rotr(w[i - 15]!, 18) ^ (w[i - 15]! >>> 3);
      const s1 = rotr(w[i - 2]!, 17) ^ rotr(w[i - 2]!, 19) ^ (w[i - 2]! >>> 10);
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = [h0!, h1!, h2!, h3!, h4!, h5!, h6!, h7!];
    for (let i = 0; i < 64; i += 1) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + SHA_K[i]! + w[i]!) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    h0 = (h0! + a) >>> 0;
    h1 = (h1! + b) >>> 0;
    h2 = (h2! + c) >>> 0;
    h3 = (h3! + d) >>> 0;
    h4 = (h4! + e) >>> 0;
    h5 = (h5! + f) >>> 0;
    h6 = (h6! + g) >>> 0;
    h7 = (h7! + h) >>> 0;
  }
  const words = [h0!, h1!, h2!, h3!, h4!, h5!, h6!, h7!];
  return words.flatMap((word) => [(word >>> 24) & 0xff, (word >>> 16) & 0xff, (word >>> 8) & 0xff, word & 0xff]);
}

export function utf8Bytes(text: string): number[] {
  const out: number[] = [];
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (code < 0x80) out.push(code);
    else if (code < 0x800) out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    else if (code < 0x10000) out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    else
      out.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
  }
  return out;
}

export function sha256Hex(text: string): string {
  return sha256Bytes(utf8Bytes(text))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export interface AvalancheSample {
  flippedBit: number;
  differingBits: number;
  percent: number;
}

/** Flip one message bit at a time and count differing digest bits. */
export function avalancheSamples(text: string, bits = 32): AvalancheSample[] {
  const base = sha256Bytes(utf8Bytes(text));
  const bytes = utf8Bytes(text);
  if (bytes.length === 0) bytes.push(0);
  const out: AvalancheSample[] = [];
  for (let bit = 0; bit < bits; bit += 1) {
    const copy = [...bytes];
    const byteIndex = bit % copy.length;
    copy[byteIndex] = copy[byteIndex]! ^ (1 << (bit % 8));
    const digest = sha256Bytes(copy);
    let differing = 0;
    for (let i = 0; i < 32; i += 1) {
      let x = base[i]! ^ digest[i]!;
      while (x) {
        differing += x & 1;
        x >>= 1;
      }
    }
    out.push({ flippedBit: bit, differingBits: differing, percent: (differing / 256) * 100 });
  }
  return out;
}

// ---- ECC -------------------------------------------------------------------

export interface EcPoint {
  x: bigint;
  y: bigint;
}

export interface EcCurve {
  p: bigint;
  a: bigint;
  b: bigint;
  generator: EcPoint;
  order: bigint;
  label: string;
}

export const P256: EcCurve = {
  p: 0xffffffff00000001000000000000000000000000ffffffffffffffffffffffffn,
  a: -3n,
  b: 0x5ac635d8aa3a93e7b3ebbd55769886bc651d06b0cc53b0f63bce3c3e27d2604bn,
  generator: {
    x: 0x6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296n,
    y: 0x4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5n,
  },
  order: 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n,
  label: 'NIST P-256',
};

export const SMALL_ECC: EcCurve = {
  p: 97n,
  a: 2n,
  b: 3n,
  generator: { x: 3n, y: 6n },
  order: 5n,
  label: 'y² = x³ + 2x + 3 (mod 97)',
};

export function isOnCurve(point: EcPoint | null, curve: EcCurve): boolean {
  if (!point) return true;
  const { x, y } = point;
  if (x < 0n || x >= curve.p || y < 0n || y >= curve.p) return false;
  return mod(y * y, curve.p) === mod(x * x * x + curve.a * x + curve.b, curve.p);
}

export function ecAdd(p1: EcPoint | null, p2: EcPoint | null, curve: EcCurve): EcPoint | null {
  const { p, a } = curve;
  if (!p1) return p2;
  if (!p2) return p1;
  if (p1.x === p2.x) {
    if (mod(p1.y + p2.y, p) === 0n) return null;
    const lambda = mod((3n * p1.x * p1.x + a) * modInverse(2n * p1.y, p), p);
    const x = mod(lambda * lambda - 2n * p1.x, p);
    return { x, y: mod(lambda * (p1.x - x) - p1.y, p) };
  }
  const lambda = mod((p2.y - p1.y) * modInverse(p2.x - p1.x, p), p);
  const x = mod(lambda * lambda - p1.x - p2.x, p);
  return { x, y: mod(lambda * (p1.x - x) - p1.y, p) };
}

export function ecMultiply(k: bigint, point: EcPoint | null, curve: EcCurve): EcPoint | null {
  let result: EcPoint | null = null;
  let addend = point;
  let scalar = k;
  if (scalar < 0n) {
    scalar = -scalar;
    addend = addend ? { x: addend.x, y: mod(-addend.y, curve.p) } : null;
  }
  while (scalar > 0n) {
    if (scalar & 1n) result = ecAdd(result, addend, curve);
    addend = ecAdd(addend, addend, curve);
    scalar >>= 1n;
  }
  return result;
}

/** All affine points of a small curve (for visualisation). */
export function curvePoints(curve: EcCurve): EcPoint[] {
  const out: EcPoint[] = [];
  const p = Number(curve.p);
  for (let x = 0; x < p; x += 1) {
    const rhs = mod(BigInt(x) ** 3n + curve.a * BigInt(x) + curve.b, curve.p);
    for (let y = 0; y < p; y += 1) {
      if (mod(BigInt(y) * BigInt(y), curve.p) === rhs) out.push({ x: BigInt(x), y: BigInt(y) });
    }
  }
  return out;
}

// ---- helpers & benchmarks --------------------------------------------------

export function hexToBytes(hex: string): number[] {
  const clean = hex.replace(/[^0-9a-f]/gi, '');
  const out: number[] = [];
  for (let i = 0; i < clean.length; i += 2) out.push(parseInt(clean.slice(i, i + 2) || '0', 16));
  return out;
}

export function bytesToHex(bytes: ArrayLike<number>): string {
  return Array.from(bytes, (b) => (b & 0xff).toString(16).padStart(2, '0')).join('');
}

export interface CryptoBenchmark {
  id: string;
  labelEn: string;
  labelZh: string;
  measured: number;
  expected: number;
  relErr: number;
  passed: boolean;
}

export function runCryptoBenchmarks(): CryptoBenchmark[] {
  const key = rsaFromPrimes(61n, 53n, 17n);
  const message = 65n;
  const roundTrip = rsaDecryptInt(rsaEncryptInt(message, key), key) === message ? 1 : 0;

  const aesKey = hexToBytes('000102030405060708090a0b0c0d0e0f');
  const aesPlain = hexToBytes('00112233445566778899aabbccddeeff');
  const aesCipher = bytesToHex(aesEncryptBlock(aesPlain, aesKey));

  const digest = sha256Hex('abc');

  const onCurve = isOnCurve(P256.generator, P256) ? 1 : 0;
  const orderOk = ecMultiply(P256.order, P256.generator, P256) === null ? 1 : 0;
  const fermat = modPow(2n, 1_000_000_006n, 1_000_000_007n);

  const cases = [
    {
      id: 'rsa-roundtrip',
      labelEn: 'RSA (p=61, q=53, e=17) round-trip m=65',
      labelZh: 'RSA（p=61, q=53, e=17）对 m=65 往返成功',
      measured: roundTrip,
      expected: 1,
      tol: 0,
    },
    {
      id: 'aes-fips197',
      labelEn: 'AES-128 FIPS-197 test vector',
      labelZh: 'AES-128 FIPS-197 测试向量',
      measured: aesCipher === '69c4e0d86a7b0430d8cdb78070b4c55a' ? 1 : 0,
      expected: 1,
      tol: 0,
    },
    {
      id: 'sha256-abc',
      labelEn: 'SHA-256("abc") = ba7816bf…f20015ad',
      labelZh: 'SHA-256("abc") = ba7816bf…f20015ad',
      measured: digest === 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad' ? 1 : 0,
      expected: 1,
      tol: 0,
    },
    {
      id: 'ecc-p256-mult',
      labelEn: 'P-256: G on curve and n·G = ∞',
      labelZh: 'P-256：G 在曲线上且 n·G = ∞',
      measured: onCurve && orderOk ? 1 : 0,
      expected: 1,
      tol: 0,
    },
    {
      id: 'fermat-little',
      labelEn: 'Fermat: 2^(p−1) ≡ 1 (mod p)',
      labelZh: '费马小定理：2^(p−1) ≡ 1 (mod p)',
      measured: Number(fermat),
      expected: 1,
      tol: 0,
    },
  ];
  return cases.map((c) => {
    const denom = Math.abs(c.expected) || 1;
    const relErr = Math.abs(c.measured - c.expected) / denom;
    return { ...c, relErr, passed: relErr <= c.tol };
  });
}

export interface CryptoParams {
  p: bigint;
  q: bigint;
  e: bigint;
  message: string;
  aesKey: string;
  aesPlaintext: string;
}

export const DEFAULT_CRYPTO_PARAMS: CryptoParams = {
  p: 61n,
  q: 53n,
  e: 17n,
  message: 'hello',
  aesKey: '000102030405060708090a0b0c0d0e0f',
  aesPlaintext: '00112233445566778899aabbccddeeff',
};

/** Parse JSON or key=value lines; unknown keys are ignored. */
export function parseCryptoParams(text: string): Partial<CryptoParams> {
  const out: Partial<CryptoParams> = {};
  const trimmed = text.trim();
  if (trimmed.startsWith('{')) {
    try {
      const obj = JSON.parse(trimmed) as Record<string, unknown>;
      for (const key of ['p', 'q', 'e'] as const) {
        const v = obj[key];
        if (typeof v === 'string' || typeof v === 'number') {
          try {
            out[key] = BigInt(v);
          } catch {
            /* ignore */
          }
        }
      }
      if (typeof obj.message === 'string') out.message = obj.message;
      if (typeof obj.aesKey === 'string') out.aesKey = obj.aesKey;
      if (typeof obj.aesPlaintext === 'string') out.aesPlaintext = obj.aesPlaintext;
      return out;
    } catch {
      return out;
    }
  }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = /^([a-zA-Z]+)\s*[:=]\s*(.+)$/.exec(line);
    if (!m) continue;
    const key = m[1]!;
    const value = m[2]!.trim();
    if (key === 'p' || key === 'q' || key === 'e') {
      try {
        out[key] = BigInt(value);
      } catch {
        /* ignore */
      }
    } else if (key === 'message') out.message = value;
    else if (key === 'aesKey') out.aesKey = value;
    else if (key === 'aesPlaintext') out.aesPlaintext = value;
  }
  return out;
}

/** Text → integer block for the teaching RSA demo (UTF-8 big-endian). */
export function textToInt(text: string): bigint {
  const bytes = utf8Bytes(text);
  let value = 0n;
  for (const b of bytes) value = (value << 8n) | BigInt(b);
  return value;
}

export function intToText(value: bigint): string {
  const bytes: number[] = [];
  let v = value;
  if (v === 0n) bytes.push(0);
  while (v > 0n) {
    bytes.unshift(Number(v & 0xffn));
    v >>= 8n;
  }
  try {
    return new TextDecoder().decode(new Uint8Array(bytes));
  } catch {
    return bytesToHex(bytes);
  }
}
