# Design

How the dashboard (`packages/app`) looks and why. The look lives in the shared components in `packages/app/src/components/ui/` (Tailwind and cva variants over Base UI) and the tokens in `packages/app/src/index.css`; this file is the rules behind them.

## Buttons

Status: in the code since 2026-11-13.

### Why the bordered white button goes

The old secondary was a white fill with a grey border and black text. The border existed only because the fill matched the card behind it, and next to an input it read as a second field. The brand is monochrome (`--primary` is ink black), so "primary-coloured text, no border, white fill" would be a plain label with nothing to say it can be clicked. The secondary instead gets a fill that differs from every surface: `--soft` (black at 6%). It reads as a quiet grey chip on the canvas, on cards and in dialogs, and needs no border.

Rejected: adding an accent colour so borderless accent text could carry the secondary. It rebrands a deliberately monochrome product to fix one button.

### Four tiers (owner, 2026-11-18)

Every labelled button is one of four tiers, loudest first. Pick by what the action does for the row or view, not by where it sits. Red is a tone over tiers 1 to 3, never a fifth tier.

| Tier | `Button` | Looks like | Use for |
|---|---|---|---|
| 1 Primary | `variant="primary"` | ink fill, white text | the one commit of a layer: Test and connect, Add, Start again, New agent |
| 2 Secondary | `variant="secondary"` | `--soft` grey fill | what a view or row needs next outside Settings rows: Update, Restart to update, Download, Try again; and Cancel |
| 3 Ghost | `variant="ghost"` | surface background (transparent), ink text, soft fill on hover | every Settings row action (owner, 2026-11-26): Edit, Set up, Sign in, Add key, Connect, Manage; and Show folder, Check now, Refresh, Copy, I've installed it; red text (`danger`) for Remove, Disconnect |
| 4 Text | `variant="text"` | coloured text only, no padding or fill, hover underline | a quiet way onward: Show all N, + Add, 2 connected ›, Edit beside a value |

Icon-only buttons sit outside the tiers. They are ghost squares, ink by default. Delete's trash is red at rest and Stop/Start are tinted (rule 13). The test for 2 against 3 is state: a row that still needs setting up gets a secondary; once it's set up, its action drops to ghost so the rows that need you stand out. Settings rows are the exception (owner, 2026-11-26): every row action there is ghost, set up or not, and the row's note carries the state. Tier 4 replaces the hand-styled `variant="bare"` text buttons (`connections-view.tsx` "N connected", `agent-connections.tsx` "+ Add"). Settings page by page: see the table under "Settings, by tier".

### Variants

| Variant | `Button` | Rest | Hover | Use for | Never for |
|---|---|---|---|---|---|
| Primary | `variant="primary"` | fill `--primary`, white text | fill `--primary-hover` | the one action the view exists for: create, save, connect, allow | navigation, row actions |
| Secondary | `variant="secondary"` | fill `--soft`, text `--ink`, no border | fill `--mid` | every other action that should look like a button: Cancel, Chat, Stop/Start, Retry, external links, labelled Copy | destructive actions |
| Ghost | default | transparent, text `--ink` | fill `--soft` | row actions, toolbar actions, the close X | the only action in a view |
| Danger | `variant="danger"` | transparent, text `--fail` | fill `--fail` at 8% | the trigger of a destructive action | anything not behind a confirm |
| Danger fill | `variant="destructive"` | fill `--fail`, white text | same, slightly darker | only the final button of a confirm whose action loses data for good (Delete agent, Delete connection) | everywhere else |
| Icon-only | `size="icon"` or `"icon-sm"` | square, transparent, icon in `--mute` | soft fill, icon in `--ink` (red with `danger`) | Close, Toggle sidebar, Rename, More (⋯), Send/Stop, and the one repeated action of a table row | any action without a universally known glyph |
| Link | `a`, `variant="link"` | underlined, inherited colour | none | an action inside a sentence | standalone actions |
| Overflow menu | `DropdownMenu` | ghost icon trigger (⋯) | `--tint` highlight | two or more rare actions in a header | a single item, or the primary |

All variants share: active `scale(.96)`, the global 2px focus ring (shown only once Tab is pressed; a click hides it again, and typing never brings it back), disabled at 50% opacity with no hover change.

Two sizes. 32px (default) in page headers, dialog and popover footers, empty states. 28px (`sm`) inside cards, rows, tables, inline forms, setup steps and chat. Both use 14px text. The 32px composer send button (`variant="send"`, radius 10px) is the only exception.

### Rules

1. A layer (page, dialog, popover, open inline form) has at most one primary.
2. A row never holds a primary. Row actions are ghost `sm`.
3. Every button in one toolbar has the same anatomy: all icon + label, or all label only.
4. Header buttons are icon + label. Row, footer and inline-form buttons are label only, except the external-link and copy icons.
5. Icon-only is for Close, Toggle sidebar, Rename, More, Send/Stop, and a table row's single repeated action (trash to remove a person, × to take a connection off an agent), so a long table isn't a column of the same word. Each has `aria-label` and `title`.
6. An action is red if and only if it opens a confirm, and it gets a confirm if and only if one click cannot undo it.
7. The trigger is red text. The button inside the confirm is red fill only when the action loses data for good (Delete an agent or a connection). An action that can be done again (Remove a computer, whose agents move back here; Disconnect a model) keeps red text on the surface's background in its confirm too, no fill (owner, 2026-11-18). Red fill appears nowhere else.
8. A copy button confirms in place: `CopyButton` swaps its icon for a checkmark for 1.5s, no toast. Only a failed copy toasts.
8. On the page that manages an object (agent, connection), Delete is visible in the header, last, after a separator.
9. On a page that is not for managing the object (chat), destructive actions live in the ⋯ menu, last, after a separator, in red.
10. A header shows at most three buttons. A fourth sends everything but the primary and one secondary into ⋯. A ⋯ menu holds at least two items.
11. The trash icon means the thing is gone for good (Delete, Remove a person). Disconnect, Revoke and Unlink never use it.
12. Dialog footers: Cancel (secondary) left, the committing action (primary or danger fill) rightmost.
13. A state toggle (Stop/Start) is one button named for what it will do, with a swapping icon. As an icon in a header its glyph is tinted for what it does (owner, 2026-11-18): Stop in `--hue-red` (owner, 2026-11-27, was amber), Start in `--hue-green`.
14. A button that fires a mutation is disabled while it is pending. One that waits on an outside service also changes its label to "Connecting…".
15. Actions inside a sentence are links, never buttons.
16. **Banned: confirming in a popover** (owner, 2026-11-18). A confirm never floats over the trigger. A small action (an icon in a header, a row's pill) confirms in place, as Settings › Computers does: the trigger turns into a grey Cancel and a red action pill where it stood (red text, no fill, unless rule 7 calls for the fill), the line under it says what happens, and Esc or a click elsewhere cancels (`useConfirming` and `ConfirmIcon` in `components/confirm-button.tsx`). Where the line can't fit beside the pills (the agent panel), the status line under the name says it instead. Bigger destructive actions keep the `AlertDialog`.

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
| Agent | Connections | a checkbox per connection | only the agent's connections, × to remove, an Add menu for the rest |
| Connection | Remove (grant) | black word | × icon |
| Admin | row Set up / Edit / View | `btn row` 30px | ghost `sm` 28px |
| Admin | inline Cancel | white bordered beside a white bordered input | soft fill |
| Admin | Update now | primary `sm` (a second primary when a form is open) | secondary `sm` |

### Settings, by tier

Today every Settings action is a secondary pill, so Sign in and Manage look the same. Target:

| Page | Button | Today | Tier |
|---|---|---|---|
| General | Show folder | secondary | 3 ghost |
| General › Updates | Check now | secondary | 3 ghost |
| General › Updates | Download, Restart to update, Update | secondary | 2 secondary |
| Computers | Update (computer row) | secondary | 2 secondary |
| Computers | Remove (opens the confirm) | secondary | 3 ghost, red |
| Computers | inline confirm Cancel / Remove | secondary / destructive | 2 secondary / 3 ghost, red (no fill: a computer can be added again) |
| Models › provider | inline confirm Cancel / Disconnect | secondary / destructive | 2 secondary / 3 ghost, red |
| Computers | enrolment Try again / Remove | secondary / secondary | 2 secondary / 3 ghost |
| Models | Sign in, Add key (not set up) | secondary | 3 ghost (primary while nothing is connected) |
| Models | Manage (signed in or connected) | secondary | 3 ghost |
| Models › provider | Refresh models | secondary | 3 ghost |
| Models › provider | Disconnect / Sign out (opens confirm) | secondary | 3 ghost, red |
| Models › provider | Show all N | secondary | 4 text |
| Models › key form | Cancel / Connect | secondary / primary | 2 / 1 |
| Models › sign-in | Copy code / Open host | secondary / secondary | 3 ghost / 2 secondary |
| MCP | Copy (command, path) | secondary | 3 ghost |
| Admin | Edit, Set up | secondary | 3 ghost |
| Apps | Connect | secondary | 3 ghost |
| Settings | Back, Close | icon | icon (ghost) |

Outside Settings the same test holds: agent panel channels "Set up" is secondary until set up, then "Edit" is ghost; "+ Add" and "N connected ›" become text.

### Code

Every variant and size is in `components/ui/button.tsx` (`buttonVariants` for links styled as buttons). A destructive trigger is `ConfirmButton`, which opens the `AlertDialog`; overflow menus are `DropdownMenu` with `DropdownMenuItem variant="destructive"`.

### Dropdowns

A dropdown trigger (Model, Computer) follows the secondary button: soft fill, no border, darker fill on hover and while open. Triggers stacked in one card share a minimum width (136px) so their edges line up, with the icon and label on the left and the chevron on the right. Every option has an icon in the same column, then its name and a one-line description, then the tick; the trigger shows the chosen option's icon. A menu of things to add (connections on an agent) follows the same shape: icon, name, and a greyed-out reason when an option can't be chosen.

### Person avatars (owner, 2026-11-26)

Every person, everywhere (People, the sidebar, chat, Access, New agent, Telegram), is `PersonFace` (`components/custom/person-face.tsx`), never a hand-made circle: soft initials, a pastel circle with the initials in a deep shade of the same colour (two letters from 28px, one below). The colour comes from the email (a name when there is none), from 8 pairs, so a person looks the same on every screen. No face and no ink outline: faces are for agents, so a person never looks like an agent. GitHub accounts keep their real pictures. Options compared on claude.ai/artifact/2TPbuaNZADqJaZiHb87GKS.

### Tabs and filters (owner, 2026-11-26)

Tabs and filters use the line style by default (shadcn's `line` tabs, https://ui.shadcn.com/docs/components/base/tabs#line): words on no background, `--mute` at rest and `--ink` on hover and when picked, with a 2px ink line under the picked one. This is `ToggleGroup`'s default variant. The grey segmented control (`variant="segmented"`) is kept only for choosing a value inside a form (a person's role, how a connection signs in). A list that has a filter doesn't also get a search field unless it can grow past a few dozen rows.

### Checks before merging UI

- Labels, buttons and titles are short words, never sentences, and don't repeat the agent's name: "Delete", "What it does", "Memory", not "Delete Ops" or "What Ops does" (owner, 2026-11-27). The name goes in the `aria-label` ("Delete Ops"). Drop helper lines under a title or a field unless they prevent a mistake; the one place for a full sentence is a confirm's consequence line ("Delete Ops? Its chats, memory and skills go with it.").
- Pickers in one form share one fixed width; content left-aligned, text truncates, chevron pinned right.
- No layout shift: choosing an option, toggling a mode or adding items never changes the size of the row, card or popover (reserve check/icon slots, keep one-line subtitles).
- Loading never shows an empty state: while an agent or a thread loads, the panel and the composer hold their place as empty shapes, and "nothing here yet" copy waits until the data says so. The panel's browser preview appears only once a page is on screen.
- A preview shows the real state (the Access row shows exactly the picked people), never placeholders.
- One line of help at most; prefer a sensible default over explanatory text.
- No shadows, no nested borders.
- Popovers keep their side and size while open.
- One button per action on a screen — no empty-state button that repeats a header button.
- Moving between views inside a dialog swaps content; the dialog never closes and reopens. A dialog family (Settings and its Apps, Add a computer and its steps) renders one `Dialog` whose children change with the route; a dialog opened from inside another opens on top of it.
- Esc steps back one view before it closes anything: on a sheet inside a dialog (an app's connect sheet, a Models step) it clicks the view's back control (`data-back`) and returns to the list; only at the top view does it close the dialog. A dialog on top of another (Add key over New agent, Add a computer over Settings) closes alone.
- One icon per concept, same set, size and stroke everywhere: Hugeicons; a device is `deviceIcon` / `DEVICE_ICONS` from `lib/computers.ts` (laptop, server, browser, phone) in the Settings nav's blue, 20px in rows.

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

## Routines

Status: in the code since 2026-11-20 (owner). Screens: the "OpenHut Routines" artifact. Reviewed by UI, product, SRE, over-engineering and security reviewers to zero comments.

The agent owns its routines; the person looks (owner: "preferably the user would not interact with them"). No duplication, no yapping, concise, playful.

- **Panel.** One row under Skills: a clock icon, "Routines", and what's coming up ("3", "None yet"); stopped ones add "· [red dot] 1 stopped" (dot and ink text, never red text).
- **Dialog.** The Memory dialog's split layout. Header: face and "Routines", nothing else. Left: only what's coming up (no Done list), each a status circle (grey; amber spinner while running; red cross when the last run failed or it stopped), the name and one muted line: the next run ("Tomorrow at 10:00"), "Last check failed" or the stopped line. Right: the name over one line, "Weekdays at 10:00 · [brand glyph] #finance · until Dec 20"; the plan in the agent's own words beside its 28px face, no label; then, once it has run, "Last time · Today, 13:45" and what it said in the plan's column. No run history: a log is overkill. A failed run's text is neutral ("No answer in time."), with a red cross before it and ink text, since it sits beside the agent's face.
- **Actions.** Footer: "Want it different? Tell Dev." (a link inside a sentence) and one red **Stop** that confirms in place ("Dev won't run it again."). A stopped routine says "Want it running again?" and its button is **Clear** ("Takes it off the list."). No pause, no edit form, no "who asked".
- **Empty.** "No routines yet", nothing more. No example prompts: the agent sets them up, the person doesn't.

## The App

Status: in the code since 2026-11-17. Surface values are DuskBot's Daylight skin (`styles.css`, `[data-skin="daylight"]`), its Settings sheet (`styles/settings.css`) and Connect apps (`connect-apps.css`), translated to our tokens in `index.css`.

### Direction: playful identity, calm chrome

DuskBot's look (owner, 2026-11-17). Text and chrome are calm: ink text at a few sizes, small sentence-case titles, grey pill actions, white and light-grey surfaces, faint hairlines, no shadows except floating surfaces, no display font, no uppercase labels, no mono body copy. Personality comes from the things that identify something: agent faces, full-colour brand logos, status dots.

### Colour is for identity, not decoration

Owner, 2026-11-17, after a fully coloured pass read as too much.

- Colour only for identity: brand logos (Slack, WhatsApp, Telegram, Gmail, Claude, OpenAI, every app in Connections), agent faces, status dots (green running, amber starting, red failing, grey off). The Claude sparkle beside a model name is a brand mark and stays.
- Actions are plain: Stop/Start, Clear chat, Delete and every other icon button are 16px Hugeicons in ink at 1.6 stroke, 28 to 32px hit area, hover fill only. Two exceptions carry colour at rest (owner, 2026-11-18): Delete's trash is `--fail` (destructive red), and Stop/Start are amber/green as in rule 13. Every other icon button stays ink.
- Settings icons carry one soft tint each; everywhere else colour is identity only (owner, 2026-11-17). In the Settings nav and Settings rows each line icon's stroke takes one calm hue from the `--hue-*` tokens in `index.css` (about 65% of the bright brand chroma): General slate, Updates sky, Computers blue, Models violet, MCP teal; open at login green, keep awake and notifications amber, failures red, the data folder blue, usage violet. One colour per icon, no fills, no tiles. The app is light-only (`color-scheme: light`), so the hues have no dark variants yet; add them with the dark theme.
- Everywhere else row icons are plain line icons in `--mute`: the panel's rows (Model, Runs on, Memory, Skills, Browser, Run code), the chat and the sidebar.
- **No tinted backgrounds** (owner, 2026-11-19: "they look very sloppy"). No pastel row, card or icon-tile fills, no tinted pills, no coloured boxes behind a note. Surfaces are white or the grey `--soft` of a secondary button; a state like Added is a disabled ghost pill with a green tick, never a green fill.
- **The hut has moods** (owner, 2026-11-19), and a dialog that has a moment shows the one that fits it: `<Hut mood>` from `lib/hut.ts`: looking (finding computers), key (needs access), building (setting up), asleep (offline), worried (something stopped), party (it worked). The brand page lists the same six. The hut itself never floats or bobs: its eyes blink and its prop moves (the wrench turns, the key jiggles, the Zs rise), nothing else.

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

- **Sidebar.** 256px. The header is a plain **Agents** title (15px semibold, owner, 2026-11-27: no logo or wordmark) with Hide sidebar and New agent as borderless 32px icons with 8px corners and a hover fill only (`ICON_BUTTON` in `kit.tsx`). Agents only, no threads and no search. Each agent row is one line (owner, 2026-11-27, no message preview): a 40px face, the name (15px/20px medium, ellipsis; red when the agent is in trouble, its state in the tooltip), an 8px orange dot when a thread waits on you, and the time of the newest message rightmost (12.5px muted). No status dot: while the agent works, an 18px white badge with the 14px working spinner sits on the face. Rows have 8px 10px padding, 12px gap, 10px corners, `--picked` when open. Agents stay in the order they were made, oldest first: activity never reorders them. Agents on an offline computer are greyed and say "Offline". Bottom: a gear (Settings, ⌘,) and the Connections pill, both 40px. Collapsed (⌘\) the sidebar is hidden entirely: the traffic lights sit over the chat header, which gains expand and new agent right after them (84px in). ⌘1–9 opens the nth agent.
- **Update card** (owner, 2026-11-19: prominent, playful, not technical). Above the gear, a white card with a hairline (`UpdateEverything` in `update-pill.tsx`). The hut is its face, the one colour on it. While this Mac downloads, the hut hops along an ink `Meter` fed by the update's progress, titled in plain words ("Packing a few things", "Fixing up the hut", "Nearly there") over "0.4.0 · your agents keep working". Once ready: "All fixed up", "Version 0.4.0 is ready" and a full-width primary Restart ("Update and restart" when other computers are behind too; "Something new for you" and Update when only they are). Version only, no MB or percentage on screen; the full list of what updates is the button's tooltip.
- **Chat** (owner, 2026-11-27: no right panel). The chat takes the full width. Its header is 116px: centred at the top, the agent's 56px face over its name in a `--soft` pill (14px medium), which opens Setup; on the left the thread's title for any thread but the main one; on the right, 28px icons with tooltips, kept compact: Browser (globe), Threads, Setup (gear) and Clear chat (the eraser, always there, faded until there are messages, confirming in a dialog). A reply that ran one step shows that step as its own row (label, command, duration), not a summary over a single row. Messages, tool rows, cards, the date divider and the composer share one column, at most 840px wide, and flow from the top down. Every chat starts with a welcome from the agent, written like a reply: "Hey! I’m <name>." and what it does (or "Ask me anything, or tell me what my job is."); an empty chat is that welcome and the composer, with a muted line under the welcome when the agent can't answer yet (no model, offline, starting) and the raw error behind "Details". The composer is a `--sidebar` box with a 1px ink border, 22px corners and a soft shadow: the text on top (15px, two lines tall, growing to 240px), and under it attach on the left and the round filled ink send button with a white arrow on the right (faded until there is text). User bubbles are `--soft` with ink text, 12/12/4/12 corners. Files picked, dropped or pasted show as grey 28px chips above the row inside the composer; sent files are the same chips above the user's bubble, and a home path the agent writes in backticks renders as a chip too. An attached PNG, JPEG, GIF or WebP shows an 18px thumbnail in place of the icon (never SVG).
- **Agent replies** are GFM in `.msg-t` (`index.css`), quiet like the rest of the chat: 14px/1.5 ink, 8px after paragraphs and lists, 12px around blocks (code, tables, quotes, images), 4px between list items. Headings are barely above body: 15px (h1, h2) or 14px, semibold, 16px above and 4px below; bold is semibold too. Lists sit 20px in with `--mute` markers. A task list is a 14px read-only box per item (`--mid` hairline; done is an ink box with the app's tick, and the item goes `--mute` and struck through), never a greyed native checkbox. Tables are the app's table (`card.tsx`): 13px, tabular numbers, `--hair` row dividers only, a 12px `--mute` medium header with no fill, 6px 12px cells with the first column flush with the text; they fit their content and scroll sideways (on a phone cells don't wrap). Quotes are `--mute` text after a 2px `--mid` rule. Links are the Link variant: underlined, inherited colour, no hover change; a bare URL shows shortened with a 12px muted `ArrowUpRight01Icon`. Inline code is a 12.5px mono chip on `--soft` with 6px corners, in tables too. Images fit the column with 8px corners. A fenced block is `CodeBlock` (`features/threads/code.tsx`): a white card with a `--hair` border and 8px corners (no dark panel), a 36px head with the language as a 12px `--mute` label and a ghost `sm` Copy in `--mute`, then 12.5px mono highlighted by Shiki (loaded on first use, JavaScript engine, `github-light`; add a dark theme with the app's), plain until its tokens arrive so only colour changes. No literal colours anywhere in it. While a reply streams, `settled` (`features/threads/markdown.ts`) holds back a table until its delimiter row is in, so the header never flashes as a line of pipes, and lines an agent starts with "•" are read as list items.
- **Threads** (owner, 2026-11-27). **Threads** in the chat header opens a floating card on the right of the chat, 360 by 520 (shorter on a small window so it never covers the composer), 12px from the edge under the header, 16px corners, hairline, `shadow-pop`. While it is open the chat column and composer move left to make room, so it never covers the chat. It stays open until its × or the Threads button closes it (Esc too; never a click outside), and remembers being open. Inside: **Threads** (12px muted) with "+ New", "View all" and ×, then the thread list, scrolling, fading 56px at the bottom only while there is more below. "+ New" makes an empty web thread (`POST /api/threads`) and opens it. A thread row is one 38px line: a 16px status icon, the title (13px, ellipsis), the source icon (a globe for the web, Discord’s glyph, webhook, a clock with a circular arrow for a routine) and the age (12px muted); the open thread is `--picked`, and Archive replaces the source and age on hover (not on the main thread). Status icons: the main thread a ring with a filled centre in ink, working a spinning arc over a `--mid` ring, waiting on you an orange dot (`--wait`), idle a dashed `--mute-2` ring. On a phone, Threads opens a sheet with the same list. **View all** is a command palette (720 by 448, 24px corners): a borderless 15px search, "New thread" with ⌘J, and one flat list.
- **Browser** (owner, 2026-11-27). A globe in the chat header (when the agent has a browser) opens the browser as a floating card on the right, the same place and width as Threads; only one of the two is open at a time. The card: **Browser** · the site (12px muted) with a green live dot while the agent browses, Open full size and ×, then the live page (16:10, 8px corners) and a 12px caption of the agent's last action; when the agent isn't browsing, "Not browsing right now". It opens by itself when the agent starts browsing (unless Threads is open) and stays until you close it. The globe shows a live dot while the agent browses, and is `--picked` while its card is open. Open full size is the Take over dialog.
- **Setup dialog** (owner, 2026-11-27: the same window as Settings). The gear and the agent's name open it (`/agents/:id/setup/<tab>`), sized like Settings (`Dialog size="window"`). Its nav matches Settings': 198px `--sidebar`, items 7px 9px, 13px/18px, a coloured 18px icon each (General slate, Connections red, Channels blue, Memory violet, Skills amber, Routines green, Webhooks sky), no title above them. Each pane follows Settings: a 15px medium title over a 12.5px muted subtitle (a short phrase, no sentence), then a row with the count on the left (12px muted) and the pane's one primary on the right (ink pill with a + : Add app, Add for memory, Add webhook), aligned with the rows below. Rows are 42px, 13.5px, a 15px muted icon, the value or a switch on the right; row actions are ghost `sm` (Connect). General (owner, 2026-11-27: sections, not hairlines): the agent itself first (its 44px face, the name in 15px medium over "Name and picture", Edit ›, opening Customize on top), then sections with a 12px medium muted label: **Job** (What it does, Model), **Access** (Runs on, Who can use it), **Abilities** (Run code, Browser, Keys), **Activity** (Notify me, Activity) and **Stop or delete** (Stop/Start with the state on the right, rule 13; a red Delete that confirms in place). Connections: every team connection as a 54px row with a switch, and Add app over Setup as its own 440px dialog. Channels: Slack, Discord, WhatsApp, Telegram with a switch once connected, else Connect. Memory and Skills are one column (owner, 2026-11-27, no split views): the list fills the pane, and opening an item shows it full width with the pane title as a breadcrumb ("Memory › Note", "Skills › <skill>"; the first part goes back). A note has its text, then Remove, Discard and Save; a skill has Formatted / Plain text, Copy path and Delete over its text. Empty shows one "Nothing saved yet" / "No skills yet". Routines and Webhooks list what the agent has; an empty one shows a 44px soft icon tile and a 15px title.
- **Add an app** opens on top of Setup as its own 440 by 500 dialog over a lighter scrim (black at 18%, no blur): "Add an app" (17px semibold) and ×, one 40px search field on `--soft`, then the apps not connected yet as 54px rows (28px logo, name, one-liner, a ghost Connect). No filter tabs.
- **Skills and Memory dialogs** (owner, 2026-11-18; designs Skills B and Memory C on claude.ai/artifact/HPBKsBMj7Qvve2ZLDCiN1j): both are one wide split dialog, min(1080px, 100vw − 32px) by min(720px, 100vh − 48px). Skills: the list on the left (All / Learned / Built in, no search) and the picked skill on the right. Its header says the name once (15px), a "Built in · read-only" chip on built-ins, then Rendered / Source, a trash icon that confirms in place (learned only) and ×; under it the description and, only when it differs from the name, the path with Copy. Rendered drops the frontmatter and a first heading that repeats the name, with headings capped at 17px. Source is a borderless editor. The footer shows only while editing a learned skill: character count, Discard, Save. Drafts are kept per skill, so picking another skill never loses typing, and an unsaved one gets a dot in the list. Memory: People and Notes in one list on the left, never tabs and no search, and the picked entry in a roomy editor on the right. No usage meters or progress bars in Memory: the owner found them confusing. Entries are plain text, so grouping People by person would need a change to how memory is stored.
- **All threads** ("View all") is a command palette modeled on Grok's chat search: 720 by 448, 120px from the top, 24px corners, a hairline border. A borderless 15px medium search line ("Search <agent> threads"), a highlighted 40px "New thread" row with ⌘ J keys, a "Threads" label (14px medium muted) and one flat list, no date groups: 40px rows with 10px corners, the 16px status icon, the 14px title, the source icon and the age right-aligned in 14px muted, fading 48px at the bottom while there is more below. Arrow keys move the highlight, Enter opens it, ⌘J starts a thread.
- **Settings and Connections are dialogs** over the app, never pages, one fixed size so nothing jumps between tabs: DuskBot's sheet, min(900px, 100vw − 32px) by min(700px, 100vh − 96px), 12px corners, the app dimmed behind, Esc or the round × (32px, 10px from the corner) closes and returns to the agent that was open. The URL keeps `/settings/:tab` and `/connections/*`. Inside, the type is DuskBot's: 13px/18px body.
- **Final wording (settled in design review, 2026-11-18; don't reword).** General, "An agent stops or fails": "The Dock icon counts them either way." (Mac only, from `badgeNote` in `lib/platform.ts`; no line on Linux). "Keep this Mac awake": "The screen can still turn off. Agents can't answer while the Mac sleeps." ("the computer" on Linux).
- **Brand glyphs at one optical size.** In Settings rows every brand glyph is drawn at 20px; every provider uses its real logo, and Codex's mark carries a tighter `vb` in `brand-icons.ts` so it fills the box like the others.
- **Pane intros.** A pane opens with one full sentence ending in a full stop, only where it adds something the rows don't say. Computers: "Your agents run on these computers." MCP: "Let Claude Code or another app manage your agents." General and Models have none (Models starts at its Subscriptions label). Use `Intro` in `settings/kit.tsx`, nothing else; the first row sits 6px under it, the same as under a section label. A note that belongs to a list ("Keys stay on the computer you add them to.") is `ListNote`: 12px muted, about 11px under the last row's text, starting at the row-text edge.
- **Settings.** A 198px nav (16px 12px padding, 2px gaps, items 7px 9px, 8px corners, 13px/18px, `--picked` when selected) with General, Computers, Models, MCP. The pane title sits above the scroller (26px top, 34px in, 15px/22px medium); the pane scrolls with 18px 24px 40px padding and 36px between sections. Every tab uses one row (`Row` in `settings/kit.tsx`): a 24px icon slot, 16px gap, a 13px/18px title over a 12px/16px muted line, the trailing item flush to the same right edge (a chevron too), 48px minimum, 9px 10px padding. The icon and the trailing item centre on the title and its first line, so a row with a longer note keeps them at the top. Section labels are 12px muted, 10px in. Row actions are grey pills (26px, 12px text, 10px padding). Computers is one list, no detail pages and no expanding rows: each computer's line icon (laptop or server, soft blue) with its status dot, "Online · 4 agents · OpenHut 0.3.0" ("No agents" at none), "✓ Current" on This Mac and a grey "Remove" pill on the others, which confirms in the row itself: the second line becomes "Its agents stop and leave this list." and the pills become Cancel and a red Remove; Esc or a click elsewhere cancels. Updates live on the same rows: This Mac shows "Restart to update" once the app has downloaded one, and another computer that's behind shows an "Update" pill before Remove; "Add a computer" is a row with a plain plus in soft green. It opens the pairing dialog (below). Adding never blocks: picking a computer returns to the list at once, where it is one plain row: the server icon, its name, one word for where it is (Connecting…, Installing…, Starting…, Almost ready…) and a 14px spinner. No dot, no steps, no timer, no versions; the installer's output stays in the log. The install keeps running with Settings closed (main keeps its state); when it finishes the row becomes the normal Online computer. A failure gets a red dot, one plain sentence and a Try again pill beside Remove. An update in progress is the same plain row with "Updating…". Models: two sections of the same rows, Subscriptions (Claude, Codex) and API keys (OpenRouter, OpenAI, xAI), each with a brand glyph, a note ("On This Mac and beelink", or "24 models · 10 on · On This Mac" for a key), then "Signed in" or "Connected" with a Manage pill, or a Sign in / Add key pill. Add key and Codex's sign-in open a step inside the pane (`?open=<provider>`, back arrow, the Connections sheet's header and footer): a password field and "Put it on" ticks for a key, the device code with Copy and an Open link for Codex. Manage is the title with a back arrow, one head row (the masked key, where it is, when it updated, Refresh models and Disconnect or Sign out, which confirms in the row), a search field with an All / On segmented filter, and a switch per model (10 shown until Show all). The Model picker is a menu of providers: one row per connected provider (its logo, its name, and the model this slot uses or "3 models on", with a tick on the provider in use), and unconnected providers greyed under Not set up. Each provider's models open in a submenu beside it on hover, click or →: one 30px line per model with the model's own logo (the lab's, for OpenRouter), its name, its prices on the right ($ in / $ out, two significant digits under a dollar) or the plan's note for a subscription, and a tick; a hairline between labs; a search field pinned on top once more than 8 models are on; a footer saying prices are per million tokens. The submenu is 330px wide and grows to fit, up to the window's height; only its list scrolls, never the search or the footer. The panel has one Model row: an agent has one model for everything, its background jobs included (owner, 2026-11-20); there is no Fallback and no helper models. New agent has Model. "Claude this week" appears only once an agent has used it, with the 5-hour and weekly usage beside the label. MCP: one row per computer, named like on Computers (the suggested server name is the computer's name, prefixed with "openhut-" only when it doesn't already say openhut), its command as a 12px muted mono line that wraps only between arguments (a quoted path stays whole with the "--" before it, and a flag with its value; never truncated, mono never above 12px) and a text-only "Copy" pill; Other apps shows the bridge path the same way with its sentence 4px under it; a computer reached through this one adds "Works while OpenHut is open on this Mac." Models: the Claude row's second line is only where it is signed in ("On This Mac and beelink"); General ends its first list with "OpenHut 0.1.1" over "Updates download on their own." ("Ready to install." once one has downloaded) and a green "Up to date" status or the "Restart to update" pill. A home folder shows as ~, outside any quotes (~/"Library/…"), so a shown command still works when typed; Copy always copies the full path.
- **Your devices** (owner, 2026-11-18): one Settings tab, not Computers and Devices. Two groups named by what they do: "Run your agents" (this Mac, servers; This Mac appears only here) with Add a computer, and "Chat with your agents" (phones) with Add a phone. Old /settings/computers and /settings/phones links open it.
- **Pairing opens its own dialog** (owner, 2026-11-18: "much better than this thing where you have to go back"). The one exception to steps opening inside the pane: Settings › Your devices › Add a phone and › Add a computer each open a narrow dialog (560px, 12px corners) over Settings, titled with the row's name, with × and Esc closing it back to the list. It goes through three states in place, never a back arrow: waiting (a phone gets a 216px QR beside three numbered steps; a computer gets the join line with Copy), with a spinner and "Waiting for your phone…" or "Waiting for it to join…" over "The code works once, for 5 minutes."; Allow, with "Allow "<name>"?", the six digits at 44px in two groups of three and one line on what to check (Allow closes the dialog and the new device or computer is just there in the list, like any other row: no celebration on the Mac, owner 2026-11-18; the celebration is the phone's); and expired, "This code expired" with Make a new code. Footers follow rule 12: Cancel or Don't allow on the left, the one primary (Allow, Make a new code) on the right; waiting has no primary.
- **Channel setup** (Slack, WhatsApp, Telegram) uses the same sheet as a connection: brand logo, a 15px sentence-case title, one 13px line, flat numbered steps with one line of instruction and the action each, grey pills, and at most one muted line in the footer. No mock chats or transcripts, no mono except tokens and IDs. Who can message an agent is one field of IDs or numbers (the first is the owner); there is no "anyone" mode in the app.
- **GitHub setup is one dialog** (owner, 2026-11-26). Set up opens the owner (its GitHub avatar shows as you type) and a prefilled name; Continue on GitHub opens one popup where GitHub creates the app and goes straight on to installing it, while the dialog advances in place: "Creating app…", "Installing…", then the Manage view. Manage is the app's avatar, "<slug>[bot]" and "on <owner>", one line "Installed on N repositories" linking to GitHub (one primary Install on GitHub at 0), a red Remove that confirms, and a small "Add an avatar on GitHub"; × closes it. Progress uses skeletons, not spinners, and the dialog keeps its top edge while its height changes. A blocked popup shows an Open GitHub link; a closed one says "GitHub closed before it finished." with Try again.
- **Connections.** DuskBot's Connect apps: 22px 32px 28px padding, a 17px/24px title 52px from the top (below the ×) with a 12px muted "N connected ›" on the right (shown at 0 too; it filters to the connected ones), a search field ("Search apps"), a search field, category chips (28px, 13px, 10px padding, 8px apart, selected one black), 12px muted group labels with 28px under them, and a two-column grid of 64px rows (24px logo, 13px medium name over one 13px muted noun line with no full stop and no "as you", a 96px grey "Connect" pill centred on the text). With more than one computer, each connection is listed once with a small chip per computer (grey dot when offline). A connection's sheet replaces the dialog's body with a back arrow; a sheet that creates something asks "Put it on" (computers with agents ticked) right under its name field.

## Where agents run

Status: in the code since 2026-11-19 (owner). Screens: the "Where agents run" artifact. The Linux app runs agents the same way since 2026-11-23, so it shows the same words.

From 0.4.0, agents on This Mac (or a Windows or Linux PC) are plain processes that run as the person: they can open what the person can open, the home network included. Agents on a Linux server each run in their own sandbox. The app says so where people look at an agent first (owner, 2026-11-19: "maybe at the agent level?"), then on the computer, at first run and once after the update. The words are calm and factual: no warning colour, no "unsafe", no "sandbox off".

### Words

| Where | This Mac / this PC | A server |
|---|---|---|
| Line under Runs on (agent panel) | Runs on this computer like any app, with your access. | Runs on beelink, sealed in its own box. |
| Runs on menu, option note | With your access · while this computer is awake | Sealed in its own box · always on |
| Settings › Devices, row note | Agents have your access · 2 agents · OpenHut 0.4.0 | Each agent sealed in its own box · 1 agent · OpenHut 0.4.0 |
| Add a computer, row note | A Linux computer that stays on seals each agent in its own box and keeps answering while this computer sleeps. | |
| Getting ready | Agents run on this computer like any app you install, with your access. | |
| Getting ready, the three marks | With your access · Keys in the macOS Keychain · Add a computer anytime | |
| First run, third step | Setting up agents · ready | |

"Mac" follows `WORDS.here` ("computer" on Windows and Linux).

### Rules

1. Every agent says where it runs and what that means, in one 12px muted line under its Runs on row. It is the only place the agent page talks about this.
2. The Runs on menu repeats it in each option's note, so moving an agent shows the trade before it happens.
3. An agent on This Mac that is connected to Slack gets one note under that line: a `--tint` box with 12.5px `--body` text, "Dev is in your team's Slack. For team use, run it on a server.", and one tier-4 text action: "Move to beelink" when a server is online (it moves the agent in place, like the menu), else "Add a computer". No dismiss and no colour; it goes away when the agent moves or Slack is disconnected. WhatsApp and Telegram are personal chats and don't show it.
4. The sidebar doesn’t say where an agent runs; Setup › General › Runs on does.
5. Settings › Your devices puts the trade in each computer's note instead of "Online": the status dot already says online, and an offline row still says "Offline".
6. Never in user copy: sizes, "srt", "Seatbelt", "gVisor", "unsafe", "risk", "exposed". "Sandbox" is fine for the server side.

### What changes, by page

| Page | Control | Before | After |
|---|---|---|---|
| Agent panel | under Runs on | nothing | one muted line, rule 1 |
| Agent panel | Runs on menu notes | Only while this Mac is awake / Always on | Runs as you · while this Mac is awake / Its own sandbox · always on |
| Agent panel | agent on This Mac in Slack | nothing | tinted note with Move to beelink or Add a computer, rule 3 |
| Settings › Your devices | This Mac note | Online · 2 agents · OpenHut 0.3.2 | Agents run as you · 2 agents · OpenHut 0.4.0 |
| Settings › Your devices | server note | Online · 1 agent · OpenHut 0.3.2 | Each agent in its own sandbox · 1 agent · OpenHut 0.4.0 |
| Settings › Your devices | Add a computer note | An always-on Linux computer keeps agents answering while this Mac sleeps. | A Linux server gives each agent its own sandbox and keeps answering while this Mac sleeps. |
| Welcome | line | Each agent gets its own sealed computer. … | Agents run on this Mac, as you, like any app you install. … |
| Welcome | marks | Sealed per agent · Keys in the Keychain · About 1 GB of memory per agent | Runs as you · Keys in the Keychain · Add a server anytime |
| First run | third step | Agent runtime and network fence · 6 of 6 checks passed | Agent runtime · ready (Mac and Windows) |
| After updating from 0.3.x | dialog | none | rule 6 |
