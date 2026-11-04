// ==========================================================================
// automata — Figure Studio panels
//   a. state counts for NFA / DFA / minimal DFA.
//   b. the DFA transition table rendered as a bar of out-degree per state.
// ==========================================================================

import type { PlotSpec } from '@/core/plot';
import { FIGURE_PANEL_HEIGHT, FIGURE_PANEL_WIDTH, panelPlace, panelTag, type FigurePanelSpec } from '@/core/figure/sheet';
import { OTHER_CHAR, type AutomataBuild } from './kernel';

export interface AutomataFigureInput {
  build: AutomataBuild;
  test: string;
}

export function automataFigurePanels(input: AutomataFigureInput): FigurePanelSpec[] {
  const { build } = input;
  const panels: FigurePanelSpec[] = [];
  const counts = [
    ['NFA', build.nfa.states.length],
    ['DFA', build.dfa.states.length],
    ['min DFA', build.minDfa.states.length],
  ] as const;
  panels.push({
    ...panelPlace(0),
    tag: panelTag(0),
    spec: {
      width: FIGURE_PANEL_WIDTH,
      height: FIGURE_PANEL_HEIGHT,
      title: 'Automaton state counts',
      xLabel: 'construction',
      yLabel: 'states',
      grid: true,
      ticks: 5,
      xTicksOverride: counts.map(([label], i) => ({ pos: i + 0.4, label })),
      xDomain: [-0.2, 3],
      series: [
        {
          name: 'states',
          kind: 'bar',
          color: '#b48cff',
          bars: counts.map(([, n], i) => ({ x0: i, x1: i + 0.8, y: n })),
        },
      ],
    } as PlotSpec,
  });

  const alphabet = build.dfa.alphabet.filter((c) => c !== OTHER_CHAR);
  const bars = build.dfa.states.flatMap((s, i) =>
    alphabet.map((symbol, j) => ({
      x0: i + (j / Math.max(1, alphabet.length)) * 0.8,
      x1: i + ((j + 1) / Math.max(1, alphabet.length)) * 0.8,
      y: s.trans[symbol] === undefined ? 0 : 1,
    })),
  );
  panels.push({
    ...panelPlace(1),
    tag: panelTag(1),
    spec: {
      width: FIGURE_PANEL_WIDTH,
      height: FIGURE_PANEL_HEIGHT,
      title: `DFA transitions · test “${input.test}”`,
      xLabel: 'state',
      yLabel: 'defined',
      grid: true,
      ticks: 5,
      series: [{ name: 'transition', kind: 'bar', color: '#ffd166', bars }],
    } as PlotSpec,
  });
  return panels;
}
