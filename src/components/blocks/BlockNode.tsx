// ==========================================================================
// Ergalics Studio — block node component (block system)
//
// Node card: category accent bar, name, state dot, a read-only summary of
// the block's params, and input/output ports. Position & hit-testing live in
// geometry.ts; interaction is delegated up to BlockCanvas via callbacks.
// ==========================================================================

import { memo } from 'react';
import type { BlockInstance, BlockMeta } from '@/types/block';
import type { FlowBuildStepInfo, NodeStatus } from '@/stores/blockStore';
import type { PreviewStepStatus } from '@/core/build/engine';
import { useLocale, useT } from '@/i18n';
import { blockName } from '@/blocks/l10n';
import { CloseIcon } from '@/components/icons';
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
  /** Last run's cache decision for this node (absent before the first run). */
  build?: FlowBuildStepInfo;
  /** Dry-run verdict shown before the first run of the current graph. */
  preview?: PreviewStepStatus;
  screenPos: Point;
  height: number;
  onNodePointerDown: (e: React.PointerEvent, id: string) => void;
  onPortPointerDown: (
    e: React.PointerEvent,
    id: string,
    portId: string,
    side: 'in' | 'out',
  ) => void;
  onDelete: (id: string) => void;
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

function formatBuildDuration(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${Math.round(ms)} ms`;
}

function BlockNodeImpl(props: BlockNodeProps) {
  const { instance, meta, selected, status, build, preview, screenPos, height } = props;
  const { locale } = useLocale();
  const t = useT();
  const paramEntries = Object.entries(instance.params).slice(0, MAX_PARAM_ROWS);
  const paramRows = paramEntries.length;
  const buildLabel = build ? t(`blocks.build.node_${build.status}`) : '';
  const buildTitle = build
    ? [
        `${buildLabel} · ${formatBuildDuration(build.durationMs)}`,
        build.reason,
        ...(build.fromPersistence ? [t('blocks.build.node_persisted')] : []),
      ].join(' · ')
    : '';

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
        {!build && preview && (
          <span
            className={`block-node-build is-preview is-${preview}`}
            title={t('blocks.build.preview_node_hint')}
          >
            {t(`blocks.build.node_${preview}`)}
          </span>
        )}
        {build && (
          <span
            className={`block-node-build is-${build.status}`}
            title={buildTitle}
          >
            {buildLabel}
          </span>
        )}
        {status !== 'idle' && <span className={`block-node-state is-${status}`} />}
        <button
          type="button"
          className="block-node-delete"
          title={t('common.delete')}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            props.onDelete(instance.id);
          }}
        >
          <CloseIcon size={11} />
        </button>
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

/**
 * Memoized with a custom comparator: the canvas hands every node a freshly
 * allocated `screenPos` object on each render, so the default shallow compare
 * would never skip anything. During a node drag (or a status flip) all other
 * nodes keep identical positions, and skipping them is what keeps a large
 * graph from re-rendering on every pointermove.
 */
export const BlockNode = memo(
  BlockNodeImpl,
  (a, b) =>
    a.instance === b.instance &&
    a.meta === b.meta &&
    a.selected === b.selected &&
    a.status === b.status &&
    a.build === b.build &&
    a.preview === b.preview &&
    a.height === b.height &&
    a.screenPos.x === b.screenPos.x &&
    a.screenPos.y === b.screenPos.y &&
    a.onNodePointerDown === b.onNodePointerDown &&
    a.onPortPointerDown === b.onPortPointerDown &&
    a.onDelete === b.onDelete,
);
