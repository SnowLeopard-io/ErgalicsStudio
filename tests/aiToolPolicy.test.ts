// ==========================================================================
// 工具开关：关掉的工具必须从"模型能看见的清单"里消失。
// 这条锁的反面是"能调但被拒"——那会浪费一轮往返，也是用户抱怨的根源。
// ==========================================================================

import { describe, expect, it, beforeEach, vi } from 'vitest';
import { availableTools } from '@/core/ai/chat';
import { useAiToolPolicyStore } from '@/stores/aiToolPolicyStore';

function makeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() { return map.size; },
  } as unknown as Storage;
}

beforeEach(() => {
  vi.stubGlobal('localStorage', makeStorage());
  useAiToolPolicyStore.getState().enableAll();
});

describe('Agent 工具开关', () => {
  it('关闭一个工具后，它不再出现在可调用清单里', () => {
    const before = availableTools().map((t) => t.name);
    expect(before.length).toBeGreaterThan(0);
    const target = before[0]!;

    useAiToolPolicyStore.getState().toggleTool(target, false);
    const after = availableTools().map((t) => t.name);
    expect(after).not.toContain(target);

    useAiToolPolicyStore.getState().toggleTool(target, true);
    expect(availableTools().map((t) => t.name)).toContain(target);
  });

  it('全部启用后回到初始清单', () => {
    const initial = availableTools().map((t) => t.name);
    const target = initial[0]!;
    useAiToolPolicyStore.getState().toggleTool(target, false);
    useAiToolPolicyStore.getState().enableAll();
    expect(availableTools().map((t) => t.name)).toEqual(initial);
  });

  it('开关写入 localStorage，刷新后仍然记得', () => {
    const target = availableTools()[0]!.name;
    useAiToolPolicyStore.getState().toggleTool(target, false);
    const raw = localStorage.getItem('ergalics:ai-disabled-tools');
    expect(raw).toContain(target);
  });
});
