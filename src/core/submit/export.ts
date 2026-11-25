// ==========================================================================
// Submission checklist export (FR-10)
//
// Turns a submission gate result into publishable Markdown / JSON. Failed
// items always carry their fix guidance — a bare FAIL is not actionable.
// ==========================================================================

import type { CheckItem, SubmissionCheckResult } from './checklist';

export type ChecklistTranslator = (key: string, params?: Record<string, string | number>) => string;

const identity: ChecklistTranslator = (key, params) =>
  params && Object.keys(params).length > 0 ? `${key} ${JSON.stringify(params)}` : key;

function textFor(item: CheckItem, field: 'labelKey' | 'messageKey' | 'fixKey', t: ChecklistTranslator): string {
  return t(item[field], item.params);
}

export function checklistToMarkdown(
  result: SubmissionCheckResult,
  t: ChecklistTranslator = identity,
): string {
  const lines: string[] = [
    `# Submission checklist — ${result.targetId.toUpperCase()}`,
    '',
    `${result.items.length - result.failedCount}/${result.total} checks passed.`,
    '',
  ];
  for (const group of result.groups) {
    lines.push(`## ${group.group}`);
    lines.push('');
    for (const item of group.items) {
      const mark = item.passed ? 'PASS' : 'FAIL';
      lines.push(`- [${item.passed ? 'x' : ' '}] **${mark} — ${textFor(item, 'labelKey', t)}**`);
      lines.push(`  - ${textFor(item, 'messageKey', t)}`);
      if (!item.passed) lines.push(`  - Fix: ${textFor(item, 'fixKey', t)}`);
    }
    lines.push('');
  }
  if (result.failedCount > 0) {
    lines.push('## Required fixes before submission');
    lines.push('');
    for (const item of result.items.filter((i) => !i.passed)) {
      lines.push(`1. **${textFor(item, 'labelKey', t)}** — ${textFor(item, 'fixKey', t)}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

export function checklistToJson(
  result: SubmissionCheckResult,
  t: ChecklistTranslator = identity,
): string {
  const payload = {
    schema: 'ergalics.checklist/1',
    target: result.targetId,
    passed: result.passed,
    total: result.total,
    failedCount: result.failedCount,
    items: result.items.map((item) => ({
      id: item.id,
      group: item.group,
      passed: item.passed,
      label: textFor(item, 'labelKey', t),
      message: textFor(item, 'messageKey', t),
      fix: item.passed ? undefined : textFor(item, 'fixKey', t),
      focusTarget: item.focusTarget,
    })),
  };
  return `${JSON.stringify(payload, null, 2)}\n`;
}
