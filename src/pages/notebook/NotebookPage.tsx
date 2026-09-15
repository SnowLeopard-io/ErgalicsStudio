// ==========================================================================
// Ergalics Studio — Notebook (/notebook)
//
// Mixed markdown/code cells persisted in project.state.notebook. Markdown
// renders through the core mdToHtml (escaped, dependency-free); code cells
// run on a dedicated Pyodide runtime that is terminated on unmount.
// ==========================================================================

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useT } from '@/i18n';
import { useAppStore } from '@/stores/appStore';
import { useProjectStore } from '@/stores/projectStore';
import { useNotebookStore } from '@/stores/notebookStore';
import { mdToHtml } from '@/core/notebook/notebook';
import type { NotebookCell, NotebookCellOutput } from '@/core/notebook/notebook';

function CellOutputs({ outputs }: { outputs: NotebookCellOutput[] }) {
  if (outputs.length === 0) return null;
  return (
    <div className="nb-cell-outputs">
      {outputs.map((out, i) => {
        if (out.kind === 'stdout') {
          return (
            <pre key={i} className="nb-out nb-out-stdout">
              {out.text}
            </pre>
          );
        }
        if (out.kind === 'stderr') {
          return (
            <pre key={i} className="nb-out nb-out-stderr">
              {out.text}
            </pre>
          );
        }
        if (out.kind === 'error') {
          return (
            <pre key={i} className="nb-out nb-out-error">
              {out.text}
            </pre>
          );
        }
        return (
          <div key={i} className="nb-out-vars">
            {out.entries.map((e) => (
              <span key={e.name} className="nb-var" title={e.preview}>
                <b>{e.name}</b> = {e.preview}
              </span>
            ))}
          </div>
        );
      })}
    </div>
  );
}

function CellItem({ cell, index }: { cell: NotebookCell; index: number }) {
  const t = useT();
  const notify = useAppStore((s) => s.notify);
  const updateCell = useNotebookStore((s) => s.updateCell);
  const removeCell = useNotebookStore((s) => s.removeCell);
  const moveCell = useNotebookStore((s) => s.moveCell);
  const addCell = useNotebookStore((s) => s.addCell);
  const runCell = useNotebookStore((s) => s.runCell);
  const runningCellId = useNotebookStore((s) => s.runningCellId);
  const hasProject = useProjectStore((s) => !!s.project);

  const [editing, setEditing] = useState(index === 0 && cell.source === '');

  const running = runningCellId === cell.id;

  const handleRun = () => {
    if (!hasProject) {
      notify('warning', t('figure.need_project'));
      return;
    }
    void runCell(cell.id);
  };

  return (
    <section className={`nb-cell nb-cell-${cell.type}${running ? ' nb-cell-running' : ''}`}>
      <div className="nb-cell-toolbar">
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => updateCell(cell.id, { type: cell.type === 'md' ? 'code' : 'md' })}
          title={t('notebook.toggle_type')}
        >
          {cell.type === 'md' ? 'MD' : 'PY'}
        </button>
        <button type="button" className="btn btn-sm" onClick={() => moveCell(cell.id, -1)} title={t('notebook.move_up')}>
          ↑
        </button>
        <button type="button" className="btn btn-sm" onClick={() => moveCell(cell.id, 1)} title={t('notebook.move_down')}>
          ↓
        </button>
        {cell.type === 'code' && (
          <button
            type="button"
            className="btn btn-sm btn-primary"
            disabled={running}
            onClick={handleRun}
          >
            {running ? t('notebook.running') : t('notebook.run')}
          </button>
        )}
        <span className="nb-cell-meta">
          {cell.durationMs !== undefined && (
            <span className={cell.ok ? 'nb-ok' : 'nb-fail'}>
              {cell.ok ? '✓' : '✗'} {cell.durationMs} ms
            </span>
          )}
        </span>
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => addCell('md', cell.id)}
          title={t('notebook.add_md_below')}
        >
          +MD
        </button>
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => addCell('code', cell.id)}
          title={t('notebook.add_code_below')}
        >
          +PY
        </button>
        <button
          type="button"
          className="btn btn-sm btn-danger"
          onClick={() => removeCell(cell.id)}
          title={t('common.delete')}
        >
          ✕
        </button>
      </div>

      {cell.type === 'md' ? (
        editing ? (
          <>
            <textarea
              className="input nb-source"
              rows={4}
              value={cell.source}
              onChange={(e) => updateCell(cell.id, { source: e.target.value })}
            />
            <button type="button" className="btn btn-sm" onClick={() => setEditing(false)}>
              {t('notebook.preview')}
            </button>
          </>
        ) : (
          <div
            className="nb-md"
            onClick={() => setEditing(true)}
            // mdToHtml escapes all raw HTML before applying its own markup.
            dangerouslySetInnerHTML={{
              __html: cell.source.trim() ? mdToHtml(cell.source) : `<p>${t('notebook.empty_md')}</p>`,
            }}
          />
        )
      ) : (
        <>
          <textarea
            className="input nb-source nb-source-code"
            rows={Math.max(3, cell.source.split('\n').length)}
            spellCheck={false}
            value={cell.source}
            onChange={(e) => updateCell(cell.id, { source: e.target.value })}
          />
          <CellOutputs outputs={cell.outputs} />
        </>
      )}
    </section>
  );
}

export default function NotebookPage() {
  const t = useT();
  const navigate = useNavigate();
  const project = useProjectStore((s) => s.project);
  const addCell = useNotebookStore((s) => s.addCell);
  const disposeRuntime = useNotebookStore((s) => s.disposeRuntime);

  const cells = project?.state.notebook?.cells ?? [];

  useEffect(() => disposeRuntime, [disposeRuntime]);

  return (
    <div className="nb-page">
      <header className="nb-header">
        <button type="button" className="btn" onClick={() => navigate('/workbench')}>
          ← {t('figure.back')}
        </button>
        <h1 className="figures-title">{t('notebook.title')}</h1>
        <button type="button" className="btn btn-sm" onClick={() => addCell('md')}>
          + MD
        </button>
        <button type="button" className="btn btn-sm" onClick={() => addCell('code')}>
          + PY
        </button>
      </header>

      {!project && <div className="empty-hint">{t('figure.need_project')}</div>}

      {project && cells.length === 0 && (
        <div className="empty-hint">{t('notebook.empty')}</div>
      )}

      <div className="nb-cells">
        {cells.map((cell, i) => (
          <CellItem key={cell.id} cell={cell} index={i} />
        ))}
      </div>
    </div>
  );
}
