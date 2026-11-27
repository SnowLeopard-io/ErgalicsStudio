// Parse worker: runs the pure deck parser off the main thread so large
// Nastran/Abaqus/Ansys imports never freeze the UI.

import { parseEngineeringFile } from './index';
import type { EngineeringStudy } from './types';

interface ParseRequest {
  id: number;
  text: string;
  name: string;
}

self.onmessage = (event: MessageEvent<ParseRequest>) => {
  const { id, text, name } = event.data;
  try {
    const study: EngineeringStudy = parseEngineeringFile(text, name);
    self.postMessage({ id, ok: true, study });
  } catch (err) {
    self.postMessage({ id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
