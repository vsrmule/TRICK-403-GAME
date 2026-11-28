import { Card, SUIT_NAMES, Suit, sortHand } from './cards';
import { Game304, teamOf } from './game';
import {
  BidRecord,
  CancelReason,
  CoatInfo,
  CompletedTrick,
  Contract,
  GameConfig,
  GameEvent,
  Phase,
  RoundResult,
  Trick,
} from './types';
import type { RuleOptions } from './rules';

export interface LegalInfo {
  canPass: boolean;
  /** Numeric bids allowed right now (160…300, 304), ascending. */
  bidOptions: number[];
  canChallengeCoat: boolean;
  /** Self Coat: a bidding call on your turn (play alone, no trump, win every trick). */
  canSelfCoat: boolean;
  canSelectTrump: boolean;
  /** The bidder, once the bid is reached: choose Stop or Continue. */
  canChooseContinue: boolean;
  /** Card ids that may be played now. */
  playable: string[];
  /** Reason each non-playable card in hand is disabled. */
  disabledReasons: Record<string, string>;
  canAskTrump: boolean;
  canRevealTrump: boolean;
  /** Coat: shown to the bidding side on its turn in play; `reason` explains a refusal (e.g. last trick). */
  coat: { show: boolean; allowed: boolean; reason: string | null };
}

/** Everything one seat is allowed to know. Never contains other players' unplayed cards. */
export interface PlayerView {
  seat: number | null;
  config: GameConfig;
  options: RuleOptions;
  phase: Phase;
  round: number;
  dealer: number;
  turn: number;
  numTeams: number;
  teams: number[];
  cardsEach: number;
  pointsInPlay: number;
  handCounts: number[];
  myHand: Card[];
  /** Bidder only: the placed trump card, while it is still in the bidder's hand (Issue 7, D2). */
  myTrumpIndicator: Card | null;
  /** Known only once revealed, or to the bidder. */
  trumpSuit: Suit | null;
  trumpRevealed: boolean;
  trumpRevealedBy: number | null;
  bids: BidRecord[];
  passed: boolean[];
  highBid: BidRecord | null;
  contract: Contract | null;
  currentTrick: Trick | null;
  completedTricks: CompletedTrick[];
  coat: CoatInfo | null;
  /** Why the previous deal was cancelled (until the first bid of the fresh deal), else null. */
  lastCancel: CancelReason | null;
  /** Self Coat: true for the caller's teammates, who sit out the hand. */
  sittingOut: boolean[];
  scores: number[];
  lastResult: RoundResult | null;
  matchWinners: number[] | null;
  legal: LegalInfo | null;
}

const clone = <T>(v: T): T => (v === null || v === undefined ? v : JSON.parse(JSON.stringify(v)));

export function viewFor(g: Game304, seat: number | null): PlayerView {
  const isSeat = seat !== null && seat >= 0 && seat < g.n;
  const isBidder = isSeat && g.contract?.bidder === seat;
  const over = g.phase === 'roundOver' || g.phase === 'matchOver';
  const trumpKnown = g.trumpRevealed || (isBidder && g.trumpSuit !== null) || over;
  // While trump is hidden, others must not learn that a bidder's card counted as trump (D3).
  const mask = <T extends Trick>(t: T): T => (trumpKnown ? t : { ...t, plays: t.plays.map((p) => ({ ...p, asTrump: false })) });
  return {
    seat: isSeat ? seat : null,
    config: clone(g.config),
    options: { ...g.options },
    phase: g.phase,
    round: g.round,
    dealer: g.dealer,
    turn: g.turn,
    numTeams: g.teamCount,
    teams: Array.from({ length: g.n }, (_, s) => teamOf(g.n, s)),
    cardsEach: g.cardsEach,
    pointsInPlay: g.pointsInPlay,
    handCounts: g.hands.map((h) => h.length),
    myHand: isSeat ? sortHand(g.hands[seat!]).map(clone) : [],
    myTrumpIndicator:
      isBidder && g.trumpIndicator && g.hands[seat!].some((c) => c.id === g.trumpIndicator!.id) ? clone(g.trumpIndicator) : null,
    trumpSuit: trumpKnown ? g.trumpSuit : null,
    trumpRevealed: g.trumpRevealed,
    trumpRevealedBy: g.trumpRevealedBy,
    bids: clone(g.bids),
    passed: [...g.passed],
    highBid: clone(g.highBid),
    contract: clone(g.contract),
    currentTrick: g.currentTrick ? mask(clone(g.currentTrick)) : null,
    completedTricks: clone(g.completedTricks).map(mask),
    coat: clone(g.coat),
    lastCancel: g.lastCancel,
    sittingOut: Array.from({ length: g.n }, (_, s) => g.sittingOut(s)),
    scores: [...g.scores],
    lastResult: clone(g.lastResult),
    matchWinners: g.matchWinners ? [...g.matchWinners] : null,
    legal: isSeat ? legalFor(g, seat!) : null,
  };
}

function legalFor(g: Game304, seat: number): LegalInfo {
  const myTurn = g.turn === seat;
  const bidding = g.phase === 'bidding' && myTurn && !g.passed[seat];
  const playable = g.legalCards(seat).map((c) => c.id);
  const disabledReasons: Record<string, string> = {};
  const led = g.ledSuit();
  for (const c of g.hands[seat]) {
    if (playable.includes(c.id)) continue;
    let reason: string;
    if (g.sittingOut(seat)) reason = 'You sit out this hand: your teammate plays Self Coat alone';
    else if (g.phase === 'trumpSelect') reason = myTurn ? 'Choose as your hidden trump card' : 'Waiting for trump selection';
    else if (g.phase === 'continueChoice') reason = myTurn ? 'Choose Stop or Continue first' : 'Waiting for the bidder to choose';
    else if (g.phase === 'bidding') reason = 'Bidding in progress';
    else if (g.phase !== 'playing') reason = 'Round over';
    else if (!myTurn) reason = 'Not your turn';
    else if (led && c.suit !== led) reason = `Must follow led suit, ${SUIT_NAMES[led]}`;
    else if (g.askedThisTurn === seat) reason = 'You asked for trump, so you must play a trump';
    else reason = 'Not playable';
    disabledReasons[c.id] = reason;
  }
  const isBiddingSide = g.contract ? g.team(seat) === g.team(g.contract.bidder) || g.options.coatCallers === 'anyone' : false;
  const coatShow = g.phase === 'playing' && myTurn && isBiddingSide && g.contract?.type === 'normal' && !g.coat;
  const coatReason = coatShow ? g.coatBlock(seat) : null;
  return {
    canPass: bidding,
    bidOptions: bidding ? g.availableBids() : [],
    canChallengeCoat: bidding && g.challengeCoatBlock(seat) === null,
    canSelfCoat: bidding && g.selfCoatBlock(seat) === null,
    canSelectTrump: g.phase === 'trumpSelect' && myTurn,
    canChooseContinue: g.phase === 'continueChoice' && myTurn,
    playable,
    disabledReasons,
    canAskTrump: g.canAskTrump(seat),
    canRevealTrump: g.canRevealTrump(seat),
    coat: { show: coatShow, allowed: coatShow && coatReason === null, reason: coatReason },
  };
}

/** Events visible to a seat (private events filtered out). */
export function eventsFor(events: GameEvent[], seat: number | null): GameEvent[] {
  return events.filter((e) => e.to === undefined || e.to === seat);
}
