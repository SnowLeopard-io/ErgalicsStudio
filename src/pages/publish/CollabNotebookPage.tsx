// ==========================================================================
// Ergalics Studio — collaborative research notebook (/studio/collab-notebook)
//
// Cells are CRDTs (see core/publish/collab): every edit is a minimal
// replaceAll, and snapshots are exchanged over a BroadcastChannel room keyed
// by notebook id, so two tabs on the same origin converge without a server.
// Section-level comments, history checkpoints + diffs, Markdown/HTML/DOCX/
// Jupyter/PDF export and a Git workspace snapshot round out the surface.
// ==========================================================================

import { useEffect, useMemo, useRef, useState } from 'react';
import { useT } from '@/i18n';
import { ToolShell } from '@/components/ToolShell';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { useAppStore } from '@/stores/appStore';
import { usePublishStore } from '@/stores/publishStore';
import {
  TextCrdt,
  crdtText,
  createCollabCell,
  createCollabChannel,
  createCollabNote,
  diffText,
  mergeCollabNotes,
  noteCheckpoint,
  notebookToMarkdown,
  type CollabCell,
  type CollabMessage,
  type CollabNote,
  type TextDiffOp,
} from '@/core/publish/collab';
import {
  notebookFileStem,
  notebookToDocx,
  notebookToHtml,
  notebookToIpynb,
} from '@/core/publish/export';
import { buildNotebookPdf } from '@/core/publish/pdf';
import { downloadBlob } from '@/core/download';
import {
  downloadText,
  readTextFile,
  usePublishState,
  writePublishArtifacts,
} from './shared';

function updateCellText(note: CollabNote, cellId: string, text: string): CollabNote {
  return {
    ...note,
    cells: note.cells.map((cell) => {
      if (cell.id !== cellId) return cell;
      const crdt = new TextCrdt(cell.crdt.site, cell.crdt);
      crdt.replaceAll(text);
      return { ...cell, crdt: crdt.snapshot() };
    }),
    updatedAt: Date.now(),
  };
}

function markdownToCells(markdown: string): CollabCell[] {
  const cells: CollabCell[] = [];
  let buffer: string[] = [];
  let inCode = false;
  const flush = () => {
    const text = buffer.join('\n').trim();
    buffer = [];
    if (text) cells.push(createCollabCell(inCode ? 'code' : 'md', text));
  };
  for (const line of markdown.split(/\r?\n/)) {
    if (line.trim().startsWith('```')) {
      if (inCode) {
        inCode = false;
        flush();
      } else {
        flush();
        inCode = true;
      }
      continue;
    }
    buffer.push(line);
  }
  flush();
  return cells.length > 0 ? cells : [createCollabCell('md', markdown)];
}

function DiffView({ ops }: { ops: TextDiffOp[] }) {
  return (
    <pre className="publish-diff">
      {ops.map((op, i) => (
        <span key={i} className={`publish-diff-${op.type}`}>
          {op.text}
          {'\n'}
        </span>
      ))}
    </pre>
  );
}

export default function CollabNotebookPage() {
  const t = useT();
  const notify = useAppStore((s) => s.notify);
  const publish = usePublishState();
  const saveNote = usePublishStore((s) => s.saveNote);
  const deleteNote = usePublishStore((s) => s.deleteNote);
  const setActiveNote = usePublishStore((s) => s.setActiveNote);

  const notes = publish.notes;
  const note =
    notes.find((n) => n.id === publish.activeNoteId) ?? notes[0] ?? null;
  const noteRef = useRef<CollabNote | null>(note);
  noteRef.current = note;

  const [deleteTarget, setDeleteTarget] = useState<CollabNote | null>(null);
  const [deleteCell, setDeleteCell] = useState<CollabCell | null>(null);
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});
  const [peers, setPeers] = useState<string[]>([]);
  const [historyId, setHistoryId] = useState<string | null>(null);
  const [mergedNotice, setMergedNotice] = useState(false);
  const channelRef = useRef<ReturnType<typeof createCollabChannel>>(null);

  const persist = (next: CollabNote, broadcast = true) => {
    saveNote(next);
    if (broadcast) {
      channelRef.current?.send({
        type: 'state',
        from: next.cells[0]?.crdt.site ?? 'local',
        note: next,
      });
    }
  };

  // Join the room for the active notebook. `note.id` (not the note object) is
  // the dependency: typing must not tear down and recreate the channel.
  const noteId = note?.id ?? null;
  useEffect(() => {
    if (!noteId) {
      channelRef.current?.close();
      channelRef.current = null;
      return;
    }
    // Fresh room: drop peers learned under the previous notebook.
    setPeers([]);
    const channel = createCollabChannel(noteId, (message: CollabMessage) => {
      const current = noteRef.current;
      if (!current || current.id !== noteId) return;
      setPeers((prev) => (prev.includes(message.from) ? prev : [...prev, message.from]));
      if (message.type === 'request') {
        channelRef.current?.send({
          type: 'state',
          from: current.cells[0]?.crdt.site ?? 'local',
          note: current,
        });
        return;
      }
      if (message.type === 'state') {
        const merged = mergeCollabNotes(current, message.note);
        const changed = notebookToMarkdown(merged) !== notebookToMarkdown(current);
        if (changed) {
          saveNote(merged);
          setMergedNotice(true);
        }
      }
    });
    channelRef.current = channel;
    channel?.send({ type: 'request', from: 'local' });
    return () => {
      channel?.close();
      if (channelRef.current === channel) channelRef.current = null;
    };
  }, [noteId, saveNote]);

  useEffect(() => {
    if (!mergedNotice) return;
    const timer = setTimeout(() => setMergedNotice(false), 2200);
    return () => clearTimeout(timer);
  }, [mergedNotice]);

  const createNote = () => {
    const record = createCollabNote('Research notebook');
    saveNote(record);
    setHistoryId(null);
  };

  const importMarkdown = async (file: File | undefined) => {
    if (!file) return;
    const text = await readTextFile(file);
    const record: CollabNote = {
      id: crypto.randomUUID(),
      title: file.name.replace(/\.[^.]+$/, '') || 'Imported notebook',
      cells: markdownToCells(text),
      updatedAt: Date.now(),
      history: [],
    };
    saveNote(record);
    notify('success', t('publish.common.saved'));
  };

  const addCell = (type: 'md' | 'code') => {
    if (!note) return;
    persist({
      ...note,
      cells: [...note.cells, createCollabCell(type, type === 'code' ? '# code' : '')],
      updatedAt: Date.now(),
    });
  };

  const patchCell = (cellId: string, patch: Partial<CollabCell>) => {
    if (!note) return;
    persist({
      ...note,
      cells: note.cells.map((cell) => (cell.id === cellId ? { ...cell, ...patch } : cell)),
      updatedAt: Date.now(),
    });
  };

  const removeCell = (cellId: string) => {
    if (!note) return;
    persist({ ...note, cells: note.cells.filter((c) => c.id !== cellId), updatedAt: Date.now() });
  };

  const addComment = (cell: CollabCell) => {
    const text = (commentDrafts[cell.id] ?? '').trim();
    if (!text || !note) return;
    patchCell(cell.id, {
      comments: [
        ...cell.comments,
        {
          id: crypto.randomUUID(),
          author: `${t('publish.collab.author')} ${(cell.crdt.site || 'local').slice(0, 4)}`,
          text,
          createdAt: Date.now(),
        },
      ],
    });
    setCommentDrafts((prev) => ({ ...prev, [cell.id]: '' }));
  };

  const toggleComment = (cell: CollabCell, commentId: string) => {
    patchCell(cell.id, {
      comments: cell.comments.map((c) =>
        c.id === commentId ? { ...c, resolved: !c.resolved } : c,
      ),
    });
  };

  const checkpoint = () => {
    if (!note) return;
    const point = noteCheckpoint(note);
    persist({ ...note, history: [point, ...(note.history ?? [])].slice(0, 30) });
  };

  const selectedCheckpoint = note?.history?.find((h) => h.id === historyId) ?? null;
  const checkpointDiff = useMemo(() => {
    if (!note || !selectedCheckpoint) return [];
    const before = selectedCheckpoint.cells.map((c) => c.text).join('\n\n');
    const after = notebookToMarkdown(note);
    return diffText(before, after);
  }, [note, selectedCheckpoint]);

  const exportDocx = () => {
    if (!note) return;
    downloadBlob(
      `${notebookFileStem(note)}.docx`,
      notebookToDocx(note),
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
  };

  const exportPdf = async () => {
    if (!note) return;
    try {
      downloadBlob(
        `${notebookFileStem(note)}.pdf`,
        await buildNotebookPdf(note),
        'application/pdf',
      );
    } catch (err) {
      notify('error', t('publish.common.error', { reason: String(err) }));
    }
  };

  const saveWorkspace = async () => {
    if (!note) return;
    try {
      const stem = notebookFileStem(note);
      const files: Array<{ path: string; content?: string; bytes?: Uint8Array }> = [
        { path: `manuscript/notebook-${stem}.md`, content: notebookToMarkdown(note) },
        { path: `manuscript/notebook-${stem}.ipynb`, content: notebookToIpynb(note) },
      ];
      try {
        files.push({ path: `manuscript/notebook-${stem}.pdf`, bytes: await buildNotebookPdf(note) });
      } catch {
        // Keep the text exports even if PDF layout fails.
      }
      await writePublishArtifacts(files, `notebook ${note.title}`);
      notify('success', t('publish.common.git_saved'));
    } catch (err) {
      notify('error', t('publish.common.error', { reason: String(err) }));
    }
  };

  return (
    <ToolShell toolId="collab-notebook">
      <div className="publish-page">
        <aside className="publish-side">
          <div className="publish-side-head">
            <h2 className="publish-side-title">{t('publish.collab.notes')}</h2>
            <button type="button" className="btn btn-sm btn-primary" onClick={createNote}>
              + {t('publish.collab.new')}
            </button>
          </div>
          <ul className="publish-list publish-list-scroll">
            {notes.map((n) => (
              <li key={n.id} className={`publish-list-item${n.id === note?.id ? ' is-active' : ''}`}>
                <button
                  type="button"
                  className="publish-list-select"
                  onClick={() => {
                    setActiveNote(n.id);
                    setHistoryId(null);
                  }}
                >
                  <span className="publish-list-name">{n.title}</span>
                  <span className="publish-list-meta">
                    {n.cells.length} cells · {new Date(n.updatedAt).toLocaleString()}
                  </span>
                </button>
                <button
                  type="button"
                  className="publish-delete"
                  aria-label={t('publish.common.delete')}
                  title={t('publish.common.delete')}
                  onClick={() => setDeleteTarget(n)}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
          {notes.length === 0 && <p className="publish-muted">{t('publish.common.none')}</p>}
          <label className="btn btn-sm publish-file-btn">
            {t('publish.collab.import_md')}
            <input
              type="file"
              accept=".md,.markdown,text/plain"
              hidden
              onChange={(e) => void importMarkdown(e.target.files?.[0])}
            />
          </label>
          <div className="publish-card publish-peer-card">
            <div className="publish-mini-title">{t('publish.collab.peers')}</div>
            <div className="publish-tags">
              <span className="publish-tag is-live">● {t('publish.collab.device_site')}</span>
              {peers.map((peer) => (
                <span key={peer} className="publish-tag">{peer.slice(0, 6)}</span>
              ))}
            </div>
            <p className="publish-hint">{t('publish.collab.offline')}</p>
          </div>
        </aside>

        <section className="publish-main">
          {!note ? (
            <div className="publish-empty">{t('publish.common.none')}</div>
          ) : (
            <>
              <div className="publish-card">
                <label className="publish-label">
                  {t('publish.collab.title')}
                  <input
                    className="input"
                    value={note.title}
                    onChange={(e) => persist({ ...note, title: e.target.value, updatedAt: Date.now() })}
                  />
                </label>
                <div className="publish-row publish-between publish-wrap">
                  <div className="publish-row">
                    <button type="button" className="btn btn-sm" onClick={() => addCell('md')}>
                      {t('publish.collab.add_md')}
                    </button>
                    <button type="button" className="btn btn-sm" onClick={() => addCell('code')}>
                      {t('publish.collab.add_code')}
                    </button>
                    <button type="button" className="btn btn-sm" onClick={checkpoint}>
                      {t('publish.collab.checkpoint')}
                    </button>
                  </div>
                  <div className="publish-row publish-wrap">
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => downloadText(`${notebookFileStem(note)}.md`, notebookToMarkdown(note), 'text/markdown;charset=utf-8')}
                    >
                      {t('publish.collab.export_md')}
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => downloadText(`${notebookFileStem(note)}.html`, notebookToHtml(note), 'text/html;charset=utf-8')}
                    >
                      {t('publish.collab.export_html')}
                    </button>
                    <button type="button" className="btn btn-sm" onClick={exportDocx}>
                      {t('publish.collab.export_docx')}
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => downloadText(`${notebookFileStem(note)}.ipynb`, notebookToIpynb(note), 'application/x-ipynb+json')}
                    >
                      {t('publish.collab.export_ipynb')}
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => void exportPdf()}
                    >
                      {t('publish.collab.export_pdf')}
                    </button>
                    <button type="button" className="btn btn-sm btn-primary" onClick={() => void saveWorkspace()}>
                      {t('publish.collab.save_workspace')}
                    </button>
                  </div>
                </div>
                {mergedNotice && <p className="publish-success">{t('publish.collab.merge_remote')}</p>}
              </div>

              {note.cells.map((cell, index) => (
                <div key={cell.id} className="publish-card publish-cell">
                  <div className="publish-row publish-between">
                    <span className="publish-cell-tag">
                      {index + 1} · {cell.type === 'code' ? t('publish.collab.cell_code') : t('publish.collab.cell_md')}
                    </span>
                    <div className="publish-row">
                      <select
                        className="select"
                        value={cell.type}
                        onChange={(e) => patchCell(cell.id, { type: e.target.value as CollabCell['type'] })}
                        aria-label={t('publish.collab.cell_md')}
                      >
                        <option value="md">{t('publish.collab.cell_md')}</option>
                        <option value="code">{t('publish.collab.cell_code')}</option>
                      </select>
                      <button
                        type="button"
                        className="publish-delete is-always"
                        aria-label={t('publish.common.delete')}
                        title={t('publish.common.delete')}
                        onClick={() => setDeleteCell(cell)}
                      >
                        ×
                      </button>
                    </div>
                  </div>
                  <textarea
                    className={`publish-cell-input${cell.type === 'code' ? ' publish-mono' : ''}`}
                    value={crdtText(cell.crdt)}
                    onChange={(e) => persist(updateCellText(note, cell.id, e.target.value))}
                    rows={cell.type === 'code' ? 5 : 4}
                    spellCheck={false}
                    aria-label={t('publish.collab.cell_md')}
                  />

                  <div className="publish-comments">
                    <div className="publish-mini-title">
                      {t('publish.collab.comments')} ({cell.comments.length})
                    </div>
                    {cell.comments.map((comment) => (
                      <div key={comment.id} className={`publish-comment${comment.resolved ? ' is-resolved' : ''}`}>
                        <div className="publish-comment-head">
                          <strong>{comment.author}</strong>
                          <span className="publish-muted">
                            {new Date(comment.createdAt).toLocaleString()}
                          </span>
                          <button
                            type="button"
                            className="btn btn-sm"
                            onClick={() => toggleComment(cell, comment.id)}
                          >
                            {comment.resolved ? t('publish.collab.resolved') : t('publish.collab.resolve')}
                          </button>
                        </div>
                        <p>{comment.text}</p>
                      </div>
                    ))}
                    <div className="publish-row">
                      <input
                        className="input publish-grow"
                        placeholder={t('publish.collab.comment_placeholder')}
                        value={commentDrafts[cell.id] ?? ''}
                        onChange={(e) =>
                          setCommentDrafts((prev) => ({ ...prev, [cell.id]: e.target.value }))
                        }
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') addComment(cell);
                        }}
                      />
                      <button type="button" className="btn btn-sm" onClick={() => addComment(cell)}>
                        {t('publish.collab.add_comment')}
                      </button>
                    </div>
                  </div>
                </div>
              ))}

              <div className="publish-card">
                <h3 className="publish-card-title">{t('publish.collab.history')}</h3>
                {(note.history ?? []).length === 0 ? (
                  <p className="publish-hint">{t('publish.collab.no_history')}</p>
                ) : (
                  <ul className="publish-plain-list">
                    {(note.history ?? []).map((point) => (
                      <li key={point.id}>
                        <button
                          type="button"
                          className="publish-link"
                          onClick={() => setHistoryId(point.id === historyId ? null : point.id)}
                        >
                          {new Date(point.at).toLocaleString()}
                        </button>
                        <span className="publish-muted"> · {point.cells.length} cells</span>
                      </li>
                    ))}
                  </ul>
                )}
                {selectedCheckpoint && (
                  <>
                    <div className="publish-mini-title">{t('publish.collab.diff')}</div>
                    {checkpointDiff.every((op) => op.type === 'equal') ? (
                      <p className="publish-hint">{t('publish.collab.diff_equal')}</p>
                    ) : (
                      <DiffView ops={checkpointDiff} />
                    )}
                  </>
                )}
              </div>
            </>
          )}
        </section>
      </div>

      <ConfirmDialog
        open={deleteTarget !== null}
        title={t('publish.common.delete')}
        message={t('publish.common.delete_confirm', { name: deleteTarget?.title ?? '' })}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget) deleteNote(deleteTarget.id);
          setDeleteTarget(null);
        }}
      />
      <ConfirmDialog
        open={deleteCell !== null}
        title={t('publish.common.delete')}
        message={t('publish.common.delete_confirm', { name: t('publish.collab.cell_md') })}
        onClose={() => setDeleteCell(null)}
        onConfirm={() => {
          if (deleteCell) removeCell(deleteCell.id);
          setDeleteCell(null);
        }}
      />
    </ToolShell>
  );
}
