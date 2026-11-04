// ==========================================================================
// crypto — Cryptography Lab
//
// Four teaching views: textbook RSA, AES-128 round trace, SHA-256 avalanche
// effect and short-Weierstrass ECC point arithmetic. Educational code only —
// not constant-time and never for real secrets.
// ==========================================================================

import type { ContainerCapabilities, ParamDefinition, Plugin, PluginApi } from '@/types/plugin';
import { actionButton, actionFired, exportRowsCsv, notify } from '@/core/plugin-tools/enhance';
import { clearScienceOutputs, fmtMetric, setScienceOutputs, type ScienceMetric } from '@/core/research/scienceOutput';
import { pushPanelsToFigure, type Bilingual } from '@/core/figure/sheet';
import {
  CS,
  clamp,
  drawCard,
  drawFootnote,
  drawHeader,
  drawTable,
  font,
  prepareCanvas,
  plotBox,
} from '../../shared/cs-utils';
import { cryptoFigurePanels } from './figure';
import { cryptoManifest } from './manifest';
import {
  AES_SBOX,
  DEFAULT_CRYPTO_PARAMS,
  SMALL_ECC,
  aesEncryptBlock,
  aesTrace,
  avalancheSamples,
  bytesToHex,
  curvePoints,
  ecMultiply,
  hexToBytes,
  intToText,
  isOnCurve,
  parseCryptoParams,
  rsaDecryptInt,
  rsaEncryptInt,
  rsaFromPrimes,
  runCryptoBenchmarks,
  sha256Hex,
  textToInt,
  type RsaKey,
} from './kernel';

export { cryptoManifest } from './manifest';

type ModeId = 'rsa' | 'aes' | 'hash' | 'ecc';

interface State {
  mode: ModeId;
  p: number;
  q: number;
  e: number;
  message: string;
  aesKey: string;
  aesPlaintext: string;
  hashText: string;
  scalar: number;
}

export class CryptographyPlugin implements Plugin {
  readonly manifest = cryptoManifest;
  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  private zh = false;
  private state: State = {
    mode: 'rsa',
    p: Number(DEFAULT_CRYPTO_PARAMS.p),
    q: Number(DEFAULT_CRYPTO_PARAMS.q),
    e: Number(DEFAULT_CRYPTO_PARAMS.e),
    message: 'A',
    aesKey: DEFAULT_CRYPTO_PARAMS.aesKey,
    aesPlaintext: DEFAULT_CRYPTO_PARAMS.aesPlaintext,
    hashText: 'The quick brown fox jumps over the lazy dog',
    scalar: 7,
  };

  async init(api: PluginApi) {
    this.api = api;
    this.zh = api.locale === 'zh-CN';
    api.onLocaleChange((l) => {
      this.zh = l === 'zh-CN';
      this.draw();
    });
  }

  async destroy() {
    clearScienceOutputs(this.manifest.id);
    this.ctx = null;
  }

  async activate(context: { container: ContainerCapabilities }) {
    this.ctx = context.container;
  }

  async deactivate() {}

  render(container: ContainerCapabilities) {
    this.ctx = container;
    this.draw();
  }

  getParams(): ParamDefinition[] {
    const s = this.state;
    return [
      {
        key: 'mode',
        label: 'Primitive',
        labelI18n: { 'zh-CN': '密码原语', 'en-US': 'Primitive' },
        type: 'select',
        options: [
          { value: 'rsa', label: 'RSA' },
          { value: 'aes', label: 'AES-128' },
          { value: 'hash', label: 'SHA-256' },
          { value: 'ecc', label: 'ECC' },
        ],
        value: s.mode,
      },
      { key: 'p', label: 'Prime p', labelI18n: { 'zh-CN': '素数 p', 'en-US': 'Prime p' }, type: 'number', min: 3, max: 9973, step: 1, value: s.p, visibleWhen: { key: 'mode', in: ['rsa'] } },
      { key: 'q', label: 'Prime q', labelI18n: { 'zh-CN': '素数 q', 'en-US': 'Prime q' }, type: 'number', min: 3, max: 9973, step: 1, value: s.q, visibleWhen: { key: 'mode', in: ['rsa'] } },
      { key: 'e', label: 'Public exponent e', labelI18n: { 'zh-CN': '公钥指数 e', 'en-US': 'Public exponent e' }, type: 'number', min: 3, max: 65537, step: 2, value: s.e, visibleWhen: { key: 'mode', in: ['rsa'] } },
      { key: 'message', label: 'Message', labelI18n: { 'zh-CN': '消息', 'en-US': 'Message' }, type: 'text', value: s.message, visibleWhen: { key: 'mode', in: ['rsa'] } },
      { key: 'aesKey', label: 'AES key (hex, 16 bytes)', labelI18n: { 'zh-CN': 'AES 密钥（hex，16 字节）', 'en-US': 'AES key (hex, 16 bytes)' }, type: 'text', value: s.aesKey, visibleWhen: { key: 'mode', in: ['aes'] } },
      { key: 'aesPlaintext', label: 'Plaintext block (hex)', labelI18n: { 'zh-CN': '明文分组（hex）', 'en-US': 'Plaintext block (hex)' }, type: 'text', value: s.aesPlaintext, visibleWhen: { key: 'mode', in: ['aes'] } },
      { key: 'hashText', label: 'Hash input', labelI18n: { 'zh-CN': '哈希输入', 'en-US': 'Hash input' }, type: 'text', value: s.hashText, visibleWhen: { key: 'mode', in: ['hash'] } },
      { key: 'scalar', label: 'ECC scalar k', labelI18n: { 'zh-CN': 'ECC 标量 k', 'en-US': 'ECC scalar k' }, type: 'range', min: 1, max: 20, step: 1, value: s.scalar, visibleWhen: { key: 'mode', in: ['ecc'] } },
      actionButton('benchmark', 'Run validation benchmarks', '运行验证基准', 'primary'),
      actionButton('exportCsv', 'Export primitive data CSV', '导出原语数据 CSV'),
      actionButton('sendToFigure', 'Send to Figure Studio', '发送到 Figure Studio'),
    ];
  }

  updateParams(params: Record<string, unknown>) {
    let changed = false;
    if (typeof params.mode === 'string' && ['rsa', 'aes', 'hash', 'ecc'].includes(params.mode) && params.mode !== this.state.mode) {
      this.state.mode = params.mode as ModeId;
      changed = true;
    }
    for (const key of ['p', 'q', 'e'] as const) {
      if (typeof params[key] === 'number' && Number.isFinite(params[key])) {
        const v = Math.trunc(params[key] as number);
        if (v !== this.state[key]) {
          this.state[key] = v;
          changed = true;
        }
      }
    }
    for (const key of ['message', 'aesKey', 'aesPlaintext', 'hashText'] as const) {
      if (typeof params[key] === 'string' && params[key] !== this.state[key]) {
        this.state[key] = params[key] as string;
        changed = true;
      }
    }
    if (typeof params.scalar === 'number' && Number.isFinite(params.scalar)) {
      const scalar = clamp(Math.round(params.scalar), 1, 20);
      if (scalar !== this.state.scalar) {
        this.state.scalar = scalar;
        changed = true;
      }
    }
    if (actionFired(params, 'benchmark')) {
      this.runBenchmark();
      return;
    }
    if (actionFired(params, 'exportCsv')) {
      this.exportCsv();
      return;
    }
    if (actionFired(params, 'sendToFigure')) {
      void this.sendToFigure();
      return;
    }
    if (changed) this.draw();
  }

  getSupportedFormats() {
    return this.manifest.formats ?? [];
  }

  async loadData(file: File) {
    const parsed = parseCryptoParams(await file.text());
    if (parsed.p !== undefined) this.state.p = Number(parsed.p);
    if (parsed.q !== undefined) this.state.q = Number(parsed.q);
    if (parsed.e !== undefined) this.state.e = Number(parsed.e);
    if (parsed.message) this.state.message = parsed.message;
    if (parsed.aesKey) this.state.aesKey = parsed.aesKey;
    if (parsed.aesPlaintext) this.state.aesPlaintext = parsed.aesPlaintext;
    this.draw();
    notify(
      this.api,
      'success',
      `Loaded cryptographic parameters from ${file.name}.`,
      `已从 ${file.name} 载入密码学参数。`,
    );
  }

  compute(input: unknown) {
    const text = typeof input === 'string' ? input : this.state.hashText;
    return Promise.resolve({ ok: true as const, output: { sha256: sha256Hex(text), avalanche: avalancheSamples(text, 32) } });
  }

  // ---- model -----------------------------------------------------------------

  private rsa(): RsaKey | null {
    try {
      return rsaFromPrimes(BigInt(this.state.p), BigInt(this.state.q), BigInt(this.state.e));
    } catch {
      return null;
    }
  }

  private aesData() {
    const key = hexToBytes(this.state.aesKey);
    const plain = hexToBytes(this.state.aesPlaintext);
    if (key.length !== 16 || plain.length !== 16) return null;
    try {
      return { key, plain, cipher: aesEncryptBlock(plain, key), trace: aesTrace(plain, key) };
    } catch {
      return null;
    }
  }

  private hashData() {
    const samples = avalancheSamples(this.state.hashText, 32);
    const avg = samples.reduce((s, x) => s + x.differingBits, 0) / Math.max(1, samples.length);
    return { digest: sha256Hex(this.state.hashText), samples, avg };
  }

  private eccData() {
    const points = curvePoints(SMALL_ECC);
    const multiples = Array.from({ length: Math.min(this.state.scalar, 20) }, (_, i) =>
      ecMultiply(BigInt(i + 1), SMALL_ECC.generator, SMALL_ECC),
    );
    return { points, multiples };
  }

  private runBenchmark() {
    const bench = runCryptoBenchmarks();
    const failed = bench.filter((b) => !b.passed);
    const metrics: ScienceMetric[] = bench.map((b) => ({
      key: `bench-${b.id}`,
      label: this.zh ? b.labelZh : b.labelEn,
      value: fmtMetric(b.relErr),
      severity: b.passed ? 'ok' : 'error',
      hint: `${b.measured} / ${b.expected}`,
    }));
    setScienceOutputs(this.manifest.id, metrics);
    notify(
      this.api,
      failed.length === 0 ? 'success' : 'warning',
      failed.length === 0 ? `All ${bench.length} cryptography benchmarks passed.` : `${failed.length}/${bench.length} benchmarks failed.`,
      failed.length === 0 ? `全部 ${bench.length} 项密码学基准通过。` : `${failed.length}/${bench.length} 项基准未通过。`,
    );
  }

  private exportCsv() {
    if (this.state.mode === 'rsa') {
      const key = this.rsa();
      if (!key) {
        notify(this.api, 'warning', 'RSA parameters are invalid.', 'RSA 参数无效。');
        return;
      }
      const m = textToInt(this.state.message) % key.n;
      const c = rsaEncryptInt(m, key);
      const back = rsaDecryptInt(c, key);
      exportRowsCsv(this.api, 'rsa-demo', ['field', 'value'], [
        ['p', key.p.toString()],
        ['q', key.q.toString()],
        ['n', key.n.toString()],
        ['phi', key.phi.toString()],
        ['e', key.e.toString()],
        ['d', key.d.toString()],
        ['m', m.toString()],
        ['c', c.toString()],
        ['decrypted', back.toString()],
        ['text', intToText(back)],
      ]);
      return;
    }
    if (this.state.mode === 'aes') {
      const data = this.aesData();
      if (!data) {
        notify(this.api, 'warning', 'AES key/plaintext must be 16 hex bytes.', 'AES 密钥/明文必须是 16 字节 hex。');
        return;
      }
      exportRowsCsv(
        this.api,
        'aes-round-trace',
        ['round', 'sub_bytes', 'shift_rows', 'mix_columns', 'round_key'],
        data.trace.map((r) => [r.round, bytesToHex(r.afterSubBytes), bytesToHex(r.afterShiftRows), r.afterMixColumns ? bytesToHex(r.afterMixColumns) : '', bytesToHex(r.roundKey)]),
      );
      return;
    }
    if (this.state.mode === 'hash') {
      const data = this.hashData();
      exportRowsCsv(this.api, 'sha256-avalanche', ['flipped_bit', 'differing_bits', 'percent'], data.samples.map((s) => [s.flippedBit, s.differingBits, Number(s.percent.toFixed(2))]));
      return;
    }
    const data = this.eccData();
    exportRowsCsv(
      this.api,
      'ecc-multiples',
      ['k', 'x', 'y', 'on_curve'],
      data.multiples.map((p, i) => [i + 1, p ? p.x.toString() : '∞', p ? p.y.toString() : '', p ? (isOnCurve(p, SMALL_ECC) ? 1 : 0) : 1]),
    );
  }

  private async sendToFigure() {
    const hash = this.hashData();
    const ecc = this.eccData();
    const caption: Bilingual = {
      zh: `密码学实验室：SHA-256 雪崩效应平均 ${hash.avg.toFixed(1)}/256 位翻转；小曲线 y²=x³+2x+3 (mod 97) 上 ${ecc.points.length} 个仿射点，${this.state.scalar}·G 已标出。`,
      en: `Cryptography Lab: SHA-256 avalanche averages ${hash.avg.toFixed(1)}/256 flipped bits; ${ecc.points.length} affine points on y²=x³+2x+3 (mod 97), with ${this.state.scalar}·G highlighted.`,
    };
    await pushPanelsToFigure(
      this.api,
      { zh: '密码学演示', en: 'Cryptography Demonstration' },
      caption,
      cryptoFigurePanels({ hash, ecc, aes: this.aesData() }),
    );
  }

  // ---- drawing ---------------------------------------------------------------

  private draw() {
    const frame = prepareCanvas(this.ctx?.canvas2d);
    if (!frame) return;
    const { g, w, h } = frame;
    this.publish();
    drawHeader(
      g,
      w,
      this.zh ? '密码学实验室' : 'Cryptography Lab',
      this.zh ? '教学实现 · 非恒定时间 · 不可用于真实机密' : 'teaching implementation · not constant-time · never for real secrets',
      this.zh,
    );
    if (this.state.mode === 'aes') this.drawAes(g, w, h);
    else if (this.state.mode === 'hash') this.drawHash(g, w, h);
    else if (this.state.mode === 'ecc') this.drawEcc(g, w, h);
    else this.drawRsa(g, w, h);
  }

  private publish() {
    const metrics: ScienceMetric[] = [];
    if (this.state.mode === 'rsa') {
      const key = this.rsa();
      metrics.push(
        { key: 'modulus', label: 'Modulus bits', value: fmtMetric(key?.bits ?? 0), unit: 'bit', severity: key && key.bits > 64 ? 'ok' : 'warn', hint: key ? `n = ${key.n}` : 'invalid parameters' },
        { key: 'phi', label: 'φ(n)', value: key ? key.phi.toString() : '—', severity: 'info' },
        { key: 'd', label: 'Private d', value: key ? key.d.toString() : '—', severity: 'info', hint: 'd·e ≡ 1 (mod φ(n))' },
      );
    } else if (this.state.mode === 'aes') {
      const data = this.aesData();
      metrics.push(
        { key: 'aes-rounds', label: 'AES rounds', value: '10', unit: 'round', severity: data ? 'ok' : 'error' },
        { key: 'aes-cipher', label: 'Ciphertext', value: data ? bytesToHex(data.cipher).slice(0, 16) + '…' : 'invalid key/block', severity: data ? 'ok' : 'error', hint: data ? bytesToHex(data.cipher) : '16 hex bytes required' },
        { key: 'sbox', label: 'S-box entries', value: String(AES_SBOX.length), unit: 'byte', severity: 'info', hint: 'generated from GF(2⁸) inverse + affine map' },
      );
    } else if (this.state.mode === 'hash') {
      const data = this.hashData();
      metrics.push(
        { key: 'digest', label: 'SHA-256', value: data.digest.slice(0, 16) + '…', severity: 'ok', hint: data.digest },
        { key: 'avalanche', label: 'Avalanche average', value: data.avg.toFixed(2), unit: '/256 bit', severity: Math.abs(data.avg - 128) < 24 ? 'ok' : 'warn', hint: 'ideal ≈ 128 / 256 bits (50%)' },
        { key: 'samples', label: 'Flipped-bit trials', value: String(data.samples.length), unit: 'trial', severity: 'info' },
      );
    } else {
      const data = this.eccData();
      const p = data.multiples.at(-1) ?? null;
      metrics.push(
        { key: 'curve-points', label: 'Affine points', value: String(data.points.length), unit: 'point', severity: 'info', hint: SMALL_ECC.label },
        { key: 'scalar', label: 'Scalar k', value: String(this.state.scalar), severity: 'info' },
        { key: 'kg', label: 'k·G', value: p ? `(${p.x}, ${p.y})` : '∞', severity: p ? 'ok' : 'warn', hint: p && isOnCurve(p, SMALL_ECC) ? 'on curve' : 'point at infinity' },
      );
    }
    setScienceOutputs(this.manifest.id, metrics);
  }

  private drawRsa(g: CanvasRenderingContext2D, w: number, h: number) {
    const key = this.rsa();
    if (!key) {
      g.fillStyle = CS.red;
      g.font = font(this.zh, 12);
      g.textAlign = 'center';
      g.fillText(this.zh ? '参数无效：p、q 必须为不同素数，且 gcd(e, φ(n)) = 1。' : 'Invalid parameters: p and q must be distinct primes with gcd(e, φ(n)) = 1.', w / 2, h / 2);
      return;
    }
    const m = textToInt(this.state.message) % key.n;
    const c = rsaEncryptInt(m, key);
    const back = rsaDecryptInt(c, key);
    const cards = [
      ['p', key.p.toString()],
      ['q', key.q.toString()],
      ['n = p·q', key.n.toString()],
      ['φ(n)', key.phi.toString()],
      ['e', key.e.toString()],
      ['d = e⁻¹ mod φ', key.d.toString()],
    ];
    const cols = 3;
    const cw = (w - 64) / cols;
    cards.forEach(([label, value], i) => {
      const x = 32 + (i % cols) * cw;
      const y = 66 + Math.floor(i / cols) * 74;
      drawCard(g, x, y, cw - 12, 60, i >= 2 && i < 4 ? 'rgba(255,209,102,0.5)' : CS.grid);
      g.textAlign = 'left';
      g.font = font(false, 9);
      g.fillStyle = CS.faint;
      g.fillText(label!, x + 12, y + 19);
      g.font = font(false, 13, '700');
      g.fillStyle = CS.text;
      g.fillText(value!, x + 12, y + 43);
    });
    const box = plotBox(w, h, 58, 224, 36, 80);
    const stages = [
      { label: 'message m', value: m.toString(), color: CS.blue },
      { label: 'c = mᵉ mod n', value: c.toString(), color: CS.amber },
      { label: 'm′ = cᵈ mod n', value: back.toString(), color: CS.cyan },
    ];
    const gap = box.w / stages.length;
    stages.forEach((stage, i) => {
      const x = box.x0 + i * gap + gap / 2;
      drawCard(g, x - gap * 0.4, box.y0 + 10, gap * 0.8, 58, stage.color);
      g.textAlign = 'center';
      g.font = font(false, 9);
      g.fillStyle = CS.faint;
      g.fillText(stage.label, x, box.y0 + 29);
      g.font = font(false, 13, '700');
      g.fillStyle = stage.color;
      g.fillText(stage.value.length > 22 ? `${stage.value.slice(0, 20)}…` : stage.value, x, box.y0 + 52);
      if (i < 2) {
        g.strokeStyle = 'rgba(166,180,201,0.4)';
        g.beginPath();
        g.moveTo(x + gap * 0.42, box.y0 + 39);
        g.lineTo(x + gap * 0.58, box.y0 + 39);
        g.stroke();
      }
    });
    g.textAlign = 'center';
    g.font = font(this.zh, 10);
    g.fillStyle = back === m ? CS.green : CS.red;
    g.fillText(
      back === m
        ? this.zh
          ? `往返成功：解密文本 “${intToText(back)}” · 模数仅 ${key.bits} 位，仅用于教学。`
          : `Round-trip OK: “${intToText(back)}” · only ${key.bits}-bit modulus, teaching use only.`
        : this.zh
          ? '往返失败：请检查参数。'
          : 'Round-trip failed — check parameters.',
      w / 2,
      h - 26,
    );
  }

  private drawAes(g: CanvasRenderingContext2D, w: number, h: number) {
    const data = this.aesData();
    if (!data) {
      g.fillStyle = CS.red;
      g.font = font(this.zh, 12);
      g.textAlign = 'center';
      g.fillText(this.zh ? 'AES 需要 16 字节密钥与 16 字节明文（32 个 hex 字符）。' : 'AES needs 16-byte key and plaintext (32 hex characters each).', w / 2, h / 2);
      return;
    }
    const labelY = 66;
    g.textAlign = 'center';
    g.font = font(false, 9);
    g.fillStyle = CS.faint;
    g.fillText('plaintext', w / 2 - 210, labelY);
    g.fillText('ciphertext', w / 2 + 210, labelY);
    drawStateGrid(g, bytesToHex(data.plain), w / 2 - 270, labelY + 12, 120, 120, false);
    drawStateGrid(g, bytesToHex(data.cipher), w / 2 + 150, labelY + 12, 120, 120, true);
    g.strokeStyle = 'rgba(255,209,102,0.5)';
    g.beginPath();
    g.moveTo(w / 2 - 137, labelY + 72);
    g.lineTo(w / 2 + 137, labelY + 72);
    g.stroke();
    g.fillStyle = CS.amber;
    g.font = font(false, 10);
    g.fillText('10 rounds · SubBytes → ShiftRows → MixColumns → AddRoundKey', w / 2, labelY + 63);
    drawTable(
      g,
      w,
      h,
      ['round', 'SubBytes', 'ShiftRows', 'MixColumns', 'AddRoundKey'],
      data.trace.map((r) => [
        r.round,
        bytesToHex(r.afterSubBytes).slice(0, 16) + '…',
        bytesToHex(r.afterShiftRows).slice(0, 16) + '…',
        r.afterMixColumns ? bytesToHex(r.afterMixColumns).slice(0, 16) + '…' : '— (final)',
        bytesToHex(r.roundKey).slice(0, 16) + '…',
      ]),
      { top: 230, rowHeight: 22 },
    );
  }

  private drawHash(g: CanvasRenderingContext2D, w: number, h: number) {
    const data = this.hashData();
    const box = plotBox(w, h, 60, 90, 30, 70);
    const max = Math.max(1, ...data.samples.map((s) => s.differingBits));
    const bw = box.w / data.samples.length;
    g.strokeStyle = CS.grid;
    g.strokeRect(box.x0, box.y0, box.w, box.h);
    g.setLineDash([4, 4]);
    g.strokeStyle = 'rgba(255,209,102,0.55)';
    g.beginPath();
    g.moveTo(box.x0, box.y1 - (128 / 256) * box.h);
    g.lineTo(box.x1, box.y1 - (128 / 256) * box.h);
    g.stroke();
    g.setLineDash([]);
    data.samples.forEach((s, i) => {
      const bh = (s.differingBits / Math.max(256, max)) * box.h;
      g.fillStyle = i % 2 ? 'rgba(180,140,255,0.72)' : 'rgba(120,200,255,0.72)';
      g.fillRect(box.x0 + i * bw + 1, box.y1 - bh, Math.max(1, bw - 2), bh);
    });
    g.textAlign = 'center';
    g.font = font(false, 9);
    g.fillStyle = CS.faint;
    g.fillText('0', box.x0, box.y1 + 14);
    g.fillText('31', box.x1, box.y1 + 14);
    g.fillStyle = CS.dim;
    g.font = font(this.zh, 10);
    g.fillText(this.zh ? '翻转的消息位' : 'flipped message bit', (box.x0 + box.x1) / 2, box.y1 + 32);
    drawCard(g, box.x0, 62, box.w, 22);
    g.fillStyle = CS.text;
    g.font = font(false, 10);
    g.textAlign = 'left';
    g.fillText(data.digest, box.x0 + 10, 76);
    drawFootnote(
      g,
      w,
      h,
      this.zh
        ? `平均 ${data.avg.toFixed(1)}/256 位翻转（理想约 128/256）· 单比特输入变化应雪崩到约一半摘要位。`
        : `Average ${data.avg.toFixed(1)}/256 flipped bits (ideal ≈ 128/256) · one input bit should avalanche to about half the digest.`,
      this.zh,
    );
  }

  private drawEcc(g: CanvasRenderingContext2D, w: number, h: number) {
    const data = this.eccData();
    const box = plotBox(w, h, 58, 68, 32, 60);
    drawCard(g, box.x0, box.y0, box.w, box.h);
    const p = Number(SMALL_ECC.p);
    const px = (x: number) => box.x0 + (x / p) * box.w;
    const py = (y: number) => box.y1 - (y / p) * box.h;
    g.fillStyle = 'rgba(120,200,255,0.38)';
    for (const point of data.points) {
      g.beginPath();
      g.arc(px(Number(point.x)), py(Number(point.y)), 1.5, 0, Math.PI * 2);
      g.fill();
    }
    data.multiples.forEach((point, i) => {
      if (!point) return;
      const x = px(Number(point.x));
      const y = py(Number(point.y));
      g.strokeStyle = i === data.multiples.length - 1 ? CS.amber : 'rgba(255,139,134,0.65)';
      g.fillStyle = i === data.multiples.length - 1 ? CS.amber : 'rgba(255,139,134,0.65)';
      g.beginPath();
      g.arc(x, y, i === data.multiples.length - 1 ? 5 : 2.8, 0, Math.PI * 2);
      g.fill();
      if (i < 6 || i === data.multiples.length - 1) {
        g.font = font(false, 8.5);
        g.textAlign = 'left';
        g.fillText(`${i + 1}G`, x + 6, y - 4);
      }
    });
    const last = data.multiples.at(-1);
    drawFootnote(
      g,
      w,
      h,
      zhText(
        this.zh,
        `${SMALL_ECC.label} · ${data.points.length} 个仿射点 · ${this.state.scalar}G = ${last ? `(${last.x}, ${last.y})` : '∞'}`,
        `${SMALL_ECC.label} · ${data.points.length} affine points · ${this.state.scalar}G = ${last ? `(${last.x}, ${last.y})` : '∞'}`,
      ),
      this.zh,
    );
  }
}

function drawStateGrid(
  g: CanvasRenderingContext2D,
  hex: string,
  x: number,
  y: number,
  w: number,
  h: number,
  cipher: boolean,
): void {
  const bytes = hexToBytes(hex);
  const cw = w / 4;
  const ch = h / 4;
  for (let r = 0; r < 4; r += 1) {
    for (let c = 0; c < 4; c += 1) {
      const i = c * 4 + r;
      const value = bytes[i] ?? 0;
      const intensity = value / 255;
      g.fillStyle = cipher
        ? `rgba(${Math.round(120 + 135 * intensity)}, ${Math.round(70 + 110 * intensity)}, ${Math.round(200 + 55 * intensity)}, 0.88)`
        : `rgba(${Math.round(60 + 90 * intensity)}, ${Math.round(120 + 100 * intensity)}, ${Math.round(180 + 75 * intensity)}, 0.88)`;
      g.fillRect(x + c * cw + 1, y + r * ch + 1, cw - 2, ch - 2);
      g.fillStyle = 'rgba(8,11,16,0.9)';
      g.font = font(false, 9, '700');
      g.textAlign = 'center';
      g.fillText(value.toString(16).padStart(2, '0'), x + c * cw + cw / 2, y + r * ch + ch / 2 + 3);
    }
  }
}

function zhText(zh: boolean, zhTextValue: string, en: string): string {
  return zh ? zhTextValue : en;
}

export default function createCryptographyPlugin(): Plugin {
  return new CryptographyPlugin();
}
