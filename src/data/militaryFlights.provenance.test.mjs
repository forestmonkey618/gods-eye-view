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

/** No descriptor set may exist for a key the store does not currently hold. */
function assertNoOrphans() {
  const held = new Set(
    militaryFlightsLayer.getCurrentEntities().map((e) => e.icao24),
  );
  for (const key of militaryFlightsLayer.getProvenanceMap().keys())
    assert.equal(
      held.has(key),
      true,
      `${key}: descriptor set without a record`,
    );
}

/** A viewer stub rich enough for the real init()/destroy() lifecycle. */
function lifecycleViewer() {
  const canvas = {
    addEventListener() {},
    removeEventListener() {},
    clientWidth: 100,
    clientHeight: 100,
    getBoundingClientRect: () => ({ left: 0, top: 0 }),
  };
  return {
    camera: { positionCartographic: null },
    scene: {
      primitives: { add: (p) => p, remove() {}, raiseToTop() {} },
      canvas,
    },
    trackedEntityChanged: new Cesium.Event(),
    entities: new Cesium.EntityCollection(),
  };
}

function withDom(t) {
  const realDocument = globalThis.document;
  const realWindow = globalThis.window;
  globalThis.document = {
    body: { classList: { contains: () => false } },
    addEventListener() {},
    removeEventListener() {},
  };
  globalThis.window = new EventTarget();
  t.after(() => {
    globalThis.document = realDocument;
    globalThis.window = realWindow;
  });
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

test('FROZEN RULE end to end — gs/track 0 are REPORTED, absent gs/track are synthetic 0 without a descriptor', async (t) => {
  let now = 1_800_000_350_000;
  const viewer = { camera: { positionCartographic: null }, scene: {} };
  seed(viewer);
  mockFeed(t, { now: () => now, row: { gs: 0, track: 0 } });
  await militaryFlightsLayer.update(viewer);
  let record = militaryFlightsLayer
    .getAnalystRecords()
    .find((e) => e.icao24 === ICAO);
  let prov = militaryFlightsLayer.getProvenanceMap().get(ICAO);
  assert.equal(record.speedMps, 0);
  assert.equal(record.heading, 0);
  assert.equal(prov.speedMps.epistemic, EPISTEMIC.REPORTED);
  assert.equal(prov.speedMps.sourceId, 'adsb.lol');
  assert.equal(prov.track.reportedAtMs, now - 1_000);
  assertNoOrphans();

  now += 20_000;
  mockFeed(t, { now: () => now, row: { gs: undefined, track: undefined } });
  await militaryFlightsLayer.update(viewer);
  record = militaryFlightsLayer
    .getAnalystRecords()
    .find((e) => e.icao24 === ICAO);
  prov = militaryFlightsLayer.getProvenanceMap().get(ICAO);
  assert.equal(record.speedMps, 0, 'value semantics untouched: synthetic 0');
  assert.equal(record.heading, 0);
  assert.equal(
    'speedMps' in prov,
    false,
    'synthetic 0 is not presented as reported',
  );
  assert.equal('track' in prov, false);
  assertNoOrphans();
});

test('the absence sweep forgets the record and its descriptors together (stale polls keep both)', async (t) => {
  let now = 1_800_000_500_000;
  const viewer = { camera: { positionCartographic: null }, scene: {} };
  seed(viewer);
  mockFeed(t, { now: () => now });
  await militaryFlightsLayer.update(viewer);
  assert.equal(militaryFlightsLayer.getProvenanceMap().size, 1);
  assertNoOrphans();
  // MISSING_POLL_LIMIT (3) complete polls without the aircraft: two 'stale'
  // polls retain record + descriptors, the third removes both.
  for (let miss = 1; miss <= 3; miss++) {
    now += 60_000;
    t.mock.method(Date, 'now', () => now);
    t.mock.method(globalThis, 'fetch', async () =>
      Response.json({ now, ac: [] }, { headers: { 'X-ADS-B-Cache': 'MISS' } }),
    );
    await militaryFlightsLayer.update(viewer);
    const entities = militaryFlightsLayer.getCurrentEntities().length;
    const descriptors = militaryFlightsLayer.getProvenanceMap().size;
    if (miss < 3) {
      assert.equal(entities, 1, `miss ${miss}: record retained`);
      assert.equal(
        descriptors,
        1,
        `miss ${miss}: descriptors retained with it`,
      );
    } else {
      assert.equal(entities, 0, 'record aged out');
      assert.equal(descriptors, 0, 'descriptors aged out with it');
    }
    assertNoOrphans();
  }
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

test('real init() → poll → destroy() lifecycle: init resets the sidecar with the store, and nothing survives destroy', async (t) => {
  withDom(t);
  const now = 1_800_000_600_000;
  const viewer = lifecycleViewer();
  // Populate while no viewer is registered so init() is legal afterwards.
  _setTrackedMilitaryRefreshStateForTest({
    icao24: ICAO,
    entity: null,
    tracked: false,
    history: [],
    billboard: {
      position: Cesium.Cartesian3.fromDegrees(-97, 31, 8000),
      show: true,
    },
    billboardCollection: { show: true, remove() {} },
    viewer: null,
    meta: { rawLat: 31, rawLon: -97, onGround: false },
  });
  mockFeed(t, { now: () => now });
  await militaryFlightsLayer.update(viewer);
  assert.equal(
    militaryFlightsLayer.getProvenanceMap().size,
    1,
    'populated before init',
  );

  militaryFlightsLayer.init(viewer);
  assert.equal(
    militaryFlightsLayer.getCurrentEntities().length,
    0,
    'init resets the store',
  );
  assert.equal(
    militaryFlightsLayer.getProvenanceMap().size,
    0,
    'init resets the sidecar with it',
  );

  await militaryFlightsLayer.update(viewer);
  assert.equal(militaryFlightsLayer.getCurrentEntities().length, 1);
  assert.equal(
    militaryFlightsLayer.getProvenanceMap().get(ICAO).position.sourceId,
    'adsb.lol',
  );
  assertNoOrphans();

  militaryFlightsLayer.destroy(viewer);
  assert.equal(militaryFlightsLayer.getCurrentEntities().length, 0);
  assert.equal(militaryFlightsLayer.getProvenanceMap().size, 0);
});
