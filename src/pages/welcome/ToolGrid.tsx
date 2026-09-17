// ==========================================================================
// Ergalics Studio — welcome-page research tool launch grid
//
// All 14 grid-registered tools (the general analysis surface keeps its own
// workbench button) grouped into the five mutually-exclusive discipline
// groups. A filter box flattens the groups while searching. Cards record
// recency (shared with the top-bar launcher) and route to /studio/<id>.
// ==========================================================================

import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useT } from '@/i18n';
import { ToolIcon, ArrowRightIcon, SearchIcon } from '@/components/icons';
import {
  GRID_GROUPS,
  GRID_TOOLS,
  getTool,
  type ResearchGroupId,
} from '@/pages/research/toolRegistry';
import { recordTool } from '@/core/recentTools';

export function ToolGrid() {
  const t = useT();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');

  const q = query.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!q) return GRID_TOOLS;
    return GRID_TOOLS.filter((toolDef) => {
      const title = t(toolDef.titleKey).toLowerCase();
      const desc = t(toolDef.descKey).toLowerCase();
      return toolDef.id.includes(q) || title.includes(q) || desc.includes(q);
    });
  }, [q, t]);

  const open = (id: string) => {
    const toolDef = getTool(id);
    if (!toolDef) return;
    recordTool(id);
    navigate(toolDef.path);
  };

  return (
    <section className="welcome-tools card" aria-label={t('welcome.tools.title')}>
      <div className="welcome-tools-head">
        <h2 className="welcome-section-title">{t('welcome.tools.title')}</h2>
        <div className="menu-filter welcome-tools-filter">
          <SearchIcon size={13} />
          <input
            className="menu-filter-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('launcher.search')}
            aria-label={t('launcher.search')}
          />
        </div>
      </div>

      {filtered.length === 0 && <p className="tool-grid-empty">{t('launcher.empty')}</p>}

      {q
        ? (
          <div className="tool-grid">
            {filtered.map((toolDef) => (
              <ToolCard key={toolDef.id} id={toolDef.id} onOpen={open} />
            ))}
          </div>
        )
        : GRID_GROUPS.map((group) => {
            const groupTools = filtered.filter((x) => x.group === (group as ResearchGroupId));
            if (groupTools.length === 0) return null;
            return (
              <div key={group} className="tool-grid-group">
                <h3 className="tool-grid-label">{t(`tool.group.${group}`)}</h3>
                <div className="tool-grid">
                  {groupTools.map((toolDef) => (
                    <ToolCard key={toolDef.id} id={toolDef.id} onOpen={open} />
                  ))}
                </div>
              </div>
            );
          })}
    </section>
  );
}

function ToolCard({ id, onOpen }: { id: string; onOpen: (id: string) => void }) {
  const t = useT();
  const toolDef = getTool(id)!;
  return (
    <button type="button" className="tool-card" onClick={() => onOpen(id)}>
      <span className="tool-card-icon" aria-hidden="true">
        <ToolIcon kind={toolDef.icon} size={20} />
      </span>
      <span className="tool-card-text">
        <span className="tool-card-title">{t(toolDef.titleKey)}</span>
        <span className="tool-card-desc">{t(toolDef.descKey)}</span>
      </span>
      <ArrowRightIcon size={15} />
    </button>
  );
}
