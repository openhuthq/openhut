# Design

How the dashboard (`packages/desktop/src/renderer`) looks and why. The look lives in the shared components in `packages/desktop/src/renderer/src/components/ui/` (Tailwind and cva variants over Base UI) and the tokens in `packages/desktop/src/renderer/src/index.css`; this file is the rules behind them.

## Buttons

Status: in the code since 2026-11-13.

### Why the bordered white button goes

The old secondary was a white fill with a grey border and black text. The border existed only because the fill matched the card behind it, and next to an input it read as a second field. The brand is monochrome (`--primary` is ink black), so "primary-coloured text, no border, white fill" would be a plain label with nothing to say it can be clicked. The secondary instead gets a fill that differs from every surface: `--soft` (black at 6%). It reads as a quiet grey chip on the canvas, on cards and in dialogs, and needs no border.

Rejected: adding an accent colour so borderless accent text could carry the secondary. It rebrands a deliberately monochrome product to fix one button.

### Variants

| Variant | `Button` | Rest | Hover | Use for | Never for |
|---|---|---|---|---|---|
| Primary | `variant="primary"` | fill `--primary`, white text | fill `--primary-hover` | the one action the view exists for: create, save, connect, allow | navigation, row actions |
| Secondary | `variant="secondary"` | fill `--soft`, text `--ink`, no border | fill `--mid` | every other action that should look like a button: Cancel, Chat, Stop/Start, Retry, external links, labelled Copy | destructive actions |
| Ghost | default | transparent, text `--ink` | fill `--soft` | row actions, toolbar actions, the close X | the only action in a view |
| Danger | `variant="danger"` | transparent, text `--fail` | fill `--fail` at 8% | the trigger of a destructive action | anything not behind a confirm |
| Danger fill | `variant="destructive"` | fill `--fail`, white text | same, slightly darker | only the final button inside a confirm dialog | everywhere else |
| Icon-only | `size="icon"` or `"icon-sm"` | square, transparent, icon in `--mute` | soft fill, icon in `--ink` (red with `danger`) | Close, Toggle sidebar, Rename, More (⋯), Send/Stop, and the one repeated action of a table row | any action without a universally known glyph |
| Link | `a`, `variant="link"` | underlined, inherited colour | none | an action inside a sentence | standalone actions |
| Overflow menu | `DropdownMenu` | ghost icon trigger (⋯) | `--tint` highlight | two or more rare actions in a header | a single item, or the primary |

All variants share: active `scale(.96)`, the global 2px focus ring, disabled at 50% opacity with no hover change.

Two sizes. 32px (default) in page headers, dialog and popover footers, empty states. 28px (`sm`) inside cards, rows, tables, inline forms, setup steps and chat. Both use 14px text. The 32px composer send button (`variant="send"`, radius 10px) is the only exception.

### Rules

1. A layer (page, dialog, popover, open inline form) has at most one primary.
2. A row never holds a primary. Row actions are ghost `sm`.
3. Every button in one toolbar has the same anatomy: all icon + label, or all label only.
4. Header buttons are icon + label. Row, footer and inline-form buttons are label only, except the external-link and copy icons.
5. Icon-only is for Close, Toggle sidebar, Rename, More, Send/Stop, and a table row's single repeated action (trash to remove a person, × to take a connection off an agent), so a long table isn't a column of the same word. Each has `aria-label` and `title`.
6. An action is red if and only if it opens a confirm, and it gets a confirm if and only if one click cannot undo it.
7. The trigger is red text; the button inside the confirm is red fill. Red fill appears nowhere else.
8. A copy button confirms in place: `CopyButton` swaps its icon for a checkmark for 1.5s, no toast. Only a failed copy toasts.
8. On the page that manages an object (agent, connection), Delete is visible in the header, last, after a separator.
9. On a page that is not for managing the object (chat), destructive actions live in the ⋯ menu, last, after a separator, in red.
10. A header shows at most three buttons. A fourth sends everything but the primary and one secondary into ⋯. A ⋯ menu holds at least two items.
11. The trash icon means the thing is gone for good (Delete, Remove a person). Disconnect, Revoke and Unlink never use it.
12. Dialog footers: Cancel (secondary) left, the committing action (primary or danger fill) rightmost.
13. A state toggle (Stop/Start) is one secondary button named for what it will do, with a swapping icon and no colour. The status badge carries the colour.
14. A button that fires a mutation is disabled while it is pending. One that waits on an outside service also changes its label to "Connecting…".
15. Actions inside a sentence are links, never buttons.

### What changes, by page

| Page | Control | Before | After |
|---|---|---|---|
| Everywhere | Cancel, and every secondary button | white, grey border | soft grey fill, no border |
| Everywhere | confirm dialog action | white, bordered, red text (same as its trigger) | red fill |
| Everywhere | ghost buttons (close X, sidebar toggle, row actions) | no hover state | soft fill on hover |
| Everywhere | labelled copy chips (Copy SQL, Copy manifest) | mono bordered chip | secondary `sm`; a chip that shows the copied value stays |
| Agents | Copy prompt | primary (second primary on the page) | secondary |
| Agent | Chat | white bordered | secondary |
| Agent | Stop / Start | white bordered, amber or green text | secondary, no colour |
| Agent | Delete | white bordered, red text | red text, no border |
| Agent | skill Edit / View | bordered `sm` | none: the whole skill card opens it (2026-11-14) |
| Agent | channel Set up / Edit, Disconnect | `btn row` 30px | ghost `sm` 28px, Disconnect red |
| Chat | Clear | visible ghost button | "Clear chat" in the ⋯ menu |
| Chat | Delete agent | not on this page | red item in the ⋯ menu, same confirm as the agent page |
| Chat | Settings | ghost 28px | ghost 32px, stays visible |
| Chat | composer Stop | white with ink border | ink fill, white square |
| Chat | "Open agent settings" (empty state) | secondary | primary, labelled "Settings" |
| Connection | Delete | white bordered, red text | red text, no border |
| Tailscale | Disconnect | trash icon | label only |
| Agent | Connections | a checkbox per connection | only the agent's connections, × to remove, an Add menu for the rest |
| Connection | Remove (grant) | black word | × icon |
| Admin | row Set up / Edit / View | `btn row` 30px | ghost `sm` 28px |
| Admin | inline Cancel | white bordered beside a white bordered input | soft fill |
| Admin | Update now | primary `sm` (a second primary when a form is open) | secondary `sm` |

### Code

Every variant and size is in `components/ui/button.tsx` (`buttonVariants` for links styled as buttons). A destructive trigger is `ConfirmButton`, which opens the `AlertDialog`; overflow menus are `DropdownMenu` with `DropdownMenuItem variant="destructive"`.

### Dropdowns

A dropdown trigger (Model, Computer) follows the secondary button: soft fill, no border, darker fill on hover and while open. Triggers stacked in one card share a minimum width (136px) so their edges line up, with the icon and label on the left and the chevron on the right. Every option has an icon in the same column, then its name and a one-line description, then the tick; the trigger shows the chosen option's icon. A menu of things to add (connections on an agent) follows the same shape: icon, name, and a greyed-out reason when an option can't be chosen.

### Known trade-off

A ghost button at rest is bare text. In a row ("Set up", "Remove") that is the convention and the hover fill confirms it, but it is the weakest affordance in the system. If rows test badly, promote row actions to secondary `sm` rather than bringing the border back.

## Icons and type

- Every UI icon is Hugeicons (`@hugeicons/react` + `@hugeicons/core-free-icons`, free stroke set) through `components/icons.tsx` and `status-badge.tsx`; brand marks for other apps stay in `brand-icons.ts`. Don't hand-draw an SVG icon (owner, 2026-11-14). Computers too are plain line icons: a laptop for This Mac, a server for a Linux computer, a plus for Add a computer (owner, 2026-11-17).
- Statuses in a list are Linear-style circle icons, not coloured dots. The shape carries the state, so it reads without colour: running `Loading02Icon` (amber, spinning, so every status keeps the circle shape), done `CheckmarkCircle02Icon` (green), nothing to do `CircleIcon` (grey), skipped or paused `DashedLineCircleIcon` (grey), failed `CancelCircleIcon` (red). They live with the badges in `status-badge.tsx` (owner, 2026-11-15).
- Text is 14px across the app, sidebar included. Only small labels and counts (12px), code and tool-call chips (12.5px) and headings differ.

## Agent page

Status: in the code since 2026-11-14.

- The avatar stays large (64px) with the name beside it at 18px, in a tight row: 10px above it, 12px between avatar and name, 10px before the two columns (owner, 2026-11-16, chosen over moving both into the breadcrumb).
- Two columns on top that end on the same line: Instructions stretches to the rail's height (the preview text is absolutely placed, so long instructions never make the row taller). Skills sit below, full width.
- No scroll box inside the page. A nested scroller ended below the fold, trapped the wheel and, with classic scrollbars, put a 15px track inside the box's border. If a list is too long, fold it, don't scroll it.
- Skills are the Agents page's grid of tile `Card`s, so every card has the same width and a two-line description. A segmented filter (All / Learned / Built in, Learned selected) sits in the section head, and 12 cards show until "Show all" (12 fills 1, 2, 3 or 4 columns evenly).
- A skill's icon: a learned skill gets the ink sparkle tile; a built-in one gets the brand mark when its name starts with a brand in `brand-icons.ts` (github, google, claude), else the Hugeicon for its Hermes category, the folder in `skill.path` (`skillIcon` in `icons.tsx`), else the bolt.
- Memory is one row in the facts box ("5 entries · Manage") that opens a sheet with one list of everything the agent saved, people first.
- Detail that belongs to one thing on a page (an agent's memory) opens in a `Sheet` (`components/ui/sheet.tsx`): the same Base UI dialog as `Dialog`, pinned to the right edge, full height, 560px, sliding in 2.5rem with a fade over 200ms and a light blurred backdrop, like shadcn's Sheet. Which sheet is open lives in the URL.

## Desktop app

Status: in the code since 2026-11-17. Surface values are DuskBot's Daylight skin (`styles.css`, `[data-skin="daylight"]`), its Settings sheet (`styles/settings.css`) and Connect apps (`connect-apps.css`), translated to our tokens in `index.css`.

### Direction: playful identity, calm chrome

DuskBot's look (owner, 2026-11-17). Text and chrome are calm: ink text at a few sizes, small sentence-case titles, grey pill actions, white and light-grey surfaces, faint hairlines, no shadows except floating surfaces, no display font, no uppercase labels, no mono body copy. Personality comes from the things that identify something: agent faces, full-colour brand logos, status dots.

### Colour is for identity, not decoration

Owner, 2026-11-17, after a fully coloured pass read as too much.

- Colour only for identity: brand logos (Slack, WhatsApp, Telegram, Gmail, Claude, OpenAI, every app in Connections), agent faces, status dots (green running, amber starting, red failing, grey off). The Claude sparkle beside a model name is a brand mark and stays.
- Actions are plain: Stop/Start, Clear chat, Delete and every other icon button are 16px Hugeicons in ink at 1.6 stroke, 28 to 32px hit area, hover fill only. Delete turns red only on hover.
- Settings icons carry one soft tint each; everywhere else colour is identity only (owner, 2026-11-17). In the Settings nav and Settings rows each line icon's stroke takes one calm hue from the `--hue-*` tokens in `index.css` (about 65% of the bright brand chroma): General slate, Updates sky, Computers blue, Models violet, MCP teal; open at login green, keep awake and notifications amber, failures red, the data folder blue, usage violet. One colour per icon, no fills, no tiles. The app is light-only (`color-scheme: light`), so the hues have no dark variants yet; add them with the dark theme.
- Everywhere else row icons are plain line icons in `--mute`: the panel's rows (Model, Runs on, Memory, Skills, Browser, Run code), the chat and the sidebar.

| Thing | Rule | Token / value |
|---|---|---|
| Panes | The sidebar and the agent's right panel share one tint; the chat between them is white. | `--sidebar` #f7f7f7 (Dusk panel), chat `--card` #fff |
| Pane edges | One hairline between panes, no shadow. | `--hair` black 8% at 0.5px (Dusk `--color-edge` #1c1c1c14, 0.5px) |
| Hover / selected | Rows hover with a fill, the selected row is a darker fill: no white card, no shadow. | `--hover` black 3.5%, `--picked` black 8% (Dusk hover ink/3.5, selected #e4e4e4) |
| Surfaces on the tint | The Connections pill and the gear: white, hairline border, hover tints the white. | `SURFACE` in `kit.tsx` (Dusk `bg-composer` + `border-ink/[0.08]`) |
| Shadows | Only floating surfaces lift: dialogs, menus, popovers, tooltips, toasts. Cards, rows, panels and the composer have none. | `shadow-dialog`, `shadow-menu`, `shadow-pop` |
| Radius | 6px small (chips, inline buttons), 8px rows, cards, buttons, inputs, selects, alerts and tiles, 12px dialogs and chat bubbles. Nothing rounder, except circles for avatars, dots and switches, and the pill actions inside dialogs. | `rounded-md`, `rounded-lg`, `rounded-xl` |
| Text | Text is ink by default; muted only for timestamps, counts, hints, labels and placeholders. Secondary copy that stays is `--body` or the darker `--mute`. | `--mute` 45%, `--mute-2` 56% lightness |
| Status chips | A coloured dot and ink text ("Running", "Up to date", "Signed in"), never coloured text. | `Status` in `kit.tsx` |
| Scrollbars | Thin, no track, shown on hover. Dialog panes hide theirs (`no-scrollbar`) and fade 16px at the bottom (`fade-b`); the chat fades 24px under its header (`fade-t`). The right panel keeps `scrollbar-gutter: stable` so its edge never moves. | global rule and utilities in `index.css` |
| Focus | Rings only for keyboard (`:focus-visible`), never with a pointer, and none on anything behind an open dialog. | `index.css` |
| Motion | The sidebar slides with DuskBot's spring (240ms width, content fades and moves 8px in 160ms); everything stops under reduced motion. | `--ease-spring` in `index.css` |

- **Sidebar.** 280px. Header buttons are borderless 32px icons with 8px corners and a hover fill only (`ICON_BUTTON` in `kit.tsx`), whatever the state. Each agent row is the face with its status dot, the name, and one line; with more than one computer the line starts with the agent's computer ("beelink · …"), and agents on an offline computer are greyed and say "Offline". Bottom: a gear (Settings, ⌘,) and the Connections pill, both 40px. Collapsed (⌘\) the sidebar is hidden entirely, as in Claude, ChatGPT, Linear and Notion: the traffic lights sit over the chat header, which gains expand and new agent right after them (84px in). ⌘1–9 opens the nth agent. There is no search.
- **Chat.** The header is the face and the name, with Clear chat on the right (a 28px eraser, only when there are messages, confirming "Clear this chat? Memory stays." in a small popover). User bubbles are `--soft` with ink text, 12/12/4/12 corners. The composer is one row: text and send. An agent that can't answer shows only its face, one 20px semibold line and a 14px sentence in the middle ("Ops isn't answering" / "It restarts on its own, or Stop and Start it from the panel."), with the raw error behind a "Details" disclosure; the amber banner above the composer only appears once there are messages. Below 1100pt the right panel hides itself and a small button in the chat header brings it back.
- **Right panel.** Header: face, name (18px semibold, sentence case) and status, with Stop/Start and Delete as 28px icon buttons on the name line, each with a tooltip; Delete confirms in a small popover from the icon ("Delete Ops? Its memory goes too."). Rows like the sidebar's, about 32px, 13px text, plain muted icon, value in ink on the right; every trailing control ends on the panel's 16px padding. Section labels are 12px sentence-case muted ("What it does", "Talk to it on", "Can use", "Computer"). Channels are a 16px brand glyph, the name, "Connected" in muted when connected, else a grey "Set up" pill. "Runs on" lists the computers; another online one is "Move to …" and moves the agent in place. "Can use" offers "Add to <computer>" for a connection that isn't on the agent's computer. The bottom "Computer" section is Browser and Run code.
- **Settings and Connections are dialogs** over the app, never pages, one fixed size so nothing jumps between tabs: DuskBot's sheet, min(900px, 100vw − 32px) by min(700px, 100vh − 96px), 12px corners, the app dimmed behind, Esc or the round × (32px, 10px from the corner) closes and returns to the agent that was open. The URL keeps `/settings/:tab` and `/connections/*`. Inside, the type is DuskBot's: 13px/18px body.
- **Final wording (settled in design review, 2026-11-18; don't reword).** General, "An agent stops or fails": "The Dock icon counts them either way." (Mac only, from `badgeNote` in `lib/platform.ts`; no line on Linux). "Keep this Mac awake": "The screen can still turn off. Agents can't answer while the Mac sleeps." ("the computer" on Linux).
- **Brand glyphs at one optical size.** In Settings rows every brand glyph is drawn at 20px; line marks (Codex, OpenRouter, xAI) carry a tighter `vb` in `brand-icons.ts` so they fill the box like the Claude and OpenAI marks.
- **Pane intros.** A pane opens with one full sentence ending in a full stop, only where it adds something the rows don't say. Computers: "Your agents run on these computers." MCP: "Let Claude Code or another app manage your agents." General and Models have none (Models starts at its Subscriptions label). Use `Intro` in `settings/kit.tsx`, nothing else; the first row sits 6px under it, the same as under a section label. A note that belongs to a list ("Keys stay on the computer you add them to.") is `ListNote`: 12px muted, about 11px under the last row's text, starting at the row-text edge.
- **Settings.** A 198px nav (16px 12px padding, 2px gaps, items 7px 9px, 8px corners, 13px/18px, `--picked` when selected) with General, Computers, Models, MCP. The pane title sits above the scroller (26px top, 34px in, 15px/22px medium); the pane scrolls with 18px 24px 40px padding and 36px between sections. Every tab uses one row (`Row` in `settings/kit.tsx`): a 24px icon slot, 16px gap, a 13px/18px title over a 12px/16px muted line, the trailing item flush to the same right edge (a chevron too), 48px minimum, 9px 10px padding. The icon and the trailing item centre on the title and its first line, so a row with a longer note keeps them at the top. Section labels are 12px muted, 10px in. Row actions are grey pills (26px, 12px text, 10px padding). Computers is one list, no detail pages and no expanding rows: each computer's line icon (laptop or server, soft blue) with its status dot, "Online · 4 agents · OpenHut 0.3.0" ("No agents" at none), "✓ Current" on This Mac and a grey "Remove" pill on the others, which confirms in the row itself: the second line becomes "Its agents stop and leave this list." and the pills become Cancel and a red Remove; Esc or a click elsewhere cancels. Updates live on the same rows: This Mac shows "Restart to update" once the app has downloaded one, and another computer that's behind shows an "Update" pill before Remove; "Add a computer" is a row with a plain plus in soft green. It opens a step inside the pane (never a dialog on the dialog) with two rows: Tailscale and Others. Tailscale shows one of four states: not installed (logo, "Install Tailscale to reach your other computers", a Get Tailscale pill and "I've installed it"), stopped or signed out ("Open Tailscale and sign in"), no eligible computers, or the peer list, where computers already added say Added. Others is a name, https address and key. Adding never blocks: picking a computer returns to the list at once, where it is one plain row: the server icon, its name, one word for where it is (Connecting…, Installing…, Starting…, Almost ready…) and a 14px spinner. No dot, no steps, no timer, no versions; the installer's output stays in the log. The install keeps running with Settings closed (main keeps its state); when it finishes the row becomes the normal Online computer. A failure gets a red dot, one plain sentence and a Try again pill beside Remove. An update in progress is the same plain row with "Updating…". Models: two sections of the same rows, Subscriptions (Claude, Codex) and API keys (OpenRouter, OpenAI, xAI), each with a brand glyph, a note ("On This Mac and beelink", or "24 models · 10 on · On This Mac" for a key), then "Signed in" or "Connected" with a Manage pill, or a Sign in / Add key pill. Add key and Codex's sign-in open a step inside the pane (`?open=<provider>`, back arrow, the Connections sheet's header and footer): a password field and "Put it on" ticks for a key, the device code with Copy and an Open link for Codex. Manage is the title with a back arrow, one head row (the masked key, where it is, when it updated, Refresh models and Disconnect or Sign out, which confirms in the row), a search field with an All / On segmented filter, and a switch per model (10 shown until Show all). Pickers (Model, Fallback, Helper models) are one searchable popover grouped by provider, with the search field once more than 8 models are on, a No fallback or Automatic first option, unconnected providers greyed under Not set up, and the model that is already the main one greyed in Fallback. The panel has Model, Fallback and Helper models rows ("Automatic" or "2 of 3 set"); Helper models opens a sheet, and New agent has Model, Fallback and an Advanced disclosure for the helpers. "Claude this week" appears only once an agent has used it, with the 5-hour and weekly usage beside the label. MCP: one row per computer, named like on Computers (the suggested server name is the computer's name, prefixed with "openhut-" only when it doesn't already say openhut), its command as a 12px muted mono line that wraps only between arguments (a quoted path stays whole with the "--" before it, and a flag with its value; never truncated, mono never above 12px) and a text-only "Copy" pill; Other apps shows the bridge path the same way with its sentence 4px under it; a computer reached through this one adds "Works while OpenHut is open on this Mac." Models: the Claude row's second line is only where it is signed in ("On This Mac and beelink"); General ends its first list with "OpenHut 0.1.1" over "Updates download on their own." ("Ready to install." once one has downloaded) and a green "Up to date" status or the "Restart to update" pill. A home folder shows as ~, outside any quotes (~/"Library/…"), so a shown command still works when typed; Copy always copies the full path.
- **Channel setup** (Slack, WhatsApp, Telegram) uses the same sheet as a connection: brand logo, a 15px sentence-case title, one 13px line, flat numbered steps with one line of instruction and the action each, grey pills, and at most one muted line in the footer. No mock chats or transcripts, no mono except tokens and IDs. Who can message an agent is one field of IDs or numbers (the first is the owner); there is no "anyone" mode in the app.
- **Connections.** DuskBot's Connect apps: 22px 32px 28px padding, a 17px/24px title 52px from the top (below the ×) with a 12px muted "N connected ›" on the right (shown at 0 too; it filters to the connected ones), a search field ("Search apps"), a search field, category chips (28px, 13px, 10px padding, 8px apart, selected one black), 12px muted group labels with 28px under them, and a two-column grid of 64px rows (24px logo, 13px medium name over one 13px muted noun line with no full stop and no "as you", a 96px grey "Connect" pill centred on the text). With more than one computer, each connection is listed once with a small chip per computer (grey dot when offline). A connection's sheet replaces the dialog's body with a back arrow; a sheet that creates something asks "Put it on" (computers with agents ticked) right under its name field.
