// main.js — viewer entry: scene, camera, lights, UI, URL-driven views for screenshots.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/OrbitControls.js';
import { loadModel, effective, hash } from './loader.js';
import { buildHouse } from './geometry.js';
import { FirstPerson } from './controls.js';
import { Minimap } from './minimap.js';
import { Doors } from './doors.js';
import { Editor } from './editor.js';
import { TouchControls, detectTouch } from './touch.js';
import { mergeInto, mergedGeometry } from './merge.js';
import { Lighting } from './lighting.js';
import { dayOfYear } from './sun.js';
import { mats } from './materials.js';
import { WALK } from './collision.js';
import { SITE } from './terrain.js';

const q = new URLSearchParams(location.search);
if (['finished', 'surveyed'].includes(q.get('street'))) SITE.STREET = q.get('street'); // ?street=surveyed: the street area as measured (B4.2)
// mobile / touch: no shadows, no preserved drawing buffer, joystick + drag-look (touch.js); `?touch=1|0`, `?shadows=1|0`, `?dpr=`, `?merge=0`
const TOUCH = detectTouch(q);
const SHADOWS = q.get('shadows') ? q.get('shadows') === '1' : !TOUCH;
const MERGE = q.get('merge') !== '0' && !q.get('dump'); // ?dump=1 needs the per-object meshes
if (TOUCH) document.body.classList.add('touch');
if (q.get('fps')) document.body.classList.add('showfps'); // ?fps=1 → frame rate + draw calls overlay
const canvas = document.getElementById('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: !TOUCH, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, Number(q.get('dpr')) || 2));
renderer.shadowMap.enabled = SHADOWS;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();

const persp = new THREE.PerspectiveCamera(45, 1, 0.05, 500);
const ortho = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.05, 500);
let camera = persp;
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;

// light rig: sun on the site's sun path + sky dome + interior lamps at dusk (lighting.js); `?t=15.5&doy=172|today` presets the clock
const lighting = new Lighting(scene, { shadows: SHADOWS, maxPointLights: TOUCH ? 4 : 8 });
const sun = lighting.sun;
const todayDoy = (() => { const d = new Date(); return dayOfYear(d.getMonth() + 1, d.getDate(), d.getFullYear()); })();
lighting.set(Number(q.get('t')) || 15, q.get('doy') === 'today' ? todayDoy : (Number(q.get('doy')) || 172));

const msg = document.getElementById('msg');
let house = null, groups = {}, fp = null, minimap = null, doors = null, doorInView = null, mode = 'orbit', editor = null, touch = null;
const walkCam = new THREE.PerspectiveCamera(68, 1, 0.05, 300);
export const app = { scene, renderer, controls, lighting, get camera() { return camera; }, setLevel, setView, setMode, model: null, ready: false, get player() { return fp; }, doors: null, touch: TOUCH, shadows: SHADOWS, merged: MERGE };
window.app = app;

// spawn: in front of the entrance door, facing in (south); teleport targets per level
const SPAWN = { x: 5150, y: -2600, feet: 0, yaw: 180 };   // on the entrance path in front of the canopy, facing the door (model south = into the house)
const TELEPORT = { np1: { x: 6000, y: 1500, feet: 0, yaw: 90 }, np2: { x: 12460, y: 2300, feet: 3050, yaw: 180 } }; // 1 = hall 1.01 facing the stair, 2 = 2 NP hall at the top of the stair

function setMode(m) {
  mode = m;
  const walk = m === 'walk';
  controls.enabled = !walk;
  if (walk) { useCamera(walkCam); fp.enable(); document.getElementById('walkhint').classList.add('show'); }
  else { fp?.disable(); document.getElementById('walkhint').classList.remove('show'); }
  document.getElementById('mm').style.display = walk && minimap?.visible ? 'block' : 'none';
  document.querySelectorAll('[data-mode]').forEach(b => b.classList.toggle('on', b.dataset.mode === m));
  document.getElementById('tb-mode').textContent = walk ? 'Orbit' : 'Procházet';
  document.body.classList.toggle('walking', walk);
  app.mode = m;
  editor?.onModeChange();
}

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h); // also sets the canvas CSS size — with updateStyle=false a Retina canvas was 2× the viewport and only its top-left quarter was visible
  persp.aspect = w / h; persp.updateProjectionMatrix();
  walkCam.aspect = w / h; walkCam.updateProjectionMatrix();
  const half = orthoHalf; ortho.left = -half * w / h; ortho.right = half * w / h; ortho.top = half; ortho.bottom = -half; ortho.updateProjectionMatrix();
}
let orthoHalf = 9;
addEventListener('resize', resize);

function setLevel(which) {
  // 'np1' | 'np2' | 'all' — hides upper structure so plan-like views show the level
  const vis = { np1: true, slab: true, np2: true, roof: true, ground: true, ceil_np1: which !== 'np1', ceil_np2: which === 'all' };
  if (which === 'np1') { vis.slab = vis.np2 = vis.roof = false; }
  if (which === 'np2') { vis.roof = false; }
  for (const k in vis) if (groups[k]) groups[k].visible = vis[k];
  // per-level view: also hide things that sit above that level's ceiling (pergola roof over the terrace)
  for (const lk of ['np1', 'np2']) {
    const L = app.model?.levels[lk]; if (!groups[lk] || !L) continue;
    const ceil = ((L.z_floor ?? 0) + (L.height || 2900)) / 1000;
    for (const o of groups[lk].children) {
      o.visible = which === 'all' || which !== lk || !isAbove(o, ceil);
      if (o.userData.furnitureDisplay && editor?.active) o.visible = false;   // merged furniture copy: shown only outside the editor (setFurnitureDisplay)
    }
  }
  document.querySelectorAll('[data-level]').forEach(b => b.classList.toggle('on', b.dataset.level === which));
  app.level = which;
}
/** Does a direct child of a level group sit above that level's ceiling (pergola roof over the terrace …)? Merged groups carry the flag. */
function isAbove(o, ceil) {
  if (o.userData?.above != null) return o.userData.above;
  const z0 = o.userData?.data?.z0; if (z0 != null) return z0 / 1000 >= ceil - 0.05;
  const bb = new THREE.Box3().setFromObject(o); return bb.min.y >= ceil - 0.05;
}
/** Draw-call pass: static meshes merged per material (door leaves / panels, furniture items, instanced lamellas and the terrain stay as they are). */
function mergeStatic() {
  const dynamic = o => o.name === 'furniture' || o.name === 'fixture:kitchen' || o.name === 'fixture:builtins' || o.isInstancedMesh
    || o.name === 'leaf' || o.name === 'panel' || !!o.userData?.dynamic; // moving door / gate parts; jambs, tracks and gate posts are static and merge
  const stats = {};
  for (const lk of ['np1', 'np2']) {
    const L = app.model.levels[lk]; if (!groups[lk] || !L) continue;
    const ceil = ((L.z_floor ?? 0) + (L.height || 2900)) / 1000;
    stats[lk] = mergeInto(groups[lk], { skip: dynamic, bucket: o => isAbove(o, ceil) ? 'above' : 'below', decorate: (g, bk) => { g.userData.above = bk === 'above'; } });
  }
  for (const k of ['slab', 'roof', 'ceil_np1', 'ceil_np2']) if (groups[k]) stats[k] = mergeInto(groups[k]);
  if (groups.ground) stats.ground = mergeInto(groups.ground, { skip: o => o === groups.veg || dynamic(o) }); // gates stay separate
  if (groups.veg) stats.veg = mergeInto(groups.veg);
  return stats;
}
/**
 * Furniture display: outside the editor every level's furniture is drawn as one merged mesh per material
 * (`furniture:merged`, world frame) and the static parts of the per-item groups are hidden; the editor shows the items
 * (it selects, highlights and rebuilds them) and the copy is rebuilt when editing ends. Moving parts (the fridge doors,
 * userData.dynamic) are never merged and stay visible either way. No-op with ?merge=0.
 */
function setFurnitureDisplay(editing) {
  if (!MERGE) return;
  for (const lk of ['np1', 'np2']) {
    const g = groups[lk]; if (!g) continue;
    const items = g.children.find(c => c.name === 'furniture'); if (!items) continue;
    let copy = g.children.find(c => c.name === 'furniture:merged');
    if (!editing) {
      if (copy) { g.remove(copy); copy.traverse(o => o.geometry?.dispose()); }
      copy = new THREE.Group(); copy.name = 'furniture:merged'; copy.userData = { furnitureDisplay: true, above: false };
      items.updateWorldMatrix(true, true);
      const lists = new Map();
      const walk = o => { if (o.userData?.dynamic) return; if (o.isMesh) { const k = o.material.uuid + (o.castShadow ? '1' : '0'); if (!lists.has(k)) lists.set(k, []); lists.get(k).push(o); } for (const c of o.children) walk(c); };
      walk(items);
      for (const arr of lists.values()) { const m = new THREE.Mesh(mergedGeometry(arr, new THREE.Matrix4()), arr[0].material); m.castShadow = arr[0].castShadow; m.receiveShadow = true; copy.add(m); }
      g.add(copy);
    }
    items.visible = true; for (const it of items.children) for (const c of it.children) c.visible = editing || !!c.userData?.dynamic;
    if (copy) copy.visible = !editing;
  }
}


function useCamera(c) {
  if (camera === c) return;
  camera = c; controls.object = c; controls.update();
}

function setView(name) {
  if (mode === 'walk') setMode('orbit');
  const center = new THREE.Vector3(10.6, 1.5, 3.6); // house bbox x 0–21,18, y −1,7–8,92
  lighting.override = name === 'top' ? 'flat' : name.startsWith('elev') ? 'front' : null; // plan view: no shadows; elevations: front-lit
  if (name === 'top') {
    useCamera(ortho); orthoHalf = 8; ortho.near = 0.1; resize();
    camera.position.set(center.x, 60, center.z + 0.001); camera.up.set(0, 0, -1); // north up on screen
    controls.target.copy(new THREE.Vector3(center.x, 0, center.z));
  } else if (name.startsWith('elev')) { // orthographic elevations: N (from the street), S, E, W
    useCamera(ortho); orthoHalf = 7.5; ortho.near = 60 - 9.5; resize(); camera.up.set(0, 1, 0); // clip everything more than 9,5 m in front of the house centre (fences, gates, street) — like a drawn elevation
    const f = name[4], c = new THREE.Vector3(10.6, 3.2, 3.6), D = 60;
    if (f === 'N') camera.position.set(c.x, c.y, c.z - D);
    if (f === 'S') camera.position.set(c.x, c.y, c.z + D);
    if (f === 'E') camera.position.set(c.x + D, c.y, c.z);
    if (f === 'W') camera.position.set(c.x - D, c.y, c.z);
    controls.target.copy(c);
    sun.position.copy(camera.position).multiplyScalar(0.5).add(new THREE.Vector3(0, 25, 0)); // front-lit elevation
  } else {
    useCamera(persp); camera.up.set(0, 1, 0);
    // model frame = DSP sheets: model north (−Z) = real west = the street, +Z = real east = the garden, +X = real north
    controls.target.copy(center);
    if (name === 'garden') camera.position.set(-5, 9, 25);       // from the garden (real east), seen from its real-south end
    if (name === 'site') { camera.position.set(-18, 34, 36); controls.target.set(10, 0, 3); }
    if (name === 'street') { camera.position.set(9, 19, -21); controls.target.set(10.6, 1.2, 2.5); } // from above the street (real west), high enough to look over the street trees
    if (name === 'west') camera.position.set(-22, 8, 6);         // from the real south (model west)
    if (name === 'terrace') { camera.position.set(6.2, 1.65, 9.6); controls.target.set(6.2, 1.5, 6); }
    if (name === 'entrance') { camera.position.set(5.3, 1.65, -6.5); controls.target.set(5.5, 1.5, 0); }
    if (name === 'garage') { camera.position.set(18, 1.65, -6.8); controls.target.set(18, 1.5, 2); }
  }
  controls.update(); lighting.update();
  document.querySelectorAll('[data-view]').forEach(b => b.classList.toggle('on', b.dataset.view === name));
  app.view = name;
}

// time of day: season select + clock slider (bar "Slunce"); readout with elevation / azimuth / sunrise / sunset
const DIRS = ['S', 'SV', 'V', 'JV', 'J', 'JZ', 'Z', 'SZ'];
const hhmm = h => `${Math.floor(h)}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`;
function sunUI() {
  const st = lighting.state, dir = DIRS[Math.round(st.azimuth / 45) % 8];
  document.getElementById('sunout').textContent = `${hhmm(st.hours)} · ` + (st.elevation > 0 ? `slunce ${st.elevation.toFixed(0)}° nad obzorem, ${dir} (${st.azimuth.toFixed(0)}°)` : 'slunce pod obzorem') + ` · východ ${hhmm(st.rise)}, západ ${hhmm(st.set)}`;
  document.getElementById('tod').value = st.hours;
  const sel = document.getElementById('season'); sel.value = [...sel.options].some(o => o.value == st.doy) ? String(st.doy) : 'today';
}
document.getElementById('tod').oninput = e => { lighting.set(Number(e.target.value), lighting.doy); sunUI(); };
document.getElementById('season').onchange = e => { lighting.set(lighting.hours, e.target.value === 'today' ? todayDoy : Number(e.target.value)); sunUI(); };
app.setTime = (hours, doy = lighting.doy) => { lighting.set(hours, doy); sunUI(); };

document.querySelectorAll('[data-level]').forEach(b => b.onclick = () => setLevel(b.dataset.level));
document.querySelectorAll('[data-view]').forEach(b => b.onclick = () => setView(b.dataset.view));
document.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => { if (b.dataset.mode === 'walk') { setLevel('all'); setMode('walk'); } else setMode('orbit'); });
document.getElementById('veg').onchange = e => { if (groups.veg) groups.veg.visible = e.target.checked; };

(async () => {
  const { raw, text } = await loadModel();
  const { m } = effective(raw);
  app.model = m; app.raw = raw; app.hash = hash(text);
  const built = buildHouse(m);
  ({ root: house, groups } = built);
  scene.add(house);
  lighting.setLamps(built.lamps, mats.lamp); app.lamps = built.lamps; sunUI();
  if (MERGE) app.mergeStats = mergeStatic();
  app.colliders = built.colliders; app.stairPlans = built.stairPlans; app.groundAt = built.ground.ground;
  doors = new Doors(house, built.colliders); app.doors = doors;
  fp = new FirstPerson(walkCam, canvas, built.colliders);
  fp.teleport(SPAWN.x, SPAWN.y, SPAWN.feet, SPAWN.yaw);
  fp.onLock = locked => document.getElementById('walkhint').classList.toggle('locked', locked);
  const toggleMap = () => { minimap.visible = !minimap.visible; document.getElementById('mm').style.display = mode === 'walk' && minimap.visible ? 'block' : 'none'; };
  fp.onKey = e => {
    if (e.code === 'KeyM') toggleMap();
    if (e.code === 'Digit1' || e.code === 'Digit2') { const t = TELEPORT[e.code === 'Digit1' ? 'np1' : 'np2']; fp.teleport(t.x, t.y, t.feet, t.yaw); }
    if (e.code === 'KeyE' && doorInView) doors.toggle(doorInView);
  };
  // touch: joystick + drag-look + tap on doors; the compact touch bar (#tbar) replaces the keyboard shortcuts
  touch = new TouchControls({ canvas, app, ui: { base: document.getElementById('joy'), knob: document.getElementById('joyknob') },
    onTap: (x, y) => { const d = doors.pickAt(walkCam, x / innerWidth * 2 - 1, -(y / innerHeight) * 2 + 1, 4); if (d) doors.toggle(d); } });
  if (TOUCH) { touch.enable(); fp.touch = true; }
  app.touchControls = touch;
  document.getElementById('tb-menu').onclick = () => document.getElementById('hud').classList.toggle('open');
  document.getElementById('tb-mode').onclick = () => { if (mode === 'walk') setMode('orbit'); else { setLevel('all'); setMode('walk'); } };
  document.getElementById('tb-np1').onclick = () => { if (mode !== 'walk') { setLevel('all'); setMode('walk'); } fp.teleport(TELEPORT.np1.x, TELEPORT.np1.y, TELEPORT.np1.feet, TELEPORT.np1.yaw); };
  document.getElementById('tb-np2').onclick = () => { if (mode !== 'walk') { setLevel('all'); setMode('walk'); } fp.teleport(TELEPORT.np2.x, TELEPORT.np2.y, TELEPORT.np2.feet, TELEPORT.np2.yaw); };
  document.getElementById('tb-map').onclick = toggleMap;
  document.getElementById('tb-edit').onclick = () => editor.toggle();
  const fsBtn = document.getElementById('tb-fs'), docEl = document.documentElement;
  if (docEl.requestFullscreen) fsBtn.onclick = () => document.fullscreenElement ? document.exitFullscreen() : docEl.requestFullscreen(); else fsBtn.style.display = 'none';
  minimap = new Minimap(document.getElementById('mm'), m); minimap.visible = true;
  // furniture editor (Tab): applies furniture stored in localStorage for this JSON version, then rebuilds if needed
  editor = new Editor({ app, canvas, groups, colliders: built.colliders, model: m, raw, hash: app.hash, onChange: () => { document.getElementById('edit-btn').classList.toggle('on', editor.active); document.getElementById('tb-edit').classList.toggle('on', editor.active); setFurnitureDisplay(editor.active); } });
  app.editor = editor;
  if (editor.stored) editor.rebuildAll();
  setFurnitureDisplay(false);
  document.getElementById('edit-btn').onclick = () => editor.toggle();
  setLevel(q.get('level') || 'all');
  if (q.get('veg') === '0') { groups.veg.visible = false; document.getElementById('veg').checked = false; }
  if (q.get('walk')) {
    setMode('walk');
    const at = (q.get('at') || '').split(',').map(Number);
    if (at.length >= 3 && at.every(v => !isNaN(v))) fp.teleport(at[0], at[1], at[2], at[3] ?? 180);
    if (q.get('pitch')) fp.pitch = Number(q.get('pitch')) * Math.PI / 180;
    fp.apply();
    if (q.get('map') === '0') { minimap.visible = false; document.getElementById('mm').style.display = 'none'; }
    if (q.get('hint') === '0') document.getElementById('walkhint').style.display = 'none'; // screenshots: no keyboard hint card over the centre of the view
  } else setView(q.get('view') || 'garden');
  resize();
  const nCh = (raw.changes || []).filter(c => c.enabled !== false).length;
  msg.textContent = `${m.meta.project} · navrhovaný stav (${nCh} změn) · hash ${app.hash}` + (editor.stored ? ' · nábytek upraven v prohlížeči (Tab)' : '');
  app.ready = true;
  if (q.get('edit')) editor.enable();       // ?edit=1 opens the furniture editor
  if (q.get('sel')) editor.script('sel:' + q.get('sel'));
  if (q.get('ed')) editor.script(q.get('ed')); // scripted edits: ?ed=sel:n_sedacka;move:500,0;rot:90;export (→ <pre id="export">)
  if (q.get('dump')) dumpScene(house); // debugging: ?dump=1 → <pre id="dump"> with object bboxes (mm)
  if (q.get('open')) for (const id of q.get('open').split(',')) { const d = doors.byId(id); if (d) { doors.toggle(d); d.state = d.target; doors.pose(d); } } // ?open=d_spiz,furn:n_lednice,gate_walk → start with these open (screenshots)
  if (q.get('sim')) simulate(q.get('sim')); // debugging: ?walk=1&sim=KeyW:120;mouse:200,0;KeyW:60 → <pre id="sim"> trajectory
  if (q.get('stats')) statsAfterFrames(3); // ?stats=1 → <pre id="stats"> with draw calls / triangles / mesh counts after 3 frames
})().catch(e => { msg.textContent = 'Chyba: ' + e.message; console.error(e); });

function simulate(spec) {
  const rows = [];
  const state = tag => {
    const cam = walkCam, right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion), up = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
    const dir = cam.getWorldDirection(new THREE.Vector3()), f = fp.forward();
    return `${tag}\tx ${fp.pos.x.toFixed(0)}\ty ${fp.pos.y.toFixed(0)}\tfeet ${fp.feet.toFixed(0)}\tyaw ${(fp.yaw * 180 / Math.PI).toFixed(1)}\tpitch ${(fp.pitch * 180 / Math.PI).toFixed(1)}\tfwd(plan) ${f.dx.toFixed(3)},${f.dy.toFixed(3)}\tcamDir ${dir.x.toFixed(3)},${dir.y.toFixed(3)},${dir.z.toFixed(3)}\tcamRight ${right.x.toFixed(3)},${right.y.toFixed(3)},${right.z.toFixed(3)}\tcamUp ${up.x.toFixed(3)},${up.y.toFixed(3)},${up.z.toFixed(3)}\torder ${cam.rotation.order}`;
  };
  rows.push(state('start'));
  for (const part of spec.split(';')) {
    const [key, arg] = part.split(':');
    if (key === 'mouse') { const [mx, my] = arg.split(',').map(Number); fp.locked = true; fp._move({ movementX: mx, movementY: my }); fp.apply(); rows.push(state('mouse ' + arg)); continue; }
    if (key === 'KeyE') { const d = doors.lookAt(walkCam); if (d) doors.toggle(d); for (let i = 0; i < 40; i++) doors.update(1 / 60); rows.push(state('E → ' + (d ? d.id + ' target ' + d.target : 'no door in view'))); continue; }
    fp.keys.add(key);
    for (let i = 0; i < +arg; i++) { fp.update(1 / 60); doors.update(1 / 60); if (i % 30 === 29) rows.push(state(key + ' f' + (i + 1))); }
    fp.keys.delete(key); fp.update(1 / 60); rows.push(state(key + ' end'));
  }
  const pre = document.createElement('pre'); pre.id = 'sim'; pre.style.display = 'none'; pre.textContent = rows.join('\n');
  document.body.appendChild(pre);
}

function statsAfterFrames(n) {
  const tick = () => { if (--n > 0) return requestAnimationFrame(tick); renderer.render(scene, camera);
    let meshes = 0, inst = 0; scene.traverse(o => { if (o.isInstancedMesh) inst++; else if (o.isMesh) meshes++; });
    const r = renderer.info.render, mem = renderer.info.memory;
    const pre = document.createElement('pre'); pre.id = 'stats'; pre.style.display = 'none';
    pre.textContent = JSON.stringify({ calls: r.calls, triangles: r.triangles, meshes, instanced: inst, geometries: mem.geometries, textures: mem.textures, programs: renderer.info.programs?.length, merged: MERGE, shadows: SHADOWS, touch: TOUCH, dpr: renderer.getPixelRatio(), mergeStats: app.mergeStats || null, sun: lighting.state, lamps: lighting.points.length, lampsOn: lighting.lampsOn });
    document.body.appendChild(pre); };
  requestAnimationFrame(tick);
}
export const perf = { frames: 0, ms: 0 };
function dumpScene(root) {
  const rows = [];
  const bb = new THREE.Box3();
  root.traverse(o => {
    if (!o.name || o === root) return;
    bb.setFromObject(o);
    const r = v => Math.round(v * 1000);
    let n = 0; o.traverse(c => { if (c.isMesh) n++; });
    rows.push(`${o.name}\tmeshes=${n}\tx ${r(bb.min.x)}..${r(bb.max.x)}\ty ${r(bb.min.z)}..${r(bb.max.z)}\tz ${r(bb.min.y)}..${r(bb.max.y)}`);
  });
  const pre = document.createElement('pre'); pre.id = 'dump'; pre.style.display = 'none'; pre.textContent = rows.join('\n');
  document.body.appendChild(pre);
}

let last = performance.now();
const fpsEl = document.getElementById('fps'); let fpsN = 0, fpsT = performance.now();
renderer.setAnimationLoop(now => {
  const dt = (now - last) / 1000; last = now;
  if (fpsEl && ++fpsN >= 30) { fpsEl.textContent = Math.round(fpsN * 1000 / (now - fpsT)) + ' fps · ' + renderer.info.render.calls + ' calls'; fpsN = 0; fpsT = now; }
  if (mode === 'walk' && fp) {
    fp.update(dt); doors.update(dt);
    doorInView = doors.lookAt(walkCam);
    const pr = document.getElementById('prompt');
    pr.style.display = doorInView ? 'block' : 'none';
    if (doorInView) pr.textContent = (TOUCH ? 'ťukněte · ' : 'E · ') + (doorInView.target ? 'zavřít ' : 'otevřít ') + (doorInView.label || (doorInView.type === 'garage' ? 'vrata' : 'dveře'));
    minimap?.draw(fp.level, fp.pos && { x: fp.pos.x, y: fp.pos.y, forward: () => fp.forward() });
  }
  else controls.update();
  renderer.render(scene, camera);
});
