// ==========================================================================
// Ergalics Studio — industrial viewport widgets
//
// Two renderers share this module: the Three.js CAD viewport (CadViewport.tsx)
// for real 3-D/stl-style output and the lightweight canvas plot used for 2-D
// meshes. The toggle / preset bars live here too so geometry and mesh pages
// expose one identical set of view actions instead of two diverging copies.
// ==========================================================================

import { useEffect, useRef } from 'react';
import { useT } from '@/i18n';
import type { EngineeringField, EngineeringMesh } from '@/core/engineering/types';
import type { CadViewPreset } from './CadViewport';

const PRESETS: readonly CadViewPreset[] = ['fit', 'front', 'top', 'side'];

/** Save a `data:` URL produced by the CAD snapshot hook. */
export function downloadSnapshot(url: string, filename: string): void {
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
}

/** 3-D ⇄ 2-D switch plus the PNG snapshot trigger. Both modes can snapshot:
 *  3-D renders the WebGL canvas, 2-D the lightweight mesh canvas. */
export function ViewToggle({
  view3d,
  onToggle,
  onSnapshot,
}: {
  view3d: boolean;
  onToggle: () => void;
  onSnapshot: () => void;
}) {
  const t = useT();
  return (
    <>
      <button type="button" className="btn btn-sm" onClick={onToggle}>
        {view3d ? t('industrial.cad_view') : '2D'}
      </button>
      <button type="button" className="btn btn-sm" onClick={onSnapshot}>
        {t('industrial.cad_snapshot')}
      </button>
    </>
  );
}

/** Camera presets + wireframe toggle, shown only while 3-D is active. */
export function ViewPresetBar({
  preset,
  onPreset,
  wireframe,
  onWireframe,
}: {
  preset: CadViewPreset;
  onPreset: (preset: CadViewPreset) => void;
  wireframe: boolean;
  onWireframe: (wireframe: boolean) => void;
}) {
  const t = useT();
  return (
    <div className="ind-toolbar analysis-row">
      {PRESETS.map((p) => (
        <button
          key={p}
          type="button"
          className={`btn btn-sm${preset === p ? ' is-active' : ''}`}
          onClick={() => onPreset(p)}
        >
          {t(`industrial.cad_view_${p}`)}
        </button>
      ))}
      <label className="research-check">
        <input type="checkbox" checked={wireframe} onChange={(e) => onWireframe(e.target.checked)} />
        {t('industrial.cad_wireframe')}
      </label>
      <span className="ind-hint">{t('industrial.cad_hint')}</span>
    </div>
  );
}

/** Lightweight SVG mesh viewer with field colouring. `snapshotRequest` is a
 *  counter: each increment exports the current canvas as a PNG data URL, so
 *  the 2-D mode offers the same 导出图片 action as the 3-D viewport. */
export function MeshCanvas({
  mesh,
  field,
  vectors,
  height = 420,
  snapshotRequest = 0,
  onSnapshotReady,
}: {
  mesh: EngineeringMesh;
  field?: EngineeringField | null;
  /** Optional element-centred vector field (e.g. potential-flow velocity).
   *  Drawn as arrows on top of the colour map. */
  vectors?: EngineeringField | null;
  height?: number;
  snapshotRequest?: number;
  onSnapshotReady?: (url: string) => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const readyRef = useRef(onSnapshotReady);
  readyRef.current = onSnapshotReady;
  useEffect(() => {
    if (snapshotRequest === 0) return;
    const canvas = ref.current;
    const ready = readyRef.current;
    if (!canvas || !ready) return;
    ready(canvas.toDataURL('image/png'));
  }, [snapshotRequest]);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    /** Flat [x0, y0, x1, y1, …] projected node buffer, reused across redraws
     *  (resize ticks). Mapping nodes to an array of tuples allocated one small
     *  array per node, i.e. ~1M allocations per redraw on large meshes. */
    let positions = new Float64Array(mesh.nodes.length * 2);

    const draw = (): void => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const width = canvas.clientWidth || 800;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      const [minX, minY, , maxX, maxY] = mesh.bounds;
      const spanX = maxX - minX || 1;
      const spanY = maxY - minY || 1;
      const pad = 18;
      const scale = Math.min((width - pad * 2) / spanX, (height - pad * 2) / spanY);
      const offX = (width - spanX * scale) / 2;
      const offY = (height - spanY * scale) / 2;
      const px = (x: number) => offX + (x - minX) * scale;
      const py = (y: number) => height - offY - (y - minY) * scale;
      if (positions.length !== mesh.nodes.length * 2) {
        positions = new Float64Array(mesh.nodes.length * 2);
      }
      for (let i = 0; i < mesh.nodes.length; i += 1) {
        const node = mesh.nodes[i]!;
        positions[i * 2] = px(node.x);
        positions[i * 2 + 1] = py(node.y);
      }

      let min = Infinity;
      let max = -Infinity;
      if (field) {
        for (const value of field.values) {
          if (Number.isFinite(value)) {
            if (value < min) min = value;
            if (value > max) max = value;
          }
        }
      }
      const span = field ? max - min || 1 : 1;

      const fillFor = (elementIndex: number): string => {
        if (!field) return 'rgba(96,165,250,0.10)';
        const value =
          field.location === 'element'
            ? field.values[elementIndex * field.components] ?? min
            : averageElement(field, mesh, elementIndex);
        const t = Math.max(0, Math.min(1, (value - min) / span));
        // Blue → cyan → yellow → red.
        const hue = 220 - 220 * t;
        return `hsla(${hue}, 82%, 55%, 0.55)`;
      };

      const maxElements = 12000;
      const stride = Math.max(1, Math.ceil(mesh.elements.length / maxElements));
      ctx.lineWidth = mesh.elements.length > 4000 ? 0.35 : 0.8;
      for (let index = 0; index < mesh.elements.length; index += stride) {
        const element = mesh.elements[index]!;
        if (element.nodes.length < 2) continue;
        ctx.beginPath();
        element.nodes.forEach((nodeIndex, i) => {
          const ox = positions[nodeIndex * 2];
          const oy = positions[nodeIndex * 2 + 1];
          if (ox === undefined || oy === undefined) return;
          if (i === 0) ctx.moveTo(ox, oy);
          else ctx.lineTo(ox, oy);
        });
        if (element.nodes.length >= 3) {
          ctx.closePath();
          ctx.fillStyle = fillFor(index);
          ctx.fill();
        }
        ctx.strokeStyle = element.nodes.length >= 3 ? 'rgba(30,41,59,0.35)' : 'rgba(59,130,246,0.7)';
        ctx.stroke();
      }
      if (mesh.elements.length === 0) {
        ctx.fillStyle = 'rgba(59,130,246,0.9)';
        for (let i = 0; i < mesh.nodes.length; i += 1) {
          ctx.beginPath();
          ctx.arc(positions[i * 2]!, positions[i * 2 + 1]!, 1.4, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      drawVectors(ctx, mesh, vectors, positions);
    };

    draw();
    // Re-draw when the pane (not the viewport) changes size, e.g. the right
    // panel opens or the workbench is resized.
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => draw());
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [mesh, field, vectors, height]);
  return <canvas ref={ref} className="ind-mesh-canvas" style={{ height }} />;
}

/**
 * Element-centred arrows over the colour map. Length is proportional to the
 * magnitude (with a floor so slow regions are still visible), direction is
 * drawn from the vector components. Capped at a few hundred arrows so large
 * meshes stay readable and cheap to paint.
 */
function drawVectors(
  ctx: CanvasRenderingContext2D,
  mesh: EngineeringMesh,
  vectors: EngineeringField | null | undefined,
  positions: Float64Array,
): void {
  if (!vectors || vectors.location !== 'element' || vectors.components < 2) return;
  const components = vectors.components;
  const count = mesh.elements.length;
  if (count === 0) return;
  let maxMagnitude = 0;
  for (let i = 0; i < count; i += 1) {
    const magnitude = Math.hypot(
      vectors.values[i * components] ?? 0,
      vectors.values[i * components + 1] ?? 0,
    );
    if (Number.isFinite(magnitude) && magnitude > maxMagnitude) maxMagnitude = magnitude;
  }
  if (!(maxMagnitude > 0)) return;
  const stride = Math.max(1, Math.ceil(count / 420));
  const baseLength = 18;
  ctx.lineCap = 'round';
  for (let index = 0; index < count; index += stride) {
    const vx = vectors.values[index * components] ?? 0;
    const vy = vectors.values[index * components + 1] ?? 0;
    const magnitude = Math.hypot(vx, vy);
    if (!(magnitude > 0)) continue;
    const element = mesh.elements[index]!;
    let cx = 0;
    let cy = 0;
    let hits = 0;
    for (const nodeIndex of element.nodes) {
      const ox = positions[nodeIndex * 2];
      const oy = positions[nodeIndex * 2 + 1];
      if (ox === undefined || oy === undefined) continue;
      cx += ox;
      cy += oy;
      hits += 1;
    }
    if (hits === 0) continue;
    cx /= hits;
    cy /= hits;
    // Canvas y grows downwards, so the vertical component is negated.
    const ux = vx / magnitude;
    const uy = -vy / magnitude;
    const length = baseLength * (0.4 + 0.6 * Math.min(1, magnitude / maxMagnitude));
    const half = length / 2;
    const x0 = cx - ux * half;
    const y0 = cy - uy * half;
    const x1 = cx + ux * half;
    const y1 = cy + uy * half;
    const head = Math.min(5, half);
    for (const [stroke, width] of [['rgba(15,23,42,0.35)', 2.6], ['rgba(248,250,252,0.95)', 1.1]] as const) {
      ctx.strokeStyle = stroke;
      ctx.fillStyle = stroke;
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x1 - ux * head - uy * head * 0.55, y1 - uy * head + ux * head * 0.55);
      ctx.lineTo(x1 - ux * head + uy * head * 0.55, y1 - uy * head - ux * head * 0.55);
      ctx.closePath();
      ctx.fill();
    }
  }
}

function averageElement(field: EngineeringField, mesh: EngineeringMesh, elementIndex: number): number {
  const element = mesh.elements[elementIndex];
  if (!element) return 0;
  let total = 0;
  let count = 0;
  for (const node of element.nodes) {
    const value = field.values[node * field.components];
    if (Number.isFinite(value)) {
      total += value!;
      count += 1;
    }
  }
  return count > 0 ? total / count : 0;
}
