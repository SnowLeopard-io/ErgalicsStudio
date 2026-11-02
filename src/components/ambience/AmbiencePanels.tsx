// Settings panels for the ambience system: the "Experience & Ambience"
// section (sound / motion / rewards switches) and the "Achievements" badge
// wall. Both render inside the standard settings-section card layout.

import { useEffect, useRef } from 'react';
import { useT } from '@/i18n';
import { downloadBlob } from '@/core/download';
import { useAppStore } from '@/stores/appStore';
import { useAmbienceStore } from '@/stores/ambienceStore';
import { BADGES, badgeUiImage, type BadgeId } from '@/core/ambience/model';
import { XpIndicator } from './AmbienceLayer';

export function AmbienceSettingsPanel() {
  const t = useT();
  const notify = useAppStore((s) => s.notify);
  const {
    settings, setSoundEnabled, setAmbientEnabled, setVolume, setMotion, setRewardsEnabled,
    exportProgress, importProgress,
  } = useAmbienceStore();
  const fileRef = useRef<HTMLInputElement>(null);

  const handleImport = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const ok = importProgress(String(reader.result ?? ''));
      notify(ok ? 'success' : 'error', t(ok ? 'ambience.import_done' : 'ambience.import_failed'));
    };
    reader.readAsText(file);
  };

  return (
    <section className="card settings-section">
      <h2 className="settings-section-title">{t('settings.ambience')}</h2>
      <p className="settings-label">{t('ambience.section_desc')}</p>

      <div className="settings-row">
        <label className="settings-label" htmlFor="ambience-sound">{t('ambience.sound')}</label>
        <div className="settings-value ambience-row-value">
          <input
            id="ambience-sound"
            type="checkbox"
            className="ambience-switch"
            checked={settings.soundEnabled}
            onChange={(e) => setSoundEnabled(e.target.checked)}
          />
        </div>
      </div>
      <p className="settings-label ambience-hint">{t('ambience.sound_desc')}</p>

      <div className="settings-row">
        <label className="settings-label" htmlFor="ambience-ambient">{t('ambience.ambient')}</label>
        <div className="settings-value ambience-row-value">
          <input
            id="ambience-ambient"
            type="checkbox"
            className="ambience-switch"
            checked={settings.ambientEnabled}
            disabled={!settings.soundEnabled}
            onChange={(e) => setAmbientEnabled(e.target.checked)}
          />
        </div>
      </div>
      <p className="settings-label ambience-hint">{t('ambience.ambient_desc')}</p>

      <div className="settings-row">
        <label className="settings-label" htmlFor="ambience-volume">{t('ambience.volume')}</label>
        <div className="settings-value ambience-row-value">
          <input
            id="ambience-volume"
            type="range"
            min={0}
            max={100}
            value={settings.volume}
            className="ambience-volume"
            onChange={(e) => setVolume(Number(e.target.value))}
          />
          <span className="ambience-volume-value">{settings.volume}%</span>
        </div>
      </div>

      <div className="settings-row">
        <label className="settings-label" htmlFor="ambience-motion">{t('ambience.motion')}</label>
        <select
          id="ambience-motion"
          className="select settings-control"
          value={settings.motion}
          onChange={(e) => setMotion(e.target.value as typeof settings.motion)}
        >
          <option value="full">{t('ambience.motion_full')}</option>
          <option value="reduced">{t('ambience.motion_reduced')}</option>
          <option value="off">{t('ambience.motion_off')}</option>
        </select>
      </div>
      <p className="settings-label ambience-hint">{t('ambience.motion_desc')}</p>

      <div className="settings-row">
        <label className="settings-label" htmlFor="ambience-rewards">{t('ambience.rewards')}</label>
        <div className="settings-value ambience-row-value">
          <input
            id="ambience-rewards"
            type="checkbox"
            className="ambience-switch"
            checked={settings.rewardsEnabled}
            onChange={(e) => setRewardsEnabled(e.target.checked)}
          />
        </div>
      </div>
      <p className="settings-label ambience-hint">{t('ambience.rewards_desc')}</p>

      <div className="settings-row">
        <label className="settings-label">{t('ambience.export')}</label>
        <div className="settings-value ambience-row-value">
          <button
            type="button"
            className="btn"
            onClick={() => {
              downloadBlob('ergalics-ambience-progress.json', exportProgress(), 'application/json');
              notify('success', t('ambience.export_done'));
            }}
          >
            {t('ambience.export')}
          </button>
          <button type="button" className="btn" onClick={() => fileRef.current?.click()}>
            {t('ambience.import')}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            style={{ display: 'none' }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleImport(file);
              e.target.value = '';
            }}
          />
        </div>
      </div>
    </section>
  );
}

export function AchievementsPanel() {
  const t = useT();
  const badges = useAmbienceStore((s) => s.progress.badges);
  const markWallSeen = useAmbienceStore((s) => s.markWallSeen);
  // Visiting the wall clears the "new achievement" entry signal.
  useEffect(() => {
    markWallSeen();
  }, [markWallSeen]);
  const unlockedCount = BADGES.filter((b) => badges[b.id]).length;

  return (
    <section className="card settings-section">
      <h2 className="settings-section-title">{t('ambience.wall_title')}</h2>
      {/* Level + XP progress lives here (settings) instead of the top bar. */}
      <div className="ambience-xp-in-panel">
        <XpIndicator />
      </div>
      <p className="settings-label">
        {t('ambience.wall_progress', { unlocked: unlockedCount, total: BADGES.length })}
      </p>

      <div className="badge-wall">
        {BADGES.map((badge) => {
          const unlockedAt = badges[badge.id];
          const unlocked = Boolean(unlockedAt);
          return (
            <div
              key={badge.id}
              className={`badge-card rarity-${badge.rarity}${unlocked ? ' unlocked' : ''}`}
              title={unlocked ? t(badge.nameKey) : t('ambience.wall_locked')}
            >
              <img className="badge-card-img" src={badgeUiImage(badge.id as BadgeId)} alt="" loading="lazy" />
              <span className="badge-card-name">{t(badge.nameKey)}</span>
              <span className="badge-card-desc">{t(badge.descKey)}</span>
              <span className="badge-card-meta">
                {unlocked && unlockedAt
                  ? t('ambience.wall_unlocked_at', {
                      date: new Date(unlockedAt).toLocaleDateString(),
                    })
                  : t('ambience.wall_locked')}
              </span>
              {unlocked && (
                <a
                  className="badge-card-download"
                  href={badge.hdPath}
                  download={`ergalics-badge-${badge.id}.jpg`}
                  onClick={(e) => e.stopPropagation()}
                >
                  {t('ambience.download_hd')}
                </a>
              )}
            </div>
          );
        })}
      </div>
      {unlockedCount === 0 && <p className="settings-label ambience-hint">{t('ambience.wall_empty')}</p>}
    </section>
  );
}
