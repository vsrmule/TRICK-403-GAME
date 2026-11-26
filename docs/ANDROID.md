# Trick 304 — Android app (APK)

The Android app is a Capacitor wrapper around the live game site. It opens
`https://trick304.live` inside the app, so every update
to the website reaches app users immediately — no reinstall needed.

## What the app adds

- An installable app with the Trick 304 icon and splash screen.
- Microphone permission for voice chat and camera permission for video chat
  (asked only when a player turns their camera on).
- Works with TalkBack like the website.

## Download

Players download it from the website's home screen: **Get the Android app → Download APK**
(`/downloads/trick304.apk`). Android asks once to allow installing from the browser
("Install unknown apps"). iPhone users use the website in Safari or Chrome.

## Rebuild the APK

```powershell
cd D:\workspace\GAME
npm run build                       # build the web app
cd apps\web
npx cap sync android                # copy config and web build into the Android project
cd android
$env:JAVA_HOME = 'C:\Program Files\Android\Android Studio1\jbr'   # JDK 21
.\gradlew.bat assembleDebug --no-daemon
copy app\build\outputs\apk\debug\app-debug.apk ..\public\downloads\trick304.apk
cd ..\..\..; npm run build          # so the server serves the new APK
```

## Changing the server address

If the site moves (for example a paid ngrok domain or real hosting), change
`server.url` in `apps/web/capacitor.config.json`, run `npx cap sync android` and rebuild.

## Notes

- This is a **debug-signed** APK: fine for sharing with friends, not for the Play Store.
  For the Play Store, create a signing key and build `assembleRelease` / an app bundle.
- The app's user agent is `Trick304App/1.0`, which also stops ngrok's free-plan
  "Visit Site" warning page from appearing inside the app.
- Android's WebView has no built-in text-to-speech; with TalkBack on, game events go to
  TalkBack instead (automatic fallback).
