# Implementing the API Routes

With the database layer in place, this chapter replaces the stub handlers in `task/route.gleam` with real implementations[^1]. Before that, `task.gleam` gains JSON encoders and decoders, and `web.gleam` gains shared helpers that keep the handler code flat and free of repetition.

## Install Dependencies

Both packages need `gleam_json` — `shared` for its types, `server` for building responses:

```sh
cd shared
gleam add gleam_json

cd ../server
gleam add gleam_json
```

`gleam.toml` gains one entry in each package:

```toml
# shared/gleam.toml
[dependencies]
gleam_stdlib = ">= 0.44.0 and < 2.0.0"
gleam_json = ">= 3.1.0 and < 4.0.0"   # [!code ++]
```

```toml
# server/gleam.toml
[dependencies]
...
gleam_otp = ">= 1.2.0 and < 2.0.0"
gleam_json = ">= 3.1.0 and < 4.0.0"   # [!code ++]
wisp = ">= 2.2.1 and < 3.0.0"
```

## JSON in `shared/src/task.gleam`

`task.gleam` needs four new functions: a decoder and an encoder for both `Task` and `TaskInput`:

```gleam
import gleam/dynamic/decode.{type Decoder}  // [!code ++]
import gleam/json.{type Json}               // [!code ++]

pub type Task {
  Task(id: Int, name: String, description: String, completed: Bool)
}

pub fn task_from(input: TaskInput, id: Int) -> Task {
  Task(
    id: id,
    name: input.name,
    description: input.description,
    completed: input.completed,
  )
}

pub fn task_decoder() -> Decoder(Task) {                                    // [!code ++]
  use id <- decode.field("id", decode.int)                                  // [!code ++]
  use name <- decode.field("name", decode.string)                           // [!code ++]
  use description <- decode.field("description", decode.string)             // [!code ++]
  use completed <- decode.field("completed", decode.bool)                   // [!code ++]
  decode.success(Task(id:, name:, description:, completed:))                // [!code ++]
}                                                                           // [!code ++]

pub fn task_to_json(task: Task) -> Json {                                   // [!code ++]
  json.object([                                                             // [!code ++]
    #("id", json.int(task.id)),                                             // [!code ++]
    #("name", json.string(task.name)),                                      // [!code ++]
    #("description", json.string(task.description)),                        // [!code ++]
    #("completed", json.bool(task.completed)),                              // [!code ++]
  ])                                                                        // [!code ++]
}                                                                           // [!code ++]

pub type TaskInput {
  TaskInput(name: String, description: String, completed: Bool)
}

pub fn task_input_from(task: Task) -> TaskInput {
  TaskInput(
    name: task.name,
    description: task.description,
    completed: task.completed,
  )
}

pub fn task_input_decoder() -> Decoder(TaskInput) {                         // [!code ++]
  use name <- decode.field("name", decode.string)                           // [!code ++]
  use description <- decode.field("description", decode.string)             // [!code ++]
  use completed <- decode.optional_field("completed", False, decode.bool)   // [!code ++]
  decode.success(TaskInput(name:, description:, completed:))                // [!code ++]
}                                                                           // [!code ++]

pub fn task_input_to_json(input: TaskInput) -> Json {                       // [!code ++]
  json.object([                                                             // [!code ++]
    #("name", json.string(input.name)),                                     // [!code ++]
    #("description", json.string(input.description)),                       // [!code ++]
    #("completed", json.bool(input.completed)),                             // [!code ++]
  ])                                                                        // [!code ++]
}                                                                           // [!code ++]
```

A few things worth noting:

- **Decoders can be generated** — the Gleam LSP offers a code action to generate decoders from type definitions. Place the cursor on the type name and invoke "Generate decoder" to get a starting point, then adjust as needed (e.g. swapping `decode.field` for `decode.optional_field`).
- **`decode.optional_field`** — used for `completed` in `TaskInput`. If the field is absent from the JSON body, the decoder falls back to `False` rather than returning an error. This is useful for create requests where a sensible default exists.
- **`task_decoder` vs `task_input_decoder`** — `task_decoder` expects an `id` field; `task_input_decoder` does not. The separation mirrors the split between `Task` and `TaskInput` in the domain model.

## Handler Helpers in `web.gleam`

The route handlers all share three common operations: parsing an ID from a path segment, decoding a JSON body, and translating a database result into an HTTP response. Rather than repeating this logic in every handler, `web.gleam` provides three helper functions:

```gleam
import error.{type DatabaseError, RecordNotFound}                       // [!code ++]
import gleam/dynamic/decode.{type Decoder}                              // [!code ++]
import gleam/int                                                        // [!code ++]
import wisp.{type Request, type Response}

pub fn middleware(
  req: Request,
  handle_request: fn(Request) -> Response,
) -> Response {
  use <- wisp.log_request(req)
  use <- wisp.rescue_crashes
  use req <- wisp.handle_head(req)
  handle_request(req)
}

pub fn parse_id(id: String, next: fn(Int) -> Response) -> Response {    // [!code ++]
  case int.parse(id) {                                                  // [!code ++]
    Ok(value) -> next(value)                                            // [!code ++]
    Error(_) -> wisp.not_found()                                        // [!code ++]
  }                                                                     // [!code ++]
}                                                                       // [!code ++]

pub fn decode_body(                                                     // [!code ++]
  json: decode.Dynamic,                                                 // [!code ++]
  decoder: Decoder(a),                                                  // [!code ++]
  next: fn(a) -> Response,                                              // [!code ++]
) -> Response {                                                         // [!code ++]
  case decode.run(json, decoder) {                                      // [!code ++]
    Ok(value) -> next(value)                                            // [!code ++]
    Error(_) -> wisp.unprocessable_content()                            // [!code ++]
  }                                                                     // [!code ++]
}                                                                       // [!code ++]

pub fn db_execute(                                                      // [!code ++]
  result: Result(a, DatabaseError),                                     // [!code ++]
  next: fn(a) -> Response,                                              // [!code ++]
) -> Response {                                                         // [!code ++]
  case result {                                                         // [!code ++]
    Ok(value) -> next(value)                                            // [!code ++]
    Error(RecordNotFound) -> wisp.not_found()                           // [!code ++]
    Error(_) -> wisp.internal_server_error()                            // [!code ++]
  }                                                                     // [!code ++]
}                                                                       // [!code ++]
```

Each helper follows the same shape: it takes a `next` continuation as its last argument. On success it calls `next` with the unwrapped value; on failure it returns an error response directly. This lets handlers use Wisp's `use` syntax for a flat, readable pipeline.

- **`parse_id`** — path segment IDs arrive as strings. `int.parse` converts them; a non-integer (or negative) ID returns `404` rather than crashing.
- **`decode_body`** — runs a decoder against the parsed JSON body. An invalid payload returns `422 Unprocessable Content`.
- **`db_execute`** — maps database results to HTTP responses. `RecordNotFound` becomes `404`; any other error becomes `500`.

## Route Handlers in `task/route.gleam`

With the helpers in place, the route handlers become short, readable pipelines:

```gleam
import context.{type Context}
import gleam/json
import task
import task/database
import web
import wisp.{type Request, type Response}

pub fn list_tasks(ctx: Context) -> Response {
  let db = context.db_conn(ctx)
  use tasks <- web.db_execute(database.all_tasks(db))

  tasks
  |> json.array(task.task_to_json)
  |> json.to_string
  |> wisp.json_body(wisp.ok(), _)
}

pub fn create_task(req: Request, ctx: Context) -> Response {
  let db = context.db_conn(ctx)
  use json <- wisp.require_json(req)
  use task_input <- web.decode_body(json, task.task_input_decoder())
  use task <- web.db_execute(database.create_task(db, task_input))

  task
  |> task.task_to_json
  |> json.to_string
  |> wisp.json_body(wisp.created(), _)
}

pub fn show_task(_req: Request, ctx: Context, id: String) -> Response {
  let db = context.db_conn(ctx)
  use id <- web.parse_id(id)
  use task <- web.db_execute(database.get_task(db, id))

  task
  |> task.task_to_json
  |> json.to_string
  |> wisp.json_body(wisp.ok(), _)
}

pub fn update_task(req: Request, ctx: Context, id: String) -> Response {
  let db = context.db_conn(ctx)
  use id <- web.parse_id(id)
  use json <- wisp.require_json(req)
  use task_input <- web.decode_body(json, task.task_input_decoder())
  let task = task.task_from(task_input, id)
  use task <- web.db_execute(database.update_task(db, task))

  task
  |> task.task_to_json
  |> json.to_string
  |> wisp.json_body(wisp.ok(), _)
}

pub fn upsert_task(req: Request, ctx: Context, id: String) -> Response {
  let db = context.db_conn(ctx)
  use id <- web.parse_id(id)
  use json <- wisp.require_json(req)
  use task_input <- web.decode_body(json, task.task_input_decoder())
  let task = task.task_from(task_input, id)
  use #(task, inserted) <- web.db_execute(database.upsert_task(db, task))

  let body =
    task
    |> task.task_to_json
    |> json.to_string
  let status = case inserted {
    True -> wisp.created()
    False -> wisp.ok()
  }
  wisp.json_body(status, body)
}

pub fn delete_task(_req: Request, ctx: Context, id: String) -> Response {
  let db = context.db_conn(ctx)
  use id <- web.parse_id(id)
  use _ <- web.db_execute(database.delete_task(db, id))

  wisp.no_content()
}
```

A few things worth noting:

- **`use` for early returns** — each `use` line is a callback that either calls `next` on success or returns an error response immediately. The result is an imperative-looking pipeline where failures short-circuit without nested `case` expressions.
- **`wisp.require_json`** — provided by Wisp; parses the request body as JSON and returns a `decode.Dynamic` value, or responds with `400 Bad Request` if the body isn't valid JSON.
- **`upsert_task` status** — the `inserted` flag from the database layer determines whether to return `201 Created` (new record) or `200 OK` (updated existing record). This is the correct REST semantics for `PUT`.
- **`delete_task` discards the value** — `use _ <-` ignores the `Ok(Nil)` from `database.delete_task`; only the error branch matters here.

## Verifying the API

Start the server with the database running:

```sh
docker compose up -d
cd server
gleam run
```

Then exercise each endpoint with `curl`:

```sh
# List tasks — empty initially
curl -i http://localhost:8000/api/tasks
# 200 OK, []

# Create a task
curl -i -X POST http://localhost:8000/api/tasks \
  -H "Content-Type: application/json" \
  -d '{"name":"Buy milk","description":"2% fat"}'
# 201 Created, {"id":1,"name":"Buy milk","description":"2% fat","completed":false}

# Create another task
curl -i -X POST http://localhost:8000/api/tasks \
  -H "Content-Type: application/json" \
  -d '{"name":"Read a book","description":"Something good","completed":true}'
# 201 Created, {"id":2,...}

# List tasks — both tasks now returned
curl -i http://localhost:8000/api/tasks
# 200 OK, [{"id":1,...},{"id":2,...}]

# Show a task
curl -i http://localhost:8000/api/tasks/1
# 200 OK, {"id":1,"name":"Buy milk","description":"2% fat","completed":false}

# Update a task (partial fields)
curl -i -X PATCH http://localhost:8000/api/tasks/1 \
  -H "Content-Type: application/json" \
  -d '{"name":"Buy milk","description":"Whole milk","completed":true}'
# 200 OK, {"id":1,"name":"Buy milk","description":"Whole milk","completed":true}

# Upsert — insert a new task with a specific ID
curl -i -X PUT http://localhost:8000/api/tasks/99 \
  -H "Content-Type: application/json" \
  -d '{"name":"Walk the dog","description":"Morning walk","completed":false}'
# 201 Created, {"id":99,...}

# Upsert — update the same task
curl -i -X PUT http://localhost:8000/api/tasks/99 \
  -H "Content-Type: application/json" \
  -d '{"name":"Walk the dog","description":"Evening walk","completed":true}'
# 200 OK, {"id":99,...}

# Delete a task
curl -i -X DELETE http://localhost:8000/api/tasks/1
# 204 No Content

# Show deleted task — 404
curl -i http://localhost:8000/api/tasks/1
# 404 Not Found

# Invalid ID — 404
curl -i http://localhost:8000/api/tasks/abc
# 404 Not Found

# Missing required field — 422
curl -i -X POST http://localhost:8000/api/tasks \
  -H "Content-Type: application/json" \
  -d '{"description":"No name field"}'
# 422 Unprocessable Content
```

The error cases confirm the helpers are working: a non-integer ID returns `404`, a missing required field returns `422`, and a deleted record returns `404` on subsequent lookup.

## What's Next

The REST API is fully implemented and backed by a real database. The next step is adding automated tests for the route handlers.

[^1]: See commit [b0e4e2e](https://github.com/lukwol/doable/commit/b0e4e2e385766953d4895728f2026c03b0522040) on GitHub
