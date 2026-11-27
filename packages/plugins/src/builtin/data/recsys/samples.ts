// ==========================================================================
// Embedded deterministic sample for the Recommender Lab plugin.
//
// 25 users × 18 items with 3 latent taste clusters, 15% of the cells left
// unrated, integer ratings 1–5 and 4 numeric item content features. Fully
// seeded, so the CSV text is identical on every load — the plugin boots with
// it so the first Run works without any file interaction.
// ==========================================================================

import { generateSyntheticRatings } from './kernel';

export const RECSYS_SAMPLE_CSV: string = generateSyntheticRatings(25, 18, 20261029);
