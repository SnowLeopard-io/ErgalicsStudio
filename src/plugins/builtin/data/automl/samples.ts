// ==========================================================================
// Embedded deterministic sample for the AutoML plugin.
//
// 200 rows × (4 numeric features + 1 low-cardinality categorical feature +
// binary target). The target carries a real linear + categorical signal plus
// Gaussian noise, and ~2% of `x3_signal` cells are empty so mean imputation
// and one-hot encoding are exercised end-to-end. Fully seeded, so the CSV
// text is identical on every load.
// ==========================================================================

import { generateSyntheticDataset } from './kernel';

export const AUTOML_SAMPLE_CSV: string = generateSyntheticDataset(200, 20261029);
