// geometry.js — builds the house from the *effective* model.
//
// COORDINATE CONVENTIONS
//   Model (JSON): millimetres. Origin = north-west outer corner of the house.
//     x → east, y → south, z → up; z = 0 is the ground-floor finished floor (±0,000).
//     rect = [x0, y0, x1, y1] in plan (outer outline), walls/fixtures may carry z0/z1.
//   three.js (world): metres, right-handed, Y up.
//     X = x / 1000 (east), Y = z / 1000 (up), Z = y / 1000 (south).
//     So north is −Z, south is +Z, east is +X, west is −X.
//   Use M(v) to convert a length and P(x, y, z) to convert a point (prims.js).
//
// Walls are split into boxes around their openings (openings.js); glazing, doors, lamellas,
// railings and the pergola are parametric (openings.js / details.js). Everything is derived from
// the JSON — nothing is re-measured from the PDFs.

import * as THREE from 'three';
import { M, CONST, boxFromRect, prismFromPoly, rectilinearPrism, rectPoly, bboxOf, polyBBox, rectHitsPoly, pointInPoly } from './prims.js';
import { mats } from './materials.js';
import { buildWall, wallFrame } from './openings.js';
import { lamellaWall, pergola, railing, greenRoof, chimney, roofSlab } from './details.js';
import { roomFloorZ, roomCeil } from './config.js';
import { stairPlan, STAIR } from './stairs.js';
import { buildColliders, floorRaise as colFloorRaise } from './collision.js';
import { buildFurniture, buildKitchen, buildBuiltins } from './furniture.js';
import { makeGround } from './terrain.js';
import { buildSite } from './site.js';

export { CONST, M } from './prims.js';
export { mats as materials } from './materials.js';

export const OUTDOOR_Z = CONST.OUTDOOR_Z;

/**
 * Build the whole house. Returns { root, groups } where groups = { np1, slab, np2, roof, ground }
 * so the viewer can hide upper parts for plan-like views.
 */
export function buildHouse(m) {
  const root = new THREE.Group(); root.name = 'house';
  const groups = {};
  const mk = name => { const g = new THREE.Group(); g.name = name; root.add(g); groups[name] = g; return g; };
  const levels = m.levels, keys = Object.keys(levels);
  const zfOf = L => L.z_floor ?? L.elev ?? 0;
  const stairPlans = [], lamps = [];
  const G = makeGround(m); // terrain: needed by the furniture on the site (hen house, compost) and by the site builder

  // fixture masses (anything with z1), deduped across levels — the first (lower) level wins
  const masses = dedupeMasses(keys.flatMap(lk => levels[lk].fixtures.filter(f => f.rect && f.z1 != null).map(f => ({ f, z0: f.z0 ?? zfOf(levels[lk]), z1: f.z1, lk }))));

  for (const lk of keys) {
    const L = levels[lk], zf = zfOf(L), g = mk(lk);
    const floorRaise = o => colFloorRaise(o, L, zf); // lift door bottoms to the adjacent indoor floor (garage +300)

    // stair plan first (walls standing inside the stair footprint stop below the treads above them)
    const upperK = keys[keys.indexOf(lk) + 1];
    const sfx = L.fixtures.find(f => /^f\d*_schod$/.test(f.id) && f.rect);
    let stairP = null;
    if (sfx && upperK) {
      const room = L.rooms.find(r => /schod/i.test(r.id) && rectHitsPoly(sfx.rect, r.poly)) || L.rooms.find(r => rectHitsPoly(sfx.rect, r.poly) && /schod/i.test(r.name));
      const vf = levels[upperK].fixtures.find(f => /^f\d*_schod$/.test(f.id) && f.rect);
      stairP = stairPlan(sfx, room, { riseTotal: zfOf(levels[upperK]) - zf, walls: L.walls, voidX0: vf ? vf.rect[0] : undefined, ceilZ: L.height || 2600 });
    }
    const wallsHere = stairP ? clipUnderStair(L.walls, sfx.rect, stairP, zf, L) : L.walls;
    for (const w of wallsHere) {
      const ops = L.openings.filter(o => o.wall === w.id);
      const z0 = w.z0 ?? zf, z1 = w.z1 ?? zf + (L.height || 2900);
      const mesh = w.kind === 'lamely' ? lamellaWall(w, z0 <= 0 ? CONST.TERRACE_Z : z0, z1, masses) : buildWall(w, ops, zf, L, floorRaise, masses);
      mesh.userData.level = lk;
      g.add(mesh);
    }

    for (const r of L.rooms) {
      const zTop = roomFloorZ(r, zf);
      let t, material;
      if (r.outdoor) { t = zf === 0 ? 900 : CONST.DECK_T; material = zf === 0 ? mats.floorOut : mats.deck; } // ground-floor outdoor slabs reach below the terrain (slabs at ±0, natural ground −716 at the SW corner)
      else {
        const off = zTop - zf;
        t = zf === 0 ? CONST.GROUND_FLOOR_T + off : CONST.FLOOR_T;
        // DSP room tables: 1 NP ceramic tiles everywhere, garage + workshop TAURUS paving; 2 NP wood, bathrooms tiles
        material = off || /gar|díln/i.test(r.name) ? mats.floorGar : zf === 0 || /koup|wc/i.test(r.name) ? mats.floorTile : mats.floorIn;
      }
      const voids = zf > 0 ? L.fixtures.filter(f => /^f\d*_schod$/.test(f.id) && f.rect && rectHitsPoly(f.rect, r.poly)).map(f => f.rect) : [];
      const lift = zf > 0 ? 2 : 0; // upper floors drawn 2 mm high: lower-level walls end at the upper floor's top (RD Vysoký Újezd vych1 +3,050 under the cantilever rooms) and would flicker through it
      const mesh = voids.length ? rectilinearPrism(r.poly, voids, zTop + lift, t + lift, material) : prismFromPoly(r.poly, zTop + lift, t + lift, material);
      mesh.name = 'floor:' + r.id; mesh.userData = { kind: 'floor', id: r.id, level: lk, data: r, zTop };
      g.add(mesh);
    }

    // lowered SDK ceilings (room field `ceil`, DSP "s.v. 2 400"): a white ceiling layer below the slab
    for (const r of L.rooms) if (!r.outdoor && r.ceil && r.ceil < (L.height || 2600) - 20) {
      const c = prismFromPoly(r.poly, zf + r.ceil + 30, 30, mats.ceiling); c.name = 'ceiling:' + r.id;
      (groups['ceil_' + lk] || mk('ceil_' + lk)).add(c); // own group: hidden in this level's plan view (main.js setLevel)
      // open winders above a lowered ceiling (RD Vysoký Újezd: the top winders over the WC corner of bathroom 1.07) would poke
      // through it: box them in from just below the lowest wedge up to the ceiling (DSP B-B: the ceiling steps down there)
      const cen = poly => poly.reduce((a, p) => [a[0] + p[0] / poly.length, a[1] + p[1] / poly.length], [0, 0]);
      const wedges = stairP ? stairP.treads.filter(t => t.open && pointInPoly(...cen(t.poly), r.poly)) : [];
      const low = Math.min(...wedges.map(t => t.z - STAIR.TREAD_T - 250));
      if (wedges.length && zf + low < zf + r.ceil + 30) {
        const xs = wedges.flatMap(t => t.poly.map(p => p[0])), ys = wedges.flatMap(t => t.poly.map(p => p[1]));
        const box = boxFromRect([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)], zf + low - 20, zf + r.ceil + 30, mats.ceiling); box.name = 'ceiling:' + r.id + ':stair';
        groups['ceil_' + lk].add(box);
      }
    }

    // furniture + built-ins (kitchen run, bath, tech room, fireplace, hall unit)
    g.add(buildFurniture(L, zf, G.ground)); g.add(buildKitchen(L, zf)); g.add(buildBuiltins(L, zf));
    // ceiling lamps in every indoor room (glow at night; the largest rooms also get point lights — lighting.js),
    // except where the ceiling is the stair void (the lamp would float over the stairs)
    const upper = keys[keys.indexOf(lk) + 1];
    const voidRects = upper ? levels[upper].fixtures.filter(f => /^f\d*_schod$/.test(f.id) && f.rect).map(f => f.rect) : [];
    for (const r of L.rooms) if (!r.outdoor) for (const p of lampSpots(r)) {
      if (voidRects.some(v => p[0] >= v[0] && p[0] <= v[2] && p[1] >= v[1] && p[1] <= v[3])) continue;
      const z = zf + roomCeil(r, L) - 30; lamps.push({ room: r.id, x: p[0], y: p[1], z, area: polyArea(r.poly) / 1e6 });
      const lamp = new THREE.Mesh(new THREE.CylinderGeometry(M(160), M(160), M(24), 24), mats.lamp); lamp.position.set(M(p[0]), M(z - 12), M(p[1])); lamp.name = 'lamp:' + r.id; g.add(lamp);
    }

    // chimney: once, from the lowest level that has it
    const kom = L.fixtures.find(f => /komin/.test(f.id) && f.rect);
    if (kom && lk === keys[0]) g.add(chimney(kom, zf));

    // stairs: from the stair fixture + stair room of this level, only where a void exists above (not the top level)
    if (stairP) { stairPlans.push({ plan: stairP, level: lk, upper }); g.add(stairMesh(stairP, zf, sfx.id)); }
  }
  // railing along the open edge of the stair void on the upper floor
  for (const { plan, upper } of stairPlans) groups[upper].add(railing({ id: 'stair_rail', rect: plan.voidRail }, plan.top.z, plan.top.z + 1000));

  // fixture masses by role
  const np2 = levels.np2, zf2 = np2 ? zfOf(np2) : CONST.Z2;
  const houseOuter = np2 ? bboxOf(np2.walls.filter(w => w.kind === 'ext').map(w => w.rect)) : null;
  const deckRects = np2 ? np2.rooms.filter(r => r.outdoor).map(r => rectPoly(r.poly).length === 4 ? bboxOf([[...r.poly[0], ...r.poly[2]]]) : bboxOf([[Math.min(...r.poly.map(p => p[0])), Math.min(...r.poly.map(p => p[1])), Math.max(...r.poly.map(p => p[0])), Math.max(...r.poly.map(p => p[1]))]])) : [];
  for (const mm of masses) {
    const { f, z0, z1, lk } = mm, g = groups[lk];
    if (/perg/.test(f.id)) g.add(pergola(f, z0, z1, CONST.TERRACE_Z));
    else if (/zabr/.test(f.id)) g.add(railing(f, z0, z1));
    else if (/f2_gar|pristavba/.test(f.id)) g.add(roofSlab(f, z0, z1));
    else if (/striska/.test(f.id)) { const b = boxFromRect(f.rect, z0, z1 - 40, mats.ext); b.name = 'fixture:' + f.id; g.add(b); g.add(boxFromRect(f.rect, z1 - 40, z1, mats.frame)); } // white rendered canopy, anthracite flashing on top (D.1.1.5)
    else if (/strecha/.test(f.id)) { // non-walkable flat roof of a one-storey part: white ceiling layer + roof body (PVC membrane grey)
      const r = [f.rect[0] + 20, f.rect[1] + 20, f.rect[2] - 20, f.rect[3] - 20]; // inset: no coplanar faces with the attic walls
      const c = boxFromRect(r, z0, z0 + 30, mats.slab); c.name = 'fixture:' + f.id; g.add(c); g.add(boxFromRect(r, z0 + 30, z1, mats.roof)); }
    else if (/konzola/.test(f.id)) { const b = boxFromRect(f.rect, z0, z1 - CONST.FLOOR_T - 5, mats.ext); b.name = 'fixture:' + f.id; g.add(b); } // 2 NP cantilever: rendered soffit +2,500 and edge, top just under the 2 NP floor finish
    else if (/sloup/.test(f.id)) { const b = boxFromRect(f.rect, z0, z1, mats.wood); b.name = 'fixture:' + f.id; g.add(b); }      // timber post under the canopy
    else if (/drevo/.test(f.id)) { const b = boxFromRect(f.rect, z0, z1, mats.wood); b.name = 'fixture:' + f.id; g.add(b); }
    else { const b = boxFromRect(f.rect, z0, z1, mats.mass); b.name = 'fixture:' + f.id; b.userData = { kind: 'fixture', id: f.id, level: lk, data: f }; g.add(b); }
  }
  // green roof (no z in the data): 60 mm layer on the +3,550 garage roof, minus the deck and the house
  if (np2) for (const f of np2.fixtures.filter(f => /zelena/.test(f.id) && f.rect)) {
    const gr = masses.find(mm => /f2_gar/.test(mm.f.id));
    groups.np2.add(greenRoof(f, [...deckRects, houseOuter].filter(Boolean), gr ? gr.z1 : 3550));
  }

  // slab between floors + main-house roof — derived from the upper level's exterior walls
  if (np2) {
    const voidRects = np2.fixtures.filter(f => f.id === 'f2_schod' && f.rect).map(f => [...f.rect]);
    // bevelled slab edge over the first treads (CONST.SLAB_CHAMFER, DSP D.1.1.4 section B-B): from the slab underside above the
    // first riser up to the floor at the void edge, so the headroom over the bottom treads is the floor height, not the slab's
    const sp = CONST.SLAB_CHAMFER && voidRects.length ? stairPlans.find(s => s.plan.layout === 'straight+fanES') : null;
    const fx0 = sp ? Math.min(...sp.plan.treads.flatMap(t => t.poly.map(p => p[0]))) : Infinity;
    const chamfer = sp && fx0 < voidRects[0][0] - 50 ? [fx0, voidRects[0][1], voidRects[0][0], voidRects[0][3]] : null;
    if (chamfer) voidRects[0][0] = fx0;
    const gs = mk('slab');
    const ins = 50, slabRect = [houseOuter[0] + ins, houseOuter[1] + ins, houseOuter[2] - ins, houseOuter[3] - ins]; // inset: no coplanar faces with the walls
    const slab = prismFromPoly(rectPoly(slabRect), zf2 - CONST.FLOOR_T, CONST.SLAB_T - CONST.FLOOR_T, mats.slab, voidRects.map(rectPoly));
    slab.name = 'slab:np1-np2'; gs.add(slab);
    if (chamfer) {
      const [cx0, cy0, cx1, cy1] = chamfer, zb = zf2 - CONST.SLAB_T, zt = zf2 - CONST.FLOOR_T, sh = new THREE.Shape();
      sh.moveTo(M(cx0), M(zb)); sh.lineTo(M(cx1), M(zt)); sh.lineTo(M(cx0), M(zt)); sh.closePath();
      const w = new THREE.Mesh(new THREE.ExtrudeGeometry(sh, { depth: M(cy1 - cy0), bevelEnabled: false }), mats.slab);
      w.position.z = M(cy0); w.castShadow = w.receiveShadow = true; w.name = 'slab:chamfer'; gs.add(w);
    }
    const gr = mk('roof');
    const t = Math.min(...np2.walls.filter(w => w.kind === 'ext').map(w => w.t));
    const inner = [houseOuter[0] + t, houseOuter[1] + t, houseOuter[2] - t, houseOuter[3] - t];
    const ceil = zf2 + (np2.height || 2600);
    const roof = prismFromPoly(rectPoly(inner), ceil + CONST.ROOF_T, CONST.ROOF_T - 30, mats.roof);
    roof.name = 'roof:house'; gr.add(roof);
    const cl = prismFromPoly(rectPoly(inner), ceil + 30, 30, mats.ceiling); cl.name = 'ceiling:np2'; gr.add(cl); // 2 NP ceiling (SDK, white) under the roof package
  }

  // site: terrain from the survey with holes under the building, road, fence + gates, driveway, garden
  const L1 = levels[keys[0]];
  const footprint = [...L1.walls.map(w => w.rect), ...L1.rooms.map(r => polyBBox(r.poly))];
  const strom = L1.fixtures.find(f => f.circle && /strom/.test(f.id));
  const site = buildSite(m, G, footprint, strom ? strom.circle : null);
  const gg = mk('ground'); gg.add(site.root);
  groups.veg = site.veg;

  const colliders = buildColliders(m, stairPlans, G);
  return { root, groups, masses, stairPlans, colliders, ground: G, lamps };
}

/** Walls overlapping the stair footprint are split: the part under the flight stops 200 below the lowest tread above it. */
function clipUnderStair(walls, fr, plan, zf, L) {
  const out = [];
  for (const w of walls) {
    const r = w.rect, ix0 = Math.max(r[0], fr[0]), iy0 = Math.max(r[1], fr[1]), ix1 = Math.min(r[2], fr[2]), iy1 = Math.min(r[3], fr[3]);
    if (w.kind === 'ext' || ix1 - ix0 <= 0 || iy1 - iy0 <= 0) { out.push(w); continue; }
    const over = plan.treads.filter(t => { const xs = t.poly.map(p => p[0]), ys = t.poly.map(p => p[1]); return Math.min(...xs) < ix1 && Math.max(...xs) > ix0 && Math.min(...ys) < iy1 && Math.max(...ys) > iy0; });
    if (!over.length) { out.push(w); continue; }
    const zTop = zf + Math.min(...over.map(t => t.z)) - STAIR.TREAD_T - (CONST.STAIR_LEDS ? 200 : 5); // up to the lowest tread above it (200 lower where LED strips glow under the noses)
    const horiz = r[2] - r[0] >= r[3] - r[1], a0 = horiz ? r[0] : r[1], a1 = horiz ? r[2] : r[3], c0 = horiz ? ix0 : iy0, c1 = horiz ? ix1 : iy1;
    const part = (s0, s1, extra) => ({ ...w, ...extra, rect: horiz ? [s0, r[1], s1, r[3]] : [r[0], s0, r[2], s1] });
    if (c0 > a0) out.push(part(a0, c0, {}));
    out.push(part(c0, c1, { id: w.id + ':podschod', z1: Math.min(w.z1 ?? zf + (L.height || 2600), zTop) }));
    if (c1 < a1) out.push(part(c1, a1, { id: w.id + ':za' }));
  }
  return out;
}

const polyArea = poly => Math.abs(poly.reduce((a, p, i) => { const q = poly[(i + 1) % poly.length]; return a + p[0] * q[1] - q[0] * p[1]; }, 0)) / 2;
/** Lamp positions of a room: the centroid (or the bbox centre if the centroid falls outside an L-shape); big rooms get two along the long axis. */
function lampSpots(r) {
  const b = polyBBox(r.poly), cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2, area = polyArea(r.poly) / 1e6;
  let sx = 0, sy = 0, A = 0; for (let i = 0; i < r.poly.length; i++) { const p = r.poly[i], q = r.poly[(i + 1) % r.poly.length], c = p[0] * q[1] - q[0] * p[1]; A += c; sx += (p[0] + q[0]) * c; sy += (p[1] + q[1]) * c; }
  const centroid = A ? [sx / (3 * A), sy / (3 * A)] : [cx, cy];
  if (area > CONST.LAMP_TWO_ABOVE) {
    const longX = b[2] - b[0] >= b[3] - b[1];
    const two = longX ? [[b[0] + (b[2] - b[0]) / 3, centroid[1]], [b[0] + 2 * (b[2] - b[0]) / 3, centroid[1]]] : [[centroid[0], b[1] + (b[3] - b[1]) / 3], [centroid[0], b[1] + 2 * (b[3] - b[1]) / 3]];
    if (two.every(p => pointInPoly(p[0], p[1], r.poly))) return two;
  }
  return [pointInPoly(centroid[0], centroid[1], r.poly) ? centroid : [cx, cy]];
}

/**
 * Stair: the bottom winder is a solid block, the straight flight and the top winder are open below — oak treads and white risers on a
 * sloped white soffit slab (so the space under it, e.g. in the pantry, is usable). Glass railing along the
 * flight's south edge only when no wall runs there.
 */
function stairMesh(plan, zf, id) {
  const g = new THREE.Group(); g.name = 'fixture:' + id; g.userData = { kind: 'stair', id, plan };
  const straight = plan.treads.filter(t => t.kind === 'straight');
  for (const t of plan.treads) {
    g.add(prismFromPoly(t.poly, zf + t.z, STAIR.TREAD_T, mats.floorIn));
    if (t.kind !== 'straight') { // winder: solid block at the bottom; the top winder (over the pantry) is open below — a 250 slab under each wedge
      if (t.open) g.add(prismFromPoly(t.poly, zf + t.z - STAIR.TREAD_T, 250, mats.int));
      else if (t.z - STAIR.TREAD_T > zf) g.add(prismFromPoly(t.poly, zf + t.z - STAIR.TREAD_T, t.z - STAIR.TREAD_T, mats.int));
      continue; }
    const xs = t.poly.map(p => p[0]), ys = t.poly.map(p => p[1]);
    const xb = t.riserX != null ? t.riserX + 40 : Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys); // riser at the low side of the step
    g.add(boxFromRect([xb - 40, y0, xb, y1], zf + t.z - plan.rise - 60, zf + t.z - STAIR.TREAD_T, mats.int));
  }
  if (straight.length) { // sloped soffit slab 250 thick, 200 below the nose line, over the whole straight run
    const xs = straight.flatMap(t => t.poly.map(p => p[0])), ys = straight.flatMap(t => t.poly.map(p => p[1]));
    const y0 = Math.min(...ys), y1 = Math.max(...ys), risesEast = plan.layout === 'straight+fanES';
    const xE = risesEast ? Math.min(...xs) : Math.max(...xs), xW = risesEast ? Math.max(...xs) : Math.min(...xs); // xE = low end, xW = high end
    const zE = Math.min(...straight.map(t => t.z)) - plan.rise, zW = Math.max(...straight.map(t => t.z)); // nose line: (xE, zE) → (xW, zW)
    // profile in the x–z plane with vertical ends (a rotated box poked past the end walls): top SOFFIT_GAP below the nose
    // line, vertical thickness SOFFIT_T / cos(pitch); clamped to the floor where it runs into it at the bottom
    const k = (zW - zE) / Math.abs(xW - xE), tv = STAIR.SOFFIT_T * Math.hypot(1, k), top = x => zE + Math.abs(x - xE) * k - STAIR.SOFFIT_GAP;
    const sh = new THREE.Shape(), pt = (x, z) => [M(x), M(zf + Math.max(z, 0))];
    sh.moveTo(...pt(xE, top(xE))); sh.lineTo(...pt(xW, top(xW))); sh.lineTo(...pt(xW, top(xW) - tv)); sh.lineTo(...pt(xE, top(xE) - tv)); sh.closePath();
    const slab = new THREE.Mesh(new THREE.ExtrudeGeometry(sh, { depth: M(y1 - y0), bevelEnabled: false }), mats.int);
    slab.position.z = M(y0); slab.castShadow = slab.receiveShadow = true; g.add(slab);
  }
  for (const w of plan.sideWalls || []) { // partition closing an open stretch of the flight's side: from the soffit underside up to the ceiling
    const [x0, y0, x1, y1] = w.rect, sh = new THREE.Shape();
    sh.moveTo(M(x0), M(zf + w.zb0)); sh.lineTo(M(x1), M(zf + w.zb1)); sh.lineTo(M(x1), M(zf + w.zt)); sh.lineTo(M(x0), M(zf + w.zt)); sh.closePath();
    const pw = new THREE.Mesh(new THREE.ExtrudeGeometry(sh, { depth: M(y1 - y0), bevelEnabled: false }), mats.int);
    pw.position.z = M(y0); pw.castShadow = pw.receiveShadow = true; pw.name = 'stair:sidewall'; g.add(pw);
  }
  if (CONST.STAIR_LEDS) g.add(stairLeds(plan, zf)); // LED strips under the noses: a Vlašim owner request, off here
  // stepped glass panels on the south edge of the straight flight + a sloped handrail on top
  const py = plan.pivot[1], H = 1000;
  for (const t of plan.railTreads) {
    const xa = Math.min(...t.poly.map(p => p[0])), xb = Math.max(...t.poly.map(p => p[0]));
    const gl = boxFromRect([xa, py - 12, xb, py], zf + t.z - plan.rise, zf + t.z + H - 60, mats.glass); gl.castShadow = false; g.add(gl);
  }
  if (plan.railTreads.length) {
    const xs = plan.railTreads.flatMap(t => t.poly.map(p => p[0])), x0 = Math.min(...xs), x1 = Math.max(...xs);
    const zLo = Math.min(...plan.railTreads.map(t => t.z)), zHi = Math.max(...plan.railTreads.map(t => t.z)) + plan.rise;
    const len = Math.hypot(x1 - x0, zHi - zLo);
    const rail = new THREE.Mesh(new THREE.BoxGeometry(M(len), M(40), M(60)), mats.frame);
    rail.position.set(M((x0 + x1) / 2), M(zf + (zLo + zHi) / 2 + H - 20), M(py - 6));
    rail.rotation.z = -Math.atan2(zHi - zLo, x1 - x0); // rises toward −x (west)
    rail.castShadow = true; g.add(rail);
  }
  return g;
}

/**
 * LED stair lighting (owner's reference photo): a strip under every tread nose and a warm glow that fades down the
 * riser below it. The nose edge = the edge shared with the previous tread (fan: first polygon edge, straight: east
 * edge); the glow is one vertex-coloured additive mesh (warm at the top, black at the bottom) so the merge pass
 * leaves it alone; the strips are emissive boxes. lighting.js dims both by day.
 */
function stairLeds(plan, zf) {
  const g = new THREE.Group(); g.name = 'stair:led';
  const STRIP = 14, pos = [], col = [], idx = [];
  const centroid = poly => poly.reduce((a, p) => [a[0] + p[0] / poly.length, a[1] + p[1] / poly.length], [0, 0]);
  plan.treads.forEach((t, i) => {
    const [A, B] = t.kind === 'fan' ? [t.poly[0], t.poly[1]] : [t.poly[1], t.poly[2]];
    const mid = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2], len = Math.hypot(B[0] - A[0], B[1] - A[1]);
    if (len < 50) return;
    const d = [(B[0] - A[0]) / len, (B[1] - A[1]) / len];
    let n = [-d[1], d[0]]; // perpendicular; flipped to point toward the lower tread (or the entry for the first one)
    const toward = i ? centroid(plan.treads[i - 1].poly) : (t.kind === 'fan' ? [mid[0], mid[1] + 1000] : [mid[0] + 1000, mid[1]]);
    if ((toward[0] - mid[0]) * n[0] + (toward[1] - mid[1]) * n[1] < 0) n = [-n[0], -n[1]];
    const zTop = zf + t.z - STAIR.TREAD_T, zBot = zf + (i ? plan.treads[i - 1].z : 0);
    // strip: recessed 10 mm under the nose
    const strip = new THREE.Mesh(new THREE.BoxGeometry(M(len - 20), M(STRIP), M(STRIP)), mats.led);
    strip.position.set(M(mid[0] - n[0] * 10), M(zTop - STRIP / 2 - 2), M(mid[1] - n[1] * 10)); strip.rotation.y = -Math.atan2(d[1], d[0]);
    g.add(strip);
    // wash quad 2 mm in front of the riser face: warm at the nose, black at the lower tread
    const a = [A[0] + n[0] * 2, A[1] + n[1] * 2], b = [B[0] + n[0] * 2, B[1] + n[1] * 2], k = pos.length / 3;
    pos.push(M(a[0]), M(zTop), M(a[1]), M(b[0]), M(zTop), M(b[1]), M(b[0]), M(zBot), M(b[1]), M(a[0]), M(zBot), M(a[1]));
    col.push(1, 0.72, 0.42, 1, 0.72, 0.42, 0, 0, 0, 0, 0, 0);
    idx.push(k, k + 1, k + 2, k, k + 2, k + 3);
  });
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geom.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); geom.setIndex(idx); geom.computeVertexNormals();
  const wash = new THREE.Mesh(geom, mats.ledWash); wash.name = 'stair:ledwash'; wash.renderOrder = 5; g.add(wash);
  return g;
}

/** Drop masses that are (almost) fully contained in another mass; on a tie the earlier (lower level) wins. */
function dedupeMasses(list) {
  const vol = a => (a.f.rect[2] - a.f.rect[0]) * (a.f.rect[3] - a.f.rect[1]) * (a.z1 - a.z0);
  const inter = (a, b) => {
    const dx = Math.min(a.f.rect[2], b.f.rect[2]) - Math.max(a.f.rect[0], b.f.rect[0]);
    const dy = Math.min(a.f.rect[3], b.f.rect[3]) - Math.max(a.f.rect[1], b.f.rect[1]);
    const dz = Math.min(a.z1, b.z1) - Math.max(a.z0, b.z0);
    return dx > 0 && dy > 0 && dz > 0 ? dx * dy * dz : 0;
  };
  return list.filter((a, i) => !list.some((b, j) => {
    if (i === j) return false;
    const ab = inter(a, b), sameish = ab > 0.9 * vol(a) && ab > 0.9 * vol(b);
    return sameish ? j < i : (vol(b) > vol(a) && ab > 0.9 * vol(a));
  }));
}
