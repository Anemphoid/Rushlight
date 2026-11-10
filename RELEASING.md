# Releasing Rushlight

Installed copies of Rushlight (the AppImage) check for a new version shortly
after launch and every few hours. When one has been downloaded, a small banner
offers "Restart to update"; otherwise it installs the next time the app closes.

## Publish a new version

1. Commit your changes to `main` and push.
2. Tag the version and push the tag:

       git tag v0.1.1
       git push origin v0.1.1

3. GitHub Actions (the **Release** workflow, ~5 minutes) builds the AppImage and
   publishes it, plus `latest-linux.yml`, to a GitHub Release. Progress is under
   the repo's **Actions** tab. The version comes from the tag, so there is no
   need to edit `package.json`.

Versions must go up (0.1.1, 0.2.0, ...). Installed apps only offer versions
newer than the one they're running.

## Windows

The same tag also builds a Windows installer (the Release workflow's `windows` job, after the Linux one) and publishes
`Rushlight-Setup.exe` and `latest.yml` into the same GitHub Release. It installs for the current person (no administrator
step) and updates itself like the AppImage. Windows 10 and 11, 64-bit.

**Not signed yet.** There is no code-signing certificate, so Windows shows "Windows protected your PC" (SmartScreen) the first
time: **More info**, then **Run anyway**. The download page will say this with a picture. Buying a certificate removes it later.

On every pull request the CI `windows` job builds the program and the installer, installs it and starts the real app
(`scripts/electron-smoke.mjs`). `npm run dist:win` builds the installer on a Windows computer.

## Try the packaged app without publishing

    npm install
    npm run dist

Produces `dist/Rushlight-<version>.AppImage`. Run it with `chmod +x` and
execute it. This build has no update feed, which is fine for testing.

## Things that have to be true

- **The repo must be public** for in-app updates to work. electron-updater's
  GitHub mode can't read a private repo without embedding a token in the app.
  (Private source is possible with the `generic` provider and a web server for
  the release files; ask before switching.)
- **The sounds ship inside the project** in `src/renderer/src/assets/sounds/`
  (seven files: self-join, self-leave, other-join, other-leave, room-switch,
  ptt-on, ptt-off). To change one, replace the file with the same name. They're
  bundled at build time.
- Packaged builds default to the server in `src/main/defaults.js`. Change it
  there, or per machine in `server-config.json` in the app's config folder.
