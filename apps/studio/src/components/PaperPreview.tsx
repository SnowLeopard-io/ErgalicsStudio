// ==========================================================================
// Ergalics Studio — paper preview pane (shared)
//
// A fixed-width "paper" (A4 = 794 px @96dpi by default) rendered in a
// sandboxed iframe, with a zoom toolbar. Used by the report generator and
// the LaTeX editor so both previews behave identically: the paper never
// reflows with the side panel, zoom scales the paper (transform) rather
// than the layout, and a 100% reset is always one click away.
//
// Zoom via transform + height compensation: the wrapper reserves
// visibleHeight = contentHeight / zoom so the scroll container never shows
// dead space at the bottom, and wide documents scroll horizontally instead
// of being clipped.
// ==========================================================================

import { useState } from 'react';
import { useT } from '@/i18n';

export interface PaperPreviewProps {
  /** The document to preview (full HTML). */
  srcDoc: string | null;
  /** Fixed paper width in px. Default 794 (A4 portrait @96dpi). */
  paperWidth?: number;
  /** Extra iframe sandbox tokens. */
  sandbox?: string;
  /** Accessible label for the iframe and toolbar. */
  ariaLabel: string;
  /** Bumped by the parent when srcDoc should visually reset. */
  buildId?: number | string;
  /** Minimum zoom (default 0.4). */
  minZoom?: number;
  /** Maximum zoom (default 2). */
  maxZoom?: number;
}

const ZOOM_STEP = 0.1;

export function PaperPreview({
  srcDoc,
  paperWidth = 794,
  sandbox,
  ariaLabel,
  buildId,
  minZoom = 0.4,
  maxZoom = 2,
}: PaperPreviewProps) {
  const t = useT();
  const [zoom, setZoom] = useState(1);

  const round = (z: number) => Math.round(z * 10) / 10;
  const zoomOut = () => setZoom((z) => Math.max(minZoom, round(z - ZOOM_STEP)));
  const zoomIn = () => setZoom((z) => Math.min(maxZoom, round(z + ZOOM_STEP)));

  return (
    <div className="paper-preview">
      <div className="paper-preview-toolbar" role="toolbar" aria-label={ariaLabel}>
        <span className="paper-preview-zoom-label">{t('paper.zoom')}</span>
        <button type="button" className="btn btn-sm" onClick={zoomOut} aria-label={t('paper.zoom_out')}>
          −
        </button>
        <span className="paper-preview-zoom-value" aria-live="polite">
          {Math.round(zoom * 100)}%
        </span>
        <button type="button" className="btn btn-sm" onClick={zoomIn} aria-label={t('paper.zoom_in')}>
          +
        </button>
        <button
          type="button"
          className="btn btn-sm"
          disabled={zoom === 1}
          onClick={() => setZoom(1)}
        >
          {t('paper.zoom_reset')}
        </button>
      </div>
      {srcDoc ? (
        <div className="paper-preview-scroll">
          <div className="paper-preview-paper" style={{ height: `calc(100% / ${zoom})` }}>
            <iframe
              key={buildId}
              className="paper-preview-frame"
              title={ariaLabel}
              srcDoc={srcDoc}
              sandbox={sandbox}
              style={{
                width: `${paperWidth}px`,
                transform: `scale(${zoom})`,
                transformOrigin: 'top left',
              }}
            />
          </div>
        </div>
      ) : (
        <div className="empty-hint">{t('paper.empty')}</div>
      )}
    </div>
  );
}
