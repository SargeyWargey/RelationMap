# Flyover Mode — Rework Design Doc

**Status:** Ready to implement
**Date:** 2026-03-15

This document captures all planned changes to the circle-based flyover camera system before implementation begins. Work from top to bottom; each section maps directly to code edits.

---

## Overview of changes

| # | Problem | Fix |
|---|---------|-----|
| 1 | Ground plane z-fighting flicker | Move ground & grid down 0.01 |
| 2 | `orbitDuration` is a separate timing concept from camera speed | Remove it; derive all durations from `FLYOVER_BASE_SPEED` |
| 3 | Fly segments use a cubic Bezier curve | Use straight `lerpVectors` — tangent departure already guaranteed by circle geometry |
| 4 | `easeInOut` applied per-segment causes velocity spikes at segment boundaries | Remove easing; use linear `t` for consistent speed |
| 5 | Double label bug during flyover | Save `flyoverWasActive` before the animation block to avoid mid-frame state change |
| 6 | `FlyoverSegment` type carries unused Bezier control points | Remove `flyP1`/`flyP2`; rename `flyP0→flyStart`, `flyP3→flyEnd` |
| 7 | "Flight speed" slider label is misleading after removing orbit duration | Rename to "Camera speed" in the UI |

---

## 1 — Ground plane z-fighting fix

**File:** `components/CityCanvas.tsx`
**Lines:** ~772–777

**Current:**
```ts
ground.rotation.x = -Math.PI / 2;
ground.name = "ground";
scene.add(ground);
// ...
scene.add(new THREE.GridHelper(600, 300, gridColor, gridColor));
```

**Change:** Add `ground.position.y = -0.01` and set GridHelper y-position to -0.01.

```ts
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.01;          // ← prevents z-fighting with building bases
ground.name = "ground";
scene.add(ground);
// ...
const grid = new THREE.GridHelper(600, 300, gridColor, gridColor);
grid.position.y = -0.01;            // ← keep grid aligned with ground
scene.add(grid);
```

---

## 2 — Remove `flyoverOrbitDuration`; add `FLYOVER_BASE_SPEED`

### 2a — New constant

Add after the existing `FP_*` constants at the top of `CityCanvas.tsx`:

```ts
const FLYOVER_BASE_SPEED = 5.0; // world-units per second for both arcs and fly segments
```

### 2b — `SceneState` (line ~84)

Remove:
```ts
flyoverOrbitDuration: number;
```

### 2c — `Props` (line ~103)

Remove:
```ts
flyoverOrbitDuration?: number;
```

### 2d — `computeFlyoverSegments` signature (line ~719)

Current:
```ts
function computeFlyoverSegments(
  queue, buildingMap, initialCamPos,
  camHeightOffset, speedMult,
  orbitDuration,   // ← REMOVE
  radiusMult,
)
```

New:
```ts
function computeFlyoverSegments(
  queue, buildingMap, initialCamPos,
  camHeightOffset, speedMult,
  radiusMult,
)
```

### 2e — Arc duration (line ~613)

Current:
```ts
const arcDur = Math.max(0.5, (arcSweep / Math.PI) * orbitDuration) / speedMult;
```

New:
```ts
const arcDur = Math.max(0.3, arcSweep * ci.r / (FLYOVER_BASE_SPEED * speedMult));
```

> Arc duration scales with actual arc length (sweep × radius), not a separate orbit timer.

### 2f — Initial fly duration (line ~585)

Current:
```ts
const flyDur0 = Math.max(1.5, flyDist0 / 8) / speedMult;
```

New:
```ts
const flyDur0 = Math.max(0.5, flyDist0 / (FLYOVER_BASE_SPEED * speedMult));
```

### 2g — Mid-tour fly duration (line ~636)

Current:
```ts
const flyDur = Math.max(1.5, flyDist / 8) / speedMult;
```

New:
```ts
const flyDur = Math.max(0.5, flyDist / (FLYOVER_BASE_SPEED * speedMult));
```

### 2h — All call sites — remove `orbitDuration` argument

Three call sites in `CityCanvas.tsx` (lines ~983–986, ~1233–1236, and inside the activation useEffect):

Current:
```ts
computeFlyoverSegments(
  queue, buildingMap, camera.position.clone(),
  s.flyoverCameraHeightOffset, s.flyoverSpeedMult,
  s.flyoverOrbitDuration, s.flyoverArcHeightMult,   // ← remove s.flyoverOrbitDuration
)
```

New:
```ts
computeFlyoverSegments(
  queue, buildingMap, camera.position.clone(),
  s.flyoverCameraHeightOffset, s.flyoverSpeedMult,
  s.flyoverArcHeightMult,
)
```

### 2i — Settings sync `useEffect` (line ~1259)

Remove:
```ts
s.flyoverOrbitDuration = flyoverOrbitDuration;
```

Remove `flyoverOrbitDuration` from the dependency array.

### 2j — `stateRef.current` initializer (line ~1137)

Remove:
```ts
flyoverOrbitDuration: flyoverOrbitDuration,
```

---

## 3 — Straight-line fly segments (remove Bezier)

### 3a — Simplify `FlyoverSegment` type (lines ~24–38)

Current:
```ts
type FlyoverSegment = {
  // ...
  flyP0: THREE.Vector3; flyP1: THREE.Vector3;
  flyP2: THREE.Vector3; flyP3: THREE.Vector3;
  // ...
};
```

New:
```ts
type FlyoverSegment = {
  // ...
  flyStart: THREE.Vector3;
  flyEnd:   THREE.Vector3;
  // ...
};
```

### 3b — Initial fly segment construction (lines ~592–602)

Remove `flyP1_0`, `flyP2_0`, tangent direction computation, and `scale0`. Keep only:

```ts
const flyStart_0 = initialCamPos.clone();
const flyEnd_0   = flyP3_0;   // renamed from flyP3_0
```

Push with `flyStart: flyStart_0, flyEnd: flyEnd_0`.
Also remove the empty `flyP1`/`flyP2` placeholders from non-fly arc segments.

### 3c — Mid-tour fly segment construction (lines ~637–653)

Remove `flyScale`, `exitTx/exitTz`, `entTx1/entTz1`, `flyP1`, `flyP2`. Keep only:

```ts
const flyStart = new THREE.Vector3(exitX, exitY, exitZ);
const flyEnd   = new THREE.Vector3(entX1, entY1, entZ1);
```

Push segment with `flyStart, flyEnd`.

### 3d — Animation fly path (line ~1010)

Current:
```ts
camera.position.copy(cubicBezier(seg.flyP0, seg.flyP1, seg.flyP2, seg.flyP3, t));
```

New:
```ts
camera.position.lerpVectors(seg.flyStart!, seg.flyEnd!, t);
```

> The tangent-departure property is already guaranteed by the external-tangent geometry: `flyStart` IS the tangent point on circle[i], so the straight line to `flyEnd` is automatically tangent. No Bezier needed.

---

## 4 — Remove easeInOut (linear speed)

**File:** `components/CityCanvas.tsx`, line ~999

Current:
```ts
const t = easeInOut(s.flyoverSegT);
```

New:
```ts
const t = s.flyoverSegT;
```

> With consistent BASE_SPEED-derived durations, easing would create speed variation within segments. Linear `t` keeps the camera moving at a constant world-units-per-second.

---

## 5 — Double-label defensive fix

**File:** `components/CityCanvas.tsx`

The bug: `exitFlyover()` can set `s.flyoverActive = false` mid-frame (inside the animation block around line ~992–1033). The label rendering code below then sees `flyoverActive = false` and falls through to the click-label branch, briefly rendering all connected-node labels for one frame.

**Fix:** Save `flyoverActive` before the animation block runs:

```ts
// Save state BEFORE the animation block may call exitFlyover()
const flyoverWasActive = !!s?.flyoverActive;

// ... existing animation block ...

// Use flyoverWasActive instead of s?.flyoverActive for all label/SVG rendering below
```

Replace all three label-rendering checks:
- `if (s?.flyoverActive && ...)` → `if (flyoverWasActive && ...)`
- `} else if (s.flyoverActive) {` → `} else if (flyoverWasActive) {`
- `if (s.flyoverActive && s.flyoverLabelMode === 'overhead')` → `if (flyoverWasActive && s.flyoverLabelMode === 'overhead')`

---

## 6 — `ProjectCityScreen.tsx` cleanup

**File:** `components/ProjectCityScreen.tsx`

### 6a — Remove `flyoverOrbitDuration` state

Remove the `useState` initializer (lines ~48–54):
```ts
const [flyoverOrbitDuration, setFlyoverOrbitDuration] = useState(() => { ... });
```

### 6b — Remove localStorage effect (line ~81)

Remove:
```ts
useEffect(() => { localStorage.setItem('city_flyover_orbit', String(flyoverOrbitDuration)); }, [flyoverOrbitDuration]);
```

### 6c — Remove "Orbit duration" slider (lines ~520–530)

Remove the entire `<div>` block for the Orbit duration slider.

### 6d — Remove prop from CityCanvas JSX

Find and remove `flyoverOrbitDuration={flyoverOrbitDuration}` from the `<CityCanvas ... />` element.

### 6e — Rename "Flight speed" → "Camera speed" (line ~511)

Current:
```html
<span ...>Flight speed</span>
```

New:
```html
<span ...>Camera speed</span>
```

---

## Implementation order

1. Ground plane fix (quick, isolated)
2. Add `FLYOVER_BASE_SPEED` constant
3. Simplify `FlyoverSegment` type (rename fields)
4. Update `computeFlyoverSegments`: remove `orbitDuration` param, new durations, straight fly
5. Update all 3 call sites to drop `orbitDuration`
6. Update animation loop: remove easeInOut, use `lerpVectors`
7. Remove `flyoverOrbitDuration` from `SceneState`, `Props`, stateRef, settings sync
8. Double-label fix (save `flyoverWasActive`)
9. `ProjectCityScreen.tsx` cleanup (remove state, effect, slider, prop, rename label)

---

## Files changed

| File | Nature of change |
|------|-----------------|
| `components/CityCanvas.tsx` | Type simplification, constant, algorithm, bug fix |
| `components/ProjectCityScreen.tsx` | Remove slider/state/prop, rename label |

No new files. No API changes.
