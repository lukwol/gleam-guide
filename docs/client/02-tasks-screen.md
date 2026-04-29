# Tasks Screen

With the Lustre skeleton in place, it's time to replace the greeting app with the real task UI. In this chapter we'll fetch tasks from the API and render them as a list — introducing effects, a dedicated HTTP client, and error handling along the way[^1].

Six files change, four are new:

```sh
doable/
└── client/
    ├── gleam.toml              # 4 new deps + dev proxy config  [!code highlight]
    └── src/
        ├── error.gleam         # ApiError type                  [!code ++]
        ├── api.gleam           # HTTP client                    [!code ++]
        ├── browser.gleam       # window.location.origin FFI     [!code ++]
        ├── browser_ffi.js      # FFI implementation             [!code ++]
        └── client.gleam        # tasks screen                   [!code highlight]
```

## Install Dependencies

Making HTTP requests from the browser requires four packages:

```sh
cd client
gleam add gleam_http gleam_fetch gleam_javascript gleam_json
```

`gleam.toml` gains four new entries:

```toml
# client/gleam.toml

[dependencies]
shared = { path = "../shared" }
gleam_stdlib = ">= 0.44.0 and < 2.0.0"
gleam_javascript = ">= 1.0.0 and < 2.0.0"   # [!code ++]
gleam_json = ">= 3.1.0 and < 4.0.0"         # [!code ++]
gleam_http = ">= 4.0.0 and < 5.0.0"         # [!code ++]
gleam_fetch = ">= 1.3.0 and < 2.0.0"        # [!code ++]
lustre = ">= 5.6.0 and < 6.0.0"
```

- **gleam_http** — shared request and response types used across Gleam's HTTP ecosystem.
- **gleam_fetch** — a thin wrapper around the browser's native [Fetch API](https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API).
- **gleam_javascript** — exposes browser primitives, including `Promise`.
- **gleam_json** — JSON decoding, shared with the server and `shared` packages.

## Error Handling

A new `error.gleam` module defines all the ways an API call can fail:

```gleam
// client/src/error.gleam

import gleam/dynamic/decode
import gleam/fetch
import gleam/int

pub type ApiError {
  InvalidUrl(url: String)
  UnexpectedStatus(status: Int)
  FetchError(fetch.FetchError)
  DecodeError(List(decode.DecodeError))
}

pub fn message(error: ApiError) -> String {
  case error {
    InvalidUrl(url) -> "Invalid URL: " <> url
    UnexpectedStatus(status) -> "Unexpected status: " <> int.to_string(status)
    FetchError(fetch.NetworkError(detail)) -> "Network error: " <> detail
    FetchError(fetch.UnableToReadBody) -> "Unable to read response body"
    FetchError(fetch.InvalidJsonBody) -> "Response is not valid JSON"
    DecodeError(_) -> "Failed to decode response"
  }
}
```

`ApiError` covers every failure the API client can produce:

- **`InvalidUrl`** — the URL string couldn't be parsed into a request.
- **`UnexpectedStatus`** — the server responded with a status code outside the expected set.
- **`FetchError`** — a network-level failure from `gleam_fetch`.
- **`DecodeError`** — the response body didn't match the expected JSON shape.

The `message` helper turns any error into a human-readable string. All the pattern matching happens here, once — the view just calls `error.message(err)`.

## The API Client

`api.gleam` provides a single public function, `get`, that sends a JSON request and decodes the response:

```gleam
// client/src/api.gleam

import error.{
  type ApiError, DecodeError, FetchError, InvalidUrl, UnexpectedStatus,
}
import gleam/bool
import gleam/dynamic/decode.{type Decoder}
import gleam/fetch
import gleam/http.{Get}
import gleam/http/request.{type Request}
import gleam/javascript/promise.{type Promise}
import gleam/result

pub fn get(path: String, decoder: Decoder(a)) -> Promise(Result(a, ApiError)) {
  use req <- with_json_request(path)
  req
  |> request.set_method(Get)
  |> execute(expect: 200, decoder:)
}
```

`get` takes a path and a decoder, and returns a `Promise` that resolves to either the decoded value or an `ApiError`.

### Building the Request

`with_json_request` constructs a base request or returns early if the URL is invalid:

```gleam
// client/src/api.gleam

import browser

fn api_base_url() -> String {
  browser.window_location_origin()
}

fn with_json_request(
  path: String,
  callback: fn(Request(String)) -> Promise(Result(b, ApiError)),
) -> Promise(Result(b, ApiError)) {
  let url = api_base_url() <> path
  request.to(url)
  |> result.replace_error(InvalidUrl(url))
  |> result.map(request.set_header(_, "accept", "application/json"))
  |> promise.resolve
  |> promise.try_await(callback)
}
```

`api_base_url` reads the page's own origin at runtime — `http://localhost:1234` in dev, whatever the deployment URL is in production. The `browser` module is a thin FFI wrapper introduced a few sections below.

1. `request.to` parses the URL, returning `Error(Nil)` on failure. `result.replace_error` swaps that for a meaningful `InvalidUrl`.
2. `result.map` adds the `accept` header to the request.
3. `promise.resolve` lifts the `Result` into a resolved promise so the rest of the chain can use `promise.try_await` — which calls `callback` only on `Ok`, and short-circuits with the error otherwise.

### Executing the Request

```gleam
// client/src/api.gleam

fn execute(
  req: Request(String),
  expect expect: Int,
  decoder decoder: Decoder(a),
) -> Promise(Result(a, ApiError)) {
  req
  |> fetch.send
  |> promise.try_await(fetch.read_json_body)
  |> promise.map(result.map_error(_, FetchError))
  |> promise.map_try(fn(response) {
    use <- bool.guard(
      response.status != expect,
      Error(UnexpectedStatus(response.status)),
    )
    response.body
    |> decode.run(decoder)
    |> result.map_error(DecodeError)
  })
}
```

The pipeline sends the request and processes the response in four steps:

1. `fetch.send` dispatches the request and returns a promise of a raw response.
2. `fetch.read_json_body` reads and parses the body as JSON; `promise.try_await` short-circuits if reading fails.
3. `promise.map` wraps any `fetch.FetchError` into our `ApiError` type.
4. `promise.map_try` validates the status code with `bool.guard` — which returns its second argument early if the condition is true — then decodes the body with the provided decoder.

## Enabling Effects

The greeting app used `lustre.simple`, which only allows pure state updates. To make HTTP requests, `client.gleam` upgrades to `lustre.application`:

```gleam
// client/src/client.gleam

pub fn main() {
  let app = lustre.application(init, update, view) // [!code highlight]
  let assert Ok(_) = lustre.start(app, "#app", Nil)
}
```

With `lustre.simple`, `init` returns `Model` and `update` returns `Model`. With `lustre.application`, both return `#(Model, Effect(Msg))` — a tuple pairing the new model with an optional side effect to run. Effects run outside the pure `update` function and feed their results back in as messages.

```
┌───▶ User interaction
│           │
│           ▼
│        Message ◀──────────────────┐
│           │                       │
│           ▼                       │
│   update(model, msg) ──▶ Effect   │
│           │               │       │
│           ▼               ▼       │
│        new Model     Effect runs  │
│           │          (HTTP, …)    │
│           ▼               │       │
│      view(model)          └───────┘
│           │
│           ▼
└──────────HTML
```

## Model and Messages

The model now holds the task list and a loading flag:

```gleam
// client/src/client.gleam

pub type Model {
  Model(tasks: Result(List(Task), ApiError), loading: Bool)
}

pub type Msg {
  ApiReturnedTasks(Result(List(Task), ApiError))
}
```

`tasks` is a `Result` — it holds either a list of tasks or the error that prevented fetching them. `loading` tracks whether a fetch is in flight; it's separate from `tasks` so the loading state is readable independently of whether there's already data.

`Msg` has a single variant. Following Lustre's subject-verb-object convention, `ApiReturnedTasks` names the source (`Api`) and the event (`ReturnedTasks`).

## Fetching on Init

`init` starts a fetch immediately:

```gleam
// client/src/client.gleam

pub fn init(_) -> #(Model, Effect(Msg)) {
  #(Model(tasks: Ok([]), loading: True), fetch_tasks())
}

fn fetch_tasks() -> Effect(Msg) {
  use dispatch <- effect.from
  api.get("/api/tasks", decode.list(task.task_decoder()))
  |> promise.map(ApiReturnedTasks)
  |> promise.tap(dispatch)
  Nil
}
```

`effect.from` creates an effect from a callback that receives `dispatch` — the function that sends messages back into the MVU loop. Inside the callback, `api.get` returns a promise; `promise.map` wraps the result in `ApiReturnedTasks`; `promise.tap` calls `dispatch` with that message when the promise resolves, without consuming the value. The trailing `Nil` satisfies Gleam's requirement that every function returns a value — `effect.from` ignores it.

## Update

`update` handles the single message:

```gleam
// client/src/client.gleam

pub fn update(_model: Model, msg: Msg) -> #(Model, Effect(Msg)) {
  case msg {
    ApiReturnedTasks(Ok(tasks)) -> #(
      Model(tasks: Ok(tasks), loading: False),
      effect.none(),
    )
    ApiReturnedTasks(Error(err)) -> #(
      Model(tasks: Error(err), loading: False),
      effect.none(),
    )
  }
}
```

The previous model is ignored for now (`_model`) — the response carries the full new state. Both branches set `loading: False` — the fetch has settled regardless of outcome. `effect.none()` signals that no further side effects are needed.

## View

```gleam
// client/src/client.gleam

pub fn view(model: Model) -> Element(Msg) {
  html.div([], [
    html.h1([], [element.text("Tasks")]),
    case model.tasks {
      Error(err) -> html.p([], [element.text(error.message(err))])
      Ok([]) if model.loading -> html.p([], [element.text("Loading...")])
      Ok([]) -> html.p([], [element.text("No tasks yet")])
      Ok(tasks) -> html.ul([], list.map(tasks, view_task))
    },
  ])
}

fn view_task(task: Task) -> Element(Msg) {
  html.li([], [
    html.input([
      attribute.type_("checkbox"),
      attribute.checked(task.completed),
      attribute.disabled(True),
    ]),
    element.text(task.name <> " — " <> task.description),
  ])
}
```

The `case` on `model.tasks` covers all four states:

- **Error** — display the error message via `error.message`.
- **`Ok([]) if model.loading`** — the list is empty _and_ a fetch is in flight: show "Loading…". The guard clause distinguishes this from an empty list that has already loaded.
- **`Ok([])`** — fetch complete but no tasks: "No tasks yet".
- **`Ok(tasks)`** — render the list.

`view_task` renders each task as a list item with a read-only checkbox. The checkbox reflects the task's `completed` state but `attribute.disabled(True)` prevents interaction for now.

<figure>
  <img src="/screenshots/tasks-readonly.png">
  <figcaption>Tasks screen showing a read-only list fetched from the API</figcaption>
</figure>

## Browser FFI

`api_base_url` reaches for `window.location.origin`, which isn't in the Gleam standard library. A tiny FFI module bridges the gap:

```gleam
// client/src/browser.gleam

@external(javascript, "./browser_ffi.js", "window_location_origin")
pub fn window_location_origin() -> String
```

```js
// client/src/browser_ffi.js

export function window_location_origin() {
  return window.location.origin;
}
```

`@external` declares a Gleam function that's implemented in another language. The three arguments are the target (`javascript`), the module path relative to this file, and the exported function name. Callers use `browser.window_location_origin()` like any other Gleam function — the FFI boundary is invisible.

## Proxying the API in Dev

`window.location.origin` returns `http://localhost:1234` in dev — but the API runs on port 8000. Hitting it directly would be a cross-origin request, which the browser blocks by default.

`lustre_dev_tools` has a built-in dev proxy for exactly this situation. A small addition to `gleam.toml` tells it to forward `/api/*` requests to the Gleam server, and while we're here we set the page title too:

```toml
# client/gleam.toml

[tools.lustre.html]                                          # [!code ++]
title = "Doable"                                             # [!code ++]

[tools.lustre.dev]                                           # [!code ++]
proxy = { from = "/api", to = "http://localhost:8000/api" }  # [!code ++]
```

The browser sends the request to the dev server (same origin — no CORS), the dev server relays it to `localhost:8000`, and the response flows back the same way.

::: info
[CORS](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS) (Cross-Origin Resource Sharing) is a browser security mechanism that blocks requests between different origins by default. Proxying through the dev server keeps everything same-origin, so no `Access-Control-Allow-*` headers are needed on the server. In production the API and frontend are served from the same origin via Caddy, so the setup stays consistent.
:::

## What's Next

Tasks load from the API and render as a list — but the app is still one page crammed into `client.gleam`. Next, we'll carve it into modules: a `Route` type, a router, per-page files, and a task service so adding new screens doesn't mean bloating one file.

[^1]: See commit [e604a08](https://github.com/lukwol/doable/commit/e604a08) on GitHub
