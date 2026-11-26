import { useSyncExternalStore } from 'react';

/**
 * Game voice for announcements — exactly one channel, never doubled:
 *  - auto (default): the game voice speaks only when a screen reader is in use on this
 *    device (see srDetect.ts); sighted players get sound effects and on-screen text;
 *  - voice: game voice always on;
 *  - silent: game voice off;
 *  - screenReader: events go to the player's own screen reader instead of the game voice.
 */
export type SpeechMode = 'auto' | 'voice' | 'silent' | 'screenReader';

export interface Prefs {
  name: string;
  /** 0–100 for each audio channel. */
  voiceVolume: number;
  announceVolume: number;
  sfxVolume: number;
  musicVolume: number;
  /** Background music: off by default so people can talk. */
  musicOn: boolean;
  /** UI and speech language (catalog code). */
  lang: string;
  /** Play the Trick 304 start sequence at launch. */
  playIntro: boolean;
  /** Read new text-chat messages aloud (politely, after game announcements). */
  readChat: boolean;
  /** Turn-by-turn instructions: spoken by the game voice and shown on screen. */
  guidance: boolean;
  /** Where game announcements go: screen reader live region, built-in voice, or both. */
  speech: SpeechMode;
  speechRate: number;
  duck: boolean;
  pushToTalk: boolean;
  /** Colour theme. DEFAULT light (owner decision). */
  theme: 'dark' | 'light' | 'high-contrast';
  /** Text size multiplier, 1 (100%) to 2 (200%). */
  textScale: number;
  /** Four-colour suits (DEFAULT) or classic two-colour. */
  suits: 'four' | 'two';
  /** Motion: follow the device (DEFAULT), always reduce, or always full. */
  motion: 'system' | 'reduce' | 'full';
  /** Vibrate on your turn and key moments (phones). */
  haptics: boolean;
  /** Hand layout: spread (wrapping rows grouped by suit, DEFAULT) or fan. */
  handLayout: 'spread' | 'fan';
  /** Show point values on cards. */
  showPoints: boolean;
  confirmPlay: boolean;
  focusHandOnTurn: boolean;
  playerVolume: Record<string, number>;
  playerMuted: Record<string, boolean>;
}

const DEFAULTS: Prefs = {
  name: '',
  voiceVolume: 80,
  announceVolume: 100,
  sfxVolume: 60,
  musicVolume: 35,
  musicOn: false,
  lang: 'en',
  playIntro: true,
  readChat: true,
  guidance: true,
  speech: 'auto',
  speechRate: 1.1,
  duck: true,
  pushToTalk: false,
  theme: 'light',
  textScale: 1,
  suits: 'four',
  motion: 'system',
  haptics: true,
  handLayout: 'spread',
  showPoints: true,
  confirmPlay: false,
  focusHandOnTurn: false,
  playerVolume: {},
  playerMuted: {},
};

const KEY = 'g304.prefs';
const VERSION = 7;

function load(): Prefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const stored = JSON.parse(raw);
      // v2 (Trick 304 CR v4): announcements default to "both"; reset the old default once.
      if ((stored.v ?? 1) < 2 && stored.speech === 'screenReader') delete stored.speech;
      // v5: one default for everyone (game voice); earlier defaults and the old first-run question are reset once.
      // v7: light became the default theme; move people off the old dark default once.
      if ((stored.v ?? 1) < 7 && stored.theme === 'dark') stored.theme = 'light';
      if ((stored.v ?? 1) < 6) {
        delete stored.speech;
        delete stored.askedScreenReader;
      }
      // Older display switches → the design-system settings.
      if (stored.highContrast === true && !stored.theme) stored.theme = 'high-contrast';
      if (stored.largeText === true && !stored.textScale) stored.textScale = 1.25;
      if (stored.fourColor === false && !stored.suits) stored.suits = 'two';
      if (typeof stored.vibrate === 'boolean' && stored.haptics === undefined) stored.haptics = stored.vibrate;
      return { ...DEFAULTS, ...stored };
    }
  } catch {
    /* storage unavailable */
  }
  const more = window.matchMedia?.('(prefers-contrast: more)').matches;
  return { ...DEFAULTS, theme: more ? 'high-contrast' : 'light' };
}

let state = load();
const listeners = new Set<() => void>();

export const prefs = {
  get: () => state,
  set(patch: Partial<Prefs>) {
    state = { ...state, ...patch };
    try {
      localStorage.setItem(KEY, JSON.stringify({ ...state, v: VERSION }));
    } catch {
      /* ignore */
    }
    listeners.forEach((l) => l());
  },
  subscribe(l: () => void) {
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  },
};

export function usePrefs(): Prefs {
  return useSyncExternalStore(prefs.subscribe, prefs.get);
}

/** Stable per-device session token used to reclaim your seat after a reload. */
export function sessionToken(): string {
  const k = 'g304.token';
  try {
    let t = localStorage.getItem(k);
    if (!t) {
      t = Array.from(crypto.getRandomValues(new Uint8Array(18)), (b) => b.toString(16).padStart(2, '0')).join('');
      localStorage.setItem(k, t);
    }
    return t;
  } catch {
    return Array.from(crypto.getRandomValues(new Uint8Array(18)), (b) => b.toString(16).padStart(2, '0')).join('');
  }
}
