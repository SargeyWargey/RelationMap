// Pure shape layouts for the Sphere view. Each returns unit-scale positions
// (bounding radius ≈ 1) keyed by node id, in the view's screen-aligned space
// (x right, y down, z toward the viewer).

export type Vec3 = [number, number, number];

export type ShapeLayout = "sphere" | "seven" | "horse";

type LayoutInput = Array<{ id: string; databaseId: string }>;

export function computeShapeLayout(shape: ShapeLayout, nodes: LayoutInput): Map<string, Vec3> {
  // The seven and horse skeletons are authored y-up; flip into the y-down view space
  if (shape === "seven") return flipY(sevenLayout(nodes));
  if (shape === "horse") return flipY(horseLayout(nodes));
  return fibonacciSphereByDatabase(nodes);
}

function flipY(positions: Map<string, Vec3>): Map<string, Vec3> {
  for (const [id, v] of positions) positions.set(id, [v[0], -v[1], v[2]]);
  return positions;
}

/**
 * Distribute nodes evenly across the entire sphere, with each database's
 * nodes interleaved throughout so all databases are represented everywhere.
 * Achieved by sorting nodes so databases alternate, then running a single
 * fibonacci spiral over the full sorted list.
 */
function fibonacciSphereByDatabase(
  nodes: Array<{ id: string; databaseId: string }>,
): Map<string, Vec3> {
  const total = nodes.length;
  if (total === 0) return new Map();

  // Group nodes by database, preserving insertion order of databases
  const dbOrder: string[] = [];
  const dbGroups = new Map<string, string[]>();
  for (const n of nodes) {
    if (!dbGroups.has(n.databaseId)) {
      dbOrder.push(n.databaseId);
      dbGroups.set(n.databaseId, []);
    }
    dbGroups.get(n.databaseId)!.push(n.id);
  }

  // Interleave: round-robin across databases so nodes from each db are
  // spread throughout the spiral index range rather than clumped together
  const interleaved: string[] = [];
  const maxLen = Math.max(...dbOrder.map((db) => dbGroups.get(db)!.length));
  for (let i = 0; i < maxLen; i++) {
    for (const db of dbOrder) {
      const group = dbGroups.get(db)!;
      if (i < group.length) interleaved.push(group[i]);
    }
  }

  // Single fibonacci spiral over all nodes
  const phi = Math.PI * (3 - Math.sqrt(5));
  const result = new Map<string, Vec3>();
  interleaved.forEach((id, i) => {
    const y = 1 - (i / (total - 1)) * 2;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = phi * i;
    result.set(id, [Math.cos(theta) * r, y, Math.sin(theta) * r]);
  });

  return result;
}

/**
 * Distribute nodes on the surface of a 3D number "7".
 * The 7 is formed by two segments:
 *   - Top bar: left to right across the top
 *   - Diagonal stroke: from the right end of the bar down-left
 * Nodes sit on the cylindrical tube surface around each segment.
 * The shape fits in roughly a unit cube (coords roughly -0.5..0.5 on each axis),
 * then we normalize so it renders at the same scale as the sphere.
 */
function sevenLayout(
  nodes: Array<{ id: string; databaseId: string }>,
): Map<string, Vec3> {
  const total = nodes.length;
  if (total === 0) return new Map();

  // Define the 7 skeleton in local space
  // Top bar: (-0.5, 0.6, 0) → (0.5, 0.6, 0)
  // Diagonal: (0.5, 0.6, 0) → (-0.2, -0.7, 0)
  const topBarStart:   Vec3 = [-0.5,  0.6, 0];
  const topBarEnd:     Vec3 = [ 0.5,  0.6, 0];
  const diagEnd:       Vec3 = [-0.2, -0.7, 0];

  // Tube radius (the 7 has some thickness)
  const tubeR = 0.09;

  // Length of each segment
  function segLen(a: Vec3, b: Vec3) {
    return Math.sqrt((b[0]-a[0])**2 + (b[1]-a[1])**2 + (b[2]-a[2])**2);
  }
  const lenBar  = segLen(topBarStart, topBarEnd);
  const lenDiag = segLen(topBarEnd, diagEnd);
  const totalLen = lenBar + lenDiag;

  // Proportional node counts per segment
  const nBar  = Math.max(1, Math.round(total * lenBar / totalLen));
  const nDiag = total - nBar;

  // Interleave nodes across databases so colors are evenly spread
  const dbOrder: string[] = [];
  const dbGroups = new Map<string, string[]>();
  for (const n of nodes) {
    if (!dbGroups.has(n.databaseId)) {
      dbOrder.push(n.databaseId);
      dbGroups.set(n.databaseId, []);
    }
    dbGroups.get(n.databaseId)!.push(n.id);
  }
  const interleaved: string[] = [];
  const maxLen2 = Math.max(...dbOrder.map((db) => dbGroups.get(db)!.length));
  for (let i = 0; i < maxLen2; i++) {
    for (const db of dbOrder) {
      const g = dbGroups.get(db)!;
      if (i < g.length) interleaved.push(g[i]);
    }
  }

  // For a point along a segment at parameter t (0..1), compute tube surface position
  // using an angular offset around the segment's local axis
  function tubePoint(a: Vec3, b: Vec3, t: number, angle: number): Vec3 {
    // Segment direction
    const dx = b[0]-a[0], dy = b[1]-a[1], dz = b[2]-a[2];
    const len = Math.sqrt(dx*dx+dy*dy+dz*dz)||1;
    const dir: Vec3 = [dx/len, dy/len, dz/len];

    // A perpendicular vector (use world up [0,0,1] or [0,1,0])
    const up: Vec3 = Math.abs(dir[2]) < 0.9 ? [0, 0, 1] : [0, 1, 0];
    // Gram-Schmidt
    const dot2 = dir[0]*up[0]+dir[1]*up[1]+dir[2]*up[2];
    const perp1: Vec3 = [up[0]-dot2*dir[0], up[1]-dot2*dir[1], up[2]-dot2*dir[2]];
    const p1len = Math.sqrt(perp1[0]**2+perp1[1]**2+perp1[2]**2)||1;
    const n1: Vec3 = [perp1[0]/p1len, perp1[1]/p1len, perp1[2]/p1len];
    // Second perpendicular = dir × n1
    const n2: Vec3 = [dir[1]*n1[2]-dir[2]*n1[1], dir[2]*n1[0]-dir[0]*n1[2], dir[0]*n1[1]-dir[1]*n1[0]];

    const cx3 = a[0] + t*dx;
    const cy3 = a[1] + t*dy;
    const cz3 = a[2] + t*dz;

    return [
      cx3 + tubeR * (Math.cos(angle)*n1[0] + Math.sin(angle)*n2[0]),
      cy3 + tubeR * (Math.cos(angle)*n1[1] + Math.sin(angle)*n2[1]),
      cz3 + tubeR * (Math.cos(angle)*n1[2] + Math.sin(angle)*n2[2]),
    ];
  }

  const result = new Map<string, Vec3>();

  // Place nodes on bar segment
  for (let i = 0; i < nBar && i < interleaved.length; i++) {
    const t = nBar === 1 ? 0.5 : i / (nBar - 1);
    const angle = (i / nBar) * Math.PI * 2 * 3; // helical wrap
    result.set(interleaved[i], tubePoint(topBarStart, topBarEnd, t, angle));
  }
  // Place nodes on diagonal segment
  for (let i = 0; i < nDiag && (nBar + i) < interleaved.length; i++) {
    const t = nDiag === 1 ? 0.5 : i / (nDiag - 1);
    const angle = (i / Math.max(1, nDiag)) * Math.PI * 2 * 5;
    result.set(interleaved[nBar + i], tubePoint(topBarEnd, diagEnd, t, angle));
  }

  // Normalize: find bounding sphere radius and scale to ~1
  let maxR = 0;
  for (const v of result.values()) {
    const r2 = Math.sqrt(v[0]**2 + v[1]**2 + v[2]**2);
    if (r2 > maxR) maxR = r2;
  }
  if (maxR > 0) {
    for (const [id, v] of result.entries()) {
      result.set(id, [v[0]/maxR, v[1]/maxR, v[2]/maxR]);
    }
  }

  return result;
}

/**
 * Distribute nodes on the surface of a 3D horse silhouette.
 * The horse is built from tube segments forming a side-profile skeleton
 * with real Z-depth (body has barrel width). Facing right.
 *
 * Coordinate system: X=right, Y=up, Z=toward viewer
 */
function horseLayout(
  nodes: Array<{ id: string; databaseId: string }>,
): Map<string, Vec3> {
  const total = nodes.length;
  if (total === 0) return new Map();

  // ── Skeleton segments ──────────────────────────────────────────────────
  // Each entry: [start, end, tubeRadius, label]
  // All coords in a local ~2-unit space; will be normalized at the end.
  // Horse faces right (+X). Y is up. Z gives depth.
  const segments: Array<{ a: Vec3; b: Vec3; r: number }> = [
    // Body (barrel) — main torso, slight taper toward rump
    { a: [-0.55,  0.10, 0], b: [ 0.35,  0.15, 0], r: 0.22 },

    // Rump — from body rear up and back slightly
    { a: [ 0.35,  0.15, 0], b: [ 0.50,  0.30, 0], r: 0.15 },

    // Neck — rising forward from chest
    { a: [-0.35,  0.30, 0], b: [-0.15,  0.68, 0], r: 0.10 },

    // Head — from top of neck forward
    { a: [-0.15,  0.68, 0], b: [ 0.10,  0.72, 0], r: 0.09 },

    // Muzzle — from front of head, slight downward angle
    { a: [ 0.10,  0.72, 0], b: [ 0.22,  0.62, 0], r: 0.07 },

    // Ear — short spike up from top of head
    { a: [-0.02,  0.80, 0], b: [ 0.04,  0.90, 0], r: 0.04 },

    // Front-left foreleg upper
    { a: [-0.30, 0.10, 0.06], b: [-0.32, -0.22, 0.06], r: 0.06 },
    // Front-left foreleg lower (slight knee bend)
    { a: [-0.32, -0.22, 0.06], b: [-0.30, -0.55, 0.06], r: 0.05 },

    // Front-right foreleg upper
    { a: [-0.22, 0.10, -0.06], b: [-0.24, -0.22, -0.06], r: 0.06 },
    // Front-right foreleg lower
    { a: [-0.24, -0.22, -0.06], b: [-0.22, -0.55, -0.06], r: 0.05 },

    // Rear-left hind leg upper
    { a: [ 0.28, 0.10, 0.07], b: [ 0.32, -0.18, 0.07], r: 0.07 },
    // Rear-left hind leg lower
    { a: [ 0.32, -0.18, 0.07], b: [ 0.26, -0.55, 0.07], r: 0.05 },

    // Rear-right hind leg upper
    { a: [ 0.20, 0.10, -0.07], b: [ 0.24, -0.18, -0.07], r: 0.07 },
    // Rear-right hind leg lower
    { a: [ 0.24, -0.18, -0.07], b: [ 0.18, -0.55, -0.07], r: 0.05 },

    // Tail — flowing back and down from rump
    { a: [ 0.50,  0.30, 0.00], b: [ 0.72,  0.10, 0.05], r: 0.06 },
    { a: [ 0.72,  0.10, 0.05], b: [ 0.80, -0.10, 0.12], r: 0.05 },
    { a: [ 0.80, -0.10, 0.12], b: [ 0.76, -0.28, 0.16], r: 0.04 },

    // Mane — short segments along top of neck/head
    { a: [-0.30,  0.68, 0.04], b: [-0.18,  0.78, 0.06], r: 0.04 },
    { a: [-0.18,  0.78, 0.06], b: [-0.06,  0.82, 0.05], r: 0.03 },
  ];

  // ── Helpers ───────────────────────────────────────────────────────────
  function segLen(a: Vec3, b: Vec3) {
    return Math.sqrt((b[0]-a[0])**2 + (b[1]-a[1])**2 + (b[2]-a[2])**2);
  }

  function tubePoint(a: Vec3, b: Vec3, r: number, t: number, angle: number): Vec3 {
    const dx = b[0]-a[0], dy = b[1]-a[1], dz = b[2]-a[2];
    const len = Math.sqrt(dx*dx+dy*dy+dz*dz) || 1;
    const dir: Vec3 = [dx/len, dy/len, dz/len];
    const up: Vec3 = Math.abs(dir[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const dot2 = dir[0]*up[0]+dir[1]*up[1]+dir[2]*up[2];
    const perp1: Vec3 = [up[0]-dot2*dir[0], up[1]-dot2*dir[1], up[2]-dot2*dir[2]];
    const p1len = Math.sqrt(perp1[0]**2+perp1[1]**2+perp1[2]**2) || 1;
    const n1: Vec3 = [perp1[0]/p1len, perp1[1]/p1len, perp1[2]/p1len];
    const n2: Vec3 = [dir[1]*n1[2]-dir[2]*n1[1], dir[2]*n1[0]-dir[0]*n1[2], dir[0]*n1[1]-dir[1]*n1[0]];
    return [
      a[0]+t*dx + r*(Math.cos(angle)*n1[0]+Math.sin(angle)*n2[0]),
      a[1]+t*dy + r*(Math.cos(angle)*n1[1]+Math.sin(angle)*n2[1]),
      a[2]+t*dz + r*(Math.cos(angle)*n1[2]+Math.sin(angle)*n2[2]),
    ];
  }

  // Proportional node counts per segment by length
  const lengths = segments.map((s) => segLen(s.a, s.b));
  const totalLen = lengths.reduce((s, l) => s + l, 0);
  const counts = lengths.map((l, i) =>
    i < lengths.length - 1
      ? Math.max(1, Math.round(total * l / totalLen))
      : 0
  );
  // Last segment gets remainder
  counts[counts.length - 1] = Math.max(1, total - counts.slice(0, -1).reduce((s, c) => s + c, 0));

  // Interleave nodes across databases
  const dbOrder: string[] = [];
  const dbGroups = new Map<string, string[]>();
  for (const n of nodes) {
    if (!dbGroups.has(n.databaseId)) { dbOrder.push(n.databaseId); dbGroups.set(n.databaseId, []); }
    dbGroups.get(n.databaseId)!.push(n.id);
  }
  const interleaved: string[] = [];
  const maxLen3 = Math.max(...dbOrder.map((db) => dbGroups.get(db)!.length));
  for (let i = 0; i < maxLen3; i++) {
    for (const db of dbOrder) {
      const g = dbGroups.get(db)!;
      if (i < g.length) interleaved.push(g[i]);
    }
  }

  // Place nodes
  const result = new Map<string, Vec3>();
  let cursor = 0;
  for (let si = 0; si < segments.length; si++) {
    const { a, b, r } = segments[si];
    const n = counts[si];
    for (let i = 0; i < n && cursor < interleaved.length; i++, cursor++) {
      const t = n === 1 ? 0.5 : i / (n - 1);
      const angle = (i / Math.max(1, n)) * Math.PI * 2 * 4;
      result.set(interleaved[cursor], tubePoint(a, b, r, t, angle));
    }
  }

  // Normalize to unit bounding sphere
  let maxR = 0;
  for (const v of result.values()) {
    const r2 = Math.sqrt(v[0]**2+v[1]**2+v[2]**2);
    if (r2 > maxR) maxR = r2;
  }
  if (maxR > 0) {
    for (const [id, v] of result.entries()) {
      result.set(id, [v[0]/maxR, v[1]/maxR, v[2]/maxR]);
    }
  }

  return result;
}
