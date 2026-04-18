# Desktop Additions

Two things are missing from the desktop app: there's no way to reload the page if the task list goes stale, and dragging over text triggers browser-style selection.

This chapter adds a View menu with a Reload action and a platform detection layer that disables text selection when running outside the browser. Nine files change, five are new[^1]:

```sh
doable/
└── client/
    ├── package.json                    # @tauri-apps/plugin-os added          [!code highlight]
    ├── src-tauri/
    │   ├── Cargo.toml                  # tauri-plugin-os added                [!code highlight]
    │   ├── capabilities/
    │   │   └── default.json            # os:default permission added          [!code highlight]
    │   └── src/
    │       └── lib.rs                  # menu construction + os plugin        [!code highlight]
    └── src/
        ├── browser.gleam               # reload_page added                    [!code highlight]
        ├── browser_ffi.js              # reload_page added                    [!code highlight]
        ├── client.gleam                # Msg type + menu wiring               [!code highlight]
        ├── main.js                     # platform body class                  [!code highlight]
        ├── platform.gleam              # platform detection                   [!code ++]
        ├── style.css                   # user-select CSS                      [!code highlight]
        └── tauri/
            ├── menu.gleam              # menu event subscription              [!code ++]
            ├── menu_ffi.js             # Tauri event listener                 [!code ++]
            ├── os.gleam                # platform string external             [!code ++]
            └── os_ffi.js               # tauri-plugin-os bridge               [!code ++]
```

## The Menu

Menus in Tauri are built on the Rust side. `lib.rs` constructs a View submenu with a single Reload item and appends it to the platform's default menu bar:

```rust
// client/src-tauri/src/lib.rs

use tauri::{
    AppHandle, Emitter,
    menu::{Menu, MenuEvent, MenuItem, Submenu},
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_os::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            let reload_item =                                                                        // [!code ++]
                MenuItem::with_id(app.handle(), "reload", "Reload", true, Some("CmdOrCtrl+R"))?;   // [!code ++]
            let view_submenu = Submenu::with_items(app.handle(), "View", true, &[&reload_item])?;   // [!code ++]
            let menu = Menu::default(app.handle())?;                                                 // [!code ++]
            menu.append(&view_submenu)?;                                                             // [!code ++]
            app.set_menu(menu)?;                                                                     // [!code ++]
            Ok(())
        })
        .on_menu_event(|app: &AppHandle, event: MenuEvent| {                                         // [!code ++]
            app.emit("menu-event", event.id().as_ref()).ok();                                        // [!code ++]
        })                                                                                           // [!code ++]
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

A few things worth noting:

- `Menu::default` gives the platform's built-in menu bar — on macOS that includes the application menu with Quit and Hide. The View submenu is appended on top rather than replacing it.
- `MenuItem::with_id` assigns the string `"reload"` as the item's identifier. That id is what gets emitted when the user clicks — the label "Reload" is display only.
- `Some("CmdOrCtrl+R")` registers the keyboard shortcut. `CmdOrCtrl` maps to Cmd on macOS and Ctrl on Windows and Linux.
- `on_menu_event` emits a `"menu-event"` Tauri event carrying the item's id. That crosses the Rust/JS boundary and makes the event available to the Gleam frontend.

## Menu Events in Gleam

The Rust side emits a Tauri event; the Gleam side subscribes to it. Two new files handle the bridge:

```js
// client/src/tauri/menu_ffi.js

import { listen } from "@tauri-apps/api/event";

export function listen_menu_events(dispatch) {
  listen("menu-event", (event) => {
    dispatch(event.payload);
  });
}
```

```gleam
// client/src/tauri/menu.gleam

import lustre/effect.{type Effect}

@external(javascript, "./menu_ffi.js", "listen_menu_events")
fn listen_menu_events(dispatch: fn(String) -> Nil) -> Nil

pub fn subscribe(to_msg: fn(String) -> msg) -> Effect(msg) {
  use dispatch <- effect.from
  use id <- listen_menu_events
  to_msg(id) |> dispatch
}
```

`listen_menu_events` calls Tauri's `listen` API, which fires the callback every time a `"menu-event"` arrives. `subscribe` wraps it as a Lustre effect: `effect.from` provides the `dispatch` function, which gets threaded through as the callback. When the user clicks a menu item, the item's id string is dispatched as a message.

## Platform Detection

Platform detection relies on `tauri-plugin-os`. The Tauri CLI handles all the wiring — it adds the Rust crate to `Cargo.toml`, the JS package to `package.json`, the permission to `capabilities/default.json`, and registers the plugin in `lib.rs`:

```sh
cd client
bun tauri add os
```

`os_ffi.js` calls the plugin to get the current platform string:

```js
// client/src/tauri/os_ffi.js

import { platform } from "@tauri-apps/plugin-os";

export function platform_string() {
  try {
    return platform();
  } catch {
    return "browser";
  }
}
```

The `try/catch` matters: `@tauri-apps/plugin-os` throws when called outside a Tauri context. Catching it and returning `"browser"` means the same code works in both environments without crashing.

```gleam
// client/src/tauri/os.gleam

@external(javascript, "./os_ffi.js", "platform_string")
pub fn platform_string() -> String
```

`platform.gleam` maps the raw string to a typed value:

```gleam
// client/src/platform.gleam

import tauri/os

pub type Platform {
  Browser
  MacOS
  Windows
  Linux
}

pub fn platform() -> Platform {
  case os.platform_string() {
    "macos" -> MacOS
    "windows" -> Windows
    "linux" -> Linux
    _ -> Browser
  }
}

pub fn is_desktop() -> Bool {
  case platform() {
    MacOS | Windows | Linux -> True
    _ -> False
  }
}
```

## Wiring the App

Previously `client.gleam` forwarded all messages directly to the router. With the menu as a second source of messages, a top-level `Msg` type is needed:

```gleam
// client/src/client.gleam

import browser                                                          // [!code ++]
import lustre
import lustre/effect.{type Effect}
import lustre/element.{type Element}
import modem
import router
import tauri/menu                                                       // [!code ++]

pub fn main() {
  let app = lustre.application(init, update, view)
  let assert Ok(_) = lustre.start(app, "#app", Nil)
}

pub type Msg {                                                         // [!code ++]
  RouterSentMsg(router.Msg)                                            // [!code ++]
  MenuSentEvent(String)                                                // [!code ++]
}                                                                      // [!code ++]

type Model {
  Model(page: router.Page)
}

fn init(_) -> #(Model, Effect(router.Msg)) {                                    // [!code --]
fn init(_) -> #(Model, Effect(Msg)) {                                           // [!code ++]
  let #(page, router_effect) = router.init(modem.initial_uri())
  #(
    Model(page:),
    effect.batch([modem.init(router.on_url_change), router_effect]),            // [!code --]
    effect.batch([                                                              // [!code ++]
      modem.init(router.on_url_change) |> effect.map(RouterSentMsg),            // [!code ++]
      router_effect |> effect.map(RouterSentMsg),                               // [!code ++]
      menu.subscribe(MenuSentEvent),                                            // [!code ++]
    ]),                                                                         // [!code ++]
  )
}

fn update(model: Model, msg: router.Msg) -> #(Model, Effect(router.Msg)) {      // [!code --]
  let #(page, effect) = router.update(model.page, msg)                          // [!code --]
  #(Model(page:), effect)                                                       // [!code --]
}                                                                               // [!code --]
fn update(model: Model, msg: Msg) -> #(Model, Effect(Msg)) {                    // [!code ++]
  case msg {                                                                    // [!code ++]
    RouterSentMsg(msg) -> {                                                     // [!code ++]
      let #(page, effect) = router.update(model.page, msg)
      #(Model(page:), effect |> effect.map(RouterSentMsg))                      // [!code ++]
    }                                                                           // [!code ++]
    MenuSentEvent("reload") -> {                                                // [!code ++]
      #(model, effect.from(fn(_) { browser.reload_page() }))                    // [!code ++]
    }                                                                           // [!code ++]
    MenuSentEvent(_) -> #(model, effect.none())                                 // [!code ++]
  }
}

fn view(model: Model) -> Element(router.Msg) {                                  // [!code --]
  router.view(model.page)                                                       // [!code --]
fn view(model: Model) -> Element(Msg) {                                         // [!code ++]
  router.view(model.page) |> element.map(RouterSentMsg)                         // [!code ++]
}
```

`effect.map(RouterSentMsg)` wraps every effect produced by the router so its messages arrive at the top level as `RouterSentMsg(...)`. `menu.subscribe(MenuSentEvent)` registers the listener once at startup. When Reload is triggered, `MenuSentEvent("reload")` arrives and calls `browser.reload_page()`. Unknown menu events are silently ignored — a safe default as the menu grows.

## Reload FFI

`browser.reload_page` is a thin external that calls `window.location.reload()`:

```gleam
// client/src/browser.gleam

@external(javascript, "./browser_ffi.js", "history_back")
pub fn history_back() -> Nil

@external(javascript, "./browser_ffi.js", "window_location_origin")
pub fn window_location_origin() -> String

@external(javascript, "./browser_ffi.js", "reload_page")    // [!code ++]
pub fn reload_page() -> Nil                                 // [!code ++]
```

```js
// client/src/browser_ffi.js

export function history_back() {
  window.history.back();
}

export function window_location_origin() {
  return window.location.origin;
}

export function reload_page() {    // [!code ++]
  window.location.reload();        // [!code ++]
}                                  // [!code ++]
```

## Text Selection

Web pages select text on click-drag. One CSS rule scoped to `body.desktop` disables it across the entire app:

```css
/* client/src/style.css */

@import "tailwindcss";
@plugin "daisyui";
@plugin "@iconify/tailwind4";

body.desktop * {             /* [!code ++] */
  -webkit-user-select: none; /* [!code ++] */
  user-select: none;         /* [!code ++] */
}                            /* [!code ++] */
```

`main.js` adds the class at startup using `is_desktop()`:

```js
// client/src/main.js

import { main } from "./client.gleam";
import { is_desktop } from "./platform.gleam";   // [!code ++]
import "./style.css";

document.addEventListener("DOMContentLoaded", () => {
  if (is_desktop()) {                            // [!code ++]
    document.body.classList.add("desktop");      // [!code ++]
  } else {                                       // [!code ++]
    document.body.classList.add("browser");      // [!code ++]
  }                                              // [!code ++]
  const dispatch = main({});                     
});                                              
```

Scoping the rule to `body.desktop` keeps the browser experience unchanged — text stays selectable when running in a regular browser tab.

## Running

```sh
cd client
bun tauri dev
```

A View menu appears in the menu bar. Selecting View → Reload — or pressing Cmd+R on macOS, Ctrl+R on Windows and Linux — reloads the page. Clicking and dragging over text no longer triggers selection.

## What's Next

The desktop app now has a View menu and no text selection. The next chapter continues the polish — replacing the browser's `fetch` with Tauri's built-in HTTP client.

[^1]: See commits [3052847](https://github.com/lukwol/doable/commit/3052847) and [ca34123](https://github.com/lukwol/doable/commit/ca34123) on GitHub
