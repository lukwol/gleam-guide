# Create Tasks

The tasks list shows data but offers no way to add anything. In this chapter we'll add the first interactive page — a form for creating new tasks — along with the routing and API call it needs.

Eight files change, one is new[^1]:

```sh
doable/
└── client/
    └── src/
        ├── api.gleam              # post added              [!code highlight]
        ├── browser.gleam          # history_back added      [!code highlight]
        ├── browser_ffi.js         # history_back added      [!code highlight]
        ├── route.gleam            # NewTask route           [!code highlight]
        ├── router.gleam           # NewTaskPage wired in    [!code highlight]
        ├── service/
        │   └── task_service.gleam # post_task added         [!code highlight]
        └── page/
            ├── tasks.gleam        # New Task link added     [!code highlight]
            └── new_task.gleam     # new task form page      [!code ++]
```

## Extending the Routes

`route.gleam` gains one new variant:

```gleam
// client/src/route.gleam

pub type Route {
  Tasks
  NewTask  // [!code ++]
}

pub fn to_path(route: Route) -> String {
  case route {
    Tasks -> "/tasks"
    NewTask -> "/tasks/new"  // [!code ++]
  }
}

pub fn from_uri(uri: Uri) -> Route {
  case uri.path_segments(uri.path) {
    ["tasks"] -> Tasks
    ["tasks", "new"] -> NewTask  // [!code ++]
    _ -> home_route
  }
}
```

## The Post Method

`api.gleam` gets a `post` function following the same shape as `get`:

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
  |> execute(expect: 201, decoder:)
}
```

The `json:` label on `body` makes call sites read like `api.post(path, decoder, json: body)` — intent is clear without any extra ceremony.

## Extending the Task Service

`task_service.gleam` gains `post_task`, which encapsulates the serialization and API call so pages never have to touch JSON directly:

```gleam
// client/src/service/task_service.gleam

pub fn post_task(input: TaskInput) -> Promise(Result(Task, ApiError)) {   // [!code ++]
  let body =                                                              // [!code ++]
    input                                                                 // [!code ++]
    |> task.task_input_to_json                                            // [!code ++]
    |> json.to_string                                                     // [!code ++]
                                                                          // [!code ++]
  "/api/tasks"                                                            // [!code ++]
  |> api.post(task.task_decoder(), json: body)                            // [!code ++]
}                                                                         // [!code ++]
```

`post_task` takes a `TaskInput`, serializes it to JSON internally, and delegates to `api.post`. The encoding lives here, so `new_task.gleam` can pass a `TaskInput` value without knowing anything about JSON serialization.

## Browser FFI

After creating a task, the page navigates away. Going back requires calling `window.history.back()` — something the Gleam standard library doesn't expose. The existing `browser` module gets one more FFI pair:

```gleam
// client/src/browser.gleam

@external(javascript, "./browser_ffi.js", "window_location_origin")
pub fn window_location_origin() -> String

@external(javascript, "./browser_ffi.js", "history_back")    // [!code ++]
pub fn history_back() -> Nil                                 // [!code ++]
```

```js
// client/src/browser_ffi.js

export function window_location_origin() {
  return window.location.origin;
}

export function history_back() {    // [!code ++]
  window.history.back();            // [!code ++]
}                                   // [!code ++]
```

`history_back` returns `Nil` — Gleam's equivalent of a void function — since `window.history.back()` is called for its side effect, not a value.

## The New Task Page

`page/new_task.gleam` is a self-contained Lustre page. The model is a flat record — there is nothing to fetch before the form can be shown:

```gleam
// client/src/page/new_task.gleam

pub type Model {
  Model(name: String, description: String, submitting: Bool, error: Option(String))
}

pub type Msg {
  UserUpdatedName(String)
  UserUpdatedDescription(String)
  UserClickedBack
  UserSubmittedForm
  ApiCreatedTask(Result(Task, ApiError))
}

pub fn init() -> #(Model, Effect(Msg)) {
  #(Model(name: "", description: "", submitting: False, error: None), effect.none())
}
```

Five messages cover everything the page needs to handle:

- `UserUpdatedName` / `UserUpdatedDescription` — field changes as the user types
- `UserClickedBack` — back button clicked
- `UserSubmittedForm` — save button clicked
- `ApiCreatedTask` — result of the POST request

`update` applies field changes and handles the two user actions — back and submit:

```gleam
// client/src/page/new_task.gleam

pub fn update(model: Model, msg: Msg) -> #(Model, Effect(Msg)) {
  case msg {
    UserUpdatedName(name) -> #(Model(..model, name:), effect.none())
    UserUpdatedDescription(description) -> #(
      Model(..model, description:),
      effect.none(),
    )
    UserClickedBack -> #(model, effect.from(fn(_) { browser.history_back() }))
    UserSubmittedForm ->
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

`UserSubmittedForm` validates that the name isn't empty before setting `submitting: True` and firing the request. On success, `modem.push` navigates to `/tasks` and adds an entry to the browser history so the back button works. `UserClickedBack` wraps `browser.history_back()` in `effect.from` — Lustre requires all side effects to go through the effect system, even synchronous ones.

`view` renders the form inline:

```gleam
// client/src/page/new_task.gleam

pub fn view(model: Model) -> Element(Msg) {
  html.div([], [
    html.h1([], [element.text("New Task")]),
    case model.error {
      None -> element.none()
      Some(err) -> html.p([], [element.text(err)])
    },
    html.div([], [
      html.label([], [element.text("Name")]),
      html.input([
        attribute.type_("text"),
        attribute.placeholder("Task name"),
        attribute.value(model.name),
        event.on_input(UserUpdatedName),
      ]),
    ]),
    html.div([], [
      html.label([], [element.text("Description")]),
      html.textarea(
        [
          attribute.placeholder("Optional description"),
          event.on_input(UserUpdatedDescription),
        ],
        model.description,
      ),
    ]),
    html.div([], [
      html.button(
        [attribute.disabled(model.submitting), event.on_click(UserSubmittedForm)],
        [
          element.text(case model.submitting {
            True -> "Saving..."
            False -> "Save"
          }),
        ],
      ),
      html.button([event.on_click(UserClickedBack)], [element.text("Back")]),
    ]),
  ])
}
```

The submit button is disabled while `submitting` is `True` and its label switches to `"Saving..."` for immediate feedback. The form lives directly in this module for now — the next chapter extracts it into a shared component when the edit page needs the same fields.

<figure>
  <img src="/screenshots/new-task-unstyled.png">
  <figcaption>New task form before styling</figcaption>
</figure>

The private `post_task` function builds the API call as an effect:

```gleam
// client/src/page/new_task.gleam

fn post_task(name: String, description: String) -> Effect(Msg) {
  use dispatch <- effect.from
  TaskInput(name:, description:, completed: False)
  |> task_service.post_task
  |> promise.map(ApiCreatedTask)
  |> promise.tap(dispatch)
  Nil
}
```

`use dispatch <- effect.from` is the standard Lustre pattern for bridging async work into the message system: `effect.from` provides `dispatch`, `promise.tap` calls it with the result, and the trailing `Nil` satisfies the `fn() -> Nil` return type.

## Wiring the Router

`router.gleam` gains a new page variant and message type:

```gleam
// client/src/router.gleam

pub type Page {
  TasksPage(tasks.Model)
  NewTaskPage(new_task.Model)  // [!code ++]
}

pub type Msg {
  OnRouteChanged(route.Route)
  TasksPageSentMsg(tasks.Msg)
  NewTaskPageSentMsg(new_task.Msg)  // [!code ++]
}
```

`update` and `view` each gain a branch following the same pattern as `TasksPage`. A catch-all is also added:

```gleam
// client/src/router.gleam

pub fn update(page: Page, msg: Msg) -> #(Page, Effect(Msg)) {
  case msg, page {
    OnRouteChanged(route), _ -> page_from_route(route)
    TasksPageSentMsg(page_msg), TasksPage(page_model) -> {
      let #(new_page_model, effect) = tasks.update(page_model, page_msg)
      #(TasksPage(new_page_model), effect.map(effect, TasksPageSentMsg))
    }
    NewTaskPageSentMsg(page_msg), NewTaskPage(page_model) -> {  // [!code ++]
      let #(new_page_model, effect) = new_task.update(page_model, page_msg)  // [!code ++]
      #(NewTaskPage(new_page_model), effect.map(effect, NewTaskPageSentMsg))  // [!code ++]
    }  // [!code ++]
    _, _ -> panic as "mismatched msg and page"  // [!code ++]
  }
}
```

The `_, _ -> panic` catch-all makes routing bugs immediately visible. A message arriving for the wrong page is a programming error — panicking during development is preferable to silently swallowing it.

`page_from_route` maps the new route to its page:

```gleam
// client/src/router.gleam

fn page_from_route(route: route.Route) -> #(Page, Effect(Msg)) {
  case route {
    route.Tasks -> {
      let #(page_model, effect) = tasks.init()
      #(TasksPage(page_model), effect.map(effect, TasksPageSentMsg))
    }
    route.NewTask -> {                                                    // [!code ++]
      let #(page_model, effect) = new_task.init()                         // [!code ++]
      #(NewTaskPage(page_model), effect.map(effect, NewTaskPageSentMsg))  // [!code ++]
    }                                                                     // [!code ++]
  }
}
```

## New Task Link

`tasks.gleam` adds a link above the task list:

```gleam
// client/src/page/tasks.gleam

pub fn view(model: Model) -> Element(Msg) {
  html.div([], [
    html.h1([], [element.text("Tasks")]),
    html.a([attribute.href(route.to_path(route.NewTask))], [  // [!code ++]
      element.text("New Task"),                               // [!code ++]
    ]),                                                       // [!code ++]
    case model.tasks {
      Error(err) -> html.p([], [element.text(error.message(err))])
      Ok([]) if model.loading -> html.p([], [element.text("Loading...")])
      Ok([]) -> html.p([], [element.text("No tasks yet")])
      Ok(tasks) -> html.ul([], list.map(tasks, view_task))
    },
  ])
}
```

The link uses `route.to_path` rather than a hardcoded string, so if the route's path ever changes the update happens in one place.

## What's Next

Users can create tasks, but not edit or delete them yet — and the form fields would have to be duplicated if we added an edit page naïvely. Next, we'll extract them into a shared component, then build editing and deletion on top.

[^1]: See commit [d41f914](https://github.com/lukwol/doable/commit/d41f914) on GitHub
