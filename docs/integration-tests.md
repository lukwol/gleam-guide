# Integration Tests

With the REST API complete, this chapter adds an automated test suite that exercises each route end-to-end — through the router, handlers, and real database queries — without running a live HTTP server. The setup involves four moving parts: a dedicated test database, a shared test context, transaction-based rollback for isolation, and Wisp's in-process request simulator.

Several new files are added across the project:

```sh
doable/
├── compose.yml                             # TEST_DB_NAME and migrate-test service added [!code highlight]
├── docker/
│   └── init-test-db.sh                     # creates the test database on first start    [!code ++]
└── server/
    ├── src/
    │   └── context.gleam                   # extended with TestContext variant           [!code highlight]
    └── test/
        ├── server_test.gleam               # initialises test context before suite       [!code highlight]
        ├── test_context.gleam              # shared DB pool setup and retrieval          [!code ++]
        ├── database_helpers.gleam          # transaction rollback helper                 [!code ++]
        ├── fixtures.gleam                  # reusable Task test data                     [!code ++]
        └── routes/
            ├── router_test.gleam           # routing and method-not-allowed cases        [!code ++]
            ├── list_tasks_test.gleam       # GET /api/tasks                              [!code ++]
            ├── create_task_test.gleam      # POST /api/tasks                             [!code ++]
            ├── show_task_test.gleam        # GET /api/tasks/:id                          [!code ++]
            ├── update_task_test.gleam      # PATCH /api/tasks/:id                        [!code ++]
            ├── upsert_task_test.gleam      # PUT /api/tasks/:id                          [!code ++]
            └── delete_task_test.gleam      # DELETE /api/tasks/:id                       [!code ++]
```

## Test Database Setup

Tests need their own database so they don't touch development data. Two small additions to `compose.yml` and an init script create it automatically when the Docker stack first starts[^1].

### `docker/init-test-db.sh`

A new shell script runs during the Postgres container's first-time initialization:

```sh
#!/bin/bash
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -c "CREATE DATABASE \"$TEST_DB_NAME\";"
```

This creates the test database alongside the development database in the same Postgres instance. Postgres runs scripts in `/docker-entrypoint-initdb.d/` automatically on first start, so no manual steps are needed.

### `.env`

One new variable tells Docker and the server which database name to use for tests:

```sh
# Database
PGHOST=db
PGPORT=5432
PGDATABASE=doable-dev
PGUSER=doable-user-dev
PGPASSWORD=doable-dev-p@ssw0rd
TEST_DB_NAME=doable-test  # [!code ++]

# Server
SECRET_KEY_BASE=...
SERVER_HOST=0.0.0.0
SERVER_PORT=8000
```

### `compose.yml`

Two changes to `compose.yml`: the `db` service gains the `TEST_DB_NAME` environment variable and a volume mount for the init script, and a new `migrate-test` service runs the same migrations against the test database:

```yaml{42-44}
name: doable-dev

services:
  db:
    image: postgres:18-alpine
    restart: unless-stopped
    shm_size: 128mb
    environment:
      POSTGRES_PORT: ${PGPORT}
      POSTGRES_USER: ${PGUSER}
      POSTGRES_PASSWORD: ${PGPASSWORD}
      POSTGRES_DB: ${PGDATABASE}
      TEST_DB_NAME: ${TEST_DB_NAME}                                             # [!code ++]
    ports:
      - ${PGPORT}:${PGPORT}
    volumes:
      - data:/var/lib/postgresql
      - ./docker/init-test-db.sh:/docker-entrypoint-initdb.d/init-test-db.sh:ro # [!code ++]
    healthcheck:
      test: "pg_isready -U ${PGUSER} -d ${PGDATABASE}"
      interval: 1s
      timeout: 2s
      retries: 10

  migrate:
    image: migrate/migrate
    volumes:
      - ./migrations:/migrations
    command: >
      -path /migrations
      -database postgres://${PGUSER}:${PGPASSWORD}@${PGHOST}:${PGPORT}/${PGDATABASE}?sslmode=disable
      up
    depends_on:
      db:
        condition: service_healthy

  migrate-test:                             # [!code ++]
    image: migrate/migrate                  # [!code ++]
    volumes:                                # [!code ++]
      - ./migrations:/migrations            # [!code ++]
    command: >                              # [!code ++]
      -path /migrations
      -database postgres://${PGUSER}:${PGPASSWORD}@${PGHOST}:${PGPORT}/${TEST_DB_NAME}?sslmode=disable
      up
    depends_on:                             # [!code ++]
      db:                                   # [!code ++]
        condition: service_healthy          # [!code ++]

volumes:
  data:
    name: doable-dev-data

networks:
  default:
    name: doable-dev-network
```

Recreate the stack to apply these changes:

```sh
docker compose down -v
docker compose up -d
```

`-v` removes the named volume so Postgres reinitializes from scratch and the init script runs again.

## Test Context

The tests need database access, but setting up a fresh connection pool per-test would be slow and wasteful. Instead, the pool is started once when the test suite starts and retrieved by name in each test.

### Extending `context.gleam`

`context.gleam` gains a `TestContext` variant that holds a direct `pog.Connection` rather than a named pool reference. The `db_conn` helper handles both variants:

```gleam
pub type Context {
  Context(config: Config, db_pool_name: DbPoolName)
  TestContext(config: Config, db_conn: pog.Connection)  // [!code ++]
}

pub fn db_conn(ctx: Context) -> pog.Connection {
  pog.named_connection(ctx.db_pool_name)                // [!code --]
  case ctx {                                            // [!code ++]
    Context(_, db_pool_name) -> pog.named_connection(db_pool_name)  // [!code ++]
    TestContext(_, db_conn) -> db_conn                  // [!code ++]
  }                                                     // [!code ++]
}
```

`TestContext` stores a `pog.Connection` directly because `with_rollback` (covered below) must inject a transaction-scoped connection into the context. Named pool lookup would bypass the transaction boundary.

### `test/test_context.gleam`

`test_context.gleam` provides two functions: `init` starts the pool once, and `get` retrieves it by name for each test[^2]:

```gleam
import config
import context.{type Context, TestContext}
import envoy
import gleam/erlang/process
import gleam/option.{Some}
import pog

const test_db_pool_name = "test_db_pool"

@external(erlang, "erlang", "binary_to_atom")
fn binary_to_atom(name: String) -> process.Name(pog.Message)

pub fn init() -> Context {
  let config = test_config()
  let db_pool_name = binary_to_atom(test_db_pool_name)
  let db_conn = pog.named_connection(db_pool_name)
  let assert Ok(_) =
    db_pool_name
    |> pog.default_config
    |> pog.host(config.db_host)
    |> pog.port(config.db_port)
    |> pog.database(config.db_name)
    |> pog.user(config.db_user)
    |> pog.password(Some(config.db_password))
    |> pog.start
  TestContext(config:, db_conn:)
}

pub fn get() -> Context {
  let config = test_config()
  let db_pool_name = binary_to_atom(test_db_pool_name)
  let assert Ok(_) = process.named(db_pool_name)
  let db_conn = pog.named_connection(db_pool_name)
  TestContext(config:, db_conn:)
}

fn test_config() -> config.Config {
  let assert Ok(db_name) = envoy.get("TEST_DB_NAME")
  config.Config(..config.load(), db_name:)
}
```

A few things worth noting:

- **`binary_to_atom`** — pog's named pool API requires a `process.Name(pog.Message)`. Gleam's standard library doesn't expose a way to create one from a string at runtime, so this calls Erlang's `binary_to_atom` directly via an `@external` binding.
- **`pog.named_connection`** — returns a lazy handle that references the pool by name; it does not establish a connection immediately. The actual connection is checked out from the pool when a query runs, which is why it is safe to call before `pog.start`.
- **`init` vs `get`** — `init` starts the pool and must be called once before any test runs. `get` looks up the already-running pool by name; it's called at the top of every test. gleeunit runs tests concurrently, so sharing one pool rather than creating one per test avoids connection exhaustion.
- **`test_config`** — overrides `db_name` with `TEST_DB_NAME` from the environment, leaving all other settings (host, port, user, password) the same as the development config.
- **`pog.start`** — for tests, the pool is started directly rather than through an OTP supervisor. There's no crash-recovery concern in a test process.

### `test/server_test.gleam`

gleeunit's `main` is the suite entry point. Calling `test_context.init()` here ensures the pool exists before any test module runs:

```gleam
import gleeunit
import test_context

pub fn main() -> Nil {
  test_context.init()

  gleeunit.main()
}
```

## Test Fixtures

`test/fixtures.gleam` defines a handful of reusable `Task` values that appear throughout the tests:

```gleam
import task

pub const task1 = task.Task(
  id: 1,
  name: "Buy groceries",
  description: "Milk, eggs, bread, and coffee",
  completed: False,
)

pub const task2 = task.Task(
  id: 2,
  name: "Read a book",
  description: "Finish the current chapter",
  completed: True,
)

pub const task3 = task.Task(
  id: 42,
  name: "Go for a run",
  description: "30 minutes in the park",
  completed: False,
)

pub const task4 = task.Task(
  id: 67,
  name: "Call dentist",
  description: "Schedule annual checkup",
  completed: False,
)
```

The `id` fields don't matter — database sequences assign real IDs on insert. The fixtures are used as templates for `task_input_from`, which strips the ID before inserting.

## Rollback Isolation

Tests that write to the database must leave it clean for the tests that follow. `test/database_helpers.gleam` provides a `with_rollback` helper that wraps a test body in a transaction and always rolls back:

```gleam
import context.{type Context, TestContext}
import pog

pub fn with_rollback(ctx: Context, next: fn(Context) -> Nil) -> Nil {
  let _ =
    pog.transaction(context.db_conn(ctx), fn(db_conn) {
      next(TestContext(config: ctx.config, db_conn:))
      // Always rollback by returning Error
      Error("rollback")
    })
  Nil
}
```

A few things worth noting:

- **`pog.transaction`** — starts a database transaction and passes the transaction-scoped connection to the callback. If the callback returns `Error`, the transaction is rolled back; if it returns `Ok`, it is committed.
- **Always returning `Error("rollback")`** — by unconditionally returning an error after `next`, every test transaction is rolled back regardless of whether it succeeded or failed. This ensures no test leaves data behind.
- **Injecting a new `TestContext`** — `with_rollback` wraps the transaction-scoped `db_conn` in a fresh `TestContext` and passes it to `next`. All database calls inside the test use this connection and therefore participate in the same transaction.
- **`use` at the call site** — tests call `use ctx <- database_helpers.with_rollback(ctx)` to shadow the outer `ctx` with the transaction-scoped one. Any test that omits `with_rollback` runs outside a transaction and directly affects the test database — appropriate for read-only tests.

## Writing Route Tests

Tests call `router.handle_request` directly, bypassing Mist and the TCP stack entirely. Wisp's `simulate` module builds in-memory requests and reads responses. It is part of the `wisp` package already declared as a dependency — no new packages needed.

### The `simulate` API

A request with a JSON body:

```gleam
let response =
  simulate.request(http.Post, "/api/tasks")
  |> simulate.json_body(body)
  |> router.handle_request(ctx)

response.status               // Int
simulate.read_body(response)  // String
```

`simulate.json_body` sets both the body and the `content-type: application/json` header in one call. When you need to send a malformed body with the correct content type — to test JSON parse failures — use `simulate.string_body` and `simulate.header` separately:

```gleam
let response =
  simulate.request(http.Post, "/api/tasks")
  |> simulate.string_body("{not valid json}")
  |> simulate.header("content-type", "application/json")
  |> router.handle_request(ctx)
```

### Stateless Tests

Tests that don't write to the database need no rollback. They call `test_context.get()` and dispatch a request directly. Because every mutating test wraps its writes in `with_rollback`, the database is always empty at the start of a read-only test regardless of execution order.

```gleam
// routes/list_tasks_test.gleam
pub fn empty_list_tasks_test() {
  let ctx = test_context.get()

  let response =
    simulate.request(http.Get, "/api/tasks")
    |> router.handle_request(ctx)

  assert response.status == 200

  let body = simulate.read_body(response)
  let assert Ok(tasks) = json.parse(body, decode.list(task.task_decoder()))

  assert tasks == []
}
```

Method-not-allowed and not-found cases are also stateless — they don't touch the database at all:

```gleam
// routes/router_test.gleam
pub fn unknown_route_not_found_test() {
  let ctx = test_context.get()

  let response =
    simulate.request(http.Get, "/unknown")
    |> router.handle_request(ctx)

  assert response.status == 404
  assert simulate.read_body(response) == "Not found"
}

// routes/list_tasks_test.gleam
pub fn list_tasks_wrong_method_test() {
  let ctx = test_context.get()

  let response =
    simulate.request(http.Delete, "/api/tasks")
    |> router.handle_request(ctx)

  assert response.status == 405
  assert simulate.read_body(response) == "Method not allowed"
}
```

### Stateful Tests

Tests that insert data wrap the body in `with_rollback`. The transaction-scoped `ctx` is then used for both the seed insert and the HTTP request, so both participate in the same transaction:

```gleam
// routes/list_tasks_test.gleam
pub fn not_empty_list_tasks_test() {
  let ctx = test_context.get()
  use ctx <- database_helpers.with_rollback(ctx)

  let db_conn = context.db_conn(ctx)
  let inputs =
    [fixtures.task1, fixtures.task2]
    |> list.map(task.task_input_from)

  inputs
  |> list.each(fn(input) {
    let assert Ok(_) = database.create_task(db_conn, input)
  })

  let response =
    simulate.request(http.Get, "/api/tasks")
    |> router.handle_request(ctx)

  assert response.status == 200

  let body = simulate.read_body(response)
  let assert Ok(tasks) = json.parse(body, decode.list(task.task_decoder()))

  assert list.map(tasks, task.task_input_from) == list.reverse(inputs)
}
```

`list.reverse(inputs)` reflects the `ORDER BY id DESC` in the `all_tasks` query — the most recently inserted task comes first.

A create test verifies the response body matches the submitted input:

```gleam
// routes/create_task_test.gleam
pub fn create_task_with_completed_test() {
  let ctx = test_context.get()
  use ctx <- database_helpers.with_rollback(ctx)

  let body =
    fixtures.task1
    |> task.task_input_from
    |> task.task_input_to_json

  let response =
    simulate.request(http.Post, "/api/tasks")
    |> simulate.json_body(body)
    |> router.handle_request(ctx)

  assert response.status == 201
  let body = simulate.read_body(response)
  let assert Ok(task) = json.parse(body, task.task_decoder())

  assert task.task_input_from(task) == task.task_input_from(fixtures.task1)
}
```

`task.task_input_from` strips the ID before comparing — the database assigns a new ID, so comparing the full `Task` structs would always fail.

### Error Cases

Error path tests exercise the handler helpers without requiring database state. An invalid JSON body returns `422`, a malformed body returns `400`:

```gleam
// routes/create_task_test.gleam
pub fn create_task_with_invalid_json_test() {
  let ctx = test_context.get()

  let body = json.object([#("foo", json.string("bar"))])

  let response =
    simulate.request(http.Post, "/api/tasks")
    |> simulate.json_body(body)
    |> router.handle_request(ctx)

  assert response.status == 422
  assert simulate.read_body(response) == "Unprocessable content"
}

pub fn create_task_with_malformed_body_test() {
  let ctx = test_context.get()

  let response =
    simulate.request(http.Post, "/api/tasks")
    |> simulate.string_body("{not valid json}")
    |> simulate.header("content-type", "application/json")
    |> router.handle_request(ctx)

  assert response.status == 400
  assert simulate.read_body(response) == "Bad request: Invalid JSON"
}
```

`422` comes from `web.decode_body` — valid JSON that doesn't match the decoder. `400` comes from `wisp.require_json` — the body itself isn't valid JSON.

### Upsert

The upsert handler returns `201 Created` when it inserts and `200 OK` when it updates. Two separate tests cover each branch:

```gleam
// routes/upsert_task_test.gleam
pub fn upsert_task_creates_task_test() {
  let ctx = test_context.get()
  use ctx <- database_helpers.with_rollback(ctx)

  let input = task.task_input_from(fixtures.task1)
  let body = task.task_input_to_json(input)

  let response =
    simulate.request(http.Put, "/api/tasks/123456789")
    |> simulate.json_body(body)
    |> router.handle_request(ctx)

  assert response.status == 201
  let assert Ok(task) =
    json.parse(simulate.read_body(response), task.task_decoder())

  assert task.id == 123_456_789
  assert task.task_input_from(task) == input
}

pub fn upsert_task_updates_task_test() {
  let ctx = test_context.get()
  use ctx <- database_helpers.with_rollback(ctx)

  let db_conn = context.db_conn(ctx)
  let assert Ok(created) =
    database.create_task(db_conn, task.task_input_from(fixtures.task1))

  let updated_input = task.task_input_from(fixtures.task2)
  let body = task.task_input_to_json(updated_input)

  let response =
    simulate.request(http.Put, "/api/tasks/" <> int.to_string(created.id))
    |> simulate.json_body(body)
    |> router.handle_request(ctx)

  assert response.status == 200
  let assert Ok(task) =
    json.parse(simulate.read_body(response), task.task_decoder())

  assert task.id == created.id
  assert task.task_input_from(task) == updated_input
}
```

The insert test uses a hardcoded high ID (`123456789`) that's unlikely to exist, making it a reliable insert. The update test inserts first, then upserts the same ID, confirming the `200` branch.

The remaining test files — `show_task_test.gleam`, `update_task_test.gleam`, and `delete_task_test.gleam` — follow the same patterns: seed with `database.create_task` inside `with_rollback`, dispatch a simulated request using the transaction-scoped `ctx`, and assert on the response status and body.

## Running the Tests

Start the Docker stack (if not already running) and run the suite from the `server/` directory:

```sh
docker compose up -d
cd server
gleam test
#   Compiled in 0.07s
#    Running server_test.main
# ................................
# 32 passed, no failures
```

gleeunit discovers every function whose name ends in `_test` across all files in `test/`. Each dot represents one passing test; a summary of passes and failures is printed at the end.

## What's Next

The server is fully tested. The next step adds it to Docker Compose so the whole stack — database, migrations, and server — starts with a single `docker compose up`, making client development easier without needing to run `gleam run` separately.

[^1]: See commit [b9991b6](https://github.com/lukwol/doable/commit/b9991b6219a28fbce4d63e1b6c4d1e24d0bdde95) on GitHub

[^2]: See commit [df43064](https://github.com/lukwol/doable/commit/df430644ecc4e2ef91a68605725048d85f57b332) on GitHub
