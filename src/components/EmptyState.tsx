import { useRef, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useT } from '@/i18n';
import { useProjectStore } from '@/stores/projectStore';
import { useAppStore } from '@/stores/appStore';
import { FolderOpenIcon, LayersIcon, PlusIcon } from './icons';

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  /** Action buttons rendered in a centered row. */
  actions?: ReactNode;
  className?: string;
}

/**
 * Canonical empty surface: icon + headline + one line of guidance +
 * optional actions. Replaces the scattered bare `.empty-hint` paragraphs
 * so no tool ever shows a dead blank area (UI design guide §7).
 */
export function EmptyState({ icon, title, description, actions, className }: EmptyStateProps) {
  return (
    <div className={`empty-state${className ? ` ${className}` : ''}`}>
      {icon && <div className="empty-state-icon">{icon}</div>}
      <h3 className="empty-state-title">{title}</h3>
      {description && <p className="empty-state-desc">{description}</p>}
      {actions && <div className="empty-state-actions">{actions}</div>}
    </div>
  );
}

/**
 * Shown by the ToolShell when a project-bound research tool is opened
 * without an active project. Offers the same three exits everywhere:
 * create / open from disk / back to the welcome surface.
 */
export function EmptyProject({ compact }: { compact?: boolean }) {
  const t = useT();
  const navigate = useNavigate();
  const notify = useAppStore((s) => s.notify);
  const createProject = useProjectStore((s) => s.createProject);
  const openFromFile = useProjectStore((s) => s.openFromFile);
  const fileInputRef = useRef<HTMLInputElement>(null);

  return (
    <EmptyState
      className={compact ? 'empty-state-compact' : undefined}
      icon={<LayersIcon size={30} strokeWidth={1.4} />}
      title={t('empty.project.title')}
      description={t('empty.project.desc')}
      actions={
        <>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => {
              void createProject('').then(() => notify('success', t('project.new')));
            }}
          >
            <PlusIcon size={14} /> {t('project.new')}
          </button>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => fileInputRef.current?.click()}
          >
            <FolderOpenIcon size={14} /> {t('project.open')}
          </button>
          <button type="button" className="btn btn-sm" onClick={() => navigate('/')}>
            {t('empty.project.back')}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".clproj,application/json"
            style={{ display: 'none' }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) {
                void openFromFile(file).catch(() => notify('error', t('project.open_failed')));
              }
              e.target.value = '';
            }}
          />
        </>
      }
    />
  );
}
