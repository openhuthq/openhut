# Design

How the dashboard (`packages/web`) looks and why. The stylesheet is `packages/web/src/index.css`; this file is the rules behind it.

## Buttons

Status: in the code since 2026-11-13.

### Why the bordered white button goes

The old secondary was a white fill with a grey border and black text. The border existed only because the fill matched the card behind it, and next to an input it read as a second field. The brand is monochrome (`--primary` is ink black), so "primary-coloured text, no border, white fill" would be a plain label with nothing to say it can be clicked. The secondary instead gets a fill that differs from every surface: `--soft` (black at 6%). It reads as a quiet grey chip on the canvas, on cards and in dialogs, and needs no border.

Rejected: adding an accent colour so borderless accent text could carry the secondary. It rebrands a deliberately monochrome product to fix one button.

### Variants

| Variant | Class | Rest | Hover | Use for | Never for |
|---|---|---|---|---|---|
| Primary | `btn primary` | fill `--primary`, white text | fill `--primary-hover` | the one action the view exists for: create, save, connect, allow | navigation, row actions |
| Secondary | `btn sec` | fill `--soft`, text `--ink`, no border | fill `--hair` | every other action that should look like a button: Cancel, Chat, Stop/Start, Retry, external links, labelled Copy | destructive actions |
| Ghost | `btn` | transparent, text `--ink` | fill `--soft` | row actions, toolbar actions, the close X | the only action in a view |
| Danger | `btn danger` | transparent, text `--fail` | fill `--fail` at 8% | the trigger of a destructive action | anything not behind a confirm |
| Danger fill | `btn primary danger` | fill `--fail`, white text | same, slightly darker | only the final button inside a confirm dialog | everywhere else |
| Icon-only | add `icon` | square, transparent, icon in `--mute` | soft fill, icon in `--ink` (red with `danger`) | Close, Toggle sidebar, Rename, More (⋯), Send/Stop, and the one repeated action of a table row | any action without a universally known glyph |
| Link | `a`, `linkbtn` | underlined, inherited colour | none | an action inside a sentence | standalone actions |
| Overflow menu | `.menu`, `.menuitem` | ghost icon trigger (⋯) | `--tint` highlight | two or more rare actions in a header | a single item, or the primary |

All variants share: active `scale(.96)`, the global 2px focus ring, disabled at 50% opacity with no hover change.

Two sizes. 32px (default) in page headers, dialog and popover footers, empty states. 28px (`sm`) inside cards, rows, tables, inline forms, setup steps and chat. The 44px sign-in button and the 34px composer send button are the only exceptions.

### Rules

1. A layer (page, dialog, popover, open inline form) has at most one primary.
2. A row never holds a primary. Row actions are ghost `sm`.
3. Every button in one toolbar has the same anatomy: all icon + label, or all label only.
4. Header buttons are icon + label. Row, footer and inline-form buttons are label only, except the external-link and copy icons.
5. Icon-only is for Close, Toggle sidebar, Rename, More, Send/Stop, and a table row's single repeated action (trash to remove a person, × to revoke an invite or take a connection off an agent), so a long table isn't a column of the same word. Each has `aria-label` and `title`.
6. An action is red if and only if it opens a confirm, and it gets a confirm if and only if one click cannot undo it.
7. The trigger is red text; the button inside the confirm is red fill. Red fill appears nowhere else.
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
| Everywhere | Cancel, and every `btn sec` | white, grey border | soft grey fill, no border |
| Everywhere | confirm dialog action | white, bordered, red text (same as its trigger) | red fill |
| Everywhere | ghost buttons (close X, sidebar toggle, row actions) | no hover state | soft fill on hover |
| Everywhere | labelled copy chips (Copy SQL, Copy manifest) | mono bordered chip | secondary `sm`; a chip that shows the copied value stays |
| Agents | Copy prompt | primary (second primary on the page) | secondary |
| Agent | Chat | white bordered | secondary |
| Agent | Stop / Start | white bordered, amber or green text | secondary, no colour |
| Agent | Delete | white bordered, red text | red text, no border |
| Agent | skill Edit / View | bordered `sm` | ghost `sm`, same as the channel rows |
| Agent | channel Set up / Edit, Disconnect | `btn row` 30px | ghost `sm` 28px, Disconnect red |
| Chat | Clear | visible ghost button | "Clear chat" in the ⋯ menu |
| Chat | Delete agent | not on this page | red item in the ⋯ menu, same confirm as the agent page |
| Chat | Settings | ghost 28px | ghost 32px, stays visible |
| Chat | composer Stop | white with ink border | ink fill, white square |
| Chat | "Open agent settings" (empty state) | secondary | primary, labelled "Settings" |
| Connection | Delete | white bordered, red text | red text, no border |
| Tailscale | Disconnect | trash icon | label only |
| People | Remove (person) | black word, though it confirms | trash icon, red on hover |
| People | Revoke (invite) | black word | × icon |
| People | Invite popover | role select, link shown in a page banner | role cards, then the link and Copy link inside the popover |
| Agent | Connections | a checkbox per connection | only the agent's connections, × to remove, an Add menu for the rest |
| Connection | Remove (grant) | black word | × icon |
| Admin | row Set up / Edit / View | `btn row` 30px | ghost `sm` 28px |
| Admin | inline Cancel | white bordered beside a white bordered input | soft fill |
| Admin | Update now | primary `sm` (a second primary when a form is open) | secondary `sm` |
| Invite | Sign in instead | secondary, though it is the only action | primary |

### CSS

Classes that go: `.btn.ghost` (the base becomes the ghost), `.btn.stop`, `.btn.go`, `.btn.row`, `.btn.tight`, `.send.stop`, the unused `.tries`. Classes added: `.btn.icon`, `.menuitem.danger`. No new tokens.

```css
.btn{background:transparent}
.btn:hover:not(:disabled){background:var(--soft)}
.btn.primary{background:var(--primary);color:#fff}
.btn.primary:hover:not(:disabled){background:var(--primary-hover)}
.btn.sec{background:var(--soft)}
.btn.sec:hover:not(:disabled){background:var(--hair)}
.btn.sm{height:28px;padding:0 10px;font-size:13px}
.btn.icon{width:32px;padding:0;justify-content:center}
.btn.icon.sm{width:28px}
.btn.danger{color:var(--fail)}
.btn.danger:hover:not(:disabled){background:oklch(55% .185 27 / .08)}
.btn.primary.danger{background:var(--fail);color:#fff}
.btn.primary.danger:hover:not(:disabled){filter:brightness(.92)}
.menuitem.danger,.menuitem.danger svg{color:var(--fail)}
```

### Dropdowns

A dropdown trigger (Model, Computer) follows the secondary button: soft fill, no border, darker fill on hover and while open. Triggers stacked in one card share a minimum width (136px) so their edges line up, with the icon and label on the left and the chevron on the right. Every option has an icon in the same column, then its name and a one-line description, then the tick; the trigger shows the chosen option's icon. A menu of things to add (connections on an agent) follows the same shape: icon, name, and a greyed-out reason when an option can't be chosen.

### Known trade-off

A ghost button at rest is bare text. In a row ("Set up", "Remove") that is the convention and the hover fill confirms it, but it is the weakest affordance in the system. If rows test badly, promote row actions to secondary `sm` rather than bringing the border back.
