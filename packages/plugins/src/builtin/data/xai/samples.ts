// ==========================================================================
// Embedded deterministic sample for the Model Interpreter (XAI) plugin.
//
// ~240 rows of synthetic "adult-like" census data: age, weekly hours,
// education years, spiky capital gains, a binary sensitive attribute (sex)
// and a binary >50K-style target with genuine signal in every feature —
// including a sex-correlated term, so the fairness metrics are
// non-degenerate. Fully seeded, so the CSV text is identical on every load;
// the plugin boots with it so the first Run works without any file
// interaction.
// ==========================================================================

import { generateAdultLikeSample } from './kernel';

export const XAI_SAMPLE_CSV: string = generateAdultLikeSample(240, 20261029);
