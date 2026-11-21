// ==========================================================================
// Ergalics Studio — industrial workbench pages
//
// One module for the industrial suite. Every page shares the same neutral
// EngineeringStudy held by `useEngineeringStore`, so importing a mesh in the
// viewer immediately feeds the material editor, the case editor and the
// solver. These are UI shells over the pure engineering core.
// ==========================================================================

import { useMemo, useRef, useState } from 'react';
import { useT } from '@/i18n';
import { EmptyState } from '@/components/EmptyState';
import { ToolIcon } from '@/components/icons';
import { EngineeringImportButton } from './ImportButton';
import { CadViewport, type CadViewPreset } from './CadViewport';
import { sampleTetField } from '@/core/engineering/volume';
import { artifactBaseName, buildReportPdf, safeName, useIndustrialArtifacts, useIndustrialOutput } from './artifacts';
import { useProjectStore } from '@/stores/projectStore';
import { useEngineeringStore } from '@/stores/engineeringStore';
import { useAppStore } from '@/stores/appStore';
import { useLocale } from '@/i18n';
import { downloadBytes, downloadText, renderSVG } from '@/core/plot';
import { logger } from '@/core/logger';
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
import {
  algorithmLabel,
  benchmarkLabel,
  boundaryKindLabel,
  fieldLabel,
  locationLabel,
  metricLabel,
  stepKindLabel,
} from './labels';
import { industrialExampleById } from '@/core/engineering/examples';
import { targetNodeIndices, findBoundaryConflicts } from '@/core/engineering/solve';
import { MATERIAL_LIBRARY, MATERIAL_PROPERTY_META, materialSummary, formatEngineering } from '@/core/engineering/materials';
import { defaultCase, ensureCase, validateDesignParameters } from '@/core/engineering/cases';
import { engineeringFingerprint } from '@/core/engineering/study';
import type {
  BoundaryKind,
  EngineeringCase,
  EngineeringStep,
  EngineeringStepKind,
  EngineeringStudy,
} from '@/core/engineering/types';
import {
  ExportGroups,
  FieldPicker,
  IndustrialActions,
  NoStudy,
  Page,
  PageHead,
  SvgPlot,
  useSendFigure,
  useStudyReplaceGuard,
} from './shared';
import { downloadSnapshot, MeshCanvas, ViewPresetBar, ViewToggle } from './viewers';
import { openFemLab, runFemLabCheck, type SimulationCheck } from './interop';

// --------------------------------------------------------------------------
// Geometry (P3)
// --------------------------------------------------------------------------

export function GeometryPage() {
  const t = useT();
  const study = useEngineeringStore((s) => s.study);
  const geometry = study?.geometry;
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
  const exportGeometryCsv = (target: 'download' | 'save') => {
    if (!geometry) return;
    void outputText('results', `${base}-geometry.csv`, geometryToCSV(geometry), target);
  };
  return (
    <Page toolId="geometry-import">
      <div className="ind-page analysis-body">
        <PageHead toolId="geometry-import" title={t('industrial.geometry')} />
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
                <ViewToggle
                  view3d={view3d}
                  onToggle={() => setView3d((v) => !v)}
                  onSnapshot={() => setSnapshotTick((n) => n + 1)}
                />
              </div>
              <ExportGroups
                items={[{
                  label: t('industrial.export_geometry_csv'),
                  onDownload: () => exportGeometryCsv('download'),
                  onSave: () => void exportGeometryCsv('save'),
                }]}
              />
              {view3d && (
                <ViewPresetBar
                  preset={preset}
                  onPreset={setPreset}
                  wireframe={wireframe}
                  onWireframe={setWireframe}
                />
              )}
            </>
          )}
        </IndustrialActions>
        {!geometry ? (
          <NoStudy
            toolId="geometry-import"
            title={study ? t('industrial.no_geometry') : undefined}
            description={study ? t('industrial.no_geometry_desc') : undefined}
          />
        ) : (
          <>
            {view3d && (
              <CadViewport
                geometry={geometry}
                layers={layers}
                wireframe={wireframe}
                preset={preset}
                snapshotRequest={snapshotTick}
                onSnapshotReady={(url) => downloadSnapshot(url, `${base}-cad.png`)}
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
            {study && !view3d && (
              <MeshCanvas
                mesh={study.mesh}
                height={360}
                snapshotRequest={snapshotTick}
                onSnapshotReady={(url) => downloadSnapshot(url, `${base}-mesh.png`)}
              />
            )}
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
  const t = useT();
  const study = useEngineeringStore((s) => s.study);
  const result = useEngineeringStore((s) => s.result);
  const [fieldName, setFieldName] = useState('');
  const [view3d, setView3d] = useState(true);
  const [preset, setPreset] = useState<CadViewPreset>('fit');
  const [wireframe, setWireframe] = useState(false);
  const [snapshotTick, setSnapshotTick] = useState(0);
  const { outputText, outputFigure } = useIndustrialOutput();
  const fields = study?.fields ?? [];
  const field = fields.find((item) => item.name === fieldName) ?? fields[0] ?? null;
  const base = artifactBaseName(study);
  const exportMesh = (target: 'download' | 'save') => {
    if (!study) return;
    void outputText('results', `${base}-nodes.csv`, nodesToCSV(study.mesh), target);
    void outputText('results', `${base}-elements.csv`, elementsToCSV(study.mesh), target);
  };
  const exportFigure = (target: 'download' | 'save') => {
    if (!study) return;
    void outputFigure(`${base}-mesh.svg`, meshToSVG(study, field, { title: study.name }), target);
  };
  return (
    <Page toolId="mesh-viewer">
      <div className="ind-page analysis-body">
        <PageHead toolId="mesh-viewer" title={t('industrial.mesh')} />
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
                <ViewToggle
                  view3d={view3d}
                  onToggle={() => setView3d((v) => !v)}
                  onSnapshot={() => setSnapshotTick((n) => n + 1)}
                />
              </div>
              <ExportGroups
                items={[
                  {
                    label: t('industrial.export_mesh_csv'),
                    onDownload: () => exportMesh('download'),
                    onSave: () => void exportMesh('save'),
                  },
                  {
                    label: t('industrial.export_mesh_svg'),
                    onDownload: () => exportFigure('download'),
                    onSave: () => void exportFigure('save'),
                  },
                ]}
              />
              {view3d && (
                <ViewPresetBar
                  preset={preset}
                  onPreset={setPreset}
                  wireframe={wireframe}
                  onWireframe={setWireframe}
                />
              )}
            </>
          )}
        </IndustrialActions>
        {!study ? (
          <NoStudy toolId="mesh-viewer" />
        ) : (
          <>
            {view3d ? (
              <CadViewport
                mesh={study.mesh}
                field={field}
                wireframe={wireframe}
                preset={preset}
                snapshotRequest={snapshotTick}
                onSnapshotReady={(url) => downloadSnapshot(url, `${base}-mesh.png`)}
              />
            ) : (
              <MeshCanvas
                mesh={study.mesh}
                field={field}
                snapshotRequest={snapshotTick}
                onSnapshotReady={(url) => downloadSnapshot(url, `${base}-mesh.png`)}
              />
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
        <PageHead toolId="material-library" title={t('industrial.materials')} />
        <IndustrialActions toolId="material-library">
          <div className="ind-toolbar analysis-row ind-add-row">
            <select className="input input-sm" value={template} onChange={(e) => setTemplate(e.target.value)}>
              {MATERIAL_LIBRARY.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.nameI18n[(locale.startsWith('zh') ? 'zh' : 'en') as 'zh' | 'en'] ?? item.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn btn-sm btn-primary"
              // Store actions silently no-op without a study — make that
              // visible instead of leaving a button that does nothing.
              disabled={!study}
              onClick={() => addMaterial(template)}
            >
              {t('industrial.material_add')}
            </button>
          </div>
        </IndustrialActions>
        {!study ? (
          <NoStudy toolId="material-library" />
        ) : (
          <>
            {study.materials.length === 0 && (
              <EmptyState
                title={t('industrial.no_material')}
                description={t('industrial.no_material_desc')}
              />
            )}
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
        <PageHead toolId="load-cases" title={t('industrial.cases')} />
        <IndustrialActions toolId="load-cases">
          <div className="ind-toolbar analysis-row">
            <select className="input input-sm" value={kind} onChange={(e) => setKind(e.target.value as EngineeringStepKind)}>
              {STEP_KINDS.map((item) => <option key={item} value={item}>{stepKindLabel(t, item)}</option>)}
            </select>
            <button type="button" className="btn btn-sm btn-primary" disabled={!study} onClick={() => addStep(kind)}>{t('industrial.step_add')}</button>
          </div>
        </IndustrialActions>
        {!study || !studyCase ? (
          <NoStudy toolId="load-cases" />
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
  // Physical symbols for the two value inputs, so "0 / 0" fields say what
  // they mean (ux·uy vs fx·fy vs T…) instead of relying on hover titles.
  const componentHint: Record<BoundaryKind, [string, string]> = {
    displacement: ['ux', 'uy'],
    force: ['fx', 'fy'],
    traction: ['tx', 'ty'],
    temperature: ['T', '—'],
    'heat-flux': ['qx', 'qy'],
    pressure: ['p', '—'],
    'electric-potential': ['V', '—'],
    other: ['c0', 'c1'],
  };
  const hints = componentHint[kind];
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
        <input className="input input-sm" type="number" step="any" value={c0} placeholder={hints[0]} onChange={(e) => setC0(Number(e.target.value))} title={t('industrial.component_n', { n: 0 })} />
        <input className="input input-sm" type="number" step="any" value={c1} placeholder={hints[1]} onChange={(e) => setC1(Number(e.target.value))} title={t('industrial.component_n', { n: 1 })} />
        <button
          type="button"
          className="btn btn-sm btn-primary"
          disabled={!study}
          onClick={() => add({
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

type Translate = (key: string, params?: Record<string, string | number>) => string;

interface ReadinessItem {
  key: string;
  label: string;
  severity: 'ok' | 'warn' | 'info';
  detail: string;
}

/** Pre-solve model check, the way desktop FEA tools gate a solve: surface what
 *  is missing on the page instead of failing after the user presses Solve. */
function solveChecklist(study: EngineeringStudy, step: EngineeringStep | undefined, t: Translate): ReadinessItem[] {
  const { mesh } = study;
  const items: ReadinessItem[] = [];
  const finite = mesh.nodes.every(
    (node) => Number.isFinite(node.x) && Number.isFinite(node.y) && Number.isFinite(node.z),
  );
  const meshOk = mesh.nodes.length > 0 && mesh.elements.length > 0 && finite;
  items.push({
    key: 'mesh',
    label: t('industrial.check_mesh'),
    severity: meshOk ? 'ok' : 'warn',
    detail: meshOk
      ? t('industrial.check_mesh_detail', { nodes: mesh.nodes.length, elements: mesh.elements.length })
      : t('industrial.check_mesh_empty'),
  });

  const isHeat = step?.kind === 'steady-heat' || step?.kind === 'transient-heat';
  const property = (material: EngineeringStudy['materials'][number], key: string): number => {
    const raw = material.properties[key];
    return typeof raw === 'number' ? raw : Number.NaN;
  };
  const material = study.materials.find((candidate) => {
    if (isHeat) return property(candidate, 'k') > 0;
    const E = property(candidate, 'E');
    const nu = property(candidate, 'nu');
    return Number.isFinite(E) && E > 0 && Number.isFinite(nu) && nu > -1 && nu < 0.5;
  });
  items.push({
    key: 'material',
    label: t('industrial.check_material'),
    severity: material ? 'ok' : 'warn',
    detail: material ? material.name : t('industrial.check_material_missing'),
  });

  const constraintKind: BoundaryKind = isHeat
    ? 'temperature'
    : step?.kind === 'potential-flow' ? 'pressure' : 'displacement';
  const constraints = study.boundaryConditions.filter(
    (bc) => bc.kind === constraintKind && targetNodeIndices(mesh, bc.target).length > 0,
  );
  items.push({
    key: 'constraint',
    label: t('industrial.check_constraint'),
    severity: constraints.length > 0 ? 'ok' : 'warn',
    detail: constraints.length > 0
      ? t('industrial.check_constraint_ok', { n: constraints.length })
      : t('industrial.check_constraint_missing'),
  });

  const loadKinds: BoundaryKind[] = isHeat
    ? ['heat-flux']
    : step?.kind === 'potential-flow' ? ['pressure', 'electric-potential', 'other'] : ['traction', 'force', 'pressure'];
  const loads = study.boundaryConditions.filter(
    (bc) => loadKinds.includes(bc.kind) && Object.values(bc.components).some((value) => value !== 0),
  );
  items.push({
    key: 'load',
    label: t('industrial.check_load'),
    severity: loads.length > 0 ? 'ok' : 'info',
    detail: loads.length > 0
      ? t('industrial.check_load_ok', { n: loads.length })
      : t('industrial.check_load_empty'),
  });

  const hasTet = mesh.elements.some((element) => element.type === 'tet4');
  const stepOk = step ? !hasTet || step.kind === 'steady-heat' : false;
  items.push({
    key: 'step',
    label: t('industrial.check_step'),
    severity: !step ? 'warn' : stepOk ? 'ok' : 'warn',
    detail: !step
      ? t('industrial.check_step_missing')
      : stepOk ? step.name : t('industrial.check_step_mismatch'),
  });

  // Contradictory BCs are caught by the solver; surface them before the
  // solve so the user can fix the model instead of reading a failure toast.
  const conflict = findBoundaryConflicts(
    study.boundaryConditions,
    step?.kind ?? 'static-structural',
  )[0];
  if (conflict) {
    items.push({
      key: 'conflict',
      label: t('industrial.check_conflict'),
      severity: 'warn',
      detail: t('industrial.check_conflict_detail', {
        fix: conflict.prescribed.name,
        load: conflict.load.name,
      }),
    });
  }

  // Dangling design paths would make every scan row identical.
  const studyCase = ensureCase(study.cases)[0]!;
  const designIssues = validateDesignParameters({
    parameters: studyCase.design.parameters,
    materials: study.materials,
    steps: studyCase.steps,
    boundaryConditions: study.boundaryConditions,
  });
  if (designIssues.length > 0) {
    items.push({
      key: 'design',
      label: t('industrial.check_design'),
      severity: 'warn',
      detail: t('industrial.check_design_detail', {
        n: designIssues.length,
        name: designIssues[0]!.parameter,
      }),
    });
  }
  return items;
}

export function SolvePage() {
  const t = useT();
  const study = useEngineeringStore((s) => s.study);
  const result = useEngineeringStore((s) => s.result);
  const solving = useEngineeringStore((s) => s.solving);
  const solveError = useEngineeringStore((s) => s.error);
  const benchmark = useEngineeringStore((s) => s.benchmark);
  const buildStats = useEngineeringStore((s) => s.buildStats);
  const buildCached = useEngineeringStore((s) => s.buildCached);
  const clearBuildCache = useEngineeringStore((s) => s.clearBuildCache);
  const solve = useEngineeringStore((s) => s.solve);
  const runBenchmark = useEngineeringStore((s) => s.runBenchmark);
  const activeStepId = useEngineeringStore((s) => s.activeStepId);
  const selectStep = useEngineeringStore((s) => s.selectStep);
  const { outputText } = useIndustrialOutput();
  const [simBusy, setSimBusy] = useState(false);
  const [simCheck, setSimCheck] = useState<SimulationCheck | null>(null);
  const steps = study ? ensureCase(study.cases)[0]!.steps : [];
  const activeStep = steps.find((candidate) => candidate.id === activeStepId) ?? steps[0];
  const checklist = study ? solveChecklist(study, activeStep, t) : [];
  const readyCount = checklist.filter((item) => item.severity !== 'warn').length;
  const base = artifactBaseName(study);
  const exportStudy = (target: 'download' | 'save') => {
    if (study) void outputText('study', `${base}-study.json`, studyDocument(study), target);
  };
  const exportMetrics = (target: 'download' | 'save') => {
    if (result) void outputText('results', `${base}-metrics.csv`, resultToCSV(result), target);
  };
  const checkWithSimulation = async () => {
    setSimBusy(true);
    try {
      setSimCheck(await runFemLabCheck(study));
    } finally {
      setSimBusy(false);
    }
  };
  return (
    <Page toolId="fea-solver">
      <div className="ind-page analysis-body">
        <PageHead toolId="fea-solver" title={t('industrial.solver')} />
        <IndustrialActions toolId="fea-solver">
          <div className="ind-toolbar analysis-row">
            <select className="input input-sm" value={activeStepId ?? ''} onChange={(e) => selectStep(e.target.value)}>
              {steps.map((step) => <option key={step.id} value={step.id}>{step.name} ({stepKindLabel(t, step.kind)})</option>)}
            </select>
            <button
              type="button"
              className="btn btn-sm btn-primary"
              disabled={solving || !activeStep}
              onClick={() => void solve()}
            >
              {solving ? <span className="spinner" /> : t('industrial.solve')}
            </button>
            {buildStats && (
              <span className={`tag${buildCached ? ' is-hit' : ''}`}>
                {buildCached
                  ? t('industrial.build_hit', { n: buildStats.cached })
                  : t('industrial.build_computed', { n: buildStats.computed })}
              </span>
            )}
          </div>
          {/* Benchmarks / verification / cache maintenance form their own
              group — they are solver operations, not exports. */}
          <div className="ind-export-group">
            <span className="ind-export-label">{t('industrial.checks_group')}</span>
            <div className="ind-export-row">
              <button type="button" className="btn btn-sm" onClick={() => runBenchmark()}>
                {t('industrial.benchmark')}
              </button>
              <button type="button" className="btn btn-sm" disabled={simBusy || !study} onClick={() => void checkWithSimulation()}>
                {simBusy ? <span className="spinner" /> : t('industrial.sim_plugin_run')}
              </button>
              <button type="button" className="btn btn-sm" onClick={clearBuildCache}>
                {t('industrial.clear_build_cache')}
              </button>
            </div>
          </div>
          <ExportGroups
            items={[
              {
                label: t('industrial.export_metrics_csv'),
                disabled: !result,
                onDownload: () => exportMetrics('download'),
                onSave: () => void exportMetrics('save'),
              },
              {
                label: t('industrial.export_study_json'),
                onDownload: () => exportStudy('download'),
                onSave: () => void exportStudy('save'),
              },
            ]}
          />
        </IndustrialActions>
        {!study ? (
          <NoStudy />
        ) : (
          <>
            <div className="ind-card">
              <header className="ind-card-head">
                <strong>{t('industrial.check_title')}</strong>
                <span className={`tag${checklist.length > 0 && readyCount === checklist.length ? ' is-hit' : ''}`}>
                  {t('industrial.check_summary', { ok: readyCount, total: checklist.length })}
                </span>
              </header>
              <ul className="ind-check">
                {checklist.map((item) => (
                  <li key={item.key} className={`ind-check-item is-${item.severity}`}>
                    <span className="ind-check-mark" aria-hidden="true">
                      {item.severity === 'ok' ? '✓' : item.severity === 'warn' ? '!' : 'i'}
                    </span>
                    <strong>{item.label}</strong>
                    <span>{item.detail}</span>
                    {item.severity === 'warn' && (
                      <button
                        type="button"
                        className="ind-check-fix"
                        onClick={() => useAppStore.getState().setEmbeddedTool(
                          item.key === 'material' ? 'material-library'
                            : item.key === 'mesh' ? 'mesh-viewer'
                            : item.key === 'design' ? 'design-scan'
                            : 'load-cases',
                        )}
                      >
                        {t('industrial.check_fix')}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
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
            {simCheck && (
              <div className="ind-card">
                <header className="ind-card-head">
                  <strong>{t('industrial.sim_plugin_title')}</strong>
                  <button type="button" className="btn btn-sm" onClick={() => void openFemLab()}>
                    <ToolIcon kind="solver" size={13} /> {t('industrial.sim_plugin_open')}
                  </button>
                </header>
                {simCheck.ok ? (
                  <div className="ind-metrics">
                    <div>
                      <span>{t('industrial.sim_plugin_status')}</span>
                      <strong>{t('industrial.sim_plugin_converged')}</strong>
                    </div>
                    {simCheck.iterations !== undefined && (
                      <div><span>{t('industrial.iterations_label')}</span><strong>{simCheck.iterations}</strong></div>
                    )}
                    {simCheck.residual !== undefined && (
                      <div><span>{t('industrial.residual_label')}</span><strong>{simCheck.residual.toExponential(3)}</strong></div>
                    )}
                  </div>
                ) : (
                  <div className="ind-error">{simCheck.error ?? t('industrial.sim_plugin_failed')}</div>
                )}
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
            <div className="ind-canvas-wrap">
              <MeshCanvas mesh={study.mesh} field={study.fields[0]} height={340} />
              {/* Empty canvas → explain what to do next; a failed solve keeps
                  its (localized) reason on the canvas instead of only a toast. */}
              {!result && (
                <div className={`ind-canvas-hint${solveError ? ' is-error' : ''}`} role="status">
                  <div className="ind-canvas-hint-card">
                    <strong>{solveError ? t('industrial.solve_failed') : t('industrial.solver_empty_title')}</strong>
                    <span>{solveError ?? t('industrial.solver_empty_desc')}</span>
                  </div>
                </div>
              )}
            </div>
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
  const t = useT();
  const study = useEngineeringStore((s) => s.study);
  const result = useEngineeringStore((s) => s.result);
  const [fieldName, setFieldName] = useState('');
  const sendFigure = useSendFigure();
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
  type Target = 'download' | 'save';
  const exportFieldCsv = (target: Target) => {
    if (!study || !field) return;
    void outputText('results', `${stem}.csv`, fieldToCSV(study, field), target);
  };
  const exportMeshCsv = (target: Target) => {
    if (!study) return;
    void outputText('results', `${base}-nodes.csv`, nodesToCSV(study.mesh), target);
    void outputText('results', `${base}-elements.csv`, elementsToCSV(study.mesh), target);
  };
  const exportMetrics = (target: Target) => {
    if (!result) return;
    void outputText('results', `${base}-metrics.csv`, resultToCSV(result), target);
  };
  const exportFigure = (target: Target) => {
    if (!study) return;
    void outputFigure(`${stem}.svg`, figureSvg(), target);
  };
  const exportFigurePng = (target: Target) => {
    if (!study) return;
    void outputPng(`${stem}.png`, figureSvg(), target);
  };
  const exportFigurePdf = (target: Target) => {
    if (!study) return;
    void outputPdf(`${stem}.pdf`, figureSvg(), target);
  };
  const exportHistogram = (target: Target) => {
    if (!histogram) return;
    void outputFigure(`${stem}-histogram.svg`, renderSVG(histogram), target);
  };
  return (
    <Page toolId="post-processing">
      <div className="ind-page analysis-body">
        <PageHead toolId="post-processing" title={t('industrial.post')} />
        <IndustrialActions toolId="post-processing">
          <div className="ind-toolbar analysis-row">
            <FieldPicker fields={fields} value={field?.name ?? ''} onChange={setFieldName} />
            {field && <span className="ind-hint">{locationLabel(t, field.location)} · {t('industrial.component_count', { n: field.components })} {field.unit ? `· ${field.unit}` : ''}</span>}
            <span className="ind-toolbar-spacer" />
            {/* Sending figures to the figure pipeline is not a file export —
                it stays an action, outside the download/save groups. */}
            {histogram && (
              <button
                type="button"
                className="btn btn-sm"
                title={t('industrial.send_figure_hint')}
                onClick={() => sendFigure(
                  `${study?.name ?? 'Study'} · ${t('industrial.field_distribution')}`,
                  histogram,
                  field ? fieldLabel(t, field.name) : undefined,
                )}
              >
                {t('industrial.send_figure')}
              </button>
            )}
          </div>
          <ExportGroups
            items={[
              {
                label: t('industrial.export_field_csv'),
                disabled: !field,
                onDownload: () => exportFieldCsv('download'),
                onSave: () => void exportFieldCsv('save'),
              },
              {
                label: t('industrial.export_mesh_csv'),
                onDownload: () => exportMeshCsv('download'),
                onSave: () => void exportMeshCsv('save'),
              },
              {
                label: t('industrial.export_metrics_csv'),
                disabled: !result,
                onDownload: () => exportMetrics('download'),
                onSave: () => void exportMetrics('save'),
              },
              {
                label: t('industrial.export_svg'),
                onDownload: () => exportFigure('download'),
                onSave: () => void exportFigure('save'),
              },
              {
                label: t('industrial.export_png'),
                onDownload: () => exportFigurePng('download'),
                onSave: () => void exportFigurePng('save'),
              },
              {
                label: t('industrial.export_pdf'),
                onDownload: () => exportFigurePdf('download'),
                onSave: () => void exportFigurePdf('save'),
              },
              {
                label: t('industrial.export_histogram_svg'),
                disabled: !histogram,
                onDownload: () => exportHistogram('download'),
                onSave: () => void exportHistogram('save'),
              },
            ]}
          />
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
        </IndustrialActions>
        {!study ? (
          <NoStudy toolId="post-processing" />
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

// --------------------------------------------------------------------------
// Design scan (parametric sweep)
// --------------------------------------------------------------------------

interface ScanSuggestion {
  path: string;
  min: number;
  max: number;
  levels: number;
}

/** Parameter paths that actually exist in the current study. `applyDesignPoint`
 *  silently ignores a path whose entity name does not match, so the scan page
 *  offers one-click starters instead of making the user guess the syntax. */
function scanSuggestions(study: EngineeringStudy): ScanSuggestion[] {
  const out: ScanSuggestion[] = [];
  const material = study.materials[0];
  const E = material?.properties.E;
  if (material && typeof E === 'number' && E > 0) {
    out.push({
      path: `material.${material.name}.E`,
      min: Number((E * 0.8).toPrecision(6)),
      max: Number((E * 1.2).toPrecision(6)),
      levels: 3,
    });
  }
  const step = ensureCase(study.cases)[0]?.steps[0];
  if (step) {
    out.push({ path: `step.${step.id}.tolerance`, min: 1e-11, max: 1e-9, levels: 3 });
  }
  const bc = study.boundaryConditions.find((item) => Math.abs(item.components[0] ?? 0) > 0);
  const value = bc?.components[0];
  if (bc && typeof value === 'number') {
    out.push({
      path: `bc.${bc.name}.0`,
      min: Number((value * 0.5).toPrecision(6)),
      max: Number((value * 1.5).toPrecision(6)),
      levels: 3,
    });
  }
  return out;
}

/** Inline design-space editor: the scan page must be operable on its own —
 *  previously parameters could only be added on the Loads & BCs page. */
function ScanParameterEditor({
  study,
  design,
  onChange,
}: {
  study: EngineeringStudy;
  design: EngineeringCase['design'];
  onChange: (design: EngineeringCase['design']) => void;
}) {
  const t = useT();
  const suggestions = useMemo(() => scanSuggestions(study), [study]);
  const [path, setPath] = useState(suggestions[0]?.path ?? '');
  const [min, setMin] = useState(suggestions[0]?.min ?? 0);
  const [max, setMax] = useState(suggestions[0]?.max ?? 1);
  const [levels, setLevels] = useState(suggestions[0]?.levels ?? 3);
  const points = design.parameters.reduce(
    (total, parameter) => total * Math.max(2, Math.round(parameter.levels) || 2),
    1,
  );
  const pick = (item: ScanSuggestion) => {
    setPath(item.path);
    setMin(item.min);
    setMax(item.max);
    setLevels(item.levels);
  };
  const add = () => {
    const name = path.trim();
    if (!name) return;
    if (!Number.isFinite(min) || !Number.isFinite(max)) return;
    // A reversed or absurd level count would otherwise produce a scan the
    // validator then rejects; normalise here so Add always makes a usable row.
    const low = Math.min(min, max);
    const high = Math.max(min, max);
    onChange({
      ...design,
      parameters: [
        ...design.parameters,
        { name, min: low, max: high, levels: Math.min(12, Math.max(2, Math.round(levels) || 2)) },
      ],
    });
  };
  return (
    <section className="ind-card">
      <header className="ind-card-head">
        <strong>{t('industrial.scan_setup_title')}</strong>
        <span className="ind-hint">{t('industrial.scan_setup_steps')}</span>
      </header>
      <div className="ind-toolbar analysis-row">
        <input
          className="input input-sm"
          value={path}
          list="scan-param-suggestions"
          placeholder={t('industrial.parameter_path')}
          onChange={(e) => setPath(e.target.value)}
        />
        <datalist id="scan-param-suggestions">
          {suggestions.map((item) => <option key={item.path} value={item.path} />)}
        </datalist>
        <input
          className="input input-sm"
          type="number"
          step="any"
          title={t('industrial.min')}
          value={min}
          onChange={(e) => setMin(Number(e.target.value))}
        />
        <input
          className="input input-sm"
          type="number"
          step="any"
          title={t('industrial.max')}
          value={max}
          onChange={(e) => setMax(Number(e.target.value))}
        />
        <input
          className="input input-sm"
          type="number"
          min={2}
          title={t('industrial.levels')}
          value={levels}
          onChange={(e) => setLevels(Number(e.target.value))}
        />
        <button type="button" className="btn btn-sm btn-primary" disabled={!path.trim()} onClick={add}>
          {t('industrial.add_parameter')}
        </button>
      </div>
      {suggestions.length > 0 && (
        <div className="ind-toolbar analysis-row">
          <span className="ind-hint">{t('industrial.scan_suggestions')}</span>
          {suggestions.map((item) => (
            <button key={item.path} type="button" className="btn btn-sm" onClick={() => pick(item)}>
              {item.path}
            </button>
          ))}
        </div>
      )}
      {design.parameters.length === 0 ? (
        <div className="ind-hint">{t('industrial.scan_path_hint')}</div>
      ) : (
        <div className="ind-table-wrap">
          <table className="sweep-table">
            <thead>
              <tr>
                <th>{t('industrial.parameter')}</th>
                <th>{t('industrial.min')}</th>
                <th>{t('industrial.max')}</th>
                <th>{t('industrial.levels')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {design.parameters.map((parameter, index) => (
                <tr key={`${parameter.name}-${index}`}>
                  <td className="mono">{parameter.name}</td>
                  <td>{parameter.min}</td>
                  <td>{parameter.max}</td>
                  <td>{parameter.levels}</td>
                  <td>
                    <button
                      type="button"
                      className="btn btn-sm"
                      aria-label={t('common.delete')}
                      onClick={() => onChange({
                        ...design,
                        parameters: design.parameters.filter((_, i) => i !== index),
                      })}
                    >
                      ×
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="ind-hint">{t('industrial.scan_points', { n: points })}</div>
        </div>
      )}
    </section>
  );
}

export function DesignScanPage() {
  const t = useT();
  const study = useEngineeringStore((s) => s.study);
  const scan = useEngineeringStore((s) => s.scan);
  const scanError = useEngineeringStore((s) => s.scanError);
  const runScan = useEngineeringStore((s) => s.runScan);
  const updateDesign = useEngineeringStore((s) => s.updateCaseDesign);
  const [busy, setBusy] = useState(false);
  const [metric, setMetric] = useState('');
  const sendFigure = useSendFigure();
  const design = study ? ensureCase(study.cases)[0]!.design : null;
  const keys = useMemo(() => scanMetricKeys(scan).slice(0, 8), [scan]);
  const activeMetric = keys.includes(metric) ? metric : keys[0] ?? '';
  const spec = useMemo(
    () => (activeMetric ? scanMetricSpec(scan, activeMetric, { title: metricLabel(t, activeMetric) }) : null),
    [activeMetric, scan, t],
  );
  const base = artifactBaseName(study);
  const { outputText, outputFigure } = useIndustrialOutput();
  const exportCsv = (target: 'download' | 'save') => {
    if (scan.length === 0) return;
    void outputText('results', `${base}-design-scan.csv`, scanToCSV(scan), target);
  };
  return (
    <Page toolId="design-scan">
      <div className="ind-page analysis-body">
        <PageHead toolId="design-scan" title={t('industrial.design_scan')} />
        <IndustrialActions toolId="design-scan">
          {design && (
            <div className="ind-toolbar analysis-row">
              <button type="button" className="btn btn-sm btn-primary" disabled={busy || design.parameters.length === 0}
                onClick={async () => { setBusy(true); try { await runScan(); } finally { setBusy(false); } }}>
                {busy ? <span className="spinner" /> : t('industrial.run_scan')}
              </button>
              <span className="ind-hint">{t('industrial.scan_summary', { p: design.parameters.length, n: scan.length })}</span>
              {spec && (
                <button
                  type="button"
                  className="btn btn-sm"
                  title={t('industrial.send_figure_hint')}
                  onClick={() => sendFigure(`${study?.name ?? 'Study'} · ${metricLabel(t, activeMetric)}`, spec, t('industrial.design_scan'))}
                >
                  {t('industrial.send_figure')}
                </button>
              )}
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
            </div>
          )}
          <ExportGroups
            items={[
              {
                label: t('industrial.export_scan_csv'),
                disabled: scan.length === 0,
                onDownload: () => exportCsv('download'),
                onSave: () => void exportCsv('save'),
              },
              {
                label: t('industrial.export_svg'),
                disabled: !spec,
                onDownload: () => { if (spec) void outputFigure(`${base}-design-scan-${safeName(activeMetric)}.svg`, renderSVG(spec), 'download'); },
                onSave: () => { if (spec) void outputFigure(`${base}-design-scan-${safeName(activeMetric)}.svg`, renderSVG(spec), 'save'); },
              },
            ]}
          />
        </IndustrialActions>
        {!study || !design ? (
          <NoStudy toolId="design-scan" />
        ) : (
          <>
            <ScanParameterEditor study={study} design={design} onChange={updateDesign} />
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
            {scan.length === 0 && design.parameters.length > 0 && !scanError && (
              <div className="ind-hint">{t('industrial.scan_ready')}</div>
            )}
            {scanError && (
              <div className="ind-hint ind-scan-error">
                {t(`industrial.scan_issue_${scanError.reason.replace(/-/g, '_')}`, {
                  name: scanError.parameter,
                  detail: scanError.detail,
                })}
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
  const t = useT();
  const study = useEngineeringStore((s) => s.study);
  const setStudy = useEngineeringStore((s) => s.setStudy);
  const result = useEngineeringStore((s) => s.result);
  const solve = useEngineeringStore((s) => s.solve);
  const solving = useEngineeringStore((s) => s.solving);
  const activeStepId = useEngineeringStore((s) => s.activeStepId);
  const [fieldName, setFieldName] = useState('');
  const [inletSpeed, setInletSpeed] = useState('1');
  const notify = useAppStore((s) => s.notify);
  const { locale } = useLocale();
  // This page only solves potential flow. Another study's heat/structural
  // result must not be presented as a flow field.
  const step = study
    ? ensureCase(study.cases)[0]?.steps.find((item) => item.id === activeStepId) ??
      ensureCase(study.cases)[0]?.steps[0] ??
      null
    : null;
  const isFlow = step?.kind === 'potential-flow';
  const fields = result?.fields ?? study?.fields ?? [];
  const velocityField = isFlow ? fields.find((item) => item.name === 'velocity') ?? null : null;
  // Potential flow returns a normalised velocity field, so speed is the
  // meaningful colour map rather than the first field in the list.
  const preferredField = isFlow ? 'speed' : fields[0]?.name ?? '';
  const field =
    fields.find((item) => item.name === (fieldName || preferredField)) ?? fields[0] ?? null;
  // Mean speed on the inlet group (pressure BC with a non-zero potential):
  // converts the normalised ∇φ field into physical m/s.
  const inletMean = useMemo(() => {
    if (!isFlow || !study || !velocityField) return null;
    const inlet = study.boundaryConditions.find(
      (bc) => bc.kind === 'pressure' && Object.values(bc.components).some((value) => value !== 0),
    );
    if (!inlet) return null;
    const nodes = new Set(targetNodeIndices(study.mesh, inlet.target));
    if (nodes.size === 0) return null;
    let sum = 0;
    let count = 0;
    for (let i = 0; i < study.mesh.elements.length; i += 1) {
      const element = study.mesh.elements[i]!;
      if (!element.nodes.every((node) => nodes.has(node))) continue;
      sum += Math.hypot(
        velocityField.values[i * velocityField.components] ?? 0,
        velocityField.values[i * velocityField.components + 1] ?? 0,
      );
      count += 1;
    }
    return count > 0 ? sum / count : null;
  }, [isFlow, study, velocityField]);
  const referenceSpeed = Number(inletSpeed);
  const speedScale =
    inletMean && inletMean > 0 && Number.isFinite(referenceSpeed) && referenceSpeed > 0
      ? referenceSpeed / inletMean
      : null;
  const maxSpeed = result?.metrics.max_speed ?? null;
  const { guard, dialog } = useStudyReplaceGuard();
  const makeChannel = () => {
    guard(() => {
      const example = industrialExampleById('industrial-channel-flow');
      if (!example) return;
      setStudy(example.build());
      notify('success', t('industrial.example_loaded', {
        name: example.nameI18n[locale.startsWith('zh') ? 'zh-CN' : 'en-US'],
      }));
      });
  };
  return (
    <Page toolId="quick-fluid">
      <div className="ind-page analysis-body">
        <PageHead toolId="quick-fluid" title={t('industrial.fluid')} />
        <IndustrialActions toolId="quick-fluid">
          <div className="ind-toolbar analysis-row">
            <button type="button" className="btn btn-sm" onClick={makeChannel}>{t('industrial.generate_channel')}</button>
            <button type="button" className="btn btn-sm btn-primary" disabled={solving || !study || !isFlow} onClick={() => void solve()}>{t('industrial.solve_flow')}</button>
            {isFlow && (
              <label className="ind-field">
                <span>{t('industrial.inlet_speed')}</span>
                <input
                  className="input input-sm ind-num"
                  type="number"
                  min={0}
                  step="0.1"
                  value={inletSpeed}
                  onChange={(e) => setInletSpeed(e.target.value)}
                />
              </label>
            )}
            <FieldPicker fields={fields} value={field?.name ?? ''} onChange={setFieldName} />
          </div>
          <EngineeringImportButton />
          {dialog}
        </IndustrialActions>
        {!study ? <NoStudy toolId="quick-fluid" /> : !isFlow ? (
          <div className="ind-empty">
            <EmptyState
              title={t('industrial.potential_flow')}
              description={t('industrial.potential_flow_desc')}
            />
            <div className="ind-toolbar analysis-row ind-empty-actions">
              <button type="button" className="btn btn-sm btn-primary" onClick={makeChannel}>
                {t('industrial.generate_channel')}
              </button>
            </div>
          </div>
        ) : (
          <>
            <MeshCanvas mesh={study.mesh} field={field} vectors={velocityField} height={380} />
            <div className="ind-hint">
              {typeof navigator !== 'undefined' && 'gpu' in navigator ? t('industrial.gpu_available') : t('industrial.gpu_unavailable')} · {t('industrial.fluid_hint')}
            </div>
            {result && (
              <div className="ind-metrics">
                {Object.entries(result.metrics).slice(0, 6).map(([key, value]) => (
                  <div key={key}><span>{metricLabel(t, key)}</span><strong>{formatEngineering(value)}</strong></div>
                ))}
                {inletMean !== null && speedScale !== null && (
                  <div>
                    <span>{t('industrial.max_speed_calibrated')}</span>
                    <strong>{formatEngineering((maxSpeed ?? 0) * speedScale)}</strong>
                  </div>
                )}
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
        <PageHead toolId="repro-fingerprint" title={t('industrial.fingerprint')} />
        <IndustrialActions toolId="repro-fingerprint">
          <div className="ind-toolbar analysis-row">
            <button type="button" className="btn btn-sm" disabled={!fingerprint} onClick={() => void copy()}>{t('industrial.copy')}</button>
            <button
              type="button"
              className="btn btn-sm btn-primary"
              disabled={!study}
              onClick={() => void saveStudyJson()}
            >
              {t('industrial.save_study')}
            </button>
            <span className="ind-hint">{t('industrial.project')} {project?.name ?? '—'} · {t('industrial.lock_v3')}</span>
          </div>
        </IndustrialActions>
        {!study || !fingerprint ? (
          <NoStudy toolId="repro-fingerprint" />
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
  const t = useT();
  const { locale } = useLocale();
  const study = useEngineeringStore((s) => s.study);
  const result = useEngineeringStore((s) => s.result);
  const benchmark = useEngineeringStore((s) => s.benchmark);
  const buildReport = useEngineeringStore((s) => s.buildReport);
  const base = artifactBaseName(study);
  // buildReport stamps `generatedAt` with the current time, so memoize it on
  // the real inputs: otherwise every render produces a new HTML string and the
  // preview would reload (and its timestamp would drift).
  const report = useMemo(
    () => buildReport(),
    // buildReport reads study/result/benchmark/locale from the store, which
    // the linter cannot see — list them so the memo invalidates on real input
    // changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [buildReport, study, result, benchmark, locale],
  );
  const [paperHeight, setPaperHeight] = useState(1120);
  const [zoom, setZoom] = useState(100);
  const shellRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  /** Shrink the sheet to the panel width (never enlarge beyond 100%) so a
   *  narrow dock cannot hide the right-hand columns. */
  const fitWidth = () => {
    const shell = shellRef.current;
    const frame = frameRef.current;
    if (!shell || !frame || frame.offsetWidth === 0) return;
    const available = shell.clientWidth - 32;
    const ratio = available / frame.offsetWidth;
    setZoom(Math.max(50, Math.min(100, Math.floor(ratio * 100))));
  };
  const { saveText, saveBinary, notify } = useIndustrialArtifacts();
  const [pdfBusy, setPdfBusy] = useState(false);
  const downloadHtml = () => {
    if (report) downloadText(report.html, `${base}-report.html`, 'text/html');
  };
  const downloadMarkdown = () => {
    if (report) downloadText(report.markdown, `${base}-report.md`, 'text/markdown');
  };
  const saveHtml = () => {
    if (report) void saveText('results', `${base}-report.html`, report.html);
  };
  const saveMarkdown = () => {
    if (report) void saveText('results', `${base}-report.md`, report.markdown);
  };
  /** PDF goes through the shared document pipeline (jsPDF + CJK font). */
  const exportPdf = async (target: 'download' | 'save') => {
    if (!report) return;
    setPdfBusy(true);
    try {
      const bytes = await buildReportPdf(report.title, report.markdown);
      if (target === 'download') downloadBytes(bytes, `${base}-report.pdf`, 'application/pdf');
      else await saveBinary('results', `${base}-report.pdf`, bytes);
    } catch (err) {
      logger.warn('engineering', 'report PDF export failed', err);
      notify('error', t('industrial.pdf_failed'));
    } finally {
      setPdfBusy(false);
    }
  };
  return (
    <Page toolId="industrial-report">
      <div className="ind-page analysis-body">
        <PageHead toolId="industrial-report" title={t('industrial.report')} />
        <IndustrialActions toolId="industrial-report">
          <ExportGroups
            items={[
              {
                label: t('industrial.export_html'),
                disabled: !report,
                onDownload: downloadHtml,
                onSave: saveHtml,
              },
              {
                label: t('industrial.export_markdown'),
                disabled: !report,
                onDownload: downloadMarkdown,
                onSave: saveMarkdown,
              },
              {
                label: t('industrial.export_pdf'),
                disabled: !report || pdfBusy,
                onDownload: () => void exportPdf('download'),
                onSave: () => void exportPdf('save'),
              },
            ]}
          />
          {report && (
            <div className="ind-toolbar analysis-row">
              <span className="ind-hint">{t('industrial.report_fingerprint', { hash: report.fingerprint.meshHash.slice(0, 12) })}</span>
            </div>
          )}
        </IndustrialActions>
        {!study || !report ? (
          <NoStudy toolId="industrial-report" />
        ) : (
          <>
            {/* Print-style preview: the report renders as a white A4 sheet, the
                same markup the downloaded HTML uses — WYSIWYG by construction.
                The zoom slider scales the sheet without reflowing it, so the
                paper can never be squeezed or hidden by a narrow dock. */}
            <div className="ind-paper-toolbar">
              <span className="ind-hint">{t('industrial.report_zoom')}</span>
              <input
                type="range"
                className="ind-zoom"
                min={50}
                max={150}
                step={5}
                value={zoom}
                aria-label={t('industrial.report_zoom')}
                onChange={(event) => setZoom(Number(event.target.value))}
              />
              <span className="ind-hint mono">{zoom}%</span>
              <button type="button" className="btn btn-sm" onClick={fitWidth}>
                {t('industrial.report_fit')}
              </button>
            </div>
            <div className="ind-paper-shell" ref={shellRef}>
              <div
                className="ind-paper-stage"
                style={{ width: `${(210 * zoom) / 100}mm`, height: paperHeight * (zoom / 100) }}
              >
                <iframe
                  ref={frameRef}
                  title={report.title}
                  className="ind-paper-frame"
                  srcDoc={report.html}
                  style={{ height: paperHeight, transform: `scale(${zoom / 100})` }}
                  onLoad={(event) => {
                    const doc = event.currentTarget.contentDocument;
                    if (doc) setPaperHeight(Math.max(640, doc.documentElement.scrollHeight));
                    fitWidth();
                  }}
                />
              </div>
            </div>
          </>
        )}
      </div>
    </Page>
  );
}
