# Setting Up the Server

## Install Dependencies

To add HTTP server capabilities to `server`, install these packages:

```sh
cd server
gleam add gleam_http gleam_erlang wisp mist
```

- **gleam_http** — types and abstractions for HTTP requests and responses
- **gleam_erlang** — Erlang interop utilities, including process management
- **wisp** — a lightweight web framework that handles routing, middleware, and response building
- **mist** — the underlying HTTP server that wisp runs on top of

This adds the following entries to `gleam.toml`[^1]:

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

We'll organise the server code across four files:

```
src/
├── server.gleam       # starts the HTTP server
├── web.gleam          # shared middleware
├── router.gleam       # top-level request dispatcher
└── task/
    └── route.gleam    # stub handlers for Task routes
```

## Starting the Server

`server.gleam` starts a mist HTTP server on port 8000 and wires it to the router:

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

## Middleware

`web.gleam` defines a middleware stack applied to every request — logging, crash recovery, and HEAD method handling:

```gleam
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

## Router

`router.gleam` dispatches incoming requests by path and method. All task endpoints live under `/api/tasks`:

```gleam
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

`case segments, req.method` matches on both the remaining path segments and HTTP method simultaneously, making the routing table easy to scan.

## Task Route Stubs

`task/route.gleam` contains stub handlers that return empty responses, to be filled in later[^2]:

| Handler       | Method | Path             |
| ------------- | ------ | ---------------- |
| `list_tasks`  | GET    | `/api/tasks`     |
| `create_task` | POST   | `/api/tasks`     |
| `show_task`   | GET    | `/api/tasks/:id` |
| `update_task` | PATCH  | `/api/tasks/:id` |
| `upsert_task` | PUT    | `/api/tasks/:id` |
| `delete_task` | DELETE | `/api/tasks/:id` |

[^2]: See commit [623097c](https://github.com/lukwol/doable/commit/623097c3207f7ac65083a4aba14e47b220820355) on GitHub
