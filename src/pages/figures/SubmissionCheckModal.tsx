// ==========================================================================
// Ergalics Studio — submission check panel (FR-03)
//
// Grouped pass/fail checklist for the active figure sheet, aligned to the
// IEEE/Elsevier profiles in core/submit/checklist. The panel also owns the
// submission export settings (format/dpi/color-mode/font-embedding) that the
// checklist inspects. Every failing item offers "locate the issue": controls
// inside this dialog are focused in place; page controls close the dialog
// first, then scroll + focus.
// ==========================================================================

import { useMemo } from 'react';
import { Modal } from '@/components/Modal';
import { useT } from '@/i18n';
import {
  runSubmissionCheck,
  SUBMISSION_TARGETS,
} from '@/core/submit/checklist';
import type {
  SubmissionDoc,
  SubmissionExportSettings,
  SubmissionTargetId,
} from '@/core/submit/checklist';
import type { FigureExportFormat } from '@/core/figure/compose';

interface SubmissionCheckModalProps {
  open: boolean;
  onClose: () => void;
  /** The figure document under check (active sheet). */
  doc: SubmissionDoc;
  targetId: SubmissionTargetId;
  onTargetChange: (id: SubmissionTargetId) => void;
  settings: SubmissionExportSettings;
  onSettingsChange: (patch: Partial<SubmissionExportSettings>) => void;
}

const GROUP_ORDER = ['image', 'annotation', 'text', 'metadata'] as const;

export function SubmissionCheckModal({
  open,
  onClose,
  doc,
  targetId,
  onTargetChange,
  settings,
  onSettingsChange,
}: SubmissionCheckModalProps) {
  const t = useT();
  const result = useMemo(() => runSubmissionCheck(doc, targetId), [doc, targetId]);

  const locate = (target: string) => {
    const el = document.getElementById(target);
    if (!el) return;
    if (el.closest('.modal')) {
      el.scrollIntoView({ block: 'center' });
      (el as HTMLElement).focus?.();
      return;
    }
    // Page control: release the dialog first, then scroll + focus.
    onClose();
    window.setTimeout(() => {
      const pageEl = document.getElementById(target);
      if (!pageEl) return;
      pageEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      (pageEl as HTMLElement).focus?.();
    }, 60);
  };

  return (
    <Modal
      open={open}
      title={t('submit.check_title')}
      width={560}
      onClose={onClose}
      footer={
        <button type="button" className="btn" onClick={onClose}>
          {t('common.ok')}
        </button>
      }
    >
      <div className="submit-panel">
        <div className="submit-settings">
          <div className="figures-field">
            <label className="figures-label" htmlFor="submit-target">
              {t('submit.target')}
            </label>
            <select
              id="submit-target"
              className="input"
              value={targetId}
              onChange={(e) => onTargetChange(e.target.value as SubmissionTargetId)}
            >
              {(Object.keys(SUBMISSION_TARGETS) as SubmissionTargetId[]).map((id) => (
                <option key={id} value={id}>
                  {SUBMISSION_TARGETS[id].name}
                </option>
              ))}
            </select>
          </div>
          <div className="figures-field">
            <label className="figures-label" htmlFor="submit-export-format">
              {t('submit.format')}
            </label>
            <select
              id="submit-export-format"
              className="input"
              value={settings.format}
              onChange={(e) =>
                onSettingsChange({ format: e.target.value as FigureExportFormat })
              }
            >
              <option value="svg">SVG</option>
              <option value="pdf">PDF</option>
              <option value="png600">PNG (600 dpi)</option>
            </select>
          </div>
          <div className="figures-field figures-field-small">
            <label className="figures-label" htmlFor="submit-export-dpi">
              {t('submit.dpi')}
            </label>
            <input
              id="submit-export-dpi"
              type="number"
              min={1}
              className="input"
              value={settings.rasterDpi}
              onChange={(e) =>
                onSettingsChange({ rasterDpi: Math.max(1, Number(e.target.value) || 0) })
              }
            />
          </div>
          <div className="figures-field">
            <label className="figures-label" htmlFor="submit-color-mode">
              {t('submit.color_mode')}
            </label>
            <select
              id="submit-color-mode"
              className="input"
              value={settings.colorMode}
              onChange={(e) =>
                onSettingsChange({ colorMode: e.target.value as 'rgb' | 'cmyk' })
              }
            >
              <option value="rgb">RGB</option>
              <option value="cmyk">CMYK</option>
            </select>
          </div>
          <div className="figures-field">
            <label className="figures-label" htmlFor="submit-font-embed">
              {t('submit.font_embed')}
            </label>
            <input
              id="submit-font-embed"
              type="checkbox"
              className="submit-font-embed"
              checked={settings.fontEmbedded}
              onChange={(e) => onSettingsChange({ fontEmbedded: e.target.checked })}
            />
          </div>
        </div>

        <p className="submit-summary">
          {result.passed
            ? t('submit.all_passed')
            : t('submit.summary', { total: result.total, failed: result.failedCount })}
        </p>

        {GROUP_ORDER.map((group) => {
          const items = result.groups.find((g) => g.group === group)?.items ?? [];
          return (
            <section key={group} className="submit-group">
              <h3 className="submit-group-title">{t(`submit.group.${group}`)}</h3>
              <ul className="submit-list">
                {items.map((item) => (
                  <li
                    key={item.id}
                    className={`submit-item ${item.passed ? 'submit-item-ok' : 'submit-item-fail'}`}
                  >
                    <div className="submit-item-head">
                      <span className={`tag ${item.passed ? 'tag-success' : 'tag-error'}`}>
                        {item.passed ? t('submit.passed') : t('submit.failed')}
                      </span>
                      <span className="submit-item-label">{t(item.labelKey)}</span>
                    </div>
                    {!item.passed && (
                      <div className="submit-item-body">
                        <p className="submit-item-message">
                          {t(item.messageKey, item.params)}
                        </p>
                        <p className="submit-item-fix">{t(item.fixKey, item.params)}</p>
                        <button
                          type="button"
                          className="btn btn-sm"
                          onClick={() => locate(item.focusTarget)}
                        >
                          {t('submit.locate')}
                        </button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </Modal>
  );
}
