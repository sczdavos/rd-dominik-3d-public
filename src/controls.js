// controls.js — first-person walking: pointer lock + mouse look, WASD / arrows, Shift = run,
// gravity + floor following and collision via collision.js. Positions are kept in plan mm
// (x east, y south, feet = z of the soles); the camera is placed at feet + eye height.
import * as THREE from 'three';
import { WALK, floorAt, resolveXY } from './collision.js';
import { CONST } from './config.js';

const isTyping = e => e.target && /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName); // keys typed into the editor panel don't walk

export class FirstPerson {
  constructor(camera, dom, colliders) {
    this.camera = camera; this.dom = dom; this.col = colliders;
    this.pos = { x: 0, y: 0 }; this.feet = 0; this.vz = 0;
    this.yaw = Math.PI; this.pitch = 0;        // yaw 0 = looking north (−Z); π = south
    this.keys = new Set(); this.enabled = false; this.locked = false; this.lockable = true; // lockable=false: the editor owns the cursor
    this.stick = null; this.run = false; this.touch = false; // virtual joystick {x: strafe, y: forward} in −1..1 (touch.js); touch = never request pointer lock
    this.onLock = () => {}; this.onKey = () => {};
    this._move = e => { if (!this.locked) return; this.yaw -= e.movementX * 0.0022; this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch - e.movementY * 0.0022)); };
    this._down = e => { if (!this.enabled || e.repeat || isTyping(e)) return; this.keys.add(e.code); this.onKey(e); };
    this._up = e => this.keys.delete(e.code);
    this._lockChange = () => { this.locked = document.pointerLockElement === this.dom; this.onLock(this.locked); if (!this.locked) this.keys.clear(); };
    this._click = e => { if (this.enabled && this.lockable && !this.touch && e.pointerType !== 'touch' && !this.locked) this.dom.requestPointerLock?.(); };
  }
  enable() {
    if (this.enabled) return; this.enabled = true;
    document.addEventListener('mousemove', this._move); document.addEventListener('keydown', this._down); document.addEventListener('keyup', this._up);
    document.addEventListener('pointerlockchange', this._lockChange); this.dom.addEventListener('click', this._click);
    this.apply();
  }
  disable() {
    if (!this.enabled) return; this.enabled = false; this.keys.clear();
    if (document.pointerLockElement === this.dom) document.exitPointerLock();
    document.removeEventListener('mousemove', this._move); document.removeEventListener('keydown', this._down); document.removeEventListener('keyup', this._up);
    document.removeEventListener('pointerlockchange', this._lockChange); this.dom.removeEventListener('click', this._click);
  }
  /** Place the player: plan mm, feet height mm, yaw in degrees (0 = north, 90 = east, 180 = south). */
  teleport(x, y, feet, yawDeg = 180) {
    this.pos.x = x; this.pos.y = y; this.feet = feet; this.vz = 0; this.pitch = 0; this.camY = null;
    this.yaw = -yawDeg * Math.PI / 180;
    this.feet = floorAt(this.col, x, y, feet + WALK.STEP); // snap onto whatever is there
    this.apply();
  }
  get level() { return this.feet >= CONST.Z2 - 600 ? 'np2' : 'np1'; }
  /** Unit forward vector in plan (dx east, dy south). */
  forward() { return { dx: -Math.sin(this.yaw), dy: -Math.cos(this.yaw) }; }
  update(dt) {
    if (!this.enabled) return;
    dt = Math.min(dt, 0.05);
    const k = this.keys, f = this.forward(), r = { dx: Math.cos(this.yaw), dy: -Math.sin(this.yaw) };
    let mx = 0, my = 0;
    if (k.has('KeyW') || k.has('ArrowUp')) { mx += f.dx; my += f.dy; }
    if (k.has('KeyS') || k.has('ArrowDown')) { mx -= f.dx; my -= f.dy; }
    if (k.has('KeyD') || k.has('ArrowRight')) { mx += r.dx; my += r.dy; }
    if (k.has('KeyA') || k.has('ArrowLeft')) { mx -= r.dx; my -= r.dy; }
    if (this.stick) { mx += f.dx * this.stick.y + r.dx * this.stick.x; my += f.dy * this.stick.y + r.dy * this.stick.x; }
    const len = Math.hypot(mx, my);
    if (len > 0) {
      const speed = (k.has('ShiftLeft') || k.has('ShiftRight') || this.run) ? WALK.RUN : WALK.WALK;
      const dist = speed * dt * Math.min(1, len), n = Math.max(1, Math.ceil(dist / 100)); // a half-pushed joystick walks slower
      for (let i = 0; i < n; i++) {
        this.pos.x += mx / len * dist / n; this.pos.y += my / len * dist / n;
        resolveXY(this.col, this.pos, this.feet);
        const fl = floorAt(this.col, this.pos.x, this.pos.y, this.feet);
        if (fl > this.feet) { this.feet = fl; this.vz = 0; } // step up (≤ STEP)
      }
    } else resolveXY(this.col, this.pos, this.feet);
    // gravity / floor following
    const fl = floorAt(this.col, this.pos.x, this.pos.y, this.feet);
    if (fl >= this.feet - 1) { this.feet = fl; this.vz = 0; }
    else { this.vz -= 9810 * dt; this.feet = Math.max(fl, this.feet + this.vz * dt); if (this.feet === fl) this.vz = 0; }
    // eye height follows the feet with a short ease so steps and stairs don't jolt
    const eye = this.feet + WALK.EYE;
    this.camY = this.camY == null ? eye : this.camY + (eye - this.camY) * Math.min(1, dt * 12);
    this.apply();
  }
  apply() {
    this.camera.position.set(this.pos.x / 1000, (this.camY ?? (this.feet + WALK.EYE)) / 1000, this.pos.y / 1000);
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
  }
}
