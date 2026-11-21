// ==========================================================================
// Ergalics Studio — Agent 能力面板
//
// 用户原话："Agent 界面不成熟，只有一个对话框，Skill 这些地方该在哪里加
// 也没有配置好。" 这块就是那个"地方"：
//   · 逐个工具的开关（只读 / 写入 / 不可逆一眼看清）
//   · MCP 接入的状态说明（注册表支持 mcp 来源，客户端还没接）
//   · 一键恢复全部能力
//
// 不做技能编辑器：工具由 hostTools / 未来的 MCP 服务器注册，面板只负责
// "允许哪些"，不负责"定义什么"。定义和授权分开，才不会长出第二套 schema。
// ==========================================================================

import { useMemo } from 'react';
import { ensureHostToolsRegistered, toolRegistry } from '@/core/ai/tools';
import { isMutatingTool, isReadOnlyTool } from '@/core/ai/tools/registry';
import { useAiToolPolicyStore } from '@/stores/aiToolPolicyStore';
import { useT } from '@/i18n';

export function AgentCapabilityPanel() {
  const t = useT();
  const disabledTools = useAiToolPolicyStore((s) => s.disabledTools);
  const toggleTool = useAiToolPolicyStore((s) => s.toggleTool);
  const enableAll = useAiToolPolicyStore((s) => s.enableAll);

  // 注册表是运行期注册的；面板打开时确保 host 工具已就位。
  ensureHostToolsRegistered();
  const tools = useMemo(() => toolRegistry.list(), [disabledTools]);

  const enabled = tools.filter((tool) => !disabledTools.includes(tool.name)).length;

  return (
    <div className="agent-capabilities" data-testid="agent-capability-panel">
      <div className="agent-cap-head">
        <span className="agent-cap-title">能力</span>
        <span className="agent-cap-count">{enabled}/{tools.length} 已启用</span>
      </div>

      <ul className="agent-cap-list">
        {tools.map((tool) => {
          const readOnly = isReadOnlyTool(tool.name);
          const mutating = isMutatingTool(tool.name);
          return (
            <li key={tool.name} className="agent-cap-item">
              <label className="agent-cap-row">
                <input
                  type="checkbox"
                  checked={!disabledTools.includes(tool.name)}
                  onChange={(e) => toggleTool(tool.name, e.target.checked)}
                />
                <span className="agent-cap-main">
                  <span className="agent-cap-name">{tool.name}</span>
                  <span className="agent-cap-desc">{tool.description}</span>
                </span>
                <span className={`agent-cap-tag${readOnly ? ' is-safe' : mutating ? ' is-write' : ''}`}>
                  {readOnly ? '只读' : mutating ? '写入' : '工具'}
                </span>
              </label>
            </li>
          );
        })}
      </ul>

      <div className="agent-cap-foot">
        <button type="button" className="btn btn-sm" onClick={enableAll} disabled={disabledTools.length === 0}>
          全部启用
        </button>
      </div>

      <p className="agent-cap-note">
        MCP：工具注册表已按来源区分 host / mcp，并支持整批替换；但浏览器侧的 MCP 客户端尚未接入，
        这里不显示"未连接"的假条目。接入后工具会直接出现在上面的列表里。
      </p>
      <p className="agent-cap-note">
        关闭的工具不会出现在模型的可调用清单里——不是调用时再拒绝，而是让它根本看不见。
      </p>
      <p className="agent-cap-note">{t('ai.tools_available', { n: enabled })}</p>
    </div>
  );
}
