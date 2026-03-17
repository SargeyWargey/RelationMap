"use client";

import { useEffect, useRef } from "react";

// ---------------------------------------------------------------------------
// Parallax mountain silhouette background
// Three layered SVG mountain ranges that shift on mouse move.
// When `visible` is false, layers lerp off-screen to the bottom — front layer
// first, back layer last — for a staggered parallax exit.
// ---------------------------------------------------------------------------

const PARALLAX_LAYERS = [
  {
    points: (W: number, H: number): [number, number][] => [
      [0, H],
      [0, 390],
      [60, 330],
      [200, 365],
      [330, 282],
      [460, 338],
      [570, 268],
      [670, 308],
      [760, 258],
      [855, 302],
      [950, 248],
      [1060, 298],
      [1170, 252],
      [1290, 308],
      [1410, 268],
      [W, 318],
      [W, H],
    ],
    lightFill: "rgba(196,146,58,0.09)",
    darkFill:  "rgba(100,120,160,0.10)",
    shiftFactor: 0.008,
    exitLerp: 0.018,
    exitTarget: 90,
  },
  {
    points: (W: number, H: number): [number, number][] => [
      [0, H],
      [0, 440],
      [70, 398],
      [175, 448],
      [280, 368],
      [400, 428],
      [495, 352],
      [605, 408],
      [700, 348],
      [795, 392],
      [890, 342],
      [995, 398],
      [1100, 348],
      [1220, 408],
      [1340, 358],
      [W, 412],
      [W, H],
    ],
    lightFill: "rgba(217,119,87,0.07)",
    darkFill:  "rgba(80,100,140,0.10)",
    shiftFactor: 0.018,
    exitLerp: 0.030,
    exitTarget: 110,
  },
  {
    points: (W: number, H: number): [number, number][] => [
      [0, H],
      [0, 490],
      [100, 468],
      [210, 498],
      [320, 438],
      [440, 488],
      [545, 418],
      [660, 472],
      [755, 412],
      [860, 458],
      [965, 408],
      [1080, 462],
      [1195, 422],
      [1315, 468],
      [1430, 428],
      [W, 458],
      [W, H],
    ],
    lightFill: "rgba(192,107,67,0.065)",
    darkFill:  "rgba(60,80,120,0.12)",
    shiftFactor: 0.032,
    exitLerp: 0.048,
    exitTarget: 130,
  },
] as const;

// The text uses the same exit params as layer 2 (front), so it falls with it.
// It sits between layers 1 and 2 visually (zIndex between them).
const TEXT_EXIT_LERP   = 0.038; // slightly slower than layer 2 — feels like it's between 1 and 2
const TEXT_EXIT_TARGET = 120;   // between layer 1 (110) and layer 2 (130)

interface Props {
  /** When false the layers animate off-screen to the bottom, front layer first. */
  visible?: boolean;
  /** When true the "Select a database to continue" prompt is shown. */
  showPrompt?: boolean;
  /** Called when the background is clicked (only active when showPrompt is true). */
  onBackgroundClick?: () => void;
}

export function ParallaxMountainBg({ visible = true, showPrompt = false, onBackgroundClick }: Props) {
  const mouseRef  = useRef({ x: 0, y: 0 });
  const frameRef  = useRef<number | null>(null);
  const smoothRef = useRef({ x: 0.5, y: 0.5 });
  const layerRefs = useRef<(SVGSVGElement | null)[]>([null, null, null]);
  const textRef   = useRef<HTMLDivElement | null>(null);

  // Per-layer current exit-Y offset (in % of viewport height), starts at 0.
  const exitYRef     = useRef<number[]>([0, 0, 0]);
  const textExitYRef = useRef(0);

  // Keep refs so the rAF loop always reads the latest values without re-registering.
  const visibleRef     = useRef(visible);
  const showPromptRef  = useRef(showPrompt);
  useEffect(() => { visibleRef.current = visible; }, [visible]);
  useEffect(() => { showPromptRef.current = showPrompt; }, [showPrompt]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      mouseRef.current = {
        x: e.clientX / window.innerWidth,
        y: e.clientY / window.innerHeight,
      };
    };
    window.addEventListener("mousemove", onMove, { passive: true });

    const tick = () => {
      // Mouse parallax
      const lerp = 0.06;
      smoothRef.current.x += (mouseRef.current.x - smoothRef.current.x) * lerp;
      smoothRef.current.y += (mouseRef.current.y - smoothRef.current.y) * lerp;
      const dx = smoothRef.current.x - 0.5;
      const dy = smoothRef.current.y - 0.5;

      PARALLAX_LAYERS.forEach((layer, i) => {
        const el = layerRefs.current[i];
        if (!el) return;

        const target = visibleRef.current ? 0 : layer.exitTarget;
        exitYRef.current[i] += (target - exitYRef.current[i]) * layer.exitLerp;

        const sx = dx * layer.shiftFactor * 100;
        const sy = dy * layer.shiftFactor * 60 + exitYRef.current[i];
        el.style.transform = `translate(${sx.toFixed(3)}%, ${sy.toFixed(3)}%)`;
      });

      // Animate text element — falls between layer 1 and 2
      const textEl = textRef.current;
      if (textEl) {
        const textTarget = visibleRef.current ? 0 : TEXT_EXIT_TARGET;
        textExitYRef.current += (textTarget - textExitYRef.current) * TEXT_EXIT_LERP;

        // Also apply a gentle parallax shift using layer 1.5 shift factor
        const midShift = (PARALLAX_LAYERS[1].shiftFactor + PARALLAX_LAYERS[2].shiftFactor) / 2;
        const sx = dx * midShift * 100;
        const sy = dy * midShift * 60 + textExitYRef.current;

        textEl.style.transform = `translate(calc(-50% + ${sx.toFixed(3)}vw), calc(-50% + ${sy.toFixed(3)}vh))`;

        // Fade out as it falls
        const progress = textExitYRef.current / TEXT_EXIT_TARGET; // 0 → 1
        textEl.style.opacity = showPromptRef.current ? String(Math.max(0, 1 - progress * 1.4)) : "0";
      }

      frameRef.current = requestAnimationFrame(tick);
    };
    frameRef.current = requestAnimationFrame(tick);

    return () => {
      window.removeEventListener("mousemove", onMove);
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    };
  }, []);

  const BLEED = "6%";
  const toPoints = (pts: [number, number][]) => pts.map(([x, y]) => `${x},${y}`).join(" ");
  const VW = 1600;
  const VH = 600;

  return (
    <div
      aria-hidden={!onBackgroundClick}
      onClick={onBackgroundClick}
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: onBackgroundClick ? "auto" : "none",
        cursor: onBackgroundClick ? "pointer" : "default",
        zIndex: 0,
        overflow: "hidden",
      }}
    >
      {/* Layer 0 — back */}
      <svg
        ref={(el) => { layerRefs.current[0] = el; }}
        viewBox={`0 0 ${VW} ${VH}`}
        preserveAspectRatio="xMidYMax slice"
        xmlns="http://www.w3.org/2000/svg"
        style={{
          position: "absolute",
          top: `-${BLEED}`,
          left: `-${BLEED}`,
          width: `calc(100% + 2 * ${BLEED})`,
          height: `calc(100% + 2 * ${BLEED})`,
          willChange: "transform",
          transformOrigin: "center center",
        }}
      >
        <polygon points={toPoints(PARALLAX_LAYERS[0].points(VW, VH))} fill={PARALLAX_LAYERS[0].lightFill} className="mountain-light" />
        <polygon points={toPoints(PARALLAX_LAYERS[0].points(VW, VH))} fill={PARALLAX_LAYERS[0].darkFill}  className="mountain-dark"  />
      </svg>

      {/* Layer 1 — middle */}
      <svg
        ref={(el) => { layerRefs.current[1] = el; }}
        viewBox={`0 0 ${VW} ${VH}`}
        preserveAspectRatio="xMidYMax slice"
        xmlns="http://www.w3.org/2000/svg"
        style={{
          position: "absolute",
          top: `-${BLEED}`,
          left: `-${BLEED}`,
          width: `calc(100% + 2 * ${BLEED})`,
          height: `calc(100% + 2 * ${BLEED})`,
          willChange: "transform",
          transformOrigin: "center center",
        }}
      >
        <polygon points={toPoints(PARALLAX_LAYERS[1].points(VW, VH))} fill={PARALLAX_LAYERS[1].lightFill} className="mountain-light" />
        <polygon points={toPoints(PARALLAX_LAYERS[1].points(VW, VH))} fill={PARALLAX_LAYERS[1].darkFill}  className="mountain-dark"  />
      </svg>

      {/* Text prompt — lives between layer 1 and layer 2 */}
      <div
        ref={textRef}
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          willChange: "transform, opacity",
          opacity: showPrompt ? 1 : 0,
          transition: "none",
          whiteSpace: "nowrap",
          textAlign: "center",
        }}
      >
        <span style={{
          fontFamily: "'DM Mono', monospace",
          fontSize: 18,
          color: "var(--text-faint)",
          fontWeight: 300,
          letterSpacing: "0.06em",
        }}>
          Select a database to continue
        </span>
      </div>

      {/* Layer 2 — front */}
      <svg
        ref={(el) => { layerRefs.current[2] = el; }}
        viewBox={`0 0 ${VW} ${VH}`}
        preserveAspectRatio="xMidYMax slice"
        xmlns="http://www.w3.org/2000/svg"
        style={{
          position: "absolute",
          top: `-${BLEED}`,
          left: `-${BLEED}`,
          width: `calc(100% + 2 * ${BLEED})`,
          height: `calc(100% + 2 * ${BLEED})`,
          willChange: "transform",
          transformOrigin: "center center",
        }}
      >
        <polygon points={toPoints(PARALLAX_LAYERS[2].points(VW, VH))} fill={PARALLAX_LAYERS[2].lightFill} className="mountain-light" />
        <polygon points={toPoints(PARALLAX_LAYERS[2].points(VW, VH))} fill={PARALLAX_LAYERS[2].darkFill}  className="mountain-dark"  />
      </svg>

      <style>{`
        .mountain-dark  { display: none; }
        [data-theme="dark"] .mountain-light { display: none; }
        [data-theme="dark"] .mountain-dark  { display: block; }
      `}</style>
    </div>
  );
}
