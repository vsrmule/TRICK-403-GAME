/**
 * Trick 304 rules data. The engine reads every number and threshold from here,
 * so rule changes are data edits (plus tests), not code rewrites.
 */
import type { PlayerCount } from './types';

export const GAME_NAME = 'Trick 304';

export interface Band {
  id: 1 | 2;
  min: number;
  max: number;
  /** Normal bid: points to the bidding side if made, to each opposing side if stopped. */
  win: number;
  lose: number;
  /** Coat (called during play): bid points + bonus if made; double to opponents if stopped. */
  coatWin: number;
  coatLose: number;
}

export interface RuleSet {
  cardsPerPlayer: Record<PlayerCount, number>;
  /** 4-player short option: cards per player. */
  fourCardOption: number;
  bidding: {
    min: number;
    step: number;
    /** Last bid reachable in steps of `step`. */
    maxStepped: number;
    /** The single bid allowed after maxStepped (all card points). */
    top: number;
    /** Bids from this value up are named "<word>", "<word> 10", "<word> 20"… */
    namedFrom: number;
  };
  bands: Band[];
  challengeCoat: { win: number; lose: number };
}

export const RULES: RuleSet = {
  cardsPerPlayer: { 2: 12, 3: 8, 4: 6, 6: 4, 8: 3 },
  fourCardOption: 4,
  bidding: { min: 160, step: 10, maxStepped: 300, top: 304, namedFrom: 200 },
  bands: [
    { id: 1, min: 160, max: 190, win: 1, lose: 2, coatWin: 1 + 2, coatLose: 6 },
    { id: 2, min: 200, max: 304, win: 2, lose: 4, coatWin: 2 + 3, coatLose: 10 },
  ],
  challengeCoat: { win: 6, lose: 12 },
};

/**
 * Settings for details the change request left open. Each has a named DEFAULT
 * (see docs/DELIVERY-NOTES.md) and can be changed per room without code changes.
 */
export interface RuleOptions {
  /** D1: who may call Coat and Challenge Coat. */
  coatCallers: 'biddingSide' | 'anyone';
  /** D2: a player who asks for trump must then play a trump if they hold one. */
  askerMustPlayTrump: boolean;
  /** Coat called during trick k covers trick k itself (else from the next trick). */
  coatCoversCallingTrick: boolean;
  /** Challenge Coat result replaces the normal bid scoring for the round. */
  challengeCoatReplacesBid: boolean;
}

export const DEFAULT_RULE_OPTIONS: RuleOptions = {
  coatCallers: 'biddingSide',
  askerMustPlayTrump: true,
  coatCoversCallingTrick: true,
  challengeCoatReplacesBid: true,
};

/** Every legal bid value, in order: 160, 170 … 300, 304. */
export function allBids(rules: RuleSet = RULES): number[] {
  const b = rules.bidding;
  const out: number[] = [];
  for (let v = b.min; v <= b.maxStepped; v += b.step) out.push(v);
  out.push(b.top);
  return out;
}

/** Bids strictly above `current` (or all bids if none). */
export function bidsAbove(current: number | null, rules: RuleSet = RULES): number[] {
  return allBids(rules).filter((v) => current === null || v > current);
}

export function isLegalBidValue(v: number, rules: RuleSet = RULES): boolean {
  return allBids(rules).includes(v);
}

export function bandOf(value: number, rules: RuleSet = RULES): Band {
  const b = rules.bands.find((x) => value >= x.min && value <= x.max);
  if (!b) throw new Error(`No band for bid ${value}`);
  return b;
}
