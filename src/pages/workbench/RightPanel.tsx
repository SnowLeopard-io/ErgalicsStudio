import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useT, useLocale } from '@/i18n';
import { usePluginStore, buildPluginApi } from '@/stores/pluginStore';
import { useAppStore } from '@/stores/appStore';
import { FileInfoPanel } from './FileInfoPanel';
import type { FilePreviewState } from '@/stores/appStore';
import { ParamPanel } from '@/components/ParamPanel';
import { EmptyState } from '@/components/EmptyState';
import { ToolIcon } from '@/components/icons';
import { getTool } from '@/pages/research/toolRegistry';
import { emit, on, type BusSubscription } from '@/core/events';
import type { ParamDefinition } from '@/types/plugin';
import { usePanelWidth } from '@/hooks/usePanelWidth';
import { ChevronLeftIcon, ChevronRightIcon } from '@/components/icons';

/** Introduction card for the suite currently embedded in the central canvas:
 *  identity (icon / name / group) plus its registry description, with
 *  actions to open the standalone page or close the embed. */
function SuiteIntro({ toolId }: { toolId: string }) {
  const t = useT();
  const navigate = useNavigate();
  const setEmbeddedTool = useAppStore((s) => s.setEmbeddedTool);
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
      <div className="suite-intro-actions">
        <button type="button" className="btn btn-sm" onClick={() => navigate(toolDef.path)}>
          {t('suite.open_standalone')}
        </button>
        <button type="button" className="btn btn-sm" onClick={() => setEmbeddedTool(null)}>
          {t('suite.close')}
        </button>
      </div>
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
  const filePreview: FilePreviewState | null = useAppStore((s) => s.filePreview);
  // Research suite embedded in the central canvas — the right panel switches
  // to the suite introduction while one is open.
  const embeddedToolId = useAppStore((s) => s.embeddedTool);
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
            <EmptyState
              className="right-panel-empty"
              title={t('workbench.right.no_plugin')}
              description={t('workbench.empty.subtitle')}
            />
          )}
        </>
      )}
      </aside>
    </div>
  );
}