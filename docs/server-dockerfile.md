# Server Dockerfile

With the server complete and tested, this chapter adds it to Docker Compose so the full backend — database, migrations, and server — starts with a single `docker compose up`. The key piece is a multi-stage Dockerfile[^1] that compiles the Gleam project into a minimal Erlang image[^2].

Two files change:

```sh
doable/
├── compose.yml          # server service added        [!code highlight]
└── server/
    └── Dockerfile       # multi-stage Erlang build    [!code ++]
```

## Dockerfile

```dockerfile
ARG ERLANG_VERSION=28.4.1.0
ARG GLEAM_VERSION=v1.15.2

FROM ghcr.io/gleam-lang/gleam:${GLEAM_VERSION}-scratch AS gleam   # stage 1: compiler

FROM erlang:${ERLANG_VERSION}-alpine AS build                     # stage 2: build
COPY --from=gleam /bin/gleam /bin/gleam
COPY shared/ /doable/shared/
WORKDIR /doable/server
COPY server/gleam.toml server/manifest.toml ./                    # copy manifests only
RUN gleam deps download                                           # cached until deps change
COPY server/ ./                                                   # copy source
RUN gleam export erlang-shipment

FROM erlang:${ERLANG_VERSION}-alpine                              # stage 3: runtime
COPY --from=build /doable/server/build/erlang-shipment /doable-server
WORKDIR /doable-server
ENTRYPOINT ["/doable-server/entrypoint.sh"]
CMD ["run"]
```

### Stage 1 — Compiler

```dockerfile
FROM ghcr.io/gleam-lang/gleam:${GLEAM_VERSION}-scratch AS gleam
```

This stage exists purely to extract the `gleam` binary from the official scratch image. Scratch images contain only the binary and nothing else — there's no shell, no package manager, no filesystem beyond the single file. By naming this stage `gleam`, the build stage can pull the binary out with `COPY --from=gleam`.

### Stage 2 — Build

```dockerfile
FROM erlang:${ERLANG_VERSION}-alpine AS build
COPY --from=gleam /bin/gleam /bin/gleam
COPY shared/ /doable/shared/
WORKDIR /doable/server
COPY server/gleam.toml server/manifest.toml ./
RUN gleam deps download
COPY server/ ./
RUN gleam export erlang-shipment
```

This is where compilation happens. The order of `COPY` and `RUN` instructions is deliberate — Docker builds each instruction as a separate cached layer. A layer is only rebuilt when its instruction or anything above it changes.

`shared/` is copied before any server files because it lives outside `server/` and the Dockerfile needs the project root as its build context (set in `compose.yml`). Copying it early means it's available when Gleam resolves the path dependency in `gleam.toml`.

The dependency download is split from the source copy intentionally:

```dockerfile
COPY server/gleam.toml server/manifest.toml ./      # ← only the manifests
RUN gleam deps download                             # ← cached layer
COPY server/ ./                                     # ← source files
RUN gleam export erlang-shipment
```

If the source were copied first and then deps downloaded, any change to any `.gleam` file would invalidate the deps layer and trigger a full re-download on every build. By copying only `gleam.toml` and `manifest.toml` first, the deps layer is only invalidated when the dependency manifest actually changes — source edits only invalidate the compilation layer below it.

`gleam export erlang-shipment` produces a self-contained directory with the compiled BEAM files and an `entrypoint.sh` script. No Gleam toolchain is needed to run it — only the Erlang runtime.

### Stage 3 — Runtime

```dockerfile
FROM erlang:${ERLANG_VERSION}-alpine
COPY --from=build /doable/server/build/erlang-shipment /doable-server
WORKDIR /doable-server
ENTRYPOINT ["/doable-server/entrypoint.sh"]
CMD ["run"]
```

The final image is a fresh Alpine with just the Erlang runtime — no Gleam compiler, no build tools, no source code. Only the compiled shipment is copied in from the build stage. `CMD ["run"]` is the argument passed to `entrypoint.sh`, which starts the OTP application.

## Docker Compose

The `server` service builds from the Dockerfile and waits for migrations to finish before starting:

```yaml
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
      TEST_DB_NAME: ${TEST_DB_NAME}
    ports:
      - ${PGPORT}:${PGPORT}
    volumes:
      - data:/var/lib/postgresql
      - ./docker/init-test-db.sh:/docker-entrypoint-initdb.d/init-test-db.sh:ro
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

  migrate-test:
    image: migrate/migrate
    volumes:
      - ./migrations:/migrations
    command: >
      -path /migrations
      -database postgres://${PGUSER}:${PGPASSWORD}@${PGHOST}:${PGPORT}/${TEST_DB_NAME}?sslmode=disable
      up
    depends_on:
      db:
        condition: service_healthy

  server: # [!code ++]
    build: # [!code ++]
      context: . # [!code ++]
      dockerfile: server/Dockerfile # [!code ++]
    restart: unless-stopped # [!code ++]
    environment: # [!code ++]
      - ENV # [!code ++]
      - SECRET_KEY_BASE # [!code ++]
      - SERVER_HOST # [!code ++]
      - SERVER_PORT # [!code ++]
      - PGHOST # [!code ++]
      - PGPORT # [!code ++]
      - PGDATABASE # [!code ++]
      - PGUSER # [!code ++]
      - PGPASSWORD # [!code ++]
    ports: # [!code ++]
      - ${SERVER_PORT}:${SERVER_PORT} # [!code ++]
    depends_on: # [!code ++]
      migrate: # [!code ++]
        condition: service_completed_successfully # [!code ++]

volumes:
  data:
    name: doable-dev-data

networks:
  default:
    name: doable-dev-network
```

A few things worth noting:

- **`context: .`** — sets the build context to the project root so the Dockerfile can access `shared/` alongside `server/`.
- **`environment`** — uses the bare variable name form (`- PGHOST`) to pass each variable through from the shell environment or `.env` file without hardcoding values in `compose.yml`.
- **`depends_on: condition: service_completed_successfully`** — the server only starts after `migrate` exits cleanly, ensuring the schema is in place before the application accepts connections.
- **`restart: unless-stopped`** — if the server crashes, Docker restarts it automatically, which is handy during client development.

## Starting the Stack

```sh
docker compose up --build
```

`--build` forces a rebuild of the server image on first run. After that, omit it for faster startup — Docker reuses the cached layers unless `gleam.toml`, `manifest.toml`, or the source files change:

```sh
docker compose up
```

The server is now reachable at `http://localhost:8000` without needing a separate terminal running `gleam run`.

## What's Next

With the full backend running from a single command, it's time to start building the client.

[^1]: Based on the [Gleam deployment guide](https://gleam.run/deployment/linux-server/) — worth a read!

[^2]: See commit [8aaa5f9](https://github.com/lukwol/doable/commit/8aaa5f907d84a51c153861eb4edd215c654631ab) on GitHub
