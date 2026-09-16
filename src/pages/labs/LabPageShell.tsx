import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useT } from '@/i18n';

/**
 * Shared shell for the lab pages (research tools promoted from TopBar
 * dialogs): the same header as the figure-family pages — back to workbench
 * plus the tool title — wrapping an unconstrained scrollable body so every
 * research surface shares one look.
 */
export function LabPageShell({ title, children }: { title: string; children: ReactNode }) {
  const t = useT();
  const navigate = useNavigate();
  return (
    <div className="figures-page">
      <header className="figures-header">
        <button type="button" className="btn" onClick={() => navigate('/workbench')}>
          ← {t('figure.back')}
        </button>
        <h1 className="figures-title">{title}</h1>
      </header>
      <div className="lab-page">{children}</div>
    </div>
  );
}
