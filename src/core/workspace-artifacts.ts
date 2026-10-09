// ==========================================================================
// Ergalics Studio — save lab artifacts into the project workspace
//
// 科研模块（labs）产出的图表 / 清洗数据 / 统计结果等工件的统一入库入口：
// 写入项目 Git 仓库工作树的标准骨架目录（figures/ data/ runs/，
// SKEL §3.1），重名自动追加序号，成功后 bumpFileOps 让侧栏文件
// 资源管理器刷新。只写工作树，不做 git add/commit。
// ==========================================================================

import { getGitAdapter } from './git';
import { getProjectRepoPath } from '@/stores/projectStore';
import { useAppStore } from '@/stores/appStore';
import type { Project } from '@/types/project';

/** Skeleton dirs of the project template; '' = repo root (e.g. repro.lock). */
export type ArtifactDir =
  | 'figures'
  | 'data'
  | 'runs'
  | 'manuscript'
  | 'code'
  | '';

/** Join a skeleton dir + filename into a repo-relative path. */
const joinPath = (dir: string, name: string) => (dir ? `${dir}/${name}` : name);

/** Pick `name`, or `name (2)`, `(3)`, … when the target already exists. */
async function uniqueName(
  repoPath: string,
  dir: string,
  name: string,
): Promise<string> {
  const adapter = getGitAdapter();
  let names: Set<string>;
  try {
    const entries = await adapter.readDir(repoPath, dir);
    names = new Set(entries.map((e) => e.name));
  } catch {
    names = new Set();
  }
  if (!names.has(name)) return name;
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  for (let i = 2; ; i += 1) {
    const cand = `${stem} (${i})${ext}`;
    if (!names.has(cand)) return cand;
  }
}

async function saveArtifact(
  project: Project,
  dir: ArtifactDir,
  filename: string,
  write: (repoPath: string, path: string) => Promise<void>,
): Promise<string> {
  const repoPath = getProjectRepoPath(project);
  const finalName = await uniqueName(repoPath, dir, filename);
  const path = joinPath(dir, finalName);
  await write(repoPath, path);
  useAppStore.getState().bumpFileOps(); // refresh the sidebar explorer
  return path;
}

/** Save UTF-8 text (SVG chart, CSV, JSON snapshot, …) into a skeleton dir. */
export function saveTextArtifact(
  project: Project,
  dir: ArtifactDir,
  filename: string,
  content: string,
): Promise<string> {
  return saveArtifact(project, dir, filename, (repoPath, path) =>
    getGitAdapter().writeFile(repoPath, path, content),
  );
}

/** Save binary data (PNG snapshot, PDF, …) into a skeleton dir. */
export function saveBinaryArtifact(
  project: Project,
  dir: ArtifactDir,
  filename: string,
  data: Uint8Array,
): Promise<string> {
  return saveArtifact(project, dir, filename, (repoPath, path) =>
    getGitAdapter().writeFileBinary(repoPath, path, data),
  );
}
