// ==========================================================================
// Ergalics Studio — caption generator (FR-03)
//
// Drafts a figure caption from the sheet's chart type, data column names and
// (when derivable) a statistical result, using core/submit/caption. The draft
// is previewed in an editable textarea and applied to the sheet on confirm.
// Default language follows the active UI locale; the user can override it.
// ==========================================================================

import { useEffect, useMemo, useState } from 'react';
import { Modal } from '@/components/Modal';
import { useT, useLocale } from '@/i18n';
import { draftCaption, deriveStatsFromPanels } from '@/core/submit/caption';
import type { NarrativeLang } from '@/core/stats/narrative';
import type { FigurePanel } from '@/core/figure/compose';
import type { ChartKind } from '@/core/plot';

interface CaptionGeneratorModalProps {
  open: boolean;
  onClose: () => void;
  panels: FigurePanel[];
  currentCaption: string;
  onApply: (caption: string) => void;
}

/** Column names backing a panel: x label, y label, series name. */
function panelColumns(panel: FigurePanel): string[] {
  const cols: string[] = [];
  if (panel.spec.xLabel) cols.push(panel.spec.xLabel);
  if (panel.spec.yLabel) cols.push(panel.spec.yLabel);
  const name = panel.spec.series[0]?.name;
  if (name && !cols.includes(name)) cols.push(name);
  return cols;
}

export function CaptionGeneratorModal({
  open,
  onClose,
  panels,
  currentCaption,
  onApply,
}: CaptionGeneratorModalProps) {
  const t = useT();
  const { locale } = useLocale();
  const defaultLang: NarrativeLang = locale === 'en-US' ? 'en-US' : 'zh-CN';

  const [lang, setLang] = useState<NarrativeLang>(defaultLang);
  const [text, setText] = useState('');

  const first = panels[0] ?? null;
  const chartType = (first?.spec.series[0]?.kind as ChartKind | undefined) ?? 'line';
  const stats = useMemo(() => deriveStatsFromPanels(panels), [panels]);

  const draft = () => {
    const columns = first ? panelColumns(first) : [];
    setText(draftCaption({ chartType, columns, stats, lang }));
  };

  // Opening resets the draft language to the UI locale (FR-03 default).
  useEffect(() => {
    if (open) setLang(defaultLang);
  }, [open, defaultLang]);

  // Fresh draft whenever the dialog opens or the language is switched.
  useEffect(() => {
    if (!open) return;
    const columns = first ? panelColumns(first) : [];
    setText(draftCaption({ chartType, columns, stats, lang }));
  }, [open, lang, chartType, stats, first]);

  const hasStats = stats !== null;

  return (
    <Modal
      open={open}
      title={t('submit.caption_title')}
      width={520}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="button" className="btn" onClick={draft}>
            {t('submit.caption_redraft')}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={text.trim().length === 0}
            onClick={() => {
              onApply(text);
              onClose();
            }}
          >
            {t('submit.caption_apply')}
          </button>
        </>
      }
    >
      <div className="submit-caption-gen">
        <div className="figures-field">
          <label className="figures-label" htmlFor="submit-caption-lang">
            {t('submit.caption_lang')}
          </label>
          <select
            id="submit-caption-lang"
            className="input"
            value={lang}
            onChange={(e) => setLang(e.target.value as NarrativeLang)}
          >
            <option value="zh-CN">中文</option>
            <option value="en-US">English</option>
          </select>
        </div>
        {!hasStats && <p className="submit-item-fix">{t('submit.caption_no_stats')}</p>}
        <div className="figures-field">
          <label className="figures-label" htmlFor="submit-caption-preview">
            {t('submit.caption_draft')}
          </label>
          <textarea
            id="submit-caption-preview"
            className="input figures-caption"
            rows={4}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </div>
        {currentCaption.trim().length > 0 && (
          <p className="figures-field-hint">{currentCaption}</p>
        )}
      </div>
    </Modal>
  );
}
