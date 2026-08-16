// ==========================================================================
// Ergalics Studio — block canvas (block system)
//
// Renders the block graph (nodes + SVG connections) and owns the pointer
// interaction: pan (drag empty space), zoom (wheel), node drag, port
// connect, and selection. All geometry is delegated to geometry.ts.
// ==========================================================================

import { useEffect, useRef, useState } from 'react';
import { useBlockStore } from '@/stores/blockStore';
import { blockRegistry } from '@/blocks/registry';
import type { BlockInstance, BlockMeta } from '@/types/block';
import {
  connectionPath,
  hitTestPoint,
  MAX_PARAM_ROWS,
  nodeHeight,
  portOffset,
  PORT_RADIUS,
  screenToWorld,
  worldToScreen,
} from './geometry';
import type { Point, Viewport } from './geometry';
import { BlockNode } from './BlockNode';

type DragState =
  | { kind: 'pan'; startScreen: Point; startViewport: Viewport }
  | { kind: 'node'; id: string; offset: Point }
  | { kind: 'connect'; fromNode: string; fromPort: string; cursor: Point }
  | null;

/** Rubber-band line shown while dragging an output port to an input port. */
interface PendingConnect {
  fromNode: string;
  fromPort: string;
  cursor: Point;
}

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 3;

function paramRowsOf(instance: BlockInstance): number {
  return Math.min(Object.keys(instance.params).length, MAX_PARAM_ROWS);
}

/** Screen-space position of a port: node screen pos + unscaled port offset. */
function portScreenPos(
  instance: BlockInstance,
  meta: BlockMeta,
  portId: string,
  side: 'in' | 'out',
  viewport: Viewport,
): Point {
  const ports = side === 'in' ? meta.inputs : meta.outputs;
  const index = ports.findIndex((p) => p.id === portId);
  const nodeScreen = worldToScreen(instance.position, viewport);
  const offset = portOffset(index, side, paramRowsOf(instance));
  return { x: nodeScreen.x + offset.x, y: nodeScreen.y + offset.y };
}

export function BlockCanvas() {
  const instances = useBlockStore((s) => s.instances);
  const connections = useBlockStore((s) => s.connections);
  const viewport = useBlockStore((s) => s.viewport);
  const selectedIds = useBlockStore((s) => s.selectedIds);
  const nodeStatus = useBlockStore((s) => s.nodeStatus);

  const containerRef = useRef<HTMLDivElement>(null);
  const drag = useRef<DragState>(null);
  const [pending, setPending] = useState<PendingConnect | null>(null);

  // Keep the palette's "drop at viewport center" math honest by publishing
  // the real canvas size; otherwise a node dropped from the palette lands at
  // a screen corner regardless of the current zoom/pan.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const report = () => {
      const rect = el.getBoundingClientRect();
      useBlockStore.getState().setCanvasSize({ width: rect.width, height: rect.height });
    };
    report();
    const ro = new ResizeObserver(report);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const clientToLocal = (clientX: number, clientY: number): Point => {
    const rect = containerRef.current!.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const local = clientToLocal(e.clientX, e.clientY);
    // Empty space → begin pan.
    drag.current = { kind: 'pan', startScreen: local, startViewport: viewport };
    useBlockStore.getState().setSelected([]);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onNodePointerDown = (e: React.PointerEvent, id: string) => {
    e.stopPropagation();
    const local = clientToLocal(e.clientX, e.clientY);
    const inst = useBlockStore.getState().instances.find((i) => i.id === id);
    if (!inst) return;
    const world = screenToWorld(local, viewport);
    drag.current = {
      kind: 'node',
      id,
      offset: { x: world.x - inst.position.x, y: world.y - inst.position.y },
    };
    useBlockStore.getState().setSelected([id]);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onPortPointerDown = (
    e: React.PointerEvent,
    id: string,
    portId: string,
    side: 'in' | 'out',
  ) => {
    e.stopPropagation();
    if (side === 'in') return; // connecting starts from an output port
    const local = clientToLocal(e.clientX, e.clientY);
    drag.current = { kind: 'connect', fromNode: id, fromPort: portId, cursor: local };
    // Push the rubber-band line into React state so it actually re-renders.
    setPending({ fromNode: id, fromPort: portId, cursor: local });
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const local = clientToLocal(e.clientX, e.clientY);
    const store = useBlockStore.getState();

    if (d.kind === 'pan') {
      store.setViewport({
        ...viewport,
        x: d.startViewport.x + (local.x - d.startScreen.x),
        y: d.startViewport.y + (local.y - d.startScreen.y),
      });
    } else if (d.kind === 'node') {
      const world = screenToWorld(local, viewport);
      store.moveInstance(d.id, { x: world.x - d.offset.x, y: world.y - d.offset.y });
    } else if (d.kind === 'connect') {
      drag.current = { ...d, cursor: local };
      setPending({ fromNode: d.fromNode, fromPort: d.fromPort, cursor: local });
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    setPending(null);
    if (d?.kind !== 'connect') return;

    const local = clientToLocal(e.clientX, e.clientY);
    const store = useBlockStore.getState();
    // Find an input port under the cursor (screen space).
    for (const inst of store.instances) {
      if (inst.id === d.fromNode) continue;
      const meta = blockRegistry.get(inst.blockId);
      if (!meta) continue;
      const paramRows = paramRowsOf(inst);
      const nodeScreen = worldToScreen(inst.position, viewport);
      for (let i = 0; i < meta.inputs.length; i += 1) {
        const offset = portOffset(i, 'in', paramRows);
        const center = { x: nodeScreen.x + offset.x, y: nodeScreen.y + offset.y };
        if (hitTestPoint(local, center, PORT_RADIUS * 2)) {
          store.connect(
            { nodeId: d.fromNode, portId: d.fromPort },
            { nodeId: inst.id, portId: meta.inputs[i]!.id },
          );
          return;
        }
      }
    }
  };

  const onWheel = (e: React.WheelEvent) => {
    const local = clientToLocal(e.clientX, e.clientY);
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    const nextZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, viewport.zoom * factor));
    const world = screenToWorld(local, viewport);
    useBlockStore.getState().setViewport({
      zoom: nextZoom,
      x: local.x - world.x * nextZoom,
      y: local.y - world.y * nextZoom,
    });
  };

  // Build connection paths in screen space.
  const paths: { id: string; d: string }[] = [];
  for (const c of connections) {
    const from = useBlockStore.getState().instances.find((i) => i.id === c.from.nodeId);
    const to = useBlockStore.getState().instances.find((i) => i.id === c.to.nodeId);
    const fromMeta = from && blockRegistry.get(from.blockId);
    const toMeta = to && blockRegistry.get(to.blockId);
    if (!from || !to || !fromMeta || !toMeta) continue;
    const p1 = portScreenPos(from, fromMeta, c.from.portId, 'out', viewport);
    const p2 = portScreenPos(to, toMeta, c.to.portId, 'in', viewport);
    paths.push({ id: c.id, d: connectionPath(p1, p2) });
  }
  if (pending) {
    const from = useBlockStore.getState().instances.find((i) => i.id === pending.fromNode);
    const fromMeta = from && blockRegistry.get(from.blockId);
    if (from && fromMeta) {
      const p1 = portScreenPos(from, fromMeta, pending.fromPort, 'out', viewport);
      paths.push({ id: '__pending__', d: connectionPath(p1, pending.cursor) });
    }
  }

  return (
    <div
      ref={containerRef}
      className="block-canvas"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onWheel={onWheel}
    >
      <svg className="block-canvas-svg">
        {paths.map((p) => (
          <path key={p.id} className="block-connection" d={p.d} />
        ))}
      </svg>

      {instances.map((inst) => {
        const meta = blockRegistry.get(inst.blockId);
        if (!meta) return null;
        return (
          <BlockNode
            key={inst.id}
            instance={inst}
            meta={meta}
            selected={selectedIds.includes(inst.id)}
            status={nodeStatus[inst.id] ?? 'idle'}
            screenPos={worldToScreen(inst.position, viewport)}
            height={nodeHeight(meta.inputs.length, meta.outputs.length, paramRowsOf(inst))}
            onNodePointerDown={onNodePointerDown}
            onPortPointerDown={onPortPointerDown}
          />
        );
      })}
    </div>
  );
}
