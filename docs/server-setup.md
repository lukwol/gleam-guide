# Setting Up the Server

Before we can store or retrieve tasks, we need an HTTP server that listens for requests and routes them to the right place. By the end of this chapter you'll have a working API with all task endpoints responding — no database yet, but enough to verify the routing is correct.

This chapter touches four files:

- `server.gleam` — entry point that starts the HTTP server
- `web.gleam` — shared middleware stack applied to every request
- `router.gleam` — router that dispatches by path and method
- `task/route.gleam` — route handlers for the task API

## Install Dependencies

Gleam's HTTP ecosystem is composed of a few small, dedicated packages rather than one monolithic framework. Install them all at once:

```sh
cd server
gleam add gleam_http gleam_erlang wisp mist
```

Here's what each one brings:

- **wisp** — a lightweight web framework that handles routing helpers, middleware, and response construction. It's the layer you'll spend most of your time in.
- **mist** — the actual TCP server that receives connections and speaks HTTP. Wisp sits on top of Mist, so you rarely interact with it directly.
- **gleam_erlang** — Erlang interop utilities. It's a transitive dependency pulled in by Wisp and Mist, but we use `process.sleep_forever()` from it directly, so we declare it explicitly to avoid a compiler warning.
- **gleam_http** — the shared vocabulary of HTTP: `Request`, `Response`, methods, headers. Also a transitive dependency, declared explicitly because we import it directly in our router.

After running the command, `gleam.toml` gains four new entries[^1]:

```toml
[dependencies]
shared = { path = "../shared" }
gleam_stdlib = ">= 0.44.0 and < 2.0.0"
gleam_http = ">= 4.3.0 and < 5.0.0" # [!code ++]
gleam_erlang = ">= 1.3.0 and < 2.0.0" # [!code ++]
wisp = ">= 2.2.1 and < 3.0.0" # [!code ++]
mist = ">= 5.0.4 and < 6.0.0" # [!code ++]
```

[^1]: See commit [18c3c39](https://github.com/lukwol/doable/commit/18c3c39974b2dbb45e1b1de4a5c37e52ea0189ba) on GitHub

## Source Layout

Three new files join the existing `server.gleam`:

```sh
src/
├── server.gleam       # starts the HTTP server
├── web.gleam          # shared middleware              [!code ++]
├── router.gleam       # top-level request dispatcher   [!code ++]
└── task/
    └── route.gleam    # task route handlers            [!code ++]
```

`server.gleam` is the entry point — its only job is to start Mist and hand it a request handler. `web.gleam` holds middleware that runs on every request regardless of route. `router.gleam` inspects the path and method and decides which handler to call. `task/route.gleam` contains the actual handler functions for the task API.

This separation keeps `router.gleam` free of cross-cutting concerns and `web.gleam` free of routing logic — each file does exactly one thing.

## Starting the Server

`server.gleam` wires everything together and starts Mist on port 8000:

```gleam
import gleam/erlang/process
import mist
import router
import wisp
import wisp/wisp_mist

pub fn main() -> Nil {
  wisp.configure_logger()
  let secret_key_base = wisp.random_string(64)

  let assert Ok(_) =
    wisp_mist.handler(router.handle_request, secret_key_base)
    |> mist.new
    |> mist.port(8000)
    |> mist.start

  process.sleep_forever()
}
```

`wisp_mist.handler` adapts Wisp's request/response model to what Mist expects, bridging the two libraries. The `secret_key_base` is a random string Wisp uses to sign cookies and session data — generating it fresh on each startup is fine for development; in production you'd load it from an environment variable.

`process.sleep_forever()` at the end prevents the Erlang VM from exiting once `main` returns. The server runs in a separate process managed by Mist, so without this the program would simply end.

## Middleware

Rather than attaching middleware to individual routes, we define it once in `web.gleam` and apply it to every request:

```gleam
import wisp

pub fn middleware(
  req: wisp.Request,
  handle_request: fn(wisp.Request) -> wisp.Response,
) -> wisp.Response {
  use <- wisp.log_request(req)
  use <- wisp.rescue_crashes
  use req <- wisp.handle_head(req)
  handle_request(req)
}
```

The three layers, from outermost to innermost:

- **`log_request`** — logs every incoming request so you can see what's hitting the server in your terminal.
- **`rescue_crashes`** — catches any unhandled panics and turns them into 500 responses instead of crashing the process. Essential during development when handler stubs are incomplete.
- **`handle_head`** — automatically handles `HEAD` requests by running the corresponding `GET` handler and stripping the body. This is correct HTTP behaviour for free.

Wisp's `use` syntax threads the request through each layer in order. The result is a clean, readable middleware stack that's easy to extend later.

## Router

`router.gleam` receives every request after middleware runs and decides where it goes:

```gleam
import gleam/http.{Delete, Get, Patch, Post, Put}
import task/route as task_routes
import web
import wisp.{type Request, type Response}

pub fn handle_request(req: Request) -> Response {
  use req <- web.middleware(req)

  case wisp.path_segments(req) {
    ["api", "tasks", ..rest] -> handle_tasks(rest, req)
    _ -> wisp.not_found()
  }
}

fn handle_tasks(segments: List(String), req: Request) -> Response {
  case segments, req.method {
    [], Get -> task_routes.list_tasks()
    [], Post -> task_routes.create_task(req)
    [], _ -> wisp.method_not_allowed([Get, Post])

    [id], Get -> task_routes.show_task(req, id)
    [id], Patch -> task_routes.update_task(req, id)
    [id], Put -> task_routes.upsert_task(req, id)
    [id], Delete -> task_routes.delete_task(req, id)
    [_], _ -> wisp.method_not_allowed([Get, Patch, Put, Delete])
    _, _ -> wisp.not_found()
  }
}
```

The routing logic is split into two functions to keep each `case` focused. `handle_request` matches on the path prefix and delegates to a sub-handler; `handle_tasks` then matches on the remaining segments and the HTTP method together.

`case segments, req.method` is a nice Gleam trick — matching on a tuple of values in one expression makes the routing table read almost like a specification. The exhaustive catch-all arms at the bottom ensure that unsupported methods return `405 Method Not Allowed` rather than a generic 404, which is the correct HTTP behaviour.

## Task Routes

`task/route.gleam` defines the six handlers. For now they're stubs — each one returns the right status code and an empty placeholder body[^2]:

| Handler       | Method | Path             |
| ------------- | ------ | ---------------- |
| `list_tasks`  | GET    | `/api/tasks`     |
| `create_task` | POST   | `/api/tasks`     |
| `show_task`   | GET    | `/api/tasks/:id` |
| `update_task` | PATCH  | `/api/tasks/:id` |
| `upsert_task` | PUT    | `/api/tasks/:id` |
| `delete_task` | DELETE | `/api/tasks/:id` |

```gleam
import wisp.{type Request, type Response}

pub fn list_tasks() -> Response {
  wisp.ok()
  |> wisp.json_body("[]")
}

pub fn create_task(_req: Request) -> Response {
  wisp.created()
  |> wisp.json_body("{}")
}

pub fn show_task(_req: Request, _id: String) -> Response {
  wisp.ok()
  |> wisp.json_body("{}")
}

pub fn update_task(_req: Request, _id: String) -> Response {
  wisp.ok()
  |> wisp.json_body("{}")
}

pub fn upsert_task(_req: Request, _id: String) -> Response {
  wisp.ok()
  |> wisp.json_body("{}")
}

pub fn delete_task(_req: Request, _id: String) -> Response {
  wisp.no_content()
}
```

Using underscored parameters like `_req` and `_id` tells both the compiler and the reader that these values are intentionally unused for now. The status codes already reflect the intended final behaviour — `201 Created` for `create_task`, `204 No Content` for `delete_task` — so the stubs double as a lightweight contract for what the real implementations will return.

[^2]: See commit [d440191](https://github.com/lukwol/doable/commit/d4401913ce856e3dcb73eeb3309d404246360516) on GitHub

## Verifying the API Routes

Start the server:

```sh
cd server
gleam run
```

Then hit each route with `curl -i` to confirm the right status codes come back:

```sh
curl -i http://localhost:8000/api/tasks             # 200 OK, []
curl -i -X POST http://localhost:8000/api/tasks     # 201 Created, {}
curl -i http://localhost:8000/api/tasks/1           # 200 OK, {}
curl -i -X PATCH http://localhost:8000/api/tasks/1  # 200 OK, {}
curl -i -X PUT http://localhost:8000/api/tasks/1    # 200 OK, {}
curl -i -X DELETE http://localhost:8000/api/tasks/1 # 204 No Content

curl -i -X DELETE http://localhost:8000/api/tasks   # 405 Method Not Allowed
curl -i http://localhost:8000/api/unknown           # 404 Not Found
```

The last two lines check the error cases: an unsupported method returns `405`, and an unknown path returns `404`. Getting these right from the start means the API already behaves correctly at the edges, before any real logic exists.

If you prefer a GUI, [Postman](https://www.postman.com), [Insomnia](https://insomnia.rest), or [Bruno](https://www.usebruno.com) all work equally well against `http://localhost:8000`.

## What's Next

The routing skeleton is in place. The next step is setting up the PostgreSQL database with Docker Compose — once that's running, we'll come back and replace these stubs with handlers that actually read from and write to the database.
