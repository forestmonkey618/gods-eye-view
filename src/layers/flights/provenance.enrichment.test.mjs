import assert from 'node:assert/strict';
import test from 'node:test';
import { FlightRecords } from './records.js';
import { EPISTEMIC } from '../../data/provenance.js';
import {
  applyTypeEnrichment,
  applyRouteEnrichment,
  ensureProvObj,
} from './enrichmentCore.js';

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
  callsign: 'AAL123',
  baroAltitudeM: 1000,
  ellipsoidAltitudeM: null,
  onGround: false,
  speedMps: 120,
  courseDeg: 90,
  positionTimeMs: 1700000000000,
  contactTimeMs: 1700000001000,
  ...fields,
});

test('enrichmentCore is production path: type enrichment applies values and REPORTED provenance with shared receipt', () => {
  const store = records();
  store.geoidReady = true;
  store.receive(obs(), view({ sourceId: 'opensky', receivedAtMs: 1000 }));
  const meta = store.data.get('abc123');
  // Initially no enrichment
  assert.equal(meta.typeCode, null);
  const provMap = store.provenance;
  let provObj = provMap.get('abc123');
  // provObj exists but no typeCode yet
  assert.ok(!provObj.typeCode);

  const receipt = 2000;
  const data = { typeCode: 'B738', typeName: 'Boeing 737', registration: 'N12345', found: true };
  const result = applyTypeEnrichment({ meta, provObj, data, receivedAtMs: receipt });

  // Values applied via production helper
  assert.equal(meta.typeCode, 'B738');
  assert.equal(meta.typeName, 'Boeing 737');
  assert.equal(meta.registration, 'N12345');
  assert.equal(result.changed, true);

  // Provenance each REPORTED adsbdb, reportedAtMs null, receivedAtMs = receipt
  assert.equal(provObj.typeCode.epistemic, 'reported');
  assert.equal(provObj.typeCode.sourceId, 'adsbdb');
  assert.equal(provObj.typeCode.reportedAtMs, null);
  assert.equal(provObj.typeCode.receivedAtMs, receipt);
  assert.equal(provObj.typeName.receivedAtMs, receipt);
  assert.equal(provObj.registration.receivedAtMs, receipt);

  // All share same receipt timestamp from one callback
  assert.equal(provObj.typeCode.receivedAtMs, provObj.typeName.receivedAtMs);
  assert.equal(provObj.typeName.receivedAtMs, provObj.registration.receivedAtMs);
});

test('enrichmentCore: retained enrichment retains provenance unchanged across poll', () => {
  const store = records();
  store.geoidReady = true;
  store.receive(obs(), view({ sourceId: 'opensky', receivedAtMs: 1000 }));
  const meta = store.data.get('abc123');
  const provMap = store.provenance;
  let provObj = provMap.get('abc123');

  applyTypeEnrichment({
    meta,
    provObj,
    data: { typeCode: 'B738', typeName: 'B738', registration: 'N123', found: true },
    receivedAtMs: 2000,
  });
  const firstReceipt = provObj.typeCode.receivedAtMs;

  // Simulate another aircraft poll without new enrichment (retention via prevMeta)
  store.receive(obs({ latitude: 40, positionTimeMs: 1700000010000, contactTimeMs: 1700000011000 }), view({ sourceId: 'opensky', receivedAtMs: 3000 }));
  // After receive, typeCode retained via prevMeta ?? null
  assert.equal(store.data.get('abc123').typeCode, 'B738');
  const afterProv = store.provenance.get('abc123');
  // Provenance retained unchanged
  assert.equal(afterProv.typeCode.receivedAtMs, firstReceipt);
  assert.equal(afterProv.typeCode.sourceId, 'adsbdb');
});

test('enrichmentCore: replacement changes value and provenance receipt', () => {
  const store = records();
  store.geoidReady = true;
  store.receive(obs(), view({ sourceId: 'opensky', receivedAtMs: 1000 }));
  const meta = store.data.get('abc123');
  let provObj = store.provenance.get('abc123');

  applyTypeEnrichment({
    meta,
    provObj,
    data: { typeCode: 'B738', found: true },
    receivedAtMs: 2000,
  });
  assert.equal(provObj.typeCode.receivedAtMs, 2000);

  // Replacement with different typeCode
  const result = applyTypeEnrichment({
    meta,
    provObj,
    data: { typeCode: 'A320', found: true },
    receivedAtMs: 5000,
  });
  assert.equal(meta.typeCode, 'A320');
  assert.equal(result.changed, true);
  assert.equal(provObj.typeCode.receivedAtMs, 5000);
  assert.equal(provObj.typeCode.sourceId, 'adsbdb');
});

test('enrichmentCore: same value again does NOT make provenance appear newer', () => {
  const store = records();
  store.geoidReady = true;
  store.receive(obs(), view({ sourceId: 'opensky', receivedAtMs: 1000 }));
  const meta = store.data.get('abc123');
  let provObj = store.provenance.get('abc123');

  applyTypeEnrichment({
    meta,
    provObj,
    data: { typeCode: 'B738', found: true },
    receivedAtMs: 2000,
  });
  const first = provObj.typeCode.receivedAtMs;

  // Same value again with newer receipt
  const result = applyTypeEnrichment({
    meta,
    provObj,
    data: { typeCode: 'B738', found: true },
    receivedAtMs: 9999,
  });
  // Value unchanged, so changed false, and provenance should remain old (not falsely newer)
  assert.equal(meta.typeCode, 'B738');
  assert.equal(result.changed, false);
  assert.equal(provObj.typeCode.receivedAtMs, first, 'should retain old receipt, not update to newer when value same');
});

test('enrichmentCore: route enrichment applies airline and route with REPORTED provenance', () => {
  const store = records();
  store.geoidReady = true;
  store.receive(obs(), view({ sourceId: 'opensky', receivedAtMs: 1000 }));
  const meta = store.data.get('abc123');
  let provObj = store.provenance.get('abc123');

  const receipt = 3000;
  const data = {
    airline: 'American Airlines',
    origin: { code: 'JFK', name: 'JFK' },
    destination: { code: 'LAX', name: 'LAX' },
    found: true,
  };
  const result = applyRouteEnrichment({ meta, provObj, data, receivedAtMs: receipt });

  assert.equal(meta.airline, 'American Airlines');
  assert.equal(meta.route.origin.code, 'JFK');
  assert.equal(meta.route.destination.code, 'LAX');
  assert.equal(result.changed, true);

  assert.equal(provObj.airline.epistemic, 'reported');
  assert.equal(provObj.airline.sourceId, 'adsbdb');
  assert.equal(provObj.airline.reportedAtMs, null);
  assert.equal(provObj.airline.receivedAtMs, receipt);

  assert.equal(provObj.route.sourceId, 'adsbdb');
  assert.equal(provObj.route.reportedAtMs, null);
  assert.equal(provObj.route.receivedAtMs, receipt);
});

test('enrichmentCore: route enrichment same data again retains old provenance', () => {
  const store = records();
  store.geoidReady = true;
  store.receive(obs(), view({ sourceId: 'opensky', receivedAtMs: 1000 }));
  const meta = store.data.get('abc123');
  let provObj = store.provenance.get('abc123');

  applyRouteEnrichment({
    meta,
    provObj,
    data: { airline: 'American', origin: { code: 'JFK' }, destination: { code: 'LAX' }, found: true },
    receivedAtMs: 4000,
  });
  const firstAirline = provObj.airline.receivedAtMs;
  const firstRoute = provObj.route.receivedAtMs;

  // Same data again with newer receipt
  const result = applyRouteEnrichment({
    meta,
    provObj,
    data: { airline: 'American', origin: { code: 'JFK' }, destination: { code: 'LAX' }, found: true },
    receivedAtMs: 9999,
  });
  assert.equal(result.changed, false);
  assert.equal(provObj.airline.receivedAtMs, firstAirline);
  assert.equal(provObj.route.receivedAtMs, firstRoute);
});

test('enrichmentCore: route enrichment replacement updates provenance', () => {
  const store = records();
  store.geoidReady = true;
  store.receive(obs(), view({ sourceId: 'opensky', receivedAtMs: 1000 }));
  const meta = store.data.get('abc123');
  let provObj = store.provenance.get('abc123');

  applyRouteEnrichment({
    meta,
    provObj,
    data: { airline: 'American', origin: { code: 'JFK' }, destination: { code: 'LAX' }, found: true },
    receivedAtMs: 4000,
  });
  applyRouteEnrichment({
    meta,
    provObj,
    data: { airline: 'Delta', origin: { code: 'JFK' }, destination: { code: 'SFO' }, found: true },
    receivedAtMs: 8000,
  });
  assert.equal(meta.airline, 'Delta');
  assert.equal(meta.route.destination.code, 'SFO');
  assert.equal(provObj.airline.receivedAtMs, 8000);
  assert.equal(provObj.route.receivedAtMs, 8000);
});

test('enrichmentCore: klass DERIVED provenance via classification when typeCode changes', () => {
  const store = records();
  store.geoidReady = true;
  store.receive(obs({ category: 1 }), view({ sourceId: 'opensky', receivedAtMs: 1000 }));
  const meta = store.data.get('abc123');
  let provObj = store.provenance.get('abc123');
  const initialKlass = meta.klass;

  const result = applyTypeEnrichment({
    meta,
    provObj,
    data: { typeCode: 'B738', found: true },
    receivedAtMs: 2000,
  });

  // klass should have changed if typeCode gives different classification than category alone
  // At minimum, klass provenance must be DERIVED via classification, sourceId null
  assert.ok(provObj.klass);
  assert.equal(provObj.klass.epistemic, 'derived');
  assert.equal(provObj.klass.via, 'classification');
  assert.equal(provObj.klass.sourceId, null);
  assert.equal(result.klassChanged || provObj.klass.via, 'classification');
  // No external adsbdb source attached directly to klass
  assert.notEqual(provObj.klass.sourceId, 'adsbdb');
});

test('enrichmentCore: ensureProvObj creates and reuses', () => {
  const map = new Map();
  const o1 = ensureProvObj(map, 'abc');
  o1.typeCode = { sourceId: 'adsbdb' };
  const o2 = ensureProvObj(map, 'abc');
  assert.equal(o1, o2);
  assert.equal(o2.typeCode.sourceId, 'adsbdb');
});

test('enrichmentCore: receipt time injection deterministic', () => {
  const store = records();
  store.geoidReady = true;
  store.receive(obs(), view({ sourceId: 'opensky', receivedAtMs: 1000 }));
  const meta = store.data.get('abc123');
  let provObj = store.provenance.get('abc123');

  const exact = 1234567890000;
  applyTypeEnrichment({
    meta,
    provObj,
    data: { typeCode: 'B738', found: true },
    receivedAtMs: exact,
  });
  assert.equal(provObj.typeCode.receivedAtMs, exact);
});
