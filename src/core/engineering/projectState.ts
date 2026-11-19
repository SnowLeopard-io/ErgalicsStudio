// ==========================================================================
// Engineering project state (serialized into `.clproj`)
//
// `study/engineering.json`-equivalent payload kept inside the project file so
// a project reopens with its study, last solve result and design scan. The
// original imported file is mirrored into the workspace (`geometry/`,
// `mesh/`) by the import store.
// ==========================================================================

import type { StudySnapshot } from './study';
import type { EngineeringResultSnapshot } from './solve';

export interface EngineeringScanRow {
  id: string;
  name: string;
  params: Record<string, number>;
  metrics: Record<string, number>;
}

export interface EngineeringProjectState {
  study?: StudySnapshot | null;
  result?: EngineeringResultSnapshot | null;
  scan?: EngineeringScanRow[] | null;
  activeStepId?: string | null;
  updatedAt?: number;
}

/** Study payload path used when exporting the engineering JSON document. */
export const ENGINEERING_STUDY_PATH = 'study/engineering.json';
