# Database Setup

With the server routing in place, we need a PostgreSQL database to back it. We'll run Postgres locally using Docker Compose and keep the connection credentials in a `.env` file.

Two new files at the project root:

```sh
doable/
├── .env          # database credentials       [!code ++]
└── compose.yml   # runs Postgres in Docker    [!code ++]
```

## Environment Variables

Create a `.env` file at the project root to hold the database credentials:

```sh
# .env

# Database
PGHOST=db
PGPORT=5432
PGDATABASE=doable-dev
PGUSER=doable-user-dev
PGPASSWORD=doable-dev-p@ssw0rd
```

The variable names follow the [standard libpq environment variables](https://www.postgresql.org/docs/current/libpq-envars.html), which Postgres clients pick up automatically — including Squirrel, the Gleam package we'll use later to query the database.

::: danger
Never commit `.env` to version control. For this guide I did it intentionally — the credentials are for a local dev database only and keeping the file in the repo simplifies following along.
:::

## Docker Compose

Create `compose.yml` at the project root[^1]:

```yaml
# compose.yml

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

volumes:
  data:
    name: doable-dev-data

networks:
  default:
    name: doable-dev-network
```

A few things worth noting:

- `image: postgres:18-alpine` — the Alpine variant keeps the image small.
- `shm_size: 128mb` — Postgres uses shared memory for internal buffers; the Docker defaults to 64 MB but I followed the recommended settings in [official Postgres image docs](https://hub.docker.com/_/postgres).
- `restart: unless-stopped` — the container restarts automatically after a machine reboot, unless you explicitly stop it.
- `${PGPORT}:${PGPORT}` — Docker Compose reads `.env` automatically, so the port mapping uses the same variable as the app.
- Named volume `doable-dev-data` — data persists across container restarts and rebuilds.
- Named network `doable-dev-network` — an explicit name makes it easier to connect other services later.

## Starting the Database

```sh
docker compose up -d
```

The `-d` flag runs the containers in the background. On first run Docker will pull the Postgres image, which may take a moment.

To verify the container is healthy:

```sh
docker compose ps
```

You should see `db` listed with status `running`.

## Verifying the Database

Connect to the running container with `psql` to confirm the database was created and is accepting connections:

```sh
docker compose exec db psql -U doable-user-dev -d doable-dev
```

If everything is working you'll land in the `psql` prompt:

```
psql (18.x)
Type "help" for help.

doable-dev=#
```

Once inside, run `\l` to list databases and confirm `doable-dev` is present. Then run a quick query to confirm the database is accepting connections:

```sql
SELECT 1;
```

You should see:

```
 ?column?
----------
        1
(1 row)
```

Type `\q` to exit.

::: tip
Since the port is mapped to your host, you can also connect directly from your machine without going through Docker:

```sh
psql -h localhost -p 5432 -U doable-user-dev -d doable-dev
```

The same credentials work in any GUI client — [DBeaver](https://dbeaver.io), [DataGrip](https://www.jetbrains.com/datagrip/), or similar — using `localhost:5432`.
:::

## What's Next

With the database running, the next step is creating the schema. We'll write a migration using the `migrate` service to set up the tasks table.

[^1]: See commit [2f9bf51](https://github.com/lukwol/doable/commit/2f9bf51d4647c032e551686a9bb3e0f7cd1176ad) on GitHub
