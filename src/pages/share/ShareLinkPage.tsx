import { useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useT } from '@/i18n';
import { decompressFromEncodedURIComponent } from 'lz-string';
import { DEFAULT_PROJECT_NAME } from '@/types/project';
import { useProjectStore } from '@/stores/projectStore';

/**
 * `crypto.randomUUID` only exists in a secure context (https / localhost).
 * Shared links get opened from file:// copies and plain-http intranet hosts,
 * where the previous direct call threw and the catch silently bounced the
 * user back to the welcome page with no explanation.
 */
function makeId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // RFC 4122 v4-shaped fallback from getRandomValues (also secure-context only,
  // but available in every browser that matters; Math.random as last resort).
  if (typeof crypto?.getRandomValues === 'function') {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6]! & 0x0f) | 0x40;
    bytes[8] = (bytes[8]! & 0x3f) | 0x80;
    const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  return `shared-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Hard ceiling on the decompressed share payload (strings + JSON), bytes. */
const MAX_PAYLOAD_BYTES = 8 * 1024 * 1024;

/**
 * A share URL is untrusted input that gets persisted into the project store:
 * cap its size and keep only the plain fields we understand, so a crafted
 * link can neither smuggle unexpected structure nor blow up storage.
 */
function sanitizeShare(raw: unknown): { name: string; files: unknown[]; processed: unknown; params: Record<string, unknown>; scene: unknown } | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as Record<string, unknown>;
  const data = (p.data ?? {}) as Record<string, unknown>;
  const files = Array.isArray(data.files) ? data.files : [];
  const params = (p.params ?? {}) as Record<string, unknown>;
  if (!files.every((f) => f && typeof f === 'object')) return null;
  if (typeof params !== 'object') return null;
  const name = typeof p.name === 'string' && p.name.length > 0 ? p.name.slice(0, 200) : DEFAULT_PROJECT_NAME;
  return { name, files, processed: data.processed, params, scene: p.scene ?? null };
}

export default function ShareLinkPage() {
  const t = useT();
  const { payload } = useParams<{ payload: string }>();
  const navigate = useNavigate();
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current || !payload) return;
    ran.current = true;
    try {
      const json = decompressFromEncodedURIComponent(payload);
      if (!json) throw new Error('bad payload');
      // Cap before parsing: JSON.parse on a multi-hundred-MB string can OOM
      // the tab before any downstream validation ever runs.
      if (json.length > MAX_PAYLOAD_BYTES) throw new Error('payload too large');
      const share = sanitizeShare(JSON.parse(json));
      if (!share) throw new Error('bad share shape');
      const project = {
        id: makeId(),
        name: share.name,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        data: { files: share.files, processed: share.processed },
        state: {
          activePlugin: null,
          parameters: share.params,
          camera: (share.scene as { camera?: unknown } | null)?.camera ?? null,
          scene: share.scene,
        },
        metadata: { version: '1.0', description: null, tags: [] },
      };
      void useProjectStore.getState().loadProjectFromText(JSON.stringify(project)).then(() => {
        navigate('/workbench', { replace: true });
      }).catch(() => {
        // A failed load previously left this page stuck on the spinner
        // forever (unhandled rejection after the try/catch already ran).
        navigate('/', { replace: true });
      });
    } catch {
      navigate('/', { replace: true });
    }
  }, [payload, navigate, t]);

  return (
    <div className="share-loading">
      <span className="spinner" />
      <span>{t('status.loading')}</span>
    </div>
  );
}