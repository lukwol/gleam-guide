# SQL Queries with Squirrel

With the schema in place, it's time to add Squirrel. This clever tool reads plain `.sql` files and produces type-safe Gleam functions — the SQL stays as SQL, Squirrel just generates the wrappers.

Five SQL files and a generated Gleam module:

```sh
doable/
└── server/
    └── src/
        └── task/
            ├── sql/
            │   ├── all_tasks.sql       # fetch all tasks ordered by id desc    [!code ++]
            │   ├── get_task.sql        # fetch a single task by id             [!code ++]
            │   ├── create_task.sql     # insert a new task                     [!code ++]
            │   ├── update_task.sql     # update an existing task               [!code ++]
            │   └── delete_task.sql     # delete a task by id                   [!code ++]
            └── sql.gleam               # generated type-safe query functions   [!code ++]
```

## Install Dependencies

We need three new packages[^1]:

```sh
cd server
gleam add pog gleam_time
gleam add --dev squirrel
```

- **pog** — a great Postgres driver; `pog.Connection` is what we'll pass to every query. It's a transitive dependency pulled in by Squirrel, declared explicitly to avoid a compiler warning.
- **gleam_time** — provides the `Timestamp` type that pog uses for `TIMESTAMP` columns. Also a transitive dependency, declared explicitly because we import it in the generated **sql.gleam**.
- **squirrel** — a dev-only code generator, not a runtime dependency.

After running the commands, `gleam.toml` gains three new entries:

```toml
# server/gleam.toml

[dependencies]
shared = { path = "../shared" }
gleam_stdlib = ">= 0.44.0 and < 2.0.0"
gleam_http = ">= 4.3.0 and < 5.0.0"
gleam_erlang = ">= 1.3.0 and < 2.0.0"
wisp = ">= 2.2.1 and < 3.0.0"
mist = ">= 5.0.4 and < 6.0.0"
pog = ">= 4.1.0 and < 5.0.0"            # [!code ++]
gleam_time = ">= 1.8.0 and < 2.0.0"     # [!code ++]

[dev_dependencies]
gleeunit = ">= 1.0.0 and < 2.0.0"
squirrel = ">= 4.6.0 and < 5.0.0"       # [!code ++]
```

## Install direnv

[direnv](https://direnv.net) loads environment variables from a `.envrc` file whenever you enter a directory, and unloads them when you leave — perfect for overriding a single variable locally without touching the shared `.env`.

::: code-group

```sh [macOS]
brew install direnv
```

```sh [Linux]
sudo apt install direnv      # Debian/Ubuntu
sudo dnf install direnv      # Fedora
```

```sh [Windows]
scoop install direnv
```

:::

direnv needs a one-line hook in your shell's startup file to activate:

::: code-group

```sh [zsh (~/.zshrc)]
eval "$(direnv hook zsh)"
```

```sh [bash (~/.bashrc)]
eval "$(direnv hook bash)"
```

```sh [fish (~/.config/fish/config.fish)]
direnv hook fish | source
```

:::

Open a new shell after adding the hook. The [official hook docs](https://direnv.net/docs/hook.html) cover other shells.

## Configure Database Access

Squirrel connects to the database at code-generation time to validate queries and infer types — which is why we set the libpq environment variables in `.env` from the start.

There's a catch: `.env` sets `PGHOST=db`, which is the hostname of the Postgres container inside the Docker network. That name doesn't resolve on the host machine. When running `gleam run -m squirrel` locally, we need `PGHOST=localhost` instead.

Create `server/.envrc` to handle this. The file sits alongside `gleam.toml` in the `server/` directory:

```sh
doable/
└── server/
    └── .envrc    # [!code ++]
```

Content of `.envrc`:

```sh
# server/.envrc

dotenv ../.env

export PGHOST=localhost
```

Run `direnv allow` once to permit [direnv](https://direnv.net) to load it. After that, direnv loads `.envrc` automatically whenever you enter the directory — first pulling in the root `.env` via `dotenv`, then overriding `PGHOST` with `localhost`, so Squirrel can reach the database through the mapped port without touching the shared `.env` file used by `compose.yml`.

::: warning Don't forget `direnv allow`
Without it, `.envrc` is silently ignored and Squirrel will fail to connect with a confusing `PGHOST=db` error — `db` only resolves inside the Docker network, not from your host. If you hit connection errors, re-run `direnv allow` in `server/` first.
:::

## SQL Queries

Squirrel looks for `.sql` files under `src/` and generates a corresponding `.gleam` module next to each directory of queries. Create the query files in `server/src/task/sql/`:

**`all_tasks.sql`**

```sql
-- server/src/task/sql/all_tasks.sql

SELECT
  id,
  name,
  description,
  completed,
  created_at,
  updated_at
FROM tasks
ORDER BY created_at DESC, id DESC
```

**`get_task.sql`**

```sql
-- server/src/task/sql/get_task.sql

SELECT
  id,
  name,
  description,
  completed,
  created_at,
  updated_at
FROM tasks
WHERE id = $1
```

**`create_task.sql`**

```sql
-- server/src/task/sql/create_task.sql

INSERT INTO tasks (name, description, completed)
VALUES ($1, $2, $3)
RETURNING
  id,
  name,
  description,
  completed,
  created_at,
  updated_at
```

**`update_task.sql`**

```sql
-- server/src/task/sql/update_task.sql

UPDATE tasks
SET
  name = $2,
  description = $3,
  completed = $4,
  updated_at = NOW()
WHERE id = $1
RETURNING
  id,
  name,
  description,
  completed,
  created_at,
  updated_at
```

**`delete_task.sql`**

```sql
-- server/src/task/sql/delete_task.sql

DELETE FROM tasks
WHERE id = $1
```

A few things worth noting:

- `$1`, `$2`, ... — PostgreSQL's positional parameter syntax. Squirrel maps these to typed function arguments in the generated code.
- `RETURNING` — tells Postgres to return the affected row. Squirrel uses the returned columns to generate the result type.

## Generate the Gleam Module

With the database running and `.envrc` loaded, run Squirrel:

```sh
docker compose up -d
cd server
gleam run -m squirrel
```

Squirrel connects to the database, validates each query against the live schema, and generates `src/task/sql.gleam`. For each `.sql` file it produces a result row type and a query function. Here's what it generates for `all_tasks`:

```gleam
// server/src/task/sql.gleam

pub type AllTasksRow {
  AllTasksRow(
    id: Int,
    name: String,
    description: String,
    completed: Bool,
    created_at: Timestamp,
    updated_at: Timestamp,
  )
}

pub fn all_tasks(
  db: pog.Connection,
) -> Result(pog.Returned(AllTasksRow), pog.QueryError) {
  // ...
}
```

The column types come directly from the schema — Squirrel infers them by querying Postgres, not by parsing the SQL itself. If a query references a column that doesn't exist or uses the wrong type, generation fails rather than producing code that would blow up at runtime.

::: warning
`sql.gleam` is a generated file — do not edit it by hand. Re-running `gleam run -m squirrel` will overwrite any changes.
:::

## What's Next

Squirrel gave us typed query functions — but they need a live `pog.Connection` to run against. Next, we'll load server config from `.env`, start a supervised connection pool, and thread it through the router so handlers can reach the database.

[^1]: See commit [f2efd4d](https://github.com/lukwol/doable/commit/f2efd4d) on GitHub
