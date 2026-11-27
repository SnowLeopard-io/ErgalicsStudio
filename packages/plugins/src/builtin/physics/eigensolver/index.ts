// EM Eigensolver plugin — factory export (plugin contract §6).

import type { Plugin } from '@ergalics/plugin-sdk';
import { EmEigensolverPlugin } from './plugin';

export default function createEmEigensolverPlugin(): Plugin {
  return new EmEigensolverPlugin();
}
