import { useT } from '../i18n-react';
import { pickLocal } from '../i18n';
import { TECH_DOC_GROUPS, type DocFormat } from '../data/techdocs';

// Static documents are copied from docs/technical into public/technical at
// build time, so they sit next to the site bundle. Filenames contain spaces
// and Chinese characters — encode the whole name. The site uses HashRouter,
// so page-relative URLs resolve against the site root in both dev and prod.
function docUrl(file: string): string {
  return `${import.meta.env.BASE_URL}technical/${encodeURIComponent(file)}`;
}

/** Per-format link props: PDF/MD download, HTML opens for online reading. */
function fmtLink(format: DocFormat, file: string) {
  const href = docUrl(file);
  if (format === 'html') return { href, target: '_blank' as const, rel: 'noreferrer' as const };
  return { href, download: true };
}

function fmtLabel(format: DocFormat): string {
  if (format === 'pdf') return 'PDF';
  if (format === 'html') return 'HTML';
  return 'MD';
}

function fmtGlyph(format: DocFormat): string {
  if (format === 'html') return '↗';
  return '⬇';
}

export function Downloads() {
  const t = useT();
  return (
    <div className="page">
      <header className="page-head">
        <h1>{t('downloads.title')}</h1>
        <p>{t('downloads.desc')}</p>
      </header>
      {TECH_DOC_GROUPS.map((group) => (
        <section key={group.id} className="dl-group">
          <h2>{pickLocal(group.title)}</h2>
          <p className="muted">{pickLocal(group.desc)}</p>
          <div className="dl-grid">
            {group.docs.map((doc) => {
              const base = doc.file.replace(/\.(md|html|pdf)$/i, '');
              return (
                <article key={doc.file} className="doc-card">
                  <div className="card-tags">
                    {doc.formats.map((f) => (
                      <span key={f} className="tag">{f.toUpperCase()}</span>
                    ))}
                  </div>
                  <h3>{pickLocal(doc.title)}</h3>
                  <p>{pickLocal(doc.desc)}</p>
                  <div className="card-foot dl-actions">
                    {doc.formats.map((f) => (
                      <a
                        key={f}
                        className="btn btn-sm btn-ghost dl-btn"
                        {...fmtLink(f, `${base}.${f}`)}
                        aria-label={`${fmtLabel(f)} · ${pickLocal(doc.title)}`}
                      >
                        {fmtGlyph(f)} {fmtLabel(f)}
                      </a>
                    ))}
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
