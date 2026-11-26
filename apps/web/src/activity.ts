import { useSyncExternalStore } from 'react';

/**
 * What is making sound right now, per audio channel — shown visually so deaf and
 * hard-of-hearing players know when the game or a friend is "speaking".
 */
export interface Activity {
  /** The game voice is speaking. */
  announcing: boolean;
  /** A sound effect is playing (and which one). */
  sfx: string | null;
  /** Background music is on. */
  music: boolean;
}

let state: Activity = { announcing: false, sfx: null, music: false };
const listeners = new Set<() => void>();
let sfxTimer: number | null = null;

function set(p: Partial<Activity>) {
  const next = { ...state, ...p };
  if (next.announcing === state.announcing && next.sfx === state.sfx && next.music === state.music) return;
  state = next;
  listeners.forEach((l) => l());
}

export const activity = {
  get: () => state,
  setAnnouncing: (on: boolean) => set({ announcing: on }),
  setMusic: (on: boolean) => set({ music: on }),
  /** Mark an effect as playing for `ms`. */
  pulseSfx(name: string, ms: number) {
    set({ sfx: name });
    if (sfxTimer) clearTimeout(sfxTimer);
    sfxTimer = window.setTimeout(() => set({ sfx: null }), ms);
  },
  subscribe(l: () => void) {
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  },
};

export function useActivity() {
  return useSyncExternalStore(activity.subscribe, activity.get);
}
