import { useT } from '@/i18n';
import { siteUrl, docsUrl } from '@/core/site-links';

/**
 * Persistent cross-site switcher, rendered once in the app shell so a user can
 * hop to the official website or the docs at any point while working, not just
 * on the welcome screen. Mirrors the floating switcher on the docs site so all
 * three properties look and behave the same. In production all three share one
 * origin (GitHub Pages); in dev they fall back to each workspace's fixed port.
 */
export function CrossSiteSwitcher() {
  const t = useT();
  return (
    <nav className="cross-site-switcher" aria-label={t('sites.label')}>
      <span className="csw-label">{t('sites.label')}</span>
      <a className="csw-link" href={siteUrl()} target="_blank" rel="noreferrer">
        {t('sites.website')}
      </a>
      <a className="csw-link" href={docsUrl()} target="_blank" rel="noreferrer">
        {t('sites.docs')}
      </a>
      <span className="csw-link is-current">{t('sites.studio')}</span>
    </nav>
  );
}