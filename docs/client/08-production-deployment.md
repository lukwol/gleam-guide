# Production Deployment

The web app is feature-complete. This chapter ships it — building Docker images, pushing them to a registry, and running the full stack on a real server with a single command.

Three files are added[^1]:

```sh
doable/
├── Caddyfile            # reverse proxy configuration    [!code ++]
├── compose.prod.yml     # production compose stack       [!code ++]
└── client/
    └── Dockerfile       # client multi-stage build       [!code ++]
```

::: info Prerequisites
This chapter assumes you have a Linux server reachable over SSH. Any VPS from DigitalOcean, Hetzner, Linode, or similar works. The server needs Docker installed and ports 22 and 80 open in the firewall — on Ubuntu that's `ufw allow ssh && ufw allow 80/tcp && ufw enable`. Before deploying, SSH in and create the directory where the app will live:

```sh
ssh user@your-server
mkdir -p ~/doable
```

That's the only server-side setup required.
:::

## Client Dockerfile

The development workflow ran the client entirely from the Vite dev server — no build, no static files. Production needs the opposite: a compiled bundle served by a proper HTTP server. Caddy is an excellent fit: single binary, automatic config reload, and a clean DSL for reverse-proxying.

The build uses two stages — one for compiling the Gleam/Vite frontend, one for the Caddy image:

```dockerfile
# client/Dockerfile

ARG GLEAM_VERSION=v1.15.4

FROM --platform=${BUILDPLATFORM} ghcr.io/gleam-lang/gleam:${GLEAM_VERSION}-scratch AS gleam

FROM --platform=${BUILDPLATFORM} oven/bun:alpine AS build
COPY --from=gleam /bin/gleam /bin/gleam
WORKDIR /doable/client
COPY shared/gleam.toml /doable/shared/gleam.toml
COPY client/gleam.toml client/manifest.toml ./
RUN --mount=type=cache,target=/doable/client/build \
    gleam deps download
COPY client/package.json client/bun.lock* ./
RUN --mount=type=cache,target=/root/.bun/install/cache \
    bun install --frozen-lockfile
COPY shared/ /doable/shared/
COPY client/ ./
RUN --mount=type=cache,target=/doable/client/build \
    bun run build

FROM caddy:alpine
COPY --from=build /doable/client/dist /srv
COPY Caddyfile /etc/caddy/Caddyfile
```

The pattern mirrors the server Dockerfile: copy manifests first, download dependencies, copy source, build. The deps layer only rebuilds when `gleam.toml`, `manifest.toml`, or `package.json` change — source edits don't trigger a re-download. `bun run build` calls Vite's production build, which compiles the Gleam code and emits the bundle to `dist/`.

The final stage is a plain `caddy:alpine` image. Only the compiled `dist/` directory and the Caddyfile are copied in — no Node, no Bun, no Gleam toolchain. The result is a lean image that's just Caddy and static files.

`--platform=${BUILDPLATFORM}` tells Docker to run the build stages on the host machine's native architecture, even when targeting a different platform for deployment. The Gleam compilation and Bun build run natively — the final Caddy stage just copies the resulting files, so there's nothing to cross-compile.

## Caddyfile

Caddy handles two concerns: routing `/api/*` requests to the Gleam server, and serving the static frontend for everything else:

```
# Caddyfile

:80 {
    handle /api/* {
        reverse_proxy server:{$SERVER_PORT}
    }

    handle {
        root * /srv
        file_server
        try_files {path} /index.html
    }
}
```

API requests are forwarded to the `server` container at the port set by `$SERVER_PORT`. Everything else is served as a static file from `/srv` — the directory where the client `dist/` was copied. `try_files {path} /index.html` is the standard SPA fallback: if a path doesn't correspond to an actual file (like `/tasks/42`), Caddy returns `index.html` and lets the client-side router take over.

## Production Compose

`compose.prod.yml` defines the full production stack — database, migrations, Gleam server, and Caddy:

```yaml
# compose.prod.yml

name: doable-prod

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

  server:
    build:
      context: .
      dockerfile: server/Dockerfile
      platforms:
        - linux/amd64
    image: lukwol/doable-server:latest
    restart: unless-stopped
    environment:
      - ENV
      - SECRET_KEY_BASE
      - SERVER_HOST
      - SERVER_PORT
      - PGHOST
      - PGPORT
      - PGDATABASE
      - PGUSER
      - PGPASSWORD
    expose:
      - ${SERVER_PORT}
    depends_on:
      migrate:
        condition: service_completed_successfully

  caddy:
    build:
      context: .
      dockerfile: client/Dockerfile
    platform: linux/amd64
    image: lukwol/doable-caddy:latest
    restart: unless-stopped
    environment:
      - SERVER_PORT
    ports:
      - "80:80"
    depends_on:
      - server

volumes:
  data:
    name: doable-prod-data

networks:
  default:
    name: doable-prod-network
```

A few differences from the dev compose file stand out:

- **`image:`** — both `server` and `caddy` have an `image:` field alongside `build:`. When building, Docker tags the result with that name. When pushing, it pushes that tag to the registry. The remote server pulls images by this name — it doesn't need the source code at all.
- **`platforms: [linux/amd64]`** — production targets a `linux/amd64` server. This pins the build output regardless of what machine runs the build.
- **`expose:` vs `ports:`** — the server uses `expose:` instead of `ports:`. That makes the port available to other containers on the same Docker network, but not to the host machine. Only Caddy needs to reach the server; there's no reason to expose it publicly.
- **No `migrate-test`** — the test-only migration service has no place in production.

::: tip Tag versions in production
The `latest` tag is convenient for development but risky in production — `docker compose pull` on the server will silently replace whatever was running. In a real deployment, tag images by version or git SHA:

```yaml
image: lukwol/doable-server:1.2.0
image: lukwol/doable-server:3b7426e
```

That way every deployment is explicit and rollbacks are straightforward.
:::

## Environment

Production uses a separate `.env.prod` file that is not committed to the repository — it contains real credentials and secrets. You can create it by copying `.env` and updating the values:

```sh
cp .env .env.prod
```

Then edit `.env.prod` with production-appropriate values: a real `SECRET_KEY_BASE`, a strong database password, and `ENV=prod`. If you prefer not to maintain a separate file, you can also edit `.env` directly before building and deploying.

## Logging In

Before pushing images, authenticate with the registry. Docker Hub:

```sh
docker login
```

Enter your Docker Hub username and password when prompted. The credentials are stored locally and reused for subsequent pushes and pulls.

::: info Other registries
Docker Hub is the default, but any OCI-compatible registry works. Common alternatives include GitHub Container Registry (`ghcr.io`), Google Artifact Registry (`gcr.io`), and AWS ECR. Each has its own `docker login` command:

```sh
# GitHub Container Registry
docker login ghcr.io -u USERNAME --password-stdin <<< "$GITHUB_TOKEN"

# Google Artifact Registry
gcloud auth configure-docker us-docker.pkg.dev
```

The rest of the workflow is identical — just swap the image prefix in `compose.prod.yml`.
:::

## Building and Pushing

Build both images locally:

```sh
docker compose --env-file .env.prod -f compose.prod.yml build server caddy
```

The two builds are meaningfully different. The server has `platforms: [linux/amd64]` in `compose.prod.yml`, so Docker uses buildx to cross-compile the Erlang binary for the target architecture — even when building on an Apple Silicon Mac. The client is simpler: the build stages run natively on the host (thanks to `--platform=${BUILDPLATFORM}`) and produce platform-agnostic static files. Only the final Caddy layer needs to be `linux/amd64`, and that's just copying files into an Alpine image.

Then push both to the registry:

```sh
docker compose --env-file .env.prod -f compose.prod.yml push server caddy
```

Both images land in your registry under the names declared in `compose.prod.yml`.

## Deploying

With the images in the registry, copy the compose file, environment, and migrations to the server:

```sh
scp compose.prod.yml user@your-server:doable/compose.yml
scp .env.prod user@your-server:doable/.env
scp -r migrations user@your-server:doable/
```

The filenames are changed intentionally. On the server, `compose.yml` is Docker Compose's default filename and `.env` is its default environment file — so no flags are needed. `docker compose up` just works.

SSH in and start the stack:

```sh
ssh user@your-server
cd doable
docker compose up -d
```

Docker pulls the images from the registry, starts all services in dependency order, runs migrations, and brings the app up. Open port 80 in a browser — doable is live.

## Gleam Shell on Production

If you've ever used `rails console` in a Ruby on Rails project, this will feel familiar — a live REPL connected to the production database, great for inspecting data, running one-off queries, or seeding records without going through the API. Tools like [Kamal](https://kamal-deploy.org) make this kind of access a first-class feature; with Docker Compose it's just one `exec` away:

```sh
docker compose exec server ./entrypoint.sh shell
```

From there, `console:init()` connects to the production database and returns a connection:

```erlang
1> DbConn = console:init().

2> 'task@repository':create_task(DbConn, {task_input, "Buy groceries", "Milk and eggs", false}).
% {ok,{task,1,<<"Buy groceries">>,<<"Milk and eggs">>,false}}

3> 'task@repository':all_tasks(DbConn).
% {ok,[{task,1,<<"Buy groceries">>,<<"Milk and eggs">>,false}]}
```

This is the production database — any changes made here are real.

## Updating

When you push a new version of an image, pull it on the server before restarting:

```sh
docker compose pull
docker compose up -d
```

`docker compose pull` fetches the latest images for all services. `up -d` restarts any containers whose image has changed.

::: tip
If you're using versioned image tags (recommended), update the tag in `compose.yml` on the server before pulling — that's your explicit record of what version is deployed.
:::

## What's Next

The app runs in the browser, and now it runs in production too. The next chapter goes in a different direction — wrapping the frontend in [Tauri](https://tauri.app) to turn it into a native desktop and mobile application.

[^1]: See commit [ad86970](https://github.com/lukwol/doable/commit/ad86970) on GitHub
