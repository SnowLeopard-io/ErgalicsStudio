import type { PluginManifest } from '@/types/plugin';

export const netProtoManifest: PluginManifest = {
  id: 'example.netproto',
  name: 'Network Protocol Simulator',
  nameI18n: { 'zh-CN': '网络协议模拟器', 'en-US': 'Network Protocol Simulator' },
  version: '1.0.0',
  author: 'Ergalics',
  description:
    'Message-sequence simulations of the TCP three-way handshake and teardown, Reno congestion control (slow start, congestion avoidance, fast retransmit/quick recovery) and the TLS 1.3 handshake, with a packet timeline, congestion-window chart and step-by-step annotations.',
  descriptionI18n: {
    'zh-CN':
      'TCP 三次握手与四次挥手、Reno 拥塞控制（慢启动、拥塞避免、快速重传/快速恢复）以及 TLS 1.3 握手的报文序列模拟，含数据包时间线、拥塞窗口图表与逐步骤注释。',
    'en-US':
      'Message-sequence simulations of the TCP three-way handshake and teardown, Reno congestion control (slow start, congestion avoidance, fast retransmit/quick recovery) and the TLS 1.3 handshake, with a packet timeline, congestion-window chart and step-by-step annotations.',
  },
  license: 'MIT',
  entry: 'example.netproto',
  category: 'scientific',
  sandbox: 'trusted',
  research: {
    tier: 'demonstration',
    units: { time: 'RTT', window: 'MSS', lossRate: 'fraction' },
    benchmarks: ['tcp-handshake', 'slow-start-doubling', 'loss-halves-cwnd', 'tls13-flight', 'retransmit-timeout'],
    reproducible: true,
    notes:
      'The congestion controller is a discrete Reno model stepped once per RTT with an optional loss event schedule; it omits delayed ACKs, SACK and pacing. The TLS 1.3 handshake lists the standard 1-RTT flight and marks encrypted records, but performs no real cryptography. Times are in round-trip times (RTT), not seconds.',
    notesI18n: {
      'zh-CN':
        '拥塞控制是每个 RTT 步进一次的离散 Reno 模型，可配置丢包事件序列；省略延迟 ACK、SACK 与 pacing。TLS 1.3 握手只列出标准 1-RTT 报文流并标注加密记录，不做真实密码运算。时间单位为 RTT，而非秒。',
      'en-US':
        'The congestion controller is a discrete Reno model stepped once per RTT with an optional loss event schedule; it omits delayed ACKs, SACK and pacing. The TLS 1.3 handshake lists the standard 1-RTT flight and marks encrypted records, but performs no real cryptography. Times are in round-trip times (RTT), not seconds.',
    },
  },
  formats: [{ extension: '.json', mimeTypes: ['application/json'], description: 'scenario: { protocol, rtts, lossAt, initialCwnd }' }],
  signature: {
    alg: 'ed25519',
    fingerprint: 'ed25519:790901b82a89fe505b5f98e2b7bf28e3',
    sig: '11e89e6b6d2af09ddf2f25e2b11c8067796ee7abfa01cc69d9332ac0bb810a3c2db14a26dd7d1798ec945492bd56d899d61cf61af0a01eddd4c5453148578a0a',
    signer: 'Ergalics Studio (cs pack)',
    signedAt: '2026-10-28T00:00:00.000Z',
    pub: '0d7550754e0800a5d237eef5826035766b9b3e5a15868a940ab289958788e3b0',
  },
};
