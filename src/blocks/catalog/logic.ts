// ==========================================================================
// Ergalics Studio — built-in logic blocks (block system)
//
// Phase 1 keeps only `logic.sequence` — the one control-flow-like block that
// is a natural special case of a linear DAG. The other logic blocks are
// deferred (see block-system-design.md appendix A.1).
// ==========================================================================

import type { BlockMeta } from '@/types/block';
import type { BlockExecutor } from '@/types/dag';

export const logicSequence: BlockMeta = {
  id: 'logic.sequence',
  category: 'logic',
  name: '顺序执行',
  nameI18n: { 'en-US': 'Sequence' },
  description: '强制按顺序执行，透传输入数据',
  descriptionI18n: { 'en-US': 'Enforce sequential execution; pass data through' },
  icon: '→',
  color: '#616161',
  inputs: [
    { id: 'data', label: '数据', type: 'data', dataType: 'DataTable', required: true },
  ],
  outputs: [
    { id: 'data', label: '数据', type: 'data', dataType: 'DataTable', required: false },
  ],
  defaultParams: {},
  gpuMode: 'cpu-only',
};

export const logicSequenceExecutor: BlockExecutor = async (ctx) => ctx.getInput('data');
