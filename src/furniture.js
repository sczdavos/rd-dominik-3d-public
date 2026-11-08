// furniture.js — parametric furniture (IKEA-catalogue abstraction) and built-in fixtures (kitchen, bath, tech room).
//
// Each item is built in a local frame: X = along the item's back (width w), Z = depth d, the BACK at +Z,
// the FRONT facing −Z, origin at the footprint centre on the floor. The group is then rotated so the back
// faces the chosen side (S: 0, E: +90°, W: −90°, N: 180°) plus the item's own `rot` (degrees, clockwise in
// plan) and placed at the rect centre on the room floor. Orientation rules: see `orient()`; an explicit
// `back: 'N'|'S'|'E'|'W'` on the item (written by the editor when you rotate) overrides the inference.
import * as THREE from 'three';
import { M, box, boxFromRect, rectsOverlap, prismFromPoly } from './prims.js';
import { mats } from './materials.js';
import { roomFloorZ, CONST } from './config.js';
import { pointInPoly, hiddenDoorRect } from './collision.js';
import { mergeInto } from './merge.js';

const F = {
  oak: new THREE.MeshStandardMaterial({ color: 0xc9a06a, roughness: 0.75 }),
  white: new THREE.MeshStandardMaterial({ color: 0xf4f4f2, roughness: 0.6 }),
  fabric: new THREE.MeshStandardMaterial({ color: 0x8d8f93, roughness: 0.95 }),
  fabricDark: new THREE.MeshStandardMaterial({ color: 0x5c6066, roughness: 0.95 }),
  linen: new THREE.MeshStandardMaterial({ color: 0xf6f6f4, roughness: 0.9 }),
  blanket: new THREE.MeshStandardMaterial({ color: 0xa9b0b8, roughness: 0.95 }),
  chrome: mats.chrome,
  black: new THREE.MeshStandardMaterial({ color: 0x25272a, roughness: 0.5, metalness: 0.3 }),
  steel: new THREE.MeshStandardMaterial({ color: 0xb8bcc0, roughness: 0.35, metalness: 0.7 }),
  ceramic: new THREE.MeshStandardMaterial({ color: 0xfafaf8, roughness: 0.3 }),
  glass: mats.glass,
  concrete: mats.floorOut,
  anthracite: mats.frame,
  car: new THREE.MeshStandardMaterial({ color: 0x3b4149, roughness: 0.35, metalness: 0.6 }),
  carGlass: new THREE.MeshStandardMaterial({ color: 0x1c2126, roughness: 0.1, metalness: 0.5 }),
  rubber: new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.9 }),
  grey: new THREE.MeshStandardMaterial({ color: 0x9a9da2, roughness: 0.8 }),
  screen: new THREE.MeshStandardMaterial({ color: 0x0b0d10, roughness: 0.2, metalness: 0.4 }),
  carpet: new THREE.MeshStandardMaterial({ color: 0xd8d2c4, roughness: 1 }),
  travertine: new THREE.MeshStandardMaterial({ color: 0xd9c9ad, roughness: 0.85 }),
  fire: new THREE.MeshStandardMaterial({ color: 0xff7a1a, emissive: 0xff5a00, emissiveIntensity: 1.2, roughness: 1 }),
  books: [0x8a4b3c, 0x3d5a80, 0x5b7f5b, 0xd9b45b, 0x6b5b95, 0xe0e0dc, 0x2f3e46].map(c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.9 })),
  leaf: new THREE.MeshStandardMaterial({ color: 0x3c6338, roughness: 0.55, flatShading: true }),        // mature fig leaves (dark, glossy)
  leafLight: new THREE.MeshStandardMaterial({ color: 0x87b551, roughness: 0.7, flatShading: true }),    // fresh growth at the tips
  soil: new THREE.MeshStandardMaterial({ color: 0x3a2f26, roughness: 1 }),
  joint: new THREE.MeshStandardMaterial({ color: 0xbfc0bc, roughness: 0.7 }),                         // wardrobe carcass: shows as thin lines in the 12 mm joints between the white fronts
  cabinet: mats.cabinet, cabinetBox: mats.cabinetBox,                                                   // kitchen wall cabinets (greige — visibly different from the white base)
  mesh: mats.mesh,                                                                                       // wire mesh (hen run)
  paint: new THREE.MeshStandardMaterial({ color: 0x9a3b2e, roughness: 0.85 }),                          // painted hen house (falu red)
  roofFelt: new THREE.MeshStandardMaterial({ color: 0x3b3a38, roughness: 0.95 }),
  compost: new THREE.MeshStandardMaterial({ color: 0x4a3a28, roughness: 1 }),
  towel: new THREE.MeshStandardMaterial({ color: 0x6f93b0, roughness: 1 }),                          // bathroom towels (dusty blue — reads against white units and walls)
};
export const furnitureMaterials = F;

// ---------- helpers ----------
/** box in the item's local frame: size (w × h × d), centre (x, z=height, y=depth) in mm */
const bx = (g, w, h, d, x, z, y, mat) => { const m = box(w, h, d, x, z, y, mat); g.add(m); return m; };
const cyl = (g, r, h, x, z, y, mat, seg = 20) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(M(r), M(r), M(h), seg), mat); m.position.set(M(x), M(z), M(y)); m.castShadow = m.receiveShadow = true; g.add(m); return m; };
/** thin (slightly tapered) cylinder between two local points [x, z (height), y (depth)] — trunks and branches */
const stem = (g, a, b, r, mat, seg = 8) => {
  const v = new THREE.Vector3(M(b[0] - a[0]), M(b[1] - a[1]), M(b[2] - a[2])), len = v.length();
  const m = new THREE.Mesh(new THREE.CylinderGeometry(M(r) * 0.7, M(r), len, seg), mat);
  m.position.set(M((a[0] + b[0]) / 2), M((a[1] + b[1]) / 2), M((a[2] + b[2]) / 2));
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), v.divideScalar(len));
  m.castShadow = m.receiveShadow = true; g.add(m); return m;
};
/** flattened faceted ball — one cluster of foliage */
const blob = (g, r, x, z, y, mat) => {
  const m = new THREE.Mesh(new THREE.IcosahedronGeometry(M(r), 1), mat);
  m.position.set(M(x), M(z), M(y)); m.scale.set(1, 0.72, 1);
  m.castShadow = m.receiveShadow = true; g.add(m); return m;
};
const rectC = r => [(r[0] + r[2]) / 2, (r[1] + r[3]) / 2];
const rectW = r => r[2] - r[0], rectD = r => r[3] - r[1];

/** Distance from each side of `rect` outward to the nearest wall/fixture face overlapping that side. */
function sideDistances(rect, walls) {
  const [x0, y0, x1, y1] = rect, d = { N: Infinity, S: Infinity, E: Infinity, W: Infinity };
  for (const w of walls) {
    const [a0, b0, a1, b1] = w;
    const ovX = Math.min(x1, a1) - Math.max(x0, a0) > 50, ovY = Math.min(y1, b1) - Math.max(y0, b0) > 50;
    if (ovX && b1 <= y0 + 5) d.N = Math.min(d.N, y0 - b1);
    if (ovX && b0 >= y1 - 5) d.S = Math.min(d.S, b0 - y1);
    if (ovY && a1 <= x0 + 5) d.W = Math.min(d.W, x0 - a1);
    if (ovY && a0 >= x1 - 5) d.E = Math.min(d.E, a0 - x1);
  }
  return d;
}
const ANGLE = { S: 0, E: Math.PI / 2, W: -Math.PI / 2, N: Math.PI };
const nearest = (d, sides) => sides.reduce((b, s) => d[s] < d[b] ? s : b, sides[0]);
const sideToward = (from, to) => { const dx = to[0] - from[0], dy = to[1] - from[1]; return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'E' : 'W') : (dy > 0 ? 'S' : 'N'); };
const opposite = { N: 'S', S: 'N', E: 'W', W: 'E' };

/** Decide the BACK side of an item. ctx = { walls, items } */
function orient(it, ctx) {
  const r = it.rect, d = sideDistances(r, ctx.walls), t = it.type;
  const longX = rectW(r) >= rectD(r);
  const shortSides = longX ? ['E', 'W'] : ['N', 'S'], longSides = longX ? ['N', 'S'] : ['E', 'W'];
  const c = rectC(r);
  const nearestOf = types => ctx.items.filter(o => types.includes(o.type) && o !== it).map(o => ({ o, dist: Math.hypot(rectC(o.rect)[0] - c[0], rectC(o.rect)[1] - c[1]) })).sort((a, b) => a.dist - b.dist)[0];
  switch (t) {
    case 'bed_single': case 'bed_double': return nearest(d, shortSides);
    case 'chair': case 'dining_chair': { const tb = nearestOf(['dining_table', 'desk', 'desk_L', 'coffee_table']); return tb && tb.dist < 2500 ? opposite[sideToward(c, rectC(tb.o.rect))] : nearest(d, ['N', 'S', 'E', 'W']); }
    case 'sofa_L': { const tb = nearestOf(['coffee_table']); if (tb && tb.dist < 3500) return opposite[sideToward(c, rectC(tb.o.rect))]; return nearest(d, longSides); }
    case 'car': return nearest(d, shortSides);
    case 'treadmill': return opposite[nearest(d, shortSides)]; // console toward the nearer end wall → user walks toward the wall
    case 'dining_table': case 'coffee_table': case 'gym_rack': case 'box': case 'carpet': case 'console': return longX ? 'S' : 'E';
    case 'office_chair': { const tb = nearestOf(['desk_L', 'desk']); return tb && tb.dist < 2500 ? opposite[sideToward(c, rectC(tb.o.rect))] : nearest(d, ['N', 'S', 'E', 'W']); }
    case 'monitor': case 'monitor_curved': { const tb = nearestOf(['desk_L', 'desk']); if (tb) { const dd = sideDistances(tb.o.rect, ctx.walls); return nearest(dd, ['N', 'S', 'E', 'W']); } return nearest(d, ['N', 'S', 'E', 'W']); }
    case 'punching_bag': case 'crates': case 'wood_stack': case 'parallel_bars': return longX ? 'S' : 'E';
    case 'hood': case 'thermomix': case 'optigrill': case 'knife_block': { // things on the kitchen run: back toward the nearest wall of the run they stand on
      const run = ctx.walls.filter(r => rectsOverlap(r, it.rect)); return nearest(sideDistances(it.rect, ctx.walls.filter(r => !run.includes(r))), ['N', 'S', 'E', 'W']); }
    case 'sofa': { const tb = nearestOf(['tv', 'coffee_table']); if (tb && tb.dist < 4000) return opposite[sideToward(c, rectC(tb.o.rect))]; return nearest(d, longSides); }
    default: return nearest(d, ['N', 'S', 'E', 'W']); // wardrobe, dresser, nightstand, desk, bench, toilet, sink, shower, appliance
  }
}

// ---------- builders (local frame, back at +Z) ----------
function bed(g, w, d, h, it) {
  const frameH = Math.min(h, 350), head = Math.max(h, 800) + 200;
  bx(g, w, frameH, d, 0, frameH / 2, 0, F.oak);
  bx(g, w - 60, 200, d - 100, 0, frameH + 100, -20, F.linen);                         // mattress
  bx(g, w - 60, 60, d * 0.6, 0, frameH + 230, -d * 0.2 + 0, F.blanket);                // blanket over the foot 60 %
  const n = w > 1200 ? 2 : 1;
  for (let i = 0; i < n; i++) bx(g, (w - 200) / n - 40, 120, 400, (i - (n - 1) / 2) * ((w - 200) / n), frameH + 260, d / 2 - 300, F.linen); // pillows
  bx(g, w, head, 60, 0, head / 2, d / 2 - 30, F.oak);                                   // headboard
}
function nightstand(g, w, d, h) { bx(g, w, h, d, 0, h / 2, 0, F.oak); bx(g, w - 60, h * 0.4, 8, 0, h * 0.7, -d / 2 - 4, F.white); bx(g, w - 60, h * 0.4, 8, 0, h * 0.28, -d / 2 - 4, F.white); }
function dresser(g, w, d, h) { bx(g, w, h - 20, d, 0, (h - 20) / 2, 0, F.white); bx(g, w + 20, 20, d + 20, 0, h - 10, 0, F.oak); for (let i = 0; i < 3; i++) bx(g, w - 40, (h - 80) / 3 - 16, 6, 0, 40 + (i + 0.5) * (h - 80) / 3, -d / 2 - 3, F.oak); }
function wardrobe(g, w, d, h) {
  bx(g, w, h - 80, d, 0, 80 + (h - 80) / 2, 0, F.white); bx(g, w - 40, 80, d - 40, 0, 40, 0, F.grey);
  bx(g, w - 6, h - 100, 6, 0, 90 + (h - 100) / 2, -d / 2 - 2, F.joint); // seen through the joints
  const n = Math.max(1, Math.round(w / 600));
  for (let i = 0; i < n; i++) { bx(g, w / n - 12, h - 100, 10, (i - (n - 1) / 2) * w / n, 90 + (h - 100) / 2, -d / 2 - 10, F.white); bx(g, 14, 140, 14, (i - (n - 1) / 2) * w / n + (i % 2 ? -1 : 1) * (w / n / 2 - 40), h * 0.5, -d / 2 - 18, F.chrome); }
}
function desk(g, w, d, h) { bx(g, w, 30, d, 0, h - 15, 0, F.oak); for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) bx(g, 40, h - 30, 40, sx * (w / 2 - 40), (h - 30) / 2, sy * (d / 2 - 40), F.white); bx(g, w * 0.4, 120, d - 80, w * 0.25, h - 30 - 60, 0, F.white); }
function chair(g, w, d, h, legMat = F.chrome) {
  const seat = 450; bx(g, w, 50, d, 0, seat - 25, 0, F.fabric);
  for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) bx(g, 24, seat - 50, 24, sx * (w / 2 - 30), (seat - 50) / 2, sy * (d / 2 - 30), legMat);
  bx(g, w, h - seat, 40, 0, seat + (h - seat) / 2, d / 2 - 20, F.fabric);
}
function sofaL(g, w, d, h, it, backSide, ctx) {
  // base along the back, seat depth 900; L-return on the short end nearer a wall
  const seatH = 420, depth = Math.min(900, d);
  bx(g, w, seatH, depth, 0, seatH / 2, d / 2 - depth / 2, F.fabric);
  bx(g, w, h - seatH, 220, 0, seatH + (h - seatH) / 2, d / 2 - 110, F.fabricDark);      // backrest
  const n = Math.max(2, Math.round(w / 800));
  for (let i = 0; i < n; i++) bx(g, w / n - 30, 120, depth - 260, (i - (n - 1) / 2) * w / n, seatH + 60, d / 2 - depth / 2 - 110, F.fabric);
  if (d > depth + 300) { // L-return: the chaise at one end, extending toward the front
    const dd = sideDistances(it.rect, ctx.walls);
    const longX = rectW(it.rect) >= rectD(it.rect);
    // which local X end? pick the end closer to a wall in world terms
    const ends = backSide === 'N' || backSide === 'S' ? ['W', 'E'] : ['N', 'S'];
    const nearEnd = dd[ends[0]] <= dd[ends[1]] ? ends[0] : ends[1];
    const plusEnd = { S: 'E', E: 'N', W: 'S', N: 'W' }[backSide]; // world side that local +X points to
    const sign = nearEnd === plusEnd ? 1 : -1;
    const ret = 900, len = d - depth;
    bx(g, ret, seatH, len, sign * (w / 2 - ret / 2), seatH / 2, -d / 2 + len / 2, F.fabric);
    bx(g, ret - 30, 120, len - 60, sign * (w / 2 - ret / 2), seatH + 60, -d / 2 + len / 2, F.fabric);
    bx(g, 220, h - seatH - 150, len, sign * (w / 2 - 110), seatH + (h - seatH - 150) / 2, -d / 2 + len / 2, F.fabricDark); // armrest
  }
  bx(g, 220, h - seatH - 150, depth, (w / 2 - 110), seatH + (h - seatH - 150) / 2, d / 2 - depth / 2, F.fabricDark);
  bx(g, 220, h - seatH - 150, depth, -(w / 2 - 110), seatH + (h - seatH - 150) / 2, d / 2 - depth / 2, F.fabricDark);
}
function table(g, w, d, h, legMat = F.white, inset = 100) { bx(g, w, 40, d, 0, h - 20, 0, F.oak); for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) bx(g, 60, h - 40, 60, sx * (w / 2 - inset + 30 - 60), (h - 40) / 2, sy * (d / 2 - inset + 30 - 60), legMat); }
function coffeeTable(g, w, d, h) { bx(g, w, 30, d, 0, h - 15, 0, F.oak); for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) bx(g, 30, h - 30, 30, sx * (w / 2 - 40), (h - 30) / 2, sy * (d / 2 - 40), F.black); }
function bench(g, w, d, h) { bx(g, w, 40, d, 0, h - 20, 0, F.oak); bx(g, w - 100, h - 40, 40, 0, (h - 40) / 2, d / 2 - 40, F.white); bx(g, w - 100, h - 40, 40, 0, (h - 40) / 2, -d / 2 + 40, F.white); }
function toilet(g, w, d, h) {
  const cist = 160; bx(g, Math.min(w, 400), 400, cist, 0, 600, d / 2 - cist / 2, F.ceramic);                 // cistern
  const bowlD = d - cist - 20; bx(g, Math.min(w, 380), h - 120, bowlD, 0, 120 + (h - 120) / 2, -d / 2 + bowlD / 2, F.ceramic); // bowl
  bx(g, Math.min(w, 380) - 20, 30, bowlD - 20, 0, h + 15, -d / 2 + bowlD / 2, F.white);                     // seat
}
function sink(g, w, d, h) {
  bx(g, w, 500, d - 60, 0, h - 150 - 250, 30, F.white);                      // vanity cabinet under the basin
  bx(g, w, 150, d, 0, h - 75, 0, F.ceramic);                                 // basin / top
  const n = w > 900 ? 2 : 1; for (let i = 0; i < n; i++) { bx(g, Math.min(400, w / n - 60), 100, Math.min(320, d - 100), (i - (n - 1) / 2) * w / n, h - 45, -10, F.white); cyl(g, 12, 180, (i - (n - 1) / 2) * w / n, h + 90, d / 2 - 60, F.chrome, 10); }
}
function shower(g, w, d, h, it, back, ctx) {
  bx(g, w, 40, d, 0, 20, 0, F.ceramic);                                      // tray
  const dd = sideDistances(it.rect, ctx.walls);
  const backSide = back, rot = ANGLE[backSide];
  // glass on sides that are not against a wall — evaluate in world sides then map to local
  const worldSides = { N: dd.N > 150, S: dd.S > 150, E: dd.E > 150, W: dd.W > 150 };
  const localOf = { 0: { N: 'front', S: 'back', E: 'right', W: 'left' }, [Math.PI / 2]: { E: 'back', W: 'front', N: 'right', S: 'left' }, [-Math.PI / 2]: { W: 'back', E: 'front', S: 'right', N: 'left' }, [Math.PI]: { S: 'front', N: 'back', W: 'right', E: 'left' } }[rot];
  for (const s of ['N', 'S', 'E', 'W']) if (worldSides[s]) {
    const l = localOf[s];
    if (l === 'front') showerFront(g, w, d, h, it);                                                      // fixed pane + hinged glass door (E opens it)
    else if (l === 'back') bx(g, w, h - 40, 10, 0, 40 + (h - 40) / 2, d / 2 - 5, F.glass);
    else bx(g, 10, h - 40, d, (l === 'right' ? 1 : -1) * (w / 2 - 5), 40 + (h - 40) / 2, 0, F.glass);
  }
  cyl(g, 12, h - 300, w / 2 - 60, 40 + (h - 300) / 2, d / 2 - 60, F.chrome, 8); bx(g, 200, 20, 200, w / 2 - 160, h - 60, d / 2 - 140, F.chrome);
}
/** Entry side of a shower: a fixed pane on the +X part and a hinged glass door (≤ 800) on the −X part, hinged on the fixed
 *  pane (or, without one, at the +X edge) and swinging out into the room (−Z) — so an open leaf never sweeps along the
 *  wall beside the shower (radiator, door). An openable like the fridge doors (E · "dveře sprchy"). */
function showerFront(g, w, d, h, it) {
  const dw = w - 800 >= 150 ? 800 : w, gh = h - 40, zc = 40 + gh / 2, hx = -w / 2 + dw;              // hx = hinge x
  if (dw < w) { bx(g, w - dw - 6, gh, 10, w / 2 - (w - dw) / 2 + 3, zc, -d / 2 + 5, F.glass); bx(g, 12, gh, 14, hx + 3, zc, -d / 2 + 5, F.chrome); } // fixed pane + profile at the junction
  const op = new THREE.Group(); op.name = 'openable'; op.userData = { kind: 'opening', id: 'furn:' + (it?.id || 'shower'), type: 'door', label: 'dveře sprchy', dynamic: true };
  const piv = new THREE.Group(); piv.name = 'leaf'; piv.userData = { hingeSign: 1, sideSign: -1 };  // leaf toward −X from the hinge, opens toward the front (−Z)
  piv.position.set(M(hx), 0, M(-d / 2 + 5));
  bx(piv, dw - 10, gh, 8, -dw / 2, zc, 0, F.glass);
  bx(piv, 12, gh, 14, -6, zc, 0, F.chrome);                                                           // hinge profile
  bx(piv, 20, 320, 12, -dw + 70, zc, -12, F.chrome);                                                  // handle bar on the outside, at the free edge
  mergeInto(piv); op.add(piv); g.add(op);
}
function vanity(g, w, d, h) { // wall-hung vanity unit: greige drawer fronts (two per basin) under a white top with countertop basins (2 when ≥ 900 wide), taps, a hand towel on a rail at each end
  const T = 18, top = 30, z0 = Math.max(200, h - 600), body = h - top - z0, n = w >= 900 ? 2 : 1;
  bx(g, w, body, d - T, 0, z0 + body / 2, T / 2, F.white);                                            // carcass
  for (let i = 0; i < n; i++) for (let k = 0; k < 2; k++) {                                           // drawer fronts with 4 mm reveals
    const fw = w / n - 8, fh = body / 2 - 8, x = (i - (n - 1) / 2) * w / n, z = z0 + 4 + k * body / 2 + fh / 2;
    bx(g, fw, fh, T, x, z, -d / 2 + T / 2, F.cabinet);
    bx(g, Math.min(200, fw * 0.4), 10, 12, x, z + fh / 2 - 30, -d / 2 - 6, F.black);                // handle
  }
  bx(g, w, top, d, 0, h - top / 2, 0, F.ceramic);                                                     // top
  for (let i = 0; i < n; i++) {
    const x = (i - (n - 1) / 2) * w / n;
    bx(g, Math.min(420, w / n - 80), 110, Math.min(340, d - 90), x, h + 55, -20, F.ceramic);         // countertop basin
    cyl(g, 12, 220, x, h + 110, d / 2 - 50, F.chrome, 10); bx(g, 24, 20, 130, x, h + 215, d / 2 - 110, F.chrome); // tap + spout
  }
  for (const s of [-1, 1]) {                                                                          // towel rail + hand towel at each end (outside the footprint by 55)
    const x = s * (w / 2 + 40), zr = h - 250;
    const rail = cyl(g, 6, 360, x, zr, -d / 2 + 200, F.chrome, 8); rail.rotation.x = Math.PI / 2;
    const br = cyl(g, 5, 40, s * (w / 2 + 20), zr, -d / 2 + 30, F.chrome, 8); br.rotation.z = Math.PI / 2;   // bracket to the carcass
    bx(g, 30, 340, 300, x, zr - 160, -d / 2 + 190, F.towel);                                          // towel hanging from the rail
    bx(g, 30, 14, 300, x, zr + 6, -d / 2 + 190, F.towel);                                           // fold over the rail
  }
}
function towelRadiator(g, w, d, h) { // ladder towel radiator (anthracite): two collectors, rungs in groups of four, a bath towel and a hand towel hung over rungs
  const tube = 28, pitch = 90, zt = d / 2 - tube / 2;
  for (const s of [-1, 1]) bx(g, tube, h, tube, s * (w / 2 - tube / 2), h / 2, zt, F.anthracite);   // collectors
  const rungs = []; for (let z = 60, k = 0; z <= h - 60; z += pitch, k++) if (k % 5 !== 4) rungs.push(z);
  for (const z of rungs) { const r = cyl(g, 10, w - tube, 0, z, zt, F.anthracite, 10); r.rotation.z = Math.PI / 2; }
  const zb = rungs[Math.round(rungs.length * 0.62)] ?? h * 0.6, zh = rungs[Math.round(rungs.length * 0.3)] ?? h * 0.3;
  bx(g, w * 0.5, 36, tube + 30, -w * 0.2, zb + 18, zt - 15, F.towel); bx(g, w * 0.5, 520, 30, -w * 0.2, zb - 242, zt - tube / 2 - 25, F.towel); // bath towel
  bx(g, w * 0.32, 30, tube + 30, w * 0.28, zh + 15, zt - 15, F.linen); bx(g, w * 0.32, 320, 24, w * 0.28, zh - 145, zt - tube / 2 - 22, F.linen);  // hand towel
}
function car(g, w, d, h) {
  // w = width (1.5 m), d = length; front at −Z
  bx(g, w - 80, h * 0.42, d - 100, 0, 300 + h * 0.21, 0, F.car);                              // body
  bx(g, w - 200, h * 0.38, d * 0.55, 0, 300 + h * 0.42 + h * 0.19, d * 0.05, F.carGlass);   // cabin
  bx(g, w - 220, 40, d * 0.55 - 60, 0, 300 + h * 0.42 + h * 0.38 - 20, d * 0.05, F.car);    // roof
  for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { const wheel = cyl(g, 320, 220, sx * (w / 2 - 110), 320, sy * (d / 2 - 900), F.rubber, 18); wheel.rotation.z = Math.PI / 2; }
}
function treadmill(g, w, d, h) {
  bx(g, w, 150, d, 0, 75, 0, F.black); bx(g, w - 200, 20, d - 300, 0, 160, 80, F.grey);
  for (const s of [-1, 1]) bx(g, 40, h - 300, 40, s * (w / 2 - 60), 150 + (h - 300) / 2, -d / 2 + 200, F.steel);
  bx(g, w, 100, 200, 0, h - 50, -d / 2 + 200, F.black); for (const s of [-1, 1]) bx(g, 40, 40, d * 0.4, s * (w / 2 - 60), h - 350, -d / 2 + 200 + d * 0.2, F.steel);
}
function gymRack(g, w, d, h) {
  for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) bx(g, 60, h, 60, sx * (w / 2 - 30), h / 2, sy * (d / 2 - 30), F.black);
  for (const sy of [-1, 1]) bx(g, w, 60, 60, 0, h - 30, sy * (d / 2 - 30), F.black);
  for (const sx of [-1, 1]) bx(g, 60, 60, d, sx * (w / 2 - 30), h - 30, 0, F.black);
  cyl(g, 14, w + 300, 0, 1500, 0, F.steel, 10).rotation.z = Math.PI / 2;                          // bar
  bx(g, 300, 60, Math.min(1200, d - 200), 0, 450, 0, F.fabricDark); for (const sy of [-1, 1]) bx(g, 200, 400, 60, 0, 200, sy * (Math.min(1200, d - 200) / 2 - 60), F.black); // bench
}
function appliance(g, w, d, h, it) {
  if (h >= 1500) { bx(g, w, h, d, 0, h / 2, 0, F.steel); bx(g, w - 40, 3, 4, 0, h * 0.62, -d / 2 - 2, F.black); bx(g, 20, h * 0.3, 20, w / 2 - 60, h * 0.45, -d / 2 - 12, F.chrome); } // fridge
  else { bx(g, w, h - 60, d, 0, (h - 60) / 2, 0, F.white); bx(g, w - 40, 12, d - 40, 0, h - 6, 0, F.black); for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) cyl(g, 90, 6, sx * w * 0.22, h + 3, sy * d * 0.22, F.grey, 20); } // hob + oven
}
function plainBox(g, w, d, h) { bx(g, w, h, d, 0, h / 2, 0, F.grey); }
function monitorCurved(g, w, d, h) { // wide curved screen: 7 segments on an arc, stand, keyboard in front
  const n = 7, R = w * 1.1, seg = w / n, sh = h - 130;
  for (let i = 0; i < n; i++) { const a = (i - (n - 1) / 2) * (seg / R); const m = bx(g, seg + 4, sh, 22, Math.sin(a) * R, 130 + sh / 2, d / 2 - 50 - (1 - Math.cos(a)) * R, F.screen); m.rotation.y = -a; }
  bx(g, 80, 130, 50, 0, 65, d / 2 - 50, F.black); bx(g, 420, 15, 200, 0, 8, d / 2 - 100, F.black);
  bx(g, Math.min(440, w * 0.4), 18, 130, 0, 9, -d / 2 + 70, F.grey); bx(g, 90, 22, 60, Math.min(440, w * 0.4) / 2 + 80, 11, -d / 2 + 70, F.grey);
}
function shelving(g, w, d, h) { // open metal shelves with jars, boxes and crates
  for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) bx(g, 30, h, 30, sx * (w / 2 - 15), h / 2, sy * (d / 2 - 15), F.steel);
  const n = Math.max(2, Math.round(h / 420)), sh = (h - 40) / n;
  for (let k = 0; k <= n; k++) bx(g, w, 22, d, 0, 30 + k * sh, 0, F.grey);
  for (let k = 0; k < n; k++) { let x = -w / 2 + 60, i = 0; while (x < w / 2 - 80) { const bw = 90 + ((k * 5 + i * 3) % 4) * 40, bh = Math.min(sh - 50, 120 + ((k + i) % 3) * 80); const mat = [F.white, F.oak, F.books[3], F.books[1], F.grey][(k + i) % 5]; bx(g, bw, bh, d * 0.7, x + bw / 2, 30 + k * sh + 11 + bh / 2, 0, mat); x += bw + 30 + ((i * 7) % 3) * 20; i++; } }
}
function chestFreezer(g, w, d, h) { bx(g, w, h, d, 0, h / 2, 0, F.white); bx(g, w - 20, 40, d - 20, 0, h - 20, 0, F.grey); bx(g, w * 0.5, 20, 30, 0, h + 8, -d / 2 + 30, F.grey); }
function crates(g, w, d, h) { const n = Math.max(1, Math.round(h / 300)); for (let k = 0; k < n; k++) bx(g, w - 20, 280, d - 20, 0, 140 + k * 300, 0, [F.books[1], F.books[0], F.books[2]][k % 3]); }
function fridgeUS(g, w, d, h, it) { // American two-door fridge; the doors are an openable (E opens both at once): shell + lit interior with shelves and a few things
  const DT = 50, shell = F.steel, cav = d - DT;               // the door leaves fill the front 50 mm
  bx(g, w, h, 30, 0, h / 2, d / 2 - 15, shell);                                                   // back
  for (const s of [-1, 1]) bx(g, 30, h, cav - 30, s * (w / 2 - 15), h / 2, DT / 2 + 15, shell);  // sides
  bx(g, w - 60, 30, cav - 30, 0, h - 15, DT / 2 + 15, shell); bx(g, w - 60, 60, cav - 30, 0, 30, DT / 2 + 15, shell); // top, bottom
  const iw = w - 60, ih = h - 90, id = cav - 40, iz = DT / 2 + 20;                               // interior (white liner)
  bx(g, iw, ih, 6, 0, 60 + ih / 2, d / 2 - 33, F.white); for (const s of [-1, 1]) bx(g, 6, ih, id, s * (iw / 2 - 3), 60 + ih / 2, iz, F.white);
  bx(g, iw, 6, id, 0, h - 33, iz, F.white); bx(g, iw, 6, id, 0, 63, iz, F.white);
  bx(g, 6, ih - 12, id, 40, 66 + (ih - 12) / 2, iz, F.white);                                     // divider: freezer left, fridge right
  for (const z of [0.3, 0.5, 0.7]) bx(g, iw / 2 - 56, 6, id - 40, iw / 4 + 20, 60 + ih * z, iz, F.ceramic);   // fridge shelves
  for (const z of [0.36, 0.66]) bx(g, iw / 2 - 56, 6, id - 40, -iw / 4 - 20, 60 + ih * z, iz, F.ceramic);    // freezer drawers
  bx(g, 70, 200, 70, iw / 4 - 60, 60 + ih * 0.3 + 103, iz - 40, F.white); cyl(g, 35, 110, iw / 4 + 60, 60 + ih * 0.5 + 58, iz - 60, F.books[3], 12);
  bx(g, 120, 60, 160, iw / 4 + 20, 60 + ih * 0.7 + 33, iz, F.books[0]); cyl(g, 30, 260, iw / 4 + 120, 60 + ih * 0.3 + 133, iz + 20, F.books[2], 10);
  const op = new THREE.Group(); op.name = 'openable'; op.userData = { kind: 'opening', id: 'furn:' + (it?.id || 'fridge'), type: 'door', label: 'lednici', dynamic: true };
  for (const s of [-1, 1]) {
    const piv = new THREE.Group(); piv.name = 'leaf'; piv.userData = { hingeSign: s, sideSign: -1 }; // both swing toward the front (−Z)
    piv.position.set(M(s * w / 2), 0, M(-d / 2 + DT / 2));
    const lw = w / 2 - 3;
    bx(piv, lw, h - 40, DT - 4, -s * (lw / 2 + 3), h / 2, 0, F.steel);
    bx(piv, 24, h * 0.55, 24, -s * (w / 2 - 60), h * 0.5, -DT / 2 - 14, F.chrome);                // handles beside the meeting edge
    if (s > 0) bx(piv, w * 0.3, h * 0.2, 4, -s * w / 4, h * 0.62, -DT / 2 - 2, F.black);         // display / dispenser on the right door
    mergeInto(piv); op.add(piv);
  }
  g.add(op);
}
function ovenTower(g, w, d, h) { bx(g, w, h, d, 0, h / 2, 0, F.white); bx(g, w - 40, 560, 8, 0, 900 + 280, -d / 2 - 4, F.black); bx(g, w - 60, 40, 20, 0, 900 + 520, -d / 2 - 20, F.chrome); bx(g, w - 40, 380, 8, 0, 1500 + 190, -d / 2 - 4, F.black); bx(g, w - 60, 30, 16, 0, 1500 + 340, -d / 2 - 16, F.chrome); }
/** Kitchen tall units in the wall-cabinet look (greige fronts with 4 mm joints over the darker carcass, black bar handles). */
function tallFronts(g, w, d, h, rows, handleAt) {
  bx(g, w - 8, h - 100, d - 8, 0, 100 + (h - 100) / 2, 4, F.cabinetBox); bx(g, w - 40, 100, d - 40, 0, 50, 0, F.grey); // carcass, recessed plinth
  const n = Math.max(1, Math.round(w / 600));
  for (const [z0, z1] of rows) for (let i = 0; i < n; i++) {
    const xc = (i - (n - 1) / 2) * w / n, hx = n > 1 ? xc + (i % 2 ? -1 : 1) * (w / n / 2 - 40) : xc + w / 2 - 40;
    bx(g, w / n - 8, z1 - z0 - 8, 18, xc, (z0 + z1) / 2, -d / 2 + 9, F.cabinet);
    const hl = Math.min(400, (z1 - z0) * 0.45), hz = handleAt(z0, z1, hl);
    bx(g, 16, hl, 22, hx, hz, -d / 2 - 11, F.black);
  }
}
function fridgeBuiltin(g, w, d, h) { // integrated fridge-freezer behind kitchen fronts: freezer front below 800, fridge front above, handles near the split
  const split = Math.min(800, h * 0.4);
  tallFronts(g, w, d, h, [[100, split], [split, h]], (z0, z1, hl) => z0 === 100 ? z1 - 40 - hl / 2 : z0 + 40 + hl / 2);
}
function tallCabinet(g, w, d, h) { // kitchen tall cabinet / pantry unit: doors ≈ 600 wide, split at 1 950 when taller than 2 100
  const rows = h > 2100 ? [[100, 1950], [1950, h]] : [[100, h]];
  tallFronts(g, w, d, h, rows, (z0, z1, hl) => z0 === 100 ? Math.min(z1 - 40 - hl / 2, 1100) : z0 + 40 + hl / 2);
}
function dishwasher(g, w, d, h) { bx(g, w, h - 100, d, 0, 100 + (h - 100) / 2, 0, F.steel); bx(g, w - 40, 30, 20, 0, h - 60, -d / 2 - 12, F.chrome); bx(g, w - 60, 40, 4, 0, h - 120, -d / 2 - 2, F.black); }
function wineCooler(g, w, d, h) { bx(g, w, h, d, 0, h / 2, 0, F.black); bx(g, w - 60, h - 120, 10, 0, h / 2, -d / 2 - 5, F.carGlass); for (let k = 0; k < 4; k++) bx(g, w - 100, 8, d - 60, 0, 120 + k * (h - 200) / 4, 0, F.oak); bx(g, 20, h * 0.5, 24, w / 2 - 60, h / 2, -d / 2 - 14, F.chrome); }
function hood(g, w, d, h) { bx(g, w, 60, d, 0, 30, 0, F.steel); bx(g, w * 0.55, h - 60, d * 0.55, 0, 60 + (h - 60) / 2, d * 0.2, F.steel); bx(g, w - 100, 6, d - 60, 0, -3, 0, F.carGlass); }
function thermomix(g, w, d, h) { const r = Math.min(w, d) / 2; cyl(g, r * 0.7, h * 0.45, 0, h * 0.225, d * 0.1, F.grey, 20); cyl(g, r * 0.6, h * 0.5, 0, h * 0.45 + h * 0.25, d * 0.1, F.steel, 20); bx(g, w * 0.5, h * 0.4, d * 0.3, 0, h * 0.2, -d / 2 + d * 0.15, F.white); bx(g, w * 0.35, h * 0.2, 4, 0, h * 0.25, -d / 2 - 2, F.screen); }
function optigrill(g, w, d, h) { bx(g, w, h * 0.5, d, 0, h * 0.25, 0, F.black); bx(g, w, h * 0.5, d * 0.9, 0, h * 0.75, -d * 0.05, F.steel); bx(g, w * 0.7, 20, 30, 0, h * 0.75, -d / 2 - 15, F.black); }
function knifeBlock(g, w, d, h) { const b = bx(g, w, h, d, 0, h / 2, 0, F.oak); b.rotation.x = -0.25; for (let i = 0; i < 4; i++) bx(g, 10, 60, 4, -w / 2 + 25 + i * (w - 50) / 3, h + 20, 0, F.black); }
function grillOutdoor(g, w, d, h) { // gas grill on a cart with hood and side shelves
  bx(g, w * 0.7, 750, d, 0, 375, 0, F.black); for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { const c = cyl(g, 60, 40, sx * (w * 0.35 - 60), 60, sy * (d / 2 - 60), F.rubber, 12); c.rotation.z = Math.PI / 2; }
  bx(g, w * 0.7, 120, d, 0, 810, 0, F.steel); bx(g, w * 0.7, h - 870, d * 0.9, 0, 870 + (h - 870) / 2, d * 0.05, F.steel);
  bx(g, w * 0.6, 20, 30, 0, h - 120, -d / 2 - 15, F.black); for (const s of [-1, 1]) bx(g, w * 0.15, 30, d * 0.9, s * (w * 0.425), 855, 0, F.steel);
  cyl(g, 30, h - 200, w / 2 - 20, 750 + (h - 200) / 2, d / 2 - 60, F.steel, 10);
}
function woodStack(g, w, d, h) { const r = 60, nx = Math.floor(w / (2 * r + 6)), nz = Math.floor(h / (2 * r + 2)); for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) { const c = cyl(g, r - 4, d, -w / 2 + r + 3 + i * (2 * r + 6) + (k % 2) * r * 0.6, r + k * (2 * r + 2), 0, F.oak, 9); c.rotation.x = Math.PI / 2; } }
function punchingBag(g, w, d, h) { const r = Math.min(w, d) / 2; cyl(g, 14, h - 1750, 0, 1750 + (h - 1750) / 2 - 20, 0, F.steel, 6); bx(g, 120, 40, 120, 0, h - 20, 0, F.black); cyl(g, r, 1150, 0, 600 + 575, 0, F.rubber, 18); cyl(g, r * 0.6, 120, 0, 1750 + 40, 0, F.black, 12); }
function weightRack(g, w, d, h) { bx(g, w, 40, d, 0, h - 20, 0, F.black); bx(g, w, 40, d, 0, h * 0.5, 0, F.black); for (const s of [-1, 1]) bx(g, 40, h, 60, s * (w / 2 - 20), h / 2, 0, F.black); for (const z of [h * 0.5 + 20, h + 20]) for (let i = 0; i < 4; i++) { const x = -w / 2 + w * (i + 0.5) / 4; for (const s of [-1, 1]) cyl(g, 55, 60, x, z + 55, s * (d / 2 - 60), F.rubber, 12).rotation.x = Math.PI / 2; bx(g, 24, 24, d - 120, x, z + 55, 0, F.steel); } }
function pullupBar(g, w, d, h) { for (const s of [-1, 1]) bx(g, 40, 40, d, s * (w / 2 - 60), 20, 0, F.black); cyl(g, 16, w, 0, 20, -d / 2 + 20, F.steel, 10).rotation.z = Math.PI / 2; }
function parallelBars(g, w, d, h) { for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) bx(g, 40, h - 40, 40, sx * (w / 2 - 40), (h - 40) / 2, sy * (d / 2 - 40), F.black); for (const s of [-1, 1]) cyl(g, 18, d, s * (w / 2 - 40), h - 20, 0, F.steel, 10).rotation.x = Math.PI / 2; bx(g, w - 40, 40, 40, 0, 20, 0, F.black); }
function workbench(g, w, d, h) { bx(g, w, 60, d, 0, h - 30, 0, F.oak); for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) bx(g, 60, h - 60, 60, sx * (w / 2 - 50), (h - 60) / 2, sy * (d / 2 - 50), F.steel); bx(g, w - 200, 30, d - 200, 0, 250, 0, F.grey); bx(g, 160, 120, 120, w / 2 - 250, h + 60, -d / 2 + 90, F.steel); bx(g, 40, 200, 40, w / 2 - 250, h + 100, -d / 2 + 30, F.black); }
function pegboard(g, w, d, h) { bx(g, w, h, d, 0, h / 2, 0, F.grey); for (let i = 0; i < 6; i++) bx(g, 24 + (i % 3) * 14, 160 + (i % 2) * 90, 20, -w / 2 + 120 + i * (w - 240) / 5, h * 0.55, -d / 2 - 10, [F.black, F.steel, F.books[0]][i % 3]); }
function toolchest(g, w, d, h) { bx(g, w, h - 100, d, 0, 100 + (h - 100) / 2, 0, F.books[0]); for (let k = 0; k < 4; k++) bx(g, w - 60, 8, 4, 0, 160 + k * (h - 220) / 4, -d / 2 - 2, F.black); for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) cyl(g, 45, 30, sx * (w / 2 - 60), 45, sy * (d / 2 - 50), F.rubber, 10).rotation.z = Math.PI / 2; }
function bikeWall(g, w, d, h) { // bicycle hung vertically by the front wheel, seen from the front (wheels stacked)
  const R = 330, x = 0, zTop = h - R - 40, zBot = 450 + R;
  for (const z of [zTop, zBot]) { const t = new THREE.Mesh(new THREE.TorusGeometry(M(R), M(22), 8, 24), F.rubber); t.position.set(M(x), M(z), M(-d / 2 + 120)); t.castShadow = true; g.add(t); }
  bx(g, 30, zTop - zBot, 30, x, (zTop + zBot) / 2, -d / 2 + 120, F.books[1]); bx(g, 30, (zTop - zBot) * 0.7, 30, x + 60, zBot + (zTop - zBot) * 0.45, -d / 2 + 120, F.books[1]).rotation.z = 0.5;
  bx(g, 420, 26, 40, x, zTop - 60, -d / 2 + 60, F.black); bx(g, 60, 30, 120, x + 80, zBot + (zTop - zBot) * 0.55, -d / 2 + 120, F.black);
  bx(g, 60, 80, d - 60, x, h - 40, 0, F.books[1]);
}
function shoeRack(g, w, d, h) { // open two-tier rack with a few shoes
  for (const s of [-1, 1]) bx(g, 30, h, d, s * (w / 2 - 15), h / 2, 0, F.oak);
  for (const z of [60, h / 2, h - 20]) bx(g, w - 60, 20, d, 0, z, 0, F.oak);
  for (let k = 0; k < 2; k++) for (let i = 0; i < Math.floor((w - 100) / 130); i++) bx(g, 90, 70, d - 80, -w / 2 + 80 + i * 130, [70, h / 2 + 10][k] + 35, 0, [F.black, F.books[1], F.grey, F.books[0]][(i + k) % 4]);
}
function elecCabinet(g, w, d, h) { bx(g, w, h, d, 0, h / 2, 0, F.white); bx(g, w - 40, h - 40, 4, 0, h / 2, -d / 2 - 2, F.grey); bx(g, 20, 60, 12, w / 2 - 50, h / 2, -d / 2 - 6, F.black); }
function netRack(g, w, d, h) { bx(g, w, h, d, 0, h / 2, 0, F.black); for (let k = 0; k < 3; k++) bx(g, w - 60, 44, 6, 0, 40 + k * 90 + 22, -d / 2 - 3, [F.steel, F.grey, F.black][k]); for (let i = 0; i < 8; i++) bx(g, 8, 8, 4, -w / 2 + 60 + i * 30, 62, -d / 2 - 8, F.books[2]); }
function deskL(g, w, d, h, it, back, ctx) {
  // back arm along +Z, side arm along the end nearer a wall
  const A = 700;
  bx(g, w, 30, A, 0, h - 15, d / 2 - A / 2, F.oak);
  const dd = sideDistances(it.rect, ctx.walls), ends = back === 'N' || back === 'S' ? ['W', 'E'] : ['N', 'S'];
  const nearEnd = dd[ends[0]] <= dd[ends[1]] ? ends[0] : ends[1], plusEnd = { S: 'E', E: 'N', W: 'S', N: 'W' }[back];
  const sign = nearEnd === plusEnd ? 1 : -1;
  bx(g, A, 30, d - A, sign * (w / 2 - A / 2), h - 15, -A / 2, F.oak);
  bx(g, 30, h - 30, A - 40, -sign * (w / 2 - 30), (h - 30) / 2, d / 2 - A / 2, F.white);     // panel leg at the free end
  bx(g, A - 40, h - 30, 30, sign * (w / 2 - A / 2), (h - 30) / 2, -d / 2 + 30, F.white);     // panel leg at the side arm's end
  bx(g, 30, h - 30, d - 60, sign * (w / 2 - A + 15), (h - 30) / 2, 0, F.white);              // inner corner panel
}
function officeChair(g, w, d, h) {
  const seat = 480; for (let i = 0; i < 5; i++) { const a = i * Math.PI * 2 / 5; const arm = bx(g, 300, 30, 40, Math.cos(a) * 150, 40, Math.sin(a) * 150, F.black); arm.rotation.y = -a; }
  cyl(g, 25, seat - 80, 0, 60 + (seat - 80) / 2, 0, F.chrome, 10);
  bx(g, w, 70, d, 0, seat - 35, 0, F.fabricDark);
  bx(g, w - 60, h - seat - 40, 60, 0, seat + (h - seat - 40) / 2, d / 2 - 40, F.fabricDark);
  for (const s of [-1, 1]) { bx(g, 30, 220, 30, s * (w / 2 - 20), seat + 110, 40, F.black); bx(g, 40, 20, 240, s * (w / 2 - 20), seat + 230, 0, F.black); }
}
function sofa(g, w, d, h) {
  const seatH = 420; bx(g, w, seatH, d, 0, seatH / 2, 0, F.fabric);
  bx(g, w, h - seatH, 220, 0, seatH + (h - seatH) / 2, d / 2 - 110, F.fabricDark);
  const n = Math.max(2, Math.round(w / 800)); for (let i = 0; i < n; i++) bx(g, w / n - 30, 120, d - 280, (i - (n - 1) / 2) * w / n, seatH + 60, -80, F.fabric);
  for (const s of [-1, 1]) bx(g, 200, h - seatH - 150, d, s * (w / 2 - 100), seatH + (h - seatH - 150) / 2, 0, F.fabricDark);
}
function monitor(g, w, d, h) {
  const sw = Math.min(w, 900); bx(g, sw, h - 120, 30, 0, 120 + (h - 120) / 2, d / 2 - 40, F.screen);
  bx(g, 60, 120, 40, 0, 60, d / 2 - 40, F.black); bx(g, 300, 15, 180, 0, 8, d / 2 - 90, F.black);
  bx(g, Math.min(420, w - 100), 18, 130, 0, 9, -d / 2 + 70, F.grey); bx(g, 90, 22, 60, Math.min(420, w - 100) / 2 + 80, 11, -d / 2 + 70, F.grey);
}
function pcTower(g, w, d, h) { bx(g, w, h, d, 0, h / 2, 0, F.black); bx(g, w - 40, h - 60, 4, 0, h / 2, -d / 2 - 2, F.grey); }
function tv(g, w, d, h) { bx(g, w, h, 40, 0, h / 2, d / 2 - 20, F.screen); bx(g, w - 20, h - 20, 4, 0, h / 2, d / 2 - 42, F.black); }
function tvTable(g, w, d, h) { bx(g, w, h - 20, d, 0, (h - 20) / 2 + 20, 0, F.white); bx(g, w, 20, d, 0, h - 10, 0, F.oak); for (let i = 0; i < 2; i++) bx(g, w / 2 - 16, h - 60, 6, (i - 0.5) * w / 2, h / 2 + 10, -d / 2 - 3, F.white); }
function consoleBox(g, w, d, h) { bx(g, w, h, d, 0, h / 2, 0, F.black); bx(g, w * 0.6, 4, d * 0.5, 0, h + 2, 0, F.grey); }
function carpet(g, w, d, h) { bx(g, w, h, d, 0, h / 2, 0, F.carpet); }
function bookshelf(g, w, d, h) {
  bx(g, w, h, 20, 0, h / 2, d / 2 - 10, F.white);
  for (const s of [-1, 1]) bx(g, 25, h, d, s * (w / 2 - 12), h / 2, 0, F.white);
  const n = Math.max(2, Math.round(h / 380));
  for (let k = 0; k <= n; k++) bx(g, w - 50, 22, d, 0, Math.min(h - 11, 40 + k * (h - 60) / n), 0, F.white);
  for (let k = 0; k < n; k++) { let x = -w / 2 + 40; const z0 = 40 + k * (h - 60) / n + 11, shelfH = (h - 60) / n; let i = 0;
    while (x < w / 2 - 80) { const bw = 25 + ((k * 7 + i * 3) % 4) * 12, bh = shelfH * (0.55 + ((k + i) % 3) * 0.12); bx(g, bw, bh, d - 60, x + bw / 2, z0 + bh / 2, 10, F.books[(k * 3 + i) % F.books.length]); x += bw + 4; i++; if (i % 9 === 8) x += 60; } }
}

function ficus(g, w, d, h) { // Ficus benjamina in a pot: thin braided trunk under a dense, weeping canopy, light new growth at the tips
  const R = Math.min(w, d) / 2, potR = Math.min(190, R * 0.42), potH = Math.min(360, h * 0.22);
  cyl(g, potR * 0.76, potH * 0.5, 0, potH * 0.25, 0, F.anthracite, 16);                    // pot: narrow foot …
  cyl(g, potR, potH * 0.56, 0, potH * 0.72, 0, F.anthracite, 16);                          // … wider top
  cyl(g, potR + 12, 46, 0, potH - 23, 0, F.anthracite, 16);                                // rim
  cyl(g, potR - 25, 40, 0, potH - 20, 0, F.soil, 12);                                      // soil
  const top = potH + (h - potH) * 0.40;                                                    // where the braided stems split into branches
  for (let i = 0; i < 3; i++) { const a = i * Math.PI * 2 / 3; stem(g, [Math.cos(a) * 48, potH - 20, Math.sin(a) * 48], [Math.cos(a + 2.1) * 16, top, Math.sin(a + 2.1) * 16], 18, F.oak); }
  const base = potH + (h - potH) * 0.20, ch = h - base;                                    // the canopy hangs down to the lower third
  const rings = [[0.60, 0.04, 6, 0.33], [0.58, 0.30, 7, 0.36], [0.44, 0.59, 6, 0.34], [0.22, 0.84, 4, 0.32]]; // [radius, height, count, cluster size] as fractions of R
  let i = 0;
  for (const [rf, zf, n, sf] of rings) for (let k = 0; k < n; k++, i++) {
    const a = k * Math.PI * 2 / n + i * 0.55, rr = R * rf * (0.84 + ((i * 3) % 4) * 0.055);
    const x = Math.cos(a) * rr, y = Math.sin(a) * rr, z = base + ch * zf + ((i % 3) - 1) * ch * 0.045;
    if (zf < 0.35 && k % 2 === 0) stem(g, [0, top, 0], [x * 0.8, top + (z - top) * 0.8, y * 0.8], 12, F.oak); // a few visible branches into the skirt
    blob(g, R * sf * (0.86 + ((i * 5) % 3) * 0.09), x, z, y, i % 7 === 3 ? F.leafLight : F.leaf);
  }
  blob(g, R * 0.3, 0, base + ch * 0.95, 0, F.leaf);
}

function kallax(g, w, d, h) { // IKEA KALLAX-style open cube shelf: 16 mm carcass, cubes ≈ 335, a few cubes with boxes / books / a basket
  const T = 16, cols = Math.max(1, Math.round(w / 385)), rows = Math.max(1, Math.round(h / 385)), cw = (w - (cols + 1) * T) / cols, ch = (h - (rows + 1) * T) / rows;
  bx(g, w, h, 6, 0, h / 2, d / 2 - 3, F.white);                                                    // back
  for (const x of [-w / 2 + T / 2, w / 2 - T / 2]) bx(g, T, h, d, x, h / 2, 0, F.white);
  for (const z of [T / 2, h - T / 2]) bx(g, w - 2 * T, T, d, 0, z, 0, F.white);
  for (let i = 1; i < cols; i++) bx(g, T, h - 2 * T, d, -w / 2 + T + i * (cw + T) - T / 2, h / 2, 0, F.white);
  for (let k = 1; k < rows; k++) bx(g, w - 2 * T, T, d, 0, T + k * (ch + T) - T / 2, 0, F.white);
  for (let i = 0; i < cols; i++) for (let k = 0; k < rows; k++) {
    const x = -w / 2 + T + i * (cw + T) + cw / 2, z = T + k * (ch + T), kind = (i * 3 + k * 5) % 4;
    if (kind === 0) bx(g, cw - 30, ch - 30, d - 40, x, z + (ch - 30) / 2, 0, [F.grey, F.books[1], F.books[3]][(i + k) % 3]);  // box insert
    else if (kind === 1) { let bxx = x - cw / 2 + 30; for (let b = 0; b < 5 && bxx < x + cw / 2 - 40; b++) { const bw = 28 + (b % 3) * 12; bx(g, bw, ch * (0.55 + (b % 2) * 0.15), d - 90, bxx + bw / 2, z + ch * (0.55 + (b % 2) * 0.15) / 2, 10, F.books[(i + k + b) % F.books.length]); bxx += bw + 5; } }
    else if (kind === 2) bx(g, cw - 60, ch * 0.5, d - 80, x, z + ch * 0.25, 0, F.oak);             // basket
  }
}
function bathCabinet(g, w, d, h) { // tall bathroom column: white carcass, greige door fronts (kitchen cabinet colour, 4 mm reveals) below and above an open oak niche, dark handles, a folded towel in the niche
  const T = 18, plinth = 80, nz0 = Math.round(h * 0.52), nz1 = nz0 + 350, cd = d - T;                  // carcass depth leaves the door thickness inside the footprint
  bx(g, w - 40, plinth, cd - 40, 0, plinth / 2, T / 2, F.grey);
  bx(g, w, h - plinth, 8, 0, plinth + (h - plinth) / 2, d / 2 - 4, F.white);                             // back
  for (const x of [-w / 2 + T / 2, w / 2 - T / 2]) bx(g, T, h - plinth, cd, x, plinth + (h - plinth) / 2, T / 2, F.white);
  for (const z of [plinth + T / 2, h - T / 2, nz0 - T / 2, nz1 + T / 2]) bx(g, w - 2 * T, T, cd, 0, z, T / 2, z > plinth + T && z < h - T ? F.oak : F.white); // bottom, top, niche shelves (oak)
  bx(g, w - 2 * T, nz1 - nz0, 10, 0, (nz0 + nz1) / 2, d / 2 - 13, F.oak);                                // oak niche back
  bx(g, w * 0.55, 70, cd * 0.55, 0, nz0 + 35, T / 2, F.linen);                                           // folded towel
  for (const [z0, z1] of [[plinth + T, nz0 - T], [nz1 + T, h - T]]) {                                    // door fronts with reveals
    const dh = z1 - z0 - 8; bx(g, w - 8, dh, T, 0, z0 + 4 + dh / 2, -d / 2 + T / 2, F.cabinet);
    bx(g, 10, 140, 12, w / 2 - 45, z0 === plinth + T ? z1 - 120 : z0 + 120, -d / 2 - 6, F.black);      // handle near the niche
  }
}
function henhouse(g, w, d, h) { // small painted hen house on legs with a felt gable roof, hatch + ramp and a wire run in front
  const hd = Math.min(900, d * 0.4), hz0 = 300, body = h - hz0 - 250, run = d - hd, hw = w - 60;
  const cz = d / 2 - hd / 2;                                                                       // house centre (depth), at the back
  for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) bx(g, 50, hz0, 50, sx * (hw / 2 - 40), hz0 / 2, cz + sy * (hd / 2 - 40), F.oak);
  bx(g, hw, 30, hd, 0, hz0 + 15, cz, F.oak);                                                       // floor
  bx(g, hw - 20, body, hd - 20, 0, hz0 + 30 + body / 2, cz, F.paint);                              // walls
  bx(g, hw - 20, 60, hd - 20, 0, hz0 + 30 + body + 30, cz, F.paint);                               // gable fill (simplified)
  for (const s of [-1, 1]) { const r = bx(g, hw + 120, 20, hd / 2 + 120, 0, h - 120, cz + s * (hd / 4 + 10), F.roofFelt); r.rotation.x = s * 0.5; } // two roof planes
  bx(g, 250, 300, 20, -hw / 2 + 60 + 125, hz0 + 30 + 150, cz - hd / 2 + 20, F.black);              // hatch (dark opening) on the front face
  const ramp = bx(g, 240, 20, 620, -hw / 2 + 185, hz0 / 2 + 20, cz - hd / 2 - 290, F.oak); ramp.rotation.x = -0.5; // ramp down into the run
  bx(g, 320, 260, 200, hw / 2 - 160, hz0 + 30 + body * 0.35 + 130, cz + hd / 2 + 90, F.paint);      // nest box at the back
  bx(g, 340, 20, 240, hw / 2 - 160, hz0 + 30 + body * 0.35 + 270, cz + hd / 2 + 100, F.roofFelt);
  if (run > 400) { // wire run: corner posts, mesh on the three open sides and the top, a little door frame
    const rz = 1000, rc = -d / 2 + run / 2, RW = w - 20;
    for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) bx(g, 30, rz, 30, sx * (RW / 2 - 15), rz / 2, rc + sy * (run / 2 - 15), F.oak);
    for (const s of [-1, 1]) { const m = bx(g, 4, rz - 40, run - 30, s * (RW / 2 - 15), rz / 2, rc, F.mesh); m.castShadow = false; }
    let m = bx(g, RW - 30, rz - 40, 4, 0, rz / 2, -d / 2 + 15, F.mesh); m.castShadow = false;
    m = bx(g, RW - 30, 4, run - 30, 0, rz - 2, rc, F.mesh); m.castShadow = false;
    bx(g, 30, rz - 60, 30, -RW / 2 + 15 + 500, rz / 2, -d / 2 + 15, F.oak);                        // door stile
  }
}
function planter(g, w, d, h) { // fibre-cement planter (anthracite) with a tall ornamental grass / shrub — terrace edges instead of railings (meeting 2026-10-21)
  const T = 20;
  bx(g, w, h, d, 0, h / 2, 0, F.anthracite);
  bx(g, w - 2 * T, 40, d - 2 * T, 0, h - 20, 0, F.soil);
  const R = Math.min(w, d) * 0.55, n = Math.max(2, Math.round(w / 420)), ph = Math.max(600, h * 1.4);
  for (let i = 0; i < n; i++) { // one clump per ≈ 420 mm: a few stems and three stacked foliage blobs, the top one lighter
    const x = -w / 2 + (i + 0.5) * w / n, off = ((i * 7) % 3 - 1) * d * 0.12;
    for (let k = 0; k < 3; k++) { const a = k * 2.1 + i; stem(g, [x + Math.cos(a) * 40, h - 30, off + Math.sin(a) * 40], [x + Math.cos(a) * 90, h + ph * (0.45 + k * 0.15), off + Math.sin(a) * 60], 8, F.oak); }
    blob(g, R * 0.42, x, h + ph * 0.35, off, F.leaf);
    blob(g, R * 0.40, x + 30, h + ph * 0.62, off - 20, F.leaf);
    blob(g, R * 0.32, x - 20, h + ph * 0.88, off + 10, F.leafLight);
  }
}

function compost(g, w, d, h) { // slatted wooden compost bin, three quarters full
  for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) bx(g, 60, h, 60, sx * (w / 2 - 30), h / 2, sy * (d / 2 - 30), F.oak);
  const n = Math.max(3, Math.round(h / 130));
  for (let k = 0; k < n; k++) { const z = 40 + k * (h - 60) / n + 35;
    for (const s of [-1, 1]) { bx(g, w - 120, 70, 20, 0, z, s * (d / 2 - 10), F.oak); bx(g, 20, 70, d - 120, s * (w / 2 - 10), z, 0, F.oak); } }
  bx(g, w - 60, h * 0.72, d - 60, 0, h * 0.36, 0, F.compost);
}

const BUILDERS = {
  bed_single: bed, bed_double: bed, nightstand, dresser, wardrobe, desk, chair: (g, w, d, h) => chair(g, w, d, h, F.chrome), dining_chair: (g, w, d, h) => chair(g, w, d, h, F.oak),
  sofa_L: sofaL, coffee_table: coffeeTable, dining_table: (g, w, d, h) => table(g, w, d, h), bench, toilet, sink, shower, car, treadmill, gym_rack: gymRack, appliance, box: plainBox,
  desk_L: deskL, office_chair: officeChair, sofa, monitor, pc: pcTower, tv, tv_table: tvTable, console: consoleBox, carpet, bookshelf,
  monitor_curved: monitorCurved, shelving, chest_freezer: chestFreezer, crates, fridge_us: fridgeUS, fridge_builtin: fridgeBuiltin, tall_cabinet: tallCabinet, oven_tower: ovenTower, dishwasher, wine_cooler: wineCooler, hood, thermomix, optigrill, knife_block: knifeBlock,
  grill_outdoor: grillOutdoor, wood_stack: woodStack, punching_bag: punchingBag, weight_rack: weightRack, pullup_bar: pullupBar, parallel_bars: parallelBars,
  workbench, pegboard, toolchest, bike_wall: bikeWall, elec_cabinet: elecCabinet, net_rack: netRack, shoe_rack: shoeRack, ficus_benjamina: ficus, planter,
  kallax, henhouse, compost, bath_cabinet: bathCabinet, vanity, towel_radiator: towelRadiator,
};
export const FURNITURE_TYPES = Object.keys(BUILDERS);

/** Build one furniture item as a Group placed in world space. ctx = { walls: [rects], items, rooms, zf } */
export function buildItem(it, ctx) {
  const g = new THREE.Group(); g.name = 'furniture:' + it.id; g.userData = { kind: 'furniture', id: it.id, data: it };
  const back = ANGLE[it.back] != null ? it.back : orient(it, ctx); // `back` in the data (set by the editor) pins the orientation
  const r = it.rect, alongX = back === 'N' || back === 'S';
  const w = alongX ? rectW(r) : rectD(r), d = alongX ? rectD(r) : rectW(r), h = it.h || 750;
  (BUILDERS[it.type] || plainBox)(g, w, d, h, it, back, ctx); // builders ignore the extra args unless they need orientation context
  mergeInto(g, { skip: o => !!o.userData?.dynamic }); // one mesh per material (local frame — the group is still at the origin here); moving parts (fridge doors) stay separate
  const [cx, cy] = rectC(r);
  const room = ctx.rooms.find(rm => pointInPoly(cx, cy, rm.poly));
  const z = room ? roomFloorZ(room, ctx.zf) : (ctx.ground && ctx.zf === 0 ? ctx.ground(cx, cy) : ctx.zf); // outside every room (garden): on the terrain
  g.position.set(M(cx), M(z + (it.z || 0)), M(cy)); // `z` = bottom of the item above the floor (things placed on furniture)
  g.rotation.y = ANGLE[back] - (it.rot || 0) * Math.PI / 180;
  g.userData.floorZ = z; g.userData.back = back; g.userData.size = { w, d, h }; // local extents (editor selection box)
  return g;
}

/** All furniture of one level → Group. `ground(x, y)` = terrain height for items outside every room (garden). */
export function buildFurniture(L, zf, ground = null) {
  const g = new THREE.Group(); g.name = 'furniture';
  const walls = [...L.walls.map(w => w.rect), ...L.fixtures.filter(f => f.rect && /kuch|skrin|regaly|technol/.test(f.id)).map(f => f.rect)];
  const ctx = { walls, items: L.furniture || [], rooms: L.rooms, zf, ground };
  for (const it of ctx.items) g.add(buildItem(it, ctx));
  return g;
}

// ---------- built-in fixtures ----------
const WORKTOP = 900, WALLCAB_Z0 = 1450, WALLCAB_ROW = 2100, WALLCAB_D = 350, CORNER_A = 650, DOOR_W = 500, REVEAL = 4, FRONT_T = 18, PANEL = 20;
/**
 * Kitchen from the `f_kuch*` rects (+ sink `f_drez`, appliances from furniture): base cabinets with the worktop, and
 * wall cabinets from 1 450 up to the ceiling along every wall face that a run, a tall appliance (fridge, oven tower) or
 * a hidden pantry door in the kitchen touches — one band per wall face, cut around the hood, tall appliances and windows
 * (only where they overlap in height), continued above the fridge / oven tower; a diagonal corner unit where two bands
 * meet in a corner. Fronts: doors ≈ 500 wide with 4 mm reveals in the cabinet colour (mats.cabinet), two rows
 * (1 450–2 100 and 2 100–ceiling). A hidden door (`front`, openings.js) gets a floor-to-ceiling cabinet surround.
 */
export function buildKitchen(L, zf) {
  const g = new THREE.Group(); g.name = 'fixture:kitchen';
  const ceil = zf + (L.height || 2900);
  const runs = L.fixtures.filter(f => f.rect && /^f_kuch/.test(f.id));
  const furn = L.furniture || [], walls = L.walls.map(w => w.rect);
  const roomOf = r => L.rooms.find(rm => pointInPoly((r[0] + r[2]) / 2, (r[1] + r[3]) / 2, rm.poly));
  const floorOf = r => { const rm = roomOf(r); return rm ? roomFloorZ(rm, zf) : zf; };
  const kitchenRooms = new Set(runs.map(r => roomOf(r.rect)).filter(Boolean));
  const inKitchen = r => kitchenRooms.has(roomOf(r));
  const talls = furn.filter(f => ['appliance', 'fridge_us', 'fridge_builtin', 'tall_cabinet', 'oven_tower'].includes(f.type) && (f.h || 0) >= 1500 && inKitchen(f.rect));
  const hoods = furn.filter(f => f.type === 'hood' && inKitchen(f.rect));
  const sinkF = L.fixtures.find(f => /drez/.test(f.id) && f.rect);
  // base cabinets + worktop per run, minus tall appliances
  for (const run of runs) {
    const cut = talls.filter(a => rectsOverlap(a.rect, run.rect)).map(a => a.rect);
    for (const c of splitRect(run.rect, cut)) {
      if (c[2] - c[0] < 60 || c[3] - c[1] < 60) continue;
      g.add(boxFromRect(c, zf + 100, zf + WORKTOP - 40, F.white)); g.add(boxFromRect([c[0] + 40, c[1] + 40, c[2] - 40, c[3] - 40], zf, zf + 100, F.grey));
      g.add(boxFromRect(c, zf + WORKTOP - 40, zf + WORKTOP, F.oak));
    }
  }
  // hidden doors (pantry entry): floor-to-ceiling side panels + a cabinet above the door over the surround's full depth
  const portals = [];
  for (const o of L.openings) {
    const r = hiddenDoorRect(o, L.walls.find(x => x.id === o.wall)); if (!r || !inKitchen(r)) continue;
    const d = sideDistances(r, walls), wallSide = nearest(d, ['N', 'S', 'E', 'W']), front = opposite[wallSide], horiz = wallSide === 'N' || wallSide === 'S';
    const [x0, y0, x1, y1] = r, z0 = floorOf(r), top = z0 + (o.h || 2100);
    const over = horiz ? [x0 - PANEL, y0, x1 + PANEL, y1] : [x0, y0 - PANEL, x1, y1 + PANEL];
    for (const side of horiz ? [[x0 - PANEL, y0, x0, y1], [x1, y0, x1 + PANEL, y1]] : [[x0, y0 - PANEL, x1, y0], [x0, y1, x1, y1 + PANEL]]) g.add(boxFromRect(side, z0, ceil, F.cabinetBox));
    cabinet(g, over, top, ceil, front);
    portals.push({ rect: over, z0, z1: ceil });
  }
  // wall-cabinet bands: one per wall face touched by a run / tall appliance / portal
  const faces = new Map();
  for (const r of [...runs.map(f => f.rect), ...talls.map(a => a.rect), ...portals.map(p => p.rect)]) {
    const d = sideDistances(r, walls);
    for (const side of ['N', 'S', 'E', 'W']) {
      if (d[side] >= 100) continue;
      const c = side === 'N' ? r[1] - d.N : side === 'S' ? r[3] + d.S : side === 'W' ? r[0] - d.W : r[2] + d.E;
      const [a0, a1] = side === 'N' || side === 'S' ? [r[0], r[2]] : [r[1], r[3]];
      const key = side + ':' + Math.round(c / 10), f = faces.get(key) || { side, c, a0, a1 };
      f.a0 = Math.min(f.a0, a0); f.a1 = Math.max(f.a1, a1); faces.set(key, f);
    }
  }
  const bands = [...faces.values()], zB = zf + WALLCAB_Z0;
  for (const A of bands) for (const B of bands) { // corner unit where an E–W band meets a N–S band
    if (!(A.side === 'N' || A.side === 'S') || !(B.side === 'E' || B.side === 'W')) continue;
    const x = B.c, y = A.c, ax = Math.abs(A.a0 - x) < 10 ? 1 : Math.abs(A.a1 - x) < 10 ? -1 : 0, by = Math.abs(B.a0 - y) < 10 ? 1 : Math.abs(B.a1 - y) < 10 ? -1 : 0;
    if (!ax || !by) continue;
    if (ax > 0) A.a0 = x + CORNER_A; else A.a1 = x - CORNER_A;
    if (by > 0) B.a0 = y + CORNER_A; else B.a1 = y - CORNER_A;
    cornerUnit(g, x, y, ax, by, zB, ceil);
  }
  const obstacles = [
    ...talls.map(a => ({ rect: a.rect, z0: floorOf(a.rect), z1: floorOf(a.rect) + (a.h || 0) })),
    ...hoods.map(a => ({ rect: a.rect, z0: floorOf(a.rect) + (a.z || 0), z1: floorOf(a.rect) + (a.z || 0) + (a.h || 500) })),
    ...portals,
    ...L.openings.filter(o => o.type === 'window').map(o => ({ rect: [o.rect[0] - WALLCAB_D, o.rect[1] - WALLCAB_D, o.rect[2] + WALLCAB_D, o.rect[3] + WALLCAB_D], z0: zf + (o.sill || 0), z1: zf + (o.sill || 0) + (o.h || 0) })),
  ];
  for (const b of bands) {
    const horiz = b.side === 'N' || b.side === 'S';
    const r = b.side === 'N' ? [b.a0, b.c, b.a1, b.c + WALLCAB_D] : b.side === 'S' ? [b.a0, b.c - WALLCAB_D, b.a1, b.c] : b.side === 'W' ? [b.c, b.a0, b.c + WALLCAB_D, b.a1] : [b.c - WALLCAB_D, b.a0, b.c, b.a1];
    if (b.a1 - b.a0 < 60) continue;
    const obs = obstacles.filter(o => rectsOverlap(o.rect, r) && o.z1 > zB && o.z0 < ceil);
    const edges = new Set([b.a0, b.a1]); for (const o of obs) for (const v of horiz ? [o.rect[0], o.rect[2]] : [o.rect[1], o.rect[3]]) if (v > b.a0 && v < b.a1) edges.add(v);
    const xs = [...edges].sort((p, q) => p - q);
    for (let i = 0; i < xs.length - 1; i++) {
      const s0 = xs[i], e0 = xs[i + 1]; if (e0 - s0 < 40) continue;
      const cell = horiz ? [s0, r[1], e0, r[3]] : [r[0], s0, r[2], e0];
      const cover = obs.filter(o => rectsOverlap(o.rect, cell)).map(o => [o.z0, o.z1]);
      for (const [z0, z1] of freeIntervals(zB, ceil, cover)) {
        if (z1 - z0 < 150) continue;
        const rows = z0 <= zB + 1 && z1 > zf + WALLCAB_ROW + 150 ? [[z0, zf + WALLCAB_ROW], [zf + WALLCAB_ROW, z1]] : [[z0, z1]];
        for (const [za, zc] of rows) cabinet(g, cell, za, zc, opposite[b.side]);
      }
    }
  }
  if (sinkF) { // inset basin; the tap stands behind it on the wall side of the run
    const [x0, y0, x1, y1] = sinkF.rect;
    g.add(boxFromRect([x0, y0, x1, y1], zf + WORKTOP - 170, zf + WORKTOP + 2, F.steel)); g.add(boxFromRect([x0 + 30, y0 + 30, x1 - 30, y1 - 30], zf + WORKTOP - 160, zf + WORKTOP - 20, F.grey));
    const dd = sideDistances(sinkF.rect, walls), side = nearest(dd, ['N', 'S', 'E', 'W']);
    const tx = side === 'W' ? x0 - 25 : side === 'E' ? x1 + 25 : (x0 + x1) / 2, ty = side === 'N' ? y0 - 25 : side === 'S' ? y1 + 25 : (y0 + y1) / 2;
    cyl(g, 12, 300, tx, zf + WORKTOP + 150, ty, F.chrome, 10); const sp = cyl(g, 10, 180, tx + (side === 'W' ? 90 : side === 'E' ? -90 : 0), zf + WORKTOP + 300, ty + (side === 'N' ? 90 : side === 'S' ? -90 : 0), F.chrome, 8); sp.rotation.z = side === 'W' || side === 'E' ? Math.PI / 2 : 0; sp.rotation.x = side === 'N' || side === 'S' ? Math.PI / 2 : 0;
  }
  mergeInto(g, { skip: o => !!o.userData?.dynamic }); // moving parts (shower door) stay separate
  return g;
}
/** [lo, hi] minus the z-ranges `covers` → free [z0, z1] intervals. */
function freeIntervals(lo, hi, covers) {
  const out = []; let c = lo;
  for (const [a, b] of [...covers].sort((u, v) => u[0] - v[0])) { if (a > c) out.push([c, Math.min(a, hi)]); c = Math.max(c, b); if (c >= hi) break; }
  if (c < hi) out.push([c, hi]);
  return out;
}
/** One wall-cabinet cell: carcass + doors (≈ 500 wide, 4 mm reveals) with a small dark handle, fronts on the `front` side. */
function cabinet(g, rect, z0, z1, front) {
  const [x0, y0, x1, y1] = rect, horiz = front === 'N' || front === 'S';
  const inner = front === 'S' ? [x0, y0, x1, y1 - FRONT_T] : front === 'N' ? [x0, y0 + FRONT_T, x1, y1] : front === 'E' ? [x0, y0, x1 - FRONT_T, y1] : [x0 + FRONT_T, y0, x1, y1];
  g.add(boxFromRect(inner, z0, z1, F.cabinetBox));
  const w = horiz ? x1 - x0 : y1 - y0, n = Math.max(1, Math.round(w / DOOR_W)), dw = w / n;
  for (let i = 0; i < n; i++) {
    const s = (horiz ? x0 : y0) + i * dw + REVEAL, e = s + dw - 2 * REVEAL;
    g.add(boxFromRect(front === 'S' ? [s, y1 - FRONT_T, e, y1] : front === 'N' ? [s, y0, e, y0 + FRONT_T] : front === 'E' ? [x1 - FRONT_T, s, x1, e] : [x0, s, x0 + FRONT_T, e], z0 + REVEAL, z1 - REVEAL, F.cabinet));
    const hx = (n > 1 && i < n / 2) || n === 1 ? e - 40 : s + 40, hz = z0 + 100;
    g.add(boxFromRect(front === 'S' ? [hx - 8, y1, hx + 8, y1 + 22] : front === 'N' ? [hx - 8, y0 - 22, hx + 8, y0] : front === 'E' ? [x1, hx - 8, x1 + 22, hx + 8] : [x0 - 22, hx - 8, x0, hx + 8], hz, hz + 100, F.black));
  }
}
/** Diagonal corner wall cabinet at the corner (x, y): CORNER_A along each wall (sx, sy = directions the bands run), WALLCAB_D deep, a door on the 45° face in each row. */
function cornerUnit(g, x, y, sx, sy, z0, z1) {
  const A = CORNER_A, D = WALLCAB_D;
  const poly = [[x, y], [x + sx * A, y], [x + sx * A, y + sy * D], [x + sx * D, y + sy * A], [x, y + sy * A]];
  const area = poly.reduce((a, p, i) => { const q = poly[(i + 1) % poly.length]; return a + p[0] * q[1] - q[0] * p[1]; }, 0);
  g.add(prismFromPoly(area > 0 ? poly : [...poly].reverse(), z1, z1 - z0, F.cabinetBox));
  const p1 = poly[2], p2 = poly[3], dx = p2[0] - p1[0], dy = p2[1] - p1[1], len = Math.hypot(dx, dy), mx = (p1[0] + p2[0]) / 2, my = (p1[1] + p2[1]) / 2, nx = sx / Math.SQRT2, ny = sy / Math.SQRT2;
  const rows = z1 > z0 + (WALLCAB_ROW - WALLCAB_Z0) + 150 ? [[z0, z0 + WALLCAB_ROW - WALLCAB_Z0], [z0 + WALLCAB_ROW - WALLCAB_Z0, z1]] : [[z0, z1]];
  for (const [za, zc] of rows) {
    const door = box(len - 2 * REVEAL, zc - za - 2 * REVEAL, FRONT_T, 0, 0, 0, F.cabinet);
    door.position.set(M(mx + nx * FRONT_T / 2), M((za + zc) / 2), M(my + ny * FRONT_T / 2)); door.rotation.y = -Math.atan2(dy, dx); g.add(door);
    const knob = box(16, 100, 22, 0, 0, 0, F.black);
    knob.position.set(M(mx + nx * (FRONT_T + 11) - dx / len * (len / 2 - 60)), M(za + 150), M(my + ny * (FRONT_T + 11) - dy / len * (len / 2 - 60))); knob.rotation.y = -Math.atan2(dy, dx); g.add(knob);
  }
}
/** rect minus a list of rects → grid cells (rectilinear). */
function splitRect(rect, cuts) {
  const xs = [...new Set([rect[0], rect[2], ...cuts.flatMap(c => [c[0], c[2]])])].filter(v => v >= rect[0] && v <= rect[2]).sort((a, b) => a - b);
  const ys = [...new Set([rect[1], rect[3], ...cuts.flatMap(c => [c[1], c[3]])])].filter(v => v >= rect[1] && v <= rect[3]).sort((a, b) => a - b);
  const out = [];
  for (let i = 0; i < xs.length - 1; i++) for (let j = 0; j < ys.length - 1; j++) {
    const cx = (xs[i] + xs[i + 1]) / 2, cy = (ys[j] + ys[j + 1]) / 2;
    if (!cuts.some(c => cx > c[0] && cx < c[2] && cy > c[1] && cy < c[3])) out.push([xs[i], ys[j], xs[i + 1], ys[j + 1]]);
  }
  return out;
}

/** Other built-ins: fireplace wall, hall unit, outdoor kitchen, tech room, bathroom fixtures. Returns Group. */
export function buildBuiltins(L, zf) {
  const g = new THREE.Group(); g.name = 'fixture:builtins';
  const furn = L.furniture || [];
  const sameRect = (a, b) => a && b && a.every((v, i) => Math.abs(v - b[i]) < 6);
  const walls = L.walls.map(w => w.rect);
  for (const f of L.fixtures) {
    if (!f.rect || f.z1 != null || /schod|komin|f_kuch\d|drez|zelena|zidka|pilir|perg|zabr|striska|drevo/.test(f.id)) continue; // kitchen runs → buildKitchen; the outdoor kitchen f_vkuch is built below
    const twin = furn.find(n => sameRect(n.rect, f.rect));
    const [x0, y0, x1, y1] = f.rect, w = x1 - x0, d = y1 - y0;
    if (/krb/.test(f.id)) { // corner fireplace: stone-clad pillar to the ceiling, two-sided glass firebox at the corner facing the room
      const dd = sideDistances(f.rect, walls), openX = dd.W >= dd.E ? -1 : 1, openY = dd.S >= dd.N ? 1 : -1; // open corner = the sides away from walls
      const cx = openX < 0 ? x0 : x1, cy = openY > 0 ? y1 : y0, FB = 560, z0 = zf + 500, z1 = zf + 1250;
      const inner = [Math.min(cx, cx - openX * FB), Math.min(cy, cy - openY * FB), Math.max(cx, cx - openX * FB), Math.max(cy, cy - openY * FB)];
      const cells = splitRect(f.rect, [[inner[0] - 1, inner[1] - 1, inner[2] + 1, inner[3] + 1]]);
      g.add(boxFromRect(f.rect, zf, z0, F.travertine)); g.add(boxFromRect(f.rect, z1, zf + 2900, F.travertine));
      for (const c of cells) g.add(boxFromRect(c, z0, z1, F.travertine));
      // hollow firebox: black floor, ceiling and the two back walls (the sides against the pillar), fire inside
      const bx0 = inner[0] + 4, by0 = inner[1] + 4, bx1 = inner[2] - 4, by1 = inner[3] - 4;
      g.add(boxFromRect([bx0, by0, bx1, by1], z0, z0 + 20, F.black)); g.add(boxFromRect([bx0, by0, bx1, by1], z1 - 20, z1, F.black));
      g.add(boxFromRect(openX < 0 ? [bx1 - 20, by0, bx1, by1] : [bx0, by0, bx0 + 20, by1], z0, z1, F.black));
      g.add(boxFromRect(openY > 0 ? [bx0, by0, bx1, by0 + 20] : [bx0, by1 - 20, bx1, by1], z0, z1, F.black));
      g.add(boxFromRect([inner[0] + 130, inner[1] + 130, inner[2] - 130, inner[3] - 130], z0 + 20, z0 + 120, F.rubber));             // logs / ash bed
      g.add(boxFromRect([inner[0] + 180, inner[1] + 180, inner[2] - 180, inner[3] - 180], z0 + 100, z0 + 480, F.fire));               // fire
      const gx = openX < 0 ? [inner[0] - 6, inner[1], inner[0] + 6, inner[3]] : [inner[2] - 6, inner[1], inner[2] + 6, inner[3]];
      const gy = openY > 0 ? [inner[0], inner[3] - 6, inner[2], inner[3] + 6] : [inner[0], inner[1] - 6, inner[2], inner[1] + 6];
      for (const gr of [gx, gy]) { const pane = boxFromRect(gr, z0 + 20, z1 - 20, F.glass); pane.castShadow = false; g.add(pane); }
      continue; }
    if (/skrin/.test(f.id)) { if (twin && twin.type === 'wardrobe') continue; g.add(boxFromRect(f.rect, zf + (twin ? 1300 : 0), zf + 2100, F.white)); if (twin) for (let i = 0; i < 4; i++) g.add(boxFromRect([x0 + 300 + i * (w - 600) / 3 - 15, y1 - 40, x0 + 300 + i * (w - 600) / 3 + 15, y1 - 10], zf + 1150, zf + 1250, F.chrome)); continue; } // hall unit: bench below (furniture), hooks, cabinets above
    if (/vkuch/.test(f.id)) { // outdoor kitchen unit against the pergola's west wall (owner 2026-10-21): concrete block on the terrace slab with a countertop washbasin and a wall tap; the gas grill is furniture (n_gril) standing next to it
      const tz = zf + CONST.TERRACE_Z, wt = tz + WORKTOP, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, bw = Math.min(360, w - 200) / 2, bd = Math.min(460, d - 200) / 2;
      g.add(boxFromRect(f.rect, tz, wt, F.concrete));
      g.add(boxFromRect([cx - bw, cy - bd, cx + bw, cy + bd], wt, wt + 140, F.ceramic));                           // washbasin bowl on the worktop
      g.add(boxFromRect([cx - bw + 35, cy - bd + 35, cx + bw - 35, cy + bd - 35], wt + 45, wt + 141, F.grey));     // bowl inside
      cyl(g, 14, 300, x0 + 70, wt + 150, cy, F.chrome, 10);                                                       // wall-mounted tap: riser
      g.add(box(cx - x0 - 40, 24, 24, x0 + 70 + (cx - x0 - 40) / 2, wt + 300, cy, F.chrome));                      // spout to the bowl's centre
      continue; }
    if (/pracka/.test(f.id)) { // washer + dryer: side by side when the rect is wide, stacked when it is narrow
      const dd = sideDistances(f.rect, walls), side = nearest(dd, ['N', 'S', 'E', 'W']), horiz = side === 'N' || side === 'S';
      const n = (horiz ? w : d) >= 1100 ? 2 : 1, fy = side === 'N' ? y1 + 6 : side === 'S' ? y0 - 6 : (y0 + y1) / 2, fx = side === 'W' ? x1 + 6 : side === 'E' ? x0 - 6 : (x0 + x1) / 2;
      for (let i = 0; i < n; i++) {
        const r = horiz ? [x0 + i * w / n, y0, x0 + (i + 1) * w / n, y1] : [x0, y0 + i * d / n, x1, y0 + (i + 1) * d / n];
        g.add(boxFromRect([r[0] + 5, r[1] + 5, r[2] - 5, r[3] - 5], zf, zf + 850, F.white));
        const p = cyl(g, 140, 12, horiz ? (r[0] + r[2]) / 2 : fx, zf + 450, horiz ? fy : (r[1] + r[3]) / 2, F.glass, 20); if (horiz) p.rotation.x = Math.PI / 2; else p.rotation.z = Math.PI / 2;
      }
      if (n === 2) g.add(boxFromRect(f.rect, zf + 850, zf + 900, F.oak)); else { g.add(boxFromRect(f.rect, zf + 850, zf + 1700, F.white)); const p = cyl(g, 140, 12, fx, zf + 1275, fy, F.glass, 20); if (horiz) p.rotation.x = Math.PI / 2; else p.rotation.z = Math.PI / 2; }
      continue; }
    if (/mrazak/.test(f.id)) { g.add(boxFromRect(f.rect, zf, zf + 1800, F.white)); continue; }
    if (/technol_rek/.test(f.id)) { // one ventilation unit with heat recovery on its own rect (RD Vysoký Újezd: Zehnder ComfoAir Q350): wall-hung box, four Ø160 ducts up to the ceiling
      const room = L.rooms.find(r => pointInPoly((x0 + x1) / 2, (y0 + y1) / 2, r.poly)), ceil = zf + (room?.ceil || L.height || 2600), zb = zf + 1050, zt = zf + 1900;
      g.add(boxFromRect(f.rect, zb, zt, F.white));
      for (let i = 0; i < 4; i++) cyl(g, 80, ceil - zt, x0 + w * (i + 0.5) / 4, (zt + ceil) / 2, (y0 + y1) / 2, F.grey, 16);
      continue; }
    if (/technol_tc/.test(f.id)) { // one heat-pump indoor module with a built-in hot-water tank on its own rect (RD Vysoký Újezd: IVT AirModul): floor-standing white column, dark display on the front (away from the nearest wall)
      g.add(boxFromRect(f.rect, zf, zf + 1800, F.white));
      const side = nearest(sideDistances(f.rect, walls), ['N', 'S', 'E', 'W']), cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, P = 90;
      g.add(boxFromRect(side === 'N' ? [cx - P, y1, cx + P, y1 + 6] : side === 'S' ? [cx - P, y0 - 6, cx + P, y0] : side === 'W' ? [x1, cy - P, x1 + 6, cy + P] : [x0 - 6, cy - P, x0, cy + P], zf + 1450, zf + 1560, F.black));
      continue; }
    if (/technol/.test(f.id)) { // heat pump (indoor unit), hot-water tank, ventilation unit (wall-hung, high): side by side in a wide rect, in a row along the wall in a narrow (< 1 400) one
      if (w >= 1400) { g.add(boxFromRect([x0, y0, x0 + 600, y0 + 600], zf, zf + 1800, F.white)); cyl(g, 350, 1900, x1 - 450, zf + 950, y0 + 450, F.white, 24); g.add(boxFromRect([x0 + 100, y1 - 700, x0 + 1100, y1 - 100], zf + 1500, zf + 2200, F.grey)); }
      else { g.add(boxFromRect([x0, y0, x0 + 600, y0 + 600], zf, zf + 1800, F.white)); cyl(g, 350, 1900, x0 + 400, zf + 950, y0 + 1050, F.white, 24); g.add(boxFromRect([x0 + 50, y1 - 1100, x0 + 650, y1 - 100], zf + 1500, zf + 2200, F.grey)); }
      continue; }
    if (/regaly/.test(f.id)) { const longX = w >= d; const n = Math.floor((longX ? w : d) / 1000); for (let i = 0; i <= n; i++) { const a = (longX ? x0 : y0) + i * ((longX ? w : d) / n); g.add(boxFromRect(longX ? [a - 20, y0, a + 20, y1] : [x0, a - 20, x1, a + 20], zf, zf + 2000, F.grey)); } for (let k = 0; k < 5; k++) g.add(boxFromRect(f.rect, zf + 150 + k * 450, zf + 180 + k * 450, F.oak)); continue; }
    if (/wc/.test(f.id)) { if (twin) continue; const it = { id: f.id, type: 'toilet', rect: f.rect, h: 400 }; g.add(buildItem(it, { walls, items: [], rooms: L.rooms, zf })); continue; }
    if (/sprcha/.test(f.id)) { if (twin) continue; g.add(buildItem({ id: f.id, type: 'shower', rect: f.rect, h: 2000 }, { walls, items: [], rooms: L.rooms, zf })); continue; }
    if (/umyv/.test(f.id)) { if (twin) continue; g.add(buildItem({ id: f.id, type: 'sink', rect: f.rect, h: 850 }, { walls, items: [], rooms: L.rooms, zf })); continue; }
    if (/vana/.test(f.id)) { g.add(boxFromRect(f.rect, zf, zf + 580, F.white)); g.add(boxFromRect([x0 + 60, y0 + 60, x1 - 60, y1 - 60], zf + 400, zf + 582, F.ceramic)); g.add(boxFromRect([x0 + 120, y0 + 120, x1 - 120, y1 - 120], zf + 200, zf + 583, F.grey)); const t = cyl(g, 12, 250, x1 - 150, zf + 700, (y0 + y1) / 2, F.chrome, 10); continue; }
    g.add(boxFromRect(f.rect, zf, zf + 900, F.grey)); // unknown built-in: a 900 box
  }
  mergeInto(g, { skip: o => !!o.userData?.dynamic }); // moving parts (shower door) stay separate
  return g;
}
