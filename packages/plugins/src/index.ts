// ==========================================================================
// @ergalics/plugins — Official Built-in Plugin Pack Entry
//
// Zero host coupling: this package depends ONLY on @ergalics/plugin-sdk,
// @ergalics/plugin-signing, @ergalics/sci-kernels, and explicit npm deps.
// Hosts register this pack through `registerPluginPack(officialPluginPack)`.
// ==========================================================================

import type { PluginPack } from '@ergalics/plugin-sdk';
import { BUILTIN_PLUGINS, findBuiltin } from './builtin/index';
import { PLUGIN_DISCIPLINES, disciplineOf } from './categories';
import { MARKETPLACE_CATALOG, MARKET_CATEGORIES } from './marketplace';
import { buildDemoPackage, listDemoPackageIds } from './marketplace-demo-packages';

export { BUILTIN_PLUGINS, findBuiltin, type BuiltinPluginInfo } from './builtin/index';
export { PLUGIN_DISCIPLINES, disciplineOf, type PluginDiscipline } from './categories';
export {
  MARKETPLACE_CATALOG,
  MARKET_CATEGORIES,
  type MarketCategory,
  type MarketItem,
} from './marketplace';
export { buildDemoPackage, listDemoPackageIds } from './marketplace-demo-packages';

export const officialPluginPack: PluginPack = {
  id: 'ergalics.official',
  plugins: BUILTIN_PLUGINS,
  disciplines: PLUGIN_DISCIPLINES,
  disciplineOf,
  findPlugin: findBuiltin,
  marketplaceCatalog: MARKETPLACE_CATALOG,
  marketCategories: MARKET_CATEGORIES,
  buildDemoPackage,
  listDemoPackageIds,
};
