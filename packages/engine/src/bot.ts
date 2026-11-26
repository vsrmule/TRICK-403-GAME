import { Card, RANKS, Suit, SUITS, points, strength, sumPoints } from './cards';
import { trickLeader } from './game';
import { Action, Play } from './types';
import { PlayerView } from './view';

/**
 * Heuristic bot. It decides only from its own PlayerView, so it never uses
 * information a human in the same seat could not see.
 */
export function botDecide(v: PlayerView): Action | null {
  if (v.seat === null || !v.legal || v.turn !== v.seat) return null;
  if (v.phase === 'bidding') return decideBid(v);
  if (v.phase === 'trumpSelect') return { type: 'selectTrump', cardId: chooseTrump(v.myHand).id };
  if (v.phase === 'playing') return decidePlay(v);
  return null;
}

const bySuit = (cards: Card[], suit: Suit) => cards.filter((c) => c.suit === suit);

/** Rough card points this side expects to capture with this hand as bidder. */
function estimate(v: PlayerView): number {
  const hand = v.myHand;
  const k = v.cardsEach;
  const longest = Math.max(...SUITS.map((s) => bySuit(hand, s).length));
  const jacks = hand.filter((c) => c.rank === 'J').length;
  const avg = v.pointsInPlay / v.config.numPlayers;
  const score = sumPoints(hand) + 15 * Math.max(0, longest - k / 4) + 8 * jacks;
  return (v.pointsInPlay / v.numTeams) + (score - avg) * 1.5;
}

function decideBid(v: PlayerView): Action {
  const L = v.legal!;
  const seat = v.seat!;
  const lowest = L.bidOptions[0];
  const othersActive = v.passed.filter((p, i) => !p && i !== seat).length;
  // Avoid endless void rounds: the last player standing with no bid opens at the minimum.
  if (!v.highBid && othersActive === 0 && lowest !== undefined) return { type: 'bid', value: lowest };
  if (lowest === undefined) return { type: 'pass' };
  const est = estimate(v);
  const partnerHigh = v.highBid && v.teams[v.highBid.seat] === v.teams[seat];
  const needed = partnerHigh ? lowest + 30 : lowest;
  return est >= needed ? { type: 'bid', value: lowest } : { type: 'pass' };
}

export function chooseTrump(hand: Card[]): Card {
  let bestSuit: Suit = hand[0].suit;
  let bestScore = -1;
  for (const s of SUITS) {
    const cs = bySuit(hand, s);
    const sc = cs.length * 20 + sumPoints(cs);
    if (cs.length && sc > bestScore) {
      bestScore = sc;
      bestSuit = s;
    }
  }
  // Hide the weakest card of the trump suit; keep the strong ones playable.
  return bySuit(hand, bestSuit).reduce((lo, c) => (strength(c) < strength(lo) ? c : lo));
}

function seenCards(v: PlayerView): Set<string> {
  const seen = new Set<string>();
  for (const t of v.completedTricks) for (const p of t.plays) seen.add(p.card.id);
  for (const p of v.currentTrick?.plays ?? []) seen.add(p.card.id);
  for (const c of v.myHand) seen.add(c.id);
  return seen;
}

function isMaster(c: Card, seen: Set<string>): boolean {
  return RANKS.slice(0, RANKS.indexOf(c.rank)).every((r) => seen.has(`${r}${c.suit}`));
}

const lowest = (cards: Card[]) =>
  cards.reduce((lo, c) => (points(c) < points(lo) || (points(c) === points(lo) && strength(c) < strength(lo)) ? c : lo));
const highestPoints = (cards: Card[]) => cards.reduce((hi, c) => (points(c) > points(hi) ? c : hi));

/** Would `card` win the trick as things stand, from this seat's knowledge? */
function wouldWin(card: Card, plays: Play[], v: PlayerView): boolean {
  const known = v.trumpSuit; // revealed, or our own trump suit if we are the bidder
  // Trump is the whole suit (CR v5): any trump-suit card counts.
  const counts = known !== null && card.suit === known;
  const sim = [...plays, { seat: v.seat!, card, asTrump: counts }];
  return trickLeader(sim, known)?.seat === v.seat;
}

function decidePlay(v: PlayerView): Action {
  const L = v.legal!;
  const seat = v.seat!;
  const myTeam = v.teams[seat];
  const hand = v.myHand;
  const legal = hand.filter((c) => L.playable.includes(c.id));
  const plays = v.currentTrick?.plays ?? [];
  const seen = seenCards(v);
  const trump = v.trumpSuit;

  if (plays.length === 0) {
    const masters = legal.filter((c) => isMaster(c, seen) && c.suit !== trump);
    if (masters.length) return { type: 'play', cardId: highestPoints(masters).id };
    const nonTrump = legal.filter((c) => c.suit !== trump);
    return { type: 'play', cardId: lowest(nonTrump.length ? nonTrump : legal).id };
  }

  const current = trickLeader(plays, v.trumpRevealed ? trump : null)!;
  const partnerWinning = v.teams[current.seat] === myTeam;
  const trickPts = plays.reduce((s, p) => s + points(p.card), 0);
  const lastToPlay = plays.length === v.config.numPlayers - 1;

  // Void in the led suit with valuable cards on the table: ask for trump.
  if (L.canAskTrump && !partnerWinning && trickPts >= 15) return { type: 'askTrump' };

  if (partnerWinning) {
    const safe = lastToPlay || isMaster(current.card, seen) || current.asTrump;
    const feed = legal.filter((c) => c.suit !== trump);
    if (safe) return { type: 'play', cardId: highestPoints(feed.length ? feed : legal).id };
    return { type: 'play', cardId: lowest(legal).id };
  }
  const winners = legal.filter((c) => wouldWin(c, plays, v));
  if (winners.length && (trickPts >= 10 || lastToPlay || winners.some((c) => c.suit !== trump))) {
    const cheapest = winners.reduce((lo, c) => (strength(c) < strength(lo) ? c : lo));
    return { type: 'play', cardId: cheapest.id };
  }
  const nonTrump = legal.filter((c) => c.suit !== trump);
  return { type: 'play', cardId: lowest(nonTrump.length ? nonTrump : legal).id };
}
