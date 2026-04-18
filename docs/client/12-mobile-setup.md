# Mobile Setup

Tauri isn't just a desktop framework — the same Gleam frontend can run on iOS and Android. The Rust backend handles the native layer on mobile just as it does on desktop. This chapter sets up both mobile targets and gets the app running on a simulator.

Two commands do the bulk of the work:

```sh
cd client
bun tauri ios init
bun tauri android init
```

Each creates a platform project under `src-tauri/gen/`:

```sh
doable/
└── client/
    └── src-tauri/
        └── gen/
            ├── apple/    # Xcode project for iOS    [!code ++]
            └── android/  # Gradle project for Android [!code ++]
```

These are full native projects — Xcode and Android Studio can open them directly if you need to configure anything beyond what Tauri exposes.

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

Three environment variables need to be set. On macOS, add these to your shell profile:

```sh
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
export ANDROID_HOME="$HOME/Library/Android/sdk"
export NDK_HOME="$ANDROID_HOME/ndk/$(ls -1 $ANDROID_HOME/ndk | tail -1)"
```

`NDK_HOME` picks the latest NDK version installed — if you have multiple versions, replace the subshell with the exact path.

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

## Running on iOS

```sh
cd client
bun tauri ios dev
```

Tauri compiles the Rust binary for the simulator target, starts the Vite dev server via `beforeDevCommand`, and launches the app in the iOS Simulator. To target a specific simulator, pass its name:

```sh
bun tauri ios dev "iPhone 16"
```

To open the Xcode project instead — useful for configuring signing, capabilities, or debugging native crashes:

```sh
bun tauri ios dev --open
```

## Running on Android

```sh
cd client
bun tauri android dev
```

This compiles the Rust binary for the Android target, starts Vite, and launches the app on the running emulator or connected device. Start an Android Virtual Device from Android Studio's Device Manager first if no device is connected.

::: tip First mobile build is *very* slow
Building for iOS or Android compiles the full Rust toolchain for a new target triple plus a fresh Gradle/Xcode configuration. Expect 10–15 minutes on the first run. Subsequent builds are much faster thanks to incremental compilation — don't cancel the first build just because it looks stuck.
:::

To open the Android Studio project instead:

```sh
bun tauri android dev --open
```

::: info Physical iOS device
Running on a physical iPhone requires a paid Apple Developer account for code signing. The simulator is enough for development and doesn't require one.
:::

## What's Next

...
