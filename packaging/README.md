# Packaging: Microsoft Store, Flatpak and NixOS

## Microsoft Store (Windows x64)

The Windows release job builds the usual NSIS installer, then separately
packages an unsigned AppX with FaamOffice's Partner Center identity. Download
the `faamoffice-store-appx` workflow artifact and upload its `.appx` to Partner
Center. Store packaging is best effort and does not block the other release
artifacts; the AppX never enters GitHub Releases or the desktop update feed.

On a Windows build machine, after preparing the normal release dependencies:

```sh
npm run dist:win:store -w @genoffice/shell
```

This command sets Store mode and writes to `apps/shell/release/store/`. It
packages x64 only; leave `GENOFFICE_WIN_ARM64` unset. Store identity and listing
metadata live in `apps/shell/electron-builder.cjs`, and tile assets are generated
from the logo with `node tools/gen-appx-assets.mjs`.

The Store install opens its Store listing for updates, omits login-item and
CLI-on-PATH registration, and opens Windows Default apps using its packaged
AUMID. The ordinary installer retains its existing behavior. Validate the AppX
on Windows and complete Partner Center review before enabling the website's
Microsoft Store badge in Admin → Settings.

## Linux packaging

The release pipeline publishes AppImage, deb and rpm artifacts (see
`apps/shell/electron-builder.cjs`). This directory adds two community-maintained
routes requested in genoffice#1858. Both wrap the published release artifacts —
they do not rebuild the Electron/Rust source tree — so they track the official
binaries bit for bit.

These files are provided as-is and are not exercised by CI; verify them on a
real system before relying on them.

## Flatpak

`flatpak/com.faamoffice.app.json` installs the deb via the Flatpak `extra-data`
mechanism: flatpak downloads the pinned deb from GitHub Releases at install
time (size + sha256 verified), and the first launch unpacks it into
`/app/extra/app` (`apply_extra`, plain Python 3) and starts it through Zypak,
which ships in `org.electronjs.Electron2.BaseApp` and adapts Electron's own
sandbox to the Flatpak sandbox.

Build and install locally from a repo checkout:

```sh
flatpak remote-add --if-not-exists flathub https://dl.flathub.org/repo/flathub.repo
flatpak install flathub org.freedesktop.Sdk//24.08 org.electronjs.Electron2.BaseApp//24.08
flatpak-builder --user --install --force-clean build-dir packaging/flatpak/com.faamoffice.app.json
flatpak run com.faamoffice.app
```

Notes:

- File type associations, the icon set and the desktop entry come from the repo
  (`apps/shell/build/icons`); the deb's payload only provides the app itself.
- The bundled `faamoffice` command line works inside the sandbox, e.g.:
  `flatpak run --command=/app/extra/app/opt/FaamOffice/resources/cli/faamoffice com.faamoffice.app --help`
- The deb carries an in-app updater feed baked for the native install layout;
  under Flatpak `/app` is read-only, so updates must go through Flatpak, not
  the app's update dialog.
- The manifest pins v0.11.0. On a new release, update the `url`, `sha256` and
  `size` of the `extra-data` source (and the `<release>` entry in
  `com.faamoffice.app.metainfo.xml`); the `x-checker-data` block lets the
  Flathub bot propose the new URL automatically.

## NixOS

`nix/genoffice.nix` wraps the upstream AppImage with `appimageTools` (no source
rebuild), installs the repo's icon set plus a desktop entry, and declares the
two libraries Electron dlopens from the host (`libsecret` for keyring-backed
API-key storage, `nss`):

```sh
nix-build packaging/nix
./result/bin/faamoffice
```

The expression reads the repo's icon files, so run it from a repo checkout. On
a new release, bump `version` and the `hash` in `nix/genoffice.nix`.

Known caveat: the nix store is mounted `nosuid`, so Chromium can abort with
"The SUID sandbox helper binary was found, but is not configured correctly"
when the AppImage's `chrome-sandbox` is present but not setuid. In that case
launch with `faamoffice --no-sandbox` (the flag passes through the wrapper); the
Flatpak route keeps the real sandbox via Zypak instead.
