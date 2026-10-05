# Rushlight

Rushlight is a small, self-hosted voice and text chat app, built in the
spirit of old Ventrilo servers. You run the server yourself, so there's no
company sitting between you and your friends. Conversations disappear once
everyone leaves a room, unless the people who were in it vote to keep the
history.

This repository is the desktop client. The server is its own repository:
[Rushlight-Server](https://github.com/Anemphoid/Rushlight-Server).

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
- System wide push to talk and open mic, mute and deafen, and a mic input
  volume control
- Per person volume: right click someone in your voice room to turn them up or
  down
- See who is talking and who is muted right in the channel tree, plus your
  connection's ping and quality
- Unread dots on text rooms, with optional desktop notifications
- Custom avatars
- Invite codes scoped to one server, single use or reusable, with optional
  expiry
- Guest access with no account needed
- Admin tools: kick, ban, mute, and timed access
- Four looks: Parchment and Cool Slate, each in dark and light
- A desktop client built with Electron, with automatic updates

## Where things stand

Rushlight is still labelled alpha. Three of the four things it was waiting on
for beta are in place:

- Working between two people on separate networks. It has been confirmed that
  way, though only by a very small group so far.
- Database migrations, so an update no longer means wiping the database.
- Admin moderation: kick, ban, mute, and timed access.

The fourth, the server published with setup docs that don't assume my own
hardware, is partly done. The server is published and documented, but you also
have to install and configure LiveKit (the voice engine) yourself. There is a
basic guide for that, and bundling LiveKit into the server's setup, so one install
does both, is planned and not built yet.

Self-hosting is possible today, but it takes more setup than it should, and it is
new, so expect rough edges.

## Encryption

Nothing in Rushlight is end to end encrypted yet.

- Passwords are stored hashed, never in plain text.
- Chat messages are stored as plain text in the server's database, so whoever
  runs the server can read them. Ephemeral rooms are deleted when everyone
  leaves, but that is deletion, not encryption.
- Voice goes through your LiveKit server, which can access it.
- The server speaks plain HTTP. If it is reachable over the internet, put it
  behind a reverse proxy that provides HTTPS, such as Caddy.

End to end encryption is planned for after beta. That plan has not changed.

## Roadmap

After beta (unchanged):
- Live participant lists in the channel tree (right now it refreshes every
  few seconds instead of updating instantly)
- End to end encryption
- Flatpak packaging

Also on the list: a screen for admins to see and revoke invite codes, and a few
smaller interface ideas.

## Getting the app

Download the latest AppImage from the releases page, then run:

    chmod +x Rushlight.AppImage
    ./Rushlight.AppImage

The app checks for updates in the background and offers to install them
when one's ready.

The first time it runs, it connects to an address that belongs to my own private
network, which won't work for you. Point it at your own server first, as
described below.

## Running a server

You need three things: this client, the
[Rushlight server](https://github.com/Anemphoid/Rushlight-Server), and a
[LiveKit](https://livekit.io) server for the voice. LiveKit is a separate program
and is **not bundled** with the Rushlight server, so you install and configure it
yourself. The server's README walks through setting up the server, running it as
a service, and updating it from tagged releases with automatic rollback if an
update fails, and it links a basic LiveKit setup guide.

Then tell the client where your server is:

1. Run the app and try to sign in. It will say it can't connect, but that
   writes a file called `server-config.json` into the app's config folder (on
   Linux, under `~/.config/`, in a folder named Rushlight or rushlight).
2. Quit the app, open that file, and set the address of your server:

       { "serverUrl": "http://your-server:4000" }

3. Start the app again and create an account.

A few things worth knowing:

- Anyone who can reach your server can create an account, but nobody can see a
  server's channels without one of its invite codes. Keep the server on a private
  network, such as a VPN, unless you mean to open it up.
- Every person who uses your server points their client at it the same way.
- The server and the client update separately, so check the release notes of
  both when you update either one.

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

## License

Business Source License 1.1. See LICENSE.
