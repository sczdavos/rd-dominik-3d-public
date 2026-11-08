// stairs.js — stair plan reconstructed from the stair fixture + stair room (pure, no three.js).
//
// Reading of the DSP linework (1 NP / 2 NP underlay): the flight starts at the notch off the living
// room (south-east corner of the stair room), turns through a winder fanning around the notch's inner
// corner, then runs straight west and arrives at the 2 NP corridor at the west end of the footprint.
// 18 risers of 3300/18 = 183,3 mm are kept (floor-to-floor is fixed); the going along the walking line
// is whatever the footprint allows — which is much less than the wanted 260 (see ASSUMPTIONS.md 3.x).
export const STAIR = { MAX_RISE: 200, RISE_TOTAL: 3050, WALK_LINE_R: 600, TREAD_T: 40, SOFFIT: 450, SOFFIT_GAP: 200, SOFFIT_T: 250 }; // riser count = fewest risers with rise ≤ MAX_RISE; SOFFIT: nose-to-underside depth (open below, collision); SOFFIT_GAP / _T: the drawn sloped soffit slab of a straight run (gap below the nose line, thickness)

/** Reflex (concave) vertex of a simple polygon, or null. Plan coordinates: y grows south. */
export function reflexVertex(poly) {
  const n = poly.length; let area = 0;
  for (let i = 0; i < n; i++) { const [x1, y1] = poly[i], [x2, y2] = poly[(i + 1) % n]; area += x1 * y2 - x2 * y1; }
  const ccw = area > 0; // orientation sign in this (y-down) frame
  for (let i = 0; i < n; i++) {
    const [ax, ay] = poly[(i + n - 1) % n], [bx, by] = poly[i], [cx, cy] = poly[(i + 1) % n];
    const cross = (bx - ax) * (cy - by) - (by - ay) * (cx - bx);
    if ((cross > 0) !== ccw) return poly[i];
  }
  return null;
}

/**
 * Build the stair plan. fixture = stair footprint rect, room = stair room polygon (with the entry notch).
 * fixture.stair (optional) = { risers, going, fans: [nBottom, nTop] } — the architect's explicit layout (DSP 15. 10. 2026:
 * 18 × 183,3 / 260, 4 + 9 + 4): a bottom winder fanning around the notch corner, `going` mm straight treads running west,
 * and a top winder at the west end turning south onto the upper floor (open below — it sits over the pantry).
 * Without it: the reconstructed single-winder flight whose top riser lands at the footprint's west end.
 * Returns { treads: [{poly, z, kind, open?}], blocks: [{rect, z0, z1}], top: {x, y, z}, exit, pivot, going, fanCount, ... }.
 * z = top of tread (absolute mm).
 */
export function stairPlan(fixture, room, opts = {}) {
  const [x0, y0, x1, y1] = fixture.rect;
  const S = fixture.stair || null;
  if (S && S.straight && S.dir === 'E' && S.turn === 'S') return straightTopFanES(fixture, S, opts);
  const riseTotal = opts.riseTotal || STAIR.RISE_TOTAL;
  const risers = opts.risers || S?.risers || Math.ceil(riseTotal / STAIR.MAX_RISE), rise = riseTotal / risers;
  const pivot = (room && reflexVertex(room.poly)) || [x1, y1]; // no notch → straight flight over the whole footprint
  const [px, py] = pivot;
  const treads = [];
  const R = Math.min(STAIR.WALK_LINE_R, (py - y0) * 0.55);
  const fanLen = (px < x1 && py > y0) ? R * Math.PI / 2 : 0;
  const twoFans = !!(fanLen && S?.fans?.length === 2 && S.going);
  let nf, ns, gs, nf2 = 0;
  if (twoFans) { nf = S.fans[0]; nf2 = S.fans[1]; ns = risers - 1 - nf - nf2; gs = S.going; }
  else {
    const going = (fanLen + (px - x0)) / (risers - 1);
    nf = fanLen ? Math.max(1, Math.round(fanLen / going)) : 0;
    ns = risers - 1 - nf; gs = (px - x0) / ns;
  }
  const going = (fanLen + ns * gs + (twoFans ? fanLen : 0)) / (risers - 1);
  // bottom winder: wedges around the notch corner, from the east-pointing ray (entry edge) to the north-pointing ray
  if (nf) {
    const thetaC = Math.atan2(py - y0, x1 - px);
    const hit = th => th >= Math.PI / 2 - 1e-9 ? [px, y0] : th <= thetaC ? [x1, py - (x1 - px) * Math.tan(th)] : [px + (py - y0) / Math.tan(th), y0];
    for (let j = 0; j < nf; j++) {
      const a = j * (Math.PI / 2) / nf, b = (j + 1) * (Math.PI / 2) / nf;
      const poly = [[px, py], hit(a)];
      if (a < thetaC && thetaC < b) poly.push([x1, y0]);
      poly.push(hit(b));
      treads.push({ poly, z: (j + 1) * rise, kind: 'fan' });
    }
  }
  const blocks = [];
  for (let i = 0; i < ns; i++) {
    const rect = [px - (i + 1) * gs, y0, px - i * gs, py];
    const z = (nf + i + 1) * rise;
    treads.push({ poly: [[rect[0], rect[1]], [rect[2], rect[1]], [rect[2], rect[3]], [rect[0], rect[3]]], z, kind: 'straight' });
    blocks.push({ rect, z0: Math.max(0, z - STAIR.SOFFIT), z1: z, soft: true }); // open underside: walkable where the headroom allows
  }
  const xe = px - ns * gs; // west end of the straight run
  // top winder: wedges around (xe, py) from the north-pointing ray to the west-pointing ray; the last wedge's west ray is
  // the exit edge — you step south off it onto the upper floor. Open below (over the pantry); no blocks: headroom > 2 m.
  if (twoFans) {
    const thC = Math.atan2(py - y0, x0 - xe); // direction of the footprint's north-west corner
    const hit = th => {
      if (th <= Math.PI / 2 + 1e-9) return [xe, y0];
      if (th >= Math.PI - 1e-9) return [x0, py];
      const x = xe + (py - y0) / Math.sin(th) * Math.cos(th);
      return x >= x0 ? [x, y0] : [x0, py - (xe - x0) / -Math.cos(th) * Math.sin(th)];
    };
    for (let j = 0; j < nf2; j++) {
      const a = Math.PI / 2 + j * (Math.PI / 2) / nf2, b = Math.PI / 2 + (j + 1) * (Math.PI / 2) / nf2;
      const poly = [[xe, py], hit(a)];
      if (a < thC && thC < b) poly.push([x0, y0]);
      poly.push(hit(b));
      treads.push({ poly, z: (nf + ns + j + 1) * rise, kind: 'fan', open: true });
    }
  }
  const top = risers * rise;
  // railings: the flight's open south edge gets a stepped glass railing over every straight tread that is more
  // than 400 below the upper floor; from there eastward the void edge on the upper floor gets a floor-level railing.
  // Single winder: the void railing starts right at the top riser (owner's wish). Two winders: it starts at the
  // east end of the exit edge (x = xe) so the top winder stays open to the corridor.
  const lowTreads = treads.filter(t => t.kind === 'straight');
  const railFromX = twoFans ? xe : x0;
  const strip = [railFromX, py, px, py + 50];
  const walled = (opts.walls || []).some(w => Math.min(w.rect[2], strip[2]) - Math.max(w.rect[0], strip[0]) > 0 && Math.min(w.rect[3], strip[3]) - Math.max(w.rect[1], strip[1]) > 0);
  return { treads, blocks, top: twoFans ? { x: (x0 + xe) / 2, y: py, z: top } : { x: x0, y: (y0 + py) / 2, z: top }, exit: twoFans ? 'S' : 'W',
    pivot, going, fanGoing: nf ? fanLen / nf : 0, straightGoing: gs, fanCount: nf, fanCount2: nf2, risers, rise, walled,
    railTreads: walled ? [] : lowTreads, railFromX,
    flightRail: walled ? null : [railFromX, py, px, py + 50], // blocker along the flight's open south edge (when no wall is there)
    voidRail: [railFromX, py, x1, py + 100] };                 // railing on the upper floor along the void's open south edge
}

/**
 * RD Vysoký Újezd (DSP D.1.1.2/3): a straight flight rising east (+x) with `S.straight` treads of `S.going`, then
 * `S.fans[1]` winders in the square at the east end of the footprint, turning south (+y); the top riser is the square's
 * south edge and you step off southwards onto the upper floor. fixture.rect = whole footprint incl. the square
 * (width = square side). Winder rays fan from the square's south-west corner (the inside of the turn) from north to east.
 */
export function straightTopFanES(fixture, S, opts = {}) {
  const [x0, y0, x1, y1] = fixture.rect, W = y1 - y0, xs = x1 - W;      // xs = start of the winder square
  const risers = S.risers, riseTotal = opts.riseTotal || STAIR.RISE_TOTAL, rise = riseTotal / risers;
  const ns = S.straight, gs = (xs - x0) / ns, nf2 = S.fans?.[1] || 0;
  const treads = [], blocks = [];
  for (let i = 0; i < ns; i++) {
    const rect = [x0 + i * gs, y0, x0 + (i + 1) * gs, y1], z = (i + 1) * rise;
    treads.push({ poly: [[rect[0], rect[1]], [rect[2], rect[1]], [rect[2], rect[3]], [rect[0], rect[3]]], z, kind: 'straight', riserX: rect[0] });
    blocks.push({ rect, z0: Math.max(0, z - STAIR.SOFFIT), z1: z, soft: true });
  }
  const P = [xs, y1]; // pivot = inside corner of the turn
  const hit = th => { const c = Math.cos(th), sn = Math.sin(th); // ray from P at angle th (0 = east, 90° = north), plan y down
    if (sn * W >= c * W && sn > 1e-9 && W / sn * c <= W + 1e-6) return [xs + W / sn * c, y0];
    return [x1, y1 - W * sn / c]; };
  for (let j = 0; j < nf2; j++) {
    const a = Math.PI / 2 - j * (Math.PI / 2) / nf2, b = Math.PI / 2 - (j + 1) * (Math.PI / 2) / nf2;
    const pa = hit(a), pb = hit(b), poly = [P, pa];
    if (pa[1] === y0 && pb[0] === x1 && pb[1] > y0) poly.push([x1, y0]); // wedge containing the north-east corner
    poly.push(pb);
    treads.push({ poly, z: (ns + j + 1) * rise, kind: 'fan', open: true });
  }
  const top = { x: (xs + x1) / 2, y: y1, z: riseTotal };
  const strip = [x0, y1, xs, y1 + 50];
  const walled = (opts.walls || []).some(w => Math.min(w.rect[2], strip[2]) - Math.max(w.rect[0], strip[0]) > 0 && Math.min(w.rect[3], strip[3]) - Math.max(w.rect[1], strip[1]) > 0);
  const voidX0 = opts.voidX0 ?? x0;
  // open stretches of the flight's south edge (no wall standing along it, e.g. RD Vysoký Újezd x 10 510–11 810 over store
  // 1.05: the DSP 1 NP plan has only a thin line there = a partition above the cut plane): a 100 partition on the outer side
  // from the stair's soffit underside up to the ceiling; the space under the flight stays open (under-stair storage)
  const covered = (opts.walls || []).filter(w => w.rect[1] < strip[3] && w.rect[3] > strip[1] && w.rect[0] < xs && w.rect[2] > x0).map(w => [Math.max(w.rect[0], x0), Math.min(w.rect[2], xs)]).sort((a, b) => a[0] - b[0]);
  const gaps = []; let c = x0;
  for (const [a, b] of covered) { if (a > c) gaps.push([c, a]); c = Math.max(c, b); }
  if (c < xs) gaps.push([c, xs]);
  const k = ns * rise / (xs - x0), under = x => (x - x0) * k - STAIR.SOFFIT_GAP - STAIR.SOFFIT_T * Math.hypot(1, k); // soffit underside (as stairMesh draws it)
  const ceilZ = opts.ceilZ ?? riseTotal - 450;
  const sideWalls = walled ? gaps.filter(([a, b]) => b - a >= 200).map(([a, b]) => ({ rect: [a, y1, b, y1 + 100], zb0: under(a), zb1: under(b), zt: ceilZ })) : [];
  return { treads, blocks, top, exit: 'S', pivot: P, going: gs, straightGoing: gs, fanCount: 0, fanCount2: nf2, risers, rise, walled,
    railTreads: [], railFromX: voidX0, flightRail: null, sideWalls,
    voidRail: [voidX0, y1, xs, y1 + 100], layout: 'straight+fanES' };
}
