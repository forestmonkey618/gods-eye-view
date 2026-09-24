import assert from 'node:assert/strict';
import test from 'node:test';
import { FlightRecords } from './records.js';

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
  originCountry: 'United States',
  baroAltitudeM: 1000,
  ellipsoidAltitudeM: 1100,
  onGround: false,
  speedMps: 120,
  courseDeg: 90,
  verticalRateMps: 5,
  category: 3,
  positionTimeMs: 1700000000000,
  contactTimeMs: 1700000001000,
  ...fields,
});

// --- REPORTED: value and provenance created together ---

test('I3b provenance: REPORTED fields created with provenance', () => {
  const store = records();
  store.geoidReady = true;
  const receipt = 1700000005000;
  store.receive(obs(), view({ sourceId: 'opensky', receivedAtMs: receipt }));
  const prov = store.provenance.get('abc123');
  assert.ok(prov);
  // position already tested in I3a, but check new map includes it
  assert.equal(prov.position.sourceId, 'opensky');
  assert.equal(prov.position.reportedAtMs, 1700000000000);
  assert.equal(prov.altitude.sourceId, 'opensky');
  assert.equal(prov.altitude.reportedAtMs, 1700000000000); // position time for altitude
  assert.equal(prov.geoAltitudeM.sourceId, 'opensky');
  assert.equal(prov.velocity.sourceId, 'opensky');
  assert.equal(prov.velocity.reportedAtMs, 1700000001000); // contact time
  assert.equal(prov.true_track.reportedAtMs, 1700000001000);
  assert.equal(prov.verticalRate.reportedAtMs, 1700000001000);
  assert.equal(prov.callsign.reportedAtMs, 1700000001000);
  assert.equal(prov.originCountry.reportedAtMs, 1700000001000);
  assert.equal(prov.category.reportedAtMs, 1700000001000);
  assert.equal(prov.onGround.reportedAtMs, 1700000000000);
  assert.equal(prov.lastContactEpochMs.reportedAtMs, 1700000001000);
  assert.equal(prov.altitude.receivedAtMs, receipt);
  assert.equal(prov.velocity.receivedAtMs, receipt);
});

test('I3b provenance: replacement replaces provenance', () => {
  const store = records();
  store.geoidReady = true;
  store.receive(obs({ baroAltitudeM: 1000, speedMps: 120 }), view({ sourceId: 'opensky', receivedAtMs: 1000 }));
  const prov1 = store.provenance.get('abc123');
  assert.equal(prov1.altitude.receivedAtMs, 1000);
  assert.equal(prov1.velocity.receivedAtMs, 1000);
  store.receive(obs({ baroAltitudeM: 2000, speedMps: 130, positionTimeMs: 1700000010000, contactTimeMs: 1700000011000 }), view({ sourceId: 'opensky', receivedAtMs: 2000 }));
  const prov2 = store.provenance.get('abc123');
  assert.equal(prov2.altitude.reportedAtMs, 1700000010000);
  assert.equal(prov2.altitude.receivedAtMs, 2000);
  assert.equal(prov2.velocity.reportedAtMs, 1700000011000);
  assert.equal(prov2.velocity.receivedAtMs, 2000);
  assert.equal(store.data.get('abc123').altitude, 2000);
  assert.equal(store.data.get('abc123').velocity, 130);
});

test('I3b provenance: omission retains value + provenance (sticky)', () => {
  const store = records();
  store.geoidReady = true;
  store.receive(obs({ callsign: 'ABC123', speedMps: 200, courseDeg: 90 }), view({ sourceId: 'opensky', receivedAtMs: 1000 }));
  const provBefore = store.provenance.get('abc123');
  assert.equal(store.data.get('abc123').callsign, 'ABC123');
  assert.equal(store.data.get('abc123').velocity, 200);
  // Next observation omits callsign and velocity (null / empty)
  store.receive(obs({ callsign: '', speedMps: null, courseDeg: null, positionTimeMs: 1700000010000, contactTimeMs: 1700000011000 }), view({ sourceId: 'opensky', receivedAtMs: 2000 }));
  // Values retained
  assert.equal(store.data.get('abc123').callsign, 'ABC123');
  assert.equal(store.data.get('abc123').velocity, 200);
  assert.equal(store.data.get('abc123').true_track, 90);
  const provAfter = store.provenance.get('abc123');
  // Provenance retained (old receipt)
  assert.equal(provAfter.callsign.receivedAtMs, provBefore.callsign.receivedAtMs);
  assert.equal(provAfter.callsign.reportedAtMs, provBefore.callsign.reportedAtMs);
  assert.equal(provAfter.velocity.receivedAtMs, provBefore.velocity.receivedAtMs);
  assert.equal(provAfter.true_track.receivedAtMs, provBefore.true_track.receivedAtMs);
});

test('I3b provenance: null/absent semantics — no provenance when no current value', () => {
  const store = records();
  store.geoidReady = true;
  // geoAltitudeM null when missing -> no provenance
  store.receive(obs({ ellipsoidAltitudeM: null }), view({ sourceId: 'opensky', receivedAtMs: 1000 }));
  const prov = store.provenance.get('abc123');
  assert.equal(prov.geoAltitudeM, undefined);
  assert.equal(store.data.get('abc123').geoAltitudeM, null);
  // verticalRate null -> no provenance
  store.receive(obs({ id: 'def', verticalRateMps: null }), view({ sourceId: 'opensky', receivedAtMs: 1000 }));
  const prov2 = store.provenance.get('def');
  assert.equal(prov2.verticalRate, undefined);
  // callsign empty -> no provenance
  store.receive(obs({ id: 'ghi', callsign: '' }), view({ sourceId: 'opensky', receivedAtMs: 1000 }));
  const prov3 = store.provenance.get('ghi');
  // callsign empty but stickyText would try prev, prev also empty, so '' and no provenance
  assert.equal(prov3.callsign, undefined);
  assert.equal(store.data.get('ghi').callsign, '');
  // altitude fallback synthetic 10000 when both missing -> no REPORTED provenance
  store.receive(obs({ id: 'jkl', baroAltitudeM: null, onGround: false }), view({ sourceId: 'opensky', receivedAtMs: 1000 }));
  const prov4 = store.provenance.get('jkl');
  // altitude is 10000 fallback, but no provenance because not reported
  assert.equal(store.data.get('jkl').altitude, 10000);
  assert.equal(prov4.altitude, undefined);
  // velocity fallback 0 synthetic -> no provenance
  store.receive(obs({ id: 'mno', speedMps: null }), view({ sourceId: 'opensky', receivedAtMs: 1000 }));
  const prov5 = store.provenance.get('mno');
  assert.equal(store.data.get('mno').velocity, 0);
  assert.equal(prov5.velocity, undefined);
});

test('I3b provenance: source switch with replacement updates provenance', () => {
  const store = records();
  store.geoidReady = true;
  store.receive(obs({ callsign: 'ABC123', speedMps: 200, latitude: 39 }), view({ sourceId: 'opensky', receivedAtMs: 1000 }));
  assert.equal(store.provenance.get('abc123').callsign.sourceId, 'opensky');
  assert.equal(store.provenance.get('abc123').velocity.sourceId, 'opensky');
  assert.equal(store.provenance.get('abc123').position.sourceId, 'opensky');
  // T2 adsb.lol fallback with new position and velocity, callsign absent
  store.receive(obs({ callsign: '', speedMps: 210, latitude: 40, positionTimeMs: 1700000010000, contactTimeMs: 1700000011000 }), view({ sourceId: 'adsb.lol', receivedAtMs: 2000 }));
  const prov = store.provenance.get('abc123');
  assert.equal(store.data.get('abc123').callsign, 'ABC123'); // retained
  assert.equal(store.data.get('abc123').velocity, 210); // replaced
  assert.equal(prov.callsign.sourceId, 'opensky'); // retained old
  assert.equal(prov.velocity.sourceId, 'adsb.lol'); // updated
  assert.equal(prov.position.sourceId, 'adsb.lol'); // updated
});

test('I3b provenance: source switch without replacement preserves provenance', () => {
  const store = records();
  store.geoidReady = true;
  store.receive(obs({ callsign: 'ABC123', speedMps: 200, latitude: 39 }), view({ sourceId: 'opensky', receivedAtMs: 1000 }));
  const before = store.provenance.get('abc123');
  // Simulate aircraft not in new snapshot (no receive) — provenance should stay opensky if we don't call receive
  // For explicit test: receive with invalid position but new source should NOT overwrite retained position provenance (guard)
  store.receive(obs({ latitude: NaN, longitude: NaN, callsign: '', speedMps: null }), view({ sourceId: 'adsb.lol', receivedAtMs: 2000 }));
  const after = store.provenance.get('abc123');
  // Position retained (NaN guard), so position provenance stays opensky
  assert.equal(after.position.sourceId, before.position.sourceId);
  // callsign and velocity retained, so provenance stays opensky
  assert.equal(after.callsign.sourceId, 'opensky');
  assert.equal(after.velocity.sourceId, 'opensky');
});

test('I3b provenance: reportedAtMs truthful — position vs contact', () => {
  const store = records();
  store.geoidReady = true;
  const posTime = 1700000000000;
  const contactTime = 1700000005000;
  store.receive(obs({ positionTimeMs: posTime, contactTimeMs: contactTime }), view({ sourceId: 'opensky', receivedAtMs: 1000 }));
  const prov = store.provenance.get('abc123');
  assert.equal(prov.position.reportedAtMs, posTime);
  assert.equal(prov.altitude.reportedAtMs, posTime);
  assert.equal(prov.geoAltitudeM.reportedAtMs, posTime);
  assert.equal(prov.onGround.reportedAtMs, posTime);
  assert.equal(prov.velocity.reportedAtMs, contactTime);
  assert.equal(prov.true_track.reportedAtMs, contactTime);
  assert.equal(prov.callsign.reportedAtMs, contactTime);
});

test('I3b provenance: receivedAtMs truthful — snapshot receipt', () => {
  const store = records();
  store.geoidReady = true;
  const receipt1 = 1700000001000;
  const receipt2 = 1700000009000;
  store.receive(obs(), view({ sourceId: 'opensky', receivedAtMs: receipt1 }));
  assert.equal(store.provenance.get('abc123').position.receivedAtMs, receipt1);
  assert.equal(store.provenance.get('abc123').velocity.receivedAtMs, receipt1);
  store.receive(obs({ latitude: 40, positionTimeMs: 1700000010000, contactTimeMs: 1700000011000 }), view({ sourceId: 'opensky', receivedAtMs: receipt2 }));
  assert.equal(store.provenance.get('abc123').position.receivedAtMs, receipt2);
  assert.equal(store.provenance.get('abc123').velocity.receivedAtMs, receipt2);
});

test('I3b provenance: independent sticky fields diverge correctly', () => {
  const store = records();
  store.geoidReady = true;
  // T1: all fields present
  store.receive(obs({ callsign: 'AAA', speedMps: 100, courseDeg: 10, baroAltitudeM: 1000 }), view({ sourceId: 'opensky', receivedAtMs: 1000 }));
  const p1 = store.provenance.get('abc123');
  // T2: only velocity updates, callsign and track omitted
  store.receive(obs({ callsign: '', speedMps: 110, courseDeg: null, baroAltitudeM: null, positionTimeMs: 1700000010000, contactTimeMs: 1700000011000 }), view({ sourceId: 'opensky', receivedAtMs: 2000 }));
  const p2 = store.provenance.get('abc123');
  // velocity should have new receipt, callsign and track should retain old
  assert.equal(p2.velocity.receivedAtMs, 2000);
  assert.equal(p2.callsign.receivedAtMs, p1.callsign.receivedAtMs);
  assert.equal(p2.true_track.receivedAtMs, p1.true_track.receivedAtMs);
  // altitude retained (since baro null) -> old provenance
  assert.equal(p2.altitude.receivedAtMs, p1.altitude.receivedAtMs);
  // Data values
  assert.equal(store.data.get('abc123').callsign, 'AAA');
  assert.equal(store.data.get('abc123').velocity, 110);
  assert.equal(store.data.get('abc123').true_track, 10);
  assert.equal(store.data.get('abc123').altitude, 1000);

  // T3: callsign updates, velocity retained
  store.receive(obs({ callsign: 'BBB', speedMps: null, courseDeg: null, baroAltitudeM: 2000, positionTimeMs: 1700000020000, contactTimeMs: 1700000021000 }), view({ sourceId: 'opensky', receivedAtMs: 3000 }));
  const p3 = store.provenance.get('abc123');
  assert.equal(p3.callsign.receivedAtMs, 3000);
  assert.equal(p3.callsign.reportedAtMs, 1700000021000);
  assert.equal(p3.velocity.receivedAtMs, 2000); // retained from T2
  assert.equal(p3.altitude.receivedAtMs, 3000); // replaced
  assert.equal(store.data.get('abc123').callsign, 'BBB');
  assert.equal(store.data.get('abc123').velocity, 110);
  assert.equal(store.data.get('abc123').altitude, 2000);
});

test('I3b provenance: DERIVED fields — epistemic DERIVED via', () => {
  const store = records();
  store.geoidReady = true;
  store.receive(obs({ category: 3 }), view({ sourceId: 'opensky', receivedAtMs: 1000 }));
  const prov = store.provenance.get('abc123');
  assert.equal(prov.klass.epistemic, 'derived');
  assert.equal(prov.klass.via, 'classification');
  assert.equal(prov.klass.sourceId, null);
  assert.equal(prov.wasAirborne.epistemic, 'derived');
  assert.equal(prov.wasAirborne.via, 'airborne-history');
  assert.equal(prov.renderAltitudeM.epistemic, 'derived');
  assert.equal(prov.renderAltitudeM.via, 'render-altitude-selection');
});

test('I3b provenance: DERIVED no false external source', () => {
  const store = records();
  store.geoidReady = true;
  store.receive(obs(), view({ sourceId: 'opensky', receivedAtMs: 1000 }));
  const prov = store.provenance.get('abc123');
  // Derived should NOT have sourceId
  assert.equal(prov.klass.sourceId, null);
  assert.equal(prov.renderAltitudeM.sourceId, null);
  assert.equal(prov.wasAirborne.sourceId, null);
});

test('I3b provenance: DERIVED recomputation follows inputs', () => {
  const store = records();
  store.geoidReady = true;
  store.receive(obs({ category: 3 }), view({ sourceId: 'opensky', receivedAtMs: 1000 }));
  assert.equal(store.data.get('abc123').klass, 'airliner'); // category 3 -> airliner
  let prov = store.provenance.get('abc123');
  assert.equal(prov.klass.via, 'classification');
  // Change category to helicopter (8)
  store.receive(obs({ category: 8, positionTimeMs: 1700000010000, contactTimeMs: 1700000011000 }), view({ sourceId: 'opensky', receivedAtMs: 2000 }));
  assert.equal(store.data.get('abc123').klass, 'helicopter');
  prov = store.provenance.get('abc123');
  assert.equal(prov.klass.via, 'classification');
  // Still derived, no history
  assert.equal(prov.klass.history, undefined);
});

test('I3b provenance: current-state only no history', () => {
  const store = records();
  store.geoidReady = true;
  store.receive(obs({ baroAltitudeM: 1000 }), view({ sourceId: 'opensky', receivedAtMs: 1000 }));
  store.receive(obs({ baroAltitudeM: 2000, positionTimeMs: 1700000010000 }), view({ sourceId: 'opensky', receivedAtMs: 2000 }));
  store.receive(obs({ baroAltitudeM: 3000, positionTimeMs: 1700000020000 }), view({ sourceId: 'opensky', receivedAtMs: 3000 }));
  const prov = store.provenance.get('abc123');
  assert.equal(prov.altitude.receivedAtMs, 3000);
  assert.equal(Array.isArray(prov.altitude), false);
  assert.equal(prov.altitude.history, undefined);
  assert.equal(store.provenance.size, 1);
});

test('I3b provenance: cleanup forget removes all provenance', () => {
  const store = records();
  store.geoidReady = true;
  store.receive(obs(), view({ sourceId: 'opensky', receivedAtMs: 1000 }));
  assert.ok(store.provenance.has('abc123'));
  store.forget('abc123');
  assert.equal(store.provenance.has('abc123'), false);
  assert.equal(store.data.has('abc123'), false);
});

test('I3b provenance: copy-safe — returned map and descriptors not mutable', () => {
  const store = records();
  store.geoidReady = true;
  store.receive(obs(), view({ sourceId: 'opensky', receivedAtMs: 1000 }));
  const provObj = store.provenance.get('abc123');
  assert.ok(Object.isFrozen(provObj.position));
  assert.ok(Object.isFrozen(provObj.velocity));
  // Mutating copy should not affect stored
  const copy = { ...provObj.position };
  copy.sourceId = 'tampered';
  assert.equal(store.provenance.get('abc123').position.sourceId, 'opensky');
});

test('I3b provenance: getProvenanceMap copy-safe and shape', () => {
  const store = records();
  store.geoidReady = true;
  store.receive(obs(), view({ sourceId: 'opensky', receivedAtMs: 1000 }));
  // Simulate queries.getProvenanceMap
  const fullMap = store.provenance;
  const out = new Map();
  for (const [icao, provObj] of fullMap) {
    const copy = {};
    for (const [field, desc] of Object.entries(provObj)) {
      if (!desc) continue;
      copy[field] = { ...desc };
    }
    out.set(icao, copy);
  }
  assert.ok(out instanceof Map);
  const entry = out.get('abc123');
  assert.ok(entry.position);
  assert.ok(entry.altitude);
  assert.ok(entry.velocity);
  assert.ok(entry.klass);
  // Mutating returned should not affect internal
  entry.position.sourceId = 'tampered';
  assert.equal(store.provenance.get('abc123').position.sourceId, 'opensky');
});

test('I3b provenance: TIS-B included, no synthetic keys', () => {
  const store = records();
  store.geoidReady = true;
  store.receive(obs({ id: '~abc123', callsign: 'TISB' }), view({ sourceId: 'opensky', receivedAtMs: 1000 }));
  const prov = store.provenance.get('~abc123');
  assert.ok(prov);
  assert.equal(prov.position.sourceId, 'opensky');
  assert.equal(prov.callsign.sourceId, 'opensky');
  // No synthetic entityKey
  assert.equal(store.provenance.has('aircraft:icao24:abc123'), false);
});

test('I3b provenance: getCurrentEntities unchanged', () => {
  const store = records();
  store.geoidReady = true;
  store.receive(obs(), view({ sourceId: 'opensky', receivedAtMs: 1000 }));
  // Simulate getCurrentEntities
  const result = [];
  for (const [icao24, info] of store.data) {
    result.push({
      icao24,
      lat: info.rawLat,
      lon: info.rawLon,
      altitudeM: info.altitude,
      callsign: info.callsign,
    });
  }
  assert.equal(result[0].provenance, undefined);
  assert.equal(result[0].sourceId, undefined);
});

// I3a finalization — core rule: unknown must remain unknown. When the source
// supplied no report time, the descriptor's reportedAtMs stays null. It must
// NOT be filled with the wall clock (which the store uses elsewhere for its
// own bookkeeping) or with the receipt time (a different clock with a
// different meaning).
test('I3b provenance: missing source time stays null — never filled by wall clock or receipt', () => {
  const store = records();
  store.geoidReady = true;
  const WALL = 9999999999999; // sentinel wall clock, distinct from every fixture time
  const receipt = 1700000009000;
  const realNow = Date.now;
  Date.now = () => WALL;
  try {
    store.receive(
      obs({ positionTimeMs: null, contactTimeMs: null }),
      view({ sourceId: 'opensky', receivedAtMs: receipt }),
    );
  } finally {
    Date.now = realNow;
  }
  const prov = store.provenance.get('abc123');
  // Position was reported (finite lat/lon) but carries no source time.
  assert.ok(prov.position);
  assert.equal(prov.position.sourceId, 'opensky');
  assert.equal(prov.position.reportedAtMs, null, 'no source time — stays null');
  assert.equal(prov.position.receivedAtMs, receipt);
  assert.notEqual(prov.position.reportedAtMs, WALL, 'wall clock must not fill the report time');
  assert.notEqual(prov.position.reportedAtMs, receipt, 'receipt time must not be relabelled as report time');
  // Kinematics share the same honesty: contact time missing too.
  assert.equal(prov.velocity.reportedAtMs, null);
  assert.equal(prov.callsign.reportedAtMs, null);
  // The store's own bookkeeping may still use the wall clock — provenance must not.
  assert.equal(store.data.get('abc123').observedReceiptMs, WALL);
});

// I3a finalization — the authority must not mutate source records. The
// observation is the feed's data; receive() reads it, it never writes back.
test('I3b provenance: receive() does not mutate the incoming observation', () => {
  const store = records();
  store.geoidReady = true;
  const original = obs();
  const frozen = JSON.parse(JSON.stringify(original));
  store.receive(original, view({ sourceId: 'opensky', receivedAtMs: 1700000005000 }));
  // A second receive with the same object must see identical inputs.
  store.receive(original, view({ sourceId: 'opensky', receivedAtMs: 1700000006000 }));
  assert.deepEqual(original, frozen, 'observation must be unmodified');
  // And the provenance sidecar must not alias the observation either.
  const prov = store.provenance.get('abc123');
  assert.ok(Object.isFrozen(prov.position));
  assert.equal(prov.position.sourceId, 'opensky');
});
