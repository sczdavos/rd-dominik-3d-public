// loader.js — loads rd-vysoky-ujezd-model.json and applies the `changes` list.
// The JSON is the single source of truth; nothing here re-derives geometry.

/** FNV-1a hash, identical to hash() in rd-vysoky-ujezd-model.html — used for the localStorage key. */
export function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}

/**
 * Port of effective() from the 2D editor, "new" state only:
 * apply every change with enabled !== false, ops in order, on a deep copy.
 * Returns { m: effective model, marks: {id: {k:'add'|'rem'|'mod'}} }.
 */
export function effective(model) {
  const m = JSON.parse(JSON.stringify(model));
  const marks = {};
  for (const ch of (m.changes || [])) {
    if (ch.enabled === false) continue;
    for (const op of ch.ops || []) {
      const coll = m.levels[op.level]?.[op.coll];
      if (!coll) continue;
      if (op.op === 'remove') {
        const i = coll.findIndex(e => e.id === op.id);
        if (i >= 0) { marks[op.id] = { k: 'rem', item: coll[i] }; coll.splice(i, 1); }
      } else if (op.op === 'add') {
        coll.push(op.item); marks[op.item.id] = { k: 'add' };
      } else if (op.op === 'set') {
        const e = coll.find(e => e.id === op.id);
        if (e) { Object.assign(e, op.patch); marks[op.id] = { k: 'mod' }; }
      }
    }
  }
  return { m, marks };
}

/** Fetch the model; on failure (file://, offline) resolve via the file picker overlay. */
export async function loadModel(url = './rd-vysoky-ujezd-model.json') {
  try {
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const text = await r.text();
    return { raw: JSON.parse(text), text };
  } catch (e) {
    console.warn('fetch failed, falling back to file picker', e);
    return new Promise(resolve => {
      const pick = document.getElementById('pick');
      const inp = document.getElementById('pickfile');
      pick.classList.add('show');
      inp.onchange = async () => {
        const text = await inp.files[0].text();
        pick.classList.remove('show');
        resolve({ raw: JSON.parse(text), text });
      };
    });
  }
}
