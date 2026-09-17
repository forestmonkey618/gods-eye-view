import assert from 'node:assert/strict';
import test from 'node:test';

import { geodesicM } from './geoEllipsoid.js';
import {
  EARTH_RADIUS_M,
  METRIC,
  ringAreaM2,
  anyRingContains,
  bearingDeg,
  destinationPoint,
  distanceBetween,
  distanceM,
  nearbyM,
  ringContains,
  slantM,
  surfaceM,
  toDegrees,
  toRadians,
  withinM,
  wrapDegrees,
} from './geo.js';

const closeTo = (actual, expected, tolerance, message) =>
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${message || 'value'}: expected ${expected} ± ${tolerance}, got ${actual}`,
  );

test('geo: the canonical radius is a single decided value', () => {
  // Decision D2. The value is pinned deliberately: it is the one number every
  // distance in the application is multiplied by, and the point of this module
  // is that it is decided once rather than three times.
  assert.equal(EARTH_RADIUS_M, 6371008.8);
});

test('geo: surface distance matches a known meridian arc', () => {
  // One degree of latitude is about 111.2 km. A latitude-only pair isolates the
  // meridian so the expectation does not depend on any longitude convention.
  closeTo(surfaceM(0, 0, 1, 0), 111194.9, 60, 'one degree of latitude');
  closeTo(surfaceM(0, 0, 0, 1), 111194.9, 60, 'one degree of longitude at the equator');
  // At 60°N a degree of longitude is half its equatorial length.
  closeTo(surfaceM(60, 0, 60, 1), 55597.5, 60, 'one degree of longitude at 60N');
});

test('geo: surface distance is symmetric and zero for identical points', () => {
  assert.equal(surfaceM(51.5, -0.12, 51.5, -0.12), 0);
  closeTo(
    surfaceM(51.5, -0.12, 40.7, -74),
    surfaceM(40.7, -74, 51.5, -0.12),
    1e-6,
    'symmetry',
  );
});

test('geo: distanceM defaults to SURFACE', () => {
  const plain = distanceM(51.5, -0.12, 40.7, -74);
  assert.equal(plain, surfaceM(51.5, -0.12, 40.7, -74));
  // With heights supplied, SLANT is a genuinely different quantity. Without
  // them it degrades to SURFACE and says so, which is asserted separately.
  const slant = distanceM(51.5, -0.12, 40.7, -74, {
    metric: METRIC.SLANT,
    height1M: 11000,
    height2M: 11000,
  });
  assert.notEqual(slant, plain);
  assert.ok(Number.isFinite(slant));
});

test('geo: SLANT accounts for altitude, SURFACE does not', () => {
  // Directly above the reference, separated only by height: the surface
  // distance is zero and the slant distance is the height.
  const slant = slantM(0, 0, 10000, 0, 0, 0);
  assert.equal(slant.metricResolved, METRIC.SLANT);
  assert.equal(slant.degraded, null);
  closeTo(slant.distanceM, 10000, 1e-6, 'vertical separation');
  assert.equal(surfaceM(0, 0, 0, 0), 0);
});

test('geo: SLANT degrades to SURFACE and REPORTS that it did', () => {
  // The failure mode this guards: silently substituting a different quantity,
  // so a caller reports a surface distance as if it were sensor range.
  for (const [h1, h2] of [
    [null, 1000],
    [1000, undefined],
    [NaN, 0],
    [0, NaN],
  ]) {
    const result = slantM(51.5, -0.12, h1, 40.7, -74, h2);
    assert.equal(result.metricResolved, METRIC.SURFACE);
    assert.equal(result.degraded, 'missing-height');
    assert.equal(result.distanceM, surfaceM(51.5, -0.12, 40.7, -74));
  }
});

test('geo: SLANT is the chord, which is shorter than the arc at ground level', () => {
  const surface = surfaceM(0, 0, 0, 1);
  // Two points on the sphere: the straight line through space is shorter than
  // the great-circle arc. Small, but it is a real difference in the metric, not
  // a rounding artefact — and it is why "which is closest?" must name its
  // metric.
  const groundLevel = slantM(0, 0, 0, 0, 1, 0);
  assert.equal(groundLevel.metricResolved, METRIC.SLANT);
  assert.ok(groundLevel.distanceM < surface, 'chord under the arc');
  assert.ok(surface - groundLevel.distanceM < 5, 'by metres, not kilometres');

  // Raise both endpoints and the chord overtakes the arc: this is the effect
  // that made two screens answer "within 250 km" differently.
  const elevated = slantM(0, 0, 12000, 0, 1, 12000);
  assert.ok(elevated.distanceM > surface, 'elevated chord outside the ground arc');
  assert.ok(elevated.distanceM - surface < 1000, 'a boundary effect, not a gross error');
});

test('geo: geodesicM returns WGS84 values, not sphere values', () => {
  // Pinned to published figures so the "exact tier" claim is falsifiable.
  closeTo(geodesicM(0, 0, 0, 1), 111319.49, 0.5, 'one degree of longitude at the equator');
  closeTo(geodesicM(0, 0, 1, 0), 110574.39, 0.5, 'one degree of latitude at the equator');
  // ...whereas the fast path is the mean sphere. The two answer differently,
  // by about 0.11% here, which is why a reported figure takes the exact tier.
  const spherical = surfaceM(0, 0, 0, 1);
  assert.ok(spherical < geodesicM(0, 0, 0, 1), 'the mean sphere is the smaller planet');
  assert.ok(
    Math.abs(geodesicM(0, 0, 0, 1) - spherical) / spherical < 0.002,
    'and they stay within 0.2% at the equator',
  );
});

test('geo: both tiers accept the same inputs and stay in the same order of magnitude', () => {
  for (const [lat1, lon1, lat2, lon2] of [
    [51.5, -0.12, 51.6, -0.2],
    [40.7, -74, 40.8, -73.9],
    [-33.86, 151.2, -33.9, 151.3],
    [71.0, 25.0, 71.1, 25.2],
  ]) {
    const spherical = surfaceM(lat1, lon1, lat2, lon2);
    const exact = geodesicM(lat1, lon1, lat2, lon2);
    assert.ok(Number.isFinite(exact) && exact > 0, 'geodesic is finite and positive');
    // Bound is the equatorial/polar radius spread, not a rounding tolerance:
    // the fast path is a model and a published figure is the ellipsoid.
    assert.ok(
      Math.abs(exact - spherical) / spherical < 0.006,
      `tiers within 0.6% (got ${exact} vs ${spherical})`,
    );
  }
});

test('geo: non-finite input yields NaN rather than a plausible wrong number', () => {
  for (const value of [NaN, undefined, null, 'abc', Infinity]) {
    assert.ok(Number.isNaN(surfaceM(0, 0, 1, value)), `lon2=${value}`);
    assert.ok(Number.isNaN(distanceM(0, 0, value, 0)));
    assert.ok(Number.isNaN(geodesicM(0, 0, 1, value)));
  }
});

test('geo: bearing and destination round-trip', () => {
  const bearing = bearingDeg(0, 0, 1, 0);
  closeTo(bearing, 0, 1e-9, 'due north');
  closeTo(bearingDeg(0, 0, 0, 1), 90, 1e-9, 'due east');

  const target = destinationPoint(0, 0, 90, surfaceM(0, 0, 0, 1));
  closeTo(target.lat, 0, 1e-6, 'latitude unchanged travelling east on the equator');
  closeTo(target.lon, 1, 0.01, 'arrives near one degree east');
});

test('geo: wrapDegrees is exact in range and wraps only at the seam', () => {
  // A value already in range must come back untouched: pushing it through the
  // modulo is only exact in binary for some inputs.
  assert.equal(wrapDegrees(0.0005), 0.0005);
  assert.equal(wrapDegrees(-0), 0);
  assert.equal(wrapDegrees(180), -180);
  assert.equal(wrapDegrees(-180), -180);
  assert.equal(wrapDegrees(190), -170);
  assert.equal(wrapDegrees(-190), 170);
  assert.equal(wrapDegrees(540), -180);
});

test('geo: toRadians/toDegrees are inverses', () => {
  for (const value of [-180, -90, -1, 0, 1, 90, 180])
    closeTo(toDegrees(toRadians(value)), value, 1e-12, `${value}`);
});

test('geo: withinM respects the radius boundary and rejects bad radii', () => {
  const d = surfaceM(0, 0, 0, 1);
  assert.equal(withinM(0, 0, 0, 1, d + 1), true);
  assert.equal(withinM(0, 0, 0, 1, d - 1), false);
  assert.equal(withinM(0, 0, 0, 1, -5), false);
  assert.equal(withinM(0, 0, 0, 1, NaN), false);
});

test('geo: distanceBetween reads point objects, distanceM stays allocation-free', () => {
  closeTo(
    distanceBetween({ lat: 0, lon: 0 }, { lat: 0, lon: 1 }),
    surfaceM(0, 0, 0, 1),
    1e-9,
    'point-object form matches the primitives form',
  );
  closeTo(
    distanceBetween(
      { lat: 0, lon: 0, heightM: 1000 },
      { lat: 0, lon: 0, heightM: 0 },
      { metric: METRIC.SLANT },
    ),
    1000,
    1e-6,
    'heightM is picked up from the points',
  );
  // A point without a height degrades the pair rather than inventing one.
  assert.equal(
    distanceBetween({ lat: 0, lon: 0, heightM: 1000 }, { lat: 0, lon: 0 }, {
      metric: METRIC.SLANT,
    }),
    0,
  );
  assert.ok(Number.isNaN(distanceBetween(null, { lat: 0, lon: 0 })));
});

test('geo: nearbyM returns ascending distances within the radius, capped', () => {
  const items = [
    { id: 'far', lat: 0, lon: 3 },
    { id: 'near', lat: 0, lon: 1 },
    { id: 'mid', lat: 0, lon: 2 },
    { id: 'off', lat: 40, lon: 40 },
    { id: 'bad', lat: NaN, lon: 0 },
  ];
  const out = nearbyM(items, { lat: 0, lon: 0 }, surfaceM(0, 0, 0, 2.5));
  assert.deepEqual(
    out.map((entry) => entry.item.id),
    ['near', 'mid'],
  );
  assert.ok(out[0].distanceM < out[1].distanceM);
  const capped = nearbyM(items, { lat: 0, lon: 0 }, Infinity, { cap: 2 });
  assert.equal(capped.length, 2);
  // Non-finite coordinates are skipped, not treated as distance zero.
  assert.ok(!capped.some((entry) => entry.item.id === 'bad'));
});

test('geo: nearbyM ordering matches whole-set surface ordering', () => {
  // The property that makes a panel and a query agree: one comparator, used
  // once. Sorting by anything else (a 3D chord, say) can invert a near pair.
  const items = [];
  for (let i = 0; i < 20; i += 1) items.push({ id: i, lat: i * 0.03, lon: i * 0.05 });
  const out = nearbyM(items, { lat: 0.2, lon: 0.3 }, Infinity);
  const expected = items
    .slice()
    .sort(
      (a, b) =>
        surfaceM(0.2, 0.3, a.lat, a.lon) - surfaceM(0.2, 0.3, b.lat, b.lon),
    )
    .map((entry) => entry.id);
  assert.deepEqual(
    out.map((entry) => entry.item.id),
    expected,
  );
});

test('geo: nearbyM with an empty or absent collection is empty', () => {
  assert.deepEqual(nearbyM([], { lat: 0, lon: 0 }, 1000), []);
  assert.deepEqual(nearbyM(null, { lat: 0, lon: 0 }, 1000), []);
  assert.deepEqual(nearbyM([{ lat: 0, lon: 0 }], null, 1000), []);
});

/* ─────────────────────────── ring containment ─────────────────────────── */

test('geo: ringContains agrees with the classic ray cast for a normal ring', () => {
  const square = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ];
  assert.equal(ringContains(square, 0.5, 0.5), true);
  assert.equal(ringContains(square, 1.5, 0.5), false);
  assert.equal(ringContains(square, 0.5, 1.5), false);
  assert.equal(ringContains(square, -0.5, 0.5), false);
});

test('geo: ringContains rejects malformed rings and points', () => {
  assert.equal(ringContains([], 0, 0), false);
  assert.equal(ringContains([[0, 0], [1, 1]], 0, 0), false);
  assert.equal(ringContains(null, 0, 0), false);
  assert.equal(
    ringContains([[0, 0], [1, 0], [1, 1]], NaN, 0),
    false,
  );
});

test('geo: a ring straddling the antimeridian is correct on both sides of the seam', () => {
  // The regression that motivated the fix. This rectangle covers 179E..181E
  // (that is, 179E to 179W) between 10N and 20N. The previous implementation
  // answered five of these eight probes wrongly, including reporting a point in
  // the Gulf of Guinea as inside the box.
  const rectangle = [
    [179, 10],
    [-179, 10],
    [-179, 20],
    [179, 20],
  ];
  assert.equal(ringContains(rectangle, 15, 180), true, 'centre, on the seam');
  assert.equal(ringContains(rectangle, 15, 179.5), true, 'just west, inside');
  assert.equal(ringContains(rectangle, 15, -179.5), true, 'just east, inside');
  assert.equal(ringContains(rectangle, 15, 178), false, 'west of the box');
  assert.equal(ringContains(rectangle, 15, -178), false, 'east of the box');
  assert.equal(ringContains(rectangle, 15, 0), false, 'the Gulf of Guinea');
  assert.equal(ringContains(rectangle, 5, 179.5), false, 'south of the box');
  assert.equal(ringContains(rectangle, 25, -179.5), false, 'north of the box');
});

test('geo: containment is invariant under whole turns of longitude', () => {
  // A point and the same point plus or minus 360 degrees are the same place, so
  // no correct implementation may answer them differently. This catches wrap
  // bugs without needing to know any geography.
  const ring = [
    [179, 10],
    [-179, 10],
    [-179, 20],
    [179, 20],
  ];
  for (const lat of [5, 10.5, 15, 19.5, 25]) {
    for (const lon of [-179.9, -179, -90, 0, 90, 179, 179.9]) {
      const base = ringContains(ring, lat, lon);
      assert.equal(ringContains(ring, lat, lon + 360), base, `(${lat},${lon}) +360`);
      assert.equal(ringContains(ring, lat, lon - 360), base, `(${lat},${lon}) -360`);
    }
  }
});

test('geo: a wider crossing ring stays consistent across its whole extent', () => {
  // A box spanning 160E to 160W: not a full turn, but far wider than the seam
  // probes above, and wide enough that more than one longitude image of a point
  // falls inside the unwrapped bounds.
  const ring = [
    [160, -10],
    [-160, -10],
    [-160, 10],
    [160, 10],
  ];
  assert.equal(ringContains(ring, 0, 180), true, 'centre on the seam');
  assert.equal(ringContains(ring, 0, 179), true, 'west side');
  assert.equal(ringContains(ring, 0, -179), true, 'east side');
  assert.equal(ringContains(ring, 0, 0), false, 'Greenwich is not in it');
  assert.equal(ringContains(ring, 20, 180), false, 'north of it');
  assert.equal(ringContains(ring, 0, 159), false, 'just west of it');
  assert.equal(ringContains(ring, 0, -159), false, 'just east of it');
});

test('geo: ringAreaM2 measures a sphere, not a degree rectangle', () => {
  // A 1° × 1° cell at the equator is about 12 364 km² — the product of the two
  // edge lengths (12 378 km²) is 0.11% too big, because the cell is pinched
  // toward the pole. Pinned so the formula cannot quietly become a planar one.
  const oneDegree = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ];
  const area = ringAreaM2(oneDegree);
  closeTo(area, 12_364_000_000, 25_000_000, 'one degree square at the equator');

  // At 60°N the same degree square is HALF as wide, so half the area. This is
  // the assertion a planar-in-degrees implementation cannot pass.
  const highLatitude = [
    [0, 59],
    [1, 59],
    [1, 60],
    [0, 60],
  ];
  const ratio = ringAreaM2(highLatitude) / area;
  assert.ok(ratio > 0.45 && ratio < 0.55, `high-latitude square is about half (got ${ratio})`);
});

test('geo: ringAreaM2 is not fooled by the antimeridian', () => {
  // The same 1°-tall box, expressed across the seam, spanning 2° of longitude.
  // A shoelace over raw longitudes reports most of the planet instead.
  const crossing = [
    [179, 0],
    [-179, 0],
    [-179, 1],
    [179, 1],
  ];
  const area = ringAreaM2(crossing);
  const equatorCell = ringAreaM2([
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ]);
  closeTo(area / equatorCell, 2, 0.01, 'exactly two equatorial cells wide');
  assert.ok(area < 3e10, 'nowhere near a hemispheric area');
});

test('geo: ringAreaM2 handles degenerate and bad input explicitly', () => {
  assert.equal(ringAreaM2([]), 0);
  assert.equal(ringAreaM2([[0, 0], [1, 1]]), 0);
  assert.equal(ringAreaM2(null), 0);
  assert.ok(Number.isNaN(ringAreaM2([[0, 0], [1, 0], [1, Number.NaN]])));
});

test('geo: anyRingContains is a disjunction over a feature’s rings', () => {
  const rings = [
    [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ],
    [
      [10, 10],
      [11, 10],
      [11, 11],
      [10, 11],
    ],
  ];
  assert.equal(anyRingContains(rings, 0.5, 0.5), true);
  assert.equal(anyRingContains(rings, 10.5, 10.5), true);
  assert.equal(anyRingContains(rings, 5, 5), false);
  assert.equal(anyRingContains(null, 0, 0), false);
});
