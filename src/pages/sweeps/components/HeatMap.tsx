// ==========================================================================
// Sweep Studio — 2-axis heat map (pure SVG, no chart dependency)
// ==========================================================================

import { fmt as fmtNum } from '@/pages/research/researchUi';

export interface HeatMapProps {
  xVals: number[];
  yVals: number[];
  grid: number[][];
  lo: number;
  hi: number;
  xName: string;
  yName: string;
  colorAt: (value: number, low: number, high: number) => string;
}

export function HeatMap({ xVals, yVals, grid, lo, hi, xName, yName, colorAt }: HeatMapProps) {
  const cell = 34;
  const pad = 70;
  const width = pad + xVals.length * cell + 20;
  const height = pad + yVals.length * cell + 30;
  return (
    <svg className="sweep-heat" width={width} height={height} role="img" aria-label={`${xName} × ${yName}`}>
      {grid.map((row, yi) =>
        row.map((value, xi) => (
          <rect
            key={`${xi}-${yi}`}
            x={pad + xi * cell}
            y={height - 60 - (yi + 1) * cell}
            width={cell - 1}
            height={cell - 1}
            fill={colorAt(value, lo, hi)}
          >
            <title>{`${xName}=${xVals[xi]}, ${yName}=${yVals[yi]}: ${fmtNum(value, 5)}`}</title>
          </rect>
        )),
      )}
      {xVals.map((x, i) => (
        <text key={`x${i}`} x={pad + i * cell + cell / 2} y={height - 42} fontSize={10} textAnchor="middle">
          {fmtNum(x, 4)}
        </text>
      ))}
      {yVals.map((y, i) => (
        <text
          key={`y${i}`}
          x={pad - 6}
          y={height - 60 - (i + 1) * cell + cell / 2 + 3}
          fontSize={10}
          textAnchor="end"
        >
          {fmtNum(y, 4)}
        </text>
      ))}
      <text x={pad + (xVals.length * cell) / 2} y={height - 20} fontSize={11} textAnchor="middle">
        {xName}
      </text>
      <text
        x={14}
        y={height / 2}
        fontSize={11}
        textAnchor="middle"
        transform={`rotate(-90 14 ${height / 2})`}
      >
        {yName}
      </text>
    </svg>
  );
}
