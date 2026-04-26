# Deploy to Device

The app runs in dev on simulators and emulators — but `localhost:8000` is hardcoded. That breaks on physical devices, where the server isn't reachable at `localhost`, and it breaks in production builds, where the server lives behind a real domain. This chapter fixes the URL logic, then takes the app through production builds on simulators, emulators, and real devices[^1].

Seven files change, three are new:

```sh
doable/
└── client/
    ├── src-tauri/
    │   ├── capabilities/
    │   │   ├── default.json          # production URL allowlisted         [!code highlight]
    │   │   └── mobile.json           # mobile-only http allowlist         [!code highlight]
    │   ├── src/
    │   │   ├── commands.rs           # is_dev + tauri_dev_host commands   [!code ++]
    │   │   └── lib.rs                # invoke_handler registered          [!code highlight]
    │   └── tauri.conf.json           # iOS team ID + LAN host arg         [!code highlight]
    └── src/
        ├── api.gleam                 # async base URL by platform + mode  [!code highlight]
        └── tauri/
            ├── commands.gleam        # tauri_is_dev + tauri_dev_host      [!code ++]
            └── commands_ffi.js       # invoke bridge                      [!code ++]
```

## Reading Tauri's State from Rust

Tauri has two pieces of state we want to consume from Gleam: whether the binary was built in debug or release mode (`tauri::is_dev()`), and the LAN host the dev server is bound to when targeting a physical device (`option_env!("TAURI_DEV_HOST")` — Tauri's CLI sets this at compile time). Both are exposed as Tauri commands that the JS side can `invoke`:

```rust
// client/src-tauri/src/commands.rs

#[tauri::command]
pub fn is_dev() -> bool {
    tauri::is_dev()
}

#[tauri::command]
pub fn tauri_dev_host() -> Option<String> {
    option_env!("TAURI_DEV_HOST").map(str::to_string)
}
```

`lib.rs` registers them with `invoke_handler` and pulls in the new module:

```rust
// client/src-tauri/src/lib.rs

mod commands;                                                // [!code ++]

...

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_os::init())
        .setup_platform()
        .invoke_handler(tauri::generate_handler![             // [!code ++]
            commands::is_dev,                                 // [!code ++]
            commands::tauri_dev_host                          // [!code ++]
        ])                                                    // [!code ++]
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

`tauri::generate_handler!` is a macro that turns the listed commands into a single handler value Tauri can register. Adding more commands later means appending them to the list.

## The Gleam Bridge

`commands_ffi.js` invokes the two commands through Tauri's `invoke` API. Both have `isTauri()` guards so the same Gleam code can also run in a plain browser — outside a Tauri context, `is_dev` defaults to `False` and `tauri_dev_host` to `None`:

```js
// client/src/tauri/commands_ffi.js

import { invoke, isTauri } from "@tauri-apps/api/core";
import { Some, None } from "../../gleam_stdlib/gleam/option.mjs";

export async function tauri_is_dev() {
  return isTauri() ? invoke("is_dev") : false;
}

export async function tauri_dev_host() {
  const host = isTauri() ? await invoke("tauri_dev_host") : null;
  return host ? new Some(host) : new None();
}
```

`commands.gleam` exposes both as typed Gleam externals returning `Promise`s — Tauri's `invoke` is asynchronous:

```gleam
// client/src/tauri/commands.gleam

import gleam/javascript/promise.{type Promise}
import gleam/option.{type Option}

@external(javascript, "./commands_ffi.js", "tauri_is_dev")
pub fn tauri_is_dev() -> Promise(Bool)

@external(javascript, "./commands_ffi.js", "tauri_dev_host")
pub fn tauri_dev_host() -> Promise(Option(String))
```

## Resolving the API Base URL

`api_base_url()` now branches on platform, build mode, and whether `TAURI_DEV_HOST` was set at compile time. Because the Tauri commands are async, the function returns a `Promise(String)` rather than a bare `String` — the rest of `api.gleam` adapts to wait for it:

```gleam
// client/src/api.gleam

import gleam/option.{None, Some}     // [!code ++]
import tauri/commands                // [!code ++]

fn api_base_url() -> String {                                           // [!code --]
  case platform.platform() {                                            // [!code --]
    Browser -> browser.window_location_origin()                         // [!code --]
    _ -> "http://localhost:8000"                                        // [!code --]
  }                                                                     // [!code --]
}                                                                       // [!code --]
fn api_base_url() -> Promise(String) {                                  // [!code ++]
  use tauri_is_dev <- promise.await(commands.tauri_is_dev())            // [!code ++]
  use tauri_dev_host <- promise.map(commands.tauri_dev_host())          // [!code ++]
  case platform.platform(), tauri_is_dev, tauri_dev_host {              // [!code ++]
    Browser, _, _ -> browser.window_location_origin()                   // [!code ++]
    _, True, Some(host) -> "http://" <> host <> ":8000"                 // [!code ++]
    _, True, None -> "http://localhost:8000"                            // [!code ++]
    _, False, _ -> "https://your-domain.com"                            // [!code ++]
  }                                                                     // [!code ++]
}                                                                       // [!code ++]
```

- **Browser** — `window.location.origin` works in any browser context, dev or production, because the Caddy proxy is there to forward `/api`.
- **Tauri + dev + host set** — Tauri sets `TAURI_DEV_HOST` to the machine's LAN IP when targeting a physical device. The server needs to be reachable on that address, not just `localhost`.
- **Tauri + dev + no host** — simulator and emulator both share the host network, so `localhost:8000` reaches the server directly.
- **Tauri + release** — replace `https://your-domain.com` with the address of your deployed server.

`with_json_request` awaits the resolved URL before building the request:

```gleam
// client/src/api.gleam

fn with_json_request(
  path: String,
  callback: fn(Request(String)) -> Promise(Result(b, ApiError)),
) -> Promise(Result(b, ApiError)) {
  let url = api_base_url() <> path                // [!code --]
  use base_url <- promise.await(api_base_url())   // [!code ++]
  let url = base_url <> path                      // [!code ++]
  request.to(url)
  |> result.replace_error(InvalidUrl(url))
  |> result.map(request.set_header(_, "accept", "application/json"))
  |> promise.resolve
  |> promise.try_await(callback)
}
```

## HTTP Capabilities

The production URL needs to be added to the desktop HTTP allowlist — requests to unlisted URLs are blocked:

```json
// client/src-tauri/capabilities/default.json

{
  "identifier": "http:default",
  "allow": [
    { "url": "http://localhost:8000/**" },
    { "url": "https://your-domain.com/**" } // [!code ++]
  ]
}
```

On mobile, physical devices reach the dev server through whichever LAN IP `TAURI_DEV_HOST` was set to. Since the address varies between networks, a wildcard host is the simplest match. Adding the rule to `mobile.json` keeps it scoped to iOS and Android — desktop builds don't get a wildcard:

```json
// client/src-tauri/capabilities/mobile.json

{
  "identifier": "mobile-capability",
  "platforms": ["android", "iOS"],
  "windows": ["main"],
  "permissions": [
    "haptics:allow-impact-feedback",
    {                                          // [!code ++]
      "identifier": "http:default",            // [!code ++]
      "allow": [                               // [!code ++]
        {                                      // [!code ++]
          "url": "http://*:8000/**"            // [!code ++]
        }                                      // [!code ++]
      ]                                        // [!code ++]
    }                                          // [!code ++]
  ]
}
```

## Binding the Dev Server to the LAN

Targeting a physical device needs the dev server bound to the LAN, not just `127.0.0.1`. `lustre_dev_tools start` accepts `--host=0.0.0.0` to do that. We only want it set when Tauri provides a `TAURI_DEV_HOST`, so the shell expansion `${TAURI_DEV_HOST:+--host=0.0.0.0}` substitutes the flag when the variable is set and produces nothing otherwise:

```json
// client/src-tauri/tauri.conf.json

{
  "build": {
    "frontendDist": "../dist",
    "devUrl": "http://localhost:1234",
    "beforeDevCommand": "gleam run -m lustre/dev start",                                       // [!code --]
    "beforeDevCommand": "gleam run -m lustre/dev start ${TAURI_DEV_HOST:+--host=0.0.0.0}",     // [!code ++]
    "beforeBuildCommand": "gleam run -m lustre/dev build"
  }
}
```

For simulator and emulator runs, `TAURI_DEV_HOST` is empty and `lustre_dev_tools` keeps its default loopback binding.

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

Before distributing, swap the bundle identifier in `tauri.conf.json` for your own reverse-domain value. Both iOS and Android pick it up from that one field — it was set to `com.lukwol.doable` back in chapter 11 as a placeholder.

## Running on iOS Simulator

For a dev build on the simulator, `bun tauri ios dev` from chapter 12 still works. For a production build:

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

Tauri detects the physical device, sets `TAURI_DEV_HOST` to the machine's LAN IP, and starts `lustre_dev_tools` bound to that address. The `dev + Some(host)` branch in `api_base_url()` kicks in — API requests go to `http://<LAN IP>:8000` instead of `localhost`.

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

This confirms the emulator is connected. For a dev build, `bun tauri android dev` from chapter 12 still applies. To produce a standalone APK you can install directly on the emulator:

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
Android release builds disallow plain HTTP by default. The release branch in `api_base_url()` must point at an HTTPS URL — `http://your-domain.com` will be blocked. For local testing, use a tunneling tool (Tailscale, Cloudflare Tunnel, ngrok, or similar) to expose the local server over HTTPS.
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

Like iOS, Tauri sets `TAURI_DEV_HOST` to the machine's LAN IP when a physical device is connected, so the `dev + Some(host)` branch in `api_base_url()` kicks in — API requests go to `http://<LAN IP>:8000` instead of `localhost`.

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

And that's the full stack: a Gleam server backed by Postgres, a Lustre frontend driven by `lustre_dev_tools`, and a Tauri shell that runs the same code as a web app, a macOS/Windows/Linux desktop app, and an iOS/Android mobile app — all sharing types and validation written once in Gleam.

Thanks for sticking with me all the way through. If any of it helped, I'd love to hear about it — and the full source is at [github.com/lukwol/doable](https://github.com/lukwol/doable) if you want to fork it, star it, or use it as a starting point for your own project. Happy building.

[^1]: See commit [c440971](https://github.com/lukwol/doable/commit/c440971) on GitHub
