// I2 production adapter — the canonical record index built from the REAL
// production stores, and its production consumer (the voice
// get_current_view_state tracked read-back). Every layer below is constructed
// by the application factories and driven by a real LayerLifecycle; only the
// network sources are fixtures, fed through the production snapshot
// normalizers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as Cesium from 'cesium';
import { LayerLifecycle } from './lifecycle.js';
import { buildCurrentRecordIndex } from './currentRecordIndex.js';
import { createGevActionRunner } from '../voice/gevActions.js';
import { defaultSurface } from './surfaceServices.js';
import { createMilitaryRegistry } from '../layers/aircraft/classification.js';
import { createApplicationFlights } from '../app/layers/flights.js';
import { createApplicationMilitary } from '../app/layers/militaryFlights.js';
import { createApplicationVessels } from '../app/layers/aisLiveVessels.js';
import { openSkySnapshot, readsbSnapshot } from '../sources/live/aircraft.js';
import { vesselSnapshot } from '../sources/live/vessels.js';

const SHARED = 'ae01ce'; // one airframe reported by both aircraft feeds
const CIVIL = 'a1b2c3';
const SHARED_KEY = `aircraft:icao24:${SHARED}`;
const CIVIL_KEY = `aircraft:icao24:${CIVIL}`;

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

/** One OpenSky state vector (the production /api/opensky row shape). */
function openSkyRow(id, callsign, lon, lat) {
  const t = nowSec();
  return [
    id,
    callsign,
    'United States',
    t - 2,
    t - 1,
    lon,
    lat,
    8534,
    false,
    205,
    95,
    0,
    null,
    8600,
    null,
    null,
    null,
    6,
  ];
}

/** Viewer stub rich enough for the real init/enable/disable/destroy paths. */
function createViewer() {
  const primitives = [];
  let trackedEntity;
  const trackedEntityChanged = new Cesium.Event();
  const position = Cesium.Cartesian3.fromDegrees(-97.5, 30.5, 20_000);
  const camera = {
    positionCartographic: Cesium.Cartographic.fromDegrees(-97.5, 30.5, 20_000),
    positionWC: position,
    position,
    direction: Cesium.Cartesian3.UNIT_Y,
    heading: 0,
    pitch: -1.2,
    roll: 0,
    transform: Cesium.Matrix4.IDENTITY,
    viewMatrix: Cesium.Matrix4.IDENTITY,
    frustum: { projectionMatrix: Cesium.Matrix4.IDENTITY },
    moveEnd: new Cesium.Event(),
    cancelFlight() {},
    lookAtTransform() {},
  };
  const viewer = {
    camera,
    // Every primitive the real layers added, so a test can hide them all.
    rendered: primitives,
    clock: {
      currentTime: Cesium.JulianDate.now(),
      onTick: new Cesium.Event(),
    },
    scene: {
      camera,
      primitives: {
        add: (primitive) => (primitives.push(primitive), primitive),
        remove: (primitive) => {
          primitives.splice(primitives.indexOf(primitive), 1);
          return true;
        },
        raiseToTop() {},
        contains: (primitive) => primitives.includes(primitive),
      },
      canvas: {
        addEventListener() {},
        removeEventListener() {},
        clientWidth: 100,
        clientHeight: 100,
        getBoundingClientRect: () => ({ left: 0, top: 0 }),
      },
      preRender: new Cesium.Event(),
      preUpdate: new Cesium.Event(),
      frameState: { frameNumber: 1, mode: Cesium.SceneMode.SCENE3D },
      screenSpaceCameraController: null,
    },
    trackedEntityChanged,
    entities: new Cesium.EntityCollection(),
    isDestroyed: () => false,
  };
  Object.defineProperty(viewer, 'trackedEntity', {
    get: () => trackedEntity,
    set(value) {
      trackedEntity = value;
      trackedEntityChanged.raiseEvent(value);
    },
  });
  return viewer;
}

const harnessesByTest = new WeakMap();

/**
 * Install browser-shaped globals once per test and tear down, in one hook,
 * every production layer the test built before restoring them. Destroying a
 * layer needs these globals, so restoration must come last.
 */
function testHarnesses(t) {
  let harnesses = harnessesByTest.get(t);
  if (harnesses) return harnesses;
  harnesses = [];
  harnessesByTest.set(t, harnesses);
  const saved = {
    window: globalThis.window,
    document: globalThis.document,
    fetch: globalThis.fetch,
    log: console.log,
  };
  const win = new EventTarget();
  win.setTimeout = setTimeout;
  win.clearTimeout = clearTimeout;
  win.requestIdleCallback = null;
  globalThis.window = win;
  globalThis.document = {
    body: { classList: { contains: () => false } },
    addEventListener() {},
    removeEventListener() {},
    getElementById: () => null,
  };
  // No network in unit tests: only the fixture sources supply data.
  globalThis.fetch = async () => ({
    ok: false,
    status: 503,
    json: async () => ({}),
  });
  console.log = () => {};
  t.after(async () => {
    try {
      for (const { lifecycle, militaryRegistry } of harnesses) {
        await lifecycle.destroyAll();
        militaryRegistry.dispose();
        // A layer that failed to tear down would leak its poll interval.
        assert.equal(lifecycle.layers.size, 0, 'every layer was destroyed');
      }
    } finally {
      globalThis.window = saved.window;
      globalThis.document = saved.document;
      globalThis.fetch = saved.fetch;
      console.log = saved.log;
    }
  });
  return harnesses;
}

/**
 * Build the three production stores behind a real lifecycle. Each feed's rows
 * are mutable so a test can change what the next poll reports.
 */
function createProductionStores(t) {
  const harnesses = testHarnesses(t);
  const feeds = {
    civil: [
      openSkyRow(CIVIL, 'SWA696  ', -97.67, 30.19),
      openSkyRow(SHARED, 'RCH451  ', -97.0, 31.0),
      openSkyRow('~abc123', 'TISB1   ', -97.1, 30.9), // TIS-B: no canonical key
    ],
    military: [
      {
        hex: SHARED,
        lat: 31.02,
        lon: -97.01,
        alt_baro: 28_000,
        gs: 400,
        track: 95,
        seen: 1,
        seen_pos: 2,
        flight: 'RCH451 ',
        t: 'C17',
      },
    ],
    vessels: [
      {
        mmsi: '012345678',
        lat: 51.95,
        lon: 4.1,
        name: 'LEADING ZERO',
        speed: 3,
        course: 10,
        heading: 11,
        last_position_epoch: nowSec() - 5,
      },
      {
        mmsi: '12345678',
        lat: 51.96,
        lon: 4.2,
        name: 'EIGHT DIGITS',
        speed: 1,
        course: 200,
        heading: 201,
        last_position_epoch: nowSec() - 5,
      },
    ],
  };
  const flightsSource = {
    label: 'Fixture OpenSky',
    async getSnapshot() {
      const now = Date.now();
      return {
        ...openSkySnapshot(
          { time: nowSec(), states: feeds.civil },
          { sourceId: 'opensky', now, receivedAtMs: now },
        ),
        status: 200,
      };
    },
  };
  const militarySource = {
    label: 'Fixture adsb.lol',
    async getSnapshot() {
      const now = Date.now();
      return {
        ...readsbSnapshot(
          { now, ac: feeds.military },
          { observedAtMs: now, sourceId: 'adsb.lol', now, receivedAtMs: now },
        ),
        status: 200,
      };
    },
  };
  const vesselSource = {
    label: 'Fixture AIS',
    async getSnapshot() {
      const now = Date.now();
      return {
        ...vesselSnapshot(
          { rows: feeds.vessels, status: 'live', lastMessageAt: now },
          { sourceId: 'aisstream', now, receivedAtMs: now },
        ),
        status: 200,
      };
    },
    async getTrack() {
      return { records: [], complete: false };
    },
  };

  const viewer = createViewer();
  const militaryRegistry = createMilitaryRegistry();
  const flights = createApplicationFlights({
    surface: defaultSurface,
    source: flightsSource,
    militaryRegistry,
  });
  const military = createApplicationMilitary({
    surface: defaultSurface,
    source: militarySource,
    militaryRegistry,
  });
  const vessels = createApplicationVessels({
    source: vesselSource,
    options: { maxLabels: 0 },
  });
  vessels.testing._setAisRuntimeForTest({
    now: () => Date.now(),
    setTimeout: () => 0,
    clearTimeout() {},
  });
  vessels.testing._setVesselOverlayHostForTest({
    setEntries() {},
    setVisible() {},
    clearSource() {},
    hitTest: () => null,
  });
  const lifecycle = new LayerLifecycle(viewer);
  for (const layer of [flights, military, vessels]) lifecycle.register(layer);
  const harness = {
    lifecycle,
    viewer,
    feeds,
    flights,
    military,
    vessels,
    militaryRegistry,
  };
  harnesses.push(harness);
  return harness;
}

/** entityKey → sorted store ids, the attribution a consumer reads. */
function attribution(index) {
  return Object.fromEntries(
    index
      .values()
      .map((entry) => [
        entry.entityKey,
        entry.records.map((item) => item.storeId),
      ]),
  );
}

/**
 * Let a production store move on the instant the adapter has captured it.
 * The first read returns the store's real records and then runs `moveOn` (a
 * real store change); every later read counts as a reread and sees
 * `later(records)`. `restore()` reinstates the plain accessor.
 */
function moveOnAfterCapture(
  layer,
  { moveOn = () => {}, later = (records) => records } = {},
) {
  const read = layer.getCurrentEntities;
  const reads = { captured: 0, reread: 0 };
  layer.getCurrentEntities = () => {
    if (reads.captured > 0) {
      reads.reread += 1;
      return later(read());
    }
    reads.captured += 1;
    const capture = read();
    moveOn();
    return capture;
  };
  return {
    reads,
    restore() {
      layer.getCurrentEntities = read;
    },
  };
}

test('production vessel records are valid buildRecordIndex input (verified, not assumed)', async (t) => {
  const { lifecycle, vessels } = createProductionStores(t);
  await lifecycle.setEnabled('ais-live-vessels', true);
  const stored = vessels.getCurrentEntities();
  // The real accessor exposes canonical and non-canonical records alike…
  assert.deepEqual(
    stored.map(({ entityKey, mmsi }) => [entityKey, mmsi]),
    [
      ['vessel:mmsi:012345678', '012345678'],
      [null, '12345678'],
    ],
  );
  for (const record of stored)
    for (const [field, value] of Object.entries(record))
      assert.ok(
        value === null ||
          ['string', 'number', 'boolean'].includes(typeof value),
        `${field} is primitive`,
      );
  // …and the adapter admits the canonical one under storeId 'vessels'.
  const { index, stores } = buildCurrentRecordIndex(lifecycle);
  assert.deepEqual(
    stores.map(({ storeId }) => storeId),
    ['vessels'],
  );
  assert.deepEqual(attribution(index), {
    'vessel:mmsi:012345678': ['vessels'],
  });
  assert.equal(
    index.get('vessel:mmsi:012345678').records[0].record.name,
    'LEADING ZERO',
  );
});

test('one aircraft in both production stores is one entity with two separately attributed records', async (t) => {
  const { lifecycle } = createProductionStores(t);
  await lifecycle.setEnabled('flights', true);
  // Enabling Military does not purge the civil copy until the next civil poll:
  // both stores genuinely hold the airframe now.
  await lifecycle.setEnabled('military', true);
  const { index, stores } = buildCurrentRecordIndex(lifecycle);
  assert.deepEqual(
    stores.map(({ storeId }) => storeId),
    ['flights', 'military'],
  );
  const entry = index.get(SHARED_KEY);
  assert.deepEqual(
    entry.records.map(({ storeId }) => storeId),
    ['flights', 'military'],
  );
  const [civil, military] = entry.records.map(({ record }) => record);
  assert.equal(civil.icao24, SHARED);
  assert.equal(military.icao24, SHARED);
  // Payloads are the stores' own, not merged: civil keeps its OpenSky fix,
  // military its adsb.lol fix.
  assert.equal(civil.lat, 31.0);
  assert.equal(military.lat, 31.02);
  assert.notEqual(civil.altitudeM, military.altitudeM);
  assert.equal(
    index.size,
    2,
    'one canonical entity per airframe, not per store',
  );
  assert.deepEqual(attribution(index)[CIVIL_KEY], ['flights']);
});

test('invalid and missing identities never enter the production index', async (t) => {
  const { lifecycle, feeds, flights } = createProductionStores(t);
  feeds.civil.push(openSkyRow('zzzzzz', 'NONHEX  ', -97.2, 30.8));
  feeds.civil.push(openSkyRow('abc', 'SHORT   ', -97.3, 30.7));
  await lifecycle.setEnabled('flights', true);
  await lifecycle.setEnabled('ais-live-vessels', true);
  const held = flights.getCurrentEntities();
  assert.deepEqual(
    held
      .filter((record) => record.entityKey === null)
      .map((r) => r.icao24)
      .sort(),
    ['abc', 'zzzzzz', '~abc123'],
    'the store retains non-canonical contacts with a null key',
  );
  const { index } = buildCurrentRecordIndex(lifecycle);
  assert.deepEqual(Object.keys(attribution(index)), [
    CIVIL_KEY,
    SHARED_KEY,
    'vessel:mmsi:012345678',
  ]);
  for (const probe of [
    'aircraft:icao24:~abc123',
    'aircraft:icao24:zzzzzz',
    'aircraft:icao24:abc',
    'vessel:mmsi:12345678',
    'SWA696',
    'banana',
  ])
    assert.equal(index.has(probe), false, probe);
  // No identity is derived from callsign, display name or position.
  const values = JSON.stringify(index.values());
  assert.doesNotMatch(values, /TISB1|NONHEX|SHORT|EIGHT DIGITS/);
});

test('disabled, disabling and re-enabling stores contribute nothing, though their caches remain', async (t) => {
  const { lifecycle, flights, military } = createProductionStores(t);
  await lifecycle.setEnabled('flights', true);
  await lifecycle.setEnabled('military', true);
  await lifecycle.setEnabled('military', false);
  assert.deepEqual(
    military.getCurrentEntities().map((record) => record.entityKey),
    [SHARED_KEY],
    'the disabled store still retains its cache',
  );
  let { index, stores } = buildCurrentRecordIndex(lifecycle);
  assert.deepEqual(
    stores.map(({ storeId }) => storeId),
    ['flights'],
  );
  assert.deepEqual(attribution(index)[SHARED_KEY], ['flights']);

  // Disabling: the manager still reports enabled:true while disable() runs.
  let observedWhileDisabling = null;
  const unsubscribe = lifecycle.subscribe((change) => {
    if (change.type === 'visibility-transition' && change.layerId === 'flights')
      observedWhileDisabling = buildCurrentRecordIndex(lifecycle);
  });
  await lifecycle.setEnabled('flights', false);
  unsubscribe();
  assert.equal(observedWhileDisabling.index.size, 0);
  assert.deepEqual(observedWhileDisabling.stores, []);
  assert.ok(flights.getCurrentEntities().length > 0, 'civil cache retained');
  ({ index, stores } = buildCurrentRecordIndex(lifecycle));
  assert.equal(index.size, 0);
  assert.deepEqual(stores, []);

  // Re-enabling: the retained cache is not current until the first poll lands.
  let observedWhileEnabling = null;
  const unsubscribeEnable = lifecycle.subscribe((change) => {
    if (
      change.type === 'visibility-transition' &&
      change.layerId === 'military'
    )
      observedWhileEnabling = buildCurrentRecordIndex(lifecycle);
  });
  await lifecycle.setEnabled('military', true);
  unsubscribeEnable();
  assert.equal(observedWhileEnabling.index.size, 0);
  ({ index } = buildCurrentRecordIndex(lifecycle));
  assert.deepEqual(attribution(index), { [SHARED_KEY]: ['military'] });
});

test('an uncertain lifecycle is not current; neither is an unregistered or accessor-less layer', () => {
  const store = {
    getCurrentEntities: () => [
      {
        entityKey: CIVIL_KEY,
        icao24: CIVIL,
        lat: 1,
        lon: 2,
        altitudeM: 3,
        callsign: 'X',
      },
    ],
  };
  const manager = (state, module = store) => ({
    getLayerLifecycleState: (layerId) => (layerId === 'flights' ? state : null),
    layers: new Map([['flights', { module }]]),
  });
  const on = { enabled: true, lifecycleState: 'enabled', uncertain: false };
  assert.equal(buildCurrentRecordIndex(manager(on)).index.size, 1);
  assert.equal(
    buildCurrentRecordIndex(manager({ ...on, uncertain: true })).index.size,
    0,
  );
  assert.equal(buildCurrentRecordIndex(manager(on, {})).index.size, 0);
  assert.equal(buildCurrentRecordIndex(manager(null)).index.size, 0);
  assert.equal(buildCurrentRecordIndex(null).index.size, 0);
  assert.equal(buildCurrentRecordIndex({}).index.size, 0);
});

test('updates and removals follow the stores; an absence is never an inferred departure', async (t) => {
  const { lifecycle, feeds, flights } = createProductionStores(t);
  await lifecycle.setEnabled('flights', true);
  await lifecycle.setEnabled('military', true);
  const before = buildCurrentRecordIndex(lifecycle).index;

  // Next civil poll: the Military layer now owns the shared airframe, so the
  // civil store drops it; the civil airliner moves.
  feeds.civil[0] = openSkyRow(CIVIL, 'SWA696  ', -97.5, 30.3);
  await lifecycle.refreshLayer('flights');
  let { index } = buildCurrentRecordIndex(lifecycle);
  assert.deepEqual(attribution(index)[SHARED_KEY], ['military']);
  assert.equal(index.get(CIVIL_KEY).records[0].record.lon, -97.5);
  // Earlier snapshots are untouched: no shared mutable state, no history.
  assert.deepEqual(attribution(before)[SHARED_KEY], ['flights', 'military']);
  assert.equal(before.get(CIVIL_KEY).records[0].record.lon, -97.67);

  // A missing poll keeps the contact (stale) — the index still carries it.
  feeds.civil = feeds.civil.filter((row) => row[0] !== CIVIL);
  await lifecycle.refreshLayer('flights');
  ({ index } = buildCurrentRecordIndex(lifecycle));
  assert.equal(index.has(CIVIL_KEY), true, 'one missing poll is not a removal');
  // Evicted after the store's missed-poll limit: the entity simply is not
  // indexed any more. The index exposes no departure, tombstone or diff.
  await lifecycle.refreshLayer('flights');
  await lifecycle.refreshLayer('flights');
  assert.equal(
    flights.getCurrentEntities().some((r) => r.icao24 === CIVIL),
    false,
  );
  ({ index } = buildCurrentRecordIndex(lifecycle));
  assert.equal(index.has(CIVIL_KEY), false);
  assert.equal(index.get(CIVIL_KEY), undefined);
  assert.deepEqual(Object.keys(index).sort(), ['get', 'has', 'size', 'values']);
});

test('building and mutating the index never mutates the authoritative stores', async (t) => {
  const { lifecycle, flights, military, vessels } = createProductionStores(t);
  for (const id of ['flights', 'military', 'ais-live-vessels'])
    await lifecycle.setEnabled(id, true);
  const snapshot = () =>
    JSON.stringify([
      flights.getCurrentEntities(),
      military.getCurrentEntities(),
      vessels.getCurrentEntities(),
      [...flights.getProvenanceMap()],
      [...military.getProvenanceMap()],
      [...vessels.getProvenanceMap()],
    ]);
  const baseline = snapshot();
  const { index, stores } = buildCurrentRecordIndex(lifecycle);
  const entry = index.get(SHARED_KEY);
  entry.records[0].record.lat = -1;
  entry.records[1].record.callsign = 'TAMPERED';
  entry.records.pop();
  for (const item of index.values())
    for (const { record } of item.records) record.entityKey = 'banana';
  // The exposed capture cannot be extended, and its records are the
  // accessors' fresh copies: tampering with them reaches neither the stores
  // nor the index built from them.
  assert.throws(() => stores[0].records.push({ entityKey: CIVIL_KEY }));
  for (const store of stores)
    for (const record of store.records) record.entityKey = 'banana';
  assert.equal(snapshot(), baseline, 'store records and provenance unchanged');
  assert.deepEqual(
    index.get(SHARED_KEY).records.map(({ record }) => record.callsign),
    ['RCH451', 'RCH451'],
    'index copies are independent of consumer mutation',
  );
  assert.equal(Object.isFrozen(index), true);
});

test('each eligible store is read once, and the index is built from exactly the records exposed beside it', async (t) => {
  const { lifecycle, flights, military, vessels } = createProductionStores(t);
  for (const id of ['flights', 'military', 'ais-live-vessels'])
    await lifecycle.setEnabled(id, true);
  await lifecycle.setEnabled('military', false);
  const reads = { flights: [], military: [], vessels: [] };
  for (const [storeId, layer] of Object.entries({
    flights,
    military,
    vessels,
  })) {
    const read = layer.getCurrentEntities;
    layer.getCurrentEntities = () => {
      const records = read();
      reads[storeId].push(records);
      return records;
    };
  }
  const { index, stores } = buildCurrentRecordIndex(lifecycle);
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(reads).map(([storeId, calls]) => [storeId, calls.length]),
    ),
    { flights: 1, military: 0, vessels: 1 },
    'one read per settled-ON store; none of the disabled one',
  );
  assert.equal(Object.isFrozen(stores), true);
  for (const store of stores) {
    const [captured] = reads[store.storeId];
    assert.equal(Object.isFrozen(store), true);
    assert.equal(Object.isFrozen(store.records), true);
    // That read's own record objects, in order: nothing reread or rebuilt.
    assert.equal(store.records.length, captured.length);
    store.records.forEach((record, i) => assert.equal(record, captured[i]));
    assert.equal(
      Object.isFrozen(captured),
      false,
      "the accessor's own array is left untouched",
    );
  }
  // The index holds exactly the canonical records of that same capture.
  const captured = {};
  for (const { storeId, records } of stores)
    for (const { entityKey } of records)
      if (entityKey !== null) (captured[entityKey] ??= []).push(storeId);
  assert.deepEqual(attribution(index), captured);
  assert.deepEqual(captured, {
    [CIVIL_KEY]: ['flights'],
    [SHARED_KEY]: ['flights'],
    'vessel:mmsi:012345678': ['vessels'],
  });
  assert.ok(
    stores[0].records.some((record) => record.entityKey === null),
    'non-canonical records are captured too; only the index decides identity',
  );
});

test('results are deterministic across rebuilds and independent of enable order', async (t) => {
  const first = createProductionStores(t);
  for (const id of ['flights', 'military', 'ais-live-vessels'])
    await first.lifecycle.setEnabled(id, true);
  const one = buildCurrentRecordIndex(first.lifecycle);
  const again = buildCurrentRecordIndex(first.lifecycle);
  assert.notEqual(one.index, again.index, 'each call is a fresh rebuild');
  assert.deepEqual(one.index.values(), again.index.values());
  assert.deepEqual(one.stores, again.stores);
  // Entities sort by entityKey; records inside an entity sort by storeId.
  const keys = one.index.values().map((entry) => entry.entityKey);
  assert.deepEqual(keys, [...keys].sort());
  for (const entry of one.index.values()) {
    const storeIds = entry.records.map(({ storeId }) => storeId);
    assert.deepEqual(storeIds, [...storeIds].sort());
  }

  // Reverse enable order. Military then Flights means the civil poll already
  // suppresses the shared airframe, so wait for the same settled state
  // (a civil refresh) in the first set before comparing.
  const second = createProductionStores(t);
  for (const id of ['ais-live-vessels', 'military', 'flights'])
    await second.lifecycle.setEnabled(id, true);
  await first.lifecycle.refreshLayer('flights');
  const settledFirst = buildCurrentRecordIndex(first.lifecycle);
  const settledSecond = buildCurrentRecordIndex(second.lifecycle);
  assert.deepEqual(
    settledSecond.stores.map(({ storeId }) => storeId),
    ['flights', 'military', 'vessels'],
    'store order is fixed, not registration or enable order',
  );
  assert.deepEqual(
    attribution(settledSecond.index),
    attribution(settledFirst.index),
  );
  assert.deepEqual(attribution(settledSecond.index), {
    [CIVIL_KEY]: ['flights'],
    [SHARED_KEY]: ['military'],
    'vessel:mmsi:012345678': ['vessels'],
  });
});

test('eligibility never depends on Cesium rendering or billboard visibility', async (t) => {
  const { lifecycle, viewer } = createProductionStores(t);
  for (const id of ['flights', 'military', 'ais-live-vessels'])
    await lifecycle.setEnabled(id, true);
  const expected = attribution(buildCurrentRecordIndex(lifecycle).index);
  assert.equal(Object.keys(expected).length, 3);

  // Hide every collection and every billboard the real layers rendered.
  const collections = viewer.rendered.filter(
    (primitive) => primitive instanceof Cesium.BillboardCollection,
  );
  let billboards = 0;
  for (const collection of collections) {
    collection.show = false;
    for (let i = 0; i < collection.length; i++) {
      collection.get(i).show = false;
      billboards += 1;
    }
  }
  assert.equal(collections.length, 3, 'one collection per production layer');
  assert.ok(
    billboards >= 3,
    'the layers rendered billboards for their records',
  );
  assert.deepEqual(
    attribution(buildCurrentRecordIndex(lifecycle).index),
    expected,
    'presentation changed; canonical current state did not',
  );

  // The reverse also holds: a disabled layer whose billboards are forced
  // visible still contributes nothing.
  await lifecycle.setEnabled('military', false);
  for (const collection of collections) {
    collection.show = true;
    for (let i = 0; i < collection.length; i++) collection.get(i).show = true;
  }
  const { stores } = buildCurrentRecordIndex(lifecycle);
  assert.deepEqual(
    stores.map(({ storeId }) => storeId),
    ['flights', 'vessels'],
  );
});

test('the adapter module is Cesium/DOM/render independent and routes through buildRecordIndex', () => {
  const source = readFileSync(
    new URL('./currentRecordIndex.js', import.meta.url),
    'utf8',
  );
  const code = source
    .replace(/\/\*\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
  assert.deepEqual(
    [...code.matchAll(/^import .* from '([^']+)';$/gm)].map(
      (match) => match[1],
    ),
    ['./recordIndex.js'],
  );
  assert.match(code, /buildRecordIndex\(collections\)/);
  for (const forbidden of [
    /cesium/i,
    /\bdocument\b/,
    /\bwindow\b/,
    /billboard/i,
    /\.show\b/,
    /getAnalystRecords|getAllPositions|getNearby/,
    /aircraft\(|vessel\(|entityKey\s*=|icao24|mmsi|callsign/,
    /isMilitaryLayerActive|observedReceiptMs|history/i,
  ])
    assert.doesNotMatch(code, forbidden);
});

test('production consumer: get_current_view_state attributes tracked contacts through the index', async (t) => {
  const { lifecycle, viewer, feeds, flights, military, vessels } =
    createProductionStores(t);
  // A malformed 6-digit MMSI spells a valid ICAO24 that the civil feed also
  // carries. Identity must come from the owning store, never from the digits.
  feeds.civil.push(openSkyRow('123456', 'LOOKALIK', -97.4, 30.6));
  feeds.vessels.push({
    mmsi: '123456',
    lat: 51.97,
    lon: 4.3,
    name: 'SIX DIGITS',
    speed: 2,
    course: 30,
    heading: 31,
    last_position_epoch: nowSec() - 5,
  });
  const runner = createGevActionRunner({
    viewer,
    styleManager: { activeStyle: 'normal' },
    dataManager: lifecycle,
  });
  const readBack = (state) =>
    state.tracked.map(({ layerId, icao24, mmsi, canonical }) => ({
      layerId,
      id: icao24 ?? mmsi,
      canonical,
    }));
  // Store reads during each read-back: the adapter's single capture of every
  // settled-ON store and nothing more — attribution never reads a store again.
  const reads = {};
  for (const [storeId, layer] of Object.entries({
    flights,
    military,
    vessels,
  })) {
    const read = layer.getCurrentEntities;
    layer.getCurrentEntities = () => {
      reads[storeId] = (reads[storeId] ?? 0) + 1;
      return read();
    };
  }
  const resetReads = () => {
    for (const storeId of Object.keys(reads)) delete reads[storeId];
  };
  const trackedNow = async () => {
    resetReads();
    return readBack(await runner('get_current_view_state'));
  };

  await lifecycle.setEnabled('flights', true);
  assert.deepEqual(await trackedNow(), []);
  assert.deepEqual(reads, {}, 'nothing tracked: no index is built');

  assert.equal(flights.trackById(SHARED, { origin: 'programmatic' }), true);
  assert.deepEqual(await trackedNow(), [
    {
      layerId: 'flights',
      id: SHARED,
      canonical: {
        entityKey: SHARED_KEY,
        storeIds: ['flights'],
        eligibleStoreIds: ['flights'],
      },
    },
  ]);
  assert.deepEqual(reads, { flights: 1 });

  // Military now reports the same airframe: one entity, both stores named.
  await lifecycle.setEnabled('military', true);
  assert.deepEqual((await trackedNow())[0].canonical, {
    entityKey: SHARED_KEY,
    storeIds: ['flights', 'military'],
    eligibleStoreIds: ['flights', 'military'],
  });
  assert.deepEqual(reads, { flights: 1, military: 1 });

  // Following the military contact releases the civil one; attribution is
  // still to one canonical entity with both current store records.
  assert.equal(military.trackById(SHARED, { origin: 'programmatic' }), true);
  await lifecycle.setEnabled('ais-live-vessels', true);
  assert.equal(vessels.selectById('012345678'), true);
  assert.deepEqual(await trackedNow(), [
    {
      layerId: 'military',
      id: SHARED,
      canonical: {
        entityKey: SHARED_KEY,
        storeIds: ['flights', 'military'],
        eligibleStoreIds: ['flights', 'military', 'vessels'],
      },
    },
    {
      layerId: 'ais-live-vessels',
      id: '012345678',
      canonical: {
        entityKey: 'vessel:mmsi:012345678',
        storeIds: ['vessels'],
        eligibleStoreIds: ['flights', 'military', 'vessels'],
      },
    },
  ]);
  assert.deepEqual(reads, { flights: 1, military: 1, vessels: 1 });

  // While Military is disabling, its contact is still read back but is not
  // attributed — and nothing about it is inferred.
  let duringDisable = null;
  const unsubscribe = lifecycle.subscribe((change) => {
    if (
      change.type === 'visibility-transition' &&
      change.layerId === 'military'
    )
      duringDisable = runner('get_current_view_state');
  });
  resetReads();
  await lifecycle.setEnabled('military', false);
  unsubscribe();
  assert.deepEqual(readBack(await duringDisable), [
    { layerId: 'military', id: SHARED, canonical: null },
    {
      layerId: 'ais-live-vessels',
      id: '012345678',
      canonical: {
        entityKey: 'vessel:mmsi:012345678',
        storeIds: ['vessels'],
        eligibleStoreIds: ['flights', 'vessels'],
      },
    },
  ]);
  assert.deepEqual(
    reads,
    { flights: 1, vessels: 1 },
    'the disabling store is not read',
  );

  // Contacts without canonical identity are read back, never keyed: a TIS-B
  // aircraft, and a vessel whose MMSI would pass as an indexed ICAO24.
  assert.equal(flights.trackById('~abc123', { origin: 'programmatic' }), true);
  assert.equal(vessels.selectById('123456'), true);
  assert.equal(
    buildCurrentRecordIndex(lifecycle).index.has('aircraft:icao24:123456'),
    true,
    'the look-alike aircraft is indexed',
  );
  assert.deepEqual(await trackedNow(), [
    { layerId: 'flights', id: '~abc123', canonical: null },
    { layerId: 'ais-live-vessels', id: '123456', canonical: null },
  ]);
  assert.deepEqual(reads, { flights: 1, vessels: 1 });

  // Re-enabling: Military's retained cache is not current until its first
  // poll lands, so while the layer enables it is neither read nor named.
  // (Tracking a flight releases the vessel selection, so only the airframe
  // is read back from here on.)
  assert.equal(flights.trackById(SHARED, { origin: 'programmatic' }), true);
  let duringEnable = null;
  const unsubscribeEnable = lifecycle.subscribe((change) => {
    if (
      change.type === 'visibility-transition' &&
      change.layerId === 'military'
    )
      duringEnable = runner('get_current_view_state');
  });
  resetReads();
  await lifecycle.setEnabled('military', true);
  unsubscribeEnable();
  assert.deepEqual(readBack(await duringEnable), [
    {
      layerId: 'flights',
      id: SHARED,
      canonical: {
        entityKey: SHARED_KEY,
        storeIds: ['flights'],
        eligibleStoreIds: ['flights', 'vessels'],
      },
    },
  ]);
  assert.deepEqual(
    reads,
    { flights: 1, vessels: 1 },
    'the enabling store is not read',
  );
  assert.deepEqual((await trackedNow())[0].canonical, {
    entityKey: SHARED_KEY,
    storeIds: ['flights', 'military'],
    eligibleStoreIds: ['flights', 'military', 'vessels'],
  });
  assert.deepEqual(reads, { flights: 1, military: 1, vessels: 1 });
});

test('production consumer: attribution comes only from the adapter snapshot, never from rereading a store', async (t) => {
  const { lifecycle, viewer, feeds, flights, military, vessels } =
    createProductionStores(t);
  const runner = createGevActionRunner({
    viewer,
    styleManager: { activeStyle: 'normal' },
    dataManager: lifecycle,
  });
  const canonicalNow = async () =>
    Object.fromEntries(
      (await runner('get_current_view_state')).tracked.map(
        ({ layerId, canonical }) => [layerId, canonical],
      ),
    );
  for (const id of ['flights', 'military', 'ais-live-vessels'])
    await lifecycle.setEnabled(id, true);
  assert.equal(flights.trackById(SHARED, { origin: 'programmatic' }), true);
  assert.equal(vessels.selectById('012345678'), true);
  const everyStore = ['flights', 'military', 'vessels'];
  const expected = {
    flights: {
      entityKey: SHARED_KEY,
      storeIds: ['flights', 'military'],
      eligibleStoreIds: everyStore,
    },
    'ais-live-vessels': {
      entityKey: 'vessel:mmsi:012345678',
      storeIds: ['vessels'],
      eligibleStoreIds: everyStore,
    },
  };
  assert.deepEqual(await canonicalNow(), expected);

  // Presentation is not an input: hiding every rendered collection and
  // billboard changes nothing.
  for (const primitive of viewer.rendered)
    if (primitive instanceof Cesium.BillboardCollection) {
      primitive.show = false;
      for (let i = 0; i < primitive.length; i++) primitive.get(i).show = false;
    }
  assert.deepEqual(await canonicalNow(), expected);

  // Every store moves on the instant the adapter has captured it. The AIS
  // store really evicts the selected vessel through its production reconcile
  // (a selected vessel survives three missed complete snapshots, not four).
  // A later read would see Flights contradict its capture — the tracked
  // airframe under another entity's key, the TIS-B contact under a canonical
  // one — and Military empty.
  const rekeyed = { [SHARED]: CIVIL_KEY, '~abc123': SHARED_KEY };
  const contradict = (records) =>
    records.map((record) =>
      rekeyed[record.icao24]
        ? { ...record, entityKey: rekeyed[record.icao24] }
        : record,
    );
  const remaining = feeds.vessels.filter((row) => row.mmsi !== '012345678');
  const movedOn = [
    moveOnAfterCapture(flights, { later: contradict }),
    moveOnAfterCapture(military, { later: () => [] }),
    moveOnAfterCapture(vessels, {
      moveOn() {
        for (let refresh = 0; refresh < 4; refresh++)
          vessels.testing._reconcileVesselsForTest(viewer, remaining);
      },
    }),
  ];
  assert.deepEqual(
    await canonicalNow(),
    expected,
    'attribution matches the captured snapshot, not the moved-on stores',
  );
  for (const store of movedOn) {
    assert.deepEqual(store.reads, { captured: 1, reread: 0 });
    store.restore();
  }
  assert.equal(
    vessels.getCurrentEntities().some((record) => record.mmsi === '012345678'),
    false,
    'the AIS store really moved on after the capture',
  );

  // A contact captured without canonical identity stays unattributed,
  // whatever a later read of its store would claim.
  assert.equal(flights.trackById('~abc123', { origin: 'programmatic' }), true);
  const civil = moveOnAfterCapture(flights, { later: contradict });
  assert.deepEqual(await canonicalNow(), { flights: null });
  assert.deepEqual(civil.reads, { captured: 1, reread: 0 });
  civil.restore();

  // The owning store's assignment in the capture is the identity, even one
  // the native identifier does not spell (as if the store had correlated the
  // TIS-B track to an ICAO address): the consumer never re-derives a key.
  const read = flights.getCurrentEntities;
  flights.getCurrentEntities = () =>
    read().map((record) =>
      record.icao24 === '~abc123'
        ? { ...record, entityKey: 'aircraft:icao24:abc123' }
        : record,
    );
  assert.deepEqual(await canonicalNow(), {
    flights: {
      entityKey: 'aircraft:icao24:abc123',
      storeIds: ['flights'],
      eligibleStoreIds: everyStore,
    },
  });
  flights.getCurrentEntities = read;
});
