// ==========================================================================
// Ergalics Studio — audio ingestion & playback (host context only)
//
// The numerical kernels never touch this module: Node/jsdom has no Web Audio,
// so tests import the plugin kernels directly. This layer owns the two
// browser-only concerns:
//   1. turning a user `File` into Float64 samples (native WAV parser first,
//      then the platform decoder for MP3/AAC/OGG when available);
//   2. session-scoped playback with a single AudioContext that is always
//      released on stop / dispose.
//
// Audio is deliberately *not* persisted: project files store text only, so an
// imported clip lives for the current plugin session and is never written to
// `.clproj`.
// ==========================================================================

import type { PluginApi } from '@/types/plugin';
import { decodeWav, WavError } from './wav';

export { decodeWav, encodeWav, WavError } from './wav';
export type { DecodedWav } from './wav';

/** Hard upload limit (25 MiB) — decoded Float64 is ~8× the file size. */
export const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
/** Analysis / playback limit; keeps decoded memory bounded. */
export const MAX_AUDIO_SECONDS = 60;

export interface AudioClip {
  name: string;
  sampleRate: number;
  channels: number;
  duration: number;
  /** Mono downmix used for analysis and waveform drawing. */
  samples: Float64Array;
  /** Per-channel signals (1 or 2 channels are passed to Web Audio). */
  channelData: Float64Array[];
  codec: 'pcm' | 'float' | 'decoded';
}

export class AudioDecodeError extends Error {
  readonly code:
    | 'too-large'
    | 'too-long'
    | 'empty'
    | 'unsupported'
    | 'decode-failed'
    | 'no-web-audio';
  constructor(code: AudioDecodeError['code'], message: string) {
    super(message);
    this.name = 'AudioDecodeError';
    this.code = code;
  }
}

const audioContextCtor = (): typeof AudioContext | undefined => {
  const g = globalThis as unknown as {
    AudioContext?: typeof AudioContext;
    webkitAudioContext?: typeof AudioContext;
  };
  return g.AudioContext ?? g.webkitAudioContext;
};

const MAX_SAMPLES = 8_000_000;

function clipFromChannelData(
  name: string,
  sampleRate: number,
  channelData: Float64Array[],
  codec: AudioClip['codec'],
): AudioClip {
  const frames = channelData[0]?.length ?? 0;
  const mono = new Float64Array(frames);
  for (let c = 0; c < channelData.length; c += 1) {
    const ch = channelData[c]!;
    for (let i = 0; i < frames; i += 1) mono[i] = mono[i]! + ch[i]!;
  }
  if (channelData.length > 0) {
    for (let i = 0; i < frames; i += 1) mono[i] = mono[i]! / channelData.length;
  }
  return {
    name,
    sampleRate,
    channels: channelData.length,
    duration: frames / sampleRate,
    samples: mono,
    channelData,
    codec,
  };
}

/** One-line, user-facing explanation of a decode failure. */
export function audioErrorText(err: unknown, zh: boolean): string {
  if (err instanceof AudioDecodeError) {
    switch (err.code) {
      case 'too-large':
        return zh
          ? '音频文件超过 25 MB 上限，请先裁剪或压缩。'
          : 'Audio file exceeds the 25 MB limit — trim or compress it first.';
      case 'too-long':
        return zh ? '音频超过 60 秒上限，请导入更短的片段。' : 'Audio exceeds the 60 s limit — import a shorter clip.';
      case 'empty':
        return zh ? '音频文件为空或不含可用的采样。' : 'The audio file is empty or has no usable samples.';
      case 'unsupported':
        return zh
          ? '不支持的音频编码。WAV（PCM/float）保证支持；MP3/AAC/OGG 取决于运行环境。'
          : 'Unsupported audio encoding. WAV (PCM/float) is guaranteed; MP3/AAC/OGG depends on the runtime.';
      case 'no-web-audio':
        return zh
          ? '当前环境没有可用的 Web Audio，无法解码该格式；请改用 WAV。'
          : 'Web Audio is unavailable here, so this format cannot be decoded — use WAV instead.';
      default:
        return zh
          ? '音频解码失败；请确认文件未损坏，或改用 WAV 格式。'
          : 'Audio decoding failed — check the file, or use WAV.';
    }
  }
  const msg = err instanceof Error ? err.message : String(err);
  return zh ? `音频处理失败：${msg}` : `Audio processing failed: ${msg}`;
}

/**
 * Decode a user-supplied audio file into Float64 samples. Native WAV parsing
 * runs first (no Web Audio needed); other containers go through the platform
 * decoder, which is available in Chromium/Electron but not in Node.
 */
export async function decodeAudioClip(api: PluginApi, file: File): Promise<AudioClip> {
  if (file.size > MAX_AUDIO_BYTES) {
    throw new AudioDecodeError('too-large', 'audio file exceeds 25 MB');
  }
  if (file.size === 0) throw new AudioDecodeError('empty', 'empty audio file');

  const buffer =
    typeof api.readBinary === 'function' ? await api.readBinary(file) : await file.arrayBuffer();

  let lastErr: unknown = null;
  try {
    const wav = decodeWav(buffer);
    if (wav.samples.length === 0) throw new AudioDecodeError('empty', 'no samples');
    assertLength(wav.duration);
    return clipFromChannelData(file.name, wav.sampleRate, wav.channelData, wav.codec);
  } catch (err) {
    lastErr = err;
    if (err instanceof AudioDecodeError) throw err;
    if (!(err instanceof WavError)) throw err;
  }

  const Ctor = audioContextCtor();
  if (!Ctor) {
    throw new AudioDecodeError(
      'no-web-audio',
      lastErr instanceof Error ? lastErr.message : 'Web Audio unavailable',
    );
  }
  let ctx: AudioContext | null = null;
  try {
    ctx = new Ctor();
    const decoded = await ctx.decodeAudioData(buffer.slice(0));
    assertLength(decoded.duration);
    if (decoded.length * decoded.numberOfChannels > MAX_SAMPLES) {
      throw new AudioDecodeError('too-long', 'decoded audio too large');
    }
    const channelData: Float64Array[] = [];
    for (let c = 0; c < decoded.numberOfChannels; c += 1) {
      channelData.push(Float64Array.from(decoded.getChannelData(c)));
    }
    if (channelData.length === 0) throw new AudioDecodeError('empty', 'no decoded channels');
    return clipFromChannelData(file.name, decoded.sampleRate, channelData, 'decoded');
  } catch (err) {
    if (err instanceof AudioDecodeError) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    const unsupported = /decode|encoding|format|not supported|unable/i.test(msg);
    throw new AudioDecodeError(
      unsupported ? 'unsupported' : 'decode-failed',
      lastErr instanceof Error ? `${lastErr.message}; ${msg}` : msg,
    );
  } finally {
    if (ctx) void ctx.close().catch(() => undefined);
  }
}

function assertLength(duration: number): void {
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new AudioDecodeError('empty', 'zero-length audio');
  }
  if (duration > MAX_AUDIO_SECONDS) {
    throw new AudioDecodeError('too-long', `audio longer than ${MAX_AUDIO_SECONDS} s`);
  }
}

/**
 * Session-scoped clip player. One AudioContext per player, created lazily on
 * the first user gesture; `dispose()` closes it so no audio graph leaks when
 * the plugin is unloaded or the user switches labs.
 */
export class AudioClipPlayer {
  private ctx: AudioContext | null = null;
  private source: AudioBufferSourceNode | null = null;
  private gain: GainNode | null = null;
  private _playing = false;

  get playing(): boolean {
    return this._playing;
  }

  get available(): boolean {
    return audioContextCtor() !== undefined;
  }

  /** Play a clip from `offset` seconds. Resolves when playback starts. */
  async play(clip: AudioClip, offset = 0, onEnded?: () => void): Promise<void> {
    const Ctor = audioContextCtor();
    if (!Ctor) throw new AudioDecodeError('no-web-audio', 'Web Audio unavailable');
    this.stop();
    if (!this.ctx || this.ctx.state === 'closed') this.ctx = new Ctor();
    const ctx = this.ctx;
    if (ctx.state === 'suspended') await ctx.resume().catch(() => undefined);

    const channels = Math.min(2, Math.max(1, clip.channelData.length || 1));
    const frames = clip.samples.length;
    const buffer = ctx.createBuffer(channels, Math.max(1, frames), clip.sampleRate);
    for (let c = 0; c < channels; c += 1) {
      const src = clip.channelData[c] ?? clip.samples;
      buffer.copyToChannel(Float32Array.from(src), c);
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const gain = ctx.createGain();
    gain.gain.value = 1;
    source.connect(gain);
    gain.connect(ctx.destination);
    source.onended = () => {
      if (this.source === source) {
        this._playing = false;
        this.source = null;
      }
      onEnded?.();
    };
    const start = Math.max(0, Math.min(offset, clip.duration - 0.001));
    source.start(0, start);
    this.source = source;
    this.gain = gain;
    this._playing = true;
  }

  setVolume(v: number): void {
    if (this.gain) this.gain.gain.value = Math.max(0, Math.min(1, v));
  }

  stop(): void {
    if (this.source) {
      try {
        this.source.stop();
      } catch {
        /* already stopped */
      }
      this.source.disconnect();
      this.source = null;
    }
    if (this.gain) {
      this.gain.disconnect();
      this.gain = null;
    }
    this._playing = false;
  }

  dispose(): void {
    this.stop();
    if (this.ctx) {
      void this.ctx.close().catch(() => undefined);
      this.ctx = null;
    }
  }
}
