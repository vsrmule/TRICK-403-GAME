# Trick 304 — Delivery notes for Change Request v4 (24 November 2026)

## 1. Conflicts between the previous build and CR v4, and what was done

1. **Name.** The build said "304". Now "Trick 304" in the UI, page title, app manifest, help, intro and share text.
2. **Bid ladder.** The build stopped numeric bids at 300 and had a separate "Call 304". Now bids are 160…300 in tens, then 304; "Call 304" is removed (DEFAULT: bidding 304 *is* the 304 bid). Minimum bid is fixed at 160, so the 160/170 lobby option was removed.
3. **Bid names.** Not present before. 200 = "Jaan", 210 = "Jaan 10" … 300 = "Jaan 100"; 304 = "304". Used in announcements, labels, bidding controls and the bid list.
4. **Scoring.** Flat +2 / +4 replaced by bands: Band 1 (160–190) +1 / opponents +2; Band 2 (200–304) +2 / opponents +4.
5. **Coat and Challenge Coat were swapped.** The build had Coat as a bidding call and Challenge Coat mid-game. Now Challenge Coat is a bidding call (win every trick, +6 / +12) and Coat is called during play (trick 1 … N−1, Band 1 +3 / +6, Band 2 +5 / +10). The server rejects Coat in the last trick with the reason "Coat can't be called in the last trick", and the UI shows and speaks that reason.
6. **Open Trump → ask to reveal.** "Open Trump" removed. A player void in the led suit may *Ask for trump* (the bidder must reveal immediately, enforced by the server), or not ask. The bidder may *Reveal trump* himself when void in the led suit, and is never forced to. Announcement: "<name> asked for trump. Trump is <suit>."
7. **Bidder's hidden trump plays.** Before, trump-suit cards only counted once trump was open. Now (D3) a trump-suit card the bidder plays while trump is hidden counts as trump. To keep trump secret, other players' views and events don't mark that card as trump until trump is revealed.
8. **Announcements.** Before, announcements went to the screen reader by default. Now each event has a built-in-voice version and a text version (live region + readable game log); the default is "both", queued so they never overlap. Wording varies lightly; the screen-reader text is always the first, clearest version.
9. **New features**: start sequence, narration and animation, language layer, video chat (host controlled), text chat, background music, four-channel mixer, more distinct sound effects. See section 3.
10. **Rules module.** All rule numbers (cards per mode, bid ladder, bands, Coat and Challenge Coat points) are in `packages/engine/src/rules.ts`; open details are named settings in `RuleOptions`.

## 2. DEFAULTs used (each is a named setting)

| # | DEFAULT | Where it lives |
|---|---|---|
| 1 | The bid of 304 is spoken and labelled "304" and scores as Band 2. | `i18n.ts` `bidName`, `rules.ts` bands |
| 2 | The BRD's "304 Bid" is the same as bidding 304 (Band 2). | `rules.ts` `allBids` |
| 3 | Challenge Coat's result replaces the normal bid scoring. | `RuleOptions.challengeCoatReplacesBid` = true |
| 4 | A Coat called in trick k covers trick k itself. | `RuleOptions.coatCoversCallingTrick` = true |
| 5 | D1: only the bidding side may call Coat and Challenge Coat, on its own turn. In bidding, calling Challenge Coat makes the caller's side the bidding side. | `RuleOptions.coatCallers` = 'biddingSide' |
| 6 | D2: any player void in the led suit may ask for trump on their turn; they must then play a trump if they hold one; the hidden card returns to the bidder's hand. | `RuleOptions.askerMustPlayTrump` = true |
| 7 | D3: a trump-suit card the bidder plays without revealing counts as trump from that moment. | `RuleOptions.bidderHiddenTrumpCounts` = true |
| 8 | D4: if trump was never revealed, the hidden card is played as the bidder's last card, which reveals it. | engine `playableHand` |
| 9 | Start sequence: credit order rotates each launch; one voice for all clips; initials only; spoken name plus a short sound logo. | `components/Intro.tsx`, `i18n.ts` `credits` |
| 10 | Opening narration: short placeholder, skippable, with text and screen-reader version; animation respects reduce motion. | `i18n.ts` `intro.narration`, `styles.css` |
| 11 | Announcements (owner decision): **the game voice is for screen-reader users only**. Setting "Game voice: Automatic" (default) turns it on when a screen reader is detected on the device; sighted players get sound effects, the on-screen instruction box and the game log, with no voice. Never doubled: nothing is pushed to the screen reader automatically. Web detection is heuristic (a screen reader activates buttons without a pointer or key press reaching the page) and is remembered per device; native apps should use the platform flag (TalkBack/VoiceOver). Settings also offer Always on, Off, and "use my own screen reader instead". The start sequence plays for everyone. | `srDetect.ts`, `prefs.speech` = auto |
| 12 | Announced events: card played, trick won, trump asked/revealed, plus bid, pass, round won, match won, Coat, Challenge Coat, turn alerts. | `describe.ts` |
| 13 | Encouraging sound when a round is won: winning side only. | `App.tsx` `roundOver` |
| 14 | Text chat (changed on owner request): **on from the start**, no switch-on step; the host can turn it off. Emoji reactions: quick reactions shown at the sender's seat, and reactions on messages. | server `chatEnabled` default true, `react`, `reactMessage` |
| 15 | Video chat (changed on owner request): **available by default**; each player's camera starts off and is turned on or off with one tap (toolbar Camera button, or More on phones). The host can still switch video off for the room, which turns every camera off. | server `videoEnabled` default true |
| 16 | Background music: off by default. | `prefs.musicOn` |
| 17 | Language: English, default. | `i18n.ts` `CATALOGS` |

### Choices outside the DEFAULT list (please confirm)

These came up while building and weren't specified. Each is a single place to change:

- **Bidder self-reveal** does not force the bidder to play a trump (D2's "must play trump" applies to the asker only).
- **3 players**: "opponents score N" gives N to *each* of the two defenders (unchanged from the earlier build).
- **Challenge Coat** still has the winning caller set a hidden trump, as for any bid.
- **Coat** can't be called during a Challenge Coat (it would be redundant), and only once per round.
- **A broken Coat or Challenge Coat ends the round immediately.**
- **The start sequence plays at app launch** (title screen with a Start button, needed so the browser allows sound). It can be skipped, turned off, or replayed from Settings.
- **Announcements use one channel only** (owner decision, replacing the CR default "both"): the game voice, for screen-reader users only (detected automatically), with the text kept in the readable game log. No first-run question. Web detection is a heuristic and must be confirmed with real NVDA, JAWS, Narrator, TalkBack and VoiceOver.

## 3. Features delivered

- **Rules engine and bots**: bidding bands up to 304, Jaan names, Challenge Coat, Coat, ask-to-reveal, bidder reveal, D1–D4. Bots ask for trump when it's worth it and, as bidder, play hidden trumps.
- **Start sequence**: sound logo + "Trick 304", three credits in rotating order, narration with a card-fan animation. Skippable, with text on screen.
- **Audio**: 16 synthesised effects, each distinguishable by ear (deal, card played, your turn, bid, pass, trick won or lost, trump asked, trump revealed, Coat, round end, cheer, match won, chat, error, sound logo). Optional generated background music. Effects and music duck under speech.
- **Mixer**: voice chat, announcements, effects and music sliders, each a labelled native slider.
- **Voice chat**: open microphone by default. Push-to-talk per player: hold the Talk button or the V key, or activate Talk once to start and again to stop, so it works with screen-reader double-tap. Server relay fallback when direct connections fail.
- **Video chat**: host-controlled. When off, no camera permission is requested and no video UI is shown. Each player turns their own camera on. Every video is labelled ("Arjun's camera").
- **Text chat**: message list, labelled message box (Enter sends; dictation works), new messages read out politely after game announcements, rate-limited, 300 characters.
- **Turn-by-turn instructions (for everyone, with or without a screen reader)**: on each turn the game's own voice says what you can do right now (for example "Follow Hearts. You have 2 cards in Hearts" or "You have no Clubs. Play any card, or ask for trump"), and the same instruction is shown on screen. "What now?" (key I) repeats it any time. On by default; can be turned off in Settings.
- **Voice reconnect**: after a network drop, phone screen lock or server restart, a player automatically rejoins voice (previously they could stay silent while the screen said "Mic on").
- **Language layer**: announcement text and spoken variants, credits and narration come from a catalog (`packages/engine/src/i18n.ts`). Adding a language means adding a catalog. The older UI chrome (button labels, help text) is still inline English and should move into the catalog before a second language ships.

## 4. Tests (all passing: 63)

| Required | Test |
|---|---|
| Band 1 win and loss | `normal bid scoring › Band 1 made / stopped` |
| Band 2 win and loss incl. 304 | `Band 2 made / stopped`, `304 bid made … stopped` |
| Step from 300 to 304 | `bidding › enforces the ladder … 300 to 304`, `bid ladder` |
| Coat success and failure, both bands | `Coat › Band 1 made 3 / Band 2 made 5 / Band 1 stopped 6 / Band 2 stopped 10` |
| Coat refused in last trick, accepted in second-to-last, every mode | `Coat timing with 2/3/4/6/8 players` |
| Challenge Coat success and failure | `Challenge Coat › made +6 / stopped +12` |
| Ask-to-reveal asked / not asked | `trump › when asked … / when nobody asks …` |
| Bidder plays trump without reveal | `trump › bidder plays a trump-suit card without revealing` |
| Host enabling and disabling video | server `video chat (host controlled)` |
| All five modes with bots | `full matches with bots in every mode` (11 configurations, randomized actions including Coat, Challenge Coat, ask and reveal; every round re-scored independently) |

Also covered: text chat rules, voice relay isolation, reconnects, mid-game seat takeover.

Run them with `npm test`.

## 5. Privacy and accessibility status

**Privacy (verified automatically).** After every action in every randomized match, each player's view is checked: it contains no other player's unplayed card, no hidden trump card, no trump suit (unless revealed or you are the bidder), and no card flagged as trump while trump is hidden. A separate test plays full matches over real websockets and inspects every payload each client receives, including the events.

**Accessibility (automated checks done; real screen-reader testing NOT yet done).**

- Done: axe-core scans of the intro, lobby with video on (phone size), chat, game table (both players), basket and settings show **no violations**. Two players completed rounds in Edge by keyboard and pointer, with the reduce-motion setting on for one of them. Both the in-game voice and the screen-reader live region received every announcement, in order.
- **Not done, and still required:** testing with TalkBack (Android), VoiceOver (iOS) and NVDA/JAWS (Windows) by a real screen-reader user. I can't run those screen readers. Please have a blind tester check at least:
  1. Start sequence: Start, Skip, and that clips don't overlap with the screen reader.
  2. Join by code, bid (including a Jaan bid and 304), pass, Challenge Coat.
  3. Hide trump, ask for trump, reveal trump as bidder, Coat (including the refusal message in the last trick).
  4. T / S / B readouts and the Won-Tricks Basket.
  5. Push-to-talk by double-tap (TalkBack/VoiceOver), mute, per-player volume.
  6. Text chat with dictation, and hearing new messages without game announcements being cut off.
  7. Video: host toggle, own camera toggle, camera labels.
  8. All four mixer sliders, and the three announcement modes.

## 6. Known limitations

- Video needs a direct connection between players. Audio falls back to the server relay, but video doesn't. Add a TURN server for players on mobile data.
- Built-in voice quality depends on the device's installed text-to-speech voices.
- Rooms live in server memory; a server restart ends games.
- Native store builds (Capacitor) are not produced yet; the game runs as a web app and PWA.

---

# Change Request V5 — delivered

Only the listed changes were made. Look, sound, voice and accessibility are unchanged; one "Round points" chip was added to the existing scoreboard bar to show the score line (change 3).

## What changed

1. **Early stop when the bid becomes impossible.** After each trick, if the bidding side's captured points plus all points still unplayed are below its bid, the round stops and scores as a normal stopped bid. Announced and shown: "Round stopped: Team B can no longer reach the bid of Jaan."
2. **Trump is the whole suit.** Every card of the trump suit counts as trump in every trick, whoever plays it and whether or not trump has been revealed yet. (The earlier setting "D3: only the bidder's hidden-trump cards count" is removed.) While trump is still hidden, other players' screens still do not mark a card as trump, so the hidden suit stays secret until the trick result.
3. **Score line after every trick.** Spoken and shown after each trick: "Round score: Team A 53, Team B 30. Team A needs 170." On screen in the "Round points" chip.
4. **Early stop when the bid is reached.** The round stops as soon as the bidding side has reached its bid and scores as a normal made bid (not a double).
5. **Failed Coat or Challenge Coat stops the round at once.** "Coat failed: Team A lost a trick. Round stopped." / "Challenge Coat failed: …".
- **While Coat or Challenge Coat is active, changes 1 and 4 are off.**
- **Coat:** only during play; trick 1 up to the second-to-last trick; only when the caller's side opens the trick, before any card of it is played; only if the caller's whole side has won every trick so far this round (automatically true in trick 1). Refusals are spoken and shown (caption strip and under the Coat button): "Coat refused: it cannot be called in the last trick" / "…your side has already lost a trick this round" / "…call it when your side opens a trick, before any card is played" / "…it can only be called during play".
- **Challenge Coat:** only during bidding; refused once play has started: "Challenge Coat refused: it can only be called during bidding, before play starts".
- Accepted Coat is announced "Coat accepted. Priya called Coat: Team A must win every remaining trick."

## Values kept from the build (as instructed)

- Challenge Coat: win 6, failure 12 (matches the CR's default understanding).
- Coat: Band 1 win 3 / failure 6; Band 2 win 5 / failure 10. The build gives the failure points **to the opponents** ("opponents +6"); the CR says this equals "they lose 6". Nothing was changed.
- Who may call Coat: the build allows the **bidding side only** (D1). Unchanged.

## Please confirm with Satya

1. **"Opens the trick" means the caller must be the player leading that trick.** With D1 (bidding side only), a Coat in trick 1 is therefore possible only when a bidding-side player leads trick 1 (this depends on the "first trick led by" setting).
2. **Changes 1 and 4 apply in every player mode** (2, 3, 4, 6 and 8 players), not only 4 players, because the CR's terms describe 4 players but the game supports all five modes.
3. **Whole-suit trump while hidden:** a player who does not know the trump suit yet can win a trick by discarding a card that happens to be trump. This follows change 2 literally.
4. **Early stop and Coat:** because the round stops as soon as a bid is reached, a side that reaches its bid early no longer gets the chance to call Coat later in that round.

## Tests

93 automated tests pass, including every CR v5 acceptance test: early stops (1, 4, 5), whole-suit trump (2), score line after every trick (3), Coat refused for an earlier lost trick (6), in the last trick (7), accepted when opening the second-to-last trick (8) and in earlier tricks (9) in all five player modes, refused during bidding (10), Challenge Coat only in bidding (11, 12), Coat and Challenge Coat failure and win scoring (13–16), and the spoken/written messages (17).

**Owner decision (25 Nov 2026): microphone off by default.** Everyone joins voice chat with the microphone off and turns it on with the Mic button (or M). Players can still hear everyone else straight away. Push-to-talk remains available in Settings.

## Issue 6 — Hidden trump indicator card (only change in this release)

- The bidder chooses trump by pointing at a card in their hand. **The card stays in the hand**, is counted in the hand size, and is played like any other card. Nothing is ever set face down or taken out of the hand.
- Everyone hears "X chose trump. It stays hidden." Only the bidder is told the suit and card privately.
- Until trump is revealed, no other device receives the trump suit by any route (view, events, speech, played-card flags). This is checked by engine and websocket tests.
- Trump is revealed when (a) a player with no card of the led suit asks for it, or (b) the bidder chooses to reveal on any of their turns. Either way it is announced to all.
- If trump is never revealed, it appears in the round summary.
- Removed: the face-down trump card, the "last card is the hidden trump" rule, and the old `bidderHiddenTrumpCounts` note (D3) from CR v5, which no longer applies.
- Acceptance tests 1–8 are covered in `packages/engine/test/engine.test.ts` ("Issue 6: trump indicator card").

## Issue 7 — Right of the bidder leads; hidden trump card known only to the bidder

- **Change 1:** the player to the bidder's right (the next seat in turn order) always leads trick 1, in every mode and every round. The lobby setting "First trick led by" was removed because it conflicted with this rule. Everyone hears "A is the bidder. B leads the first trick." From trick 2 the trick winner leads, as before.
- **Change 2:** the bidder places one card as the hidden trump card. Everyone hears "A has placed the trump card." Only the bidder sees the card: it is marked "Trump card" in their hand and named in their screen-reader text.
- The card stays in the bidder's hand count, so playing it looks like any other card. It is never labelled as trump, and playing it does not reveal trump. The bidder alone hears "You played your trump card. Trump stays hidden unless you reveal it."
- Trump is revealed only by the bidder's choice or by a valid ask from a player with no card of the led suit.
- **D1:** any card may be placed. **D2:** after a reveal, an unplayed placed card stays marked for the bidder only, until it is played.
- **Tests:** the Coat scoring tests now set the bidding side to open the trick directly, because in team modes that side no longer leads trick 1. The Issue 7 tests cover acceptance tests 1–8.

## Issue 8 — Bug fix: an unrevealed trump suit has no power

- Until trump is revealed, the trump suit is an ordinary suit for **every** player, including the bidder. A trump-suit card played off the led suit cannot win the trick; the highest card of the led suit wins (8.1–8.3, 8.7).
- Playing any card when you have no card of the led suit is still legal, including a trump-suit card, without revealing (8.4). Following suit is unchanged (8.5).
- To cut, trump must be revealed first: a non-bidder asks, or the bidder taps "Reveal trump" (8.6). A trump-suit card played *before* the reveal keeps no power, even if trump is revealed later in the same trick. Already-revealed trump works as before (8.8).
- The winner announcement, running score and next leader follow the corrected winner (8.9).
- This replaces the CR v5 behaviour ("trump-suit cards count even while hidden"). Help text and the "no card of the led suit" guidance were updated to match. Bots now reveal trump before cutting, as a human bidder must.
- Tests: "Issue 8: an unrevealed trump suit has no power" covers acceptance tests 1–8.

## Issue 9 — The Android app did not work

**Cause.** The APK did not contain the game: it was a shell that opened a fixed web address.
Version 1.0, which the website still served at `/downloads/trick304.apk`, opened an ngrok
tunnel that is now offline, so the app showed only an ngrok error page
(ERR_NGROK_3200). The 1.1 fix had been committed, but the site was never redeployed with it.

**Fix.** The app now carries the whole game inside the APK (web app, voice clips, tutorial
video). Only the live game connection goes to `https://trick304.live`
(`apps/web/.env.android`). Invite links still use the public address. The APK no longer
packs the previous APK inside itself (1.1 was 11.8 MB for that reason). Version 1.2.

**Checked.** A complete match was played in the installed APK on an Android 16 emulator
against the live server, with no crash and no console errors. Players with 1.0 or 1.1 need to
install 1.2 once. Still to do: a run on a real phone, with TalkBack.

## Issue 10 — Built-in game voice

The game now speaks with its own recorded clips: Azure neural voice Jenny, with excited,
cheerful and friendly styles. The clips ship inside the website and the APK. Device
text-to-speech is no longer used anywhere. Details: `docs/VOICE.md`.

- **This replaces DEFAULT 11.** The game voice is now **on for everyone by default**, with or
  without a screen reader. The screen-reader detection (`srDetect.ts`) is removed.
- Settings → Announcements → **Game voice** on/off, remembered on the device. Players who had
  chosen "Off" or "use my own screen reader instead" keep it off.
- No double speech: what the game voice says is not also sent to the screen reader. Anything the
  voice has no clips for (chat, free text) goes to the screen reader and the captions.
- Player-typed names can't be pre-recorded, so the voice says "Seat 3" (and "You"). Bots
  have recorded names. Text and captions keep the real names.
- The T / S / B readouts and chat stay text (screen reader and captions).
- Checked: full matches on the website (desktop Chromium, no screen reader) and in the APK,
  playing the clips in order; the off switch and that it survives a reload; offline playback in the
  APK (airplane mode). `npm test` checks that every announcement in randomized matches in
  every seat count can be said with the phrase book.

## Issue 11 — Video tutorial in How to Play

How to Play now opens with a **Video tutorial** section and a "Play the video tutorial"
button. The video plays inside the game, from files shipped with the website and the APK.
The controls are labelled buttons and sliders: Play/Pause, Back 10 s, Forward 10 s, Position
(read as "3 minutes 20 seconds of 17 minutes"), Mute, Volume and Full screen. Play, pause and
seek changes are announced to the screen reader. Videos sit in `apps/web/public/media/<lang>/`
(`tutorial.json` + the video file). The player's language is used, otherwise English.
