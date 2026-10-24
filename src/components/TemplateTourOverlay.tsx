// ==========================================================================
// FR-01 — Template guided-tour overlay
//
// Appears top-right after a subject template loads. Closeable, with
// prev/next stepping and a progress indicator. Step text comes from the
// catalog's embedded bilingual payload (not global i18n); chrome strings
// use `tpl.*` keys and follow the current locale.
// ==========================================================================

import { useNavigate } from 'react-router-dom';
import { useLocale, useT } from '@/i18n';
import { getTemplate, pickLocale } from '@/core/templates';
import { useTemplateTourStore } from '@/stores/templateTourStore';
import { CloseIcon, ArrowLeftIcon, ArrowRightIcon } from '@/components/icons';

export function TemplateTourOverlay() {
  const t = useT();
  const { locale } = useLocale();
  const navigate = useNavigate();
  const open = useTemplateTourStore((s) => s.open);
  const templateId = useTemplateTourStore((s) => s.templateId);
  const step = useTemplateTourStore((s) => s.step);
  const next = useTemplateTourStore((s) => s.next);
  const prev = useTemplateTourStore((s) => s.prev);
  const close = useTemplateTourStore((s) => s.close);

  if (!open || !templateId) return null;
  const tpl = getTemplate(templateId);
  if (!tpl) return null;

  const total = tpl.steps.length;
  const current = tpl.steps[Math.min(step, total - 1)]!;
  const isLast = step >= total - 1;

  return (
    <aside className="template-tour" role="dialog" aria-label={t('tpl.tour.title')}>
      <header className="template-tour-head">
        <span className="template-tour-brand">{pickLocale(tpl.title, locale)}</span>
        <button
          type="button"
          className="icon-btn"
          aria-label={t('tpl.tour.close')}
          title={t('tpl.tour.close')}
          onClick={close}
        >
          <CloseIcon size={14} />
        </button>
      </header>
      <div className="template-tour-body">
        <h3 className="template-tour-step-title">{pickLocale(current.title, locale)}</h3>
        <p className="template-tour-step-body">{pickLocale(current.body, locale)}</p>
        {current.toolRoute && (
          <button
            type="button"
            className="btn btn-sm template-tour-goto"
            onClick={() => {
              navigate(current.toolRoute!);
            }}
          >
            {t('tpl.tour.open_step')} <ArrowRightIcon size={12} />
          </button>
        )}
      </div>
      <footer className="template-tour-foot">
        <span className="template-tour-progress">
          {t('tpl.tour.progress', { n: step + 1, total })}
        </span>
        <span className="template-tour-dots" aria-hidden="true">
          {tpl.steps.map((s, i) => (
            <span key={s.title.en} className={`template-tour-dot${i === step ? ' is-active' : ''}`} />
          ))}
        </span>
        <span className="template-tour-actions">
          <button
            type="button"
            className="btn btn-sm"
            onClick={prev}
            disabled={step === 0}
          >
            <ArrowLeftIcon size={12} /> {t('tpl.tour.prev')}
          </button>
          {isLast ? (
            <button type="button" className="btn btn-sm btn-primary" onClick={close}>
              {t('tpl.tour.done')}
            </button>
          ) : (
            <button type="button" className="btn btn-sm btn-primary" onClick={next}>
              {t('tpl.tour.next')} <ArrowRightIcon size={12} />
            </button>
          )}
        </span>
      </footer>
    </aside>
  );
}
