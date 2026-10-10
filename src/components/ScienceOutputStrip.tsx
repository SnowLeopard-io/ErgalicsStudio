import { useEffect, useState } from 'react';
import {
  getScienceOutputs,
  subscribeScienceOutputs,
  type ScienceOutputEntry,
} from '@/core/research/scienceOutput';
import { usePluginStore } from '@/stores/pluginStore';

/**
 * Unified scientific-output strip rendered under the workbench viewport.
 * Shows the active plugin's published metrics (R², residuals, CIs,
 * convergence / conservation diagnostics…) so every plot is paired with its
 * numerical conclusions. Hidden entirely when the active plugin has
 * published nothing.
 */
export function ScienceOutputStrip() {
  const activeId = usePluginStore((s) => s.activeId);
  const [outputs, setOutputs] = useState<Record<string, ScienceOutputEntry>>(() =>
    getScienceOutputs(),
  );

  useEffect(() => subscribeScienceOutputs(setOutputs), []);

  const entry = activeId ? outputs[activeId] : undefined;
  if (!entry || entry.metrics.length === 0) return null;

  return (
    <div className="science-strip" role="status">
      <span className="science-strip-title">Σ</span>
      <div className="science-strip-items">
        {entry.metrics.map((m) => (
          <span
            key={m.key}
            className={`science-metric sev-${m.severity ?? 'info'}`}
            title={m.hint ?? m.label}
          >
            <span className="science-metric-label">{m.label}</span>
            <span className="science-metric-value">
              {m.value}
              {m.unit ? <span className="science-metric-unit"> {m.unit}</span> : null}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}
