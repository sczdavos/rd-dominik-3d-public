// minimap.js — 2D plan of the current level drawn from the same data, with the player position and view cone.
export class Minimap {
  constructor(canvas, model) {
    this.cv = canvas; this.ctx = canvas.getContext('2d'); this.m = model; this.visible = false; this.level = null;
    this.bbox = null;
  }
  fit(level) {
    const L = this.m.levels[level];
    const rects = [...L.walls.map(w => w.rect), ...L.rooms.map(r => bb(r.poly))];
    const b = rects.reduce((a, r) => [Math.min(a[0], r[0]), Math.min(a[1], r[1]), Math.max(a[2], r[2]), Math.max(a[3], r[3])], [Infinity, Infinity, -Infinity, -Infinity]);
    this.bbox = b; const pad = 600;
    this.scale = Math.min((this.cv.width - 20) / (b[2] - b[0] + 2 * pad), (this.cv.height - 20) / (b[3] - b[1] + 2 * pad));
    this.ox = 10 + ((this.cv.width - 20) - (b[2] - b[0] + 2 * pad) * this.scale) / 2 - (b[0] - pad) * this.scale;
    this.oy = 10 + ((this.cv.height - 20) - (b[3] - b[1] + 2 * pad) * this.scale) / 2 - (b[1] - pad) * this.scale;
  }
  X(x) { return this.ox + x * this.scale; }
  Y(y) { return this.oy + y * this.scale; }
  rect(r, fill, stroke) { const c = this.ctx; c.beginPath(); c.rect(this.X(r[0]), this.Y(r[1]), (r[2] - r[0]) * this.scale, (r[3] - r[1]) * this.scale); if (fill) { c.fillStyle = fill; c.fill(); } if (stroke) { c.strokeStyle = stroke; c.lineWidth = 1; c.stroke(); } }
  draw(level, player) {
    if (!this.visible) return;
    if (level !== this.level) { this.level = level; this.fit(level); }
    const L = this.m.levels[level], c = this.ctx;
    c.clearRect(0, 0, this.cv.width, this.cv.height);
    c.fillStyle = 'rgba(255,255,255,0.92)'; c.fillRect(0, 0, this.cv.width, this.cv.height);
    for (const r of L.rooms) {
      c.beginPath(); r.poly.forEach((p, i) => i ? c.lineTo(this.X(p[0]), this.Y(p[1])) : c.moveTo(this.X(p[0]), this.Y(p[1]))); c.closePath();
      c.fillStyle = r.outdoor ? '#dfe7d6' : '#f4efe4'; c.fill();
    }
    for (const f of L.fixtures) if (f.rect) this.rect(f.rect, 'rgba(120,130,140,0.18)');
    for (const f of L.furniture || []) this.rect(f.rect, '#e9dcc0', '#b09a6a');
    for (const w of L.walls) this.rect(w.rect, w.kind === 'glass' ? '#9fc5e8' : w.kind === 'lamely' ? '#c9a66b' : w.kind === 'int' ? '#6b7079' : '#2b2f36');
    for (const o of L.openings) this.rect(o.rect, o.type === 'window' ? '#cfe3f3' : '#ffffff');
    if (player) {
      const px = this.X(player.x), py = this.Y(player.y), f = player.forward();
      c.beginPath(); c.moveTo(px, py);
      const a = Math.atan2(f.dy, f.dx), spread = 0.5, len = 2200 * this.scale;
      c.arc(px, py, len, a - spread, a + spread); c.closePath(); c.fillStyle = 'rgba(230,80,50,0.25)'; c.fill();
      c.beginPath(); c.arc(px, py, 4, 0, Math.PI * 2); c.fillStyle = '#e25030'; c.fill();
    }
    c.fillStyle = '#5a6470'; c.font = '11px system-ui, sans-serif'; c.fillText(L.name + '  ·  N ↑', 8, this.cv.height - 6);
  }
}
const bb = poly => [Math.min(...poly.map(p => p[0])), Math.min(...poly.map(p => p[1])), Math.max(...poly.map(p => p[0])), Math.max(...poly.map(p => p[1]))];
