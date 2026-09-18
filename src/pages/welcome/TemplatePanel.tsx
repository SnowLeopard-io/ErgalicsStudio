// ==========================================================================
// FR-01 — Welcome-page subject template browser
//
// Modal panel over the template catalog: subject filter chips + search +
// cards (subject / difficulty / estimated minutes / tool icons). Picking a
// card loads the template project and routes to its first concrete tool
// step; the guided-tour overlay then appears top-right.
// ==========================================================================

import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLocale, useT } from '@/i18n';
import { Modal } from '@/components/Modal';
import { SearchIcon, ClockIcon, ToolIcon } from '@/components/icons';
import { getTool } from '@/pages/research/toolRegistry';
import {
  SUBJECT_TEMPLATES,
  loadTemplate,
  pickLocale,
  type SubjectTemplate,
  type TemplateSubject,
} from '@/core/templates';
import { useAppStore } from '@/stores/appStore';

const SUBJECTS: TemplateSubject[] = [
  'physics',
  'biology',
  'astronomy',
  'engineering',
  'chemistry',
  'geoscience',
  'medicine',
  'mathematics',
];

export function TemplatePanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const { locale } = useLocale();
  const navigate = useNavigate();
  const notify = useAppStore((s) => s.notify);
  const [subject, setSubject] = useState<TemplateSubject | 'all'>('all');
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const q = query.trim().toLowerCase();
  const items = useMemo(
    () =>
      SUBJECT_TEMPLATES.filter((tpl) => {
        if (subject !== 'all' && tpl.subject !== subject) return false;
        if (!q) return true;
        return (
          tpl.id.includes(q) ||
          tpl.title.zh.toLowerCase().includes(q) ||
          tpl.title.en.toLowerCase().includes(q) ||
          tpl.summary.zh.toLowerCase().includes(q) ||
          tpl.summary.en.toLowerCase().includes(q)
        );
      }),
    [subject, q],
  );

  const use = async (tpl: SubjectTemplate) => {
    if (busy) return;
    setBusy(tpl.id);
    try {
      const result = await loadTemplate(tpl.id);
      if (result.ok) {
        onClose();
        navigate(result.route);
      } else {
        notify('error', `${t('tpl.load_failed')}: ${tpl.id}`);
      }
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={t('tpl.browse_title')} width={860}>
      <p className="template-panel-desc">{t('tpl.browse_desc')}</p>
      <div className="template-panel-toolbar">
        <div className="chips template-subject-chips" role="group" aria-label={t('tpl.filter.all')}>
          <button
            type="button"
            className={`chip${subject === 'all' ? ' is-active' : ''}`}
            onClick={() => setSubject('all')}
          >
            {t('tpl.filter.all')}
          </button>
          {SUBJECTS.map((s) => (
            <button
              key={s}
              type="button"
              className={`chip${subject === s ? ' is-active' : ''}`}
              onClick={() => setSubject(s)}
            >
              {t(`tpl.subject.${s}`)}
            </button>
          ))}
        </div>
        <div className="menu-filter template-search">
          <SearchIcon size={13} />
          <input
            className="menu-filter-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('tpl.search_placeholder')}
            aria-label={t('tpl.search_placeholder')}
          />
        </div>
      </div>

      {items.length === 0 && <div className="empty-hint">{t('tpl.empty')}</div>}

      <div className="template-grid">
        {items.map((tpl) => (
          <article key={tpl.id} className="template-card card">
            <div className="template-card-tags">
              <span className="tag tag-primary">{t(`tpl.subject.${tpl.subject}`)}</span>
              <span className="tag tag-muted">{t(`tpl.difficulty.${tpl.difficulty}`)}</span>
              <span className="template-card-minutes">
                <ClockIcon size={12} /> {t('tpl.minutes', { n: tpl.minutes })}
              </span>
            </div>
            <h3 className="template-card-title">{pickLocale(tpl.title, locale)}</h3>
            <p className="template-card-summary">{pickLocale(tpl.summary, locale)}</p>
            <div className="template-card-tools" title={t('tpl.tools')}>
              {tpl.tools.map((id) => {
                const toolDef = getTool(id);
                return (
                  <span
                    key={id}
                    className="template-card-tool"
                    title={toolDef ? t(toolDef.titleKey) : id}
                  >
                    {toolDef ? <ToolIcon kind={toolDef.icon} size={14} /> : <span className="tag tag-muted">{id}</span>}
                  </span>
                );
              })}
            </div>
            <div className="template-card-foot">
              <button
                type="button"
                className="btn btn-sm btn-primary"
                onClick={() => void use(tpl)}
                disabled={busy !== null}
              >
                {busy === tpl.id ? t('tpl.loading') : t('tpl.open')}
              </button>
            </div>
          </article>
        ))}
      </div>
    </Modal>
  );
}
