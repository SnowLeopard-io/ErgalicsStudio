import { useT } from '@/i18n';
import { useAppStore } from '@/stores/appStore';

export function BannerStack() {
  const banners = useAppStore((s) => s.banners);
  const removeBanner = useAppStore((s) => s.removeBanner);
  const t = useT();

  if (banners.length === 0) return null;

  return (
    <div className="banner-stack">
      {banners.map((b) => (
        <div key={b.id} className={`banner banner-${b.kind}`} role="alert">
          <span>{t(b.messageKey)}</span>
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