// ==========================================================================
// netproto — pure kernel
//
// Discrete, deterministic message-sequence models for teaching networking:
// TCP connection setup/teardown, Reno congestion control, RTT estimation and
// the TLS 1.3 1-RTT handshake. Times are expressed in round-trip times (RTT);
// no sockets, no wall clock and no real cryptography.
// ==========================================================================

export type Direction = 'client→server' | 'server→client' | 'internal';

export interface MessageStep {
  /** Index in the simulated sequence. */
  index: number;
  /** Time in RTTs from the start. */
  time: number;
  from: 'client' | 'server';
  to: 'client' | 'server';
  /** Short protocol name, e.g. SYN, SYN-ACK, ClientHello. */
  flag: string;
  seq?: number;
  ack?: number;
  /** Encrypted record in TLS 1.3. */
  encrypted?: boolean;
  noteEn: string;
  noteZh: string;
}

export interface HandshakeResult {
  protocol: 'tcp' | 'tls13';
  steps: MessageStep[];
  /** Total simulated time in RTTs. */
  rtts: number;
  /** Whether the simulation completed the expected flight. */
  complete: boolean;
}

export function tcpHandshake(clientIsn = 1000, serverIsn = 5000): HandshakeResult {
  const steps: MessageStep[] = [
    {
      index: 0,
      time: 0,
      from: 'client',
      to: 'server',
      flag: 'SYN',
      seq: clientIsn,
      noteEn: 'Client picks an initial sequence number and sends SYN (window scaling / SACK options may ride along).',
      noteZh: '客户端选择初始序号并发送 SYN（可携带窗口缩放 / SACK 选项）。',
    },
    {
      index: 1,
      time: 0.5,
      from: 'server',
      to: 'client',
      flag: 'SYN-ACK',
      seq: serverIsn,
      ack: clientIsn + 1,
      noteEn: 'Server acknowledges the client ISN and advertises its own ISN and receive window.',
      noteZh: '服务器确认客户端初始序号，并通告自己的初始序号与接收窗口。',
    },
    {
      index: 2,
      time: 1,
      from: 'client',
      to: 'server',
      flag: 'ACK',
      seq: clientIsn + 1,
      ack: serverIsn + 1,
      noteEn: 'Connection established: both directions are now open (1 full RTT).',
      noteZh: '连接建立：双向通道打开（共 1 个完整 RTT）。',
    },
  ];
  return { protocol: 'tcp', steps, rtts: 1, complete: true };
}

export function tcpTeardown(clientSeq = 1000, serverSeq = 5000): HandshakeResult {
  const steps: MessageStep[] = [
    {
      index: 0,
      time: 0,
      from: 'client',
      to: 'server',
      flag: 'FIN',
      seq: clientSeq,
      noteEn: 'Client half-closes: FIN marks the end of its byte stream.',
      noteZh: '客户端半关闭：FIN 标记其字节流结束。',
    },
    {
      index: 1,
      time: 0.5,
      from: 'server',
      to: 'client',
      flag: 'ACK',
      ack: clientSeq + 1,
      noteEn: 'Server acknowledges the FIN; client→server direction is closed.',
      noteZh: '服务器确认 FIN；客户端→服务器方向关闭。',
    },
    {
      index: 2,
      time: 1,
      from: 'server',
      to: 'client',
      flag: 'FIN',
      seq: serverSeq,
      noteEn: 'Server finishes its remaining data and sends its own FIN.',
      noteZh: '服务器发送完剩余数据后发送自己的 FIN。',
    },
    {
      index: 3,
      time: 1.5,
      from: 'client',
      to: 'server',
      flag: 'ACK',
      ack: serverSeq + 1,
      noteEn: 'Client acknowledges; the client enters TIME_WAIT for 2×MSL.',
      noteZh: '客户端确认；随后进入 2×MSL 的 TIME_WAIT。',
    },
  ];
  return { protocol: 'tcp', steps, rtts: 1.5, complete: true };
}

export const TLS13_FLIGHT = [
  'ClientHello',
  'ServerHello',
  'EncryptedExtensions',
  'Certificate',
  'CertificateVerify',
  'Finished (server)',
  'Finished (client)',
  'Application Data',
  'NewSessionTicket',
] as const;

export function tls13Handshake(): HandshakeResult {
  const steps: MessageStep[] = [];
  const push = (
    from: 'client' | 'server',
    flag: string,
    time: number,
    encrypted: boolean,
    noteEn: string,
    noteZh: string,
  ): void => {
    steps.push({ index: steps.length, time, from, to: from === 'client' ? 'server' : 'client', flag, encrypted, noteEn, noteZh });
  };
  push('client', 'ClientHello', 0, false, 'ClientHello carries supported versions, key shares and a random nonce.', 'ClientHello 携带支持的版本、密钥交换份额与随机数。');
  push('server', 'ServerHello', 0.5, false, 'ServerHello selects TLS 1.3 and the key share; both sides can now derive handshake keys.', 'ServerHello 选择 TLS 1.3 与密钥份额；双方可导出握手密钥。');
  push('server', 'EncryptedExtensions', 0.5, true, 'EncryptedExtensions is the first record protected by handshake keys.', 'EncryptedExtensions 是首条由握手密钥保护的记录。');
  push('server', 'Certificate', 0.5, true, 'Server certificate chain (omitted for PSK resumption).', '服务器证书链（PSK 恢复时省略）。');
  push('server', 'CertificateVerify', 0.5, true, 'Signature over the transcript proves possession of the certificate key.', '对握手记录签名，证明持有证书私钥。');
  push('server', 'Finished (server)', 0.5, true, 'Server Finished MAC covers the whole transcript.', '服务器 Finished MAC 覆盖完整握手记录。');
  push('client', 'Finished (client)', 1, true, 'Client verifies the server flight, then sends its Finished. 1-RTT handshake complete.', '客户端验证服务器报文后发送 Finished，1-RTT 握手完成。');
  push('client', 'Application Data', 1, true, '0-RTT or 1-RTT application data can flow immediately.', '0-RTT 或 1-RTT 应用数据可立即发送。');
  push('server', 'NewSessionTicket', 1.5, true, 'Server issues a resumption ticket for a future 0-RTT connection.', '服务器签发恢复票据，供未来 0-RTT 连接使用。');
  return { protocol: 'tls13', steps, rtts: 1.5, complete: true };
}

// ---- Reno congestion control -------------------------------------------------

export interface CongestionStep {
  /** RTT index (0-based). */
  round: number;
  cwnd: number;
  ssthresh: number;
  phase: 'slow start' | 'congestion avoidance' | 'fast recovery';
  loss: boolean;
}

export interface CongestionTrace {
  steps: CongestionStep[];
  initialCwnd: number;
  losses: number[];
  /** Peak window observed in MSS. */
  peak: number;
}

export interface RenoOptions {
  initialCwnd?: number;
  initialSsthresh?: number;
  rounds?: number;
  /** RTT indices at which a packet loss is signalled. */
  lossAt?: number[];
  /** Reno fast retransmit instead of a coarse timeout (default true). */
  fastRetransmit?: boolean;
}

/**
 * Step Reno once per RTT. Slow start doubles the window until ssthresh, then
 * congestion avoidance adds one MSS per RTT. A loss halves ssthresh; fast
 * retransmit drops cwnd to the new ssthresh, a timeout drops it to 1 MSS.
 */
export function congestionTrace(options: RenoOptions = {}): CongestionTrace {
  const initialCwnd = Math.max(1, options.initialCwnd ?? 1);
  const rounds = Math.max(1, options.rounds ?? 16);
  const losses = new Set((options.lossAt ?? []).filter((r) => r >= 0 && r < rounds));
  const fast = options.fastRetransmit !== false;
  let cwnd = initialCwnd;
  let ssthresh = Math.max(2, options.initialSsthresh ?? 16);
  let phase: CongestionStep['phase'] = cwnd < ssthresh ? 'slow start' : 'congestion avoidance';
  const steps: CongestionStep[] = [];
  let peak = cwnd;

  for (let round = 0; round < rounds; round += 1) {
    const loss = losses.has(round);
    steps.push({ round, cwnd, ssthresh, phase, loss });
    peak = Math.max(peak, cwnd);
    if (loss) {
      ssthresh = Math.max(2, Math.floor(cwnd / 2));
      cwnd = fast ? ssthresh : 1;
      phase = fast ? 'fast recovery' : 'slow start';
      continue;
    }
    if (phase === 'fast recovery') {
      // One RTT of inflated window, then deflate to ssthresh and continue in
      // congestion avoidance.
      cwnd = ssthresh;
      phase = 'congestion avoidance';
      continue;
    }
    if (phase === 'slow start') {
      cwnd = Math.min(ssthresh, cwnd * 2);
      if (cwnd >= ssthresh) phase = 'congestion avoidance';
    } else {
      cwnd += 1;
    }
  }
  return { steps, initialCwnd, losses: [...losses].sort((a, b) => a - b), peak };
}

// ---- RTT estimation (Jacobson/Karels) ---------------------------------------

export interface RtoSample {
  sample: number;
  srtt: number;
  rttvar: number;
  rto: number;
}

export function rtoSample(samples: number[], initialRto = 1): RtoSample[] {
  let srtt = samples[0] ?? 0;
  let rttvar = srtt / 2;
  let rto = initialRto;
  const out: RtoSample[] = [];
  samples.forEach((sample, i) => {
    if (i === 0) {
      srtt = sample;
      rttvar = sample / 2;
    } else {
      rttvar = 0.75 * rttvar + 0.25 * Math.abs(srtt - sample);
      srtt = 0.875 * srtt + 0.125 * sample;
    }
    rto = srtt + Math.max(0.001, 4 * rttvar);
    out.push({ sample, srtt, rttvar, rto });
  });
  return out;
}

// ---- scenario parsing --------------------------------------------------------

export type NetScenarioProtocol = 'tcp' | 'tls13' | 'reno';

export interface NetScenario {
  protocol: NetScenarioProtocol;
  clientIsn: number;
  serverIsn: number;
  rounds: number;
  initialCwnd: number;
  initialSsthresh: number;
  lossAt: number[];
  rttSamples: number[];
  fastRetransmit: boolean;
}

export const DEFAULT_NET_SCENARIO: NetScenario = {
  protocol: 'tcp',
  clientIsn: 1000,
  serverIsn: 5000,
  rounds: 16,
  initialCwnd: 1,
  initialSsthresh: 16,
  lossAt: [8, 13],
  rttSamples: [0.04, 0.05, 0.045, 0.06],
  fastRetransmit: true,
};

export function parseScenario(text: string): NetScenario {
  const scenario: NetScenario = { ...DEFAULT_NET_SCENARIO, lossAt: [...DEFAULT_NET_SCENARIO.lossAt], rttSamples: [...DEFAULT_NET_SCENARIO.rttSamples] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return scenario;
  }
  if (!parsed || typeof parsed !== 'object') return scenario;
  const obj = parsed as Record<string, unknown>;
  if (obj.protocol === 'tcp' || obj.protocol === 'tls13' || obj.protocol === 'reno') scenario.protocol = obj.protocol;
  const int = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : fallback);
  scenario.clientIsn = int(obj.clientIsn, scenario.clientIsn);
  scenario.serverIsn = int(obj.serverIsn, scenario.serverIsn);
  scenario.rounds = Math.max(1, Math.min(200, int(obj.rounds, scenario.rounds)));
  scenario.initialCwnd = Math.max(1, int(obj.initialCwnd, scenario.initialCwnd));
  scenario.initialSsthresh = Math.max(2, int(obj.initialSsthresh, scenario.initialSsthresh));
  if (Array.isArray(obj.lossAt)) {
    scenario.lossAt = obj.lossAt.filter((v): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0).map(Math.trunc);
  }
  if (Array.isArray(obj.rttSamples)) {
    scenario.rttSamples = obj.rttSamples.filter((v): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0);
  }
  if (typeof obj.fastRetransmit === 'boolean') scenario.fastRetransmit = obj.fastRetransmit;
  return scenario;
}

export function simulateScenario(scenario: NetScenario): HandshakeResult | CongestionTrace {
  if (scenario.protocol === 'tls13') return tls13Handshake();
  if (scenario.protocol === 'reno') {
    return congestionTrace({
      rounds: scenario.rounds,
      initialCwnd: scenario.initialCwnd,
      initialSsthresh: scenario.initialSsthresh,
      lossAt: scenario.lossAt,
      fastRetransmit: scenario.fastRetransmit,
    });
  }
  return tcpHandshake(scenario.clientIsn, scenario.serverIsn);
}

// ---- benchmarks --------------------------------------------------------------

export interface NetBenchmark {
  id: string;
  labelEn: string;
  labelZh: string;
  measured: number;
  expected: number;
  relErr: number;
  passed: boolean;
}

export function runNetProtocolBenchmarks(): NetBenchmark[] {
  const handshake = tcpHandshake();
  const reno = congestionTrace({ initialCwnd: 1, initialSsthresh: 16, rounds: 8 });
  const doubles = reno.steps.slice(0, 4).map((s) => s.cwnd).join(',') === '1,2,4,8';
  const lossTrace = congestionTrace({ initialCwnd: 8, initialSsthresh: 16, rounds: 3, lossAt: [0] });
  const afterLoss = lossTrace.steps[1]?.cwnd ?? 0;
  const tls = tls13Handshake();
  const rto = rtoSample([0.04, 0.05, 0.045, 0.06]);

  const cases = [
    {
      id: 'tcp-handshake',
      labelEn: 'TCP three-way handshake completes in 1 RTT',
      labelZh: 'TCP 三次握手在 1 个 RTT 内完成',
      measured: handshake.rtts,
      expected: 1,
      tol: 0,
    },
    {
      id: 'slow-start-doubling',
      labelEn: 'Slow start window doubles 1→2→4→8 MSS',
      labelZh: '慢启动窗口倍增 1→2→4→8 MSS',
      measured: doubles ? 1 : 0,
      expected: 1,
      tol: 0,
    },
    {
      id: 'loss-halves-cwnd',
      labelEn: 'Reno loss at cwnd 8 sets cwnd to ssthresh = 4',
      labelZh: 'Reno 在 cwnd 8 丢包后将 cwnd 设为 ssthresh = 4',
      measured: afterLoss,
      expected: 4,
      tol: 0,
    },
    {
      id: 'tls13-flight',
      labelEn: 'TLS 1.3 flight has 9 messages and 7 encrypted records',
      labelZh: 'TLS 1.3 报文流含 9 条消息与 7 条加密记录',
      measured: tls.steps.length === 9 && tls.steps.filter((s) => s.encrypted).length === 7 ? 1 : 0,
      expected: 1,
      tol: 0,
    },
    {
      id: 'retransmit-timeout',
      labelEn: 'RTO after flat 40 ms samples is 120 ms (SRTT + 4·RTTVAR)',
      labelZh: '40 ms 稳定样本后的 RTO 为 120 ms（SRTT + 4·RTTVAR）',
      measured: rto[0]?.rto ?? 0,
      expected: 0.12,
      tol: 1e-12,
    },
  ];
  return cases.map((c) => {
    const denom = Math.abs(c.expected) || 1;
    const relErr = Math.abs(c.measured - c.expected) / denom;
    const tol = (c as { tol?: number }).tol ?? 1e-9;
    return { id: c.id, labelEn: c.labelEn, labelZh: c.labelZh, measured: c.measured, expected: c.expected, relErr, passed: relErr <= tol };
  });
}
