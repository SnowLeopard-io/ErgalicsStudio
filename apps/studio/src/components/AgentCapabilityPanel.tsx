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
  const tools = toolRegistry.list();

  const enabled = tools.filter((tool) => !disabledTools.includes(tool.name)).length;

  /**
   * 工具名与描述写给模型看（英文），面板则面向用户：优先取 i18n，
   * 未登记的工具回退到注册表里的 title / description。
   */
  const localized = (name: string, field: 'name' | 'desc', fallback: string) => {
    const key = `agent.tool.${name}.${field}`;
    const text = t(key);
    return text === key ? fallback : text;
  };

  return (
    <div className="agent-capabilities" data-testid="agent-capability-panel">
      <div className="agent-cap-head">
        <span className="agent-cap-title">{t('agent.cap.title')}</span>
        <span className="agent-cap-count">
          {t('agent.cap.enabled', { enabled, total: tools.length })}
        </span>
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
                  <span className="agent-cap-name" title={tool.name}>
                    {localized(tool.name, 'name', tool.title ?? tool.name)}
                  </span>
                  <span className="agent-cap-desc">
                    {localized(tool.name, 'desc', tool.description)}
                  </span>
                </span>
                <span className={`agent-cap-tag${readOnly ? ' is-safe' : mutating ? ' is-write' : ''}`}>
                  {readOnly
                    ? t('agent.cap.readonly')
                    : mutating
                      ? t('agent.cap.write')
                      : t('agent.cap.tool')}
                </span>
              </label>
            </li>
          );
        })}
      </ul>

      <div className="agent-cap-foot">
        <button type="button" className="btn btn-sm" onClick={enableAll} disabled={disabledTools.length === 0}>
          {t('agent.cap.enable_all')}
        </button>
      </div>

      <p className="agent-cap-note">{t('agent.cap.mcp_note')}</p>
      <p className="agent-cap-note">{t('agent.cap.hidden_note')}</p>
    </div>
  );
}
