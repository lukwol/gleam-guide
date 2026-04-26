# Full-stack Gleam guide: web, desktop, and mobile

A practical guide to building full-stack apps with [Gleam](https://gleam.run) — covering a JSON HTTP API, a browser frontend, and desktop and mobile apps for iOS and Android, all sharing types and validation logic written once.

The guide walks through building **Doable**, a task manager, from scratch using Wisp, Mist, PostgreSQL, Lustre, and Tauri.

Read it online at [lukwol.github.io/gleam-guide](https://lukwol.github.io/gleam-guide/).

## Local development

Install dependencies and start the dev server:

```sh
bun install
bun run docs:dev
```

Build the static site:

```sh
bun run docs:build
```

Preview the built site:

```sh
bun run docs:preview
```

## Project structure

- `docs/` — guide content (Markdown)
- `docs/.vitepress/config.mjs` — VitePress configuration

## License

See [LICENSE](LICENSE).
