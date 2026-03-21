# Introduction

In this guide, you'll build a simple full-stack task manager — an HTTP API in Gleam running on Erlang, paired with a frontend compiled to JavaScript.

This guide assumes you have Gleam installed and are familiar with the basics of the language. If you're new to Gleam, check out the [official tour](https://tour.gleam.run) before continuing.

## Creating Projects

The application is made up of three Gleam projects living side by side in the same repository:

- **server** — the HTTP backend, compiled to Erlang
- **client** — the frontend, compiled to JavaScript
- **shared** — code shared between the two (types, validation logic, etc.)

Create them with:

```sh
gleam new server --skip-github
gleam new client --skip-github --template javascript
gleam new shared --skip-github
```

The `--skip-github` flag skips generating GitHub Actions workflows, keeping things simple for now. The `--template javascript` flag sets `client`'s compile target to JavaScript; `server` and `shared` default to Erlang.

Both `server` and `client` depend on `shared` via a local path reference. Add the following to their `gleam.toml`[^1]:

```toml
[dependencies]
shared = { path = "../shared" } # [!code ++]
gleam_stdlib = ">= 0.44.0 and < 2.0.0"
```

[^1]: See commit [46bd4ae](https://github.com/lukwol/gleam-app/commit/46bd4ae5912781600b93d5ab3bae25de32a4d46d) on GitHub

## Project Structure

The repository layout looks like this:

```
gleam-app/
├── server/
│   ├── gleam.toml
│   └── src/server.gleam
├── client/
│   ├── gleam.toml
│   └── src/client.gleam
└── shared/
    ├── gleam.toml
    └── src/shared.gleam
```

The dependency relationship between projects is straightforward:

```
server ──┐
         ├──▶ shared
client ──┘
```

Each project contains a minimal `main` function and a test suite using [gleeunit](https://github.com/lpil/gleeunit). To run or test any project:

```sh
cd server   # or client / shared
gleam run
gleam test
```
