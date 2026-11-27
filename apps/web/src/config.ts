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
