// ==========================================================================
// Ergalics Studio — restore a project's workbench session
//
// Reopens the canvas tabs (files / editors / surfaces / suites), the front
// tab and the last run's console for a project, all from the persisted
// session record. Content is re-read from the workspace tree, so a file that
// changed on disk shows its current version instead of a stale copy.
// ==========================================================================

import { useAppStore } from '@/stores/appStore';
import { useEditorStore } from '@/stores/editorStore';
import { logger } from '@/core/logger';
import type { WorkbenchSession } from '@/stores/workbenchSession';
import {
  openProjectEditorTab,
  openProjectPreview,
  openProjectSurface,
} from '@/core/workspace/open-file';

/**
 * Apply a stored session. `isCurrent` lets the caller abort when the user
 * switched projects while a tab was being read from disk.
 */
export async function restoreWorkbenchSession(
  saved: WorkbenchSession | null,
  isCurrent: () => boolean = () => true,
): Promise<void> {
  if (!saved) return;
  if (!isCurrent()) return;

  // Expanded folders go first: the explorer mounts with the restored tree.
  useAppStore.setState({ explorerExpanded: saved.expandedDirs });

  // Last run's output: the console panel and terminal show it again.
  if (saved.console.length > 0 || saved.error !== null) {
    useEditorStore.setState({ console: saved.console, error: saved.error });
  }

  for (const tab of saved.tabs) {
    if (!isCurrent()) return;
    try {
      switch (tab.kind) {
        case 'file':
          await openProjectPreview(tab.path);
          break;
        case 'editor':
          await openProjectEditorTab(tab.path, tab.editor);
          break;
        case 'surface':
          await openProjectSurface(tab.mode, tab.path);
          break;
        case 'tool':
          useAppStore.getState().setEmbeddedTool(tab.id);
          break;
        case 'settings':
          useAppStore.getState().openSettingsTab();
          break;
      }
    } catch (err) {
      // One unreadable file must not abort the rest of the layout.
      logger.warn('project', 'workbench tab restore failed', err);
    }
  }

  if (!isCurrent()) return;

  // Front tab: the one that was in front, else the first that reopened, else
  // the plugin canvas (the tab strip may be empty when files disappeared).
  const app = useAppStore.getState();
  const active =
    saved.activeTab && app.canvasTabs.some((tab) => tab.key === saved.activeTab)
      ? saved.activeTab
      : (app.canvasTabs[0]?.key ?? null);
  if (active) app.activateTab(active);
  else app.showPluginCanvas();
}
