// ==========================================================================
// Ergalics Studio — Host Plugin Pack Registry
//
// Single integration point between the workstation host and `@ergalics/plugins`.
// When `@ergalics/plugins` is extracted to an external repository (or replaced
// with a remote `.cspkg` catalog), only this module needs to change.
// ==========================================================================

import type {
  BuiltinPluginInfo,
  DisciplineInfo,
  MarketCategory,
  MarketItem,
  PluginDiscipline,
  PluginPack,
} from '@ergalics/plugin-sdk';
import { officialPluginPack } from '@ergalics/plugins';

let activePack: PluginPack = officialPluginPack;

/** Swap or register an external plugin pack (useful for tests or future remote packs). */
export function registerPluginPack(pack: PluginPack): void {
  activePack = pack;
}

export function getActivePluginPack(): PluginPack {
  return activePack;
}

export function getBuiltinPlugins(): readonly BuiltinPluginInfo[] {
  return activePack.plugins;
}

export function findBuiltin(id: string): BuiltinPluginInfo | undefined {
  return activePack.findPlugin(id);
}

export function getPluginDisciplines(): readonly DisciplineInfo[] {
  return activePack.disciplines;
}

export function disciplineOf(pluginId: string): PluginDiscipline {
  return activePack.disciplineOf(pluginId);
}

export function getMarketplaceCatalog(): readonly MarketItem[] {
  return activePack.marketplaceCatalog;
}

export function getMarketCategories(): readonly MarketCategory[] {
  return activePack.marketCategories;
}

export function buildDemoPackage(id: string): ArrayBuffer {
  if (!activePack.buildDemoPackage) {
    throw new Error(`active plugin pack "${activePack.id}" does not provide demo packages`);
  }
  return activePack.buildDemoPackage(id);
}

// Convenience aliases for existing host surfaces (all routed through activePack)
export const BUILTIN_PLUGINS = officialPluginPack.plugins;
export const PLUGIN_DISCIPLINES = officialPluginPack.disciplines;
export const MARKETPLACE_CATALOG = officialPluginPack.marketplaceCatalog;
export const MARKET_CATEGORIES = officialPluginPack.marketCategories;

export type { BuiltinPluginInfo, DisciplineInfo, MarketCategory, MarketItem, PluginDiscipline, PluginPack };
