// ==========================================================================
// Ergalics Studio — research tool registry (single source of truth)
//
// Every standalone research surface is declared exactly once here: id,
// route (/studio/<id>), legacy hash route (kept as redirects), icon,
// i18n title/description keys, launcher grid group and the lazy page
// component. Consumed by the /studio route, the top-bar launcher and the
// welcome-page launch grid.
// ==========================================================================

import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import type { ToolIconKind } from '@/components/icons';

export type ResearchGroupId = 'measure' | 'model' | 'data' | 'signal' | 'deliver';

export interface ResearchTool {
  /** Stable id, also the /studio/<id> slug. */
  id: string;
  /** Canonical route. */
  path: string;
  /** Pre-/studio hash route, preserved as a client-side redirect. */
  legacyPath: string;
  icon: ToolIconKind;
  titleKey: string;
  descKey: string;
  group: ResearchGroupId;
  /** Shown in the welcome launch grid + top-bar launcher. The general
   *  "analyze" surface stays reachable via its own top-bar button. */
  inGrid: boolean;
  /** Project-bound tools show EmptyProject until a project is active. */
  requireProject: boolean;
  component: LazyExoticComponent<ComponentType>;
}

const tool = (
  id: string,
  loader: () => Promise<{ default: ComponentType }>,
  opts: {
    icon: ToolIconKind;
    titleKey: string;
    group: ResearchGroupId;
    inGrid?: boolean;
    requireProject?: boolean;
    legacyPath?: string;
    descKey?: string;
  },
): ResearchTool => ({
  id,
  path: `/studio/${id}`,
  legacyPath: opts.legacyPath ?? `/${id}`,
  icon: opts.icon,
  titleKey: opts.titleKey,
  descKey: opts.descKey ?? `tool.${id}.desc`,
  group: opts.group,
  inGrid: opts.inGrid ?? true,
  requireProject: opts.requireProject ?? false,
  component: lazy(loader),
});

export const RESEARCH_TOOLS: ResearchTool[] = [
  tool('uncertainty', () => import('@/pages/labs/UncertaintyPage'), {
    icon: 'uncertainty', titleKey: 'uncertainty.title', group: 'measure',
  }),
  tool('profiler', () => import('@/pages/labs/ProfilerPage'), {
    icon: 'profiler', titleKey: 'profile.title', group: 'measure',
  }),
  tool('model-lab', () => import('@/pages/labs/ModelLabPage'), {
    icon: 'model-lab', titleKey: 'model.title', group: 'model',
  }),
  tool('inference', () => import('@/pages/labs/InferenceForgePage'), {
    icon: 'inference', titleKey: 'inference.title', group: 'model',
  }),
  tool('sweeps', () => import('@/pages/sweeps/SweepsPage'), {
    icon: 'sweeps', titleKey: 'sweep.title', group: 'model', requireProject: true,
  }),
  tool('sql', () => import('@/pages/sql/SqlWorkbenchPage'), {
    icon: 'sql', titleKey: 'sql.title', group: 'data', requireProject: true,
  }),
  tool('lineage', () => import('@/pages/labs/LineagePage'), {
    icon: 'lineage', titleKey: 'lineage.title', group: 'data',
  }),
  tool('figures', () => import('@/pages/figures/FigureStudioPage'), {
    icon: 'figures', titleKey: 'figure.title', group: 'data', requireProject: true,
  }),
  tool('analysis', () => import('@/pages/labs/AnalysisPage'), {
    icon: 'analysis', titleKey: 'analysis.title', group: 'data', inGrid: false,
  }),
  tool('signal', () => import('@/pages/signal/SignalLabPage'), {
    icon: 'signal', titleKey: 'signal.title', group: 'signal', requireProject: true,
  }),
  tool('notebook', () => import('@/pages/notebook/NotebookPage'), {
    icon: 'notebook', titleKey: 'notebook.title', group: 'signal', requireProject: true,
  }),
  tool('runs', () => import('@/pages/labs/RunsPage'), {
    icon: 'runs', titleKey: 'research.runs.title', group: 'signal',
  }),
  tool('report', () => import('@/pages/report/ReportBuilderPage'), {
    icon: 'report', titleKey: 'report.title', group: 'deliver', requireProject: true,
  }),
  tool('reprolock', () => import('@/pages/labs/ReproLockPage'), {
    icon: 'reprolock', titleKey: 'reprolock.title', group: 'deliver',
  }),
  tool('supplement', () => import('@/pages/labs/SupplementPage'), {
    icon: 'supplement', titleKey: 'supplement.title', group: 'deliver',
  }),
];

export const GRID_GROUPS: ResearchGroupId[] = ['measure', 'model', 'data', 'signal', 'deliver'];

const BY_ID = new Map(RESEARCH_TOOLS.map((x) => [x.id, x]));

export function getTool(id: string | undefined): ResearchTool | undefined {
  return id ? BY_ID.get(id) : undefined;
}

export const GRID_TOOLS = RESEARCH_TOOLS.filter((x) => x.inGrid);

/** Legacy path → tool map for the old-route redirects in App.tsx. */
export const TOOLS_BY_LEGACY_PATH = new Map(
  RESEARCH_TOOLS.map((x) => [x.legacyPath, x] as const),
);
