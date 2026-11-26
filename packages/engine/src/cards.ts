export type Suit = 'S' | 'H' | 'C' | 'D';
export type Rank = 'J' | '9' | 'A' | '10' | 'K' | 'Q';

export interface Card {
  /** Stable id, e.g. "JS" (Jack of Spades), "10H". */
  id: string;
  suit: Suit;
  rank: Rank;
}

/** Display / sort order of suits (per PRD: Spades, Hearts, Clubs, Diamonds). */
export const SUITS: Suit[] = ['S', 'H', 'C', 'D'];
/** Highest to lowest. */
export const RANKS: Rank[] = ['J', '9', 'A', '10', 'K', 'Q'];

export const RANK_POINTS: Record<Rank, number> = { J: 30, '9': 20, A: 11, '10': 10, K: 3, Q: 2 };

export const SUIT_NAMES: Record<Suit, string> = { S: 'Spades', H: 'Hearts', C: 'Clubs', D: 'Diamonds' };
export const SUIT_SINGULAR: Record<Suit, string> = { S: 'Spade', H: 'Heart', C: 'Club', D: 'Diamond' };
export const SUIT_SYMBOLS: Record<Suit, string> = { S: '♠', H: '♥', C: '♣', D: '♦' };
export const RANK_NAMES: Record<Rank, string> = { J: 'Jack', '9': 'Nine', A: 'Ace', '10': 'Ten', K: 'King', Q: 'Queen' };

export function makeCard(rank: Rank, suit: Suit): Card {
  return { id: `${rank}${suit}`, rank, suit };
}

export function fullDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) for (const rank of RANKS) deck.push(makeCard(rank, suit));
  return deck;
}

export function cardFromId(id: string): Card {
  const suit = id.slice(-1) as Suit;
  const rank = id.slice(0, -1) as Rank;
  if (!SUITS.includes(suit) || !RANKS.includes(rank)) throw new Error(`Bad card id ${id}`);
  return makeCard(rank, suit);
}

export const points = (c: Card) => RANK_POINTS[c.rank];
/** Higher is stronger. */
export const strength = (c: Card) => RANKS.length - RANKS.indexOf(c.rank);

export function sumPoints(cards: Card[]): number {
  return cards.reduce((s, c) => s + points(c), 0);
}

/** Group by suit (S,H,C,D) and sort highest to lowest within a suit. */
export function sortHand(cards: Card[]): Card[] {
  return [...cards].sort(
    (a, b) => SUITS.indexOf(a.suit) - SUITS.indexOf(b.suit) || RANKS.indexOf(a.rank) - RANKS.indexOf(b.rank),
  );
}

export function cardName(c: Card): string {
  return `${RANK_NAMES[c.rank]} of ${SUIT_NAMES[c.suit]}`;
}

export function cardShort(c: Card): string {
  return `${c.rank}${SUIT_SYMBOLS[c.suit]}`;
}

export type Rng = () => number;

export function shuffle<T>(items: T[], rng: Rng = Math.random): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Deterministic PRNG for tests (mulberry32). */
export function seededRng(seed: number): Rng {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}
