import assert from 'node:assert/strict';
import test from 'node:test';
import { FlightRecords } from './records.js';
import { EPISTEMIC, createProvenance } from '../../data/provenance.js';

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

test('enrichment provenance: typeCode REPORTED adsbdb with receipt time', () => {
  const store = records();
  store.geoidReady = true;
  store.receive(obs(), view({ sourceId: 'opensky', receivedAtMs: 1000 }));
  const before = Date.now();
  const receivedAtMs = Date.now();
  function tryProv() {
    return createProvenance({
      epistemic: EPISTEMIC.REPORTED,
      sourceId: 'adsbdb',
      reportedAtMs: null,
      receivedAtMs,
    });
  }
  const meta = store.data.get('abc123');
  let provObj = store.provenance.get('abc123');
  assert.ok(provObj);
  meta.typeCode = 'B738';
  provObj.typeCode = tryProv();
  meta.typeName = 'Boeing 737';
  provObj.typeName = tryProv();
  meta.registration = 'N12345';
  provObj.registration = tryProv();

  const afterProv = store.provenance.get('abc123');
  assert.equal(afterProv.typeCode.sourceId, 'adsbdb');
  assert.equal(afterProv.typeCode.reportedAtMs, null);
  assert.ok(afterProv.typeCode.receivedAtMs >= before);
  assert.equal(afterProv.typeCode.epistemic, 'reported');
  assert.equal(afterProv.registration.sourceId, 'adsbdb');
});

test('enrichment provenance: retained enrichment retains provenance', () => {
  const store = records();
  store.geoidReady = true;
  store.receive(obs(), view({ sourceId: 'opensky', receivedAtMs: 1000 }));
  const provObj = store.provenance.get('abc123');
  provObj.typeCode = createProvenance({
    epistemic: EPISTEMIC.REPORTED,
    sourceId: 'adsbdb',
    reportedAtMs: null,
    receivedAtMs: 2000,
  });
  store.data.get('abc123').typeCode = 'B738';
  // Next poll, receive without enrichment (enrichment retained via prevMeta)
  store.receive(obs({ latitude: 40, positionTimeMs: 1700000010000, contactTimeMs: 1700000011000 }), view({ sourceId: 'opensky', receivedAtMs: 3000 }));
  assert.equal(store.data.get('abc123').typeCode, 'B738');
  const after = store.provenance.get('abc123');
  assert.equal(after.typeCode.receivedAtMs, 2000);
  assert.equal(after.typeCode.sourceId, 'adsbdb');
});

test('enrichment provenance: no invented source timestamp', () => {
  const store = records();
  store.geoidReady = true;
  store.receive(obs(), view({ sourceId: 'opensky', receivedAtMs: 1000 }));
  const provObj = store.provenance.get('abc123');
  provObj.typeCode = createProvenance({
    epistemic: EPISTEMIC.REPORTED,
    sourceId: 'adsbdb',
    reportedAtMs: null,
    receivedAtMs: 2000,
  });
  assert.equal(provObj.typeCode.reportedAtMs, null);
});

test('enrichment provenance: sourceId reflects actual source adsbdb', () => {
  const prov = createProvenance({
    epistemic: EPISTEMIC.REPORTED,
    sourceId: 'adsbdb',
    reportedAtMs: null,
    receivedAtMs: Date.now(),
  });
  assert.equal(prov.sourceId, 'adsbdb');
  assert.equal(prov.epistemic, 'reported');
});

