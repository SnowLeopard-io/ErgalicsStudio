// ==========================================================================
// Ergalics Studio — research tool registry (single source of truth)
//
// Every standalone research surface is declared exactly once here: id,
// route (/studio/<id>), legacy hash route (kept as redirects), icon,
// i18n title/description keys, launcher grid group and the lazy page
// component. Consumed by the /studio route, the top-bar launcher and the
// welcome-page launch grid.
// ==========================================================================

import { type ComponentType, type LazyExoticComponent } from 'react';
import { lazyRetry } from '@/core/lazyRetry';
import type { NavigateFunction } from 'react-router-dom';
import { useAppStore } from '@/stores/appStore';
import type { ToolIconKind } from '@/components/icons';

export type ResearchGroupId =
  | 'measure'
  | 'model'
  | 'data'
  | 'signal'
  | 'deliver'
  /** Writing and publication surfaces (LaTeX, citations, notebooks, preprints). */
  | 'publish'
  /** Lightweight no-project utilities (converters, calculators). Rendered as
   *  the last group in the launchers, visually separate from research suites. */
  | 'utils';

interface ResearchTool {
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
  /** Shown in the top-bar launcher (the welcome-page launch grid was
   *  removed). The general "analyze" surface stays reachable via its own
   *  top-bar button. */
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
  component: lazyRetry(loader),
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
  tool('model-inference', () => import('@/pages/labs/InferencePage'), {
    icon: 'model-inference', titleKey: 'tool.model-inference.title', group: 'model',
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
  tool('etl', () => import('@/pages/labs/EtlPage'), {
    icon: 'cleaning', titleKey: 'tool.etl.title', group: 'data',
  }),
  tool('schema', () => import('@/pages/labs/SchemaPage'), {
    icon: 'profiler', titleKey: 'tool.schema.title', group: 'data',
  }),
  tool('synth', () => import('@/pages/labs/SynthPage'), {
    icon: 'uncertainty', titleKey: 'tool.synth.title', group: 'data',
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
  tool('course', () => import('@/pages/labs/CoursePage'), {
    icon: 'course', titleKey: 'tool.course.title', group: 'deliver', requireProject: true,
  }),
  tool('cleaning', () => import('@/pages/labs/CleaningWizardPage'), {
    icon: 'cleaning', titleKey: 'tool.cleaning.title', group: 'data', requireProject: true,
  }),
  tool('files', () => import('@/pages/labs/FileExplorerPage'), {
    icon: 'files', titleKey: 'tool.files.title', group: 'data', requireProject: true,
  }),
  tool('gallery', () => import('@/pages/gallery/GalleryPage'), {
    icon: 'gallery', titleKey: 'tool.gallery.title', group: 'deliver',
  }),
  // ---- research writing & publication --------------------------------------
  tool('latex-editor', () => import('@/pages/publish/LatexEditorPage'), {
    icon: 'latex',
    titleKey: 'tool.latex-editor.title',
    descKey: 'tool.latex-editor.desc',
    group: 'publish',
    requireProject: true,
  }),
  tool('citation-manager', () => import('@/pages/publish/CitationManagerPage'), {
    icon: 'citation',
    titleKey: 'tool.citation-manager.title',
    descKey: 'tool.citation-manager.desc',
    group: 'publish',
    requireProject: true,
  }),
  tool('collab-notebook', () => import('@/pages/publish/CollabNotebookPage'), {
    icon: 'collab',
    titleKey: 'tool.collab-notebook.title',
    descKey: 'tool.collab-notebook.desc',
    group: 'publish',
    requireProject: true,
  }),
  tool('preprint', () => import('@/pages/publish/PreprintPage'), {
    icon: 'preprint',
    titleKey: 'tool.preprint.title',
    descKey: 'tool.preprint.desc',
    group: 'publish',
    requireProject: true,
  }),
  // ---- utility toolkit (no project required) ------------------------------
  tool('unit-convert', () => import('@/pages/utils/UnitConvertPage'), {
    icon: 'units', titleKey: 'tool.unit-convert.title', group: 'utils',
  }),
  tool('calc', () => import('@/pages/utils/CalcPage'), {
    icon: 'calc', titleKey: 'tool.calc.title', group: 'utils',
  }),
  tool('format-convert', () => import('@/pages/utils/FormatConvertPage'), {
    icon: 'convert', titleKey: 'tool.format-convert.title', group: 'utils',
  }),
  tool('sigfig', () => import('@/pages/utils/SigFigPage'), {
    icon: 'sigfig', titleKey: 'tool.sigfig.title', group: 'utils',
  }),
  tool('molar-mass', () => import('@/pages/utils/MolarMassPage'), {
    icon: 'molar', titleKey: 'tool.molar-mass.title', group: 'utils',
  }),
  tool('quick-stats', () => import('@/pages/utils/QuickStatsPage'), {
    icon: 'quickstats', titleKey: 'tool.quick-stats.title', group: 'utils',
  }),
];

export const GRID_GROUPS: ResearchGroupId[] = [
  'measure', 'model', 'data', 'signal', 'deliver', 'publish', 'utils',
];

const BY_ID = new Map(RESEARCH_TOOLS.map((x) => [x.id, x]));

export function getTool(id: string | undefined): ResearchTool | undefined {
  return id ? BY_ID.get(id) : undefined;
}

export const GRID_TOOLS = RESEARCH_TOOLS.filter((x) => x.inGrid);

/**
 * Open a research suite embedded in the Standard-mode central canvas instead
 * of navigating to its standalone /studio/<id> page. From outside the
 * workbench (welcome page, command palette) this first routes to /workbench;
 * the embedded state lives in appStore, so CentralArea picks it up on mount.
 */
export function openToolEmbedded(
  navigate: NavigateFunction,
  id: string,
  pathname: string,
): void {
  if (!getTool(id)) return;
  const app = useAppStore.getState();
  app.setMode('standard');
  app.setEmbeddedTool(id);
  if (pathname !== '/workbench') navigate('/workbench');
}
