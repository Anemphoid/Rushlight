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
