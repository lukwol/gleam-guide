# Connecting to the Database

The query functions are ready but they need a [`pog.Connection`](https://hexdocs.pm/pog/pog.html#Connection) to run against. This chapter wires everything together: loading server settings from environment variables, setting up a supervised database connection pool, and threading it through the router to the route handlers.

Three new files join the existing ones, and four are updated:

```sh
doable/
├── .env                       # adds server settings                            [!code highlight]
└── server/
    └── src/
        ├── config.gleam       # loads all settings from environment variables   [!code ++]
        ├── context.gleam      # holds config and DB pool, passed to handlers    [!code ++]
        ├── database.gleam     # starts supervised DB pool                       [!code ++]
        ├── server.gleam       # initialises config and context, configures Mist [!code highlight]
        ├── router.gleam       # threads context through to route handlers       [!code highlight]
        └── task/
            └── route.gleam    # handler stubs accept context                    [!code highlight]
```

## Install Dependencies

Two new packages[^1]:

```sh
cd server
gleam add envoy gleam_otp
```

- **envoy** — reads environment variables.
- **gleam_otp** — OTP primitives: supervisors, processes, named registries. It's a transitive dependency of `pog`, declared explicitly because we use `static_supervisor` from it directly.

`gleam.toml` gains two new entries:

```toml
# server/gleam.toml

[dependencies]
shared = { path = "../shared" }
gleam_stdlib = ">= 0.44.0 and < 2.0.0"
gleam_http = ">= 4.3.0 and < 5.0.0"
gleam_erlang = ">= 1.3.0 and < 2.0.0"
gleam_otp = ">= 1.2.0 and < 2.0.0"      # [!code ++]
wisp = ">= 2.2.1 and < 3.0.0"
mist = ">= 5.0.4 and < 6.0.0"
pog = ">= 4.1.0 and < 5.0.0"
gleam_time = ">= 1.8.0 and < 2.0.0"
envoy = ">= 1.1.0 and < 2.0.0"          # [!code ++]
```

## Server Configuration

### Environment Variables

The server needs three more values in `.env`[^2]:

```sh
# .env

# Database
PGHOST=db
PGPORT=5432
PGDATABASE=doable-dev
PGUSER=doable-user-dev
PGPASSWORD=doable-dev-p@ssw0rd

# Server
SECRET_KEY_BASE=1811fb5d050b56...   # [!code ++]
SERVER_HOST=0.0.0.0                 # [!code ++]
SERVER_PORT=8000                    # [!code ++]
```

- `SECRET_KEY_BASE` — used by Wisp to sign cookies and session data. Previously generated with `wisp.random_string(64)` on each startup; loading it from the environment makes it stable across restarts.
  ::: tip
  Generate a value for `SECRET_KEY_BASE` with `openssl rand -hex 64`.
  :::
- `SERVER_HOST` — the address Mist binds to. `0.0.0.0` accepts connections on all interfaces.
  ::: info
  Binding to `0.0.0.0` is required when running inside Docker — binding to `localhost` would only accept connections from within the container itself, making the server unreachable from Caddy or the host machine.
  :::

- `SERVER_PORT` — the port the HTTP server listens on.

## App Config

`config.gleam` defines a `Config` type and a `load` function that reads every setting from the environment at startup:

```gleam
// server/src/config.gleam

import envoy
import gleam/int
import gleam/result

pub type Config {
  Config(
    db_host: String,
    db_port: Int,
    db_name: String,
    db_user: String,
    db_password: String,
    secret_key_base: String,
    server_host: String,
    server_port: Int,
  )
}

pub fn load() -> Config {
  let assert Ok(db_host) = envoy.get("PGHOST")
  let assert Ok(db_port) = envoy.get("PGPORT") |> result.try(int.parse)
  let assert Ok(db_name) = envoy.get("PGDATABASE")
  let assert Ok(db_user) = envoy.get("PGUSER")
  let assert Ok(db_password) = envoy.get("PGPASSWORD")
  let assert Ok(secret_key_base) = envoy.get("SECRET_KEY_BASE")
  let assert Ok(server_host) = envoy.get("SERVER_HOST")
  let assert Ok(server_port) = envoy.get("SERVER_PORT") |> result.try(int.parse)

  Config(
    secret_key_base:,
    server_host:,
    server_port:,
    db_host:,
    db_port:,
    db_name:,
    db_user:,
    db_password:,
  )
}
```

`let assert Ok` panics if a variable is missing or can't be parsed — intentionally so. A misconfigured server should fail loudly at startup, not silently misbehave at runtime.

`result.try(int.parse)` chains the string result from `envoy.get` into `int.parse`, converting port strings to integers in one step.

## Database Context

`context.gleam` wraps the config and the database pool into a single `Context` value that gets passed to every request handler:

```gleam
// server/src/context.gleam

import config.{type Config}
import gleam/erlang/process
import pog

pub type DbPoolName =
  process.Name(pog.Message)

pub type Context {
  Context(config: Config, db_pool_name: DbPoolName)
}

pub fn db_conn(ctx: Context) -> pog.Connection {
  pog.named_connection(ctx.db_pool_name)
}
```

`DbPoolName` — rather than storing a `pog.Connection` directly, `Context` stores a named reference to the pool process. `db_conn` resolves it to a live connection on demand using `pog.named_connection`.

## Database Pool

`database.gleam` owns the pool lifecycle — it creates a named pool, attaches it to an OTP supervisor, and returns the pool name:

```gleam
// server/src/database.gleam

import config.{type Config}
import context.{type DbPoolName}
import gleam/erlang/process
import gleam/option.{Some}
import gleam/otp/static_supervisor as supervisor
import pog

pub fn start(config: Config) -> DbPoolName {
  let db_pool_name = process.new_name("db")
  let db_pool =
    db_pool_name
    |> pog.default_config
    |> pog.host(config.db_host)
    |> pog.port(config.db_port)
    |> pog.database(config.db_name)
    |> pog.user(config.db_user)
    |> pog.password(Some(config.db_password))
    |> pog.supervised
  let assert Ok(_) =
    supervisor.new(supervisor.RestForOne)
    |> supervisor.add(db_pool)
    |> supervisor.start
  db_pool_name
}
```

A few things worth noting:

- `pog.supervised` — wraps the pool as an OTP child spec rather than starting it immediately. This lets us hand it to a supervisor.
- `supervisor.RestForOne` — if the pool process crashes, the supervisor restarts it. With `RestForOne`, any processes started after the crashed one are also restarted, preserving startup order.

## Wiring It Together

`server.gleam` now loads config and context before starting Mist, and configures the server from the environment rather than hardcoded values:

```gleam
// server/src/server.gleam

import config                                      // [!code ++]
import context.{Context}                           // [!code ++]
import database                                    // [!code ++]
import gleam/erlang/process
import mist
import router
import wisp
import wisp/wisp_mist

pub fn main() -> Nil {
  let config = config.load()                       // [!code ++]
  let db_pool_name = database.start(config)        // [!code ++]
  let context = Context(config:, db_pool_name:)    // [!code ++]

  wisp.configure_logger()

  let assert Ok(_) =
    router.handle_request(_, context)              // [!code highlight]
    |> wisp_mist.handler(config.secret_key_base)   // [!code highlight]
    |> mist.new
    |> mist.bind(config.server_host)               // [!code ++]
    |> mist.port(config.server_port)               // [!code highlight]
    |> mist.start

  process.sleep_forever()
}
```

`router.handle_request(_, context)` uses Gleam's function capture syntax — the `_` is a placeholder for the request argument, producing a single-argument function with `context` already applied. This matches the signature `wisp_mist.handler` expects.

### `router.gleam`

The router now accepts and threads `Context` through to the route handlers:

```gleam
// server/src/router.gleam

import context.{type Context}                                                     // [!code ++]
import gleam/http.{Delete, Get, Patch, Post}
import task/route as task_routes
import web
import wisp.{type Request, type Response}

pub fn handle_request(req: Request, ctx: Context) -> Response {                   // [!code highlight]
  use req <- web.middleware(req)

  case wisp.path_segments(req) {
    ["api", "tasks", ..rest] -> handle_tasks(rest, req, ctx)                      // [!code highlight]
    _ -> wisp.not_found()
  }
}

fn handle_tasks(segments: List(String), req: Request, ctx: Context) -> Response { // [!code highlight]
  case segments, req.method {
    [], Get -> task_routes.list_tasks(ctx)                                        // [!code highlight]
    [], Post -> task_routes.create_task(req, ctx)                                 // [!code highlight]
    [], _ -> wisp.method_not_allowed([Get, Post])

    [id], Get -> task_routes.show_task(req, ctx, id)                              // [!code highlight]
    [id], Patch -> task_routes.update_task(req, ctx, id)                          // [!code highlight]
    [id], Delete -> task_routes.delete_task(req, ctx, id)                         // [!code highlight]
    [_], _ -> wisp.method_not_allowed([Get, Patch, Delete])
    _, _ -> wisp.not_found()
  }
}
```

### `task/route.gleam`

The handler stubs now accept `Context` as a parameter, ready for the real implementations:

```gleam
// server/src/task/route.gleam

import context.{type Context}                                                 // [!code ++]
import wisp.{type Request, type Response}

pub fn list_tasks(_ctx: Context) -> Response {                                // [!code highlight]
  wisp.ok()
  |> wisp.json_body("[]")
}

pub fn create_task(_req: Request, _ctx: Context) -> Response {                // [!code highlight]
  wisp.created()
  |> wisp.json_body("{}")
}

pub fn show_task(_req: Request, _ctx: Context, _id: String) -> Response {     // [!code highlight]
  wisp.ok()
  |> wisp.json_body("{}")
}

pub fn update_task(_req: Request, _ctx: Context, _id: String) -> Response {   // [!code highlight]
  wisp.ok()
  |> wisp.json_body("{}")
}

pub fn delete_task(_req: Request, _ctx: Context, _id: String) -> Response {   // [!code highlight]
  wisp.no_content()
}
```

## Verifying the Connection

Before moving on, it's worth confirming the database pool actually connects. `gleam shell` drops you into an Erlang shell with all compiled modules available — you can call Gleam modules directly using Erlang syntax.

Make sure the database is running and open Gleam shell:

```sh
docker compose up -d
cd server
gleam shell
```

Then run the following erlang expressions:

```erlang
1> shell:strings(true).
2> application:ensure_all_started(pgo).
3> Config = config:load().
4> DbPoolName = database:start(Config).
5> Context = {context, Config, DbPoolName}.
6> DbConn = context:db_conn(Context).
7> Query = pog:query("SELECT 1").
8> pog:execute(Query, DbConn).
% {ok,{returned,1,[nil]}}
```

`returned` contains the row count (`1`) and the decoded rows (`[nil]` — no decoder was attached, so each row decodes to `nil`). Getting an `ok` tuple confirms the pool started, connected, and executed a query successfully.

A few things worth noting:

- `shell:strings(true)` — tells the Erlang shell to display binaries as strings rather than lists of integers, making output more readable.
- `application:ensure_all_started(pgo)` — starts `pgo`, the Erlang database driver that `pog` wraps, and its dependencies. Normally Gleam's runtime does this automatically, but in the shell it needs to be done manually.

::: info
Gleam modules compile to Erlang modules with the same name. `config:load()` calls `load()` from `config.gleam`, `database:start(Config)` calls `start` from `database.gleam`, and so on. Gleam custom types compile to Erlang tuples, so `Context(config:, db_pool_name:)` becomes `{context, Config, DbPoolName}` — the constructor name as a lowercase atom followed by the fields.
:::

## What's Next

The server is now fully wired to the database. The next step is replacing the route stubs with real implementations that call into `task/sql.gleam`. But before we dive into that we need to prepare our model and the database repository.

[^1]: See commit [2c9cb83](https://github.com/lukwol/doable/commit/2c9cb83) on GitHub

[^2]: See commit [7758bc5](https://github.com/lukwol/doable/commit/7758bc5) on GitHub
