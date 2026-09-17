/**
 * The canonical spatial authority.
 *
 * Every geographic distance, proximity test and ring-containment decision in
 * the application resolves to this module. It owns the decisions that had
 * drifted across nine implementations: argument order, Earth radius, units,
 * formula, and WHICH METRIC answers which question.
 *
 * ## Why one module instead of one formula
 *
 * `SURFACE` and `SLANT` answer genuinely different questions — "how far apart
 * are these on the ground?" versus "how far is this from the sensor?" — so
 * collapsing them to a single formula would break line-of-sight reasoning that
 * needs the 3D separation. What must be single-valued is not the formula but
 * the AUTHORITY: `distanceM` resolves the metric, and every caller that needs a
 * user-facing distance asks it rather than deriving its own.
 *
 * ## Why this exists (the defect it prevents)
 *
 * `src/layers/awareness/queries.js` documents a trial in which the Contacts
 * panel said 111 and the voice analyst said 15 for the same question, because
 * each computed proximity its own way. They were unified so they "cannot drift
 * again". That fix was correct and local; this module is the same rule applied
 * to distance itself, which had accumulated nine implementations — two of them
 * disagreeing about whether "within 250 km" includes altitude, with nothing in
 * any payload saying which had answered.
 *
 * ## Argument order (decided, not conventional)
 *
 * Point arguments are `(lat, lon)` — NEVER `(lon, lat)`. The one prior
 * exception was a private helper in `naturalEarthRegions.js`, retired here.
 *
 * Ring vertices are the other way round: `[[lon, lat], ...]`, matching the
 * GeoJSON convention the bundled Natural Earth pack uses. A ring is a DATA
 * FORMAT, not an argument list, so it keeps the format's order. Every function
 * taking a ring says so in its signature.
 *
 * ## The exact tier lives next door
 *
 * `geodesicM` (WGS84, Cesium-backed) lives in `data/geoEllipsoid.js`, not here.
 * That split is deliberate: this module has NO imports at all, so any headless
 * or Cesium-free entry point can use the authority, and only a caller that
 * genuinely wants the ellipsoid pays for the rendering dependency. Both tiers
 * answer the same question with different figures of the Earth — see the note
 * on `distanceM`.
 *
 * ## Units
 *
 * Metres in, metres out. There is deliberately no `...Km` export: kilometre
 * formatting is a display concern, and a kilometre value must never
 * propagate into a computation.
 *
 * @module data/geo
 */

/**
 * Canonical spherical Earth radius, metres (IUGG mean radius).
 *
 * One radius, chosen once. The repository previously carried three values —
 * 6371 km, 6371000 m (which are THE SAME radius) and this one — and the only
 * real difference between them was 8.8 m, i.e. about 0.35 m at 250 km. The
 * choice of value barely matters; having exactly one does.
 */
export const EARTH_RADIUS_M = 6371008.8;

const D2R = Math.PI / 180;

/** The two metrics. See `distanceM`. */
export const METRIC = Object.freeze({
  /** Great-circle distance across the sphere — "how far apart on the ground". */
  SURFACE: 'surface',
  /** Straight-line distance through space, altitude included — "how far from the sensor". */
  SLANT: 'slant',
});

/** The default metric. User-facing geographic windows, proximity and ordering. */
export const DEFAULT_METRIC = METRIC.SURFACE;

/** @param {number} deg @returns {number} */
export function toRadians(deg) {
  return deg * D2R;
}

/** @param {number} rad @returns {number} */
export function toDegrees(rad) {
  return rad / D2R;
}

/** A finite number, or null. Keeps NaN out of distance results. */
function finiteOrNull(value) {
  return Number.isFinite(value) ? Number(value) : null;
}

/**
 * Great-circle (surface) distance in metres between two latitude/longitude
 * points, on a sphere of `EARTH_RADIUS_M`.
 *
 * Allocation-free: takes primitives and returns a number, because this runs
 * inside proximity scans over tens of thousands of records. Do not "tidy" it
 * into an object-taking function.
 *
 * @param {number} lat1 @param {number} lon1
 * @param {number} lat2 @param {number} lon2
 * @returns {number} Metres, or NaN if any input is not finite.
 */
export function surfaceM(lat1, lon1, lat2, lon2) {
  if (
    !Number.isFinite(lat1) ||
    !Number.isFinite(lon1) ||
    !Number.isFinite(lat2) ||
    !Number.isFinite(lon2)
  )
    return NaN;
  const p1 = lat1 * D2R;
  const p2 = lat2 * D2R;
  const dp = (lat2 - lat1) * D2R;
  const dl = (lon2 - lon1) * D2R;
  const sinDp = Math.sin(dp / 2);
  const sinDl = Math.sin(dl / 2);
  const h = sinDp * sinDp + Math.cos(p1) * Math.cos(p2) * sinDl * sinDl;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(Math.min(1, h)));
}

/**
 * Straight-line (slant) distance in metres between two points, altitude
 * included.
 *
 * Throws away no information the caller supplied: when either height is
 * missing this degrades to the surface distance and REPORTS that it did, so a
 * caller can never mistake a degraded answer for a slant one. Silently
 * substituting a different quantity is the failure mode this exists to prevent.
 *
 * @param {number} lat1 @param {number} lon1 @param {number} [height1M=0]
 * @param {number} lat2 @param {number} lon2 @param {number} [height2M=0]
 * @returns {{distanceM: number, metricResolved: string, degraded: string|null}}
 */
export function slantM(lat1, lon1, height1M, lat2, lon2, height2M) {
  const h1 = finiteOrNull(height1M);
  const h2 = finiteOrNull(height2M);
  const surface = surfaceM(lat1, lon1, lat2, lon2);
  if (h1 === null || h2 === null) {
    return {
      distanceM: surface,
      metricResolved: METRIC.SURFACE,
      degraded: 'missing-height',
    };
  }
  // Spherical ECEF, matching the sphere the SURFACE metric uses. Using
  // Cesium's ellipsoidal helper here would put the two metrics on different
  // figures of the Earth, so a caller comparing them would be comparing two
  // different planets.
  const p1 = lat1 * D2R;
  const p2 = lat2 * D2R;
  const l1 = lon1 * D2R;
  const l2 = lon2 * D2R;
  const r1 = EARTH_RADIUS_M + h1;
  const r2 = EARTH_RADIUS_M + h2;
  const c1 = Math.cos(p1);
  const c2 = Math.cos(p2);
  const dx = r1 * c1 * Math.cos(l1) - r2 * c2 * Math.cos(l2);
  const dy = r1 * c1 * Math.sin(l1) - r2 * c2 * Math.sin(l2);
  const dz = r1 * Math.sin(p1) - r2 * Math.sin(p2);
  return {
    distanceM: Math.sqrt(dx * dx + dy * dy + dz * dz),
    metricResolved: METRIC.SLANT,
    degraded: null,
  };
}

/**
 * THE distance call. Answers in metres under the requested metric.
 *
 * Defaults to `SURFACE`. Pass `metric: METRIC.SLANT` only when physical
 * sensor-to-object separation is genuinely the question — line-of-sight,
 * camera frusta, overpass geometry. A surface answer is stable when a feed
 * momentarily reports altitude as null; a slant answer is not, and an unstable
 * count is worse than a slightly different one.
 *
 * @param {number} lat1 @param {number} lon1
 * @param {number} lat2 @param {number} lon2
 * @param {object} [options]
 * @param {string} [options.metric=METRIC.SURFACE]
 * @param {number} [options.height1M] Required for SLANT.
 * @param {number} [options.height2M] Required for SLANT.
 * @returns {number} Metres. NaN when an input is not finite.
 */
export function distanceM(lat1, lon1, lat2, lon2, options = {}) {
  const metric = options.metric || DEFAULT_METRIC;
  if (metric === METRIC.SLANT)
    return slantM(lat1, lon1, options.height1M, lat2, lon2, options.height2M)
      .distanceM;
  return surfaceM(lat1, lon1, lat2, lon2);
}

/**
 * `distanceM` for `{lat, lon, heightM?}` points. Convenience for call sites
 * that already hold point objects; NOT for hot loops, where the primitives
 * version avoids two allocations per comparison.
 *
 * @returns {number} Metres.
 */
export function distanceBetween(a, b, options = {}) {
  if (!a || !b) return NaN;
  return distanceM(a.lat, a.lon, b.lat, b.lon, {
    ...options,
    height1M: options.height1M ?? a.heightM,
    height2M: options.height2M ?? b.heightM,
  });
}


/**
 * Initial bearing from point 1 to point 2, degrees clockwise from north.
 * @returns {number} Degrees in [0, 360).
 */
export function bearingDeg(lat1, lon1, lat2, lon2) {
  const p1 = lat1 * D2R;
  const p2 = lat2 * D2R;
  const dl = (lon2 - lon1) * D2R;
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return (Math.atan2(y, x) / D2R + 360) % 360;
}

/**
 * Point reached by travelling `distanceM` along `bearing` (great-circle).
 * @returns {{lat: number, lon: number}}
 */
export function destinationPoint(lat, lon, bearing, distanceM) {
  const ad = distanceM / EARTH_RADIUS_M;
  const p1 = lat * D2R;
  const l1 = lon * D2R;
  const brg = bearing * D2R;
  const sinP2 =
    Math.sin(p1) * Math.cos(ad) + Math.cos(p1) * Math.sin(ad) * Math.cos(brg);
  const p2 = Math.asin(Math.min(1, Math.max(-1, sinP2)));
  const l2 =
    l1 +
    Math.atan2(
      Math.sin(brg) * Math.sin(ad) * Math.cos(p1),
      Math.cos(ad) - Math.sin(p1) * Math.sin(p2),
    );
  // Re-wrap through the canonical seam helper so a caller never receives a
  // longitude outside [-180, 180) from a spatial function.
  return { lat: p2 / D2R, lon: wrapDegrees(l2 / D2R) };
}

/**
 * An angle-formed longitude brought back into [-180, 180).
 *
 * A value already in range is returned UNCHANGED rather than pushed through the
 * modulo, which is only exact in binary for some inputs. The seam is the only
 * place the arithmetic is needed, so it is the only place that pays for it.
 * (Same reasoning as `drawMode.wrapLongitude`, which this supersedes for
 * spatial callers.)
 *
 * @param {number} lon
 * @returns {number}
 */
export function wrapDegrees(lon) {
  if (!Number.isFinite(lon)) return lon;
  if (lon >= -180 && lon < 180) return Object.is(lon, -0) ? 0 : lon;
  const value = ((((lon + 180) % 360) + 360) % 360) - 180;
  return Object.is(value, -0) ? 0 : value;
}

/**
 * Whether two points are within `radiusM` of each other. Radius is a SURFACE
 * radius by default, matching `distanceM`.
 * @returns {boolean}
 */
export function withinM(lat1, lon1, lat2, lon2, radiusM, options = {}) {
  if (!Number.isFinite(radiusM) || radiusM < 0) return false;
  const d = distanceM(lat1, lon1, lat2, lon2, options);
  return Number.isFinite(d) && d <= radiusM;
}

/**
 * Nearest items to a reference point, in metres.
 *
 * The reference's trigonometry is hoisted OUT of the loop: the reference is one
 * point and the items are many, so per-item cost is what matters. Callers
 * supply `items` with numeric `lat`/`lon`; non-finite or missing coordinates
 * are skipped rather than sorted to the end as spurious zeroes.
 *
 * @param {Array<object>} items
 * @param {{lat: number, lon: number}} reference
 * @param {number} radiusM
 * @param {object} [options]
 * @param {number} [options.cap=Infinity] Maximum results.
 * @param {(item: object) => number} [options.getLat]
 * @param {(item: object) => number} [options.getLon]
 * @param {string} [options.metric=METRIC.SURFACE]
 * @returns {Array<{item: object, distanceM: number}>} Ascending by distance.
 */
export function nearbyM(items, reference, radiusM, options = {}) {
  const out = [];
  if (!Array.isArray(items) || !items.length || !reference) return out;
  const { cap = Infinity, getLat, getLon } = options;
  const radius = Number.isFinite(radiusM) && radiusM >= 0 ? radiusM : Infinity;
  const useGetters = Boolean(getLat || getLon);
  const latOf = getLat || ((item) => item.lat);
  const lonOf = getLon || ((item) => item.lon);
  // Hoisted: the reference is one point and the items are many, so every trig
  // call that depends only on the reference is computed once.
  const rLat = reference.lat * D2R;
  const rLon = reference.lon * D2R;
  const cosRLat = Math.cos(rLat);
  for (const item of items) {
    // Direct property reads unless the caller supplied accessors: this loop
    // runs per record per frame, and a per-item callback shows up in profiles.
    const lat = useGetters ? latOf(item) : item.lat;
    const lon = useGetters ? lonOf(item) : item.lon;
    const p = lat * D2R;
    const dl = lon * D2R - rLon;
    const sinDp = Math.sin((p - rLat) / 2);
    const sinDl = Math.sin(dl / 2);
    const h = sinDp * sinDp + cosRLat * Math.cos(p) * sinDl * sinDl;
    // `d <= radius` is false for NaN, so a record with a missing or non-finite
    // coordinate is skipped here without a separate validation pass.
    const d = 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(Math.min(1, h)));
    if (!(d <= radius)) continue;
    out.push({ item, distanceM: d });
  }
  out.sort((a, b) => a.distanceM - b.distanceM);
  return Number.isFinite(cap) ? out.slice(0, Math.max(0, Math.floor(cap))) : out;
}

/* ────────────────────────── ring containment ────────────────────────── */

/**
 * Ring classification, cached per ring array.
 *
 * Classification scans the ring once (O(n)) and then every containment test
 * reuses it, which is what keeps the hot path — one ring tested against
 * thousands of records — at the same cost as before. A `WeakMap` lets the pack
 * rings be collected when the pack is; nothing here outlives its input.
 *
 * @type {WeakMap<Array, {mode: string, ring?: Array<number>, min?: number, max?: number}>}
 */
const RING_CLASS = new WeakMap();

const MODE_PLANAR = 'planar';
const MODE_UNWRAPPED = 'unwrapped';

/**
 * Decide how a ring must be tested.
 *
 * Two cases, and the distinction is the whole point:
 *
 *  - **Not crossing the antimeridian** — the original planar ray cast is exact
 *    and cheap. Unchanged behaviour, unchanged cost. This is almost every ring.
 *  - **Crossing, local** — a ring that merely straddles the seam, such as an
 *    area of interest drawn over Fiji or the Aleutians. Naive ray casting is
 *    WRONG for these: it treats a segment spanning 179° to -179° as crossing
 *    ~358° of longitude. Unwrapping makes the ring continuous, and testing each
 *    of the point's longitude images inside the unwrapped bounds recovers the
 *    correct answer. This is the case the previous implementation failed: on a
 *    rectangle spanning 179°E to 179°W it answered five of eight probe points
 *    wrongly, including reporting a point in the Gulf of Guinea as inside.
 *  - **Crossing, encircling** — a ring that wraps the axis (|winding| ≈ 360°),
 *    such as Antarctica or the Arctic Ocean. These keep the planar test, and
 *    that is not laziness: unwrapping is NOT faithful for them, because their
 *    interior is defined around a pole, which is a single point on the sphere
 *    but an entire latitude line in any flattened view. Measured: the four
 *    pole-encircling and band-shaped rings all answer correctly with the planar
 *    test, including the Southern Ocean band and East Antarctica's 0°-to-180°
 *    half. (Verified against the shipped packs; see
 *    `naturalEarthRegions.test.mjs`, which pins those answers.)
 *
 * One consequence of keeping the planar test, recorded here because it looks
 * like a bug and is not: a ring with a boundary edge running ALONG the seam
 * (East Antarctica has meridian edges at exactly ±180° and 0°) answers
 * differently for lon 179.99 and lon -179.99. Those are two different places,
 * on opposite sides of a real boundary, one degree apart from the unambiguous
 * answers `pointInRing(ring, -88, 179) === true` and `-179 === false`. Points
 * within a vertex-width of a boundary are not defined by an even-odd test at
 * all; do not build logic that depends on them.
 *
 * The discriminator is WINDING: the total signed longitude travelled around the
 * ring. A ring that encloses a pole winds exactly once (|winding| ≈ 360°); a
 * local ring that merely crosses the seam winds zero times. Measured on the
 * shipped pack: Antarctica 359.8°, East Antarctica 359.8°, Polar Plateau
 * 360.0°, Arctic Ocean -359.8°, Southern Ocean -359.8°; a crossing rectangle
 * spanning 179E..181E measures 0.0°.
 *
 * @param {Array<Array<number>>} ring `[[lon, lat], ...]`
 */
function classifyRing(ring) {
  const cached = RING_CLASS.get(ring);
  if (cached) return cached;
  // The x-coordinates are extracted once here rather than per test. In the hot
  // path a single ring is tested against thousands of records, so a per-call
  // `map` would allocate once per record — which is exactly the regression this
  // classification exists to avoid.
  const lons = new Array(ring.length);
  for (let i = 0; i < ring.length; i += 1) lons[i] = ring[i][0];

  let classification = { mode: MODE_PLANAR, lons };
  let crosses = false;
  for (let i = 1; i < ring.length; i += 1) {
    if (Math.abs(ring[i][0] - ring[i - 1][0]) > 180) {
      crosses = true;
      break;
    }
  }
  // The closing edge counts too.
  if (
    !crosses &&
    ring.length > 2 &&
    Math.abs(ring[0][0] - ring[ring.length - 1][0]) > 180
  )
    crosses = true;

  if (crosses) {
    const unwrapped = new Array(ring.length);
    let previous = ring[0][0];
    unwrapped[0] = previous;
    let min = previous;
    let max = previous;
    for (let i = 1; i < ring.length; i += 1) {
      let lon = ring[i][0];
      while (lon - previous > 180) lon -= 360;
      while (lon - previous < -180) lon += 360;
      unwrapped[i] = lon;
      if (lon < min) min = lon;
      if (lon > max) max = lon;
      previous = lon;
    }
    const winding = Math.abs(unwrapped[unwrapped.length - 1] - unwrapped[0]);
    const span = max - min;
    // Encircling rings keep the planar test. The span guard is belt-and-braces
    // for a ring wide enough that two of a point's longitude images could fall
    // inside it, which would make "any image inside" unsound.
    if (winding < 180 && span < 360)
      classification = { mode: MODE_UNWRAPPED, lons: unwrapped, min, max };
  }
  RING_CLASS.set(ring, classification);
  return classification;
}

/** Even-odd ray cast. `lons[i]` is the x of vertex `i`, `ring[i][1]` its y. */
function rayCast(ring, lons, lat, lon) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const yi = ring[i][1];
    const yj = ring[j][1];
    if (yi > lat !== yj > lat) {
      const x = ((lons[j] - lons[i]) * (lat - yi)) / (yj - yi) + lons[i];
      if (lon < x) inside = !inside;
    }
  }
  return inside;
}

/**
 * Whether a point lies inside a ring, correctly across the antimeridian.
 *
 * This is the replacement for `naturalEarthRegions.pointInRing`, which is now
 * a re-export of it. The old implementation is exact for the rings it was
 * written against and wrong for a ring that straddles the seam: on a rectangle
 * spanning 179°E to 179°W it answered incorrectly for five of eight probe
 * points, including reporting a point in the Gulf of Guinea as inside.
 *
 * Points exactly on the boundary, and points at a vertex, are not defined by an
 * even-odd test and may return either answer; do not build logic that depends
 * on the seam of a boundary.
 *
 * @param {Array<Array<number>>} ring `[[lon, lat], ...]` — GeoJSON vertex order.
 * @param {number} lat Point latitude, degrees.
 * @param {number} lon Point longitude, degrees.
 * @returns {boolean}
 */
export function ringContains(ring, lat, lon) {
  if (!Array.isArray(ring) || ring.length < 3) return false;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  const classification = classifyRing(ring);
  if (classification.mode === MODE_PLANAR)
    return rayCast(ring, classification.lons, lat, lon);
  const { lons: unwrapped, min, max } = classification;
  // The point has one image every 360°. At most one can fall inside a ring
  // narrower than a full turn, so testing the candidates that land in range is
  // exhaustive rather than a shortcut.
  for (let offset = -720; offset <= 720; offset += 360) {
    const candidate = lon + offset;
    if (candidate < min || candidate > max) continue;
    if (rayCast(ring, unwrapped, lat, candidate)) return true;
  }
  return false;
}

/**
 * Whether a point lies inside any of a feature's rings.
 *
 * The bundled Natural Earth pack stores a feature's geometry as a FLAT list of
 * rings (see `naturalEarthRegions.buildEntries`: it iterates `polygons` and
 * tests each with `pointInRing`), so containment is a disjunction, not an
 * outer-and-not-hole test. Repeated here so callers outside the region module
 * do not re-implement the loop.
 *
 * @param {Array<Array<Array<number>>>} rings
 * @param {number} lat @param {number} lon
 * @returns {boolean}
 */
/**
 * Spherical-excess area of a ring, in square metres.
 *
 * Takes `[lon, lat]` vertices like `ringContains`. Each edge contributes its
 * SHORT longitude delta rather than its raw one, which is what makes a ring
 * crossing the antimeridian measure as its real size instead of as almost the
 * whole planet. The sign is discarded: the packs store outer rings, and the
 * caller wants a size, not an orientation.
 *
 * This is the spherical-excess family (the same one the region pack uses for
 * its `areaKm2` metadata), not a planar area in degrees, which is meaningless
 * near the poles.
 *
 * @param {Array<Array<number>>} ring - `[lon, lat]` vertices.
 * @returns {number} Square metres, 0 for a degenerate ring, NaN for bad input.
 */
export function ringAreaM2(ring) {
  const n = Array.isArray(ring) ? ring.length : 0;
  if (n < 3) return 0;
  const toRad = (deg) => (deg * Math.PI) / 180;
  let sum = 0;
  for (let i = 0; i < n; i += 1) {
    const v = ring[i];
    const w = ring[(i + 1) % n];
    const lon1 = Number(v?.[0]);
    const lat1 = Number(v?.[1]);
    const lon2 = Number(w?.[0]);
    const lat2 = Number(w?.[1]);
    if (![lon1, lat1, lon2, lat2].every(Number.isFinite)) return NaN;
    // Shortest signed delta, so an edge crossing ±180 stays ~0 instead of ~360.
    const dLon = ((((lon2 - lon1) % 360) + 540) % 360) - 180;
    sum += toRad(dLon) * (2 + Math.sin(toRad(lat1)) + Math.sin(toRad(lat2)));
  }
  return Math.abs((sum * EARTH_RADIUS_M * EARTH_RADIUS_M) / 2);
}

export function anyRingContains(rings, lat, lon) {
  if (!Array.isArray(rings)) return false;
  for (const ring of rings) if (ringContains(ring, lat, lon)) return true;
  return false;
}
