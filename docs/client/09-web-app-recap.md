# Recap — The Web App

You've reached a natural finish line. The web track is complete: a PostgreSQL database, a Gleam API server, an integration test suite, and a styled Lustre frontend — all running in production behind Caddy, all driven from a single `docker compose up`.

![Doable running in the browser](/screenshots/tasks-styled.png)

## What You've Built

```
                 ┌─────────────Docker───────────────────────┐
                 │      ┌────PostgreSQL───┐                 │
                 │      │┌───────────────┐│                 │
                 │      ││ Prod Database ││                 │
                 │      │└───▲───────────┘│                 │
                 │      └────┼────────────┘                 │
                 │┌──────────┼──Caddy──────────────────────┐│
                 ││          │           ┌────────────────┐││
                 ││┌─────────┴────────┐  │ Gleam Frontend │││
                 │││ Gleam API Server │  │  File Server   │││
                 ││└─▲────────────────┘  └─────────▲──────┘││
                 │└──┼─────────────────────────────┼───────┘│
                 └───┼─────────────────────────────┼────────┘
                     │                             │
                 ┌───┴─────────────────────────────┴───┐
                 │             Browser                 │
                 └─────────────────────────────────────┘
```

A real, deployable web app, not a toy. Here's what that actually means.

## Skills You've Picked Up

**Gleam on Erlang.** You wrote a Wisp router, threaded a supervised OTP connection pool through it, and used `gleam shell` to poke at live modules. That's not "Gleam-the-language" — that's Gleam in its natural environment.

**Gleam on JavaScript.** The same language, the same type system, a totally different runtime. You built a Lustre app with the Elm Architecture, wired it to the API with typed decoders, and shared validation logic between frontend and backend via the `shared` project.

**The infrastructure around the code.** PostgreSQL with reversible migrations. Type-safe SQL with Squirrel. Integration tests against a real database with transaction rollback between cases. Multi-stage Dockerfiles. Vite for the frontend, Caddy for production. These are the pieces that turn a prototype into something you can actually ship.

## Stop Here, or Keep Going

If you came to this guide to learn how to build a full-stack web app in Gleam — you're done. The remaining chapters are a bonus track.

The same Lustre frontend you just built can run outside the browser, too. The next four chapters wrap it in [Tauri](https://tauri.app):

- **[Desktop Setup](/client/10-desktop-setup)** — turn the Vite project into a native macOS/Windows/Linux app with no changes to the Gleam code.
- **[Desktop Additions](/client/11-desktop-additions)** — a View menu, Cmd+R reload, and platform detection.
- **[Native HTTP](/client/12-native-http)** — route API calls through Tauri's Rust backend so production desktop builds escape browser CORS.
- **[Mobile Setup](/client/13-mobile-setup)** — the same frontend on iOS and Android simulators.

Nothing in those chapters changes the web app you just shipped. If you'd rather stop and reinvest the time elsewhere, this is a good place to do it.

Either way: well done.
