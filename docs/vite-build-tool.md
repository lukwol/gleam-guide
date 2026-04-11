# Vite Build Tool

The CORS middleware added in the previous chapter was a workaround for a problem that doesn't need to exist. The browser only enforces the same-origin policy when the frontend and backend are served from different origins — if a dev server proxies API requests on the client's behalf, the browser never sees a cross-origin request. [Vite](https://vite.dev) has this capability built in.

Replacing `lustre_dev_tools` with Vite also gives us a standard JS build tool with a rich plugin ecosystem — including [vite-gleam](https://github.com/nicktobey/vite-gleam), which teaches Vite to import `.gleam` files directly. With the proxy in place, the API base URL is always the same origin as the page, so the hardcoded `http://localhost:8000` in `api.gleam` can go too.

Thirteen files change, five are new[^1]:

```sh
doable/
├── client/
│   ├── .gitignore               # Gleam lines restored after Vite overwrote them  [!code highlight]
│   ├── gleam.toml               # lustre_dev_tools removed                        [!code highlight]
│   ├── index.html               # Vite entry point                                [!code ++]
│   ├── package.json             # vite + vite-gleam deps                          [!code ++]
│   ├── vite.config.js           # plugin + proxy config                           [!code ++]
│   └── src/
│       ├── api.gleam            # hardcoded URL → platform.api_base_url()         [!code highlight]
│       ├── main.js              # JS entry that boots client.gleam                [!code ++]
│       ├── platform.gleam       # api_base_url() backed by FFI                    [!code ++]
│       └── platform_ffi.js      # window.location.origin                         [!code ++]
└── server/
    └── src/
        └── web.gleam            # CORS middleware removed                         [!code highlight]
```

## Initializing Vite

Inside the `client/` directory, scaffold a new Vite project in-place:

```sh
cd client
bun create vite .
```

Vite will ask which framework and variant to use — select **Vanilla** and **JavaScript**. It then generates a fresh `package.json`, `index.html`, and `src/main.js`, and rewrites `.gitignore` with its own template.

That rewrite drops the Gleam-specific entries. Add them back manually under a `# Gleam` comment:

```
# Gleam              // [!code ++]
*.beam               // [!code ++]
*.ez                 // [!code ++]
/build               // [!code ++]
erl_crash.dump       // [!code ++]

# Logs
logs
...
```

Next, add the vite-gleam plugin, install everything, and remove `lustre_dev_tools` — it was only needed to run the old dev server:

```sh
gleam remove lustre_dev_tools
bun add vite-gleam
bun install
```

## Entry Point

Vite's entry point is `index.html`. It references a JS module, which in turn imports from the Gleam source:

```html
<!-- client/index.html -->

<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>client</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.js"></script>
  </body>
</html>
```

`main.js` imports `main` from `client.gleam` and calls it once the DOM is ready:

```js
// client/src/main.js

import { main } from "./client.gleam";

document.addEventListener("DOMContentLoaded", () => {
  const dispatch = main({});
});
```

vite-gleam intercepts the `.gleam` import and compiles it to JavaScript on demand. The `#app` div is the same mount point `lustre.start` expects — nothing changes on the Gleam side.

## Vite Config

`vite.config.js` wires up the plugin and the dev proxy:

```js
// client/vite.config.js

import { defineConfig } from "vite";
import gleam from "vite-gleam";

export default defineConfig({
  plugins: [gleam()],

  server: {
    proxy: {
      "/api": "http://localhost:8000",
    },
  },
});
```

The `proxy` block tells Vite's dev server to forward any request whose path starts with `/api` to `http://localhost:8000`. The browser sends the request to the Vite server (same origin), Vite relays it to the Gleam server, and the response comes back — no cross-origin request, no CORS.

## API Base URL

With the proxy in place, the API is reachable at the same origin as the page. `window.location.origin` returns that origin at runtime — `http://localhost:5173` in development, whatever the deployment URL is in production. The hardcoded constant in `api.gleam` is replaced with a call to a new platform-specific module.

The hardcoded constant in `api.gleam` is replaced with a call to `platform`:

```gleam
// client/src/platform.gleam

pub fn api_base_url() -> String {
  window_location_origin()
}

@external(javascript, "./platform_ffi.js", "window_location_origin")
fn window_location_origin() -> String
```

`@external` declares a Gleam function that is implemented in another language. The three arguments are the target (`javascript`), the module path relative to this file, and the exported function name. The FFI implementation is a one-liner:

```js
// client/src/platform_ffi.js

export function window_location_origin() {
  return window.location.origin;
}
```

`api.gleam` swaps the constant for a call to `platform.api_base_url()`:

```gleam
// client/src/api.gleam

import platform  // [!code ++]

const api_base_url = "http://localhost:8000"  // [!code --]

fn with_json_request(
  path: String,
  callback: fn(Request(String)) -> Promise(Result(b, ApiError)),
) -> Promise(Result(b, ApiError)) {
  let url = api_base_url <> path          // [!code --]
  let url = platform.api_base_url() <> path  // [!code ++]
  ...
}
```

## Removing CORS

With no cross-origin requests, the CORS middleware in `web.gleam` serves no purpose. Remove the `cors` call from `middleware` and delete the function entirely:

```gleam
// server/src/web.gleam

import error.{type DatabaseError, RecordNotFound}
import gleam/dynamic/decode.{type Decoder}
import gleam/http           // [!code --]
import gleam/http/response  // [!code --]
import gleam/int
import wisp.{type Request, type Response}

pub fn middleware(
  req: Request,
  handle_request: fn(Request) -> Response,
) -> Response {
  use <- wisp.log_request(req)
  use <- wisp.rescue_crashes
  use req <- wisp.handle_head(req)
  use <- cors(req)          // [!code --]
  handle_request(req)
}

fn cors(req: Request, next: fn() -> Response) -> Response { ... }  // [!code --]
```

## Running the Dev Server

```sh
cd client
bun run dev
```

Vite starts at `http://localhost:5173`. API requests to `/api/*` are proxied to the Gleam server running on port 8000. The app behaves identically to before — listing, creating, and editing tasks all work — but the CORS workaround is gone.

## What's Next

With a proper build tool in place, adding CSS tooling is straightforward. The next chapter installs [Tailwind CSS](https://tailwindcss.com) and [DaisyUI](https://daisyui.com) and styles the app.

[^1]: See commit [33c887f](https://github.com/lukwol/doable/commit/33c887f6d0dbd4e14dafa1c7729a1ef25527446e) on GitHub
