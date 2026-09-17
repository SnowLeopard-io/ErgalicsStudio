// ==========================================================================
// examples 全量守門測試
//
// examples/projects/*.clproj 的流程 DAG 必須：
//   1. flowToIR 時一個區塊都不能丟（simple-kit 目錄 100% 覆蓋）；
//   2. IR → irToFlow 後 blockId / 參數 / 連線數量往返一致；
//   3. IR codegen Python 後再 parse 回 IR 不拋例外（文字可往返）。
// examples/code/*.py 則必須能被解析器完整吃下（不拋例外；超出 IR 的
// Python 語法允許進 RawCode，它們由 Pyodide 執行）。
// ==========================================================================
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { flowToIR, irToFlow } from '@/editor/flow/convert';
import { codegenPython } from '@/editor/codegen/python';
import { parseCodeToIR } from '@/editor/code/parse';
import { irToWorkspaceJSON } from '@/editor/block/convert';
import { interpret } from '@/editor/runtime/interpreter';
import { createStudioApi, type StudioApiHost } from '@/editor/runtime/studio-api';
import type { RenderedView } from '@/types/datatable';
import type { BlockGraphState, BlockInstance } from '@/types/block';

const PROJECTS_DIR = resolve(__dirname, '../../examples/projects');
const CODE_DIR = resolve(__dirname, '../../examples/code');

interface ClProject {
  state?: { blockGraph?: BlockGraphState };
}

function loadProjects(): { name: string; graph: BlockGraphState }[] {
  return readdirSync(PROJECTS_DIR)
    .filter((f) => f.endsWith('.clproj'))
    .map((f) => {
      const proj = JSON.parse(readFileSync(resolve(PROJECTS_DIR, f), 'utf8')) as ClProject;
      return { name: f, graph: proj.state?.blockGraph ?? { instances: [], connections: [], viewport: { x: 0, y: 0, zoom: 1 } } };
    })
    .filter((p) => p.graph.instances.length > 0);
}

/** 可比較的區塊多重集（拓撲排序會改變順序，故用 blockId+params 指紋）。
 *  空字串參數視同未設定（IR → 目錄時會省略空 colorColumn 等）。 */
function blockFingerprints(instances: BlockInstance[]): string[] {
  const canonical = (params: Record<string, unknown>): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(params)) {
      if (v === '' || v === undefined || v === null) continue;
      out[k] = v;
    }
    return out;
  };
  return instances
    .map((i) => `${i.blockId}::${JSON.stringify(canonical(i.params))}`)
    .sort();
}

describe('example projects: flow DAG ⇄ IR round-trip', () => {
  const projects = loadProjects();

  it('discovers example projects', () => {
    expect(projects.length).toBeGreaterThanOrEqual(8);
  });

  for (const { name, graph } of projects) {
    it(`${name}: every flow block maps to IR and back without loss`, () => {
      // 1) graph → IR：一個實例對應一條 body 陳述。
      const program = flowToIR(graph);
      expect(program.body.length, `${name}: IR statement count`).toBe(graph.instances.length);

      // 2) IR → flow：blockId 多重集一致、連線數不變。
      const back = irToFlow(program);
      expect(back.instances.length, `${name}: round-trip instance count`).toBe(graph.instances.length);
      expect(blockFingerprints(back.instances)).toEqual(blockFingerprints(graph.instances));
      expect(back.connections.length, `${name}: connection count`).toBe(graph.connections.length);

      // 3) Python codegen + 重新解析不拋例外。
      const py = codegenPython(program);
      expect(() => parseCodeToIR(py, 'python')).not.toThrow();

      // 4) IR → Blockly JSON 也不應拋例外（積木模式切換）。
      expect(() => irToWorkspaceJSON(program)).not.toThrow();
    });
  }
});

describe('example projects: IR interpreter executes the full pipeline', () => {
  // 樣例裡刻意保留了「未配置」的統計塊（stats.summary 參數為空），流程引擎
  // 會把它標為節點錯誤而不中斷其他節點；這是唯一允許的失敗原因。
  const CONFIGURATION_ERRORS = /not configured|does not exist|pick a column/;

  for (const { name, graph } of loadProjects()) {
    it(`${name}: runs through the IR interpreter (block/code engine)`, async () => {
      const program = flowToIR(graph);
      const rendered: RenderedView[] = [];
      const host: StudioApiHost = {
        loadText: async () => '',
        renderView: async (view) => {
          rendered.push(view);
        },
        notify: () => undefined,
        print: () => undefined,
      };
      const result = await interpret(program, createStudioApi(host));
      if (!result.ok) {
        expect(result.error?.message ?? '').toMatch(CONFIGURATION_ERRORS);
      }
      // 帶有已配置 viz.* 塊的工程至少要渲染出一個視圖。
      const hasConfiguredViz = graph.instances.some(
        (i) =>
          (i.blockId.startsWith('viz.') || i.blockId.startsWith('plot.')) &&
          (typeof i.params.column === 'string' ? i.params.column : (i.params.xColumn ?? '')),
      );
      if (hasConfiguredViz && result.ok) {
        expect(rendered.length, `${name}: should render at least one view`).toBeGreaterThan(0);
      }
    });
  }
});

describe('example code samples: parser never throws', () => {
  const samples = readdirSync(CODE_DIR).filter((f) => f.endsWith('.py'));
  expect(samples.length).toBeGreaterThan(0);
  for (const file of samples) {
    it(`${file}: parses (free-form Python may fall back to RawCode)`, () => {
      const source = readFileSync(resolve(CODE_DIR, file), 'utf8');
      expect(() => parseCodeToIR(source, 'python')).not.toThrow();
    });
  }
});
