// ==========================================================================
// Ergalics Studio — shared industrial page chrome
//
// The geometry / mesh / material / case / solve / post pages all share one
// shell: project-aware study loading, the portal action bar, a page header
// with the registry icon (same icon resource as the research suite), the
// study summary strip, and the publication-grade plot renderer.
// ==========================================================================

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useLocation } from 'react-router-dom';
import { useT, useLocale } from '@/i18n';
import { ToolShell } from '@/components/ToolShell';
import { EmptyState } from '@/components/EmptyState';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { ToolIcon } from '@/components/icons';
import { getTool } from '@/pages/research/toolRegistry';
import { sendSpecToFigure } from '@/pages/research/researchUi';
import { EngineeringImportButton } from './ImportButton';
import { useProjectStore } from '@/stores/projectStore';
import { primaryMaterial, useEngineeringStore } from '@/stores/engineeringStore';
import { toolTabKey, useAppStore } from '@/stores/appStore';
import { useIndustrialChrome } from '@/stores/industrialChromeStore';
import { renderSVG } from '@ergalics/plugin-sdk/plot';
import type { PlotSpec } from '@ergalics/plugin-sdk/plot';
import { INDUSTRIAL_EXAMPLES } from '@/core/engineering/examples';
import type { EngineeringField } from '@/core/engineering/types';
import { fieldLabel, localizedMeshSummary } from './labels';

/** Load the active project's engineering study exactly once per project. */
export function useStudyLoaded(): void {
  const project = useProjectStore((s) => s.project);
  const projectId = project?.id ?? null;
  const loadedId = useRef<string | null>(null);
  useEffect(() => {
    if (projectId === loadedId.current) return;
    loadedId.current = projectId;
    // A different project must not inherit the previous study/result.
    // `loadFromProject` already resets the store when the snapshot is empty;
    // calling `clear()` first would persist `null` into the newly opened
    // project's state (it writes through to `project.state.engineering`) and
    // the next autosave would wipe the stored study.
    useEngineeringStore.getState().loadFromProject(project);
  }, [projectId, project]);
}

export function Page({ toolId, children }: { toolId: string; children: ReactNode }) {
  useStudyLoaded();
  return <ToolShell toolId={toolId}>{children}</ToolShell>;
}

/**
 * Every suite edits one shared study, so loading a model anywhere replaces
 * the user's configured materials, boundary conditions and results. Route
 * each load through this guard: with a study already in place it asks before
 * replacing, without one it just proceeds. Render the returned `dialog`
 * alongside the component that guards its load actions.
 */
export function useStudyReplaceGuard() {
  const t = useT();
  const study = useEngineeringStore((s) => s.study);
  const [pending, setPending] = useState<{ run: () => void } | null>(null);
  // Enter/space key repeat and fast double clicks can fire onConfirm twice
  // before React clears `pending`; the ref makes the action run exactly once.
  const consumed = useRef(false);
  const guard = (action: () => void) => {
    if (study) {
      consumed.current = false;
      setPending({ run: action });
    } else {
      action();
    }
  };
  const close = () => {
    consumed.current = true;
    setPending(null);
  };
  const dialog = (
    <ConfirmDialog
      open={pending !== null}
      title={t('industrial.replace_title')}
      message={t('industrial.replace_message')}
      name={study?.name}
      danger
      confirmLabel={t('industrial.replace_confirm')}
      onConfirm={() => {
        if (consumed.current) return;
        consumed.current = true;
        const action = pending?.run;
        setPending(null);
        action?.();
      }}
      onClose={close}
    />
  );
  return { guard, dialog };
}

/**
 * Operation bars for industrial pages. Embedded in the workbench they portal
 * into the right sidebar (RightPanel registers the host), so the canvas only
 * shows the viewport, charts and tables. Standalone /studio pages have no
 * sidebar and keep the bars inline; a collapsed sidebar simply hides them.
 */
export function IndustrialActions({ toolId, children }: { toolId: string; children: ReactNode }) {
  const { pathname } = useLocation();
  const activeTab = useAppStore((s) => s.activeTab);
  const host = useIndustrialChrome((s) => s.host);
  if (pathname.startsWith('/studio')) {
    // Standalone pages have no right sidebar; the toolbars render inline and
    // every export carries its own explicit destination (download / save).
    return <>{children}</>;
  }
  // Hidden canvas tabs stay mounted, so without this guard every open
  // industrial page would portal its bars into the same sidebar host and the
  // panel would mix several tools' actions together.
  if (activeTab !== toolTabKey(toolId)) return null;
  return host ? createPortal(children, host) : null;
}

export interface ExportItem {
  label: string;
  disabled?: boolean;
  onDownload: () => void;
  onSave: () => void;
}

/**
 * The two export destinations every industrial suite offers: browser download
 * and save-to-workspace, as explicit button rows instead of a checkbox that
 * silently reroutes the same buttons.
 */
export function ExportGroups({ items }: { items: ExportItem[] }) {
  const t = useT();
  if (items.length === 0) return null;
  return (
    <div className="ind-export-groups">
      <div className="ind-export-group">
        <span className="ind-export-label">{t('industrial.download')}</span>
        <div className="ind-export-row">
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              className="btn btn-sm"
              disabled={item.disabled}
              onClick={item.onDownload}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
      <div className="ind-export-group">
        <span className="ind-export-label">{t('industrial.save_to_workspace')}</span>
        <div className="ind-export-row">
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              className="btn btn-sm"
              disabled={item.disabled}
              onClick={item.onSave}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Page title row: shared registry icon + title + live study summary. */
export function PageHead({ toolId, title }: { toolId: string; title?: string }) {
  const t = useT();
  const tool = getTool(toolId);
  return (
    <header className="ind-page-head">
      <h2 className="ind-page-head-title">
        {tool && (
          <span className="ind-page-head-icon" aria-hidden="true">
            <ToolIcon kind={tool.icon} size={16} />
          </span>
        )}
        {title ?? (tool ? t(tool.titleKey) : toolId)}
      </h2>
      <StudyMeta />
    </header>
  );
}

export function StudyMeta() {
  const t = useT();
  const study = useEngineeringStore((s) => s.study);
  // Mesh statistics are O(elements): cache the summary per mesh reference so
  // page re-renders do not rescan the whole mesh every time.
  const mesh = study?.mesh ?? null;
  const meshSummary = useMemo(() => (mesh ? localizedMeshSummary(t, mesh) : ''), [t, mesh]);
  if (!study) return null;
  const material = primaryMaterial(study);
  return (
    <div className="ind-meta">
      <span className="tag">{study.sourceFormat}</span>
      <span>{meshSummary}</span>
      <span>{material?.name ?? '—'}</span>
    </div>
  );
}

export function NoStudy({
  children,
  toolId,
  title,
  description,
}: {
  children?: ReactNode;
  /** Prefer an example built for this tool (e.g. DXF/STEP for geometry). */
  toolId?: string;
  /** Override the empty-state copy (e.g. study loaded but no geometry). */
  title?: string;
  description?: string;
}) {
  const t = useT();
  const { locale } = useLocale();
  const notify = useAppStore((s) => s.notify);
  const setStudy = useEngineeringStore((s) => s.setStudy);
  const { guard, dialog } = useStudyReplaceGuard();
  // A dead end is the worst first-run experience: offer a solvable sample and
  // a way into the mesh viewer instead of only telling the user something is
  // missing.
  const loadExample = () => {
    guard(() => {
      const example =
        INDUSTRIAL_EXAMPLES.find((candidate) => candidate.toolId === toolId) ??
        INDUSTRIAL_EXAMPLES[0];
      if (!example) return;
      setStudy(example.build());
      notify('success', t('industrial.example_loaded', {
        name: example.nameI18n[locale.startsWith('zh') ? 'zh-CN' : 'en-US'],
      }));
      // Geometry examples only make sense in the geometry viewer — open that
      // tool so the freshly loaded study is actually visible. Otherwise the
      // user stays on the same empty page and the button looks dead.
      if (example.toolId) useAppStore.getState().setEmbeddedTool(example.toolId);
    });
  };
  return (
    <div className="ind-empty">
      <EmptyState
        title={title ?? t('industrial.no_study')}
        description={description ?? t('industrial.no_study_desc')}
      />
      {children ?? (
        <div className="ind-toolbar analysis-row ind-empty-actions">
          <button type="button" className="btn btn-sm btn-primary" onClick={loadExample}>
            {t('industrial.load_example')}
          </button>
          {/* There are many examples and project files — open the shared
              industrial window so the user can pick instead of guessing. */}
          <EngineeringImportButton label={t('industrial.open_import_window')} />
          {/* On the mesh viewer itself this button would be a no-op. */}
          {toolId !== 'mesh-viewer' && (
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => useAppStore.getState().setEmbeddedTool('mesh-viewer')}
            >
              {t('industrial.open_mesh_viewer')}
            </button>
          )}
        </div>
      )}
      {dialog}
    </div>
  );
}

/** Inline SVG chart using the shared publication-grade plot renderer. */
export function SvgPlot({ spec }: { spec: PlotSpec }) {
  const markup = useMemo(() => renderSVG(spec), [spec]);
  return (
    <div
      className="analysis-svg ind-chart"
      // The renderer emits trusted, locally generated SVG markup.
      dangerouslySetInnerHTML={{ __html: markup }}
    />
  );
}

export function FieldPicker({
  fields,
  value,
  onChange,
}: {
  fields: EngineeringField[];
  value: string;
  onChange: (name: string) => void;
}) {
  const t = useT();
  if (fields.length === 0) return null;
  return (
    <label className="ind-field">
      <span>{t('industrial.field')}</span>
      <select className="input input-sm" value={value} onChange={(e) => onChange(e.target.value)}>
        {fields.map((field) => (
          <option key={field.name} value={field.name}>
            {fieldLabel(t, field.name)} {field.unit ? `(${field.unit})` : ''}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * Send a PlotSpec into the shared figure pipeline. Unlike a bare
 * `sendSpecToFigure` call this surfaces whether the panel actually landed, so
 * a stale project with no sheet never fails silently.
 */
export function useSendFigure(): (name: string, spec: PlotSpec, caption?: string) => void {
  const t = useT();
  const notify = useAppStore((s) => s.notify);
  return (name, spec, caption) => {
    const ok = sendSpecToFigure(name, spec, caption);
    notify(ok ? 'success' : 'error', t(ok ? 'industrial.figure_sent' : 'industrial.figure_send_failed'));
  };
}
