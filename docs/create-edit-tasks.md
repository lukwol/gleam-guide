# Create and Edit Tasks

The routing skeleton is in place. This chapter fills it in — two new pages for creating and editing tasks, a shared component they both render, and a server fix to handle the CORS preflight requests that `POST` and `PATCH` trigger[^1].

Eight files change, three are new:

```sh
doable/
├── client/
│   └── src/
│       ├── api.gleam                  # post and patch added         [!code highlight]
│       ├── route.gleam                # NewTask, EditTask routes     [!code highlight]
│       ├── router.gleam               # two new pages wired in       [!code highlight]
│       ├── components/
│       │   └── task_form.gleam        # shared form component        [!code ++]
│       └── page/
│           ├── tasks.gleam            # links added                  [!code highlight]
│           ├── new_task.gleam         # create task page             [!code ++]
│           └── edit_task.gleam        # edit task page               [!code ++]
└── server/
    └── src/
        └── web.gleam                  # CORS preflight fix           [!code highlight]
```

## Extending the Routes

`route.gleam` gains two new variants:

```gleam
// client/src/route.gleam

pub type Route {
  Tasks
  NewTask        // [!code ++]
  EditTask(Int)  // [!code ++]
}

pub fn to_path(route: Route) -> String {
  case route {
    Tasks -> "/tasks"
    NewTask -> "/tasks/new"                                            // [!code ++]
    EditTask(id) -> "/tasks/" <> int.to_string(id) <> "/edit"          // [!code ++]
  }
}

pub fn from_uri(uri: Uri) -> Route {
  case uri.path_segments(uri.path) {
    ["tasks"] -> Tasks
    ["tasks", "new"] -> NewTask                                        // [!code ++]
    ["tasks", id, "edit"] ->                                           // [!code ++]
      int.parse(id)                                                    // [!code ++]
      |> result.map(EditTask)                                          // [!code ++]
      |> result.unwrap(home_route)                                     // [!code ++]
    _ -> home_route
  }
}
```

`EditTask` carries the task ID directly in the route type. `from_uri` parses the URL segment with `int.parse` and falls back to `home_route` if it isn't a valid number. The compiler now requires every `case route` expression to handle `NewTask` and `EditTask`, so nothing can be left unwired.

## API: POST and PATCH

The API client grows two new public functions — one for creating tasks, one for updating them:

```gleam
// client/src/api.gleam

pub fn post(
  path: String,
  decoder: Decoder(a),
  json body: String,
) -> Promise(Result(a, ApiError)) {
  use req <- with_json_request(path)
  req
  |> request.set_method(Post)
  |> request.set_header("content-type", "application/json")
  |> request.set_body(body)
  |> execute(expect: [201], decoder:)
}

pub fn patch(
  path: String,
  decoder: Decoder(a),
  json body: String,
) -> Promise(Result(a, ApiError)) {
  use req <- with_json_request(path)
  req
  |> request.set_method(Patch)
  |> request.set_header("content-type", "application/json")
  |> request.set_body(body)
  |> execute(expect: [200], decoder:)
}
```

Both follow the same shape as `get`: build a base request via `with_json_request`, set the method and headers, attach the body, then pass to `execute` with the expected status. The `json:` label on `body` makes call sites read like `api.post(path, decoder, json: body)`, which makes the intent clear without extra ceremony.

## The Shared Form Component

Both new pages render the same HTML form. Rather than duplicate it, `task_form.gleam` defines the form once:

```gleam
// client/src/components/task_form.gleam

pub type Msg {
  UserUpdatedName(String)
  UserUpdatedDescription(String)
  UserToggledCompleted(Bool)
  UserSubmittedForm
}

pub fn view(
  title: String,
  name: String,
  description: String,
  completed: Option(Bool),
  submitting: Bool,
  error: Option(String),
) -> Element(Msg) { ... }
```

`completed` being `Option(Bool)` is the key design decision. The "completed" checkbox is only meaningful when editing an existing task — a new task is always incomplete. Passing `None` signals that the checkbox should be hidden entirely; `Some(value)` shows it with the current state.

The submit button is disabled while `submitting` is `True`, and its label switches to `"Saving..."` so the user gets immediate feedback.

## New Task Page

`page/new_task.gleam` is the simpler of the two pages. Its model is a flat record — there is nothing to load, so there is no loading state:

```gleam
// client/src/page/new_task.gleam

pub type Model {
  Model(name: String, description: String, submitting: Bool, error: Option(String))
}

pub type Msg {
  FormSentMsg(task_form.Msg)
  ApiCreatedTask(Result(task.Task, ApiError))
}

pub fn init() -> #(Model, Effect(Msg)) {
  #(Model(name: "", description: "", submitting: False, error: None), effect.none())
}
```

`FormSentMsg` wraps every message that comes from the form component — the same pattern the router uses for page messages. `update` unwraps them and applies changes to the model:

```gleam
// client/src/page/new_task.gleam

pub fn update(model: Model, msg: Msg) -> #(Model, Effect(Msg)) {
  case msg {
    FormSentMsg(task_form.UserUpdatedName(name)) -> #(
      Model(..model, name:),
      effect.none(),
    )
    FormSentMsg(task_form.UserUpdatedDescription(description)) -> #(
      Model(..model, description:),
      effect.none(),
    )
    FormSentMsg(task_form.UserToggledCompleted(_)) -> #(model, effect.none())
    FormSentMsg(task_form.UserSubmittedForm) ->
      case model.name {
        "" -> #(Model(..model, error: Some("Name is required")), effect.none())
        _ -> #(
          Model(..model, submitting: True, error: None),
          post_task(model.name, model.description),
        )
      }
    ApiCreatedTask(Ok(_)) -> #(
      model,
      modem.push(route.to_path(route.Tasks), None, None),
    )
    ApiCreatedTask(Error(err)) -> #(
      Model(..model, submitting: False, error: Some(error.message(err))),
      effect.none(),
    )
  }
}
```

`UserToggledCompleted` is explicitly handled and ignored — the new task page passes `None` to the form so the checkbox never appears, but the `Msg` type must still be exhaustively matched. `UserSubmittedForm` validates that the name isn't empty before setting `submitting: True` and firing the request. On success, `modem.push` navigates to `/tasks` and adds an entry to the browser history so the back button works.

`view` delegates entirely to `task_form.view`:

```gleam
// client/src/page/new_task.gleam

pub fn view(model: Model) -> Element(Msg) {
  task_form.view(
    "New Task",
    model.name,
    model.description,
    None,
    model.submitting,
    model.error,
  )
  |> element.map(FormSentMsg)
}
```

`element.map(FormSentMsg)` wraps every `task_form.Msg` the view might emit — the same technique the router uses for page views.

## Edit Task Page

`page/edit_task.gleam` is more involved because it must fetch the existing task before the form can be shown. The model reflects this with three distinct states:

```gleam
// client/src/page/edit_task.gleam

pub type Model {
  Loading(task_id: Int)
  Loaded(task: task.Task, submitting: Bool, error: Option(String))
  LoadError(String)
}

pub type Msg {
  ApiReturnedTask(Result(task.Task, ApiError))
  FormSentMsg(task_form.Msg)
  ApiUpdatedTask(Result(task.Task, ApiError))
}
```

`init` starts in `Loading` and immediately fires the fetch:

```gleam
// client/src/page/edit_task.gleam

pub fn init(task_id: Int) -> #(Model, Effect(Msg)) {
  #(Loading(task_id:), fetch_task(task_id))
}
```

`update` matches on both the message and the current model state together. Most form messages only make sense when the model is `Loaded`:

```gleam
// client/src/page/edit_task.gleam

pub fn update(model: Model, msg: Msg) -> #(Model, Effect(Msg)) {
  case msg, model {
    ApiReturnedTask(Ok(t)), _ -> #(
      Loaded(task: t, submitting: False, error: None),
      effect.none(),
    )
    ApiReturnedTask(Error(err)), _ -> #(
      LoadError(error.message(err)),
      effect.none(),
    )
    FormSentMsg(task_form.UserUpdatedName(name)), Loaded(task:, ..) -> #(
      Loaded(..model, task: task.Task(..task, name:)),
      effect.none(),
    )
    FormSentMsg(task_form.UserUpdatedDescription(description)), Loaded(task:, ..) -> #(
      Loaded(..model, task: task.Task(..task, description:)),
      effect.none(),
    )
    FormSentMsg(task_form.UserToggledCompleted(completed)), Loaded(task:, ..) -> #(
      Loaded(..model, task: task.Task(..task, completed:)),
      effect.none(),
    )
    FormSentMsg(task_form.UserSubmittedForm), Loaded(task:, ..) ->
      case task.name {
        "" -> #(Loaded(..model, error: Some("Name is required")), effect.none())
        _ -> #(
          Loaded(..model, submitting: True, error: None),
          patch_task(task),
        )
      }
    ApiUpdatedTask(Ok(_)), _ -> #(
      model,
      modem.push(route.to_path(route.Tasks), None, None),
    )
    ApiUpdatedTask(Error(err)), Loaded(..) -> #(
      Loaded(..model, submitting: False, error: Some(error.message(err))),
      effect.none(),
    )
    _, _ -> #(model, effect.none())
  }
}
```

The `task.Task(..task, name:)` spread syntax updates a single field without repeating all the others — the same shorthand as `Model(..model, ...)` used throughout the codebase. The catch-all `_, _ -> #(model, effect.none())` silently ignores any message that arrives while the model is in the wrong state, such as a form message arriving before the task has loaded.

`view` switches on the model state:

```gleam
// client/src/page/edit_task.gleam

pub fn view(model: Model) -> Element(Msg) {
  case model {
    Loading(_) -> html.p([], [element.text("Loading...")])
    LoadError(err) ->
      html.div([], [
        html.p([], [element.text(err)]),
        html.a([attribute.href(route.to_path(route.Tasks))], [
          element.text("Back"),
        ]),
      ])
    Loaded(task:, submitting:, error:) ->
      task_form.view(
        "Edit Task",
        task.name,
        task.description,
        Some(task.completed),
        submitting,
        error,
      )
      |> element.map(FormSentMsg)
  }
}
```

`Loading` shows a placeholder while the fetch is in flight. `LoadError` shows the error with a link back to the task list — there is nothing useful to do on this page if the task cannot be loaded. `Loaded` renders the form with `Some(task.completed)` so the completed checkbox appears and reflects the task's current state.

## Wiring the Router

The router gains two new page variants and matching messages:

```gleam
// client/src/router.gleam

pub type Page {
  TasksPage(tasks.Model)
  NewTaskPage(new_task.Model)    // [!code ++]
  EditTaskPage(edit_task.Model)  // [!code ++]
}

pub type Msg {
  OnRouteChanged(route.Route)
  TasksPageSentMsg(tasks.Msg)
  NewTaskPageSentMsg(new_task.Msg)   // [!code ++]
  EditTaskPageSentMsg(edit_task.Msg) // [!code ++]
}
```

`update` and `view` each gain two new branches following the same pattern as `TasksPage`. The router's `update` also gains a catch-all that is different from the one in the edit task page:

```gleam
// client/src/router.gleam

pub fn update(page: Page, msg: Msg) -> #(Page, Effect(Msg)) {
  case msg, page {
    OnRouteChanged(route), _ -> page_from_route(route)
    TasksPageSentMsg(page_msg), TasksPage(page_model) -> {
      let #(new_page_model, effect) = tasks.update(page_model, page_msg)
      #(TasksPage(new_page_model), effect.map(effect, TasksPageSentMsg))
    }
    NewTaskPageSentMsg(page_msg), NewTaskPage(page_model) -> {                          // [!code ++]
      let #(new_page_model, effect) = new_task.update(page_model, page_msg)             // [!code ++]
      #(NewTaskPage(new_page_model), effect.map(effect, NewTaskPageSentMsg))            // [!code ++]
    }                                                                                   // [!code ++]
    EditTaskPageSentMsg(page_msg), EditTaskPage(page_model) -> {                        // [!code ++]
      let #(new_page_model, effect) = edit_task.update(page_model, page_msg)            // [!code ++]
      #(EditTaskPage(new_page_model), effect.map(effect, EditTaskPageSentMsg))          // [!code ++]
    }                                                                                   // [!code ++]
    _, _ -> panic as "mismatched msg and page"                                          // [!code ++]
  }
}

pub fn view(page: Page) -> Element(Msg) {
  case page {
    TasksPage(page_model) ->
      tasks.view(page_model) |> element.map(TasksPageSentMsg)
    NewTaskPage(page_model) ->                                                          // [!code ++]
      new_task.view(page_model) |> element.map(NewTaskPageSentMsg)                      // [!code ++]
    EditTaskPage(page_model) ->                                                         // [!code ++]
      edit_task.view(page_model) |> element.map(EditTaskPageSentMsg)                    // [!code ++]
  }
}
```

The edit task page silently ignores mismatched messages because some can legitimately arrive out of order. The router panics instead — a message arriving for the wrong page is a programming error that should never happen if the router is correct. Panicking makes it visible immediately during development rather than silently swallowing it.

`page_from_route` maps the two new routes to their pages:

```gleam
// client/src/router.gleam

fn page_from_route(route: route.Route) -> #(Page, Effect(Msg)) {
  case route {
    route.Tasks -> {
      let #(page_model, effect) = tasks.init()
      #(TasksPage(page_model), effect.map(effect, TasksPageSentMsg))
    }
    route.NewTask -> {                                                           // [!code ++]
      let #(page_model, effect) = new_task.init()                                // [!code ++]
      #(NewTaskPage(page_model), effect.map(effect, NewTaskPageSentMsg))         // [!code ++]
    }                                                                            // [!code ++]
    route.EditTask(id) -> {                                                      // [!code ++]
      let #(page_model, effect) = edit_task.init(id)                             // [!code ++]
      #(EditTaskPage(page_model), effect.map(effect, EditTaskPageSentMsg))       // [!code ++]
    }                                                                            // [!code ++]
  }
}
```

The task ID flows from the URL (`EditTask(id)` in the route) directly into `edit_task.init(id)`, which fires the fetch. No global state, no context — the page gets everything it needs from the route.

## Updating the Tasks List

`tasks.gleam` gets two small additions. A "New Task" link appears at the top of the page:

```gleam
// client/src/page/tasks.gleam

pub fn view(model: Model) -> Element(Msg) {
  html.div([], [
    html.h1([], [element.text("Tasks")]),
    html.a([attribute.href(route.to_path(route.NewTask))], [                      // [!code ++]
      element.text("New Task"),                                                   // [!code ++]
    ]),                                                                           // [!code ++]
    case model.tasks {
      Error(err) -> html.p([], [element.text(error.message(err))])
      Ok([]) if model.loading -> html.p([], [element.text("Loading...")])
      Ok([]) -> html.p([], [element.text("No tasks yet")])
      Ok(tasks) -> html.ul([], list.map(tasks, view_task))
    },
  ])
}
```

And each task item becomes a link to its edit page:

```gleam
// client/src/page/tasks.gleam

fn view_task(t: task.Task) -> Element(Msg) {
  html.li([], [
    html.a([attribute.href(route.to_path(route.EditTask(t.id)))], [  // [!code ++]
      html.input([                                                   // [!code highlight]
        attribute.type_("checkbox"),                                 // [!code highlight]
        attribute.checked(t.completed),                              // [!code highlight]
        attribute.disabled(True),                                    // [!code highlight]
      ]),                                                            // [!code highlight]
      element.text(t.name <> " — " <> t.description),                // [!code highlight]
    ]),                                                              // [!code ++]
  ])
}
```

Both links use `route.to_path`, so the URLs stay in sync with `route.gleam`. If a route's path ever changes, the update happens in one place.

## Server: Preflight Requests

The previous `cors` middleware was a zero-argument function that appended CORS headers to every response. `POST` and `PATCH` requests trigger a CORS preflight — the browser first sends an `OPTIONS` request to check whether the cross-origin call is allowed. The old middleware forwarded `OPTIONS` to the router, which has no handler for it, resulting in a 404 and a blocked request.

The fix is to intercept `OPTIONS` before it reaches the router:

```gleam
// server/src/web.gleam

fn cors(req: Request, next: fn() -> Response) -> Response {  // [!code highlight]
  let resp = case req.method {                               // [!code ++]
    http.Options -> wisp.ok()                                // [!code ++]
    _ -> next()                                              // [!code ++]
  }                                                          // [!code ++]
  resp                                                       // [!code highlight]
  |> response.set_header("access-control-allow-origin", "*")
  |> response.set_header(
    "access-control-allow-methods",
    "GET, POST, PATCH, PUT, DELETE, OPTIONS",
  )
  |> response.set_header("access-control-allow-headers", "content-type, accept")
}
```

`cors` now receives the request so it can inspect the method. An `OPTIONS` request returns an empty `200 OK` immediately via `wisp.ok()`, with the CORS headers attached. Any other method passes through to the router as before. The call site in `middleware` updates accordingly:

```gleam
// server/src/web.gleam

pub fn middleware(
  req: Request,
  handle_request: fn(Request) -> Response,
) -> Response {
  use <- wisp.log_request(req)
  use <- wisp.rescue_crashes
  use req <- wisp.handle_head(req)
  use <- cors(req)                            // [!code highlight]
  handle_request(req)
}
```

## What's Next

The app now supports task listing, creation, and editing; however, the UI is still a bit raw. Additionally, our CORS middleware is becoming messier and redundant. To make our lives easier, we will migrate to the [Vite build tool](https://vite.dev) next.

[^1]: See commit [b189ff5](https://github.com/lukwol/doable/commit/b189ff5f0555b18395eb3b323f082da0929722df) on GitHub
