import { useT, useLocale } from '@/i18n';
import { Modal } from '@/components/Modal';
import {
  BUILTIN_EXAMPLES,
  exampleToFile,
  exampleName,
  exampleDescription,
} from '@/core/examples';
import { findBuiltin } from '@/plugins/builtin';
import { usePluginStore } from '@/stores/pluginStore';
import { useAppStore } from '@/stores/appStore';
import { logger } from '@/core/logger';

interface ExampleDataDialogProps {
  open: boolean;
  onClose: () => void;
}

export function ExampleDataDialog({ open, onClose }: ExampleDataDialogProps) {
  const t = useT();
  const { locale } = useLocale();
  const notify = useAppStore((s) => s.notify);
  const loadingRef = { current: false };

  const loadExample = async (id: string) => {
    const ex = BUILTIN_EXAMPLES.find((e) => e.id === id);
    if (!ex || loadingRef.current) return;
    loadingRef.current = true;
    try {
      const store = usePluginStore.getState();
      if (!store.isLoaded(ex.pluginId)) {
        const info = findBuiltin(ex.pluginId);
        if (!info) throw new Error(`unknown builtin plugin ${ex.pluginId}`);
        const plugin = await info.load();
        await store.load(plugin);
      }
      const current = usePluginStore.getState();
      if (current.activeId !== ex.pluginId) {
        await current.activate(ex.pluginId);
      }
      const plugin = usePluginStore
        .getState()
        .registry.find((e) => e.id === ex.pluginId)?.plugin;
      await plugin?.loadData?.(exampleToFile(ex));
      notify('success', t('workbench.example_data.loaded'));
      onClose();
    } catch (err) {
      logger.error('example', `load failed ${id}`, err);
      notify('error', `${t('workbench.example_data.load_failed')}: ${String(err)}`);
    } finally {
      loadingRef.current = false;
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('workbench.example_data.title')}
      width={640}
      footer={
        <button type="button" className="btn" onClick={onClose}>
          {t('common.close')}
        </button>
      }
    >
      <div className="plugin-dialog">
        <p className="example-data-subtitle">{t('workbench.example_data.subtitle')}</p>
        <div className="plugin-list-pane">
          {BUILTIN_EXAMPLES.map((ex) => (
            <div key={ex.id} className="plugin-card">
              <div className="plugin-card-main">
                <span className="plugin-icon">▦</span>
                <div className="plugin-card-info">
                  <div className="plugin-card-title">{exampleName(ex, locale)}</div>
                  <div className="plugin-card-meta">
                    {exampleDescription(ex, locale)}
                  </div>
                  <div className="example-data-tags">
                    <span className="tag tag-muted">{ex.filename}</span>
                    <span className="tag tag-primary">{ex.format}</span>
                    <span className="tag tag-muted">{ex.pluginId}</span>
                  </div>
                </div>
              </div>
              <div className="plugin-card-actions">
                <button
                  type="button"
                  className="btn btn-sm btn-primary"
                  onClick={() => void loadExample(ex.id)}
                >
                  {t('workbench.example_data.load')}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}