// ==========================================================================
// Ergalics Studio — async engineering parse
//
// `parseEngineeringFile` is pure but O(deck size): a 30 MB Nastran bulk file
// would freeze the UI for seconds. Large decks are parsed inside a module
// worker; small files stay on the main thread where worker startup would
// dominate the parse.
// ==========================================================================

import { parseEngineeringFile } from './index';
import type { EngineeringStudy } from './types';

/** Files above this size parse in the worker. */
const WORKER_THRESHOLD_BYTES = 256 * 1024;

type ParseRequest = { id: number; text: string; name: string };
type ParseResponse =
  | { id: number; ok: true; study: EngineeringStudy }
  | { id: number; ok: false; error: string };

let worker: Worker | null = null;
let nextId = 0;
const pending = new Map<number, { resolve: (s: EngineeringStudy) => void; reject: (e: Error) => void }>();

function ensureWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('./parse-async.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (event: MessageEvent<ParseResponse>) => {
    const msg = event.data;
    const job = pending.get(msg.id);
    if (!job) return;
    pending.delete(msg.id);
    if (msg.ok) job.resolve(msg.study);
    else job.reject(new Error(msg.error));
  };
  worker.onerror = (event) => {
    const error = new Error(event.message || 'parse worker crashed');
    for (const job of pending.values()) job.reject(error);
    pending.clear();
  };
  return worker;
}

function parseInWorker(text: string, name: string): Promise<EngineeringStudy> {
  const w = ensureWorker();
  const id = nextId++;
  return new Promise<EngineeringStudy>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    w.postMessage({ id, text, name } satisfies ParseRequest);
  });
}

/**
 * Parse a deck without blocking the UI. Small files resolve synchronously
 * (the promise wrapper only defers to a microtask); large ones go to the
 * worker. Errors surface the same way as the sync parser.
 */
export async function parseEngineeringFileAsync(text: string, name: string): Promise<EngineeringStudy> {
  if (text.length >= WORKER_THRESHOLD_BYTES) {
    return parseInWorker(text, name);
  }
  return Promise.resolve(parseEngineeringFile(text, name));
}
