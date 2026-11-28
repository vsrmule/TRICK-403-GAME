# Trick 304 — Android app (APK)

The Android app is a Capacitor app that **carries the whole game inside the APK**: the web
app, the built-in voice clips and the tutorial video. Only the live game connection goes to
the server, `https://trick304.live`. The game screens, voice and video therefore load
from the phone itself, and the app no longer depends on a web address staying the same.

(Up to version 1.1 the app was an empty shell that opened a web address. Version 1.0 pointed
at an ngrok tunnel that went offline, which is why the app stopped working. Phones with
1.0 or 1.1 installed need to install the new APK once.)

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
cd D:\workspace\GAME\apps\web
npm run build:android               # web app for the APK -> dist-android (game server: .env.android)
npx cap sync android                # copy it into the Android project
cd android
$env:JAVA_HOME = 'C:\Program Files\Android\Android Studio1\jbr'   # JDK 21
.\gradlew.bat assembleDebug --no-daemon
copy app\build\outputs\apk\debug\app-debug.apk ..\public\downloads\trick304.apk
cd ..\..\..; npm run build          # so the server serves the new APK
```

Raise `versionCode` / `versionName` in `android/app/build.gradle` for each release. That is the
only place: the app carries the number built in, and the website build publishes it at
`/downloads/version.json`.

## How players get updates

From version 1.4 the app checks `/downloads/version.json` at launch, when it comes back to the
foreground, and every 30 minutes. When the website has a newer APK it shows (and announces)
"A new version of Trick 304 is available" with **Download update**, which opens the APK in the
phone's browser; installing it over the app keeps the player's settings. Apps older than 1.4
can't show this, so those players need to download the new APK once by hand.

Older apps that can't show newer game choices keep working: each app tells the server which
features it supports, and for an app from before the Stop / Continue choice the server chooses
Stop for it (the earlier behaviour) and tells the table.

## Changing the server address

Edit `apps/web/.env.android` (`VITE_SERVER_URL` = game server, `VITE_PUBLIC_URL` = the
address used in invite links), then rebuild the APK as above.

## Notes

- This is a **debug-signed** APK: fine for sharing with friends, not for the Play Store.
  For the Play Store, create a signing key and build `assembleRelease` / an app bundle.
- `npm run build:android` leaves out `public/downloads`, so the APK never contains an
  older APK.
- The app's user agent ends in `Trick304App/1.2` (the normal Android WebView agent comes first).
