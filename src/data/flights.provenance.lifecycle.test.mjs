// I3c — civil-store provenance lifecycle: no descriptor may outlive its record.
// Runs the PRODUCTION flights layer (mocked OpenSky response → update →
// FlightRecords.receive) and reads back through flightsLayer.getProvenanceMap().
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import flightsLayer, {
  _setTrackedFlightRefreshStateForTest,
} from './flights.js';
import {
  registerMilitaryIcaos,
  setMilitaryLayerActive,
} from './militaryRegistry.js';

const ICAO = 'ae1234'; // a hex the military registry will learn about below

/** No descriptor set may exist for a key the civil store does not currently hold. */
function assertNoOrphans() {
  const held = new Set(flightsLayer.getCurrentEntities().map((e) => e.icao24));
  for (const key of flightsLayer.getProvenanceMap().keys())
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

function seed(viewer) {
  _setTrackedFlightRefreshStateForTest({
    icao24: ICAO,
    entity: { gevLabelModel: { title: '', details: [] } },
    billboard: {
      position: Cesium.Cartesian3.fromDegrees(-97.6, 30.3, 10_668),
      color: Cesium.Color.WHITE,
      show: true,
    },
    billboardCollection: { show: true, remove() {} },
    viewer,
    tracked: false,
    history: [],
    meta: {
      callsign: 'RCH123',
      altitude: 10_668,
      renderAltitudeM: 10_700,
      velocity: 250,
      true_track: 95,
      klass: 'airliner',
      onGround: false,
      wasAirborne: true,
      turnRateDps: 0,
      rawLat: 30.3,
      rawLon: -97.6,
    },
  });
}

function mockOpenSky(t, nowSec, { present = true } = {}) {
  t.mock.method(globalThis, 'fetch', async (url) => {
    if (!String(url).startsWith('/api/opensky'))
      return { ok: true, status: 200, json: async () => ({ ac: [] }) };
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({
        time: nowSec,
        states: !present
          ? []
          : [
              [
                ICAO,
                'RCH123  ',
                'United States',
                nowSec - 2,
                nowSec - 1,
                -97.6,
                30.3,
                10_668,
                false,
                250,
                95,
                0,
                null,
                10_700,
                null,
                null,
                null,
                5,
              ],
            ],
      }),
    };
  });
}

test('the Military-layer activation sweep forgets the record AND its descriptors', async (t) => {
  const viewer = { camera: { positionCartographic: null }, scene: {} };
  seed(viewer);
  mockOpenSky(t, Math.floor(Date.now() / 1000));
  await flightsLayer.update(viewer);
  const before = flightsLayer.getProvenanceMap().get(ICAO);
  assert.equal(before?.position?.sourceId, 'opensky');
  assert.equal(before.position.reportedAtMs > 0, true);

  registerMilitaryIcaos([ICAO]);
  flightsLayer.testing._onMilitaryActiveChangeForTest(true);

  assert.equal(
    flightsLayer.getCurrentEntities().some((e) => e.icao24 === ICAO),
    false,
    'record removed from the civil store',
  );
  assert.equal(
    flightsLayer.getProvenanceMap().has(ICAO),
    false,
    'no orphaned descriptor set survives the sweep',
  );
});

test('destroy() leaves no civil descriptor behind', async (t) => {
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
  mockOpenSky(t, Math.floor(Date.now() / 1000));
  await flightsLayer.update(viewer);
  assert.equal(flightsLayer.getProvenanceMap().size, 1);
  const realDocument = globalThis.document;
  globalThis.document = { removeEventListener() {} };
  try {
    flightsLayer.destroy(viewer);
  } finally {
    globalThis.document = realDocument;
  }
  assert.equal(flightsLayer.getCurrentEntities().length, 0);
  assert.equal(flightsLayer.getProvenanceMap().size, 0);
});

test('the poll-time suppression branch also forgets record and descriptors together', async (t) => {
  const viewer = { camera: { positionCartographic: null }, scene: {} };
  seed(viewer);
  mockOpenSky(t, Math.floor(Date.now() / 1000));
  await flightsLayer.update(viewer);
  assert.equal(flightsLayer.getProvenanceMap().has(ICAO), true);
  registerMilitaryIcaos([ICAO]);
  setMilitaryLayerActive(true);
  try {
    await flightsLayer.update(viewer);
  } finally {
    setMilitaryLayerActive(false);
  }
  assert.equal(
    flightsLayer.getCurrentEntities().some((e) => e.icao24 === ICAO),
    false,
    'duplicate suppressed while the Military layer owns it',
  );
  assert.equal(flightsLayer.getProvenanceMap().has(ICAO), false);
  assertNoOrphans();
});

test('the civil absence sweep forgets the record and its descriptors together (stale polls keep both)', async (t) => {
  const viewer = { camera: { positionCartographic: null }, scene: {} };
  seed(viewer);
  const nowSec = Math.floor(Date.now() / 1000);
  mockOpenSky(t, nowSec);
  await flightsLayer.update(viewer);
  assert.equal(flightsLayer.getProvenanceMap().size, 1);
  for (let miss = 1; miss <= 3; miss++) {
    mockOpenSky(t, nowSec + miss * 30, { present: false });
    await flightsLayer.update(viewer);
    const entities = flightsLayer.getCurrentEntities().length;
    const descriptors = flightsLayer.getProvenanceMap().size;
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

test('real civil init() → poll → destroy() lifecycle: init resets the sidecar with the store, and nothing survives destroy', async (t) => {
  withDom(t);
  const viewer = lifecycleViewer();
  _setTrackedFlightRefreshStateForTest({
    icao24: ICAO,
    entity: null,
    tracked: false,
    history: [],
    billboard: {
      position: Cesium.Cartesian3.fromDegrees(-97.6, 30.3, 10_668),
      color: Cesium.Color.WHITE,
      show: true,
    },
    billboardCollection: { show: true, remove() {} },
    viewer: null,
    meta: {
      callsign: 'RCH123',
      altitude: 10_668,
      renderAltitudeM: 10_700,
      velocity: 250,
      true_track: 95,
      klass: 'airliner',
      onGround: false,
      wasAirborne: true,
      turnRateDps: 0,
      rawLat: 30.3,
      rawLon: -97.6,
    },
  });
  mockOpenSky(t, Math.floor(Date.now() / 1000));
  await flightsLayer.update(viewer);
  assert.equal(
    flightsLayer.getProvenanceMap().size,
    1,
    'populated before init',
  );

  flightsLayer.init(viewer);
  assert.equal(
    flightsLayer.getCurrentEntities().length,
    0,
    'init resets the store',
  );
  assert.equal(
    flightsLayer.getProvenanceMap().size,
    0,
    'init resets the sidecar with it',
  );

  await flightsLayer.update(viewer);
  const entities = flightsLayer.getCurrentEntities();
  assert.equal(entities.length, 1);
  // I2 primitive shape frozen — provenance never leaks into it.
  assert.deepEqual(Object.keys(entities[0]).sort(), [
    'altitudeM',
    'callsign',
    'entityKey',
    'icao24',
    'lat',
    'lon',
  ]);
  for (const key of Object.keys(
    flightsLayer.getAnalystRecords().find((e) => e.icao24 === ICAO),
  ))
    assert.doesNotMatch(key, /provenance|epistemic|sourceId/i);
  assert.equal(
    flightsLayer.getProvenanceMap().get(ICAO).position.sourceId,
    'opensky',
  );
  assertNoOrphans();

  flightsLayer.destroy(viewer);
  assert.equal(flightsLayer.getCurrentEntities().length, 0);
  assert.equal(flightsLayer.getProvenanceMap().size, 0);
});
