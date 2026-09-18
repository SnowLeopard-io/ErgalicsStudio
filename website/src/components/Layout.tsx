import { useEffect, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { useLocale, useT } from '../i18n-react';
import { studioUrl, docsUrl } from '../studio-link';

type Theme = 'dark' | 'light';

function applyTheme(t: Theme) {
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem('ergalics-website:theme', t); } catch { /* ignore */ }
}

export function Layout({ children }: { children: React.ReactNode }) {
  const t = useT();
  const { locale, setLocale } = useLocale();
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      const saved = localStorage.getItem('ergalics-website:theme');
      if (saved === 'dark' || saved === 'light') return saved;
    } catch { /* ignore */ }
    return 'dark';
  });
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();

  useEffect(() => { applyTheme(theme); }, [theme]);
  useEffect(() => { setMenuOpen(false); window.scrollTo(0, 0); }, [location.pathname]);

  const nav = [
    { to: '/gallery', label: t('nav.gallery') },
    { to: '/themes', label: t('nav.themes') },
    { to: '/plugins', label: t('nav.plugins') },
  ];

  return (
    <div className="site">
      <header className="site-header">
        <div className="header-inner">
          <Link to="/" className="brand" aria-label="Ergalics Studio home">
            <img
              className="brand-mark"
              src="./ico.ico"
              alt=""
              width={22}
              height={22}
              aria-hidden="true"
            />
            <span className="brand-name">Ergalics Studio</span>
          </Link>
          <nav className={`site-nav${menuOpen ? ' open' : ''}`} aria-label="Primary">
            {nav.map((n) => (
              <NavLink key={n.to} to={n.to} className={({ isActive }) => (isActive ? 'active' : '')}>
                {n.label}
              </NavLink>
            ))}
            <a href={docsUrl('/guide/introduction')} className="nav-docs">{t('nav.docs')}</a>
            <a href={studioUrl('/')} className="nav-studio">{t('nav.enter')}</a>
          </nav>
          <div className="header-actions">
            <button
              className="icon-btn"
              aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            >
              {theme === 'dark' ? (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" /></svg>
              )}
            </button>
            <button
              className="lang-btn"
              aria-label="Switch language"
              onClick={() => setLocale(locale === 'zh-CN' ? 'en-US' : 'zh-CN')}
            >
              {locale === 'zh-CN' ? 'EN' : '中'}
            </button>
            <a href={studioUrl('/')} className="btn btn-primary header-cta">{t('nav.enter')}</a>
            <button
              className={`icon-btn menu-btn${menuOpen ? ' open' : ''}`}
              aria-label="Toggle menu"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen(!menuOpen)}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
            </button>
          </div>
        </div>
      </header>
      <main className="site-main">{children}</main>
      <footer className="site-footer">
        <div className="footer-inner">
          <div>
            <div className="brand-name footer-brand">Ergalics Studio</div>
            <p className="footer-tagline">{t('footer.tagline')}</p>
          </div>
          <div className="footer-links">
            <div className="footer-heading">{t('footer.links')}</div>
            <a href={studioUrl('/')}>{t('nav.enter')}</a>
            <a href={docsUrl('/guide/introduction')} target="_blank" rel="noreferrer">{t('nav.docs')}</a>
            <a href="https://github.com/SnowLeopard-io/ErgalicsStudio" target="_blank" rel="noreferrer">GitHub</a>
            <a href="https://gitee.com/cnt-code/ergalics-studio" target="_blank" rel="noreferrer">Gitee</a>
          </div>
        </div>
        <div className="footer-bottom">
          <span>© 2026 SnowLeopard-io · {t('footer.license')}</span>
        </div>
      </footer>
    </div>
  );
}
