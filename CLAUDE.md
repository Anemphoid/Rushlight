# Rushlight client

Electron + React (electron-vite) desktop client for Rushlight, a small
Ventrilo-style voice/text chat app. This repo is the **client only**. The
server (`rushlight-server`: Node/Express, SQLite, JWT, LiveKit token minting)
is a separate project and is deliberately unpublished until beta. Anything
that needs server changes (new endpoints, stored fields) can't be done here;
say so rather than faking it.

## Commands

- `npm install`, `npm run dev` (dev defaults to a localhost server)
- `npm run build` (the check to run before committing; there is no lint or
  test script)
- `npm run dist` builds the AppImage. Releases are made by pushing a `vX.Y.Z`
  tag; see `RELEASING.md`.

## Layout

- `src/main/` Electron main process: frameless transparent window, IPC for
  window controls, global PTT key hook (`uiohook-napi`, lazy-loaded with a
  window-focused fallback), auto-updater, server config
  (`defaults.js` + `server-config.json` in userData).
- `src/renderer/src/api.js` all backend calls. `App.jsx` owns state that must
  survive navigation (servers, tree, open chat, admin flag). Screens are in
  `screens/`, shared pieces in `components/`.
- `voice.js` the single LiveKit connection, kept **outside React** so opening
  Settings/Profile doesn't drop a call. Components use
  `subscribe`/`getSnapshot`. PTT starts muted, open mic stays live. Mic input
  gain is a Web Audio GainNode track processor, attached only when gain is
  off 100%, and it falls back to the raw mic on any failure.
- `unread.js` unread dots and desktop notifications, also outside React. "Read"
  is the newest message id seen per space (localStorage); new spaces are
  baselined so old history never shows as unread. The tree's 5s poll checks
  closed text spaces (persistent ones, or ephemeral ones with someone in them).
- Who is speaking/muted shows on the channel tree rows (matched to LiveKit
  participants by display name), not in the voice panel. Per-person volume
  (right-click someone in your voice space) is keyed by name and is a 0-100%
  share of the output volume. Mute/deafen live in `voice.js` and gate PTT.
- `sounds.js` loads sounds by base name from `assets/sounds/` (missing = silent).

## Gotchas learned the hard way

- The CSP in `src/renderer/index.html` matters. `connect-src` needs the bare
  schemes (`http: https: ws: wss:`), not `http://*`, which is silently
  ignored. `img-src` and `media-src` are needed for avatars and sounds.
  Test CSP-sensitive changes by running the app.
- Release AppImage filename must stay version-less (`Rushlight.AppImage`) or
  electron-updater breaks fixed-path launchers on update.
- No `window.prompt()`/native dialogs in Electron; use inline forms/confirms.
- Stop click propagation on nested buttons (the tree's `+`/`x`) or the row
  underneath opens too.
- A resumed `AudioContext` is required for sound to play.
- The repo is public; never commit secrets, keys, or personal network details
  beyond what `defaults.js` already has.

## Product decisions already made

- No emojis in the UI (text labels like `v`/`t`/`v-t`, `mic`/`out`).
- No fake or mock participants. Test with real connections.
- Servers are permanent; accounts belong to many servers via server-scoped
  join codes; guests join with a code and get a narrow voice-only token.
- Ephemeral spaces wipe after 10s empty (server-side presence). Switching to
  persistent needs a majority vote of people who have written there.
- Density drives root font-size (rem everywhere). Four palettes: Parchment and
  Cool Slate, each dark/light, via CSS variables.
- Beta requires: working between two people on separate networks (done once),
  migrations (done), admin moderation (kick/mute/ban), published server docs.
- Social features (friends, DMs) are deferred; avatars only for now.
- Prefer one change per pass so a break can be attributed.

## Working style

Commit to the assigned feature branch, don't open PRs unless asked. Real
audio, the global key hook and the GUI can't be verified in the cloud sandbox;
flag those as untested for the owner to try on their desktop.

## Where we left off (temporary: delete this section after the server migration)

- **Client v0.4.0 is released** but nobody has run its new features on a desktop
  yet: mic input gain (check PTT still works after moving the slider), per-person
  volume (right-click someone in your voice space), mute/deafen, unread dots and
  desktop notifications, speaking/muted markers in the tree, ping and connection
  quality, and the sticky Settings back button. Ask the owner what they saw.
- **The server moved to its own public repo, Anemphoid/Rushlight-Server** (attach
  it with `add_repo` if a task touches the server). v0.2.0 is released there, but
  the owner's server machine still runs the old zip version. They will migrate it
  when they have a terminal (docs/migrate-existing-install.md in the server repo).
  Until then the client talks to the old server, which lacks the new code
  list/revoke endpoints.
- **After the migration:** a client screen in Admin Tools to list and revoke join
  codes (`GET` / `DELETE /api/servers/:id/codes`). Revoking is the only way to
  remove a guest. Also note guests now get a 409 if their screen name matches an
  account, so make sure the guest join screen shows the server's message.
- **Other ideas the owner liked:** profile banner color, system tray icon,
  keyboard navigation in the channel tree, collapsible channels, mute/deafen
  hotkeys (needs main-process work).
- **Loose end:** the owner thought the Settings page's vertical centering had
  been fixed in a newer local version, but that fix is not in this repo. Ask
  whether they have unpushed commits.
