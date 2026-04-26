# Mobile Setup

Tauri isn't just a desktop framework — the same Gleam frontend can run on iOS and Android. The Rust backend handles the native layer on mobile just as it does on desktop. This chapter follows Tauri's [mobile development guide](https://v2.tauri.app/develop/) to set up both targets and get the app running on a simulator or emulator.

Two init commands scaffold the native projects; a handful of file changes make the Rust, Gleam, and CSS mobile-friendly[^1]:

```sh
doable/
└── client/
    ├── gleam.toml                     # viewport meta in lustre.html      [!code highlight]
    ├── src-tauri/
    │   ├── src/
    │   │   └── lib.rs                 # desktop/mobile setup split        [!code highlight]
    │   └── gen/                       # native projects                   [!code ++]
    │       ├── apple/                 # Xcode project for iOS             [!code ++]
    │       └── android/               # Gradle project for Android        [!code ++]
    └── src/
        ├── client.gleam               # IOS / Android body class          [!code highlight]
        ├── client.css                 # safe-area-inset-top               [!code highlight]
        └── app/
            └── platform.gleam         # IOS + Android + is_mobile         [!code highlight]
```

## iOS Prerequisites

::: warning Full Xcode, not Command Line Tools
Tauri's iOS build needs the full Xcode app from the App Store. `xcode-select --install` only installs the Command Line Tools, which are missing the iOS SDK and simulators. If `bun tauri ios init` fails with "no iOS SDK found," this is why.
:::

iOS development requires macOS and a full Xcode installation — the Command Line Tools alone are not enough. Install it from the App Store, then install Cocoapods:

```sh
brew install cocoapods
```

::: tip Need a specific Xcode version?
The App Store only offers the latest. Grab older builds from [Apple's developer downloads](https://developer.apple.com/download/), or manage multiple versions with [xcodes](https://github.com/XcodesOrg/xcodes) (CLI) / [XcodesApp](https://github.com/XcodesOrg/XcodesApp) (GUI).
:::

Add the Rust targets for iOS devices and simulators:

```sh
rustup target add aarch64-apple-ios x86_64-apple-ios aarch64-apple-ios-sim
```

- `aarch64-apple-ios` — physical devices (iPhone, iPad)
- `aarch64-apple-ios-sim` — Apple Silicon simulator
- `x86_64-apple-ios` — Intel Mac simulator

## Android Prerequisites

Android development requires Android Studio. Download and install it from the [Android Developers website](https://developer.android.com/studio), then open the SDK Manager and install:

- Android SDK Platform
- Android SDK Platform-Tools
- NDK (Side by side)
- Android SDK Build-Tools
- Android SDK Command-line Tools

Three environment variables need to be set. Add them to your shell profile — the paths depend on your operating system:

::: code-group

```sh [macOS]
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
export ANDROID_HOME="$HOME/Library/Android/sdk"
export NDK_HOME="$ANDROID_HOME/ndk/$(ls -1 $ANDROID_HOME/ndk | tail -1)"
```

```sh [Linux]
export JAVA_HOME="/opt/android-studio/jbr"
export ANDROID_HOME="$HOME/Android/Sdk"
export NDK_HOME="$ANDROID_HOME/ndk/$(ls -1 $ANDROID_HOME/ndk | tail -1)"
```

```powershell [Windows]
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
$env:NDK_HOME = "$env:ANDROID_HOME\ndk\$((Get-ChildItem $env:ANDROID_HOME\ndk | Sort-Object Name | Select-Object -Last 1).Name)"
```

:::

`NDK_HOME` picks the latest NDK version installed — if you have multiple versions, replace the subshell with the exact path. On Linux, adjust `JAVA_HOME` if Android Studio was installed somewhere other than `/opt/android-studio` (for example via Snap or the tar archive in `$HOME`). To make the Windows variables permanent across shells, set them through **System Properties → Environment Variables** instead.

::: tip If the build fails with "NDK not found"
The `$(ls -1 $ANDROID_HOME/ndk | tail -1)` shell expression only works if `$ANDROID_HOME/ndk` exists and contains at least one numbered subdirectory. Open Android Studio's SDK Manager → SDK Tools and install **NDK (Side by side)** first. Then re-source your shell profile so `NDK_HOME` picks up the new path.
:::

Then add the Rust targets for Android:

```sh
rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android
```

- `aarch64-linux-android` — modern 64-bit devices
- `armv7-linux-androideabi` — older 32-bit ARM devices
- `i686-linux-android` — 32-bit x86 emulator
- `x86_64-linux-android` — 64-bit x86 emulator

## Initialization

That's the toolchain slog out of the way — from here on it's the fun part. With both toolchains in place, run the mobile initializers inside `client/`:

```sh
cd client
bun tauri ios init
bun tauri android init
```

Each creates a platform project under `src-tauri/gen/`. These are full native projects — Xcode and Android Studio can open them directly if you need to configure anything beyond what Tauri exposes.

## Splitting Desktop and Mobile Setup

The previous chapter added a View menu and a menu-event handler directly inside `run()`. Neither belongs on mobile — iOS and Android don't have an application menu bar, and Tauri doesn't expose the `tauri::menu` module on those targets at all. Compiling the desktop code as-is for iOS or Android fails right at the import line.

Two things need to change: the `tauri::menu` import has to disappear on mobile, and `run()` has to run different setup logic depending on the target. A clean way to handle both at once is to lift the menu setup out of `run()` and place it behind a small extension trait — one implementation for desktop, a no-op implementation for mobile — each guarded by `#[cfg(desktop)]` or `#[cfg(mobile)]`:

```rust
// client/src-tauri/src/lib.rs

#[cfg(desktop)]                                                                                      // [!code ++]
use tauri::{
    AppHandle, Emitter,
    menu::{Menu, MenuEvent, MenuItem, Submenu},
};
use tauri::{Builder, Runtime};                                                                       // [!code ++]

trait BuilderExt<R: Runtime> {                                                                       // [!code ++]
    fn setup_platform(self) -> Self;                                                                 // [!code ++]
}                                                                                                    // [!code ++]

#[cfg(desktop)]                                                                                      // [!code ++]
impl<R: Runtime> BuilderExt<R> for Builder<R> {                                                      // [!code ++]
    fn setup_platform(self) -> Self {                                                                // [!code ++]
        self.setup(|app| {                                                                           // [!code ++]
            let reload_item =                                                                        // [!code ++]
                MenuItem::with_id(app.handle(), "reload", "Reload", true, Some("CmdOrCtrl+R"))?;     // [!code ++]
            let view_submenu = Submenu::with_items(app.handle(), "View", true, &[&reload_item])?;    // [!code ++]
            let menu = Menu::default(app.handle())?;                                                 // [!code ++]
            menu.append(&view_submenu)?;                                                             // [!code ++]
            app.set_menu(menu)?;                                                                     // [!code ++]
            Ok(())                                                                                   // [!code ++]
        })                                                                                           // [!code ++]
        .on_menu_event(|app: &AppHandle<R>, event: MenuEvent| {                                      // [!code ++]
            app.emit("menu-event", event.id().as_ref()).ok();                                        // [!code ++]
        })                                                                                           // [!code ++]
    }                                                                                                // [!code ++]
}                                                                                                    // [!code ++]

#[cfg(mobile)]                                                                                       // [!code ++]
impl<R: Runtime> BuilderExt<R> for Builder<R> {                                                      // [!code ++]
    fn setup_platform(self) -> Self {                                                                // [!code ++]
        self                                                                                         // [!code ++]
    }                                                                                                // [!code ++]
}                                                                                                    // [!code ++]

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_os::init())
        .setup(|app| {                                                                               // [!code --]
            let reload_item =                                                                        // [!code --]
                MenuItem::with_id(app.handle(), "reload", "Reload", true, Some("CmdOrCtrl+R"))?;     // [!code --]
            let view_submenu = Submenu::with_items(app.handle(), "View", true, &[&reload_item])?;   // [!code --]
            let menu = Menu::default(app.handle())?;                                                 // [!code --]
            menu.append(&view_submenu)?;                                                             // [!code --]
            app.set_menu(menu)?;                                                                     // [!code --]
            Ok(())                                                                                   // [!code --]
        })                                                                                           // [!code --]
        .on_menu_event(|app: &AppHandle, event: MenuEvent| {                                         // [!code --]
            app.emit("menu-event", event.id().as_ref()).ok();                                        // [!code --]
        })                                                                                           // [!code --]
        .setup_platform()                                                                            // [!code ++]
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

The `.setup(...)` block and `.on_menu_event(...)` chain that previously lived in `run()` move into the desktop implementation verbatim — the bodies don't need to change, they simply get a new home. Back in `run()`, a single `.setup_platform()` call takes their place and resolves to the matching implementation at compile time.

Three points worth highlighting before moving on:

- **The `tauri::menu` import is now guarded by `#[cfg(desktop)]`.** Without the guard, the mobile build would fail on a missing module — the import is only meaningful on platforms where the desktop implementation exists.
- **The trait is generic over `R: Runtime`.** Tauri's `Builder<R>` is itself generic over the runtime, so the extension trait has to follow suit. That's also why the `on_menu_event` closure now takes `&AppHandle<R>` rather than the bare `&AppHandle` it used before — the same type parameter, threaded through.
- **The mobile implementation is simply `self`.** There's no platform-specific setup to perform on mobile yet, but `.setup_platform()` still needs an implementation to resolve to. In the next chapter, this is where the haptics plugin registration will land.

## Detecting Mobile in Gleam

`app/platform.gleam` already knew about macOS, Windows, and Linux. Two more variants cover the mobile platforms, and a matching `is_mobile` helper mirrors `is_desktop`:

```gleam
// client/src/app/platform.gleam

pub type Platform {
  Browser
  MacOS
  Windows
  Linux
  IOS                                  // [!code ++]
  Android                              // [!code ++]
}

pub fn platform() -> Platform {
  case os.platform_string() {
    "macos" -> MacOS
    "windows" -> Windows
    "linux" -> Linux
    "ios" -> IOS                       // [!code ++]
    "android" -> Android               // [!code ++]
    _ -> Browser
  }
}

pub fn is_desktop() -> Bool {
  case platform() {
    MacOS | Windows | Linux -> True
    _ -> False
  }
}

pub fn is_mobile() -> Bool {           // [!code ++]
  case platform() {                    // [!code ++]
    IOS | Android -> True              // [!code ++]
    _ -> False                         // [!code ++]
  }                                    // [!code ++]
}                                      // [!code ++]
```

`tauri-plugin-os` already returns `"ios"` or `"android"` on those targets — mapping them through the same `case` keeps detection in one place.

## Mobile Styling

Two things need attention on mobile: the status bar at the top shouldn't sit on top of the content, and the viewport should not let the user pinch-zoom the app into a desktop-like layout.

`client.gleam` already tags `<body>` with `desktop` or `browser`. Adding a third arm for iOS and Android tags the body with `mobile`:

```gleam
// client/src/client.gleam

import app/platform.{Android, Browser, IOS, Linux, MacOS, Windows}     // [!code highlight]

pub fn main() {
  case platform.platform() {
    MacOS | Windows | Linux -> browser.add_body_class("desktop")
    IOS | Android -> browser.add_body_class("mobile")                  // [!code ++]
    Browser -> browser.add_body_class("browser")
  }
  ...
}
```

`client.css` extends the `user-select: none` rule to mobile and pads the app with the safe area inset so content clears the notch or status bar:

```css
/* client/src/client.css */

body.mobile *,                                             /* [!code ++] */
body.desktop * {
  -webkit-user-select: none;
  user-select: none;
}

body.mobile > #app > * {                                   /* [!code ++] */
  padding-top: env(safe-area-inset-top);                   /* [!code ++] */
}                                                          /* [!code ++] */
```

For `env(safe-area-inset-top)` to resolve to a non-zero value, the viewport meta needs `viewport-fit=cover`. While here, `user-scalable=no` disables pinch-zoom so the app behaves like a native one. `lustre_dev_tools` generates the HTML scaffold for us, so the meta tag goes in `gleam.toml` rather than a hand-written `index.html`:

```toml
# client/gleam.toml

[tools.lustre.html]
title = "Doable"
meta = [                                                                                                              # [!code ++]
  { name = "viewport", content = "width=device-width, initial-scale=1, user-scalable=no, viewport-fit=cover" },       # [!code ++]
]                                                                                                                     # [!code ++]
```

## Running on iOS

```sh
cd client
bun tauri ios dev
```

Tauri asks which simulator to use, compiles the Rust binary for the simulator target, starts `lustre_dev_tools` via `beforeDevCommand`, and launches the app in the iOS Simulator. API requests reach the Gleam server at `http://localhost:8000` directly — the simulator shares the host's network stack.

To target a specific simulator up front, pass its name:

```sh
bun tauri ios dev "iPhone 16"
```

To open the Xcode project instead — useful for configuring signing, capabilities, or debugging native crashes:

```sh
bun tauri ios dev --open
```

## Running on Android

Start an Android Virtual Device from Android Studio's Device Manager first. Then:

```sh
cd client
bun tauri android dev
```

This compiles the Rust binary for the Android target, starts `lustre_dev_tools`, and launches the app on the running emulator.

Unlike the iOS simulator, an Android emulator runs on its own virtual network — `localhost` inside the emulator means the emulator itself, not the host. API requests to `http://localhost:8000` fail until the host port is forwarded into the emulator:

```sh
adb reverse tcp:8000 tcp:8000
```

::: tip Undoing the reverse
`adb reverse --remove tcp:8000` tears down the forward when you're done. `adb reverse --list` shows any active rules.
:::

To open the Android Studio project instead:

```sh
bun tauri android dev --open
```

## What's Next

The app now runs on an iOS simulator and an Android emulator — same Gleam code, two new platforms. Mobile has the same stale-data problem the View menu solved on desktop, though, and this time there's no menu bar and no Cmd+R to fall back on. Next up: pull-to-refresh, so a swipe from the top reloads the tasks.

[^1]: See commit [5eb389f](https://github.com/lukwol/doable/commit/5eb389f) on GitHub
