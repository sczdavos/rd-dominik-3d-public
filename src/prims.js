// prims.js — unit conversion, constants and geometric primitives shared by the builders.
//
// COORDINATE CONVENTIONS (see geometry.js): model mm, x east / y south / z up;
// world metres, X = x/1000, Y = z/1000, Z = y/1000.
import * as THREE from 'three';

export const M = v => v / 1000;
export const P = (x, y, z) => new THREE.Vector3(M(x), M(z), M(y));

import { CONST } from './config.js';
export { CONST };

/** Axis-aligned box from a plan rect [x0,y0,x1,y1] and z-range [z0,z1] (all mm). */
export function boxFromRect(rect, z0, z1, material) {
  const [x0, y0, x1, y1] = rect;
  const g = new THREE.BoxGeometry(M(x1 - x0), M(z1 - z0), M(y1 - y0));
  const m = new THREE.Mesh(g, material);
  m.position.set(M((x0 + x1) / 2), M((z0 + z1) / 2), M((y0 + y1) / 2));
  m.castShadow = m.receiveShadow = true;
  return m;
}

/** Box in a local frame: centre (cx, cz, cy) and size (sx, sz, sy), mm. Local X=u, Y=up, Z=v. */
export function box(sx, sz, sy, cx, cz, cy, material) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(M(sx), M(sz), M(sy)), material);
  m.position.set(M(cx), M(cz), M(cy));
  m.castShadow = m.receiveShadow = true;
  return m;
}

/** Prism from a plan polygon [[x,y],...] (mm), extruded from zTop down by thickness (mm). Optional holes. */
export function prismFromPoly(poly, zTop, thickness, material, holes = []) {
  const shape = new THREE.Shape(poly.map(p => new THREE.Vector2(M(p[0]), M(p[1]))));
  for (const h of holes) shape.holes.push(new THREE.Path(h.map(p => new THREE.Vector2(M(p[0]), M(p[1])))));
  const g = new THREE.ExtrudeGeometry(shape, { depth: M(thickness), bevelEnabled: false });
  const m = new THREE.Mesh(g, material);
  m.rotation.x = Math.PI / 2;   // shape.y → world Z (south); extrusion goes down (−Y)
  m.position.y = M(zTop);
  m.castShadow = m.receiveShadow = true;
  return m;
}

export const rectPoly = ([x0, y0, x1, y1]) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
export const bboxOf = rects => rects.reduce((b, r) => [Math.min(b[0], r[0]), Math.min(b[1], r[1]), Math.max(b[2], r[2]), Math.max(b[3], r[3])], [Infinity, Infinity, -Infinity, -Infinity]);
export const polyBBox = poly => [Math.min(...poly.map(p => p[0])), Math.min(...poly.map(p => p[1])), Math.max(...poly.map(p => p[0])), Math.max(...poly.map(p => p[1]))];
export const rectsOverlap = (a, b) => Math.min(a[2], b[2]) - Math.max(a[0], b[0]) > 0 && Math.min(a[3], b[3]) - Math.max(a[1], b[1]) > 0;

/** Point-in-polygon (even-odd), plan coordinates. */
export function pointInPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const inRect = (x, y, r) => x > r[0] && x < r[2] && y > r[1] && y < r[3];
export function rectHitsPoly(rect, poly) {
  const b = polyBBox(poly);
  const x0 = Math.max(rect[0], b[0]), x1 = Math.min(rect[2], b[2]), y0 = Math.max(rect[1], b[1]), y1 = Math.min(rect[3], b[3]);
  return x1 - x0 > 0 && y1 - y0 > 0 && pointInPoly((x0 + x1) / 2, (y0 + y1) / 2, poly);
}

/**
 * Rectilinear polygon minus rectangles, as a group of prisms: split the bbox by every x/y edge,
 * keep cells whose centre is inside the polygon and outside all cut-outs.
 */
export function rectilinearPrism(poly, cuts, zTop, thickness, material) {
  const xs = [...new Set([...poly.map(p => p[0]), ...cuts.flatMap(c => [c[0], c[2]])])].sort((a, b) => a - b);
  const ys = [...new Set([...poly.map(p => p[1]), ...cuts.flatMap(c => [c[1], c[3]])])].sort((a, b) => a - b);
  const group = new THREE.Group();
  for (let i = 0; i < xs.length - 1; i++) for (let j = 0; j < ys.length - 1; j++) {
    const cx = (xs[i] + xs[i + 1]) / 2, cy = (ys[j] + ys[j + 1]) / 2;
    if (!pointInPoly(cx, cy, poly) || cuts.some(c => inRect(cx, cy, c))) continue;
    group.add(boxFromRect([xs[i], ys[j], xs[i + 1], ys[j + 1]], zTop - thickness, zTop, material));
  }
  return group;
}

/** InstancedMesh of unit boxes; `items` = [{sx,sz,sy, cx,cz,cy, ry}] (mm, ry radians about the vertical axis, rx about local X). */
export function instancedBoxes(items, material) {
  const im = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), material, items.length);
  const mtx = new THREE.Matrix4(), pos = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3(), e = new THREE.Euler();
  items.forEach((it, i) => {
    pos.set(M(it.cx), M(it.cz), M(it.cy)); s.set(M(it.sx), M(it.sz), M(it.sy));
    e.set(it.rx || 0, it.ry || 0, it.rz || 0); q.setFromEuler(e);
    mtx.compose(pos, q, s); im.setMatrixAt(i, mtx);
  });
  im.castShadow = im.receiveShadow = true;
  return im;
}
