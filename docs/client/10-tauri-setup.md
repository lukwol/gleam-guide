# Tauri Setup

The app runs in the browser — but it doesn't have to. [Tauri](https://tauri.app) is an incredible framework for building native desktop apps from web frontends — it wraps the Vite frontend in a native desktop window using the operating system's built-in webview. The Gleam code, HTML, and CSS don't change at all; Tauri simply provides the frame around them and a Rust backend that can talk to the OS.

Because we already have a Vite project, the [manual setup](https://tauri.app/start/create-project/) path is the right one — it adds Tauri on top of what's already there rather than scaffolding everything from scratch. The approach is inspired by this [excellent write-up](https://www.wezm.net/v2/posts/2024/gleam-tauri/) by Wesley Moore.

Setting up Tauri adds a whole `src-tauri/` directory alongside the existing client code[^1]:

```sh
doable/
└── client/
    ├── package.json              # @tauri-apps/cli added                  [!code highlight]
    └── src-tauri/                # Tauri project root                     [!code ++]
        ├── .gitignore            # excludes /target and generated schemas [!code ++]
        ├── Cargo.toml            # Rust manifest + tauri dependencies     [!code ++]
        ├── Cargo.lock            # pinned dependency tree                 [!code ++]
        ├── build.rs              # Tauri build script                     [!code ++]
        ├── tauri.conf.json       # app name, window, build commands       [!code ++]
        ├── capabilities/
        │   └── default.json      # permission grants for the webview      [!code ++]
        ├── icons/                # app icons for all platforms            [!code ++]
        └── src/
            ├── lib.rs            # Tauri app entrypoint                   [!code ++]
            └── main.rs           # binary that calls lib::run()           [!code ++]
```

## Install Rust

Tauri's backend compiles from Rust, so the Rust toolchain — `rustc`, `cargo`, and `rustup` — needs to be installed before the Tauri CLI can do anything.

::: code-group

```sh [macOS & Linux]
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

```sh [Windows]
# Download and run rustup-init.exe from https://rustup.rs
```

:::

Restart the shell so the new `~/.cargo/bin` directory is on `PATH`, then verify with:

```sh
rustc --version
cargo --version
```

## Initialization

Inside `client/`, run the Tauri initializer:

```sh
cd client
bun tauri init
```

The CLI asks six questions. Answer them like this:

| Question                                                            | Answer                  |
| ------------------------------------------------------------------- | ----------------------- |
| What is your app name?                                              | `Doable`                |
| What should the window title be?                                    | `Doable`                |
| Where are your web assets, relative to `src-tauri/tauri.conf.json`? | `../dist`               |
| What is the url of your dev server?                                 | `http://localhost:5173` |
| What is your frontend dev command?                                  | `bun run dev`           |
| What is your frontend build command?                                | `bun run build`         |

The web assets path points to `../dist` — Vite's output directory when building for production. In development, Tauri loads the page from the dev URL instead, so `../dist` is only used during `bun tauri build`.

`@tauri-apps/cli` lands in `package.json` as a dev dependency:

```json
// client/package.json

{
  "devDependencies": {
    "@iconify-json/heroicons": "^1.2.3",
    "@iconify/tailwind4": "^1.2.3",
    "@tailwindcss/vite": "^4.2.2",
    "@tauri-apps/cli": "^2.10.1", // [!code ++]
    "tailwindcss": "^4.2.2",
    "vite": "^8.0.8",
    "vite-gleam": "^1.7.1"
  },
  "dependencies": {
    "daisyui": "^5.5.19"
  }
}
```

## Configuration

`tauri.conf.json` is the single source of truth for the app's identity, window defaults, and build commands:

```json
// client/src-tauri/tauri.conf.json

{
  "$schema": "../node_modules/@tauri-apps/cli/config.schema.json",
  "productName": "Doable",
  "version": "0.1.0",
  "identifier": "com.tauri.dev",
  "build": {
    "frontendDist": "../dist",
    "devUrl": "http://localhost:5173",
    "beforeDevCommand": "bun run dev",
    "beforeBuildCommand": "bun run build"
  },
  "app": {
    "windows": [
      {
        "title": "Doable",
        "width": 800,
        "height": 600,
        "resizable": true,
        "fullscreen": false
      }
    ],
    "security": {
      "csp": null
    }
  },
  "bundle": {
    "active": true,
    "targets": "all",
    "icon": [
      "icons/32x32.png",
      "icons/128x128.png",
      "icons/128x128@2x.png",
      "icons/icon.icns",
      "icons/icon.ico"
    ]
  }
}
```

Quick tour of the fields that matter:

- `beforeDevCommand` and `beforeBuildCommand` tell Tauri to start Vite before opening the window. Running `bun tauri dev` is enough — no need to start Vite separately.
- `devUrl` points at the Vite dev server. In dev mode, Tauri loads the page from this URL and waits for it to be ready before showing the window.
- `csp` is `null` for now. Content Security Policy matters for production, but we'll leave it open while developing.
- The `icon` list covers the formats each target platform expects. The initializer drops placeholder icons into `icons/` so builds work out of the box.

## Capabilities

Tauri v2 uses a capability system to control what the webview is allowed to do. The generated `capabilities/default.json` grants the built-in defaults:

```json
// client/src-tauri/capabilities/default.json

{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "enables the default permissions",
  "windows": ["main"],
  "permissions": ["core:default"]
}
```

`core:default` covers the baseline set of Tauri APIs — window management, event system, logging — without opening up anything sensitive like filesystem access or shell execution. Additional permissions get added here as plugins are introduced.

## The Rust App

Tauri's Rust side is minimal scaffolding. `build.rs` runs the Tauri build helper which generates type stubs and validates the configuration at compile time:

```rust
// client/src-tauri/build.rs

fn main() {
    tauri_build::build()
}
```

The app logic lives in `lib.rs`, separated from `main.rs` so the same code compiles on mobile targets (which don't use a `main` binary):

```rust
// client/src-tauri/src/lib.rs

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

`main.rs` is a single call to `lib::run()`, plus a Windows-specific attribute that suppresses the extra console window that would otherwise appear in release builds:

```rust
// client/src-tauri/src/main.rs

// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    app_lib::run();
}
```

`Cargo.toml` declares the Rust crate and its dependencies:

```toml
# client/src-tauri/Cargo.toml

[package]
name = "app"
version = "0.1.0"
description = "A Tauri App"
authors = ["you"]
license = ""
repository = ""
edition = "2021"            # [!code --]
edition = "2024"            # [!code ++]
rust-version = "1.77.2"     # [!code --]
rust-version = "1.94.1"     # [!code ++]

[lib]
name = "app_lib"
crate-type = ["staticlib", "cdylib", "rlib"]

[build-dependencies]
tauri-build = { version = "2.5.6", features = [] }

[dependencies]
serde_json = "1.0"
serde = { version = "1.0", features = ["derive"] }
log = "0.4"
tauri = { version = "2.10.3", features = [] }
tauri-plugin-log = "2"
```

The `[lib]` section compiles the crate as three output types so the same code works as a shared library, a dynamic library (for mobile), and a normal Rust library. `tauri-build` is a build-time dependency only; the runtime dependencies are `tauri` itself plus `serde`/`serde_json` for JSON serialization and `tauri-plugin-log` for logging.

The initializer still scaffolds `edition = "2021"` and an older `rust-version`. Bump both to `edition = "2024"` and the current stable `rust-version` so you get the latest Rust language improvements.

## Running the Desktop App

```sh
cd client
bun tauri dev
```

Tauri compiles the Rust binary, starts the Vite dev server via `beforeDevCommand`, then opens the native window pointing at `http://localhost:5173`. Hot reloading works out of the box: editing a `.gleam` file triggers a Vite HMR update and the window refreshes.

::: tip First build is slow — that's normal
The first `bun tauri dev` compiles hundreds of Rust crates from scratch, so expect it to sit for a few minutes. Every run after that is much faster thanks to incremental compilation.
:::

Tauri only wraps the frontend, so the Gleam server still needs to be running for the `/api` routes to respond. Nothing to do here — it's already up as a service via `docker compose` (or `gleam run` if you're running it manually).

## What's Next

A browser has a refresh button; the desktop app doesn't. If the task list goes stale, the user is stuck. We'll fix that next by adding a View menu with a Reload action.

[^1]: See commit [9f49e92](https://github.com/lukwol/doable/commit/9f49e92) on GitHub
