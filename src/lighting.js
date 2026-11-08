// lighting.js — the light rig: sun on its real path (sun.js), a faint moon at night, hemisphere + ambient,
// a gradient sky dome and the interior light (ceiling lamps glow + a few point lights) that comes on at dusk.
// Everything is driven by update() from the clock time + day of year; setView() may override the sun
// position for the flat elevation views ('front') or turn shadows off for the plan view ('flat').
import * as THREE from 'three';
import { sunPosition, sunTimes } from './sun.js';
import { mats } from './materials.js';

const TARGET = new THREE.Vector3(10, 0, 6);            // house centre (world metres)
const col = h => new THREE.Color(h);
const P = { // palette: day / low sun (dusk, dawn) / night
  sunDay: col(0xfff4e5), sunLow: col(0xffbe80),
  skyTop: [col(0x0a1020), col(0x6c7fa8), col(0x9dbde0)], skyHor: [col(0x1a2438), col(0xf1c6a6), col(0xe8eef4)],
  hemi: [col(0x1a2438), col(0xf0cdb0), col(0xdfe9f3)], ground: [col(0x0e1219), col(0x76705e), col(0x8a8f7a)],
};
const POINT_I = 5;                                    // interior point light intensity (cd-ish; decay 2 → ≈ 1,2 at 2 m) — 16 blew the rooms out
const smooth = t => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };
const mix3 = (out, [night, low, day], k, warm) => out.copy(day).lerp(low, warm).lerp(night, 1 - k);

function skyDome() {
  const mat = new THREE.ShaderMaterial({
    uniforms: { topColor: { value: col(0x9dbde0) }, horizonColor: { value: col(0xe8eef4) }, exponent: { value: 0.55 } },
    vertexShader: 'varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: 'uniform vec3 topColor, horizonColor; uniform float exponent; varying vec3 vW; void main(){ float h = max(normalize(vW - vec3(10.0, 0.0, 6.0)).y, 0.0); gl_FragColor = vec4(mix(horizonColor, topColor, pow(h, exponent)), 1.0);\n#include <colorspace_fragment>\n}',
    side: THREE.BackSide, depthWrite: false, fog: false, toneMapped: false,
  });
  const m = new THREE.Mesh(new THREE.SphereGeometry(180, 32, 16), mat); m.position.copy(TARGET); m.name = 'sky'; m.renderOrder = -1; m.frustumCulled = false;
  return m;
}

export class Lighting {
  /** opts = { shadows, maxPointLights } */
  constructor(scene, { shadows = true, maxPointLights = 8 } = {}) {
    this.scene = scene; this.shadows = shadows; this.maxPointLights = maxPointLights;
    this.hours = 15; this.doy = 172; this.override = null; this.lampMaterial = null; this.points = [];
    this.hemi = new THREE.HemisphereLight(0xdfe9f3, 0x8a8f7a, 1.2); scene.add(this.hemi);
    this.ambient = new THREE.AmbientLight(0xffffff, 0.45); scene.add(this.ambient);
    this.sun = new THREE.DirectionalLight(0xfff4e5, 2.2); this.sun.castShadow = shadows;
    this.sun.shadow.mapSize.set(3072, 3072);
    Object.assign(this.sun.shadow.camera, { left: -30, right: 40, top: 40, bottom: -35, near: 1, far: 160 });
    this.sun.shadow.bias = -0.0002; this.sun.shadow.normalBias = 0.03; // avoids acne seams where coplanar wall pieces meet
    this.sun.target.position.copy(TARGET); scene.add(this.sun, this.sun.target);
    this.moon = new THREE.DirectionalLight(0x9fb4d8, 0); this.moon.position.set(TARGET.x + 25, 35, TARGET.z - 30); this.moon.target.position.copy(TARGET); scene.add(this.moon, this.moon.target);
    this.sky = skyDome(); scene.add(this.sky);
    this.lights = new THREE.Group(); this.lights.name = 'interior-lights'; scene.add(this.lights);
    this.update();
  }
  /** Interior point lights at the ceiling lamps of the largest rooms (lamps = [{x, y, z (mm), area}]); the lamp material glows at night. */
  setLamps(lamps, lampMaterial) {
    this.lampMaterial = lampMaterial;
    for (const l of [...lamps].sort((a, b) => b.area - a.area).slice(0, this.maxPointLights)) {
      const p = new THREE.PointLight(0xffe4b8, 0, 8, 2); p.position.set(l.x / 1000, (l.z - 400) / 1000, l.y / 1000); p.name = 'lamp:' + l.room; this.lights.add(p); this.points.push(p);
    }
    this.update();
  }
  set(hours, doy) { this.hours = hours; this.doy = doy; this.update(); }
  /** Current sun state for the UI. */
  get state() { const s = sunPosition(this.hours, this.doy), t = sunTimes(this.doy); return { ...s, rise: t.rise, set: t.set, hours: this.hours, doy: this.doy }; }
  update() {
    const s = sunPosition(this.hours, this.doy), el = s.elevation;
    const k = smooth((el + 3) / 13);                 // 0 = night … 1 = day (from −3° to +10°)
    const warm = 1 - smooth((el - 1) / 12);          // 1 = sun at the horizon, 0 above ≈ 13° (a 10° morning sun is only slightly warm)
    this.sun.color.copy(P.sunDay).lerp(P.sunLow, warm);
    this.sun.intensity = 2.4 * k; this.sun.visible = k > 0.001;
    if (this.override !== 'front') this.sun.position.set(TARGET.x + s.x * 60, TARGET.y + s.y * 60, TARGET.z + s.z * 60);
    this.sun.castShadow = this.shadows && el > 2 && this.override !== 'flat';
    mix3(this.hemi.color, P.hemi, k, warm); mix3(this.hemi.groundColor, P.ground, k, warm);
    this.hemi.intensity = (this.override === 'flat' ? 1.6 : 1.2) * (0.25 + 0.75 * k);
    this.ambient.intensity = 0.12 + 0.33 * k;
    this.moon.intensity = 0.18 * (1 - k); this.moon.visible = k < 0.999;
    mix3(this.sky.material.uniforms.topColor.value, P.skyTop, k, warm); mix3(this.sky.material.uniforms.horizonColor.value, P.skyHor, k, warm);
    this.scene.background = this.sky.material.uniforms.horizonColor.value;
    const on = 1 - smooth((el - 1) / 7);             // lamps: full below +1°, off above +8°
    if (this.lampMaterial) this.lampMaterial.emissiveIntensity = 1.4 * on;
    for (const p of this.points) { p.intensity = POINT_I * on; p.visible = on > 0.02; }
    mats.led.emissiveIntensity = 0.5 + 1.3 * on; mats.ledWash.color.setScalar(0.3 + 0.7 * on); // stair LEDs: always on, full at dusk
    this.lampsOn = on;
  }
}
