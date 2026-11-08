// doors.js — everything that opens with E: house doors (hinged leaves swing around their hinge per the JSON `swing`,
// sliding panels slide along the wall, the garage door lifts), the hidden two-leaf pantry door, the fridge (both
// doors at once) and the site gates (hinged pedestrian gates, the telescopic sliding driveway gate). An openable is
// any group with userData { kind: 'opening', type: 'door' | 'sliding' | 'garage', id, label? }; its moving parts are
// descendants named 'leaf' (pivot groups, userData { hingeSign, sideSign }) or 'panel' (userData { dir, slide } or
// { lift }). A closed door's collision blocker is 'door:<id>' (collision.js); an open one is passable. `scan()`
// re-collects the openables after the editor rebuilt a level's furniture (the fridge lives there) and keeps their state.
import * as THREE from 'three';

const TYPES = ['door', 'sliding', 'garage'];

export class Doors {
  constructor(house, colliders) {
    this.house = house; this.col = colliders;
    this.doors = []; this.meshes = []; this.byMesh = new Map();
    this.ray = new THREE.Raycaster(); this.ray.far = 2.6;
    this.scan();
  }
  /** (Re)collect every openable under the house root; open / closed states survive by id. */
  scan() {
    const prev = new Map(this.doors.map(d => [d.id, d]));
    this.doors = []; this.meshes = []; this.byMesh.clear();
    this.house.traverse(o => {
      const ud = o.userData;
      if (ud?.kind !== 'opening' || !TYPES.includes(ud.type)) return;
      const d = { group: o, id: ud.id, type: ud.type, label: ud.label || null, state: 0, target: 0, hingeSign: ud.hingeSign, sideSign: ud.sideSign,
        blocker: this.col.blockers.find(b => b.id === 'door:' + ud.id) || null, leaves: [], panels: [] };
      const old = prev.get(ud.id); if (old) { d.state = old.state; d.target = old.target; }
      o.traverse(c => {
        if (c.name === 'leaf') d.leaves.push(c);
        if (c.name === 'panel') d.panels.push({ obj: c, base: c.position.clone() });
        if (c.isMesh) { this.meshes.push(c); this.byMesh.set(c, d); }
      });
      d.leaf = d.leaves[0] || null; // compatibility (tools/cdp-touch.mjs)
      if (d.blocker) d.blocker.active = d.target === 0;
      this.doors.push(d); this.pose(d);
    });
  }
  /** Door under the crosshair of `camera` within reach, or null. */
  lookAt(camera) { return this.pickAt(camera, 0, 0); }
  /** Door under a screen point (NDC) within `reach` metres (a tap on a phone may be a bit farther away than the crosshair). */
  pickAt(camera, x, y, reach = 2.6) {
    this.ray.far = reach; this.ray.setFromCamera({ x, y }, camera);
    const hit = this.ray.intersectObjects(this.meshes, false)[0];
    return hit ? this.byMesh.get(hit.object) : null;
  }
  byId(id) { return this.doors.find(d => d.id === id) || null; }
  toggle(d) {
    d.target = d.target ? 0 : 1;
    if (d.blocker) d.blocker.active = d.target === 0;
  }
  setAll(open) { for (const d of this.doors) { d.target = open ? 1 : 0; if (d.blocker) d.blocker.active = !open; } }
  /** Place the moving parts for the door's current state (0 closed … 1 open). */
  pose(d) {
    const s = d.state, e = s < 0.5 ? 2 * s * s : 1 - Math.pow(-2 * s + 2, 2) / 2; // ease in-out
    for (const p of d.leaves) p.rotation.y = e * (p.userData.hingeSign ?? d.hingeSign ?? -1) * (p.userData.sideSign ?? d.sideSign ?? 1) * Math.PI / 2;
    for (const p of d.panels) {
      if (d.type === 'garage') p.obj.position.y = p.base.y + e * p.obj.userData.lift / 1000;
      else p.obj.position.x = p.base.x + e * p.obj.userData.dir * p.obj.userData.slide / 1000;
    }
  }
  update(dt) {
    for (const d of this.doors) {
      if (d.state === d.target) continue;
      const step = dt / 0.45; d.state = d.target > d.state ? Math.min(d.target, d.state + step) : Math.max(d.target, d.state - step);
      this.pose(d);
    }
  }
}
