# Styling

The app is fully functional — now let's make it look good too. [Tailwind CSS](https://tailwindcss.com) provides low-level utility classes that compose into layouts, and [DaisyUI](https://daisyui.com) layers a set of semantic component classes on top — `btn`, `card`, `alert` — so you get good-looking UI without writing a single line of custom CSS. The [Heroicons](https://heroicons.com) icon set rounds it out.

Nine files change, one is new[^1]:

```sh
doable/
└── client/
    ├── package.json             # tailwindcss, daisyui, iconify added    [!code highlight]
    ├── vite.config.js           # @tailwindcss/vite plugin added         [!code highlight]
    ├── src/
    │   ├── style.css            # CSS entry point                        [!code ++]
    │   ├── main.js              # imports style.css                      [!code highlight]
    │   ├── component/
    │   │   └── task_form.gleam  # DaisyUI form controls                  [!code highlight]
    │   └── page/
    │       ├── tasks.gleam      # styled task list                       [!code highlight]
    │       ├── new_task.gleam   # styled new task form                   [!code highlight]
    │       └── edit_task.gleam  # styled edit task form                  [!code highlight]
    └── ...
```

## Install Dependencies

Three packages join the project: Tailwind itself, its official Vite plugin, and DaisyUI. The Heroicons icon set is pulled in through Iconify's Tailwind plugin, which turns icon names directly into CSS classes.

```sh
cd client
bun add --dev @tailwindcss/vite tailwindcss @iconify/tailwind4 @iconify-json/heroicons
bun add daisyui
```

`package.json` gains the new entries:

```json
// client/package.json

{
  "devDependencies": {
    "@iconify-json/heroicons": "^1.2.3",    // [!code ++]
    "@iconify/tailwind4": "^1.2.3",          // [!code ++]
    "@tailwindcss/vite": "^4.2.2",           // [!code ++]
    "tailwindcss": "^4.2.2",                 // [!code ++]
    "vite": "^8.0.8",
    "vite-gleam": "^1.7.1"
  },
  "dependencies": {
    "daisyui": "^5.5.19"                     // [!code ++]
  }
}
```

- **tailwindcss** — the core utility class engine.
- **@tailwindcss/vite** — the official Vite plugin that integrates Tailwind into the build pipeline.
- **daisyui** — semantic component classes (`btn`, `card`, `alert`, `checkbox`, …) that map to Tailwind utilities under the hood.
- **@iconify/tailwind4** — a Tailwind plugin that generates utility classes for icon sets, e.g. `icon-[heroicons--plus]`.
- **@iconify-json/heroicons** — the Heroicons icon data consumed by the Iconify plugin.

Then register the plugin in `vite.config.js`:

```js
// client/vite.config.js

import { defineConfig } from "vite";
import gleam from "vite-gleam";
import tailwindcss from "@tailwindcss/vite";  // [!code ++]

export default defineConfig({
  plugins: [gleam(), tailwindcss()],           // [!code highlight]

  server: {
    proxy: {
      "/api": "http://localhost:8000",
    },
  },
});
```

## CSS Entry Point

Tailwind v4 is configured entirely through CSS — no `tailwind.config.js`. Create `src/style.css` with three lines:

```css
/* client/src/style.css */

@import "tailwindcss";
@plugin "daisyui";
@plugin "@iconify/tailwind4";
```

`@import "tailwindcss"` activates the full utility class engine. The two `@plugin` lines load DaisyUI and Iconify as CSS-layer plugins. That's the entire configuration.

Import the stylesheet in `main.js` so Vite picks it up:

```js
// client/src/main.js

import { main } from "./client.gleam";
import "./style.css";               // [!code ++]

document.addEventListener("DOMContentLoaded", () => {
  const dispatch = main({});
});
```

## DaisyUI Approach

DaisyUI's design philosophy pairs well with Lustre's. Component classes (`btn`, `card`, `form-control`) name *what something is*, while Tailwind modifier classes (`flex`, `gap-3`, `mt-6`) describe *how it's arranged*. The two layers stay separate — DaisyUI for semantics, Tailwind for layout — so views remain readable even when class lists grow long.

A pattern that appears throughout is using Gleam's `case` expression to conditionally compose class strings:

```gleam
attribute.class(case t.completed {
  True -> "font-medium line-through text-base-content/50"
  False -> "font-medium"
})
```

Because `attribute.class` takes an ordinary string, conditional styling is just a `case` expression — no special utilities or class-merging helpers needed.

## Tasks Screen

`tasks.gleam` gets a full layout: a centred container, a header row with the page title and a primary "New Task" button, and a card list for the tasks themselves[^1].

The outer container uses `min-h-screen bg-base-200` to fill the viewport with DaisyUI's subtle background colour, while `container mx-auto max-w-2xl` centres the content and caps its width.

```gleam
// client/src/page/tasks.gleam

pub fn view(model: Model) -> Element(Msg) {
  html.div([attribute.class("min-h-screen bg-base-200")], [
    html.div([attribute.class("container mx-auto p-4 max-w-2xl")], [
      html.div([attribute.class("flex items-center justify-between mb-6")], [
        html.h1([attribute.class("text-3xl font-bold")], [
          element.text("Tasks"),
        ]),
        html.a(
          [
            attribute.href(route.to_path(route.NewTask)),
            attribute.class("btn btn-primary"),
          ],
          [
            html.span(
              [attribute.class("icon-[heroicons--plus] size-5")],
              [],
            ),
            element.text("New Task"),
          ],
        ),
      ]),
      case model.tasks {
        Error(err) ->
          html.div([attribute.class("alert alert-error")], [
            element.text(error.message(err)),
          ])
        Ok([]) if model.loading ->
          html.div(
            [attribute.class("flex justify-center p-8")],
            [
              html.span(
                [attribute.class("loading loading-spinner loading-lg")],
                [],
              ),
            ],
          )
        Ok([]) ->
          html.p(
            [attribute.class("text-base-content/60 text-center p-8")],
            [element.text("No tasks yet")],
          )
        Ok(tasks) ->
          html.ul([attribute.class("space-y-2")], list.map(tasks, view_task))
      },
    ]),
  ])
}
```

A few details worth noting:

- The "New Task" link becomes `btn btn-primary` with a `heroicons--plus` icon rendered via an empty `span` — Iconify generates a CSS mask-image from the icon data at build time, so there's no SVG in the Gleam source at all.
- `loading loading-spinner loading-lg` is a DaisyUI animated spinner — the loading state upgrades from a plain text "Loading…" to a proper indicator.
- `alert alert-error` replaces the bare `<p>` for errors, giving it the red alert styling DaisyUI provides.

Each task row becomes a card:

```gleam
fn view_task(t: Task) -> Element(Msg) {
  html.li(
    [attribute.class("card bg-base-100 shadow hover:shadow-md transition-shadow")],
    [
      html.a(
        [
          attribute.href(route.to_path(route.EditTask(t.id))),
          attribute.class("card-body p-4 flex-row items-center gap-3"),
        ],
        [
          html.input([
            attribute.type_("checkbox"),
            attribute.checked(t.completed),
            attribute.disabled(True),
            attribute.class("checkbox checkbox-primary"),
          ]),
          html.div([attribute.class("flex-1 min-w-0")], [
            html.p(
              [
                attribute.class(case t.completed {
                  True -> "font-medium line-through text-base-content/50"
                  False -> "font-medium"
                }),
              ],
              [element.text(t.name)],
            ),
            case t.description {
              "" -> element.none()
              desc ->
                html.p(
                  [attribute.class("text-sm text-base-content/60 truncate")],
                  [element.text(desc)],
                )
            },
          ]),
          html.span(
            [
              attribute.class(
                "icon-[heroicons--chevron-right] text-base-content/40 text-xl",
              ),
            ],
            [],
          ),
        ],
      ),
    ],
  )
}
```

`card bg-base-100 shadow` gives each task a white card on the light-grey page background. The `hover:shadow-md transition-shadow` adds a subtle lift on hover, signalling that the row is clickable. The chevron icon on the right reinforces that.

Completed tasks get the `line-through text-base-content/50` treatment — struck through and dimmed — while incomplete tasks stay fully opaque. The description is hidden entirely when empty (`element.none()`) rather than rendering a blank line, and `truncate` keeps long descriptions to a single line.

## Task Form

`task_form.gleam` provides the shared name, description, and completed fields used on both the new and edit pages. The bare `<label>` and `<input>` tags become proper DaisyUI form controls:

```gleam
// client/src/component/task_form.gleam

pub fn view(
  name: String,
  description: String,
  completed: Option(Bool),
) -> Element(Msg) {
  html.div([attribute.class("space-y-4")], [
    html.div([attribute.class("form-control")], [
      html.label([attribute.class("label")], [
        html.span([attribute.class("label-text")], [element.text("Name")]),
      ]),
      html.input([
        attribute.type_("text"),
        attribute.placeholder("Task name"),
        attribute.value(name),
        attribute.class("input input-bordered w-full"),
        event.on_input(UserUpdatedName),
      ]),
    ]),
    html.div([attribute.class("form-control")], [
      html.label([attribute.class("label")], [
        html.span([attribute.class("label-text")], [
          element.text("Description"),
        ]),
      ]),
      html.textarea(
        [
          attribute.placeholder("Optional description"),
          attribute.class("textarea textarea-bordered w-full"),
          event.on_input(UserUpdatedDescription),
        ],
        description,
      ),
    ]),
    case completed {
      None -> element.none()
      Some(value) ->
        html.div([attribute.class("form-control")], [
          html.label(
            [attribute.class("label cursor-pointer justify-start gap-3")],
            [
              html.input([
                attribute.type_("checkbox"),
                attribute.checked(value),
                attribute.class("checkbox"),
                event.on_check(UserUpdatedCompleted),
              ]),
              html.span([attribute.class("label-text")], [
                element.text("Completed"),
              ]),
            ],
          ),
        ])
    },
  ])
}
```

`form-control` is a DaisyUI wrapper that handles spacing and alignment between label and input. `input input-bordered` and `textarea textarea-bordered` give the fields their standard border style. The checkbox for the completed field uses `cursor-pointer justify-start gap-3` to left-align the label and give it a pointer cursor — DaisyUI's default `label` centers content for toggle switches, so these overrides adapt it for a checkbox.

## New Task Page

`new_task.gleam` gets the same page-level layout as the tasks screen — centred container, bold heading — and the action buttons acquire proper DaisyUI styling:

```gleam
// client/src/page/new_task.gleam

pub fn view(model: Model) -> Element(Msg) {
  html.div([attribute.class("min-h-screen bg-base-200")], [
    html.div([attribute.class("container mx-auto p-4 max-w-lg")], [
      html.div([attribute.class("flex items-center gap-2 mb-6")], [
        html.button(
          [
            attribute.class("btn btn-ghost btn-sm btn-circle"),
            event.on_click(UserClickedBack),
          ],
          [
            html.span(
              [attribute.class("icon-[heroicons--arrow-left] size-5")],
              [],
            ),
          ],
        ),
        html.h1([attribute.class("text-2xl font-bold")], [
          element.text("New Task"),
        ]),
      ]),
      case model.error {
        None -> element.none()
        Some(err) ->
          html.div([attribute.class("alert alert-error mb-4")], [
            element.text(err),
          ])
      },
      task_form.view(model.name, model.description, None)
        |> element.map(FormMsg),
      html.div([attribute.class("flex gap-2 mt-6")], [
        html.button(
          [
            attribute.disabled(model.submitting),
            attribute.class("btn btn-primary"),
            event.on_click(UserSubmittedForm),
          ],
          [
            case model.submitting {
              True ->
                html.span(
                  [attribute.class("loading loading-spinner loading-sm")],
                  [],
                )
              False ->
                html.span(
                  [attribute.class("icon-[heroicons--archive-box-arrow-down] size-5")],
                  [],
                )
            },
            element.text(case model.submitting {
              True -> "Saving..."
              False -> "Save"
            }),
          ],
        ),
      ]),
    ]),
  ])
}
```

The Back button becomes `btn btn-ghost btn-sm btn-circle` — a small circular ghost button that sits beside the heading without drawing too much attention. The Save button shows a spinner in place of the icon while the form is submitting, providing immediate feedback without disabling the button label.

## Edit Task Page

`edit_task.gleam` mirrors the new task page layout and adds a Delete button. The loading state — previously a `<p>Loading…</p>` — becomes a centred full-screen spinner:

```gleam
// client/src/page/edit_task.gleam

pub fn view(model: Model) -> Element(Msg) {
  case model.loading {
    True ->
      html.div(
        [
          attribute.class(
            "min-h-screen bg-base-200 flex items-center justify-center",
          ),
        ],
        [
          html.span(
            [attribute.class("loading loading-spinner loading-lg")],
            [],
          ),
        ],
      )
    False ->
      html.div([attribute.class("min-h-screen bg-base-200")], [
        html.div([attribute.class("container mx-auto p-4 max-w-lg")], [
          html.div([attribute.class("flex items-center gap-2 mb-6")], [
            html.button(
              [
                attribute.class("btn btn-ghost btn-sm btn-circle"),
                event.on_click(UserClickedBack),
              ],
              [
                html.span(
                  [attribute.class("icon-[heroicons--arrow-left] size-5")],
                  [],
                ),
              ],
            ),
            html.h1([attribute.class("text-2xl font-bold")], [
              element.text("Edit Task"),
            ]),
          ]),
          case model.error {
            None -> element.none()
            Some(err) ->
              html.div([attribute.class("alert alert-error mb-4")], [
                element.text(err),
              ])
          },
          task_form.view(
            model.task.name,
            model.task.description,
            Some(model.task.completed),
          )
            |> element.map(FormMsg),
          html.div([attribute.class("flex gap-2 mt-6")], [
            html.button(
              [
                attribute.disabled(model.submitting),
                attribute.class("btn btn-primary"),
                event.on_click(UserSubmittedForm),
              ],
              [
                case model.submitting {
                  True ->
                    html.span(
                      [attribute.class("loading loading-spinner loading-sm")],
                      [],
                    )
                  False ->
                    html.span(
                      [attribute.class("icon-[heroicons--archive-box-arrow-down] size-5")],
                      [],
                    )
                },
                element.text(case model.submitting {
                  True -> "Saving..."
                  False -> "Save"
                }),
              ],
            ),
            html.button(
              [
                attribute.disabled(model.submitting),
                attribute.class("btn btn-error"),
                event.on_click(UserClickedDelete),
              ],
              [
                html.span(
                  [attribute.class("icon-[heroicons--trash] size-5")],
                  [],
                ),
                element.text("Delete"),
              ],
            ),
          ]),
        ]),
      ])
  }
}
```

The Delete button is `btn btn-error` — DaisyUI's red variant — making it visually distinct from the primary Save action. Both buttons are disabled while the form is submitting, preventing double-submissions.

## Running the Dev Server

```sh
cd client
bun run dev
```

Open `http://localhost:5173`. The app now has a proper layout: a task list rendered as cards with completion state, loading spinners, error alerts, and form pages with consistent styling throughout.

## What's Next

The web app is complete. The next chapter wraps it in [Tauri](https://tauri.app) to turn it into a native desktop application.

[^1]: See commit [89fafad](https://github.com/lukwol/doable/commit/89fafadc0a83ae849830209b4ebe109f9c140eb1) on GitHub
