// ==========================================================================
// Ergalics Studio — AI 工具开关（用户可裁剪 Agent 的能力面）
//
// 为什么需要
// ---------
// 工具注册表里现在有十几个能力，但用户只能整体开关"允许 Agent 操作应用"。
// 这带来两个真实问题：
//   1. 一个只想聊天的人，也被迫把 activate_plugin / run_code 这类写入工具
//      全部放行（面板里只显示"已启用 N 个可调用工具"，没有逐项选择）；
//   2. 出问题时无法缩小范围——不知道是哪一个工具在乱动。
//
// 这里只做一件事：记住"哪些工具被用户关掉了"。读取侧在 core/ai/chat.ts，
// 写侧是 Agent 能力面板。默认全开，保持现有行为不变。
// ==========================================================================

import { create } from 'zustand';

const STORAGE_KEY = 'ergalics:ai-disabled-tools';

function readDisabled(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

interface AiToolPolicyState {
  disabledTools: string[];
  isEnabled: (name: string) => boolean;
  toggleTool: (name: string, enabled: boolean) => void;
  enableAll: () => void;
}

export const useAiToolPolicyStore = create<AiToolPolicyState>((set, get) => ({
  disabledTools: readDisabled(),

  isEnabled: (name) => !get().disabledTools.includes(name),

  toggleTool: (name, enabled) => {
    const current = get().disabledTools;
    const next = enabled ? current.filter((n) => n !== name) : [...new Set([...current, name])];
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // 存储不可用时只影响本次会话记忆，不阻断使用
    }
    set({ disabledTools: next });
  },

  enableAll: () => {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
    set({ disabledTools: [] });
  },
}));

/** 给非 React 调用方（core/ai/chat.ts）用的纯函数读取。 */
export function isToolEnabled(name: string): boolean {
  return !useAiToolPolicyStore.getState().disabledTools.includes(name);
}
