# Edit and Delete Tasks

The new task page renders its form fields directly. As soon as the edit page is needed, those fields would have to be duplicated. In this chapter we'll extract them into a shared component, refactor the new task page to use it, and then build the edit page on top.

Eight files change, two are new[^1]:

```sh
doable/
└── client/
    └── src/
        ├── api.gleam                    # patch, delete added              [!code highlight]
        ├── route.gleam                  # EditTask route                   [!code highlight]
        ├── router.gleam                 # EditTaskPage wired in            [!code highlight]
        ├── service/
        │   └── task_service.gleam       # fetch_task, patch, delete added  [!code highlight]
        ├── component/
        │   └── task_form.gleam          # shared form fields               [!code ++]
        └── page/
            ├── tasks.gleam              # toggle added, edit links         [!code highlight]
            ├── new_task.gleam           # refactored to use task_form      [!code highlight]
            └── edit_task.gleam          # edit task page                   [!code ++]
```

## Shared Form Component

`component/task_form.gleam` defines the form fields that both pages share. Crucially, it only handles field input — no submit button, no error display, no title. Those belong to the pages themselves, because each page has different buttons and different context:

```gleam
// client/src/component/task_form.gleam

pub type Msg {
  UserUpdatedName(String)
  UserUpdatedDescription(String)
  UserUpdatedCompleted(Bool)
}

pub fn view(
  name: String,
  description: String,
  completed: Option(Bool),
) -> Element(Msg) {
  html.div([], [
    html.div([], [
      html.label([], [element.text("Name")]),
      html.input([
        attribute.type_("text"),
        attribute.placeholder("Task name"),
        attribute.value(name),
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
        description,
      ),
    ]),
    case completed {
      None -> element.none()
      Some(value) ->
        html.label([], [
          html.input([
            attribute.type_("checkbox"),
            attribute.checked(value),
            event.on_check(UserUpdatedCompleted),
          ]),
          element.text("Completed"),
        ])
    },
  ])
}
```

The `completed` parameter being `Option(Bool)` is the key design decision. The completed checkbox is only meaningful when editing an existing task — a new task is always incomplete. Passing `None` hides the checkbox entirely; `Some(value)` shows it with the current state.

## Refactoring New Task

Now that the form component exists, `new_task.gleam` removes its inline fields and delegates to it. The `Msg` type changes to wrap form messages:

```gleam
// client/src/page/new_task.gleam

pub type Msg {
  FormMsg(task_form.Msg)  // [!code highlight]
  UserSubmittedForm
  UserClickedBack
  ApiCreatedTask(Result(Task, ApiError))
}
```

`update` handles each form message through the `FormMsg` wrapper. `UserUpdatedCompleted` is explicitly handled and ignored — the checkbox never appears on this page, but exhaustive matching still requires covering it:

```gleam
// client/src/page/new_task.gleam

pub fn update(model: Model, msg: Msg) -> #(Model, Effect(Msg)) {
  case msg {
    FormMsg(UserUpdatedName(name)) -> #(Model(..model, name:), effect.none())
    FormMsg(UserUpdatedDescription(description)) -> #(
      Model(..model, description:),
      effect.none(),
    )
    FormMsg(UserUpdatedCompleted(_)) -> #(model, effect.none())
    ...
  }
}
```

`view` replaces the inline fields with a single `task_form.view` call. `element.map(FormMsg)` wraps every message the component emits so it fits into the page's `Msg` type:

```gleam
// client/src/page/new_task.gleam

pub fn view(model: Model) -> Element(Msg) {
  html.div([], [
    html.h1([], [element.text("New Task")]),
    case model.error {
      None -> element.none()
      Some(err) -> html.p([], [element.text(err)])
    },
    task_form.view(model.name, model.description, None)  // [!code highlight]
      |> element.map(FormMsg),                           // [!code highlight]
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

The submit and back buttons stay in the page rather than moving into the form — the edit page will have a delete button too, and the form component shouldn't need to know about that.

## Patch and Delete Methods

`api.gleam` gains two new functions. `patch` mirrors `post` but expects a `200` response:

```gleam
// client/src/api.gleam

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
  |> execute(expect: 200, decoder:)
}
```

`delete` is different — it expects no response body, so there is nothing to decode:

```gleam
// client/src/api.gleam

pub fn delete(path: String) -> Promise(Result(Nil, ApiError)) {
  use request <- with_json_request(path)
  request
  |> request.set_method(Delete)
  |> fetch.send
  |> promise.map(result.map_error(_, FetchError))
  |> promise.map_try(fn(response) {
    use <- bool.guard(
      response.status != 204,
      Error(UnexpectedStatus(response.status)),
    )
    Ok(Nil)
  })
}
```

`bool.guard` provides an early-return pattern: if the condition is true it returns the first argument; otherwise it evaluates the second. Here it returns an error if the status isn't `204 No Content`, and `Ok(Nil)` otherwise.

## Extending the Task Service

With `api.patch` and `api.delete` in place, `task_service.gleam` gains the three operations the edit page needs. The full module now covers every task API call in one place:

```gleam
// client/src/service/task_service.gleam

pub fn fetch_tasks() -> Promise(Result(List(Task), ApiError)) {
  "/api/tasks"
  |> api.get(decode.list(task.task_decoder()))
}

pub fn fetch_task(task_id: Int) -> Promise(Result(Task, ApiError)) {    // [!code ++]
  let path = "/api/tasks/" <> int.to_string(task_id)                    // [!code ++]
    path                                                                // [!code ++]
    |> api.get(task.task_decoder())                                     // [!code ++]
}                                                                       // [!code ++]

pub fn post_task(input: TaskInput) -> Promise(Result(Task, ApiError)) {
  let body =
    input
    |> task.task_input_to_json
    |> json.to_string

  "/api/tasks"
  |> api.post(task.task_decoder(), json: body)
}

pub fn patch_task(task: Task) -> Promise(Result(Task, ApiError)) {     // [!code ++]
  let body =                                                           // [!code ++]
    task                                                               // [!code ++]
    |> task.to_task_input                                              // [!code ++]
    |> task.task_input_to_json                                         // [!code ++]
    |> json.to_string                                                  // [!code ++]
                                                                       // [!code ++]
  let path = "/api/tasks/" <> int.to_string(task.id)                   // [!code ++]
  path                                                                 // [!code ++]
  |> api.patch(task.task_decoder(), json: body)                        // [!code ++]
}                                                                      // [!code ++]

pub fn delete_task(task_id: Int) -> Promise(Result(Nil, ApiError)) {   // [!code ++]
  let path = "/api/tasks/" <> int.to_string(task_id)                   // [!code ++]
  path                                                                 // [!code ++]
  |> api.delete                                                        // [!code ++]
}                                                                      // [!code ++]
```

`fetch_task` mirrors `fetch_tasks` but targets a single task by ID. `patch_task` accepts the full `Task` record, converts it to `TaskInput` for serialization, then delegates to `api.patch`. `delete_task` only needs the ID — no body to build.

## Extending the Routes

`route.gleam` adds the edit route. `EditTask` carries the task ID directly in the route type, so the page gets everything it needs from the URL:

```gleam
// client/src/route.gleam

pub type Route {
  Tasks
  NewTask
  EditTask(Int)  // [!code ++]
}

pub fn to_path(route: Route) -> String {
  case route {
    Tasks -> "/tasks"
    NewTask -> "/tasks/new"
    EditTask(id) -> "/tasks/" <> int.to_string(id) <> "/edit"  // [!code ++]
  }
}

pub fn from_uri(uri: Uri) -> Route {
  case uri.path_segments(uri.path) {
    ["tasks"] -> Tasks
    ["tasks", "new"] -> NewTask
    ["tasks", id, "edit"] ->                  // [!code ++]
      int.parse(id)                           // [!code ++]
      |> result.map(EditTask)                 // [!code ++]
      |> result.unwrap(home_route)            // [!code ++]
    _ -> home_route
  }
}
```

`from_uri` parses the URL segment with `int.parse` and falls back to `home_route` if it isn't a valid integer. The compiler now requires every `case route` expression to handle `EditTask`, so nothing can be left unwired.

## The Edit Task Page

`page/edit_task.gleam` needs to fetch the task before the form can be shown. Rather than using a union type for loading state, the model uses a flat record with a `loading` flag — the task fields are always accessible, and the view switches on `loading` to decide what to render:

```gleam
// client/src/page/edit_task.gleam

pub type Model {
  Model(task: Task, loading: Bool, submitting: Bool, error: Option(String))
}

pub type Msg {
  FormMsg(task_form.Msg)
  UserSubmittedForm
  UserClickedDelete
  UserClickedBack
  ApiReturnedTask(Result(Task, ApiError))
  ApiUpdatedTask(Result(Task, ApiError))
  ApiDeletedTask(Result(Nil, ApiError))
}
```

Seven messages cover the full lifecycle of the page:

- `FormMsg` — wraps field changes emitted by the form component
- `UserSubmittedForm` — save button clicked
- `UserClickedDelete` — delete button clicked
- `UserClickedBack` — back navigation
- `ApiReturnedTask` — result of the initial fetch
- `ApiUpdatedTask` — result of the PATCH request
- `ApiDeletedTask` — result of the DELETE request

`init` starts with a placeholder task and immediately fires the fetch:

```gleam
// client/src/page/edit_task.gleam

pub fn init(task_id: Int) -> #(Model, Effect(Msg)) {
  #(
    Model(
      task: Task(id: task_id, name: "", description: "", completed: False),
      loading: True,
      submitting: False,
      error: None,
    ),
    fetch_task(task_id),
  )
}
```

Storing the task ID in the placeholder task avoids threading it separately through the model — `fetch_task` reads it, and the path construction functions can use `model.task.id` without special-casing the loading state.

`update` handles all messages and uses the `task.Task(..task, field:)` spread syntax to update individual fields on the nested task record:

```gleam
// client/src/page/edit_task.gleam

pub fn update(model: Model, msg: Msg) -> #(Model, Effect(Msg)) {
  case msg {
    FormMsg(UserUpdatedName(name)) -> #(
      Model(..model, task: Task(..model.task, name:)),
      effect.none(),
    )
    FormMsg(UserUpdatedDescription(description)) -> #(
      Model(..model, task: Task(..model.task, description:)),
      effect.none(),
    )
    FormMsg(UserUpdatedCompleted(completed)) -> #(
      Model(..model, task: Task(..model.task, completed:)),
      effect.none(),
    )
    UserSubmittedForm ->
      case model.task.name {
        "" -> #(Model(..model, error: Some("Name is required")), effect.none())
        _ -> #(
          Model(..model, submitting: True, error: None),
          patch_task(model.task),
        )
      }
    UserClickedDelete -> #(
      Model(..model, submitting: True),
      delete_task(model.task.id),
    )
    UserClickedBack -> #(model, effect.from(fn(_) { browser.history_back() }))
    ApiReturnedTask(Ok(task)) -> #(
      Model(..model, task:, loading: False),
      effect.none(),
    )
    ApiReturnedTask(Error(err)) -> #(
      Model(..model, loading: False, error: Some(error.message(err))),
      effect.none(),
    )
    ApiUpdatedTask(Ok(_)) -> #(
      model,
      modem.push(route.to_path(route.Tasks), None, None),
    )
    ApiUpdatedTask(Error(err)) -> #(
      Model(..model, submitting: False, error: Some(error.message(err))),
      effect.none(),
    )
    ApiDeletedTask(Ok(_)) -> #(
      model,
      modem.push(route.to_path(route.Tasks), None, None),
    )
    ApiDeletedTask(Error(err)) -> #(
      Model(..model, submitting: False, error: Some(error.message(err))),
      effect.none(),
    )
  }
}
```

Both `ApiUpdatedTask(Ok(_))` and `ApiDeletedTask(Ok(_))` navigate back to the tasks list. The delete button sets `submitting: True` before firing the request so both buttons are disabled during the operation — preventing a double-submit or a delete while a save is in flight.

`view` switches on `model.loading`:

```gleam
// client/src/page/edit_task.gleam

pub fn view(model: Model) -> Element(Msg) {
  case model.loading {
    True -> html.p([], [element.text("Loading...")])
    False ->
      html.div([], [
        html.h1([], [element.text("Edit Task")]),
        case model.error {
          None -> element.none()
          Some(err) -> html.p([], [element.text(err)])
        },
        task_form.view(
          model.task.name,
          model.task.description,
          Some(model.task.completed),
        )
          |> element.map(FormMsg),
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
          html.button(
            [attribute.disabled(model.submitting), event.on_click(UserClickedDelete)],
            [element.text("Delete")],
          ),
          html.button([event.on_click(UserClickedBack)], [element.text("Back")]),
        ]),
      ])
  }
}
```

`Some(model.task.completed)` passes the current completion state to the form, so the checkbox appears and reflects the real value. The delete button is disabled alongside the save button — `submitting` guards both.

<figure>
  <img src="/screenshots/edit-task-unstyled.png">
  <figcaption>Edit task form before styling</figcaption>
</figure>

The three private effects delegate to the task service and follow the same `use dispatch <- effect.from` pattern:

```gleam
// client/src/page/edit_task.gleam

fn fetch_task(task_id: Int) -> Effect(Msg) {
  use dispatch <- effect.from
  task_service.fetch_task(task_id)
  |> promise.map(ApiReturnedTask)
  |> promise.tap(dispatch)
  Nil
}

fn patch_task(task: Task) -> Effect(Msg) {
  use dispatch <- effect.from
  task_service.patch_task(task)
  |> promise.map(ApiUpdatedTask)
  |> promise.tap(dispatch)
  Nil
}

fn delete_task(task_id: Int) -> Effect(Msg) {
  use dispatch <- effect.from
  task_service.delete_task(task_id)
  |> promise.map(ApiDeletedTask)
  |> promise.tap(dispatch)
  Nil
}
```

## Wiring the Router

`router.gleam` gains the final page variant and message:

```gleam
// client/src/router.gleam

pub type Page {
  TasksPage(tasks.Model)
  NewTaskPage(new_task.Model)
  EditTaskPage(edit_task.Model)  // [!code ++]
}

pub type Msg {
  OnRouteChanged(route.Route)
  TasksPageSentMsg(tasks.Msg)
  NewTaskPageSentMsg(new_task.Msg)
  EditTaskPageSentMsg(edit_task.Msg)  // [!code ++]
}
```

`update` gains a matching branch, and `view` delegates to the edit page's view function:

```gleam
// client/src/router.gleam

pub fn update(page: Page, msg: Msg) -> #(Page, Effect(Msg)) {
  case msg, page {
    OnRouteChanged(route), _ -> page_from_route(route)
    TasksPageSentMsg(page_msg), TasksPage(page_model) -> {
      let #(new_page_model, effect) = tasks.update(page_model, page_msg)
      #(TasksPage(new_page_model), effect.map(effect, TasksPageSentMsg))
    }
    NewTaskPageSentMsg(page_msg), NewTaskPage(page_model) -> {
      let #(new_page_model, effect) = new_task.update(page_model, page_msg)
      #(NewTaskPage(new_page_model), effect.map(effect, NewTaskPageSentMsg))
    }
    EditTaskPageSentMsg(page_msg), EditTaskPage(page_model) -> {                // [!code ++]
      let #(new_page_model, effect) = edit_task.update(page_model, page_msg)    // [!code ++]
      #(EditTaskPage(new_page_model), effect.map(effect, EditTaskPageSentMsg))  // [!code ++]
    }  // [!code ++]
    _, _ -> panic as "mismatched msg and page"
  }
}

pub fn view(page: Page) -> Element(Msg) {
  case page {
    TasksPage(page_model) ->
      tasks.view(page_model) |> element.map(TasksPageSentMsg)
    NewTaskPage(page_model) ->
      new_task.view(page_model) |> element.map(NewTaskPageSentMsg)
    EditTaskPage(page_model) ->                                                 // [!code ++]
      edit_task.view(page_model) |> element.map(EditTaskPageSentMsg)            // [!code ++]
  }
}
```

`page_from_route` maps the edit route to the page. The task ID flows directly from the URL into `edit_task.init`, which fires the fetch — no global state, no context:

```gleam
// client/src/router.gleam

fn page_from_route(route: route.Route) -> #(Page, Effect(Msg)) {
  case route {
    route.Tasks -> {
      let #(page_model, effect) = tasks.init()
      #(TasksPage(page_model), effect.map(effect, TasksPageSentMsg))
    }
    route.NewTask -> {
      let #(page_model, effect) = new_task.init()
      #(NewTaskPage(page_model), effect.map(effect, NewTaskPageSentMsg))
    }
    route.EditTask(id) -> {                                                    // [!code ++]
      let #(page_model, effect) = edit_task.init(id)                           // [!code ++]
      #(EditTaskPage(page_model), effect.map(effect, EditTaskPageSentMsg))     // [!code ++]
    }                                                                          // [!code ++]
  }
}
```

## Toggling Task Completion

`tasks.gleam` gains two new messages and a new effect so completion can be toggled inline without leaving the list.

Two new `Msg` variants handle the toggle lifecycle. `UserToggledTask` carries the task and the new completion state as a `Bool` — the value comes straight from the checkbox event rather than being derived from the model:

```gleam
// client/src/page/tasks.gleam

pub type Msg {
  ApiReturnedTasks(Result(List(Task), ApiError))
  UserToggledTask(Task, Bool)                     // [!code ++]
  ApiUpdatedTask(Result(Task, ApiError))          // [!code ++]
}
```

`update` handles both, using `result.map` and `list.map` to swap the updated task in place — no full refetch needed:

```gleam
// client/src/page/tasks.gleam

    UserToggledTask(task, completed) -> #(model, toggle_task(task, completed))  // [!code ++]
    ApiUpdatedTask(Ok(updated)) -> #(                                           // [!code ++]
      Model(                                                                    // [!code ++]
        ..model,                                                                // [!code ++]
        tasks: result.map(                                                      // [!code ++]
          model.tasks,                                                          // [!code ++]
          list.map(_, fn(t) {                                                   // [!code ++]
            case t.id == updated.id {                                           // [!code ++]
              True -> updated                                                   // [!code ++]
              False -> t                                                        // [!code ++]
            }                                                                   // [!code ++]
          }),                                                                   // [!code ++]
        ),                                                                      // [!code ++]
      ),                                                                        // [!code ++]
      effect.none(),                                                            // [!code ++]
    )                                                                           // [!code ++]
    ApiUpdatedTask(Error(_)) -> #(model, effect.none())                         // [!code ++]
```

`toggle_task` applies the new completion state and PATCHes it via the service:

```gleam
// client/src/page/tasks.gleam

fn toggle_task(task: Task, completed: Bool) -> Effect(Msg) {                  // [!code ++]
  use dispatch <- effect.from                                                 // [!code ++]
  task_service.patch_task(Task(..task, completed:))                           // [!code ++]
  |> promise.map(ApiUpdatedTask)                                              // [!code ++]
  |> promise.tap(dispatch)                                                    // [!code ++]
  Nil                                                                         // [!code ++]
}                                                                             // [!code ++]
```

`toggle_task` takes the new `Bool` value directly from the checkbox event rather than flipping `!task.completed` from the closure — this avoids stale state if the checkbox is clicked before a previous PATCH response arrives. `Task(..task, completed:)` uses record spread to produce a copy with just the one field updated.

## Edit Links in the Tasks List

Each task item becomes a separate checkbox and link. Keeping them apart means clicking the checkbox toggles completion while clicking the text navigates to the edit page — two independent interactions on the same row:

```gleam
// client/src/page/tasks.gleam

fn view_task(task: Task) -> Element(Msg) {
  html.li([], [
    html.input([                                                         // [!code ++]
      attribute.type_("checkbox"),
      attribute.checked(task.completed),
      event.on_check(fn(checked) { UserToggledTask(task, checked) }),    // [!code ++]
    ]),
    html.a([attribute.href(route.to_path(route.EditTask(task.id)))], [   // [!code ++]
      element.text(task.name <> " — " <> task.description),
    ]),                                                                  // [!code ++]
  ])
}
```

`event.on_check` passes the new boolean directly into `UserToggledTask`. The link delegates URL construction to `route.to_path`, consistent with every other navigation in the app.

<figure>
  <img src="/screenshots/tasks-unstyled.png">
  <figcaption>Tasks list with interactive checkboxes and edit links, before styling</figcaption>
</figure>

## What's Next

The CRUD loop is complete — list, create, edit, delete all work. The UI still needs styling, though, and before we get to Tauri later in the guide we'll want a JS build tool to hook into its ecosystem. Next up: bringing [Vite](https://vite.dev) into the project alongside [vite-gleam](https://github.com/nicktobey/vite-gleam) before fully transitioning to Tauri.

[^1]: See commit [52f31d1](https://github.com/lukwol/doable/commit/52f31d1) on GitHub
