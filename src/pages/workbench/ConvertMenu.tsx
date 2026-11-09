// ==========================================================================
// Ergalics Studio — common conversion menu (top bar, every mode)
//
// One dropdown lists every surface the program can be converted into:
// the three workbench modes (flow / block / code) and the three code
// dialects (Python / R / JavaScript). Choosing a language converts into code
// mode in that dialect, using the same preview → write sibling file → open
// pipeline as a mode switch (see stores/useModeConvert.ts).
// ==========================================================================

import { useT } from '@/i18n';
import { useAppStore } from '@/stores/appStore';
import { useEditorStore } from '@/stores/editorStore';
import { useModeConvert } from '@/stores/useModeConvert';
import { Dropdown, type MenuItemDef } from '@/components/Dropdown';
import { ChevronDownIcon, SwapIcon } from '@/components/icons';
import type { CodeLanguage } from '@/types/editor';

const MODE_TARGETS: { id: 'flow' | 'block' | 'code'; labelKey: string }[] = [
  { id: 'flow', labelKey: 'workbench.mode.flow' },
  { id: 'block', labelKey: 'workbench.mode.block' },
  { id: 'code', labelKey: 'workbench.mode.code' },
];

const LANGUAGE_TARGETS: { id: CodeLanguage; labelKey: string; ext: string }[] = [
  { id: 'python', labelKey: 'editor.lang.python', ext: '.py' },
  { id: 'r', labelKey: 'editor.lang.r', ext: '.r' },
  { id: 'js', labelKey: 'editor.lang.js', ext: '.js' },
];

export function ConvertMenu() {
  const t = useT();
  const mode = useAppStore((s) => s.mode);
  const language = useEditorStore(
    (s) => s.sessions.find((x) => x.id === s.activeSessionId)?.language ?? 'python',
  );
  const requestTarget = useModeConvert((s) => s.requestTarget);

  const items: MenuItemDef[] = [
    { key: 'convert-modes', label: t('workbench.convert.mode_group'), header: true },
    ...MODE_TARGETS.map((m) => ({
      key: `mode:${m.id}`,
      label: t(m.labelKey),
      active: mode === m.id,
      disabled: mode === m.id,
      onClick: () => requestTarget({ kind: 'mode', mode: m.id }),
    })),
    { key: 'convert-sep', label: '' },
    { key: 'convert-langs', label: t('workbench.convert.language_group'), header: true },
    ...LANGUAGE_TARGETS.map((l) => {
      const current = mode === 'code' && language === l.id;
      return {
        key: `lang:${l.id}`,
        label: t(l.labelKey),
        description: l.ext,
        active: current,
        disabled: current,
        onClick: () => requestTarget({ kind: 'language', language: l.id }),
      };
    }),
  ];

  return (
    <Dropdown
      ariaLabel={t('workbench.convert.menu')}
      triggerClassName="cluster-btn convert-trigger"
      align="left"
      trigger={
        <>
          <SwapIcon size={13} />
          <span>{t('workbench.convert.menu')}</span>
          <ChevronDownIcon size={11} />
        </>
      }
      items={items}
    />
  );
}
