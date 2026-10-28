// EM Eigensolver plugin — factory export (plugin contract §6).

import type { Plugin } from '@/types/plugin';
import { EmEigensolverPlugin } from './plugin';

export default function createEmEigensolverPlugin(): Plugin {
  return new EmEigensolverPlugin();
}
