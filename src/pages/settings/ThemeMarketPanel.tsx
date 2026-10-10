// FR-21 theme market — settings-page panel.
//
// Self-contained section: official themes (instant preview/apply), the
// marketplace catalog (install/uninstall/apply), custom .cstheme import and
// the chart-palette linkage note. All validation lives in core/theme-pack;
// this component only presents and wires user intent to it.
import { useEffect, useRef, useState } from 'react';
import { useT } from '@/i18n';
import { getLocale } from '@/i18n';
import { useAppStore } from '@/stores/appStore';
import { ThemeParseError, parseCsThemeJson, type CsTheme } from '@/core/theme-pack/schema';
import {
  getActiveTheme,
  subscribeThemePack,
  applyTheme,
  removeTheme,
} from '@/core/theme-pack/apply';
import {
  OFFICIAL_THEMES,
  listInstalledThemes,
  findThemeById,
  installTheme,
  uninstallTheme,
  getAppliedThemeId,
  applyAndRemember,
  clearAppliedTheme,
} from '@/core/theme-pack/registry';
import { MARKET_THEMES, findMarketEntry, websiteThemeLink } from '@/core/theme-pack/market';
import { Modal } from '@/components/Modal';

function PaletteSwatch({ colors }: { colors: readonly string[] }) {
  return (
    <span
      className="theme-palette-swatch"
      style={{ display: 'inline-flex', gap: 2, verticalAlign: 'middle' }}
      aria-hidden="true"
    >
      {colors.map((c) => (
        <i
          key={c}
          style={{ width: 10, height: 10, borderRadius: 2, background: c, display: 'inline-block' }}
        />
      ))}
    </span>
  );
}

export function ThemeMarketPanel() {
  const t = useT();
  const locale = getLocale();
  const notify = useAppStore((s) => s.notify);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [, forceRender] = useState(0);
  const [installed, setInstalled] = useState<CsTheme[]>(() => listInstalledThemes());
  const [previewTheme, setPreviewTheme] = useState<CsTheme | null>(null);
  const [uninstallTarget, setUninstallTarget] = useState<CsTheme | null>(null);

  // Re-render when the applied theme changes anywhere in the app.
  useEffect(() => subscribeThemePack(() => forceRender((n) => n + 1)), []);

  const active = getActiveTheme();
  const appliedId = previewTheme ? null : getAppliedThemeId();

  const refreshInstalled = () => setInstalled(listInstalledThemes());

  const doApply = (theme: CsTheme) => {
    setPreviewTheme(null);
    applyAndRemember(theme);
    notify('success', t('theme.apply_done', { name: displayName(theme) }));
  };

  const doRemove = () => {
    setPreviewTheme(null);
    clearAppliedTheme();
    notify('success', t('theme.remove_done'));
  };

  const doPreview = (theme: CsTheme) => {
    if (previewTheme?.id === theme.id) {
      // Exit preview: restore whatever was applied before (or the stock look).
      setPreviewTheme(null);
      const prevId = getAppliedThemeId();
      const prev = prevId ? findThemeById(prevId) : null;
      if (prev) applyTheme(prev);
      else removeTheme();
    } else {
      setPreviewTheme(theme);
      applyTheme(theme);
    }
  };

  const doInstallMarket = (entryId: string) => {
    const entry = findMarketEntry(entryId);
    if (!entry) return;
    try {
      installTheme(entry.theme);
      refreshInstalled();
      notify('success', t('theme.install_done', { name: entry.name[locale === 'en-US' ? 'en' : 'zh'] }));
    } catch (err) {
      notify('error', err instanceof Error ? err.message : String(err));
    }
  };

  const doUninstall = (theme: CsTheme) => {
    if (uninstallTheme(theme.id)) {
      if (getAppliedThemeId() === theme.id) clearAppliedTheme();
      refreshInstalled();
      notify('success', t('theme.uninstall_done', { name: displayName(theme) }));
    }
    setUninstallTarget(null);
  };

  const doImport = async (file: File) => {
    try {
      const text = await file.text();
      const theme = parseCsThemeJson(text);
      installTheme(theme);
      refreshInstalled();
      notify('success', t('theme.import_success', { name: theme.name }));
    } catch (err) {
      const detail =
        err instanceof ThemeParseError || err instanceof Error ? err.message : String(err);
      notify('error', t('theme.import_failed', { error: detail }));
    }
  };

  const pickLocal = (pair: { zh: string; en: string }) => (locale === 'en-US' ? pair.en : pair.zh);

  /**
   * CsTheme.name 是安装时固化的单语言字符串（官方/市场主题为英文），直接
   * 裸显会造成中英混排。市场目录自带双语 name/desc——按 id 或 officialId
   * 反查即可拿到；导入的自定义主题没有市场条目，退回原始 name。
   */
  const marketMetaOf = (themeId: string) =>
    MARKET_THEMES.find((e) => e.id === themeId || e.officialId === themeId);

  const displayName = (theme: CsTheme): string => {
    const meta = marketMetaOf(theme.id);
    return meta ? pickLocal(meta.name) : theme.name;
  };

  const installedIds = new Set(installed.map((i) => i.id));

  return (
    <section className="card settings-section">
      <h2 className="settings-section-title">{t('theme.section_title')}</h2>

      <div className="settings-row">
        <label className="settings-label">{t('theme.applied_label')}</label>
        <div className="settings-value">
          {active ? (
            <>
              {displayName(active)}
              {previewTheme && (
                <span className="sql-preview-note"> · {t('theme.previewing', { name: displayName(previewTheme) })}</span>
              )}
              {!previewTheme && <PaletteSwatch colors={active.chartPalette ?? []} />}
            </>
          ) : (
            t('theme.applied_none')
          )}
          {(active || previewTheme) && (
            <button type="button" className="btn" style={{ marginLeft: 8 }} onClick={doRemove}>
              {t('theme.remove_applied')}
            </button>
          )}
        </div>
      </div>

      <p className="settings-label">{t('theme.orthogonal_note')}</p>
      <p className="settings-label">{t('theme.chart_note')}</p>

      <h3 className="settings-section-title">{t('theme.official_title')}</h3>
      <div className="theme-grid">
        {OFFICIAL_THEMES.map((theme) => {
          const meta = marketMetaOf(theme.id);
          const applied = appliedId === theme.id;
          return (
            <div key={theme.id} className={`theme-card${applied ? ' is-applied' : ''}`}>
              <div className="theme-card-head">
                <span className="theme-card-name">{displayName(theme)}</span>
                {applied && <span className="tag">{t('theme.applied_badge')}</span>}
              </div>
              {meta && <p className="theme-card-desc">{pickLocal(meta.desc)}</p>}
              <div className="theme-card-meta">
                <span>
                  {t('theme.version')} {theme.version}
                </span>
                {theme.density && (
                  <span>
                    {t('theme.density')}: {t(`theme.density_${theme.density}`)}
                  </span>
                )}
                {theme.chartPalette && <PaletteSwatch colors={theme.chartPalette} />}
              </div>
              <div className="theme-card-actions">
                <button type="button" className="btn" onClick={() => doPreview(theme)}>
                  {previewTheme?.id === theme.id ? t('theme.preview_stop') : t('theme.preview')}
                </button>
                <button type="button" className="btn btn-primary" onClick={() => doApply(theme)}>
                  {t('theme.apply')}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <h3 className="settings-section-title">{t('theme.market_title')}</h3>
      <div className="theme-grid">
        {MARKET_THEMES.map((entry) => {
          const isInstalled = installedIds.has(entry.id) || Boolean(entry.officialId);
          const applied = !previewTheme && getAppliedThemeId() === entry.id;
          return (
            <div key={entry.id} className={`theme-card${applied ? ' is-applied' : ''}`}>
              <div className="theme-card-head">
                <span className="theme-card-name">{pickLocal(entry.name)}</span>
                {isInstalled && <span className="tag">{t('theme.installed_badge')}</span>}
              </div>
              <p className="theme-card-desc">{pickLocal(entry.desc)}</p>
              <div className="theme-card-meta">
                <span>{entry.author}</span>
                <span>
                  {t('theme.version')} {entry.version}
                </span>
                <span>⬇ {entry.downloads}</span>
                {entry.theme.chartPalette && <PaletteSwatch colors={entry.theme.chartPalette} />}
              </div>
              <div className="theme-card-actions">
                {!isInstalled && (
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => doInstallMarket(entry.id)}
                  >
                    {t('theme.install')}
                  </button>
                )}
                {isInstalled && (
                  <>
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => doApply(entry.theme)}
                    >
                      {t('theme.apply')}
                    </button>
                    {!entry.officialId && (
                      <button
                        type="button"
                        className="btn btn-danger"
                        onClick={() => setUninstallTarget(entry.theme)}
                      >
                        {t('theme.uninstall')}
                      </button>
                    )}
                  </>
                )}
                <a className="btn" href={websiteThemeLink(entry.id)} target="_blank" rel="noreferrer">
                  {t('theme.view_on_website')}
                </a>
              </div>
            </div>
          );
        })}
      </div>

      {installed.length > 0 && (
        <>
          <h3 className="settings-section-title">{t('theme.installed_title')}</h3>
          <div className="theme-grid">
            {installed.map((theme) => {
              const applied = appliedId === theme.id;
              return (
                <div key={theme.id} className={`theme-card${applied ? ' is-applied' : ''}`}>
                  <div className="theme-card-head">
                    <span className="theme-card-name">{displayName(theme)}</span>
                    {applied && <span className="tag">{t('theme.applied_badge')}</span>}
                  </div>
                  <div className="theme-card-meta">
                    <span>
                      {t('theme.version')} {theme.version}
                    </span>
                    {theme.chartPalette && <PaletteSwatch colors={theme.chartPalette} />}
                  </div>
                  <div className="theme-card-actions">
                    <button type="button" className="btn btn-primary" onClick={() => doApply(theme)}>
                      {t('theme.apply')}
                    </button>
                    <button
                      type="button"
                      className="btn btn-danger"
                      onClick={() => setUninstallTarget(theme)}
                    >
                      {t('theme.uninstall')}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
      {installed.length === 0 && <div className="empty-hint">{t('theme.empty_installed')}</div>}

      <div className="settings-row">
        <label className="settings-label">{t('theme.import')}</label>
        <div className="settings-value">
          <button type="button" className="btn" onClick={() => fileInputRef.current?.click()}>
            {t('theme.import')}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".cstheme,.json,application/json"
            style={{ display: 'none' }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void doImport(file);
              e.target.value = '';
            }}
          />
        </div>
      </div>
      <p className="settings-label">{t('theme.import_hint')}</p>

      <Modal
        open={uninstallTarget !== null}
        onClose={() => setUninstallTarget(null)}
        title={t('theme.uninstall_confirm_title')}
        width={420}
        footer={
          <>
            <button type="button" className="btn" onClick={() => setUninstallTarget(null)}>
              {t('common.cancel')}
            </button>
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => uninstallTarget && doUninstall(uninstallTarget)}
            >
              {t('common.confirm')}
            </button>
          </>
        }
      >
        <p>
          {uninstallTarget &&
            t('theme.uninstall_confirm_body', {
              name: displayName(uninstallTarget),
              version: uninstallTarget.version,
            })}
        </p>
      </Modal>
    </section>
  );
}

export default ThemeMarketPanel;
