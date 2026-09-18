// ==========================================================================
// Ergalics Studio — narrative panel (FR-02)
//
// Shared result-panel widget: turns a structured statistical result into a
// publication-style paragraph (core/stats/narrative), lets the user edit it,
// copy it to the clipboard, or append it to a saved report spec (F8 store).
// Language follows the active locale.
// ==========================================================================

import { useEffect, useState } from 'react';
import { useT, useLocale } from '@/i18n';
import { useAppStore } from '@/stores/appStore';
import { useProjectStore } from '@/stores/projectStore';
import { useResearchStore } from '@/stores/researchStore';
import { generateNarrative, type NarrativeInput } from '@/core/stats/narrative';

interface NarrativePanelProps {
  /** The narratable result, or null when nothing on screen can be narrated. */
  input: NarrativeInput | null;
}

export function NarrativePanel({ input }: NarrativePanelProps) {
  const t = useT();
  const { locale } = useLocale();
  const notify = useAppStore((s) => s.notify);
  const [text, setText] = useState<string | null>(null);

  // A fresh test/fit replaces the input object; drop the stale paragraph so
  // the user never copies text describing the previous result.
  useEffect(() => {
    setText(null);
  }, [input]);

  if (!input) return null;

  const generate = () => {
    setText(generateNarrative(input, locale === 'en-US' ? 'en-US' : 'zh-CN'));
  };

  const copy = async () => {
    if (text === null) return;
    try {
      await navigator.clipboard.writeText(text);
      notify('success', t('narrative.copied'));
    } catch {
      notify('error', t('narrative.copy_failed'));
    }
  };

  const insert = () => {
    if (text === null) return;
    const project = useProjectStore.getState().project;
    if (!project) {
      notify('error', t('narrative.insert_failed'));
      return;
    }
    const reports = project.state.reports ?? [];
    const section = { type: 'markdown' as const, text };
    const saveReport = useResearchStore.getState().saveReport;
    const last = reports[reports.length - 1];
    if (last) {
      saveReport({ ...last, sections: [...last.sections, section], updatedAt: Date.now() });
      notify('success', t('narrative.inserted', { name: last.title }));
    } else {
      const title = t('narrative.default_report');
      saveReport({
        id: crypto.randomUUID(),
        name: t('narrative.new_report'),
        title,
        sections: [section],
        updatedAt: Date.now(),
      });
      notify('success', t('narrative.inserted', { name: title }));
    }
  };

  if (text === null) {
    return (
      <div className="analysis-row">
        <button type="button" className="btn" onClick={generate}>
          {t('narrative.generate')}
        </button>
      </div>
    );
  }

  return (
    <div className="analysis-row" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
      <h4 className="share-section-title">{t('narrative.title')}</h4>
      <textarea className="input" rows={4} value={text} onChange={(e) => setText(e.target.value)} />
      <div className="analysis-actions">
        <button type="button" className="btn" onClick={() => void copy()}>
          {t('narrative.copy')}
        </button>
        <button type="button" className="btn btn-primary" onClick={insert}>
          {t('narrative.insert')}
        </button>
      </div>
    </div>
  );
}
