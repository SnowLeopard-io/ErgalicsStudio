// ==========================================================================
// Ergalics Studio — inline SVG icon library (single source of truth)
//
// All glyphs formerly scattered as Unicode characters (⚙ ? ☰ ▾ ✕ ◈ ❓ …)
// live here so stroke weight, size and a11y treatment stay consistent.
// Icons are decorative by default (aria-hidden); the owning button must
// carry its own aria-label/title. Set `label` to expose an accessible name.
// ==========================================================================

import type { SVGProps } from 'react';

export type IconSize = 14 | 16 | 18 | 20 | 22 | 24;

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  size?: IconSize | number;
  /** Accessible name. When omitted the icon is hidden from assistive tech. */
  label?: string;
  strokeWidth?: number;
}

function Svg({
  size = 16,
  label,
  strokeWidth = 1.7,
  children,
  ...rest
}: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={label ? undefined : true}
      role={label ? 'img' : undefined}
      aria-label={label}
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

// ---- generic UI glyphs ----------------------------------------------------

export const MenuIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 6h16M4 12h16M4 18h16" />
  </Svg>
);

export const ChevronDownIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="m6 9 6 6 6-6" />
  </Svg>
);

export const ChevronRightIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="m9 6 6 6-6 6" />
  </Svg>
);

export const CloseIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Svg>
);

export const ArrowLeftIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M19 12H5" />
    <path d="m11 6-6 6 6 6" />
  </Svg>
);

export const ArrowRightIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 12h14" />
    <path d="m13 6 6 6-6 6" />
  </Svg>
);

export const SearchIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </Svg>
);

export const HelpIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M9.5 9.2a2.5 2.5 0 1 1 3.6 2.2c-.7.4-1.1 1-1.1 1.8" />
    <path d="M12 17h.01" />
  </Svg>
);

export const SettingsIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1Z" />
  </Svg>
);

export const PlusIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);

export const FolderOpenIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 20a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v2" />
    <path d="m3 20 2.5-9h15L18 20z" />
  </Svg>
);

export const ClockIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3.5 2" />
  </Svg>
);

export const PlayIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M7 5.5v13l11-6.5z" />
  </Svg>
);

export const BookIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 19V5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z" />
    <path d="M4 19a2 2 0 0 0 2 2h13" />
    <path d="M8 7h7M8 10.5h7" />
  </Svg>
);

export const MoreIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none" />
    <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
    <circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none" />
  </Svg>
);

export const TrashIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 7h16" />
    <path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    <path d="M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13" />
    <path d="M10 11v6M14 11v6" />
  </Svg>
);

/** Compact gauge/diamond dot used for the collapsed performance entry. */
export const GaugeIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 15a8 8 0 1 1 16 0" />
    <path d="m12 15 4-4" />
    <circle cx="12" cy="15" r="1.3" fill="currentColor" stroke="none" />
  </Svg>
);

export const FlaskIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9 3h6" />
    <path d="M10 3v6L5.5 18a2 2 0 0 0 1.8 3h9.4a2 2 0 0 0 1.8-3L14 9V3" />
    <path d="M7.5 14h9" />
  </Svg>
);

export const LayersIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="m12 3 9 5-9 5-9-5z" />
    <path d="m3 13 9 5 9-5" />
  </Svg>
);

export const ToolboxIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="7" width="18" height="13" rx="2" />
    <path d="M8 7V5a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
    <path d="M3 12h18" />
    <path d="M12 10.5v3" />
  </Svg>
);

export const VariableIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 7c2 8 3 10 5 10s2-5 4-10" />
    <path d="M14 12c1 3 2 5 4 5 1.5 0 2-1.5 2-3" />
  </Svg>
);

// ---- research tool glyphs -------------------------------------------------

export type ToolIconKind =
  | 'runs'
  | 'analysis'
  | 'uncertainty'
  | 'model-lab'
  | 'inference'
  | 'profiler'
  | 'reprolock'
  | 'signal'
  | 'sweeps'
  | 'report'
  | 'sql'
  | 'lineage'
  | 'figures'
  | 'notebook'
  | 'supplement'
  | 'model-inference'
  | 'course'
  | 'cleaning'
  | 'gallery';

export function ToolIcon({ kind, ...rest }: IconProps & { kind: ToolIconKind }) {
  switch (kind) {
    case 'runs': // clipboard with list lines
      return (
        <Svg {...rest}>
          <path d="M9 4.5H6.5A1.5 1.5 0 0 0 5 6v13.5A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5V6a1.5 1.5 0 0 0-1.5-1.5H15" />
          <rect x="9" y="3" width="6" height="3" rx="1" />
          <path d="M8.5 11h7M8.5 15h4.5" />
        </Svg>
      );
    case 'uncertainty': // bell curve
      return (
        <Svg {...rest}>
          <path d="M2.5 19c3.5 0 4-14 9.5-14s6 14 9.5 14" />
          <path d="M2.5 19h19" />
        </Svg>
      );
    case 'model-lab': // scatter with regression line
      return (
        <Svg {...rest}>
          <path d="M4 20V4" />
          <path d="M4 20h16" />
          <circle cx="8.5" cy="14.5" r="1.2" />
          <circle cx="12" cy="10.5" r="1.2" />
          <circle cx="16" cy="7" r="1.2" />
          <path d="M6 16.5 18 5.5" />
        </Svg>
      );
    case 'inference': // branching priors → posterior
      return (
        <Svg {...rest}>
          <circle cx="6" cy="5" r="2.2" />
          <circle cx="6" cy="19" r="2.2" />
          <circle cx="17" cy="12" r="2.2" />
          <path d="M8 6.2c3 1.5 5 3.4 7 4.6" />
          <path d="M8 17.8c3-1.5 5-3.4 7-4.6" />
        </Svg>
      );
    case 'model-inference': // neural net (input → hidden → output)
      return (
        <Svg {...rest}>
          <circle cx="5" cy="7" r="1.8" />
          <circle cx="5" cy="17" r="1.8" />
          <circle cx="12" cy="5" r="1.8" />
          <circle cx="12" cy="12" r="1.8" />
          <circle cx="12" cy="19" r="1.8" />
          <circle cx="19" cy="12" r="1.8" />
          <path d="M6.6 6.4 10.4 5.2M6.6 7.6 10.4 11.4M6.6 16.4 10.4 12.6M6.6 17.6 10.4 18.8M13.8 5.6 17.6 11M13.8 12h3.4M13.8 18.4 17.6 13" />
        </Svg>
      );
    case 'profiler': // magnifier over bars
      return (
        <Svg {...rest}>
          <path d="M4 20v-5M9 20v-9M14 20v-3" />
          <circle cx="17" cy="7" r="4" />
          <path d="m20 10 2 2" />
        </Svg>
      );
    case 'reprolock': // lock with check
      return (
        <Svg {...rest}>
          <rect x="5" y="10.5" width="14" height="10" rx="2" />
          <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
          <path d="m9 15.5 2 2 4-4" />
        </Svg>
      );
    case 'signal': // waveform
      return (
        <Svg {...rest}>
          <path d="M2 12.5h3.5L8 6l4.5 12 3-8.5 1.5 3H22" />
        </Svg>
      );
    case 'sweeps': // parameter grid
      return (
        <Svg {...rest}>
          <rect x="3.5" y="3.5" width="7" height="7" rx="1" />
          <rect x="13.5" y="3.5" width="7" height="7" rx="1" />
          <rect x="3.5" y="13.5" width="7" height="7" rx="1" />
          <rect x="13.5" y="13.5" width="7" height="7" rx="1" />
        </Svg>
      );
    case 'report': // document
      return (
        <Svg {...rest}>
          <path d="M6 3h8.5L19 7.5V21H6z" />
          <path d="M14.5 3v4.5H19" />
          <path d="M9 12.5h6M9 16.5h6" />
        </Svg>
      );
    case 'sql': // database
      return (
        <Svg {...rest}>
          <ellipse cx="12" cy="5.5" rx="7.5" ry="2.5" />
          <path d="M4.5 5.5v13c0 1.4 3.4 2.5 7.5 2.5s7.5-1.1 7.5-2.5v-13" />
          <path d="M4.5 12c0 1.4 3.4 2.5 7.5 2.5s7.5-1.1 7.5-2.5" />
        </Svg>
      );
    case 'lineage': // fork graph
      return (
        <Svg {...rest}>
          <circle cx="6" cy="5" r="2.2" />
          <circle cx="6" cy="19" r="2.2" />
          <circle cx="18" cy="12" r="2.2" />
          <path d="M6 7.2v9.6" />
          <path d="M6 12h7a3 3 0 0 0 3-3" />
        </Svg>
      );
    case 'figures': // composed chart
      return (
        <Svg {...rest}>
          <path d="M4 4v16h16" />
          <path d="M8 16v-4M12 16V8M16 16v-6" />
        </Svg>
      );
    case 'notebook': // notebook
      return (
        <Svg {...rest}>
          <rect x="5" y="3.5" width="14" height="17" rx="1.5" />
          <path d="M5 8h14M8.5 3.5v17" strokeDasharray="2 2" />
          <path d="M11 12h5M11 15.5h5" />
        </Svg>
      );
    case 'supplement': // package
      return (
        <Svg {...rest}>
          <path d="m12 3 8.5 4.5v9L12 21l-8.5-4.5v-9z" />
          <path d="m3.5 7.5 8.5 4.5 8.5-4.5" />
          <path d="M12 12v9" />
        </Svg>
      );
    case 'analysis': // sigma
      return (
        <Svg {...rest}>
          <path d="M18 5H7l5 7-5 7h11" />
        </Svg>
      );
    case 'course': // graduation cap
      return (
        <Svg {...rest}>
          <path d="m12 4 9.5 4.5L12 13 2.5 8.5z" />
          <path d="M6.5 10.8V16c0 1.6 2.5 3 5.5 3s5.5-1.4 5.5-3v-5.2" />
          <path d="M21.5 8.5V14" />
        </Svg>
      );
    case 'cleaning': // broom
      return (
        <Svg {...rest}>
          <path d="M14.5 3.5 20 9" />
          <path d="m13 8 3.5-3.5a1.5 1.5 0 0 1 2.1 0l1.9 1.9a1.5 1.5 0 0 1 0 2.1L17 12" />
          <path d="M13 8 4.5 16.5c-.6.6-.8 1.5-.5 2.3l1 2.6c.2.6.9.9 1.5.7l2.6-1c.8-.3 1.3.1 1.9-.5L17 12" />
          <path d="m7 15 2 2M10 12.5l2 2" />
        </Svg>
      );
    case 'gallery': // framed picture with mountain
      return (
        <Svg {...rest}>
          <rect x="3.5" y="4.5" width="17" height="15" rx="1.5" />
          <circle cx="9" cy="9.5" r="1.4" />
          <path d="m4.5 17 5-5.5 4 4 3-2.5 3.5 4" />
        </Svg>
      );
  }
}
