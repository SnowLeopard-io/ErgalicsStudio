// ==========================================================================
// Ergalics Studio — Builtin Plugin Data Schema Registry
//
// Maps builtin plugin IDs (especially ed25519-signed manifests like stats/*
// whose manifest bytes are signature-pinned) to their declarative
// `PluginDataSchemaSpec` without altering pinned signatures or pulling Zod
// into the first-screen bundle.
// ==========================================================================

import type { PluginDataSchemaSpec } from '@/types/dataSchema';

export const BUILTIN_PLUGIN_DATA_SCHEMAS: Readonly<
  Record<string, PluginDataSchemaSpec | PluginDataSchemaSpec[]>
> = {
  // Pilot signed plugin: Survival Analysis (KM / Log-Rank / Cox)
  'example.stats-survival': {
    preset: 'ergalics:tabular/survival-table',
  },
};
