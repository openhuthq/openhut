---
status: accepted
---
# The dashboard uses Tailwind and shadcn components

## Decision
`packages/desktop/src/renderer` styles with Tailwind CSS v4 (theme and utilities, no Preflight) and shadcn's Base UI components, copied into `src/components/ui/` and adapted with `cva` variants so each current look is a named `variant` or `size`. Screens in `features/` and `app/` build from those components and utilities; `index.css` keeps only tokens, base element rules and a few scoped blocks.

## Context
Owner, 2026-11-16, after an audit of the stylesheet: every style was a short global class in one 716-line `index.css`, and the same row, segmented control, dropdown and heading had grown up to four versions because nothing was shared. This replaces `dashboard-menus-use-base-ui.md`, which kept Tailwind out.

## Why
Shared components with typed variants stop new one-off classes, and shadcn's components sit on Base UI, which the dashboard already used for menus. The switch kept every pixel: each existing look became a variant, checked by screenshot diffs at 1440 and 390px. Unifying the duplicate looks is a later, deliberate change.

## Consequences
- Tokens live in `@theme` in `index.css`; app names (`text-mute`, `bg-soft`, `border-hair`) and shadcn aliases both resolve to them. No dark mode.
- Generated shadcn code is adapted, not pasted: no `size-4` icon sizing, no focus-ring utilities (the global 2px ring stays), no `/NN` on translucent tokens, `scale-[.96]` on press, our keyframes instead of tw-animate.
- Dialogs, sheets and popovers are controlled by the URL. Native radios stay inside `RadioGroup` so uncontrolled forms and `:has()` toggles keep working. Toasts stay `lib/toast.ts` and tooltips stay `title`.
- The sidebar follows shadcn's: under 900px (`useIsMobile`) it is a left sheet opened by the page's trigger and closed by any link in it, which is the one dialog not in the URL; on desktop ⌘B or Ctrl+B collapses it with a slide and the `sidebar_state` cookie remembers it (2026-11-17).
- `test/ui-conventions.test.ts` keeps raw controls and inline styles out of screens.
