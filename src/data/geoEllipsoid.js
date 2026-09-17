/**
 * Exact ellipsoidal distance — the Cesium-backed tier of the spatial authority.
 *
 * This lives in its own module, next to `geo.js` rather than inside it, for one
 * concrete reason: several portable entry points (`pkg.exports`: the source
 * adapters, the transit and regional services) are reachable from headless
 * code, and `scripts/check-import-directions.mjs` forbids those from reaching
 * Cesium. Keeping the ellipsoid maths here means `geo.js` is dependency-free —
 * plain arithmetic any surface can import — and only callers that genuinely
 * want the WGS84 ellipsoid pay for Cesium.
 *
 * Both tiers answer the same question with different figures of the Earth; see
 * `geo.js` for the rule about which one a number is allowed to come from.
 *
 * @module data/geoEllipsoid
 */

import * as Cesium from 'cesium';

/**
 * Exact ellipsoidal distance in metres (WGS84), for numbers that are REPORTED
 * as evidence.
 *
 * Spherical `surfaceM` is the fast path and is what filters and scans use. A
 * number a user is invited to trust — a measurement, a briefed figure — comes
 * from here instead.
 *
 * **The two tiers do not agree, and the difference is not a rounding error.**
 * They are two different figures of the Earth:
 *
 *  - One degree of longitude at the equator is 111 319.5 m on WGS84 and
 *    111 194.9 m on the mean sphere — 124 m apart, about 0.11%.
 *  - Across latitudes the gap is bounded by the equatorial-versus-polar radius
 *    spread, roughly 0.5% at worst, so the same place can differ by over a
 *    kilometre at a 250 km range depending on which tier answered.
 *
 * That is exactly why the choice is a rule rather than a convenience: a
 * filtered set and a published figure must not silently come from different
 * planets. Filters use `surfaceM`; anything printed as a measurement uses
 * `geodesicM`.
 *
 * @returns {number} Metres.
 */
export function geodesicM(lat1, lon1, lat2, lon2) {
  if (
    !Number.isFinite(lat1) ||
    !Number.isFinite(lon1) ||
    !Number.isFinite(lat2) ||
    !Number.isFinite(lon2)
  )
    return NaN;
  const a = Cesium.Cartographic.fromDegrees(lon1, lat1);
  const b = Cesium.Cartographic.fromDegrees(lon2, lat2);
  return new Cesium.EllipsoidGeodesic(a, b).surfaceDistance;
}
