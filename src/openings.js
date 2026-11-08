// openings.js — walls split around their openings + parametric window / door / sliding / garage elements.
//
// Local frame of an opening (and of a glazed unit): origin at the opening's plan centre on the wall
// centreline, at the level floor. u = along the wall (+u = east for E–W walls, south for N–S walls),
// z = up (mm above the level floor), v = across the wall. For N–S walls the group is rotated −90°
// about Y so local +v = west. `sideSign` converts the JSON swing side (+ = south/east) to local v.
import * as THREE from 'three';
import { M, CONST, box, boxFromRect, rectsOverlap, instancedBoxes } from './prims.js';
import { mats } from './materials.js';

const FRAME = 70, FRAME_D = 90, GLASS_T = 8, JAMB = 50, LEAF_T = 40, MAX_PANE = 1200;

export function wallFrame(w) {
  const [x0, y0, x1, y1] = w.rect;
  const horiz = (x1 - x0) >= (y1 - y0);
  return { horiz, a0: horiz ? x0 : y0, a1: horiz ? x1 : y1, t: horiz ? y1 - y0 : x1 - x0, c: horiz ? (y0 + y1) / 2 : (x0 + x1) / 2 };
}

/**
 * Build one wall (any kind except `lamely`) with its openings cut out by splitting into boxes.
 * ops = openings referencing this wall. floorRaise(o) = mm the opening bottom is lifted to the
 * adjacent indoor floor (garage block at +300). masses = fixture masses (for glazed-wall clipping).
 */
export function buildWall(w, ops, zf, L, floorRaise, masses = []) {
  const g = new THREE.Group(); g.name = 'wall:' + w.id; g.userData = { kind: 'wall', id: w.id, data: w };
  const F = wallFrame(w);
  const z0 = w.z0 ?? zf, z1 = w.z1 ?? zf + (L.height || 2900);
  const zb = (w.kind === 'ext' && z0 <= 0) ? z0 - CONST.PLINTH : z0;
  const rectAlong = (s, e) => F.horiz ? [s, w.rect[1], e, w.rect[3]] : [w.rect[0], s, w.rect[2], e];
  const clad = CONST.CLADDING.includes(w.id) && w.ins ? w.ins : null, slats = []; // timber slat cladding on the outer face (study)
  const side = w.kind === 'ext' ? w.ins : null, greyTop = side ? CONST.FACADE?.grey?.[w.id] : null;
  const skinRect = (rect, d0, d1) => { const [x0, y0, x1, y1] = rect; // a thin layer d0..d1 mm outside the outer face
    return side === 'N' ? [x0, y0 - d1, x1, y0 - d0] : side === 'S' ? [x0, y1 + d0, x1, y1 + d1] : side === 'W' ? [x0 - d1, y0, x0 - d0, y1] : [x1 + d0, y0, x1 + d1, y1]; };
  const piece = (rect, za, zc) => {
    if (zc - za <= 0) return;
    if (w.kind === 'glass') glazedWallPiece(g, rect, za, zc, z1, F, masses, w.glass);
    else g.add(boxFromRect(rect, za, zc, mats[w.kind] || mats.int));
    if (clad) cladding(g, rect, za, zc, clad, slats);
    if (greyTop && Math.min(zc, greyTop) > za) g.add(boxFromRect(skinRect(rect, 0, 8), za, Math.min(zc, greyTop), mats.extGrey)); // grey render (D.1.1.5 legend 2)
  };

  const cuts = [], detached = [];
  for (const o of ops) {
    const os = F.horiz ? o.rect[0] : o.rect[1], oe = F.horiz ? o.rect[2] : o.rect[3];
    const cs = Math.max(os, F.a0), ce = Math.min(oe, F.a1);
    if (ce - cs <= 0) { detached.push(o); continue; }
    const raise = ['door', 'sliding', 'garage', 'opening'].includes(o.type) ? floorRaise(o) : 0;
    const lo = zf + (o.sill || 0) + raise, hi = Math.min(lo + (o.h || 2000), z1); // a raised door keeps its height
    cuts.push({ o, s: cs, e: ce, lo, hi });
  }
  cuts.sort((a, b) => a.s - b.s);
  let cursor = F.a0;
  for (const c of cuts) {
    if (c.s > cursor) piece(rectAlong(cursor, c.s), zb, z1);
    piece(rectAlong(c.s, c.e), zb, c.lo);
    piece(rectAlong(c.s, c.e), c.hi, z1);
    cursor = Math.max(cursor, c.e);
  }
  if (cursor < F.a1) piece(rectAlong(cursor, F.a1), zb, z1);

  if (slats.length) g.add(instancedBoxes(slats, mats.lamely));
  // stone cladding (legend 3) on the piers between neighbouring openings, over the band of their heights
  if (side && (CONST.FACADE?.stone || []).includes(w.id)) for (let i = 0; i < cuts.length - 1; i++) {
    const a = cuts[i], b = cuts[i + 1]; if (b.s - a.e <= 0 || b.s - a.e > 2000) continue;
    g.add(boxFromRect(skinRect(rectAlong(a.e, b.s), 0, 20), Math.min(a.lo, b.lo), Math.max(a.hi, b.hi), mats.stone));
  }
  // external venetian blind boxes at the top of the listed openings, in the outer part of the reveal
  if (side) for (const c of cuts) if ((CONST.BLINDS || []).includes(c.o.id)) {
    const r = rectAlong(c.s + 20, c.e - 20), t = F.t, out = side === 'S' || side === 'E' ? 1 : -1;
    const face = F.horiz ? (out > 0 ? w.rect[3] : w.rect[1]) : (out > 0 ? w.rect[2] : w.rect[0]);
    const v0 = face - out * Math.min(160, t - 40), v1 = face + out * 10, lo = Math.min(v0, v1), hi = Math.max(v0, v1);
    const br = F.horiz ? [r[0], lo, r[2], hi] : [lo, r[1], hi, r[3]];
    g.add(boxFromRect(br, c.hi - (CONST.BLIND_H || 250), c.hi, mats.blind));
  }
  for (const c of cuts) g.add(buildOpening(c.o, w, F, zf, c));
  // opening outside its wall's outline (garage door spanning between two pillars): the opening rect
  // becomes a virtual wall segment of the same kind/height, and the opening is cut into it (→ lintel).
  for (const o of detached) g.add(buildWall({ ...w, id: w.id + '+' + o.id, rect: o.rect }, [o], zf, L, floorRaise, masses));
  return g;
}

// ---- timber slat cladding (study: garage / workshop block) ----
const SLAT_W = 60, SLAT_D = 40, SLAT_PITCH = 100, BOARD = 10, GAP = 10;
/** Dark board on the outer face of a wall piece + vertical oak slats in front of it (collected into `slats` for one InstancedMesh). */
function cladding(g, rect, za, zc, side, slats) {
  const [x0, y0, x1, y1] = rect, horiz = side === 'N' || side === 'S', out = side === 'S' || side === 'E' ? 1 : -1;
  const board = horiz ? [x0, out > 0 ? y1 : y0 - BOARD, x1, out > 0 ? y1 + BOARD : y0] : [out > 0 ? x1 : x0 - BOARD, y0, out > 0 ? x1 + BOARD : x0, y1];
  g.add(boxFromRect(board, za, zc, mats.claddingBack));
  const face = horiz ? (out > 0 ? y1 : y0) : (out > 0 ? x1 : x0), c = face + out * (BOARD + GAP + SLAT_D / 2);
  const a0 = horiz ? x0 : y0, a1 = horiz ? x1 : y1;
  for (let a = a0 + SLAT_PITCH / 2; a < a1; a += SLAT_PITCH) slats.push({ sx: horiz ? SLAT_W : SLAT_D, sz: zc - za, sy: horiz ? SLAT_D : SLAT_W, cx: horiz ? a : c, cz: (za + zc) / 2, cy: horiz ? c : a });
}

// ---- glazed walls (kind: glass) ----
/**
 * One piece of a glazed wall: glazing (panes ≤ MAX_PANE) up to GLASS_WALL_BAND below the wall top or up to a roof mass
 * sitting on it, a solid band above. An optional `band = {z0, z1}` (wall field `glass`, owner 2026-09-08) limits the
 * glazing to that height range — solid (rendered) wall below z0 (plinth / step) and above z1 (lintel / ceiling band).
 */
function glazedWallPiece(g, rect, za, zc, zWallTop, F, masses, band = null) {
  const coverZ = Math.min(zc, ...masses.filter(mm => rectsOverlap(mm.f.rect, rect) && mm.z0 > za).map(mm => mm.z0)); // a roof mass takes over from here
  const glazeTop = Math.min(coverZ, zWallTop - CONST.GLASS_WALL_BAND);
  const gz0 = Math.max(za, band?.z0 ?? za), gz1 = Math.min(glazeTop, band?.z1 ?? glazeTop);
  const u = new THREE.Group(); u.name = 'glazed';
  const [x0, y0, x1, y1] = rect;
  const wdt = F.horiz ? x1 - x0 : y1 - y0;
  placeLocal(u, F, F.horiz ? (x0 + x1) / 2 : (y0 + y1) / 2, 0);
  if (gz0 > za) u.add(box(wdt, gz0 - za, F.t, 0, (za + gz0) / 2, 0, mats.ext));                     // solid below the glass
  if (gz1 > gz0) glazing(u, wdt, gz0, gz1 - gz0, Math.max(1, Math.ceil(wdt / MAX_PANE)), 60, 100);
  if (coverZ > Math.max(gz1, gz0)) u.add(box(wdt, coverZ - Math.max(gz1, gz0), F.t, 0, (Math.max(gz1, gz0) + coverZ) / 2, 0, mats.ext)); // roof edge band / solid above the glass
  g.add(u);
}

function placeLocal(g, F, uc, zf) {
  if (F.horiz) g.position.set(M(uc), M(zf), M(F.c));
  else { g.position.set(M(F.c), M(zf), M(uc)); g.rotation.y = -Math.PI / 2; }
}

/** Frame (bars `fw` wide, `fd` deep) + `n` glass panes divided by mullions, centred at u=0, v=0.
 *  corner = {a|b: cut}: corner window — at that end the pane stops `cut` short of the opening (at the crossing
 *  of the two wall centre planes) and has no end frame; the window in the perpendicular wall meets it there. */
function glazing(g, w, z0, h, n = 1, fw = FRAME, fd = FRAME_D, mat = mats.frame, corner = null) {
  const ca = corner?.a || 0, cb = corner?.b || 0;
  const u0 = -w / 2 + ca, u1 = w / 2 - cb, ww = u1 - u0;
  const fa = ca ? 0 : fw, fb = cb ? 0 : fw, iw = ww - fa - fb, ic = u0 + fa + iw / 2;
  if (!ca) g.add(box(fw, h, fd, u0 + fw / 2, z0 + h / 2, 0, mat));
  if (!cb) g.add(box(fw, h, fd, u1 - fw / 2, z0 + h / 2, 0, mat));
  g.add(box(iw, fw, fd, ic, z0 + fw / 2, 0, mat));
  g.add(box(iw, fw, fd, ic, z0 + h - fw / 2, 0, mat));
  for (let i = 1; i < n; i++) g.add(box(fw, h - 2 * fw, fd, u0 + i * ww / n, z0 + h / 2, 0, mat));
  const glass = box(iw, h - 2 * fw, GLASS_T, ic, z0 + h / 2, 0, mats.glass);
  glass.castShadow = false; g.add(glass);
}

// ---- openings ----
export function buildOpening(o, w, F, zf, c) {
  const g = new THREE.Group(); g.name = 'opening:' + o.id;
  const wdt = c.e - c.s;
  placeLocal(g, F, (c.s + c.e) / 2, zf);
  const z0 = c.lo - zf, h = c.hi - c.lo, t = F.t;
  const ext = w.kind === 'ext' && !!w.ins;
  const sw = o.swing || { hinge: 'a', side: '+' };
  const sideSign = F.horiz ? (sw.side === '+' ? 1 : -1) : (sw.side === '+' ? -1 : 1);
  const hingeSign = sw.hinge === 'a' ? -1 : 1;
  g.userData = { kind: 'opening', id: o.id, type: o.type, wall: w.id, data: o, sideSign, hingeSign, w: wdt, h, t, z0 };
  if (o.type === 'window') { // strip windows: one pane; wide tall ones: a mullion every ≈ 1,5 m
    const corner = o.corner ? { [o.corner]: t / 2 } : null; // 'a' | 'b': that end meets the window in the perpendicular wall at a house corner
    glazing(g, wdt, z0, h, (wdt >= 1800 && h > 900) ? Math.max(2, Math.round(wdt / 1500)) : 1, FRAME, FRAME_D, mats.frame, corner);
    if (o.corner && F.horiz) { // slim steel post 100 × 100 where the two panes meet — built once, by the window in the E–W wall
      const u = o.corner === 'b' ? wdt / 2 - t / 2 : -wdt / 2 + t / 2;
      g.add(box(100, h, 100, u, z0 + h / 2, 0, mats.frame));
    }
  }
  else if (o.type === 'door') door(g, o, wdt, z0, h, t, ext, hingeSign, sideSign);
  else if (o.type === 'sliding') sliding(g, wdt, z0, h, o.slide, hingeSignFor(o.slide));
  else if (o.type === 'garage') garage(g, wdt, z0, h);
  else if (o.type === 'opening') lining(g, wdt, z0, h, t);
  return g;
}

function lining(g, w, z0, h, t) {
  const d = Math.min(t, 250);
  g.add(box(JAMB, h, d, -(w - JAMB) / 2, z0 + h / 2, 0, mats.doorIn));
  g.add(box(JAMB, h, d, (w - JAMB) / 2, z0 + h / 2, 0, mats.doorIn));
  g.add(box(w, JAMB, d, 0, z0 + h - JAMB / 2, 0, mats.doorIn));
}

function door(g, o, w, z0, h, t, ext, hingeSign, sideSign) {
  if (o.front) return hiddenDoor(g, o, w, z0, h, t, sideSign);
  const glassy = ext || (o.h || 0) >= 2300; // exterior + balcony doors: anthracite frame with glazing
  const fm = glassy ? mats.frame : mats.doorIn;
  const d = glassy ? FRAME_D : Math.min(t, 250);
  g.add(box(JAMB, h, d, -(w - JAMB) / 2, z0 + h / 2, 0, fm));
  g.add(box(JAMB, h, d, (w - JAMB) / 2, z0 + h / 2, 0, fm));
  g.add(box(w, JAMB, d, 0, z0 + h - JAMB / 2, 0, fm));
  const inner = w - 2 * JAMB, T = Math.min(o.transom || 0, h - 1200), hd = h - T; // transom: fixed glazing above the leaf (entrance door, meeting 2026-10-21)
  if (T) { g.add(box(w, JAMB, d, 0, z0 + hd - JAMB / 2, 0, fm)); glazing(g, inner, z0 + hd, T - JAMB, 1, 50, FRAME_D, fm); }
  const lw = Math.min(o.leaf || (o.w - 100), inner), lh = hd - JAMB - 10;
  const pivot = new THREE.Group(); pivot.name = 'leaf';
  pivot.position.set(M(hingeSign * inner / 2), M(z0), M(sideSign * (t / 2 - LEAF_T / 2 - 10)));
  pivot.userData = { hingeSign, sideSign, angle: 0 };
  const leafMat = glassy ? mats.frame : mats.doorIn;
  const leaf = box(lw, lh, LEAF_T, -hingeSign * lw / 2, lh / 2, 0, leafMat); pivot.add(leaf);
  if (glassy) { // glass panel in the leaf
    const gl = box(lw - 2 * FRAME, lh - 2 * FRAME - 300, GLASS_T + 2, -hingeSign * lw / 2, lh / 2 + 150, 0, mats.glass); gl.castShadow = false; pivot.add(gl);
    pivot.add(box(lw, 300 + FRAME, LEAF_T + 2, -hingeSign * lw / 2, (300 + FRAME) / 2, 0, leafMat)); // kick plate
  }
  pivot.add(box(120, 20, 40, -hingeSign * (lw - 80), 1050, LEAF_T / 2 + 20, mats.chrome));
  pivot.add(box(120, 20, 40, -hingeSign * (lw - 80), 1050, -LEAF_T / 2 - 20, mats.chrome));
  g.add(pivot);
  const rest = inner - lw;
  if (rest > 60) { // fixed sidelight next to the leaf (entrance door: 900 leaf in a 1 100 opening)
    const cu = -hingeSign * (inner / 2 - rest / 2);
    g.add(box(FRAME, lh, FRAME_D, -hingeSign * (inner / 2 - rest + FRAME / 2), z0 + lh / 2, 0, fm));
    const gl = box(rest - FRAME, lh, GLASS_T, cu, z0 + lh / 2, 0, mats.glass); gl.castShadow = false; g.add(gl);
  }
}

const CAB_LEAF_T = 20, CAB_REVEAL = 4;
/**
 * Door hidden in a run of cabinets (pantry entry): `o.front` mm in front of the wall face away from the swing, flush
 * with the cabinet fronts, `o.leaves` (1 or 2) cabinet-coloured leaves over the full opening width, no visible frame —
 * the kitchen builder (furniture.js) adds the cabinet surround. The leaves swing to the `swing.side` of the wall.
 */
function hiddenDoor(g, o, w, z0, h, t, sideSign) {
  const n = o.leaves || 2, lw = w / n - 2 * CAB_REVEAL, lh = h - 2 * CAB_REVEAL - 12;
  const v = -sideSign * (t / 2 + o.front - CAB_LEAF_T / 2);
  for (let i = 0; i < n; i++) {
    const hingeSign = n === 1 ? ((o.swing?.hinge || 'a') === 'a' ? -1 : 1) : (i === 0 ? -1 : 1);
    const pivot = new THREE.Group(); pivot.name = 'leaf'; pivot.userData = { hingeSign, sideSign, angle: 0 };
    pivot.position.set(M(hingeSign * w / 2), M(z0 + CAB_REVEAL), M(v));
    pivot.add(box(lw, lh, CAB_LEAF_T, -hingeSign * (lw / 2 + CAB_REVEAL), lh / 2, 0, mats.cabinet));
    pivot.add(box(20, 140, 24, -hingeSign * (lw - 40), 1050, -sideSign * (CAB_LEAF_T / 2 + 12), mats.frame)); // handle on the outer face, near the meeting edge
    g.add(pivot);
  }
}

const hingeSignFor = sl => (sl?.fixed === 'b' || sl?.pocket === 'b') ? 1 : -1; // local u of the fixed panel / pocket end ('a' = start = −u)

/**
 * Sliding door. slide = { fixed: 'a'|'b' } → that half is a fixed pane, the other slides over it;
 * slide = { pocket: 'a'|'b' } → one full-width leaf that disappears into the wall on that side;
 * no `slide` → two panels parting to both sides.
 */
function sliding(g, w, z0, h, slide, fixedSign) {
  g.add(box(w, 60, 140, 0, z0 + h - 30, 0, mats.frame)); // top track
  const ph = h - 60;
  if (slide?.pocket) {
    const p = new THREE.Group(); p.name = 'panel'; p.userData = { dir: fixedSign, slide: w - 40 };
    glazing(p, w - 10, z0, ph, 1, 60, 50, mats.doorIn);
    g.add(p); return;
  }
  const pw = w / 2 + 40;
  for (const s of [-1, 1]) {
    const isFixed = slide?.fixed && s === fixedSign;
    const p = new THREE.Group(); p.name = 'panel';
    p.userData = slide?.fixed ? { dir: isFixed ? 0 : fixedSign, slide: w / 2 - 20 } : { dir: s, slide: w / 2 - 60 };
    p.position.set(M(s * (w / 4 - 20)), 0, M(s * 45));
    glazing(p, pw, z0, ph, 1, 60, 60);
    g.add(p);
  }
}

function garage(g, w, z0, h) {
  const p = new THREE.Group(); p.name = 'panel'; p.userData = { lift: h - 150 };
  p.add(box(w, h, 50, 0, z0 + h / 2, 0, mats.doorOut));
  for (let i = 1; i < 5; i++) p.add(box(w, 14, 62, 0, z0 + h * i / 5, 0, mats.frame)); // section joints
  g.add(p);
}
