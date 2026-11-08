// collision.js — walkable surfaces, blockers, floor lookup and circle-vs-box resolution (pure, no three.js).
// Everything is derived from the effective model (+ the stair plan), in plan mm: x east, y south, z up.
import { CONST, roomFloorZ } from './config.js';
import { SITE } from './terrain.js';

export const WALK = { RADIUS: 250, SOFT_RADIUS: 120, HEIGHT: 1750, STEP: 450, EYE: 1650, WALK: 3400, RUN: 5500 }; // mm/s — brisk by default, Shift sprints
const PASSABLE = ['door', 'sliding', 'garage', 'opening'];

export function pointInPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
export const inRect = (x, y, r) => x >= r[0] && x <= r[2] && y >= r[1] && y <= r[3];
export const wallFrame = w => { const [x0, y0, x1, y1] = w.rect, horiz = (x1 - x0) >= (y1 - y0); return { horiz, a0: horiz ? x0 : y0, a1: horiz ? x1 : y1, t: horiz ? y1 - y0 : x1 - x0, c: horiz ? (y0 + y1) / 2 : (x0 + x1) / 2 }; };

/** mm the bottom of a passable opening is lifted to the higher adjacent *indoor* floor (garage block +300). */
export function floorRaise(o, L, zf) {
  const w = L.walls.find(x => x.id === o.wall); if (!w) return 0;
  const F = wallFrame(w), [x0, y0, x1, y1] = o.rect, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, d = F.t / 2 + 100;
  const pts = F.horiz ? [[cx, cy - d], [cx, cy + d]] : [[cx - d, cy], [cx + d, cy]];
  return Math.max(0, ...pts.flatMap(p => L.rooms.filter(r => !r.outdoor && pointInPoly(p[0], p[1], r.poly)).map(r => roomFloorZ(r, zf) - zf)));
}

/** Solid pieces of a wall after cutting its passable openings: [{rect, z0, z1}]. Windows are not cut. */
export function wallPieces(w, ops, zf, L) {
  const F = wallFrame(w), [x0, y0, x1, y1] = w.rect;
  const z0 = w.z0 ?? zf, z1 = w.z1 ?? zf + (L.height || 2900);
  const along = (s, e) => F.horiz ? [s, y0, e, y1] : [x0, s, x1, e];
  const out = [], cuts = [], detached = [];
  for (const o of ops) {
    if (!PASSABLE.includes(o.type)) continue;
    const os = F.horiz ? o.rect[0] : o.rect[1], oe = F.horiz ? o.rect[2] : o.rect[3];
    const cs = Math.max(os, F.a0), ce = Math.min(oe, F.a1);
    if (ce - cs <= 0) { detached.push(o); continue; }
    const lo = zf + (o.sill || 0) + floorRaise(o, L, zf); // the whole door moves up with a raised floor
    cuts.push({ s: cs, e: ce, lo, hi: Math.min(lo + (o.h || 2000), z1) });
  }
  cuts.sort((a, b) => a.s - b.s);
  let cursor = F.a0;
  const push = (rect, za, zb) => { if (zb - za > 0 && rect[2] > rect[0] && rect[3] > rect[1]) out.push({ rect, z0: za, z1: zb }); };
  for (const c of cuts) {
    if (c.s > cursor) push(along(cursor, c.s), z0, z1);
    push(along(c.s, c.e), z0, c.lo);
    push(along(c.s, c.e), c.hi, z1);
    cursor = Math.max(cursor, c.e);
  }
  if (cursor < F.a1) push(along(cursor, F.a1), z0, z1);
  for (const o of detached) out.push(...wallPieces({ ...w, rect: o.rect }, [o], zf, L));
  return out;
}

/**
 * Plan rect of the cabinet surround of a hidden door (`o.front` mm in front of the wall face on the side away from
 * the swing, over the opening width) — the pantry entry disguised as cabinet doors. Null when the door is a normal one.
 */
export function hiddenDoorRect(o, w) {
  if (!o.front || !w) return null;
  const F = wallFrame(w), [x0, y0, x1, y1] = o.rect, side = o.swing?.side || '+';
  if (F.horiz) return side === '-' ? [x0, w.rect[3], x1, w.rect[3] + o.front] : [x0, w.rect[1] - o.front, x1, w.rect[1]];
  return side === '+' ? [w.rect[0] - o.front, y0, w.rect[0], y1] : [w.rect[2], y0, w.rect[2] + o.front, y1];
}
/**
 * Plan rect of the fixed sidelight of a door whose leaf is narrower than the opening (openings.js door(): jambs 50, leaf
 * `o.leaf` at the hinge end — 'a' = the low-coordinate end —, fixed glazing over the rest), or null. RD Vysoký Újezd
 * o_vstup: 1 000 leaf + 1 270 fixed glazing in a 2 370 opening.
 */
export function sidelightRect(o, w) {
  if (!w || !o.leaf) return null;
  const JAMB = 50, F = wallFrame(w), [x0, y0, x1, y1] = o.rect, os = F.horiz ? x0 : y0, oe = F.horiz ? x1 : y1;
  const inner = (oe - os) - 2 * JAMB, lw = Math.min(o.leaf, inner); if (inner - lw <= 60) return null;
  const [s, e] = (o.swing?.hinge || 'a') === 'a' ? [os + JAMB + lw, oe] : [os, oe - JAMB - lw];
  return F.horiz ? [s, y0, e, y1] : [x0, s, x1, e];
}
/** Blocker band (40 mm) at the leaf plane of a hidden door — the far end of its surround. */
function hiddenDoorBand(o, w) {
  const r = hiddenDoorRect(o, w), F = wallFrame(w), side = o.swing?.side || '+';
  if (F.horiz) return side === '-' ? [r[0], r[3] - 40, r[2], r[3]] : [r[0], r[1], r[2], r[1] + 40];
  return side === '+' ? [r[0], r[1], r[0] + 40, r[3]] : [r[2] - 40, r[1], r[2], r[3]];
}

/**
 * Colliders for the whole house: surfaces (walkable tops) and blockers (solid boxes).
 * stairPlans = [{plan, level}] from stairs.js.
 */
export function buildColliders(m, stairPlans = [], G = null) {
  const surfaces = [], blockers = [];
  for (const lk of Object.keys(m.levels)) {
    const L = m.levels[lk], zf = L.z_floor ?? L.elev ?? 0;
    for (const w of L.walls) for (const p of wallPieces(w, L.openings.filter(o => o.wall === w.id), zf, L)) blockers.push({ ...p, id: w.id, level: lk });
    // door thresholds: the cut-out itself is walkable at the (raised) door bottom; closed door leaves block (toggled by doors.js)
    for (const o of L.openings) if (PASSABLE.includes(o.type)) {
      const lo = zf + (o.sill || 0) + floorRaise(o, L, zf);
      surfaces.push({ poly: rectPoly(o.rect), holes: [], z: lo, id: o.id, level: lk });
      if (o.type !== 'opening') { const w = L.walls.find(x => x.id === o.wall); blockers.push({ rect: o.front && w ? hiddenDoorBand(o, w) : o.rect, z0: lo, z1: lo + (o.h || 2000), id: 'door:' + o.id, level: lk, door: true, active: true }); }
      const side = o.type === 'door' && !o.front ? sidelightRect(o, L.walls.find(x => x.id === o.wall)) : null;
      if (side) blockers.push({ rect: side, z0: lo, z1: lo + (o.h || 2000), id: 'sidelight:' + o.id, level: lk }); // fixed glazing beside the leaf stays shut when the door opens
    }
    for (const r of L.rooms) {
      const holes = zf > 0 ? L.fixtures.filter(f => /^f\d*_schod$/.test(f.id) && f.rect).map(f => f.rect) : [];
      surfaces.push({ poly: r.poly, holes, z: roomFloorZ(r, zf), id: r.id, level: lk });
    }
    for (const f of L.fixtures) {
      if (!f.rect) continue;
      if (/komin/.test(f.id)) { if (lk === 'np1') blockers.push({ rect: f.rect, z0: zf, z1: CONST.CHIMNEY_TOP, id: f.id, level: lk }); continue; }
      if (f.z1 == null) continue;
      const z0 = f.z0 ?? zf;
      if (/perg/.test(f.id)) { blockers.push({ rect: [f.rect[2] - 150, f.rect[3] - 150, f.rect[2], f.rect[3]], z0: CONST.TERRACE_Z, z1: z0, id: f.id + ':post', level: lk }); continue; }
      if (/f2_gar|pristavba/.test(f.id)) { surfaces.push({ poly: rectPoly(f.rect), holes: [], z: f.z1, id: f.id, level: lk }); continue; }
      blockers.push({ rect: f.rect, z0, z1: f.z1, id: f.id, level: lk });
    }
  }
  // furniture and built-ins (kitchen, bath, tech room) block; low pieces (≤ STEP) are stepped over
  for (const lk of Object.keys(m.levels)) {
    const L = m.levels[lk], zf = L.z_floor ?? L.elev ?? 0;
    const floorAtPt = (x, y) => { const r = L.rooms.find(rm => pointInPoly(x, y, rm.poly)); return r ? roomFloorZ(r, zf) : zf; };
    blockers.push(...furnitureBlockers(L, lk, G ? G.ground : null));
    for (const f of L.fixtures) {
      if (!f.rect || f.z1 != null) continue;
      const h = BUILTIN_H.find(([re]) => re.test(f.id))?.[1]; if (!h) continue;
      const z0 = floorAtPt((f.rect[0] + f.rect[2]) / 2, (f.rect[1] + f.rect[3]) / 2);
      blockers.push({ rect: f.rect, z0, z1: z0 + h, id: 'fx:' + f.id, level: lk, soft: true });
    }
  }
  for (const { plan, level } of stairPlans) {
    for (const t of plan.treads) surfaces.push({ poly: t.poly, holes: [], z: t.z, id: 'stair', level });
    for (const b of plan.blocks) blockers.push({ ...b, id: 'stair', level });
    blockers.push({ rect: plan.voidRail, z0: plan.top.z, z1: plan.top.z + 1000, id: 'stair:rail', level: 'np2' });
    if (plan.flightRail) blockers.push({ rect: plan.flightRail, z0: 0, z1: plan.top.z + 1000, id: 'stair:flightrail', level });
    for (const w of plan.sideWalls || []) { // partition over an open stretch of the flight's side, in 200 slices (bottom follows the soffit)
      const [x0, y0, x1, y1] = w.rect, n = Math.max(1, Math.ceil((x1 - x0) / 200));
      for (let i = 0; i < n; i++) { const a = x0 + (x1 - x0) * i / n, b = x0 + (x1 - x0) * (i + 1) / n; blockers.push({ rect: [a, y0, b, y1], z0: w.zb0 + (w.zb1 - w.zb0) * i / n, z1: w.zt, id: 'stair:sidewall', level }); }
    }
  }
  // site (model.site, pipeline s05): street hedge, mesh fences, both gates ('door:<id>' blockers that doors.js switches off
  // while open), street-tree trunks, bins and the pillar — slanted lines are split into short pieces with small AABBs
  if (G && m.site) {
    const S = m.site;
    const line = (pts, w, id, extra = {}) => {
      for (let i = 0; i < pts.length - 1; i++) { const a = pts[i], b = pts[i + 1], len = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.ceil(len / 400));
        for (let k = 0; k < n; k++) { const x0 = a[0] + (b[0] - a[0]) * k / n, y0 = a[1] + (b[1] - a[1]) * k / n, x1 = a[0] + (b[0] - a[0]) * (k + 1) / n, y1 = a[1] + (b[1] - a[1]) * (k + 1) / n;
          blockers.push({ rect: [Math.min(x0, x1) - w / 2, Math.min(y0, y1) - w / 2, Math.max(x0, x1) + w / 2, Math.max(y0, y1) + w / 2], z0: -3000, z1: 5000, id, level: 'site', ...extra }); } }
    };
    const off = (pts, d) => pts.map((p, i) => { const q = pts[Math.min(i + 1, pts.length - 1)], o = pts[Math.max(i - 1, 0)], dx = q[0] - o[0], dy = q[1] - o[1], L = Math.hypot(dx, dy) || 1; return [p[0] + dy / L * d, p[1] - dx / L * d]; });
    for (const h of S.hedges || []) line(off(h.line, SITE.HEDGE_W / 2 + 10), SITE.HEDGE_W, 'hedge');
    for (const f of S.fences || []) line(f.line, 80, 'fence');
    for (const g of S.gates || []) line(g.line, 120, 'door:' + g.id, { door: true, active: true });
    for (const t of S.street?.trees || []) blockers.push({ rect: [t.x - 150, t.y - 150, t.x + 150, t.y + 150], z0: -3000, z1: 5000, id: 'tree', level: 'site', soft: true });
    for (const o of S.objects || []) if (o.rect && (o.kind === 'bin' || o.kind === 'pillar')) blockers.push({ rect: o.rect, z0: -3000, z1: 5000, id: o.kind, level: 'site' });
  }
  return { surfaces, blockers, ground: G ? G.ground : null };
}
const rectPoly = ([x0, y0, x1, y1]) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];

/** Blockers of one level's furniture (rotated footprint → AABB, on the room floor + `z`); tagged `furniture` so the editor can replace them. */
export function furnitureBlockers(L, lk, ground = null) {
  const zf = L.z_floor ?? L.elev ?? 0, out = [];
  const floorAtPt = (x, y) => { const r = L.rooms.find(rm => pointInPoly(x, y, rm.poly)); return r ? roomFloorZ(r, zf) : (ground && zf === 0 ? ground(x, y) : zf); }; // outside every room (garden): on the terrain
  for (const f of L.furniture || []) {
    const [x0, y0, x1, y1] = f.rect, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, a = (f.rot || 0) * Math.PI / 180;
    const hw = (x1 - x0) / 2, hd = (y1 - y0) / 2, ex = Math.abs(hw * Math.cos(a)) + Math.abs(hd * Math.sin(a)), ey = Math.abs(hw * Math.sin(a)) + Math.abs(hd * Math.cos(a));
    const z0 = floorAtPt(cx, cy) + (f.z || 0);
    out.push({ rect: [cx - ex, cy - ey, cx + ex, cy + ey], z0, z1: z0 + (f.h || 750), id: 'furn:' + f.id, level: lk, furniture: true, soft: true });
  }
  return out;
}
/** Replace the furniture blockers of one level in place (after an edit); door and other blockers keep their identity. */
export function refreshFurnitureBlockers(col, L, lk) {
  for (let i = col.blockers.length - 1; i >= 0; i--) if (col.blockers[i].furniture && col.blockers[i].level === lk) col.blockers.splice(i, 1);
  col.blockers.push(...furnitureBlockers(L, lk, col.ground));
}
/** heights of built-in fixtures without z in the data (mm) */
const BUILTIN_H = [[/^f_kuch/, 900], [/krb/, 2900], [/skrin/, 2100], [/vkuch/, 900], [/pracka/, 1700], [/mrazak/, 1800], [/technol/, 1900], [/regaly/, 2000], [/f2_wc/, 800], [/sprcha/, 2000], [/umyv/, 850], [/vana/, 600]];

/** Height of the floor under (x,y) for a player whose feet are at `feet`: the highest surface not more than STEP above the feet; ground if none. */
export function floorAt(col, x, y, feet) {
  let best = -Infinity;
  for (const s of col.surfaces) {
    if (s.z > feet + WALK.STEP || s.z <= best) continue;
    if (!pointInPoly(x, y, s.poly) || s.holes.some(h => x > h[0] && x < h[2] && y > h[1] && y < h[3])) continue; // hole edge counts as floor: the top tread's edge lies exactly on it
    best = s.z;
  }
  if (best !== -Infinity) return best;
  return col.ground ? col.ground(x, y) : CONST.GROUND; // terrain (with driveway / path ramps) is the ground
}

/** Push the point p {x,y} out of every active blocker (circle vs AABB), in place. Returns true if anything moved. */
export function resolveXY(col, p, feet) {
  let moved = false;
  const head = feet + WALK.HEIGHT, minTop = feet + WALK.STEP;
  for (let iter = 0; iter < 3; iter++) {
    let any = false;
    for (const b of col.blockers) {
      if (b.active === false || !(b.z0 < head && b.z1 > minTop)) continue;
      const r = b.soft ? WALK.SOFT_RADIUS : WALK.RADIUS, [x0, y0, x1, y1] = b.rect;
      const cx = Math.max(x0, Math.min(p.x, x1)), cy = Math.max(y0, Math.min(p.y, y1));
      let dx = p.x - cx, dy = p.y - cy, d2 = dx * dx + dy * dy;
      if (d2 >= r * r) continue;
      if (d2 > 1e-6) { const d = Math.sqrt(d2), k = (r - d) / d; p.x += dx * k; p.y += dy * k; }
      else { // centre inside the box: exit through the nearest face
        const ex = [p.x - x0 + r, x1 - p.x + r], ey = [p.y - y0 + r, y1 - p.y + r];
        const m = Math.min(ex[0], ex[1], ey[0], ey[1]);
        if (m === ex[0]) p.x = x0 - r; else if (m === ex[1]) p.x = x1 + r; else if (m === ey[0]) p.y = y0 - r; else p.y = y1 + r;
      }
      any = moved = true;
    }
    if (!any) break;
  }
  return moved;
}
