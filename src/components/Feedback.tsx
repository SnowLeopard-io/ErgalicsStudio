import { useT } from '@/i18n';
import { useAppStore } from '@/stores/appStore';
import { usePluginStore } from '@/stores/pluginStore';

export function BannerStack() {
  const banners = useAppStore((s) => s.banners);
  const removeBanner = useAppStore((s) => s.removeBanner);
  const registry = usePluginStore((s) => s.registry);
  const t = useT();

  if (banners.length === 0) return null;

  const pluginName = (id?: string) => {
    if (!id) return '';
    return registry.find((e) => e.id === id)?.name ?? id;
  };

  return (
    <div className="banner-stack">
      {banners.map((b) => (
        <div key={b.id} className={`banner banner-${b.kind}`} role="alert">
          <span>{t(b.messageKey)}{b.pluginId ? ` · ${pluginName(b.pluginId)}` : ''}</span>
          {b.dismissible && (
            <div className="banner-actions">
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => removeBanner(b.id)}>
                {t('common.close')}
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export function ToastStack() {
  const notifications = useAppStore((s) => s.notifications);
  const dismiss = useAppStore((s) => s.dismissNotification);

  return (
    <div className="toast-stack">
      {notifications.map((n) => (
        <div key={n.id} className={`toast toast-${n.kind}`} onClick={() => dismiss(n.id)}>
          {n.message}
        </div>
      ))}
    </div>
  );
}