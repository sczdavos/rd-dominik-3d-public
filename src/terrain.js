// terrain.js — terrain from the survey points (pure, no three.js): Delaunay TIN with inverse-distance
// fallback outside the hull, plus the site cuts (driveway ramp, entrance path). Heights in mm relative
// to ±0,000; plan coordinates as in the model (x east, y south).
export const SITE = {
  GRID: 500,                                   // terrain grid step
  EXTENT: [-12000, -27000, 36000, 25000],      // terrain rectangle (x0, y0, x1, y1): plot + street + margins
  HOUSE: [[0, 0, 15320, 7120], [14800, -1720, 21180, 7120], [3500, -1200, 7920, 0]], // ground-floor outline (main block, garage block, canopy)
  FINISHED_Z: -250,                            // upravený terén U.T. 417,450 = −0,250 around the house (C.3)
  FINISHED_MARGIN: 2500, FINISHED_BLEND: 2500, // finished level up to this distance from the house, then blended into the surveyed ground
  HEDGE_W: 300, HEDGE_H: 1400,                 // street hedge: the 300 strip inside the boundary, 1,4 m (C.3, regulation)
  GATE_H: 1400, MESH_H: 1800,                  // wicket + sliding gate (assumption A7.6), welded-mesh fence 1,8 m
  ROAD_W: 6000,                                // asphalt centred on the street axis (assumption A7.5)
  // street surface: 'finished' = the planned street between the parcel edges (pavement back edge near_edge → far_edge) as a smooth
  // surface from the heights measured along those edges, filling the surveyed trough (centre ≈ −1,45 under kerbs at ≈ −0,30:
  // the street is not built yet, B4.2); 'surveyed' = the ground as measured (A7.4). URL ?street=surveyed for comparison.
  STREET: 'finished',
  GRAVEL: [[11260, 7120, 15320, 8920]],        // gravel under the cantilever beyond the terrace deck, in front of the study (A7.9)
  // C.3 street linework east of the lines read in A7 (s05 STREET): the carriageway kerbs (double lines, 5,45 m apart) give the
  // axis beyond the driveway, the pavement back edge and the far parcel edge continue; west: straight on past the terrain edge
  STREET_EAST: { axis: [[36000, -17676], [17700, -13396]], near: [[36000, -11360], [29981, -9935], [19107, -7360]], far: [[36000, -24032], [28385, -22255]] },
  STREET_WEST: { axis: [[-6704, -27000]], near: [[-14536, -26918]], far: [[-827, -29691]] },
};

/** Street lines of model.site.street extended east / west (SITE.STREET_EAST / _WEST), all running from east to west. */
export function streetLines(st) {
  const E = SITE.STREET_EAST, W = SITE.STREET_WEST;
  return { axis: [...E.axis, ...(st.axis || []), ...W.axis], near: [...E.near, ...(st.near_edge || []), ...W.near], far: [...E.far, ...(st.far_edge || []), ...W.far] };
}

/** Point `dist` mm from `a` toward `b` (plan). */
export const toward = (a, b, dist) => { const len = Math.hypot(b[0] - a[0], b[1] - a[1]); return [a[0] + (b[0] - a[0]) * dist / len, a[1] + (b[1] - a[1]) * dist / len]; };
/** Point on the segment a–b where coordinate `axis` (0 = x, 1 = y) equals `v`. */
export const lerpOn = (a, b, axis, v) => { const t = (v - a[axis]) / (b[axis] - a[axis]); return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]; };
/** Sub-ranges of [lo, hi] outside `gaps` (ranges on the same axis). */
export function splitGaps(lo, hi, gaps) { const out = []; let c = lo; for (const [g0, g1] of [...gaps].sort((u, v) => u[0] - v[0])) { if (g0 > c) out.push([c, g0]); c = Math.max(c, g1); } if (c < hi) out.push([c, hi]); return out; }
/** Bowyer–Watson Delaunay triangulation. pts = [{x,y}] → array of [i,j,k]. */
export function delaunay(pts) {
  const n = pts.length;
  const minX = Math.min(...pts.map(p => p.x)), maxX = Math.max(...pts.map(p => p.x)), minY = Math.min(...pts.map(p => p.y)), maxY = Math.max(...pts.map(p => p.y));
  const d = Math.max(maxX - minX, maxY - minY) * 20, cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  const P = pts.map(p => [p.x, p.y]); P.push([cx - d, cy - d], [cx + d, cy - d], [cx, cy + d]);
  let tris = [[n, n + 1, n + 2]];
  const circ = t => { const [ax, ay] = P[t[0]], [bx, by] = P[t[1]], [qx, qy] = P[t[2]];
    const D = 2 * (ax * (by - qy) + bx * (qy - ay) + qx * (ay - by)); if (Math.abs(D) < 1e-9) return null;
    const ux = ((ax * ax + ay * ay) * (by - qy) + (bx * bx + by * by) * (qy - ay) + (qx * qx + qy * qy) * (ay - by)) / D;
    const uy = ((ax * ax + ay * ay) * (qx - bx) + (bx * bx + by * by) * (ax - qx) + (qx * qx + qy * qy) * (bx - ax)) / D;
    return { x: ux, y: uy, r2: (ax - ux) ** 2 + (ay - uy) ** 2 }; };
  let cc = tris.map(circ);
  for (let i = 0; i < n; i++) {
    const [px, py] = P[i], bad = [], keep = [], keepC = [];
    tris.forEach((t, k) => { const c = cc[k]; if (c && (px - c.x) ** 2 + (py - c.y) ** 2 < c.r2) bad.push(t); else { keep.push(t); keepC.push(c); } });
    const edges = new Map();
    for (const t of bad) for (let e = 0; e < 3; e++) { const a = t[e], b = t[(e + 1) % 3], key = a < b ? a + ',' + b : b + ',' + a; edges.set(key, (edges.get(key) || 0) + 1); }
    for (const t of bad) for (let e = 0; e < 3; e++) { const a = t[e], b = t[(e + 1) % 3], key = a < b ? a + ',' + b : b + ',' + a; if (edges.get(key) === 1) { const nt = [a, b, i]; keep.push(nt); keepC.push(circ(nt)); } }
    tris = keep; cc = keepC;
  }
  return tris.filter(t => t.every(v => v < n));
}

export class Terrain {
  constructor(survey) {
    this.pts = survey.terrain_points_mm.map(p => ({ x: p.x, y: p.y, z: p.z_rel_mm }));
    this.tris = delaunay(this.pts);
    this.plot = survey.plot_polygon_mm;
  }
  /** Natural terrain height (mm). TIN inside the hull, inverse-distance (6 nearest) outside. */
  height(x, y) {
    for (const [i, j, k] of this.tris) {
      const a = this.pts[i], b = this.pts[j], c = this.pts[k];
      const det = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y); if (Math.abs(det) < 1e-9) continue;
      const l1 = ((b.y - c.y) * (x - c.x) + (c.x - b.x) * (y - c.y)) / det, l2 = ((c.y - a.y) * (x - c.x) + (a.x - c.x) * (y - c.y)) / det, l3 = 1 - l1 - l2;
      if (l1 >= -1e-6 && l2 >= -1e-6 && l3 >= -1e-6) return l1 * a.z + l2 * b.z + l3 * c.z;
    }
    const near = this.pts.map(p => ({ p, d2: (p.x - x) ** 2 + (p.y - y) ** 2 })).sort((u, v) => u.d2 - v.d2).slice(0, 6);
    let sw = 0, sz = 0; for (const { p, d2 } of near) { const w = 1 / Math.max(d2, 1); sw += w; sz += w * p.z; }
    return sz / sw;
  }
  inPlot(x, y) { return pointInPoly(x, y, this.plot); }
}

export function pointInPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const inRect = (x, y, r) => x >= r[0] && x <= r[2] && y >= r[1] && y <= r[3];

/** Distance from (x, y) to a set of rects (0 inside). */
function distRects(x, y, rects) {
  let d = Infinity;
  for (const r of rects) { const dx = Math.max(r[0] - x, 0, x - r[2]), dy = Math.max(r[1] - y, 0, y - r[3]); d = Math.min(d, Math.hypot(dx, dy)); }
  return d;
}
/** Linear ramp over a polygon along y: z(y) between (ya, za) and (yb, zb), clamped. */
const rampY = (ya, za, yb, zb) => y => za + (zb - za) * Math.min(1, Math.max(0, (y - ya) / (yb - ya)));

/**
 * Ground model for walking and for draping site surfaces (all heights mm relative to ±0,000):
 * the surveyed terrain (TIN of site.survey.terrain_points_mm), the finished level −0,250 around the house blended out into
 * it, and the paved areas of site.paving on their own levels: forecourt ±0, terrace deck −0,050, the entrance path and the
 * parking as ramps from ±0 at the house to the ground at the street hedge, the driveway crossing from there down to the street.
 */
export function makeGround(model) {
  const S = model.site, T = new Terrain(S.survey);
  const pv = Object.fromEntries((S.paving || []).map(p => [p.id, p]));
  const fin = (x, y) => { // natural ground with the finished level around the house
    const d = distRects(x, y, SITE.HOUSE), zn = T.height(x, y);
    if (d <= SITE.FINISHED_MARGIN) return SITE.FINISHED_Z;
    if (d >= SITE.FINISHED_MARGIN + SITE.FINISHED_BLEND) return zn;
    const f = (d - SITE.FINISHED_MARGIN) / SITE.FINISHED_BLEND; return SITE.FINISHED_Z * (1 - f) + zn * f;
  };
  // finished street (SITE.STREET): inside the street corridor the ground is lifted to a smooth surface interpolated (inverse
  // distance) from the heights along the pavement back edge and the far parcel edge; the surveyed trough stays below it
  let streetZ = null;
  if (S.street && SITE.STREET === 'finished') {
    const L = streetLines(S.street), corridor = [...L.near, ...[...L.far].reverse()], samples = [];
    const high = T.pts.filter(p => p.z > -500); // the pavement / verge level; the trough and the low strips beside the boundary are the unbuilt state
    const edgeZ = (x, y) => { const near = high.map(p => ({ p, d2: (p.x - x) ** 2 + (p.y - y) ** 2 })).sort((u, v) => u.d2 - v.d2).slice(0, 4);
      let sw = 0, sz = 0; for (const { p, d2 } of near) { const w = 1 / Math.max(d2, 1e4); sw += w; sz += w * p.z; } return sz / sw; };
    for (const line of [L.near, L.far]) for (let i = 0; i < line.length - 1; i++) {
      const a = line[i], b = line[i + 1], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 1000));
      for (let k = 0; k < n; k++) { const x = a[0] + (b[0] - a[0]) * k / n, y = a[1] + (b[1] - a[1]) * k / n; samples.push([x, y, edgeZ(x, y)]); }
    }
    streetZ = (x, y) => { if (!pointInPoly(x, y, corridor)) return null;
      let sw = 0, sz = 0; for (const [sx, sy, z] of samples) { const w = 1 / Math.max((sx - x) ** 2 + (sy - y) ** 2, 1e4); sw += w; sz += w * z; } return sz / sw; };
  }
  const natural = (x, y) => { const z = fin(x, y), s = streetZ ? streetZ(x, y) : null; return s == null ? z : Math.max(z, s); };
  const yMin = p => Math.min(...p.poly.map(q => q[1]));
  const ramps = {};
  if (pv.pav_chodnik) { const y0 = yMin(pv.pav_chodnik); ramps.pav_chodnik = rampY(y0, streetZ ? natural(5350, y0 - 400) : fin(5350, y0), -1200, 0); } // finished street: the path meets the pavement level at the wicket
  if (pv.pav_parkovani && pv.pav_sjezd && streetZ) { // finished street: parking + driveway crossing = one even slope from the garage (±0) to the street
    const yb = yMin(pv.pav_sjezd) + 300; ramps.pav_parkovani = ramps.pav_sjezd = rampY(-1720, 0, yb, natural(18000, yb));
  } else {
  if (pv.pav_parkovani) { const y0 = -6400; ramps.pav_parkovani = rampY(y0, fin(17000, y0 - 200), -1720, 0); }
  if (pv.pav_sjezd) { const ya = -6900, yb = Math.min(...pv.pav_sjezd.poly.map(q => q[1])); ramps.pav_sjezd = rampY(ya, ramps.pav_parkovani ? ramps.pav_parkovani(ya) : fin(18000, ya), yb + 300, natural(18000, yb + 300)); }
  }
  const flat = { pav_predprostor: 0, pav_terasa: (pv.pav_terasa?.z_rel ?? -50) };
  const order = ['pav_terasa', 'pav_predprostor', 'pav_chodnik', 'pav_parkovani', 'pav_sjezd'];
  const level = (id, x, y) => id in flat ? flat[id] : ramps[id] ? ramps[id](y) : natural(x, y); // a paved area's own surface (also on its edge)
  // the hedge strip under each gate is paved at the level of the paving it opens onto (the polygons stop either side of the strip)
  const strips = [];
  for (const gt of S.gates || []) {
    const [a, b] = gt.line, L = Math.hypot(b[0] - a[0], b[1] - a[1]), nx = -(b[1] - a[1]) / L, ny = (b[0] - a[0]) / L, mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const id = order.find(k => pv[k] && [1, -1].some(sg => pointInPoly(mid[0] + sg * nx * 500, mid[1] + sg * ny * 500, pv[k].poly)));
    if (id) strips.push({ id, poly: [[a[0] + nx * 400, a[1] + ny * 400], [b[0] + nx * 400, b[1] + ny * 400], [b[0] - nx * 400, b[1] - ny * 400], [a[0] - nx * 400, a[1] - ny * 400]] });
  }
  const paved = (x, y) => { for (const id of order) { const p = pv[id]; if (p && pointInPoly(x, y, p.poly)) return level(id, x, y); }
    for (const st of strips) if (pointInPoly(x, y, st.poly)) return level(st.id, x, y); return null; };
  const ground = (x, y) => { const z = paved(x, y); return z ?? natural(x, y); };
  return { terrain: T, height: (x, y) => T.height(x, y), surface: natural, ground, paved, level, finished: fin, streetZ };
}
