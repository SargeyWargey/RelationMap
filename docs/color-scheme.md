# RelationCity — Brand Guide

> A portable reference for colors, typography, motion, and UI feel. Use this to apply the RelationCity design system to any project.

---

## Brand Identity

**Personality:** Warm, spatial, analytical. Like a well-worn map of a place you understand deeply. Organic without being sloppy. Precise without being cold.

**Aesthetic:** Solarized-warm meets editorial. Think aged paper, ember light, city grids at dusk. Information-dense UIs that still feel habitable.

**Avoid:** Cool/clinical blues as primaries, pure white or pure black, flat neon, generic SaaS "clean" aesthetics.

---

## Color System

### Core Brand Colors

| Name | Hex | Role |
|------|-----|------|
| Warm Orange | `#D97757` | **Primary accent** — CTAs, highlights, selection states |
| Rust | `#C06B43` | Secondary accent, depth, hover states |
| Gold | `#C4923A` | Tertiary, badges, tags, highlights |
| Sage | `#5A7A5E` | Status / success |
| Slate | `#5A7080` | Info / neutral |

**The orange-rust range is the brand's heartbeat.** Everything else supports it. When in doubt, use `#D97757`.

---

### Light Mode Palette

#### Backgrounds
| Token | Hex | Description |
|-------|-----|-------------|
| `--bg-base` | `#F7F3ED` | Page / canvas background — warm cream |
| `--bg-surface` | `#F2EDE6` | Card / panel surface |
| `--bg-raised` | `#EDE8E0` | Elevated elements |
| `--bg-overlay` | `#E8E2D8` | Overlays, dropdowns |

#### Text
| Token | Hex | Description |
|-------|-----|-------------|
| `--text-primary` | `#2D2520` | Main body text — warm near-black |
| `--text-secondary` | `#5C4F44` | Subtext, labels |
| `--text-muted` | `#8B7868` | Placeholders, hints |
| `--text-faint` | `#B3A494` | Disabled / decorative |

#### Accents
| Token | Hex | Description |
|-------|-----|-------------|
| `--accent-warm` | `#D97757` | Primary — CTAs, nodes, highlights |
| `--accent-rust` | `#C06B43` | Depth / hover states |
| `--accent-gold` | `#C4923A` | Badges, tags |
| `--accent-sage` | `#5A7A5E` | Status / success |
| `--accent-slate` | `#5A7080` | Info / neutral |

#### Borders
| Token | Value | Description |
|-------|-------|-------------|
| `--border-subtle` | `rgba(139, 120, 100, 0.15)` | Hairline dividers |
| `--border-default` | `rgba(139, 120, 100, 0.28)` | Standard borders |
| `--border-strong` | `rgba(139, 120, 100, 0.50)` | Prominent borders |

#### Panels
| Token | Value | Description |
|-------|-------|-------------|
| `--panel-bg` | `rgba(247, 243, 237, 0.92)` | Floating panel background |
| `--panel-border` | `rgba(139, 120, 100, 0.22)` | Panel border |

#### Shadows
| Token | Value | Description |
|-------|-------|-------------|
| `--shadow-sm` | `0 1px 3px rgba(45,37,32,0.08), 0 1px 2px rgba(45,37,32,0.06)` | Subtle lift |
| `--shadow-md` | `0 4px 16px rgba(45,37,32,0.10), 0 2px 6px rgba(45,37,32,0.07)` | Card elevation |
| `--shadow-lg` | `0 12px 40px rgba(45,37,32,0.14), 0 4px 12px rgba(45,37,32,0.08)` | Modal / drawer |
| `--shadow-panel` | `0 20px 60px rgba(45,37,32,0.16), 0 4px 16px rgba(45,37,32,0.10)` | Floating panels |

---

### Dark Mode Palette

Trigger: `[data-theme="dark"]` on the root element.

#### Backgrounds
| Token | Hex | Description |
|-------|-----|-------------|
| `--bg-base` | `#1A1A1A` | Page / canvas background — warm near-black |
| `--bg-surface` | `#222222` | Card / panel surface |
| `--bg-raised` | `#2A2A2A` | Elevated elements |
| `--bg-overlay` | `#333333` | Overlays, dropdowns |

#### Text
| Token | Hex | Description |
|-------|-----|-------------|
| `--text-primary` | `#ECECEC` | Main body text |
| `--text-secondary` | `#C4C4C4` | Subtext, labels |
| `--text-muted` | `#8B8B8B` | Placeholders, hints |
| `--text-faint` | `#5A5A5A` | Disabled / decorative |

#### Accents
| Token | Hex | Description |
|-------|-----|-------------|
| `--accent-warm` | `#DA7756` | Primary — CTAs, nodes, highlights |
| `--accent-rust` | `#C06B43` | Depth / hover states |
| `--accent-gold` | `#C99A4B` | Badges, tags |
| `--accent-sage` | `#6A9B6E` | Status / success |
| `--accent-slate` | `#6A8A9A` | Info / neutral |

#### Borders
| Token | Value | Description |
|-------|-------|-------------|
| `--border-subtle` | `rgba(255, 255, 255, 0.06)` | Hairline dividers |
| `--border-default` | `rgba(255, 255, 255, 0.12)` | Standard borders |
| `--border-strong` | `rgba(255, 255, 255, 0.24)` | Prominent borders |

#### Panels
| Token | Value | Description |
|-------|-------|-------------|
| `--panel-bg` | `rgba(34, 34, 34, 0.94)` | Floating panel background |
| `--panel-border` | `rgba(255, 255, 255, 0.10)` | Panel border |

#### Shadows
| Token | Value | Description |
|-------|-------|-------------|
| `--shadow-sm` | `0 1px 3px rgba(0,0,0,0.30), 0 1px 2px rgba(0,0,0,0.20)` | Subtle lift |
| `--shadow-md` | `0 4px 16px rgba(0,0,0,0.40), 0 2px 6px rgba(0,0,0,0.25)` | Card elevation |
| `--shadow-lg` | `0 12px 40px rgba(0,0,0,0.50), 0 4px 12px rgba(0,0,0,0.30)` | Modal / drawer |
| `--shadow-panel` | `0 20px 60px rgba(0,0,0,0.55), 0 4px 16px rgba(0,0,0,0.35)` | Floating panels |

---

### Categorical / Tag Color Rotation

Used cyclically for color-coding databases, tags, categories. Chosen for contrast on both light and dark backgrounds.

| # | Hex | Name |
|---|-----|------|
| 1 | `#0D9488` | Teal |
| 2 | `#F97316` | Orange |
| 3 | `#2563EB` | Blue |
| 4 | `#DC2626` | Red |
| 5 | `#7C3AED` | Purple |
| 6 | `#16A34A` | Green |
| 7 | `#EA580C` | Dark Orange |
| 8 | `#4F46E5` | Indigo |
| 9 | `#BE123C` | Crimson |
| 10 | `#0891B2` | Cyan |

---

## Typography

### Type Scale

| Role | Font | Weights | Source |
|------|------|---------|--------|
| **Display / Headings** | Lora | 400, 500, 600 (+ italic 400) | Google Fonts |
| **Body / UI** | Geist | 300, 400, 500, 600 | Google Fonts |
| **Code / Mono** | DM Mono | 300, 400, 500 | Google Fonts |

### Import

```css
@import url('https://fonts.googleapis.com/css2?family=Lora:ital,wght@0,400;0,500;0,600;1,400&family=DM+Mono:wght@300;400;500&family=Geist:wght@300;400;500;600&display=swap');
```

### CSS Stacks

```css
font-family: 'Lora', Georgia, serif;           /* display */
font-family: 'Geist', ui-sans-serif, system-ui, sans-serif;   /* body */
font-family: 'DM Mono', ui-monospace, monospace;              /* code */
```

### Tailwind Font Families

```ts
fontFamily: {
  display: ["'Lora'", "Georgia", "serif"],
  mono:    ["'DM Mono'", "ui-monospace", "monospace"],
  body:    ["'Geist'", "ui-sans-serif", "system-ui"],
}
```

### Usage Guidance

- **Lora** for page/section headings, callouts, any text meant to read like a title
- **Geist** for all UI chrome — labels, buttons, nav, body copy
- **DM Mono** for data values, code, IDs, timestamps

---

## Texture & Surface Treatment

The body background uses a very subtle SVG noise overlay to give surfaces the feel of paper rather than flat paint:

```css
background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='300' height='300'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='300' height='300' filter='url(%23noise)' opacity='0.028'/%3E%3C/svg%3E");
```

**Opacity:** `0.028` — barely visible. Do not increase; the effect should be subliminal.

---

## Motion & Animation

### Easing

The house easing curve for all transitions and animations:

```css
cubic-bezier(0.32, 0, 0.15, 1)
```

This curve decelerates into the end state — feels physical, not bouncy. Use it for panels, modals, slide-ins.

For simple opacity fades, `ease` is fine.

### Durations

| Use case | Duration |
|----------|----------|
| Micro-interactions (hover, focus) | `150ms` |
| Panel slide / modal enter | `350ms` |
| Fade transitions | `250ms` |
| Structural layout shifts | `400ms` |

### Named Animations

```css
/* Fade up from slightly below — use for appearing elements */
@keyframes fadeUp {
  from { opacity: 0; transform: translateY(6px); }
  to   { opacity: 1; transform: translateY(0); }
}

/* Slide in from right — use for side panels / drawers */
@keyframes slideInRight {
  from { opacity: 0; transform: translateX(24px); }
  to   { opacity: 1; transform: translateX(0); }
}

/* Expanding ring — use for active indicators, pings */
@keyframes pulse-ring {
  0%   { transform: scale(1);   opacity: 0.7; }
  100% { transform: scale(2.2); opacity: 0; }
}

/* Text flash — use for loading / waiting states */
@keyframes textFlash {
  0%, 100% { color: var(--text-faint); }
  50%       { color: var(--accent-warm); }
}
```

### Panel Transition

```css
.transition-panel {
  transition: transform 0.35s cubic-bezier(0.32, 0, 0.15, 1),
              opacity   0.25s ease;
}
```

---

## Component Patterns

### Scrollbars

Minimal, unobtrusive. 5px wide, no track.

```css
::-webkit-scrollbar { width: 5px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb {
  background: var(--border-strong);
  border-radius: 10px;
}
```

### Panels / Floating UI

- Background: `var(--panel-bg)` (semi-transparent with blur if desired)
- Border: `1px solid var(--panel-border)`
- Shadow: `var(--shadow-panel)`
- Border radius: `12px` (outer), `8px` (inner elements)

### Buttons (Primary)

```css
background: var(--accent-warm);
color: #fff;
border: none;
border-radius: 6px;
font-family: 'Geist', sans-serif;
font-weight: 500;
```

Hover: shift to `var(--accent-rust)`. No box-shadow on buttons — use background shift only.

### Focus States

```css
outline: 2px solid var(--accent-warm);
outline-offset: 2px;
```

---

## Tailwind Utility Tokens

| Name | Hex | Usage |
|------|-----|-------|
| `ink` | `#10151E` | Dark text utility |
| `paper` | `#F6F4EF` | Light background utility |
| `accent` | `#0D9488` | Teal utility (default category color) |
| `panel` | `#141A24` | Dark panel utility |

---

## Light / Dark Mode Implementation

Toggle by setting `data-theme="dark"` on `<html>` or `<body>`. No component-level theme logic required — all tokens flip automatically via CSS custom properties.

```js
// Toggle
document.documentElement.setAttribute('data-theme', 'dark');
document.documentElement.removeAttribute('data-theme'); // back to light
```

---

## Icon / Visual Identity

**Primary icon palette** (in priority order):

| Weight | Color | Hex | Role |
|--------|-------|-----|------|
| ★★★★★ | Warm Orange | `#D97757` | Dominant |
| ★★★★☆ | Warm Beige | `#F7F3ED` | Light base |
| ★★★★☆ | Near Black | `#1A1A1A` | Dark base |
| ★★★☆☆ | Rust | `#C06B43` | Depth |
| ★★☆☆☆ | Gold | `#C4923A` | Highlight |
| ★☆☆☆☆ | Sage | `#5A7A5E` | Supporting |
| ★☆☆☆☆ | Slate | `#5A7080` | Supporting |

**Icon generation prompt:**
> A modern app icon for RelationCity — a city-map relationship visualization tool. Use warm orange (`#D97757`) as the dominant color on a warm cream background (`#F7F3ED`) for the light variant, and the same orange on near-black (`#1A1A1A`) for the dark variant. Incorporate rust (`#C06B43`) for depth and gold (`#C4923A`) as a highlight accent. The icon should evoke interconnected nodes or city blocks in an abstract, clean geometric style.

---

## CSS Custom Properties — Full Drop-In Snippet

Copy this into any project's global CSS to apply the full palette:

```css
@import url('https://fonts.googleapis.com/css2?family=Lora:ital,wght@0,400;0,500;0,600;1,400&family=DM+Mono:wght@300;400;500&family=Geist:wght@300;400;500;600&display=swap');

:root {
  --bg-base:        #f7f3ed;
  --bg-surface:     #f2ede6;
  --bg-raised:      #ede8e0;
  --bg-overlay:     #e8e2d8;

  --border-subtle:  rgba(139, 120, 100, 0.15);
  --border-default: rgba(139, 120, 100, 0.28);
  --border-strong:  rgba(139, 120, 100, 0.50);

  --text-primary:   #2d2520;
  --text-secondary: #5c4f44;
  --text-muted:     #8b7868;
  --text-faint:     #b3a494;

  --accent-warm:    #d97757;
  --accent-rust:    #c06b43;
  --accent-gold:    #c4923a;
  --accent-sage:    #5a7a5e;
  --accent-slate:   #5a7080;

  --panel-bg:       rgba(247, 243, 237, 0.92);
  --panel-border:   rgba(139, 120, 100, 0.22);

  --shadow-sm:      0 1px 3px rgba(45,37,32,0.08), 0 1px 2px rgba(45,37,32,0.06);
  --shadow-md:      0 4px 16px rgba(45,37,32,0.10), 0 2px 6px rgba(45,37,32,0.07);
  --shadow-lg:      0 12px 40px rgba(45,37,32,0.14), 0 4px 12px rgba(45,37,32,0.08);
  --shadow-panel:   0 20px 60px rgba(45,37,32,0.16), 0 4px 16px rgba(45,37,32,0.10);
}

[data-theme="dark"] {
  --bg-base:        #1a1a1a;
  --bg-surface:     #222222;
  --bg-raised:      #2a2a2a;
  --bg-overlay:     #333333;

  --border-subtle:  rgba(255, 255, 255, 0.06);
  --border-default: rgba(255, 255, 255, 0.12);
  --border-strong:  rgba(255, 255, 255, 0.24);

  --text-primary:   #ececec;
  --text-secondary: #c4c4c4;
  --text-muted:     #8b8b8b;
  --text-faint:     #5a5a5a;

  --accent-warm:    #da7756;
  --accent-rust:    #c06b43;
  --accent-gold:    #c99a4b;
  --accent-sage:    #6a9b6e;
  --accent-slate:   #6a8a9a;

  --panel-bg:       rgba(34, 34, 34, 0.94);
  --panel-border:   rgba(255, 255, 255, 0.10);

  --shadow-sm:      0 1px 3px rgba(0,0,0,0.30), 0 1px 2px rgba(0,0,0,0.20);
  --shadow-md:      0 4px 16px rgba(0,0,0,0.40), 0 2px 6px rgba(0,0,0,0.25);
  --shadow-lg:      0 12px 40px rgba(0,0,0,0.50), 0 4px 12px rgba(0,0,0,0.30);
  --shadow-panel:   0 20px 60px rgba(0,0,0,0.55), 0 4px 16px rgba(0,0,0,0.35);
}

body {
  background: var(--bg-base);
  color: var(--text-primary);
  font-family: 'Geist', ui-sans-serif, system-ui, sans-serif;
  /* Subtle paper texture */
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='300' height='300'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='300' height='300' filter='url(%23noise)' opacity='0.028'/%3E%3C/svg%3E");
}
```
