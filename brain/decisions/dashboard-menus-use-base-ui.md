---
status: superseded
---
# Dashboard menus use Base UI, styled by our own CSS

Superseded on 2026-11-16 by `dashboard-uses-tailwind-and-shadcn.md`.

## Decision
Dropdown menus in the dashboard are `@base-ui/react/menu`, styled with classes in `index.css` (`.menu`, `.menuitem`, `.menuhead`, `.menusep`). The first one is the account menu at the bottom of the sidebar: the whole row is the trigger, and the menu holds the person and Log out.

## Context
Owner, 2026-11-13: the sidebar row with a bare sign-out icon looked odd; use the dropdown from shadcn's sidebar (`NavUser`), as Skyfleet does.

## Why
Skyfleet's shadcn dropdown is a wrapper over Base UI's Menu. The dashboard has no Tailwind (the approved design is its CSS), so we take the same primitive for focus, keyboard and positioning, and skip shadcn's Tailwind classes.

## Consequences
New menus reuse the `.menu*` classes. Tailwind and the shadcn CLI stay out of `packages/web`.
