# Introduction

## What We're Building

Welcome to The Gleam Guide. We'll build **Doable**[^1] — a full-stack task manager — from scratch: a JSON HTTP API compiled to [Erlang](https://www.erlang.org), a browser frontend compiled to [JavaScript](https://developer.mozilla.org/en-US/docs/Web/JavaScript), and desktop and mobile apps for [iOS](https://developer.apple.com/ios/) and [Android](https://developer.android.com) using [Tauri](https://tauri.app). All four share types and validation logic written once in [Gleam](https://gleam.run).

Doable lets users create, view, update, and delete tasks. Simple on the surface, but it gives us enough surface area to cover the full stack: database persistence, HTTP routing, frontend state management, and cross-platform packaging. The finished product consists of:

- **API Server** — a JSON HTTP backend compiled to [Erlang](https://www.erlang.org) using [PostgreSQL](https://www.postgresql.org) database
- **Web App** — runs in any browser, served by the Gleam backend
- **Desktop App** — packaged as a native app via [Tauri](https://tauri.app)
- **Mobile Apps** — deployed to [iOS](https://developer.apple.com/ios/) and [Android](https://developer.android.com) via Tauri

## Architecture

### Production

In production, everything runs inside Docker. [Caddy](https://caddyserver.com) is the single entry point — it serves the compiled web app as static files for the browser and proxies API requests to the backend for all clients. The desktop and mobile apps embed the same static bundle via Tauri and use Tauri's HTTP plugin to send requests to Caddy.

```
                      ┌─────────Docker─────────┐
                      │  ┌─────PostgreSQL────┐ │
                      │  │ ┌───────────────┐ │ │
                      │  │ │ Prod Database │ │ │
                      │  │ └───────▲───────┘ │ │
                      │  └─────────┼─────────┘ │
                      │            │           │
                      │     ┌──────┴─────┐     │
                      │     │ API Server │     │
                      │     └────────▲───┘     │
                      │              │         │
                      │ ┌────Caddy───┼───────┐ │
                      │ │ ┌──────────┴─────┐ │ │
                      │ │ │    Web App     │ │ │
                      │ │ │ (static files) │ │ │
                      │ │ └────────────────┘ │ │
                      │ └─────▲───▲───▲──────┘ │
                      └───────┼───┼───┼────────┘
                              │   │   │
           ┌──────────────────┘   │   └──────────────────┐
           │                      │                      │
           │                      │                      │
┌──────────┴─────────┐   ┌────────┴───────────┐     ┌────┴────┐
│     Desktop App    │   │     Mobile App     │     │ Browser │
│ ┌────────────────┐ │   │ ┌────────────────┐ │     └─────────┘
│ │    Web App     │ │   │ │    Web App     │ │
│ │ (static files) │ │   │ │ (static files) │ │
│ └────────────────┘ │   │ └────────────────┘ │
└────────────────────┘   └────────────────────┘
```

### Development

In development, the database and API server run in Docker via `docker compose up`. The database is a single PostgreSQL container with two databases inside: one for development and one for integration tests. All three clients load the frontend from [Vite](https://vite.dev)'s dev server for hot reload. The browser also sends API requests through Vite's proxy to avoid CORS issues, while desktop and mobile apps use Tauri's HTTP plugin to call the API server directly. Integration tests also call the server directly, using the dedicated test database.

```
        ┌──────────────────────Docker─────────────────────┐
        │       ┌─────────────PostgreSQL───────────────┐  │
        │       │ ┌──────────────┐   ┌───────────────┐ │  │
        │       │ │ Dev Database │   │ Test Database │ │  │
        │       │ └──────▲───────┘   └─────────────▲─┘ │  │
        │       └────────┼─────────────────────────┼───┘  │
        │  ┌─────────────┴─────────────┐           │      │
        │  │        API Server         │           │      │
        │  └───▲─────────▲────────▲────┘           │      │
        └──────┼─────────┼────────┼────────────────┼──────┘
      ┌────────┘         │        └─────┐          │
      │      ┌───────────┴──────────┐   │          │
      │      │    Vite Dev Server   │   │          │
      │      │      (with proxy)    │   │          │
      │      └─────▲─────▲─────▲────┘   │          │
      │            │     │     │        │          │
      │   ┌────────┘     │     └─────┐  │          │
      │   │              │           │  │          │
┌─────┴───┴────┐  ┌──────┴──┐  ┌─────┴──┴───┐   ┌──┴────────────────┐
│ Desktop App  │  │ Browser │  │ Mobile App │   │ Integration Tests │
└──────────────┘  └─────────┘  └────────────┘   └───────────────────┘
```

### Backend

The server is a straightforward HTTP API built with [Wisp](https://hexdocs.pm/wisp/) and [Mist](https://hexdocs.pm/mist/), backed by PostgreSQL. It exposes a REST API for task resources and shares type definitions with the frontends via the `shared` project — a multi-target Gleam library that compiles to both Erlang and JavaScript.

### Frontend

The frontend follows the **[Elm Architecture](https://guide.elm-lang.org/architecture/)**, implemented via [Lustre](https://hexdocs.pm/lustre/) — Gleam's Elm-inspired UI framework. Every page is modelled as:

- **Model** — the page's state
- **Msg** — all events that can change that state
- **update** — a pure function that produces a new model (and optional effects) from a message
- **view** — a pure function that renders the model as HTML

This makes data flow explicit and unidirectional: user interactions dispatch messages, messages drive state transitions, state drives the view. No hidden side effects, no two-way binding.

```
 ┌───▶ User interaction
 │           │
 │           ▼
 │        Message ◀──────────────────┐
 │           │                       │
 │           ▼                       │
 │   update(model, msg) ──▶ Effect   │
 │           │               │       │
 │           ▼               ▼       │
 │        new Model     Effect runs  │
 │           │          (HTTP, …)    │
 │           ▼               │       │
 │      view(model)          └───────┘
 │           │
 │           ▼
 └──────────HTML
```

## Who is this guide for

This guide is for developers who:

- Are comfortable with Gleam syntax and core concepts (if not, walk through the [official tour](https://tour.gleam.run) first)
- Want to build a real full-stack app in Gleam and understand how the pieces fit together
- Are new to the Gleam ecosystem and want to see how it all connects — from the database to the UI
- Are curious about Docker, Lustre, Wisp, or Tauri in a Gleam context

No prior experience with Docker, Erlang/OTP, frontend frameworks, or Tauri is required. We'll introduce relevant concepts as they come up.

## Prerequisites

Before starting, make sure you have the following installed:

- [Gleam](https://gleam.run/getting-started/installing/) — the language compiler and build tool
- [Erlang](https://www.erlang.org/downloads) — required to run and test the backend locally
- [Bun](https://bun.sh) — JavaScript package manager and runtime used in this guide (npm, pnpm, or yarn work too)
- [Docker](https://docs.docker.com/get-started/get-docker/) — for orchestrating services locally and for production deployment
- [direnv](https://direnv.net) — automatically loads `.envrc` files in projects, which load environment variables
- [Rust](https://www.rust-lang.org/tools/install) — required by Tauri
- [Xcode](https://developer.apple.com/xcode/) — required for iOS builds (macOS only); also install [Cocoapods](https://cocoapods.org) via Homebrew and follow [Tauri's iOS setup guide](https://tauri.app/start/prerequisites/#ios)
- [Android Studio](https://developer.android.com/studio) — required for Android builds; follow [Tauri's Android setup guide](https://tauri.app/start/prerequisites/#android) to configure the NDK and environment variables

## How to Use This Guide

The chapters are meant to be read in order — each one builds on the code from the previous. You don't need to type everything from scratch: the complete source is available at [github.com/lukwol/doable](https://github.com/lukwol/doable).

Throughout the guide, footnotes link to the specific commit where each change is introduced, so you can always diff against the reference if something isn't working.

[^1]: The name is inspired by fantastic [Rails New tutorial by Typecraft](https://www.youtube.com/watch?v=oEDkhfsFMTg&list=PLHFP2OPUpCeZcPutT9yn4-e0bMmrn5Gd1).
