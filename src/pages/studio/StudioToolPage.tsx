// ==========================================================================
// Ergalics Studio — /studio/:toolId
//
// Single route for all research tools. The registry resolves the lazy page
// component; this wrapper provides the Suspense skeleton, one-time project
// restore for deep links/bookmarks, and the EmptyProject gate for
// project-bound tools (UI design guide §2).
// ==========================================================================

import { Suspense, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ToolShell, ToolSkeleton } from '@/components/ToolShell';
import { EmptyProject, EmptyState } from '@/components/EmptyState';
import { useProjectStore } from '@/stores/projectStore';
import { useT } from '@/i18n';
import { getTool } from '@/pages/research/toolRegistry';
import { StatusBar } from '@/pages/workbench/StatusBar';
import { ArrowLeftIcon } from '@/components/icons';

export default function StudioToolPage() {
  const { toolId } = useParams<{ toolId: string }>();
  const t = useT();
  const navigate = useNavigate();
  const toolDef = getTool(toolId);
  const project = useProjectStore((s) => s.project);

  // Deep link / cold start: the workbench normally restores the most recent
  // project; do the same here (once), but never auto-create an empty one —
  // project-bound tools show EmptyProject with explicit create/open actions.
  const [restoring, setRestoring] = useState(() => !useProjectStore.getState().project);
  useEffect(() => {
    if (useProjectStore.getState().project) {
      setRestoring(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const store = useProjectStore.getState();
        await store.loadRecent();
        const recent = useProjectStore.getState().recent;
        if (!cancelled && recent[0] && !useProjectStore.getState().project) {
          await useProjectStore.getState().openProject(recent[0].id);
        }
      } catch {
        /* EmptyProject below is the fallback surface. */
      } finally {
        if (!cancelled) setRestoring(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!toolDef) {
    return (
      <div className="tool-shell">
        <header className="tool-topbar">
          <div className="tool-topbar-main">
            <button type="button" className="btn btn-sm tool-back" onClick={() => navigate('/')}>
              <ArrowLeftIcon size={14} /> {t('figure.back')}
            </button>
          </div>
        </header>
        <main className="tool-body">
          <div className="tool-content">
            <EmptyState title={t('launcher.unknown_title')} description={t('launcher.unknown_desc')} />
          </div>
        </main>
        <StatusBar />
      </div>
    );
  }

  const Page = toolDef.component;

  if (toolDef.requireProject && restoring) {
    return <ToolSkeleton toolId={toolId} />;
  }

  return (
    <Suspense fallback={<ToolSkeleton toolId={toolId} />}>
      {toolDef.requireProject && !project ? (
        <ToolShell toolId={toolDef.id}>
          <EmptyProject />
        </ToolShell>
      ) : (
        <Page />
      )}
    </Suspense>
  );
}
