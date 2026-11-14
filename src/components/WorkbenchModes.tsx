// Minimal line-style mode icons (stroke follows currentColor). Shared by the
// canvas tab strip; the former mode-cards picker was removed when files began
// choosing their own canvas on open.
import type { WorkbenchMode } from '@/types/editor';

export function ModeIcon({ kind }: { kind: WorkbenchMode }) {
  const props = {
    width: 20,
    height: 20,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.7,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };
  switch (kind) {
    case 'standard': // three-pane layout
      return (
        <svg {...props}>
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <path d="M9 4v16M15 4v16" />
        </svg>
      );
    case 'flow': // DAG nodes + connections
      return (
        <svg {...props}>
          <rect x="3" y="9" width="6" height="6" rx="1.5" />
          <rect x="15" y="3.5" width="6" height="6" rx="1.5" />
          <rect x="15" y="14.5" width="6" height="6" rx="1.5" />
          <path d="M9 12h3m0 0V6.5h3M12 12v5.5h3" />
        </svg>
      );
    case 'block': // stacked puzzle blocks
      return (
        <svg {...props}>
          <path d="M3 7.5h7v4h-4v3H3z" />
          <path d="M14 4.5h7v4h-4v3h-3v-4h-4v-3z" />
          <path d="M10 15.5h4v3h-4z" />
        </svg>
      );
    case 'code': // editor chevrons
      return (
        <svg {...props}>
          <path d="M8.5 8 4 12.5 8.5 17" />
          <path d="m15.5 8 4.5 4.5L15.5 17" />
          <path d="m13.5 5.5-3 14" />
        </svg>
      );
  }
}
