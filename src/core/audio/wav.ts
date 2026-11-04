// ==========================================================================
// Ergalics Studio — RIFF/WAVE codec (pure TS, no Web Audio)
//
// Used by the Acoustics and Synthesizer labs to decode user-supplied WAV
// files and to export rendered sounds. Keeping the codec pure means the
// kernels stay testable in Node (jsdom has no AudioContext).
//
// Supported decode: PCM 8/16/24/32-bit, IEEE float 32/64-bit, mono or
// multichannel. Multichannel clips keep their per-channel arrays; the
// mono `samples` field is the arithmetic channel average used for analysis.
// ==========================================================================

export interface DecodedWav {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  /** Duration in seconds. */
  duration: number;
  /** Channel-averaged mono signal (used for waveform / spectrum analysis). */
  samples: Float64Array;
  /** Per-channel signals. */
  channelData: Float64Array[];
  codec: 'pcm' | 'float';
}

export class WavError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WavError';
  }
}

const ascii = (view: DataView, offset: number, len: number): string => {
  let s = '';
  for (let i = 0; i < len; i += 1) s += String.fromCharCode(view.getUint8(offset + i));
  return s;
};

/** Decode a WAV file held in an ArrayBuffer. Throws `WavError` on bad input. */
export function decodeWav(buffer: ArrayBuffer): DecodedWav {
  const view = new DataView(buffer);
  if (buffer.byteLength < 44) throw new WavError('File is too short to be a WAV file.');
  if (ascii(view, 0, 4) !== 'RIFF' || ascii(view, 8, 4) !== 'WAVE') {
    throw new WavError('Not a RIFF/WAVE file (missing RIFF/WAVE header).');
  }

  let offset = 12;
  let fmt: {
    audioFormat: number;
    channels: number;
    sampleRate: number;
    bitsPerSample: number;
  } | null = null;
  let dataOffset = -1;
  let dataLength = 0;

  while (offset + 8 <= buffer.byteLength) {
    const id = ascii(view, offset, 4);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (id === 'fmt ') {
      if (body + 16 > buffer.byteLength) throw new WavError('Truncated fmt chunk.');
      let audioFormat = view.getUint16(body, true);
      const channels = view.getUint16(body + 2, true);
      const sampleRate = view.getUint32(body + 4, true);
      const bitsPerSample = view.getUint16(body + 14, true);
      // WAVE_FORMAT_EXTENSIBLE carries the real format in the sub-format GUID.
      if (audioFormat === 0xfffe && size >= 40 && body + 26 <= buffer.byteLength) {
        audioFormat = view.getUint16(body + 24, true);
      }
      fmt = { audioFormat, channels, sampleRate, bitsPerSample };
    } else if (id === 'data') {
      dataOffset = body;
      dataLength = Math.min(size, buffer.byteLength - body);
    }
    // Chunks are word-aligned.
    offset = body + size + (size & 1);
  }

  if (!fmt) throw new WavError('WAV file has no fmt chunk.');
  if (dataOffset < 0) throw new WavError('WAV file has no data chunk.');
  const { audioFormat, channels, sampleRate, bitsPerSample } = fmt;
  if (channels < 1 || channels > 32) throw new WavError(`Unsupported channel count: ${channels}.`);
  if (!(sampleRate >= 1000 && sampleRate <= 768000)) {
    throw new WavError(`Unsupported sample rate: ${sampleRate} Hz.`);
  }

  const bytesPerSample = bitsPerSample / 8;
  const frameBytes = bytesPerSample * channels;
  if (!Number.isInteger(bytesPerSample) || frameBytes <= 0) {
    throw new WavError(`Unsupported bit depth: ${bitsPerSample}.`);
  }
  const frames = Math.floor(dataLength / frameBytes);
  if (frames <= 0) throw new WavError('WAV data chunk is empty.');

  const isFloat = audioFormat === 3;
  const isPcm = audioFormat === 1;
  if (!isFloat && !isPcm) throw new WavError(`Unsupported WAV encoding (format tag ${audioFormat}).`);
  if (isPcm && ![8, 16, 24, 32].includes(bitsPerSample)) {
    throw new WavError(`Unsupported PCM bit depth: ${bitsPerSample}.`);
  }
  if (isFloat && ![32, 64].includes(bitsPerSample)) {
    throw new WavError(`Unsupported float bit depth: ${bitsPerSample}.`);
  }

  const channelData: Float64Array[] = Array.from({ length: channels }, () => new Float64Array(frames));
  const mono = new Float64Array(frames);

  for (let i = 0; i < frames; i += 1) {
    const base = dataOffset + i * frameBytes;
    let sum = 0;
    for (let c = 0; c < channels; c += 1) {
      const p = base + c * bytesPerSample;
      let v: number;
      if (isFloat) {
        v = bitsPerSample === 32 ? view.getFloat32(p, true) : view.getFloat64(p, true);
      } else if (bitsPerSample === 8) {
        v = (view.getUint8(p) - 128) / 128;
      } else if (bitsPerSample === 16) {
        v = view.getInt16(p, true) / 32768;
      } else if (bitsPerSample === 24) {
        const lo = view.getUint8(p);
        const mid = view.getUint8(p + 1);
        const hi = view.getUint8(p + 2);
        let s = (hi << 16) | (mid << 8) | lo;
        if (s & 0x800000) s -= 0x1000000;
        v = s / 8388608;
      } else {
        v = view.getInt32(p, true) / 2147483648;
      }
      channelData[c]![i] = v;
      sum += v;
    }
    mono[i] = sum / channels;
  }

  for (let c = 0; c < channels; c += 1) {
    // Keep only genuinely referenced arrays out of the hot path.
    void channelData[c];
  }

  return {
    sampleRate,
    channels,
    bitsPerSample,
    duration: frames / sampleRate,
    samples: mono,
    channelData,
    codec: isFloat ? 'float' : 'pcm',
  };
}

/** Encode mono or multi-channel Float64 samples as 16-bit PCM WAV. */
export function encodeWav(input: Float64Array | Float64Array[], sampleRate: number): ArrayBuffer {
  const channelData = Array.isArray(input) ? input : [input];
  const channels = channelData.length;
  if (channels < 1 || channels > 2) throw new WavError('WAV export supports 1 or 2 channels.');
  const frames = channelData[0]?.length ?? 0;
  if (channelData.some((c) => c.length !== frames)) throw new WavError('Channel lengths differ.');
  const bytesPerSample = 2;
  const blockAlign = channels * bytesPerSample;
  const dataBytes = frames * blockAlign;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  const writeAscii = (offset: number, s: string): void => {
    for (let i = 0; i < s.length; i += 1) view.setUint8(offset + i, s.charCodeAt(i));
  };

  writeAscii(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, Math.round(sampleRate), true);
  view.setUint32(28, Math.round(sampleRate) * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeAscii(36, 'data');
  view.setUint32(40, dataBytes, true);

  let p = 44;
  for (let i = 0; i < frames; i += 1) {
    for (let c = 0; c < channels; c += 1) {
      const v = Math.max(-1, Math.min(1, channelData[c]![i] ?? 0));
      view.setInt16(p, v < 0 ? Math.round(v * 32768) : Math.round(v * 32767), true);
      p += 2;
    }
  }
  return buffer;
}
