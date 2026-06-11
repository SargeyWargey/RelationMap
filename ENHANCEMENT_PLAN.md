# RelationCity Enhancement Plan

> **Purpose:** A phased, multi-agent enhancement pass over the app. Each workstream below is
> self-contained, owns an exclusive set of files, and can be executed by an independent agent
> **in parallel** with the others. Phase 2 (verification) runs after all Phase 1 workstreams land.
>
> **Generated from a 4-way audit** (Sphere, City, landing/theme, security/data layer) on 2026-06-10.

---

## Ground Rules (every agent must follow)

1. **File ownership is exclusive.** Only edit files listed under your workstream. If a fix
   requires touching another workstream's file, note it in your final report instead of editing.
2. **Theme consistency is sacred.** All colors come from CSS custom properties in
   `app/globals.css` (`var(--accent-warm)`, `var(--panel-bg)`, …). The brand guide is
   `docs/color-scheme.md` — warm solarized palette, Lora/Geist/DM Mono, house easing
   `cubic-bezier(0.32, 0, 0.15, 1)`. Do not introduce new hardcoded hex colors.
3. **No new npm dependencies.** Hand-roll validation, rate limiting, etc.
4. **Simple pixel values** for UI layout (per CLAUDE.md) — no clever calc chains.
5. **Don't run `npm run dev` or `npm run build`** (parallel agents would collide on `.next/`).
   Verify with `npx tsc --noEmit` and by re-reading your edits.
6. **Layout algorithms stay pure** — visual changes go in canvas components, not `lib/*Layout.ts`
   position math. Do not change how items are distributed in space (existing coordinate systems
   are intentional).
7. When removing code, grep for every variable declared in the removed block before finalizing.

---

## Phase 1 — Parallel Workstreams

### Workstream A — Landing Page & Theme Foundation

**Owns:** `app/page.tsx`, `app/layout.tsx`, `app/globals.css`, `components/ThemeProvider.tsx`,
`components/ParallaxMountainBg.tsx`, `public/*.png` (recompression only)

**A1. Fix dark-mode flash (FOUC) — HIGH.** `ThemeProvider.tsx` reads localStorage in a
`useEffect`, so a dark-mode user sees a light flash every load. Add a tiny inline
`<script>` in `app/layout.tsx` `<head>` that synchronously reads
`localStorage.getItem("theme")` (fall back to `prefers-color-scheme`) and sets
`data-theme` on `<html>` before first paint. Add `suppressHydrationWarning` to `<html>`.
Make `ThemeProvider` read the same key/values so they stay in sync, and add a
`storage` event listener so theme syncs across tabs.

**A2. Responsive landing layout — HIGH.** `app/page.tsx:293-321` hardcodes hex radius
`r = 140` producing a ~1220×945px fixed canvas — overflows/clips on smaller windows.
Measure the viewport (resize listener or `useSyncExternalStore`) and scale the whole
honeycomb: compute a scale factor `s = min(1, vw/1280, vh/1000)` and apply
`transform: scale(s)` to the cluster container (keeps all internal pixel math intact —
simplest correct fix). Below ~700px width, switch to a simple vertical stack of hex tiles
(scrollable) instead of the absolute-positioned cluster.

**A3. Staggered entry animation — MED.** All hexes currently fade in at once
(`animate-fade-up` on the cluster). Move the animation to each tile with
`animationDelay: i * 60ms` cascade (logo first). Use the existing `fadeUp` keyframes.
Add a subtle idle treatment so the page feels alive — e.g. a very slow ambient drift on the
`ParallaxMountainBg` even without mouse movement (respect `prefers-reduced-motion`).

**A4. Accessibility — HIGH.** Hex tiles: add `aria-label` ("The City — navigate your data")
on each `Link`, visible `:focus-visible` ring (2px `var(--accent-warm)`, offset 2),
keyboard activation already works via Link but focus state is invisible. Give the
Configure / dark-mode buttons `aria-label`s and focus styles. Meaningful `alt` text on
the logo image; mode icons can stay `alt=""` (decorative, title is adjacent text).
Add `role="navigation"` + `aria-label="Visualization modes"` on the cluster.

**A5. Image weight — MED.** `public/` PNGs total ~12MB; landing displays them at 36–80px.
They ARE tracked in git (recoverable). Recompress in place with macOS `sips`:
`sips -Z 320 <file>` for each landing icon (`GraphIcon2.png`, `CityLightMode.png`,
`mountain.png`, `UserIcon.png`, `library.png`, `universe.png`, `PimaryIcon.png`).
Verify each file still loads (non-zero size, `sips -g pixelWidth`). Do NOT touch
`bean.png`/`hog.png`/`CityIcon.png`/`SphereIcon.png` without checking usage first —
grep for usages; if used elsewhere at large sizes, use `-Z 640`.

**A6. Font loading — LOW.** Keep the Google Fonts `@import` (it's the documented brand
mechanism) but add `<link rel="preconnect" href="https://fonts.googleapis.com">` and
`<link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous">` in
`app/layout.tsx`.

**A7. Theme token additions — LOW.** Add to `globals.css` both themes:
`--accent-warm-glow` (rgba of accent at ~0.35) and `--accent-warm-soft` (~0.18) so other
code stops hand-rolling `rgba(224,122,53,…)` (which is the WRONG orange — brand is
#D97757/#DA7756). Replace the hardcoded `rgba(224,122,53,…)` instances inside
`globals.css` (`dbPanelFlash` keyframes, lines ~160-166) and `app/page.tsx` hover glows
with the new tokens. Also add a `:focus-visible` global default per the brand guide.

**Acceptance:** no FOUC on reload in dark mode; landing usable at 1024×768 and 390px wide;
`npx tsc --noEmit` clean; all images load; tab key visibly walks the tiles.

---

### Workstream B — The Sphere (`/graph`)

**Owns:** `components/GraphCanvas.tsx`, `components/ProjectGraphScreen.tsx`,
`lib/graph/layout.ts`

> Architecture note: GraphCanvas is **SVG-based** (custom quaternion math, no Three.js).
> Projection happens in a `useMemo` keyed on `[simNodes, rotation, zoom, size]`.

**B1. Hover-render decoupling — HIGH.** `distanceMap` BFS (GraphCanvas.tsx:698-717) is
memoized on `[localSelectedId, graph.edges, deepHighlight]` but recomputes more than
needed. Memoize the BFS purely on `[localSelectedId, graph.edges]`; derive
deep-highlight filtering in a cheaper downstream memo.

**B2. Projection hot path — HIGH.** In the projection memo (~line 748): hoist
`sphereRadius`, `cx`, `cy` computation once per render instead of recomputing
`Math.min(size.w, size.h) * SPHERE_FILL_RATIO * zoom` in multiple places (lines ~857,
871, 931). Avoid re-sorting all nodes every rotation frame if a cheaper stable approach
works (e.g. sort in place reusing the previous array; do NOT change paint-order
semantics).

**B3. RAF + listener hygiene — HIGH.** Selection animation effect (~line 619-683) never
cancels `animFrameRef` on unmount — add cleanup. Make `onTouchStart` read rotation from
`rotAtDrag.current` like the mouse handlers do, removing `rotation` from its deps
(line ~800) so touch handlers aren't recreated every drag frame.

**B4. Depth atmosphere — VISUAL.** Back-of-sphere nodes currently fade only by opacity.
Add depth-based color temperature: back nodes desaturate/cool slightly, front nodes
full warmth — compute per-node via depth factor, keep within existing palette. Strengthen
the sphere outline subtly (current opacity 0.35 is nearly invisible).

**B5. Edge glow — VISUAL.** Edges are flat 1-2px strokes while nodes glow. Add an SVG
`feGaussianBlur` filter layer: render selected/related edges twice (blurred underlay at
low opacity + sharp stroke) so active connections bloom like the nodes do. Keep
non-highlighted edges single-pass (perf).

**B6. Zoom easing — VISUAL/LOW.** Wheel zoom snaps instantly. Animate zoom toward target
over ~120ms with ease-out (rAF), matching the house motion feel.

**B7. Cursor + hints — UX.** Grab cursor should apply over the whole SVG sphere area
(currently only effective once drag starts — `.graph-canvas` class exists in globals.css,
ensure it's applied to the SVG/container). Add `Q` / `E` keyboard hints to the controls
hint bar in `ProjectGraphScreen.tsx` (they toggle the database/details panels but are
undocumented). Style as `<kbd>`-look spans in DM Mono, matching existing hint styling.

**B8. Cleanup — LOW.** Remove dead `EMPTY_ICON_SCALE` (line ~52). Name the magic numbers
in the intro animation (`Math.PI/12`, `Math.PI/15`, `0.9999` quaternion threshold,
cubic-out easing) as top-of-file constants. Replace hardcoded `rgba(224,122,53,…)` /
`#f97316` in BOTH owned files with theme vars (`var(--accent-warm)`,
`var(--accent-warm-glow)` — Workstream A is adding the glow tokens; safe to reference).

**Acceptance:** rotation drag stays smooth with 500 nodes; no console errors on
mount/unmount cycling; selection glow + edge bloom visible; `npx tsc --noEmit` clean.

---

### Workstream C — The City (`/project-city`)

**Owns:** `components/CityCanvas.tsx`, `components/ProjectCityScreen.tsx`,
`lib/cityLayout.ts` (read-only — layout math must not change)

> Architecture note: scene builds once per `[graph, darkMode]` in one big useEffect;
> mode flags (firstPerson/flyover/labels) sync via separate effects without rebuilds.
> `stateRef` holds a large SceneState. Animation loop handles FP physics + flyover.

**C1. Shared geometry/material — HIGH PERF.** Lines ~933-951: every building allocates
its own `BoxGeometry` + `EdgesGeometry` + materials. Use ONE unit `BoxGeometry(1,1,1)`
+ one shared `EdgesGeometry`, scale per-mesh via `mesh.scale.set(w, height, w)`.
Materials: per-color shared material cache (`Map<string, Material>`) instead of
per-building instances — buildings only differ by color/opacity state. NOTE: selection
highlighting mutates material opacity per building, so either keep per-building face
materials but share geometry (safe minimum), or move highlight state to per-mesh
material clones only while selected. Choose the safe option; verify selection dimming
still works per-building.

**C2. Texture/material disposal — HIGH PERF (leak).** Cleanup (~lines 1579-1582)
disposes sprite materials but never `mat.map` (the `CanvasTexture`). Dispose textures on
teardown. Also call `releaseWeb(s)` when exiting first-person mode (~line 1625-1632) so
web line geometry can't leak across FP sessions.

**C3. Per-frame allocation removal — MED PERF.** Animation loop allocates `Vector3`s every
frame (lines ~1234-1235 FP movement, ~1253-1258 web swing). Add reusable scratch vectors
to SceneState (`_fwd`, `_rgt`, `_toPlayer`, `_vel3`, …) and `.set()` them in place.

**C4. Spatial grid for collision — MED PERF.** FP floor/collision checks iterate ALL
buildings every frame (~lines 1306-1317). Build a `Map<string, node[]>` grid (cell ≈ 3×
building base) once during scene setup; query only the player's cell + neighbors.

**C5. Raycast cache — LOW PERF.** Click handlers rebuild
`[...buildingMap.values()].map(b => b.face)` per click (~988, ~1035). Cache the faces
array once at scene build.

**C6. Atmosphere — VISUAL.** Add subtle distance fog (`scene.fog = new THREE.Fog(...)`)
tuned per theme (cream haze in light, deep neutral in dark) so the city fades at the
horizon instead of hard-stopping; pick distances that don't obscure the city from the
default orbit position. Add a soft vertical gradient background (canvas-generated
texture or large gradient sphere) instead of the flat clear color — keep within palette.

**C7. Hover feedback — VISUAL/UX.** Buildings give zero feedback until clicked. Add
pointer-move raycast THROTTLED (e.g. every 3rd frame or on mousemove with 30ms throttle,
orbit mode only): hovered building brightens face opacity slightly + cursor becomes
pointer. Reuse one Raycaster instance.

**C8. Movement feel — VISUAL/UX.** FP movement is instant-velocity. Add short
acceleration/deceleration lerp (~0.1s), clamp max fall speed (~15 u/s), and a very subtle
head-bob while walking (sine on camera Y, amplitude ≤ 0.05, disabled while jumping —
and skip if it fights existing mechanics). Keep web-swing physics untouched.

**C9. HUD hints + orientation — UX.** Controls hint (ProjectCityScreen.tsx ~907-931) is
incomplete in FP mode: add `space = jump` (when jump enabled), `right-click = web`
(when web enabled), `esc = exit`. Add a small "return to center" affordance: if player
distance from origin > ~250 units, show a subtle hint button that teleports back to
spawn (reuse panel styling).

**C10. Label duplication — CODE.** `updateOverheadLabels()` (~454-573) and
`updateFlyoverOverheadLabels()` (~785-836) share ~90% SVG-pill logic. Extract a shared
`renderOverheadLabelPill()` helper. Hoist the duplicated DIAG_X/DIAG_Y/HORIZ/LABEL_H
constants to module scope.

**C11. Hardcoded colors — CODE.** Replace `rgba(224,122,53,…)` / `#f97316` instances in
both owned files with `var(--accent-warm)` / `var(--accent-warm-glow)` (CSS contexts) or
the theme-resolved equivalents already used for Three.js colors.

**Acceptance:** city loads visually identical (plus fog/hover polish), selection
highlighting still works, FP + web swing + flyover all behave, no GPU memory growth after
repeated db toggles (geometry/texture dispose), `npx tsc --noEmit` clean.

---

### Workstream D — Security & Data Layer

**Owns:** everything under `app/api/`, `lib/storage.ts`, `lib/config.ts`,
`lib/notion/sync.ts` (token sourcing only), `next.config.ts`, `middleware.ts` (new),
`components/WorkspaceConfigModal.tsx`

**D1. Stop leaking Notion tokens — CRITICAL.** `GET /api/settings`
(app/api/settings/route.ts:33-34) returns plaintext `notionToken` per workspace to the
browser. Fix the round-trip without breaking the config UI:
- GET returns `hasToken: boolean` + masked hint (`"ntn_…bp"`) instead of the token.
- `WorkspaceConfigModal.tsx`: token input shows placeholder "saved — enter to replace"
  when `hasToken`; POST sends token ONLY if the user typed a new one.
- POST handler: empty/missing token for an existing workspace = keep stored token.
- Tokens stay in `data/config.json` (gitignored, server-side only); also accept
  `process.env.NOTION_TOKEN` as fallback in `lib/notion/sync.ts` where a workspace has
  no stored token.

**D2. Path traversal — CRITICAL.** `app/api/node/[id]/route.ts:11` joins unvalidated `id`
into a filesystem path. Validate with `/^[a-zA-Z0-9-]{1,64}$/` → 400 on failure, and
double-check the resolved path starts with `NODES_DIR`.

**D3. POST body validation — HIGH.** All POST routes (`settings`, `config`,
`field-config`, `orrery-config`): reject bodies > 1MB (content-length check), validate
top-level shape (object, expected keys, string length caps — e.g. workspace name ≤ 100
chars, color values match `^#[0-9a-fA-F]{6}$` where applicable), reject prototype
pollution keys (`__proto__`, `constructor`, `prototype`) when spreading parsed JSON into
stored config.

**D4. Atomic write race — MED.** `lib/storage.ts:17-24` uses a fixed `.tmp` suffix —
concurrent writes clobber each other. Use a unique temp name
(`${filePath}.${process.pid}.${counter}.tmp` — monotonic module counter), clean up temp
file on failure.

**D5. Sync abuse guard — MED.** `POST /api/sync` triggers a full Notion crawl (5k+ file
writes) with no guard. Add an in-module mutex + cooldown: reject with 429 if a sync is
already running or finished < 30s ago.

**D6. Error hygiene — MED.** Routes return `String(err)` (leaks paths). Log the real
error server-side via `console.error`; respond with a generic message + correct status.
Standardize response shape `{ ok: false, error: string }`.

**D7. Security headers — MED.** Add `middleware.ts` (or `headers()` in next.config.ts)
setting: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
`Referrer-Policy: strict-origin-when-cross-origin`. CSP must NOT break the app — the
app uses inline styles, Google Fonts, data: images, canvas/WebGL:
`default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
font-src https://fonts.gstatic.com; img-src 'self' data: blob:; script-src 'self'
'unsafe-eval' 'unsafe-inline'; connect-src 'self' https://api.notion.com` —
verify against actual usage before finalizing (Next dev needs unsafe-eval; consider
applying CSP only in production).

**D8. Schemas route bound — LOW.** `app/api/schemas/route.ts` reads the whole dir with
unbounded `Promise.all`. Cap to a sane count (e.g. 500) and batch reads.

**D9. Settings GET hardening — LOW.** Add `Cache-Control: no-store` on settings/config
GET responses (they contain workspace metadata).

**Acceptance:** `curl /api/settings` shows no `ntn_` substrings;
`curl /api/node/..%2F..%2Fpackage` → 400; saving workspaces in the modal without
retyping the token preserves sync ability; concurrent POSTs don't corrupt config.json;
`npx tsc --noEmit` clean.

---

### Workstream E — Theme Consistency Sweep (other modes' chrome)

**Owns:** `components/ProjectMountainScreen.tsx`, `components/ProjectTimelineScreen.tsx`,
`components/ProjectUserScreen.tsx`, `components/ProjectOrreryScreen.tsx`,
`components/NodeDetailsPanel.tsx`, `components/SettingsPanel.tsx`,
`components/DatabaseTogglePanel.tsx`, `components/FieldConfigPanel.tsx`,
`components/ColorSettings.tsx`, `components/ArchiveBookPanel.tsx`,
`components/ArchiveDirectoryKiosk.tsx`, `components/OrreryBreadcrumb.tsx`,
`components/OrrerySpeedControl.tsx`, `components/OrreryTierPanel.tsx`

**Scope discipline: color/focus/polish only. No structural refactors, no canvas/3D logic
changes, no moving code between files.**

**E1.** Grep all owned files for `#f97316`, `rgba(224,122,53`, `#888`, `#9ca3af`, and
similar hardcoded colors that bypass theme vars. Replace UI-chrome instances with the
matching token (`var(--accent-warm)`, `var(--accent-warm-glow)` [new, from Workstream A],
`var(--text-muted)`, `var(--border-default)`). EXCEPTION: the categorical 10-color
rotation (teal/orange/blue/… used to color-code databases) is intentional — leave
category color ARRAYS alone; only fix chrome/UI accent colors.

**E2.** Add `:focus-visible`-equivalent styling to interactive buttons in owned panels
(2px `var(--accent-warm)` outline, offset 2) where focus is currently invisible.

**E3.** Normalize panel styling drift in owned files toward the brand spec
(`docs/color-scheme.md`): panels = `var(--panel-bg)` + 1px `var(--panel-border)` +
`var(--shadow-panel)` + 12px radius. ONLY adjust clear outliers; do not redesign.

**Acceptance:** `grep -rn "rgba(224,122,53" components/` returns matches only in files
owned by A/B/C (zero ideally); visual spot-check reasoning documented; `npx tsc --noEmit`
clean.

---

## Phase 2 — Verification (after all Phase 1 agents complete)

1. `npm run lint` — fix every error introduced by Phase 1.
2. `npx tsc --noEmit` — must be clean.
3. `npm run build` — must succeed.
4. Smoke-test dev server: `/`, `/graph`, `/project-city` render; theme toggle works; no
   console errors; `curl localhost:3000/api/settings` contains no `ntn_`.
5. Cross-workstream conflict check: `git diff --stat` — confirm no file was edited by two
   workstreams (ownership map above should prevent it).

## Deferred (explicitly out of scope this pass)

- Shared `<ModeHeader>` / button-component extraction across all 7 screens (high conflict
  surface — do as a focused follow-up).
- `next/image` migration (dev runs `--webpack`; revisit with image loader config).
- Graph API pagination (7.3MB payload) — needs client-side incremental loading design.
- InstancedMesh rewrite for City buildings (shared-geometry fix captures most of the win
  at far lower risk).
- **USER ACTION: rotate the two Notion integration tokens** that were exposed via
  `GET /api/settings` (they're in `data/config.json`; D1 stops the leak but the tokens
  should be considered burned).
