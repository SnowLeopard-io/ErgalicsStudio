import { LOCALES, useLocale, useT } from '@/i18n';
import { Dropdown } from './Dropdown';

export function LanguageSwitcher() {
  const { locale, setLocale } = useLocale();
  const t = useT();

  const current = LOCALES.find((l) => l.code === locale);

  return (
    <Dropdown
      ariaLabel={t('settings.language')}
      trigger={<span title={t('settings.language')}>{current?.label}</span>}
      items={LOCALES.map((l) => ({
        key: l.code,
        label: l.label,
        active: l.code === locale,
        onClick: () => setLocale(l.code),
      }))}
    />
  );
}