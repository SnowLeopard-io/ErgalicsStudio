import { useId, useMemo } from 'react';
import type { ChartType } from '../data/gallery-types';

// Deterministic pseudo-random from a seed (mulberry32).
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PALETTE = ['#2dd4bf', '#22d3ee', '#a78bfa', '#f472b6', '#fbbf24', '#34d399'];

/** Abstract instrument-style cover art, deterministic per (seed, chartType). */
export function CoverArt({ seed, chartType }: { seed: number; chartType: ChartType }) {
  const uid = useId().replace(/[:]/g, '');
  const art = useMemo(() => {
    const r = rng(seed * 7919 + chartType.length * 31);
    const c = () => PALETTE[Math.floor(r() * PALETTE.length)];
    switch (chartType) {
      case 'line': {
        const paths = Array.from({ length: 3 }, (_, i) => {
          const pts: string[] = [];
          let y = 30 + r() * 40;
          for (let x = 0; x <= 100; x += 5) {
            y += (r() - 0.5) * 18;
            y = Math.max(8, Math.min(92, y));
            pts.push(`${x},${y}`);
          }
          return { d: 'M' + pts.join(' L'), color: c(), w: 2 - i * 0.4 };
        });
        return <g>{paths.map((p, i) => <path key={i} d={p.d} fill="none" stroke={p.color} strokeWidth={p.w} strokeLinecap="round" />)}</g>;
      }
      case 'scatter': {
        const pts = Array.from({ length: 46 }, () => ({ x: 6 + r() * 88, y: 8 + r() * 84, s: 1 + r() * 2.6 }));
        return <g>{pts.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={p.s} fill={c()} opacity={0.85} />)}</g>;
      }
      case 'histogram': {
        const bars = Array.from({ length: 14 }, (_, i) => ({ x: 4 + i * 6.8, h: 12 + r() * 74 }));
        return <g>{bars.map((b, i) => <rect key={i} x={b.x} y={100 - b.h} width={5.2} height={b.h} rx={1} fill={c()} opacity={0.85} />)}</g>;
      }
      case 'heatmap': {
        const cells = [];
        for (let gy = 0; gy < 6; gy++) for (let gx = 0; gx < 12; gx++)
          cells.push(<rect key={`${gx}-${gy}`} x={4 + gx * 8} y={8 + gy * 14} width={7} height={12.5} rx={1} fill={c()} opacity={0.25 + r() * 0.7} />);
        return <g>{cells}</g>;
      }
      case 'contour': {
        const rings = Array.from({ length: 5 }, (_, i) => i);
        const cx = 30 + r() * 40, cy = 35 + r() * 30;
        return <g>{rings.map((i) => <ellipse key={i} cx={cx} cy={cy} rx={8 + i * 8 + r() * 3} ry={5 + i * 6 + r() * 2} fill="none" stroke={c()} strokeWidth={1.4} opacity={0.8} />)}</g>;
      }
      case 'boxplot': {
        const boxes = Array.from({ length: 5 }, (_, i) => ({ x: 8 + i * 18, med: 30 + r() * 40, lo: r() * 20, hi: 60 + r() * 30 }));
        return <g>{boxes.map((b, i) => (
          <g key={i} stroke={c()} strokeWidth={1.6} fill="none">
            <line x1={b.x + 5} y1={100 - b.hi} x2={b.x + 5} y2={100 - b.lo} />
            <rect x={b.x} y={100 - b.med - 9} width={10} height={18} fill={c()} opacity={0.3} />
            <line x1={b.x - 2} y1={100 - b.med} x2={b.x + 12} y2={100 - b.med} strokeWidth={2.2} />
          </g>
        ))}</g>;
      }
      case 'surface': {
        const lines = Array.from({ length: 8 }, (_, i) => {
          const pts: string[] = [];
          let y = 20 + i * 9;
          for (let x = 4; x <= 96; x += 6) { y += (r() - 0.5) * 7; pts.push(`${x},${y - Math.sin(x / 14 + i) * 5}`); }
          return { d: 'M' + pts.join(' L'), color: c() };
        });
        return <g>{lines.map((l, i) => <path key={i} d={l.d} fill="none" stroke={l.color} strokeWidth={1.3} opacity={0.85} />)}</g>;
      }
      case 'pointcloud': {
        const pts = Array.from({ length: 120 }, () => ({ x: 4 + r() * 92, y: 6 + r() * 88 }));
        return <g>{pts.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={0.8} fill={c()} opacity={0.7} />)}</g>;
      }
      case 'sankey': {
        const flows = Array.from({ length: 6 }, (_, i) => ({ y1: 10 + i * 14, y2: 14 + ((i * 37) % 60), w: 3 + r() * 6 }));
        return <g>{flows.map((f, i) => <path key={i} d={`M4 ${f.y1} C 40 ${f.y1}, 60 ${f.y2}, 96 ${f.y2}`} stroke={c()} strokeWidth={f.w} fill="none" opacity={0.55} strokeLinecap="round" />)}</g>;
      }
      case 'qq': {
        const pts = Array.from({ length: 30 }, () => { const t = r() * 90; return { x: 5 + t, y: 5 + t + (r() - 0.5) * 10 }; });
        return <g>
          <line x1={5} y1={95} x2={95} y2={5} stroke="var(--color-text-tertiary)" strokeWidth={1} strokeDasharray="3 3" />
          {pts.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={1.6} fill={c()} />)}
        </g>;
      }
    }
  }, [seed, chartType]);

  return (
    <svg viewBox="0 0 100 100" role="img" aria-label={`${chartType} preview`} preserveAspectRatio="none" className="cover-art">
      <defs>
        <linearGradient id={`bg-${uid}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--color-bg-tertiary)" />
          <stop offset="1" stopColor="var(--color-bg-elevated)" />
        </linearGradient>
      </defs>
      <rect width="100" height="100" fill={`url(#bg-${uid})`} />
      {art}
    </svg>
  );
}
