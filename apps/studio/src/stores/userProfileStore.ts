// Ergalics Studio — user profile store
//
// Personal profile for the settings "用户资料" page: identity fields the user
// can personalize (name, gender, affiliation, hobbies, bio, experience…).
// Purely local: persisted to localStorage under 'ergalics:user-profile'
// following the project's manual read/write convention. Nothing here is sent
// anywhere, and every field is optional — the profile simply starts empty.

import { create } from 'zustand';

export type Gender = 'unspecified' | 'female' | 'male' | 'other';

export interface UserProfile {
  name: string;
  /** Avatar image as a downscaled square data URL ('' = initials avatar). */
  avatar: string;
  /** Commit-author email. Used by the git layer (see settings hint). */
  email: string;
  gender: Gender;
  /** e.g. school year / class label, free-form. */
  birthYear: string;
  academy: string;
  workplace: string;
  /** Free-form research/interest tags, one per line in the UI. */
  hobbies: string;
  /** Career/education timeline, one entry per line in the UI. */
  experience: string;
  bio: string;
  /** Remote git account name for push/pull auth (often the site username). */
  gitUsername: string;
  /** Remote access token / password. Local-only, never leaves the browser
   *  except inside the git HTTP request itself. */
  gitToken: string;
}

const STORAGE_KEY = 'ergalics:user-profile';

const EMPTY_PROFILE: UserProfile = {
  name: '',
  avatar: '',
  email: '',
  gender: 'unspecified',
  birthYear: '',
  academy: '',
  workplace: '',
  hobbies: '',
  experience: '',
  bio: '',
  gitUsername: '',
  gitToken: '',
};

function load(): UserProfile {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...EMPTY_PROFILE };
    const merged = { ...EMPTY_PROFILE, ...(JSON.parse(raw) as Partial<UserProfile>) };
    // Avatar must be an image data URL; anything else (e.g. tampered or very
    // old payloads) falls back to the initials avatar.
    if (typeof merged.avatar !== 'string' || !merged.avatar.startsWith('data:image/')) {
      merged.avatar = '';
    }
    return merged;
  } catch {
    return { ...EMPTY_PROFILE };
  }
}

interface UserProfileStore {
  profile: UserProfile;
  update: (patch: Partial<UserProfile>) => void;
  reset: () => void;
  /** Display name: the user's name, or a neutral fallback key string ''. */
  displayName: () => string;
}

export const useUserProfileStore = create<UserProfileStore>((set, get) => ({
  profile: load(),
  update: (patch) => {
    set((s) => ({ profile: { ...s.profile, ...patch } }));
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(get().profile));
    } catch {
      /* private mode — profile simply does not persist */
    }
  },
  reset: () => {
    set({ profile: { ...EMPTY_PROFILE } });
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  },
  displayName: () => get().profile.name.trim(),
}));
