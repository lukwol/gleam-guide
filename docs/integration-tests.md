# Integration Tests

With the REST API complete, this chapter adds an automated test suite that exercises each route end-to-end — through the router, handlers, and real database queries — without running a live HTTP server.

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
        ├── server_test.gleam               # initialises test database before suite      [!code highlight]
        ├── test_context.gleam              # test context retrieval                      [!code ++]
        ├── test_database.gleam             # DB pool setup and transaction rollback      [!code ++]
        ├── test_config.gleam               # test database config                        [!code ++]
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

A shell script placed in `/docker-entrypoint-initdb.d/` runs automatically on Postgres first start, creating the test database alongside the development one:

```sh
#!/bin/bash
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -c "CREATE DATABASE \"$TEST_DB_NAME\";"
```

### `.env`

One new variable specifies the test database name:

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

Two changes: the `db` service gains the `TEST_DB_NAME` environment variable and the init script volume mount, and a new `migrate-test` service runs migrations against the test database:

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

`-v` removes the named volume so Postgres reinitializes and the init script runs again.

## Test Context

Tests use the same route handlers as production but need a database connection they can roll back after each test. To support this, a second `TestContext` variant is introduced. Unlike `Context`, which holds only a pool name atom, `TestContext` holds a `pog.Connection` directly — either a pool-backed handle for read-only tests, or a transaction-scoped one inside `with_rollback`.

Four files work together to make this happen: `test_database` owns the pool, `test_config` tells it which database to use, `test_context` wraps the pool in a `TestContext` ready to use in each test, and `server_test` starts it all before the suite runs.

### Extending `context.gleam`

`context.gleam` gains a `TestContext` variant and updates `db_conn` to handle both:

```gleam
pub type Context {
  Context(config: Config, db_pool_name: DbPoolName)
  TestContext(config: Config, db_conn: pog.Connection)                // [!code ++]
}

pub fn db_conn(ctx: Context) -> pog.Connection {
  pog.named_connection(ctx.db_pool_name)                              // [!code --]
  case ctx {                                                          // [!code ++]
    Context(_, db_pool_name) -> pog.named_connection(db_pool_name)    // [!code ++]
    TestContext(_, db_conn) -> db_conn                                // [!code ++]
  }                                                                   // [!code ++]
}
```

### `test/test_config.gleam`

Loads the test database config by overriding `db_name` with `TEST_DB_NAME`, keeping all other settings (host, port, user, password) the same as development[^2]:

```gleam
import config.{type Config}
import envoy

pub fn load() -> Config {
  let assert Ok(db_name) = envoy.get("TEST_DB_NAME")
  config.Config(..config.load(), db_name:)
}
```

### `test/test_database.gleam`

Owns the test pool lifecycle and provides the `with_rollback` helper:

```gleam
import context.{type Context, type DbPoolName, TestContext}
import gleam/option.{Some}
import pog
import test_config

const test_db_pool_name = "test_db_pool"

@external(erlang, "erlang", "binary_to_atom")
fn binary_to_atom(name: String) -> DbPoolName

pub fn db_pool_name() -> DbPoolName {
  binary_to_atom(test_db_pool_name)
}

pub fn start() -> DbPoolName {
  let config = test_config.load()

  let assert Ok(_) =
    db_pool_name()
    |> pog.default_config
    |> pog.host(config.db_host)
    |> pog.port(config.db_port)
    |> pog.database(config.db_name)
    |> pog.user(config.db_user)
    |> pog.password(Some(config.db_password))
    |> pog.start

  db_pool_name()
}

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

A few notes:

- **`binary_to_atom`** — `pog`'s named pool API requires a `process.Name(pog.Message)`. Gleam's `process.new_name` generates a unique name on every call, so it can't be used here — `start` and `test_context.get` must resolve to the same atom. `binary_to_atom` produces a fixed, deterministic atom from a string, which is exactly what's needed.
- **`start` vs `get`** — `start` starts the pool once before the suite runs; `test_context.get` looks it up by name at the top of each test.

### `test/test_context.gleam`

`test_context.get` verifies the pool is running and wraps it in a `TestContext`:

```gleam
import context.{type Context, TestContext}
import gleam/erlang/process
import pog
import test_config
import test_database

pub fn get() -> Context {
  let config = test_config.load()
  let db_pool_name = test_database.db_pool_name()
  let assert Ok(_) = process.named(db_pool_name)
  let db_conn = pog.named_connection(db_pool_name)
  TestContext(config:, db_conn:)
}
```

### `test/server_test.gleam`

`gleeunit`'s `main` is the suite entry point. Calling `test_database.start()` here ensures the pool exists before any test module runs:

```gleam
import gleeunit
import test_database

pub fn main() -> Nil {
  test_database.start()

  gleeunit.main()
}
```

Tests that write to the database wrap their body in `use ctx <- test_database.with_rollback(ctx)`. This opens a transaction, passes a transaction-scoped `ctx` to the test, and always rolls back — so every test leaves the database clean regardless of outcome. Tests that only read can skip `with_rollback` entirely.

## Test Fixtures

`test/fixtures.gleam` defines reusable `Task` values used as input templates throughout the tests:

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

The `id` fields are placeholders — the database assigns real IDs on insert. Fixtures are used as templates for `to_task_input`, which strips the ID before inserting.

## Writing Route Tests

Tests call `router.handle_request` directly, bypassing Mist and the TCP stack entirely. Wisp's `simulate` module builds in-memory requests and reads responses — no new packages needed.

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

`simulate.json_body` sets both the body and the `content-type: application/json` header.

### Stateless Tests

Tests that only read from the database don't need `with_rollback` — just get a context and dispatch a request:

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

Method-not-allowed and not-found cases are also stateless:

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

### Error Cases

Error path tests don't touch the database, so no rollback is needed. An invalid JSON body returns `422`; a malformed body returns `400`:

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

`422` comes from `web.decode_body` failing to match the decoder; `400` comes from `wisp.require_json` rejecting the body.

### Stateful Tests

Tests that write to the database wrap their body in `with_rollback`. Both the seed insert and the HTTP request use the same transaction-scoped `ctx`, so both participate in the same transaction and are rolled back after the test:

```gleam
// routes/create_task_test.gleam
pub fn create_task_with_completed_test() {
  let ctx = test_context.get()
  use ctx <- test_database.with_rollback(ctx)

  let body =
    fixtures.task1
    |> task.to_task_input
    |> task.task_input_to_json

  let response =
    simulate.request(http.Post, "/api/tasks")
    |> simulate.json_body(body)
    |> router.handle_request(ctx)

  assert response.status == 201
  let body = simulate.read_body(response)
  let assert Ok(task) = json.parse(body, task.task_decoder())

  assert task.to_task_input(task) == task.to_task_input(fixtures.task1)
}
```

`task.to_task_input` strips the ID before comparing — the database assigns a new ID, so comparing full `Task` structs would always fail.

Tests that seed multiple records follow the same pattern — insert first, then dispatch:

```gleam
// routes/list_tasks_test.gleam
pub fn not_empty_list_tasks_test() {
  let ctx = test_context.get()
  use ctx <- test_database.with_rollback(ctx)

  let db_conn = context.db_conn(ctx)
  let inputs =
    [fixtures.task1, fixtures.task2]
    |> list.map(task.to_task_input)

  inputs
  |> list.each(fn(input) {
    let assert Ok(_) = repository.create_task(db_conn, input)
  })

  let response =
    simulate.request(http.Get, "/api/tasks")
    |> router.handle_request(ctx)

  assert response.status == 200

  let body = simulate.read_body(response)
  let assert Ok(tasks) = json.parse(body, decode.list(task.task_decoder()))

  assert list.map(tasks, task.to_task_input) == list.reverse(inputs)
}
```

`list.reverse(inputs)` reflects the `ORDER BY id DESC` in the `all_tasks` query — the most recently inserted task comes first.

The upsert handler is worth highlighting because it returns `201 Created` on insert and `200 OK` on update. Two tests cover each branch:

```gleam
// routes/upsert_task_test.gleam
pub fn upsert_task_creates_task_test() {
  let ctx = test_context.get()
  use ctx <- test_database.with_rollback(ctx)

  let input = task.to_task_input(fixtures.task1)
  let body = task.task_input_to_json(input)

  let response =
    simulate.request(http.Put, "/api/tasks/123456789")
    |> simulate.json_body(body)
    |> router.handle_request(ctx)

  assert response.status == 201
  let assert Ok(task) =
    json.parse(simulate.read_body(response), task.task_decoder())

  assert task.id == 123_456_789
  assert task.to_task_input(task) == input
}

pub fn upsert_task_updates_task_test() {
  let ctx = test_context.get()
  use ctx <- test_database.with_rollback(ctx)

  let db_conn = context.db_conn(ctx)
  let assert Ok(created) =
    repository.create_task(db_conn, task.to_task_input(fixtures.task1))

  let updated_input = task.to_task_input(fixtures.task2)
  let body = task.task_input_to_json(updated_input)

  let response =
    simulate.request(http.Put, "/api/tasks/" <> int.to_string(created.id))
    |> simulate.json_body(body)
    |> router.handle_request(ctx)

  assert response.status == 200
  let assert Ok(task) =
    json.parse(simulate.read_body(response), task.task_decoder())

  assert task.id == created.id
  assert task.to_task_input(task) == updated_input
}
```

The insert test uses a hardcoded high ID (`123456789`) unlikely to exist. The update test inserts first, then upserts the same ID to confirm the `200` branch.

The remaining test files — `show_task_test.gleam`, `update_task_test.gleam`, and `delete_task_test.gleam` — follow the same patterns: seed with `repository.create_task` inside `with_rollback`, dispatch a simulated request, and assert on status and body.

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

`gleeunit` discovers every function whose name ends in `_test` across all files in `test/`. Each dot represents one passing test.

## What's Next

The server is fully tested. The next step adds it to Docker Compose so the whole stack — database, migrations, and server — starts with a single `docker compose up`, making client development easier without needing to run `gleam run` separately.

[^1]: See commit [47723c9](https://github.com/lukwol/doable/commit/47723c9) on GitHub

[^2]: See commit [7c17ec1](https://github.com/lukwol/doable/commit/7c17ec1) on GitHub
