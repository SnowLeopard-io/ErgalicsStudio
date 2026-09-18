// ==========================================================================
// FR-01 — Subject template library: public API
//
// `loadTemplate(id)` builds the template's project (deterministic example
// data, see ./data.ts), persists + applies it through the project store, and
// arms the guided-tour overlay. Returns the workbench route to navigate to.
// ==========================================================================

import { serializeProject } from '@/types/project';
import { useProjectStore } from '@/stores/projectStore';
import { useTemplateTourStore } from '@/stores/templateTourStore';
import { getTemplate } from './catalog';

export type {
  LocalizedText,
  SubjectTemplate,
  TemplateDifficulty,
  TemplateStep,
  TemplateSubject,
} from './catalog';
export { SUBJECT_TEMPLATES, getTemplate, pickLocale, GALLERY_ID_TO_TEMPLATE } from './catalog';

export interface TemplateLoadSuccess {
  ok: true;
  templateId: string;
  projectId: string;
  /** Route to land on (first concrete tool step, else the workbench). */
  route: string;
}

export interface TemplateLoadFailure {
  ok: false;
  templateId: string;
  error: string;
}

export type LoadResult = TemplateLoadSuccess | TemplateLoadFailure;

/** Create + open the template's project and arm the guided tour. */
export async function loadTemplate(id: string): Promise<LoadResult> {
  const tpl = getTemplate(id);
  if (!tpl) return { ok: false, templateId: id, error: 'unknown_template' };
  try {
    const project = tpl.buildProject();
    await useProjectStore.getState().loadProjectFromText(serializeProject(project));
    useTemplateTourStore.getState().start(tpl.id);
    const route =
      tpl.steps.find((s) => s.toolRoute && s.toolRoute !== '/workbench')?.toolRoute ?? '/workbench';
    return { ok: true, templateId: tpl.id, projectId: project.id, route };
  } catch (err) {
    return { ok: false, templateId: id, error: String(err) };
  }
}
