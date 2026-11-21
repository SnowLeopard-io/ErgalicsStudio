// ==========================================================================
// Ergalics Studio — Agent 工作页（/agent）
//
// 为什么要有这一页
// --------------
// Agent 原来只是右下角一个浮窗：用户在主界面上找不到它，找到也以为是个
// 辅助挂件；"能力"和"服务设置"都塞在对话框下方，等于没有配置入口。
//
// 这一页把三件事摆到台面上：
//   1. 左边是真实工作台（Agent 要操作的元素全部由它注册）；
//   2. 右边是对话，随时能问；
//   3. "能力"页签里逐项开关工具，看清哪些是只读、哪些会写入。
//
// 结构上刻意复用既有组件，不复制一份面板：两套实现一定会漂移。
// ==========================================================================

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import WorkbenchPage from '@/pages/workbench/WorkbenchPage';
import { AiAssistantPanel } from '@/components/AiAssistantPanel';
import { AgentCapabilityPanel } from '@/components/AgentCapabilityPanel';
import { ChevronLeftIcon, SparklesIcon } from '@/components/icons';
import { useT } from '@/i18n';

type DockTab = 'chat' | 'capabilities';

export default function AgentPage() {
  const t = useT();
  const navigate = useNavigate();
  const [tab, setTab] = useState<DockTab>('chat');

  return (
    <div className="agent-shell">
      <div className="agent-shell-head">
        <button
          type="button"
          className="agent-shell-back"
          onClick={() => navigate('/workbench')}
          aria-label={t('agent.back')}
          title={t('agent.back')}
        >
          <ChevronLeftIcon size={16} />
        </button>
        <span className="agent-shell-title">
          <SparklesIcon size={18} />
          <strong>{t('agent.title')}</strong>
          <span className="agent-shell-sub">{t('agent.subtitle')}</span>
        </span>
      </div>

      <div className="agent-shell-body">
        <div className="agent-shell-stage">
          <WorkbenchPage />
        </div>

        <aside className="agent-shell-dock">
          <div className="agent-dock-tabs" role="tablist" aria-label={t('agent.title')}>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'chat'}
              className={`agent-dock-tab${tab === 'chat' ? ' is-active' : ''}`}
              onClick={() => setTab('chat')}
            >
              {t('agent.tab_chat')}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'capabilities'}
              className={`agent-dock-tab${tab === 'capabilities' ? ' is-active' : ''}`}
              onClick={() => setTab('capabilities')}
            >
              {t('agent.tab_capabilities')}
            </button>
          </div>

          {tab === 'chat' && (
            <div className="agent-dock-chat">
              <AiAssistantPanel />
            </div>
          )}
          {tab === 'capabilities' && <AgentCapabilityPanel />}
        </aside>
      </div>
    </div>
  );
}
