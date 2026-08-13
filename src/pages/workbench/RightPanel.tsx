import { useEffect, useState } from 'react';
import { useT } from '@/i18n';
import { usePluginStore, buildPluginApi } from '@/stores/pluginStore';
import { useAppStore } from '@/stores/appStore';
import { ParamPanel } from '@/components/ParamPanel';
import { emit } from '@/core/events';
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
    setParams(activePlugin?.getParams() ?? []);
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