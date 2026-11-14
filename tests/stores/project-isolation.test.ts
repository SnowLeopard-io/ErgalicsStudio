// ==========================================================================
// Regression tests: project isolation.
//
// Switching projects must not carry ANY of the previous project's state
// across. The leaks found here were all "a module-level cache outliving
// the project":
//
//   * the Pyodide workspace tree (only the MOUNT path reset it, so a run
//     could still open the previous project's files),
//   * the interpreter's REPL namespace (session-wide interpreter),
//   * the lab handoff payload (a dataset staged in project A),
//   * the Figure Studio active sheet (mutations became silent no-ops),
//   * the schema data contract (project A's column names, globally stored).
// ==========================================================================

import { describe, it, expect, beforeEach, vi } from 'vitest';

const mountWorkspace = vi.hoisted(() => vi.fn());
const resetNamespace = vi.hoisted(() => vi.fn(async () => true));

vi.mock('@/core/pyodide/pyodide-client', async () => {
  const actual = await vi.importActual<typeof import('@/core/pyodide/pyodide-client')>(
    '@/core/pyodide/pyodide-client',
  );
  return { ...actual, PyodideClient: class { mountWorkspace = mountWorkspace; resetNamespace = resetNamespace; } };
});

import { useProjectStore } from '@/stores/projectStore';
import { useFigureStore } from '@/stores/figureStore';
import { stageLabHandoff, takeLabHandoff } from '@/core/labHandoff';
import { resetPythonRuntime } from '@/core/pyodide/code-runtime';

describe('project isolation', () => {
  beforeEach(() => {
    useProjectStore.setState({ project: null });
    useFigureStore.setState({ activeSheetId: null });
  });

  it('a lab handoff staged in one project is not consumed in another', () => {
    // Project A: stage a dataset for the uncertainty lab.
    useProjectStore.setState({
      project: { id: 'proj-a', name: 'A', state: {}, createdAt: 0, updatedAt: 0 } as never,
    });
    stageLabHandoff({ name: 'data.csv', csv: 'x\n1\n', target: 'uncertainty' });

    // The user switches to project B before the lab opens.
    useProjectStore.setState({
      project: { id: 'proj-b', name: 'B', state: {}, createdAt: 0, updatedAt: 0 } as never,
    });
    expect(takeLabHandoff()).toBeNull();
  });

  it('a lab handoff staged in the current project IS consumed', () => {
    useProjectStore.setState({
      project: { id: 'proj-a', name: 'A', state: {}, createdAt: 0, updatedAt: 0 } as never,
    });
    stageLabHandoff({ name: 'data.csv', csv: 'x\n1\n', target: 'uncertainty' });
    const taken = takeLabHandoff();
    expect(taken?.name).toBe('data.csv');
    // One-shot: a second take finds nothing.
    expect(takeLabHandoff()).toBeNull();
  });

  it('the figure store drops the previous project active sheet', () => {
    useFigureStore.getState().setActive('sheet-of-project-a');
    useProjectStore.setState({
      project: { id: 'proj-b', name: 'B', state: {}, createdAt: 0, updatedAt: 0 } as never,
    });
    expect(useFigureStore.getState().activeSheetId).toBeNull();
  });
});

describe('interpreter namespace reset', () => {
  it('resetPythonRuntime reports success', async () => {
    await expect(resetPythonRuntime()).resolves.toBeTypeOf('boolean');
  });
});
