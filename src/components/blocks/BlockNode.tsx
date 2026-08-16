// ==========================================================================
// Ergalics Studio — block node component (block system)
//
// Node card: category accent bar, name, state dot, a read-only summary of
// the block's params, and input/output ports. Position & hit-testing live in
// geometry.ts; interaction is delegated up to BlockCanvas via callbacks.
// ==========================================================================

import type { BlockInstance, BlockMeta } from '@/types/block';
import type { NodeStatus } from '@/stores/blockStore';
import { useLocale } from '@/i18n';
import { blockName } from '@/blocks/l10n';
import {
  MAX_PARAM_ROWS,
  NODE_HEADER_HEIGHT,
  NODE_PARAM_ROW,
  NODE_PORT_ROW,
  NODE_WIDTH,
  PORT_RADIUS,
} from './geometry';
import type { Point } from './geometry';

interface BlockNodeProps {
  instance: BlockInstance;
  meta: BlockMeta;
  selected: boolean;
  status: NodeStatus;
  screenPos: Point;
  height: number;
  onNodePointerDown: (e: React.PointerEvent, id: string) => void;
  onPortPointerDown: (
    e: React.PointerEvent,
    id: string,
    portId: string,
    side: 'in' | 'out',
  ) => void;
}

function formatParam(value: unknown): string {
  if (value === undefined || value === null || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (Array.isArray(value)) return value.length ? value.join(', ') : '[]';
  return String(value);
}

function portTop(index: number, paramRows: number): number {
  return (
    NODE_HEADER_HEIGHT +
    paramRows * NODE_PARAM_ROW +
    index * NODE_PORT_ROW +
    NODE_PORT_ROW / 2 -
    PORT_RADIUS
  );
}

export function BlockNode(props: BlockNodeProps) {
  const { instance, meta, selected, status, screenPos, height } = props;
  const { locale } = useLocale();
  const paramEntries = Object.entries(instance.params).slice(0, MAX_PARAM_ROWS);
  const paramRows = paramEntries.length;

  return (
    <div
      className={`block-node${selected ? ' is-selected' : ''}`}
      style={{
        transform: `translate(${screenPos.x}px, ${screenPos.y}px)`,
        width: NODE_WIDTH,
        height,
      }}
      onPointerDown={(e) => props.onNodePointerDown(e, instance.id)}
    >
      <div className="block-node-header" style={{ borderTopColor: meta.color }}>
        <span className="block-node-dot" style={{ background: meta.color }} />
        <span className="block-node-name">{blockName(meta, locale)}</span>
        {status !== 'idle' && <span className={`block-node-state is-${status}`} />}
      </div>

      {paramEntries.length > 0 && (
        <div className="block-node-params">
          {paramEntries.map(([key, value]) => (
            <div key={key} className="block-node-param-row">
              <span className="block-node-param-key">{key}</span>
              <span className="block-node-param-value">{formatParam(value)}</span>
            </div>
          ))}
        </div>
      )}

      {meta.inputs.map((port, i) => (
        <span
          key={`in-${port.id}`}
          className="block-port is-in"
          style={{ top: portTop(i, paramRows), left: -PORT_RADIUS }}
          title={port.label}
          onPointerDown={(e) => {
            e.stopPropagation();
            props.onPortPointerDown(e, instance.id, port.id, 'in');
          }}
        />
      ))}
      {meta.outputs.map((port, i) => (
        <span
          key={`out-${port.id}`}
          className="block-port is-out"
          style={{ top: portTop(i, paramRows), left: NODE_WIDTH - PORT_RADIUS }}
          title={port.label}
          onPointerDown={(e) => {
            e.stopPropagation();
            props.onPortPointerDown(e, instance.id, port.id, 'out');
          }}
        />
      ))}
    </div>
  );
}
