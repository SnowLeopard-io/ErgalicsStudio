import { useNavigate, useParams } from 'react-router-dom';
import { useT } from '@/i18n';
import { usePluginStore } from '@/stores/pluginStore';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { ThemeSwitcher } from '@/components/ThemeSwitcher';

/**
 * Plugin-registered route page (spec §2.1, route `/plugin/:pluginId`).
 * Plugins may render an independent full-page view here.
 */
export default function PluginViewPage() {
  const t = useT();
  const { pluginId } = useParams<{ pluginId: string }>();
  const navigate = useNavigate();
  const entry = usePluginStore((s) => s.registry.find((e) => e.id === pluginId));

  return (
    <div className="plugin-view">
      <header className="topbar">
        <button type="button" className="icon-btn" onClick={() => navigate('/workbench')}>
          ←
        </button>
        <span className="brand-name">{entry?.name ?? pluginId ?? t('common.unknown')}</span>
        <div className="topbar-actions">
          <LanguageSwitcher />
          <ThemeSwitcher />
        </div>
      </header>
      <main className="plugin-view-body">
        {entry?.plugin ? (
          <div className="plugin-view-placeholder">
            <p>{t('plugin.title')}: {entry.name}</p>
            <p className="empty-hint">{t('workbench.right.no_plugin')}</p>
          </div>
        ) : (
          <div className="empty-hint">{t('plugin.no_plugins')}</div>
        )}
      </main>
    </div>
  );
}