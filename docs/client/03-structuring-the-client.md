# Structuring the Client

The tasks screen works, but everything still lives in `client.gleam` — one file with no room to grow. In this chapter we'll give the client a proper shape: a `Route` type to describe URLs, a `Router` to map routes to pages, a service module for API calls, and a slimmed-down `client.gleam` that hands off almost everything to the router[^1].

Five files change, four are new:

```sh
doable/
└── client/
    ├── gleam.toml              # modem dependency added        [!code highlight]
    └── src/
        ├── route.gleam         # Route type and URL parsing    [!code ++]
        ├── router.gleam        # Page type, routing logic      [!code ++]
        ├── service/
        │   └── task_service.gleam  # task API service          [!code ++]
        ├── page/
        │   └── tasks.gleam     # tasks page extracted          [!code ++]
        └── client.gleam        # delegates to router           [!code highlight]
```

## Install Dependencies

Routing needs one new package:

```sh
cd client
gleam add modem
```

`gleam.toml` gains one entry:

```toml
# client/gleam.toml

[dependencies]
...
lustre = ">= 5.6.0 and < 6.0.0"
modem = ">= 2.1.2 and < 3.0.0"   # [!code ++]
```

[Modem](https://hexdocs.pm/modem/) is Lustre's companion library for browser URL management. It intercepts link clicks and browser navigation, converting them into messages that flow back into the MVU loop.

## Defining Routes

`route.gleam` is the single source of truth for every URL in the app:

```gleam
// client/src/route.gleam

import gleam/uri.{type Uri}

pub const home_route = Tasks

pub type Route {
  Tasks
}

pub fn to_path(route: Route) -> String {
  case route {
    Tasks -> "/tasks"
  }
}

pub fn from_uri(uri: Uri) -> Route {
  case uri.path_segments(uri.path) {
    ["tasks"] -> Tasks
    _ -> home_route
  }
}
```

`Route` is a custom type with one variant for each page — just `Tasks` for now, but it'll grow as the app does. Keeping routes as a type means the compiler will flag any unhandled route the moment a new one is added.

`to_path` converts a `Route` to its URL string. `from_uri` does the reverse — it parses a URI's path segments and returns the matching `Route`, falling back to `home_route` for anything unrecognised.

## Task Service

Before extracting the tasks page, the direct `api.get` call from `client.gleam` is lifted into its own module. `service/task_service.gleam` will be the home for all task-related API calls as the app grows:

```gleam
// client/src/service/task_service.gleam

import api
import error.{type ApiError}
import gleam/dynamic/decode
import gleam/javascript/promise.{type Promise}
import task.{type Task}

pub fn fetch_tasks() -> Promise(Result(List(Task), ApiError)) {
  "/api/tasks"
  |> api.get(decode.list(task.task_decoder()))
}
```

`fetch_tasks` wraps the same `api.get` call that previously lived inline in `client.gleam` — the behaviour is identical, just better placed. Keeping API logic out of page modules means pages stay focused on UI, and adding or changing an endpoint only touches one file.

## Extracting the Tasks Page

The MVU code from the previous chapter moves into `page/tasks.gleam`. Each page gets its own module with the same shape: `Model`, `Msg`, `init`, `update`, and `view`. This keeps pages self-contained and easy to find — when something on the tasks page needs fixing, you know exactly where to look.

The one adjustment is in `fetch_tasks`, which now delegates to the service instead of calling `api` directly:

```gleam
// client/src/page/tasks.gleam

fn fetch_tasks() -> Effect(Msg) {
  use dispatch <- effect.from
  task_service.fetch_tasks()
  |> promise.map(ApiReturnedTasks)
  |> promise.tap(dispatch)
  Nil
}
```

## The Router

`router.gleam` is the heart of this chapter. It owns the `Page` type — a wrapper that holds whichever page is currently active — and handles all navigation.

### Page and Messages

```gleam
// client/src/router.gleam

pub type Page {
  TasksPage(tasks.Model)
}

pub type Msg {
  OnRouteChanged(route.Route)
  TasksPageSentMsg(tasks.Msg)
}
```

`Page` wraps each page's model in its own variant. When a second page is added, it gets a second variant alongside `TasksPage`.

`Msg` follows the same idea. `OnRouteChanged` fires when the URL changes. `TasksPageSentMsg` wraps messages that originate inside the tasks page — this is how the router stays in control of the message flow without needing to know anything about what goes on inside each page.

### Init

```gleam
// client/src/router.gleam

pub fn init(initial_uri: Result(Uri, Nil)) -> #(Page, Effect(Msg)) {
  initial_uri
  |> result.map(page_from_uri)
  |> result.unwrap(page_from_route(route.home_route))
}
```

`init` takes the current browser URI and resolves it to the right starting page. If parsing the URI fails for any reason, it falls back to the home route. The URI is passed in rather than read here, which keeps `init` easier to test.

### Update

```gleam
// client/src/router.gleam

pub fn update(page: Page, msg: Msg) -> #(Page, Effect(Msg)) {
  case msg, page {
    OnRouteChanged(route), _ -> page_from_route(route)
    TasksPageSentMsg(page_msg), TasksPage(page_model) -> {
      let #(new_page_model, effect) = tasks.update(page_model, page_msg)
      #(TasksPage(new_page_model), effect.map(effect, TasksPageSentMsg))
    }
  }
}
```

`update` matches on both the message and the current page together. `OnRouteChanged` always navigates to the new page regardless of what's active. `TasksPageSentMsg` unwraps the inner message, delegates to `tasks.update`, then re-wraps the result.

The `effect.map(effect, TasksPageSentMsg)` call is worth pausing on. `tasks.update` returns an `Effect(tasks.Msg)`, but the router works with `Effect(router.Msg)`. `effect.map` transforms one into the other by running the effect and wrapping whatever message it produces in `TasksPageSentMsg`. The same pattern applies to every page — the router never has to know what effects a page runs, only how to wrap their results.

::: info
`effect.map` and `element.map` are the same idea applied in two places: `effect.map` lifts effect message types up to the router level, `element.map` does the same for view message types. Every page added to the router uses both — wrapping its `Effect(page.Msg)` and its `Element(page.Msg)` into the router's own `Msg` type.
:::

### View

```gleam
// client/src/router.gleam

pub fn view(page: Page) -> Element(Msg) {
  case page {
    TasksPage(page_model) ->
      tasks.view(page_model) |> element.map(TasksPageSentMsg)
  }
}
```

`view` delegates to the active page and uses `element.map` to wrap every `tasks.Msg` the view might emit into a `TasksPageSentMsg`. This mirrors what `effect.map` does for effects — keeping all message types at the right level.

### Handling URLs

```gleam
// client/src/router.gleam

pub fn on_url_change(uri: Uri) -> Msg {
  OnRouteChanged(route.from_uri(uri))
}

fn page_from_uri(uri: Uri) -> #(Page, Effect(Msg)) {
  let route = route.from_uri(uri)
  let #(page, effect) = page_from_route(route)
  let redirect = case uri.path_segments(uri.path) {
    [] -> modem.replace(route.to_path(route), None, None)
    _ -> effect.none()
  }
  #(page, effect.batch([effect, redirect]))
}

fn page_from_route(route: route.Route) -> #(Page, Effect(Msg)) {
  case route {
    route.Tasks -> {
      let #(page_model, effect) = tasks.init()
      #(TasksPage(page_model), effect.map(effect, TasksPageSentMsg))
    }
  }
}
```

`on_url_change` is passed to `modem.init` (seen in the next section) as the callback to invoke whenever the URL changes. It parses the new URI into a `Route` and wraps it in `OnRouteChanged`.

`page_from_uri` handles the initial load. If the path is empty (the user navigated to `/`), it redirects to the resolved route's canonical path using `modem.replace` — so visiting `/` lands you at `/tasks` without adding an extra entry to the browser history. `effect.batch` runs both the page's own init effect and the redirect in one go.

`page_from_route` initialises the page for a given route and wraps its effect, ready to be returned from `update` or `init`.

## Updating client.gleam

With the router in place, `client.gleam` becomes pleasantly minimal:

```gleam
// client/src/client.gleam

import lustre
import lustre/effect.{type Effect}
import lustre/element.{type Element}
import modem
import router

pub fn main() {
  let app = lustre.application(init, update, view)
  let assert Ok(_) = lustre.start(app, "#app", Nil)
}

type Model {
  Model(page: router.Page)
}

fn init(_) -> #(Model, Effect(router.Msg)) {
  let #(page, router_effect) = router.init(modem.initial_uri())
  #(
    Model(page:),
    effect.batch([modem.init(router.on_url_change), router_effect]),
  )
}

fn update(model: Model, msg: router.Msg) -> #(Model, Effect(router.Msg)) {
  let #(page, effect) = router.update(model.page, msg)
  #(Model(page:), effect)
}

fn view(model: Model) -> Element(router.Msg) {
  router.view(model.page)
}
```

`client.gleam` now does three things:

- Starts modem with `modem.init(router.on_url_change)` so URL changes flow into the loop as messages.
- Delegates `init` and `update` entirely to the `router`.
- Passes the current page straight to `router.view`.

`modem.initial_uri()` reads the browser's current URL at startup and passes it to `router.init`, so the app always opens on the right page — even if you land directly on `/tasks` from a bookmark or a shared link.

## What's Next

The client has a proper shape — routes, pages, and a service layer — but only one screen actually exists. Next, we'll put the structure to work by adding a New Task page, wiring up `POST /api/tasks`, and navigating back to the list on success.

[^1]: See commit [e35bb9f](https://github.com/lukwol/doable/commit/e35bb9f) on GitHub
