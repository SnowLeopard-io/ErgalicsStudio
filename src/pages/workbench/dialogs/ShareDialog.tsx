import { useEffect, useRef, useState } from 'react';
import { useT, getLocale } from '@/i18n';
import { Modal } from '@/components/Modal';
import { useProjectStore } from '@/stores/projectStore';
import { useAnalysisStore } from '@/stores/analysisStore';
import { useExperimentStore } from '@/stores/experimentStore';
import { useAppStore } from '@/stores/appStore';
import { serializeProject, DEFAULT_PROJECT_NAME } from '@/types/project';
import { compressToEncodedURIComponent } from 'lz-string';
import { exportSVG, exportPDF } from '@/core/plot';
import { buildLock } from '@/core/repro/lock';
import { buildReproSnapshot } from '@/core/repro/snapshot';
import { downloadBlob } from '@/core/download';
import { buildGalleryShare } from '@/core/gallery/share';
import { addShared } from '@/core/gallery/store';
import {
  GALLERY_CHART_TYPES,
  GALLERY_LICENSES,
  GALLERY_SUBJECTS,
  type GalleryChartType,
  type GalleryLicense,
  type GallerySubject,
} from '@/core/gallery/types';

interface ShareDialogProps {
  open: boolean;
  onClose: () => void;
}

interface ShareOptions {
  data: boolean;
  params: boolean;
  scene: boolean;
}

const DEFAULT_OPTIONS: ShareOptions = { data: true, params: true, scene: true };

type ShareMode = 'snapshot' | 'legacy';

/** Staged progress for the snapshot export (FR-09). */
type SnapshotStage = 'collect' | 'lock' | 'render' | 'save';

const STAGE_ORDER: SnapshotStage[] = ['collect', 'lock', 'render', 'save'];

/** Let the browser paint the progress step before the next sync phase runs. */
function nextFrame(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 16));
}

export function ShareDialog({ open, onClose }: ShareDialogProps) {
  const t = useT();
  const project = useProjectStore((s) => s.project);
  const notify = useProjectStore.getState().applyPluginParams;
  const notifyApp = useAppStore((s) => s.notify);
  const currentPlot = useAnalysisStore((s) => s.currentPlot);
  const [options, setOptions] = useState<ShareOptions>(DEFAULT_OPTIONS);
  const [link, setLink] = useState('');
  const [copied, setCopied] = useState(false);
  const [size, setSize] = useState('0 B');
  const [mode, setMode] = useState<ShareMode>('snapshot');
  const [snapshotStage, setSnapshotStage] = useState<SnapshotStage | null>(null);
  // ---- FR-19: share to gallery ----
  const [galleryEnabled, setGalleryEnabled] = useState(false);
  const [galleryLicense, setGalleryLicense] = useState<GalleryLicense>('CC-BY-4.0');
  const [gallerySubject, setGallerySubject] = useState<GallerySubject>('physics');
  const [galleryChartType, setGalleryChartType] = useState<GalleryChartType>('line');
  const [gallerySummary, setGallerySummary] = useState('');
  const [galleryAuthor, setGalleryAuthor] = useState('');
  const linkRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open && project) {
      const bytes = new Blob([serializeProject(project)]).size;
      setSize(formatBytes(bytes));
    }
  }, [open, project]);

  const toggle = (key: keyof ShareOptions) =>
    setOptions((o) => ({ ...o, [key]: !o[key] }));

  /**
   * FR-09: collect → lock → render the self-contained snapshot HTML. Shared
   * by the file export and the FR-19 gallery share; the project is only read,
   * never mutated.
   */
  const buildSnapshotHtml = async (): Promise<string> => {
    setSnapshotStage('collect');
    await nextFrame();
    // Persist latest plugin params so the lock hashes the current state.
    await notify();
    const projectNow = useProjectStore.getState().project;
    if (!projectNow) throw new Error(t('gallery.share_no_snapshot'));
    await useExperimentStore.getState().loadRuns();
    const runs = useExperimentStore.getState().runs;

    setSnapshotStage('lock');
    await nextFrame();
    const lock = buildLock(projectNow, { runs });

    setSnapshotStage('render');
    await nextFrame();
    const lang: 'zh' | 'en' = getLocale() === 'zh-CN' ? 'zh' : 'en';
    const charts = currentPlot
      ? [{ title: projectNow.name, svg: currentPlot.markup }]
      : [];
    return buildReproSnapshot({
      project: projectNow,
      lock,
      runs,
      charts,
      lang,
      studioVersion: lock.versions.studio,
    });
  };

  /**
   * FR-09: export a self-contained reproducible snapshot. Runs in explicit
   * stages so the dialog can show progress.
   */
  const exportSnapshot = async () => {
    if (!project || snapshotStage) return;
    try {
      const html = await buildSnapshotHtml();
      setSnapshotStage('save');
      await nextFrame();
      const fileName = `${(project.name || DEFAULT_PROJECT_NAME).replace(/[^\w.-]+/g, '_')}-snapshot.html`;
      downloadBlob(fileName, html, 'text/html;charset=utf-8');
      notifyApp('success', t('repro2.snapshot_saved'));
    } catch (err) {
      notifyApp('error', String(err));
    } finally {
      setSnapshotStage(null);
    }
  };

  /**
   * FR-19: publish the snapshot to the work gallery. The HTML is stripped of
   * raw private data (core/gallery/share.ts) before it reaches the local
   * shared-works store.
   */
  const shareToGallery = async () => {
    if (!project || snapshotStage) return;
    const title = project.name || DEFAULT_PROJECT_NAME;
    if (!title.trim()) {
      notifyApp('error', t('gallery.share_missing_title'));
      return;
    }
    try {
      const html = await buildSnapshotHtml();
      const { item } = buildGalleryShare(html, {
        title: { zh: title, en: title },
        summary: {
          zh: gallerySummary || project.metadata.description || title,
          en: gallerySummary || project.metadata.description || title,
        },
        author: galleryAuthor.trim() || 'Anonymous',
        subject: gallerySubject,
        chartTypes: [galleryChartType],
        reproStatus: 'locked',
        license: galleryLicense,
      });
      addShared({ item, html });
      notifyApp('success', t('gallery.share_success'));
      setGalleryEnabled(false);
    } catch (err) {
      notifyApp('error', t('gallery.share_failed', { error: String(err) }));
    } finally {
      setSnapshotStage(null);
    }
  };

  const generateLink = async () => {
    if (!project) return;
    // Persist the latest plugin params into the project before serializing,
    // and await it — otherwise the payload can be built from a stale
    // snapshot and share a project missing the current parameters.
    await notify();
    const projectNow = useProjectStore.getState().project;
    if (!projectNow) return;
    const payload = {
      name: projectNow.name,
      data: options.data ? projectNow.data : undefined,
      params: options.params ? projectNow.state.parameters : undefined,
      scene: options.scene ? projectNow.state.scene : undefined,
    };
    const compressed = compressToEncodedURIComponent(JSON.stringify(payload));
    const url = `${location.origin}${location.pathname}#/share/${compressed}`;
    setLink(url);
  };

  const exportFile = () => {
    useProjectStore.getState().saveAs(project?.name);
  };

  const exportScreenshot = () => {
    const canvas = document.querySelector('.central-canvas') as HTMLCanvasElement | null;
    if (!canvas) return;
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = `${project?.name ?? 'ergalics'}-screenshot.png`;
    a.click();
  };

  const exportChartSvg = () => {
    if (!currentPlot) return;
    exportSVG(currentPlot.markup, `${project?.name ?? 'ergalics'}-chart.svg`);
  };

  const exportChartPdf = () => {
    if (!currentPlot) return;
    void exportPDF(currentPlot.markup, `${project?.name ?? 'ergalics'}-chart.pdf`);
  };

  const copyLink = async () => {
    if (!link) return;
    await navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('share.title')}
      width={520}
      footer={
        <button type="button" className="btn" onClick={onClose}>
          {t('common.close')}
        </button>
      }
    >
      <div className="share-body">
        <div className="share-project">
          <div>
            <strong>{project?.name || DEFAULT_PROJECT_NAME}</strong>
          </div>
          <span className="tag tag-muted">{size}</span>
        </div>

        {/* ---- Mode: reproducible snapshot vs classic share (FR-09) ---- */}
        <div className="share-mode-picker" role="tablist">
          <button
            type="button"
            className={`btn btn-sm ${mode === 'snapshot' ? 'btn-primary' : ''}`}
            onClick={() => setMode('snapshot')}
          >
            {t('repro2.snapshot_mode')}
          </button>
          <button
            type="button"
            className={`btn btn-sm ${mode === 'legacy' ? 'btn-primary' : ''}`}
            onClick={() => setMode('legacy')}
          >
            {t('repro2.legacy_mode')}
          </button>
        </div>

        {mode === 'snapshot' ? (
          <>
            <h4 className="share-section-title">{t('repro2.snapshot_section')}</h4>
            <p className="share-hint">{t('repro2.snapshot_desc')}</p>
            <div className="share-actions">
              <button
                type="button"
                className="btn btn-primary"
                disabled={!project || snapshotStage !== null}
                onClick={() => void exportSnapshot()}
              >
                {t('repro2.snapshot_export')}
              </button>
            </div>
            {snapshotStage && (
              <div className="share-snapshot-progress">
                {STAGE_ORDER.map((stage) => {
                  const active = STAGE_ORDER.indexOf(stage) <= STAGE_ORDER.indexOf(snapshotStage);
                  return (
                    <span key={stage} className={active ? 'stage active' : 'stage'}>
                      {t(`repro2.progress_${stage}`)}
                    </span>
                  );
                })}
              </div>
            )}

            {/* ---- FR-19: share to the work gallery ---- */}
            <h4 className="share-section-title">{t('gallery.share_section')}</h4>
            <CheckOption
              checked={galleryEnabled}
              label={t('gallery.share_enable')}
              onChange={() => setGalleryEnabled((v) => !v)}
            />
            <p className="share-hint">{t('gallery.share_desc')}</p>
            {galleryEnabled && (
              <div className="gallery-share-form">
                <div className="analysis-row">
                  <label className="analysis-label" htmlFor="gallery-share-license">
                    {t('gallery.detail.license')}
                  </label>
                  <select
                    id="gallery-share-license"
                    className="input"
                    value={galleryLicense}
                    onChange={(e) => setGalleryLicense(e.target.value as GalleryLicense)}
                  >
                    {GALLERY_LICENSES.map((l) => (
                      <option key={l} value={l}>
                        {l}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="analysis-row">
                  <label className="analysis-label" htmlFor="gallery-share-subject">
                    {t('gallery.share_subject')}
                  </label>
                  <select
                    id="gallery-share-subject"
                    className="input"
                    value={gallerySubject}
                    onChange={(e) => setGallerySubject(e.target.value as GallerySubject)}
                  >
                    {GALLERY_SUBJECTS.map((s) => (
                      <option key={s} value={s}>
                        {t(`gallery.subject.${s}`)}
                      </option>
                    ))}
                  </select>
                  <label className="analysis-label" htmlFor="gallery-share-chart">
                    {t('gallery.share_charts')}
                  </label>
                  <select
                    id="gallery-share-chart"
                    className="input"
                    value={galleryChartType}
                    onChange={(e) => setGalleryChartType(e.target.value as GalleryChartType)}
                  >
                    {GALLERY_CHART_TYPES.map((c) => (
                      <option key={c} value={c}>
                        {t(`gallery.chart.${c}`)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="analysis-row">
                  <label className="analysis-label" htmlFor="gallery-share-author">
                    {t('gallery.share_author')}
                  </label>
                  <input
                    id="gallery-share-author"
                    className="input"
                    value={galleryAuthor}
                    placeholder={t('gallery.share_author_placeholder')}
                    onChange={(e) => setGalleryAuthor(e.target.value)}
                  />
                </div>
                <label className="analysis-label" htmlFor="gallery-share-summary">
                  {t('gallery.share_summary')}
                </label>
                <textarea
                  id="gallery-share-summary"
                  className="input"
                  rows={3}
                  value={gallerySummary}
                  placeholder={t('gallery.share_summary_placeholder')}
                  onChange={(e) => setGallerySummary(e.target.value)}
                />
                <div className="share-actions">
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={!project || snapshotStage !== null}
                    onClick={() => void shareToGallery()}
                  >
                    {t('gallery.share_submit')}
                  </button>
                </div>
              </div>
            )}
          </>
        ) : (
          <>
            {/* ---- Share: collaboration only ---- */}
            <h4 className="share-section-title">{t('share.share_section')}</h4>
            <div className="share-options">
              <CheckOption checked={options.data} label={t('share.data')} onChange={() => toggle('data')} />
              <CheckOption checked={options.params} label={t('share.params')} onChange={() => toggle('params')} />
              <CheckOption checked={options.scene} label={t('share.scene')} onChange={() => toggle('scene')} />
            </div>
            {options.data && project && (
              <p className="share-hint">
                {project.data.files.length > 0
                  ? t('share.data_files_hint', { count: project.data.files.length })
                  : t('share.data_files_empty')}
              </p>
            )}

            <div className="share-actions">
              <button type="button" className="btn btn-primary" onClick={() => void generateLink()}>
                {t('share.generate_link')}
              </button>
            </div>

            <div className="share-link-row">
              <input
                ref={linkRef}
                className="input"
                readOnly
                aria-label={t('share.link_placeholder')}
                value={link || t('share.link_placeholder')}
              />
              <button type="button" className="btn btn-sm" onClick={() => void copyLink()} disabled={!link}>
                {copied ? t('share.copied') : t('share.copy')}
              </button>
            </div>
          </>
        )}

        {/* ---- Export: every "take a file out" action lives here ---- */}
        <h4 className="share-section-title">{t('share.export_section')}</h4>
        <div className="share-actions share-export-grid">
          <button type="button" className="btn" onClick={exportFile}>
            {t('share.export_file')}
          </button>
          <button type="button" className="btn" onClick={exportScreenshot}>
            {t('share.export_screenshot')}
          </button>
          <button
            type="button"
            className="btn"
            onClick={exportChartSvg}
            disabled={!currentPlot}
            title={currentPlot ? undefined : t('share.no_chart')}
          >
            {t('share.export_chart_svg')}
          </button>
          <button
            type="button"
            className="btn"
            onClick={exportChartPdf}
            disabled={!currentPlot}
            title={currentPlot ? undefined : t('share.no_chart')}
          >
            {t('share.export_chart_pdf')}
          </button>
        </div>
        {!currentPlot && <p className="share-hint">{t('share.no_chart')}</p>}
      </div>
    </Modal>
  );
}

function CheckOption({ checked, label, onChange }: { checked: boolean; label: string; onChange: () => void }) {
  return (
    <label className="share-option">
      <input type="checkbox" checked={checked} onChange={onChange} />
      <span>{label}</span>
    </label>
  );
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB'];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(1)} ${units[i]}`;
}
