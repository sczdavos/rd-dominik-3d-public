// touch.js — touch controls for phones / tablets (iOS Safari has no pointer lock): a floating joystick
// on the left half of the screen walks (direction relative to the view, magnitude = speed, pushed past
// the ring = run), a drag on the right half looks around, a tap (lifted without moving) opens / closes the door
// under the finger. Pointer events only (touch-action: none on the canvas); the furniture editor takes touches
// on furniture before we see them (capture-phase listener), so tap = select / drag = move there.
import { WALK } from './collision.js';

const R = 56;            // joystick ring radius (px)
const LOOK = 0.0045;     // rad per px
const TAP_PX = 12;   // a tap = the finger lifted without moving more than this; no time limit (slow phones render long frames between down and up, and a look-drag always moves)

export class TouchControls {
  /** opts = { canvas, app, ui: { base, knob }, onTap(x, y) } — app provides mode, player, camera, doors. */
  constructor(opts) {
    Object.assign(this, opts);
    this.stickId = null; this.lookId = null; this.origin = null; this.look = null; this.enabled = false;
    this._down = e => this.down(e); this._move = e => this.move(e); this._up = e => this.up(e);
  }
  enable() {
    if (this.enabled) return; this.enabled = true;
    const c = this.canvas;
    c.addEventListener('pointerdown', this._down); c.addEventListener('pointermove', this._move); c.addEventListener('pointerup', this._up); c.addEventListener('pointercancel', this._up);
  }
  disable() {
    if (!this.enabled) return; this.enabled = false;
    const c = this.canvas;
    c.removeEventListener('pointerdown', this._down); c.removeEventListener('pointermove', this._move); c.removeEventListener('pointerup', this._up); c.removeEventListener('pointercancel', this._up);
    this.endStick(); this.lookId = null;
  }
  get fp() { return this.app.player; }
  down(e) {
    if (e.pointerType !== 'touch' || this.app.mode !== 'walk' || !this.fp) return;
    this.fp.touch = true; document.body.classList.add('touched');
    if (e.clientX < innerWidth / 2 && this.stickId == null) {
      this.stickId = e.pointerId; this.origin = { x: e.clientX, y: e.clientY }; this.stickMoved = 0;
      this.fp.stick = { x: 0, y: 0 }; this.fp.run = false;
      this.ui.base.style.display = 'block'; this.ui.base.style.left = e.clientX + 'px'; this.ui.base.style.top = e.clientY + 'px';
      this.ui.knob.style.transform = 'translate(0px, 0px)';
    } else if (this.lookId == null) {
      this.lookId = e.pointerId; this.look = { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, moved: 0 };
    } else return;
    this.canvas.setPointerCapture?.(e.pointerId); e.preventDefault();
  }
  move(e) {
    if (e.pointerId === this.stickId) {
      const dx = e.clientX - this.origin.x, dy = e.clientY - this.origin.y, d = Math.hypot(dx, dy), k = d > R ? R / d : 1;
      this.stickMoved = Math.max(this.stickMoved, d);
      this.fp.stick = { x: dx * k / R, y: -dy * k / R }; this.fp.run = d > R * 1.35;
      this.ui.knob.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
      this.ui.base.classList.toggle('run', this.fp.run);
    } else if (e.pointerId === this.lookId && this.look) {
      const dx = e.clientX - this.look.x, dy = e.clientY - this.look.y;
      this.look.moved = Math.max(this.look.moved, Math.hypot(e.clientX - this.look.x0, e.clientY - this.look.y0));
      this.fp.yaw -= dx * LOOK; this.fp.pitch = Math.max(-1.45, Math.min(1.45, this.fp.pitch - dy * LOOK));
      this.look.x = e.clientX; this.look.y = e.clientY; this.fp.apply();
    }
  }
  up(e) {
    if (e.pointerId === this.stickId) { const o = this.origin, tap = this.stickMoved < TAP_PX; this.endStick(); if (tap) this.onTap?.(o.x, o.y); } // a still finger on the left half is a tap too (the door you face is near the centre)
    else if (e.pointerId === this.lookId) {
      const l = this.look; this.lookId = null; this.look = null;
      if (l && l.moved < TAP_PX) this.onTap?.(l.x0, l.y0);
    }
  }
  endStick() { this.stickId = null; if (this.fp) { this.fp.stick = null; this.fp.run = false; } this.ui.base.style.display = 'none'; this.ui.base.classList.remove('run'); }
}

/** Touch / coarse-pointer device? URL `touch=1|0` overrides. */
export function detectTouch(q) {
  if (q.get('touch') === '1') return true; if (q.get('touch') === '0') return false;
  return matchMedia('(pointer: coarse)').matches || (navigator.maxTouchPoints > 1 && /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent));
}
export { WALK };
