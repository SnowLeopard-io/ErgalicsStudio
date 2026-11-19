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

/** 3-D ⇄ 2-D switch plus the PNG snapshot trigger. The snapshot button is
 *  hidden in 2-D mode: no Three.js renderer exists there, so it could only
 *  ever do nothing. */
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
      {view3d && (
        <button type="button" className="btn btn-sm" onClick={onSnapshot}>
          {t('industrial.cad_snapshot')}
        </button>
      )}
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

/** Lightweight SVG mesh viewer with field colouring. */
export function MeshCanvas({
  mesh,
  field,
  height = 420,
}: {
  mesh: EngineeringMesh;
  field?: EngineeringField | null;
  height?: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
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
    };

    draw();
    // Re-draw when the pane (not the viewport) changes size, e.g. the right
    // panel opens or the workbench is resized.
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => draw());
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [mesh, field, height]);
  return <canvas ref={ref} className="ind-mesh-canvas" style={{ height }} />;
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
