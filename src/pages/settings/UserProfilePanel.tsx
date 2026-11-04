// Settings "用户资料" panel — a local-only personal profile (name, gender,
// affiliation, hobbies, bio, experience). Nothing leaves the browser.

import { useRef, useState } from 'react';
import { useT } from '@/i18n';
import { useUserProfileStore, type Gender, type UserProfile } from '@/stores/userProfileStore';

const GENDER_OPTIONS: Gender[] = ['unspecified', 'female', 'male', 'other'];

/** Decode an image file and downscale it to a square 128px JPEG data URL
 *  (cover-cropped). Downscaling keeps the avatar to a few KB so it survives
 *  the localStorage quota alongside the rest of the profile. */
function fileToAvatarDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const size = 128;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        URL.revokeObjectURL(url);
        reject(new Error('canvas unavailable'));
        return;
      }
      const side = Math.min(img.width, img.height);
      ctx.drawImage(
        img,
        (img.width - side) / 2,
        (img.height - side) / 2,
        side,
        side,
        0,
        0,
        size,
        size,
      );
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('image decode failed'));
    };
    img.src = url;
  });
}

/** Image decode helper for the card export (data URL avatars). */
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image decode failed'));
    img.src = src;
  });
}

/** Simple dark instrument-console card: avatar (photo or initials), name,
 *  affiliation and contact rows, drawn directly on a 2x canvas — no DOM
 *  rasterizer dependency. */
async function exportProfileCard(profile: UserProfile, fallbackName: string): Promise<void> {
  const scale = 2;
  const w = 720;
  const h = 400;
  const canvas = document.createElement('canvas');
  canvas.width = w * scale;
  canvas.height = h * scale;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.scale(scale, scale);

  // Card background + accent frame.
  ctx.fillStyle = '#111820';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#2dd4bf';
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, w - 2, h - 2);
  ctx.fillStyle = 'rgba(45, 212, 191, 0.08)';
  ctx.fillRect(1, 1, w - 2, 64);

  const name = profile.name.trim() || fallbackName;
  const affil = [profile.academy.trim(), profile.workplace.trim()].filter(Boolean).join(' · ');

  // Avatar: 88px circle at (48, 108).
  const av = { x: 48, y: 108, r: 44 };
  ctx.save();
  ctx.beginPath();
  ctx.arc(av.x + av.r, av.y + av.r, av.r, 0, Math.PI * 2);
  ctx.clip();
  let drewAvatar = false;
  if (profile.avatar) {
    // Await decode so toBlob below always serializes the finished drawing.
    try {
      const img = await loadImage(profile.avatar);
      ctx.drawImage(img, av.x, av.y, av.r * 2, av.r * 2);
      drewAvatar = true;
    } catch {
      /* fall through to the initials avatar */
    }
  }
  if (!drewAvatar) {
    ctx.fillStyle = '#0d1117';
    ctx.fillRect(av.x, av.y, av.r * 2, av.r * 2);
    ctx.fillStyle = '#2dd4bf';
    ctx.font = '700 56px Inter, "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const initial = name.charAt(0).toUpperCase() || '·';
    ctx.fillText(initial, av.x + av.r, av.y + av.r + 2);
  }
  ctx.restore();

  // Name + affiliation block right of the avatar.
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#e6edf3';
  ctx.font = '700 28px Inter, "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.fillText(name, 160, av.y + 40);
  ctx.fillStyle = '#9db0c3';
  ctx.font = '400 15px Inter, "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.fillText(affil || '—', 160, av.y + 68);

  // Contact rows.
  const rows: Array<[string, string]> = [
    ['Email', profile.email.trim()],
    ['Git', profile.gitUsername.trim()],
    ['Bio', profile.bio.trim()],
  ];
  let rowY = 236;
  ctx.font = '500 13px Inter, "PingFang SC", "Microsoft YaHei", sans-serif';
  for (const [label, value] of rows) {
    if (!value) continue;
    ctx.fillStyle = '#778ba3';
    ctx.fillText(label.toUpperCase(), 48, rowY);
    ctx.fillStyle = '#e6edf3';
    // Single line, clipped, so the card never overflows.
    const clipped = value.length > 52 ? `${value.slice(0, 51)}…` : value;
    ctx.fillText(clipped, 160, rowY);
    rowY += 36;
  }

  // Footer brand.
  ctx.fillStyle = '#778ba3';
  ctx.font = '600 12px "JetBrains Mono", Consolas, monospace';
  ctx.fillText('ERGALICS STUDIO', 48, h - 32);

  canvas.toBlob((blob) => {
    if (!blob) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'ergalics-profile-card.png';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }, 'image/png');
}

export function UserProfilePanel() {
  const t = useT();
  const profile = useUserProfileStore((s) => s.profile);
  const update = useUserProfileStore((s) => s.update);
  const reset = useUserProfileStore((s) => s.reset);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [avatarError, setAvatarError] = useState(false);

  // Initials avatar: first character of the name (or a neutral dot), on the
  // accent tint. Kept quiet and instrument-console-like, no emoji.
  const initial = profile.name.trim().charAt(0).toUpperCase() || '·';

  const handleAvatarFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const dataUrl = await fileToAvatarDataUrl(file);
      update({ avatar: dataUrl });
      setAvatarError(false);
    } catch {
      setAvatarError(true);
    }
  };

  return (
    <section className="card settings-section">
      <h2 className="settings-section-title">{t('settings.profile')}</h2>
      <p className="settings-label">{t('profile.section_desc')}</p>

      <div className="profile-head">
        <button
          type="button"
          className="profile-avatar-btn"
          title={profile.avatar ? t('profile.avatar_change') : t('profile.avatar_upload')}
          onClick={() => fileInputRef.current?.click()}
        >
          {profile.avatar ? (
            <img className="profile-avatar-img" src={profile.avatar} alt="" />
          ) : (
            <span className="profile-avatar" aria-hidden="true">{initial}</span>
          )}
          {profile.avatar && (
            <span
              className="profile-avatar-remove"
              role="button"
              tabIndex={0}
              aria-label={t('profile.avatar_remove')}
              title={t('profile.avatar_remove')}
              onClick={(e) => {
                // Inner click removes; outer click re-opens the picker.
                e.stopPropagation();
                update({ avatar: '' });
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.stopPropagation();
                  e.preventDefault();
                  update({ avatar: '' });
                }
              }}
            >
              ×
            </span>
          )}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          aria-label={t('profile.avatar_upload')}
          hidden
          onChange={(e) => {
            void handleAvatarFile(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
        <div className="profile-head-meta">
          <span className="profile-name">{profile.name.trim() || t('profile.anonymous')}</span>
          <span className="profile-sub">{profile.academy || profile.workplace || t('profile.no_affiliation')}</span>
          {avatarError && <span className="settings-hint">{t('profile.avatar_error')}</span>}
        </div>
        <div className="profile-head-actions">
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => void exportProfileCard(profile, t('profile.anonymous'))}
            title={t('profile.export_card')}
          >
            {t('profile.export_card')}
          </button>
        </div>
      </div>

      <div className="settings-form-row">
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

      <div className="settings-form-row">
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

      <div className="settings-form-row">
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

      <div className="settings-form-row">
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

      <div className="settings-form-row">
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

      <div className="settings-form-row">
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

      <div className="settings-form-row">
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

      <div className="settings-form-row">
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

      <div className="settings-form-row">
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

      <div className="settings-form-row">
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

      <div className="settings-form-row">
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

      <div className="settings-form-row">
        <label className="settings-label">{t('profile.reset')}</label>
        <button type="button" className="btn" onClick={reset}>{t('profile.reset')}</button>
      </div>
    </section>
  );
}
