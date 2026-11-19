// ==========================================================================
// Ergalics Studio — industrial engineering store
//
// Owns the active EngineeringStudy (mesh + materials + BCs + cases), the
// last solve result, and the design scan. Every mutation is mirrored into
// `project.state.engineering` so the study survives save/reopen, and marks
// the project dirty. The store is intentionally UI-agnostic: tool pages read
// it, the right panel summarises it.
// ==========================================================================

import { create } from 'zustand';
import { logger } from '@/core/logger';
import {
  cloneStudy,
  engineeringFingerprint,
  fromStudySnapshot,
  toStudySnapshot,
  type EngineeringFingerprint,
  type StudySnapshot,
} from '@/core/engineering/study';
import {
  fromResultSnapshot,
  runUniaxialBenchmark,
  solveEngineeringStudy,
  toResultSnapshot,
  SOLVER_NAME,
  type BenchmarkResult,
} from '@/core/engineering/solve';
// Dynamic import below (inside solve) avoids a module-init cycle:
// engineeringStore → experimentStore → projectStore → blockStore → engineeringStore.
import {
  applyDesignPoint,
  defaultCase,
  ensureCase,
  expandDesign,
  makeStep,
  normalizeStep,
} from '@/core/engineering/cases';
import {
  materialFromTemplate,
  makeMaterial,
  resolveMaterial,
} from '@/core/engineering/materials';
import { geometryToStudy } from '@/core/engineering/geometry';
import {
  isEngineeringExtension,
  isGeometryExtension,
  parseEngineeringFile,
  meshSummary,
} from '@/core/engineering';
import { buildEngineeringReport, type EngineeringReport } from '@/core/engineering/report';
import {
  runEngineeringBuild,
  clearEngineeringBuildCache,
  type EngineeringBuild,
} from '@/core/engineering/build';
import type { BuildStats } from '@/core/build/engine';
import type {
  BoundaryCondition,
  EngineeringCase,
  EngineeringMaterial,
  EngineeringSolveResult,
  EngineeringStep,
  EngineeringStepKind,
  EngineeringStudy,
} from '@/core/engineering/types';
import type {
  EngineeringProjectState,
  EngineeringScanRow,
} from '@/core/engineering/projectState';
import { ENGINEERING_STUDY_PATH } from '@/core/engineering/projectState';
import { useProjectStore, getProjectRepoPath, getProjectSession } from './projectStore';
import { useAppStore } from './appStore';
import { getVfs } from '@/core/vfs';
import { t, getLocale } from '@/i18n';

interface EngineeringStore {
  study: EngineeringStudy | null;
  result: EngineeringSolveResult | null;
  scan: EngineeringScanRow[];
  activeStepId: string | null;
  benchmark: BenchmarkResult | null;
  solving: boolean;
  error: string | null;
  /** Content-addressed build report of the last solve (hits / recompute). */
  buildStats: BuildStats | null;
  /** True when the last solve came from the cache. */
  buildCached: boolean;

  /** Parse a text payload and make it the active study. Also mirrors the
   *  original file into the workspace (`mesh/` or `geometry/`). */
  importText: (text: string, name: string, sourcePath?: string) => EngineeringStudy | null;
  /** Import from a File (drop / file picker); mirrors binary-safe text. */
  importFile: (file: File) => Promise<EngineeringStudy | null>;
  setStudy: (study: EngineeringStudy | null) => void;
  /** Project lifecycle: load the study stored in `.clproj`. */
  loadFromProject: (project: { state: { engineering?: EngineeringProjectState | null } } | null) => void;
  clear: () => void;

  addMaterial: (templateId?: string, name?: string) => void;
  updateMaterialProperty: (materialName: string, property: string, value: number) => void;
  removeMaterial: (materialName: string) => void;
  assignMaterialTag: (tag: number, materialName: string) => void;

  addBoundaryCondition: (condition: BoundaryCondition) => void;
  updateBoundaryCondition: (index: number, patch: Partial<BoundaryCondition>) => void;
  removeBoundaryCondition: (index: number) => void;

  activeCase: () => EngineeringCase | null;
  addStep: (kind: EngineeringStepKind, name?: string) => void;
  updateStep: (stepId: string, patch: Partial<EngineeringStep>) => void;
  removeStep: (stepId: string) => void;
  selectStep: (stepId: string) => void;

  updateCaseDesign: (design: EngineeringCase['design']) => void;

  /** Solve through the shared content-addressed build engine (cache + proof). */
  solve: (stepId?: string) => Promise<EngineeringSolveResult | null>;
  /** Clear cached engineering solves. */
  clearBuildCache: () => void;
  runBenchmark: () => BenchmarkResult;
  runScan: (points?: number) => Promise<EngineeringScanRow[]>;
  fingerprint: () => EngineeringFingerprint | null;
  buildReport: () => EngineeringReport | null;
  /** Persist the study JSON into the workspace (`study/engineering.json`). */
  saveStudyJson: () => Promise<boolean>;
  /** Compact summary for the right panel / status surfaces. */
  summary: () => string;
}

/** Fill defaults the editors and solver rely on. */
function ensureDefaults(study: EngineeringStudy): EngineeringStudy {
  const next = cloneStudy(study);
  if (next.materials.length === 0) {
    const steel = materialFromTemplate('steel-q235');
    if (steel) next.materials.push(steel);
  }
  if (!next.cases || next.cases.length === 0) next.cases = [defaultCase()];
  next.cases = next.cases.map((studyCase) => ({
    ...studyCase,
    steps: studyCase.steps.map(normalizeStep),
    design: studyCase.design ?? { parameters: [], points: [] },
  }));
  if (!next.materialAssignment) {
    const first = next.materials[0]?.name;
    if (first) {
      next.materialAssignment = {};
      const tags = new Set(
        next.mesh.elements
          .map((element) => element.group)
          .filter((tag): tag is number => typeof tag === 'number' && tag !== 0),
      );
      for (const tag of tags) next.materialAssignment[String(tag)] = first;
    }
  }
  return next;
}

function persistState(state: EngineeringProjectState): void {
  const project = useProjectStore.getState().project;
  if (!project) return;
  useProjectStore.setState({
    project: {
      ...project,
      updatedAt: Date.now(),
      state: { ...project.state, engineering: state },
    },
  });
  // Route through the store action: a raw `dirty: true` bypassed editRevision
  // (breaking save-change detection) and the 2s dirty-flush debounce.
  useProjectStore.getState().setDirty(true);
}

function persistStudy(
  study: EngineeringStudy | null,
  result: EngineeringSolveResult | null,
  scan: EngineeringScanRow[],
  activeStepId: string | null,
): void {
  persistState({
    study: study ? toStudySnapshot(study) : null,
    result: result ? toResultSnapshot(result) : null,
    scan,
    activeStepId,
    updatedAt: Date.now(),
  });
}

export const useEngineeringStore = create<EngineeringStore>((set, get) => ({
  study: null,
  result: null,
  scan: [],
  activeStepId: null,
  benchmark: null,
  solving: false,
  error: null,
  buildStats: null,
  buildCached: false,

  importText: (text, name, sourcePath) => {
    try {
      if (!isEngineeringExtension(name)) {
        set({ error: `unsupported engineering file: ${name}` });
        return null;
      }
      const parsed = parseEngineeringFile(text, name);
      const study = ensureDefaults(parsed);
      const step = ensureCase(study.cases)[0]!.steps[0]!;
      set({
        study,
        result: null,
        scan: [],
        activeStepId: step.id,
        error: null,
        benchmark: null,
        solving: false,
        buildStats: null,
        buildCached: false,
      });
      persistStudy(study, null, [], step.id);
      // Mirror the source into the industrial workspace folders. Failures are
      // non-fatal (a study can be edited without a project open).
      const project = useProjectStore.getState().project;
      if (project && project.domain !== 'industrial') {
        // Importing engineering data promotes the project to the industrial
        // capability list so its VFS/UI defaults follow the study.
        useProjectStore.setState({
          project: { ...project, domain: 'industrial', updatedAt: Date.now() },
          dirty: true,
        });
      }
      if (project) {
        const folder = isGeometryExtension(name) ? 'geometry' : 'mesh';
        const relative = sourcePath && sourcePath.includes('/')
          ? sourcePath
          : `${folder}/${name}`;
        void getVfs()
          .writeFile(getProjectRepoPath(project), relative, text)
          .then(() => useAppStore.getState().bumpFileOps())
          .catch((err) => logger.warn('engineering', 'workspace mirror failed', err));
      }
      return study;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn('engineering', 'import failed', err);
      set({ error: message });
      return null;
    }
  },

  importFile: async (file) => {
    try {
      const text = await file.text();
      return get().importText(text, file.name);
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
      return null;
    }
  },

  setStudy: (study) => {
    const next = study ? ensureDefaults(study) : null;
    const step = next ? ensureCase(next.cases)[0]!.steps[0]! : null;
    if (next) {
      const project = useProjectStore.getState().project;
      if (project && project.domain !== 'industrial') {
        useProjectStore.setState({
          project: { ...project, domain: 'industrial', updatedAt: Date.now() },
          dirty: true,
        });
      }
    }
    set({
      study: next,
      activeStepId: step?.id ?? null,
      result: null,
      scan: [],
      error: null,
    });
    persistStudy(next, null, [], step?.id ?? null);
  },

  loadFromProject: (project) => {
    const stored = project?.state.engineering;
    const study = stored?.study ? fromStudySnapshot(stored.study) : null;
    if (!study) {
      set({
        study: null,
        result: null,
        scan: [],
        activeStepId: null,
        error: null,
        solving: false,
        buildStats: null,
        buildCached: false,
      });
      return;
    }
    const normalized = ensureDefaults(study);
    const stepId =
      stored?.activeStepId &&
      ensureCase(normalized.cases).some((studyCase) =>
        studyCase.steps.some((step) => step.id === stored.activeStepId),
      )
        ? stored.activeStepId
        : ensureCase(normalized.cases)[0]!.steps[0]!.id;
    set({
      study: normalized,
      result: stored?.result ? fromResultSnapshot(stored.result) : null,
      scan: stored?.scan ?? [],
      activeStepId: stepId,
      error: null,
      solving: false,
      buildStats: null,
      buildCached: false,
    });
  },

  clear: () => {
    set({
      study: null,
      result: null,
      scan: [],
      activeStepId: null,
      error: null,
      benchmark: null,
      solving: false,
      buildStats: null,
      buildCached: false,
    });
    persistState({ study: null, result: null, scan: [], activeStepId: null, updatedAt: Date.now() });
  },

  addMaterial: (templateId, name) => {
    const study = get().study;
    if (!study) return;
    const next = cloneStudy(study);
    const material = templateId
      ? materialFromTemplate(templateId, name)
      : makeMaterial(name ?? `Material ${next.materials.length + 1}`, { E: 2.1e11, nu: 0.3, rho: 7850 });
    if (!material) return;
    // Material names key the update/remove lookups and the fingerprint's
    // materialHashes Record: a duplicate name would let the fingerprint
    // overwrite the first material while the solver still reads the first,
    // making the cache key disagree with the actual inputs. Deduplicate.
    const taken = new Set(next.materials.map((item) => item.name));
    if (taken.has(material.name)) {
      let suffix = 2;
      while (taken.has(`${material.name} (${suffix})`)) suffix += 1;
      material.name = `${material.name} (${suffix})`;
    }
    next.materials.push(material);
    // Any study mutation invalidates results/scan: keeping solve metrics
    // computed from an older model would be silently misleading.
    set({ study: next, result: null, scan: [] });
    persistStudy(next, null, [], get().activeStepId);
  },

  updateMaterialProperty: (materialName, property, value) => {
    const study = get().study;
    if (!study) return;
    const next = cloneStudy(study);
    const material = next.materials.find((item) => item.name === materialName);
    if (!material) return;
    material.properties = { ...material.properties, [property]: value };
    // Any study mutation invalidates results/scan: keeping solve metrics
    // computed from an older model would be silently misleading.
    set({ study: next, result: null, scan: [] });
    persistStudy(next, null, [], get().activeStepId);
  },

  removeMaterial: (materialName) => {
    const study = get().study;
    if (!study) return;
    const next = cloneStudy(study);
    next.materials = next.materials.filter((item) => item.name !== materialName);
    if (next.materialAssignment) {
      next.materialAssignment = Object.fromEntries(
        Object.entries(next.materialAssignment).filter(([, name]) => name !== materialName),
      );
    }
    // Any study mutation invalidates results/scan: keeping solve metrics
    // computed from an older model would be silently misleading.
    set({ study: next, result: null, scan: [] });
    persistStudy(next, null, [], get().activeStepId);
  },

  assignMaterialTag: (tag, materialName) => {
    const study = get().study;
    if (!study) return;
    const next = cloneStudy(study);
    next.materialAssignment = { ...(next.materialAssignment ?? {}), [String(tag)]: materialName };
    // Any study mutation invalidates results/scan: keeping solve metrics
    // computed from an older model would be silently misleading.
    set({ study: next, result: null, scan: [] });
    persistStudy(next, null, [], get().activeStepId);
  },

  addBoundaryCondition: (condition) => {
    const study = get().study;
    if (!study) return;
    const next = cloneStudy(study);
    next.boundaryConditions.push(condition);
    // Any study mutation invalidates results/scan: keeping solve metrics
    // computed from an older model would be silently misleading.
    set({ study: next, result: null, scan: [] });
    persistStudy(next, null, [], get().activeStepId);
  },

  updateBoundaryCondition: (index, patch) => {
    const study = get().study;
    if (!study || !study.boundaryConditions[index]) return;
    const next = cloneStudy(study);
    next.boundaryConditions[index] = { ...next.boundaryConditions[index]!, ...patch };
    // Any study mutation invalidates results/scan: keeping solve metrics
    // computed from an older model would be silently misleading.
    set({ study: next, result: null, scan: [] });
    persistStudy(next, null, [], get().activeStepId);
  },

  removeBoundaryCondition: (index) => {
    const study = get().study;
    if (!study) return;
    const next = cloneStudy(study);
    next.boundaryConditions.splice(index, 1);
    // Any study mutation invalidates results/scan: keeping solve metrics
    // computed from an older model would be silently misleading.
    set({ study: next, result: null, scan: [] });
    persistStudy(next, null, [], get().activeStepId);
  },

  activeCase: () => {
    const study = get().study;
    if (!study) return null;
    return ensureCase(study.cases)[0] ?? null;
  },

  addStep: (kind, name) => {
    const study = get().study;
    if (!study) return;
    const next = cloneStudy(study);
    const cases = ensureCase(next.cases);
    const step = makeStep(name ?? defaultStepName(kind), kind);
    cases[0]!.steps.push(step);
    next.cases = cases;
    set({ study: next, activeStepId: step.id, result: null, scan: [] });
    persistStudy(next, null, [], step.id);
  },

  updateStep: (stepId, patch) => {
    const study = get().study;
    if (!study) return;
    const next = cloneStudy(study);
    for (const studyCase of ensureCase(next.cases)) {
      const step = studyCase.steps.find((candidate) => candidate.id === stepId);
      if (!step) continue;
      // Merge solver before Object.assign overwrites it with a partial patch.
      const mergedSolver = patch.solver ? { ...step.solver, ...patch.solver } : undefined;
      Object.assign(step, patch);
      if (mergedSolver) step.solver = mergedSolver;
    }
    // Any study mutation invalidates results/scan: keeping solve metrics
    // computed from an older model would be silently misleading.
    set({ study: next, result: null, scan: [] });
    persistStudy(next, null, [], get().activeStepId);
  },

  removeStep: (stepId) => {
    const study = get().study;
    if (!study) return;
    const next = cloneStudy(study);
    for (const studyCase of ensureCase(next.cases)) {
      if (studyCase.steps.length <= 1) continue;
      studyCase.steps = studyCase.steps.filter((step) => step.id !== stepId);
    }
    next.cases = ensureCase(next.cases);
    const active =
      get().activeStepId === stepId ? next.cases[0]!.steps[0]!.id : get().activeStepId;
    set({ study: next, activeStepId: active, result: null, scan: [] });
    persistStudy(next, null, [], active);
  },

  selectStep: (stepId) => {
    set({ activeStepId: stepId });
    const study = get().study;
    if (study) persistStudy(study, get().result, get().scan, stepId);
  },

  updateCaseDesign: (design) => {
    const study = get().study;
    if (!study) return;
    const next = cloneStudy(study);
    const cases = ensureCase(next.cases);
    cases[0]!.design = design;
    next.cases = cases;
    // Any study mutation invalidates results/scan: keeping solve metrics
    // computed from an older model would be silently misleading.
    set({ study: next, result: null, scan: [] });
    persistStudy(next, null, [], get().activeStepId);
  },

  solve: async (stepId) => {
    if (get().solving) return null;
    const study = get().study;
    if (!study) return null;
    const step =
      ensureCase(study.cases)
        .flatMap((studyCase) => studyCase.steps)
        .find((candidate) => candidate.id === (stepId ?? get().activeStepId)) ??
      ensureCase(study.cases)[0]!.steps[0]!;
    // Capture the session + study reference BEFORE the await: edits during the
    // solve replace the study object and a project switch changes the session.
    // Resolving against either stale target would roll the user's edits back
    // or persist this study into another project.
    const session = getProjectSession();
    const projectId = useProjectStore.getState().project?.id;
    set({ solving: true, error: null });
    try {
      const built: EngineeringBuild = await runEngineeringBuild(study, { step });
      const project = useProjectStore.getState().project;
      if (getProjectSession() !== session || project?.id !== projectId) {
        // Project switched mid-solve: drop the result. The switch reset
        // `solving`; a newer solve may own the flag now — don't touch it.
        return null;
      }
      if (get().study !== study) {
        // Edited mid-solve (same project): keep the edits, discard the result.
        set({ solving: false });
        return null;
      }
      const result = built.result;
      const next = cloneStudy(study);
      next.fields = result.fields;
      set({
        study: next,
        result,
        solving: false,
        activeStepId: step.id,
        buildStats: built.stats,
        buildCached: built.cached,
      });
      persistStudy(next, result, get().scan, step.id);
      // Make the solve visible in /studio/runs, lineage and auto-commit, just
      // like a Flow run — with its build breakdown and attestation digest.
      const stats = built.stats;
      const ran = stats.cached + stats.computed;
      // Fire-and-forget: never block the solve on the run recorder, and load
      // lazily to avoid the store import cycle at module init.
      void import('./experimentStore').then(({ useExperimentStore }) =>
        useExperimentStore.getState().recordRun({
        source: 'industrial',
        label: `${study.name} · ${step.name}`,
        params: { stepId: step.id, stepKind: step.kind, solver: SOLVER_NAME },
        inputsHash: built.attestation.planHash,
        metrics: Object.fromEntries(
          Object.entries(result.metrics).filter(([, value]) => typeof value === 'number' && Number.isFinite(value)),
        ),
        durationMs: stats.durationMs,
        build: {
          total: stats.total,
          computed: stats.computed,
          cached: stats.cached,
          blocked: stats.blocked,
          failed: stats.failed,
          durationMs: stats.durationMs,
          planHash: stats.planHash,
          environment: stats.environment,
          cacheHitRate: ran > 0 ? stats.cached / ran : 0,
          attestationDigest: built.attestation.digest,
        },
        }),
      );
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn('engineering', 'solve failed', err);
      // Same staleness guard as the success path: after a project switch the
      // flag/error surface belongs to the new project's state.
      if (
        getProjectSession() === session &&
        useProjectStore.getState().project?.id === projectId
      ) {
        set({ solving: false, error: message });
        useAppStore.getState().notify('error', message);
      }
      return null;
    }
  },

  clearBuildCache: () => {
    clearEngineeringBuildCache();
    set({ buildStats: null, buildCached: false });
  },

  runBenchmark: () => {
    const benchmark = runUniaxialBenchmark();
    set({ benchmark });
    return benchmark;
  },

  runScan: async (points) => {
    const study = get().study;
    if (!study) return [];
    const studyCase = ensureCase(study.cases)[0]!;
    const designPoints = expandDesign(studyCase.design, { samples: points });
    if (designPoints.length === 0) return [];
    const stepId = get().activeStepId;
    // The batches below yield to the event loop, so the study/project can
    // change mid-scan. Capture the targets now and re-validate before
    // persisting so a stale scan never lands in another project/state.
    const session = getProjectSession();
    const projectId = useProjectStore.getState().project?.id;
    const rows: EngineeringScanRow[] = [];
    const cap = 2048;
    const batchSize = 64;
    const limited = designPoints.slice(0, cap);
    for (let index = 0; index < limited.length; index += 1) {
      const point = limited[index]!;
      const variant = cloneStudy(study);
      const variantSteps = ensureCase(variant.cases)[0]!.steps;
      const warnings = applyDesignPoint({
        point,
        materials: variant.materials,
        steps: variantSteps,
        boundaryConditions: variant.boundaryConditions,
      });
      if (warnings.length > 0) logger.debug('engineering', 'scan warnings', warnings);
      // Resolve the step from the MUTATED variant: step.<id>.* design knobs
      // only take effect when read after applyDesignPoint.
      const step = variantSteps.find((candidate) => candidate.id === stepId) ?? variantSteps[0]!;
      try {
        const result = solveEngineeringStudy(variant, { step });
        rows.push({
          id: point.id,
          name: point.name,
          params: point.params,
          metrics: result.metrics,
        });
      } catch (err) {
        rows.push({
          id: point.id,
          name: point.name,
          params: point.params,
          metrics: { error: 1 },
        });
        logger.debug('engineering', 'scan point failed', err);
      }
      // Yield between batches: keeps the busy spinner painting and the main
      // thread responsive across a full-cap scan.
      if (index % batchSize === batchSize - 1 && index < limited.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }
    if (
      getProjectSession() !== session ||
      useProjectStore.getState().project?.id !== projectId ||
      get().study !== study
    ) {
      // Stale scan (edit or project switch mid-run): rows stay local.
      return rows;
    }
    set({ scan: rows });
    persistStudy(study, get().result, rows, get().activeStepId);
    return rows;
  },

  fingerprint: () => {
    const study = get().study;
    return study ? engineeringFingerprint(study) : null;
  },

  buildReport: () => {
    const { study, result, benchmark } = get();
    if (!study) return null;
    return buildEngineeringReport({
      study,
      result,
      locale: getLocale().startsWith('zh') ? 'zh' : 'en',
      benchmark: benchmark
        ? {
            name: benchmark.name,
            relativeError: benchmark.relativeError,
            order: benchmark.order,
          }
        : null,
    });
  },

  saveStudyJson: async () => {
    const study = get().study;
    const project = useProjectStore.getState().project;
    if (!study || !project) return false;
    try {
      const payload: StudySnapshot & { fingerprint?: EngineeringFingerprint } = {
        ...toStudySnapshot(study),
        fingerprint: engineeringFingerprint(study),
      };
      await getVfs().writeFile(
        getProjectRepoPath(project),
        ENGINEERING_STUDY_PATH,
        JSON.stringify(payload, null, 2),
      );
      useAppStore.getState().bumpFileOps();
      useAppStore.getState().notify('success', t('industrial.saved_study'));
      return true;
    } catch (err) {
      logger.warn('engineering', 'study export failed', err);
      useAppStore.getState().notify('error', t('industrial.save_failed'));
      return false;
    }
  },

  summary: () => {
    const study = get().study;
    if (!study) return '';
    const material = resolveMaterial(study.materials, study.materialAssignment, 0);
    return `${meshSummary(study.mesh)} · ${material?.name ?? '—'}`;
  },
}));

function defaultStepName(kind: EngineeringStepKind): string {
  switch (kind) {
    case 'static-structural': return 'Static structural';
    case 'steady-heat': return 'Steady heat';
    case 'transient-heat': return 'Transient heat';
    case 'potential-flow': return 'Potential flow';
    default: return 'Step';
  }
}

/** Convenience: default case of a study (used by pages). */
export function caseOf(study: EngineeringStudy): EngineeringCase {
  return ensureCase(study.cases)[0]!;
}

/** Convenience: material currently used by the study. */
export function primaryMaterial(study: EngineeringStudy): EngineeringMaterial | undefined {
  return resolveMaterial(study.materials, study.materialAssignment, 0);
}

export { geometryToStudy };
