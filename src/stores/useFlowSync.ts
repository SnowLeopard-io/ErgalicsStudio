// ==========================================================================
// Ergalics Studio — Flow ⇄ IR 同步橋接
//
// 流程（DAG）編輯器將其即時狀態保存在 `blockStore`；而區塊與程式碼編輯器
// 則保存在 `editorStore`。這個 hook 是讓流程 DAG 納入三向往返轉換的關鍵連結：
//
//   • 每當流程 DAG 變更   → 透過 IR 推入區塊／程式碼
//   • 每當使用者進入流程   → 從目前的 IR 注水（hydrate）DAG
//
// `editorStore` 所持有的 IR 永遠是中樞；除了進入模式時明確的注水動作外，
// 此處絕不會因外部驅動的 IR 變更而寫入 `blockStore`，故不會產生編輯／回饋迴圈。
// ==========================================================================

import { useEffect } from 'react';
import { useBlockStore } from '@/stores/blockStore';
import { useEditorStore } from '@/stores/editorStore';
import { useAppStore } from '@/stores/appStore';
import { BLOCK_GRAPH_CHANGED } from '@/stores/blockStore';
import { irToFlow } from '@/editor/flow/convert';
import { on } from '@/core/events';

/**
 * 掛載一次（例如於 WorkbenchPage）。銜接流程 DAG ⇄ IR 的往返轉換。
 */
export function useFlowSync(): void {
  const mode = useAppStore((s) => s.mode);

  // 將流程 DAG 的編輯推入 IR 中樞，使區塊／程式碼重新生成。
  useEffect(() => {
    if (mode !== 'flow') return;
    const off = on(BLOCK_GRAPH_CHANGED, () => {
      const sid = useEditorStore.getState().activeSessionId;
      if (!sid) return;
      const graph = useBlockStore.getState().toJSON();
      useEditorStore.getState().syncFromFlow(sid, graph);
    });
    return off.unsubscribe;
  }, [mode]);

  // 進入流程模式時，從目前的 IR 中樞注水 DAG。
  useEffect(() => {
    if (mode !== 'flow') return;
    const sid = useEditorStore.getState().activeSessionId;
    if (!sid) return;
    const session = useEditorStore.getState().sessions.find((s) => s.id === sid);
    if (!session) return;
    const flow = irToFlow(session.ir);
    useBlockStore.getState().fromJSON(flow);
  }, [mode]);
}
