// src/data/naturalEarthRegions.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { statSync, readFileSync } from 'node:fs';
import { findNaturalRegion, listRegions, lookupNaturalRegionOutline, pointInRing } from './naturalEarthRegions.js';

const PACK_DIR = new URL('./local_data/natural_earth/', import.meta.url);

test('marquee ranges resolve with sane areas (owner acceptance: Alps + Rockies)', async () => {
  const alps = await findNaturalRegion('Alps');
  assert.ok(alps, 'Alps must resolve');
  assert.equal(alps.kind, 'natural');
  assert.equal(alps.featurecla, 'Range/mtn');
  assert.ok(alps.areaKm2 > 150_000 && alps.areaKm2 < 350_000,
    `Alps area sane (got ${Math.round(alps.areaKm2)} km²)`);

  const rockies = await findNaturalRegion('Rocky Mountains');
  assert.ok(rockies, 'Rocky Mountains must resolve');
  assert.ok(rockies.areaKm2 >= 700_000 && rockies.areaKm2 < 1_500_000,
    `Rockies area sane (got ${Math.round(rockies.areaKm2)} km²)`);
  assert.ok(rockies.bboxDiagonalKm > 2000, 'Rockies span thousands of km');
});

test('aliases and articles: "the Alps", "Rockies", "Sahara Desert", "Himalaya"', async () => {
  assert.equal((await findNaturalRegion('the Alps'))?.name, 'Alps');
  assert.equal((await findNaturalRegion('Rockies'))?.name, 'Rocky Mountains');
  assert.equal((await findNaturalRegion('the Rockies'))?.name, 'Rocky Mountains');
  assert.equal((await findNaturalRegion('Sahara Desert'))?.name, 'Sahara');
  assert.equal((await findNaturalRegion('Himalaya'))?.name, 'Himalayas');
  assert.equal((await findNaturalRegion('  THE ALPS  '))?.name, 'Alps');
});

test('major deserts/ranges resolve with sane areas', async () => {
  const sahara = await findNaturalRegion('Sahara');
  assert.ok(sahara && sahara.areaKm2 > 8_000_000 && sahara.areaKm2 < 12_000_000,
    `Sahara ~9-11M km² (got ${sahara && Math.round(sahara.areaKm2)})`);

  const andes = await findNaturalRegion('Andes');
  assert.ok(andes && andes.areaKm2 > 2_000_000 && andes.areaKm2 < 4_000_000,
    `Andes area sane (got ${andes && Math.round(andes.areaKm2)})`);

  const himalayas = await findNaturalRegion('Himalayas');
  assert.ok(himalayas && himalayas.areaKm2 > 300_000 && himalayas.areaKm2 < 700_000,
    `Himalayas area sane (got ${himalayas && Math.round(himalayas.areaKm2)})`);
});

test('marine features resolve as kind "marine"', async () => {
  const gom = await findNaturalRegion('Gulf of Mexico');
  assert.ok(gom, 'Gulf of Mexico must resolve');
  assert.equal(gom.kind, 'marine');
  assert.equal(gom.featurecla, 'gulf');
  assert.ok(gom.areaKm2 > 1_200_000 && gom.areaKm2 < 1_800_000,
    `Gulf of Mexico area sane (got ${Math.round(gom.areaKm2)} km²)`);
});

test('nonsense / non-natural-region queries return null', async () => {
  assert.equal(await findNaturalRegion('Zilker Park'), null);
  assert.equal(await findNaturalRegion('Texas'), null);
  assert.equal(await findNaturalRegion(''), null);
  assert.equal(await findNaturalRegion(null), null);
  assert.equal(await findNaturalRegion('qqqqzzzz'), null);
});

test('returned polygons have >=8 vertices with valid lon/lat', async () => {
  for (const q of ['Alps', 'Rocky Mountains', 'Sahara', 'Andes', 'Himalayas', 'Gulf of Mexico']) {
    const r = await findNaturalRegion(q);
    assert.ok(r, `${q} resolves`);
    assert.ok(r.polygons.length >= 1, `${q} has polygons`);
    for (const ring of r.polygons) {
      assert.ok(ring.length >= 8, `${q} ring has >=8 vertices (got ${ring.length})`);
      for (const [lon, lat] of ring) {
        assert.ok(lon >= -180 && lon <= 180, `${q} lon in range (${lon})`);
        assert.ok(lat >= -90 && lat <= 90, `${q} lat in range (${lat})`);
      }
    }
  }
});

test('whole pack: every feature ring has >=8 vertices and valid coords', () => {
  for (const file of ['regions.json', 'marine.json']) {
    const pack = JSON.parse(readFileSync(new URL(file, PACK_DIR), 'utf8'));
    assert.ok(pack.meta?.license?.toLowerCase().includes('public domain'), `${file} meta declares PD license`);
    assert.ok(pack.meta?.fetched, `${file} meta records fetch time`);
    assert.ok(pack.features.length > 200, `${file} has hundreds of features (got ${pack.features.length})`);
    for (const ft of pack.features) {
      assert.ok(ft.name && typeof ft.name === 'string', `${file} feature named`);
      for (const ring of ft.polygons) {
        assert.ok(ring.length >= 8, `${file} ${ft.name}: ring >=8 verts (got ${ring.length})`);
        for (const [lon, lat] of ring) {
          assert.ok(Number.isFinite(lon) && lon >= -180 && lon <= 180, `${file} ${ft.name}: lon valid`);
          assert.ok(Number.isFinite(lat) && lat >= -90 && lat <= 90, `${file} ${ft.name}: lat valid`);
        }
      }
    }
  }
});

test('pack byte-size budget: regions.json + marine.json <= 3 MB', () => {
  const total = statSync(new URL('regions.json', PACK_DIR)).size
    + statSync(new URL('marine.json', PACK_DIR)).size;
  assert.ok(total <= 3 * 1024 * 1024, `pack total ${total} bytes exceeds 3 MB budget`);
});

test('listRegions() enumerates both kinds for diagnostics', async () => {
  const list = await listRegions();
  assert.ok(list.length > 1000, `pack has 1000+ named regions (got ${list.length})`);
  assert.ok(list.some((e) => e.kind === 'natural'));
  assert.ok(list.some((e) => e.kind === 'marine'));
  // diagnostics entries carry no geometry payload
  assert.equal(list[0].polygons, undefined);
});

// ── lookupNaturalRegionOutline (resolver first-rung contract) ──────
test('outline lookup: Alps ring via containment anchor', async () => {
  const r = await lookupNaturalRegionOutline('the Alps', 46.5, 10.0);
  assert.ok(r, 'Alps must resolve with an inside anchor');
  assert.equal(r.name, 'Alps');
  assert.ok(r.ring.length >= 8, 'range-scale ring');
  assert.ok(r.areaKm2 > 100000 && r.areaKm2 < 400000, `sane Alps area, got ${r.areaKm2}`);
});

test('outline lookup: duplicate names disambiguate by anchor containment', async () => {
  const us = await lookupNaturalRegionOutline('Sierra Nevada', 37.2, -119.0);
  assert.ok(us, 'US anchor must match a Sierra Nevada');
  assert.ok(pointInRing(us.ring, 37.2, -119.0), 'returned ring contains the US anchor');
});

test('outline lookup: anchor outside every ring → null (wrong-place guard)', async () => {
  assert.equal(await lookupNaturalRegionOutline('the Alps', 30.26, -97.77), null);
});

test('outline lookup: non-region names never match', async () => {
  assert.equal(await lookupNaturalRegionOutline('Zilker Park', 30.26, -97.77), null);
  assert.equal(await lookupNaturalRegionOutline('Texas', 31.0, -99.0), null);
});

test('outline lookup: marine regions resolve (Gulf of Mexico)', async () => {
  const gulf = await lookupNaturalRegionOutline('Gulf of Mexico', 25.0, -90.0);
  assert.ok(gulf && gulf.kind === 'marine');
});

test('pointInRing: basic square', () => {
  const sq = [[0, 0], [10, 0], [10, 10], [0, 10]];
  assert.equal(pointInRing(sq, 5, 5), true);
  assert.equal(pointInRing(sq, 15, 5), false);
  assert.equal(pointInRing([[0, 0], [1, 1]], 0.5, 0.5), false, 'degenerate ring');
});

/* ── I1b: antimeridian containment (the real broken cases) ──────────────────
 * The pack stores 5 rings that cross ±180°. The previous `pointInRing`
 * ray-cast answered differently depending on which side of the seam the SAME
 * place was expressed as, and reported points in the Gulf of Guinea as inside
 * a box near the date line. Both are covered here: the synthetic box pins the
 * false positive, and the shipped rings pin the seam behaviour using the real
 * geometry rather than a hand-written rectangle.
 */

const SYNTHETIC_CROSSING = [
  [179, 10],
  [-179, 10],
  [-179, 20],
  [179, 20],
];

test('pointInRing: synthetic antimeridian box, both sides of the seam', () => {
  assert.equal(pointInRing(SYNTHETIC_CROSSING, 15, 180), true, 'centre on the seam');
  assert.equal(pointInRing(SYNTHETIC_CROSSING, 15, 179.5), true, 'just west, inside');
  assert.equal(pointInRing(SYNTHETIC_CROSSING, 15, -179.5), true, 'just east, inside');
  assert.equal(pointInRing(SYNTHETIC_CROSSING, 15, 178), false, 'west of the box');
  assert.equal(pointInRing(SYNTHETIC_CROSSING, 15, -178), false, 'east of the box');
  // The regression that proved the old implementation wrong: this is the Gulf
  // of Guinea, and the old ray cast returned TRUE for it.
  assert.equal(pointInRing(SYNTHETIC_CROSSING, 15, 0), false, 'Gulf of Guinea');
  assert.equal(pointInRing(SYNTHETIC_CROSSING, 5, 179.5), false, 'south of the box');
  assert.equal(pointInRing(SYNTHETIC_CROSSING, 25, -179.5), false, 'north of the box');
});

test('pointInRing: the five shipped seam-crossing rings are encircling, and answered correctly', async () => {
  // The packs ship exactly five rings with a >180° longitude jump, and all five
  // ENCIRCLE the axis (Antarctica, East Antarctica, Polar Plateau, Arctic
  // Ocean, Southern Ocean). None of them merely straddles the seam, so none can
  // be unwrapped onto a plane: for these the pole is a latitude LINE, not a
  // point. They keep the planar test, and this pins the answers that must not
  // regress — including the one distinction that looks like a seam bug and is
  // not, see below.
  const load = (name) =>
    JSON.parse(readFileSync(new URL(name, PACK_DIR), 'utf8')).features;
  const features = [...load('regions.json'), ...load('marine.json')];

  const unwrappedSpan = (ring) => {
    let previous = ring[0][0];
    let min = previous;
    let max = previous;
    for (let i = 1; i < ring.length; i += 1) {
      let lon = ring[i][0];
      while (lon - previous > 180) lon -= 360;
      while (lon - previous < -180) lon += 360;
      if (lon < min) min = lon;
      if (lon > max) max = lon;
      previous = lon;
    }
    return max - min;
  };

  const crossing = [];
  for (const feature of features)
    for (const ring of feature.polygons || []) {
      const lons = ring.map(([lon]) => lon);
      const jumps = ring.some(
        (vertex, index) =>
          index > 0 && Math.abs(vertex[0] - ring[index - 1][0]) > 180,
      );
      if (!jumps && Math.abs(lons[0] - lons[lons.length - 1]) <= 180) continue;
      crossing.push({ feature, ring, span: unwrappedSpan(ring) });
    }
  assert.equal(crossing.length, 5, 'five seam-crossing rings in the packs');
  assert.equal(
    crossing.filter((entry) => entry.span >= 180).length,
    5,
    'and every one of them encircles the axis rather than straddling the seam',
  );

  const contains = (name, lat, lon) =>
    features
      .filter((feature) => feature.name === name)
      .some((feature) =>
        (feature.polygons || []).some((ring) => pointInRing(ring, lat, lon)),
      );

  // Pole-encircling regions contain the pole side, at longitudes either side of
  // the seam, and stop well before the mid-latitudes.
  for (const name of ['Antarctica', 'Polar Plateau'])
    for (const lon of [0, 90, -90, 179, -179])
      assert.equal(contains(name, -88, lon), true, `${name} contains (-88, ${lon})`);
  assert.equal(contains('Arctic Ocean', 85, 0), true, 'Arctic Ocean contains the pole side');
  assert.equal(contains('Arctic Ocean', 85, -90), true, 'including across the seam side');
  assert.equal(contains('Arctic Ocean', 45, 0), false, 'but not the mid-latitudes');
  assert.equal(contains('Antarctica', -60, 0), false, 'Antarctica stops at its coast');

  // Southern Ocean is a BAND around the continent: the ocean is inside it, the
  // continent to the south and the open Atlantic to the north are not.
  assert.equal(contains('Southern Ocean', -70, 0), true, 'the Southern Ocean band');
  assert.equal(contains('Southern Ocean', -55, 0), false, 'north of the band');
  assert.equal(contains('Southern Ocean', -80, 0), false, 'south of the band, over land');

  // The distinction that looks like a seam bug and is not: East Antarctica's
  // ring has boundary edges running ALONG ±180 and along 0°, so the eastern and
  // western halves of the continent are different regions. One degree away from
  // that boundary the answer is unambiguous in both directions.
  assert.equal(contains('East Antarctica', -88, 179), true, 'the eastern half');
  assert.equal(contains('East Antarctica', -88, -179), false, 'the western half');
  assert.equal(contains('East Antarctica', -88, 90), true, 'and the middle of it');
  assert.equal(contains('Antarctica', -88, 179), true, 'while Antarctica spans both');
  assert.equal(contains('Antarctica', -88, -179), true, 'halves, being the continent');
});

test('pointInRing: no shipped ring changed its answer (differential vs the old ray cast)', async () => {
  // The differential that matters before anyone builds AOIs on this module:
  // for every ring in BOTH packs that does not cross the seam, the new
  // implementation must return EXACTLY what the old one did, probe for probe.
  // Not "close", not "mostly" — the unwrapping path is only supposed to change
  // rings that actually straddle ±180, and the packs contain none of those that
  // are merely local. The two code paths are the same expression for a
  // non-crossing ring (same edge test, same iteration order, longitude literals
  // in place of computed ones), so this is an exact expectation, not a
  // tolerance. A future optimisation that perturbs ordinary rings fails here.
  const legacyPointInRing = (ring, lat, lon) => {
    if (!Array.isArray(ring) || ring.length < 3) return false;
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      const intersects =
        yi > lat !== yj > lat &&
        lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
      if (intersects) inside = !inside;
    }
    return inside;
  };

  const load = (name) =>
    JSON.parse(readFileSync(new URL(name, PACK_DIR), 'utf8')).features;
  const features = [...load('regions.json'), ...load('marine.json')];

  let rings = 0;
  let probes = 0;
  let disagreements = 0;
  const offenders = [];
  for (const feature of features)
    for (const ring of feature.polygons || []) {
      const lons = ring.map(([lon]) => lon);
      const crosses =
        ring.some(
          (vertex, index) =>
            index > 0 && Math.abs(vertex[0] - ring[index - 1][0]) > 180,
        ) || Math.abs(lons[0] - lons[lons.length - 1]) > 180;
      if (crosses) continue;
      rings += 1;
      const lats = ring.map(([, lat]) => lat);
      const midLat = (Math.min(...lats) + Math.max(...lats)) / 2;
      const midLon = (Math.min(...lons) + Math.max(...lons)) / 2;
      for (const [lat, lon] of [
        [midLat, midLon],
        [midLat + 1.5, midLon + 1.5],
        [midLat - 1.5, midLon - 1.5],
        // Deliberately far away: a point no ring should claim, which catches an
        // implementation that started returning true for everything.
        [0, 0],
      ]) {
        probes += 1;
        const before = legacyPointInRing(ring, lat, lon);
        const after = pointInRing(ring, lat, lon);
        if (before !== after) {
          disagreements += 1;
          if (offenders.length < 5)
            offenders.push(
              `${feature.name} ring(${ring.length}) (${lat},${lon}) was ${before} is ${after}`,
            );
        }
      }
    }

  assert.ok(rings > 2000, `every non-crossing ring was checked (got ${rings})`);
  assert.equal(
    disagreements,
    0,
    `shipped rings changed answer: ${offenders.join('; ')} (${probes} probes)`,
  );
});
