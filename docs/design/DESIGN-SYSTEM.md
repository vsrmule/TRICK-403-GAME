# Trick 304 — Design system and hand-off

Design brief (design only, no rules or server work), implemented in the live web app so every screen is high fidelity by construction. Screens, tokens and components map 1:1 to files in `apps/web`. Rules, scoring and server logic are unchanged.

## 0. Decisions that differ from the brief

1. **Announcement mode (brief §j asks for "in-game voice, screen reader, both; DEFAULT both").** Overridden by the product owner: "both" is removed because screen-reader users heard every event twice. The game voice is for screen-reader users only and switches on automatically when a screen reader is detected (no question is asked). Settings → *Game voice*: Automatic (DEFAULT), Always on, Off, Use my own screen reader instead.
2. **Light theme felt** stays deep green with light text on it; dark text is used everywhere else, as the brief says.
3. **Hand layout DEFAULT is "spread"** (rows grouped by suit with suit headings), because the headings give screen-reader and keyboard users the fastest navigation. "Fan" is a setting.

## 1. Tokens

Single source: `apps/web/scripts/themes.mjs` → generated `apps/web/src/theme.css` (`node apps/web/scripts/gen-theme.mjs`). Contrast is verified by `node apps/web/scripts/contrast.mjs` (fails the build if any pair drops below target). Full measured table: [contrast.md](contrast.md) — **72/72 pairs pass** (text ≥ 4.5:1, large text/UI ≥ 3:1, high-contrast text ≥ 7:1).

### Colour tokens (`--c-*`)

| Token | Role | Dark (DEFAULT) | Light | High contrast |
|---|---|---|---|---|
| `bg` | page background | #0A0F1C | #F5F1E8 | #000000 |
| `bg-glow` | background top glow | #14213D | #FFFDF7 | #000000 |
| `surface` | panels, chips | #121A2C | #FFFFFF | #000000 |
| `surface-2` | raised controls | #1A2440 | #EFE9DC | #000000 |
| `border` / `border-strong` | dividers / control edges | #2A3656 / #6B7AA3 | #D4CAB6 / #7A6E58 | #FFFFFF |
| `text` / `muted` | body / secondary text | #F3F5FA / #AEB8CE | #1A2030 / #4B5567 | #FFFFFF |
| `accent` | primary action fill, 304 identity | #F2C14E | #E3A92B | #FFE500 |
| `accent-edge` | primary action outline | #F2C14E | #7A4F00 | #FFE500 |
| `accent-ink` | gold text on surfaces | #F2C14E | #7A4F00 | #FFE500 |
| `on-accent` | text on gold | #1A1305 | #1A1305 | #000000 |
| `team-a` | Team A (cool cyan) | #4FD8EE | #006A7D | #FFFFFF |
| `team-b` | Team B (warm amber-coral) | #FF9F70 | #B03A0A | #FFE500 |
| `good` / `bad` | positive / negative | #62D99E / #FF8A94 | #17663F / #B3261E | #FFFFFF / #FFE500 |
| `focus` | focus ring | #8BE9FF | #0A5BD8 | #FFE500 |
| `felt` / `felt-deep` / `felt-text` | table | #0D4A47 / #082F2E / #D9F2EE | #1C6150 / #11443A / #F1FAF6 | #000000 / #000000 / #FFFFFF |
| `rim` / `rim-line` | table rim / gold hairline | #1C1712 / #B8953A | #3A2A1A / #E7BE5A | #FFFFFF |
| `card` / `card-edge` / `card-ink` | card face | #FBFAF6 / #C9CED8 / #141821 | #FFFFFF / #9AA1AE / #141821 | #FFFFFF / #FFFFFF / #000000 |
| `suit-spades/hearts/clubs/diamonds` | four-colour suits (DEFAULT) | #141821 / #C1121F / #0B6B3A / #1450B8 | same | all #000000 |
| `back-1/2`, `trump-back-1/2` | card back / hidden-trump back | violet stripes / gold check | same | black-white / black-yellow |

Key pairs (excerpt from [contrast.md](contrast.md)): dark text on bg **17.5:1**, muted on surface **8.7:1**, gold on surface **10.3:1**, on-accent on gold **11.0:1**, focus on surface **12.6:1**; light text on bg **14.4:1**, accent-ink on surface **7.1:1**; high contrast all text **21:1**, accent **16.5:1**.

### Type, space, shape, motion, size

| Token | Value |
|---|---|
| `--font-display` | Sora 600/700/800 (logo, headings, numbers) |
| `--font-body` | Atkinson Hyperlegible 400/700 (all body and card text; designed for low vision) |
| `--text-scale` | 1 – 2 (Settings → Text size 100–200%); everything is in `rem`, so the layout reflows instead of clipping |
| `--fs-xs/s/m/l/xl/xxl` | 13 / 15 / **17 (body, min 16)** / 20 / 26 / 36 px at 100% |
| `--space-1…7` | 4 / 8 / 12 / 16 / 24 / 32 / 48 px |
| `--radius-s/m/l` | 8 / 12 / 18 px |
| `--line` | 2 px (3 px in high contrast) |
| `--target` / `--target-gap` | 48 px minimum touch target / 8 px between targets |
| `--dur-1/2/3/4` | 120 / 240 / 400 / 800 ms (all 0.01 ms under reduce motion) |
| `--card-w/--card-h` | 4 × 5.6 rem (hand 4.75 × 6.65 rem, table 3.6 × 5 rem) |

### Iconography

Inline SVG, `aria-hidden`, always next to a text label: microphone (voice), speaker (game voice), star (effects), note (music); team shapes (circle = Team A, diamond = Team B); suit symbols ♠ ♥ ♣ ♦ plus suit letters S H C D.

## 2. Cards

- **Face** (`CardFace`, `ui.tsx`): rank + suit symbol + suit letter in the top-left and (rotated) bottom-right corners, large centre suit mark, optional point badge (Settings → *Show point values*, DEFAULT on). Suits are told apart by shape **and** letter, never colour alone. Two-colour suits available.
- **Label**: real text, e.g. "Jack of Spades, 30 points — Playable" / "— Disabled: Must follow led suit, Hearts" (real text, not `aria-label`, so voice-control users can say it).
- **Backs** (`CardBack`): violet stripes "Face-down card"; gold check "Hidden trump" (labelled).
- **States** (shape + text + colour): *Playable* — lifted 6 px, gold ring, "Play" tag. *Not playable* — hatched, greyed, "Can't play" tag. *Selected* — lifted 14 px, green ring, "✓ Selected" tag. *Just played* (table) — focus-colour ring + "Just played" tag. *Won* — enlarged, gold ring + "Won" tag. *Trump* — red "Trump" tag.
- **Sizing rule (fan)**: step = clamp(48 px, (container − card width) ÷ (cards per row − 1), card width + 6 px). If 48 px per card can't fit, the hand splits into two fans. Up to 12 cards always reachable; every card keeps ≥ 48 px of touchable width.

## 3. Components and states

| Component | File / class | States |
|---|---|---|
| Button (default, primary, warn, ghost, step, quick-bar) | `.btn` | default, hover, **focused** (3 px focus ring + 3 px offset), **pressed** (1 px down, darker), **disabled** (55% + dashed edge; with reason via `aria-disabled` + visible text, e.g. Coat), **error** (`.btn.error`) |
| Toggle | native checkbox `label.check` | on/off, focused, disabled |
| Slider | `Slider` in `Dialogs.tsx` | value + `aria-valuetext` "80 percent" |
| Stepper (spin button) | `Stepper` in `ui.tsx` | − / value / +; arrows, Page Up/Down, Home/End; `aria-valuetext` e.g. "Jaan 10 (210), Band 2"; ends disabled |
| Mode picker (radio cards) | `.mode-picker` | selected (3 px edge + ✓), focused, disabled (non-host) |
| Tabs | not used — sections with headings + "More settings" disclosure instead (fewer hidden states for screen readers) | — |
| Dialog | `Dialog` (`<dialog>` modal) | open/closed; focus trapped; Escape and Close button |
| Toast | caption strip (`Captions.tsx`) — persistent, not timed | current + previous line |
| Seat | `.seat-chip` (`Felt.tsx`), `.seat-row` (lobby) | turn ("Your turn"/"Their turn" + pulse), speaking ("Talking" + green ring), won, me, bot, away, mic off, dealer, bidder |
| Badge | `TeamBadge`, `.band-chip`, `.seat-badge`, `.felt-tag`, `.state-tag` | team A ● / team B ◆; Band 1 ▪ / Band 2 ◆ |
| Score chip | `.hud-chip`, `.score-box` | contract (gold), trump hidden (marked back) / revealed (suit card flips), timer urgent |
| Chat bubble | `.chat-list li` | own ("You:"), others, time |
| Video tile | `Tile` in `Video.tsx` | own (mirrored, "Your camera"), others ("Priya's camera"), connecting |
| Announcement strip | `CaptionStrip` | four channel indicators: Voice (who is talking), Game voice, Effects, Music — each icon + text + on/off |

## 4. Screens

All screens exist in **portrait phone (390), landscape phone (844×390), tablet (834) and desktop (1440)**: `docs/design/screens/<layout>-<screen>.jpg`. Theme variants: `desktop-light-*`, `desktop-high-contrast-*`, `phone-high-contrast-*`. Regenerate with `node apps/web/scripts/screens.mjs docs/design/screens`. axe-core: **0 violations on all 54 captures**.

| § | Screen | Files |
|---|---|---|
| a | Splash and start sequence (logo, credits as text cards, Skip) | `*-a-splash`, `*-a-credits` |
| b | Opening narration with transcript | `*-b-narration` |
| c | Home; Lobby (mode picker, bots, target, host controls) | `*-c-home`, `*-c-lobby` |
| d | Game table (seats for 2/3/4/6/8, trick area, hand, trump, bid name, dealer/bidder, turn, basket one tap) | `*-d-table` |
| e | Bidding panel (stepper, Band 1/2 text + shape, Challenge Coat) | `*-e-bidding` |
| f | Hand states and play controls (Coat with reason, Ask/Reveal trump) | `desktop-f-hand` |
| g | Trump moment "<name> asked for trump. Trump is <suit>." | `phone-d-table` (captured mid-moment) |
| h | Round / match result with plain-list breakdown; celebration for winning side only | `*-h-result` |
| i | Caption strip + full history | every screen (strip), `*-i-history` |
| j | Mixer (4 sliders), game voice, music | `*-j-settings` |
| k | Voice / video / text chat | lobby and table screens (panels below the table) |
| l | Settings: language, theme, text size, motion, haptics | `desktop-l-display` |

## 5. Motion spec

Every animation has a sound cue (`sfx.ts`) and a text event (caption strip + history; spoken when the game voice is on).

| Event | Visual | Duration | Sound cue | Reduce-motion alternative |
|---|---|---|---|---|
| Deal | hand cards rise in, staggered 45 ms | 400 ms + stagger | `deal` | cards appear instantly |
| Card played | card slides from the player's seat to the table | 350 ms | `play` | appears in place |
| Trick won | winning card enlarges + gold ring + "Won" tag; trick stays 1.8 s | 300 ms | `trickWin` / `trickLose` | ring + tag only, no scaling |
| Your turn | seat ring pulses (0.7 Hz, < 3 flashes/s), "Your turn" tag | 1.4 s loop | `turn` (+ haptic) | static ring + tag, no loop |
| Bid | bid bubble pops in at the seat | 240 ms | `bid` / `pass` / `coat` | appears instantly |
| Trump asked | centre panel with the text | 400 ms | `askTrump` | 200 ms fade |
| Trump revealed | suit card flips in the centre panel; trump chip card flips | 800 ms / 600 ms | `trump` | 200 ms fade, no flip |
| Round won | "Round won!" panel + confetti — **winning side only** (DEFAULT) | 400 ms + 1.8 s | `roundEnd` + `cheer` | fade, no confetti |
| Match won | "Match won!" panel, 6 s | 400 ms | `matchWin` | fade |

Nothing flashes more than three times per second. Reduce motion follows the device unless Settings → Motion is set otherwise.

## 6. Accessibility annotations

Global: skip link → main; landmarks `banner` (quick bar), `navigation` "Quick status", `main`, region "Captions and sound"; every control has a visible text name; focus ring 3 px, ≥ 3:1 on every surface; targets ≥ 48 × 48 px with 8 px gaps; no gesture-only actions (push-to-talk is hold **or** tap-to-toggle; every control works by keyboard). Live region: one polite `role=log`, used only when the player chooses "Use my own screen reader"; otherwise the game voice speaks and nothing is pushed to the screen reader (never doubled). Chat messages join the same polite queue after game announcements.

### Reading / focus order per screen

**a–b Start sequence**: 1 heading "Trick 304" · 2 Start · 3 Skip intro · 4 "Play this intro every time". During playback: current line (text) · Skip intro.

**c Home**: 1 Skip link · 2 Name · 3 Room code · 4 Join room · 5 Create private room · 6 Quick join · 7 Refresh list · 8 each public room's Join · 9 Settings · 10 How to play · 11 History.

**c Lobby**: 1 Skip link · 2 Quick bar: What now?, Mic, Chat, Settings, Help, Leave · 3 "Lobby" heading + status · 4 Fill seats and start / Start game (host) · 5 Share invite link · 6 Copy code · 7 per seat: Sit here / Add bot / Remove bot / Stand up · 8 Auto-assign teams · 9 Players (radio group, arrows) · 10 Short game checkbox (4 players) · 11 Play to: −, value, + · 12 More settings (disclosure) · 13 Video panel (if host enabled) · 14 Text chat · 15 History.

**d–h Table**: 1 Skip link · 2 Quick bar: What now?, Table, Score & bid, Basket, Mic, Push to talk (if on), Chat, Settings, Help, Leave · 3 Game status (round, contract, trump, scores — read, not focusable) · 4 Players list and Table list (screen-reader text equivalent of the visual table) · 5 Your move: instruction · bid stepper −/value/+ · Bid · Pass · Challenge Coat · Ask for trump · Reveal trump · Call Coat (with reason when refused) · Ready for next round · 6 Your hand: suit groups with headings, each card a button · 7 Game log · 8 Video · 9 Text chat · 10 History.

**i History dialog**: heading · Close · ordered list of all events (oldest first, with times).

**j/l Settings dialog**: heading · Close · Audio mixer (4 sliders, music, ducking) · Announcements (game voice, pace, language, read chat, instructions, test) · Start sequence · Voice chat (join/leave, push to talk, host video, per-person volume/mute) · Display (theme, text size, motion, hand layout, points, suit colours) · Gameplay (confirm play, focus hand, haptics).

**k Chat**: Video: heading · My camera toggle (`aria-pressed`) · tiles labelled "<name>'s camera". Text chat: heading · Turn on/off · message list ("Messages, n") · Message box (works with dictation; Enter sends) · Send.

## 7. Hand-off

- **Tokens** → CSS custom properties `--c-*`, `--font-*`, `--fs-*`, `--space-*`, `--radius-*`, `--dur-*`, `--target` (`theme.css`). Legacy aliases (`--bg`, `--panel`, `--gold` …) map onto them so existing styles keep working.
- **Theme switching** → `<html data-theme="dark|light|high-contrast" data-suits="four|two" data-motion="system|reduce|full" dir="ltr|rtl" style="--text-scale:1">` set from Settings in `App.tsx`.
- **Stylesheets** → `theme.css` (tokens) → `styles.css` (base) → `table.css` (table) → `design.css` (this design layer).
- **Components** → `ui.tsx` (CardFace, CardBack, TeamBadge, Stepper, Dialog), `Felt.tsx` (table, moments), `Table.tsx` (HUD, bidding, play controls, hand, results), `Lobby.tsx`, `Captions.tsx`, `Intro.tsx`, `Chat.tsx`, `Video.tsx`, `Dialogs.tsx` (Settings, Basket, Help).
- **Breakpoints** → phone ≤ 720 px (quick bar at bottom, captions at top, 5 buttons per row); landscape phone (landscape and height ≤ 560 px: table left, controls right, single-row quick bar); tablet 721–1023 px; desktop ≥ 1024 px (table height capped so table, move and hand stay in view).
- **RTL** → each language catalog declares `dir`; the layout uses logical properties for side borders and margins.

## 8. DEFAULTs (design)

1. Theme: light (owner decision; dark night table and high contrast in Settings).
2. Text size: 100% (setting up to 200%).
3. Motion: follow the device setting.
4. Hand layout: spread by suit (fan available).
5. Point values on cards: shown.
6. Suit colours: four-colour.
7. Haptics: on.
8. Encouraging celebration: winning side only.
9. Game voice: Automatic (screen-reader users only; owner decision replacing "both").
10. Music: off.
11. Video chat: off and hidden until the host enables it.
12. Text chat: off until a player or the host turns it on.
13. Push to talk: off (open mic); when on, hold or tap-to-toggle.

## 9. Not yet verified

- Real-device testing with TalkBack, VoiceOver, NVDA and JAWS (automated axe checks only).
- A right-to-left language (the layer is ready; no RTL catalog exists yet).
- Native Android/iOS wrappers (screenshots are from the web app at device sizes).
