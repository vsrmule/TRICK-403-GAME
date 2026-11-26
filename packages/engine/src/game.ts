import { Card, Rng, Suit, fullDeck, points, shuffle, strength, sumPoints } from './cards';
import { DEFAULT_RULE_OPTIONS, RULES, RuleOptions, bandOf, bidsAbove, isLegalBidValue } from './rules';
import {
  Action,
  BidAction,
  BidRecord,
  CoatInfo,
  CompletedTrick,
  Contract,
  GameConfig,
  GameEvent,
  Phase,
  Play,
  PlayerCount,
  RoundResult,
  StopReason,
  Trick,
} from './types';

export class GameError extends Error {}

export function cardsPerPlayer(config: Pick<GameConfig, 'numPlayers' | 'fourCardMode'>): number {
  if (config.numPlayers === 4 && config.fourCardMode) return RULES.fourCardOption;
  return RULES.cardsPerPlayer[config.numPlayers];
}

/** 3 players: every player is their own side. Otherwise two sides on alternating seats. */
export function teamOf(numPlayers: number, seat: number): number {
  return numPlayers === 3 ? seat : seat % 2;
}

export function numTeams(numPlayers: number): number {
  return numPlayers === 3 ? 3 : 2;
}

/** Comparable strength of a bid action (Challenge Coat beats any number). */
export function bidRank(a: BidAction): number {
  if (a.type === 'bid') return a.value;
  if (a.type === 'challengeCoat') return 10_000;
  return 0;
}

/**
 * Decide the winner of a (complete or partial) trick.
 * Only plays marked `asTrump` count as trump. If the led suit is itself the
 * trump suit, the highest card of the led suit wins.
 */
export function trickLeader(plays: Play[], trumpSuit: Suit | null): Play | null {
  if (plays.length === 0) return null;
  const led = plays[0].card.suit;
  const trumps = plays.filter((p) => p.asTrump);
  const pool = trumps.length > 0 && led !== trumpSuit ? trumps : plays.filter((p) => p.card.suit === led);
  return pool.reduce((best, p) => (strength(p.card) > strength(best.card) ? p : best));
}

export interface GameOptions {
  rng?: Rng;
  dealer?: number;
}

export class Game304 {
  readonly config: GameConfig;
  readonly options: RuleOptions;
  readonly n: PlayerCount;
  readonly teamCount: number;
  readonly cardsEach: number;
  private rng: Rng;

  phase: Phase = 'bidding';
  round = 0;
  dealer: number;
  turn = 0;
  hands: Card[][] = [];
  pointsInPlay = 0;

  bids: BidRecord[] = [];
  passed: boolean[] = [];
  highBid: BidRecord | null = null;
  contract: Contract | null = null;

  /**
   * The card the bidder pointed at to choose trump (Issue 6). It stays in the bidder's
   * hand and plays like any other card; only its suit matters. Known to the bidder only.
   */
  trumpIndicator: Card | null = null;
  /** Secret until revealed — never send to clients directly. */
  trumpSuit: Suit | null = null;
  trumpRevealed = false;
  trumpRevealedBy: number | null = null;
  /** Seat that asked for trump on this turn and so must play trump if able (D2). */
  askedThisTurn: number | null = null;

  currentTrick: Trick | null = null;
  completedTricks: CompletedTrick[] = [];
  coat: CoatInfo | null = null;

  scores: number[];
  results: RoundResult[] = [];
  matchWinners: number[] | null = null;
  redeals = 0;

  private pending: GameEvent[] = [];

  constructor(config: GameConfig, opts: GameOptions = {}) {
    if (![2, 3, 4, 6, 8].includes(config.numPlayers)) throw new GameError('Unsupported player count');
    this.config = { ...config, fourCardMode: config.numPlayers === 4 && config.fourCardMode };
    this.options = { ...DEFAULT_RULE_OPTIONS, ...(config.options ?? {}) };
    this.n = config.numPlayers;
    this.teamCount = numTeams(this.n);
    this.cardsEach = cardsPerPlayer(this.config);
    this.rng = opts.rng ?? Math.random;
    this.scores = new Array(this.teamCount).fill(0);
    this.dealer = ((opts.dealer ?? 0) - 1 + this.n) % this.n;
    this.startRound(false);
  }

  team(seat: number): number {
    return teamOf(this.n, seat);
  }

  next(seat: number): number {
    return (seat + 1) % this.n;
  }

  drainEvents(): GameEvent[] {
    const e = this.pending;
    this.pending = [];
    return e;
  }

  private emit(e: GameEvent) {
    this.pending.push(e);
  }

  // ---------------------------------------------------------------- round flow

  private startRound(isRedeal: boolean) {
    if (!isRedeal) this.round++;
    this.dealer = this.next(this.dealer);
    const deck = shuffle(fullDeck(), this.rng);
    this.hands = Array.from({ length: this.n }, () => [] as Card[]);
    let seat = this.next(this.dealer);
    for (let i = 0; i < this.cardsEach * this.n; i++) {
      this.hands[seat].push(deck[i]);
      seat = this.next(seat);
    }
    this.pointsInPlay = this.hands.reduce((s, h) => s + sumPoints(h), 0);
    this.bids = [];
    this.passed = new Array(this.n).fill(false);
    this.highBid = null;
    this.contract = null;
    this.trumpIndicator = null;
    this.trumpSuit = null;
    this.trumpRevealed = false;
    this.trumpRevealedBy = null;
    this.askedThisTurn = null;
    this.currentTrick = null;
    this.completedTricks = [];
    this.coat = null;
    this.phase = 'bidding';
    this.turn = this.next(this.dealer);
    this.emit({ kind: 'roundStart', round: this.round, dealer: this.dealer, firstBidder: this.turn, cardsEach: this.cardsEach });
    this.emit({ kind: 'turn', seat: this.turn, phase: 'bidding' });
  }

  nextRound() {
    if (this.phase !== 'roundOver') throw new GameError('Round is not over');
    this.startRound(false);
  }

  // ---------------------------------------------------------------- actions

  apply(seat: number, action: Action) {
    if (seat < 0 || seat >= this.n) throw new GameError('Bad seat');
    if (this.phase === 'roundOver' || this.phase === 'matchOver') throw new GameError('The round is over');
    // CR v5: Challenge Coat only during bidding; Coat only during play.
    if (action.type === 'challengeCoat' && this.phase !== 'bidding') {
      throw new GameError('Challenge Coat refused: it can only be called during bidding, before play starts');
    }
    if (action.type === 'coat' && this.phase !== 'playing') {
      throw new GameError('Coat refused: it can only be called during play, when your side opens a trick');
    }
    if (seat !== this.turn) throw new GameError('Not your turn');
    switch (action.type) {
      case 'bid':
      case 'pass':
      case 'challengeCoat':
        return this.doBid(seat, action);
      case 'selectTrump':
        return this.selectTrump(seat, action.cardId);
      case 'askTrump':
        return this.askTrump(seat);
      case 'revealTrump':
        return this.revealTrump(seat);
      case 'coat':
        return this.callCoat(seat);
      case 'play':
        return this.play(seat, action.cardId);
      default:
        throw new GameError('Unknown action');
    }
  }

  /** Highest numeric bid so far, or null. */
  highestNumericBid(): number | null {
    let v: number | null = null;
    for (const b of this.bids) if (b.action.type === 'bid') v = Math.max(v ?? 0, b.action.value);
    return v;
  }

  /** Numeric bids the current bidder may make (empty once Challenge Coat is on). */
  availableBids(): number[] {
    if (this.highBid?.action.type === 'challengeCoat') return [];
    return bidsAbove(this.highestNumericBid());
  }

  /** Why `seat` may not call Challenge Coat now, or null if allowed. */
  challengeCoatBlock(seat: number): string | null {
    if (this.phase !== 'bidding') return 'Challenge Coat can only be called during bidding';
    if (this.turn !== seat || this.passed[seat]) return 'Not your turn';
    if (this.highBid?.action.type === 'challengeCoat') return 'Challenge Coat has already been called';
    // D1 (biddingSide): in bidding, the caller becomes the bidding side by calling — so any player may call on their turn.
    return null;
  }

  private doBid(seat: number, action: BidAction) {
    if (this.phase !== 'bidding') throw new GameError('Not the bidding phase');
    if (this.passed[seat]) throw new GameError('You already passed');
    if (action.type === 'bid') {
      const v = action.value;
      if (!Number.isInteger(v) || !isLegalBidValue(v)) {
        throw new GameError(`Bids go from ${RULES.bidding.min} to ${RULES.bidding.maxStepped} in steps of ${RULES.bidding.step}, then ${RULES.bidding.top}`);
      }
      if (!this.availableBids().includes(v)) throw new GameError('Bid must be higher than the current bid');
    } else if (action.type === 'challengeCoat') {
      const block = this.challengeCoatBlock(seat);
      if (block) throw new GameError(block);
    }

    this.bids.push({ seat, action });
    if (action.type === 'pass') this.passed[seat] = true;
    else this.highBid = { seat, action };
    this.emit({ kind: 'bid', seat, action });

    const active = this.passed.map((p, i) => (p ? -1 : i)).filter((i) => i >= 0);
    const top = this.highBid?.action;
    const nothingHigher = top?.type === 'challengeCoat';
    if (this.highBid && (nothingHigher || active.length === 1)) return this.finishBidding();
    if (!this.highBid && active.length === 0) {
      this.redeals++;
      this.emit({ kind: 'redeal', round: this.round, dealer: this.next(this.dealer) });
      return this.startRound(true);
    }
    let t = this.next(seat);
    while (this.passed[t]) t = this.next(t);
    this.turn = t;
    this.emit({ kind: 'turn', seat: t, phase: 'bidding' });
  }

  private finishBidding() {
    const hb = this.highBid!;
    const a = hb.action;
    this.contract = {
      bidder: hb.seat,
      type: a.type === 'challengeCoat' ? 'challengeCoat' : 'normal',
      value: a.type === 'bid' ? a.value : this.highestNumericBid() ?? RULES.bidding.min,
    };
    this.phase = 'trumpSelect';
    this.turn = hb.seat;
    this.emit({ kind: 'biddingWon', seat: hb.seat, contract: { ...this.contract } });
    this.emit({ kind: 'turn', seat: hb.seat, phase: 'trumpSelect' });
  }

  private selectTrump(seat: number, cardId: string) {
    if (this.phase !== 'trumpSelect') throw new GameError('Not trump selection');
    const hand = this.hands[seat];
    const idx = hand.findIndex((c) => c.id === cardId);
    if (idx < 0) throw new GameError('Card not in hand');
    // Issue 6: the card is NOT removed — it only indicates the trump suit.
    const card = hand[idx];
    this.trumpIndicator = card;
    this.trumpSuit = card.suit;
    this.emit({ kind: 'trumpChosen', seat });
    this.emit({ kind: 'yourTrump', seat, card, to: seat });
    this.phase = 'playing';
    const leader = this.config.firstLead === 'bidderLeft' ? this.next(seat) : this.next(this.dealer);
    this.currentTrick = { index: 0, leader, plays: [] };
    this.turn = leader;
    this.emit({ kind: 'turn', seat: leader, phase: 'playing' });
  }

  /** Cards the seat may play from (the whole hand — nothing is ever set aside). */
  playableHand(seat: number): Card[] {
    return this.hands[seat];
  }

  ledSuit(): Suit | null {
    return this.currentTrick && this.currentTrick.plays.length > 0 ? this.currentTrick.plays[0].card.suit : null;
  }

  legalCards(seat: number): Card[] {
    if (this.phase !== 'playing' || this.turn !== seat) return [];
    const cards = this.playableHand(seat);
    const led = this.ledSuit();
    if (led) {
      const follow = cards.filter((c) => c.suit === led);
      if (follow.length) return follow;
      if (this.askedThisTurn === seat && this.options.askerMustPlayTrump) {
        const trumps = cards.filter((c) => c.suit === this.trumpSuit);
        if (trumps.length) return trumps;
      }
    }
    return cards;
  }

  private voidInLed(seat: number): boolean {
    const led = this.ledSuit();
    return !!led && !this.hands[seat].some((c) => c.suit === led);
  }

  private trumpHiddenNow(): boolean {
    return !this.trumpRevealed && this.trumpSuit !== null;
  }

  /** A non-bidder void in the led suit, on their turn, while trump is hidden. */
  canAskTrump(seat: number): boolean {
    return (
      this.phase === 'playing' &&
      this.turn === seat &&
      this.trumpHiddenNow() &&
      this.contract!.bidder !== seat &&
      this.askedThisTurn === null &&
      this.voidInLed(seat)
    );
  }

  /**
   * Issue 6.4(b): the bidder may reveal trump whenever they choose, on any of their
   * turns during play (before playing their card). Never forced, except when asked.
   */
  canRevealTrump(seat: number): boolean {
    return this.phase === 'playing' && this.turn === seat && this.trumpHiddenNow() && this.contract!.bidder === seat;
  }

  private reveal(by: number, how: 'asked' | 'bidder') {
    const bidder = this.contract!.bidder;
    this.trumpRevealed = true;
    this.trumpRevealedBy = by;
    this.emit({ kind: 'trumpRevealed', seat: by, bidder, suit: this.trumpSuit!, how });
  }

  private askTrump(seat: number) {
    if (!this.canAskTrump(seat)) throw new GameError('You can ask for trump only when you have no card of the led suit and trump is hidden');
    this.emit({ kind: 'trumpAsked', seat, bidder: this.contract!.bidder });
    // The bidder must reveal immediately; the server enforces it.
    this.reveal(seat, 'asked');
    this.askedThisTurn = seat;
  }

  private revealTrump(seat: number) {
    if (!this.canRevealTrump(seat)) throw new GameError('Only the bidder can reveal trump, on their turn, while trump is still hidden');
    this.reveal(seat, 'bidder');
  }

  /**
   * Why `seat` may not call Coat now, or null if allowed (CR v5):
   * during play only; from trick 1 to the second-to-last trick; only when the caller's
   * side opens the trick, before any card of it is played; and only if the caller's
   * side (the whole team) has won every trick played so far this round.
   */
  coatBlock(seat: number): string | null {
    if (this.phase !== 'playing') return 'Coat refused: it can only be called during play';
    if (this.turn !== seat) return 'Not your turn';
    if (this.contract!.type === 'challengeCoat') return 'Coat refused: Challenge Coat is already on, every trick must be won';
    if (this.coat) return 'Coat refused: Coat has already been called this round';
    if (this.options.coatCallers === 'biddingSide' && this.team(seat) !== this.team(this.contract!.bidder)) {
      return 'Coat refused: only the bidding side can call Coat';
    }
    if (this.currentTrick!.index >= this.cardsEach - 1) return 'Coat refused: it cannot be called in the last trick';
    if (this.currentTrick!.plays.length > 0) return 'Coat refused: call it when your side opens a trick, before any card is played';
    if (this.completedTricks.some((t) => t.winnerTeam !== this.team(seat))) return 'Coat refused: your side has already lost a trick this round';
    return null;
  }

  private callCoat(seat: number) {
    const block = this.coatBlock(seat);
    if (block) throw new GameError(block);
    const idx = this.currentTrick!.index;
    this.coat = { seat, team: this.team(seat), fromTrick: this.options.coatCoversCallingTrick ? idx : idx + 1, calledAt: idx };
    this.emit({ kind: 'coat', seat, team: this.team(seat), trickIndex: idx });
  }

  private play(seat: number, cardId: string) {
    const legal = this.legalCards(seat);
    const card = legal.find((c) => c.id === cardId);
    if (!card) {
      if (this.playableHand(seat).some((c) => c.id === cardId)) {
        throw new GameError(this.askedThisTurn === seat ? 'You asked for trump, so you must play a trump' : 'You must follow the led suit');
      }
      throw new GameError('Card not in hand');
    }
    const hand = this.hands[seat];
    hand.splice(hand.findIndex((c) => c.id === cardId), 1);
    const trick = this.currentTrick!;
    // CR v5: trump is the whole suit — every card of it counts as trump, whoever plays it,
    // whether or not trump has been revealed yet.
    const asTrump = card.suit === this.trumpSuit;
    trick.plays.push({ seat, card, asTrump });
    this.askedThisTurn = null;
    // Publicly, a card is only announced as trump once trump is revealed.
    this.emit({ kind: 'cardPlayed', seat, card, asTrump: asTrump && this.trumpRevealed, trickIndex: trick.index });

    if (trick.plays.length === this.n) return this.resolveTrick();
    this.turn = this.next(seat);
    this.emit({ kind: 'turn', seat: this.turn, phase: 'playing' });
  }

  private resolveTrick() {
    const trick = this.currentTrick!;
    const win = trickLeader(trick.plays, this.trumpSuit)!;
    const done: CompletedTrick = {
      ...trick,
      winner: win.seat,
      winnerTeam: this.team(win.seat),
      points: trick.plays.reduce((s, p) => s + points(p.card), 0),
    };
    this.completedTricks.push(done);
    const contract = this.contract!;
    const bidderTeam = this.team(contract.bidder);
    const captured = this.capturedByTeam();
    // CR v5 change 3: the score line after every trick travels with the trick result.
    this.emit({
      kind: 'trickWon',
      seat: win.seat,
      team: done.winnerTeam,
      points: done.points,
      trickIndex: done.index,
      captured,
      bid: contract.value,
      bidderTeam,
    });

    // CR v5 change 5: a failed Coat / Challenge Coat stops the round at once.
    if (contract.type === 'challengeCoat' && done.winnerTeam !== bidderTeam) return this.endRound('challengeCoatFailed');
    if (this.coat && done.index >= this.coat.fromTrick && done.winnerTeam !== this.coat.team) return this.endRound('coatFailed');
    if (this.completedTricks.length === this.cardsEach) return this.endRound(null);
    // CR v5 changes 1 and 4 — only while no Coat or Challenge Coat is active.
    if (contract.type === 'normal' && !this.coat) {
      const left = this.pointsInPlay - captured.reduce((a, b) => a + b, 0);
      if (captured[bidderTeam] >= contract.value) return this.endRound('bidReached');
      if (captured[bidderTeam] + left < contract.value) return this.endRound('bidImpossible');
    }

    this.currentTrick = { index: trick.index + 1, leader: win.seat, plays: [] };
    this.turn = win.seat;
    this.emit({ kind: 'turn', seat: win.seat, phase: 'playing' });
  }

  /** Card points captured so far this round, per team. */
  capturedByTeam(): number[] {
    const c = new Array(this.teamCount).fill(0);
    for (const t of this.completedTricks) c[t.winnerTeam] += t.points;
    return c;
  }

  private endRound(stopReason: StopReason | null) {
    const endedEarly = stopReason !== null;
    const contract = this.contract!;
    const captured = new Array(this.teamCount).fill(0);
    const tricksWon = new Array(this.teamCount).fill(0);
    for (const t of this.completedTricks) {
      captured[t.winnerTeam] += t.points;
      tricksWon[t.winnerTeam]++;
    }
    const band = bandOf(contract.value);
    const bidderTeam = this.team(contract.bidder);

    let kind: RoundResult['kind'];
    let caller: number;
    let success: boolean;
    let winPts: number;
    let losePts: number;
    if (contract.type === 'challengeCoat') {
      kind = 'challengeCoat';
      caller = contract.bidder;
      success = !endedEarly && this.completedTricks.every((t) => t.winnerTeam === bidderTeam);
      winPts = RULES.challengeCoat.win;
      losePts = RULES.challengeCoat.lose;
    } else if (this.coat) {
      const c = this.coat;
      kind = 'coat';
      caller = c.seat;
      success = !endedEarly && this.completedTricks.filter((t) => t.index >= c.fromTrick).every((t) => t.winnerTeam === c.team);
      winPts = band.coatWin;
      losePts = band.coatLose;
    } else {
      kind = 'normal';
      caller = contract.bidder;
      success = captured[bidderTeam] >= contract.value;
      winPts = band.win;
      losePts = band.lose;
    }
    const callerTeam = this.team(caller);
    const awarded = new Array(this.teamCount).fill(0);
    if (success) awarded[callerTeam] = winPts;
    else for (let t = 0; t < this.teamCount; t++) if (t !== callerTeam) awarded[t] = losePts;
    for (let t = 0; t < this.teamCount; t++) this.scores[t] += awarded[t];

    const result: RoundResult = {
      round: this.round,
      kind,
      caller,
      callerTeam,
      bidder: contract.bidder,
      bidValue: contract.value,
      band: band.id,
      success,
      capturedPoints: captured,
      tricksWon,
      awarded,
      trumpSuit: this.trumpSuit,
      endedEarly,
      stopReason,
    };
    this.results.push(result);
    this.turn = -1;
    this.currentTrick = null;
    this.emit({ kind: 'roundOver', result, scores: [...this.scores] });

    const best = Math.max(...this.scores);
    if (best >= this.config.matchTarget) {
      this.phase = 'matchOver';
      this.matchWinners = this.scores.map((s, t) => (s === best ? t : -1)).filter((t) => t >= 0);
      this.emit({ kind: 'matchOver', winners: [...this.matchWinners], scores: [...this.scores] });
    } else {
      this.phase = 'roundOver';
    }
  }

  get lastResult(): RoundResult | null {
    return this.results.length ? this.results[this.results.length - 1] : null;
  }
}
