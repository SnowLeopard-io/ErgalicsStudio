import { describe, expect, it } from 'vitest';
import { checklistToJson, checklistToMarkdown } from '@/core/submit/export';
import { runSubmissionCheck, type SubmissionDoc } from '@/core/submit/checklist';

const doc: SubmissionDoc = {
  templateId: 'console',
  caption: '',
  panels: [],
  export: { format: 'png600', rasterDpi: 150, colorMode: 'rgb', fontEmbedded: false },
  hasProvenance: false,
};

const result = runSubmissionCheck(doc, 'ieee');
const translate = (key: string) => key.replace(/^submit\.check\./, '').replace(/\.(label|message|fix)$/, '');

describe('checklist export', () => {
  it('renders every failure with fix guidance', () => {
    const md = checklistToMarkdown(result, translate);
    expect(md).toContain('# Submission checklist');
    expect(md).toContain('FAIL');
    expect(md).toContain('## Required fixes before submission');
    expect(md).toContain('Fix:');
    expect(md).toContain('provenance_present');
  });

  it('emits machine-readable JSON with fixes on failed items', () => {
    const parsed = JSON.parse(checklistToJson(result, translate));
    expect(parsed.schema).toBe('ergalics.checklist/1');
    expect(parsed.passed).toBe(false);
    const failed = parsed.items.filter((i: { passed: boolean }) => !i.passed);
    expect(failed.length).toBe(result.failedCount);
    expect(failed.every((i: { fix?: string }) => typeof i.fix === 'string' && i.fix.length > 0)).toBe(true);
  });
});
