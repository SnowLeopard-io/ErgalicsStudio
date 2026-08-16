import { describe, it, expect } from 'vitest';
import { createBlockRegistry, BLOCK_CATEGORIES } from '@/blocks/registry';
import { block } from './fixtures';

describe('BlockRegistry', () => {
  it('registers and retrieves blocks', () => {
    const r = createBlockRegistry();
    const m = block({ id: 'a.b', category: 'math', inputs: [], outputs: [] });
    r.register(m);
    expect(r.get('a.b')).toBe(m);
    expect(r.list()).toHaveLength(1);
    expect(r.get('nope')).toBeUndefined();
  });

  it('groups blocks by category', () => {
    const r = createBlockRegistry();
    r.register(block({ id: 'a', category: 'math', inputs: [], outputs: [] }));
    r.register(block({ id: 'b', category: 'math', inputs: [], outputs: [] }));
    r.register(block({ id: 'c', category: 'filter', inputs: [], outputs: [] }));
    expect(r.listByCategory('math')).toHaveLength(2);
    expect(r.listByCategory('filter')).toHaveLength(1);
    expect(r.listByCategory('signal')).toHaveLength(0);
  });

  it('is idempotent on duplicate registration', () => {
    const r = createBlockRegistry();
    const first = block({ id: 'dup', category: 'math', inputs: [], outputs: [] });
    r.register(first);
    // A fresh meta object under the same id (StrictMode / HMR) is skipped.
    r.register(block({ id: 'dup', category: 'math', inputs: [], outputs: [] }));
    expect(r.get('dup')).toBe(first);
    expect(r.list()).toHaveLength(1);
  });

  it('exposes every category key', () => {
    const r = createBlockRegistry();
    for (const c of BLOCK_CATEGORIES) {
      expect(r.listByCategory(c)).toEqual([]);
    }
  });
});
