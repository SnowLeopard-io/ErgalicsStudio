// Browser polyfill for the Node `Buffer` global. isomorphic-git parses the
// git index with Buffer methods (GitIndex.from), and Vite — unlike webpack —
// injects no node-globals shim, so without this any statusMatrix / index
// update throws "ReferenceError: Buffer is not defined". The `buffer` package
// is the official browser implementation; it is mounted on globalThis before
// the first git call (this module is imported first in main.tsx).
import { Buffer } from 'buffer';

if (typeof globalThis.Buffer === 'undefined') {
  globalThis.Buffer = Buffer;
}

export {};
