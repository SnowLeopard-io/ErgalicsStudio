// ==========================================================================
// Ergalics Studio — cross-suite interop bridge
//
// The industrial suite and the research suite share one project, one plugin
// registry and one figure pipeline. This module is the only place that knows
// how industrial study data is handed to a research simulation plugin, so the
// pages stay free of plugin-lifecycle details and the dependency runs one way
// (industrial → shared stores), never research → industrial.
// ==========================================================================

import { useAppStore } from '@/stores/appStore';
import { primaryMaterial, useEngineeringStore } from '@/stores/engineeringStore';
import { runTracked, usePluginStore } from '@/stores/pluginStore';
import { ensureCase } from '@/core/engineering/cases';
import type { EngineeringStudy } from '@/core/engineering/types';

/** FEM Lab (research suite) — headless P1 finite-element simulator. */
export const FEM_LAB_PLUGIN_ID = 'example.fem-lab';

export interface SimulationCheck {
  ok: boolean;
  iterations?: number;
  residual?: number;
  error?: string;
}

/** The slice of the plugin contract this bridge needs (compute-style only). */
interface HeadlessPlugin {
  updateParams?: (params: Record<string, unknown>) => unknown;
  compute?: () => Promise<{ ok: boolean; output?: unknown; error?: string }>;
}

/**
 * Map the neutral engineering study onto the FEM Lab parameter set:
 * Young's modulus / Poisson ratio from the primary material and the plane
 * assumption from the active load step. Unknown values are left untouched so
 * the plugin keeps its own defaults instead of receiving NaN.
 */
function buildFemParams(study: EngineeringStudy): Record<string, unknown> {
  const params: Record<string, unknown> = { physics: 'elasticity' };
  const material = primaryMaterial(study);
  const youngs = Number(material?.properties.E);
  const poisson = Number(material?.properties.nu);
  if (Number.isFinite(youngs) && youngs > 0) params.E = youngs;
  if (Number.isFinite(poisson) && poisson > 0 && poisson < 0.5) params.nu = poisson;
  const steps = ensureCase(study.cases)[0]?.steps ?? [];
  const activeId = useEngineeringStore.getState().activeStepId;
  const step = steps.find((item) => item.id === activeId) ?? steps[0];
  if (step?.solver.planeState) params.planeState = step.solver.planeState;
  return params;
}

/**
 * Run the research-suite FEM simulation with the industrial study's material
 * and plane-state data. The call is recorded in the shared run history, so the
 * cross-suite invocation is reproducible like any in-suite run.
 */
export async function runFemLabCheck(study: EngineeringStudy | null): Promise<SimulationCheck> {
  if (!study) return { ok: false, error: 'no-study' };
  const store = usePluginStore.getState();
  await store.ensureBuiltinsLoaded();
  const entry = usePluginStore.getState().registry.find((item) => item.id === FEM_LAB_PLUGIN_ID);
  const plugin = entry?.plugin as HeadlessPlugin | null | undefined;
  if (!plugin?.compute) return { ok: false, error: 'plugin-unavailable' };
  try {
    await plugin.updateParams?.(buildFemParams(study));
    const result = await runTracked(
      {
        pluginId: FEM_LAB_PLUGIN_ID,
        kind: 'compute',
        label: study.name,
        detail: { source: 'industrial' },
      },
      () => plugin.compute!(),
    );
    const output = (result?.output ?? {}) as { iterations?: number; residual?: number };
    return {
      ok: Boolean(result?.ok),
      iterations: output.iterations,
      residual: output.residual,
      error: result?.error,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Focus the FEM Lab plugin in the research workbench (no reload, no data loss). */
export async function openFemLab(): Promise<void> {
  const store = usePluginStore.getState();
  await store.ensureBuiltinsLoaded();
  const app = useAppStore.getState();
  app.setMode('standard');
  app.setEmbeddedTool(null);
  app.setSidebarView('research');
  await usePluginStore.getState().activate(FEM_LAB_PLUGIN_ID);
}
