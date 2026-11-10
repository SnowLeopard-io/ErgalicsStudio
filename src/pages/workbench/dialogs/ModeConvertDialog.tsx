// ==========================================================================
// Ergalics Studio — conversion confirmation dialog
//
// Rendered by WorkbenchPage when useModeConvert holds a pending conversion:
// shows what the target surface will contain, which statements stay as raw
// code, the regenerated program text, and the sibling file that will be
// written before it opens. Apply commits the conversion; cancel keeps the
// current surface untouched. Styling mirrors the code-mode language switch
// preview (be-switch-* classes).
// ==========================================================================

import { useT } from '@/i18n';
import { useModeConvert } from '@/stores/useModeConvert';

export function ModeConvertDialog() {
  const t = useT();
  const pending = useModeConvert((s) => s.pending);
  const confirm = useModeConvert((s) => s.confirm);
  const cancel = useModeConvert((s) => s.cancel);
  if (!pending) return null;

  const fromLabel = t(pending.fromKey);
  const toLabel = t(pending.toKey);
  const isLanguage = pending.target.kind === 'language';

  return (
    <div className="mode-convert-overlay" role="presentation">
      <div className="be-switch-preview mode-convert" role="dialog" aria-modal="true" aria-label={t('mode.convert.title')}>
        <div className="be-switch-preview-head">
          <span className="be-switch-preview-title">{t('mode.convert.title')}</span>
          <span className="be-switch-preview-sub">{t('mode.convert.sub', { from: fromLabel, to: toLabel })}</span>
          <button type="button" className="be-switch-preview-close" onClick={cancel} aria-label={t('mode.convert.cancel')}>
            ✕
          </button>
        </div>
        <div className="mode-convert-body">
          <p className="mode-convert-line">
            {isLanguage
              ? t('mode.convert.nodes.language', { n: pending.nodes, lang: toLabel })
              : t('mode.convert.nodes', { n: pending.nodes, mode: toLabel })}
          </p>
          <p className="mode-convert-line mode-convert-path">
            {pending.path
              ? t('mode.convert.file', { path: pending.path })
              : t('mode.convert.file.none')}
          </p>
          {pending.hidden.length > 0 && (
            <div className="mode-convert-warn">
              <p>{t('mode.convert.hidden', { n: pending.hidden.length })}</p>
              <ul>
                {pending.hidden.slice(0, 8).map((h, i) => (
                  <li key={i}>{h}</li>
                ))}
                {pending.hidden.length > 8 && <li>… (+{pending.hidden.length - 8})</li>}
              </ul>
              <p className="mode-convert-warn-note">{t('mode.convert.hidden.note')}</p>
            </div>
          )}
          <p className="mode-convert-line mode-convert-code-label">{t('mode.convert.code')}</p>
          <pre className="mode-convert-code">{pending.code.trim() !== '' ? pending.code : t('mode.convert.empty')}</pre>
        </div>
        <div className="be-switch-preview-foot">
          <span className="be-switch-preview-note">{t('mode.convert.note')}</span>
          <button type="button" className="be-switch-btn be-switch-btn-cancel" onClick={cancel}>
            {t('mode.convert.cancel')}
          </button>
          <button type="button" className="be-switch-btn be-switch-btn-apply" onClick={confirm}>
            {t('mode.convert.apply')}
          </button>
        </div>
      </div>
    </div>
  );
}
