/**
 * Where the game lives.
 *
 * The website is served by the game server itself, so both default to the page's own origin.
 * The Android app carries the web app inside the APK (origin https://localhost) and is built
 * with `--mode android` (see .env.android), which points it at the public game server.
 */
const env = import.meta.env;

/** Socket.IO server; undefined = same origin as the page. */
export const SERVER_URL = (env.VITE_SERVER_URL as string | undefined) || undefined;

/** Public address of the website, used for invite links people open on other devices. */
export const PUBLIC_URL = ((env.VITE_PUBLIC_URL as string | undefined) || window.location.origin).replace(/\/$/, '');

declare const __APP_VERSION_CODE__: number;
declare const __APP_VERSION_NAME__: string;

/** Version of the Android app this build belongs to (android/app/build.gradle). */
export const APP_VERSION = { code: __APP_VERSION_CODE__, name: __APP_VERSION_NAME__ };

/**
 * Game features this client can show, told to the server on connect. The server uses it
 * to keep older installed apps working: 1 = Self Coat and the Stop / Continue choice.
 * (Apps from before this had no number, i.e. 0.)
 */
export const CLIENT_FEATURES = 1;
