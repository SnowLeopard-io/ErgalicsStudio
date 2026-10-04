// ==========================================================================
// Ergalics Studio — keyboard shortcuts help (? / Ctrl+/, command palette)
//
// Central, always-fresh list of every shortcut the app binds. The rows are
// declared once in this file so the help can never drift from the bindings
// (add a new key → add its row here). Triggers mirror CommandPalette's
// overlay handling: `?` is ignored while typing in a field so it stays
// harmless inside inputs.
// ==========================================================================

import { useEffect } from 'react';
import { useT } from '@/i18n';
import { Modal } from './Modal';
import { useShortcutsStore } from '@/stores/shortcutsStore';
import { useCommandPaletteStore } from '@/stores/commandPaletteStore';

interface ShortcutRow {
  keys: string[];
  labelKey: string;
}

interface ShortcutGroup {
  groupKey: string;
  rows: ShortcutRow[];
}

const GROUPS: ShortcutGroup[] = [
  {
    groupKey: 'ux.shortcuts.group.global',
    rows: [
      { keys: ['Ctrl', 'S'], labelKey: 'ux.shortcuts.save' },
      { keys: ['Ctrl', 'K'], labelKey: 'ux.shortcuts.palette' },
      { keys: ['?'], labelKey: 'ux.shortcuts.help' },
      { keys: ['Esc'], labelKey: 'ux.shortcuts.esc' },
    ],
  },
  {
    groupKey: 'ux.shortcuts.group.workbench',
    rows: [
      { keys: ['滚轮'], labelKey: 'ux.shortcuts.zoom' },
      { keys: ['双击'], labelKey: 'ux.shortcuts.reset_view' },
      { keys: ['Ctrl', 'Enter'], labelKey: 'ux.shortcuts.run_sql' },
    ],
  },
  {
    groupKey: 'ux.shortcuts.group.palette',
    rows: [
      { keys: ['↑', '↓'], labelKey: 'ux.shortcuts.palette_nav' },
      { keys: ['Enter'], labelKey: 'ux.shortcuts.palette_go' },
      { keys: ['Esc'], labelKey: 'ux.shortcuts.palette_close' },
    ],
  },
  {
    groupKey: 'ux.shortcuts.group.block',
    rows: [{ keys: ['Delete', 'Backspace'], labelKey: 'ux.shortcuts.block_delete' }],
  },
];

/** True while the event target is a text-editing surface — `?` must not
 *  hijack typing inside inputs, textareas or contenteditable hosts. */
function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return true;
  return target.hasAttribute('contenteditable');
}

export function ShortcutsDialog() {
  const t = useT();
  const open = useShortcutsStore((s) => s.open);
  const setOpen = useShortcutsStore((s) => s.setOpen);

  // `?` (shift+/ in most layouts) opens from anywhere, except while typing.
  // Ctrl+/ is the no-ambiguity alias (no shift-dependent layout issues).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === '/') {
        e.preventDefault();
        // The palette overlay stacks above modals (2600 > 2000), so opening
        // the help from inside the palette would render it underneath —
        // close the palette first.
        useCommandPaletteStore.getState().setOpen(false);
        useShortcutsStore.getState().toggle();
        return;
      }
      if (e.key === '?' && !e.ctrlKey && !e.metaKey && !e.altKey && !isTyping(e.target)) {
        useShortcutsStore.getState().toggle();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <Modal
      open={open}
      title={t('ux.shortcuts.title')}
      onClose={() => setOpen(false)}
      width={520}
    >
      <div className="shortcuts-list">
        {GROUPS.map((group) => (
          <section key={group.groupKey} className="shortcuts-group">
            <h3 className="shortcuts-group-label">{t(group.groupKey)}</h3>
            <ul className="shortcuts-rows">
              {group.rows.map((row) => (
                <li key={row.labelKey} className="shortcuts-row">
                  <span className="shortcuts-desc">{t(row.labelKey)}</span>
                  <span className="shortcuts-keys">
                    {row.keys.map((k, i) => (
                      <span key={k}>
                        {i > 0 && <span className="shortcuts-plus">+</span>}
                        <kbd className="shortcuts-kbd">{k}</kbd>
                      </span>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Modal>
  );
}
