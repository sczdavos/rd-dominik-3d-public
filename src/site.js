// site.js — terrain mesh (holes under the building), street, paved areas and the terrace deck, the street hedge
// with the wicket and the sliding driveway gate, mesh fences, street trees, bins and the electricity pillar — all
// from model.site (pipeline s05, C.3), draped on terrain.js' ground model.
import * as THREE from 'three';
import { M, box, boxFromRect } from './prims.js';
import { mergeInto } from './merge.js';
import { mats } from './materials.js';
import { SITE, pointInPoly, splitGaps, streetLines } from './terrain.js';

const SM = {
  grass: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }),
  asphalt: new THREE.MeshStandardMaterial({ color: 0x5c5f63, roughness: 0.95, side: THREE.DoubleSide }),
  curb: new THREE.MeshStandardMaterial({ color: 0xa9abae, roughness: 0.9 }),
  pavers: new THREE.MeshStandardMaterial({ color: 0xc4c1ba, roughness: 0.9, side: THREE.DoubleSide }),
  gravel: new THREE.MeshStandardMaterial({ color: 0xb8b4aa, roughness: 1 }),
  post: mats.frame,
  gate: new THREE.MeshStandardMaterial({ color: 0x3a3d41, roughness: 0.6, metalness: 0.3 }),
  hedge: new THREE.MeshStandardMaterial({ color: 0x4f7a3a, roughness: 1 }),
  trunk: new THREE.MeshStandardMaterial({ color: 0x6b4f35, roughness: 0.95 }),
  crown: new THREE.MeshStandardMaterial({ color: 0x5f8f47, roughness: 1, flatShading: true }),
  crown2: new THREE.MeshStandardMaterial({ color: 0x6f9a50, roughness: 1, flatShading: true }),
  meshPost: new THREE.MeshStandardMaterial({ color: 0x6b746a, roughness: 0.7, metalness: 0.3 }), // removable mesh fence of the back strip: green-grey steel posts
  mesh: mats.mesh,
  grassPavers: new THREE.MeshStandardMaterial({ color: 0x9aa58a, roughness: 1, side: THREE.DoubleSide }),                  // zatravňovací dlažba (parking)
  deck: new THREE.MeshStandardMaterial({ color: 0x9b7653, roughness: 0.85, side: THREE.DoubleSide }),                      // wooden terrace deck
  sidewalk: new THREE.MeshStandardMaterial({ color: 0xb3b1ab, roughness: 0.95 }),
  bin: new THREE.MeshStandardMaterial({ color: 0x3d4a3f, roughness: 0.7 }),
  binLid: new THREE.MeshStandardMaterial({ color: 0x2c2f33, roughness: 0.7 }),
  pillar: new THREE.MeshStandardMaterial({ color: 0xc9c6bd, roughness: 0.9 }),
  manhole: new THREE.MeshStandardMaterial({ color: 0x55585c, roughness: 0.6, metalness: 0.4 }),
};
const C_LAWN = new THREE.Color(0x7f9f5e), C_OUT = new THREE.Color(0x8fa07a), C_VERGE = new THREE.Color(0x8aa066);

/** Terrain grid with the building footprint (rects) removed; vertex colours: lawn inside the plot, verge in the street. */
function terrainMesh(G, footprint, plot) {
  const [X0, Y0, X1, Y1] = SITE.EXTENT, step = SITE.GRID;
  const xs = new Set(), ys = new Set();
  for (let x = X0; x <= X1; x += step) xs.add(x); for (let y = Y0; y <= Y1; y += step) ys.add(y);
  for (const r of footprint) { xs.add(r[0]); xs.add(r[2]); ys.add(r[1]); ys.add(r[3]); }
  const XS = [...xs].sort((a, b) => a - b), YS = [...ys].sort((a, b) => a - b);
  const idx = new Map(), pos = [], col = [], tri = [];
  const vid = (i, j) => { const k = i * 100000 + j; if (idx.has(k)) return idx.get(k);
    const x = XS[i], y = YS[j], z = G.ground(x, y) - (G.paved(x, y) != null ? 30 : 0); const id = pos.length / 3; pos.push(M(x), M(z), M(y));
    const c = pointInPoly(x, y, plot) ? C_LAWN : C_VERGE; col.push(c.r, c.g, c.b); idx.set(k, id); return id; };
  for (let i = 0; i < XS.length - 1; i++) for (let j = 0; j < YS.length - 1; j++) {
    const cx = (XS[i] + XS[i + 1]) / 2, cy = (YS[j] + YS[j + 1]) / 2;
    if (footprint.some(r => cx > r[0] && cx < r[2] && cy > r[1] && cy < r[3])) continue;
    const a = vid(i, j), b = vid(i + 1, j), c = vid(i + 1, j + 1), d = vid(i, j + 1);
    tri.push(a, c, b, a, d, c); // wound so the normal points up (+Y) in the right-handed frame
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setIndex(tri); g.computeVertexNormals();
  const m = new THREE.Mesh(g, SM.grass); m.receiveShadow = true; m.name = 'terrain'; return m;
}

/** Polygon surface (plan points) triangulated and lifted to `zFn(x, y)` (+ lift); the paved areas are planar ramps, so
 *  vertex heights are exact; long edges are subdivided so the surface follows the ground where it is not planar. */
function drapedPoly(poly, zFn, lift, material, maxEdge = 1e9) {
  const pts = [];
  for (let i = 0; i < poly.length; i++) { const a = poly[i], b = poly[(i + 1) % poly.length], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / maxEdge));
    for (let k = 0; k < n; k++) pts.push([a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n]); }
  const tris = THREE.ShapeUtils.triangulateShape(pts.map(p => new THREE.Vector2(p[0], p[1])), []);
  const pos = []; for (const [x, y] of pts) pos.push(M(x), M(zFn(x, y) + lift), M(y));
  const idx = []; for (const [a, b, c] of tris) idx.push(a, c, b);
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  if (g.attributes.normal.getY(0) < 0) { const ix = g.index.array; for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; } g.computeVertexNormals(); }
  const m = new THREE.Mesh(g, material); m.receiveShadow = true; return m;
}

/** Ribbon of width w centred on a polyline, draped on the ground (+ lift). */
function ribbon(G, line, w, lift, material, step = 1000) {
  const P = []; // resample
  for (let i = 0; i < line.length - 1; i++) { const a = line[i], b = line[i + 1], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
    for (let k = 0; k < n; k++) P.push([a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n]); }
  P.push(line[line.length - 1]);
  const pos = [], idx = [];
  P.forEach((p, i) => { const q = P[Math.min(i + 1, P.length - 1)], o = P[Math.max(i - 1, 0)], dx = q[0] - o[0], dy = q[1] - o[1], L = Math.hypot(dx, dy) || 1, nx = -dy / L, ny = dx / L;
    for (const s of [-1, 1]) { const x = p[0] + s * nx * w / 2, y = p[1] + s * ny * w / 2; pos.push(M(x), M(G.surface(x, y) + lift), M(y)); } });
  for (let i = 0; i < P.length - 1; i++) { const a = 2 * i, b = a + 1, c = a + 2, d = a + 3; idx.push(a, c, b, b, c, d); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  if (g.attributes.normal.getY(0) < 0) { const ix = g.index.array; for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; } g.computeVertexNormals(); }
  const m = new THREE.Mesh(g, material); m.receiveShadow = true; return m;
}

/** Surface draped on the ground over a rect, `lift` mm above, subdivided every `step` mm. */
function draped(G, rect, lift, material, step = 500, zFn = null) {
  const [x0, y0, x1, y1] = rect, nx = Math.max(1, Math.ceil((x1 - x0) / step)), ny = Math.max(1, Math.ceil((y1 - y0) / step));
  const pos = [], tri = [];
  for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) { const x = x0 + (x1 - x0) * i / nx, y = y0 + (y1 - y0) * j / ny; pos.push(M(x), M((zFn ? zFn(x, y) : G.ground(x, y)) + lift), M(y)); }
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1; tri.push(a, d, b, a, c, d); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(tri); g.computeVertexNormals();
  const m = new THREE.Mesh(g, material); m.receiveShadow = true; return m;
}

/**
 * Fence between two plan points, following the ground. Default: anthracite posts every 2,5 m with three rails
 * (FENCE_H). `style: 'mesh'`: the removable fence of the back strip — thin round posts every 2 m, wire mesh and a
 * top wire (MESH_H). `gaps` = ranges along the fence axis (x for E–W runs, y for N–S runs) left open for gates; every
 * remaining piece gets its own end posts.
 */
function fence(G, group, a, b, opts = {}) {
  const mesh = opts.style === 'mesh', h = mesh ? SITE.MESH_H : SITE.GATE_H, pitch = mesh ? 2500 : 2500;
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]), ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
  const horiz = Math.abs(b[0] - a[0]) >= Math.abs(b[1] - a[1]), lo = horiz ? a[0] : a[1], hi = horiz ? b[0] : b[1];
  const tg = (opts.gaps || []).map(([g0, g1]) => [(g0 - lo) / (hi - lo), (g1 - lo) / (hi - lo)].sort((u, v) => u - v));
  const pt = t => { const x = a[0] + (b[0] - a[0]) * t, y = a[1] + (b[1] - a[1]) * t; return [x, y, G.ground(x, y)]; };
  for (const [t0, t1] of splitGaps(0, 1, tg)) {
    const n = Math.max(1, Math.round(len * (t1 - t0) / pitch));
    for (let i = 0; i <= n; i++) {
      const [x, y, z] = pt(t0 + (t1 - t0) * i / n);
      const p = mesh ? new THREE.Mesh(new THREE.CylinderGeometry(M(25), M(25), M(h), 8), SM.meshPost) : box(60, h, 60, 0, 0, 0, SM.post);
      p.position.set(M(x), M(z + h / 2), M(y)); p.castShadow = true; group.add(p);
      if (i === n) continue;
      const [x2, y2, z2] = pt(t0 + (t1 - t0) * (i + 1) / n);
      const segLen = Math.hypot(x2 - x, y2 - y, z2 - z), mx = (x + x2) / 2, my = (y + y2) / 2, mz = (z + z2) / 2, tilt = Math.atan2(z2 - z, Math.hypot(x2 - x, y2 - y));
      const bar = (sz, sy, rz, mat) => { const r = box(segLen, sz, sy, 0, 0, 0, mat); r.position.set(M(mx), M(mz + rz), M(my)); r.rotation.y = -ang; r.rotation.z = tilt; group.add(r); return r; };
      if (mesh) { bar(h - 140, 4, h / 2 - 20, SM.mesh).castShadow = false; bar(8, 8, h - 40, SM.meshPost); }
      else for (const rz of [300, 800, h - 60]) bar(40, 20, rz, SM.post);
    }
  }
}

/**
 * Hinged gate between the posts a (hinge end) and b, closed; E swings it toward the a→b direction turned clockwise on
 * the plan (inward for every gate of terrain.js fenceLayout). Slatted anthracite like the fence, or a mesh leaf (`mesh`).
 * The group carries userData.kind 'opening' so doors.js picks it up; the leaf pivot is named 'leaf'.
 */
function hingedGate(G, group, gt) {
  const { a, b, id, label, mesh } = gt, POST = mesh ? 60 : 120, h = mesh ? SITE.MESH_H : SITE.GATE_H, ph = mesh ? SITE.MESH_H + 100 : SITE.GATE_H + 100;
  const ang = Math.atan2(b[1] - a[1], b[0] - a[0]), len = Math.hypot(b[0] - a[0], b[1] - a[1]) - POST;
  for (const p of [a, b]) {
    const z = G.ground(p[0], p[1]), post = mesh ? new THREE.Mesh(new THREE.CylinderGeometry(M(POST / 2), M(POST / 2), M(ph), 10), SM.meshPost) : box(POST, ph, POST, 0, 0, 0, SM.post);
    post.position.set(M(p[0]), M(z + ph / 2), M(p[1])); post.castShadow = true; group.add(post);
  }
  const z = G.ground((a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
  const g = new THREE.Group(); g.name = 'gate:' + id; g.userData = { kind: 'opening', id, type: 'door', label, hingeSign: -1, sideSign: 1 };
  g.position.set(M(a[0] + Math.cos(ang) * POST / 2), M(z), M(a[1] + Math.sin(ang) * POST / 2)); g.rotation.y = -ang;
  const piv = new THREE.Group(); piv.name = 'leaf'; piv.userData = { hingeSign: -1, sideSign: 1, dynamic: true };
  const lw = len - 40, cx = 20 + lw / 2, z0 = 100, zh = h - 100, mat = mesh ? SM.meshPost : SM.gate;
  for (const zz of [z0 + 20, h - 20]) piv.add(box(lw, 40, 40, cx, zz, 0, mat));                  // top / bottom rail
  for (const xx of [40, len - 40]) piv.add(box(40, zh, 40, xx, z0 + zh / 2, 0, mat));              // stiles
  if (mesh) { const m = box(lw - 80, zh - 80, 4, cx, z0 + zh / 2, 0, SM.mesh); m.castShadow = false; piv.add(m); }
  else { const n = Math.max(2, Math.round(lw / 100)); for (let i = 1; i < n; i++) piv.add(box(20, zh - 80, 44, 20 + lw * i / n, z0 + zh / 2, 0, SM.post)); }
  piv.add(box(24, 120, 30, len - 110, Math.min(1000, h - 200), 34, SM.post));                     // handle on the inner face near the latch stile
  mergeInto(piv);                                                                                  // one mesh per material inside the leaf (it moves as a whole)
  g.add(piv); group.add(g);
}

/** Sliding driveway gate along the line a–b (closed); one slatted leaf that slides along the line towards `park` (open
 *  position behind the hedge). The group is rotated to the line, the leaf ('panel') moves along its local x. */
function slidingGate(G, group, gt) {
  const [a, b] = gt.line, ang = Math.atan2(b[1] - a[1], b[0] - a[0]), w = Math.hypot(b[0] - a[0], b[1] - a[1]), h = SITE.GATE_H, POST = 120;
  for (const p of [a, b]) { const z = G.ground(p[0], p[1]); const q = box(POST, h + 100, POST, 0, 0, 0, SM.post); q.position.set(M(p[0]), M(z + (h + 100) / 2), M(p[1])); q.castShadow = true; group.add(q); }
  const z = Math.max(G.ground(a[0], a[1]), G.ground(b[0], b[1]));
  const g = new THREE.Group(); g.name = 'gate:' + gt.id; g.userData = { kind: 'opening', id: gt.id, type: 'sliding', label: 'bránu' };
  g.position.set(M(a[0]), M(z), M(a[1])); g.rotation.y = -ang;
  const p = new THREE.Group(); p.name = 'panel'; p.userData = { dir: 1, slide: w - 100, dynamic: true }; p.position.set(M(w / 2), 0, M(-80));
  const pw = w - 160;
  for (const zz of [100, h - 40]) p.add(box(pw, 50, 50, 0, zz, 0, SM.gate));
  for (const xx of [-pw / 2 + 25, pw / 2 - 25]) p.add(box(50, h - 120, 50, xx, (h - 20) / 2 + 30, 0, SM.gate));
  const n = Math.round(pw / 110); for (let k = 1; k < n; k++) p.add(box(25, h - 200, 54, -pw / 2 + pw * k / n, (h - 20) / 2 + 30, 0, SM.post));
  mergeInto(p); g.add(p); group.add(g);
}

function tree(G, x, y, size, opts = {}) {
  const g = new THREE.Group(); g.name = 'tree'; const z = opts.z ?? G.ground(x, y);
  const th = 2200 * size, tr = 110 * size;
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(M(tr * 0.8), M(tr), M(th), 8), SM.trunk); trunk.position.set(M(x), M(z + th / 2), M(y)); trunk.castShadow = true; g.add(trunk);
  const crowns = opts.small ? [[0, 0, 1200, 2000]] : [[0, 0, 1800 * size, th + 900 * size], [700 * size, 300 * size, 1300 * size, th + 1500 * size], [-600 * size, -500 * size, 1200 * size, th + 1300 * size]];
  crowns.forEach(([dx, dy, r, cz], i) => { const c = new THREE.Mesh(new THREE.IcosahedronGeometry(M(r), 1), i % 2 ? SM.crown2 : SM.crown); c.position.set(M(x + dx), M(z + cz), M(y + dy)); c.castShadow = true; g.add(c); });
  return g;
}

/** Hedge along a polyline: 2 m boxes centred `off` mm to the left of the travel direction, following the ground. */
function hedge(G, group, line, off) {
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i], b = line[i + 1], len = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.ceil(len / 2000)), ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
    const nx = Math.sin(ang), ny = -Math.cos(ang); // left normal in plan (y down)
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n, x = a[0] + (b[0] - a[0]) * t + nx * off, y = a[1] + (b[1] - a[1]) * t + ny * off, z = G.ground(x, y);
      const h = box(len / n + 60, SITE.HEDGE_H, SITE.HEDGE_W, 0, 0, 0, SM.hedge); h.position.set(M(x), M(z + SITE.HEDGE_H / 2 - 50), M(y)); h.rotation.y = -ang;
      h.castShadow = h.receiveShadow = true; group.add(h);
    }
  }
}

/** Build the whole site from model.site. footprint = rects (mm) of the building at ground level. */
export function buildSite(model, G, footprint) {
  const S = model.site, root = new THREE.Group(); root.name = 'site';
  const ground = new THREE.Group(); ground.name = 'ground'; root.add(ground);
  const veg = new THREE.Group(); veg.name = 'veg'; root.add(veg);
  const plot = S.survey.plot_polygon_mm;
  ground.add(terrainMesh(G, footprint, plot));
  // street: asphalt centred on the axis (assumption), the rest of the street parcel stays verge (surveyed ground)
  const st = S.street || {};
  if (st.axis) ground.add(ribbon(G, streetLines(st).axis, st.carriageway_w || SITE.ROAD_W, 25, SM.asphalt, 500)); // A7 axis + the C.3 continuation east (SITE.STREET_EAST)
  // gravel strips (SITE.GRAVEL): on the finished ground, just above the lawn
  for (const [x0, y0, x1, y1] of SITE.GRAVEL || []) { const m = drapedPoly([[x0, y0], [x1, y0], [x1, y1], [x0, y1]], (x, y) => G.ground(x, y), 12, SM.gravel, 500); m.name = 'gravel'; ground.add(m); }
  // paved areas + terrace deck
  const mat = { dlazba: SM.pavers, zatravnovaci: SM.grassPavers, sjezd: SM.pavers, terasa: SM.deck };
  for (const p of S.paving || []) {
    const m = drapedPoly(p.poly, (x, y) => G.level(p.id, x, y), p.kind === 'terasa' ? 0 : 15, mat[p.kind] || SM.pavers); m.name = 'paving:' + p.id; ground.add(m);
    if (p.kind === 'terasa') { // deck edge: a 200 fascia down to the finished ground
      for (let i = 0; i < p.poly.length; i++) { const a = p.poly[i], b = p.poly[(i + 1) % p.poly.length], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2; if (footprint.some(r => mx >= r[0] - 5 && mx <= r[2] + 5 && my >= r[1] - 5 && my <= r[3] + 5)) continue;
        const f = box(len, 200, 40, 0, 0, 0, SM.deck); f.position.set(M(mx), M((p.z_rel ?? -50) - 100), M(my)); f.rotation.y = -Math.atan2(b[1] - a[1], b[0] - a[0]); ground.add(f); }
    }
  }
  // street hedge (300 strip between the inner line and the boundary: the boundary lies to the left of the drawn direction)
  for (const h of S.hedges || []) hedge(G, veg, h.line, SITE.HEDGE_W / 2 + 10);
  // mesh fences + gates
  const fg = new THREE.Group(); fg.name = 'fence'; ground.add(fg);
  for (const f of S.fences || []) fence(G, fg, f.line[0], f.line[f.line.length - 1], { style: 'mesh' });
  for (const g of S.gates || []) {
    if (g.kind === 'sliding') slidingGate(G, fg, g);
    else hingedGate(G, fg, { id: g.id, a: g.line[0], b: g.line[1], label: 'branku' });
  }
  // street trees, bins, pillar, tank cover
  for (const t of st.trees || []) veg.add(tree(G, t.x, t.y, 1.1));
  for (const o of S.objects || []) {
    if (o.kind === 'bin') { const [x0, y0, x1, y1] = o.rect, z = G.ground((x0 + x1) / 2, (y0 + y1) / 2); const b = boxFromRect([x0 + 20, y0 + 20, x1 - 20, y1 - 20], z, z + o.h - 60, SM.bin); ground.add(b);
      ground.add(boxFromRect([x0, y0, x1, y1], z + o.h - 60, z + o.h, SM.binLid)); }
    else if (o.kind === 'pillar') { const [x0, y0, x1, y1] = o.rect, z = G.ground((x0 + x1) / 2, (y0 + y1) / 2); ground.add(boxFromRect(o.rect, z, z + o.h, SM.pillar)); }
    else if (o.kind === 'tank') { const [x, y] = o.circle, z = G.ground(x, y); const c = new THREE.Mesh(new THREE.CylinderGeometry(M(325), M(325), M(40), 24), SM.manhole); c.position.set(M(x), M(z + 10), M(y)); ground.add(c); }
  }
  return { root, ground, veg };
}
