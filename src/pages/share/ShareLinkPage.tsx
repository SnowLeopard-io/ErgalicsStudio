import { useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useT } from '@/i18n';
import { decompressFromEncodedURIComponent } from 'lz-string';
import { useProjectStore } from '@/stores/projectStore';

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
      const parsed = JSON.parse(json);
      const project = {
        id: crypto.randomUUID(),
        name: parsed.name ?? t('project.untitled'),
        createdAt: Date.now(),
        updatedAt: Date.now(),
        data: { files: parsed.data?.files ?? [], processed: parsed.data?.processed },
        state: {
          activePlugin: null,
          parameters: parsed.params ?? {},
          camera: parsed.scene?.camera ?? null,
          scene: parsed.scene,
        },
        metadata: { version: '1.0', description: null, tags: [] },
      };
      void useProjectStore.getState().loadProjectFromText(JSON.stringify(project)).then(() => {
        navigate('/workbench', { replace: true });
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