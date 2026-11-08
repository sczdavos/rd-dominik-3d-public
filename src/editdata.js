// editdata.js — pure data logic behind the furniture editor (no three.js, no DOM; Node-testable):
// Czech labels and default sizes for new items, id generation, rotation normalisation, snapshots for
// undo / localStorage, the JSON export (edited furniture folded back into the collections, furniture ops
// dropped from `changes`) and a serializer that reproduces the file's format (Python json.dumps).

/** Czech labels for the add-item list (keys = furniture types = BUILDERS in furniture.js). */
export const LABELS = {
  bed_single: 'postel 90', bed_double: 'postel 180', nightstand: 'noční stolek', dresser: 'komoda', desk: 'psací stůl', chair: 'židle',
  wardrobe: 'skříň', sofa_L: 'rohová sedačka', coffee_table: 'konferenční stolek', dining_table: 'jídelní stůl', dining_chair: 'jídelní židle',
  bench: 'lavice', toilet: 'WC', sink: 'umyvadlo', shower: 'sprchový kout', car: 'auto', treadmill: 'běžecký pás', gym_rack: 'posilovací klec',
  appliance: 'spotřebič (varná deska / lednice)', box: 'kvádr (obecný)', desk_L: 'rohový stůl L', office_chair: 'kancelářská židle', sofa: 'gauč',
  monitor: 'monitor + klávesnice', pc: 'PC skříň', tv: 'TV na stěně', tv_table: 'TV stolek', console: 'herní konzole', carpet: 'koberec',
  bookshelf: 'knihovna', monitor_curved: 'zakřivený monitor', shelving: 'regál', chest_freezer: 'truhlicový mrazák', crates: 'přepravky',
  fridge_us: 'americká lednice', fridge_builtin: 'vestavná lednice (za dvířky)', tall_cabinet: 'vysoká kuchyňská skříň', oven_tower: 'trouba + mikrovlnka (vysoká skříň)', dishwasher: 'myčka', wine_cooler: 'vinotéka', hood: 'digestoř',
  thermomix: 'Thermomix', optigrill: 'OptiGrill', knife_block: 'stojan na nože', grill_outdoor: 'venkovní gril', wood_stack: 'dřevo (hranice)',
  punching_bag: 'boxovací pytel', weight_rack: 'stojan s činkami', pullup_bar: 'hrazda na stěně', parallel_bars: 'bradla',
  workbench: 'pracovní stůl (dílna)', pegboard: 'panel s nářadím', toolchest: 'dílenský vozík', bike_wall: 'kolo na stěně',
  elec_cabinet: 'elektrorozvaděč', net_rack: 'síťový rack', shoe_rack: 'botník', ficus_benjamina: 'Fíkus Benjamin',
  kallax: 'otevřená skříňka (IKEA Kallax)', henhouse: 'kurník (s výběhem)', compost: 'kompostér', bath_cabinet: 'koupelnová skříňka (vysoká)', vanity: 'umyvadlová skříňka (s ručníky)', towel_radiator: 'žebříkový radiátor (s ručníky)', planter: 'truhlík s vyšší rostlinou',
};

/** Default footprint for a new item: [w (x), d (y), h, z?] in mm — used when the house has no item of that type yet. */
export const DEFAULTS = {
  bed_single: [900, 2000, 500], bed_double: [1800, 2000, 500], nightstand: [500, 400, 550], dresser: [900, 450, 900], desk: [1400, 600, 750],
  chair: [450, 450, 900], wardrobe: [1200, 600, 2100], sofa_L: [2400, 1600, 850], coffee_table: [900, 600, 450], dining_table: [1600, 900, 750],
  dining_chair: [450, 450, 900], bench: [1200, 400, 450], toilet: [400, 600, 400], sink: [600, 450, 850], shower: [1000, 1000, 2000],
  car: [1500, 4600, 1500], treadmill: [900, 1900, 1400], gym_rack: [1200, 1400, 2200], appliance: [600, 600, 900], box: [800, 600, 750],
  desk_L: [2000, 1800, 750], office_chair: [600, 600, 1150], sofa: [1800, 900, 850], monitor: [800, 250, 550, 750], pc: [250, 450, 450],
  tv: [1450, 70, 830, 700], tv_table: [1650, 450, 450], console: [300, 270, 70, 450], carpet: [2000, 1500, 12], bookshelf: [1200, 350, 2200],
  monitor_curved: [1100, 300, 560, 750], shelving: [1000, 400, 2000], chest_freezer: [1000, 700, 850], crates: [400, 600, 600],
  fridge_us: [900, 750, 1800], fridge_builtin: [600, 600, 2200], tall_cabinet: [600, 600, 2200], oven_tower: [600, 600, 2100], dishwasher: [600, 600, 850], wine_cooler: [600, 600, 850], hood: [900, 500, 550, 1550],
  thermomix: [300, 300, 350, 900], optigrill: [350, 350, 200, 900], knife_block: [150, 200, 230, 900], grill_outdoor: [1300, 700, 1200],
  wood_stack: [1000, 250, 1600], punching_bag: [400, 400, 2700], weight_rack: [900, 340, 900], pullup_bar: [1000, 140, 120, 2100],
  parallel_bars: [600, 600, 1300], workbench: [1800, 750, 900], pegboard: [1800, 60, 1000, 1000], toolchest: [700, 450, 950],
  bike_wall: [350, 650, 2000], elec_cabinet: [600, 250, 1100, 1000], net_rack: [550, 300, 500, 1500], shoe_rack: [1100, 350, 500],
  ficus_benjamina: [900, 900, 1700], kallax: [770, 390, 1470], henhouse: [1200, 2400, 1400], compost: [1000, 1000, 900], bath_cabinet: [600, 450, 2000], vanity: [1200, 450, 850], towel_radiator: [600, 100, 1500, 300], planter: [1000, 400, 600],
};

/** Size of a new item of `type`: the last item of that type already in the house (any level), else DEFAULTS, else a 600 cube. */
export function defaultItem(type, model) {
  let src = null;
  for (const lk in model.levels) for (const f of model.levels[lk].furniture || []) if (f.type === type) src = f;
  if (src) return { w: src.rect[2] - src.rect[0], d: src.rect[3] - src.rect[1], h: src.h || 750, z: src.z };
  const [w, d, h, z] = DEFAULTS[type] || [600, 600, 750];
  return { w, d, h, z };
}

/** Unique id for a new item: n_<type>_<n> (1 NP) / n2_<type>_<n> (2 NP), unique across every collection of every level. */
export function newId(type, level, model) {
  const used = new Set();
  for (const lk in model.levels) for (const coll of Object.values(model.levels[lk])) if (Array.isArray(coll)) for (const e of coll) if (e && e.id) used.add(e.id);
  const prefix = (level === 'np1' ? 'n_' : level.replace(/^np/, 'n') + '_') + type + '_';
  for (let n = 1; ; n++) if (!used.has(prefix + n)) return prefix + n;
}

/** Item without private (underscore) keys, for storage and export. */
export const cleanItem = it => Object.fromEntries(Object.entries(it).filter(([k, v]) => !k.startsWith('_') && v !== undefined));

// ---------- rotation ----------
export const SIDES_CW = { S: 'W', W: 'N', N: 'E', E: 'S' };   // back side after a 90° clockwise turn (seen on the plan, north up)
export const SIDES_CCW = { S: 'E', E: 'N', N: 'W', W: 'S' };
/** Swap the footprint's width and depth around its centre (a 90° turn of the rect). */
export function swapRect(it) {
  const [x0, y0, x1, y1] = it.rect, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, hw = (x1 - x0) / 2, hd = (y1 - y0) / 2;
  it.rect = [Math.round(cx - hd), Math.round(cy - hw), Math.round(cx + hd), Math.round(cy + hw)];
}
/**
 * Turn an item by `deg` (clockwise in plan). `back` = the side its back currently faces (explicit `it.back` or the
 * inferred one). The result pins `it.back` and keeps `rot` within (−45°, 45°]: every 90° of overflow turns `back`
 * one side and swaps the rect, so the rect always stays the (approximate) true footprint — the 2D editor draws rects only.
 */
export function rotateItem(it, deg, back) {
  let rot = (it.rot || 0) + deg, b = it.back || back;
  while (rot > 45) { rot -= 90; b = SIDES_CW[b]; swapRect(it); }
  while (rot <= -45) { rot += 90; b = SIDES_CCW[b]; swapRect(it); }
  it.back = b;
  if (rot) it.rot = rot; else delete it.rot;
}
/** Translate an item's rect by (dx, dy) mm. */
export function moveItem(it, dx, dy) { it.rect = [it.rect[0] + dx, it.rect[1] + dy, it.rect[2] + dx, it.rect[3] + dy]; }
/** Set the rect from centre + size. */
export function setRect(it, cx, cy, w, d) { it.rect = [Math.round(cx - w / 2), Math.round(cy - d / 2), Math.round(cx + w / 2), Math.round(cy + d / 2)]; }

// ---------- snapshots (undo, localStorage) ----------
/** Deep copy of every level's furniture collection: { np1: [...], np2: [...] }. */
export function snapshot(model) {
  const s = {};
  for (const lk in model.levels) s[lk] = (model.levels[lk].furniture || []).map(it => JSON.parse(JSON.stringify(cleanItem(it))));
  return s;
}
/** Replace the furniture collections with a snapshot (in place — the minimap and colliders hold the model). */
export function restore(model, snap) {
  for (const lk in snap) if (model.levels[lk]) model.levels[lk].furniture = snap[lk].map(it => JSON.parse(JSON.stringify(it)));
}
/** localStorage key for the edits of one JSON version (hash of the loaded text — a newer file gets a new key). */
export const storageKey = h => 'rdvujezd-3d-furniture-' + h;

// ---------- import ----------
/**
 * Furniture snapshot from another model file (an export of this app or of the 2D editor): its enabled changes are
 * applied first, so furniture ops in `changes` count. Throws on anything that is not a model. Only furniture is taken —
 * walls, openings, rooms and fixtures always come from the file the viewer loaded.
 */
export function importFurniture(text, effective) {
  const o = JSON.parse(text);
  if (!o || typeof o !== 'object' || !o.levels) throw new Error('soubor neobsahuje model (chybí "levels")');
  const { m } = effective(o), snap = {};
  for (const lk in m.levels) if (Array.isArray(m.levels[lk].furniture)) snap[lk] = m.levels[lk].furniture.map(it => JSON.parse(JSON.stringify(cleanItem(it))));
  if (!Object.keys(snap).length) throw new Error('soubor nemá žádný nábytek');
  return snap;
}

// ---------- export ----------
/**
 * Full model for export: the loaded (raw) JSON with the edited furniture collections written into every level and
 * the furniture ops removed from enabled `changes` (they are already folded into the collections; fixture / wall /
 * opening ops stay). Disabled changes are left untouched. Everything else is byte-identical.
 */
export function exportModel(raw, model) {
  const out = JSON.parse(JSON.stringify(raw));
  for (const lk in out.levels) if (model.levels[lk]) out.levels[lk].furniture = (model.levels[lk].furniture || []).map(it => JSON.parse(JSON.stringify(cleanItem(it))));
  for (const ch of out.changes || []) if (ch.enabled !== false && Array.isArray(ch.ops)) ch.ops = ch.ops.filter(op => op.coll !== 'furniture');
  return out;
}
/** Single-line JSON with ", " / ": " separators — the format of rd-vysoky-ujezd-model.json (Python json.dumps, ensure_ascii=False). */
export function serializeCompact(v) {
  if (Array.isArray(v)) return '[' + v.map(serializeCompact).join(', ') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).filter(k => v[k] !== undefined).map(k => JSON.stringify(k) + ': ' + serializeCompact(v[k])).join(', ') + '}';
  return JSON.stringify(v) ?? 'null';
}
