// ==========================================================================
// Ergalics Studio — industrial workbench pages
//
// One module for the industrial suite. Every page shares the same neutral
// EngineeringStudy held by `useEngineeringStore`, so importing a mesh in the
// viewer immediately feeds the material editor, the case editor and the
// solver. These are UI shells over the pure engineering core.
// ==========================================================================

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useLocation } from 'react-router-dom';
import { useT } from '@/i18n';
import { ToolShell } from '@/components/ToolShell';
import { EmptyState } from '@/components/EmptyState';
import { EngineeringImportButton } from './ImportButton';
import { CadViewport, type CadViewPreset } from './CadViewport';
import { sampleTetField } from '@/core/engineering/volume';
import { artifactBaseName, safeName, useIndustrialArtifacts, useIndustrialOutput } from './artifacts';
import { useProjectStore } from '@/stores/projectStore';
import { useEngineeringStore, primaryMaterial } from '@/stores/engineeringStore';
import { toolTabKey, useAppStore } from '@/stores/appStore';
import { useIndustrialChrome } from '@/stores/industrialChromeStore';
import { useLocale } from '@/i18n';
import { mdToHtml } from '@/core/notebook/notebook';
import { renderSVG } from '@/core/plot';
import {
  elementsToCSV,
  fieldHistogramSpec,
  fieldToCSV,
  geometryToCSV,
  meshToSVG,
  nodesToCSV,
  resultToCSV,
  scanMetricKeys,
  scanMetricSpec,
  scanToCSV,
  studyDocument,
} from '@/core/engineering/export';
import type { PlotSpec } from '@/core/plot/types';
import { sendSpecToFigure } from '@/pages/research/researchUi';
import {
  algorithmLabel,
  benchmarkLabel,
  boundaryKindLabel,
  fieldLabel,
  locationLabel,
  localizedMeshSummary,
  metricLabel,
  stepKindLabel,
} from './labels';
import { industrialExampleById } from '@/core/engineering/examples';
import { MATERIAL_LIBRARY, MATERIAL_PROPERTY_META, materialSummary, formatEngineering } from '@/core/engineering/materials';
import { defaultCase, ensureCase } from '@/core/engineering/cases';
import { engineeringFingerprint } from '@/core/engineering/study';
import { runUniaxialBenchmark } from '@/core/engineering/solve';
import type {
  BoundaryKind,
  EngineeringField,
  EngineeringMesh,
  EngineeringStepKind,
} from '@/core/engineering/types';

// --------------------------------------------------------------------------
// Shared helpers
// --------------------------------------------------------------------------

function useStudyLoaded(): void {
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

function Page({ toolId, children }: { toolId: string; children: ReactNode }) {
  useStudyLoaded();
  return <ToolShell toolId={toolId}>{children}</ToolShell>;
}

/**
 * Operation bars for industrial pages. Embedded in the workbench they portal
 * into the right sidebar (RightPanel registers the host), so the canvas only
 * shows the viewport, charts and tables. Standalone /studio pages have no
 * sidebar and keep the bars inline; a collapsed sidebar simply hides them.
 */
function IndustrialActions({ toolId, children }: { toolId: string; children: ReactNode }) {
  const { pathname } = useLocation();
  const activeTab = useAppStore((s) => s.activeTab);
  const host = useIndustrialChrome((s) => s.host);
  if (pathname.startsWith('/studio')) return <>{children}</>;
  // Hidden canvas tabs stay mounted, so without this guard every open
  // industrial page would portal its bars into the same sidebar host and the
  // panel would mix several tools' actions together.
  if (activeTab !== toolTabKey(toolId)) return null;
  return host ? createPortal(children, host) : null;
}

/** Lightweight SVG mesh viewer with field colouring. */
function MeshCanvas({
  mesh,
  field,
  height = 420,
}: {
  mesh: EngineeringMesh;
  field?: EngineeringField | null;
  height?: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    /** Flat [x0, y0, x1, y1, …] projected node buffer, reused across redraws
     *  (resize ticks). Mapping nodes to an array of tuples allocated one small
     *  array per node, i.e. ~1M allocations per redraw on large meshes. */
    let positions = new Float64Array(mesh.nodes.length * 2);

    const draw = (): void => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const width = canvas.clientWidth || 800;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      const [minX, minY, , maxX, maxY] = mesh.bounds;
      const spanX = maxX - minX || 1;
      const spanY = maxY - minY || 1;
      const pad = 18;
      const scale = Math.min((width - pad * 2) / spanX, (height - pad * 2) / spanY);
      const offX = (width - spanX * scale) / 2;
      const offY = (height - spanY * scale) / 2;
      const px = (x: number) => offX + (x - minX) * scale;
      const py = (y: number) => height - offY - (y - minY) * scale;
      if (positions.length !== mesh.nodes.length * 2) {
        positions = new Float64Array(mesh.nodes.length * 2);
      }
      for (let i = 0; i < mesh.nodes.length; i += 1) {
        const node = mesh.nodes[i]!;
        positions[i * 2] = px(node.x);
        positions[i * 2 + 1] = py(node.y);
      }

      let min = Infinity;
      let max = -Infinity;
      if (field) {
        for (const value of field.values) {
          if (Number.isFinite(value)) {
            if (value < min) min = value;
            if (value > max) max = value;
          }
        }
      }
      const span = field ? max - min || 1 : 1;

      const fillFor = (elementIndex: number): string => {
        if (!field) return 'rgba(96,165,250,0.10)';
        const value =
          field.location === 'element'
            ? field.values[elementIndex * field.components] ?? min
            : averageElement(field, mesh, elementIndex);
        const t = Math.max(0, Math.min(1, (value - min) / span));
        // Blue → cyan → yellow → red.
        const hue = 220 - 220 * t;
        return `hsla(${hue}, 82%, 55%, 0.55)`;
      };

      const maxElements = 12000;
      const stride = Math.max(1, Math.ceil(mesh.elements.length / maxElements));
      ctx.lineWidth = mesh.elements.length > 4000 ? 0.35 : 0.8;
      for (let index = 0; index < mesh.elements.length; index += stride) {
        const element = mesh.elements[index]!;
        if (element.nodes.length < 2) continue;
        ctx.beginPath();
        element.nodes.forEach((nodeIndex, i) => {
          const ox = positions[nodeIndex * 2];
          const oy = positions[nodeIndex * 2 + 1];
          if (ox === undefined || oy === undefined) return;
          if (i === 0) ctx.moveTo(ox, oy);
          else ctx.lineTo(ox, oy);
        });
        if (element.nodes.length >= 3) {
          ctx.closePath();
          ctx.fillStyle = fillFor(index);
          ctx.fill();
        }
        ctx.strokeStyle = element.nodes.length >= 3 ? 'rgba(30,41,59,0.35)' : 'rgba(59,130,246,0.7)';
        ctx.stroke();
      }
      if (mesh.elements.length === 0) {
        ctx.fillStyle = 'rgba(59,130,246,0.9)';
        for (let i = 0; i < mesh.nodes.length; i += 1) {
          ctx.beginPath();
          ctx.arc(positions[i * 2]!, positions[i * 2 + 1]!, 1.4, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    };

    draw();
    // Re-draw when the pane (not the viewport) changes size, e.g. the right
    // panel opens or the workbench is resized.
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => draw());
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [mesh, field, height]);
  return <canvas ref={ref} className="ind-mesh-canvas" style={{ height }} />;
}

function averageElement(field: EngineeringField, mesh: EngineeringMesh, elementIndex: number): number {
  const element = mesh.elements[elementIndex];
  if (!element) return 0;
  let total = 0;
  let count = 0;
  for (const node of element.nodes) {
    const value = field.values[node * field.components];
    if (Number.isFinite(value)) {
      total += value!;
      count += 1;
    }
  }
  return count > 0 ? total / count : 0;
}

function FieldPicker({
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

function NoStudy({ children }: { children?: ReactNode }) {
  const t = useT();
  return (
    <div className="ind-empty">
      <EmptyState title={t('industrial.no_study')} description={t('industrial.no_study_desc')} />
      {children}
    </div>
  );
}

/** Inline SVG chart using the shared publication-grade plot renderer. */
function SvgPlot({ spec }: { spec: PlotSpec }) {
  const markup = useMemo(() => renderSVG(spec), [spec]);
  return (
    <div
      className="analysis-svg ind-chart"
      // The renderer emits trusted, locally generated SVG markup.
      dangerouslySetInnerHTML={{ __html: markup }}
    />
  );
}

function StudyMeta() {
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

// --------------------------------------------------------------------------
// Geometry (P3)
// --------------------------------------------------------------------------

export function GeometryPage() {
  useStudyLoaded();
  const t = useT();
  const study = useEngineeringStore((s) => s.study);
  const geometry = study?.geometry;
  const artifacts = useIndustrialArtifacts();
  const { outputText } = useIndustrialOutput();
  const [selected, setSelected] = useState<string>('all');
  const [view3d, setView3d] = useState(true);
  const [preset, setPreset] = useState<CadViewPreset>('fit');
  const [wireframe, setWireframe] = useState(true);
  const [snapshotTick, setSnapshotTick] = useState(0);
  const entities = geometry?.entities.filter((entity) => selected === 'all' || entity.layer === selected) ?? [];
  // Stable identity per selection: a fresh array on every render would trip
  // the CadViewport content-rebuild effect and reset the camera.
  const layers = useMemo(() => (selected === 'all' ? undefined : [selected]), [selected]);
  const base = artifactBaseName(study);
  const takeSnapshot = (url: string) => {
    const link = document.createElement('a');
    link.href = url;
    link.download = `${base}-cad.png`;
    link.click();
  };
  const exportGeometryCsv = () => {
    if (!geometry) return;
    void outputText('results', `${base}-geometry.csv`, geometryToCSV(geometry));
  };
  const saveGeometry = async () => {
    if (!geometry) return;
    await artifacts.saveText('results', `${base}-geometry.csv`, geometryToCSV(geometry));
  };
  return (
    <Page toolId="geometry-import">
      <div className="ind-page analysis-body">
        <header className="ind-page-head">
          <h2>{t('industrial.geometry')}</h2>
          <StudyMeta />
        </header>
        <IndustrialActions toolId="geometry-import">
          <EngineeringImportButton hint="DXF / STEP" />
          {geometry && (
            <>
              <div className="ind-toolbar analysis-row">
                <label className="ind-field">
                  <span>{t('industrial.layer')}</span>
                  <select className="input input-sm" value={selected} onChange={(e) => setSelected(e.target.value)}>
                    <option value="all">{t('industrial.all_layers')}</option>
                    {geometry.layers.map((layer) => (
                      <option key={layer} value={layer}>{layer}</option>
                    ))}
                  </select>
                </label>
                <span className="ind-hint">
                  {t('industrial.entities', { n: geometry.entities.length })} ·{' '}
                  {t('industrial.layers', { n: geometry.layers.length })} · {geometry.sourceFormat.toUpperCase()}
                </span>
                <span className="ind-toolbar-spacer" />
                <button type="button" className="btn btn-sm" onClick={() => setView3d((v) => !v)}>
                  {view3d ? t('industrial.cad_view') : '2D'}
                </button>
                <button type="button" className="btn btn-sm" onClick={() => setSnapshotTick((n) => n + 1)}>
                  {t('industrial.cad_snapshot')}
                </button>
                <button type="button" className="btn btn-sm" onClick={exportGeometryCsv}>
                  {t('industrial.export_geometry_csv')}
                </button>
                <button type="button" className="btn btn-sm" onClick={() => void saveGeometry()}>
                  {t('industrial.save_workspace')}
                </button>
              </div>
              {view3d && (
                <div className="ind-toolbar analysis-row">
                  {(['fit', 'front', 'top', 'side'] as CadViewPreset[]).map((p) => (
                    <button
                      key={p}
                      type="button"
                      className={`btn btn-sm${preset === p ? ' is-active' : ''}`}
                      onClick={() => setPreset(p)}
                    >
                      {t(`industrial.cad_view_${p}`)}
                    </button>
                  ))}
                  <label className="research-check">
                    <input type="checkbox" checked={wireframe} onChange={(e) => setWireframe(e.target.checked)} />
                    {t('industrial.cad_wireframe')}
                  </label>
                  <span className="ind-hint">{t('industrial.cad_hint')}</span>
                </div>
              )}
            </>
          )}
        </IndustrialActions>
        {!geometry ? (
          <NoStudy />
        ) : (
          <>
            {view3d && (
              <CadViewport
                geometry={geometry}
                layers={layers}
                wireframe={wireframe}
                preset={preset}
                snapshotRequest={snapshotTick}
                onSnapshotReady={takeSnapshot}
                height={400}
              />
            )}
            <div className="ind-geometry-list">
              {entities.slice(0, 200).map((entity) => (
                <div key={entity.id} className="ind-row">
                  <span className="tag">{t(`industrial.geometry_kind.${entity.kind}`)}</span>
                  <span className="mono">{entity.id}</span>
                  <span>{t('industrial.points', { n: entity.points.length })}</span>
                  <span className="ind-hint">{entity.layer ?? '—'}</span>
                </div>
              ))}
            </div>
            {study && !view3d && <MeshCanvas mesh={study.mesh} height={360} />}
          </>
        )}
      </div>
    </Page>
  );
}

// --------------------------------------------------------------------------
// Mesh viewer (P1)
// --------------------------------------------------------------------------

export function MeshViewerPage() {
  useStudyLoaded();
  const t = useT();
  const study = useEngineeringStore((s) => s.study);
  const result = useEngineeringStore((s) => s.result);
  const [fieldName, setFieldName] = useState('');
  const [view3d, setView3d] = useState(true);
  const [preset, setPreset] = useState<CadViewPreset>('fit');
  const [wireframe, setWireframe] = useState(false);
  const [snapshotTick, setSnapshotTick] = useState(0);
  const artifacts = useIndustrialArtifacts();
  const { outputText, outputFigure } = useIndustrialOutput();
  const fields = study?.fields ?? [];
  const field = fields.find((item) => item.name === fieldName) ?? fields[0] ?? null;
  const base = artifactBaseName(study);
  const exportMesh = () => {
    if (!study) return;
    void outputText('results', `${base}-nodes.csv`, nodesToCSV(study.mesh));
    void outputText('results', `${base}-elements.csv`, elementsToCSV(study.mesh));
  };
  const exportFigure = () => {
    if (!study) return;
    void outputFigure(`${base}-mesh.svg`, meshToSVG(study, field, { title: study.name }));
  };
  const saveAll = async () => {
    if (!study) return;
    await artifacts.saveText('results', `${base}-nodes.csv`, nodesToCSV(study.mesh));
    await artifacts.saveText('results', `${base}-elements.csv`, elementsToCSV(study.mesh));
    await artifacts.saveText('figures', `${base}-mesh.svg`, meshToSVG(study, field, { title: study.name }));
  };
  const takeSnapshot = (url: string) => {
    const link = document.createElement('a');
    link.href = url;
    link.download = `${base}-mesh.png`;
    link.click();
  };
  return (
    <Page toolId="mesh-viewer">
      <div className="ind-page analysis-body">
        <header className="ind-page-head">
          <h2>{t('industrial.mesh')}</h2>
          <StudyMeta />
        </header>
        <IndustrialActions toolId="mesh-viewer">
          <EngineeringImportButton hint="Gmsh .msh · Abaqus .inp · VTK .vtk/.vtu" />
          {study && (
            <>
              <div className="ind-toolbar analysis-row">
                <FieldPicker fields={fields} value={field?.name ?? ''} onChange={setFieldName} />
                <span className="ind-hint">
                  {t('industrial.nodes', { n: study.mesh.nodes.length })} ·{' '}
                  {t('industrial.elements', { n: study.mesh.elements.length })} ·{' '}
                  {t('industrial.groups', { n: study.mesh.groups.length })}
                </span>
                <span className="ind-toolbar-spacer" />
                <button type="button" className="btn btn-sm" onClick={() => setView3d((v) => !v)}>
                  {view3d ? t('industrial.cad_view') : '2D'}
                </button>
                <button type="button" className="btn btn-sm" onClick={() => setSnapshotTick((n) => n + 1)}>
                  {t('industrial.cad_snapshot')}
                </button>
                <button type="button" className="btn btn-sm" onClick={exportMesh}>
                  {t('industrial.export_mesh_csv')}
                </button>
                <button type="button" className="btn btn-sm" onClick={exportFigure}>
                  {t('industrial.export_mesh_svg')}
                </button>
                <button type="button" className="btn btn-sm" onClick={() => void saveAll()}>
                  {t('industrial.save_workspace')}
                </button>
              </div>
              {view3d && (
                <div className="ind-toolbar analysis-row">
                  {(['fit', 'front', 'top', 'side'] as CadViewPreset[]).map((p) => (
                    <button key={p} type="button" className={`btn btn-sm${preset === p ? ' is-active' : ''}`} onClick={() => setPreset(p)}>
                      {t(`industrial.cad_view_${p}`)}
                    </button>
                  ))}
                  <label className="research-check">
                    <input type="checkbox" checked={wireframe} onChange={(e) => setWireframe(e.target.checked)} />
                    {t('industrial.cad_wireframe')}
                  </label>
                  <span className="ind-hint">{t('industrial.cad_hint')}</span>
                </div>
              )}
            </>
          )}
        </IndustrialActions>
        {!study ? (
          <NoStudy />
        ) : (
          <>
            {view3d ? (
              <CadViewport
                mesh={study.mesh}
                field={field}
                wireframe={wireframe}
                preset={preset}
                snapshotRequest={snapshotTick}
                onSnapshotReady={takeSnapshot}
              />
            ) : (
              <MeshCanvas mesh={study.mesh} field={field} />
            )}
            {result && (
              <div className="ind-hint">
                {t('industrial.last_solve')}: {result.stepName} ·{' '}
                {t('industrial.iterations', { n: result.iterations })} ·{' '}
                {t('industrial.residual', { value: formatEngineering(result.residual) })}
              </div>
            )}
            <div className="ind-table-wrap">
              <table className="sweep-table">
                <thead><tr><th>{t('industrial.dim')}</th><th>{t('industrial.tag')}</th><th>{t('industrial.name')}</th><th>{t('industrial.members')}</th></tr></thead>
                <tbody>
                  {study.mesh.groups.slice(0, 40).map((group) => (
                    <tr key={`${group.dimension}:${group.tag}`}>
                      <td>{group.dimension}</td><td>{group.tag}</td><td>{group.name}</td><td>{group.members.length}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </Page>
  );
}

// --------------------------------------------------------------------------
// Materials (P1)
// --------------------------------------------------------------------------

export function MaterialsPage() {
  useStudyLoaded();
  const t = useT();
  const { locale } = useLocale();
  const study = useEngineeringStore((s) => s.study);
  const addMaterial = useEngineeringStore((s) => s.addMaterial);
  const updateProperty = useEngineeringStore((s) => s.updateMaterialProperty);
  const removeMaterial = useEngineeringStore((s) => s.removeMaterial);
  const assignTag = useEngineeringStore((s) => s.assignMaterialTag);
  const [template, setTemplate] = useState(MATERIAL_LIBRARY[0]?.id ?? '');
  const tags = useMemo(() => {
    if (!study) return [];
    return [...new Set(
      study.mesh.elements
        .map((element) => element.group)
        .filter((tag): tag is number => typeof tag === 'number' && tag !== 0),
    )];
  }, [study]);
  return (
    <Page toolId="material-library">
      <div className="ind-page analysis-body">
        <header className="ind-page-head">
          <h2>{t('industrial.materials')}</h2>
          <StudyMeta />
        </header>
        <IndustrialActions toolId="material-library">
          <div className="ind-toolbar analysis-row">
            <select className="input input-sm" value={template} onChange={(e) => setTemplate(e.target.value)}>
              {MATERIAL_LIBRARY.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.nameI18n[(locale.startsWith('zh') ? 'zh' : 'en') as 'zh' | 'en'] ?? item.name}
                </option>
              ))}
            </select>
            <button type="button" className="btn btn-sm btn-primary" onClick={() => addMaterial(template)}>
              {t('industrial.material_add')}
            </button>
          </div>
        </IndustrialActions>
        {!study ? (
          <NoStudy />
        ) : (
          <>
            {study.materials.length === 0 && <EmptyState title={t('industrial.no_material')} />}
            <div className="ind-cards">
              {study.materials.map((material) => (
                <section key={material.name} className="ind-card">
                  <header className="ind-card-head">
                    <strong>{material.name}</strong>
                    <button type="button" className="btn btn-sm" aria-label={t('common.delete')} onClick={() => removeMaterial(material.name)}>×</button>
                  </header>
                  <div className="ind-hint">{materialSummary(material)}</div>
                  <div className="ind-prop-grid">
                    {Object.entries(MATERIAL_PROPERTY_META).map(([key, meta]) => (
                      <label key={key} className="ind-field">
                        <span>{meta.symbol} <small>{meta.unit}</small></span>
                        <input
                          className="input input-sm"
                          type="number"
                          step="any"
                          value={Number(material.properties[key] ?? 0)}
                          onChange={(e) => updateProperty(material.name, key, Number(e.target.value))}
                        />
                      </label>
                    ))}
                  </div>
                </section>
              ))}
            </div>
            {tags.length > 0 && (
              <section className="ind-card">
                <header className="ind-card-head"><strong>{t('industrial.element_assignment')}</strong></header>
                <div className="ind-prop-grid">
                  {tags.map((tag) => (
                    <label key={tag} className="ind-field">
                      <span>{t('industrial.tag_n', { n: tag })}</span>
                      <select
                        className="input input-sm"
                        value={study.materialAssignment?.[String(tag)] ?? study.materials[0]?.name ?? ''}
                        onChange={(e) => assignTag(tag, e.target.value)}
                      >
                        {study.materials.map((material) => (
                          <option key={material.name} value={material.name}>{material.name}</option>
                        ))}
                      </select>
                    </label>
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </Page>
  );
}

// --------------------------------------------------------------------------
// Load cases + design space (P4)
// --------------------------------------------------------------------------

const STEP_KINDS: EngineeringStepKind[] = [
  'static-structural', 'steady-heat', 'transient-heat', 'potential-flow',
];

export function CasesPage() {
  useStudyLoaded();
  const t = useT();
  const study = useEngineeringStore((s) => s.study);
  const activeStepId = useEngineeringStore((s) => s.activeStepId);
  const addStep = useEngineeringStore((s) => s.addStep);
  const removeStep = useEngineeringStore((s) => s.removeStep);
  const updateStep = useEngineeringStore((s) => s.updateStep);
  const selectStep = useEngineeringStore((s) => s.selectStep);
  const updateDesign = useEngineeringStore((s) => s.updateCaseDesign);
  const [kind, setKind] = useState<EngineeringStepKind>('static-structural');
  const studyCase = study ? ensureCase(study.cases)[0]! : null;

  return (
    <Page toolId="load-cases">
      <div className="ind-page analysis-body">
        <header className="ind-page-head"><h2>{t('industrial.cases')}</h2><StudyMeta /></header>
        <IndustrialActions toolId="load-cases">
          <div className="ind-toolbar analysis-row">
            <select className="input input-sm" value={kind} onChange={(e) => setKind(e.target.value as EngineeringStepKind)}>
              {STEP_KINDS.map((item) => <option key={item} value={item}>{stepKindLabel(t, item)}</option>)}
            </select>
            <button type="button" className="btn btn-sm btn-primary" onClick={() => addStep(kind)}>{t('industrial.step_add')}</button>
          </div>
        </IndustrialActions>
        {!study || !studyCase ? (
          <NoStudy />
        ) : (
          <>
            <div className="ind-cards">
              {studyCase.steps.map((step) => (
                <section key={step.id} className={`ind-card${activeStepId === step.id ? ' is-active' : ''}`}>
                  <header className="ind-card-head">
                    <button type="button" className="ind-link" onClick={() => selectStep(step.id)}>{step.name}</button>
                    <span className="tag">{stepKindLabel(t, step.kind)}</span>
                    <button type="button" className="btn btn-sm" aria-label={t('common.delete')} onClick={() => removeStep(step.id)}>×</button>
                  </header>
                  <div className="ind-prop-grid">
                    <label className="ind-field">
                      <span>{t('industrial.tolerance')}</span>
                      <input className="input input-sm" type="number" step="any" value={step.solver.tolerance}
                        onChange={(e) => updateStep(step.id, { solver: { ...step.solver, tolerance: Number(e.target.value) } })} />
                    </label>
                    <label className="ind-field">
                      <span>{t('industrial.max_iterations')}</span>
                      <input className="input input-sm" type="number" value={step.solver.maxIterations}
                        onChange={(e) => updateStep(step.id, { solver: { ...step.solver, maxIterations: Number(e.target.value) } })} />
                    </label>
                    <label className="ind-field">
                      <span>{t('industrial.plane_state')}</span>
                      <select className="input input-sm" value={step.solver.planeState ?? 'plane-stress'}
                        onChange={(e) => updateStep(step.id, { solver: { ...step.solver, planeState: e.target.value as 'plane-stress' | 'plane-strain' } })}>
                        <option value="plane-stress">{t('industrial.plane_stress')}</option>
                        <option value="plane-strain">{t('industrial.plane_strain')}</option>
                      </select>
                    </label>
                    {step.kind === 'transient-heat' && (
                      <>
                        <label className="ind-field"><span>{t('industrial.dt')}</span>
                          <input className="input input-sm" type="number" step="any" value={step.solver.dt ?? 0.01}
                            onChange={(e) => updateStep(step.id, { solver: { ...step.solver, dt: Number(e.target.value) } })} />
                        </label>
                        <label className="ind-field"><span>{t('industrial.steps')}</span>
                          <input className="input input-sm" type="number" value={step.solver.timeSteps ?? 20}
                            onChange={(e) => updateStep(step.id, { solver: { ...step.solver, timeSteps: Number(e.target.value) } })} />
                        </label>
                      </>
                    )}
                  </div>
                </section>
              ))}
            </div>
            <BoundaryEditor />
            <DesignSpaceEditor
              design={studyCase.design}
              onChange={updateDesign}
            />
          </>
        )}
      </div>
    </Page>
  );
}

function BoundaryEditor() {
  const t = useT();
  const study = useEngineeringStore((s) => s.study);
  const add = useEngineeringStore((s) => s.addBoundaryCondition);
  const update = useEngineeringStore((s) => s.updateBoundaryCondition);
  const remove = useEngineeringStore((s) => s.removeBoundaryCondition);
  const [kind, setKind] = useState<BoundaryKind>('displacement');
  const [dimension, setDimension] = useState(0);
  const [tag, setTag] = useState(0);
  const [c0, setC0] = useState(0);
  const [c1, setC1] = useState(0);
  if (!study) return null;
  const groups = study.mesh.groups;
  const kinds: BoundaryKind[] = ['displacement', 'force', 'traction', 'temperature', 'heat-flux', 'pressure', 'other'];
  return (
    <section className="ind-card">
      <header className="ind-card-head"><strong>{t('industrial.boundary')}</strong></header>
      <div className="ind-toolbar analysis-row">
        <select className="input input-sm" value={kind} onChange={(e) => setKind(e.target.value as BoundaryKind)}>
          {kinds.map((item) => <option key={item} value={item}>{boundaryKindLabel(t, item)}</option>)}
        </select>
        <select className="input input-sm" value={dimension} onChange={(e) => setDimension(Number(e.target.value))}>
          {[0, 1, 2, 3].map((d) => <option key={d} value={d}>{t('industrial.dim_n', { n: d })}</option>)}
        </select>
        <select className="input input-sm" value={tag} onChange={(e) => setTag(Number(e.target.value))}>
          <option value={0}>{t('industrial.tag_value', { n: 0 })}</option>
          {groups.filter((g) => g.dimension === dimension).map((g) => (
            <option key={g.tag} value={g.tag}>{g.name} ({g.tag})</option>
          ))}
        </select>
        <input className="input input-sm" type="number" step="any" value={c0} onChange={(e) => setC0(Number(e.target.value))} title={t('industrial.component_n', { n: 0 })} />
        <input className="input input-sm" type="number" step="any" value={c1} onChange={(e) => setC1(Number(e.target.value))} title={t('industrial.component_n', { n: 1 })} />
        <button type="button" className="btn btn-sm btn-primary" onClick={() => add({
          name: `${kind} ${study.boundaryConditions.length + 1}`,
          kind,
          target: { dimension, tag },
          components: { 0: c0, 1: c1 },
        })}>{t('industrial.add')}</button>
      </div>
      <div className="ind-table-wrap">
        <table className="sweep-table">
          <thead><tr><th>{t('industrial.name')}</th><th>{t('industrial.kind')}</th><th>{t('industrial.target')}</th><th>{t('industrial.components')}</th><th /></tr></thead>
          <tbody>
            {study.boundaryConditions.map((bc, index) => (
              <tr key={index}>
                <td><input className="input input-sm" value={bc.name} onChange={(e) => update(index, { name: e.target.value })} /></td>
                <td>{boundaryKindLabel(t, bc.kind)}</td>
                <td>{bc.target.dimension}:{bc.target.tag}</td>
                <td>
                  <input className="input input-sm" type="number" step="any" value={bc.components[0] ?? 0}
                    onChange={(e) => update(index, { components: { ...bc.components, 0: Number(e.target.value) } })} />
                  <input className="input input-sm" type="number" step="any" value={bc.components[1] ?? 0}
                    onChange={(e) => update(index, { components: { ...bc.components, 1: Number(e.target.value) } })} />
                </td>
                <td><button type="button" className="btn btn-sm" aria-label={t('common.delete')} onClick={() => remove(index)}>×</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function DesignSpaceEditor({
  design,
  onChange,
}: {
  design: ReturnType<typeof defaultCase>['design'];
  onChange: (design: ReturnType<typeof defaultCase>['design']) => void;
}) {
  const [name, setName] = useState('material.Steel.E');
  const [min, setMin] = useState(1.5e11);
  const [max, setMax] = useState(2.5e11);
  const [levels, setLevels] = useState(3);
  const t = useT();
  return (
    <section className="ind-card">
      <header className="ind-card-head"><strong>{t('industrial.design_space')}</strong></header>
      <div className="ind-toolbar analysis-row">
        <input className="input input-sm" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('industrial.parameter_path')} />
        <input className="input input-sm" type="number" step="any" value={min} onChange={(e) => setMin(Number(e.target.value))} />
        <input className="input input-sm" type="number" step="any" value={max} onChange={(e) => setMax(Number(e.target.value))} />
        <input className="input input-sm" type="number" value={levels} onChange={(e) => setLevels(Number(e.target.value))} />
        <button type="button" className="btn btn-sm btn-primary" onClick={() => onChange({
          ...design,
          parameters: [...design.parameters, { name, min, max, levels }],
        })}>{t('industrial.add_parameter')}</button>
      </div>
      {design.parameters.length === 0 ? (
        <div className="ind-hint">{t('industrial.no_parameters')}</div>
      ) : (
        <div className="ind-table-wrap">
          <table className="sweep-table">
            <thead><tr><th>{t('industrial.parameter')}</th><th>{t('industrial.min')}</th><th>{t('industrial.max')}</th><th>{t('industrial.levels')}</th><th /></tr></thead>
            <tbody>
              {design.parameters.map((parameter, index) => (
                <tr key={`${parameter.name}-${index}`}>
                  <td>{parameter.name}</td><td>{parameter.min}</td><td>{parameter.max}</td><td>{parameter.levels}</td>
                  <td><button type="button" className="btn btn-sm" aria-label={t('common.delete')} onClick={() => onChange({
                    ...design,
                    parameters: design.parameters.filter((_, i) => i !== index),
                  })}>×</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// --------------------------------------------------------------------------
// Solver (P2)
// --------------------------------------------------------------------------

export function SolvePage() {
  useStudyLoaded();
  const t = useT();
  const study = useEngineeringStore((s) => s.study);
  const result = useEngineeringStore((s) => s.result);
  const solving = useEngineeringStore((s) => s.solving);
  const benchmark = useEngineeringStore((s) => s.benchmark);
  const buildStats = useEngineeringStore((s) => s.buildStats);
  const buildCached = useEngineeringStore((s) => s.buildCached);
  const clearBuildCache = useEngineeringStore((s) => s.clearBuildCache);
  const solve = useEngineeringStore((s) => s.solve);
  const runBenchmark = useEngineeringStore((s) => s.runBenchmark);
  const activeStepId = useEngineeringStore((s) => s.activeStepId);
  const selectStep = useEngineeringStore((s) => s.selectStep);
  const artifacts = useIndustrialArtifacts();
  const { outputText } = useIndustrialOutput();
  const steps = study ? ensureCase(study.cases)[0]!.steps : [];
  const base = artifactBaseName(study);
  const exportMetrics = () => {
    if (result) void outputText('results', `${base}-metrics.csv`, resultToCSV(result));
  };
  const exportStudy = () => {
    if (study) void outputText('study', `${base}-study.json`, studyDocument(study));
  };
  const saveOutputs = async () => {
    if (!study) return;
    await artifacts.saveText('study', 'engineering.json', studyDocument(study));
    if (result) await artifacts.saveText('results', `${base}-metrics.csv`, resultToCSV(result));
    if (study.fields[0]) await artifacts.saveText('figures', `${base}-field.svg`, meshToSVG(study, study.fields[0], { title: study.name }));
  };
  return (
    <Page toolId="fea-solver">
      <div className="ind-page analysis-body">
        <header className="ind-page-head"><h2>{t('industrial.solver')}</h2><StudyMeta /></header>
        <IndustrialActions toolId="fea-solver">
          <div className="ind-toolbar analysis-row">
            <select className="input input-sm" value={activeStepId ?? ''} onChange={(e) => selectStep(e.target.value)}>
              {steps.map((step) => <option key={step.id} value={step.id}>{step.name} ({stepKindLabel(t, step.kind)})</option>)}
            </select>
            <button type="button" className="btn btn-sm btn-primary" disabled={solving} onClick={() => void solve()}>
              {solving ? <span className="spinner" /> : t('industrial.solve')}
            </button>
            <button type="button" className="btn btn-sm" onClick={() => runBenchmark()}>
              {t('industrial.benchmark')}
            </button>
            <button type="button" className="btn btn-sm" onClick={clearBuildCache}>
              {t('industrial.clear_build_cache')}
            </button>
            {buildStats && (
              <span className={`tag${buildCached ? ' is-hit' : ''}`}>
                {buildCached
                  ? t('industrial.build_hit', { n: buildStats.cached })
                  : t('industrial.build_computed', { n: buildStats.computed })}
              </span>
            )}
            <span className="ind-toolbar-spacer" />
            <button type="button" className="btn btn-sm" onClick={exportMetrics} disabled={!result}>
              {t('industrial.export_metrics_csv')}
            </button>
            <button type="button" className="btn btn-sm" onClick={exportStudy}>
              {t('industrial.export_study_json')}
            </button>
            <button type="button" className="btn btn-sm" onClick={() => void saveOutputs()}>
              {t('industrial.save_workspace')}
            </button>
          </div>
        </IndustrialActions>
        {!study ? (
          <NoStudy />
        ) : (
          <>
            {benchmark && (
              <div className="ind-card">
                <header className="ind-card-head"><strong>{benchmarkLabel(t, benchmark.name)}</strong></header>
                <div className="ind-metrics">
                  <div><span>{t('industrial.relative_error')}</span><strong>{benchmark.relativeError.toExponential(3)}</strong></div>
                  <div><span>{t('industrial.order')}</span><strong>{benchmark.order === null ? '—' : benchmark.order.toFixed(2)}</strong></div>
                  <div><span>{t('industrial.max_displacement')}</span><strong>{benchmark.maxDisplacement.toExponential(3)}</strong></div>
                </div>
              </div>
            )}
            {result && (
              <div className="ind-card">
                <header className="ind-card-head"><strong>{result.stepName}</strong><span className="tag">{stepKindLabel(t, result.kind)}</span></header>
                <div className="ind-metrics">
                  {Object.entries(result.metrics).map(([key, value]) => (
                    <div key={key}><span>{metricLabel(t, key)}</span><strong>{formatEngineering(value)}</strong></div>
                  ))}
                </div>
                <div className="ind-hint">
                  {t('industrial.iterations', { n: result.iterations })} ·{' '}
                  {t('industrial.residual', { value: result.residual.toExponential(3) })} · {result.solver.name} {result.solver.version}
                </div>
              </div>
            )}
            {study.fields.length > 0 && <MeshCanvas mesh={study.mesh} field={study.fields[0]} height={340} />}
          </>
        )}
      </div>
    </Page>
  );
}

// --------------------------------------------------------------------------
// Post-processing (P1)
// --------------------------------------------------------------------------

export function PostPage() {
  useStudyLoaded();
  const t = useT();
  const study = useEngineeringStore((s) => s.study);
  const result = useEngineeringStore((s) => s.result);
  const [fieldName, setFieldName] = useState('');
  const artifacts = useIndustrialArtifacts();
  const { outputText, outputFigure, outputPng, outputPdf } = useIndustrialOutput();
  const fields = result?.fields ?? study?.fields ?? [];
  const field = fields.find((item) => item.name === fieldName) ?? fields[0] ?? null;
  const base = artifactBaseName(study);
  const histogram = useMemo(
    () => (field ? fieldHistogramSpec(field, { title: fieldLabel(t, field.name) }) : null),
    [field, t],
  );
  const stem = `${base}-${safeName(field?.name ?? 'field')}`;
  const is3d = study?.mesh.elements.some((e) => e.type === 'tet4') ?? false;
  const [isoLevel, setIsoLevel] = useState(0.5);
  const isoVolume = useMemo(() => {
    if (!study || !is3d || !field) return null;
    const voxel = sampleTetField(study.mesh, field, { resolution: 48 });
    // marchingTets expects the level in the SAME units as the field values.
    const finite = Array.from(voxel.values).filter((v) => Number.isFinite(v));
    if (finite.length === 0) return voxel;
    const lo = Math.min(...finite);
    const hi = Math.max(...finite);
    return { ...voxel, values: Float32Array.from(voxel.values, (v) =>
      Number.isFinite(v) ? (v - lo) / (hi - lo || 1) : v) };
  }, [study, is3d, field]);
  const figureSvg = () =>
    study ? meshToSVG(study, field, { title: `${study.name} · ${field?.name ?? ''}` }) : '';
  const exportFieldCsv = () => {
    if (!study || !field) return;
    void outputText('results', `${stem}.csv`, fieldToCSV(study, field));
  };
  const exportMeshCsv = () => {
    if (!study) return;
    void outputText('results', `${base}-nodes.csv`, nodesToCSV(study.mesh));
    void outputText('results', `${base}-elements.csv`, elementsToCSV(study.mesh));
  };
  const exportMetrics = () => {
    if (!result) return;
    void outputText('results', `${base}-metrics.csv`, resultToCSV(result));
  };
  const exportFigure = () => {
    if (!study) return;
    void outputFigure(`${stem}.svg`, figureSvg());
  };
  const exportFigurePng = () => {
    if (!study) return;
    void outputPng(`${stem}.png`, figureSvg());
  };
  const exportFigurePdf = () => {
    if (!study) return;
    void outputPdf(`${stem}.pdf`, figureSvg());
  };
  const saveAll = async () => {
    if (!study) return;
    await artifacts.saveText('figures', `${stem}.svg`, meshToSVG(study, field, { title: `${study.name} · ${field?.name ?? ''}` }));
    if (field) await artifacts.saveText('results', `${stem}.csv`, fieldToCSV(study, field));
    if (result) await artifacts.saveText('results', `${base}-metrics.csv`, resultToCSV(result));
  };
  return (
    <Page toolId="post-processing">
      <div className="ind-page analysis-body">
        <header className="ind-page-head"><h2>{t('industrial.post')}</h2><StudyMeta /></header>
        <IndustrialActions toolId="post-processing">
          <div className="ind-toolbar analysis-row">
            <FieldPicker fields={fields} value={field?.name ?? ''} onChange={setFieldName} />
            {field && <span className="ind-hint">{locationLabel(t, field.location)} · {t('industrial.component_count', { n: field.components })} {field.unit ? `· ${field.unit}` : ''}</span>}
            <span className="ind-toolbar-spacer" />
            <button type="button" className="btn btn-sm" onClick={exportFieldCsv} disabled={!field}>{t('industrial.export_field_csv')}</button>
            <button type="button" className="btn btn-sm" onClick={exportMeshCsv}>{t('industrial.export_mesh_csv')}</button>
            <button type="button" className="btn btn-sm" onClick={exportMetrics} disabled={!result}>{t('industrial.export_metrics_csv')}</button>
          </div>
          <div className="ind-toolbar analysis-row">
            <span className="ind-hint">{t('industrial.export_figure')}</span>
            <button type="button" className="btn btn-sm" onClick={exportFigure}>{t('industrial.export_svg')}</button>
            <button type="button" className="btn btn-sm" onClick={exportFigurePng}>{t('industrial.export_png')}</button>
            <button type="button" className="btn btn-sm" onClick={exportFigurePdf}>{t('industrial.export_pdf')}</button>
            <span className="ind-toolbar-spacer" />
            <button type="button" className="btn btn-sm btn-primary" onClick={() => void saveAll()}>{t('industrial.save_workspace')}</button>
          </div>
          {is3d && (
            <div className="ind-toolbar analysis-row">
              <label className="ind-field">
                <span>{t('industrial.iso_level')}</span>
                <input
                  className="input input-sm"
                  type="range" min={0} max={1} step={0.01}
                  value={isoLevel}
                  onChange={(e) => setIsoLevel(Number(e.target.value))}
                />
                <span className="mono">{isoLevel.toFixed(2)}</span>
              </label>
              <span className="ind-hint">{t('industrial.cad_hint')}</span>
            </div>
          )}
          {histogram && (
            <div className="ind-toolbar analysis-row">
              <span className="ind-hint">{t('industrial.field_distribution')}</span>
              <button type="button" className="btn btn-sm" onClick={() => void outputFigure(`${stem}-histogram.svg`, renderSVG(histogram))}>
                {t('industrial.export_svg')}
              </button>
              <button
                type="button"
                className="btn btn-sm"
                title={t('industrial.send_figure_hint')}
                onClick={() => sendSpecToFigure(
                  `${study?.name ?? 'Study'} · ${t('industrial.field_distribution')}`,
                  histogram,
                  field ? fieldLabel(t, field.name) : undefined,
                )}
              >
                {t('industrial.send_figure')}
              </button>
            </div>
          )}
        </IndustrialActions>
        {!study ? (
          <NoStudy />
        ) : (
          <>
            {is3d ? (
              <CadViewport
                mesh={study.mesh}
                isoVolume={isoVolume}
                isoLevel={isoLevel}
                wireframe
                height={430}
              />
            ) : (
              <MeshCanvas mesh={study.mesh} field={field} height={430} />
            )}
            {histogram && (
              <div className="ind-card">
                <header className="ind-card-head">
                  <strong>{t('industrial.field_distribution')}</strong>
                </header>
                <SvgPlot spec={histogram} />
              </div>
            )}
            {result && (
              <div className="ind-table-wrap">
                <table className="sweep-table">
                  <thead><tr><th>{t('industrial.metric')}</th><th>{t('industrial.value')}</th></tr></thead>
                  <tbody>
                    {Object.entries(result.metrics).map(([key, value]) => (
                      <tr key={key}><td>{metricLabel(t, key)}</td><td className="mono">{value.toPrecision(6)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </Page>
  );
}

// --------------------------------------------------------------------------
// Design scan (P4)
// --------------------------------------------------------------------------

export function DesignScanPage() {
  useStudyLoaded();
  const t = useT();
  const study = useEngineeringStore((s) => s.study);
  const scan = useEngineeringStore((s) => s.scan);
  const runScan = useEngineeringStore((s) => s.runScan);
  const artifacts = useIndustrialArtifacts();
  const [busy, setBusy] = useState(false);
  const [metric, setMetric] = useState('');
  const design = study ? ensureCase(study.cases)[0]!.design : null;
  const keys = useMemo(() => scanMetricKeys(scan).slice(0, 8), [scan]);
  const activeMetric = keys.includes(metric) ? metric : keys[0] ?? '';
  const spec = useMemo(
    () => (activeMetric ? scanMetricSpec(scan, activeMetric, { title: metricLabel(t, activeMetric) }) : null),
    [activeMetric, scan, t],
  );
  const base = artifactBaseName(study);
  const { outputText, outputFigure } = useIndustrialOutput();
  const exportCsv = () => {
    if (scan.length === 0) return;
    void outputText('results', `${base}-design-scan.csv`, scanToCSV(scan));
  };
  const saveScan = async () => {
    if (scan.length === 0) return;
    await artifacts.saveText('results', `${base}-design-scan.csv`, scanToCSV(scan));
    if (spec) await artifacts.saveText('figures', `${base}-design-scan-${safeName(activeMetric)}.svg`, renderSVG(spec));
  };
  return (
    <Page toolId="design-scan">
      <div className="ind-page analysis-body">
        <header className="ind-page-head"><h2>{t('industrial.design_scan')}</h2><StudyMeta /></header>
        <IndustrialActions toolId="design-scan">
          {design && (
            <div className="ind-toolbar analysis-row">
              <button type="button" className="btn btn-sm btn-primary" disabled={busy || design.parameters.length === 0}
                onClick={async () => { setBusy(true); try { await runScan(); } finally { setBusy(false); } }}>
                {busy ? <span className="spinner" /> : t('industrial.run_scan')}
              </button>
              <span className="ind-hint">{t('industrial.scan_summary', { p: design.parameters.length, n: scan.length })}</span>
              <span className="ind-toolbar-spacer" />
              <button type="button" className="btn btn-sm" onClick={exportCsv} disabled={scan.length === 0}>
                {t('industrial.export_scan_csv')}
              </button>
              <button type="button" className="btn btn-sm" onClick={() => void saveScan()} disabled={scan.length === 0}>
                {t('industrial.save_workspace')}
              </button>
            </div>
          )}
          {scan.length > 0 && keys.length > 0 && (
            <div className="ind-toolbar analysis-row">
              <label className="ind-field">
                <span>{t('industrial.metric')}</span>
                <select className="input input-sm" value={activeMetric} onChange={(e) => setMetric(e.target.value)}>
                  {keys.map((key) => <option key={key} value={key}>{metricLabel(t, key)}</option>)}
                </select>
              </label>
              <button type="button" className="btn btn-sm" onClick={() => spec && void outputFigure(`${base}-design-scan-${safeName(activeMetric)}.svg`, renderSVG(spec))}>
                {t('industrial.export_svg')}
              </button>
              <button
                type="button"
                className="btn btn-sm"
                disabled={!spec}
                title={t('industrial.send_figure_hint')}
                onClick={() => {
                  if (!spec) return;
                  sendSpecToFigure(`${study?.name ?? 'Study'} · ${metricLabel(t, activeMetric)}`, spec, t('industrial.design_scan'));
                }}
              >
                {t('industrial.send_figure')}
              </button>
            </div>
          )}
        </IndustrialActions>
        {!study || !design ? (
          <NoStudy />
        ) : (
          <>
            {design.parameters.length === 0 && <NoStudy />}
            {scan.length > 0 && keys.length > 0 && (
              <div className="ind-card">
                <header className="ind-card-head">
                  <strong>{t('industrial.design_scan')}</strong>
                </header>
                {spec && <SvgPlot spec={spec} />}
              </div>
            )}
            {scan.length > 0 && (
              <div className="ind-table-wrap">
                <table className="sweep-table">
                  <thead>
                    <tr><th>{t('industrial.point')}</th>{keys.map((key) => <th key={key}>{metricLabel(t, key)}</th>)}</tr>
                  </thead>
                  <tbody>
                    {scan.map((row) => (
                      <tr key={row.id}>
                        <td title={JSON.stringify(row.params)}>{row.name}</td>
                        {keys.map((key) => <td key={key} className="mono">{row.metrics[key]?.toPrecision(5) ?? '—'}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </Page>
  );
}

// --------------------------------------------------------------------------
// Quick fluid (P5)
// --------------------------------------------------------------------------

export function FluidPage() {
  useStudyLoaded();
  const t = useT();
  const study = useEngineeringStore((s) => s.study);
  const setStudy = useEngineeringStore((s) => s.setStudy);
  const result = useEngineeringStore((s) => s.result);
  const solve = useEngineeringStore((s) => s.solve);
  const solving = useEngineeringStore((s) => s.solving);
  const [fieldName, setFieldName] = useState('');
  const fields = result?.fields ?? study?.fields ?? [];
  const field = fields.find((item) => item.name === fieldName) ?? fields[0] ?? null;
  const makeChannel = () => {
    const example = industrialExampleById('industrial-channel-flow');
    if (example) setStudy(example.build());
  };
  return (
    <Page toolId="quick-fluid">
      <div className="ind-page analysis-body">
        <header className="ind-page-head"><h2>{t('industrial.fluid')}</h2><StudyMeta /></header>
        <IndustrialActions toolId="quick-fluid">
          <div className="ind-toolbar analysis-row">
            <button type="button" className="btn btn-sm" onClick={makeChannel}>{t('industrial.generate_channel')}</button>
            <button type="button" className="btn btn-sm btn-primary" disabled={solving} onClick={() => void solve()}>{t('industrial.solve_flow')}</button>
            <FieldPicker fields={fields} value={field?.name ?? ''} onChange={setFieldName} />
          </div>
          <EngineeringImportButton />
        </IndustrialActions>
        {!study ? <NoStudy /> : (
          <>
            <MeshCanvas mesh={study.mesh} field={field} height={380} />
            <div className="ind-hint">
              {typeof navigator !== 'undefined' && 'gpu' in navigator ? t('industrial.gpu_available') : t('industrial.gpu_unavailable')} · {t('industrial.fluid_hint')}
            </div>
            {result && (
              <div className="ind-metrics">
                {Object.entries(result.metrics).slice(0, 8).map(([key, value]) => (
                  <div key={key}><span>{metricLabel(t, key)}</span><strong>{formatEngineering(value)}</strong></div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </Page>
  );
}

// --------------------------------------------------------------------------
// Fingerprint (P4 / repro lock v3)
// --------------------------------------------------------------------------

export function FingerprintPage() {
  useStudyLoaded();
  const t = useT();
  const study = useEngineeringStore((s) => s.study);
  const saveStudyJson = useEngineeringStore((s) => s.saveStudyJson);
  const fingerprint = study ? engineeringFingerprint(study) : null;
  const project = useProjectStore((s) => s.project);
  const notify = useAppStore((s) => s.notify);
  const copy = async () => {
    if (!fingerprint) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(fingerprint, null, 2));
      notify('success', t('industrial.copied'));
    } catch {
      notify('error', t('industrial.copy_failed'));
    }
  };
  return (
    <Page toolId="repro-fingerprint">
      <div className="ind-page analysis-body">
        <header className="ind-page-head"><h2>{t('industrial.fingerprint')}</h2><StudyMeta /></header>
        <IndustrialActions toolId="repro-fingerprint">
          <div className="ind-toolbar analysis-row">
            <button type="button" className="btn btn-sm" onClick={() => void copy()}>{t('industrial.copy')}</button>
            <button type="button" className="btn btn-sm btn-primary" onClick={() => void saveStudyJson()}>
              {t('industrial.save_study')}
            </button>
            <span className="ind-hint">{t('industrial.project')} {project?.name ?? '—'} · {t('industrial.lock_v3')}</span>
          </div>
        </IndustrialActions>
        {!study || !fingerprint ? (
          <NoStudy />
        ) : (
          <>
            <div className="ind-card">
              <div className="ind-metrics">
                <div><span>{t('industrial.mesh_hash')}</span><strong className="mono">{fingerprint.meshHash}</strong></div>
                <div><span>{t('industrial.case_hash')}</span><strong className="mono">{fingerprint.caseHash}</strong></div>
                <div><span>{t('industrial.solver_identity')}</span><strong>{fingerprint.solver.name} {fingerprint.solver.version}</strong></div>
                <div><span>{t('industrial.algorithm')}</span><strong>{algorithmLabel(t, fingerprint.solver.algorithm)} · {t('industrial.tolerance')} {formatEngineering(fingerprint.solver.tolerance)}</strong></div>
              </div>
              <pre className="ind-pre">{JSON.stringify(fingerprint, null, 2)}</pre>
            </div>
          </>
        )}
      </div>
    </Page>
  );
}

// --------------------------------------------------------------------------
// Industrial report (P5)
// --------------------------------------------------------------------------

export function IndustrialReportPage() {
  useStudyLoaded();
  const t = useT();
  const study = useEngineeringStore((s) => s.study);
  const buildReport = useEngineeringStore((s) => s.buildReport);
  const artifacts = useIndustrialArtifacts();
  const base = artifactBaseName(study);
  // buildReport reads study/result/benchmark/locale from the store; it is a
  // cheap pure string build, so recompute on every render instead of faking
  // hook dependencies (the action itself is the only real dependency).
  const report = buildReport();
  const { outputText } = useIndustrialOutput();
  const download = () => {
    if (!report) return;
    void outputText('results', `${base}-report.html`, report.html);
  };
  const downloadMarkdown = () => {
    if (!report) return;
    void outputText('results', `${base}-report.md`, report.markdown);
  };
  const saveReport = async () => {
    if (!report) return;
    await artifacts.saveText('results', `${base}-report.html`, report.html);
    await artifacts.saveText('results', `${base}-report.md`, report.markdown);
  };
  return (
    <Page toolId="industrial-report">
      <div className="ind-page analysis-body">
        <header className="ind-page-head"><h2>{t('industrial.report')}</h2><StudyMeta /></header>
        <IndustrialActions toolId="industrial-report">
          <div className="ind-toolbar analysis-row">
            <button type="button" className="btn btn-sm btn-primary" onClick={download}>{t('industrial.download_report')}</button>
            <button type="button" className="btn btn-sm" onClick={downloadMarkdown}>{t('industrial.download_markdown')}</button>
            <button type="button" className="btn btn-sm" onClick={() => void saveReport()}>{t('industrial.save_workspace')}</button>
            {report && (
              <span className="ind-hint">{t('industrial.report_fingerprint', { hash: report.fingerprint.meshHash.slice(0, 12) })}</span>
            )}
          </div>
        </IndustrialActions>
        {!study || !report ? (
          <NoStudy />
        ) : (
          <>
            <div
              className="central-md-preview"
              dangerouslySetInnerHTML={{ __html: mdToHtml(report.markdown) }}
            />
          </>
        )}
      </div>
    </Page>
  );
}

// A couple of helpers are exported for tests / future tool pages.
export { runUniaxialBenchmark };
