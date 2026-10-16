import { MORPH } from "@/lib/cultureWorld";

type Props = { morph: number; color: string; size?: number; dim?: boolean };

/** Trig results differ in the last digit between Node and browsers — round so server and client markup match. */
const r2 = (v: number) => Math.round(v * 100) / 100;

/** Tiny drawing of a species' body plan, for legends and cards. */
export function CultureGlyph({ morph, color, size = 22, dim = false }: Props) {
  const fill = color;
  const common = { stroke: color, strokeWidth: 1.4, fill, fillOpacity: 0.28, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  let body: React.ReactNode;
  switch (morph) {
    case MORPH.bacillus:
      body = (
        <>
          <rect x={-6.5} y={-3.6} width={13} height={7.2} rx={3.6} {...common} />
          <path d="M6.5 0 Q8 -2.2 9.2 0 T11 0.4" fill="none" stroke={color} strokeWidth={0.9} />
          <path d="M-6.5 0.6 Q-8 2.6 -9.2 0.6 T-11 0.2" fill="none" stroke={color} strokeWidth={0.9} />
          <ellipse cx={0} cy={0} rx={3.2} ry={1.3} fill={color} opacity={0.6} />
        </>
      );
      break;
    case MORPH.virus:
      body = (
        <>
          {Array.from({ length: 10 }, (_, k) => {
            const a = (k / 10) * Math.PI * 2;
            return (
              <g key={k}>
                <line x1={r2(Math.cos(a) * 5)} y1={r2(Math.sin(a) * 5)} x2={r2(Math.cos(a) * 8.2)} y2={r2(Math.sin(a) * 8.2)} stroke={color} strokeWidth={1.1} />
                <circle cx={r2(Math.cos(a) * 8.8)} cy={r2(Math.sin(a) * 8.8)} r={1.25} fill={color} />
              </g>
            );
          })}
          <circle r={5.2} {...common} fillOpacity={0.35} />
        </>
      );
      break;
    case MORPH.diatom:
      body = (
        <>
          <circle r={8} {...common} fillOpacity={0.15} />
          {Array.from({ length: 16 }, (_, k) => {
            const a = (k / 16) * Math.PI * 2;
            return <line key={k} x1={r2(Math.cos(a) * 2.6)} y1={r2(Math.sin(a) * 2.6)} x2={r2(Math.cos(a) * 7.2)} y2={r2(Math.sin(a) * 7.2)} stroke={color} strokeWidth={0.7} opacity={0.85} />;
          })}
          <circle r={2.2} fill="none" stroke={color} strokeWidth={0.9} />
        </>
      );
      break;
    case MORPH.amoeba:
      body = (
        <>
          <path d="M-6 -3 C-7.5 -7 -1 -8.5 1.5 -6 C3.5 -9 9.5 -5.5 7 -1.5 C10 1.5 6.5 6.5 3 5 C1 9 -5 8 -5 4.5 C-9 4 -9 -1 -6 -3 Z" {...common} />
          <circle cx={-0.5} cy={-0.5} r={2.4} fill={color} opacity={0.65} />
          <circle cx={3.5} cy={2.5} r={1.1} fill="none" stroke={color} strokeWidth={0.8} />
        </>
      );
      break;
    case MORPH.spirillum:
      body = <path d="M-9.5 1.5 C-7.5 -5 -5 -5 -3 0 S1.5 5 3.5 0 S7.5 -5 9.5 -1" fill="none" stroke={color} strokeWidth={2.6} />;
      break;
    case MORPH.paramecium:
      body = (
        <>
          {Array.from({ length: 22 }, (_, k) => {
            const a = (k / 22) * Math.PI * 2;
            const x = r2(Math.cos(a) * 8), y = r2(Math.sin(a) * 4.4);
            return <line key={k} x1={x} y1={y} x2={r2(x * 1.17)} y2={r2(y * 1.3)} stroke={color} strokeWidth={0.6} opacity={0.8} />;
          })}
          <ellipse rx={8} ry={4.4} {...common} />
          <ellipse cx={-1} cy={0} rx={2.6} ry={1.4} fill={color} opacity={0.6} />
        </>
      );
      break;
    case MORPH.volvox:
      body = (
        <>
          <circle r={8.3} {...common} fillOpacity={0.12} />
          <circle cx={-2.8} cy={-2} r={2} fill={color} opacity={0.75} />
          <circle cx={2.6} cy={-2.6} r={1.5} fill={color} opacity={0.6} />
          <circle cx={1.4} cy={3} r={2.1} fill={color} opacity={0.7} />
          <circle cx={-3.4} cy={3.4} r={1.1} fill={color} opacity={0.55} />
        </>
      );
      break;
    case MORPH.radiolarian:
      body = (
        <>
          {Array.from({ length: 14 }, (_, k) => {
            const a = (k / 14) * Math.PI * 2;
            return <line key={k} x1={r2(Math.cos(a) * 3.6)} y1={r2(Math.sin(a) * 3.6)} x2={r2(Math.cos(a) * (k % 2 ? 9.2 : 10.4))} y2={r2(Math.sin(a) * (k % 2 ? 9.2 : 10.4))} stroke={color} strokeWidth={0.8} />;
          })}
          <circle r={4} {...common} fillOpacity={0.4} />
        </>
      );
      break;
    case MORPH.vibrio:
      body = (
        <>
          <path d="M-6.5 3.5 Q-3 -5.5 5 -2.2" fill="none" stroke={color} strokeWidth={4.4} strokeLinecap="round" opacity={0.85} />
          <path d="M5.5 -2 Q8 0 8.6 2.5 T10.5 5" fill="none" stroke={color} strokeWidth={0.9} />
        </>
      );
      break;
    default:
      body = (
        <>
          <circle r={7.2} {...common} />
          <circle cx={1.6} cy={-1.2} r={2.6} fill={color} opacity={0.65} />
          <circle cx={-3} cy={2.4} r={0.9} fill={color} opacity={0.5} />
        </>
      );
  }
  return (
    <svg width={size} height={size} viewBox="-11 -11 22 22" style={{ flexShrink: 0, opacity: dim ? 0.4 : 1, overflow: "visible" }} aria-hidden>
      {body}
    </svg>
  );
}
