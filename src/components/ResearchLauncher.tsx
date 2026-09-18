// ==========================================================================
// Ergalics Studio — research tool launcher (top-bar "lab" dropdown)
//
// Replaces the old flat 14-item menu: a "recent" group (most recently used
// tools with a badge) followed by all tools grouped by discipline, with a
// filter input and full keyboard navigation. Every item shows icon + name
// + one-line description so the tool can be identified before opening.
// ==========================================================================

import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useT } from '@/i18n';
import { Dropdown, type MenuItemDef } from './Dropdown';
import { ToolIcon, FlaskIcon, ChevronDownIcon } from './icons';
import { GRID_GROUPS, GRID_TOOLS, getTool, type ResearchGroupId } from '@/pages/research/toolRegistry';
import { getRecentTools, recordTool } from '@/core/recentTools';

export function ResearchLauncher() {
  const t = useT();
  const navigate = useNavigate();

  const items = useMemo<MenuItemDef[]>(() => {
    const open = (id: string) => {
      const toolDef = getTool(id);
      if (!toolDef) return;
      recordTool(id);
      navigate(toolDef.path);
    };

    const richItem = (id: string, badge?: string, keyPrefix = ''): MenuItemDef => {
      const toolDef = getTool(id)!;
      const title = t(toolDef.titleKey);
      const desc = t(toolDef.descKey);
      return {
        key: `${keyPrefix}${id}`,
        icon: <ToolIcon kind={toolDef.icon} size={18} />,
        label: title,
        description: desc,
        badge: badge ? <span className="menu-item-tag">{badge}</span> : undefined,
        searchText: `${id} ${title} ${desc}`,
        onClick: () => open(id),
      };
    };

    const list: MenuItemDef[] = [];
    const recent = getRecentTools(3).filter((id) => GRID_TOOLS.some((x) => x.id === id));
    if (recent.length > 0) {
      list.push({ key: 'hdr-recent', header: true, label: t('launcher.recent_group') });
      recent.forEach((id) => list.push(richItem(id, t('launcher.recent'), 'recent-')));
      list.push({ key: 'separator', label: '' });
    }

    for (const group of GRID_GROUPS) {
      const groupTools = GRID_TOOLS.filter((x) => x.group === (group as ResearchGroupId));
      if (groupTools.length === 0) continue;
      list.push({ key: `hdr-${group}`, header: true, label: t(`tool.group.${group}`) });
      groupTools.forEach((toolDef) => list.push(richItem(toolDef.id)));
    }
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t, navigate]);

  return (
    <Dropdown
      ariaLabel={t('research.menu')}
      triggerClassName="cluster-btn launcher-trigger"
      align="left"
      panelClassName="launcher-menu"
      filterable
      filterPlaceholder={t('launcher.search')}
      emptyText={t('launcher.empty')}
      trigger={
        <span className="launcher-trigger-inner">
          <FlaskIcon size={15} />
          {t('research.menu')}
          <ChevronDownIcon size={13} />
        </span>
      }
      items={items}
    />
  );
}
