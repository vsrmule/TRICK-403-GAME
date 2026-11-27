/**
 * Built-in voice: pre-recorded clips (Issue 10).
 *
 * Every announcement the game voice can say is described by a language-neutral
 * *voice script*: a list of phrase references, e.g.
 *   [{ t: 'bid', v: { who: 's3', bid: '200' } }]
 * Each language has a phrase book (apps/web/public/voice/<lang>/phrases.json) that gives
 * every phrase's wording as "chunks". A chunk holds at most one slot, e.g.
 *   { "text": "{who} bids", "you": "You bid" }, { "text": "{bid}!", "style": "excited" }
 * and the book lists the spoken text of every slot value (seats, cards, bids, numbers…).
 *
 * One audio clip exists per (style, filled-in chunk text). Its file name is a hash of
 * that pair, so the generator and the game compute the same name independently and a
 * clip that several phrases share is stored once. Adding a language = adding a folder
 * with its phrase book and clips; no code changes.
 */

export interface VoiceRef {
  /** Phrase id in the phrase book. */
  t: string;
  /** Slot values by slot name (slot name = slot type, e.g. who, bid, card, suit, num). */
  v?: Record<string, string>;
}
export type VoiceScript = VoiceRef[];

export interface PhraseChunk {
  text: string;
  /** Wording to use instead when the chunk's slot value is "you" (verb agreement). */
  you?: string;
  style?: string;
}
export interface Phrase {
  id: string;
  style?: string;
  chunks: PhraseChunk[];
}
export interface PhraseBook {
  lang: string;
  /** Voice used to generate this language's clips (informational; the generator reads it). */
  voice: string;
  /** Default speaking style. */
  style: string;
  /** Spoken text of every value of every slot type. Keys are what voice scripts carry. */
  slots: Record<string, Record<string, string>>;
  phrases: Phrase[];
}

export interface ClipSpec {
  id: string;
  style: string;
  text: string;
}

const SLOT = /\{(\w+)\}/;

/** FNV-1a (32-bit) → base36: short, stable file names. */
export function clipId(style: string, text: string): string {
  let h = 0x811c9dc5;
  const s = `${style}|${text}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36).padStart(7, '0');
}

function spec(style: string, text: string): ClipSpec {
  const t = text.replace(/\s+/g, ' ').trim();
  return { id: clipId(style, t), style, text: t };
}

/** The clip for one chunk with its slot filled from `values`; null if a value is unknown. */
export function chunkClip(book: PhraseBook, phrase: Phrase, chunk: PhraseChunk, values: Record<string, string> = {}): ClipSpec | null {
  const style = chunk.style ?? phrase.style ?? book.style;
  const m = chunk.text.match(SLOT);
  if (!m) return spec(style, chunk.text);
  const key = values[m[1]];
  if (key === undefined) return null;
  if (key === 'you' && chunk.you) return spec(style, chunk.you);
  const said = book.slots[m[1]]?.[key];
  if (said === undefined) return null;
  return spec(style, chunk.text.replace(SLOT, said));
}

/**
 * Clips for a voice script, in order. Returns null if any part can't be said with the
 * book (unknown phrase or slot value), so the caller falls back to text.
 */
export function scriptClips(book: PhraseBook, script: VoiceScript, index?: Map<string, Phrase>): ClipSpec[] | null {
  const byId = index ?? new Map(book.phrases.map((p) => [p.id, p]));
  const out: ClipSpec[] = [];
  for (const ref of script) {
    const p = byId.get(ref.t);
    if (!p) return null;
    for (const c of p.chunks) {
      const clip = chunkClip(book, p, c, ref.v);
      if (!clip) return null;
      out.push(clip);
    }
  }
  return out;
}

/** Every clip the phrase book can ever need (what the generator renders). */
export function allClips(book: PhraseBook): ClipSpec[] {
  const seen = new Map<string, ClipSpec>();
  for (const p of book.phrases) {
    for (const c of p.chunks) {
      const m = c.text.match(SLOT);
      const keys = m ? Object.keys(book.slots[m[1]] ?? {}) : [''];
      if (m && c.you && !keys.includes('you')) keys.push('you');
      for (const k of keys) {
        const clip = chunkClip(book, p, c, m ? { [m[1]]: k } : {});
        if (clip) seen.set(clip.id, clip);
      }
    }
  }
  return [...seen.values()];
}
