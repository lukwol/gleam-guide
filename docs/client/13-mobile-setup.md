# Mobile Setup

Tauri isn't just a desktop framework — the same Gleam frontend can run on iOS and Android. The Rust backend handles the native layer on mobile just as it does on desktop. This chapter follows Tauri's [mobile development guide](https://v2.tauri.app/develop/) to set up both targets and get the app running on a simulator or emulator.

Two init commands scaffold the native projects; a handful of file changes make the Rust, Gleam, CSS, and dev server mobile-friendly[^1]:

```sh
doable/
└── client/
    ├── index.html                     # viewport meta updated             [!code highlight]
    ├── vite.config.js                 # TAURI_DEV_HOST + fixed port       [!code highlight]
    ├── src-tauri/
    │   ├── tauri.conf.json            # devUrl port 1420                  [!code highlight]
    │   ├── src/
    │   │   └── lib.rs                 # desktop/mobile setup split        [!code highlight]
    │   └── gen/                       # native projects                   [!code ++]
    │       ├── apple/                 # Xcode project for iOS             [!code ++]
    │       └── android/               # Gradle project for Android        [!code ++]
    └── src/
        ├── main.js                    # body.mobile class                 [!code highlight]
        ├── platform.gleam             # IOS + Android + is_mobile         [!code highlight]
        └── style.css                  # safe-area-inset-top               [!code highlight]
```

## Initialization

Inside `client/`, run both mobile initializers:

```sh
cd client
bun tauri ios init
bun tauri android init
```

Each creates a platform project under `src-tauri/gen/`. These are full native projects — Xcode and Android Studio can open them directly if you need to configure anything beyond what Tauri exposes.

## iOS Prerequisites

::: warning Full Xcode, not Command Line Tools
Tauri's iOS build needs the full Xcode app from the App Store. `xcode-select --install` only installs the Command Line Tools, which are missing the iOS SDK and simulators. If `bun tauri ios init` fails with "no iOS SDK found," this is why.
:::

iOS development requires macOS and a full Xcode installation — the Command Line Tools alone are not enough. Install it from the App Store, then install Cocoapods:

```sh
brew install cocoapods
```

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

```powershell [Windows (PowerShell)]
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

## Splitting Desktop and Mobile Setup

The previous chapter added a View menu and a menu-event handler in `lib.rs`. Neither exists on mobile — iOS and Android have no application menu bar, and the `tauri::menu` module isn't available on those targets. Compiling the desktop setup as-is for iOS or Android fails at the import line.

The fix is to split the builder setup behind a trait with separate impls for desktop and mobile:

```rust
// client/src-tauri/src/lib.rs

#[cfg(desktop)]                                                         // [!code ++]
use tauri::{
    AppHandle, Emitter,
    menu::{Menu, MenuEvent, MenuItem, Submenu},
};
use tauri::{Builder, Runtime};                                          // [!code ++]

trait BuilderExt<R: Runtime> {                                          // [!code ++]
    fn setup_platform(self) -> Self;                                    // [!code ++]
}                                                                       // [!code ++]

#[cfg(desktop)]                                                         // [!code ++]
impl<R: Runtime> BuilderExt<R> for Builder<R> {                         // [!code ++]
    fn setup_platform(self) -> Self {                                   // [!code ++]
        self.setup(|app| {
            let reload_item =
                MenuItem::with_id(app.handle(), "reload", "Reload", true, Some("CmdOrCtrl+R"))?;
            let view_submenu = Submenu::with_items(app.handle(), "View", true, &[&reload_item])?;
            let menu = Menu::default(app.handle())?;
            menu.append(&view_submenu)?;
            app.set_menu(menu)?;
            Ok(())
        })
        .on_menu_event(|app: &AppHandle<R>, event: MenuEvent| {
            app.emit("menu-event", event.id().as_ref()).ok();
        })
    }
}

#[cfg(mobile)]                                                          // [!code ++]
impl<R: Runtime> BuilderExt<R> for Builder<R> {                         // [!code ++]
    fn setup_platform(self) -> Self {                                   // [!code ++]
        self                                                            // [!code ++]
    }                                                                   // [!code ++]
}                                                                       // [!code ++]

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_os::init())
        .setup_platform()                                               // [!code ++]
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

`#[cfg(desktop)]` gates the menu imports and the desktop impl; `#[cfg(mobile)]` provides a no-op impl. Calling `.setup_platform()` resolves to whichever matches the current target, so the mobile build drops the menu entirely and the desktop build keeps it.

## Detecting Mobile in Gleam

`platform.gleam` already knew about macOS, Windows, and Linux. Two more variants cover the mobile platforms, and a matching `is_mobile` helper mirrors `is_desktop`:

```gleam
// client/src/platform.gleam

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

`main.js` tags the body with a platform class the same way it does for desktop:

```js
// client/src/main.js

import { main } from "./client.gleam";
import { is_desktop, is_mobile } from "./platform.gleam";  // [!code highlight]
import "./style.css";

document.addEventListener("DOMContentLoaded", () => {
  if (is_mobile()) {                                       // [!code ++]
    document.body.classList.add("mobile");                 // [!code ++]
  } else if (is_desktop()) {                               // [!code ++]
    document.body.classList.add("desktop");
  } else {
    document.body.classList.add("browser");
  }
  const dispatch = main({});
});
```

`style.css` extends the `user-select: none` rule to mobile and pads the app with the safe area inset so content clears the notch or status bar:

```css
/* client/src/style.css */

body.mobile *,                                             /* [!code ++] */
body.desktop * {
  -webkit-user-select: none;
  user-select: none;
}

body.mobile > #app > * {                                   /* [!code ++] */
  padding-top: env(safe-area-inset-top);                   /* [!code ++] */
}                                                          /* [!code ++] */
```

For `env(safe-area-inset-top)` to resolve to a non-zero value, the viewport meta needs `viewport-fit=cover`. While here, `user-scalable=no` disables pinch-zoom so the app behaves like a native one:

```html
<!-- client/index.html -->

<meta
  name="viewport"
  content="width=device-width, initial-scale=1.0, user-scalable=no, viewport-fit=cover"
/>
```

## Dev Server Configuration

Tauri's mobile dev workflow needs two small changes to how Vite is started. The port must be fixed and known to Tauri, and the server has to optionally bind to a LAN-reachable host so the mobile runtime can connect:

```js
// client/vite.config.js

import { defineConfig } from "vite";
import gleam from "vite-gleam";
import tailwindcss from "@tailwindcss/vite";

const host = process.env.TAURI_DEV_HOST;                    // [!code ++]

export default defineConfig({
  plugins: [gleam(), tailwindcss()],

  clearScreen: false,                                       // [!code ++]
  server: {
    port: 1420,                                             // [!code ++]
    strictPort: true,                                       // [!code ++]
    host: host || "127.0.0.1",                              // [!code ++]
    hmr: host                                               // [!code ++]
      ? {                                                   // [!code ++]
          protocol: "ws",                                   // [!code ++]
          host,                                             // [!code ++]
          port: 1421,                                       // [!code ++]
        }                                                   // [!code ++]
      : undefined,                                          // [!code ++]
    watch: {                                                // [!code ++]
      ignored: ["**/src-tauri/**"],                         // [!code ++]
    },                                                      // [!code ++]
    proxy: {
      "/api": "http://localhost:8000",
    },
  },
});
```

`strictPort` prevents Vite from silently rolling over to another port — if 1420 is taken, the command fails instead of leaving Tauri pointing at the wrong URL. `TAURI_DEV_HOST` is set by the Tauri CLI when the dev server needs to be reachable over the network (for physical devices, in a later chapter); when unset, Vite binds to `127.0.0.1` as before. `clearScreen: false` keeps Tauri's build output visible when running alongside Vite.

`tauri.conf.json` points `devUrl` at the same port:

```json
// client/src-tauri/tauri.conf.json

{
  "build": {
    "devUrl": "http://localhost:5173",   // [!code --]
    "devUrl": "http://localhost:1420",   // [!code ++]
    ...
  }
}
```

## Running on iOS

```sh
cd client
bun tauri ios dev
```

Tauri asks which simulator to use, compiles the Rust binary for the simulator target, starts the Vite dev server via `beforeDevCommand`, and launches the app in the iOS Simulator. API requests reach the Gleam server at `http://localhost:8000` directly — the simulator shares the host's network stack.

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

This compiles the Rust binary for the Android target, starts Vite, and launches the app on the running emulator.

Unlike the iOS simulator, an Android emulator runs on its own virtual network — `localhost` inside the emulator means the emulator itself, not the host. API requests to `http://localhost:8000` fail until the host port is forwarded into the emulator:

```sh
adb reverse tcp:8000 tcp:8000
```

::: tip Undoing the reverse
`adb reverse --remove tcp:8000` tears down the forward when you're done. `adb reverse --list` shows any active rules.
:::

::: tip First mobile build is *very* slow
Building for iOS or Android compiles the full Rust toolchain for a new target triple plus a fresh Gradle/Xcode configuration. Expect 10–15 minutes on the first run. Subsequent builds are much faster thanks to incremental compilation — don't cancel the first build just because it looks stuck.
:::

To open the Android Studio project instead:

```sh
bun tauri android dev --open
```

## What's Next

The app now runs on both an iOS simulator and an Android emulator. But mobile has the same stale-data problem the desktop View menu fixed — only worse, because there's no menu and no Cmd+R to fall back on. The next chapter adds pull-to-refresh so a swipe from the top of the list reloads the tasks.

[^1]: See commit [bb97eec](https://github.com/lukwol/doable/commit/bb97eec) on GitHub
