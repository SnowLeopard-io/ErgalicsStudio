import type { PluginManifest } from '@/types/plugin';

export const cryptoManifest: PluginManifest = {
  id: 'example.crypto',
  name: 'Cryptography Lab',
  nameI18n: { 'zh-CN': '密码学实验室', 'en-US': 'Cryptography Lab' },
  version: '1.0.0',
  author: 'Ergalics',
  description:
    'Textbook RSA with BigInt key generation, an AES-128 round-by-round trace, SHA-256 with an avalanche-effect bit-difference chart, and an ECC point-arithmetic playground over a small prime field. Includes digital-signature workflow and published test vectors.',
  descriptionI18n: {
    'zh-CN':
      '基于 BigInt 的教科书式 RSA 密钥生成、AES-128 逐轮轨迹、带雪崩效应位差图的 SHA-256，以及小素数域上的 ECC 点运算演练。包含数字签名流程与公开测试向量。',
    'en-US':
      'Textbook RSA with BigInt key generation, an AES-128 round-by-round trace, SHA-256 with an avalanche-effect bit-difference chart, and an ECC point-arithmetic playground over a small prime field. Includes digital-signature workflow and published test vectors.',
  },
  license: 'MIT',
  entry: 'example.crypto',
  category: 'scientific',
  sandbox: 'trusted',
  research: {
    tier: 'quasi-research',
    units: { bits: 'bit', modulusBits: 'bit', avalanchePercent: '%' },
    benchmarks: ['rsa-roundtrip', 'aes-fips197', 'sha256-abc', 'ecc-p256-mult', 'fermat-little'],
    reproducible: true,
    notes:
      'RSA key generation uses small teaching primes and is not constant-time — never use it for real secrets. AES-128 follows FIPS-197 with the standard S-box and key schedule; SHA-256 follows FIPS-180-4. The ECC panel uses short Weierstrass curves over small prime fields for visualisation, while the benchmark checks the NIST P-256 base-point multiplication against its published coordinates.',
    notesI18n: {
      'zh-CN':
        'RSA 密钥生成使用小教学素数且非恒定时间，绝不可用于真实机密。AES-128 遵循 FIPS-197 的标准 S 盒与密钥扩展；SHA-256 遵循 FIPS-180-4。ECC 面板在小素数域上的短 Weierstrass 曲线上做可视化，而基准用 NIST P-256 基点乘法核对公开坐标。',
      'en-US':
        'RSA key generation uses small teaching primes and is not constant-time — never use it for real secrets. AES-128 follows FIPS-197 with the standard S-box and key schedule; SHA-256 follows FIPS-180-4. The ECC panel uses short Weierstrass curves over small prime fields for visualisation, while the benchmark checks the NIST P-256 base-point multiplication against its published coordinates.',
    },
  },
  formats: [
    { extension: '.json', mimeTypes: ['application/json'], description: 'RSA demo parameters: { p, q, e, message }' },
    { extension: '.txt', mimeTypes: ['text/plain'], description: 'key=value parameters, # comments allowed' },
  ],
  signature: {
    alg: 'ed25519',
    fingerprint: 'ed25519:790901b82a89fe505b5f98e2b7bf28e3',
    sig: '9e52a0ee78b2a6b0617adf5e254c18a180da4fbb06966ae9e7103039bf33fdfbe16fd4f2fdb1d00cfeafcd44238d3e9191594b3dd5b56bd46afd02f615297e05',
    signer: 'Ergalics Studio (cs pack)',
    signedAt: '2026-10-28T00:00:00.000Z',
    pub: '0d7550754e0800a5d237eef5826035766b9b3e5a15868a940ab289958788e3b0',
  },
};
