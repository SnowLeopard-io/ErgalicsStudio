import { LOCALES, useLocale, useT } from '@/i18n';
import { Dropdown } from './Dropdown';

export function LanguageSwitcher() {
  const { locale, setLocale } = useLocale();
  const t = useT();

  return (
    <Dropdown
      ariaLabel={t('settings.language')}
      trigger={
        <span className="lang-icon" title={t('settings.language')}>
          <svg
            viewBox="0 0 24 24"
            width="15"
            height="15"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="9" />
            <path d="M3 12h18" />
            <path d="M12 3c2.6 2.4 4 5.5 4 9s-1.4 6.6-4 9c-2.6-2.4-4-5.5-4-9s1.4-6.6 4-9z" />
          </svg>
        </span>
      }
      items={LOCALES.map((l) => ({
        key: l.code,
        label: l.label,
        active: l.code === locale,
        onClick: () => setLocale(l.code),
      }))}
    />
  );
}