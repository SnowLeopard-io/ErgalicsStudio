import { useT } from '@/i18n';
import { useTheme, type ThemePreference } from '@/theme';
import { Dropdown } from './Dropdown';

export function ThemeSwitcher() {
  const { preference, setPreference } = useTheme();
  const t = useT();

  const labels: Record<ThemePreference, string> = {
    light: t('settings.theme_light'),
    dark: t('settings.theme_dark'),
    system: t('settings.theme_system'),
  };

  const items: { key: ThemePreference; label: string }[] = [
    { key: 'light', label: labels.light },
    { key: 'dark', label: labels.dark },
    { key: 'system', label: labels.system },
  ];

  const icon = preference === 'dark' ? '◐' : preference === 'light' ? '☀' : '◑';

  return (
    <Dropdown
      ariaLabel={t('settings.theme')}
      trigger={<span title={t('settings.theme')}>{icon}</span>}
      items={items.map((i) => ({
        key: i.key,
        label: i.label,
        active: i.key === preference,
        onClick: () => setPreference(i.key as ThemePreference),
      }))}
    />
  );
}