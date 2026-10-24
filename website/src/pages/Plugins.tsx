import { useMemo, useState } from 'react';
import { useT } from '../i18n-react';
import { pickLocal } from '../i18n';
import { PLUGINS, type PluginCategory } from '../data/plugins';
import { studioAction } from '../studio-link';
import { buildCspkg } from '../cspkg-build';

const CATS: PluginCategory[] = ['scientific', 'fun', 'utility'];

export function Plugins() {
  const t = useT();
  const [query, setQuery] = useState('');
  const [cat, setCat] = useState<'all' | PluginCategory>('all');
  const [sort, setSort] = useState<'installs' | 'updated'>('installs');

  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    return PLUGINS
      .filter((p) => (cat === 'all' || p.category === cat))
      .filter((p) =>
        !q ||
        p.id.toLowerCase().includes(q) ||
        p.name.zh.toLowerCase().includes(q) ||
        p.name.en.toLowerCase().includes(q) ||
        p.tags.some((tag) => tag.includes(q)),
      )
      .sort((a, b) => (sort === 'installs' ? b.installs - a.installs : b.updatedAt.localeCompare(a.updatedAt)));
  }, [query, cat, sort]);

  // Download a real, signed, loadable .cspkg (ZIP) archive — the package is
  // namespaced under `market.` so it can never collide with a built-in id,
  // and signed with the website demo-publisher key the workstation trusts.
  const downloadCspkg = (id: string) => {
    const p = PLUGINS.find((x) => x.id === id)!;
    const blob = buildCspkg({
      id: p.id,
      name: pickLocal(p.name),
      version: p.version,
      author: p.author,
      description: pickLocal(p.desc),
    });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${p.id}.cspkg`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="page">
      <header className="page-head">
        <h1>{t('plugins.title')}</h1>
        <p>{t('plugins.desc')}</p>
      </header>

      <div className="plugin-toolbar">
        <input
          className="search-input"
          type="search"
          placeholder={t('plugins.search')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label={t('plugins.search')}
        />
        <div className="chips">
          <button className={`chip${cat === 'all' ? ' active' : ''}`} aria-pressed={cat === 'all'} onClick={() => setCat('all')}>
            {t('gallery.all')}
          </button>
          {CATS.map((c) => (
            <button key={c} className={`chip${cat === c ? ' active' : ''}`} aria-pressed={cat === c} onClick={() => setCat(c)}>
              {t(`plugins.cat.${c}`)}
            </button>
          ))}
        </div>
        <select className="sort-select" value={sort} onChange={(e) => setSort(e.target.value as 'installs' | 'updated')} aria-label="sort">
          <option value="installs">↓ installs</option>
          <option value="updated">↓ updated</option>
        </select>
      </div>

      {items.length === 0 ? (
        <div className="empty">{t('plugins.empty')}</div>
      ) : (
        <div className="plugin-grid">
          {items.map((p) => (
            <article key={p.id} className="plugin-card">
              <div className="plugin-head">
                <div className={`plugin-icon cat-${p.category}`} aria-hidden="true">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <path d="M9 3v4M15 3v4M6 7h12v5a6 6 0 0 1-12 0ZM12 18v3" />
                  </svg>
                </div>
                <div>
                  <h3>{pickLocal(p.name)}</h3>
                  <span className="muted">{p.id} · v{p.version}</span>
                </div>
              </div>
              <p className="plugin-desc">{pickLocal(p.desc)}</p>
              <div className="card-tags">
                <span className={`tag cat-${p.category}`}>{t(`plugins.cat.${p.category}`)}</span>
                {p.tags.slice(0, 3).map((tg) => <span key={tg} className="tag">{tg}</span>)}
                <span className={`tag sign ${p.signed ? 'ok' : 'warn'}`}>{p.signed ? `✓ ${t('plugins.signed')}` : '⚠ unsigned'}</span>
              </div>
              <div className="card-foot">
                <span className="muted">
                  {t('plugins.author')}: {p.author} · {t('plugins.installs', { n: p.installs.toLocaleString() })} · {p.sizeKb} KB
                </span>
                <div className="plugin-actions">
                  <button className="btn btn-sm btn-ghost" onClick={() => downloadCspkg(p.id)}>{t('plugins.download')}</button>
                  <a className="btn btn-sm btn-primary" href={studioAction('plugin', p.id)}>{t('plugins.install')}</a>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
