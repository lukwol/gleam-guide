# Client Setup

With the backend running in Docker, it's time to build the frontend. [Lustre](https://hexdocs.pm/lustre/) is a Gleam framework for building browser UIs using the Model-View-Update (MVU) architecture — this chapter adds it to the client project and builds a small greeting app to verify the setup before moving on to the real task UI.

Two files change:

```sh
doable/
└── client/
    ├── gleam.toml         # lustre dependencies added  [!code highlight]
    └── src/
        └── client.gleam   # greeting app               [!code highlight]
```

## Install Dependencies

Lustre is split into two packages: the runtime and the development tools.

```sh
cd client
gleam add lustre
gleam add --dev lustre_dev_tools
```

After running these commands, `gleam.toml` gains two new entries[^1]:

```toml
[dependencies]
shared = { path = "../shared" }
gleam_stdlib = ">= 0.44.0 and < 2.0.0"
lustre = ">= 5.6.0 and < 6.0.0"            # [!code ++]

[dev_dependencies]
gleeunit = ">= 1.0.0 and < 2.0.0"
lustre_dev_tools = ">= 2.3.6 and < 3.0.0"  # [!code ++]
```

- **lustre** — the frontend runtime: the MVU loop, the HTML DSL, and the event system.
- **lustre_dev_tools** — a development server with live reloading and the `gleam run -m lustre/dev start` command. It's a dev dependency because it's not needed at runtime.

## The MVU Pattern

Lustre structures every application around four things:

- **Model** — the complete state of the application at any point in time.
- **Msg** — a description of something that happened (a user action, a server response, a timer firing).
- **update** — a pure function that produces a new model from the current model and a message.
- **view** — a pure function from Model to HTML. No state lives in the view.

When a `Msg` is dispatched, Lustre calls `update(model, msg)` to produce the next model, then calls `view(new_model)` to produce the new HTML. The cycle repeats for every event. Because `view` is a pure function, the UI is always a deterministic reflection of the model — there's no component state to keep in sync.

```
 ┌───▶ User interaction
 │           │
 │           ▼
 │        Message
 │           │
 │           ▼
 │   update(model, msg)
 │           │
 │           ▼
 │        new Model
 │           │
 │           ▼
 │      view(model)
 │           │
 │           ▼
 └───────── HTML
```

This is the `lustre.simple` loop — no side effects. Once the app needs to make HTTP requests, `update` will also return effects alongside the new model, and those effects can dispatch further messages back into the loop.

## The Greeting App

`client.gleam` implements a small app to validate the setup. A user types a name, clicks a button, and sees a greeting:

```gleam
import lustre
import lustre/element.{text}
import lustre/element/html.{button, div, input, p}
import lustre/event.{on_click, on_input}

pub fn main() {
  let app = lustre.simple(init, update, view)
  let assert Ok(_) = lustre.start(app, "#app", Nil)

  Nil
}

type Model {
  Model(name: String, greeting: String)
}

fn init(_flags) {
  Model(name: "", greeting: "")
}

type Msg {
  UserUpdatedName(String)
  UserClickedGreet
}

fn update(model: Model, msg: Msg) {
  case msg {
    UserUpdatedName(name) -> Model(..model, name: name)
    UserClickedGreet -> Model(..model, greeting: "Hello " <> model.name <> "!")
  }
}

fn view(model: Model) {
  div([], [
    input([on_input(UserUpdatedName)]),
    button([on_click(UserClickedGreet)], [text("Greet")]),
    p([], [text(model.greeting)]),
  ])
}
```

Walking through each part:

### `main`

```gleam
let app = lustre.simple(init, update, view)
let assert Ok(_) = lustre.start(app, "#app", Nil)
```

`lustre.simple` assembles the three MVU functions into an app. `lustre.start` mounts it onto the DOM element matching `#app` and passes `Nil` as the initial flags — flags are how the host page passes data in at startup; we don't need any yet.

### Model

```gleam
type Model {
  Model(name: String, greeting: String)
}

fn init(_flags) {
  Model(name: "", greeting: "")
}
```

The model holds all state: the text typed into the input and the greeting displayed below the button. `init` returns the initial model — both fields empty at startup.

### Messages

```gleam
type Msg {
  UserUpdatedName(String)
  UserClickedGreet
}
```

`Msg` is a custom type — each variant represents one thing that can happen. `UserUpdatedName` carries the current input value, dispatched on every keystroke via `on_input`. `UserClickedGreet` carries no data; it's dispatched when the button is clicked.

Lustre recommends naming messages in subject-verb-object form — `UserUpdatedName` rather than `UpdateName`. This makes it immediately clear what triggered the message, which becomes valuable as the message type grows.

### Update

```gleam
fn update(model: Model, msg: Msg) {
  case msg {
    UserUpdatedName(name) -> Model(..model, name: name)
    UserClickedGreet -> Model(..model, greeting: "Hello " <> model.name <> "!")
  }
}
```

`update` is a pure function — it takes the current model and a message and returns the next model. `Model(..model, name: name)` is Gleam's record update syntax: copy `model` with `name` replaced. No mutation, no side effects.

### View

```gleam
fn view(model: Model) {
  div([], [
    input([on_input(UserUpdatedName)]),
    button([on_click(UserClickedGreet)], [text("Greet")]),
    p([], [text(model.greeting)]),
  ])
}
```

HTML elements are regular Gleam functions. Each takes two arguments: a list of attributes and a list of children. `on_input` and `on_click` are event handlers that dispatch `Msg` values — when the user types, `UserUpdatedName` is dispatched with the new value; when they click, `UserClickedGreet` is dispatched.

## Running the Dev Server

`lustre_dev_tools` provides a development server that compiles the Gleam source to JavaScript and serves it at `localhost:1234` with live reloading:

```sh
cd client
gleam run -m lustre/dev start
```

On first run, `lustre_dev_tools` creates a `.lustre/` directory alongside the client source with a generated `index.html` that mounts the app on `<div id="app">`. This is the entry point that `lustre.start(app, "#app", Nil)` targets.

Open `http://localhost:1234` in a browser, type a name, and click the button. The greeting appears below — the Lustre setup is working.

## What's Next

The MVU skeleton is in place. The next step is building the actual task UI — fetching tasks from the API, rendering a task list, and wiring up the create, update, and delete interactions.

[^1]: See commit [7a7e39d](https://github.com/lukwol/doable/commit/7a7e39d) on GitHub
