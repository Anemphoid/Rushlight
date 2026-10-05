# Rushlight client

Electron + React (electron-vite) desktop client for Rushlight, a small
Ventrilo-style voice/text chat app. This repo is the **client only**. The
server (Node/Express, SQLite, JWT, LiveKit token minting) is its own public repo,
Anemphoid/Rushlight-Server; attach it with `add_repo` for any task that needs a
new endpoint or stored field. Never fake a server feature in the client. The
owner's server updates by git tag from that repo, so client work that depends on
a server change has to wait for a server release.

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
- Never pass a handler bare to `onClick` when it takes an optional parameter
  (`handleGoHome(notice)`): it receives the click event, the Home screen tries to
  render that object, React throws, and on the frameless transparent window it
  looks like the window vanished. Wrap it: `onClick={() => onHome()}`.
- `.screen` uses `justify-content: safe center`. Plain `center` on an overflowing
  flex column makes the top of the page unreachable by scrolling.
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

## Backlog (not built yet)

- **Admin Tools screen to list and revoke join codes.** The server (v0.2.0)
  already has `GET` / `DELETE /api/servers/:id/codes`. Revoking is the only way to
  remove a guest, since guests have no account to kick or ban.
- **Guest join screen should show the server's message** when a screen name is
  refused. The server answers 409 if the name matches an account or a live guest.
- **Client-only ideas the owner liked:** keyboard navigation in the channel tree,
  collapsible channels that remember their state, a system tray icon with
  close-to-tray, system-wide mute/deafen hotkeys (needs main-process work).
- **Needs a server change first** (do those in the server repo, then the client):
  real-time updates instead of polling, server-side unread counts, profile bio,
  status and banner color shown to other people, settings sync across machines.
