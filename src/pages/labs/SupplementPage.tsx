// ==========================================================================
// Ergalics Studio — supplementary-materials packaging page
//
// Collects the metadata form (author / license / description) plus the
// inclusion toggles (data files, code sessions), builds the zip via the
// core packager and hands it to the shared downloader.
// ==========================================================================

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useT } from '@/i18n';
import { useAppStore } from '@/stores/appStore';
import { useProjectStore } from '@/stores/projectStore';
import { buildSupplement } from '@/core/package/supplement';
import { downloadBlob } from '@/core/download';
import { logger } from '@/core/logger';
import { LabPageShell } from './LabPageShell';

const COMMON_LICENSES = ['CC-BY-4.0', 'CC-BY-SA-4.0', 'CC0-1.0', 'MIT', 'Apache-2.0'];

export default function SupplementPage() {
  const t = useT();
  const notify = useAppStore((s) => s.notify);
  const navigate = useNavigate();
  const project = useProjectStore((s) => s.project);

  const [author, setAuthor] = useState('');
  const [license, setLicense] = useState('');
  const [description, setDescription] = useState('');
  const [includeData, setIncludeData] = useState(true);
  const [includeCode, setIncludeCode] = useState(true);
  const [includeLock, setIncludeLock] = useState(true);
  const [busy, setBusy] = useState(false);

  const hasProject = !!project;
  const fileCount = project?.data.files.length ?? 0;

  const handleBuild = async () => {
    if (!project || busy) return;
    setBusy(true);
    try {
      const zip = await buildSupplement(project, {
        includeData,
        code: includeCode,
        reproLock: includeLock,
        meta: {
          author: author.trim() || undefined,
          license: license.trim() || undefined,
          description: description.trim() || undefined,
        },
      });
      const safeName = project.name.replace(/[^\w.-]+/g, '_') || 'project';
      downloadBlob(`${safeName}-supplement.zip`, zip, 'application/zip');
      notify('success', t('supplement.done'));
      navigate('/workbench');
    } catch (err) {
      logger.error('package', 'supplement build failed', err);
      notify('error', t('supplement.failed', { reason: String(err) }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <LabPageShell title={t('supplement.title')}>
      <div className="supplement-form">
        <p className="supplement-intro">{t('supplement.intro')}</p>

        <div className="figures-field">
          <label className="figures-label" htmlFor="supplement-author">
            {t('supplement.author')}
          </label>
          <input
            id="supplement-author"
            className="input"
            value={author}
            onChange={(e) => setAuthor(e.target.value)}
            placeholder="J. Doe; A. Collaborator"
          />
        </div>

        <div className="figures-field">
          <label className="figures-label" htmlFor="supplement-license">
            {t('supplement.license')}
          </label>
          <input
            id="supplement-license"
            className="input"
            list="supplement-license-list"
            value={license}
            onChange={(e) => setLicense(e.target.value)}
            placeholder="CC-BY-4.0"
          />
          <datalist id="supplement-license-list">
            {COMMON_LICENSES.map((l) => (
              <option key={l} value={l} />
            ))}
          </datalist>
        </div>

        <div className="figures-field">
          <label className="figures-label" htmlFor="supplement-description">
            {t('supplement.description')}
          </label>
          <textarea
            id="supplement-description"
            className="input"
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t('supplement.description_placeholder')}
          />
        </div>

        <label className="supplement-check">
          <input
            type="checkbox"
            checked={includeData}
            onChange={(e) => setIncludeData(e.target.checked)}
          />
          {t('supplement.include_data', { count: fileCount })}
        </label>

        <label className="supplement-check">
          <input
            type="checkbox"
            checked={includeCode}
            onChange={(e) => setIncludeCode(e.target.checked)}
          />
          {t('supplement.include_code')}
        </label>

        <label className="supplement-check">
          <input
            type="checkbox"
            checked={includeLock}
            onChange={(e) => setIncludeLock(e.target.checked)}
          />
          {t('supplement.include_lock')}
        </label>

        <p className="supplement-hint">{t('supplement.hint')}</p>
      </div>

      <div className="sweep-actions">
        <button type="button" className="btn" onClick={() => navigate('/workbench')}>
          {t('common.cancel')}
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={!hasProject || busy}
          onClick={() => void handleBuild()}
        >
          {busy ? t('supplement.building') : t('supplement.build')}
        </button>
      </div>
    </LabPageShell>
  );
}
