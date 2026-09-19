// I3c — civil-store provenance lifecycle: no descriptor may outlive its record.
// Runs the PRODUCTION flights layer (mocked OpenSky response → update →
// FlightRecords.receive) and reads back through flightsLayer.getProvenanceMap().
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import flightsLayer, {
  _setTrackedFlightRefreshStateForTest,
} from './flights.js';
import { registerMilitaryIcaos } from './militaryRegistry.js';

const ICAO = 'ae1234'; // a hex the military registry will learn about below

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

function mockOpenSky(t, nowSec) {
  t.mock.method(globalThis, 'fetch', async (url) => {
    if (!String(url).startsWith('/api/opensky'))
      return { ok: true, status: 200, json: async () => ({ ac: [] }) };
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({
        time: nowSec,
        states: [
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
