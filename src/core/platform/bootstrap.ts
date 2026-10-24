// ==========================================================================
// Desktop bootstrap — swap platform adapters when running inside Electron.
// ==========================================================================
// Called once from the boot sequence. Only touches adapter singletons; UI
// and business code stay platform-agnostic.

import { setGitAdapter } from '../git';
import { IS_DESKTOP } from './index';
import { IpcGitAdapter } from './ipc-git-adapter';

let done = false;

/** Install desktop implementations of the platform adapters. Idempotent. */
export function initDesktopPlatform(): void {
  if (done || !IS_DESKTOP) return;
  done = true;
  // Real git via simple-git in the main process (no CORS proxy needed).
  setGitAdapter(new IpcGitAdapter());
}
