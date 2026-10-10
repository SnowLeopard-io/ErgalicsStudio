// ==========================================================================
// Ergalics Studio — file information panel (right panel while previewing)
//
// Replaces the plugin-parameter bar in the right panel whenever a file is
// open in the canvas preview (C 需求). Shows name / path / type / size, plus
// kind-specific stats: text line & char counts, image natural dimensions,
// markdown word & heading counts, and the standard-skeleton guide line.
// ==========================================================================

import { useEffect, useMemo, useState } from 'react';
import { useT } from '@/i18n';
import type { FilePreviewState } from '@/stores/appStore';

function fmtSize(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

const GUIDE: ReadonlyArray<{ match: (p: string) => boolean; key: string }> = [
  { match: (p) => p === 'project.clproj', key: 'explorer.file_clproj' },
  { match: (p) => p === 'runs' || p.startsWith('runs/'), key: 'explorer.dir_runs' },
  { match: (p) => p === 'figures' || p.startsWith('figures/'), key: 'explorer.dir_figures' },
  { match: (p) => p === 'data' || p.startsWith('data/'), key: 'explorer.dir_data' },
  { match: (p) => p === 'code' || p.startsWith('code/'), key: 'explorer.dir_code' },
  { match: (p) => p === 'manuscript' || p.startsWith('manuscript/'), key: 'explorer.dir_manuscript' },
  { match: (p) => p === '.ergalics' || p.startsWith('.ergalics/'), key: 'explorer.dir_ergalics' },
  { match: (p) => p === '.git' || p.startsWith('.git/'), key: 'explorer.dir_git' },
  { match: (p) => p === '.gitignore' || p === '.gitattributes', key: 'explorer.dir_ignore' },
];

function Field({ label, value }: { label: string; value?: string | number }) {
  return (
    <div className="fileinfo-field">
      <span className="fileinfo-label">{label}</span>
      <span className="fileinfo-value">{value ?? '—'}</span>
    </div>
  );
}

export function FileInfoPanel({ preview }: { preview: FilePreviewState }) {
  const t = useT();
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);

  /** Image natural dimensions, read from the blob URL on mount. */
  useEffect(() => {
    if (preview.kind !== 'image' || !preview.blobUrl) {
      setDims(null);
      return;
    }
    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (!cancelled) setDims({ w: img.naturalWidth, h: img.naturalHeight });
    };
    img.src = preview.blobUrl;
    return () => {
      cancelled = true;
      img.onload = null;
    };
  }, [preview.kind, preview.blobUrl]);

  const stats = useMemo(() => {
    const text = preview.content ?? '';
    if (preview.kind === 'text') {
      const lines = preview.content === undefined ? 0 : text.split('\n').length - 1;
      return { lines, chars: text.length };
    }
    if (preview.kind === 'markdown') {
      const headings = (text.match(/^#{1,6} /gm) ?? []).length;
      const words = (text.match(/[A-Za-z0-9\u4e00-\u9fa5]+/g) ?? []).length;
      return { words, headings };
    }
    return null;
  }, [preview.kind, preview.content]);

  const ext = preview.name.includes('.')
    ? preview.name.slice(preview.name.lastIndexOf('.') + 1).toUpperCase()
    : '文件';
  const kindLabel = t(`workbench.fileinfo.kind_${preview.kind}`);
  const guideRow = GUIDE.find((g) => g.match(preview.path));

  return (
    <div className="fileinfo">
      <div className="fileinfo-block">
        <Field label={t('workbench.fileinfo.name')} value={preview.name} />
        <Field label={t('workbench.fileinfo.path')} value={preview.path} />
        <Field label={t('workbench.fileinfo.type')} value={`${ext} · ${kindLabel}`} />
        <Field label={t('workbench.fileinfo.size')} value={fmtSize(preview.size)} />
      </div>

      {preview.kind === 'text' && stats && (
        <div className="fileinfo-block">
          <Field label={t('workbench.fileinfo.lines')} value={stats.lines} />
          <Field label={t('workbench.fileinfo.chars')} value={stats.chars} />
          <Field label={t('workbench.fileinfo.encoding')} value="UTF-8" />
        </div>
      )}

      {preview.kind === 'markdown' && stats && (
        <div className="fileinfo-block">
          <Field label={t('workbench.fileinfo.words')} value={stats.words} />
          <Field label={t('workbench.fileinfo.headings')} value={stats.headings} />
          <Field label={t('workbench.fileinfo.encoding')} value="UTF-8" />
        </div>
      )}

      {preview.kind === 'image' && (
        <div className="fileinfo-block">
          <Field
            label={t('workbench.fileinfo.dimensions')}
            value={dims ? `${dims.w} × ${dims.h} px` : t('workbench.fileinfo.loading')}
          />
        </div>
      )}

      {guideRow && (
        <div className="fileinfo-block">
          <p className="fileinfo-guide">{t(guideRow.key)}</p>
        </div>
      )}
    </div>
  );
}