# Trick 304 — Accessible Social Trick-Taking Card Game

Mobile-first multiplayer **Trick 304** with built-in voice chat, designed to be fully playable with
TalkBack, VoiceOver, NVDA and JAWS. One TypeScript codebase: a pure rules engine, an
authoritative Socket.IO server, and an accessible React web app (installable PWA, wrappable
as native Android/iOS apps with Capacitor).

## Quick start

```bash
npm install
npm run dev        # server on :3304 + web app on http://localhost:5173 (LAN-visible for phones)
npm test           # engine + server tests (42 tests)
npm run typecheck
```

Production (one process serves the web app and the game socket):

```bash
npm run build      # builds apps/web/dist
npm start          # http://localhost:3304  (PORT env var to change)
```

Phones on the same Wi-Fi can open `http://<your-PC-ip>:5173` in dev. **Voice chat needs HTTPS**
(browsers only allow microphones on secure origins, or localhost), so deploy behind TLS for
real use.

> **Change Request v4 (24 Nov 2026):** rules, DEFAULTs, tests and accessibility status are in [docs/DELIVERY-NOTES.md](docs/DELIVERY-NOTES.md). The rule sections below describe the original build; where they differ, the delivery notes win.

## Layout

| Path | What |
|---|---|
| `packages/engine` | Pure rules: deck, dealing, bidding, hidden trump, trick play, scoring, bots, per-player sanitized views, screen-reader text. Shared by server and client. |
| `apps/server` | Node + Socket.IO. Rooms with 6-digit codes, seats/bots, turn timers, reconnects, WebRTC signalling relay. Holds the only copy of the real game state. |
| `apps/web` | React + Vite client. Semantic HTML/ARIA (no canvas), queued live announcements, 3-channel audio mixer, voice mesh, high-contrast mode. |

## How the PRD maps to the code

- **Rooms & joining**: private room → 6-digit code + link `/?room=123456`; "Quick join" public matchmaking; public room list. Seats 2/3/4/6/8/12; host adds/removes bots; pick a seat to pick a team or "Auto-assign teams". A human joining mid-game takes over a bot seat at the next round. Leaving mid-game hands your seat to a bot; reloading or losing network reclaims your seat (per-device token).
- **Card privacy (server-enforced)**: `viewFor(game, seat)` builds each player's payload; only your own hand, your own hidden trump (if you are the bidder), and played cards ever leave the server. Tests inspect every websocket payload of full matches and assert no other card ids appear (`apps/server/test/server.test.ts`), and the engine fuzz tests check every view after every action in every mode.
- **Rules**: `packages/engine/src/game.ts`. Bids 160/170–300 in tens, pass = out, all-pass re-deals, 304 and Coat calls, hidden trump, follow suit, Open Trump (card returns to bidder, opener must trump if able), hidden trump as bidder's last card, Challenge Coat (after ≥1 trick, on your turn, overrides the round's scoring), match target.
- **Scoring**: Normal/304 +2 / +4, Coat +4 / +8, Challenge Coat +6 / +12, Self Coat +10 / +20, verified in all modes by randomized bot matches that recompute every round independently.
- **Players and cards** (24-card deck): 2 players 12 cards each, 3 players 8, 4 players 6, 6 players 4, 8 players 3, 12 players 2. Teams sit in alternating seats (4, 6, 8, 12).
- **Self Coat** (bidding call, on your turn; outranks every bid and Challenge Coat, ends the bidding, one per hand): the caller plays alone, their teammates sit out with their cards untouched; no trump; the caller leads trick 1; highest card of the led suit wins. Win every trick: caller's side +10. Lose one: the hand stops at once, opponents +20.
- **Cancelled rounds** (every mode): right after the deal, if one team holds all four Jacks, the round is cancelled and dealt again ("Round cancelled: one team has all four Jacks. Dealing again."). When trump is revealed, if one team holds no card of the trump suit, the round is cancelled (tricks discarded, no points) and dealt again ("Round cancelled: one team has no card of the trump suit. Dealing again."). Rule switches: `RuleOptions.cancelOnAllJacks` / `cancelOnNoTrump`.
- **Bid reached**: the bidder alone is asked "Your team has already reached its bid. Would you like to continue the game?" Stop ends the round (made, as before); Continue plays on so the side can still call Coat. Shown once per round. A bid that can no longer be reached still stops the round automatically.
- **Won-Tricks Basket**: B key / Basket button: tricks grouped by winning side, every card, read-aloud option.
- **Accessibility**: hand grouped by suit (headings) and sorted J 9 A 10 K Q; each card is a real button labelled e.g. "Jack of Clubs, 30 points — Disabled: Must follow led suit, Spades". Every game event becomes a queued `role="log"` announcement. Quick-status bar (Table T, Score & bid S, Basket B, Mic M, plus H = jump to hand) is pinned to the top on desktop and docked to the bottom on phones. With NVDA/JAWS in browse mode use **Alt+Shift+letter**. Includes high contrast, large text, four-colour suits, 48 px+ targets, optional confirm-before-play, optional turn timer (default relaxed), and bot speed setting.
- **Voice**: auto-joins on entering a room; mute (M), push-to-talk (hold V or the Talk button), per-player volume and mute. **3-channel mixer**: voice chat / game announcements (built-in voice) / sound effects, with ducking of effects while announcements speak.

## Rule interpretations (please confirm)

The PRD left some details open; these are the choices the engine makes:

1. **Cards played while trump is hidden never count as trump**, even if they are of the trump suit (as in face-down play). Only cards played after trump is revealed act as trump.
2. **304 bid / Coat value** = all card points actually in play (304, or fewer in the 4-player 4-card mode where 8 cards sit out).
3. **3 players**: each player is their own side. A failed call gives +4 / +8 / +12 to *each* defender, and the match target applies per player.
4. A broken **Coat or Challenge Coat ends the round immediately**. Normal bids are played out.
5. **All pass** → round void, dealer rotates, cards re-dealt (round number unchanged).
6. Bids are ranked: any number < 304 < Coat. Coat ends the bidding immediately.
7. The bidder may open trump themselves when they can't follow suit.
8. The hidden trump suit is shown to everyone once the round ends.

## Native apps & production notes

- **Android/iOS**: the web app is a PWA today (Add to Home Screen). For store apps, wrap `apps/web/dist` with Capacitor:
  `npm i -D @capacitor/cli @capacitor/core @capacitor/android @capacitor/ios -w @g304/web`, `npx cap init 304 com.example.g304 --web-dir dist`, `npx cap add android`, build with `VITE_SERVER_URL=https://your-server`.
  Android WebView + TalkBack and WKWebView + VoiceOver both expose the same ARIA tree, but this still needs testing on real devices.
- **Voice**: WebRTC mesh signalled by the game server: no vendor keys, fine for ≤8 players on decent networks. Add a TURN server for strict NATs/cellular (`VITE_TURN_URL`, `VITE_TURN_USERNAME`, `VITE_TURN_CREDENTIAL`). For heavy use, replace `apps/web/src/voice.ts` with LiveKit/Agora (same join/mute/volume interface).
- **State is in memory**: one server process. Rooms vanish on restart. Add Redis + sticky sessions to scale out.
- Screen-reader volume itself is controlled by the OS screen reader; the "Game announcements" slider controls the app's optional built-in voice (Settings → "Speak game announcements through").

## Acceptance checklist status

| Item | Status |
|---|---|
| Android/iOS/Web join same room via code/link and talk | Works in mobile & desktop browsers (verified headless: two browsers, live audio both ways). Native store builds not produced yet. |
| Blind tester completes a match with TalkBack/VoiceOver | Built for it and checked with axe-core (no violations on home, lobby, dialogs). **Still needs testing by a real screen-reader user on devices.** |
| No client receives others' unplayed cards / hidden trump | Automated payload inspection in tests. |
| Scoring correct in 2/3/4/6/8 modes with bots | Automated (scenario + randomized full-match tests). |
