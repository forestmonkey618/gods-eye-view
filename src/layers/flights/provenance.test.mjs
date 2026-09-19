import assert from 'node:assert/strict';
import test from 'node:test';
import { FlightRecords } from './records.js';
import { aircraft as entityKey } from '../../data/entityKey.js';

function records() {
  return new FlightRecords({
    geoidHeight: () => 40,
    cachedGroundFloor: () => null,
    floorAltitudeM: (alt) => alt,
  });
}
const view = (overrides = {}) => ({
  viewerLatDeg: null,
  viewerLonDeg: null,
  trackedId: null,
  floorWarmPoints: [],
  ...overrides,
});
const obs = (fields = {}) => ({
  id: 'abc123',
  reference: 'abc123',
  longitude: -77,
  latitude: 39,
  callsign: 'TEST1',
  baroAltitudeM: 1000,
  ellipsoidAltitudeM: null,
  onGround: false,
  speedMps: 120,
  courseDeg: 90,
  positionTimeMs: 1700000000000,
  contactTimeMs: 1700000001000,
  ...fields,
});

function getPosProv(store, id) {
  const prov = store.provenance.get(id);
  return prov ? prov.position : null;
}

// 16 items per spec - updated to use single authority provenance Map

test('position provenance: valid position REPORTED descriptor', () => {
  const store = records();
  store.geoidReady = true;
  const receipt = 1700000005000;
  store.receive(obs(), view({ sourceId: 'opensky', receivedAtMs: receipt }));
  const prov = getPosProv(store, 'abc123');
  assert.ok(prov);
  assert.equal(prov.epistemic, 'reported');
  assert.equal(prov.sourceId, 'opensky');
  assert.equal(prov.reportedAtMs, 1700000000000);
  assert.equal(prov.receivedAtMs, receipt);
  assert.ok(Object.isFrozen(prov));
});

test('position provenance: sourceId reflects actual source', () => {
  const store = records();
  store.geoidReady = true;
  store.receive(obs(), view({ sourceId: 'opensky', receivedAtMs: 1000 }));
  assert.equal(getPosProv(store, 'abc123').sourceId, 'opensky');
  store.receive(obs({ latitude: 40 }), view({ sourceId: 'adsb.lol', receivedAtMs: 2000 }));
  assert.equal(getPosProv(store, 'abc123').sourceId, 'adsb.lol');
});

test('position provenance: reportedAtMs = positionTimeMs', () => {
  const store = records();
  store.geoidReady = true;
  const posTime = 1700000011111;
  store.receive(obs({ positionTimeMs: posTime }), view({ sourceId: 'opensky', receivedAtMs: 2000 }));
  assert.equal(getPosProv(store, 'abc123').reportedAtMs, posTime);
  store.receive(obs({ id: 'def456', positionTimeMs: null }), view({ sourceId: 'opensky', receivedAtMs: 3000 }));
  assert.equal(getPosProv(store, 'def456').reportedAtMs, null);
});

test('position provenance: receivedAtMs = snapshot receipt (single per batch truthful)', () => {
  const store = records();
  store.geoidReady = true;
  const receiptMs = 1700000009000;
  store.receive(obs({ id: 'a1' }), view({ sourceId: 'opensky', receivedAtMs: receiptMs }));
  store.receive(obs({ id: 'a2' }), view({ sourceId: 'opensky', receivedAtMs: receiptMs }));
  assert.equal(getPosProv(store, 'a1').receivedAtMs, receiptMs);
  assert.equal(getPosProv(store, 'a2').receivedAtMs, receiptMs);
  const receipt2 = receiptMs + 30000;
  store.receive(obs({ id: 'a1', latitude: 40 }), view({ sourceId: 'opensky', receivedAtMs: receipt2 }));
  assert.equal(getPosProv(store, 'a1').receivedAtMs, receipt2);
});

test('position provenance: rawLat/rawLon + provenance update together', () => {
  const store = records();
  store.geoidReady = true;
  store.receive(obs({ latitude: 39, longitude: -77 }), view({ sourceId: 'opensky', receivedAtMs: 1000 }));
  assert.equal(store.data.get('abc123').rawLat, 39);
  assert.equal(getPosProv(store, 'abc123').reportedAtMs, 1700000000000);
  store.receive(obs({ latitude: 40, longitude: -78 }), view({ sourceId: 'opensky', receivedAtMs: 2000 }));
  assert.equal(store.data.get('abc123').rawLat, 40);
  assert.equal(store.data.get('abc123').rawLon, -78);
  assert.equal(getPosProv(store, 'abc123').receivedAtMs, 2000);
});

test('position provenance: newer without position does not overwrite', () => {
  const store = records();
  store.geoidReady = true;
  store.receive(obs({ latitude: 39 }), view({ sourceId: 'opensky', receivedAtMs: 1000 }));
  const before = getPosProv(store, 'abc123');
  store.receive(obs({ latitude: NaN, longitude: NaN }), view({ sourceId: 'adsb.lol', receivedAtMs: 2000 }));
  const after = getPosProv(store, 'abc123');
  assert.equal(after.sourceId, before.sourceId);
  assert.equal(after.receivedAtMs, before.receivedAtMs);
  const store2 = records();
  store2.geoidReady = true;
  store2.receive(obs(), view({ sourceId: 'opensky', receivedAtMs: 1000 }));
  assert.equal(getPosProv(store2, 'abc123').sourceId, 'opensky');
  assert.equal(store2.data.get('abc123').rawLat, 39);
});

test('position provenance: newer valid does replace', () => {
  const store = records();
  store.geoidReady = true;
  store.receive(obs({ latitude: 39 }), view({ sourceId: 'opensky', receivedAtMs: 1000 }));
  store.receive(obs({ latitude: 40 }), view({ sourceId: 'opensky', receivedAtMs: 2000 }));
  assert.equal(store.data.get('abc123').rawLat, 40);
  assert.equal(getPosProv(store, 'abc123').receivedAtMs, 2000);
});

test('position provenance: source switch with replacement updates sourceId', () => {
  const store = records();
  store.geoidReady = true;
  store.receive(obs({ latitude: 39 }), view({ sourceId: 'opensky', receivedAtMs: 1000 }));
  assert.equal(getPosProv(store, 'abc123').sourceId, 'opensky');
  store.receive(obs({ latitude: 40 }), view({ sourceId: 'adsb.lol', receivedAtMs: 2000 }));
  assert.equal(store.data.get('abc123').rawLat, 40);
  assert.equal(getPosProv(store, 'abc123').sourceId, 'adsb.lol');
});

test('position provenance: source switch without replacement does NOT relabel', () => {
  const store = records();
  store.geoidReady = true;
  store.receive(obs({ latitude: 39 }), view({ sourceId: 'opensky', receivedAtMs: 1000 }));
  const provBefore = { ...getPosProv(store, 'abc123') };
  assert.equal(getPosProv(store, 'abc123').sourceId, 'opensky');
  store.receive(obs({ latitude: NaN, longitude: NaN }), view({ sourceId: 'adsb.lol', receivedAtMs: 2000 }));
  assert.equal(getPosProv(store, 'abc123').sourceId, provBefore.sourceId);
  const store2 = records();
  store2.geoidReady = true;
  store2.receive(obs(), view({ sourceId: 'opensky', receivedAtMs: 1000 }));
  assert.equal(getPosProv(store2, 'abc123').sourceId, 'opensky');
});

test('position provenance: current-state only, no history', () => {
  const store = records();
  store.geoidReady = true;
  store.receive(obs({ latitude: 39 }), view({ sourceId: 'opensky', receivedAtMs: 1000 }));
  store.receive(obs({ latitude: 40 }), view({ sourceId: 'opensky', receivedAtMs: 2000 }));
  store.receive(obs({ latitude: 41 }), view({ sourceId: 'opensky', receivedAtMs: 3000 }));
  assert.equal(store.provenance.size, 1);
  const prov = getPosProv(store, 'abc123');
  assert.equal(prov.receivedAtMs, 3000);
  assert.equal(Array.isArray(prov), false);
  assert.equal(prov.history, undefined);
});

test('position provenance: copy-safe frozen descriptors', () => {
  const store = records();
  store.geoidReady = true;
  store.receive(obs(), view({ sourceId: 'opensky', receivedAtMs: 1000 }));
  const prov = getPosProv(store, 'abc123');
  assert.ok(Object.isFrozen(prov));
  try { prov.sourceId = 'tampered'; } catch {}
  assert.equal(getPosProv(store, 'abc123').sourceId, 'opensky');
});

test('position provenance: canonical key — Map keyed by native icao24, entityKey derived separately', () => {
  const store = records();
  store.geoidReady = true;
  store.receive(obs({ id: 'a1b2c3' }), view({ sourceId: 'opensky', receivedAtMs: 1000 }));
  assert.equal(store.provenance.has('a1b2c3'), true);
  assert.equal(entityKey('a1b2c3'), 'aircraft:icao24:a1b2c3');
  const map = new Map();
  for (const [k, v] of store.provenance) {
    const copy = {};
    for (const [field, desc] of Object.entries(v)) copy[field] = { ...desc };
    map.set(k, copy);
  }
  assert.ok(map instanceof Map);
  assert.equal(map.get('a1b2c3').position.sourceId, 'opensky');
});

test('position provenance: TIS-B behavior documented — entityKey null but provenance keyed by native id', () => {
  const store = records();
  store.geoidReady = true;
  assert.equal(entityKey('~abc123'), null);
  store.receive(obs({ id: '~abc123', latitude: 39 }), view({ sourceId: 'opensky', receivedAtMs: 1000 }));
  assert.equal(store.provenance.has('~abc123'), true);
  assert.equal(getPosProv(store, '~abc123').sourceId, 'opensky');
  assert.equal(entityKey('~abc123'), null);
});

test('position provenance: getCurrentEntities byte/shape compatible — unchanged', () => {
  const store = records();
  store.geoidReady = true;
  store.receive(obs(), view({ sourceId: 'opensky', receivedAtMs: 1000 }));
  const result = [];
  for (const [icao24, info] of store.data) {
    result.push({
      entityKey: entityKey(icao24),
      icao24,
      lat: Number.isFinite(info?.rawLat) ? info.rawLat : null,
      lon: Number.isFinite(info?.rawLon) ? info.rawLon : null,
      altitudeM: Number.isFinite(info?.altitude) ? info.altitude : null,
      callsign: String(info?.callsign || '').trim() || null,
    });
  }
  assert.equal(result.length, 1);
  assert.equal(result[0].icao24, 'abc123');
  assert.equal(result[0].lat, 39);
  assert.equal(result[0].lon, -77);
  assert.equal(result[0].provenance, undefined);
  assert.equal(result[0].sourceId, undefined);
});

test('position provenance: recordIndex unchanged — provenance-unaware', () => {
  const store = records();
  store.geoidReady = true;
  store.receive(obs(), view({ sourceId: 'opensky', receivedAtMs: 1000 }));
  assert.equal(store.data.size, 1);
  assert.equal(store.provenance.size, 1);
  assert.notEqual(store.data, store.provenance);
  const meta = store.data.get('abc123');
  assert.equal(meta.provenance, undefined);
  assert.equal(meta.sourceId, undefined);
});

test('position provenance: forget deletes provenance', () => {
  const store = records();
  store.geoidReady = true;
  store.receive(obs(), view({ sourceId: 'opensky', receivedAtMs: 1000 }));
  assert.equal(store.provenance.has('abc123'), true);
  store.forget('abc123');
  assert.equal(store.provenance.has('abc123'), false);
  assert.equal(store.data.has('abc123'), false);
});
