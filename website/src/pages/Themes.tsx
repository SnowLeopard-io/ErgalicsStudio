import { useT } from '../i18n-react';
import { pickLocal } from '../i18n';
import { THEMES } from '../data/themes';
import { studioAction } from '../studio-link';

export function Themes() {
  const t = useT();
  return (
    <div className="page">
      <header className="page-head">
        <h1>{t('themes.title')}</h1>
        <p>{t('themes.desc')}</p>
      </header>
      <div className="theme-grid">
        {THEMES.map((th) => (
          <article key={th.id} className="theme-card" style={th.vars as React.CSSProperties}>
            <div className={`theme-preview ${th.base}`} data-theme-scope={th.base}>
              <div className="tp-bar">
                <i style={{ background: th.chartPalette[0] }} />
                <i style={{ background: th.chartPalette[1] }} />
                <i style={{ background: th.chartPalette[2] }} />
              </div>
              <div className="tp-body">
                <div className="tp-title" style={{ color: th.vars['--color-text-primary'] ?? 'var(--color-text-primary)' }}>
                  {pickLocal(th.name)}
                </div>
                <div className="tp-lines">
                  <span style={{ background: th.vars['--color-text-secondary'] ?? 'var(--color-text-secondary)' }} />
                  <span style={{ background: th.vars['--color-text-secondary'] ?? 'var(--color-text-secondary)', width: '70%' }} />
                </div>
                <svg viewBox="0 0 100 34" className="tp-chart" aria-hidden="true">
                  <path d="M2 28 C 20 24, 30 8, 50 14 S 84 26, 98 6" fill="none" stroke={th.chartPalette[0]} strokeWidth="2" />
                  <path d="M2 30 C 24 27, 38 16, 56 19 S 86 29, 98 14" fill="none" stroke={th.chartPalette[1]} strokeWidth="1.4" opacity="0.7" />
                  <rect x="6" y="20" width="7" height="12" fill={th.chartPalette[2]} opacity="0.5" />
                  <rect x="20" y="14" width="7" height="18" fill={th.chartPalette[2]} opacity="0.5" />
                  <rect x="34" y="24" width="7" height="8" fill={th.chartPalette[3] ?? th.chartPalette[0]} opacity="0.5" />
                </svg>
                <div className="tp-palette">
                  {th.chartPalette.map((c) => <i key={c} style={{ background: c }} />)}
                </div>
              </div>
            </div>
            <div className="card-body">
              <div className="card-tags">
                <span className="tag">{th.base === 'dark' ? t('themes.dark') : t('themes.light')}</span>
                <span className="tag chart">.cstheme</span>
                <span className="tag">{th.version}</span>
              </div>
              <h3>{pickLocal(th.name)}</h3>
              <p>{pickLocal(th.desc)}</p>
              <div className="card-foot">
                <span className="muted">{t('common.by', { name: th.author })} · ⬇ {th.downloads}</span>
                <a className="btn btn-sm btn-primary" href={studioAction('theme', th.id)}>{t('themes.apply')}</a>
              </div>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
