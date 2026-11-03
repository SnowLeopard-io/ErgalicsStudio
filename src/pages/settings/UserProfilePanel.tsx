// Settings "用户资料" panel — a local-only personal profile (name, gender,
// affiliation, hobbies, bio, experience). Nothing leaves the browser.

import { useT } from '@/i18n';
import { useUserProfileStore, type Gender } from '@/stores/userProfileStore';

const GENDER_OPTIONS: Gender[] = ['unspecified', 'female', 'male', 'other'];

export function UserProfilePanel() {
  const t = useT();
  const profile = useUserProfileStore((s) => s.profile);
  const update = useUserProfileStore((s) => s.update);
  const reset = useUserProfileStore((s) => s.reset);

  // Initials avatar: first character of the name (or a neutral dot), on the
  // accent tint. Kept quiet and instrument-console-like, no emoji.
  const initial = profile.name.trim().charAt(0).toUpperCase() || '·';

  return (
    <section className="card settings-section">
      <h2 className="settings-section-title">{t('settings.profile')}</h2>
      <p className="settings-label">{t('profile.section_desc')}</p>

      <div className="profile-head">
        <span className="profile-avatar" aria-hidden="true">{initial}</span>
        <div className="profile-head-meta">
          <span className="profile-name">{profile.name.trim() || t('profile.anonymous')}</span>
          <span className="profile-sub">{profile.academy || profile.workplace || t('profile.no_affiliation')}</span>
        </div>
      </div>

      <div className="settings-row">
        <label className="settings-label" htmlFor="profile-name">{t('profile.name')}</label>
        <input
          id="profile-name"
          type="text"
          className="input settings-control"
          value={profile.name}
          placeholder={t('profile.name_placeholder')}
          onChange={(e) => update({ name: e.target.value })}
        />
        <p className="settings-hint">{t('profile.name_git_hint')}</p>
      </div>

      <div className="settings-row">
        <label className="settings-label" htmlFor="profile-email">{t('profile.email')}</label>
        <input
          id="profile-email"
          type="text"
          className="input settings-control"
          value={profile.email}
          placeholder={t('profile.email_placeholder')}
          onChange={(e) => update({ email: e.target.value })}
        />
        <p className="settings-hint">{t('profile.email_git_hint')}</p>
      </div>

      <div className="settings-row">
        <label className="settings-label" htmlFor="profile-git-username">{t('profile.git_username')}</label>
        <input
          id="profile-git-username"
          type="text"
          className="input settings-control"
          value={profile.gitUsername}
          placeholder={t('profile.git_username_placeholder')}
          onChange={(e) => update({ gitUsername: e.target.value })}
        />
      </div>

      <div className="settings-row">
        <label className="settings-label" htmlFor="profile-git-token">{t('profile.git_token')}</label>
        <input
          id="profile-git-token"
          type="password"
          className="input settings-control"
          value={profile.gitToken}
          placeholder={t('profile.git_token_placeholder')}
          onChange={(e) => update({ gitToken: e.target.value })}
        />
        <p className="settings-hint">{t('profile.git_hint')}</p>
      </div>

      <div className="settings-row">
        <label className="settings-label" htmlFor="profile-gender">{t('profile.gender')}</label>
        <select
          id="profile-gender"
          className="select settings-control"
          value={profile.gender}
          onChange={(e) => update({ gender: e.target.value as Gender })}
        >
          {GENDER_OPTIONS.map((g) => (
            <option key={g} value={g}>{t(`profile.gender_${g}`)}</option>
          ))}
        </select>
      </div>

      <div className="settings-row">
        <label className="settings-label" htmlFor="profile-birth">{t('profile.birth_year')}</label>
        <input
          id="profile-birth"
          type="text"
          className="input settings-control"
          value={profile.birthYear}
          placeholder={t('profile.birth_year_placeholder')}
          onChange={(e) => update({ birthYear: e.target.value })}
        />
      </div>

      <div className="settings-row">
        <label className="settings-label" htmlFor="profile-academy">{t('profile.academy')}</label>
        <input
          id="profile-academy"
          type="text"
          className="input settings-control"
          value={profile.academy}
          placeholder={t('profile.academy_placeholder')}
          onChange={(e) => update({ academy: e.target.value })}
        />
      </div>

      <div className="settings-row">
        <label className="settings-label" htmlFor="profile-workplace">{t('profile.workplace')}</label>
        <input
          id="profile-workplace"
          type="text"
          className="input settings-control"
          value={profile.workplace}
          placeholder={t('profile.workplace_placeholder')}
          onChange={(e) => update({ workplace: e.target.value })}
        />
      </div>

      <div className="settings-row">
        <label className="settings-label" htmlFor="profile-hobbies">{t('profile.hobbies')}</label>
        <textarea
          id="profile-hobbies"
          className="input settings-control profile-textarea"
          rows={2}
          value={profile.hobbies}
          placeholder={t('profile.hobbies_placeholder')}
          onChange={(e) => update({ hobbies: e.target.value })}
        />
      </div>

      <div className="settings-row">
        <label className="settings-label" htmlFor="profile-experience">{t('profile.experience')}</label>
        <textarea
          id="profile-experience"
          className="input settings-control profile-textarea"
          rows={4}
          value={profile.experience}
          placeholder={t('profile.experience_placeholder')}
          onChange={(e) => update({ experience: e.target.value })}
        />
      </div>

      <div className="settings-row">
        <label className="settings-label" htmlFor="profile-bio">{t('profile.bio')}</label>
        <textarea
          id="profile-bio"
          className="input settings-control profile-textarea"
          rows={3}
          value={profile.bio}
          placeholder={t('profile.bio_placeholder')}
          onChange={(e) => update({ bio: e.target.value })}
        />
      </div>

      <div className="settings-row">
        <label className="settings-label">{t('profile.reset')}</label>
        <button type="button" className="btn" onClick={reset}>{t('profile.reset')}</button>
      </div>
    </section>
  );
}
