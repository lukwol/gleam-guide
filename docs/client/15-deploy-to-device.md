# Deploy to Device

The app runs in dev on simulators and emulators — but `localhost:8000` is hardcoded. That breaks on physical devices, where the server isn't reachable at `localhost`, and it breaks in production builds, where the server lives behind a real domain. This chapter fixes the URL logic, then takes the app through production builds on simulators, emulators, and real devices[^1].

Six files change, three are new:

```sh
doable/
└── client/
    ├── src-tauri/
    │   ├── capabilities/
    │   │   └── default.json           # production URL allowlisted         [!code highlight]
    │   └── tauri.conf.json            # iOS team ID                        [!code highlight]
    └── src/
        ├── api.gleam                  # platform + mode + host URL logic   [!code highlight]
        ├── mode.gleam                 # Development / Production           [!code ++]
        └── vite/
            ├── env.gleam              # MODE + TAURI_DEV_HOST externals    [!code ++]
            └── env_ffi.js             # import.meta.env bridge             [!code ++]
```

## Reading Vite's Environment

Vite exposes build-time variables through `import.meta.env`. Two of them are useful here: `MODE` tells whether Vite built for development or production, and `TAURI_DEV_HOST` is set by the Tauri CLI when the dev server needs to bind to a LAN address (for physical devices).

`env_ffi.js` reads both:

```js
// client/src/vite/env_ffi.js

import { Some, None } from "../../gleam_stdlib/gleam/option.mjs";

export function mode() {
  return import.meta.env.MODE;
}

export function tauri_dev_host() {
  const host = import.meta.env.TAURI_DEV_HOST;
  return host ? new Some(host) : new None();
}
```

`env.gleam` exposes them as typed Gleam externals:

```gleam
// client/src/vite/env.gleam

import gleam/option.{type Option}

@external(javascript, "./env_ffi.js", "mode")
pub fn mode() -> String

@external(javascript, "./env_ffi.js", "tauri_dev_host")
pub fn tauri_dev_host() -> Option(String)
```

## Build Mode

`mode.gleam` maps the raw `MODE` string to a typed value:

```gleam
// client/src/mode.gleam

import vite/env

pub type Mode {
  Development
  Production
}

pub fn mode() -> Mode {
  case env.mode() {
    "production" -> Production
    _ -> Development
  }
}
```

Vite sets `MODE` to `"production"` for `bun run build` and `bun tauri build`; everything else — `bun run dev`, `bun tauri dev`, `bun tauri ios dev`, `bun tauri android dev` — is `"development"`.

## Resolving the API Base URL

`api_base_url()` now branches on platform, mode, and whether `TAURI_DEV_HOST` is set:

```gleam
// client/src/api.gleam

fn api_base_url() -> String {
  case platform.platform(), mode.mode(), env.tauri_dev_host() {  // [!code highlight]
    Browser, _, _ -> browser.window_location_origin()             // [!code highlight]
    _, Development, Some(host) -> "http://" <> host <> ":8000"   // [!code highlight]
    _, Development, None -> "http://localhost:8000"               // [!code highlight]
    _, Production, _ -> "https://your-domain.com"                 // [!code highlight]
  }
}
```

- **Browser** — `window.location.origin` works in any browser context, dev or production, because the Caddy proxy is there to forward `/api`.
- **Development + host set** — Tauri sets `TAURI_DEV_HOST` to the machine's LAN IP when targeting a physical device. The server needs to be reachable on that address, not just `localhost`.
- **Development + no host** — simulator and emulator both share the host network, so `localhost:8000` reaches the server directly.
- **Production** — replace `https://your-domain.com` with the address of your deployed server.

The production URL also needs to be added to the HTTP capability allowlist — requests to unlisted URLs are blocked:

```json
// client/src-tauri/capabilities/default.json

{
  "identifier": "http:default",
  "allow": [
    { "url": "http://localhost:8000/**" },
    { "url": "https://your-domain.com/**" }  // [!code ++]
  ]
}
```

## iOS Setup

Distributing to a simulator or device requires an Apple Developer team ID. Add it to `tauri.conf.json` under `bundle.iOS`:

```json
// client/src-tauri/tauri.conf.json

{
  "bundle": {
    "iOS": {                                         // [!code ++]
      "developmentTeam": "YOUR_APPLE_TEAM_ID"        // [!code ++]
    },                                               // [!code ++]
    ...
  }
}
```

Find your team ID in [Apple Developer](https://developer.apple.com/account) under **Membership Details**. With this set, `bun tauri ios build` handles signing automatically — no manual certificate management needed.

Before distributing, swap the bundle identifier in `tauri.conf.json` for your own reverse-domain value. Both iOS and Android pick it up from that one field — it was set to `com.lukwol.doable` back in chapter 12 as a placeholder.

## Running on iOS Simulator

For a dev build on the simulator, `bun tauri ios dev` from chapter 13 still works. For a production build:

```sh
cd client
bun tauri ios build --target aarch64-sim
```

This compiles a release build for Apple Silicon simulators. Install it on the booted simulator:

```sh
xcrun simctl install booted src-tauri/gen/apple/build/arm64-sim/Doable.app
```

The app then appears on the simulator's home screen — tap it to open, or remove it the same way as on a real device.

::: tip Simulator needs `.app`, device needs `.ipa`
`--target aarch64-sim` produces a `.app` bundle for the simulator. Physical devices require a signed `.ipa` — using the simulator build on a device won't work.
:::

## Running on an iOS Device

Connect a device and run in dev mode:

```sh
cd client
bun tauri ios dev
```

Tauri detects the physical device, sets `TAURI_DEV_HOST` to the machine's LAN IP, and starts Vite bound to that address. The `Development + Some(host)` branch in `api_base_url()` kicks in — API requests go to `http://<LAN IP>:8000` instead of `localhost`.

For a production build:

```sh
bun tauri ios build
```

List connected devices to find the UDID:

```sh
xcrun devicectl list devices
```

Then install:

```sh
xcrun devicectl device install app --device <DEVICE_UDID> \
  src-tauri/gen/apple/build/arm64/Doable.ipa
```

## Running on Android Emulator

Create and manage AVDs through Android Studio's **Device Manager** — no CLI needed. Once an emulator is running:

```sh
adb devices
```

This confirms the emulator is connected. For a dev build, `bun tauri android dev` from chapter 13 still applies. To produce a standalone APK you can install directly on the emulator:

```sh
cd client
bun tauri android build --apk --debug
```

`--debug` uses the local debug keystore to sign the APK, which lets it install without any extra setup. Dropping the flag produces a proper release build instead, but that APK has to be signed with a release keystore before it'll install anywhere — [Signing for Distribution](#signing-for-distribution) below walks through that.

```sh
adb install -r \
  src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk
```

The app appears in the emulator's launcher — tap it to open, or remove it the same way as on a real device.

::: tip `.apk` for the emulator, `.aab` for the Play Store
Without `--apk`, `bun tauri android build` also produces an AAB (Android App Bundle) — the Play Store's distribution format, but not installable via `adb`.
:::

::: warning Release builds block cleartext HTTP
Android release builds disallow plain HTTP by default. The `Production` branch in `api_base_url()` must point at an HTTPS URL — `http://your-domain.com` will be blocked. For local testing, use a tunneling tool (Tailscale, Cloudflare Tunnel, ngrok, or similar) to expose the local server over HTTPS.
:::

## Running on an Android Device

Connect a device over USB and enable USB debugging in the developer options. List connected devices to confirm it shows up alongside any running emulators:

```sh
adb devices
```

Run in dev mode:

```sh
cd client
bun tauri android dev
```

Like iOS, Tauri sets `TAURI_DEV_HOST` to the machine's LAN IP when a physical device is connected, so the `Development + Some(host)` branch in `api_base_url()` kicks in — API requests go to `http://<LAN IP>:8000` instead of `localhost`.

For a standalone install:

```sh
bun tauri android build --apk --debug
```

Then install on the connected device:

```sh
adb install -r \
  src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk
```

## Signing for Distribution

Anything you ship outside your own machine needs to be properly signed. Both platforms handle the bulk of this through their IDEs:

- **iOS** — Xcode's **Signing & Capabilities** tab manages certificates and provisioning profiles, and **Product → Archive** handles App Store submission. Start with Apple's [Code Signing overview](https://developer.apple.com/support/code-signing/).
- **Android** — Android Studio's **Build → Generate Signed Bundle / APK** walks you through creating a keystore and signing an APK (for sideloading) or an AAB (for the Play Store, where [Play App Signing](https://developer.android.com/studio/publish/app-signing) takes over the final signing).

## That's a Wrap

And that's the full stack: a Gleam server backed by Postgres, a Lustre frontend, a Vite build pipeline, and a Tauri shell that runs the same code as a web app, a macOS/Windows/Linux desktop app, and an iOS/Android mobile app — all sharing types and validation written once in Gleam.

Thanks for sticking with me all the way through. If any of it helped, I'd love to hear about it — and the full source is at [github.com/lukwol/doable](https://github.com/lukwol/doable) if you want to fork it, star it, or use it as a starting point for your own project. Happy building.

[^1]: See commit [05dbbc3](https://github.com/lukwol/doable/commit/05dbbc3) on GitHub
