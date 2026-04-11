# Getting Started

## Creating Projects

The application is made up of three Gleam projects living side by side in the same repository:

- **server** — the HTTP backend, compiled to Erlang
- **client** — the frontend, compiled to JavaScript
- **shared** — code shared between the two (types, validation logic, etc.)

Start by creating a directory for the app:

```sh
mkdir doable && cd doable
```

Then create the three projects inside it:

```sh
gleam new server --skip-github
gleam new client --skip-github --template javascript
gleam new shared --skip-github
```

The `--skip-github` flag skips generating GitHub Actions workflows, keeping things simple for now. The `--template javascript` flag sets `client`'s compile target to JavaScript; `server` and `shared` default to Erlang.

Both `server` and `client` depend on `shared` via a local path reference. Add the following to their `gleam.toml`[^1]:

```toml
# gleam.toml

[dependencies]
shared = { path = "../shared" }	        # [!code ++]
gleam_stdlib = ">= 0.44.0 and < 2.0.0"
```

[^1]: See commit [46bd4ae](https://github.com/lukwol/doable/commit/46bd4ae5912781600b93d5ab3bae25de32a4d46d) on GitHub

## Project Structure

The repository layout looks like this:

```sh
doable/
├── server/
│   ├── src/server.gleam
│   ├── gleam.toml
│   └── ...
├── client/
│   ├── src/client.gleam
│   ├── gleam.toml
│   └── ...
└── shared/
    ├── src/shared.gleam
    ├── gleam.toml
    └── ...
```

The dependency relationship between projects is straightforward:

```
server ──┐
         ├──▶ shared
client ──┘
```

Each project contains a minimal `main` function and a test suite using [gleeunit](https://github.com/lpil/gleeunit). To run or test any project:

```sh
cd server   # or client/shared
gleam run   # prints: Hello from server/client/shared!
gleam test  # prints: 1 passed, no failures
```

## What's Next

With the project scaffold in place, we'll start building the backend. The next chapter covers setting up the HTTP server, defining routes, and wiring everything together with Wisp and Mist.
