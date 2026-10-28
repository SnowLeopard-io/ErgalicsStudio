import type { PluginManifest } from '@/types/plugin';

export const acousticsManifest: PluginManifest = {
  id: 'example.acoustics',
  name: 'Acoustics Lab',
  nameI18n: { 'zh-CN': '声学实验室', 'en-US': 'Acoustics Lab' },
  version: '1.0.0',
  author: 'Ergalics',
  description:
    'Import WAV (guaranteed) or MP3/AAC/OGG audio for waveform, FFT spectrum and harmonic analysis; beat-frequency and coherent-interference demonstrations; rectangular-room eigenmodes with Sabine/Eyring reverberation, Schroeder frequency and critical distance. Audio is session-scoped and never auto-plays.',
  descriptionI18n: {
    'zh-CN':
      '导入 WAV（保证支持）或 MP3/AAC/OGG 音频，进行波形、FFT 频谱与谐波分析；拍频与相干叠加演示；矩形房间本征模态、Sabine/Eyring 混响时间、Schroeder 频率与临界距离。音频仅在当前会话内有效，且绝不自动播放。',
    'en-US':
      'Import WAV (guaranteed) or MP3/AAC/OGG audio for waveform, FFT spectrum and harmonic analysis; beat-frequency and coherent-interference demonstrations; rectangular-room eigenmodes with Sabine/Eyring reverberation, Schroeder frequency and critical distance. Audio is session-scoped and never auto-plays.',
  },
  license: 'MIT',
  entry: 'example.acoustics',
  category: 'scientific',
  sandbox: 'trusted',
  research: {
    tier: 'quasi-research',
    units: { frequency: 'Hz', level: 'dBFS', time: 's', distance: 'm', volume: 'm³' },
    benchmarks: ['axial-mode', 'sabine', 'beat', 'interference', 'wavelength', 'in-phase', 'decibel'],
    reproducible: true,
    notes:
      'Spectra use the shared radix-2 FFT with a Hann window and coherent-gain correction; harmonic amplitudes are read at the nearest bin (±1) and THD = √(ΣHₙ²)/H₁ for n ≥ 2. Room modes follow f = (c/2)√((nx/Lx)² + (ny/Ly)² + (nz/Lz)²) with c = 343 m/s. Sabine RT60 = 0.161·V/Σ(αS) (SI); Eyring −0.161V/(S·ln(1−ᾱ)); Schroeder f_s = 2000√(RT60/V); critical distance 0.057√(V/RT60). MP3/AAC/OGG decoding depends on the platform decoder; WAV PCM/float is decoded by the bundled parser.',
    notesI18n: {
      'zh-CN':
        '频谱使用共享 radix-2 FFT、Hann 窗与相干增益校正；谐波幅度取最近频点（±1），THD = √(ΣHₙ²)/H₁（n ≥ 2）。房间模态按 f = (c/2)√((nx/Lx)² + (ny/Ly)² + (nz/Lz)²)，c = 343 m/s。Sabine RT60 = 0.161·V/Σ(αS)（SI）；Eyring −0.161V/(S·ln(1−ᾱ))；Schroeder 频率 f_s = 2000√(RT60/V)；临界距离 0.057√(V/RT60)。MP3/AAC/OGG 解码依赖平台解码器；WAV PCM/float 由内置解析器处理。',
      'en-US':
        'Spectra use the shared radix-2 FFT with a Hann window and coherent-gain correction; harmonic amplitudes are read at the nearest bin (±1) and THD = √(ΣHₙ²)/H₁ for n ≥ 2. Room modes follow f = (c/2)√((nx/Lx)² + (ny/Ly)² + (nz/Lz)²) with c = 343 m/s. Sabine RT60 = 0.161·V/Σ(αS) (SI); Eyring −0.161·V/(S·ln(1−ᾱ)); Schroeder f_s = 2000√(RT60/V); critical distance 0.057√(V/RT60). MP3/AAC/OGG decoding depends on the platform decoder; WAV PCM/float is decoded by the bundled parser.',
    },
  },
  signature: {
    alg: 'ed25519',
    fingerprint: 'ed25519:790901b82a89fe505b5f98e2b7bf28e3',
    sig: '5a137b10f92a2a6db402e1047f3b4405fcf76f28b8be3e73ecf9619ff9399f3ca7e795177ceb7b610194cdcda68b1346e9ca27c8d4f259ecf2c220b937fc2f06',
    signer: 'Ergalics Studio (artsci pack)',
    signedAt: '2026-10-27T00:00:00.000Z',
    pub: '0d7550754e0800a5d237eef5826035766b9b3e5a15868a940ab289958788e3b0',
  },
  formats: [
    { extension: '.wav', mimeTypes: ['audio/wav', 'audio/x-wav'], description: 'WAV audio (PCM 8/16/24/32-bit or float)' },
    { extension: '.mp3', mimeTypes: ['audio/mpeg'], description: 'MP3 (platform decoder required)' },
    { extension: '.m4a', mimeTypes: ['audio/mp4'], description: 'AAC in MP4 (platform decoder required)' },
    { extension: '.aac', mimeTypes: ['audio/aac'], description: 'AAC (platform decoder required)' },
    { extension: '.ogg', mimeTypes: ['audio/ogg'], description: 'Ogg Vorbis (platform decoder required)' },
    { extension: '.flac', mimeTypes: ['audio/flac'], description: 'FLAC (platform decoder required)' },
    { extension: '.csv', mimeTypes: ['text/csv'], description: 'numeric waveform: time_s, amplitude' },
    { extension: '.tsv', mimeTypes: ['text/tab-separated-values'], description: 'tab-separated waveform' },
    { extension: '.txt', mimeTypes: ['text/plain'], description: 'plain-text amplitude samples' },
  ],
};
