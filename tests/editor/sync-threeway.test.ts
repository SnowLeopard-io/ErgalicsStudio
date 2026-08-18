// 三模式同步測試：區塊 ⇄ 流程 ⇄ 程式碼，皆經由 IR 中樞。
import { describe, it, expect } from 'vitest';
import { makeProgram, type IRNode, type IRProgram } from '@/editor/ir';
import { parseCodeToIR } from '@/editor/code/parse';
import { codegen } from '@/editor/codegen';
import { irToFlow, flowToIR } from '@/editor/flow/convert';
import { workspaceJSONToIR, irToWorkspaceJSON } from '@/editor/block/convert';

const ref = (name: string): IRNode => ({ kind: 'VarRef', name: name });

// 具代表性的管線：載入 → 篩選 → 正規化 → 散佈圖。
function pipelineIR(): IRProgram {
  const df1 = { kind: 'VarAssign', name: 'df1', declare: true, value: { kind: 'LoadCSV', path: 'data.csv' } } as IRNode;
  const df2 = {
    kind: 'VarAssign', name: 'df2', declare: true, value: {
      kind: 'Filter', data: ref('df1'), column: 'x', op: '>' as const, value: { kind: 'Number', value: 0 },
    },
  } as IRNode;
  const df3 = {
    kind: 'VarAssign', name: 'df3', declare: true, value: {
      kind: 'Normalize', data: ref('df2'), column: 'y', mode: 'minmax' as const,
    },
  } as IRNode;
  const plot = { kind: 'PlotScatter', data: ref('df3'), x: 'x', y: 'y' } as IRNode;
  return makeProgram([df1, df2, df3, plot], [], 'python');
}

describe('程式碼 → IR（parseCodeToIR）', () => {
  it('將 studio.load + studio.filter 賦值解析回 IR', () => {
    const code = [
      'df1 = studio.load("data.csv")',
      'df2 = studio.filter(df1, "x", ">", 0)',
      'df3 = studio.normalize(df2, "y", "minmax")',
      'studio.plot("scatter", df3, { x: "x", y: "y" })',
    ].join('\n');
    const { program, rawCount } = parseCodeToIR(code, 'python');
    expect(rawCount).toBe(0);
    expect(program.body).toHaveLength(4);
    expect(program.body[0]).toEqual({ kind: 'VarAssign', name: 'df1', declare: true, value: { kind: 'LoadCSV', path: 'data.csv' } });
    expect(program.body[1]).toMatchObject({ kind: 'VarAssign', name: 'df2', value: { kind: 'Filter', column: 'x', op: '>' } });
    expect(program.body[2]).toMatchObject({ kind: 'VarAssign', name: 'df3', value: { kind: 'Normalize', column: 'y', mode: 'minmax' } });
    expect(program.body[3]).toMatchObject({ kind: 'PlotScatter', x: 'x', y: 'y' });
  });

  it('將無法識別的程式碼保留為 RawCode，而非丟棄', () => {
    const code = ['df1 = studio.load("data.csv")', 'import numpy as np', 'print(np.mean(...))'].join('\n');
    const { rawCount } = parseCodeToIR(code, 'python');
    expect(rawCount).toBe(2);
  });

  it('也能解析 JS 拼寫（studio.loadCSV）', () => {
    const code = 'df1 = studio.loadCSV("data.csv");';
    const { program } = parseCodeToIR(code, 'js');
    expect(program.body[0]).toMatchObject({ kind: 'VarAssign', value: { kind: 'LoadCSV' } });
  });
});

describe('IR → 程式碼（codegen）', () => {
  it('為 python 與 r 產出 studio.* DSL', () => {
    const ir = pipelineIR();
    const py = codegen(ir, 'python');
    expect(py).toContain('studio.load');
    expect(py).toContain('studio.filter');
    expect(py).toContain('studio.normalize');
    const r = codegen(ir, 'r');
    expect(r).toContain(' <- ');
    expect(r).toContain('studio.load');
  });
});

describe('IR ⇄ Flow（DAG）', () => {
  it('IR → Flow 為每個資料／轉換／視覺化節點產生一個帶連線的實例', () => {
    const flow = irToFlow(pipelineIR());
    // df1（來源）、df2（篩選）、df3（正規化）、scatter（視覺化）＝ 4 個實例
    expect(flow.instances).toHaveLength(4);
    // df1→df2、df2→df3、df3→scatter ＝ 3 條連線
    expect(flow.connections).toHaveLength(3);
    const kinds = flow.instances.map((i) => i.blockId);
    expect(kinds).toContain('source.file');
    expect(kinds).toContain('filter.value');
    expect(kinds).toContain('transform.normalize');
    expect(kinds).toContain('viz.scatter');
  });

  it('Flow → IR 以變數參照重建管線', () => {
    const flow = irToFlow(pipelineIR());
    const ir = flowToIR(flow);
    const filters = ir.body.filter((n) => n.kind === 'VarAssign' && n.value.kind === 'Filter');
    expect(filters.length).toBe(1);
    const filter = filters[0] as Extract<IRNode, { kind: 'VarAssign' }>;
    expect((filter.value as { data: IRNode }).data).toMatchObject({ kind: 'VarRef' });
  });
});

describe('三向往返轉換（中樞＝IR）', () => {
  it('程式碼 → IR → Flow → IR 產出相同的管線結構', () => {
    const code = [
      'df1 = studio.load("data.csv")',
      'df2 = studio.filter(df1, "x", ">", 0)',
      'studio.plot("scatter", df2, { x: "x", y: "y" })',
    ].join('\n');
    const ir1 = parseCodeToIR(code, 'python').program;
    const flow = irToFlow(ir1);
    const ir2 = flowToIR(flow);
    const loads = ir2.body.filter((n) => n.kind === 'VarAssign' && n.value.kind === 'LoadCSV');
    const filters = ir2.body.filter((n) => n.kind === 'VarAssign' && n.value.kind === 'Filter');
    const plots = ir2.body.filter((n) => n.kind === 'PlotScatter');
    expect(loads).toHaveLength(1);
    expect(filters).toHaveLength(1);
    expect(plots).toHaveLength(1);
  });

  it('區塊 → IR → 程式碼 重現 studio DSL', () => {
    const ws = irToWorkspaceJSON(pipelineIR());
    const ir = workspaceJSONToIR(ws);
    const py = codegen(ir, 'python');
    expect(py).toContain('studio.load');
    expect(py).toContain('studio.filter');
    expect(py).toContain('studio.normalize');
    expect(py).toContain('studio.plot');
  });

  it('Flow → IR → 程式碼 重現 studio DSL', () => {
    const flow = irToFlow(pipelineIR());
    const ir = flowToIR(flow);
    const py = codegen(ir, 'python');
    expect(py).toContain('studio.load');
    expect(py).toContain('studio.filter');
    expect(py).toContain('studio.normalize');
    expect(py).toContain('studio.plot');
  });
});
