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
}

const STORAGE_KEY = 'ergalics:user-profile';

export const EMPTY_PROFILE: UserProfile = {
  name: '',
  gender: 'unspecified',
  birthYear: '',
  academy: '',
  workplace: '',
  hobbies: '',
  experience: '',
  bio: '',
};

function load(): UserProfile {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...EMPTY_PROFILE };
    return { ...EMPTY_PROFILE, ...(JSON.parse(raw) as Partial<UserProfile>) };
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
