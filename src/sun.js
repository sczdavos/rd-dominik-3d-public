// sun.js — sun position for Vysoký Újezd (≈ 49,95 N, 14,20 E) from date + local clock time (pure, Node-testable).
// NOAA-style approximation (declination + equation of time), accurate to ≈ 1° — plenty for lighting.
// World frame: model −Z = sheet top (here real west), +X = sheet right (real north), up = +Y. Azimuth is measured from
// true north, clockwise; the direction vector is turned into the model frame by site.northRot.
export const SITE_LOC = { lat: 49.95, lon: 14.20, zoneMeridian: 15, northRot: 87.93 }; // Vysoký Újezd u Berouna (≈); CET = UTC+1 → 15° E;
// northRot = site.survey.x_axis_azimuth_from_east_deg: the model keeps the DSP sheet frame, whose +x points to true north
// (2,07° east of it), so model −Z is real west; the world direction is the true azimuth turned by northRot.

const rad = d => d * Math.PI / 180, deg = r => r * 180 / Math.PI;

/** Day of year (1–366) for a month (1–12) and day. */
export function dayOfYear(month, day, year = 2026) {
  const cum = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  return cum[month - 1] + day + (leap && month > 2 ? 1 : 0);
}
/** Central-European summer time? (last Sunday of March → last Sunday of October, by day of year, 2026.) */
export function isDST(doy, year = 2026) {
  const lastSunday = m => { const d = new Date(Date.UTC(year, m, 0)); return dayOfYear(m, d.getUTCDate() - d.getUTCDay(), year); }; // month m (1-based) → last Sunday's doy
  return doy >= lastSunday(3) && doy < lastSunday(10);
}
/**
 * Sun position. hours = local clock time (CET / CEST as shown on a clock), doy = day of year.
 * Returns { elevation, azimuth } in degrees and the unit direction { x, y, z } toward the sun.
 */
export function sunPosition(hours, doy, site = SITE_LOC) {
  const clock = hours - (isDST(doy) ? 1 : 0);                                // → standard time (UTC+1)
  const B = rad(360 / 365 * (doy - 81));
  const eot = 9.87 * Math.sin(2 * B) - 7.53 * Math.cos(B) - 1.5 * Math.sin(B); // equation of time, minutes
  const decl = rad(23.44) * Math.sin(B);
  const solar = clock + (4 * (site.lon - site.zoneMeridian) + eot) / 60;    // solar time, hours
  const H = rad(15 * (solar - 12)), phi = rad(site.lat);
  const sinEl = Math.sin(phi) * Math.sin(decl) + Math.cos(phi) * Math.cos(decl) * Math.cos(H);
  const el = Math.asin(Math.max(-1, Math.min(1, sinEl)));
  let cosAz = (Math.sin(decl) - sinEl * Math.sin(phi)) / (Math.cos(el) * Math.cos(phi));
  cosAz = Math.max(-1, Math.min(1, cosAz));
  let az = Math.acos(cosAz); if (H > 0) az = 2 * Math.PI - az;              // afternoon → west of south
  const azw = az + rad(site.northRot || 0); // world azimuth (from model −Z, clockwise)
  return { elevation: deg(el), azimuth: deg(az), x: Math.cos(el) * Math.sin(azw), y: Math.sin(el), z: -Math.cos(el) * Math.cos(azw) };
}
/** Sunrise / sunset clock hours (elevation 0) for a day, by bisection over the sun curve. */
export function sunTimes(doy, site = SITE_LOC) {
  const f = h => sunPosition(h, doy, site).elevation;
  const solve = (a, b) => { for (let i = 0; i < 40; i++) { const m = (a + b) / 2; (f(m) < 0) === (f(a) < 0) ? a = m : b = m; } return (a + b) / 2; };
  const noon = 12 + (isDST(doy) ? 1 : 0);
  return { rise: solve(0, noon), set: solve(noon, 24) };
}
