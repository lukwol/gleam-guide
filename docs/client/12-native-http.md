# Native HTTP

Running the app with `bun tauri dev` works fine — the Vite dev server is running and proxies `/api` requests, so there's no CORS issue. But `bun tauri build` produces a standalone desktop app with no dev server and no proxy. The webview loads static files directly from disk, so requests to `http://localhost:8000` run into CORS restrictions and fail.

Tauri's HTTP plugin solves this by routing requests through the Rust backend, which isn't subject to browser CORS policy. The webview calls the plugin instead of `fetch`, and Rust makes the actual HTTP request.

Five files change, two are new[^1]:

```sh
doable/
└── client/
    ├── package.json                    # @tauri-apps/plugin-http added        [!code highlight]
    ├── src-tauri/
    │   ├── Cargo.toml                  # tauri-plugin-http added              [!code highlight]
    │   ├── capabilities/
    │   │   └── default.json            # http permission + url allowlist      [!code highlight]
    │   ├── src/
    │   │   └── lib.rs                  # http plugin registered               [!code highlight]
    │   └── tauri.conf.json             # app identifier updated               [!code highlight]
    └── src/
        ├── api.gleam                   # platform-aware base URL + send       [!code highlight]
        └── tauri/
            ├── http.gleam              # raw_send external                    [!code ++]
            └── http_ffi.js             # fetch bridge                         [!code ++]
```

## Installing the Plugin

```sh
cd client
bun tauri add http
```

The CLI adds `tauri-plugin-http` to `Cargo.toml`, `@tauri-apps/plugin-http` to `package.json`, registers the plugin in `lib.rs`, and updates `capabilities/default.json`. Unlike `os:default`, the HTTP permission requires an explicit URL allowlist — requests to unlisted URLs are blocked:

```json
// client/src-tauri/capabilities/default.json

{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "enables the default permissions",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "os:default",
    {                                    // [!code ++]
      "identifier": "http:default",      // [!code ++]
      "allow": [                         // [!code ++]
        {                                // [!code ++]
          "url": "http://localhost:8000/**" // [!code ++]
        }                                // [!code ++]
      ]                                  // [!code ++]
    }                                    // [!code ++]
  ]
}
```

## The HTTP Bridge

`http_ffi.js` is the core of the solution. It wraps both `fetch` and Tauri's HTTP plugin behind a single function, choosing at runtime based on whether the code is running inside Tauri:

```js
// client/src/tauri/http_ffi.js

import { Ok, Error } from "../gleam.mjs";
import { NetworkError } from "../../gleam_fetch/gleam/fetch.mjs";
import { isTauri } from "@tauri-apps/api/core";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";

export async function raw_send(request) {
  try {
    return new Ok(await (isTauri() ? tauriFetch(request) : fetch(request)));
  } catch (error) {
    return new Error(new NetworkError(error.toString()));
  }
}
```

`isTauri()` checks at runtime whether the code is running inside a Tauri webview. In the desktop app it calls `tauriFetch`, which routes through the Rust backend. In a browser it falls back to the native `fetch` — so the same code works in both environments without any conditional logic in Gleam.

`http.gleam` exposes `raw_send` as a typed Gleam external:

```gleam
// client/src/tauri/http.gleam

import gleam/fetch.{type FetchError, type FetchRequest, type FetchResponse}
import gleam/javascript/promise.{type Promise}

@external(javascript, "./http_ffi.js", "raw_send")
pub fn raw_send(a: FetchRequest) -> Promise(Result(FetchResponse, FetchError))
```

It works at the level of raw JS `Request` and `Response` objects — the same types `gleam_fetch` uses internally.

## API Changes

Two things change in `api.gleam`: the base URL becomes platform-aware, and a `send` function replaces direct calls to `fetch.send`.

In a browser, `window.location.origin` points to the Vite dev server or the production Caddy server, both of which proxy `/api` requests. In the desktop app there's no proxy, so requests go directly to the server:

```gleam
// client/src/api.gleam

fn api_base_url() -> String {
  browser.window_location_origin()      // [!code --]
  case platform.platform() {            // [!code ++]
    Browser -> browser.window_location_origin() // [!code ++]
    _ -> "http://localhost:8000"        // [!code ++]
  }                                     // [!code ++]
}
```

The `send` function bridges between Gleam's `Request` type and the raw JS objects that `raw_send` expects:

```gleam
// client/src/api.gleam

fn send(
  request: request.Request(String),
) -> Promise(Result(Response(FetchBody), FetchError)) {
  request
  |> fetch.to_fetch_request
  |> tauri_http.raw_send
  |> promise.try_await(fn(resp) {
    promise.resolve(Ok(fetch.from_fetch_response(resp)))
  })
}
```

`fetch.to_fetch_request` converts a Gleam `Request` to a JS `Request` object. `raw_send` sends it — via Tauri or the browser depending on context. `fetch.from_fetch_response` converts the JS `Response` back to a Gleam `Response` so the rest of `api.gleam` is unchanged.

`execute` and `delete` swap `fetch.send` for the new `send`:

```gleam
// client/src/api.gleam

pub fn delete(path: String) -> Promise(Result(Nil, ApiError)) {
  use request <- with_json_request(path)
  request
  |> request.set_method(Delete)
  |> fetch.send                                              // [!code --]
  |> send                                                    // [!code ++]
  |> promise.map(result.map_error(_, FetchError))
  |> promise.map_try(fn(response) {
    use <- bool.guard(
      response.status != 204,
      Error(UnexpectedStatus(response.status)),
    )
    Ok(Nil)
  })
}

fn execute(
  req: Request(String),
  expect expect: Int,
  decoder decoder: Decoder(a),
) -> Promise(Result(a, ApiError)) {
  req
  |> fetch.send                                              // [!code --]
  |> send                                                    // [!code ++]
  |> promise.try_await(fetch.read_json_body)
  |> promise.map(result.map_error(_, FetchError))
  |> promise.map_try(fn(response) {
    use <- bool.guard(
      response.status != expect,
      Error(UnexpectedStatus(response.status)),
    )
    response.body
    |> decode.run(decoder)
    |> result.map_error(DecodeError)
  })
}
```

## App Identifier

While here, `tauri.conf.json` gets a proper app identifier to replace the placeholder the initializer generated:

```json
// client/src-tauri/tauri.conf.json

{
  "identifier": "com.tauri.dev",    // [!code --]
  "identifier": "com.lukwol.doable" // [!code ++]
  ...
}
```

The identifier is how the OS distinguishes the app — it shows up in system preferences, update registries, and app bundles. We'll come back to swapping it for your own reverse-domain identifier when we cover distribution in chapter 15.

## Running

```sh
cd client
bun tauri dev
```

API requests work as before in dev. To verify the fix actually matters, run `bun tauri build` and open the resulting app — tasks load correctly without the proxy.

## What's Next

The desktop build is production-ready: HTTP flows through Rust, CORS is no longer a problem, and the same Gleam code runs in both the browser and the webview. Next, we'll take that same frontend to iOS and Android — two init commands, and the app runs on a phone.

[^1]: See commit [e6d3499](https://github.com/lukwol/doable/commit/e6d3499) on GitHub
