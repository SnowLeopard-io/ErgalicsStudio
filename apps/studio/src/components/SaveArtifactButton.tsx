// ==========================================================================
// Ergalics Studio — SaveArtifactButton
//
// 通用的"保存到工作区"按钮：把页面产出的文本工件（JSON 快照 / SVG /
// CSV / HTML 报告 …）写入当前项目 Git 仓库工作树的指定骨架目录。
// 重名自动加序号，成功后通知落盘路径并刷新侧栏文件资源管理器。
// labs 各工具页都应通过本组件暴露保存能力，保持行为一致。
// ==========================================================================

import { useState } from 'react';
import { useT } from '@/i18n';
import { useAppStore } from '@/stores/appStore';
import { useProjectStore } from '@/stores/projectStore';
import { saveTextArtifact, type ArtifactDir } from '@/core/workspace-artifacts';

interface Props {
  /** Target skeleton dir ('' = repo root). */
  dir: ArtifactDir;
  /** File name inside the dir (duplicates get " (2)", " (3)", …). */
  filename: string;
  /** UTF-8 text content to write. */
  content: string | null;
  /** Override the default label. */
  label?: string;
  /** Extra classes appended to the button. */
  className?: string;
}

export function SaveArtifactButton({
  dir,
  filename,
  content,
  label,
  className,
}: Props) {
  const t = useT();
  const notify = useAppStore((s) => s.notify);
  const project = useProjectStore((s) => s.project);
  const [busy, setBusy] = useState(false);

  const onClick = () => {
    if (!content || busy) return;
    if (!project) {
      notify('error', t('labs.no_project'));
      return;
    }
    setBusy(true);
    void saveTextArtifact(project, dir, filename, content)
      .then((path) => notify('success', t('labs.saved_ws', { path })))
      .catch(() => notify('error', t('labs.save_failed')))
      .finally(() => setBusy(false));
  };

  return (
    <button
      type="button"
      className={className ?? 'btn btn-primary'}
      disabled={!content || busy || !project}
      title={project ? undefined : t('labs.no_project')}
      onClick={onClick}
    >
      {label ?? t('labs.save_ws')}
    </button>
  );
}
