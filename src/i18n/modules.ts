// Feature-module dictionaries merged over the base zh-CN/en-US catalogs.
// Each FR module keeps its own file here so concurrent work never edits the
// shared base catalogs.
import type { LocaleDictionary } from './types';
import { pluginSigningZh, pluginSigningEn } from './dicts/plugin-signing';
import { statsNarrativeZh, statsNarrativeEn } from './dicts/stats-narrative';
import { reproZh, reproEn } from './dicts/repro';
import { citationZh, citationEn } from './dicts/citation';
import { storageZh, storageEn } from './dicts/storage';
import { templatesZh, templatesEn } from './dicts/templates';
import { rRuntimeZh, rRuntimeEn } from './dicts/r-runtime';
import { aiZh, aiEn } from './dicts/ai';
import { courseZh, courseEn } from './dicts/course';
import { cleaningZh, cleaningEn } from './dicts/cleaning';
import { submitZh, submitEn } from './dicts/submit';
import { viz3dZh, viz3dEn } from './dicts/viz3d';
import { themeMarketZh, themeMarketEn } from './dicts/theme-market';
import { pwaZh, pwaEn } from './dicts/pwa';
import { galleryZh, galleryEn } from './dicts/gallery';
import { aboutZh, aboutEn } from './dicts/about';

export const MODULE_ZH: LocaleDictionary = {
  ...pluginSigningZh,
  ...statsNarrativeZh,
  ...reproZh,
  ...citationZh,
  ...storageZh,
  ...templatesZh,
  ...rRuntimeZh,
  ...aiZh,
  ...courseZh,
  ...cleaningZh,
  ...submitZh,
  ...viz3dZh,
  ...themeMarketZh,
  ...pwaZh,
  ...galleryZh,
  ...aboutZh,
};
export const MODULE_EN: LocaleDictionary = {
  ...pluginSigningEn,
  ...statsNarrativeEn,
  ...reproEn,
  ...citationEn,
  ...storageEn,
  ...templatesEn,
  ...rRuntimeEn,
  ...aiEn,
  ...courseEn,
  ...cleaningEn,
  ...submitEn,
  ...viz3dEn,
  ...themeMarketEn,
  ...pwaEn,
  ...galleryEn,
  ...aboutEn,
};
