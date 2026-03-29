# Introduction

Welcome to The Gleam Guide. We'll build a full-stack task manager from scratch — a JSON HTTP API compiled to [Erlang](https://www.erlang.org), a browser frontend compiled to [JavaScript](https://developer.mozilla.org/en-US/docs/Web/JavaScript), and a mobile app for [iOS](https://developer.apple.com/ios/) and [Android](https://developer.android.com) using [Tauri](https://tauri.app). All three share types and validation logic written once in [Gleam](https://gleam.run).

## What We're Building

The app lets users create, view, update, and delete tasks. Simple on the surface, but it gives us enough surface area to cover the full stack: database persistence, HTTP routing, frontend state management, and cross-platform packaging.

The finished product consists of:

- **API** — a JSON HTTP backend compiled to Erlang, talking to [PostgreSQL](https://www.postgresql.org) database
- **Web** — runs in any browser, served by the Gleam backend
- **Desktop** — packaged as a native app via Tauri
- **Mobile** — deployed to iOS and Android via Tauri

All three frontends share the same Gleam codebase. We'll use Tauri to wrap the compiled JavaScript output and provide native capabilities (HTTP, haptics, etc.) where needed.

## Architecture

### Backend

The server is a straightforward HTTP API built with [Wisp](https://hexdocs.pm/wisp/) and [Mist](https://hexdocs.pm/mist/), backed by PostgreSQL. It exposes a REST API for task resources and shares type definitions with the client via the `shared` project — a multi-target Gleam library that compiles to both Erlang and JavaScript, embracing code reusability between the backend and frontend.

While building the backend we'll run the server locally with `gleam run`, connecting to a PostgreSQL container managed by [Docker Compose](https://docs.docker.com/compose/). Once we move to the frontend, we'll use `docker compose up` to bring up the full backend without managing the server service manually. We'll use the same approach for production, with a separate Compose configuration and environment.

### Frontend

The frontend follows the **[Elm Architecture](https://guide.elm-lang.org/architecture/)**, implemented via [Lustre](https://hexdocs.pm/lustre/) — Gleam's Elm-inspired UI framework. Every page is modelled as:

- **Model** — the page's state
- **Msg** — all events that can change that state
- **update** — a pure function that produces a new model (and optional effects) from a message
- **view** — a pure function that renders the model as HTML

This makes data flow explicit and unidirectional: user interactions dispatch messages, messages drive state transitions, state drives the view. No hidden side effects, no two-way binding.

```
User interaction
      │
      ▼
   Message
      │
      ▼
   update(model, msg) ──▶ new Model ──▶ view(model) ──▶ HTML
      │
      ▼
   Effect (HTTP request, navigation, …)
```

## Who is this guide for

This guide is for developers who:

- Are comfortable with Gleam syntax and core concepts (if not, work through the [official tour](https://tour.gleam.run) first)
- Want to build a real backend, frontend, or mobile app in Gleam, not just toy examples
- Are new to the Gleam ecosystem and want to see how the pieces fit together

No prior experience with Erlang/OTP, frontend frameworks, or Tauri is required. We'll introduce relevant concepts as they come up.

## Prerequisites

Before starting, make sure you have the following installed:

- [Gleam](https://gleam.run/getting-started/installing/) — the language compiler and build tool
- [Erlang](https://www.erlang.org/downloads) — required to run and test the backend locally
- [Docker](https://docs.docker.com/get-started/get-docker/) — for running the PostgreSQL database locally
- [Rust](https://www.rust-lang.org/tools/install) — required by Tauri
- [Bun](https://bun.sh) — JavaScript package manager and runtime used in this guide (npm, pnpm, or yarn work too)
- [Xcode](https://developer.apple.com/xcode/) — required for iOS builds (macOS only); also install [Cocoapods](https://cocoapods.org) via Homebrew and follow [Tauri's iOS setup guide](https://tauri.app/start/prerequisites/#ios)
- [Android Studio](https://developer.android.com/studio) — required for Android builds; follow [Tauri's Android setup guide](https://tauri.app/start/prerequisites/#android) to configure the NDK and environment variables
- [direnv](https://direnv.net) — automatically loads environment variables from `.envrc` files when entering a subproject directory; used to override database connection settings so `gleam run` in the `server/` directory connects to the PostgreSQL container exposed via Docker's port mapping
- [curl](https://curl.se) — command-line HTTP client used to verify API routes; any HTTP client (Postman, HTTPie, Restfox, etc.) works fine

## How to Use This Guide

The chapters are meant to be read in order — each one builds on the code from the previous. You don't need to type everything from scratch: the complete source is available at [github.com/lukwol/doable](https://github.com/lukwol/doable).

Throughout the guide, footnotes link to the specific commit where each change is introduced, so you can always diff against the reference if something isn't working.

The reference repository intentionally commits a `.env` file containing development credentials so you can clone and run it without any manual setup. In a real project, `.env` files should be added to `.gitignore` and never committed.
