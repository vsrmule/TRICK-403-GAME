import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  Action,
  DEFAULT_CONFIG,
  Game304,
  GameConfig,
  PLAYER_COUNTS,
  PlayerCount,
  PhraseBook,
  PlayerView,
  RULES,
  VoiceScript,
  allClips,
  clipId,
  scriptClips,
  voiceGuidance,
  whoKey,
  allBids,
  bandOf,
  basketSummary,
  bidName,
  bidsAbove,
  botDecide,
  cardFromId,
  cardLabel,
  cardsPerPlayer,
  catalog,
  describeEvent,
  eventsFor,
  guidance,
  fullDeck,
  scoreStatus,
  seededRng,
  sortHand,
  sumPoints,
  tableStatus,
  viewFor,
} from '../src';

const cfg = (over: Partial<GameConfig> = {}): GameConfig => ({ ...DEFAULT_CONFIG, ...over });
const hand = (ids: string) => ids.split(' ').map(cardFromId);

function rig(g: Game304, hands: string[]) {
  g.hands = hands.map(hand);
  g.pointsInPlay = g.hands.reduce((s, h) => s + sumPoints(h), 0);
  // Hand-made deals test other rules; Rule B (cancel when a side has no trump) is tested on its own.
  g.options.cancelOnNoTrump = false;
}
/**
 * Issue 7 moved trick 1's lead to the bidder's right, so in team modes the bidding side never
 * opens trick 1. Coat scoring tests put `seat` at the opening of the current trick directly
 * (as atTrickStart does); who leads is tested in the Issue 7 block.
 */
function opensTrick<G extends Game304>(g: G, seat: number): G {
  g.currentTrick!.leader = seat;
  g.turn = seat;
  return g;
}
const playFirst = (g: Game304) => g.apply(g.turn, { type: 'play', cardId: g.legalCards(g.turn)[0].id });
/** Play the round out; when the bid is reached the bidder chooses Stop (the old automatic stop). */
function playOut(g: Game304) {
  for (;;) {
    if (g.phase === 'playing') playFirst(g);
    else if (g.phase === 'continueChoice') g.apply(g.turn, { type: 'stopRound' });
    else return;
  }
}
const pass = (...seats: number[]) => seats.map((s) => [s, { type: 'pass' }] as [number, Action]);
const bid = (seat: number, value: number) => [seat, { type: 'bid', value }] as [number, Action];

// 8 players (3 tricks), dealer 7 so seat 0 bids first and leads. Team A (even seats) holds J/9/A of every suit.
const EIGHT = ['JS 9S AS', '10S KS QS', 'JH 9H AH', '10H KH QH', 'JC 9C AC', '10C KC QC', 'JD 9D AD', '10D KD QD'];
function eight(bids: [number, Action][]) {
  const g = new Game304(cfg({ numPlayers: 8 }), { dealer: 7, rng: seededRng(1) });
  rig(g, EIGHT);
  for (const [s, a] of bids) g.apply(s, a);
  return g;
}
/** Team A bids `value` from seat 0 and hides the Ace of Spades. */
const teamABids = (value: number) => {
  const g = eight([bid(0, value), ...pass(1, 2, 3, 4, 5, 6, 7)]);
  g.apply(0, { type: 'selectTrump', cardId: 'AS' });
  return g;
};
/** Team B bids `value` from seat 1 (hides Queen of Spades) and will capture nothing. */
const teamBBids = (value: number) => {
  const g = eight([...pass(0), bid(1, value), ...pass(2, 3, 4, 5, 6, 7)]);
  g.apply(1, { type: 'selectTrump', cardId: 'QS' });
  return g;
};

describe('deck and labels', () => {
  it('24 cards worth 304', () => {
    expect(fullDeck()).toHaveLength(24);
    expect(sumPoints(fullDeck())).toBe(304);
  });
  it('sorts by suit then J 9 A 10 K Q', () => {
    expect(sortHand(hand('QH 10S JH KS 9S AD')).map((c) => c.id)).toEqual(['9S', '10S', 'KS', 'JH', 'QH', 'AD']);
  });
  it('card labels follow the BRD format', () => {
    expect(cardLabel(cardFromId('JH'), true)).toBe('Jack of Hearts, 30 points — Playable');
    expect(cardLabel(cardFromId('9S'), false, 'Must follow led suit, Clubs')).toBe('Nine of Spades, 20 points — Disabled: Must follow led suit, Clubs');
  });
  it.each([[2, 12], [3, 8], [4, 6], [6, 4], [8, 3]] as const)('%i players get %i cards', (n, k) => {
    const g = new Game304(cfg({ numPlayers: n }), { rng: seededRng(n) });
    expect(g.hands.every((h) => h.length === k)).toBe(true);
    expect(new Set(g.hands.flat().map((c) => c.id)).size).toBe(24);
  });
  it('4-player 4-card option', () => {
    expect(cardsPerPlayer({ numPlayers: 4, fourCardMode: true })).toBe(4);
  });
});

describe('bidding: bands, names, 300 → 304', () => {
  it('bid ladder is 160…300 in tens, then 304', () => {
    const bids = allBids();
    expect(bids[0]).toBe(160);
    expect(bids.slice(-3)).toEqual([290, 300, 304]);
    expect(bidsAbove(290)).toEqual([300, 304]);
    expect(bidsAbove(300)).toEqual([304]);
    expect(bidsAbove(304)).toEqual([]);
  });
  it('names Band 2 bids "Jaan", "Jaan 10" … and 304 as "304"', () => {
    expect(bidName(190)).toBe('190');
    expect(bidName(200)).toBe('Jaan');
    expect(bidName(210)).toBe('Jaan 10');
    expect(bidName(220)).toBe('Jaan 20');
    expect(bidName(300)).toBe('Jaan 100');
    expect(bidName(304)).toBe('304');
  });
  it('bands: 160–190 is Band 1, 200–304 is Band 2', () => {
    expect([160, 190].map((v) => bandOf(v).id)).toEqual([1, 1]);
    expect([200, 300, 304].map((v) => bandOf(v).id)).toEqual([2, 2, 2]);
  });
  it('enforces the ladder in the engine, including the step from 300 to 304', () => {
    const g = new Game304(cfg(), { dealer: 3, rng: seededRng(5) });
    expect(() => g.apply(0, { type: 'bid', value: 150 })).toThrow(/160/);
    expect(() => g.apply(0, { type: 'bid', value: 165 })).toThrow(/steps/);
    expect(() => g.apply(0, { type: 'bid', value: 310 })).toThrow();
    g.apply(0, { type: 'bid', value: 300 });
    expect(viewFor(g, 1).legal!.bidOptions).toEqual([304]);
    expect(() => g.apply(1, { type: 'bid', value: 300 })).toThrow(/higher/);
    g.apply(1, { type: 'bid', value: 304 });
    expect(viewFor(g, 2).legal!.bidOptions).toEqual([]);
    expect(viewFor(g, 2).legal!.canChallengeCoat).toBe(true);
    g.apply(2, { type: 'pass' });
    g.apply(3, { type: 'pass' });
    g.apply(0, { type: 'pass' });
    expect(g.contract).toEqual({ bidder: 1, type: 'normal', value: 304 });
  });
  it('announces Band 2 bids by name', () => {
    const g = new Game304(cfg(), { dealer: 3, rng: seededRng(5) });
    g.drainEvents();
    g.apply(0, { type: 'bid', value: 210 });
    const e = g.drainEvents().find((x) => x.kind === 'bid')!;
    expect(describeEvent(e, ['A', 'B', 'C', 'D'], 1, viewFor(g, 1))!.text).toBe('A bid Jaan 10.');
  });
  it('all pass voids and re-deals', () => {
    const g = new Game304(cfg(), { dealer: 3, rng: seededRng(5) });
    for (const s of [0, 1, 2, 3]) g.apply(s, { type: 'pass' });
    expect(g.redeals).toBe(1);
    expect(g.phase).toBe('bidding');
  });
});

/** 8 players with a chosen dealer (dealer 0 → seat 1, Team B, bids first and leads trick 1). */
function eightD(dealer: number, bids: [number, Action][]) {
  const g = new Game304(cfg({ numPlayers: 8 }), { dealer, rng: seededRng(1) });
  rig(g, EIGHT);
  for (const [s, a] of bids) g.apply(s, a);
  return g;
}
/** Team B (seat 1) bids `value`, leads trick 1, and will lose it to Team A's top cards. */
const teamBLeads = (value: number) => {
  const g = eightD(0, [bid(1, value), ...pass(2, 3, 4, 5, 6, 7, 0)]);
  g.apply(1, { type: 'selectTrump', cardId: 'QS' });
  return g;
};

describe('normal bid scoring', () => {
  it('Band 1 made: +1 to the bidding side', () => {
    const g = teamABids(160);
    playOut(g);
    expect(g.lastResult).toMatchObject({ kind: 'normal', band: 1, success: true, awarded: [1, 0] });
  });
  it('Band 1 stopped: +2 to the opponents', () => {
    const g = teamBBids(190);
    playOut(g);
    expect(g.lastResult).toMatchObject({ kind: 'normal', band: 1, success: false, awarded: [2, 0] });
  });
  it('Band 2 made: +2', () => {
    const g = teamABids(200);
    playOut(g);
    expect(g.lastResult).toMatchObject({ band: 2, success: true, awarded: [2, 0] });
  });
  it('Band 2 stopped: +4 to the opponents', () => {
    const g = teamBBids(250);
    playOut(g);
    expect(g.lastResult).toMatchObject({ band: 2, success: false, awarded: [4, 0] });
  });
  it('304 bid made scores as Band 2 (+2); stopped gives opponents +4', () => {
    const g = teamABids(304);
    playOut(g);
    expect(g.lastResult).toMatchObject({ bidValue: 304, band: 2, success: true, awarded: [2, 0], stopReason: null });
    const h = teamBBids(304);
    playOut(h);
    expect(h.lastResult).toMatchObject({ bidValue: 304, band: 2, success: false, awarded: [4, 0] });
  });
  it("3 players: a stopped bid gives each defender the opponents' points", () => {
    for (let seed = 1; seed < 400; seed++) {
      const g = new Game304(cfg({ numPlayers: 3 }), { rng: seededRng(seed) });
      const over = () => g.phase === 'roundOver' || (g.phase as string) === 'matchOver';
      while (!over()) g.apply(g.turn, botDecide(viewFor(g, g.turn))!);
      const r = g.lastResult!;
      if (r.success || r.kind !== 'normal') continue;
      const lose = bandOf(r.bidValue).lose;
      expect(r.awarded.filter((_, t) => t !== r.callerTeam)).toEqual([lose, lose]);
      return;
    }
    throw new Error('no stopped 3-player bid found');
  });
});

describe('CR v5: early stops (changes 1 and 4)', () => {
  // In the 8-player rig, trick 1 is worth 160 points and goes to Team A.
  it('bid reached: the bidder chooses; Stop ends the round, scored as a normal made bid (acceptance 4)', () => {
    const g = teamABids(160);
    while (g.phase === 'playing') playFirst(g);
    expect(g.phase).toBe('continueChoice');
    playOut(g);
    expect(g.completedTricks).toHaveLength(1);
    expect(g.lastResult).toMatchObject({ kind: 'normal', success: true, awarded: [1, 0], endedEarly: true, stopReason: 'bidReached', capturedPoints: [160, 0] });
  });
  it('stops as soon as the bid becomes impossible, scored as a normal stopped bid (acceptance 1)', () => {
    const g = teamBBids(200); // Team B can reach at most 304 − 160 = 144 after trick 1
    playOut(g);
    expect(g.completedTricks).toHaveLength(1);
    expect(g.lastResult).toMatchObject({ kind: 'normal', success: false, awarded: [4, 0], endedEarly: true, stopReason: 'bidImpossible' });
  });
  it('keeps playing while the bid is still open either way', () => {
    const g = teamABids(300); // 160 after trick 1: not yet reached, still possible
    playFirst(g);
    for (let i = 0; i < 7; i++) playFirst(g);
    expect(g.completedTricks).toHaveLength(1);
    expect(g.phase).toBe('playing');
  });
  it('with Coat active, neither early stop applies; only a lost trick ends the round (acceptance 5)', () => {
    const g = opensTrick(teamABids(160), 0);
    g.apply(0, { type: 'coat' });
    playOut(g);
    expect(g.completedTricks).toHaveLength(3); // bid reached after trick 1, yet play went on
    expect(g.lastResult).toMatchObject({ kind: 'coat', success: true, stopReason: null });
  });
  it('with Challenge Coat active, neither early stop applies', () => {
    const g = eight([[0, { type: 'challengeCoat' }]]);
    g.apply(0, { type: 'selectTrump', cardId: 'AS' });
    playOut(g);
    expect(g.completedTricks).toHaveLength(3);
    expect(g.lastResult).toMatchObject({ kind: 'challengeCoat', success: true, awarded: [6, 0], stopReason: null });
  });
  it('announces the stop and why', () => {
    const g = teamBBids(200);
    playOut(g);
    const e = g.drainEvents().find((x) => x.kind === 'roundOver')!;
    const said = describeEvent(e, ['A0', 'B1', 'A2', 'B3', 'A4', 'B5', 'A6', 'B7'], 0, viewFor(g, 0))!;
    expect(said.text).toMatch(/^Round stopped: Team B can no longer reach the bid of Jaan\./);
    expect(said.voice).toMatch(/^Round stopped/);
  });
});

describe('CR v5: score line after every trick (change 3)', () => {
  it('every trick result carries and announces the round score', () => {
    const g = teamABids(304);
    g.drainEvents();
    playOut(g);
    const tricks = g.drainEvents().filter((e) => e.kind === 'trickWon');
    expect(tricks).toHaveLength(3);
    const first = tricks[0] as Extract<(typeof tricks)[number], { kind: 'trickWon' }>;
    expect(first.captured).toEqual([160, 0]);
    const said = describeEvent(first, ['A0', 'B1', 'A2', 'B3', 'A4', 'B5', 'A6', 'B7'], 0, viewFor(g, 0))!;
    expect(said.text).toContain('Round score: Team A 160, Team B 0. Team A needs 304.');
    expect(said.voice).toContain('Round score: Team A 160, Team B 0.');
  });
});

describe('CR v5: trump is the whole suit (change 2)', () => {
  // dealer 0 → seat 1 bids first and leads. Seat 0 bids, hides QH; trump is Hearts.
  const HANDS = ['QH KH JS 9S AS 10S', 'JC 9C AC 10C KC QS', 'JH 9H AH 10H JD 9D', 'QC AD 10D KD QD KS'];
  it("Issue 8: while trump is hidden, a trump-suit card played off-suit has no power", () => {
    const g = new Game304(cfg(), { dealer: 0, rng: seededRng(2) });
    rig(g, HANDS);
    for (const s of [1, 2, 3]) g.apply(s, { type: 'pass' });
    g.apply(0, { type: 'bid', value: 160 });
    g.apply(0, { type: 'selectTrump', cardId: 'QH' });
    g.apply(1, { type: 'play', cardId: 'JC' });
    g.apply(2, { type: 'play', cardId: 'JH' }); // void in clubs, no ask: an ordinary card
    g.apply(3, { type: 'play', cardId: 'QC' });
    g.apply(0, { type: 'play', cardId: 'KH' }); // the bidder's heart has no power either
    expect(g.trumpRevealed).toBe(false);
    expect(g.completedTricks[0].winner).toBe(1); // Jack of Clubs, the highest card of the led suit
    // Still secret to the other side while hidden:
    expect(viewFor(g, 1).completedTricks[0].plays.every((p) => !p.asTrump)).toBe(true);
    expect(viewFor(g, 1).trumpSuit).toBeNull();
  });
  it('after trump is revealed, every trump-suit card is trump', () => {
    const g = new Game304(cfg(), { dealer: 0, rng: seededRng(2) });
    rig(g, HANDS);
    for (const s of [1, 2, 3]) g.apply(s, { type: 'pass' });
    g.apply(0, { type: 'bid', value: 300 });
    g.apply(0, { type: 'selectTrump', cardId: 'QH' });
    g.apply(1, { type: 'play', cardId: 'JC' });
    g.apply(2, { type: 'askTrump' });
    g.apply(2, { type: 'play', cardId: '10H' });
    g.apply(3, { type: 'play', cardId: 'QC' });
    g.apply(0, { type: 'play', cardId: 'KH' });
    expect(g.completedTricks[0].winner).toBe(2);
    expect(g.completedTricks[0].plays.filter((p) => p.asTrump).map((p) => p.card.id)).toEqual(['10H', 'KH']);
  });
});

describe('Issue 8: an unrevealed trump suit has no power', () => {
  /** Seat 0 bids and places `trumpCard`; seat 1 (right of the bidder) leads. */
  function deal(hands: string[], trumpCard: string, names: string[]) {
    const g = new Game304(cfg(), { dealer: 3, rng: seededRng(8) });
    rig(g, hands);
    g.apply(0, { type: 'bid', value: 160 });
    for (const s of [1, 2, 3]) g.apply(s, { type: 'pass' });
    g.apply(0, { type: 'selectTrump', cardId: trumpCard });
    g.drainEvents();
    const said = (seat: number, evs: ReturnType<Game304['drainEvents']>) =>
      eventsFor(evs, seat).map((e) => describeEvent(e, names, seat, viewFor(g, seat))?.text ?? '').join(' ');
    return { g, said };
  }
  // Ravi (seat 0) has no clubs; diamonds are trump.
  const RAVI = ['JD 9D AD JH 9H AH', 'JC KC 10C QS KS 10S', 'QC 9C AC JS 9S AS', '10D KD QD 10H KH QH'];
  const RN = ['Ravi', 'Meera', 'Kiran', 'Arjun'];

  it('1, 3, 8: hidden-trump diamonds played off-suit (bidder and non-bidder) cannot win; the highest club wins', () => {
    const { g, said } = deal(RAVI, 'AD', RN);
    g.apply(1, { type: 'play', cardId: 'JC' });
    g.apply(2, { type: 'play', cardId: 'QC' });
    g.apply(3, { type: 'play', cardId: '10D' }); // non-bidder, no clubs, does not ask
    g.apply(0, { type: 'play', cardId: '9D' }); // bidder, no clubs, does not reveal
    const evs = g.drainEvents();
    expect(g.trumpRevealed).toBe(false);
    const t = g.completedTricks[0];
    expect(t.winner).toBe(1);
    expect(t.plays.some((p) => p.asTrump)).toBe(false);
    // 8: announcement, running score and next leader follow the corrected winner.
    expect(evs.find((e) => e.kind === 'trickWon')).toMatchObject({ seat: 1, points: 62 });
    expect(said(2, evs)).toContain('Meera won');
    expect(g.turn).toBe(1);
    expect(g.currentTrick!.leader).toBe(1);
    expect(g.capturedByTeam()[g.team(1)]).toBe(62);
  });

  it('2: hearts hidden, diamonds led: Satya (bidder) plays a heart and does not win', () => {
    const SATYA = ['JH 9H AH JS 9S AS', 'JD KD 10D QS KS 10S', 'QD 9D AD JC 9C AC', '10H KH QH 10C KC QC'];
    const { g } = deal(SATYA, 'AH', ['Satya', 'B', 'C', 'D']);
    g.apply(1, { type: 'play', cardId: 'KD' });
    g.apply(2, { type: 'play', cardId: 'QD' });
    g.apply(3, { type: 'play', cardId: 'QH' });
    g.apply(0, { type: 'play', cardId: 'JH' }); // the Jack of the hidden trump suit: no power
    expect(g.completedTricks[0].winner).toBe(1); // King of Diamonds, the highest diamond
  });

  it('4: the bidder reveals first, then cuts and wins', () => {
    const { g } = deal(RAVI, 'AD', RN);
    g.apply(1, { type: 'play', cardId: 'JC' });
    g.apply(2, { type: 'play', cardId: 'QC' });
    g.apply(3, { type: 'play', cardId: '10H' });
    g.apply(0, { type: 'revealTrump' });
    g.apply(0, { type: 'play', cardId: 'AD' });
    expect(g.completedTricks[0].winner).toBe(0);
  });

  it('a trump-suit card played before the reveal keeps no power after a later reveal in the same trick', () => {
    const { g } = deal(RAVI, 'AD', RN);
    g.apply(1, { type: 'play', cardId: 'JC' });
    g.apply(2, { type: 'play', cardId: 'QC' });
    g.apply(3, { type: 'play', cardId: '10D' }); // hidden at this moment: ordinary
    g.apply(0, { type: 'revealTrump' });
    g.apply(0, { type: 'play', cardId: 'JH' }); // Ravi reveals but does not cut
    expect(g.completedTricks[0].winner).toBe(1);
  });

  it('5: a player holding the led suit must follow', () => {
    const { g } = deal(RAVI, 'AD', RN);
    g.apply(1, { type: 'play', cardId: 'JC' });
    expect(() => g.apply(2, { type: 'play', cardId: 'JS' })).toThrow(/follow/);
  });

  it('6: once trump has been revealed (by asking), cutting wins as before', () => {
    const { g } = deal(RAVI, 'AD', RN);
    g.apply(1, { type: 'play', cardId: 'JC' });
    g.apply(2, { type: 'play', cardId: 'QC' });
    g.apply(3, { type: 'askTrump' });
    g.apply(3, { type: 'play', cardId: '10D' });
    g.apply(0, { type: 'play', cardId: 'JH' });
    expect(g.completedTricks[0].winner).toBe(3); // the Ten of Diamonds cuts the clubs
    expect(g.completedTricks[0].plays.find((p) => p.seat === 3)!.asTrump).toBe(true);
  });

  it('6: trump revealed in an earlier trick: a later cut wins as before', () => {
    const H = ['JD 9D AD JH 9H AH', 'JC KC 10C 10D QS KS', 'QC 9C AC JS 9S AS', 'KD QD 10H KH QH 10S'];
    const { g } = deal(H, 'AD', RN);
    g.apply(1, { type: 'play', cardId: 'JC' });
    g.apply(2, { type: 'play', cardId: 'QC' });
    g.apply(3, { type: 'askTrump' });
    g.apply(3, { type: 'play', cardId: 'KD' });
    g.apply(0, { type: 'play', cardId: 'JH' });
    expect(g.completedTricks[0].winner).toBe(3);
    // Trick 2: hearts led; Meera has no hearts and cuts with the Ten of Diamonds.
    g.apply(3, { type: 'play', cardId: '10H' });
    g.apply(0, { type: 'play', cardId: '9H' });
    g.apply(1, { type: 'play', cardId: '10D' });
    g.apply(2, { type: 'play', cardId: 'JS' });
    expect(g.completedTricks[1].winner).toBe(1);
  });

  it("7: nobody else holds the led suit and trump is hidden: the leader's card wins", () => {
    const ALL_SPADES = ['JD 9D AD JH 9H AH', 'JS 9S AS 10S KS QS', '10H KH QH JC 9C AC', '10D KD QD 10C KC QC'];
    const { g } = deal(ALL_SPADES, 'AD', RN);
    g.apply(1, { type: 'play', cardId: 'QS' });
    g.apply(2, { type: 'play', cardId: 'JC' });
    g.apply(3, { type: 'play', cardId: '10D' });
    g.apply(0, { type: 'play', cardId: 'JD' });
    expect(g.trumpRevealed).toBe(false);
    expect(g.completedTricks[0].winner).toBe(1);
  });
});

describe('Coat (during play)', () => {
  it('Band 1 made: 1 + 2 = 3 (acceptance 14)', () => {
    const g = opensTrick(teamABids(170), 0);
    g.apply(0, { type: 'coat' });
    playOut(g);
    expect(g.lastResult).toMatchObject({ kind: 'coat', band: 1, success: true, awarded: [3, 0] });
  });
  it('Band 2 made: 2 + 3 = 5 (acceptance 14)', () => {
    const g = opensTrick(teamABids(220), 0);
    g.apply(0, { type: 'coat' });
    playOut(g);
    expect(g.lastResult).toMatchObject({ kind: 'coat', band: 2, success: true, awarded: [5, 0] });
  });
  it('Band 1 failed: round stops at once, opponents get 6 (acceptance 13)', () => {
    const g = opensTrick(teamBLeads(170), 1);
    g.apply(1, { type: 'coat' }); // Team B opens trick 1 and calls Coat
    playOut(g);
    expect(g.completedTricks).toHaveLength(1);
    expect(g.lastResult).toMatchObject({ kind: 'coat', band: 1, success: false, awarded: [6, 0], endedEarly: true, stopReason: 'coatFailed' });
  });
  it('Band 2 failed: opponents get 10 (acceptance 13)', () => {
    const g = opensTrick(teamBLeads(240), 1);
    g.apply(1, { type: 'coat' });
    playOut(g);
    expect(g.lastResult).toMatchObject({ kind: 'coat', band: 2, success: false, awarded: [10, 0], stopReason: 'coatFailed' });
  });
  it('is announced as accepted', () => {
    const g = opensTrick(teamABids(170), 0);
    g.drainEvents();
    g.apply(0, { type: 'coat' });
    const e = g.drainEvents().find((x) => x.kind === 'coat')!;
    expect(describeEvent(e, ['Priya', 'B1', 'A2', 'B3', 'A4', 'B5', 'A6', 'B7'], 1, viewFor(g, 1))!.text).toBe(
      'Coat accepted. Priya called Coat: Team A must win every remaining trick.',
    );
  });
  it('only the bidding side may call Coat (D1, unchanged), on its own turn, once', () => {
    const g = opensTrick(teamABids(170), 0);
    expect(() => g.apply(1, { type: 'coat' })).toThrow(/turn/);
    g.apply(0, { type: 'coat' });
    expect(() => g.apply(0, { type: 'coat' })).toThrow(/already/);
  });
  it('is refused once a card of the trick has been played (call it when opening the trick)', () => {
    const g = opensTrick(teamABids(300), 0);
    playFirst(g); // seat 0 (bidding side) leads
    // seat 1 is Team B; walk to seat 2 (Team A) mid-trick
    playFirst(g);
    expect(g.turn).toBe(2);
    expect(() => g.apply(2, { type: 'coat' })).toThrow('Coat refused: call it when your side opens a trick, before any card is played');
    expect(viewFor(g, 2).legal!.coat).toEqual({ show: true, allowed: false, reason: 'Coat refused: call it when your side opens a trick, before any card is played' });
  });
  it('is refused during bidding, before the round starts (acceptance 10)', () => {
    const g = eight([]);
    expect(() => g.apply(0, { type: 'coat' })).toThrow('Coat refused: it can only be called during play, when your side opens a trick');
  });
  it('is not available during a Challenge Coat', () => {
    const g = eight([[0, { type: 'challengeCoat' }]]);
    g.apply(0, { type: 'selectTrump', cardId: 'AS' });
    opensTrick(g, 0);
    expect(() => g.apply(0, { type: 'coat' })).toThrow(/Challenge Coat/);
  });
});

/**
 * Put a game in play at the start of trick `index`, led by `leader`, with `lost`
 * earlier tricks won by the other side (tests the Coat conditions directly).
 */
function atTrickStart(n: PlayerCount, index: number, lost: number) {
  const g = new Game304(cfg({ numPlayers: n }), { dealer: n - 1, rng: seededRng(7) });
  g.apply(0, { type: 'bid', value: 160 });
  for (let s = 1; s < n; s++) g.apply(s, { type: 'pass' });
  g.apply(0, { type: 'selectTrump', cardId: g.hands[0][0].id });
  const mine = g.team(0);
  const other = Array.from({ length: n }, (_, s) => s).find((s) => g.team(s) !== mine)!;
  g.completedTricks = Array.from({ length: index }, (_, i) => {
    const winner = i < lost ? other : 0;
    return { index: i, leader: 0, plays: [], winner, winnerTeam: g.team(winner), points: 0 };
  });
  g.currentTrick = { index, leader: 0, plays: [] };
  g.turn = 0;
  return g;
}

describe.each(PLAYER_COUNTS.map((n) => [n]))('CR v5 Coat conditions with %i players', (n) => {
  const N = RULES.cardsPerPlayer[n as PlayerCount];
  it(`accepted when opening the second-to-last trick (${N - 1}) with every earlier trick won (acceptance 8)`, () => {
    const g = atTrickStart(n as PlayerCount, N - 2, 0);
    expect(g.coatBlock(0)).toBeNull();
    g.apply(0, { type: 'coat' });
    expect(g.coat).toMatchObject({ calledAt: N - 2, fromTrick: N - 2 });
  });
  it('accepted in trick 1 and every earlier trick when the record is clean (acceptance 9)', () => {
    for (let i = 0; i < N - 1; i++) expect(atTrickStart(n as PlayerCount, i, 0).coatBlock(0)).toBeNull();
  });
  it(`refused in the last trick (${N}) (acceptance 7)`, () => {
    const g = atTrickStart(n as PlayerCount, N - 1, 0);
    expect(() => g.apply(0, { type: 'coat' })).toThrow('Coat refused: it cannot be called in the last trick');
  });
  if (N >= 3) {
    it('refused if the side lost any earlier trick this round (acceptance 6)', () => {
      const g = atTrickStart(n as PlayerCount, N - 2, 1);
      expect(() => g.apply(0, { type: 'coat' })).toThrow('Coat refused: your side has already lost a trick this round');
      expect(viewFor(g, 0).legal!.coat.reason).toBe('Coat refused: your side has already lost a trick this round');
    });
  }
});

describe('Challenge Coat (during bidding)', () => {
  it('ends bidding at once; made: +6 (acceptance 11, 16)', () => {
    const g = eight([[0, { type: 'challengeCoat' }]]);
    expect(g.phase).toBe('trumpSelect');
    expect(g.contract!.type).toBe('challengeCoat');
    g.apply(0, { type: 'selectTrump', cardId: 'AS' });
    playOut(g);
    expect(g.lastResult).toMatchObject({ kind: 'challengeCoat', success: true, awarded: [6, 0] });
  });
  it('a lost trick stops the round at once: opponents +12 (acceptance 15)', () => {
    const g = eight([...pass(0), [1, { type: 'challengeCoat' }]]);
    g.apply(1, { type: 'selectTrump', cardId: 'QS' });
    playOut(g);
    expect(g.completedTricks).toHaveLength(1);
    expect(g.lastResult).toMatchObject({ kind: 'challengeCoat', success: false, awarded: [12, 0], endedEarly: true, stopReason: 'challengeCoatFailed' });
    const e = g.drainEvents().find((x) => x.kind === 'roundOver')!;
    expect(describeEvent(e, ['A0', 'B1', 'A2', 'B3', 'A4', 'B5', 'A6', 'B7'], 0, viewFor(g, 0))!.text).toMatch(/^Challenge Coat failed: Team B lost a trick\. Round stopped\./);
  });
  it('replaces the bid scoring even after numeric bids', () => {
    const g = eight([bid(0, 250), [1, { type: 'challengeCoat' }]]);
    expect(g.contract).toMatchObject({ bidder: 1, type: 'challengeCoat', value: 250 });
  });
  it('is refused once play has started (acceptance 12)', () => {
    const g = eight([]);
    expect(() => g.apply(1, { type: 'challengeCoat' })).toThrow(/turn/);
    const h = teamABids(300);
    expect(() => h.apply(0, { type: 'challengeCoat' })).toThrow('Challenge Coat refused: it can only be called during bidding, before play starts');
    playFirst(h);
    expect(() => h.apply(1, { type: 'challengeCoat' })).toThrow(/Challenge Coat refused/);
  });
});

describe('Issue 6: trump indicator card', () => {
  // dealer 0 → seat 1 bids first and leads. Seat 0 (Priya) wins the bid and points at the Queen of Hearts.
  const NAMES = ['Priya', 'Arjun', 'Meera', 'Kiran'];
  const HANDS = ['QH KH JS 9S AS 10S', 'JC 9C AC 10C KC QS', 'JH 9H AH 10H JD 9D', 'QC AD 10D KD QD KS'];
  function setup(lead = 'JC') {
    const g = new Game304(cfg(), { dealer: 0, rng: seededRng(2) });
    rig(g, HANDS);
    for (const s of [1, 2, 3]) g.apply(s, { type: 'pass' });
    g.apply(0, { type: 'bid', value: 300 });
    g.drainEvents();
    g.apply(0, { type: 'selectTrump', cardId: 'QH' });
    g.apply(1, { type: 'play', cardId: lead });
    return g;
  }
  const said = (g: Game304, seat: number, events = g.drainEvents()) =>
    eventsFor(events, seat).map((e) => describeEvent(e, NAMES, seat, viewFor(g, seat))?.text ?? '').join(' ');

  it('1: the indicator card stays in the hand and the hand count is unchanged', () => {
    const g = new Game304(cfg(), { dealer: 0, rng: seededRng(2) });
    rig(g, HANDS);
    for (const s of [1, 2, 3]) g.apply(s, { type: 'pass' });
    g.apply(0, { type: 'bid', value: 300 });
    g.apply(0, { type: 'selectTrump', cardId: 'QH' });
    expect(g.hands[0]).toHaveLength(6);
    expect(g.hands[0].map((c) => c.id)).toContain('QH');
    expect(viewFor(g, 1).handCounts[0]).toBe(6);
    expect(viewFor(g, 0).myHand.map((c) => c.id)).toContain('QH');
    expect(viewFor(g, 0).myTrumpIndicator?.id).toBe('QH');
    expect(viewFor(g, 0).trumpSuit).toBe('H');
  });

  it('2: the bidder can play the indicator card like any other card', () => {
    const g = setup('JC');
    g.apply(2, { type: 'play', cardId: 'JD' });
    g.apply(3, { type: 'play', cardId: 'QC' });
    expect(g.legalCards(0).map((c) => c.id)).toContain('QH'); // void in clubs: any card
    g.apply(0, { type: 'play', cardId: 'QH' });
    expect(g.completedTricks[0].plays.find((p) => p.seat === 0)!.card.id).toBe('QH');
    expect(g.hands[0].map((c) => c.id)).not.toContain('QH');
  });

  it('3: before the reveal no other device learns the trump suit (views, events, speech)', () => {
    const g = new Game304(cfg(), { dealer: 0, rng: seededRng(2) });
    rig(g, HANDS);
    for (const s of [1, 2, 3]) g.apply(s, { type: 'pass' });
    g.apply(0, { type: 'bid', value: 300 });
    g.drainEvents();
    g.apply(0, { type: 'selectTrump', cardId: 'QH' });
    const evs = g.drainEvents();
    for (const s of [1, 2, 3]) {
      const v = viewFor(g, s);
      expect(v.trumpSuit).toBeNull();
      expect(v.myTrumpIndicator).toBeNull();
      const json = JSON.stringify({ v, e: eventsFor(evs, s) });
      expect(json).not.toMatch(/"trumpSuit":"H"|yourTrump|myTrumpIndicator":{/);
      expect(said(g, s, evs)).not.toMatch(/Hearts/);
      expect(said(g, s, evs)).toMatch(/Priya has placed the trump card\./);
      expect(scoreStatus(v, NAMES)).not.toMatch(/Hearts/);
    }
    expect(viewFor(g, null).trumpSuit).toBeNull(); // spectators too
    // The bidder alone is told privately.
    expect(said(g, 0, evs)).toMatch(/You placed the Queen of Hearts as your trump card\. Trump is Hearts\. Only you know it\. You can still play this card\./);
  });

  it('4: a player with no card of the led suit asks, and trump is announced to all', () => {
    const g = setup('JC');
    g.drainEvents();
    expect(viewFor(g, 2).legal!.canAskTrump).toBe(true);
    g.apply(2, { type: 'askTrump' });
    expect(g.trumpRevealed).toBe(true);
    const evs = g.drainEvents();
    for (const s of [0, 1, 2, 3]) expect(viewFor(g, s).trumpSuit).toBe('H');
    expect(said(g, 1, evs)).toContain('Meera asked for trump. Trump is Hearts.');
    expect(said(g, 0, evs)).toContain('Meera asked for trump. Trump is Hearts.');
  });

  it('5: after the reveal the trump-suit rules apply (the asker cuts with trump, highest trump wins)', () => {
    const g = setup('JC');
    g.apply(2, { type: 'askTrump' });
    expect(g.legalCards(2).every((c) => c.suit === 'H')).toBe(true);
    g.apply(2, { type: 'play', cardId: '10H' });
    g.apply(3, { type: 'play', cardId: 'QC' });
    g.apply(0, { type: 'play', cardId: 'KH' });
    expect(g.completedTricks[0].winner).toBe(2); // Ten of Hearts beats King of Hearts and the led Jack of Clubs
  });

  it('6: the bidder may reveal at a time of their choosing, even while able to follow suit', () => {
    const g = setup('QS'); // spades led; the bidder holds spades and is not forced to do anything
    g.apply(2, { type: 'play', cardId: 'JD' });
    g.apply(3, { type: 'play', cardId: 'KS' });
    g.drainEvents();
    expect(viewFor(g, 0).legal!.canRevealTrump).toBe(true);
    expect(g.trumpRevealed).toBe(false);
    g.apply(0, { type: 'revealTrump' });
    const evs = g.drainEvents();
    expect(said(g, 3, evs)).toContain('Priya revealed trump. Trump is Hearts.');
    expect(viewFor(g, 1).trumpSuit).toBe('H');
    expect(viewFor(g, 0).legal!.canRevealTrump).toBe(false); // once is enough
    g.apply(0, { type: 'play', cardId: 'JS' }); // still must follow spades
    expect(g.completedTricks[0].winner).toBe(0);
  });

  it('only the bidder may reveal; others can only ask when void', () => {
    const g = setup('JC');
    expect(() => g.apply(2, { type: 'revealTrump' })).toThrow(/Only the bidder/);
  });

  it('7: if nobody asks and the bidder never reveals, trump stays hidden, then shows in the round summary', () => {
    const g = new Game304(cfg({ numPlayers: 8 }), { dealer: 7, rng: seededRng(1) });
    rig(g, EIGHT);
    g.apply(0, { type: 'bid', value: 304 });
    for (let s = 1; s < 8; s++) g.apply(s, { type: 'pass' });
    g.apply(0, { type: 'selectTrump', cardId: 'AS' });
    playOut(g);
    expect(g.trumpRevealed).toBe(false);
    expect(viewFor(g, 3).trumpSuit).toBe('S'); // round over: shown in the summary
    expect(g.lastResult!.trumpSuit).toBe('S');
  });

  it('8: no card is ever removed or held face down', () => {
    for (const n of PLAYER_COUNTS) {
      const g = new Game304(cfg({ numPlayers: n }), { rng: seededRng(n) });
      const before = g.hands.flat().length;
      while (g.phase === 'bidding') g.apply(g.turn, botDecide(viewFor(g, g.turn))!);
      g.apply(g.turn, botDecide(viewFor(g, g.turn))!); // choose trump
      expect(g.hands.flat().length).toBe(before);
      expect('hiddenTrump' in g).toBe(false);
    }
  });
});

describe('Issue 7: right of the bidder leads; hidden trump card known only to the bidder', () => {
  const NAMES = ['Priya', 'Arjun', 'Meera', 'Kiran'];
  const HANDS = ['QH KH JS 9S AS 10S', 'JC 9C AC 10C KC QS', 'JH 9H AH 10H JD 9D', 'QC AD 10D KD QD KS'];
  const said = (g: Game304, seat: number, events: ReturnType<Game304['drainEvents']>) =>
    eventsFor(events, seat).map((e) => describeEvent(e, NAMES, seat, viewFor(g, seat))?.text ?? '').join(' ');
  /** Dealer 2: bidding starts at seat 3, so the old "left of the dealer" rule would have made seat 3 lead. */
  function setup() {
    const g = new Game304(cfg(), { dealer: 2, rng: seededRng(3) });
    rig(g, HANDS);
    g.apply(3, { type: 'pass' });
    g.apply(0, { type: 'bid', value: 160 });
    g.apply(1, { type: 'pass' });
    g.apply(2, { type: 'pass' });
    g.drainEvents();
    g.apply(0, { type: 'selectTrump', cardId: 'QH' });
    return g;
  }

  it('1: the player to the right of the bidder leads trick 1, and it is announced to everyone', () => {
    const g = setup();
    const evs = g.drainEvents();
    expect(g.turn).toBe(1);
    expect(g.currentTrick!.leader).toBe(1);
    expect(said(g, 2, evs)).toContain('Priya has placed the trump card.');
    expect(said(g, 2, evs)).toContain('Priya is the bidder. Arjun leads the first trick.');
    expect(said(g, 1, evs)).toContain('Priya is the bidder. You lead the first trick.');
    expect(said(g, 0, evs)).toContain('You are the bidder. Arjun leads the first trick.');
  });

  it('1: in every mode and every round the bidder never leads trick 1; from trick 2 the winner leads', () => {
    for (const n of PLAYER_COUNTS) {
      const g = new Game304(cfg({ numPlayers: n, matchTarget: 30 }), { rng: seededRng(40 + n) });
      let rounds = 0;
      while (g.phase !== 'matchOver' && rounds < 12) {
        if (g.phase === 'roundOver') {
          rounds++;
          g.nextRound();
          continue;
        }
        const wasTrumpSelect = g.phase === 'trumpSelect';
        const before = g.completedTricks.length;
        g.apply(g.turn, botDecide(viewFor(g, g.turn))!);
        if (wasTrumpSelect) {
          const bidder = g.contract!.bidder;
          expect(g.currentTrick!.leader).toBe((bidder + 1) % n);
          expect(g.turn).not.toBe(bidder);
        }
        if (g.phase === 'playing' && g.completedTricks.length > before && g.currentTrick)
          expect(g.currentTrick.leader).toBe(g.completedTricks[g.completedTricks.length - 1].winner);
      }
      expect(rounds).toBeGreaterThan(0);
    }
  });

  it('2/3/4: playing the placed card does not reveal or announce trump, and nothing leaks', () => {
    const g = setup();
    g.apply(1, { type: 'play', cardId: 'JC' });
    g.apply(2, { type: 'play', cardId: 'JD' });
    g.apply(3, { type: 'play', cardId: 'QC' });
    g.drainEvents();
    expect(viewFor(g, 0).myHand.find((c) => c.id === 'QH')).toBeTruthy();
    g.apply(0, { type: 'play', cardId: 'QH' }); // void in clubs; the bidder plays the placed card without revealing
    const evs = g.drainEvents();
    expect(g.trumpRevealed).toBe(false);
    expect(evs.some((e) => e.kind === 'trumpRevealed')).toBe(false);
    for (const s of [1, 2, 3]) {
      const v = viewFor(g, s);
      expect(v.trumpSuit).toBeNull();
      expect(v.myTrumpIndicator).toBeNull();
      const json = JSON.stringify({ v: { ...v, myHand: [] }, e: eventsFor(evs, s) });
      expect(json).not.toMatch(/"trumpSuit":"H"|yourTrump|youPlayedTrumpCard|"asTrump":true/);
      const text = said(g, s, evs);
      expect(text).toContain('Priya played Queen of Hearts');
      expect(text).not.toMatch(/trump/i);
    }
    // Only the bidder is reminded privately.
    expect(said(g, 0, evs)).toContain('You played your trump card. Trump stays hidden unless you reveal it.');
    expect(viewFor(g, 0).myTrumpIndicator).toBeNull(); // played: no longer marked
  });

  it('5: the bidder may reveal, or keep it hidden; D2: the unplayed card stays marked for the bidder after a reveal', () => {
    const g = setup();
    g.apply(1, { type: 'play', cardId: 'QS' });
    g.apply(2, { type: 'play', cardId: 'JD' });
    g.apply(3, { type: 'play', cardId: 'KS' });
    expect(viewFor(g, 0).legal!.canRevealTrump).toBe(true);
    g.apply(0, { type: 'play', cardId: 'JS' }); // chose not to reveal
    expect(g.trumpRevealed).toBe(false);
    // Bidder won with the Jack of Spades and leads trick 2: reveal now, by choice.
    expect(g.turn).toBe(0);
    g.apply(0, { type: 'revealTrump' });
    expect(viewFor(g, 2).trumpSuit).toBe('H');
    expect(viewFor(g, 0).myTrumpIndicator?.id).toBe('QH');
    expect(viewFor(g, 2).myTrumpIndicator).toBeNull();
  });

  it('6: only a player with no card of the led suit may ask', () => {
    const g = setup();
    g.apply(1, { type: 'play', cardId: 'QS' }); // spades led
    expect(viewFor(g, 2).legal!.canAskTrump).toBe(true); // Meera has no spades
    g.apply(2, { type: 'play', cardId: 'JD' }); // void, chose not to ask: any card is fine
    expect(viewFor(g, 3).legal!.canAskTrump).toBe(false); // Kiran holds the King of Spades
    expect(() => g.apply(3, { type: 'askTrump' })).toThrow();
    expect(g.trumpRevealed).toBe(false);
  });

  it('7: only the suit of the placed card becomes trump', () => {
    const g = setup();
    expect(g.trumpSuit).toBe('H');
    g.apply(1, { type: 'play', cardId: 'JC' });
    g.apply(2, { type: 'askTrump' });
    g.apply(2, { type: 'play', cardId: '9H' });
    g.apply(3, { type: 'play', cardId: 'QC' });
    g.apply(0, { type: 'play', cardId: 'JS' });
    expect(g.completedTricks[0].winner).toBe(2); // a heart, not the Queen of Hearts herself, wins
  });
});

// ------------------------------------------------------------------ all modes with bots

function randomLegal(v: PlayerView, rng: () => number): Action | null {
  const L = v.legal!;
  const pick = <T>(xs: T[]) => xs[Math.floor(rng() * xs.length)];
  if (v.phase === 'bidding') {
    const opts: Action[] = [{ type: 'pass' }];
    if (L.bidOptions.length) opts.push({ type: 'bid', value: pick(L.bidOptions.slice(0, 4)) });
    if (L.bidOptions.includes(304) && rng() < 0.2) opts.push({ type: 'bid', value: 304 });
    if (L.canChallengeCoat && rng() < 0.04) opts.push({ type: 'challengeCoat' });
    if (L.canSelfCoat && rng() < 0.04) opts.push({ type: 'selfCoat' });
    return pick(opts);
  }
  if (v.phase === 'trumpSelect') return { type: 'selectTrump', cardId: pick(v.myHand).id };
  if (v.phase === 'continueChoice') return rng() < 0.5 ? { type: 'continueRound' } : { type: 'stopRound' };
  if (v.phase === 'playing') {
    if (L.canAskTrump && rng() < 0.4) return { type: 'askTrump' };
    if (L.canRevealTrump && rng() < 0.2) return { type: 'revealTrump' };
    if (L.coat.allowed && rng() < 0.08) return { type: 'coat' };
    return { type: 'play', cardId: pick(L.playable) };
  }
  return null;
}

function assertPrivate(g: Game304) {
  for (let s = -1; s < g.n; s++) {
    const seat = s < 0 ? null : s;
    const v = viewFor(g, seat);
    const json = JSON.stringify(v);
    for (let o = 0; o < g.n; o++) {
      if (o === seat) continue;
      for (const c of g.hands[o]) expect(json).not.toContain(`"id":"${c.id}"`);
    }
    // Issue 6: no other device ever learns which card the bidder used to choose trump.
    if (g.trumpIndicator && g.contract?.bidder !== seat && !g.trumpRevealed) expect(json).not.toContain('myTrumpIndicator":{');
    const live = g.phase === 'playing' || g.phase === 'trumpSelect';
    if (live && !g.trumpRevealed && g.contract?.bidder !== seat) {
      expect(v.trumpSuit).toBeNull();
      const plays = [...(v.currentTrick?.plays ?? []), ...v.completedTricks.flatMap((t) => t.plays)];
      expect(plays.some((p) => p.asTrump)).toBe(false);
    }
  }
}

function checkRound(g: Game304, before: number[]) {
  const r = g.lastResult!;
  const cap = new Array(g.teamCount).fill(0);
  for (const t of g.completedTricks) cap[t.winnerTeam] += t.points;
  expect(r.capturedPoints).toEqual(cap);
  if (!r.endedEarly) {
    expect(g.completedTricks).toHaveLength(g.cardsEach);
    // In Self Coat the caller's teammates keep their cards, so not every point is played.
    if (r.kind !== 'selfCoat') expect(cap.reduce((a, b) => a + b, 0)).toBe(g.pointsInPlay);
  }
  // CR v5: why a round stops early is consistent with the result.
  if (r.stopReason === 'bidReached') expect(r.success && r.kind === 'normal').toBe(true);
  if (r.stopReason === 'bidImpossible') expect(!r.success && r.kind === 'normal').toBe(true);
  if (r.stopReason === 'coatFailed') expect(!r.success && r.kind === 'coat').toBe(true);
  if (r.stopReason === 'challengeCoatFailed') expect(!r.success && r.kind === 'challengeCoat').toBe(true);
  if (r.stopReason === 'selfCoatFailed') expect(!r.success && r.kind === 'selfCoat').toBe(true);
  if (r.kind === 'normal' && r.stopReason === null) {
    // No early stop means the bid stayed open until the very last trick.
    expect(g.completedTricks).toHaveLength(g.cardsEach);
  }
  const band = bandOf(r.bidValue).id;
  let win: number, lose: number, success: boolean;
  if (r.kind === 'selfCoat') {
    [win, lose] = [10, 20];
    success = !r.endedEarly && g.completedTricks.every((t) => t.winnerTeam === r.callerTeam);
    // The caller's teammates never played a card.
    for (const t of g.completedTricks) for (const p of t.plays) expect(p.seat === r.bidder || g.team(p.seat) !== r.callerTeam).toBe(true);
  } else if (r.kind === 'challengeCoat') {
    [win, lose] = [6, 12];
    success = !r.endedEarly && g.completedTricks.every((t) => t.winnerTeam === r.callerTeam);
  } else if (r.kind === 'coat') {
    [win, lose] = band === 1 ? [3, 6] : [5, 10];
    success = !r.endedEarly && g.completedTricks.filter((t) => t.index >= g.coat!.fromTrick).every((t) => t.winnerTeam === r.callerTeam);
  } else {
    [win, lose] = band === 1 ? [1, 2] : [2, 4];
    success = cap[r.callerTeam] >= r.bidValue;
  }
  expect(r.success).toBe(success);
  for (let t = 0; t < g.teamCount; t++) {
    const expected = success ? (t === r.callerTeam ? win : 0) : t === r.callerTeam ? 0 : lose;
    expect(g.scores[t] - before[t]).toBe(expected);
  }
}

describe('full matches with bots in every mode', () => {
  const modes: Partial<GameConfig>[] = [];
  for (const numPlayers of PLAYER_COUNTS) {
    modes.push({ numPlayers });
    modes.push({ numPlayers, matchTarget: 30 });
  }
  modes.push({ numPlayers: 4, fourCardMode: true });

  it.each(modes.map((m) => [JSON.stringify(m), m]))('%s', (_l, mode) => {
    const m = mode as Partial<GameConfig>;
    const names = Array.from({ length: m.numPlayers! }, (_, i) => `P${i}`);
    for (let seed = 1; seed <= 4; seed++) {
      const g = new Game304(cfg(m), { rng: seededRng(seed * 31), dealer: seed % m.numPlayers! });
      const rng = seededRng(seed);
      let before = [...g.scores];
      let guard = 0;
      while (g.phase !== 'matchOver') {
        if (++guard > 20000) throw new Error('runaway');
        if (g.phase === 'roundOver') {
          g.nextRound();
          continue;
        }
        const v = viewFor(g, g.turn);
        const a = rng() < 0.35 ? randomLegal(v, rng) ?? botDecide(v)! : botDecide(v)!;
        g.apply(g.turn, a);
        assertPrivate(g);
        const evs = g.drainEvents();
        for (let s = 0; s < g.n; s++) {
          const vs = viewFor(g, s);
          for (const e of eventsFor(evs, s)) describeEvent(e, names, s, vs, guard);
          tableStatus(vs, names);
          scoreStatus(vs, names);
          basketSummary(vs, names);
        }
        if ((g.phase as string) === 'roundOver' || (g.phase as string) === 'matchOver') {
          checkRound(g, before);
          before = [...g.scores];
        }
      }
      expect(g.matchWinners!.length).toBeGreaterThan(0);
    }
  }, 120_000);
});

describe('turn-by-turn instructions', () => {
  const NAMES = ['Priya', 'Arjun', 'Meera', 'Kiran'];
  const HANDS = ['QH KH JS 9S AS 10S', 'JC 9C AC 10C KC QS', 'JH 9H AH 10H JD 9D', 'QC AD 10D KD QD KS'];
  function setup() {
    const g = new Game304(cfg(), { dealer: 0, rng: seededRng(2) });
    rig(g, HANDS);
    return g;
  }
  it('bidding, trump choice, leading', () => {
    const g = setup();
    expect(guidance(viewFor(g, 1), NAMES)).toBe('Bid 160 or higher, or pass. You can also call Challenge Coat or Self Coat.');
    expect(guidance(viewFor(g, 2), NAMES)).toBe('Waiting for Arjun.');
    for (const s of [1, 2, 3]) g.apply(s, { type: 'pass' });
    g.apply(0, { type: 'bid', value: 300 });
    expect(guidance(viewFor(g, 0), NAMES)).toMatch(/^Pick one card/);
    g.apply(0, { type: 'selectTrump', cardId: 'QH' });
    expect(guidance(viewFor(g, 1), NAMES)).toBe('You lead this trick. Play any card from your hand.');
  });
  it('follow suit, no card of the led suit, must trump after asking, bidder reveal', () => {
    const g = setup();
    for (const s of [1, 2, 3]) g.apply(s, { type: 'pass' });
    g.apply(0, { type: 'bid', value: 160 });
    g.apply(0, { type: 'selectTrump', cardId: 'QH' });
    g.apply(1, { type: 'play', cardId: 'JC' });
    expect(guidance(viewFor(g, 2), NAMES)).toBe('You have no Clubs. Play any card, or ask for trump.');
    g.apply(2, { type: 'askTrump' });
    expect(guidance(viewFor(g, 2), NAMES)).toBe('You asked for trump, so play a trump card now.');
    g.apply(2, { type: 'play', cardId: 'JH' });
    expect(guidance(viewFor(g, 3), NAMES)).toBe('Follow Clubs. You have 1 card in Clubs; play one of them.');
    const h = setup();
    for (const s of [1, 2, 3]) h.apply(s, { type: 'pass' });
    h.apply(0, { type: 'bid', value: 160 });
    h.apply(0, { type: 'selectTrump', cardId: 'QH' });
    for (const id of ['JC', 'JD', 'QC']) h.apply(h.turn, { type: 'play', cardId: id });
    expect(guidance(viewFor(h, 0), NAMES)).toMatch(/^You have no Clubs\. Play any card, or reveal trump\./);
  });
  it('spectators and round over', () => {
    const g = teamABids(160);
    expect(guidance(viewFor(g, null), [])).toBe('You are watching this game.');
    playOut(g);
    expect(guidance(viewFor(g, 3), [])).toMatch(/^Round over/);
  });
});

describe('spoken wording', () => {
  it('every voice variant is grammatical for "You" and for other players', () => {
    const g = teamABids(160);
    const v = viewFor(g, 0);
    const card = cardFromId('JH');
    const events = [
      { kind: 'roundStart', round: 1, dealer: 0, firstBidder: 1, cardsEach: 3 },
      { kind: 'bid', seat: 0, action: { type: 'bid', value: 210 } },
      { kind: 'bid', seat: 0, action: { type: 'pass' } },
      { kind: 'bid', seat: 0, action: { type: 'challengeCoat' } },
      { kind: 'cardPlayed', seat: 0, card, asTrump: false, trickIndex: 0 },
      { kind: 'cardPlayed', seat: 0, card, asTrump: true, trickIndex: 0 },
      { kind: 'trickWon', seat: 0, team: 0, points: 40, trickIndex: 0, captured: [40, 0], bid: 170, bidderTeam: 0 },
      { kind: 'coat', seat: 0, team: 0, trickIndex: 0 },
    ] as const;
    for (const me of [0, 1]) {
      for (const e of events) for (let seed = 0; seed < 6; seed++) {
        const s = describeEvent(e as never, ['Priya', 'Arjun'], me, v, seed)!;
        expect(s.voice).not.toMatch(/You (deals|plays|says|passes|takes|hides|trumps)/);
        expect(s.voice).not.toMatch(/from You/);
        if (me === 1) expect(s.voice).not.toMatch(/Priya (deal|play|say|pass|take|hide|trump)/);
      }
    }
  });
});

// ------------------------------------------------------------------ Issue 10: built-in voice clips

describe('built-in voice: every announcement can be said with recorded clips', () => {
  const book = JSON.parse(readFileSync(new URL('../../../apps/web/public/voice/en/phrases.json', import.meta.url), 'utf8')) as PhraseBook;
  const index = new Map(book.phrases.map((p) => [p.id, p]));
  const say = (s: VoiceScript | null | undefined, what: string) => {
    if (!s) return;
    const clips = scriptClips(book, s, index);
    if (!clips) throw new Error(`no clips for ${what}: ${JSON.stringify(s)}`);
    expect(clips.length).toBeGreaterThan(0);
  };

  it('clip ids are stable, short and distinct', () => {
    expect(clipId('excited', 'Trick 304!')).toBe(clipId('excited', 'Trick 304!'));
    expect(clipId('excited', 'Trick 304!')).not.toBe(clipId('cheerful', 'Trick 304!'));
    const all = allClips(book);
    expect(new Set(all.map((c) => c.id)).size).toBe(all.length);
    expect(all.length).toBeGreaterThan(500);
  });

  it('"You" wording and seat / bot / team names', () => {
    const names = ['Priya', 'Bot Asha', 'Arjun', 'Bot (Kiran)'];
    expect(whoKey(0, 0, names)).toBe('you');
    expect(whoKey(1, 0, names)).toBe('bot-asha');
    expect(whoKey(2, 0, names)).toBe('s3');
    expect(whoKey(3, 0, names)).toBe('s4'); // a person's seat taken over by a bot keeps the seat number
    const text = (s: VoiceScript) => scriptClips(book, s)!.map((c) => c.text).join(' ');
    expect(text([{ t: 'bid', v: { who: 'you', bid: '200' } }])).toBe('You bid Jaan!');
    expect(text([{ t: 'bid', v: { who: 's3', bid: '210' } }])).toBe('Seat 3 bids Jaan 10!');
    expect(text([{ t: 'plays', v: { who: 'bot-asha', card: 'JS' } }])).toBe('Bot Asha plays the Jack of Spades.');
    expect(scriptClips(book, [{ t: 'bid', v: { who: 'nobody', bid: '200' } }])).toBeNull();
  });

  for (const numPlayers of PLAYER_COUNTS) {
    it(`${numPlayers} players: events, instructions and results`, () => {
      const names = Array.from({ length: numPlayers }, (_, i) => (i % 2 ? `Bot ${['Asha', 'Ravi', 'Meera', 'Kiran'][i % 4]}` : `P${i}`));
      for (let seed = 1; seed <= 3; seed++) {
        const g = new Game304(cfg({ numPlayers, matchTarget: 12 }), { rng: seededRng(seed * 7), dealer: seed % numPlayers });
        const rng = seededRng(seed + 100);
        let guard = 0;
        while (g.phase !== 'matchOver') {
          if (++guard > 20000) throw new Error('runaway');
          if (g.phase === 'roundOver') {
            g.nextRound();
            continue;
          }
          const v = viewFor(g, g.turn);
          g.apply(g.turn, rng() < 0.35 ? randomLegal(v, rng) ?? botDecide(v)! : botDecide(v)!);
          const evs = g.drainEvents();
          for (let s = 0; s < g.n; s++) {
            const vs = viewFor(g, s);
            for (const e of eventsFor(evs, s)) {
              const spoken = describeEvent(e, names, s, vs, guard);
              if (spoken) say(spoken.clips, e.kind);
            }
            say(voiceGuidance(vs, names, { isHost: s === 0 }), 'guidance');
            say(voiceGuidance(vs, names, { ready: true }), 'guidance');
          }
        }
      }
    }, 120_000);
  }
});

// ------------------------------------------------------------------ Final update: Self Coat, 12 players, Continue choice

describe('Self Coat', () => {
  // 4 players, dealer 0: seat 1 bids first. Seat 1 (Team B) calls Self Coat; seat 3 is the teammate who sits out.
  const ALL_WIN = ['AS 10S KS QS AH 10H', 'JS 9S JH 9H JC JD', 'KH QH 9C AC 10C KC', 'QC 9D AD 10D KD QD'];
  const LOSES_FIRST = ['QH KH JS 9S AS 10S', 'JC 9C AC 10C KC QS', 'JH 9H AH 10H JD 9D', 'QC AD 10D KD QD KS'];
  const selfCoat = (hands: string[]) => {
    const g = new Game304(cfg(), { dealer: 0, rng: seededRng(2) });
    rig(g, hands);
    g.apply(1, { type: 'selfCoat' });
    return g;
  };

  it('is a bidding call: ends the bidding, the caller leads trick 1, no trump card and no trump', () => {
    const g = new Game304(cfg(), { dealer: 0, rng: seededRng(2) });
    rig(g, LOSES_FIRST);
    expect(viewFor(g, 1).legal!.canSelfCoat).toBe(true);
    expect(viewFor(g, 2).legal!.canSelfCoat).toBe(false); // not their turn
    g.apply(1, { type: 'selfCoat' });
    expect(g.phase).toBe('playing'); // no trump selection
    expect(g.contract).toMatchObject({ type: 'selfCoat', bidder: 1 });
    expect(g.trumpSuit).toBeNull();
    expect(g.turn).toBe(1);
    expect(g.currentTrick!.leader).toBe(1);
    // Only once per hand, and only during bidding.
    expect(() => g.apply(1, { type: 'selfCoat' })).toThrow(/during bidding/);
    for (let s = 0; s < 4; s++) expect(viewFor(g, s).legal!.canSelfCoat).toBe(false);
  });

  it('teammates sit out: never get a turn, their cards stay in hand', () => {
    const g = selfCoat(ALL_WIN);
    const turns = new Set<number>();
    while (g.phase === 'playing') {
      turns.add(g.turn);
      expect(viewFor(g, g.turn).legal!.canAskTrump).toBe(false);
      expect(viewFor(g, g.turn).legal!.canRevealTrump).toBe(false);
      expect(viewFor(g, g.turn).legal!.coat.show).toBe(false);
      playFirst(g);
    }
    expect([...turns].sort()).toEqual([0, 1, 2]);
    expect(g.hands[3]).toHaveLength(6);
    expect(viewFor(g, 3).sittingOut).toEqual([false, false, false, true]);
    for (const t of g.completedTricks) expect(t.plays.map((p) => p.seat)).not.toContain(3);
  });

  it('caller wins every trick: +10 to the caller side', () => {
    const g = selfCoat(ALL_WIN);
    playOut(g);
    expect(g.completedTricks).toHaveLength(6);
    expect(g.lastResult).toMatchObject({ kind: 'selfCoat', success: true, awarded: [0, 10], stopReason: null });
    expect(g.scores).toEqual([0, 10]);
  });

  it('caller loses a trick: the round stops at once, opponents +20, caller side loses nothing', () => {
    const g = selfCoat(LOSES_FIRST);
    g.apply(1, { type: 'play', cardId: 'QS' }); // Seat 0 holds the Jack of Spades
    g.apply(2, { type: 'play', cardId: g.legalCards(2)[0].id });
    g.apply(0, { type: 'play', cardId: 'JS' });
    expect(g.completedTricks).toHaveLength(1);
    expect(g.lastResult).toMatchObject({ kind: 'selfCoat', success: false, awarded: [20, 0], endedEarly: true, stopReason: 'selfCoatFailed' });
    expect(g.scores).toEqual([20, 0]);
  });

  it('the highest card of the led suit wins (no trump)', () => {
    const g = selfCoat(LOSES_FIRST);
    g.apply(1, { type: 'play', cardId: 'JC' });
    g.apply(2, { type: 'play', cardId: 'JD' }); // void in Clubs: a Jack of another suit does not win
    g.apply(0, { type: 'play', cardId: 'JS' });
    expect(g.completedTricks[0].winner).toBe(1);
  });

  it('Challenge Coat is unchanged: +6 / opponents +12', () => {
    expect(RULES.challengeCoat).toEqual({ win: 6, lose: 12 });
    expect(RULES.selfCoat).toEqual({ win: 10, lose: 20 });
  });

  it.each(PLAYER_COUNTS.map((n) => [n]))('works with %i players', (n) => {
    for (let seed = 1; seed <= 6; seed++) {
      const g = new Game304(cfg({ numPlayers: n as PlayerCount }), { rng: seededRng(seed), dealer: 0 });
      const caller = g.turn;
      g.apply(caller, { type: 'selfCoat' });
      const teammates = Array.from({ length: n }, (_, s) => s).filter((s) => s !== caller && g.team(s) === g.team(caller));
      if (n === 2 || n === 3) expect(teammates).toEqual([]);
      expect(g.activePlayers()).toBe(n - teammates.length);
      while (g.phase === 'playing') {
        expect(teammates).not.toContain(g.turn);
        g.apply(g.turn, botDecide(viewFor(g, g.turn))!);
      }
      for (const s of teammates) expect(g.hands[s]).toHaveLength(g.cardsEach);
      const r = g.lastResult!;
      expect(r.kind).toBe('selfCoat');
      const others = r.awarded.filter((_, t) => t !== r.callerTeam);
      if (r.success) expect(r.awarded[r.callerTeam]).toBe(10);
      else expect(others.every((a) => a === 20) && r.awarded[r.callerTeam] === 0).toBe(true);
    }
  });
});

describe('12 players', () => {
  it('two teams of six, 2 cards each, the whole deck dealt', () => {
    const g = new Game304(cfg({ numPlayers: 12 }), { rng: seededRng(4) });
    expect(g.cardsEach).toBe(2);
    expect(g.hands.every((h) => h.length === 2)).toBe(true);
    expect(g.pointsInPlay).toBe(304);
    expect(g.teamCount).toBe(2);
    expect(Array.from({ length: 12 }, (_, s) => g.team(s))).toEqual([0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1]);
    expect(PLAYER_COUNTS).toContain(12);
  });
});

describe('bid reached: Stop or Continue (bidder only)', () => {
  const NAMES8 = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
  it('only the bidder is offered the choice; it is shown once', () => {
    const g = teamABids(160);
    g.drainEvents();
    while (g.phase === 'playing') playFirst(g);
    expect(g.phase).toBe('continueChoice');
    expect(g.turn).toBe(0);
    for (let s = 0; s < 8; s++) expect(viewFor(g, s).legal!.canChooseContinue).toBe(s === 0);
    expect(() => g.apply(2, { type: 'continueRound' })).toThrow(); // a teammate does not decide
    const ev = g.drainEvents().filter((e) => e.kind === 'bidReached');
    expect(ev).toHaveLength(1);
    // Said to the bidder as the question; to everyone else only as "waiting".
    expect(describeEvent(ev[0], NAMES8, 0, viewFor(g, 0))!.text).toBe('Your team has already reached its bid. Would you like to continue the game?');
    expect(describeEvent(ev[0], NAMES8, 1, viewFor(g, 1))!.text).not.toMatch(/continue/i);
  });

  it('Continue plays on, Coat stays available, and the choice is not offered again', () => {
    const g = teamABids(160);
    while (g.phase === 'playing') playFirst(g);
    const winner = g.completedTricks[0].winner;
    g.apply(0, { type: 'continueRound' });
    expect(g.phase).toBe('playing');
    expect(g.turn).toBe(winner);
    expect(g.currentTrick!.index).toBe(1);
    expect(viewFor(g, g.turn).legal!.coat).toMatchObject({ show: true, allowed: true });
    g.apply(g.turn, { type: 'coat' });
    playOut(g);
    expect(g.completedTricks).toHaveLength(3);
    expect(g.lastResult).toMatchObject({ kind: 'coat', success: true, awarded: [3, 0] });
  });

  it('Continue without Coat plays to the end and scores the made bid', () => {
    const g = teamABids(160);
    while (g.phase === 'playing') playFirst(g);
    g.apply(0, { type: 'continueRound' });
    while ((g.phase as string) === 'playing') playFirst(g);
    expect(g.lastResult).toMatchObject({ kind: 'normal', success: true, awarded: [1, 0], stopReason: null });
  });
});

// ------------------------------------------------------------------ Rules A and B: cancelled rounds

describe('Rule A: one side holds all four Jacks', () => {
  it.each(PLAYER_COUNTS.map((n) => [n]))('%i players: such a deal is cancelled and dealt again, before any bidding', (n) => {
    let cancelled = 0;
    for (let seed = 1; seed <= 300; seed++) {
      const g = new Game304(cfg({ numPlayers: n as PlayerCount }), { rng: seededRng(seed) });
      const ev = g.drainEvents();
      const c = ev.filter((e) => e.kind === 'roundCancelled');
      cancelled += c.length;
      for (const e of c) expect(e).toMatchObject({ reason: 'allJacks', round: 1 });
      // The deal players get never has all four Jacks on one side; nothing was bid or scored.
      expect(g.sideWithAllJacks()).toBeNull();
      expect(g.phase).toBe('bidding');
      expect(g.round).toBe(1);
      expect(g.scores.every((s) => s === 0)).toBe(true);
      if (c.length) expect(g.lastCancel).toBe('allJacks');
    }
    // With 3 and 4-card-or-more hands this happens often enough to be seen in 300 deals.
    if (n !== 12) expect(cancelled).toBeGreaterThan(0);
  });

  it('the message, word for word', () => {
    expect(catalog().ev.cancelled.allJacks).toBe('Round cancelled: one team has all four Jacks. Dealing again.');
    expect(catalog().ev.cancelled.noTrump).toBe('Round cancelled: one team has no card of the trump suit. Dealing again.');
  });
});

describe('Rule B: a side holds no card of the trump suit', () => {
  // Team B (seats 1 and 3) holds no Hearts. Seat 0 wins the bid and hides the Queen of Hearts.
  const NO_HEARTS_B = ['QH KH JS 9S AS 10S', 'JC 9C AC 10C KC QS', 'JH 9H AH 10H JD 9D', 'QC AD 10D KD QD KS'];
  const setup = () => {
    const g = new Game304(cfg({ matchTarget: 30 }), { dealer: 0, rng: seededRng(2) });
    rig(g, NO_HEARTS_B);
    g.options.cancelOnNoTrump = true;
    for (const s of [1, 2, 3]) g.apply(s, { type: 'pass' });
    g.apply(0, { type: 'bid', value: 160 });
    g.apply(0, { type: 'selectTrump', cardId: 'QH' });
    g.drainEvents();
    return g;
  };

  it('revealed by the bidder: the round is cancelled at once, tricks discarded, no points, fresh deal', () => {
    const g = setup();
    for (const id of ['JC', 'JH', 'QC']) g.apply(g.turn, { type: 'play', cardId: id }); // seats 1, 2, 3
    expect(g.turn).toBe(0);
    g.apply(0, { type: 'revealTrump' });
    const ev = g.drainEvents();
    expect(ev.map((e) => e.kind)).toEqual(expect.arrayContaining(['trumpRevealed', 'roundCancelled', 'roundStart']));
    expect(ev.find((e) => e.kind === 'roundCancelled')).toMatchObject({ reason: 'noTrump', round: 1 });
    expect(g.phase).toBe('bidding');
    expect(g.round).toBe(1);
    expect(g.results).toHaveLength(0);
    expect(g.scores).toEqual([0, 0]);
    expect(g.completedTricks).toHaveLength(0);
    expect(g.currentTrick).toBeNull();
    expect(g.contract).toBeNull();
    expect(g.trumpRevealed).toBe(false);
    expect(g.hands.every((h) => h.length === 6)).toBe(true);
    expect(viewFor(g, 2).lastCancel).toBe('noTrump');
    g.apply(g.turn, { type: 'pass' });
    expect(viewFor(g, 2).lastCancel).toBeNull(); // the message stays until bidding moves on
  });

  it('revealed because a player asked: also cancelled', () => {
    const g = setup();
    g.apply(1, { type: 'play', cardId: 'QS' }); // Spades led; seat 2 has none and asks
    g.apply(2, { type: 'askTrump' });
    expect(g.drainEvents().some((e) => e.kind === 'roundCancelled')).toBe(true);
    expect(g.phase).toBe('bidding');
    expect(g.askedThisTurn).toBeNull();
  });

  it('no cancellation while every side still holds a trump-suit card', () => {
    const g = new Game304(cfg(), { dealer: 0, rng: seededRng(2) });
    rig(g, ['QH KH JS 9S AS 10S', 'JC 9C AC 10C KC 9H', 'JH QS AH 10H JD 9D', 'QC AD 10D KD QD KS']);
    g.options.cancelOnNoTrump = true;
    for (const s of [1, 2, 3]) g.apply(s, { type: 'pass' });
    g.apply(0, { type: 'bid', value: 160 });
    g.apply(0, { type: 'selectTrump', cardId: 'QH' });
    for (const id of ['JC', 'JH', 'QC']) g.apply(g.turn, { type: 'play', cardId: id });
    g.apply(0, { type: 'revealTrump' });
    expect(g.phase).toBe('playing');
    expect(g.trumpRevealed).toBe(true);
  });

  it.each(PLAYER_COUNTS.map((n) => [n]))('%i players, full matches: a revealed trump always leaves every side holding some', (n) => {
    let cancels = 0;
    for (let seed = 1; seed <= 4; seed++) {
      const g = new Game304(cfg({ numPlayers: n as PlayerCount, matchTarget: 20 }), { rng: seededRng(seed * 13), dealer: 0 });
      const rng = seededRng(seed + 7);
      let guard = 0;
      while (g.phase !== 'matchOver') {
        if (++guard > 30000) throw new Error('runaway');
        if (g.phase === 'roundOver') {
          g.nextRound();
          continue;
        }
        const scores = [...g.scores];
        const v = viewFor(g, g.turn);
        g.apply(g.turn, rng() < 0.35 ? randomLegal(v, rng) ?? botDecide(v)! : botDecide(v)!);
        const ev = g.drainEvents();
        if (ev.some((e) => e.kind === 'roundCancelled' && e.reason === 'noTrump')) {
          cancels++;
          expect(g.scores).toEqual(scores); // no points to anyone
          expect(g.phase).toBe('bidding');
        }
        if (g.trumpRevealed && g.phase === 'playing' && g.trumpSuit) {
          // Rule B was checked at the reveal; at that moment every side held trump.
          const revealedNow = ev.some((e) => e.kind === 'trumpRevealed');
          if (revealedNow) expect(g.sideWithoutSuit(g.trumpSuit)).toBeNull();
        }
        if (g.phase === 'bidding' && g.bids.length === 0) expect(g.sideWithAllJacks()).toBeNull();
      }
    }
    expect(cancels).toBeGreaterThanOrEqual(0);
  }, 120_000);
});

describe('Rule B with 3 players: the bidder against the two defenders together', () => {
  // Seat 0 bids and hides a Heart. Seat 1 holds no Hearts, seat 2 does: the defenders together still hold trump.
  const deal = (hands: string[]) => {
    const g = new Game304(cfg({ numPlayers: 3, matchTarget: 30 }), { dealer: 2, rng: seededRng(3) });
    rig(g, hands);
    g.options.cancelOnNoTrump = true;
    g.apply(0, { type: 'bid', value: 160 });
    g.apply(1, { type: 'pass' });
    g.apply(2, { type: 'pass' });
    g.apply(0, { type: 'selectTrump', cardId: 'QH' });
    g.drainEvents();
    return g;
  };
  const reveal = (g: Game304) => {
    while (g.turn !== 0) g.apply(g.turn, { type: 'play', cardId: g.legalCards(g.turn)[0].id });
    g.apply(0, { type: 'revealTrump' });
    return g.drainEvents().some((e) => e.kind === 'roundCancelled');
  };

  it('one defender without trump is not enough: no cancellation', () => {
    const g = deal(['QH KH JS 9S AS 10S KS QS', 'JC 9C AC 10C KC QC JD 9D', 'JH 9H AH 10H AD 10D KD QD']);
    expect(reveal(g)).toBe(false);
    expect(g.phase).toBe('playing');
  });

  it('neither defender holds trump: cancelled', () => {
    const g = deal(['QH KH JH 9H AH 10H JS 9S', 'JC 9C AC 10C KC QC JD 9D', 'AS 10S KS QS AD 10D KD QD']);
    expect(reveal(g)).toBe(true);
    expect(g.phase).toBe('bidding');
    expect(g.scores).toEqual([0, 0, 0]);
  });
});
