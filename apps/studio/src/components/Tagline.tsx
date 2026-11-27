import { useEffect, useState } from 'react';
import { useT } from '@/i18n';

/** Rotating hero taglines — one shows at a time, cycling every 3 s. */
const TAGLINE_COUNT = 6;

/**
 * The welcome hero's rotating tagline (`welcome.tagline.0..5`). Shared with
 * the workbench empty-canvas cover so both surfaces speak with the same
 * rotating voice. `key=` remounts the node on each swap so the CSS fade
 * (`.welcome-tagline`) replays.
 */
export function Tagline({ className }: { className?: string }) {
  const t = useT();
  const [index, setIndex] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setIndex((i) => (i + 1) % TAGLINE_COUNT), 3000);
    return () => window.clearInterval(timer);
  }, []);
  return (
    <p className={className} key={index}>
      {t(`welcome.tagline.${index}`)}
    </p>
  );
}
