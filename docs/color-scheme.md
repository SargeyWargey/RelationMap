# RelationCity — Color Scheme Design Document

> Reference document for brand colors, theme palette, and app icon generation.

---

## App Icon Color Weights

When generating the app icon, prioritize colors by the following weights:

| Weight | Color | Hex | Role |
|--------|-------|-----|------|
| ★★★★★ | Warm Orange | `#D97757` | Primary accent — dominant icon color |
| ★★★★☆ | Warm Beige | `#F7F3ED` | Light mode background / icon base |
| ★★★★☆ | Near Black | `#1A1A1A` | Dark mode background / icon base |
| ★★★☆☆ | Rust | `#C06B43` | Secondary accent / depth |
| ★★☆☆☆ | Gold | `#C4923A` | Tertiary highlight |
| ★☆☆☆☆ | Sage | `#5A7A5E` | Supporting accent |
| ★☆☆☆☆ | Slate | `#5A7080` | Supporting accent |

**Icon design guidance:** Lead with the warm orange on either a warm beige (light variant) or near-black (dark variant) background. Use rust and gold for shading and depth. Sage and slate are supporting tones — avoid making them dominant.

---

## Light Mode Palette

### Backgrounds
| Token | Hex | Description |
|-------|-----|-------------|
| `--bg-base` | `#F7F3ED` | Page / canvas background |
| `--bg-surface` | `#F2EDE6` | Card / panel surface |
| `--bg-raised` | `#EDE8E0` | Elevated elements |
| `--bg-overlay` | `#E8E2D8` | Overlays, dropdowns |

### Text
| Token | Hex | Description |
|-------|-----|-------------|
| `--text-primary` | `#2D2520` | Main body text |
| `--text-secondary` | `#5C4F44` | Subtext, labels |
| `--text-muted` | `#8B7868` | Placeholders, hints |
| `--text-faint` | `#B3A494` | Disabled / decorative |

### Accents
| Token | Hex | Description |
|-------|-----|-------------|
| `--accent-warm` | `#D97757` | **Primary** — CTAs, nodes, highlights |
| `--accent-rust` | `#C06B43` | Depth / hover states |
| `--accent-gold` | `#C4923A` | Badges, tags, highlights |
| `--accent-sage` | `#5A7A5E` | Status / success |
| `--accent-slate` | `#5A7080` | Info / neutral |

### Effects
| Token | Value | Description |
|-------|-------|-------------|
| `--node-glow` | `rgba(217, 119, 87, 0.35)` | Orange glow on graph nodes |
| `--edge-color` | `rgba(90, 80, 68, 0.22)` | Connection lines |
| `--edge-hover` | `rgba(217, 119, 87, 0.55)` | Connection line on hover |

---

## Dark Mode Palette

### Backgrounds
| Token | Hex | Description |
|-------|-----|-------------|
| `--bg-base` | `#1A1A1A` | Page / canvas background |
| `--bg-surface` | `#222222` | Card / panel surface |
| `--bg-raised` | `#2A2A2A` | Elevated elements |
| `--bg-overlay` | `#333333` | Overlays, dropdowns |

### Text
| Token | Hex | Description |
|-------|-----|-------------|
| `--text-primary` | `#ECECEC` | Main body text |
| `--text-secondary` | `#C4C4C4` | Subtext, labels |
| `--text-muted` | `#8B8B8B` | Placeholders, hints |
| `--text-faint` | `#5A5A5A` | Disabled / decorative |

### Accents
| Token | Hex | Description |
|-------|-----|-------------|
| `--accent-warm` | `#DA7756` | **Primary** — CTAs, nodes, highlights |
| `--accent-rust` | `#C06B43` | Depth / hover states |
| `--accent-gold` | `#C99A4B` | Badges, tags, highlights |
| `--accent-sage` | `#6A9B6E` | Status / success |
| `--accent-slate` | `#6A8A9A` | Info / neutral |

### Effects
| Token | Value | Description |
|-------|-------|-------------|
| `--node-glow` | `rgba(218, 119, 86, 0.40)` | Orange glow on graph nodes |
| `--edge-color` | `rgba(255, 255, 255, 0.10)` | Connection lines |
| `--edge-hover` | `rgba(218, 119, 86, 0.60)` | Connection line on hover |

---

## 3D City Canvas Colors

### Light Mode
| Element | Hex | Description |
|---------|-----|-------------|
| Ground | `#F7F3ED` | Matches `--bg-base` |
| Street | `#D4D0C8` | Road surface |
| Highway | `#BCB8B0` | Major road surface |
| Lane dashes | `#888878` | Road markings |
| Connection lines | `#222222` | Building connections |

### Dark Mode
| Element | Hex | Description |
|---------|-----|-------------|
| Ground | `#1A1A1A` | Matches `--bg-base` |
| Street | `#1C1C2E` | Road surface (blue-gray) |
| Highway | `#28283E` | Major road surface |
| Lane dashes | `#FFFFFF` | Road markings |
| Connection lines | `#FFFFFF` | Building connections |

---

## Database / Tag Color Rotation

Used cyclically to color-code databases and tags:

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

## Tailwind Custom Tokens

| Name | Hex | Usage |
|------|-----|-------|
| `ink` | `#10151E` | Dark text utility |
| `paper` | `#F6F4EF` | Light background utility |
| `accent` | `#0D9488` | Teal utility (database default) |
| `panel` | `#141A24` | Dark panel utility |

---

## App Icon Generation Prompt (Reference)

> A modern app icon for **RelationCity** — a city-map relationship visualization tool. Use a warm orange (`#D97757`) as the dominant color on a warm cream background (`#F7F3ED`) for the light variant, and the same orange on near-black (`#1A1A1A`) for the dark variant. Incorporate rust (`#C06B43`) for depth and gold (`#C4923A`) as a highlight accent. The icon should evoke interconnected nodes or city blocks in an abstract, clean geometric style.

-
