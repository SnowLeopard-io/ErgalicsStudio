// ==========================================================================
// Ergalics Studio — sidebar file explorer (Standard mode, activity bar)
//
// 两类数据源构成"工作区"视图：
//   1. 项目数据文件 —— project.data.files（用户导入的文本数据，扁平列表）。
//   2. 示例数据 —— examples/data/** 打包进应用的示例集，按真实目录结构
//      呈现为可折叠树（路径来自 dataFiles 的 glob 键）。
//
// 点击任意文件在面板下方显示原始数据预览（只读，截断到前 200 行）。
// 原始数据绝不在此处修改——预览是纯文本展示，无任何编辑入口。
// ==========================================================================

import { useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import { useT } from '@/i18n';
import { useAppStore } from '@/stores/appStore';
import { useProjectStore } from '@/stores/projectStore';
import { listBundledFilePaths, resolveBundledFile, resolveProjectFile } from '@/core/dataFiles';
import { DATA_FILE_ACCEPT } from '@/core/fileFormat';
import { ChevronDownIcon, ChevronRightIcon, CloseIcon, PlusIcon } from '@/components/icons';
import { EmptyState } from '@/components/EmptyState';

/** Raw preview shows at most this many lines (sidebar is a viewer, not an editor). */
const PREVIEW_MAX_LINES = 200;

interface TreeNode {
  name: string;
  /** Path relative to the examples root, e.g. `geo/points.xyz`. */
  path: string;
  children?: TreeNode[];
}

/** Build a sorted (directories first) tree from slash-separated file paths. */
function buildTree(paths: string[]): TreeNode[] {
  const root: TreeNode[] = [];
  for (const path of paths) {
    const parts = path.split('/');
    let level = root;
    for (let i = 0; i < parts.length; i++) {
      const isLeaf = i === parts.length - 1;
      const name = parts[i];
      let node = level.find((n) => n.name === name);
      if (!node) {
        node = { name, path: parts.slice(0, i + 1).join('/'), children: isLeaf ? undefined : [] };
        level.push(node);
      }
      if (!isLeaf) level = node.children as TreeNode[];
    }
  }
  const sortLevel = (nodes: TreeNode[]): TreeNode[] => {
    nodes.sort((a, b) => {
      const aDir = a.children ? 0 : 1;
      const bDir = b.children ? 0 : 1;
      return aDir !== bDir ? aDir - bDir : a.name.localeCompare(b.name);
    });
    for (const n of nodes) if (n.children) sortLevel(n.children);
    return nodes;
  };
  return sortLevel(root);
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

type PreviewTarget = { source: 'project' | 'example'; path: string };

export function FileExplorer() {
  const t = useT();
  const project = useProjectStore((s) => s.project);
  const addDataFile = useProjectStore((s) => s.addDataFile);
  const notify = useAppStore((s) => s.notify);

  const files = project?.data.files ?? [];
  const exampleTree = useMemo(() => buildTree(listBundledFilePaths()), []);

  // Example directories start expanded — the tree is small enough to scan.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<PreviewTarget | null>(null);
  const [content, setContent] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [importing, setImporting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Bundled examples resolve asynchronously (lazy raw-import chunks); project
  // files resolve synchronously but share the same promise flow.
  useEffect(() => {
    if (!preview) return;
    let cancelled = false;
    setFailed(false);
    setContent(null);
    const text =
      preview.source === 'project'
        ? Promise.resolve(resolveProjectFile(preview.path))
        : resolveBundledFile(preview.path);
    text
      .then((c) => {
        if (cancelled) return;
        if (c === undefined) setFailed(true);
        else setContent(c);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [preview]);

  const truncated = useMemo(() => {
    if (content === null) return null;
    const lines = content.split('\n');
    if (lines.length <= PREVIEW_MAX_LINES) return { text: content, cut: false };
    return { text: lines.slice(0, PREVIEW_MAX_LINES).join('\n'), cut: true };
  }, [content]);

  const toggleDir = (path: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const onImport = async (e: ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (picked.length === 0) return;
    setImporting(true);
    let failures = 0;
    for (const f of picked) {
      try {
        const id = await addDataFile(f);
        if (id === null) failures++;
      } catch {
        failures++;
      }
    }
    setImporting(false);
    if (failures > 0) notify('error', t('workbench.explorer.import_failed'));
  };

  const renderNodes = (nodes: TreeNode[], depth: number): ReactNode => (
    <ul className="explorer-list" role={depth === 0 ? 'tree' : 'group'}>
      {nodes.map((node) => {
        if (node.children) {
          const isCollapsed = collapsed.has(node.path);
          return (
            <li key={node.path}>
              <button
                type="button"
                className="explorer-row explorer-dir"
                style={{ paddingLeft: 6 + depth * 14 }}
                aria-expanded={!isCollapsed}
                onClick={() => toggleDir(node.path)}
              >
                {isCollapsed ? <ChevronRightIcon size={12} /> : <ChevronDownIcon size={12} />}
                <span className="explorer-name">{node.name}</span>
                <span className="explorer-count">{node.children.length}</span>
              </button>
              {!isCollapsed && renderNodes(node.children, depth + 1)}
            </li>
          );
        }
        const active = preview?.source === 'example' && preview.path === node.path;
        return (
          <li key={node.path}>
            <button
              type="button"
              className={`explorer-row explorer-file${active ? ' active' : ''}`}
              style={{ paddingLeft: 6 + depth * 14 }}
              title={node.path}
              onClick={() => setPreview({ source: 'example', path: node.path })}
            >
              <span className="explorer-name">{node.name}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );

  return (
    <div className="file-explorer">
      {!project && <EmptyState title={t('workbench.explorer.no_project')} />}

      {project && (
        <>
          <section className="explorer-section">
            <header className="explorer-section-header">
              <h4 className="explorer-heading">{t('workbench.explorer.data_files')}</h4>
              <button
                type="button"
                className="icon-btn"
                title={t('workbench.explorer.import')}
                aria-label={t('workbench.explorer.import')}
                disabled={importing}
                onClick={() => inputRef.current?.click()}
              >
                <PlusIcon size={15} />
              </button>
              <input
                ref={inputRef}
                type="file"
                multiple
                accept={DATA_FILE_ACCEPT}
                hidden
                onChange={(e) => void onImport(e)}
              />
            </header>
            {files.length === 0 ? (
              <p className="explorer-empty">{t('workbench.explorer.empty')}</p>
            ) : (
              <ul className="explorer-list" role="tree">
                {files.map((f) => {
                  const active = preview?.source === 'project' && preview.path === f.name;
                  return (
                    <li key={f.id}>
                      <button
                        type="button"
                        className={`explorer-row explorer-file${active ? ' active' : ''}`}
                        title={f.name}
                        onClick={() => setPreview({ source: 'project', path: f.name })}
                      >
                        <span className="explorer-name">{f.name}</span>
                        <span className="explorer-meta">{formatSize(f.size)}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className="explorer-section">
            <header className="explorer-section-header">
              <h4 className="explorer-heading">{t('workbench.explorer.examples')}</h4>
            </header>
            {exampleTree.length > 0 ? (
              renderNodes(exampleTree, 0)
            ) : (
              <p className="explorer-empty">{t('workbench.explorer.empty')}</p>
            )}
          </section>
        </>
      )}

      {preview && (
        <section className="explorer-preview">
          <header className="explorer-preview-header">
            <span className="explorer-preview-name" title={preview.path}>
              {preview.path.split('/').pop()}
            </span>
            <button
              type="button"
              className="icon-btn"
              aria-label={t('common.close')}
              title={t('common.close')}
              onClick={() => setPreview(null)}
            >
              <CloseIcon size={13} />
            </button>
          </header>
          {failed ? (
            <p className="explorer-empty">{t('workbench.explorer.load_failed')}</p>
          ) : content === null ? (
            <p className="explorer-empty">
              <span className="spinner" />
            </p>
          ) : (
            <>
              <pre className="explorer-preview-content">{truncated?.text}</pre>
              {truncated?.cut && (
                <p className="explorer-preview-note">{t('workbench.explorer.preview_truncated')}</p>
              )}
            </>
          )}
        </section>
      )}
    </div>
  );
}
