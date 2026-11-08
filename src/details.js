// details.js — lamella wall, bioclimatic pergola, railings, green roof, chimney, flat-roof slabs.
// World-space builders from plan rects (mm); see geometry.js for the coordinate conventions.
import * as THREE from 'three';
import { M, CONST, boxFromRect, instancedBoxes, rectilinearPrism, rectPoly, rectsOverlap } from './prims.js';
import { mats } from './materials.js';

/** kind: lamely — vertical rotating oak slats between a bottom and a top rail. */
export function lamellaWall(w, z0, z1, masses) {
  const g = new THREE.Group(); g.name = 'wall:' + w.id; g.userData = { kind: 'wall', id: w.id, data: w };
  const [x0, y0, x1, y1] = w.rect;
  const horiz = (x1 - x0) >= (y1 - y0);
  const top = Math.min(z1, ...masses.filter(mm => rectsOverlap(mm.f.rect, w.rect) && mm.z0 > z0).map(mm => mm.z0));
  const RAIL = 60, PITCH = 200, SLAT = 170, THICK = 25, ANGLE = 0.6; // slats turned ~35°
  g.add(boxFromRect(w.rect, z0, z0 + RAIL, mats.frame));
  g.add(boxFromRect(w.rect, top - RAIL, top, mats.frame));
  const len = horiz ? x1 - x0 : y1 - y0, n = Math.floor((len - PITCH / 2) / PITCH);
  const items = [];
  for (let i = 0; i < n; i++) {
    const a = (horiz ? x0 : y0) + PITCH / 2 + i * PITCH + PITCH / 2;
    items.push({ sx: horiz ? SLAT : THICK, sz: top - z0 - 2 * RAIL, sy: horiz ? THICK : SLAT,
      cx: horiz ? a : (x0 + x1) / 2, cz: (z0 + top) / 2, cy: horiz ? (y0 + y1) / 2 : a, ry: ANGLE });
  }
  g.add(instancedBoxes(items, mats.lamely));
  g.userData.lamellaTop = top;
  return g;
}

/** Bioclimatic pergola: perimeter frame beams, corner post, rotating roof lamellas (instanced). */
export function pergola(f, z0, z1, groundZ) {
  const g = new THREE.Group(); g.name = 'fixture:' + f.id; g.userData = { kind: 'fixture', id: f.id, data: f };
  const [x0, y0, x1, y1] = f.rect, B = 200;
  g.add(boxFromRect([x0, y0, x1, y0 + B], z0, z1, mats.frame));
  g.add(boxFromRect([x0, y1 - B, x1, y1], z0, z1, mats.frame));
  g.add(boxFromRect([x0, y0 + B, x0 + B, y1 - B], z0, z1, mats.frame));
  g.add(boxFromRect([x1 - B, y0 + B, x1, y1 - B], z0, z1, mats.frame));
  g.add(boxFromRect([x1 - 150, y1 - 150, x1, y1], groundZ, z0, mats.frame)); // SE post (assumption)
  const PITCH = 200, SLAT = 170, THICK = 25, ANGLE = 0.6;
  const span = (y1 - y0) - 2 * B, n = Math.floor((x1 - x0 - 2 * B) / PITCH), items = [];
  for (let i = 0; i < n; i++) items.push({ sx: SLAT, sz: THICK, sy: span, cx: x0 + B + PITCH / 2 + i * PITCH, cz: (z0 + z1) / 2, cy: (y0 + y1) / 2, rz: ANGLE });
  g.add(instancedBoxes(items, mats.lamely));
  return g;
}

/** Terrace railing: anthracite posts + handrail, continuous glass infill. */
export function railing(f, z0, z1) {
  const g = new THREE.Group(); g.name = 'fixture:' + f.id; g.userData = { kind: 'fixture', id: f.id, data: f };
  const [x0, y0, x1, y1] = f.rect;
  const horiz = (x1 - x0) >= (y1 - y0), len = horiz ? x1 - x0 : y1 - y0, c = horiz ? (y0 + y1) / 2 : (x0 + x1) / 2;
  const POST = 40, n = Math.max(1, Math.ceil(len / 1200)), items = [];
  for (let i = 0; i <= n; i++) {
    const a = (horiz ? x0 : y0) + POST / 2 + (len - POST) * i / n;
    items.push({ sx: POST, sz: z1 - z0 - 40, sy: POST, cx: horiz ? a : c, cz: (z0 + z1 - 40) / 2, cy: horiz ? c : a });
  }
  g.add(instancedBoxes(items, mats.frame));
  const rail = horiz ? [x0, c - 30, x1, c + 30] : [c - 30, y0, c + 30, y1];
  g.add(boxFromRect(rail, z1 - 40, z1, mats.frame));
  const glass = horiz ? [x0 + POST, c - 6, x1 - POST, c + 6] : [c - 6, y0 + POST, c + 6, y1 - POST];
  const gl = boxFromRect(glass, z0 + 80, z1 - 60, mats.glass); gl.castShadow = false; g.add(gl);
  return g;
}

/** Extensive green roof layer on a flat roof, minus the walkable deck and the house footprint. */
export function greenRoof(f, cuts, zTop) {
  const g = rectilinearPrism(rectPoly(f.rect), cuts, zTop + 60, 60, mats.green);
  g.name = 'fixture:' + f.id; g.userData = { kind: 'fixture', id: f.id, data: f };
  return g;
}

export function chimney(f, z0) {
  const m = boxFromRect(f.rect, z0, CONST.CHIMNEY_TOP, mats.ext);
  m.name = 'fixture:' + f.id; m.userData = { kind: 'fixture', id: f.id, data: f };
  return m;
}

/** Flat roof slab of the garage / extension: white render sides, grey roof top. */
export function roofSlab(f, z0, z1) {
  const [x0, y0, x1, y1] = f.rect;
  const m = new THREE.Mesh(new THREE.BoxGeometry(M(x1 - x0), M(z1 - z0), M(y1 - y0)),
    [mats.ext, mats.ext, mats.roof, mats.slab, mats.ext, mats.ext]);
  m.position.set(M((x0 + x1) / 2), M((z0 + z1) / 2), M((y0 + y1) / 2));
  m.castShadow = m.receiveShadow = true;
  m.name = 'fixture:' + f.id; m.userData = { kind: 'fixture', id: f.id, data: f };
  return m;
}
