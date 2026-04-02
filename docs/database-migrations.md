# Database Migrations

With the database running, we need to create the schema. We'll manage migrations using [golang-migrate](https://github.com/golang-migrate/migrate), running it as a Docker Compose service so it starts automatically and only runs after the database is ready.

## Migration Files

Create a `migrations/` directory at the project root and add the first migration:

**`migrations/000001_create_tasks.up.sql`**

```sql
CREATE TABLE tasks (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR NOT NULL,
  description TEXT NOT NULL,
  completed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
```

**`migrations/000001_create_tasks.down.sql`**

```sql
DROP TABLE tasks;
```

Each migration is a pair of files — `.up.sql` to apply the change and `.down.sql` to roll it back. The numeric prefix determines the order migrations run in.

## Updating Docker Compose

The `migrate` service needs to wait until Postgres is actually ready to accept connections — not just started. Add a healthcheck to the `db` service and a new `migrate` service to `compose.yml`[^1]:

```yaml{17-33}
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
    ports:
      - ${PGPORT}:${PGPORT}
    volumes:
      - data:/var/lib/postgresql
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

volumes:
  data:
    name: doable-dev-data

networks:
  default:
    name: doable-dev-network
```

A few things worth noting:

- **`pg_isready`** — the healthcheck uses the Postgres built-in utility to probe the TCP port and verify the server is accepting connections.
- **`depends_on: condition: service_healthy`** — makes `migrate` wait until the `db` healthcheck passes, not just until the container is running.
- **`migrate/migrate`** — the official Docker image for golang-migrate; no installation needed.
- **`./migrations:/migrations`** — mounts the local migrations directory into the container so the tool can find the SQL files.
- **`sslmode=disable`** — local dev doesn't use TLS; this tells the Postgres driver not to require it.

## Running Migrations

Restart Docker Compose to pick up the changes:

```sh
docker compose up -d
```

The `migrate` service will run, apply `000001_create_tasks.up.sql`, and exit. You can check its output with:

```sh
docker compose logs migrate
```

On the first run you should see each migration logged:

```
migrate  | 1/u create_tasks (Xms)
```

On subsequent runs, when all migrations are already applied, you'll see:

```
migrate  | no change
```

The `migrate` service is not configured with `restart: unless-stopped`, so it runs once and stops; `docker compose up` will start it again, but reruns are safe.

## Verifying the Schema

Connect to the database:

```sh
docker compose exec db psql -U doable-user-dev -d doable-dev
```

Insert a task, mark it as completed, then delete it:

```sql
INSERT INTO tasks (name, description)
VALUES ('Buy groceries', 'Milk, eggs, bread')
RETURNING *;
```

```
 id |     name      |    description    | completed |         created_at         |         updated_at
----+---------------+-------------------+-----------+----------------------------+----------------------------
  1 | Buy groceries | Milk, eggs, bread | f         | 2026-04-02 10:00:00.000000 | 2026-04-02 10:00:00.000000
(1 row)
```

```sql
UPDATE tasks SET completed = TRUE WHERE id = 1 RETURNING *;
```

```
 id |     name      |    description    | completed |         created_at         |         updated_at
----+---------------+-------------------+-----------+----------------------------+----------------------------
  1 | Buy groceries | Milk, eggs, bread | t         | 2026-04-02 10:00:00.000000 | 2026-04-02 10:00:00.000000
(1 row)
```

```sql
DELETE FROM tasks WHERE id = 1;
```

```
DELETE 1
```

Type `\q` to exit.

## What's Next

With the schema in place, the next step is writing the SQL queries. We'll use Squirrel to generate type-safe Gleam functions directly from plain `.sql` files.

[^1]: See commit [a0c44fc](https://github.com/lukwol/doable/commit/a0c44fca5133aba55bfd2c0f6c02f23e8f38424d) on GitHub
