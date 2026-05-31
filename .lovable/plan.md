
## Stage 1 — Browserbase-style preview shell

Goal: build the static UI shown in the screenshot. No agent logic, no SEO/CRO analysis yet — just the chrome the agent will later drive. Default URL: `https://glutenforum.se/`.

### Layout

```text
┌─────────────────────────────────────────────────┐
│ ● Tab: "glutenforum.se"                         │ ← tab strip
├─────────────────────────────────────────────────┤
│ ← →  ⟳   [ https://glutenforum.se        ] 🖱 │ ← URL bar
├─────────────────────────────────────────────────┤
│                                                 │
│         (site viewport / iframe area)           │ ← main preview
│                                                 │
├─────────────────────────────────────────────────┤
│ Console                                         │
│ 23:27:00  [v3-piercer] installed {...}          │ ← log rows
│ 23:27:05  Browserbase keeping connection alive  │
└─────────────────────────────────────────────────┘
```

### Scope of this stage

- Single route: `/` (replace placeholder in `src/routes/index.tsx`).
- Top tab strip with one tab showing the current page title (placeholder text for now).
- URL bar:
  - Back / forward / reload icon buttons (visual only).
  - Editable input, default `https://glutenforum.se/`. Pressing Enter updates the viewport `src`.
  - Right-side cursor-mode icons (visual only).
- Viewport area:
  - Renders the URL in an `<iframe>`, fills available vertical space, subtle border like screenshot.
  - Fallback message when the target site blocks framing (X-Frame-Options / CSP).
- Console panel:
  - Fixed-height, scrollable, monospaced.
  - Seeded with mock log rows matching the screenshot (`[v3-piercer] installed …`, `Browserbase keeping connection alive`, `browserbase-solving-finished`, JSON event row), right-aligned timestamps.
  - In-component array for now — real log streaming comes later.

### Components

- `src/components/browser-shell/BrowserShell.tsx` — overall vertical layout
- `src/components/browser-shell/TabStrip.tsx`
- `src/components/browser-shell/UrlBar.tsx` (controlled input, Enter → update iframe `src`)
- `src/components/browser-shell/Viewport.tsx` (iframe + framed-blocked fallback)
- `src/components/browser-shell/ConsolePanel.tsx`

Use shadcn `Input`, `Button`, `ScrollArea`, and `lucide-react` icons (`ArrowLeft`, `ArrowRight`, `RotateCw`, `MousePointer2`). All colors via semantic tokens in `src/styles.css` (no hardcoded hex).

### Out of scope (later stages)

- Real headless browser / Browserbase integration
- Live console streaming
- SEO / CRO agent runs, reports, scoring
- Auth, persistence, Lovable Cloud
