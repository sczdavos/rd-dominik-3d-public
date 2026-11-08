// config.js — level/height assumptions shared by geometry, collision and the viewer (pure, no three.js).
// All values in millimetres. RD Vysoký Újezd (DSP LUCERN, sections D.1.1.4): see ASSUMPTIONS.md.
export const CONST = {
  PLINTH: 500,        // exterior walls extended this far below their z0 so the house doesn't float above terrain
  FLOOR_T: 20,        // finished floor layer thickness on upper floors (slab is separate)
  GROUND_FLOOR_T: 300,// ground-floor room floor thickness (acts as the ground slab)
  Z2: 3050,           // 2 NP finished floor (17 × 179,4); fallback when the model has no np2
  SLAB_T: 450,        // slab between floors (P3/P4: 130 + 25 + 240 + 52,5): 1 NP ceiling +2,600 → 2 NP floor +3,050
  ROOF_T: 520,        // flat roof SCH1 (PVC, insulation, beams, SDK): top at 2 NP ceiling + ROOF_T
  TERRACE_Z: -50,     // terrace deck −0,050 (D.1.1.4/5)
  DECK_T: 30,         // walkable deck on flat roofs (none in this house)
  ROOF_DECK_Z: 3020,  // unused (no walkable roofs); kept for roomFloorZ of upper outdoor rooms
  ROOM_FLOOR_Z: {},   // every 1 NP room at ±0,000 (garage and workshop too, DSP)
  OUTDOOR_Z: {},      // no outdoor rooms in the model (the terrace deck is site paving, pipeline s05)
  GLASS_WALL_BAND: 250,
  CHIMNEY_TOP: 0,     // no chimney
  GROUND: -250,       // finished terrain around the house (U.T. 417,450)
  CLADDING: [],       // no timber cladding
  // façade skins on the outer face of exterior walls (D.1.1.5 legend): (2) grey silicone render up to `grey[id]`,
  // (3) stone cladding on the piers between the openings of the walls in `stone` (the S02 walls of the plans);
  // everything else is (1) white render.
  FACADE: {
    grey: { zap1_jih: 3350, zap1: 2500, vych1_jih: 3350, vych1: 2500, jih1: 3350, gar_zap: 3350, gar_jih: 3350, gar_sev: 3350, gar_vych: 3350 },
    stone: ['vych1_jih', 'vych1', 'vych2', 'sev2', 'gar_sev'],
  },
  // external venetian blinds (D.1.1.2/3 "Ex. žaluzie"): a box at the top of these openings, outside
  SLAB_CHAMFER: true, // DSP D.1.1.4 B-B: the 1 NP / 2 NP slab edge is bevelled over the first treads (+2,600 above the first riser → 2 NP floor at the void edge)
  BLINDS: ['o_obyv_od6', 'o_obyv_hs', 'o_obyv_od4', 'o_prac_od3', 'o2_loz_od12', 'o2_pok213_od11', 'o2_pok212_od10'],
  BLIND_H: 250,
  STAIR_LEDS: false,  // no LED strips under the stair noses (not in the DSP)
  LAMP_TWO_ABOVE: 18, // rooms larger than this (m²) get two ceiling lamps
};

/** Finished-floor height (mm, absolute) of a room. */
export function roomFloorZ(r, zf) {
  if (r.outdoor) return zf === 0 ? (CONST.OUTDOOR_Z[r.id] ?? CONST.TERRACE_Z) : CONST.ROOF_DECK_Z + CONST.DECK_T;
  return zf + (CONST.ROOM_FLOOR_Z[r.id] || 0);
}

/** Ceiling height (mm above the level floor) of a room: the lowered ceiling `ceil` if the model has one. */
export const roomCeil = (r, L) => r.ceil || L.height || 2600;
