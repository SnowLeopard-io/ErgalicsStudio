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

import { useEffect, useRef } from 'react';
import { useBlockStore } from '@/stores/blockStore';
import { useEditorStore } from '@/stores/editorStore';
import { useAppStore } from '@/stores/appStore';
import { BLOCK_GRAPH_CHANGED } from '@/stores/blockStore';
import { irToFlow, flowGraphSignature } from '@/editor/flow/convert';
import { on } from '@/core/events';

/** 合併連續的 DAG 變更（拖曳/連線時每幀都會觸發）。 */
const FLOW_SYNC_DEBOUNCE_MS = 120;

/**
 * 掛載一次（例如於 WorkbenchPage）。銜接流程 DAG ⇄ IR 的往返轉換。
 */
export function useFlowSync(): void {
  const mode = useAppStore((s) => s.mode);
  // 注水時 DAG 的結構簽章：與此相同的變更事件代表「沒有真正的使用者編輯」
  // （可能是注水殘留的防抖事件），不得回推，否則會用降維後的 DAG 覆寫 IR。
  const hydratedSigRef = useRef<string | null>(null);

  // 將流程 DAG 的編輯推入 IR 中樞，使區塊／程式碼重新生成。
  // 拖曳節點時 `BLOCK_GRAPH_CHANGED` 會隨每個 pointermove 觸發，而每次同步
  // 都要把整張 DAG 轉成 IR 並重新 codegen（還可能觸發存檔排程）。以短延遲
  // 合併同一批手勢，避免拖曳時每一幀都做一次全圖轉換。
  useEffect(() => {
    if (mode !== 'flow') return;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const flush = () => {
      timer = null;
      const sid = useEditorStore.getState().activeSessionId;
      if (!sid) return;
      const graph = useBlockStore.getState().toJSON();
      const sig = flowGraphSignature(graph);
      if (sig === hydratedSigRef.current) return; // 與注水內容相同 → 忽略
      hydratedSigRef.current = sig;
      useEditorStore.getState().syncFromFlow(sid, graph);
    };

    const off = on(BLOCK_GRAPH_CHANGED, () => {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(flush, FLOW_SYNC_DEBOUNCE_MS);
    });
    return () => {
      off.unsubscribe();
      // 離開流程模式（或卸載）前把最後一筆待同步的編輯送出，避免遺失。
      if (timer !== null) {
        clearTimeout(timer);
        flush();
      }
    };
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
    hydratedSigRef.current = flowGraphSignature(flow);
  }, [mode]);
}
