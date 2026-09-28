# Rushlight

Rushlight is a small, self-hosted voice and text chat app, built in the
spirit of old Ventrilo servers. You run the server yourself, so there's no
company sitting between you and your friends. Conversations disappear once
everyone leaves a room, unless the people who were in it vote to keep the
history.

## Why you might want this

It's for small groups: a family, a friend group, a guild, people who don't
need an app store full of bots and just want to talk. You keep the server on
your own hardware, so it's your data and your rules.

Push to talk works system wide, even when Rushlight isn't the focused
window, and open mic is there if you'd rather leave it on. You build your
own tree of servers, channels, and rooms, and decide which ones are voice,
text, or both.

## Features

- Servers, channels, and rooms, each set to voice, text, or both
- Chat that's ephemeral by default, with a vote to keep a room's history if
  everyone in it agrees
- System wide push to talk and open mic
- Invite codes scoped to one server, single use or reusable, with optional
  expiry
- Guest access with no account needed
- A self hosted server built with Node, Express, and SQLite
- A desktop client built with Electron, with automatic updates

## Status

This is alpha software. Voice, text, accounts, and invites all work today.
Check the roadmap below for what's coming, and the issues page for known
rough edges.

## Roadmap

Coming soon:
- Live participant lists in the channel tree (right now it refreshes every
  few seconds instead of updating instantly)
- Admin moderation: kick, mute, and ban
- Mic input volume control

Down the road:
- Database migrations, so updates stop requiring a fresh database
- End to end encryption
- Flatpak packaging

## Getting the app

Download the latest AppImage from the releases page, then run:

    chmod +x Rushlight-*.AppImage
    ./Rushlight-*.AppImage

The app checks for updates in the background and offers to install them
when one's ready.

## Running a server

This repository is only the client. The server is a separate piece, built
with Node, Express, and SQLite, that you run on your own machine. Its own
README covers setup.

## Building from source

    npm install
    npm run dev
    npm run dist

See RELEASING.md for how tagged releases get built and published.

## Project structure

    src/
      main/       Electron's main process: the window, the global push to talk hook, updates
      preload/    the secure bridge between main and the renderer
      renderer/   the React app, everything you see
    electron.vite.config.js   build tooling config
    electron-builder.yml      packaging config for the AppImage
