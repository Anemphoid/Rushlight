# Rushlight

The real Alpha 2 client — React + Vite + Electron, replacing the single-file alpha
scaffold. This is the foundation everything else (channel tree, settings, accounts)
gets built on top of.

## One-time setup

```
npm install
```

## Every time you want to work on it

```
npm run dev
```

This launches the actual Electron window with hot-reload — edit any file under
`src/renderer/src` and see it update live, no manual restart needed. Edit
`src/main` or `src/preload` and it restarts automatically.

Right now it just shows a placeholder screen confirming the stack is wired up
correctly (React rendering, LiveKit's component library importing cleanly). That
placeholder is the very next thing to replace with the real channel tree UI.

## Building a real installer (for later, not needed yet)

```
npm run dist
```

Produces an AppImage under `dist/` using the config in `electron-builder.yml`. This
won't fully work until there's a real GitHub repo connected for the `publish`
config to point at — fine to ignore until distribution actually becomes relevant.

## Project structure

```
src/
  main/       Electron main process — window creation, app lifecycle
  preload/    Preload script — the secure bridge between main and renderer
  renderer/   The actual React app — this is where the UI gets built
    src/
      App.jsx       Root component (currently a placeholder)
      main.jsx       React mount point
electron.vite.config.js   Build tooling config — rarely needs touching
electron-builder.yml       Packaging config — AppImage, Flatpak, GitHub Releases
```

## What's verified working right now

- `npm install` resolves cleanly, no version conflicts
- `electron-vite build` succeeds — main, preload, and renderer all compile
- LiveKit's React component library (`@livekit/components-react`) imports and
  bundles correctly — confirmed at build time, not just assumed compatible

## What's not built yet

Everything from here is real feature work: the channel tree UI, the settings page,
login/accounts, admin tools. This scaffold is deliberately just the foundation —
nothing about the actual product exists inside `App.jsx` yet.
