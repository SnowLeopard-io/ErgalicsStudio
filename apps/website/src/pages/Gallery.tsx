import { useMemo, useState } from 'react';
import { useT } from '../i18n-react';
import { pickLocal } from '../i18n';
import { GALLERY, SUBJECTS, CHART_TYPES, type ReproStatus } from '../data/gallery';
import { CoverArt } from '../components/CoverArt';
import { studioAction, studioUrl } from '../studio-link';

export function Gallery() {
  const t = useT();
  const [subject, setSubject] = useState<string>('all');
  const [chart, setChart] = useState<string>('all');
  const [repro, setRepro] = useState<string>('all');

  const items = useMemo(
    () =>
      GALLERY.filter(
        (g) =>
          (subject === 'all' || g.subject === subject) &&
          (chart === 'all' || g.chartType === chart) &&
          (repro === 'all' || g.repro === repro),
      ),
    [subject, chart, repro],
  );

  const reproLabel = (r: ReproStatus) =>
    r === 'ok' ? t('gallery.repro.ok') : r === 'partial' ? t('gallery.repro.partial') : t('gallery.repro.none');

  return (
    <div className="page">
      <header className="page-head">
        <h1>{t('gallery.title')}</h1>
        <p>{t('gallery.desc')}</p>
      </header>

      <div className="filters">
        <FilterGroup label={t('gallery.filter.subject')} value={subject} onChange={setSubject}
          options={[['all', t('gallery.all')], ...SUBJECTS.map((s) => [s, s] as const)]} />
        <FilterGroup label={t('gallery.filter.chart')} value={chart} onChange={setChart}
          options={[['all', t('gallery.all')], ...CHART_TYPES.map((c) => [c, c] as const)]} />
        <FilterGroup label={t('gallery.filter.repro')} value={repro} onChange={setRepro}
          options={[['all', t('gallery.all')], ['ok', t('gallery.repro.ok')], ['partial', t('gallery.repro.partial')]]} />
      </div>

      {items.length === 0 ? (
        <div className="empty">{t('gallery.empty')}</div>
      ) : (
        <div className="gallery-grid">
          {items.map((g) => (
            <article key={g.id} className="gallery-card">
              <CoverArt seed={g.seed} chartType={g.chartType} />
              <div className="card-body">
                <div className="card-tags">
                  <span className="tag">{g.subject}</span>
                  <span className="tag chart">{g.chartType}</span>
                  <span className={`repro-badge repro-${g.repro}`}>{reproLabel(g.repro)}</span>
                </div>
                <h3>{pickLocal(g.title)}</h3>
                <p>{pickLocal(g.summary)}</p>
                <div className="card-foot">
                  <span className="muted">{t('common.by', { name: g.author })} · {g.updatedAt}</span>
                  <a className="btn btn-sm btn-primary" href={g.template ? studioAction('gallery', g.id) : studioUrl(g.studioRoute)}>
                    {t('gallery.open')}
                  </a>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

function FilterGroup({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void; options: readonly (readonly [string, string])[];
}) {
  return (
    <div className="filter-group" role="group" aria-label={label}>
      <span className="filter-label">{label}</span>
      <div className="chips">
        {options.map(([v, l]) => (
          <button key={v} className={`chip${value === v ? ' active' : ''}`} aria-pressed={value === v} onClick={() => onChange(v)}>
            {l}
          </button>
        ))}
      </div>
    </div>
  );
}
