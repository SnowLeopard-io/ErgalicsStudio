import { useEffect, useState } from 'react';
import { useT } from '@/i18n';
import { usePluginStore, buildPluginApi } from '@/stores/pluginStore';
import { useAppStore } from '@/stores/appStore';
import { ParamPanel } from '@/components/ParamPanel';
import { emit, on, type BusSubscription } from '@/core/events';
import type { ParamDefinition } from '@/types/plugin';

export function RightPanel() {
  const t = useT();
  const activeId = usePluginStore((s) => s.activeId);
  const activePlugin = usePluginStore(
    (s) => s.registry.find((e) => e.id === s.activeId)?.plugin ?? null,
  );
  const rightPanelOpen = useAppStore((s) => s.rightPanelOpen);
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
      void Promise.resolve(activePlugin?.getParams()).then((defs) => setParams(defs ?? []));
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
  }, [activeId, activePlugin]);

  const onChange = (key: string, value: unknown) => {
    if (!activeId) return;
    emit(`plugin:${activeId}:params`, { [key]: value });
  };

  if (!rightPanelOpen) return null;

  return (
    <aside className="right-panel">
      <h3 className="panel-title">{t('workbench.right.params')}</h3>
      {activeId && activePlugin ? (
        <>
          <ParamPanel
            params={params}
            api={buildPluginApi(activeId)}
            onChange={onChange}
          />
          <div className="right-panel-plugin">
            <span className="tag tag-success">{activePlugin.manifest.name}</span>
          </div>
        </>
      ) : (
        <div className="empty-hint right-panel-empty">{t('workbench.right.no_plugin')}</div>
      )}
    </aside>
  );
}