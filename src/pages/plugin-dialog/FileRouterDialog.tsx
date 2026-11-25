import { useEffect, useMemo, useState } from 'react';
import { useT } from '@/i18n';
import { Modal } from '@/components/Modal';
import { pluginName } from '@/stores/pluginStore';

interface FileRouterDialogProps {
  open: boolean;
  file: File | null;
  pluginIds: string[];
  onClose: () => void;
  onPick: (pluginId: string) => void;
}

export function FileRouterDialog({ open, file, pluginIds, onClose, onPick }: FileRouterDialogProps) {
  const t = useT();
  const [query, setQuery] = useState('');
  // Fresh filter state on every open — a leftover query would hide matches
  // for the next drop.
  useEffect(() => {
    if (open) setQuery('');
  }, [open]);

  // Filter by localized display name or raw id, case-insensitive — with 40+
  // supporting plugins a bare button wall is unscannable.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return pluginIds;
    return pluginIds.filter(
      (id) => id.toLowerCase().includes(q) || pluginName(id).toLowerCase().includes(q),
    );
  }, [pluginIds, query]);

  return (
    <Modal open={open} onClose={onClose} title={t('io.choose_plugin_title')} width={480}>
      <p>{file?.name}</p>
      <p className="empty-hint">{t('io.choose_plugin_hint')}</p>
      <input
        className="input search-input"
        type="search"
        value={query}
        placeholder={t('common.search')}
        aria-label={t('common.search')}
        spellCheck={false}
        autoFocus
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="file-router-options">
        {filtered.map((id) => (
          <button key={id} type="button" className="btn btn-block" onClick={() => onPick(id)}>
            {pluginName(id)}
          </button>
        ))}
        {filtered.length === 0 && (
          <p className="empty-hint">{t('io.choose_plugin_no_match')}</p>
        )}
      </div>
    </Modal>
  );
}
