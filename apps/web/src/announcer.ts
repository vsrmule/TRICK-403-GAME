import { useSyncExternalStore } from 'react';
import type { Spoken, VoiceScript } from '@g304/engine';
import { activity } from './activity';
import { gameVoice } from './gameVoice';
import { music } from './music';
import { prefs } from './prefs';
import { sfx } from './sfx';

export interface LogEntry {
  id: number;
  text: string;
  time: number;
  kind: 'game' | 'chat' | 'system';
}

type Item = { text: string; voice: string; clips?: VoiceScript | null; kind: LogEntry['kind']; priority?: boolean; always?: boolean; alsoScreenReader?: boolean; done?: () => void };

/**
 * The spoken event queue.
 *
 * Every announcement has a text form (captions, readable history, screen reader) and,
 * where the game can say it, a voice script for the game's own built-in voice
 * (pre-recorded clips, see gameVoice.ts). Items play strictly one after another:
 *  - built-in voice on (default) and the item can be said: the game voice plays it, with or
 *    without a screen reader; it is not also sent to the screen reader, so nothing is heard twice;
 *  - otherwise (voice off, or free text such as chat): released into an aria-live log for the
 *    player's screen reader, spaced so none are dropped.
 * The text always goes into the readable game log and the captions as well.
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
  say(msg: string | Spoken | null | undefined, opts: { interrupt?: boolean; always?: boolean; alsoScreenReader?: boolean; kind?: LogEntry['kind'] } = {}) {
    void this.sayAndWait(msg, opts);
  }

  /** Like `say`, resolving once this item has been fully spoken (used by the start sequence). */
  sayAndWait(msg: string | Spoken | null | undefined, opts: { interrupt?: boolean; always?: boolean; alsoScreenReader?: boolean; kind?: LogEntry['kind'] } = {}): Promise<void> {
    if (!msg) return Promise.resolve();
    const s = typeof msg === 'string' ? { text: msg, voice: msg } : msg;
    return new Promise((resolve) => {
      const item: Item = { ...s, kind: opts.kind ?? 'game', priority: !!opts.interrupt, always: !!opts.always, alsoScreenReader: !!opts.alsoScreenReader, done: resolve };
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
    gameVoice.stop();
    activity.setAnnouncing(false);
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

    const urls = p.gameVoice && p.announceVolume > 0 ? gameVoice.urls(item.clips, item.voice) : null;
    if (p.gameVoice && !urls && !gameVoice.ready) {
      // The phrase book is still loading (first seconds after start): wait for it, then decide.
      void gameVoice.load().then(() => {
        if (this.current !== item) return;
        this.queue.unshift(item);
        this.history = this.history.filter((h) => h !== entry);
        this.current = null;
        this.pump();
      });
      return;
    }
    if (!urls) {
      // Not something the built-in voice says (or it is off): hand the text to the screen reader.
      this.toLive(entry);
      const gap = this.gapMs(item.text);
      this.duck(gap);
      finish(gap);
      return;
    }

    if (item.alsoScreenReader) this.toLive(entry);
    activity.setAnnouncing(true);
    this.duck((urls.length * 1300) / (p.speechRate || 1));
    void gameVoice.play(urls, { rate: p.speechRate || 1, volume: p.announceVolume / 100 }).then(() => {
      if (this.current !== item) return;
      activity.setAnnouncing(false);
      finish(120);
    });
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

export const announcer = new Announcer();

export function useAnnouncer() {
  return useSyncExternalStore(announcer.subscribe, announcer.getSnapshot);
}
