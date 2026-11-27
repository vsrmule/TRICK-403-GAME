/**
 * Voice scripts for the built-in voice (see voiceClips.ts): what the game's own voice
 * says for each announcement, as language-neutral phrase references.
 *
 * Player-typed names can't be pre-recorded, so the voice says "Seat 3" for a person
 * (and "You" for yourself); the standard bots have recorded names ("Bot Asha").
 * Screen-reader text and captions keep the real names.
 */
import type { Card } from './cards';
import type { Names } from './describe';
import type { GameEvent, RoundResult } from './types';
import type { PlayerView } from './view';
import type { VoiceRef, VoiceScript } from './voiceClips';

/** Names the server gives bots in empty seats ("Bot Asha" …). */
export const BOT_NAMES = ['Asha', 'Ravi', 'Meera', 'Kiran', 'Devi', 'Arun', 'Lata', 'Vijay'];

const r = (t: string, v?: Record<string, string>): VoiceRef => (v ? { t, v } : { t });

/** Voice key for a seat: "you", a standard bot ("bot-asha") or the seat number ("s3"). */
export function whoKey(seat: number, me: number | null, names: Names): string {
  if (seat === me) return 'you';
  const m = /^Bot (\w+)$/.exec(names[seat] ?? '');
  if (m && BOT_NAMES.includes(m[1])) return `bot-${m[1].toLowerCase()}`;
  return `s${seat + 1}`;
}

/** Voice key for a side: Team A/B in team games, else the player. */
export function sideKey(team: number, n: number, me: number | null, names: Names): string {
  if (n === 2 || n === 3) return whoKey(team, me, names);
  return team === 0 ? 'team-a' : 'team-b';
}

const cardKey = (c: Card) => c.id;
const num = (n: number) => r('num', { num: String(n) });

/** "Team A, 8. Team B, 4." */
export function scoreScript(scores: number[], n: number, me: number | null, names: Names): VoiceScript {
  return scores.flatMap((s, t) => [r('side', { who: sideKey(t, n, me, names) }), num(s)]);
}

/** The game voice's version of describeEvent. */
export function voiceEvent(e: GameEvent, names: Names, me: number | null, v: PlayerView): VoiceScript | null {
  const n = v.config.numPlayers;
  const W = (s: number) => whoKey(s, me, names);
  const S = (t: number) => sideKey(t, n, me, names);
  switch (e.kind) {
    case 'roundStart':
      return [r('roundStart', { round: String(e.round) }), r('deals', { who: W(e.dealer) }), ...(me !== null ? [r('handReady')] : [])];
    case 'redeal':
      return [r('redeal')];
    case 'bid':
      if (e.action.type === 'pass') return [r('pass', { who: W(e.seat) })];
      if (e.action.type === 'challengeCoat') return [r('challengeCoat', { who: W(e.seat) })];
      return [r('bid', { who: W(e.seat), bid: String(e.action.value) })];
    case 'biddingWon':
      return e.contract.type === 'challengeCoat'
        ? [r('biddingWonChallenge', { who: W(e.seat) })]
        : [r('biddingWon', { who: W(e.seat), bid: String(e.contract.value) })];
    case 'trumpChosen':
      return e.seat === me ? null : [r('trumpChosen', { who: W(e.seat) })];
    case 'yourTrump':
      return [r('yourTrump', { card: cardKey(e.card) }), r('trumpIs', { suit: e.card.suit }), r('onlyYouKnow')];
    case 'firstLead':
      return [r('isBidder', { who: W(e.bidder) }), r('leadsFirst', { who: W(e.seat) })];
    case 'youPlayedTrumpCard':
      return [r('youPlayedTrumpCard')];
    case 'trumpAsked':
      return null; // said with the reveal that follows
    case 'trumpRevealed':
      return [r(e.how === 'asked' ? 'asksTrump' : 'revealsTrump', { who: W(e.seat) }), r('trumpIs', { suit: e.suit })];
    case 'cardPlayed':
      return [r(e.asTrump ? 'trumps' : 'plays', { who: W(e.seat), card: cardKey(e.card) })];
    case 'trickWon': {
      const teamMode = n === 4 || n === 6 || n === 8;
      return [
        r('takesTrick', { who: W(e.seat) }),
        num(e.points),
        teamMode ? r('pointsFor', { who: S(e.team) }) : r('points'),
        r('roundScore'),
        ...scoreScript(e.captured, n, me, names),
        r('needs', { who: S(e.bidderTeam), bid: String(e.bid) }),
      ];
    }
    case 'coat':
      return [r('coatAccepted'), r('needsEveryTrick', { who: S(e.team) })];
    case 'turn':
      if (e.seat === me) {
        if (e.phase === 'bidding') return [r('yourTurnBid')];
        if (e.phase === 'trumpSelect') return [r('yourTurnTrump')];
        const leading = !!v.currentTrick && v.currentTrick.plays.length === 0 && v.turn === e.seat;
        return [r(leading ? 'yourTurnLead' : 'yourTurnPlay')];
      }
      if (e.phase === 'bidding') return [r('waitBid', { who: W(e.seat) })];
      if (e.phase === 'trumpSelect') return [r('waitTrump', { who: W(e.seat) })];
      return null;
    case 'roundOver':
      return [...resultScript(e.result, n, me, names), r('scores'), ...scoreScript(e.scores, n, me, names)];
    case 'matchOver':
      return [r('matchOver'), ...e.winners.map((t) => r('wins', { who: S(t) })), r('finalScore'), ...scoreScript(e.scores, n, me, names)];
  }
}

function resultScript(res: RoundResult, n: number, me: number | null, names: Names): VoiceScript {
  const side = sideKey(res.callerTeam, n, me, names);
  const out: VoiceScript = [];
  switch (res.stopReason) {
    case 'bidReached': out.push(r('stopBidReached', { who: side })); break;
    case 'bidImpossible': out.push(r('stopBidImpossible', { who: side })); break;
    case 'coatFailed': out.push(r('stopCoatFailed', { who: side })); break;
    case 'challengeCoatFailed': out.push(r('stopChallengeFailed', { who: side })); break;
  }
  const call = res.kind === 'challengeCoat' ? 'Challenge' : res.kind === 'coat' ? 'Coat' : 'Bid';
  out.push(r(res.success ? `made${call}` : `missed${call}`, { who: side }));
  res.awarded.forEach((a, t) => {
    if (a) out.push(r('side', { who: sideKey(t, n, me, names) }), r('plus', { plus: String(a) }));
  });
  return out;
}

/** The game voice's version of guidance(): what this player can do now. */
export function voiceGuidance(v: PlayerView, names: Names, opts: { ready?: boolean; isHost?: boolean } = {}): VoiceScript {
  const me = v.seat;
  if (me === null || !v.legal) return [r('watching')];
  const Lg = v.legal;
  if (v.phase === 'matchOver') return [r(opts.isHost ? 'guideMatchOverHost' : 'guideMatchOver')];
  if (v.phase === 'roundOver') return [r(opts.ready ? 'guideReadyDone' : 'guideReady')];
  if (v.turn !== me) return [r('waitingFor', { who: whoKey(v.turn, me, names) })];
  if (v.phase === 'bidding') {
    const out = Lg.bidOptions.length ? [r('guideBid', { bid: String(Lg.bidOptions[0]) })] : [r('guideNoHigherBid')];
    if (Lg.canChallengeCoat) out.push(r('guideCanChallenge'));
    return out;
  }
  if (v.phase === 'trumpSelect') return [r('guideTrump')];
  const coat = Lg.coat.allowed ? [r('guideCanCoat')] : [];
  const rev = Lg.canRevealTrump ? [r('guideCanReveal')] : [];
  const led = v.currentTrick && v.currentTrick.plays.length ? v.currentTrick.plays[0].card.suit : null;
  if (!led) return [r('guideLead'), ...coat, ...rev];
  const follow = v.myHand.filter((c) => c.suit === led).length;
  if (follow > 0) return [r('guideFollow', { suit: led }), r('guideYouHave', { count: String(follow) }), ...coat, ...rev];
  if (Lg.canAskTrump) return [r('guideVoidAsk', { suit: led })];
  if (Lg.canRevealTrump) return [r('guideVoidReveal', { suit: led })];
  if (v.trumpRevealed && v.trumpSuit && Lg.playable.length && Lg.playable.length < v.myHand.length) return [r('guideMustTrump')];
  return [r('guideVoidOpen', { suit: led }), ...coat];
}

/** "Still waiting for Seat 3." / "Seat 3's turn." */
export const voiceStillWaiting = (seat: number, me: number | null, names: Names): VoiceScript => [r('stillWaiting', { who: whoKey(seat, me, names) })];
export const voiceTurnOf = (seat: number, me: number | null, names: Names): VoiceScript => [r('turnOf', { who: whoKey(seat, me, names) })];

/** "Joined room 4 8 1 …" */
export function voiceJoined(code: string, inProgress: boolean, isHost: boolean): VoiceScript {
  return [r('joinedRoom'), ...code.split('').map((d) => num(Number(d))), ...(inProgress ? [r('gameInProgress')] : isHost ? [r('youAreHost')] : [])];
}
