// editor.js — furniture edit mode (Tab). Works on top of walk or orbit mode: the cursor is free, a click
// selects a furniture item (raycast on the `furniture:*` groups), dragging moves it on its floor plane,
// arrows nudge it (camera-relative, snapped to N/S/E/W), R turns it 15° (Shift+R back), Del removes it,
// Ctrl+Z / Ctrl+Shift+Z undo / redo. The side panel edits the fields and adds new items. Every edit
// rebuilds the level's furniture + kitchen + built-ins (orientation rules look at neighbours), refreshes
// the furniture blockers, redraws the minimap (it reads the model) and is stored in localStorage under a
// key derived from the hash of the loaded JSON. "Export JSON" downloads the full model with the edited
// furniture folded into the collections (see editdata.js). The model object is edited in place.
import * as THREE from 'three';
import { buildFurniture, buildKitchen, buildBuiltins, FURNITURE_TYPES } from './furniture.js';
import { refreshFurnitureBlockers } from './collision.js';
import { LABELS, defaultItem, newId, cleanItem, rotateItem, moveItem, setRect, snapshot, restore, storageKey, exportModel, serializeCompact, importFurniture } from './editdata.js';
import { effective } from './loader.js';

const SNAP = 10;            // mm grid for dragging / nudging
const NUDGE = 10, NUDGE_FAST = 100;
const HIGHLIGHT = new THREE.Color(0x2a6fdb);
const $ = id => document.getElementById(id);
const isTyping = e => e.target && /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName);

export class Editor {
  /** opts = { app, canvas, groups, colliders, model, raw, hash, onChange } — app provides camera / player / controls / mode / level. */
  constructor(opts) {
    Object.assign(this, opts);
    this.active = false; this.sel = null; this.selLevel = null; this.selGroup = null;
    this.drag = null; this.look = null; this.undoStack = []; this.redoStack = []; this._meshes = null;
    this.ray = new THREE.Raycaster(); this.ndc = new THREE.Vector2(); this.plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0); this.hit = new THREE.Vector3();
    // selection box: unit wire box scaled to the item's local extents
    this.box = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)), new THREE.LineBasicMaterial({ color: HIGHLIGHT, depthTest: false, transparent: true, opacity: 0.95 }));
    this.box.renderOrder = 999; this.box.visible = false; this.app.scene.add(this.box);
    this._onKey = e => this.key(e); document.addEventListener('keydown', this._onKey, true);
    this._onDown = e => this.pointerDown(e); this._onMove = e => this.pointerMove(e); this._onUp = e => this.pointerUp(e); this._noMenu = e => { if (this.active) e.preventDefault(); };
    this.buildPanel();
    this.effectiveFurniture = snapshot(this.model);   // furniture as loaded from the file (for "Zahodit úpravy")
    this.stored = this.loadStored();
    if (this.stored) restore(this.model, this.stored.levels); // the viewer rebuilds the furniture when `stored` is set
  }

  // ---------- persistence ----------
  loadStored() { try { const s = localStorage.getItem(storageKey(this.hash)); const o = s && JSON.parse(s); return o && o.levels ? o : null; } catch { return null; } }
  save() {
    const o = { savedAt: new Date().toISOString(), levels: snapshot(this.model) };
    try { localStorage.setItem(storageKey(this.hash), JSON.stringify(o)); this.stored = o; } catch (e) { console.warn('localStorage', e); this.stored = null; }
    this.status();
  }
  /** Has the model any furniture edits relative to the loaded JSON (effective state)? */
  get edited() { return !!this.stored; }
  reset() {
    if (!confirm('Zahodit všechny úpravy nábytku uložené v prohlížeči a vrátit stav ze souboru?')) return;
    localStorage.removeItem(storageKey(this.hash)); this.stored = null;
    restore(this.model, this.effectiveFurniture); this.undoStack.length = this.redoStack.length = 0;
    this.deselect(); this.rebuildAll(); this.status();
  }
  exportText() { return serializeCompact(exportModel(this.raw, this.model)); }
  /** Import the furniture of another model file into the browser copy (same as any edit: localStorage only — export and replace the file to keep it). */
  importText(text, name = 'soubor') {
    let snap;
    try { snap = importFurniture(text, effective); } catch (e) { $('ed-status').textContent = 'Import se nezdařil: ' + e.message; return false; }
    this.pushUndo(); this.deselect(); restore(this.model, snap);
    for (const lk in snap) if (!this.model.levels[lk]) delete snap[lk];
    this.rebuildAll(); this.save(); this.fill();
    const n = Object.values(snap).reduce((a, l) => a + l.length, 0);
    $('ed-status').textContent = `Importováno ${n} kusů nábytku z „${name}“ — uloženo v prohlížeči; pro trvalé uložení Export JSON a nahraďte soubor.`;
    return true;
  }
  exportJSON() {
    const text = this.exportText();
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' })); a.download = 'rd-vysoky-ujezd-model.json'; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    $('ed-status').textContent = 'Exportováno rd-vysoky-ujezd-model.json (' + text.length + ' znaků) — nahraďte jím soubor v projektu.';
  }

  // ---------- mode ----------
  toggle() { this.active ? this.disable() : this.enable(); }
  enable() {
    if (this.active) return; this.active = true;
    const c = this.canvas;
    c.addEventListener('pointerdown', this._onDown, true); c.addEventListener('pointermove', this._onMove); c.addEventListener('pointerup', this._onUp); c.addEventListener('pointercancel', this._onUp); c.addEventListener('contextmenu', this._noMenu);
    document.body.classList.add('editing'); $('ed').style.display = 'block';
    this.onModeChange(); this.status(); this.fill(); this.onChange?.();
  }
  disable() {
    if (!this.active) return; this.active = false;
    const c = this.canvas;
    c.removeEventListener('pointerdown', this._onDown, true); c.removeEventListener('pointermove', this._onMove); c.removeEventListener('pointerup', this._onUp); c.removeEventListener('pointercancel', this._onUp); c.removeEventListener('contextmenu', this._noMenu);
    document.body.classList.remove('editing'); $('ed').style.display = 'none'; c.style.cursor = '';
    this.deselect(); this.drag = this.look = null;
    if (this.app.player) this.app.player.lockable = true;
    this.onChange?.();
  }
  /** Called by the viewer when walk / orbit mode changes: the editor owns the cursor while active. */
  onModeChange() {
    const fp = this.app.player; if (!fp) return;
    fp.lockable = !this.active;
    if (this.active && document.pointerLockElement) document.exitPointerLock();
    $('ed-none').textContent = this.app.touch ? 'Ťukněte na kus nábytku.' : 'Klikněte na kus nábytku.';
    $('ed-hint').textContent = this.app.touch
      ? 'Ťuknutí = vybrat · tažení = posunout · joystick vlevo = chůze · otočení a smazání tlačítky níže · ✎ = konec editace'
      : this.app.mode === 'walk'
      ? 'Klik = vybrat · tažení = posunout · pravé tlačítko = rozhlížet · W A S D = chůze · šipky = posun o 10 mm (Shift 100) · R = otočit 15° (Shift zpět) · Del = smazat · Ctrl+Z = zpět · Tab = konec editace'
      : 'Klik = vybrat · tažení = posunout · šipky = posun o 10 mm (Shift 100) · R = otočit 15° (Shift zpět) · Del = smazat · Ctrl+Z = zpět · Tab = konec editace';
  }

  // ---------- picking ----------
  levelGroup(lk) { return this.groups[lk]?.children.find(c => c.name === 'furniture'); }
  meshes() {
    if (!this._meshes) { this._meshes = []; for (const lk in this.model.levels) this.levelGroup(lk)?.traverse(o => { if (o.isMesh) this._meshes.push(o); }); }
    return this._meshes;
  }
  setRay(e) {
    const r = this.canvas.getBoundingClientRect();
    this.ndc.set((e.clientX - r.left) / r.width * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(this.ndc, this.app.camera);
  }
  pick(e) {
    this.setRay(e);
    const hits = this.ray.intersectObjects(this.meshes(), false);
    for (const h of hits) {
      let o = h.object; while (o && o.userData?.kind !== 'furniture') o = o.parent;
      if (!o || o.parent?.name !== 'furniture') continue; // built-in twins (fixture:builtins) are not editable
      const lk = o.parent.parent.name;
      return { item: o.userData.data, group: o, level: lk, point: h.point };
    }
    return null;
  }
  groupOf(id, lk) { return this.levelGroup(lk)?.children.find(c => c.userData?.id === id) || null; }

  // ---------- selection ----------
  select(item, lk) {
    $('ed').classList.remove('collapsed');
    if (this.sel === item) { this.fill(); return; }
    this.deselect();
    this.sel = item; this.selLevel = lk; this.selGroup = this.groupOf(item.id, lk);
    this.highlight(true); this.fill();
  }
  deselect() { if (!this.sel) return; this.highlight(false); this.sel = this.selLevel = this.selGroup = null; this.box.visible = false; this.fill(); }
  highlight(on) {
    const g = this.selGroup; if (!g) return;
    g.traverse(o => {
      if (!o.isMesh) return;
      if (on) { if (!o.userData.mat0) { o.userData.mat0 = o.material; o.material = o.material.clone(); o.material.emissive = HIGHLIGHT.clone(); o.material.emissiveIntensity = 0.3; } }
      else if (o.userData.mat0) { o.material.dispose(); o.material = o.userData.mat0; delete o.userData.mat0; }
    });
    this.box.visible = on; if (on) this.placeBox();
  }
  placeBox() {
    const g = this.selGroup, s = g?.userData.size; if (!g || !s) return;
    this.box.position.set(g.position.x, g.position.y + s.h / 2000, g.position.z); this.box.rotation.y = g.rotation.y; this.box.scale.set(s.w / 1000 + 0.02, s.h / 1000 + 0.02, s.d / 1000 + 0.02);
  }

  // ---------- pointer ----------
  pointerDown(e) {
    if (isTyping(e)) return;
    if (e.button === 2 && this.app.mode === 'walk') { this.look = { x: e.clientX, y: e.clientY }; this.canvas.setPointerCapture(e.pointerId); e.preventDefault(); return; }
    if (e.button !== 0) return;
    const p = this.pick(e);
    if (!p) { this.deselect(); return; }              // empty click: deselect, orbit controls still get the event
    e.stopImmediatePropagation(); e.preventDefault();  // OrbitControls listens on the same canvas — keep it out of the drag
    this.select(p.item, p.level);
    const g = this.selGroup; this.plane.constant = -g.position.y; // horizontal plane through the item's bottom
    this.setRay(e); if (!this.ray.ray.intersectPlane(this.plane, this.hit)) return;
    const c = center(p.item);
    this.drag = { offset: { x: c[0] - this.hit.x * 1000, y: c[1] - this.hit.z * 1000 }, moved: false, start: snapshot(this.model) };
    this.canvas.setPointerCapture(e.pointerId); this.canvas.style.cursor = 'grabbing';
  }
  pointerMove(e) {
    if (this.look) { const fp = this.app.player; fp.yaw -= (e.clientX - this.look.x) * 0.0035; fp.pitch = Math.max(-1.45, Math.min(1.45, fp.pitch - (e.clientY - this.look.y) * 0.0035)); this.look = { x: e.clientX, y: e.clientY }; fp.apply(); return; }
    if (this.drag && this.sel) {
      this.setRay(e); if (!this.ray.ray.intersectPlane(this.plane, this.hit)) return;
      const nx = Math.round((this.hit.x * 1000 + this.drag.offset.x) / SNAP) * SNAP, ny = Math.round((this.hit.z * 1000 + this.drag.offset.y) / SNAP) * SNAP;
      const c = center(this.sel), dx = nx - c[0], dy = ny - c[1];
      if (!dx && !dy) return;
      this.drag.moved = true; moveItem(this.sel, dx, dy); this.previewMove();
      return;
    }
    if (e.buttons) return;
    this.canvas.style.cursor = this.pick(e) ? 'pointer' : '';
  }
  pointerUp(e) {
    if (this.look) { this.look = null; this.canvas.releasePointerCapture?.(e.pointerId); return; }
    if (!this.drag) return;
    const d = this.drag; this.drag = null; this.canvas.releasePointerCapture?.(e.pointerId); this.canvas.style.cursor = 'pointer';
    if (d.moved) { this.pushUndo(d.start); this.commit(this.selLevel); }
  }
  /** Cheap live preview while dragging / nudging: move the group and its box; the full rebuild follows on commit. */
  previewMove() {
    const g = this.selGroup, c = center(this.sel); if (g) { g.position.x = c[0] / 1000; g.position.z = c[1] / 1000; this.placeBox(); }
    this.fill();
  }

  // ---------- keys ----------
  key(e) {
    if (e.code === 'Tab' && !isTyping(e)) { e.preventDefault(); this.toggle(); return; }
    if (!this.active) return;
    if (isTyping(e)) { if (e.code === 'Escape') e.target.blur(); return; }
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.code === 'KeyZ') { e.preventDefault(); e.shiftKey ? this.redo() : this.undo(); return; }
    if (mod && e.code === 'KeyY') { e.preventDefault(); this.redo(); return; }
    if (e.code === 'Escape') { this.deselect(); return; }
    if (!this.sel) return;
    if (e.code.startsWith('Arrow')) {
      e.preventDefault(); e.stopImmediatePropagation(); // the player must not walk on arrows while an item is selected
      const step = e.shiftKey ? NUDGE_FAST : NUDGE, [fx, fy] = this.forwardAxis(), rx = -fy, ry = fx; // right = forward turned clockwise in plan
      const d = { ArrowUp: [fx, fy], ArrowDown: [-fx, -fy], ArrowRight: [rx, ry], ArrowLeft: [-rx, -ry] }[e.code];
      if (!this._nudge) { this._nudge = snapshot(this.model); }
      moveItem(this.sel, d[0] * step, d[1] * step); this.previewMove();
      clearTimeout(this._nudgeT); this._nudgeT = setTimeout(() => { this.pushUndo(this._nudge); this._nudge = null; this.commit(this.selLevel); }, 250);
      return;
    }
    if (e.code === 'KeyR') { e.preventDefault(); this.rotate(e.shiftKey ? -15 : 15); return; }
    if (e.code === 'Delete' || e.code === 'Backspace') { e.preventDefault(); this.remove(); return; }
    if (mod && e.code === 'KeyD') { e.preventDefault(); this.duplicate(); return; }
  }
  /** Unit plan vector (dx east, dy south) of "forward" for the arrows, snapped to N/S/E/W: the player's view in walk mode, the camera's in orbit mode (top view → north). */
  forwardAxis() {
    let dx = 0, dy = -1;
    if (this.app.mode === 'walk' && this.app.player) ({ dx, dy } = this.app.player.forward());
    else { const v = this.app.camera.getWorldDirection(new THREE.Vector3()); if (Math.hypot(v.x, v.z) > 1e-3) { dx = v.x; dy = v.z; } else { const u = this.app.camera.up; dx = u.x; dy = u.z; } }
    return Math.abs(dx) > Math.abs(dy) ? [Math.sign(dx), 0] : [0, Math.sign(dy) || -1];
  }

  // ---------- edits ----------
  /** Undo entries remember the selection, so undoing a delete re-selects the restored item. */
  pushUndo(snap = snapshot(this.model)) { this.undoStack.push({ snap, sel: this.sel?.id, lk: this.selLevel }); if (this.undoStack.length > 60) this.undoStack.shift(); this.redoStack.length = 0; }
  undo() { if (!this.undoStack.length) return; const u = this.undoStack.pop(); this.redoStack.push({ snap: snapshot(this.model), sel: this.sel?.id, lk: this.selLevel }); restore(this.model, u.snap); this.afterRestore(u.sel, u.lk); }
  redo() { if (!this.redoStack.length) return; const u = this.redoStack.pop(); this.undoStack.push({ snap: snapshot(this.model), sel: this.sel?.id, lk: this.selLevel }); restore(this.model, u.snap); this.afterRestore(u.sel, u.lk); }
  afterRestore(id = this.sel?.id, lk = this.selLevel) {
    this.sel = null; this.selGroup = null; this.box.visible = false;
    this.rebuildAll(); this.save();
    const it = id && this.model.levels[lk]?.furniture.find(f => f.id === id); if (it) this.select(it, lk); else this.fill();
  }
  rotate(deg) { if (!this.sel) return; this.pushUndo(); rotateItem(this.sel, deg, this.selGroup?.userData.back || 'S'); this.commit(this.selLevel); }
  remove() {
    if (!this.sel) return; this.pushUndo();
    const L = this.model.levels[this.selLevel], i = L.furniture.indexOf(this.sel); if (i >= 0) L.furniture.splice(i, 1);
    const lk = this.selLevel; this.sel = null; this.selGroup = null; this.box.visible = false; this.commit(lk);
  }
  duplicate() {
    if (!this.sel) return; this.pushUndo();
    const src = this.sel, lk = this.selLevel, copy = JSON.parse(JSON.stringify(cleanItem(src)));
    copy.id = newId(src.type, lk, this.model); moveItem(copy, 500, 0); if (copy.name) copy.name += ' (kopie)';
    this.model.levels[lk].furniture.push(copy); this.commit(lk); this.select(copy, lk);
  }
  /** Add a new item of `type`: in walk mode 1,5 m in front of the player on their level, in orbit mode at the orbit target on the selected level. */
  add(type) {
    const fp = this.app.player, walk = this.app.mode === 'walk' && fp;
    const lk = walk ? fp.level : (this.app.level === 'np2' ? 'np2' : 'np1');
    const size = defaultItem(type, this.model);
    let cx, cy;
    if (walk) { const f = fp.forward(), dist = 1000 + Math.max(size.w, size.d) / 2; cx = fp.pos.x + f.dx * dist; cy = fp.pos.y + f.dy * dist; }
    else { const t = this.app.controls.target; cx = t.x * 1000; cy = t.z * 1000; }
    this.pushUndo();
    const it = { id: newId(type, lk, this.model), type, rect: [0, 0, 0, 0], h: size.h, name: LABELS[type] || type };
    if (size.z != null) it.z = size.z;
    setRect(it, Math.round(cx / SNAP) * SNAP, Math.round(cy / SNAP) * SNAP, size.w, size.d);
    this.model.levels[lk].furniture.push(it); this.commit(lk); this.select(it, lk);
  }
  /** Apply a field edit from the panel. */
  setField(k, v) {
    const it = this.sel; if (!it) return; this.pushUndo();
    const c = center(it), w = it.rect[2] - it.rect[0], d = it.rect[3] - it.rect[1];
    if (k === 'x') setRect(it, v, c[1], w, d); else if (k === 'y') setRect(it, c[0], v, w, d);
    else if (k === 'w') setRect(it, c[0], c[1], Math.max(10, v), d); else if (k === 'd') setRect(it, c[0], c[1], w, Math.max(10, v));
    else if (k === 'h') it.h = Math.max(1, v); else if (k === 'z') { if (v) it.z = v; else delete it.z; }
    else if (k === 'rot') { if (v) it.rot = v; else delete it.rot; }
    else if (k === 'back') { if (v) it.back = v; else delete it.back; }
    else if (k === 'type') it.type = v; else if (k === 'name') { if (v) it.name = v; else delete it.name; }
    this.commit(this.selLevel);
  }

  // ---------- rebuild ----------
  /** Rebuild one level's furniture, kitchen and built-ins (they read the furniture: appliances, hoods, twins) + its blockers; then save. */
  commit(lk) {
    this.rebuildLevel(lk); this.save();
    if (this.sel) { this.selGroup = this.groupOf(this.sel.id, lk); this.highlight(true); }
    this.fill();
  }
  rebuildLevel(lk) {
    const L = this.model.levels[lk], zf = L.z_floor ?? L.elev ?? 0, g = this.groups[lk];
    for (const name of ['furniture', 'fixture:kitchen', 'fixture:builtins']) { const old = g.children.find(c => c.name === name); if (old) { g.remove(old); dispose(old); } }
    g.add(buildFurniture(L, zf, this.app.groundAt)); g.add(buildKitchen(L, zf)); g.add(buildBuiltins(L, zf));
    refreshFurnitureBlockers(this.colliders, L, lk);
    this._meshes = null;
    this.app.doors?.scan(); // the fridge doors live in the furniture
  }
  rebuildAll() { for (const lk in this.model.levels) this.rebuildLevel(lk); }

  // ---------- panel ----------
  buildPanel() {
    const sel = $('ed-type'), add = $('ed-addtype');
    for (const t of [...FURNITURE_TYPES].sort((a, b) => (LABELS[a] || a).localeCompare(LABELS[b] || b, 'cs'))) {
      for (const s of [sel, add]) { const o = document.createElement('option'); o.value = t; o.textContent = (LABELS[t] || t) + ' · ' + t; s.appendChild(o); }
    }
    add.value = 'chair';
    for (const k of ['name', 'type', 'x', 'y', 'w', 'd', 'h', 'z', 'rot', 'back']) {
      const el = $('ed-' + k); el.onchange = () => { const v = el.type === 'number' ? Number(el.value) : el.value; this.setField(k, v); };
      if (el.type === 'number') el.onkeydown = e => { if (e.key === 'Enter') el.blur(); };
    }
    $('ed-add').onclick = () => this.add(add.value);
    $('ed-dup').onclick = () => this.duplicate(); $('ed-del').onclick = () => this.remove();
    $('ed-undo').onclick = () => this.undo(); $('ed-redo').onclick = () => this.redo();
    $('ed-export').onclick = () => this.exportJSON(); $('ed-reset').onclick = () => this.reset(); $('ed-close').onclick = () => this.disable();
    const file = $('ed-importfile'); $('ed-import').onclick = () => { file.value = ''; file.click(); };
    file.onchange = async () => { const f = file.files[0]; if (f) this.importText(await f.text(), f.name); };
    $('ed-rot-l').onclick = () => this.rotate(-15); $('ed-rot-r').onclick = () => this.rotate(15);
    $('ed').querySelector('h3').onclick = e => { if (e.target.tagName !== 'BUTTON' && this.app.touch) $('ed').classList.toggle('collapsed'); }; // phone: tap the header to fold the sheet away
  }
  fill() {
    const it = this.sel, has = !!it; $('ed-item').style.display = has ? 'block' : 'none'; $('ed-none').style.display = has ? 'none' : 'block';
    $('ed-undo').disabled = !this.undoStack.length; $('ed-redo').disabled = !this.redoStack.length;
    if (!has) return;
    const c = center(it), L = this.model.levels[this.selLevel];
    $('ed-id').textContent = it.id + ' · ' + (L.name || this.selLevel);
    $('ed-name').value = it.name || ''; $('ed-type').value = it.type;
    $('ed-x').value = c[0]; $('ed-y').value = c[1]; $('ed-w').value = it.rect[2] - it.rect[0]; $('ed-d').value = it.rect[3] - it.rect[1];
    $('ed-h').value = it.h ?? ''; $('ed-z').value = it.z ?? ''; $('ed-rot').value = it.rot ?? 0;
    const inferred = this.selGroup?.userData.back || '?'; $('ed-back').value = it.back || ''; $('ed-back').options[0].textContent = 'auto (' + inferred + ')';
    const twin = (L.fixtures || []).find(f => f.rect && !f.z1 && f.rect.every((v, i) => Math.abs(v - it.rect[i]) < 6));
    $('ed-warn').textContent = twin ? `Pozor: stejný obrys má i zařizovací předmět „${twin.id}“ ve fixtures (vestavba se kreslí podle něj) — po přesunu ho upravte v 2D editoru.` : '';
  }
  status() {
    const s = $('ed-status'); if (!s) return;
    const n = Object.values(snapshot(this.model)).reduce((a, l) => a + l.length, 0);
    s.textContent = this.stored ? `Úpravy uloženy v prohlížeči ${new Date(this.stored.savedAt).toLocaleTimeString('cs')} · klíč …${this.hash} · ${n} kusů` : `Bez úprav (stav ze souboru) · ${n} kusů`;
  }

  /** Scripted edits for headless verification: ?ed=sel:n_sedacka;move:500,0;rot:90;dup;del;add:chair;undo;export */
  script(spec) {
    this.enable();
    for (const part of spec.split(';')) {
      const [cmd, arg] = part.split(':');
      if (cmd === 'sel') { for (const lk in this.model.levels) { const it = this.model.levels[lk].furniture.find(f => f.id === arg); if (it) this.select(it, lk); } }
      else if (cmd === 'move' && this.sel) { const [dx, dy] = arg.split(',').map(Number); this.pushUndo(); moveItem(this.sel, dx, dy); this.commit(this.selLevel); }
      else if (cmd === 'rot') for (let i = 0; i < Math.abs(+arg) / 15; i++) this.rotate(15 * Math.sign(+arg));
      else if (cmd === 'dup') this.duplicate(); else if (cmd === 'del') this.remove();
      else if (cmd === 'add') this.add(arg); else if (cmd === 'undo') this.undo(); else if (cmd === 'redo') this.redo();
      else if (cmd === 'set' && this.sel) { const [k, v] = arg.split('='); this.setField(k, isNaN(+v) ? v : +v); }
      else if (cmd === 'export') { const pre = document.createElement('pre'); pre.id = 'export'; pre.style.display = 'none'; pre.textContent = this.exportText(); document.body.appendChild(pre); }
    }
  }
}

const center = it => [(it.rect[0] + it.rect[2]) / 2, (it.rect[1] + it.rect[3]) / 2];
function dispose(root) { root.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.userData?.mat0) { o.material.dispose(); o.material = o.userData.mat0; } }); }
