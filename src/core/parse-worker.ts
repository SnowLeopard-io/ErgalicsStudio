// ==========================================================================
// FR-16 — parse worker entry (runs inside a Web Worker module scope).
//
// Host → worker : { id, task }
// Worker → host : { id, progress: { done, total } }   (streaming updates)
// Worker → host : { id, ok, result | error }          (final reply)
//
// `createParseWorkerRuntime` is exported for unit testing: the tests drive
// the exact same message handler with a fake Worker (see sandbox.ts's
// plugin-worker pattern).
// ==========================================================================

import { runParseTask } from './parse-tasks';
import type { ParseTask } from './parse-tasks';

interface ParseRequest {
  id: number;
  task: ParseTask;
}

export interface ParseWorkerRuntime {
  handleMessage(msg: unknown): Promise<void>;
}

export function createParseWorkerRuntime(
  postToHost: (message: unknown) => void,
): ParseWorkerRuntime {
  // Serialize dispatch: one heavy parse at a time per worker keeps memory
  // bounded and progress messages ordered.
  let chain: Promise<void> = Promise.resolve();

  return {
    handleMessage(msg: unknown): Promise<void> {
      const run = async () => {
        const req = msg as ParseRequest;
        if (typeof req?.id !== 'number' || !req.task) return;
        try {
          const result = await runParseTask(req.task, (progress) => {
            postToHost({ id: req.id, progress });
          });
          postToHost({ id: req.id, ok: true, result });
        } catch (err) {
          postToHost({
            id: req.id,
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      };
      chain = chain.then(run, run);
      return chain;
    },
  };
}

// Real worker bootstrap. Guarded so the module imports cleanly in test
// environments without a worker global (`self` undefined).
if (typeof self !== 'undefined') {
  const workerSelf = self as unknown as {
    postMessage(message: unknown): void;
    onmessage: ((ev: MessageEvent) => void) | null;
  };
  const runtime = createParseWorkerRuntime((message) => workerSelf.postMessage(message));
  workerSelf.onmessage = (ev: MessageEvent) => {
    void runtime.handleMessage(ev.data);
  };
}
