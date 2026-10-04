import { useEffect, useState } from 'react';
import { useT, useLocale } from '@/i18n';
import { usePluginStore, buildPluginApi } from '@/stores/pluginStore';
import { useAppStore } from '@/stores/appStore';
import { ParamPanel } from '@/components/ParamPanel';
import { EmptyState } from '@/components/EmptyState';
import { emit, on, type BusSubscription } from '@/core/events';
import type { ParamDefinition } from '@/types/plugin';
import { usePanelWidth } from '@/hooks/usePanelWidth';

export function RightPanel() {
  const t = useT();
  const { locale } = useLocale();
  const activeId = usePluginStore((s) => s.activeId);
  const activePlugin = usePluginStore(
    (s) => s.registry.find((e) => e.id === s.activeId)?.plugin ?? null,
  );
  const rightPanelOpen = useAppStore((s) => s.rightPanelOpen);
  const resize = usePanelWidth('ergalics:right-panel-width', 284, 220, 520);
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

  if (!rightPanelOpen) return null;

  return (
    <aside className="right-panel" style={{ width: resize.width }}>
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
    </aside>
  );
}