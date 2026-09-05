import { useEffect, useRef, useState } from 'react';
import { useT } from '@/i18n';
import { Modal } from '@/components/Modal';
import { useProjectStore } from '@/stores/projectStore';
import { useAnalysisStore } from '@/stores/analysisStore';
import { serializeProject, DEFAULT_PROJECT_NAME } from '@/types/project';
import { compressToEncodedURIComponent } from 'lz-string';
import { exportSVG, exportPDF } from '@/core/plot';

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

export function ShareDialog({ open, onClose }: ShareDialogProps) {
  const t = useT();
  const project = useProjectStore((s) => s.project);
  const notify = useProjectStore.getState().applyPluginParams;
  const currentPlot = useAnalysisStore((s) => s.currentPlot);
  const [options, setOptions] = useState<ShareOptions>(DEFAULT_OPTIONS);
  const [link, setLink] = useState('');
  const [copied, setCopied] = useState(false);
  const [size, setSize] = useState('0 B');
  const linkRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open && project) {
      const bytes = new Blob([serializeProject(project)]).size;
      setSize(formatBytes(bytes));
    }
  }, [open, project]);

  const toggle = (key: keyof ShareOptions) =>
    setOptions((o) => ({ ...o, [key]: !o[key] }));

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

        {/* ---- Share: collaboration only ---- */}
        <h4 className="share-section-title">{t('share.share_section')}</h4>
        <div className="share-options">
          <CheckOption checked={options.data} label={t('share.data')} onChange={() => toggle('data')} />
          <CheckOption checked={options.params} label={t('share.params')} onChange={() => toggle('params')} />
          <CheckOption checked={options.scene} label={t('share.scene')} onChange={() => toggle('scene')} />
        </div>

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
            value={link || t('share.link_placeholder')}
          />
          <button type="button" className="btn btn-sm" onClick={() => void copyLink()} disabled={!link}>
            {copied ? t('share.copied') : t('share.copy')}
          </button>
        </div>

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
