# Pull-to-Refresh

Mobile has no menu bar and no Cmd+R. If tasks go stale, there's no way to reload — until now. This chapter adds pull-to-refresh: swipe down from the top of the list to trigger a reload, with a haptic tick when the pull crosses the threshold.

Following Tauri's [haptics plugin guide](https://v2.tauri.app/plugin/haptics/), a new `pull_refresh.gleam` component handles the touch state and visual indicator, `haptics.gleam` wraps the native feedback, and `tasks.gleam` splits into separate mobile and desktop views. Ten files change, five are new[^1]:

```sh
doable/
└── client/
    ├── package.json                       # @tauri-apps/plugin-haptics added      [!code highlight]
    ├── src-tauri/
    │   ├── Cargo.toml                     # tauri-plugin-haptics (mobile only)    [!code highlight]
    │   ├── capabilities/
    │   │   └── mobile.json                # haptics permission, mobile-scoped     [!code ++]
    │   └── src/
    │       └── lib.rs                     # haptics in mobile setup_platform      [!code highlight]
    └── src/
        ├── component/
        │   └── pull_refresh.gleam         # touch state + indicator               [!code ++]
        ├── page/
        │   └── tasks.gleam                # pull state, view split                [!code highlight]
        └── tauri/
            ├── haptics.gleam              # ImpactStyle + effect                  [!code ++]
            └── haptics_ffi.js             # impactFeedback wrapper                [!code ++]
```

## Installing the Haptics Plugin

```sh
cd client
bun tauri add haptics
```

The CLI adds `tauri-plugin-haptics` to `Cargo.toml` and `@tauri-apps/plugin-haptics` to `package.json`. Unlike the HTTP and OS plugins, haptics only exist on mobile — calling them on desktop would crash. The Cargo dependency is scoped accordingly:

```toml
# client/src-tauri/Cargo.toml

[target.'cfg(any(target_os = "android", target_os = "ios"))'.dependencies]  # [!code ++]
tauri-plugin-haptics = "2"                                                   # [!code ++]
```

The `[target.'cfg(...)'.dependencies]` table means the crate only compiles in when building for Android or iOS — the desktop build never sees it.

## Mobile Capability

`bun tauri add haptics` added `haptics:default` to `capabilities/default.json`, but haptics only exist on mobile. Moving the permission to a dedicated `mobile.json` keeps it out of desktop builds entirely, and narrowing it from `haptics:default` to `haptics:allow-impact-feedback` grants only what the app actually uses:

```json
// client/src-tauri/capabilities/mobile.json

{
  "identifier": "mobile-capability",
  "platforms": ["android", "iOS"],
  "windows": ["main"],
  "permissions": ["haptics:allow-impact-feedback"]
}
```

The `"platforms"` field is what `default.json` lacks — Tauri only applies this capability when building for Android or iOS.

## Registering the Plugin

The haptics plugin is registered inside the mobile `setup_platform()` impl, so it's completely absent from desktop builds:

```rust
// client/src-tauri/src/lib.rs

#[cfg(mobile)]
impl<R: Runtime> BuilderExt<R> for Builder<R> {
    fn setup_platform(self) -> Self {
        self                            // [!code --]
        self.setup(|app| {              // [!code ++]
            app.handle().plugin(tauri_plugin_haptics::init())?; // [!code ++]
            Ok(())                      // [!code ++]
        })                              // [!code ++]
    }
}
```

The desktop impl is unchanged — it still sets up the menu and menu event handler.

## The Haptics Bridge

`haptics_ffi.js` is a thin wrapper around the plugin's `impactFeedback` function:

```js
// client/src/tauri/haptics_ffi.js

import { impactFeedback } from "@tauri-apps/plugin-haptics";

export async function impact_feedback(style) {
  await impactFeedback(style);
}
```

`haptics.gleam` exposes it as a typed Lustre effect:

```gleam
// client/src/tauri/haptics.gleam

import lustre/effect.{type Effect}

pub type ImpactStyle {
  Light
  Medium
  Heavy
  Soft
  Rigid
}

@external(javascript, "./haptics_ffi.js", "impact_feedback")
fn do_impact(style: String) -> Nil

fn impact_style_string(style: ImpactStyle) -> String {
  case style {
    Light -> "light"
    Medium -> "medium"
    Heavy -> "heavy"
    Soft -> "soft"
    Rigid -> "rigid"
  }
}

pub fn impact_feedback(style: ImpactStyle) -> Effect(msg) {
  use _ <- effect.from
  style
  |> impact_style_string
  |> do_impact
}
```

`impact_feedback` returns a Lustre effect that fires the native feedback for the given style. The effect itself has no platform guard — it's up to the call site to only dispatch it on mobile.

## The Pull-Refresh Component

`pull_refresh.gleam` is a self-contained component that handles touch tracking, threshold detection, and the animated indicator. It exposes everything the page needs without leaking implementation details:

```gleam
// client/src/component/pull_refresh.gleam

pub const threshold = 120.0

pub type PullState {
  Idle
  Pulling(start_y: Float, offset: Float)
  RefreshTriggered
}

pub fn release(pull_state: PullState) -> PullState {
  case pull_state {
    Pulling(offset:, ..) if offset >=. threshold -> RefreshTriggered
    _ -> Idle
  }
}
```

`threshold` is the pixel distance a pull must travel before releasing triggers a refresh. `release` is called on `touchend` — it returns `RefreshTriggered` if the threshold was met, `Idle` otherwise.

Three event attributes wire the container element to the touch lifecycle:

```gleam
// client/src/component/pull_refresh.gleam

pub fn on_touch_start(to_msg: fn(Float) -> msg) -> Attribute(msg) {
  event.on("touchstart", touch_start_decoder(to_msg))
}

pub fn on_touch_move(to_msg: fn(Float) -> msg) -> Attribute(msg) {
  event.on("touchmove", touch_y_decoder(to_msg))
}

pub fn on_touch_end(msg: msg) -> Attribute(msg) {
  event.on("touchend", decode.success(msg))
}
```

The `touchstart` decoder has one extra guard — it only fires when the page is scrolled to the top:

```gleam
// client/src/component/pull_refresh.gleam

fn touch_start_decoder(to_msg: fn(Float) -> msg) -> decode.Decoder(msg) {
  use scroll_y <- decode.then(decode.at(["view", "scrollY"], decode.int))
  use <- bool.guard(scroll_y != 0, decode.failure(to_msg(0.0), "not at top"))
  touch_y_decoder(to_msg)
}

fn touch_y_decoder(to_msg: fn(Float) -> msg) -> decode.Decoder(msg) {
  decode.at(["touches", "0", "clientY"], decode.float)
  |> decode.map(to_msg)
}
```

`decode.failure` causes the event to be dropped without dispatching a message — pulling from mid-scroll doesn't activate the refresh.

The `indicator` function renders the visual feedback: a downward arrow that rotates as the pull progresses, replaced by a spinner once loading starts. It sits outside the normal document flow, translated so it slides in from behind the status bar:

```gleam
// client/src/component/pull_refresh.gleam

pub fn indicator(refreshing: Bool, pull_state: PullState) -> Element(msg) {
  let pull_offset = case pull_state {
    Pulling(offset:, ..) -> offset
    _ -> 0.0
  }
  let progress = float.min(1.0, pull_offset /. threshold)
  let #(indicator_y, indicator_opacity) = case refreshing {
    True -> #(0.0, "1")
    False -> #(
      { progress *. indicator_height } -. indicator_height,
      float.to_string(progress),
    )
  }
  let transition = case pull_offset >. 0.0 {
    True -> "none"
    False -> "transform 0.2s ease-out, opacity 0.2s ease-out"
  }
  let icon = case refreshing {
    True -> html.span([attr.class("loading loading-spinner loading-lg")], [])
    False ->
      html.span(
        [
          attr.class("icon-[heroicons--arrow-down] text-3xl"),
          attr.style(
            "transform",
            "rotate(" <> float.to_string(progress *. 180.0) <> "deg)",
          ),
          attr.style("transition", "transform 0.1s linear"),
        ],
        [],
      )
  }

  html.div(
    [
      attr.class(
        "flex absolute inset-x-0 top-0 justify-center items-center h-12",
      ),
      attr.style(
        "transform",
        "translateY(calc("
          <> float.to_string(indicator_y)
          <> "px + env(safe-area-inset-top)))",
      ),
      attr.style("opacity", indicator_opacity),
      attr.style("transition", transition),
    ],
    [icon],
  )
}
```

`progress` runs from `0.0` to `1.0` as the offset approaches `threshold`. While pulling, transitions are disabled so the indicator tracks the finger exactly. Once the finger lifts, transitions re-enable and the indicator snaps back smoothly.

## Wiring tasks.gleam

`Model` gets a `pull_state` field, and three new messages cover the touch lifecycle:

```gleam
// client/src/page/tasks.gleam

pub type Model {
  Model(
    tasks: Result(List(Task), ApiError),
    loading: Bool,
    pull_state: PullState,              // [!code ++]
  )
}

pub type Msg {
  ApiReturnedTasks(Result(List(Task), ApiError))
  UserToggledTask(Task, Bool)
  ApiUpdatedTask(Result(Task, ApiError))
  UserStartedTouch(Float)               // [!code ++]
  UserMovedTouch(Float)                 // [!code ++]
  UserEndedTouch                        // [!code ++]
}

pub fn init() -> #(Model, Effect(Msg)) {
  #(Model(tasks: Ok([]), loading: True, pull_state: Idle), fetch_tasks())  // [!code highlight]
}
```

The `update` function gains three new cases at the end of its `case msg` block:

```gleam
// client/src/page/tasks.gleam

pub fn update(model: Model, msg: Msg) -> #(Model, Effect(Msg)) {
  case msg {
    ApiReturnedTasks(Ok(tasks)) -> #(
      Model(..model, tasks: Ok(tasks), loading: False),
      effect.none(),
    )
    ApiReturnedTasks(Error(err)) -> #(
      Model(..model, tasks: Error(err), loading: False),
      effect.none(),
    )
    UserToggledTask(task, completed) -> #(model, toggle_task(task, completed))
    ApiUpdatedTask(Ok(updated)) -> #(...)
    ApiUpdatedTask(Error(_)) -> #(model, effect.none())
    UserStartedTouch(y) -> #(                                              // [!code ++]
      Model(..model, pull_state: Pulling(start_y: y, offset: 0.0)),        // [!code ++]
      effect.none(),                                                        // [!code ++]
    )                                                                       // [!code ++]
    UserMovedTouch(y) ->                                                    // [!code ++]
      case model.pull_state {                                               // [!code ++]
        Idle | RefreshTriggered -> #(model, effect.none())                  // [!code ++]
        Pulling(start_y:, offset: prev_offset) -> {                        // [!code ++]
          let offset =                                                      // [!code ++]
            float.max(0.0, y -. start_y)                                   // [!code ++]
            |> float.min(pull_refresh.threshold, _)                        // [!code ++]
          let crossed =                                                     // [!code ++]
            prev_offset <. pull_refresh.threshold                          // [!code ++]
            && offset >=. pull_refresh.threshold                           // [!code ++]
          let haptic = case crossed {                                       // [!code ++]
            True -> haptics.impact_feedback(haptics.Light)                 // [!code ++]
            False -> effect.none()                                         // [!code ++]
          }                                                                 // [!code ++]
          #(Model(..model, pull_state: Pulling(start_y:, offset:)), haptic) // [!code ++]
        }                                                                   // [!code ++]
      }                                                                     // [!code ++]
    UserEndedTouch ->                                                       // [!code ++]
      case pull_refresh.release(model.pull_state) {                        // [!code ++]
        RefreshTriggered -> #(                                              // [!code ++]
          Model(..model, loading: True, pull_state: Idle),                 // [!code ++]
          fetch_tasks(),                                                    // [!code ++]
        )                                                                   // [!code ++]
        _ -> #(Model(..model, pull_state: Idle), effect.none())            // [!code ++]
      }                                                                     // [!code ++]
  }
}
```

`UserStartedTouch` arms the gesture by recording the finger's starting Y position. `UserMovedTouch` computes how far the pull has traveled, clamps it to `threshold` so the indicator stops once the refresh is committed, then checks whether the offset just crossed the threshold — if so, one haptic tick fires. `UserEndedTouch` delegates to `pull_refresh.release`: if the threshold was met it resets pull state and dispatches `fetch_tasks()`, otherwise it just resets.

## Splitting the View

The tasks view now branches on platform:

```gleam
// client/src/page/tasks.gleam

pub fn view(model: Model) -> Element(Msg) {
  case platform.is_mobile() {           // [!code ++]
    True -> view_mobile(model)          // [!code ++]
    False -> view_desktop(model)        // [!code ++]
  }                                     // [!code ++]
}
```

`view_mobile` attaches the touch handlers to the container and overlays the indicator. `view_desktop` keeps the loading spinner. Both delegate the actual content to `view_content`, which takes a `loading_placeholder` parameter:

```gleam
// client/src/page/tasks.gleam

fn view_mobile(model: Model) -> Element(Msg) {
  html.div(
    [
      attribute.class("min-h-screen bg-base-200"),
      pull_refresh.on_touch_start(UserStartedTouch),
      pull_refresh.on_touch_move(UserMovedTouch),
      pull_refresh.on_touch_end(UserEndedTouch),
    ],
    [
      view_content(model, loading_placeholder: element.none()),
      pull_refresh.indicator(model.loading, model.pull_state),
    ],
  )
}

fn view_desktop(model: Model) -> Element(Msg) {
  html.div([attribute.class("min-h-screen bg-base-200")], [
    view_content(
      model,
      loading_placeholder: html.div(
        [attribute.class("flex justify-center p-8")],
        [
          html.span([attribute.class("loading loading-spinner loading-lg")], []),
        ],
      ),
    ),
  ])
}
```

On mobile, the loading placeholder is `element.none()` — the pull indicator is the feedback instead of an inline spinner.

## Running

```sh
cd client
bun tauri ios dev
```

Swipe down from the top of the task list. The arrow appears and rotates as it's pulled; a haptic tick fires when it crosses the threshold; releasing triggers a reload. On Android:

```sh
bun tauri android dev
```

The gesture and visual indicator work the same way. Haptic feedback varies by device — physical Android devices are reliable, emulators typically skip it.

## What's Next

Pull-to-refresh works in dev, but the API URL is still hardcoded to `localhost:8000`. That's wrong for production builds and wrong for physical devices on a real network. The next chapter resolves the base URL by platform and build mode, then takes the app out of the simulator and onto real devices and release builds.

[^1]: See commit [919a15c](https://github.com/lukwol/doable/commit/919a15c) on GitHub
