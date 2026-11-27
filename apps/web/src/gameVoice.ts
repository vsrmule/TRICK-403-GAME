import { scriptClips, type Phrase, type PhraseBook, type VoiceScript } from '@g304/engine';
import { prefs } from './prefs';

/**
 * The game's own built-in voice (Issue 10): pre-recorded clips shipped with the website
 * and inside the Android app, under /voice/<lang>/. No device text-to-speech, no screen
 * reader and no network service is involved: the game just plays its own audio files.
 *
 * A language is a folder: phrases.json (the phrase book) + clips/<id>.mp3 + clips/index.json.
 * A language without its own folder falls back to English.
 */
const BASE = `${import.meta.env.BASE_URL}voice/`;
const FALLBACK = 'en';

interface Loaded {
  lang: string;
  book: PhraseBook;
  index: Map<string, Phrase>;
  have: Set<string>;
  /** Exact text of every phrase without slots → that phrase (for plain-text announcements). */
  literal: Map<string, string>;
}

/** 50 ms of silence (WAV), used to unlock audio on the first tap (silent, so no muting needed). */
const SILENCE = (() => {
  const n = 400;
  const b = new Uint8Array(44 + n);
  const v = new DataView(b.buffer);
  const str = (o: number, t: string) => [...t].forEach((c, i) => (b[o + i] = c.charCodeAt(0)));
  str(0, 'RIFF'); v.setUint32(4, 36 + n, true); str(8, 'WAVEfmt '); v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, 8000, true); v.setUint32(28, 8000, true);
  v.setUint16(32, 1, true); v.setUint16(34, 8, true); str(36, 'data'); v.setUint32(40, n, true);
  b.fill(128, 44);
  return `data:audio/wav;base64,${btoa(String.fromCharCode(...b))}`;
})();

const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();

async function fetchJson<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return (await r.json()) as T;
}

async function loadLang(lang: string): Promise<Loaded> {
  const [book, have] = await Promise.all([fetchJson<PhraseBook>(`${BASE}${lang}/phrases.json`), fetchJson<string[]>(`${BASE}${lang}/clips/index.json`)]);
  const literal = new Map<string, string>();
  for (const p of book.phrases) if (p.chunks.every((c) => !c.text.includes('{'))) literal.set(norm(p.chunks.map((c) => c.text).join(' ')), p.id);
  return { lang, book, index: new Map(book.phrases.map((p) => [p.id, p])), have: new Set(have), literal };
}

class GameVoice {
  private loaded: Loaded | null = null;
  private loading: Promise<Loaded | null> | null = null;
  private loadingLang = '';
  /** Two players: one speaks while the other loads the next clip. */
  private els: HTMLAudioElement[] = [];
  private token = 0;
  private stopCurrent: (() => void) | null = null;

  /** Load the phrase book for the current language (once; again when the language changes). */
  load(): Promise<Loaded | null> {
    const lang = prefs.get().lang || FALLBACK;
    if (this.loadingLang === lang) return this.loading ?? Promise.resolve(this.loaded);
    this.loadingLang = lang;
    const p = loadLang(lang)
      .catch(() => (lang === FALLBACK ? null : loadLang(FALLBACK)))
      .catch(() => null)
      .then((l) => {
        if (this.loading === p) {
          this.loaded = l;
          this.loading = null;
        }
        return l;
      });
    this.loading = p;
    return p;
  }

  /** True once the phrase book for the current language (or its fallback) is in. */
  get ready() {
    return !this.loading && this.loadingLang === (prefs.get().lang || FALLBACK);
  }

  /** Clip URLs for a voice script, or a plain sentence the phrase book has word for word. Null = can't be said. */
  urls(script: VoiceScript | null | undefined, text?: string): string[] | null {
    const l = this.loaded;
    if (!l) return null;
    let s = script;
    if (!s && text) {
      const id = l.literal.get(norm(text));
      if (id) s = [{ t: id }];
    }
    if (!s || !s.length) return null;
    const clips = scriptClips(l.book, s, l.index);
    if (!clips || !clips.every((c) => l.have.has(c.id))) return null;
    return clips.map((c) => `${BASE}${l.lang}/clips/${c.id}.mp3`);
  }

  private players() {
    if (!this.els.length) {
      this.els = [0, 1].map(() => {
        const a = new Audio();
        a.preload = 'auto';
        (a as HTMLAudioElement & { preservesPitch?: boolean }).preservesPitch = true;
        return a;
      });
    }
    return this.els;
  }

  /**
   * iPhone/iPad only let a page play sound from an element that first played inside a tap.
   * Called on the first tap / click / key press.
   */
  unlock() {
    for (const a of this.players()) {
      if (!a.paused) continue; // already speaking: it is unlocked
      a.src = SILENCE;
      const p = a.play();
      // Only tidy up if no announcement has taken the element over in the meantime.
      const done = () => {
        if (a.src === SILENCE) a.pause();
      };
      if (p) p.then(done, done);
      else done();
    }
  }

  /** Play clips one after another. Resolves when finished or stopped. */
  play(urls: string[], opts: { rate: number; volume: number }): Promise<void> {
    this.stop();
    const my = ++this.token;
    const els = this.players();
    return new Promise<void>((resolve) => {
      let i = 0;
      let current: HTMLAudioElement | null = null;
      let safety: number | null = null;
      const finish = () => {
        if (safety) clearTimeout(safety);
        if (current) {
          current.onended = current.onerror = null;
          current.pause();
        }
        if (this.stopCurrent === finish) this.stopCurrent = null;
        resolve();
      };
      this.stopCurrent = finish;
      const next = () => {
        if (my !== this.token) return finish();
        if (safety) clearTimeout(safety);
        if (i >= urls.length) return finish();
        const a = els[i % 2];
        const following = els[(i + 1) % 2];
        if (a.src !== new URL(urls[i], location.href).href) a.src = urls[i];
        // Start loading the clip after this one while this one plays.
        if (i + 1 < urls.length) following.src = urls[i + 1];
        a.muted = false;
        a.playbackRate = opts.rate;
        a.volume = Math.max(0, Math.min(1, opts.volume));
        a.currentTime = 0;
        current = a;
        i++;
        a.onended = next;
        a.onerror = next;
        // Safety net in case a clip never reports its end (e.g. a stalled load).
        safety = window.setTimeout(next, 8000);
        a.play().catch(next);
      };
      next();
    });
  }

  stop() {
    this.token++;
    this.stopCurrent?.();
  }
}

export const gameVoice = new GameVoice();

if (typeof window !== 'undefined') {
  void gameVoice.load();
  prefs.subscribe(() => void gameVoice.load());
  let unlocked = false;
  const unlock = () => {
    if (unlocked) return;
    unlocked = true;
    gameVoice.unlock();
  };
  for (const ev of ['touchend', 'click', 'keydown']) window.addEventListener(ev, unlock, { capture: true, passive: true });
}
