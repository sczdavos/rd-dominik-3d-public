// merge.js — draw-call reduction: collapses static meshes that share a material into one mesh each.
// Used per furniture item (a 136-mesh bookshelf → ~6 meshes) and for the static house / site
// (walls, floors, glazing, railings, fence, hedges …). Skipped: InstancedMesh (lamellas, posts),
// multi-material meshes (roof slabs), geometries with extra attributes (terrain vertex colours) and
// whatever the caller's `skip` marks as dynamic (door groups, furniture groups). Materials stay shared.
import * as THREE from 'three';

const mergeable = o => o.isMesh && !o.isInstancedMesh && !Array.isArray(o.material) && !o.material.map && !o.material.vertexColors && o.geometry?.isBufferGeometry
  && o.geometry.attributes.position && o.geometry.attributes.normal && !o.geometry.attributes.color && !o.geometry.morphAttributes?.position; // UVs are dropped → textured / vertex-coloured meshes stay as they are

/** One non-indexed BufferGeometry (position + normal) from `meshes`, in the frame of `inv` (inverse of the target's world matrix). */
export function mergedGeometry(meshes, inv) {
  const parts = []; let n = 0;
  const mtx = new THREE.Matrix4();
  for (const m of meshes) {
    const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
    mtx.multiplyMatrices(inv, m.matrixWorld); g.applyMatrix4(mtx);
    parts.push(g); n += g.attributes.position.count;
  }
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3); let o = 0;
  for (const g of parts) { pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3); o += g.attributes.position.count; g.dispose(); }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3)); out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  return out;
}

/**
 * Replace the mergeable meshes under `root` with one mesh per (bucket, material, castShadow), placed in
 * `root`'s local frame inside a group `merged:<bucket>`. `bucket(directChild)` partitions by root's direct
 * children (the viewer uses it for "above the ceiling"), `skip(obj)` excludes a subtree, `decorate(group, key)`
 * tags the created groups. Emptied groups are pruned. Returns { merged, meshes } counts.
 */
export function mergeInto(root, { skip = () => false, bucket = () => '', decorate = () => {} } = {}) {
  root.updateWorldMatrix(true, true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const lists = new Map(); let merged = 0;
  const walk = (o, bk) => {
    if (skip(o)) return;
    if (mergeable(o)) {
      const key = bk + '|' + o.material.uuid + '|' + (o.castShadow ? 1 : 0);
      let e = lists.get(key); if (!e) lists.set(key, e = { mat: o.material, cast: o.castShadow, bk, meshes: [] });
      e.meshes.push(o); return;
    }
    for (const c of [...o.children]) walk(c, bk);
  };
  for (const c of [...root.children]) walk(c, bucket(c));
  const groups = new Map();
  for (const e of lists.values()) {
    if (e.meshes.length < 2 && e.meshes[0]?.parent === root) continue; // nothing to gain
    const geom = mergedGeometry(e.meshes, inv);
    const m = new THREE.Mesh(geom, e.mat); m.castShadow = e.cast; m.receiveShadow = true; m.name = 'merged'; m.userData.merged = true;
    let g = groups.get(e.bk); if (!g) { g = new THREE.Group(); g.name = 'merged:' + e.bk; g.userData.merged = true; decorate(g, e.bk); root.add(g); groups.set(e.bk, g); }
    g.add(m);
    for (const src of e.meshes) { src.parent.remove(src); src.geometry.dispose(); merged++; }
  }
  const prune = o => { for (const c of [...o.children]) { if (skip(c) || c.userData.merged) continue; prune(c); if (c.isGroup && c.children.length === 0) o.remove(c); } };
  prune(root);
  let meshes = 0; root.traverse(o => { if (o.isMesh) meshes++; });
  return { merged, meshes };
}
