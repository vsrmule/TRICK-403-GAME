import type { Card, Suit } from './cards';
import type { RuleOptions } from './rules';

export type PlayerCount = 2 | 3 | 4 | 6 | 8 | 12;
export const PLAYER_COUNTS: PlayerCount[] = [2, 3, 4, 6, 8, 12];

export interface GameConfig {
  numPlayers: PlayerCount;
  /** First side to reach this many game points wins the match. */
  matchTarget: number;
  /** 4-player only: deal 4 cards each (16 in play) instead of 6. */
  fourCardMode: boolean;
  /** Open-detail settings (DEFAULTs); omitted fields use DEFAULT_RULE_OPTIONS. */
  options?: Partial<RuleOptions>;
}

export const DEFAULT_CONFIG: GameConfig = {
  numPlayers: 4,
  matchTarget: 21,
  fourCardMode: false,
};

/** selfCoat: the caller plays alone (teammates sit out), no trump, must win every trick. */
export type ContractType = 'normal' | 'challengeCoat' | 'selfCoat';

export interface Contract {
  bidder: number;
  type: ContractType;
  /** Bid value (160…304). For Challenge Coat and Self Coat, the highest numeric bid made before it, or the minimum. */
  value: number;
}

/** continueChoice: the bidding side has reached its bid; the bidder chooses Stop or Continue. */
export type Phase = 'bidding' | 'trumpSelect' | 'playing' | 'continueChoice' | 'roundOver' | 'matchOver';

export type BidAction = { type: 'bid'; value: number } | { type: 'pass' } | { type: 'challengeCoat' } | { type: 'selfCoat' };

export type Action =
  | BidAction
  | { type: 'selectTrump'; cardId: string }
  | { type: 'play'; cardId: string }
  /** A player void in the led suit asks the bidder to reveal trump. */
  | { type: 'askTrump' }
  /** The bidder reveals trump himself (when void in the led suit). */
  | { type: 'revealTrump' }
  /** Coat: called during play by the bidding side (D1), trick 1 … N−1. */
  | { type: 'coat' }
  /** The bidder, once the bid is reached: play on (Coat can still be called) … */
  | { type: 'continueRound' }
  /** … or stop the round now, scored as a made bid. */
  | { type: 'stopRound' };

export interface BidRecord {
  seat: number;
  action: BidAction;
}

export interface Play {
  seat: number;
  card: Card;
  /** True if this card counts as trump for winning the trick. */
  asTrump: boolean;
}

export interface Trick {
  index: number;
  leader: number;
  plays: Play[];
}

export interface CompletedTrick extends Trick {
  winner: number;
  winnerTeam: number;
  points: number;
}

export type CallKind = 'normal' | 'coat' | 'challengeCoat' | 'selfCoat';

export interface CoatInfo {
  seat: number;
  team: number;
  /** First trick index the Coat covers. */
  fromTrick: number;
  /** Trick index during which it was called. */
  calledAt: number;
}

export interface RoundResult {
  round: number;
  kind: CallKind;
  /** Seat that made the deciding call (bidder, Coat caller, or Challenge Coat caller). */
  caller: number;
  callerTeam: number;
  bidder: number;
  bidValue: number;
  band: 1 | 2;
  success: boolean;
  /** Card points captured per team this round. */
  capturedPoints: number[];
  tricksWon: number[];
  /** Game points awarded per team this round. */
  awarded: number[];
  trumpSuit: Suit | null;
  /** True if the round finished before all tricks were played. */
  endedEarly: boolean;
  /**
   * Why the round stopped early (CR v5), or null if all tricks were played:
   * bidReached — the bidding side reached its bid (made);
   * bidImpossible — the bidding side can no longer reach its bid (stopped);
   * coatFailed / challengeCoatFailed / selfCoatFailed — the calling side lost a trick.
   */
  stopReason: StopReason | null;
}

export type StopReason = 'bidReached' | 'bidImpossible' | 'coatFailed' | 'challengeCoatFailed' | 'selfCoatFailed';

export type RevealKind = 'asked' | 'bidder';

/** Structured events. `to` restricts an event to one seat (private info). */
export type GameEvent = { to?: number } & (
  | { kind: 'roundStart'; round: number; dealer: number; firstBidder: number; cardsEach: number }
  | { kind: 'redeal'; round: number; dealer: number }
  | { kind: 'bid'; seat: number; action: BidAction }
  | { kind: 'biddingWon'; seat: number; contract: Contract }
  /** Public: the bidder has chosen trump (the suit stays secret). */
  | { kind: 'trumpChosen'; seat: number }
  /** Issue 7: announced once trump is placed — who bid, and who leads the first trick. */
  | { kind: 'firstLead'; seat: number; bidder: number }
  /** Issue 7, private to the bidder: they played their placed trump card; trump stays hidden. */
  | { kind: 'youPlayedTrumpCard'; seat: number; card: Card }
  /** Private to the bidder: the indicator card and the trump suit. */
  | { kind: 'yourTrump'; seat: number; card: Card }
  | { kind: 'trumpAsked'; seat: number; bidder: number }
  | { kind: 'trumpRevealed'; seat: number; bidder: number; suit: Suit; how: RevealKind }
  | { kind: 'cardPlayed'; seat: number; card: Card; asTrump: boolean; trickIndex: number }
  | { kind: 'trickWon'; seat: number; team: number; points: number; trickIndex: number; captured: number[]; bid: number; bidderTeam: number; selfCoat?: boolean }
  | { kind: 'coat'; seat: number; team: number; trickIndex: number }
  /** The bidding side reached its bid; `seat` (the bidder) now chooses Stop or Continue. */
  | { kind: 'bidReached'; seat: number; team: number; bid: number }
  /** The bidder chose to play on after reaching the bid. */
  | { kind: 'continued'; seat: number }
  | { kind: 'turn'; seat: number; phase: Phase }
  | { kind: 'roundOver'; result: RoundResult; scores: number[] }
  | { kind: 'matchOver'; winners: number[]; scores: number[] }
);
