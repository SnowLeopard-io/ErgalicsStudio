// ==========================================================================
// Desktop Git adapter — routes the GitAdapter contract over IPC to the
// simple-git bridge in the Electron main process.
// ==========================================================================
// Same interface as IsomorphicGitAdapter / NodeGitAdapter: the GitPanel and
// every git-backed feature keep calling getGitAdapter() unchanged.

import type {
  DiffOptions,
  DiffResult,
  GitAdapter,
  GitBranch,
  GitCommit,
  GitHook,
  GitRemote,
  GitStatus,
  LogOptions,
  MergeResult,
  RepoEntry,
} from '../git/types';
import { desktopBridge } from './index';

export class IpcGitAdapter implements GitAdapter {
  private call<T>(method: string, ...args: unknown[]): Promise<T> {
    return desktopBridge().git.invoke<T>(method, args);
  }

  init(repoPath: string): Promise<void> {
    return this.call('init', repoPath);
  }
  clone(url: string, targetPath: string): Promise<void> {
    return this.call('clone', url, targetPath);
  }
  isRepo(repoPath: string): Promise<boolean> {
    return this.call('isRepo', repoPath);
  }
  status(repoPath: string): Promise<GitStatus> {
    return this.call('status', repoPath);
  }
  log(repoPath: string, opts?: LogOptions): Promise<GitCommit[]> {
    return this.call('log', repoPath, opts);
  }
  diff(repoPath: string, opts?: DiffOptions): Promise<DiffResult[]> {
    return this.call('diff', repoPath, opts);
  }
  branches(repoPath: string): Promise<GitBranch[]> {
    return this.call('branches', repoPath);
  }
  remotes(repoPath: string): Promise<GitRemote[]> {
    return this.call('remotes', repoPath);
  }
  add(repoPath: string, files: string[]): Promise<void> {
    return this.call('add', repoPath, files);
  }
  commit(repoPath: string, message: string, opts?: { author?: { name: string; email: string } }): Promise<string> {
    return this.call('commit', repoPath, message, opts);
  }
  checkout(repoPath: string, ref: string, create?: boolean): Promise<void> {
    return this.call('checkout', repoPath, ref, create);
  }
  branch(repoPath: string, name: string, startPoint?: string): Promise<void> {
    return this.call('branch', repoPath, name, startPoint);
  }
  deleteBranch(repoPath: string, name: string, force?: boolean): Promise<void> {
    return this.call('deleteBranch', repoPath, name, force);
  }
  merge(repoPath: string, branch: string): Promise<MergeResult> {
    return this.call('merge', repoPath, branch);
  }
  push(repoPath: string, opts: { remote: string; branch: string; force?: boolean; setUpstream?: boolean }): Promise<void> {
    return this.call('push', repoPath, opts);
  }
  pull(repoPath: string, opts: { remote: string; branch: string }): Promise<void> {
    return this.call('pull', repoPath, opts);
  }
  fetch(repoPath: string, remote: string): Promise<void> {
    return this.call('fetch', repoPath, remote);
  }
  addRemote(repoPath: string, name: string, url: string): Promise<void> {
    return this.call('addRemote', repoPath, name, url);
  }
  removeRemote(repoPath: string, name: string): Promise<void> {
    return this.call('removeRemote', repoPath, name);
  }
  installHooks(repoPath: string, hooks: GitHook[]): Promise<void> {
    return this.call('installHooks', repoPath, hooks);
  }
  getHook(repoPath: string, type: string): Promise<string | null> {
    return this.call('getHook', repoPath, type);
  }
  removeHook(repoPath: string, type: string): Promise<void> {
    return this.call('removeHook', repoPath, type);
  }
  writeFile(repoPath: string, filePath: string, content: string): Promise<void> {
    return this.call('writeFile', repoPath, filePath, content);
  }
  readFile(repoPath: string, filePath: string): Promise<string> {
    return this.call('readFile', repoPath, filePath);
  }
  writeFileBinary(repoPath: string, filePath: string, data: Uint8Array): Promise<void> {
    return this.call('writeFileBinary', repoPath, filePath, data);
  }
  readFileBinary(repoPath: string, filePath: string): Promise<Uint8Array> {
    return this.call('readFileBinary', repoPath, filePath);
  }
  deleteEntry(repoPath: string, targetPath: string, isDir: boolean): Promise<void> {
    return this.call('deleteEntry', repoPath, targetPath, isDir);
  }
  renameEntry(repoPath: string, from: string, to: string): Promise<void> {
    return this.call('renameEntry', repoPath, from, to);
  }
  readDir(repoPath: string, dirPath: string): Promise<RepoEntry[]> {
    return this.call('readDir', repoPath, dirPath);
  }
  getRootDir(repoPath: string): Promise<string | null> {
    return this.call('getRootDir', repoPath);
  }
  getConfig(repoPath: string, key: string): Promise<string | null> {
    return this.call('getConfig', repoPath, key);
  }
  setConfig(repoPath: string, key: string, value: string): Promise<void> {
    return this.call('setConfig', repoPath, key, value);
  }
}
