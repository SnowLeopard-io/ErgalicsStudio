import { useRef, useState } from 'react';
import { useT } from '@/i18n';
import { PerfOverlay } from '@/components/PerfOverlay';

export function PerfPanel() {
  const t = useT();
  const [collapsed, setCollapsed] = useState(false);
  const [pos, setPos] = useState<{ x: number; y: number }>({ x: -1, y: -1 });
  const dragRef = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { sx: e.clientX, sy: e.clientY, ox: pos.x, oy: pos.y };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const x = d.ox + (e.clientX - d.sx);
    const y = d.oy + (e.clientY - d.sy);
    setPos({
      x: Math.max(0, Math.min(x, window.innerWidth - 220)),
      y: Math.max(0, Math.min(y, window.innerHeight - 120)),
    });
  };

  const onPointerUp = () => {
    dragRef.current = null;
  };

  const style: React.CSSProperties =
    pos.x >= 0
      ? { position: 'fixed', left: pos.x, top: pos.y }
      : { position: 'fixed', right: 16, bottom: 44 };

  return (
    <div className="perf-panel" style={style}>
      <div
        className="perf-panel-header"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        title={t('workbench.perf.title')}
      >
        <span className="perf-grip">⠿</span>
        <span>{t('workbench.perf.title')}</span>
        <button
          type="button"
          className="icon-btn perf-toggle"
          onClick={() => setCollapsed((c) => !c)}
          aria-label={collapsed ? 'expand' : 'collapse'}
        >
          {collapsed ? '▾' : '▴'}
        </button>
      </div>
      {!collapsed && <PerfOverlay />}
    </div>
  );
}