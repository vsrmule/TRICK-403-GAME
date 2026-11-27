# Trick 304 — Built-in game voice

The game speaks with its own recorded voice. It works the same on the website (computers
and phones, including iPhone) and in the Android app, with or without a screen reader, and
needs no device text-to-speech and no internet voice service while playing. The clips are
plain audio files shipped inside the website and the APK.

## How it works

- Every announcement has two forms: **text** (captions, game log, screen reader) and a
  **voice script**, a list of phrase references such as `bid {who: s3, bid: 200}`
  (`packages/engine/src/voiceScript.ts`).
- The **phrase book** `apps/web/public/voice/<lang>/phrases.json` gives the wording of every
  phrase, split into chunks, plus the spoken text of every slot value (seats, bots, cards,
  bids, numbers). It is generated from `apps/web/scripts/voice/phrases-en.py`.
- Each chunk with its slot filled in is one audio clip:
  `public/voice/<lang>/clips/<id>.mp3`, where `<id>` is a hash of the speaking style and
  the words. `clips/index.json` lists the clips that exist.
- The game (`apps/web/src/gameVoice.ts`) works out the clips for each announcement and
  plays them one after another. Anything it has no clips for (chat messages, free text)
  goes to the screen reader and the captions instead, so nothing is heard twice.
- Player-typed names can't be recorded, so the voice says **"Seat 3"** for a person and
  **"You"** for yourself; bots have recorded names ("Bot Asha"). The text keeps real names.

## Settings

Settings → Announcements:
- **Game voice** on/off (on by default, remembered on the device). Off: announcements go
  to the screen reader and the captions only.
- **Announcement pace** (Slow / Normal / Fast / Very fast; pitch is kept) and the
  **Game announcements** volume slider.
- **Test announcement** plays a sample.

## Making or changing the clips (Azure Speech)

The English clips use Azure neural voice `en-US-JennyNeural` with the `excited`,
`cheerful` and `friendly` speaking styles (set per phrase in `phrases-en.py`).
The free tier (F0) is enough: all clips are about 35,000 characters, and F0 allows
500,000 a month. Audio made with a paid or free Azure Speech resource belongs to you
and may be used commercially.

1. Azure portal → create a **Speech service** (Free F0) → **Keys and Endpoint**.
2. In PowerShell (once): `setx AZURE_SPEECH_KEY "<key 1>"` and
   `setx AZURE_SPEECH_REGION "<location, e.g. centralindia>"`, then open a new window.
3. From `D:\workspace\GAME`:
   ```powershell
   python apps/web/scripts/voice/phrases-en.py              # only after changing wording
   npx vite-node apps/web/scripts/voice/generate.ts -- en   # renders missing clips
   ```
   It renders only clips that don't exist yet, so changing a few phrases renders only
   those, and an interrupted run continues where it stopped. All 1,308 clips take about
   75 minutes on F0 (20 requests a minute). `--dry-run` lists what would be rendered.
4. Rebuild the website and the APK (see `ANDROID.md`) and deploy.

## Adding a language

1. Copy `phrases-en.py` to `phrases-<code>.py`, translate the wording and the slot texts
   (keep the ids and slot keys), set the output folder to `voice/<code>`, and pick a
   voice for that language (Azure voice list: https://learn.microsoft.com/azure/ai-services/speech-service/language-support).
2. Run it, then `npx vite-node apps/web/scripts/voice/generate.ts -- <code>`.
3. The game picks the folder that matches the player's language and falls back to
   English. No code changes are needed for the voice. (The on-screen text of a new
   language is a separate catalog in `packages/engine/src/i18n.ts`.)

## Tests

`npm test` plays randomized full matches in every seat count and checks that every
announcement and every turn-by-turn instruction can be said with the phrase book.
