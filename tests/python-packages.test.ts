// python-packages.ts — pinned-package persistence semantics (settings storage
// panel). The vitest default environment is node, so localStorage is stubbed
// with the same in-memory shape (get/set/clear).
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  VENDORED_PYTHON_PACKAGES,
  getPinnedPythonPackages,
  addPinnedPythonPackages,
  removePinnedPythonPackage,
  unpinnedVendoredPackages,
} from '@/core/pyodide/python-packages';

const store = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
});

describe('python-packages pinned list', () => {
  beforeEach(() => store.clear());

  it('starts empty', () => {
    expect(getPinnedPythonPackages()).toEqual([]);
  });

  it('pins and dedupes valid vendored packages', () => {
    const next = addPinnedPythonPackages(['pandas', 'pandas', 'scipy']);
    expect(next).toEqual(['pandas', 'scipy']);
    expect(getPinnedPythonPackages()).toEqual(['pandas', 'scipy']);
  });

  it('silently drops names outside the vendored set', () => {
    addPinnedPythonPackages(['requests' as never, 'pandas']);
    expect(getPinnedPythonPackages()).toEqual(['pandas']);
  });

  it('survives a reload (localStorage is the point of the feature)', () => {
    addPinnedPythonPackages(['matplotlib']);
    expect(getPinnedPythonPackages()).toEqual(['matplotlib']);
  });

  it('unpins a package and keeps the rest', () => {
    addPinnedPythonPackages(['pandas', 'scipy']);
    expect(removePinnedPythonPackage('pandas')).toEqual(['scipy']);
    expect(getPinnedPythonPackages()).toEqual(['scipy']);
  });

  it('unpinnedVendoredPackages lists what is not pinned yet', () => {
    addPinnedPythonPackages(['pandas']);
    const rest = unpinnedVendoredPackages();
    expect(rest).not.toContain('pandas');
    expect(rest).toContain('sympy');
    expect(rest).toHaveLength(VENDORED_PYTHON_PACKAGES.length - 1);
  });

  it('corrupt storage degrades to an empty list', () => {
    localStorage.setItem('ergalics:python:pinned-packages', 'not json{');
    expect(getPinnedPythonPackages()).toEqual([]);
    localStorage.setItem('ergalics:python:pinned-packages', JSON.stringify(['nope', 42]));
    expect(getPinnedPythonPackages()).toEqual([]);
  });
});
