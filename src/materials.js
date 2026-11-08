// materials.js — shared materials ("clean archviz": white / grey render, stone cladding, anthracite aluminium, oak, concrete).
import * as THREE from 'three';

const std = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.9, ...extra });

export const mats = {
  ext:      std(0xf4f2ee),
  extGrey:  std(0xbdbcb8),                         // grey silicone render (D.1.1.5 legend 2): 1 NP and the one-storey parts
  stone:    std(0x3a3a3c, { roughness: 0.85 }),      // dark stone cladding (legend 3) on the piers between the large windows
  blind:    std(0x3d4044, { roughness: 0.6, metalness: 0.3 }), // external venetian blind box
  ceiling:  std(0xf2f1ee),                          // lowered SDK ceilings
  int:      std(0xeceae5),
  glass:    std(0xa9cbe3, { roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false }),
  lamely:   std(0xb8895a, { roughness: 0.75 }),   // oak slats
  wood:     std(0xb8895a, { roughness: 0.75 }),
  frame:    std(0x33363a, { roughness: 0.5, metalness: 0.4 }), // anthracite aluminium
  doorIn:   std(0xf7f6f3, { roughness: 0.6 }),
  doorOut:  std(0x3a3d41, { roughness: 0.5, metalness: 0.3 }),
  chrome:   std(0xd9dcdf, { roughness: 0.25, metalness: 0.9 }),
  floorIn:  std(0xc9a06a, { roughness: 0.8 }),
  floorTile: std(0xc9c3b8, { roughness: 0.7 }),   // ceramic tiles (DSP room tables), warm grey-beige so the white walls read in plan
  floorOut: std(0xb9bcbf, { roughness: 0.95 }),
  floorGar: std(0x9a9da0, { roughness: 0.95 }),
  deck:     std(0xa87b52, { roughness: 0.85 }),
  slab:     std(0xd8d8d6),
  roof:     std(0x8e9196, { roughness: 0.95 }),
  green:    std(0x6f8a4b, { roughness: 1 }),
  mass:     std(0xbfc3c8),
  ground:   std(0xa7b78f, { roughness: 1 }),
  lamp:     std(0xf6f2ea, { roughness: 0.6, emissive: 0xffe4b8, emissiveIntensity: 0 }), // ceiling lamps: glow at night (lighting.js)
  claddingBack: std(0x2f2a26, { roughness: 0.95 }),   // dark board behind the timber slat cladding
  cabinet:  std(0xd8d0c2, { roughness: 0.65 }),       // kitchen wall cabinets to the ceiling, corner unit, hidden pantry door: warm greige, visibly different from the white base cabinets
  cabinetBox: std(0xc6bdae, { roughness: 0.7 }),      // carcass behind the cabinet fronts (shows in the 4 mm reveals)
  mesh:     std(0x8a9488, { roughness: 0.8, transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false }), // wire mesh of the removable fence / hen run
  led:      std(0xfff0d8, { roughness: 0.4, emissive: 0xffc27a, emissiveIntensity: 1.2 }), // LED strip under every stair tread nose (lighting.js dims it by day)
  ledWash:  new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }), // warm glow fading down each riser (vertex colours → not merged)
};
