// ==========================================================================
// Ergalics Studio — LaTeX online editor (/studio/latex-editor)
//
// Split view: raw `.tex` source on the left, a live KaTeX preview on the
// right. Figures come from Figure Studio (one click inserts a matching
// `\includesvg` block and exports the SVG with the manuscript); equations are
// composed in a visual builder. The PDF button prints the preview, which in
// every modern browser is "Save as PDF" — no server-side TeX required.
// ==========================================================================

import { useEffect, useMemo, useRef, useState } from 'react';
import { useT } from '@/i18n';
import { ToolShell } from '@/components/ToolShell';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { useAppStore } from '@/stores/appStore';
import { useProjectStore } from '@/stores/projectStore';
import { usePublishStore } from '@/stores/publishStore';
import {
  LATEX_TEMPLATES,
  equationSnippet,
  figureSnippet,
  getLatexTemplate,
  latexPreviewBody,
  latexPreviewHtml,
  renderBibtexFile,
  starterLatex,
  type LatexTemplateId,
} from '@/core/publish/latex';
import {
  figureSheetPath,
  figureSheetSvg,
  figureSlug,
  makeFigureResolver,
  referencedFigures,
} from '@/core/publish/bridge';
import { CITATION_STYLES, type CitationStyle } from '@/core/publish/citation';
import type { ManuscriptRecord } from '@/core/publish/state';
import {
  downloadText,
  printHtml,
  usePublishState,
  writePublishArtifacts,
} from './shared';

const EQUATION_PRESETS: Array<{ id: string; tex: string }> = [
  { id: 'fraction', tex: '\\frac{a}{b}' },
  { id: 'sqrt', tex: '\\sqrt{x^2 + y^2}' },
  { id: 'integral', tex: '\\int_{0}^{\\infty} e^{-x^2}\\,dx = \\frac{\\sqrt{\\pi}}{2}' },
  { id: 'sum', tex: '\\sum_{i=1}^{n} x_i' },
  { id: 'matrix', tex: '\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}' },
  { id: 'greek', tex: '\\alpha, \\beta, \\gamma, \\Delta, \\mu, \\sigma' },
];

/**
 * Live preview surface. Writing into the iframe document imperatively (instead
 * of re-assigning `srcDoc`) keeps the update synchronous with the editor and
 * avoids the white flash / scroll jump of a full iframe reload on every
 * keystroke. The scroll position is carried over so the reader stays put.
 */
function PreviewFrame({ html, title }: { html: string; title: string }) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const bootstrapped = useRef(false);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const doc = frame.contentDocument;
    if (!doc) {
      frame.srcdoc = html;
      bootstrapped.current = true;
      return;
    }
    const scroll = bootstrapped.current ? doc.scrollingElement?.scrollTop ?? 0 : 0;
    doc.open();
    doc.write(html || '<!doctype html><html><body></body></html>');
    doc.close();
    bootstrapped.current = true;
    if (scroll > 0) {
      const scroller = doc.scrollingElement;
      if (scroller) scroller.scrollTop = scroll;
    }
  }, [html]);

  return (
    <iframe
      ref={frameRef}
      className="publish-preview"
      title={title}
      aria-label={title}
    />
  );
}

export default function LatexEditorPage() {
  const t = useT();
  const notify = useAppStore((s) => s.notify);
  const project = useProjectStore((s) => s.project);
  const publish = usePublishState();
  const saveManuscript = usePublishStore((s) => s.saveManuscript);
  const deleteManuscript = usePublishStore((s) => s.deleteManuscript);
  const setActiveManuscript = usePublishStore((s) => s.setActiveManuscript);

  const manuscripts = publish.manuscripts;
  const active =
    manuscripts.find((m) => m.id === publish.activeManuscriptId) ?? manuscripts[0] ?? null;

  const [source, setSource] = useState('');
  const [name, setName] = useState('');
  const [templateId, setTemplateId] = useState<LatexTemplateId>('ieee');
  const [style, setStyle] = useState<CitationStyle>('ieee');
  const [equationOpen, setEquationOpen] = useState(false);
  const [equationTex, setEquationTex] = useState('E = mc^2');
  const [deleteTarget, setDeleteTarget] = useState<ManuscriptRecord | null>(null);
  const [replaceStarter, setReplaceStarter] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const sheets = project?.state.figureSheets ?? [];
  const library = publish.library;

  // Load the active manuscript into the editor. `active?.id` (not `active`)
  // keeps the effect from firing on every store write (autosave).
  useEffect(() => {
    if (!active) {
      setSource('');
      setName('');
      return;
    }
    setSource(active.source);
    setName(active.name);
    setTemplateId(active.templateId);
    setStyle(active.citationStyle);
  }, [active?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Debounced write-through autosave. Does not bump `active.id`, so typing
  // never resets the textarea and never fights the effect above.
  useEffect(() => {
    if (!active) return;
    if (
      source === active.source &&
      name === active.name &&
      templateId === active.templateId &&
      style === active.citationStyle
    ) {
      return;
    }
    const timer = setTimeout(() => {
      saveManuscript({
        ...active,
        name: name.trim() || t('publish.common.untitled'),
        source,
        templateId,
        citationStyle: style,
        updatedAt: Date.now(),
      });
    }, 600);
    return () => clearTimeout(timer);
  }, [source, name, templateId, style, active, saveManuscript, t]);

  const resolveFigure = useMemo(() => makeFigureResolver(sheets), [sheets]);
  const previewHtml = useMemo(() => {
    if (!source.trim()) return '';
    return latexPreviewHtml(source, { entries: library, style, resolveFigure });
  }, [source, library, style, resolveFigure]);

  // Debounce only the (potentially slow) HTML render, not the iframe write:
  // 140 ms still feels live while coalescing fast typing bursts.
  const [previewDoc, setPreviewDoc] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setPreviewDoc(previewHtml), 140);
    return () => clearTimeout(timer);
  }, [previewHtml]);

  const equationPreview = useMemo(
    () => latexPreviewBody(`$$${equationTex}$$`, { entries: library, style }),
    [equationTex, library, style],
  );

  const createManuscript = () => {
    const now = Date.now();
    const record: ManuscriptRecord = {
      id: crypto.randomUUID(),
      name: `${t('publish.common.untitled')} ${manuscripts.length + 1}`,
      templateId: 'ieee',
      citationStyle: 'ieee',
      source: starterLatex('ieee'),
      createdAt: now,
      updatedAt: now,
    };
    saveManuscript(record);
    notify('success', t('publish.common.saved'));
  };

  const insertAtCursor = (snippet: string) => {
    const el = textareaRef.current;
    const start = el?.selectionStart ?? source.length;
    const end = el?.selectionEnd ?? source.length;
    const next = `${source.slice(0, start)}${snippet}${source.slice(end)}`;
    setSource(next);
    requestAnimationFrame(() => {
      el?.focus();
      const caret = start + snippet.length;
      el?.setSelectionRange(caret, caret);
    });
  };

  const insertFigure = (sheetId: string, width: number) => {
    const sheet = sheets.find((s) => s.id === sheetId);
    if (!sheet) return;
    const slug = figureSlug(sheet.name, sheet.id.slice(0, 8));
    insertAtCursor(
      `\n${figureSnippet(figureSheetPath(sheet), sheet.caption || sheet.name, `fig:${slug}`, width)}\n`,
    );
    notify('success', t('publish.latex.figure_inserted'));
  };

  const insertEquation = () => {
    insertAtCursor(`\n${equationSnippet(equationTex)}\n`);
    setEquationOpen(false);
    notify('success', t('publish.latex.equation_inserted'));
  };

  const handleExportTex = () => {
    const safe = (name || 'manuscript').replace(/[^\w.-]+/g, '_');
    downloadText(`${safe}.tex`, source, 'application/x-tex;charset=utf-8');
  };

  const handlePrint = () => {
    if (!previewHtml) return;
    printHtml(previewHtml, name || 'manuscript');
  };

  const handleSaveWorkspace = async () => {
    if (!project || !active) return;
    try {
      const files = [
        { path: 'manuscript/main.tex', content: source },
        { path: 'manuscript/references.bib', content: renderBibtexFile(library) },
      ];
      const wanted = new Set(referencedFigures(source));
      for (const sheet of sheets) {
        const file = figureSheetPath(sheet);
        const bare = file.replace(/^figures\//, '');
        if (wanted.has(bare) || wanted.has(file)) {
          files.push({ path: file, content: figureSheetSvg(sheet) });
        }
      }
      await writePublishArtifacts(files, `${active.name} (${active.templateId})`);
      notify('success', t('publish.common.git_saved'));
    } catch (err) {
      notify('error', t('publish.common.error', { reason: String(err) }));
    }
  };

  const template = getLatexTemplate(templateId);
  const safeSource = source || '';

  return (
    <ToolShell toolId="latex-editor">
      <div className="publish-page">
        <aside className="publish-side">
          <div className="publish-side-head">
            <h2 className="publish-side-title">{t('publish.latex.manuscripts')}</h2>
            <button type="button" className="btn btn-sm btn-primary" onClick={createManuscript}>
              + {t('publish.latex.new')}
            </button>
          </div>
          <ul className="publish-list">
            {manuscripts.map((m) => (
              <li
                key={m.id}
                className={`publish-list-item${m.id === active?.id ? ' is-active' : ''}`}
              >
                <button
                  type="button"
                  className="publish-list-select"
                  onClick={() => setActiveManuscript(m.id)}
                >
                  <span className="publish-list-name">{m.name}</span>
                  <span className="publish-list-meta">
                    {getLatexTemplate(m.templateId).label} · {m.citationStyle.toUpperCase()}
                  </span>
                </button>
                <button
                  type="button"
                  className="publish-delete"
                  aria-label={t('publish.common.delete')}
                  title={t('publish.common.delete')}
                  onClick={() => setDeleteTarget(m)}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
          {manuscripts.length === 0 && (
            <p className="publish-muted">{t('publish.common.none')}</p>
          )}

          <div className="publish-field">
            <label className="publish-label">
              {t('publish.common.name')}
              <input
                className="input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={!active}
              />
            </label>
            <label className="publish-label">
              {t('publish.common.template')}
              <select
                className="select"
                value={templateId}
                onChange={(e) => setTemplateId(e.target.value as LatexTemplateId)}
                disabled={!active}
              >
                {LATEX_TEMPLATES.map((tpl) => (
                  <option key={tpl.id} value={tpl.id}>{tpl.label}</option>
                ))}
              </select>
            </label>
            <p className="publish-hint">{template.note}</p>
            <label className="publish-label">
              {t('publish.common.style')}
              <select
                className="select"
                value={style}
                onChange={(e) => setStyle(e.target.value as CitationStyle)}
                disabled={!active}
              >
                {CITATION_STYLES.map((s) => (
                  <option key={s.id} value={s.id}>{s.label}</option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="btn btn-sm"
              disabled={!active}
              onClick={() => setReplaceStarter(true)}
            >
              {t('publish.latex.starter')}
            </button>
            <p className="publish-hint">
              {t('publish.latex.bib_hint', { n: String(library.length) })}
            </p>
          </div>
        </aside>

        <section className="publish-main">
          {!active ? (
            <div className="publish-empty">{t('publish.citation.no_entry')}</div>
          ) : (
            <>
              <div className="publish-toolbar">
                <select
                  className="select publish-grow"
                  value=""
                  onChange={(e) => {
                    if (e.target.value) insertFigure(e.target.value, 0.9);
                    e.currentTarget.value = '';
                  }}
                  aria-label={t('publish.latex.insert_figure')}
                  disabled={sheets.length === 0}
                >
                  <option value="">
                    {sheets.length === 0
                      ? t('publish.latex.no_figures')
                      : `+ ${t('publish.latex.insert_figure')}`}
                  </option>
                  {sheets.map((sheet) => (
                    <option key={sheet.id} value={sheet.id}>{sheet.name}</option>
                  ))}
                </select>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => setEquationOpen((v) => !v)}
                >
                  ∑ {t('publish.latex.insert_equation')}
                </button>
                <button type="button" className="btn btn-sm" onClick={handleExportTex}>
                  {t('publish.latex.export_tex')}
                </button>
                <button type="button" className="btn btn-sm" onClick={handlePrint}>
                  {t('publish.latex.export_pdf')}
                </button>
                <button type="button" className="btn btn-sm btn-primary" onClick={handleSaveWorkspace}>
                  {t('publish.latex.save_workspace')}
                </button>
              </div>

              {equationOpen && (
                <div className="publish-equation-panel">
                  <div className="publish-row">
                    {EQUATION_PRESETS.map((preset) => (
                      <button
                        key={preset.id}
                        type="button"
                        className="btn btn-sm"
                        onClick={() => setEquationTex(preset.tex)}
                      >
                        {preset.id}
                      </button>
                    ))}
                  </div>
                  <input
                    className="input publish-mono"
                    value={equationTex}
                    onChange={(e) => setEquationTex(e.target.value)}
                    placeholder={t('publish.latex.equation_hint')}
                    aria-label={t('publish.latex.equation_hint')}
                  />
                  <div
                    className="publish-equation-preview"
                    // Generated locally by KaTeX from the user's own input.
                    dangerouslySetInnerHTML={{ __html: equationPreview }}
                  />
                  <button type="button" className="btn btn-sm btn-primary" onClick={insertEquation}>
                    {t('publish.latex.insert_equation')}
                  </button>
                </div>
              )}

              <div className="publish-split">
                <div className="publish-pane">
                  <div className="publish-pane-title">{t('publish.latex.editor')}</div>
                  <textarea
                    ref={textareaRef}
                    className="publish-source"
                    value={safeSource}
                    onChange={(e) => setSource(e.target.value)}
                    spellCheck={false}
                    placeholder={t('publish.latex.placeholder')}
                    aria-label={t('publish.latex.editor')}
                  />
                </div>
                <div className="publish-pane">
                  <div className="publish-pane-title">{t('publish.latex.preview')}</div>
                  <PreviewFrame html={previewDoc} title={t('publish.latex.preview')} />
                </div>
              </div>
              <p className="publish-hint">{t('publish.latex.compile_hint')}</p>
            </>
          )}
        </section>
      </div>

      <ConfirmDialog
        open={deleteTarget !== null}
        title={t('publish.common.delete')}
        message={t('publish.common.delete_confirm', { name: deleteTarget?.name ?? '' })}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget) deleteManuscript(deleteTarget.id);
          setDeleteTarget(null);
        }}
      />
      <ConfirmDialog
        open={replaceStarter}
        title={t('publish.latex.starter')}
        message={t('publish.common.delete_confirm', { name: active?.name ?? '' })}
        onClose={() => setReplaceStarter(false)}
        onConfirm={() => {
          setSource(starterLatex(templateId, name || 'Untitled manuscript'));
          setReplaceStarter(false);
        }}
      />
    </ToolShell>
  );
}
