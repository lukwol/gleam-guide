# Vite Build Tool

This chapter is the first step toward the Tauri setup later in the guide, we bring [Vite](https://vite.dev) into the project alongside the fantastic [vite-gleam](https://github.com/nicktobey/vite-gleam), which teaches Vite to import `.gleam` files directly. Vite's dev server takes over the proxy role, so the `api.gleam` base URL — already derived from `window.location.origin` — keeps working untouched.

Six files change, four are new[^1]. The migration approach is based on this [excellent blog post](https://erikarow.land/notes/gleam-vite) by Erika Rowland[^2].

```sh
doable/
└── client/
    ├── .gitignore               # Gleam lines restored after Vite overwrote them  [!code highlight]
    ├── gleam.toml               # lustre_dev_tools + proxy config removed         [!code highlight]
    ├── index.html               # Vite entry point                                [!code ++]
    ├── package.json              # vite + vite-gleam dev deps                     [!code ++]
    ├── vite.config.js           # plugin + proxy config                           [!code ++]
    └── src/
        └── main.js              # JS entry that boots client.gleam                [!code ++]
```

## Install Bun

[Bun](https://bun.sh) is a fast JavaScript runtime and package manager — this guide uses its CLI from here on. Any npm-compatible tool (`npm`, `pnpm`, `yarn`) works just as well; adapt the `bun` commands if you prefer one of those.

::: code-group

```sh [macOS & Linux]
curl -fsSL https://bun.sh/install | bash
```

```sh [Windows (PowerShell)]
powershell -c "irm bun.sh/install.ps1 | iex"
```

:::

Restart the shell, then verify with:

```sh
bun --version
```

## Initializing Vite

Inside the `client/` directory, scaffold a new Vite project in-place:

```sh
cd client
bun create vite .
```

Vite will ask which framework and variant to use — select **Vanilla** and **JavaScript**. It then generates a fresh `package.json`, `index.html`, and `src/main.js`, and rewrites `.gitignore` with its own template.

::: warning
`bun create vite .` overwrites `.gitignore` with its own template, dropping the Gleam-specific entries. Restore them afterwards.
:::

Add them back manually under a `# Gleam` comment:

```sh
# Gleam               [!code ++]
*.beam               # [!code ++]
*.ez                 # [!code ++]
/build               # [!code ++]
erl_crash.dump       # [!code ++]

# Logs
logs
...
```

Next, remove `lustre_dev_tools`, add the vite-gleam plugin, and install everything:

```sh
gleam remove lustre_dev_tools
bun add --dev vite-gleam
bun install
```

The `[tools.lustre.dev]` block in `gleam.toml` can go as well — Vite takes over the proxy role:

```toml
# client/gleam.toml

[dev_dependencies]
gleeunit = ">= 1.0.0 and < 2.0.0"
lustre_dev_tools = ">= 2.3.6 and < 3.0.0"      # [!code --]

[tools.lustre.dev]                                               # [!code --]
proxy = { from = "/api", to = "http://localhost:8000/api" }      # [!code --]
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
    <title>Doable</title>
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

`vite.config.js` wires up the plugin and ports the dev proxy over from `gleam.toml`:

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

The `proxy` block does the same job the `[tools.lustre.dev]` block did: forward any request whose path starts with `/api` to `http://localhost:8000`. The browser sends the request to the Vite server (same origin), Vite relays it to the Gleam server, and the response comes back — still no cross-origin request, still no CORS.

## Running the Dev Server

```sh
cd client
bun run dev
```

Vite starts at `http://localhost:5173`. API requests to `/api/*` are proxied to the Gleam server running on port 8000. The app behaves identically to before — listing, creating, and editing tasks all work — but now we have the full JavaScript plugin ecosystem at our fingertips.

## What's Next

Vite is doing the heavy lifting — proxying the API, bundling Gleam, hot-reloading the page. The app is fully functional but visually brutal. Next, we'll plug in [Tailwind CSS](https://tailwindcss.com), [DaisyUI](https://daisyui.com), and [Heroicons](https://heroicons.com) to turn it into something you'd actually want to look at.

[^1]: See commit [c1f0f91](https://github.com/lukwol/doable/commit/c1f0f91) on GitHub

[^2]: [Using Gleam with Vite](https://erikarow.land/notes/gleam-vite) by Erika Rowland
