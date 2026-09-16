import { useNavigate } from 'react-router-dom';
import { useT } from '@/i18n';

/** Quick-start workbench modes. Every mode is a standalone route — lab tools
 *  live under pages/labs, the rest are dedicated pages. */
export type WorkbenchModeKey =
  | 'runs'
  | 'uncertainty'
  | 'model-lab'
  | 'sweeps'
  | 'signal'
  | 'report';

export const WORKBENCH_MODES: WorkbenchModeKey[] = [
  'runs',
  'uncertainty',
  'model-lab',
  'sweeps',
  'signal',
  'report',
];

/** Minimal line-style SVG icons (stroke follows currentColor). */
export function ModeIcon({ kind }: { kind: WorkbenchModeKey }) {
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
    case 'runs': // clipboard with list lines
      return (
        <svg {...props}>
          <path d="M9 4.5H6.5A1.5 1.5 0 0 0 5 6v13.5A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5V6a1.5 1.5 0 0 0-1.5-1.5H15" />
          <rect x="9" y="3" width="6" height="3" rx="1" />
          <path d="M8.5 11h7M8.5 15h4.5" />
        </svg>
      );
    case 'uncertainty': // bell curve
      return (
        <svg {...props}>
          <path d="M2.5 19c3.5 0 4-14 9.5-14s6 14 9.5 14" />
          <path d="M2.5 19h19" />
        </svg>
      );
    case 'model-lab': // scatter with regression line
      return (
        <svg {...props}>
          <path d="M4 20V4" />
          <path d="M4 20h16" />
          <circle cx="8.5" cy="14.5" r="1.2" />
          <circle cx="12" cy="10.5" r="1.2" />
          <circle cx="16" cy="7" r="1.2" />
          <path d="M6 16.5 18 5.5" />
        </svg>
      );
    case 'sweeps': // parameter grid
      return (
        <svg {...props}>
          <rect x="3.5" y="3.5" width="7" height="7" rx="1" />
          <rect x="13.5" y="3.5" width="7" height="7" rx="1" />
          <rect x="3.5" y="13.5" width="7" height="7" rx="1" />
          <rect x="13.5" y="13.5" width="7" height="7" rx="1" />
        </svg>
      );
    case 'signal': // waveform
      return (
        <svg {...props}>
          <path d="M2 12.5h3.5L8 6l4.5 12 3-8.5 1.5 3H22" />
        </svg>
      );
    case 'report': // document
      return (
        <svg {...props}>
          <path d="M6 3h8.5L19 7.5V21H6z" />
          <path d="M14.5 3v4.5H19" />
          <path d="M9 12.5h6M9 16.5h6" />
        </svg>
      );
  }
}

interface WorkbenchModeCardsProps {
  /** Custom navigation (e.g. welcome page pre-initializes GPU). Defaults to
   *  direct react-router navigation. */
  onMode?: (key: WorkbenchModeKey) => void;
}

/** Compact row of workbench mode cards shared by the welcome page and the
 *  workbench empty state. Horizontal icon+text layout keeps cards small. */
export function WorkbenchModeCards({ onMode }: WorkbenchModeCardsProps) {
  const t = useT();
  const navigate = useNavigate();
  const open = (key: WorkbenchModeKey) => {
    if (onMode) {
      onMode(key);
      return;
    }
    navigate(`/${key}`);
  };
  return (
    <div className="wb-modes-grid">
      {WORKBENCH_MODES.map((key) => (
        <button key={key} type="button" className="wb-mode-card" onClick={() => open(key)}>
          <span className="wb-mode-icon">
            <ModeIcon kind={key} />
          </span>
          <span className="wb-mode-body">
            <span className="wb-mode-title">{t(`modes.${key}.title`)}</span>
            <span className="wb-mode-desc">{t(`modes.${key}.desc`)}</span>
          </span>
        </button>
      ))}
    </div>
  );
}
