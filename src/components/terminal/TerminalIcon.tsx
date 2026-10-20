// ==========================================================================
// Ergalics Studio — terminal glyph for the activity-bar drawer toggle
//
// Local copy of the shared icon style (stroke glyphs in components/icons.tsx,
// which must stay untouched for this feature): decorative by default, the
// owning button carries its own aria-label/title. Lives beside the terminal
// feature so the activity bar does not have to reach into the lazy panel chunk.
// ==========================================================================

import type { SVGProps } from 'react';

interface TerminalIconProps extends Omit<SVGProps<SVGSVGElement>, 'width' | 'height'> {
  /** Square size in px — same convention as the shared icon library. */
  size?: number;
}

export function TerminalIcon({ size = 16, ...rest }: TerminalIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable="false"
      {...rest}
    >
      {/* Prompt caret plus a command line inside a rounded frame. */}
      <rect x="2.5" y="4.5" width="19" height="15" rx="2" />
      <path d="m6.5 9 3.2 3-3.2 3" />
      <path d="M12.5 15h5" />
    </svg>
  );
}
