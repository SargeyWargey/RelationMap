# Embedding The Sphere into a Notion Page

## TL;DR

**Yes, it's possible.** Notion supports URL embeds via `/embed` blocks (iframes). If the app is hosted publicly, you can embed `/graph` directly into Notion. The main work is:
1. Deploy or expose the app publicly
2. Optionally add an `?embed=true` query mode that strips the navigation chrome

---

## How Notion Embeds Work

Notion's `/embed` block wraps a URL in an `<iframe>`. The embedded page must:
- Be served over **HTTPS**
- Not block iframes via `X-Frame-Options: DENY` (currently not set in this app — good)
- Not block via `Content-Security-Policy: frame-ancestors 'none'` (not currently set — good)

Three.js/WebGL **works inside iframes**, so the sphere will render.

---

## Hosting Options

| Option | Notes |
|--------|-------|
| **Vercel** | Easiest. `vercel deploy` gives a public HTTPS URL. Free tier works. Needs `NOTION_TOKEN` + `NOTION_ROOT_PAGE` set as env vars in Vercel dashboard. |
| **Cloudflare Pages** | Also free, similar setup. |
| **Ngrok (local tunnel)** | For testing only — exposes `localhost:3000` via a public HTTPS URL. Not stable long-term. |
| **Self-hosted VPS** | Full control. Needs SSL cert (Let's Encrypt). `npm run build && npm start`. |

---

## What the Embed Will Look Like

The current `/graph` page includes several UI overlays that will appear inside the Notion embed:
- "The Sphere" wordmark (top-left) — links to `/`, which would navigate the iframe away
- Dark mode toggle (top-right)
- Node/edge count + sync timestamp (bottom-left)
- Controls hint + shape settings (bottom-right)
- Zoom buttons
- Sliding details panel (right side, opens on node click)
- Database toggle panel (left side, Q key)

For a clean embed, an **embed mode** should be added (see below).

---

## Recommended Implementation: `?embed=true` Query Param

Add a `?embed=true` query parameter that hides navigation chrome and locks the view for embedding.

### Changes needed

**1. `app/graph/page.tsx`** — pass `searchParams` to the screen component:
```tsx
export default async function GraphPage({
  searchParams,
}: {
  searchParams: { embed?: string };
}) {
  // existing data loading...
  const embedMode = searchParams.embed === "true";
  return <ProjectGraphScreen ... embedMode={embedMode} />;
}
```

**2. `components/ProjectGraphScreen.tsx`** — accept and apply `embedMode`:
```tsx
type Props = {
  // existing props...
  embedMode?: boolean;
};

// Hide when embedMode is true:
// - Wordmark / nav link
// - Dark mode toggle
// - Bottom stats bar
// - Controls hint
// - Database toggle panel
// - Settings panel
// - Zoom buttons (optional)
// Keep: node click → details panel (useful in embed)
```

**3. Headers** — optionally allow Notion's domain to embed:
In `next.config.js` or `next.config.ts`, add a `Content-Security-Policy` header for frame-ancestors targeting Notion, or leave unset to allow all (current behavior).

### Notion embed URL
```
https://your-deployment.vercel.app/graph?embed=true
```

---

## Interaction in the Embed

| Feature | Works in Notion Embed? |
|---------|----------------------|
| Drag to rotate sphere | Yes |
| Scroll to zoom | Yes (may conflict with Notion page scroll — user must click into iframe first) |
| Click node → details panel | Yes |
| Keyboard shortcuts (E, Q, etc.) | Only after clicking into the iframe |
| Dark mode toggle | Hidden in embed mode |
| Node/database filtering | Hidden in embed mode (could be URL params instead) |

---

## Optional: URL Params for Configuration

These would all be easy to add to `page.tsx` via `searchParams`:

| Param | Effect |
|-------|--------|
| `?embed=true` | Strip chrome |
| `?shape=seven` | Set initial shape layout (`sphere`, `seven`, `horse`) |
| `?db=abc123` | Pre-filter to a single database |
| `?node=abc123` | Pre-select a node and open the details panel |

---

## Notion-Specific Caveats

- **Scroll hijacking:** Notion captures scroll events on the page. To zoom the sphere inside Notion, the user must first click into the embed to give it focus.
- **Embed dimensions:** Notion embeds let you resize the block. The sphere fills 100% of whatever iframe dimensions Notion gives it (already set to `100vw/100vh` — will need adjustment to `100%` width/height in embed mode).
- **No cookies/localStorage sync:** If dark mode is stored in localStorage, it won't sync with the parent Notion page's theme.
- **Mobile:** Notion mobile app may not render embeds the same way — test separately.

---

## Implementation Effort

| Task | Effort |
|------|--------|
| Deploy to Vercel + set env vars | ~30 min |
| Add `?embed=true` chrome-stripping | ~1–2 hours |
| Fix iframe sizing (`100%` instead of `100vw/100vh`) | ~15 min |
| Optional URL params for shape/filter/node | ~1 hour each |

**Minimum viable embed:** Deploy to Vercel, paste the URL into Notion's `/embed` block. Done — it will work, just with the full chrome visible.
