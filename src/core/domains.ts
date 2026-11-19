// ==========================================================================
// Ergalics Studio — capability domains (research / industrial)
//
// One UI runtime, two capability lists. Every registry entry (research tool,
// plugin manifest, activity item, market entry) may declare `domains`;
// entries without the field are RESEARCH-only, which keeps every legacy
// plugin and tool exactly where it was before the industrial workbench
// landed. `both` is visible from either side.
//
// These helpers are pure and DOM-free, so the filtering policy is unit
// tested independently from the React surfaces that consume it.
// ==========================================================================

export type Domain = 'research' | 'industrial' | 'both';

/** Capability list currently in front of the user. */
export type ActiveDomain = 'research' | 'industrial';

export interface DomainTagged {
  /** Defaults to ['research'] when omitted (backward compatible). */
  domains?: Domain[];
}

/** Default domains of an entry that does not declare them. */
export const DEFAULT_DOMAINS: readonly Domain[] = ['research'];

/** Normalise an optional declaration to a non-empty list. */
export function normalizeDomains(domains: Domain[] | undefined): Domain[] {
  return domains && domains.length > 0 ? domains : [...DEFAULT_DOMAINS];
}

/** Is an entry visible in the given capability list? */
export function isDomainVisible(
  domains: Domain[] | undefined,
  domain: ActiveDomain,
): boolean {
  const list = normalizeDomains(domains);
  return list.includes(domain) || list.includes('both');
}

/**
 * The capability list implied by a project. `.clproj` files written before
 * the domain field existed have no value — those stay research projects.
 */
export function projectDomain(project: { domain?: string | null } | null | undefined): ActiveDomain {
  return project?.domain === 'industrial' ? 'industrial' : 'research';
}

/** Filter a tagged list (tools, plugins, market entries). */
export function getVisibleByDomain<T extends DomainTagged>(
  items: readonly T[],
  domain: ActiveDomain,
): T[] {
  return items.filter((item) => isDomainVisible(item.domains, domain));
}

/** Tool registry: the tools visible from the active capability list. */
export function getVisibleTools<T extends DomainTagged>(
  tools: readonly T[],
  domain: ActiveDomain,
): T[] {
  return getVisibleByDomain(tools, domain);
}

/**
 * Plugin manifests / registry entries: same rule as tools.
 *
 * NOTE: the workbench's plugin PANEL must NOT use this — industrial and
 * research tools already live in separate sidebar views, so filtering the
 * global plugin registry by the active project domain hides every research
 * plugin in an industrial project. This helper is for capability-scoped
 * surfaces (e.g. a future domain-specific marketplace) only.
 */
export function getVisiblePlugins<T extends DomainTagged>(
  entries: readonly T[],
  domain: ActiveDomain,
): T[] {
  return getVisibleByDomain(entries, domain);
}

export interface ActivityEntry extends DomainTagged {
  id: string;
}

/**
 * Activity-bar entries visible from a capability list. `research` is a
 * capability itself, so the research entry is industrial-only when the list
 * is industrial (and vice versa); file/search/git are shared (`both`).
 */
export function getActivityItems<T extends ActivityEntry>(
  items: readonly T[],
  domain: ActiveDomain,
): T[] {
  return items.filter((item) => {
    if (item.id === 'research') return domain === 'research';
    if (item.id === 'industrial') return domain === 'industrial';
    return isDomainVisible(item.domains, domain);
  });
}

/**
 * Sidebar / launcher groups for the active list. Groups themselves carry a
 * capability list; a group is kept when at least one of its tools is visible
 * and the group itself belongs to this list.
 */
export function gridGroupsForDomain<T extends DomainTagged & { group: string }>(
  tools: readonly T[],
  domain: ActiveDomain,
  groupOrder: readonly string[],
  groupDomains?: Readonly<Record<string, Domain[]>>,
): string[] {
  const visible = new Set(getVisibleTools(tools, domain).map((tool) => tool.group));
  return groupOrder.filter((group) => {
    if (!visible.has(group)) return false;
    if (!groupDomains) return true;
    return isDomainVisible(groupDomains[group], domain);
  });
}

/** Command palette entries: same visibility contract as tools. */
export function commandPaletteItems<T extends DomainTagged>(
  items: readonly T[],
  domain: ActiveDomain,
): T[] {
  return getVisibleByDomain(items, domain);
}

/** Plugin-market entries: same visibility contract as plugins. */
export function marketplaceEntries<T extends DomainTagged>(
  entries: readonly T[],
  domain: ActiveDomain,
): T[] {
  return getVisibleByDomain(entries, domain);
}
