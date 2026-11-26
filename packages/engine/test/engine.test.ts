import { describe, expect, it } from 'vitest';
import {
  Action,
  DEFAULT_CONFIG,
  Game304,
  GameConfig,
  PLAYER_COUNTS,
  PlayerCount,
  PlayerView,
  RULES,
  allBids,
  bandOf,
  basketSummary,
  bidName,
  bidsAbove,
  botDecide,
  cardFromId,
  cardLabel,
  cardsPerPlayer,
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
}
const playFirst = (g: Game304) => g.apply(g.turn, { type: 'play', cardId: g.legalCards(g.turn)[0].id });
function playOut(g: Game304) {
  while (g.phase === 'playing') playFirst(g);
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
  it('stops as soon as the bid is reached, scored as a normal made bid (acceptance 4)', () => {
    const g = teamABids(160);
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
    const g = teamABids(160);
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
  it("a non-bidder's trump-suit card counts as trump even while trump is hidden (acceptance 2)", () => {
    const g = new Game304(cfg(), { dealer: 0, rng: seededRng(2) });
    rig(g, HANDS);
    for (const s of [1, 2, 3]) g.apply(s, { type: 'pass' });
    g.apply(0, { type: 'bid', value: 300 });
    g.apply(0, { type: 'selectTrump', cardId: 'QH' });
    g.apply(1, { type: 'play', cardId: 'JC' });
    g.apply(2, { type: 'play', cardId: 'JH' }); // void in clubs, no ask: still trump
    g.apply(3, { type: 'play', cardId: 'QC' });
    g.apply(0, { type: 'play', cardId: 'KH' }); // the bidder's heart is trump too, but lower
    expect(g.trumpRevealed).toBe(false);
    expect(g.completedTricks[0].winner).toBe(2); // Jack of Hearts, the highest trump
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

describe('Coat (during play)', () => {
  it('Band 1 made: 1 + 2 = 3 (acceptance 14)', () => {
    const g = teamABids(170);
    g.apply(0, { type: 'coat' });
    playOut(g);
    expect(g.lastResult).toMatchObject({ kind: 'coat', band: 1, success: true, awarded: [3, 0] });
  });
  it('Band 2 made: 2 + 3 = 5 (acceptance 14)', () => {
    const g = teamABids(220);
    g.apply(0, { type: 'coat' });
    playOut(g);
    expect(g.lastResult).toMatchObject({ kind: 'coat', band: 2, success: true, awarded: [5, 0] });
  });
  it('Band 1 failed: round stops at once, opponents get 6 (acceptance 13)', () => {
    const g = teamBLeads(170);
    g.apply(1, { type: 'coat' }); // Team B opens trick 1 and calls Coat
    playOut(g);
    expect(g.completedTricks).toHaveLength(1);
    expect(g.lastResult).toMatchObject({ kind: 'coat', band: 1, success: false, awarded: [6, 0], endedEarly: true, stopReason: 'coatFailed' });
  });
  it('Band 2 failed: opponents get 10 (acceptance 13)', () => {
    const g = teamBLeads(240);
    g.apply(1, { type: 'coat' });
    playOut(g);
    expect(g.lastResult).toMatchObject({ kind: 'coat', band: 2, success: false, awarded: [10, 0], stopReason: 'coatFailed' });
  });
  it('is announced as accepted', () => {
    const g = teamABids(170);
    g.drainEvents();
    g.apply(0, { type: 'coat' });
    const e = g.drainEvents().find((x) => x.kind === 'coat')!;
    expect(describeEvent(e, ['Priya', 'B1', 'A2', 'B3', 'A4', 'B5', 'A6', 'B7'], 1, viewFor(g, 1))!.text).toBe(
      'Coat accepted. Priya called Coat: Team A must win every remaining trick.',
    );
  });
  it('only the bidding side may call Coat (D1, unchanged), on its own turn, once', () => {
    const g = teamABids(170);
    expect(() => g.apply(1, { type: 'coat' })).toThrow(/turn/);
    g.apply(0, { type: 'coat' });
    expect(() => g.apply(0, { type: 'coat' })).toThrow(/already/);
  });
  it('is refused once a card of the trick has been played (call it when opening the trick)', () => {
    const g = teamABids(300);
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
      expect(said(g, s, evs)).toMatch(/Priya chose trump\. It stays hidden\./);
      expect(scoreStatus(v, NAMES)).not.toMatch(/Hearts/);
    }
    expect(viewFor(g, null).trumpSuit).toBeNull(); // spectators too
    // The bidder alone is told privately.
    expect(said(g, 0, evs)).toMatch(/You chose Hearts as trump with the Queen of Hearts\. The card stays in your hand\. Only you know trump\./);
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

// ------------------------------------------------------------------ all modes with bots

function randomLegal(v: PlayerView, rng: () => number): Action | null {
  const L = v.legal!;
  const pick = <T>(xs: T[]) => xs[Math.floor(rng() * xs.length)];
  if (v.phase === 'bidding') {
    const opts: Action[] = [{ type: 'pass' }];
    if (L.bidOptions.length) opts.push({ type: 'bid', value: pick(L.bidOptions.slice(0, 4)) });
    if (L.bidOptions.includes(304) && rng() < 0.2) opts.push({ type: 'bid', value: 304 });
    if (L.canChallengeCoat && rng() < 0.04) opts.push({ type: 'challengeCoat' });
    return pick(opts);
  }
  if (v.phase === 'trumpSelect') return { type: 'selectTrump', cardId: pick(v.myHand).id };
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
    expect(cap.reduce((a, b) => a + b, 0)).toBe(g.pointsInPlay);
  }
  // CR v5: why a round stops early is consistent with the result.
  if (r.stopReason === 'bidReached') expect(r.success && r.kind === 'normal').toBe(true);
  if (r.stopReason === 'bidImpossible') expect(!r.success && r.kind === 'normal').toBe(true);
  if (r.stopReason === 'coatFailed') expect(!r.success && r.kind === 'coat').toBe(true);
  if (r.stopReason === 'challengeCoatFailed') expect(!r.success && r.kind === 'challengeCoat').toBe(true);
  if (r.kind === 'normal' && r.stopReason === null) {
    // No early stop means the bid stayed open until the very last trick.
    expect(g.completedTricks).toHaveLength(g.cardsEach);
  }
  const band = bandOf(r.bidValue).id;
  let win: number, lose: number, success: boolean;
  if (r.kind === 'challengeCoat') {
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
    modes.push({ numPlayers, firstLead: 'bidderLeft', matchTarget: 30 });
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
    expect(guidance(viewFor(g, 1), NAMES)).toBe('Bid 160 or higher, or pass. You can also call Challenge Coat.');
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
