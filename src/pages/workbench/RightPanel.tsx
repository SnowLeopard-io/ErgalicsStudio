import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useT, useLocale } from '@/i18n';
import { usePluginStore, buildPluginApi } from '@/stores/pluginStore';
import { useAppStore, toolTabKey } from '@/stores/appStore';
import { FileInfoPanel } from './FileInfoPanel';
import type { FilePreviewState } from '@/stores/appStore';
import { ParamPanel } from '@/components/ParamPanel';
import { EmptyState } from '@/components/EmptyState';
import { CITATION_META, citationUrl, currentAppVersion } from '@/core/citation';
import { ToolIcon } from '@/components/icons';
import { getTool } from '@/pages/research/toolRegistry';
import { emit, on, type BusSubscription } from '@/core/events';
import type { ParamDefinition } from '@/types/plugin';
import { usePanelWidth } from '@/hooks/usePanelWidth';
import { ChevronLeftIcon, ChevronRightIcon } from '@/components/icons';

/** Introduction card for the suite currently embedded in the central canvas:
 *  identity (icon / name / group), full registry description, data
 *  requirements and embedded-mode notes, with actions to open the standalone
 *  page or close the embed. */
function SuiteIntro({ toolId }: { toolId: string }) {
  const t = useT();
  const navigate = useNavigate();
  const closeTab = useAppStore((s) => s.closeTab);
  const toolDef = getTool(toolId);
  if (!toolDef) return null;
  return (
    <div className="suite-intro">
      <div className="suite-intro-head">
        <span className="suite-intro-icon" aria-hidden="true">
          <ToolIcon kind={toolDef.icon} size={18} />
        </span>
        <div className="suite-intro-heading">
          <div className="suite-intro-name">{t(toolDef.titleKey)}</div>
          <span className="tag">{t(`tool.group.${toolDef.group}`)}</span>
        </div>
      </div>
      <p className="suite-intro-desc">{t(toolDef.descKey)}</p>
      <dl className="suite-intro-facts">
        <div className="suite-intro-fact">
          <dt>{t('suite.info.data_req')}</dt>
          <dd>
            {toolDef.requireProject
              ? t('suite.info.needs_project')
              : t('suite.info.no_project_needed')}
          </dd>
        </div>
        <div className="suite-intro-fact">
          <dt>{t('suite.info.mode')}</dt>
          <dd>{t('suite.info.embedded_hint')}</dd>
        </div>
      </dl>
      <div className="suite-intro-actions">
        <button type="button" className="btn btn-sm" onClick={() => navigate(toolDef.path)}>
          {t('suite.open_standalone')}
        </button>
        <button type="button" className="btn btn-sm" onClick={() => closeTab(toolTabKey(toolId))}>
          {t('suite.close')}
        </button>
      </div>
    </div>
  );
}

/** Gitee mirror (kept identical to the Settings → About card). */
const GITEE_REPO_URL = 'https://gitee.com/cnt-code/ergalics-studio';
const CHANGELOG_URL = `${CITATION_META.repoUrl}/blob/main/CHANGELOG.md`;

/** Welcome / info panel shown instead of plugin parameters when no plugin is
 *  active: quick-start intro, current version with release highlights and
 *  repository cards (GitHub + Gitee). Content is factual — highlights mirror
 *  the top entries of CHANGELOG.md, and the version/release links resolve to
 *  the running build. */
function RightPanelWelcome() {
  const t = useT();
  const version = currentAppVersion();
  return (
    <div className="rp-welcome">
      <p className="rp-welcome-intro">{t('workbench.right.welcome_intro')}</p>

      <div className="rp-welcome-block">
        <div className="rp-welcome-heading">{t('workbench.right.whats_new')}</div>
        <div className="rp-welcome-version-row">
          <span className="tag tag-success">v{version}</span>
          <a
            className="rp-welcome-link"
            href={citationUrl(version)}
            target="_blank"
            rel="noreferrer"
          >
            {t('workbench.right.release_notes')}
          </a>
        </div>
        <ul className="rp-welcome-list">
          {([1, 2, 3] as const).map((i) => (
            <li key={i}>{t(`workbench.right.whats_new_${i}`)}</li>
          ))}
        </ul>
        <a className="rp-welcome-link" href={CHANGELOG_URL} target="_blank" rel="noreferrer">
          {t('workbench.right.full_changelog')} →
        </a>
      </div>

      <div className="rp-welcome-block">
        <div className="rp-welcome-heading">{t('workbench.right.repo_title')}</div>
        <p className="rp-welcome-hint">{t('workbench.right.repo_hint')}</p>
        <div className="rp-welcome-repo-btns">
          <a
            className="btn btn-sm"
            href={CITATION_META.repoUrl}
            target="_blank"
            rel="noreferrer"
          >
            GitHub
          </a>
          <a className="btn btn-sm" href={GITEE_REPO_URL} target="_blank" rel="noreferrer">
            Gitee
          </a>
        </div>
      </div>

      <p className="rp-welcome-hint">{t('workbench.right.welcome_tip')}</p>
    </div>
  );
}

export function RightPanel() {
  const t = useT();
  const { locale } = useLocale();
  const activeId = usePluginStore((s) => s.activeId);
  const activePlugin = usePluginStore(
    (s) => s.registry.find((e) => e.id === s.activeId)?.plugin ?? null,
  );
  const rightPanelOpen = useAppStore((s) => s.rightPanelOpen);
  const toggleRightPanel = useAppStore((s) => s.toggleRightPanel);
  // Active canvas tab drives what this panel shows: a file tab → file info,
  // a suite tab → suite intro, no tab → plugin parameters.
  const activeTabKey = useAppStore((s) => s.activeTab);
  const filePreview: FilePreviewState | null = useAppStore((s) =>
    activeTabKey?.startsWith('file:') ? (s.filePreviews[activeTabKey] ?? null) : null,
  );
  // Research suite embedded in the central canvas — the right panel switches
  // to the suite introduction while one is active.
  const embeddedToolId = activeTabKey?.startsWith('tool:') ? activeTabKey.slice(5) : null;
  const resize = usePanelWidth('ergalics:right-panel-width', 284, 220, 520, 'left');
  const [params, setParams] = useState<ParamDefinition[]>([]);

  useEffect(() => {
    if (!activeId) {
      setParams([]);
      return;
    }
    // Refresh definitions whenever the plugin re-renders params or its
    // values change, so sliders/toggles stay in sync with plugin state.
    // Sandboxed plugins resolve getParams() asynchronously (RPC).
    const refresh = () => {
      // `?.getParams?.()`: a minimal plugin may omit getParams, and sandboxed
      // plugins resolve it asynchronously (RPC) so the getter can be absent.
      // Guard both the property and the call to never throw here.
      void Promise.resolve(activePlugin?.getParams?.()).then((defs) => setParams(defs ?? []));
    };
    refresh();
    const subs: BusSubscription[] = [
      on(`plugin:${activeId}:params`, refresh),
      on(`plugin:${activeId}:defs`, refresh),
      on('host:params:changed', (p: { pluginId: string }) => {
        if (p?.pluginId === activeId) refresh();
      }),
    ];
    return () => subs.forEach((s) => s.unsubscribe());
    // `locale` in deps: a plugin's getParams() labels/options are
    // locale-sensitive (built from api.locale at call time), so the panel
    // must re-read them when the language switches — otherwise dropdown
    // options keep the previous language until some unrelated event.
  }, [activeId, activePlugin, locale]);

  const onChange = (key: string, value: unknown) => {
    if (!activeId) return;
    emit(`plugin:${activeId}:params`, { [key]: value });
  };

  // 收起态：面板本体不渲染，只在其原位置（中央区右侧）露一个窄的
  // 展开按钮，点击恢复展开。
  if (!rightPanelOpen) {
    return (
      <button
        type="button"
        className="panel-edge-btn panel-edge-right"
        aria-label={t('ux.panel.expand_right')}
        title={t('ux.panel.expand_right')}
        onClick={toggleRightPanel}
      >
        <ChevronLeftIcon size={12} />
      </button>
    );
  }

  // 手柄挂在包裹层而非面板内部：面板 overflow 会裁剪超出边界的部分，
  // 感应区必须整体落在面板左缘外才完整可命中。
  return (
    <div className="panel-wrap" style={{ width: resize.width }}>
      <div
        className="panel-resize-handle panel-resize-left"
        role="separator"
        aria-orientation="vertical"
        aria-label={t('ux.resize.right')}
        title={t('ux.resize.right')}
        onPointerDown={resize.onPointerDown}
        onPointerMove={resize.onPointerMove}
        onPointerUp={resize.onPointerUp}
      />
      <button
        type="button"
        className="panel-collapse-btn panel-collapse-left"
        aria-label={t('ux.panel.collapse_right')}
        title={t('ux.panel.collapse_right')}
        onClick={toggleRightPanel}
      >
        <ChevronRightIcon size={12} />
      </button>
      <aside className="right-panel">
      {embeddedToolId ? (
        <>
          <h3 className="panel-title">{t('workbench.right.suite')}</h3>
          <SuiteIntro toolId={embeddedToolId} />
        </>
      ) : filePreview ? (
        <>
          <h3 className="panel-title">{t('workbench.right.fileinfo')}</h3>
          <FileInfoPanel preview={filePreview} />
        </>
      ) : (
        <>
          <h3 className="panel-title">{t('workbench.right.params')}</h3>
          {activeId && activePlugin ? (
            <>
              {params.length === 0 && (
                <EmptyState
                  className="right-panel-empty"
                  title={t('workbench.right.no_params')}
                />
              )}
              <ParamPanel
                params={params}
                api={buildPluginApi(activeId)}
                onChange={onChange}
              />
              <div className="right-panel-plugin">
                <span className="tag tag-success">
                  {activePlugin.manifest.nameI18n?.[locale] ?? activePlugin.manifest.name}
                </span>
              </div>
            </>
          ) : (
            <RightPanelWelcome />
          )}
        </>
      )}
      </aside>
    </div>
  );
}