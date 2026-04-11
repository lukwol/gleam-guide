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
# server/Dockerfile

ARG ERLANG_VERSION=28.4.1.0
ARG GLEAM_VERSION=v1.15.2

FROM ghcr.io/gleam-lang/gleam:${GLEAM_VERSION}-scratch AS gleam   # stage 1: compiler

FROM erlang:${ERLANG_VERSION}-alpine AS build                     # stage 2: build
COPY --from=gleam /bin/gleam /bin/gleam
WORKDIR /doable/server
COPY shared/gleam.toml /doable/shared/gleam.toml                  # shared config
COPY server/gleam.toml server/manifest.toml ./                    # server config and manifests
RUN gleam deps download                                           # cached until deps change
COPY shared/ /doable/shared/                                      # full shared source
COPY server/ ./                                                   # server source
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
WORKDIR /doable/server
COPY shared/gleam.toml /doable/shared/gleam.toml
COPY server/gleam.toml server/manifest.toml ./
RUN gleam deps download
COPY shared/ /doable/shared/
COPY server/ ./
RUN gleam export erlang-shipment
```

This is where compilation happens. The order of `COPY` and `RUN` instructions is deliberate — Docker builds each instruction as a separate cached layer. A layer is only rebuilt when its instruction or anything above it changes.

The dependency download is split from the source copy intentionally:

```dockerfile
COPY shared/gleam.toml /doable/shared/gleam.toml    # ← shared config
COPY server/gleam.toml server/manifest.toml ./      # ← server config and lock file
RUN gleam deps download                             # ← cached layer
COPY shared/ /doable/shared/                        # ← full shared source
COPY server/ ./                                     # ← server source
RUN gleam export erlang-shipment
```

`server` declares a path dependency on `shared` in `gleam.toml`, so Gleam needs `shared/gleam.toml` to exist before it can resolve the dependency graph and download packages. The config and lock files are all that's needed at this stage — source isn't required until compilation. Copying them separately keeps the two concerns distinct: config and lock files invalidate the deps layer, source files invalidate the compilation layer.

If the source were copied before deps were downloaded, any change to any `.gleam` file would invalidate the deps layer and trigger a full re-download on every build. With this layout, the deps layer is only rebuilt when `gleam.toml` or `manifest.toml` actually changes.

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

With both the Dockerfile and Compose service in place, the entire stack starts with a single command:

```sh
docker compose up
```

:::: tip
To force a rebuild of the server image, use:

```sh
docker compose up --build
```

::::

The server is now reachable at `http://localhost:8000` without needing a separate terminal running `gleam run`.

:::: info
To run the server locally with `gleam run` instead, stop the `server` service first so it doesn't conflict:

```sh
docker compose stop server
```

::::

## What's Next

With the full backend running from a single command, it's time to start building the client.

[^1]: Based on the awesome [Gleam deployment guide](https://gleam.run/deployment/linux-server/)

[^2]: See commit [c0e0ac0](https://github.com/lukwol/doable/commit/c0e0ac0) on GitHub
