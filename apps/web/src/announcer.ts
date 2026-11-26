import { useSyncExternalStore } from 'react';
import type { Spoken } from '@g304/engine';
import { activity } from './activity';
import { music } from './music';
import { prefs } from './prefs';
import { screenReader } from './srDetect';
import { sfx } from './sfx';

export interface LogEntry {
  id: number;
  text: string;
  time: number;
  kind: 'game' | 'chat' | 'system';
}

type Item = { text: string; voice: string; kind: LogEntry['kind']; priority?: boolean; always?: boolean; done?: () => void };

/**
 * The spoken event queue.
 *
 * Every announcement has a text form (screen reader + readable history) and a
 * voice form (the app's built-in voice). Items play strictly one after another:
 *  - "screenReader": released into an aria-live log for the player's screen reader,
 *    spaced so none are dropped; the game voice stays quiet (nothing is heard twice);
 *  - "voice": the game's own voice, for players without a screen reader;
 *  - "silent": nothing spoken except readouts the player asks for.
 * The text always goes into the readable game log as well.
 * Effects and music duck while anything is being spoken.
 */
class Announcer {
  private queue: Item[] = [];
  private busy = false;
  private seq = 0;
  live: LogEntry[] = [];
  history: LogEntry[] = [];
  private listeners = new Set<() => void>();
  private timer: number | null = null;
  private current: Item | null = null;
  snapshot = { live: this.live, history: this.history };

  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => {
      this.listeners.delete(l);
    };
  };
  getSnapshot = () => this.snapshot;
  private notify() {
    this.snapshot = { live: this.live, history: this.history };
    this.listeners.forEach((l) => l());
  }

  /**
   * Queue an announcement. `interrupt` jumps the queue (on-demand readouts, errors)
   * without discarding pending game events.
   */
  say(msg: string | Spoken | null | undefined, opts: { interrupt?: boolean; always?: boolean; kind?: LogEntry['kind'] } = {}) {
    void this.sayAndWait(msg, opts);
  }

  /** Like `say`, resolving once this item has been fully spoken (used by the start sequence). */
  sayAndWait(msg: string | Spoken | null | undefined, opts: { interrupt?: boolean; always?: boolean; kind?: LogEntry['kind'] } = {}): Promise<void> {
    if (!msg) return Promise.resolve();
    const s = typeof msg === 'string' ? { text: msg, voice: msg } : msg;
    return new Promise((resolve) => {
      const item: Item = { ...s, kind: opts.kind ?? 'game', priority: !!opts.interrupt, always: !!opts.always, done: resolve };
      if (opts.interrupt) {
        this.stopCurrent();
        this.queue.unshift(item);
        this.pump();
      } else {
        this.queue.push(item);
        if (!this.busy) this.pump();
      }
    });
  }

  /** Drop everything queued (used when skipping the start sequence). */
  cancelAll() {
    this.stopCurrent();
    const q = this.queue;
    this.queue = [];
    q.forEach((i) => i.done?.());
  }

  private stopCurrent() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    this.current?.done?.();
    this.current = null;
    this.busy = false;
  }

  /** Screen readers queue polite text themselves; we only space it so none is dropped. */
  private gapMs(text: string) {
    const rate = prefs.get().speechRate || 1;
    const backlog = this.queue.length > 3 ? 0.5 : 1;
    return Math.min(3000, ((250 + text.length * 20) / rate) * backlog);
  }

  private toLive(entry: LogEntry) {
    this.live = [...this.live.slice(-4), entry];
    this.notify();
  }

  private pump() {
    const item = this.queue.shift();
    if (!item) {
      this.busy = false;
      return;
    }
    this.busy = true;
    this.current = item;
    const p = prefs.get();
    const entry: LogEntry = { id: ++this.seq, text: item.text, time: Date.now(), kind: item.kind };
    this.history = [...this.history.slice(-199), entry];
    this.notify();

    const finish = (afterMs: number) => {
      if (this.current !== item) return;
      this.timer = window.setTimeout(() => {
        if (this.current !== item) return;
        this.current = null;
        item.done?.();
        this.pump();
      }, afterMs);
    };

    const hasTts = 'speechSynthesis' in window;
    // Automatic: game voice only when a screen reader is in use on this device.
    const mode = p.speech === 'auto' ? (screenReader.get() ? 'voice' : 'silent') : p.speech;
    // Readouts the player asks for (T, S, What now?, errors) and the start sequence always speak.
    const forced = item.priority === true || item.always === true;
    const useVoice = (mode === 'voice' || (mode === 'silent' && forced)) && hasTts && p.announceVolume > 0;
    if (!useVoice) {
      // Own-screen-reader mode, or no built-in voice on this device: hand the text to the screen reader.
      if (mode === 'screenReader' || (mode === 'voice' && !hasTts)) this.toLive(entry);
      const gap = this.gapMs(item.text);
      this.duck(gap);
      finish(gap);
      return;
    }

    const u = new SpeechSynthesisUtterance(item.voice);
    u.volume = p.announceVolume / 100;
    u.rate = p.speechRate;
    u.lang = p.lang === 'en' ? 'en-US' : p.lang;
    const v = pickVoice(u.lang);
    if (v) u.voice = v;
    let ended = false;
    activity.setAnnouncing(true);
    const end = () => {
      if (ended) return;
      ended = true;
      activity.setAnnouncing(false);
      finish(120);
    };
    u.onend = end;
    u.onerror = end;
    this.duck(this.gapMs(item.voice) * 2);
    // Safari sometimes leaves the speech engine paused (e.g. after the screen locks).
    if (window.speechSynthesis.paused) window.speechSynthesis.resume();
    window.speechSynthesis.speak(u);
    // Safety net: some engines never fire onend.
    window.setTimeout(end, Math.min(12000, 1500 + item.voice.length * 90));
  }

  private duck(ms: number) {
    sfx.duck(ms);
    music.duck(ms);
  }

  clearHistory() {
    this.history = [];
    this.live = [];
    this.notify();
  }
}

/**
 * iPhone/iPad Safari only lets a page speak after speech was started inside a user gesture.
 * Speak a silent utterance on the first tap/click/key so later announcements are allowed.
 */
if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
  let unlocked = false;
  const unlock = () => {
    if (unlocked) return;
    unlocked = true;
    try {
      const u = new SpeechSynthesisUtterance(' ');
      u.volume = 0;
      window.speechSynthesis.speak(u);
    } catch {
      /* ignore */
    }
  };
  for (const ev of ['touchend', 'click', 'keydown']) window.addEventListener(ev, unlock, { capture: true, passive: true });
}

/** One consistent voice for all announcements and the start sequence. */
let chosen: SpeechSynthesisVoice | null = null;
function pickVoice(lang: string): SpeechSynthesisVoice | null {
  if (!('speechSynthesis' in window)) return null;
  if (chosen && chosen.lang.startsWith(lang.slice(0, 2))) return chosen;
  const voices = window.speechSynthesis.getVoices();
  chosen =
    voices.find((v) => v.lang === lang && /natural|neural|online/i.test(v.name)) ??
    voices.find((v) => v.lang === lang) ??
    voices.find((v) => v.lang.startsWith(lang.slice(0, 2))) ??
    null;
  return chosen;
}
if ('speechSynthesis' in window) window.speechSynthesis.onvoiceschanged = () => (chosen = null);

export const announcer = new Announcer();

export function useAnnouncer() {
  return useSyncExternalStore(announcer.subscribe, announcer.getSnapshot);
}
