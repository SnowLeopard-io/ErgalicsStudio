// ==========================================================================
// netproto — Figure Studio panels
//   a. Reno congestion window and ssthresh over RTT rounds.
//   b. SRTT / RTO convergence.
//   c. message count by direction for the selected handshake.
// ==========================================================================

import type { PlotSpec } from '@/core/plot';
import { FIGURE_PANEL_HEIGHT, FIGURE_PANEL_WIDTH, panelPlace, panelTag, type FigurePanelSpec } from '@/core/figure/sheet';
import type { CongestionTrace, HandshakeResult, RtoSample } from './kernel';

export interface NetProtoFigureInput {
  trace: CongestionTrace;
  rto: RtoSample[];
  handshake: HandshakeResult;
}

export function netProtoFigurePanels(input: NetProtoFigureInput): FigurePanelSpec[] {
  const panels: FigurePanelSpec[] = [];
  panels.push({
    ...panelPlace(0),
    tag: panelTag(0),
    spec: {
      width: FIGURE_PANEL_WIDTH,
      height: FIGURE_PANEL_HEIGHT,
      title: 'Reno congestion window',
      xLabel: 'RTT round',
      yLabel: 'MSS',
      grid: true,
      ticks: 6,
      legend: true,
      series: [
        {
          name: 'cwnd',
          kind: 'line',
          color: '#ffd166',
          points: input.trace.steps.map((s) => ({ x: s.round, y: s.cwnd })),
        },
        {
          name: 'ssthresh',
          kind: 'line',
          color: '#ff8b86',
          dash: [4, 3],
          points: input.trace.steps.map((s) => ({ x: s.round, y: s.ssthresh })),
        },
      ],
    } as PlotSpec,
  });

  panels.push({
    ...panelPlace(1),
    tag: panelTag(1),
    spec: {
      width: FIGURE_PANEL_WIDTH,
      height: FIGURE_PANEL_HEIGHT,
      title: 'RTT estimation & RTO',
      xLabel: 'sample',
      yLabel: 'seconds',
      grid: true,
      ticks: 6,
      legend: true,
      series: [
        { name: 'sample', kind: 'scatter', color: '#78c8ff', points: input.rto.map((r, i) => ({ x: i + 1, y: r.sample })) },
        { name: 'SRTT', kind: 'line', color: '#5ee6d0', points: input.rto.map((r, i) => ({ x: i + 1, y: r.srtt })) },
        { name: 'RTO', kind: 'line', color: '#ffd166', points: input.rto.map((r, i) => ({ x: i + 1, y: r.rto })) },
      ],
    } as PlotSpec,
  });

  const client = input.handshake.steps.filter((s) => s.from === 'client').length;
  const server = input.handshake.steps.length - client;
  const encrypted = input.handshake.steps.filter((s) => s.encrypted).length;
  panels.push({
    ...panelPlace(2),
    tag: panelTag(2),
    spec: {
      width: FIGURE_PANEL_WIDTH,
      height: FIGURE_PANEL_HEIGHT,
      title: `Messages · ${input.handshake.steps.length} total`,
      xLabel: 'category',
      yLabel: 'count',
      grid: true,
      ticks: 5,
      xTicksOverride: [
        { pos: 0.4, label: 'client' },
        { pos: 1.4, label: 'server' },
        { pos: 2.4, label: 'encrypted' },
      ],
      xDomain: [-0.2, 3],
      series: [
        {
          name: 'messages',
          kind: 'bar',
          color: '#b48cff',
          bars: [
            { x0: 0, x1: 0.8, y: client },
            { x0: 1, x1: 1.8, y: server },
            { x0: 2, x1: 2.8, y: encrypted },
          ],
        },
      ],
    } as PlotSpec,
  });
  return panels;
}
