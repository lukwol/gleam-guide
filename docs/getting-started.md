# Getting Started

## Install Gleam

Gleam compiles to Erlang by default, so both the Gleam compiler and Erlang need to be installed. Gleam's installer does not bundle Erlang — install it first.

::: code-group

```sh [macOS]
brew install erlang gleam
```

```sh [Linux]
# Erlang — use your distribution's package manager
sudo apt install erlang      # Debian/Ubuntu
sudo dnf install erlang      # Fedora

# Gleam — download the precompiled binary for your architecture from
# https://github.com/gleam-lang/gleam/releases and move it onto your PATH
```

```sh [Windows]
scoop install erlang gleam
```

:::

The [official install guide](https://gleam.run/getting-started/installing/) covers more options. Verify the toolchain with:

```sh
gleam --version
erl -version
```

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
gleam new server --skip-github --skip-git
gleam new client --skip-github --skip-git --template javascript
gleam new shared --skip-github --skip-git
```

The `--skip-github` flag skips generating GitHub Actions workflows and `--skip-git` skips initialising a git repository, keeping things simple for now. The `--template javascript` flag sets `client`'s compile target to JavaScript; `server` and `shared` default to Erlang.

Both `server` and `client` depend on `shared` via a local path reference. Add the following to their `gleam.toml`[^1]:

```toml
# gleam.toml

[dependencies]
shared = { path = "../shared" }	        # [!code ++]
gleam_stdlib = ">= 0.44.0 and < 2.0.0"
```

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

Three empty projects compile and say hello — now it's time to make one of them do something useful. Next, we'll turn `server` into an HTTP API with Wisp and Mist, routing `/api/tasks` requests to five stub handlers.

[^1]: See commit [46bd4ae](https://github.com/lukwol/doable/commit/46bd4ae) on GitHub
