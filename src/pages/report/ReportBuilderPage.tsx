// ==========================================================================
// Ergalics Studio — Report Builder (/report, F8 / FR8.4–FR8.6)
//
// Left: saved reports + ordered section editor (heading / markdown / figure
// / table / runs-summary / filter). Right: live self-contained HTML preview
// in an iframe (srcdoc) plus export/download. Specs persist in
// project.state.reports via the research store.
// ==========================================================================

import { useEffect, useMemo, useState } from 'react';
import { useT } from '@/i18n';
import { ToolShell } from '@/components/ToolShell';
import { useAppStore } from '@/stores/appStore';
import { useProjectStore } from '@/stores/projectStore';
import { useExperimentStore } from '@/stores/experimentStore';
import { useResearchStore } from '@/stores/researchStore';
import { buildReportHtml } from '@/core/report/builder';
import type { ReportSection, ReportSpec, ReportTheme, ReportLang } from '@/core/report/builder';
import { downloadBlob } from '@/core/download';
import { useTabularDataGroups } from '../research/researchUi';
import { ConfirmDialog } from '@/components/ConfirmDialog';

type SectionType = ReportSection['type'];

interface SectionDraft {
  type: SectionType;
  text: string;
  level: 1 | 2 | 3;
  sheetId: string;
  caption: string;
  tableId: string;
  title: string;
  fileId: string;
  maxRows: string;
  includeFull: boolean;
  filterId: string;
  field: string;
  label: string;
  kind: 'range' | 'categorical';
}

const EMPTY_SECTION: SectionDraft = {
  type: 'heading',
  text: '',
  level: 2,
  sheetId: '',
  caption: '',
  tableId: `t${Math.random().toString(36).slice(2, 8)}`,
  title: '',
  fileId: '',
  maxRows: '200',
  includeFull: false,
  filterId: `f${Math.random().toString(36).slice(2, 8)}`,
  field: '',
  label: '',
  kind: 'range',
};

function toSection(d: SectionDraft): ReportSection | null {
  switch (d.type) {
    case 'heading':
      return d.text.trim() ? { type: 'heading', text: d.text, level: d.level } : null;
    case 'markdown':
      return d.text.trim() ? { type: 'markdown', text: d.text } : null;
    case 'figure':
      return d.sheetId ? { type: 'figure', sheetId: d.sheetId, caption: d.caption || undefined } : null;
    case 'table':
      if (!d.tableId.trim() || !d.fileId) return null;
      return {
        type: 'table',
        id: d.tableId.trim(),
        fileId: d.fileId,
        title: d.title || undefined,
        maxRows: Math.max(1, Math.floor(Number(d.maxRows)) || 200),
        includeFull: d.includeFull,
      };
    case 'runs-summary':
      return { type: 'runs-summary' };
    case 'filter':
      return d.filterId.trim() && d.field.trim()
        ? {
            type: 'filter',
            id: d.filterId.trim(),
            field: d.field.trim(),
            label: d.label || undefined,
            kind: d.kind,
          }
        : null;
  }
}

function fromSection(s: ReportSection): SectionDraft {
  const d = { ...EMPTY_SECTION, type: s.type, tableId: `t${Math.random().toString(36).slice(2, 8)}`, filterId: `f${Math.random().toString(36).slice(2, 8)}` };
  if (s.type === 'heading') {
    d.text = s.text;
    d.level = s.level ?? 2;
  } else if (s.type === 'markdown') {
    d.text = s.text;
  } else if (s.type === 'figure') {
    d.sheetId = s.sheetId ?? '';
    d.caption = s.caption ?? '';
  } else if (s.type === 'table') {
    d.tableId = s.id;
    d.fileId = s.fileId ?? '';
    d.title = s.title ?? '';
    d.maxRows = String(s.maxRows ?? 200);
    d.includeFull = !!s.includeFull;
  } else if (s.type === 'filter') {
    d.filterId = s.id;
    d.field = s.field;
    d.label = s.label ?? '';
    d.kind = s.kind;
  }
  return d;
}

export default function ReportBuilderPage() {
  const t = useT();
  const notify = useAppStore((s) => s.notify);
  const project = useProjectStore((s) => s.project);
  const runs = useExperimentStore((s) => s.runs);
  const loadRuns = useExperimentStore((s) => s.loadRuns);
  const saveReportStore = useResearchStore((s) => s.saveReport);
  const deleteReportStore = useResearchStore((s) => s.deleteReport);

  const reports = project?.state.reports ?? [];
  const sheets = project?.state.figureSheets ?? [];
  // Parse-sniffed: the table section embeds parsed rows, so simulation-config
  // JSON files (which can never parse) must not be offered here.
  const groups = useTabularDataGroups(undefined, project?.data.files);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);

  const [name, setName] = useState('');
  const [title, setTitle] = useState('');
  const [subtitle, setSubtitle] = useState('');
  const [theme, setTheme] = useState<ReportTheme>('light');
  const [lang, setLang] = useState<ReportLang>('zh');
  const [drafts, setDrafts] = useState<SectionDraft[]>([]);
  const [html, setHtml] = useState('');
  /** Bumped on every rebuild — the preview iframe keys on it so each new
   *  document remounts a fresh iframe (Chromium will not reliably repaint an
   *  existing srcdoc iframe, which left the preview blank until a reload). */
  const [buildId, setBuildId] = useState(0);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    void loadRuns();
  }, [loadRuns, project?.id]);

  const spec: ReportSpec | null = useMemo(() => {
    if (!project) return null;
    const sections = drafts
      .map(toSection)
      .filter((s): s is ReportSection => s !== null);
    return {
      id: selectedId ?? undefined,
      name: name || undefined,
      title: title || name || 'Report',
      subtitle: subtitle || undefined,
      theme,
      lang,
      sections,
    };
  }, [project, drafts, selectedId, name, title, subtitle, theme, lang]);

  // Live preview: debounced rebuild on edits; the core is synchronous apart
  // from figures, the delay only smooths fast typing.
  useEffect(() => {
    let cancelled = false;
    if (!project || !spec) {
      setHtml('');
      return;
    }
    const timer = setTimeout(() => {
      void buildReportHtml(project, spec, { runs })
        .then((out) => {
          if (!cancelled) {
            setHtml(out);
            setBuildId((n) => n + 1);
          }
        })
        .catch(() => undefined);
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [project, spec, runs]);

  const beginNew = () => {
    const id = crypto.randomUUID();
    setSelectedId(id);
    setName(`report-${new Date().toISOString().slice(0, 10)}`);
    setTitle('');
    setSubtitle('');
    setTheme('light');
    setLang('zh');
    setDrafts([]);
  };

  const openReport = (r: ReportSpec) => {
    setSelectedId(r.id ?? null);
    setName(r.name ?? '');
    setTitle(r.title);
    setSubtitle(r.subtitle ?? '');
    setTheme(r.theme ?? 'light');
    setLang(r.lang ?? 'zh');
    setDrafts(r.sections.map(fromSection));
  };

  const addSection = (type: SectionType) => {
    setDrafts((arr) => [...arr, { ...EMPTY_SECTION, type }]);
  };

  const patchDraft = (i: number, patch: Partial<SectionDraft>) => {
    setDrafts((arr) => arr.map((d, j) => (j === i ? { ...d, ...patch } : d)));
  };

  const move = (i: number, dir: -1 | 1) => {
    setDrafts((arr) => {
      const j = i + dir;
      if (j < 0 || j >= arr.length) return arr;
      const next = arr.slice();
      const [item] = next.splice(i, 1);
      next.splice(j, 0, item!);
      return next;
    });
  };

  const handleSave = () => {
    if (!spec) return;
    const id = selectedId ?? crypto.randomUUID();
    setSelectedId(id);
    saveReportStore({ ...spec, id, updatedAt: Date.now() });
    notify('success', t('report.saved'));
  };

  const handleExport = async () => {
    if (!project || !spec || exporting) return;
    setExporting(true);
    try {
      const out = await buildReportHtml(project, spec, { runs });
      const safeName = (spec.name || 'report').replace(/[^\w.-]+/g, '_');
      downloadBlob(`${safeName}.html`, new TextEncoder().encode(out), 'text/html');
      notify('success', t('report.export_done'));
    } catch (err) {
      notify('error', t('report.export_failed', { reason: String(err) }));
    } finally {
      setExporting(false);
    }
  };

  return (
    <ToolShell toolId="report">
      {project && (
        <div className="report-main">
          <aside className="figures-side report-side">
            <div className="figures-side-header">
              <h2 className="figures-subtitle">{t('report.reports')}</h2>
              <button type="button" className="btn btn-sm btn-primary" onClick={beginNew}>
                + {t('report.new')}
              </button>
            </div>
            <ul className="figures-panel-list">
              {reports.map((r) => (
                <li
                  key={r.id}
                  className={`figures-panel-item${selectedId === r.id ? ' figures-panel-active' : ''}`}
                >
                  <button type="button" className="figures-panel-select" onClick={() => openReport(r)}>
                    <div className="figures-panel-name">{r.name || r.title}</div>
                    <div className="figures-panel-meta">{r.sections.length} sections</div>
                  </button>
                  <div className="figures-panel-actions">
                    <button
                      type="button"
                      className="btn btn-sm btn-danger"
                      onClick={() => r.id && setDeleteTarget({ id: r.id, name: r.name || r.title })}
                    >
                      {t('common.delete')}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
            {reports.length === 0 && <div className="empty-hint">{t('report.no_reports')}</div>}

            <div className="report-meta">
              <label className="figures-label">{t('report.name')}
                <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
              </label>
              <label className="figures-label">{t('report.report_title')}
                <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
              </label>
              <label className="figures-label">{t('report.subtitle')}
                <input className="input" value={subtitle} onChange={(e) => setSubtitle(e.target.value)} />
              </label>
              <div className="sweep-row">
                <label className="figures-label">{t('report.theme')}
                  <select className="input" value={theme} onChange={(e) => setTheme(e.target.value as ReportTheme)}>
                    <option value="light">{t('report.theme_light')}</option>
                    <option value="dark">{t('report.theme_dark')}</option>
                  </select>
                </label>
                <label className="figures-label">{t('report.lang')}
                  <select className="input" value={lang} onChange={(e) => setLang(e.target.value as ReportLang)}>
                    <option value="zh">{t('report.lang_zh')}</option>
                    <option value="en">{t('report.lang_en')}</option>
                  </select>
                </label>
              </div>
            </div>

            <div className="figures-side-header">
              <h2 className="figures-subtitle">{t('report.sections')}</h2>
              <DropdownAdd onAdd={addSection} />
            </div>
            <ul className="report-section-list">
              {drafts.map((d, i) => (
                <li key={i} className="report-section-item">
                  <div className="report-section-head">
                    <span className="figures-panel-tag">{i + 1}</span>
                    <strong>{t(`report.section_${d.type}`)}</strong>
                    <span className="report-section-buttons">
                      <button type="button" className="btn btn-sm" onClick={() => move(i, -1)}>↑</button>
                      <button type="button" className="btn btn-sm" onClick={() => move(i, 1)}>↓</button>
                      <button
                        type="button"
                        className="btn btn-sm btn-danger"
                        onClick={() => setDrafts((arr) => arr.filter((_, j) => j !== i))}
                      >
                        ×
                      </button>
                    </span>
                  </div>
                  {(d.type === 'heading' || d.type === 'markdown') && (
                    <>
                      {d.type === 'heading' && (
                        <select
                          className="input"
                          value={d.level}
                          onChange={(e) => patchDraft(i, { level: Number(e.target.value) as 1 | 2 | 3 })}
                        >
                          <option value={1}>H1</option>
                          <option value={2}>H2</option>
                          <option value={3}>H3</option>
                        </select>
                      )}
                      <textarea
                        className="input"
                        rows={d.type === 'markdown' ? 4 : 1}
                        value={d.text}
                        onChange={(e) => patchDraft(i, { text: e.target.value })}
                      />
                    </>
                  )}
                  {d.type === 'figure' && (
                    <div className="report-field-grid">
                      <select className="input" value={d.sheetId} onChange={(e) => patchDraft(i, { sheetId: e.target.value })}>
                        <option value="">{t('report.figure_pick')}</option>
                        {sheets.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                      </select>
                      <input className="input" placeholder={t('figure.caption')} value={d.caption}
                        onChange={(e) => patchDraft(i, { caption: e.target.value })} />
                    </div>
                  )}
                  {d.type === 'table' && (
                    <div className="report-field-grid">
                      <select className="input" value={d.fileId} onChange={(e) => patchDraft(i, { fileId: e.target.value })}>
                        <option value="">{t('report.table_file')}</option>
                        {groups.project.map((f) => <option key={f} value={f}>{f}</option>)}
                        {groups.examples.map((f) => <option key={f} value={f}>{f}</option>)}
                      </select>
                      <input className="input" placeholder={t('report.table_id')} value={d.tableId}
                        onChange={(e) => patchDraft(i, { tableId: e.target.value })} />
                      <input className="input" placeholder={t('report.table_title')} value={d.title}
                        onChange={(e) => patchDraft(i, { title: e.target.value })} />
                      <input className="input" title={t('report.max_rows')} value={d.maxRows}
                        onChange={(e) => patchDraft(i, { maxRows: e.target.value })} />
                      <label className="research-check">
                        <input type="checkbox" checked={d.includeFull}
                          onChange={(e) => patchDraft(i, { includeFull: e.target.checked })} />
                        {t('report.include_full')}
                      </label>
                    </div>
                  )}
                  {d.type === 'filter' && (
                    <div className="report-field-grid">
                      <input className="input" placeholder={t('report.filter_id')} value={d.filterId}
                        onChange={(e) => patchDraft(i, { filterId: e.target.value })} />
                      <input className="input" placeholder={t('report.filter_field')} value={d.field}
                        onChange={(e) => patchDraft(i, { field: e.target.value })} />
                      <input className="input" placeholder={t('report.filter_label')} value={d.label}
                        onChange={(e) => patchDraft(i, { label: e.target.value })} />
                      <select className="input" value={d.kind}
                        onChange={(e) => patchDraft(i, { kind: e.target.value as 'range' | 'categorical' })}>
                        <option value="range">{t('report.filter_range')}</option>
                        <option value="categorical">{t('report.filter_categorical')}</option>
                      </select>
                    </div>
                  )}
                  {d.type === 'runs-summary' && (
                    <span className="figures-panel-meta">{runs.length} runs</span>
                  )}
                </li>
              ))}
            </ul>

            <div className="sweep-actions">
              <button type="button" className="btn" onClick={handleSave}>{t('report.save')}</button>
              <button type="button" className="btn btn-primary" disabled={exporting} onClick={() => void handleExport()}>
                {t('report.export')}
              </button>
            </div>
          </aside>

          <section className="report-preview-wrap">
            {html ? (
              <iframe key={buildId} className="report-preview" title={t('report.preview')} srcDoc={html} sandbox="allow-scripts" />
            ) : (
              <div className="empty-hint">{t('report.no_reports')}</div>
            )}
          </section>
        </div>
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        title={t('report.delete')}
        message={t('report.delete_confirm')}
        name={deleteTarget?.name}
        confirmLabel={t('common.delete')}
        onConfirm={() => deleteTarget && deleteReportStore(deleteTarget.id)}
        onClose={() => setDeleteTarget(null)}
      />
    </ToolShell>
  );
}

function DropdownAdd({ onAdd }: { onAdd: (type: SectionType) => void }) {
  const t = useT();
  const types: SectionType[] = ['heading', 'markdown', 'figure', 'table', 'runs-summary', 'filter'];
  return (
    <select
      className="input btn-sm report-add-select"
      value=""
      onChange={(e) => {
        if (e.target.value) onAdd(e.target.value as SectionType);
        e.target.value = '';
      }}
    >
      <option value="">+ {t('report.add_section')}</option>
      {types.map((ty) => (
        <option key={ty} value={ty}>{t(`report.section_${ty}`)}</option>
      ))}
    </select>
  );
}
