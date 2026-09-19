// I3c — end-to-end military provenance: a mocked /api/adsblol/mil response
// travels the PRODUCTION path (createAdsbLolSource → readsbSnapshot →
// applySnapshot → MilitaryFlightRecords.receive) and is read back through the
// production accessor militaryFlightsLayer.getProvenanceMap().
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import militaryFlightsLayer, {
  _setTrackedMilitaryRefreshStateForTest,
} from './militaryFlights.js';
import { EPISTEMIC, isValidProvenance } from './provenance.js';

const ICAO = 'ae01ce';

function seed(viewer) {
  _setTrackedMilitaryRefreshStateForTest({
    icao24: ICAO,
    entity: { gevLabelModel: { title: 'RCH451', details: [] } },
    billboard: {
      position: Cesium.Cartesian3.fromDegrees(-97, 31, 8000),
      show: false,
    },
    billboardCollection: { show: true, remove() {} },
    viewer,
    tracked: false,
    history: [],
    meta: { rawLat: 31, rawLon: -97, onGround: false },
  });
}

function mockFeed(t, { now, cache = 'MISS', ageMs = 0, row = {} }) {
  t.mock.method(Date, 'now', () => now());
  t.mock.method(globalThis, 'fetch', async () =>
    Response.json(
      {
        now: now() - ageMs,
        ac: [
          {
            hex: ICAO,
            lon: -97,
            lat: 31,
            alt_baro: 28000,
            alt_geom: 28500,
            track: 95,
            gs: 400,
            baro_rate: -64,
            seen: 1,
            seen_pos: 2,
            flight: 'RCH451 ',
            t: 'C17',
            r: '05-8152',
            ...row,
          },
        ],
      },
      {
        headers: {
          'X-ADS-B-Cache': cache,
          ...(cache === 'MISS'
            ? {}
            : { 'X-ADS-B-Cache-Age-Ms': String(ageMs) }),
        },
      },
    ),
  );
}

test('a live adsb.lol batch yields REPORTED military provenance with truthful readsb times', async (t) => {
  const receivedAt = 1_800_000_000_000;
  const viewer = { camera: { positionCartographic: null }, scene: {} };
  seed(viewer);
  mockFeed(t, { now: () => receivedAt });
  await militaryFlightsLayer.update(viewer);

  const map = militaryFlightsLayer.getProvenanceMap();
  assert.equal(map instanceof Map, true);
  assert.deepEqual([...map.keys()], [ICAO], 'keyed by the native record key');
  const prov = map.get(ICAO);
  for (const [field, descriptor] of Object.entries(prov))
    assert.equal(isValidProvenance(descriptor), true, field);

  const reported = (reportedAtMs) => ({
    epistemic: EPISTEMIC.REPORTED,
    sourceId: 'adsb.lol',
    reportedAtMs,
    receivedAtMs: receivedAt,
    via: null,
  });
  // seen_pos = 2 s before the (uncached) receipt; seen = 1 s before it.
  for (const field of ['position', 'altitudeFt', 'geoAltitudeM', 'onGround'])
    assert.deepEqual(prov[field], reported(receivedAt - 2_000), field);
  for (const field of [
    'speedMps',
    'track',
    'verticalRateMps',
    'callsign',
    'lastContactEpochMs',
  ])
    assert.deepEqual(prov[field], reported(receivedAt - 1_000), field);
  // Database-backed identity delivered by the feed: no event time.
  assert.deepEqual(prov.type, reported(null));
  assert.deepEqual(prov.registration, reported(null));
  assert.equal('operator' in prov, false, 'adsb.lol row carried no ownOp');
  // Locally computed values never inherit the feed id.
  assert.equal(prov.klass.epistemic, EPISTEMIC.DERIVED);
  assert.equal(prov.klass.sourceId, null);
  assert.equal(prov.renderAltitudeM.via, 'render-altitude-selection');
  assert.equal(prov.wasAirborne.via, 'airborne-history');
  assert.equal('turnRateDps' in prov, false);
});

test('a proxy-cached batch reports the upstream observation time, not the replay receipt', async (t) => {
  const receivedAt = 1_800_000_100_000;
  const viewer = { camera: { positionCartographic: null }, scene: {} };
  seed(viewer);
  mockFeed(t, { now: () => receivedAt, cache: 'HIT', ageMs: 5_000 });
  await militaryFlightsLayer.update(viewer);
  const prov = militaryFlightsLayer.getProvenanceMap().get(ICAO);
  assert.equal(prov.position.receivedAtMs, receivedAt, 'client receipt');
  assert.equal(
    prov.position.reportedAtMs,
    receivedAt - 5_000 - 2_000,
    'cache age and seen_pos both count against the report time',
  );
  assert.equal(prov.callsign.reportedAtMs, receivedAt - 5_000 - 1_000);
});

test('the accessor is copy-safe and the I2 primitives stay provenance-unaware', async (t) => {
  const receivedAt = 1_800_000_200_000;
  const viewer = { camera: { positionCartographic: null }, scene: {} };
  seed(viewer);
  mockFeed(t, { now: () => receivedAt });
  await militaryFlightsLayer.update(viewer);

  const first = militaryFlightsLayer.getProvenanceMap();
  first.get(ICAO).position.sourceId = 'tampered';
  first.get(ICAO).forged = { epistemic: 'reported' };
  first.delete(ICAO);
  const second = militaryFlightsLayer.getProvenanceMap();
  assert.equal(second.get(ICAO).position.sourceId, 'adsb.lol');
  assert.equal('forged' in second.get(ICAO), false);
  assert.notEqual(first, second);

  const entities = militaryFlightsLayer.getCurrentEntities();
  assert.equal(entities.length, 1);
  assert.deepEqual(Object.keys(entities[0]).sort(), [
    'altitudeM',
    'callsign',
    'entityKey',
    'icao24',
    'lat',
    'lon',
  ]);
  const analyst = militaryFlightsLayer.getAnalystRecords();
  assert.equal(analyst.length, 1);
  for (const key of Object.keys(analyst[0]))
    assert.doesNotMatch(key, /provenance|epistemic|sourceId/i);
});

test('a missing kinematic on a later poll is stored as 0 without a descriptor; identity is retained with its own', async (t) => {
  let now = 1_800_000_300_000;
  const viewer = { camera: { positionCartographic: null }, scene: {} };
  seed(viewer);
  mockFeed(t, { now: () => now });
  await militaryFlightsLayer.update(viewer);
  const before = militaryFlightsLayer.getProvenanceMap().get(ICAO);

  now += 20_000;
  mockFeed(t, {
    now: () => now,
    row: { gs: undefined, track: undefined, flight: undefined, t: undefined },
  });
  await militaryFlightsLayer.update(viewer);
  const after = militaryFlightsLayer.getProvenanceMap().get(ICAO);
  const record = militaryFlightsLayer
    .getAnalystRecords()
    .find((entry) => entry.icao24 === ICAO);
  assert.equal(record.speedMps, 0);
  assert.equal('speedMps' in after, false, 'synthetic 0 carries no descriptor');
  assert.equal('track' in after, false);
  assert.equal(record.callsign, 'RCH451', 'sticky callsign retained');
  assert.deepEqual(
    after.callsign,
    before.callsign,
    'with its original descriptor',
  );
  assert.deepEqual(after.type, before.type);
  assert.equal(after.position.receivedAtMs, now, 'position was replaced');
});

test('destroy() leaves no descriptor behind', async (t) => {
  const receivedAt = 1_800_000_400_000;
  const removed = [];
  const viewer = {
    camera: { positionCartographic: null },
    scene: {
      primitives: {
        remove(primitive) {
          removed.push(primitive);
        },
      },
    },
  };
  seed(viewer);
  mockFeed(t, { now: () => receivedAt });
  await militaryFlightsLayer.update(viewer);
  assert.equal(militaryFlightsLayer.getProvenanceMap().size, 1);
  const realDocument = globalThis.document;
  globalThis.document = { removeEventListener() {} };
  try {
    militaryFlightsLayer.destroy(viewer);
  } finally {
    globalThis.document = realDocument;
  }
  assert.equal(militaryFlightsLayer.getCurrentEntities().length, 0);
  assert.equal(militaryFlightsLayer.getProvenanceMap().size, 0);
});
