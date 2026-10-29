// ==========================================================================
// socio-voting — voting systems simulator (plugin shell)
//
// Left canvas panel: the issue-space scatter (voters as small dots coloured
// by their top choice, candidates as diamonds). Right panel: horizontal bars
// of the current rule's tally plus a winner banner. One click runs an
// election, the benchmark battery, a CSV export or a Figure Studio push, and
// every run republishes structured scientific outputs (winner, vote share,
// Condorcet-criterion verdict, spoiler detection, seat-vote gap and the
// optional gerrymandering demo gap).
// ==========================================================================

import type { ContainerCapabilities, ParamDefinition, Plugin, PluginApi } from '@/types/plugin';
import { actionButton, actionFired, exportRowsCsv, notify } from '@/core/plugin-tools/enhance';
import { clearScienceOutputs, fmtMetric, setScienceOutputs, type ScienceMetric } from '@/core/research/scienceOutput';
import { mulberry32 } from '@/core/repro/random';
import { pushPanelsToFigure, type Bilingual } from '@/core/figure/sheet';
import { votingManifest } from './manifest';
import { votingFigurePanels, candidateColor } from './figure';
import {
  generateGerrymanderElectorate,
  generateRandomProfile,
  gerrymanderDemo,
  runElection,
  runVotingBenchmark,
  type Culture,
  type ElectionResult,
  type ElectoralSystem,
  type GerrymanderResult,
  type PreferenceProfile,
  type VotingParams,
} from './kernel';

export { votingManifest } from './manifest';

const SYSTEM_OPTIONS: ElectoralSystem[] = ['plurality', 'irv', 'borda', 'approval', 'pr'];

const SYSTEM_LABELS: Record<ElectoralSystem, { en: string; zh: string }> = {
  plurality: { en: 'plurality', zh: '多数制' },
  irv: { en: 'instant-runoff (IRV)', zh: '即时复选（IRV）' },
  borda: { en: 'Borda count', zh: '博达计分' },
  approval: { en: 'approval voting', zh: '赞成投票' },
  pr: { en: "D'Hondt PR", zh: "D'Hondt 比例代表" },
};

const CULTURE_LABELS: Record<Culture, { en: string; zh: string }> = {
  uniform: { en: 'uniform (impartial culture)', zh: '均匀（中立文化）' },
  spatial: { en: 'spatial (Downsonian)', zh: '空间（唐斯模型）' },
};

/** Cells of the 1-D electorate behind the gerrymandering demo. */
const GERRY_CELLS = 200;
/** Independent stream for the gerrymander demo so the profile is untouched. */
const GERRY_SALT = 0x5f356495;

function withAlpha(hex: string, alpha: number): string {
  const v = hex.replace('#', '');
  const r = parseInt(v.slice(0, 2), 16);
  const g = parseInt(v.slice(2, 4), 16);
  const b = parseInt(v.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

export class VotingPlugin implements Plugin {
  readonly manifest = votingManifest;
  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  private zh = false;

  private params: VotingParams = {
    nVoters: 400,
    nCandidates: 4,
    culture: 'spatial',
    system: 'plurality',
    approvalThreshold: 0.3,
    seats: 10,
    gerrymander: false,
    gerrymanderStrength: 0.8,
    seed: 20261029,
  };
  private profile: PreferenceProfile | null = null;
  private result: ElectionResult | null = null;
  private gerry: GerrymanderResult | null = null;

  async init(api: PluginApi) {
    this.api = api;
    this.zh = api.locale === 'zh-CN';
    this.regenerate();
  }

  async destroy() {
    clearScienceOutputs(this.manifest.id);
    this.ctx = null;
  }

  async activate(context: { container: ContainerCapabilities }) {
    this.ctx = context.container;
  }

  async deactivate() {
    // No timers to stop; state is kept for reactivation.
  }

  render(container: ContainerCapabilities) {
    this.ctx = container;
    this.draw();
  }

  getParams(): ParamDefinition[] {
    return [
      {
        key: 'nVoters',
        label: 'Voters',
        labelI18n: { 'zh-CN': '选民数', 'en-US': 'Voters' },
        type: 'range',
        min: 10,
        max: 1000,
        step: 10,
        value: this.params.nVoters,
      },
      {
        key: 'nCandidates',
        label: 'Candidates',
        labelI18n: { 'zh-CN': '候选人数', 'en-US': 'Candidates' },
        type: 'range',
        min: 2,
        max: 8,
        step: 1,
        value: this.params.nCandidates,
      },
      {
        key: 'culture',
        label: 'Culture',
        labelI18n: { 'zh-CN': '偏好文化', 'en-US': 'Culture' },
        type: 'select',
        options: (['uniform', 'spatial'] as Culture[]).map((c) => ({
          value: c,
          label: this.zh ? CULTURE_LABELS[c].zh : CULTURE_LABELS[c].en,
          labelI18n: { 'zh-CN': CULTURE_LABELS[c].zh, 'en-US': CULTURE_LABELS[c].en },
        })),
        value: this.params.culture,
      },
      {
        key: 'system',
        label: 'Electoral system',
        labelI18n: { 'zh-CN': '选举制度', 'en-US': 'Electoral system' },
        type: 'select',
        options: SYSTEM_OPTIONS.map((s) => ({
          value: s,
          label: this.zh ? SYSTEM_LABELS[s].zh : SYSTEM_LABELS[s].en,
          labelI18n: { 'zh-CN': SYSTEM_LABELS[s].zh, 'en-US': SYSTEM_LABELS[s].en },
        })),
        value: this.params.system,
      },
      {
        key: 'approvalThreshold',
        label: 'Approval threshold',
        labelI18n: { 'zh-CN': '赞成距离阈值', 'en-US': 'Approval threshold' },
        type: 'range',
        min: 0.05,
        max: 0.6,
        step: 0.05,
        value: this.params.approvalThreshold,
        visibleWhen: { key: 'system', in: ['approval'] },
        hint: this.zh ? '议题空间内该欧氏距离内的候选人获得赞成票' : 'candidates within this issue-space distance are approved',
      },
      {
        key: 'seats',
        label: 'Seats / districts',
        labelI18n: { 'zh-CN': '席位数 / 选区数', 'en-US': 'Seats / districts' },
        type: 'range',
        min: 2,
        max: 50,
        step: 1,
        value: this.params.seats,
        hint: this.zh ? 'D’Hondt 比例代表席位数，亦为杰利蝾螈选区数' : "D'Hondt PR seats, also the gerrymander district count",
      },
      {
        key: 'gerrymander',
        label: 'Gerrymander demo',
        labelI18n: { 'zh-CN': '杰利蝾螈演示', 'en-US': 'Gerrymander demo' },
        type: 'checkbox',
        value: this.params.gerrymander,
        hint: this.zh ? '一维「集中-分割」选区划分演示' : '1-D pack-and-crack districting demo',
      },
      {
        key: 'gerrymanderStrength',
        label: 'Gerrymander strength',
        labelI18n: { 'zh-CN': '划分强度', 'en-US': 'Gerrymander strength' },
        type: 'range',
        min: 0,
        max: 1,
        step: 0.05,
        value: this.params.gerrymanderStrength,
        visibleWhen: { key: 'gerrymander', in: [true] },
      },
      {
        key: 'seed',
        label: 'Seed',
        labelI18n: { 'zh-CN': '随机种子', 'en-US': 'Seed' },
        type: 'range',
        min: 1,
        max: 999999,
        step: 1,
        value: this.params.seed,
        hint: this.zh ? '固定种子 ⇒ 选举完全可复现' : 'fixed seed ⇒ fully reproducible election',
      },
      actionButton('run', 'Run election', '运行选举', 'primary'),
      actionButton('benchmark', 'Run benchmark', '运行基准验证'),
      actionButton('exportCsv', 'Export CSV', '导出 CSV'),
      actionButton('sendToFigure', 'Send to Figure Studio', '发送到 Figure Studio'),
    ];
  }

  updateParams(params: Record<string, unknown>) {
    const num = (k: string, apply: (n: number) => void): void => {
      if (typeof params[k] === 'number' && Number.isFinite(params[k] as number)) apply(params[k] as number);
    };
    let reshaped = false;
    let retallied = false;

    num('nVoters', (n) => {
      const v = Math.min(1000, Math.max(10, Math.round(n / 10) * 10));
      if (v !== this.params.nVoters) {
        this.params.nVoters = v;
        reshaped = true;
      }
    });
    num('nCandidates', (n) => {
      const v = Math.min(8, Math.max(2, Math.round(n)));
      if (v !== this.params.nCandidates) {
        this.params.nCandidates = v;
        reshaped = true;
      }
    });
    if (typeof params.culture === 'string' && (params.culture === 'uniform' || params.culture === 'spatial')) {
      if (params.culture !== this.params.culture) {
        this.params.culture = params.culture as Culture;
        reshaped = true;
      }
    }
    if (typeof params.system === 'string' && SYSTEM_OPTIONS.includes(params.system as ElectoralSystem)) {
      if (params.system !== this.params.system) {
        this.params.system = params.system as ElectoralSystem;
        retallied = true;
      }
    }
    num('approvalThreshold', (n) => {
      const v = Math.min(0.6, Math.max(0.05, Math.round(n * 20) / 20));
      if (v !== this.params.approvalThreshold) {
        this.params.approvalThreshold = v;
        retallied = true;
      }
    });
    num('seats', (n) => {
      const v = Math.min(50, Math.max(2, Math.round(n)));
      if (v !== this.params.seats) {
        this.params.seats = v;
        retallied = true;
      }
    });
    if (typeof params.gerrymander === 'boolean' && params.gerrymander !== this.params.gerrymander) {
      this.params.gerrymander = params.gerrymander;
      retallied = true;
    }
    num('gerrymanderStrength', (n) => {
      const v = Math.min(1, Math.max(0, Math.round(n * 20) / 20));
      if (v !== this.params.gerrymanderStrength) {
        this.params.gerrymanderStrength = v;
        retallied = true;
      }
    });
    num('seed', (n) => {
      const s = Math.max(1, Math.round(n));
      if (s !== this.params.seed) {
        this.params.seed = s;
        reshaped = true;
      }
    });

    if (reshaped) this.regenerate();
    else if (retallied) this.runAnalysis();

    if (actionFired(params, 'run')) {
      this.regenerate();
    }
    if (actionFired(params, 'benchmark')) this.runBenchmark();
    if (actionFired(params, 'exportCsv')) this.exportCsv();
    if (actionFired(params, 'sendToFigure')) void this.sendToFigure();
    this.draw();
  }

  // ---- election control ----------------------------------------------------------

  /** Fresh profile from the current seed, then a full analysis pass. */
  private regenerate() {
    const rand = mulberry32(this.params.seed >>> 0 || 1);
    this.profile = generateRandomProfile(this.params.nVoters, this.params.nCandidates, rand, this.params.culture);
    this.runAnalysis();
  }

  /** Re-tally the current profile under the current rule options. */
  private runAnalysis() {
    if (!this.profile) return;
    this.result = runElection(this.profile, {
      system: this.params.system,
      approvalThreshold: this.params.approvalThreshold,
      seats: this.params.seats,
    });
    if (this.params.gerrymander) {
      const rand = mulberry32((this.params.seed ^ GERRY_SALT) >>> 0 || 1);
      this.gerry = gerrymanderDemo(
        generateGerrymanderElectorate(GERRY_CELLS, rand),
        this.params.seats,
        this.params.gerrymanderStrength,
      );
    } else {
      this.gerry = null;
    }
    this.publishOutputs();
  }

  // ---- scientific outputs ----------------------------------------------------------

  /** Winner's D'Hondt seat share minus first-preference vote share. */
  private seatVoteGap(r: ElectionResult): number {
    const totalSeats = r.prSeats.reduce((s, v) => s + v, 0);
    const totalVotes = r.firstPrefs.reduce((s, v) => s + v, 0);
    if (totalSeats <= 0 || totalVotes <= 0) return 0;
    return r.prSeats[r.winner]! / totalSeats - r.firstPrefs[r.winner]! / totalVotes;
  }

  private publishOutputs() {
    const r = this.result;
    if (!r) return;
    const zh = this.zh;
    const sys = SYSTEM_LABELS[r.system];
    const cw = r.condorcet.winner;
    const violated = cw !== null && cw !== r.winner;
    const metrics: ScienceMetric[] = [
      {
        key: 'winner',
        label: zh ? '获胜者' : 'Winner',
        value: `C${r.winner}`,
        severity: 'info',
        hint: zh ? `选举制度：${sys.zh}` : `electoral system: ${sys.en}`,
      },
      {
        key: 'vote-share',
        label: zh ? '获胜者得票率' : 'Winner vote share',
        value: fmtMetric(r.winnerShare * 100),
        unit: '%',
        severity: 'info',
        hint: zh ? '当前规则计票中获胜者占比' : "winner's share of the active-rule tally",
      },
      {
        key: 'condorcet',
        label: zh ? '孔多塞赢家' : 'Condorcet winner',
        value: cw === null ? (zh ? '不存在' : 'none') : `C${cw}`,
        severity: 'info',
        hint: zh
          ? '两两多数比较中击败所有对手的候选人'
          : 'candidate beating every rival in pairwise majority comparisons',
      },
      {
        key: 'criterion',
        label: zh ? '孔多塞准则' : 'Condorcet criterion',
        value:
          cw === null
            ? zh ? '无孔多塞赢家' : 'no Condorcet winner'
            : violated
              ? zh ? `未选出（选了 C${r.winner}）` : `violated (elected C${r.winner})`
              : zh ? '当选' : 'honoured',
        severity: cw === null ? 'info' : violated ? 'warn' : 'ok',
        hint: zh
          ? '当孔多塞赢家存在时，当前规则是否选出该候选人'
          : 'whether the active rule elects the beats-all winner when one exists',
      },
      {
        key: 'spoiler',
        label: zh ? '分票效应' : 'Spoiler effect',
        value: r.spoiler.spoiled ? (zh ? '检出' : 'detected') : zh ? '无' : 'none',
        severity: r.spoiler.spoiled ? 'warn' : 'info',
        hint: zh
          ? `插入候选人 C${r.spoiler.spoilerCandidate} 使获胜者从 C${r.spoiler.baseWinner} 变为 C${r.spoiler.fullWinner}`
          : `adding candidate C${r.spoiler.spoilerCandidate} changed the winner from C${r.spoiler.baseWinner} to C${r.spoiler.fullWinner}`,
      },
      {
        key: 'seat-vote-gap',
        label: zh ? '席位-得票落差' : 'Seat-vote gap',
        value: fmtMetric(this.seatVoteGap(r) * 100),
        unit: '%',
        severity: 'info',
        hint: zh
          ? '获胜者在首轮偏好票的 D’Hondt 席位份额减去其首轮得票份额'
          : "winner's D'Hondt seat share on first-preference blocs minus first-preference vote share",
      },
    ];
    if (this.gerry) {
      const g = this.gerry;
      metrics.push({
        key: 'gerrymander-gap',
        label: zh ? '杰利蝾螈落差' : 'Gerrymander gap',
        value: fmtMetric(g.gerrymanderGap * 100),
        unit: '%',
        severity: g.gerrymanderGap > g.neutralGap ? 'warn' : 'info',
        hint: zh
          ? `绘图政党的席位份额-得票份额：中性地图 ${fmtMetric(g.neutralGap * 100)}%，集中-分割地图 ${fmtMetric(g.gerrymanderGap * 100)}%`
          : `map-drawer seat share minus vote share: neutral map ${fmtMetric(g.neutralGap * 100)}%, pack-and-crack map ${fmtMetric(g.gerrymanderGap * 100)}%`,
      });
    }
    setScienceOutputs(this.manifest.id, metrics);
  }

  private runBenchmark() {
    const b = runVotingBenchmark();
    const zh = this.zh;
    const metrics: ScienceMetric[] = [
      {
        key: 'bench-status',
        label: 'Benchmark',
        value: b.pass ? (zh ? '全部通过' : 'ALL PASS') : zh ? '未通过' : 'FAIL',
        severity: b.pass ? 'ok' : 'error',
        hint: zh ? '内嵌社会选择验证组（非用户数据）' : 'embedded social-choice validation battery (not user data)',
      },
      {
        key: 'bench-hand',
        label: zh ? '手工算例' : 'Hand profile',
        value:
          b.pluralityExact && b.bordaExact && b.irvExact
            ? zh ? '多数/Borda/IRV 全对' : 'plurality/Borda/IRV exact'
            : zh ? '不一致' : 'mismatch',
        severity: b.pluralityExact && b.bordaExact && b.irvExact ? 'ok' : 'error',
      },
      {
        key: 'bench-criterion',
        label: zh ? '孔多塞准则检验' : 'Condorcet criterion',
        value:
          b.criterionViolationDetected && b.criterionHonoured && b.cyclicNoWinner
            ? zh ? '违背/遵守/循环 均检出' : 'violation / honoured / cycle detected'
            : zh ? '不一致' : 'mismatch',
        severity: b.criterionViolationDetected && b.criterionHonoured && b.cyclicNoWinner ? 'ok' : 'error',
      },
      {
        key: 'bench-spoiler',
        label: zh ? '分票效应' : 'Spoiler effect',
        value: b.spoilerDetected ? (zh ? '检出' : 'detected') : zh ? '未检出' : 'missed',
        severity: b.spoilerDetected ? 'ok' : 'error',
      },
      {
        key: 'bench-dhondt',
        label: zh ? 'D’Hondt 分配' : "D'Hondt allocation",
        value: b.dhondtExact ? '[4,3,1]' : zh ? '不一致' : 'mismatch',
        severity: b.dhondtExact ? 'ok' : 'error',
      },
      {
        key: 'bench-determinism',
        label: zh ? '固定种子确定性' : 'Seed determinism',
        value: b.deterministic ? (zh ? '可复现' : 'reproducible') : zh ? '不可复现' : 'irreproducible',
        severity: b.deterministic ? 'ok' : 'error',
      },
    ];
    setScienceOutputs(this.manifest.id, metrics);
    notify(
      this.api,
      b.pass ? 'success' : 'warning',
      `Benchmark ${b.pass ? 'passed' : 'FAILED'}: hand tallies, Condorcet criterion, spoiler, D'Hondt, determinism ${b.deterministic}`,
      `基准验证${b.pass ? '通过' : '未通过'}：手工算例、孔多塞准则、分票效应、D’Hondt、确定性 ${b.deterministic}`,
    );
  }

  private exportCsv() {
    const r = this.result;
    if (!r) {
      notify(this.api, 'warning', 'No election to export yet.', '暂无可导出的选举结果。');
      return;
    }
    const rows = r.counts.map((c, i) => [
      `C${i}`,
      r.firstPrefs[i]!,
      r.borda[i]!,
      r.approvals[i]!,
      r.prSeats[i]!,
      c,
    ]);
    exportRowsCsv(
      this.api,
      'socio-voting-election',
      ['candidate', 'first_preference_votes', 'borda_points', 'approval_votes', 'dhondt_seats', 'rule_tally'],
      rows,
    );
  }

  private async sendToFigure(): Promise<void> {
    if (!this.profile || !this.result) {
      notify(this.api, 'warning', 'No election to send yet.', '暂无可发送的选举结果。');
      return;
    }
    const r = this.result;
    const cw = r.condorcet.winner;
    const violated = cw !== null && cw !== r.winner;
    const sys = SYSTEM_LABELS[r.system];
    const caption: Bilingual = {
      zh: `${sys.zh}选举（${this.params.nVoters} 位选民、${this.params.nCandidates} 位候选人、种子 ${this.params.seed}）：获胜者 C${r.winner}（${(r.winnerShare * 100).toFixed(1)}%）；孔多塞赢家${cw === null ? '不存在' : `为 C${cw}`}，当前规则${violated ? '未选出该候选人（违背孔多塞准则）' : cw !== null ? '选出该候选人' : '无准则结论'}；分票效应${r.spoiler.spoiled ? '检出' : '未检出'}；席位-得票落差 ${(this.seatVoteGap(r) * 100).toFixed(1)}%。`,
      en: `${sys.en} election (${this.params.nVoters} voters, ${this.params.nCandidates} candidates, seed ${this.params.seed}): winner C${r.winner} (${(r.winnerShare * 100).toFixed(1)}%); ${cw === null ? 'no Condorcet winner exists' : `Condorcet winner C${cw}`}${violated ? ', violated by the active rule' : cw !== null ? ', elected by the active rule' : ''}; spoiler effect ${r.spoiler.spoiled ? 'detected' : 'absent'}; seat-vote gap ${(this.seatVoteGap(r) * 100).toFixed(1)}%.`,
    };
    await pushPanelsToFigure(
      this.api,
      { zh: '投票制度分析', en: 'Voting Systems Analysis' },
      caption,
      votingFigurePanels({ profile: this.profile, result: this.result }),
    );
  }

  // ---- drawing -------------------------------------------------------------------

  private draw() {
    const canvas = this.ctx?.canvas2d;
    if (!canvas) return;
    canvas.width = canvas.clientWidth || 760;
    canvas.height = canvas.clientHeight || 420;
    const g = canvas.getContext('2d');
    if (!g) return;
    g.fillStyle = getComputedStyle(canvas).backgroundColor || '#0a0e13';
    g.fillRect(0, 0, canvas.width, canvas.height);
    if (!this.profile || !this.result) return;

    const panelTop = 42;
    const panelBottom = canvas.height - 56;
    const size = Math.max(80, Math.min(panelBottom - panelTop, canvas.width * 0.46));
    this.drawScatter(g, 54, panelTop, size);
    const ox2 = 54 + size + 40;
    const w2 = canvas.width - ox2 - 20;
    if (w2 >= 140) this.drawBars(g, ox2, panelTop, w2, panelBottom - panelTop);
    this.drawFooter(g, canvas);
  }

  /** Left panel: issue-space scatter (voters by top choice, candidate diamonds). */
  private drawScatter(g: CanvasRenderingContext2D, ox: number, oy: number, size: number) {
    const zh = this.zh;
    const profile = this.profile!;
    g.textAlign = 'center';
    g.fillStyle = 'rgba(230,238,248,0.95)';
    g.font = `13px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.fillText(
      zh ? '议题空间（圆点=选民按首轮偏好着色，菱形=候选人）' : 'Issue space (dots = voters by top choice, diamonds = candidates)',
      ox + size / 2,
      oy - 8,
    );

    // plot frame
    g.strokeStyle = 'rgba(255,255,255,0.18)';
    g.lineWidth = 1;
    g.strokeRect(ox, oy, size, size);

    // voters, coloured by first preference
    profile.rankings.forEach((r, v) => {
      const p = profile.voterPos?.[v];
      if (!p) return;
      const top = r[0];
      if (top === undefined) return;
      g.fillStyle = withAlpha(candidateColor(top), 0.7);
      g.beginPath();
      g.arc(ox + p.x * size, oy + (1 - p.y) * size, 2.2, 0, Math.PI * 2);
      g.fill();
    });

    // candidates as labelled diamonds
    profile.candidatePos?.forEach((p, c) => {
      const cx = ox + p.x * size;
      const cy = oy + (1 - p.y) * size;
      const rad = 7;
      g.beginPath();
      g.moveTo(cx, cy - rad);
      g.lineTo(cx + rad, cy);
      g.lineTo(cx, cy + rad);
      g.lineTo(cx - rad, cy);
      g.closePath();
      g.fillStyle = candidateColor(c);
      g.fill();
      g.strokeStyle = 'rgba(20,26,34,0.9)';
      g.lineWidth = 1.5;
      g.stroke();
      g.fillStyle = 'rgba(230,238,248,0.95)';
      g.font = `10px Consolas, monospace`;
      g.textAlign = 'left';
      g.fillText(`C${c}`, cx + rad + 2, cy + 3);
      g.textAlign = 'center';
    });

    // axis labels
    g.fillStyle = 'rgba(170,182,200,0.9)';
    g.font = `10px Consolas, monospace`;
    g.fillText(zh ? '议题 1' : 'issue 1', ox + size / 2, oy + size + 13);
    g.save();
    g.translate(ox - 8, oy + size / 2);
    g.rotate(-Math.PI / 2);
    g.fillText(zh ? '议题 2' : 'issue 2', 0, 0);
    g.restore();
  }

  /** Right panel: winner banner + horizontal tally bars per candidate. */
  private drawBars(g: CanvasRenderingContext2D, ox: number, oy: number, w: number, h: number) {
    const zh = this.zh;
    const r = this.result!;
    const n = r.counts.length;
    const maxCount = Math.max(1, ...r.counts);
    const bannerH = 28;

    // winner banner
    const winnerColor = candidateColor(r.winner);
    g.fillStyle = withAlpha(winnerColor, 0.16);
    g.fillRect(ox, oy, w, bannerH);
    g.strokeStyle = withAlpha(winnerColor, 0.55);
    g.strokeRect(ox, oy, w, bannerH);
    g.textAlign = 'left';
    g.fillStyle = 'rgba(230,238,248,0.98)';
    g.font = `12px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    const banner = zh
      ? `获胜者 C${r.winner} · ${(r.winnerShare * 100).toFixed(1)}% · ${SYSTEM_LABELS[r.system].zh}`
      : `Winner C${r.winner} · ${(r.winnerShare * 100).toFixed(1)}% · ${SYSTEM_LABELS[r.system].en}`;
    g.fillText(banner, ox + 8, oy + bannerH - 9);

    // horizontal bars
    const barTop = oy + bannerH + 10;
    const barBottom = oy + h - 16;
    const rowH = Math.max(16, (barBottom - barTop) / Math.max(1, n));
    const labelW = 30;
    const valueW = 52;
    const barW = Math.max(10, w - labelW - valueW);
    for (let c = 0; c < n; c += 1) {
      const y = barTop + c * rowH;
      const bh = Math.min(12, rowH - 4);
      g.textAlign = 'right';
      g.fillStyle = 'rgba(170,182,200,0.95)';
      g.font = '10px Consolas, monospace';
      g.fillText(`C${c}`, ox + labelW - 6, y + rowH / 2 + 3);
      const bw = (r.counts[c]! / maxCount) * barW;
      g.fillStyle = withAlpha(candidateColor(c), c === r.winner ? 0.95 : 0.6);
      g.fillRect(ox + labelW, y + (rowH - bh) / 2, bw, bh);
      g.textAlign = 'left';
      g.fillStyle = 'rgba(200,210,225,0.95)';
      g.fillText(String(r.counts[c]!), ox + labelW + bw + 4, y + rowH / 2 + 3);
    }

    // tally unit caption
    g.textAlign = 'left';
    g.fillStyle = 'rgba(150,165,185,0.9)';
    g.font = `10px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.fillText(zh ? `计票单位：${r.tallyLabel.zh}` : `tally unit: ${r.tallyLabel.en}`, ox, oy + h - 3);
  }

  private drawFooter(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement) {
    const zh = this.zh;
    const r = this.result;
    if (!r) return;
    const cw = r.condorcet.winner;
    const violated = cw !== null && cw !== r.winner;
    g.textAlign = 'left';
    g.font = `11px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.fillStyle = 'rgba(170,182,200,0.95)';
    const l1 = zh
      ? `${this.params.nVoters} 位选民 · ${this.params.nCandidates} 位候选人 · ${CULTURE_LABELS[this.params.culture].zh} · ${SYSTEM_LABELS[r.system].zh} · 种子 ${this.params.seed}`
      : `${this.params.nVoters} voters · ${this.params.nCandidates} candidates · ${CULTURE_LABELS[this.params.culture].en} · ${SYSTEM_LABELS[r.system].en} · seed ${this.params.seed}`;
    g.fillText(l1, 54, canvas.height - 30);
    g.fillStyle = 'rgba(200,210,225,0.95)';
    const cond = cw === null
      ? zh ? '孔多塞赢家不存在' : 'no Condorcet winner'
      : violated
        ? zh ? `孔多塞赢家 C${cw} 未被选出（违背准则）` : `Condorcet winner C${cw} not elected (criterion violated)`
        : zh ? `孔多塞赢家 C${cw} 当选` : `Condorcet winner C${cw} elected`;
    const l2 = `${cond}  ·  ${zh ? '分票效应' : 'spoiler'}: ${r.spoiler.spoiled ? (zh ? '检出' : 'yes') : zh ? '无' : 'no'}  ·  ${zh ? '席位-得票落差' : 'seat-vote gap'}: ${(this.seatVoteGap(r) * 100).toFixed(1)}%`;
    g.fillStyle = violated ? 'rgba(220,180,140,0.98)' : 'rgba(200,210,225,0.95)';
    g.fillText(l2, 54, canvas.height - 14);
  }
}

export default function createVotingPlugin(): Plugin {
  return new VotingPlugin();
}
