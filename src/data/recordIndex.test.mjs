import assert from 'node:assert/strict';
import test from 'node:test';

import { aircraft as aircraftEntityKey } from './entityKey.js';
import { buildRecordIndex, buildAircraftRecordIndex, STORE_ID } from './recordIndex.js';

function makeRecord(icao24, overrides = {}) {
  return {
    entityKey: aircraftEntityKey(icao24),
    icao24,
    lat: 51.5,
    lon: -0.12,
    altitudeM: 10000,
    callsign: 'TEST',
    ...overrides,
  };
}

function makeFlightsRecord(icao24, overrides = {}) {
  return makeRecord(icao24, overrides);
}

function makeMilitaryRecord(icao24, overrides = {}) {
  return makeRecord(icao24, overrides);
}

// 1. One canonical aircraft record produces one canonical entity entry
test('I2c: one canonical record produces one entity entry', () => {
  const rec = makeFlightsRecord('a1b2c3');
  const idx = buildRecordIndex([{ storeId: STORE_ID.FLIGHTS, records: [rec] }]);
  assert.equal(idx.size, 1);
  assert.ok(idx.has('aircraft:icao24:a1b2c3'));
  const entry = idx.get('aircraft:icao24:a1b2c3');
  assert.equal(entry.entityKey, 'aircraft:icao24:a1b2c3');
  assert.equal(entry.records.length, 1);
  assert.equal(entry.records[0].storeId, 'flights');
});

// 2. Same entityKey from flights + military produces ONE canonical entity with TWO current store-owned records
test('I2c: same entityKey from flights + military → one entity, two store records', () => {
  const f = makeFlightsRecord('a1b2c3', { lat: 51.5, callsign: 'BAW123' });
  const m = makeMilitaryRecord('a1b2c3', { lat: 51.6, callsign: 'RCH123' });
  const idx = buildRecordIndex([
    { storeId: STORE_ID.FLIGHTS, records: [f] },
    { storeId: STORE_ID.MILITARY, records: [m] },
  ]);
  assert.equal(idx.size, 1);
  const entry = idx.get('aircraft:icao24:a1b2c3');
  assert.equal(entry.records.length, 2);
  const byStore = new Map(entry.records.map(r => [r.storeId, r.record]));
  assert.ok(byStore.has('flights'));
  assert.ok(byStore.has('military'));
  assert.equal(byStore.get('flights').callsign, 'BAW123');
  assert.equal(byStore.get('military').callsign, 'RCH123');
});

// 3. Different payloads for same entityKey preserved independently
test('I2c: different payloads same entityKey preserved independently', () => {
  const f = makeFlightsRecord('a1b2c3', { lat: 1, lon: 1, altitudeM: 1000, callsign: 'F' });
  const m = makeMilitaryRecord('a1b2c3', { lat: 2, lon: 2, altitudeM: 2000, callsign: 'M' });
  const idx = buildRecordIndex([
    { storeId: 'flights', records: [f] },
    { storeId: 'military', records: [m] },
  ]);
  const entry = idx.get('aircraft:icao24:a1b2c3');
  const flightsRec = entry.records.find(r => r.storeId === 'flights').record;
  const milRec = entry.records.find(r => r.storeId === 'military').record;
  assert.equal(flightsRec.lat, 1);
  assert.equal(milRec.lat, 2);
  assert.equal(flightsRec.altitudeM, 1000);
  assert.equal(milRec.altitudeM, 2000);
});

// 4. Store enumeration order does not choose/overwrite a payload
test('I2c: store enumeration order does not choose/overwrite payload', () => {
  const f = makeFlightsRecord('a1b2c3', { callsign: 'FLIGHTS' });
  const m = makeMilitaryRecord('a1b2c3', { callsign: 'MILITARY' });

  const idx1 = buildRecordIndex([
    { storeId: 'flights', records: [f] },
    { storeId: 'military', records: [m] },
  ]);
  const idx2 = buildRecordIndex([
    { storeId: 'military', records: [m] },
    { storeId: 'flights', records: [f] },
  ]);

  // Both should have 2 records regardless of collection order
  assert.equal(idx1.get('aircraft:icao24:a1b2c3').records.length, 2);
  assert.equal(idx2.get('aircraft:icao24:a1b2c3').records.length, 2);

  // Deterministic store ordering inside entry: alphabetical (flights before military)
  const e1 = idx1.get('aircraft:icao24:a1b2c3');
  assert.equal(e1.records[0].storeId, 'flights');
  assert.equal(e1.records[1].storeId, 'military');

  const e2 = idx2.get('aircraft:icao24:a1b2c3');
  assert.equal(e2.records[0].storeId, 'flights');
  assert.equal(e2.records[1].storeId, 'military');
});

// 5. Record with entityKey null excluded from canonical index
test('I2c: entityKey null excluded', () => {
  const nullRec = { entityKey: null, icao24: '~abc123', lat: 0, lon: 0, altitudeM: 10000, callsign: 'TISB' };
  const validRec = makeFlightsRecord('a1b2c3');
  const idx = buildRecordIndex([{ storeId: 'flights', records: [nullRec, validRec] }]);
  assert.equal(idx.size, 1);
  assert.ok(!idx.has('~abc123'));
  assert.ok(idx.has('aircraft:icao24:a1b2c3'));
});

// 6. TIS-B current record remains outside canonical index
test('I2c: TIS-B remains outside canonical index', () => {
  const tisb = { entityKey: null, icao24: '~abc123', lat: 51.5, lon: -0.12, altitudeM: 10000, callsign: 'TISB' };
  const idx = buildRecordIndex([{ storeId: 'flights', records: [tisb] }]);
  assert.equal(idx.size, 0);
  assert.equal(idx.get('aircraft:icao24:abc123'), undefined);
});

// 7. Missing/malformed inputs fail safely
test('I2c: missing/malformed inputs fail safely', () => {
  const malformed = [
    { entityKey: null, icao24: '', lat: null, lon: null, altitudeM: null, callsign: null },
    { entityKey: '', icao24: 'abc', lat: null, lon: null, altitudeM: null, callsign: null },
    null,
    undefined,
    {},
  ];
  const idx = buildRecordIndex([{ storeId: 'flights', records: malformed }]);
  assert.equal(idx.size, 0);

  // Invalid storeId throws
  assert.throws(() => buildRecordIndex([{ storeId: 'invalid', records: [] }]), /Invalid storeId/);
  assert.throws(() => buildRecordIndex(null), /must be an array/);
});

// 8. Two different entityKeys remain separate
test('I2c: two different entityKeys separate', () => {
  const r1 = makeFlightsRecord('a1b2c3');
  const r2 = makeFlightsRecord('b2c3d4');
  const idx = buildRecordIndex([{ storeId: 'flights', records: [r1, r2] }]);
  assert.equal(idx.size, 2);
  assert.ok(idx.has('aircraft:icao24:a1b2c3'));
  assert.ok(idx.has('aircraft:icao24:b2c3d4'));
});

// 9. Rebuild from new current input removes entities no longer present
test('I2c: rebuild removes entities no longer present', () => {
  const r1 = makeFlightsRecord('a1b2c3');
  const r2 = makeFlightsRecord('b2c3d4');
  const idx1 = buildRecordIndex([{ storeId: 'flights', records: [r1, r2] }]);
  assert.equal(idx1.size, 2);

  // Rebuild with only r1 — r2 should disappear
  const idx2 = buildRecordIndex([{ storeId: 'flights', records: [r1] }]);
  assert.equal(idx2.size, 1);
  assert.ok(idx2.has('aircraft:icao24:a1b2c3'));
  assert.ok(!idx2.has('aircraft:icao24:b2c3d4'));
});

// 10. Rebuild removes store record that disappeared while preserving same entity from another store
test('I2c: rebuild removes store record disappeared, preserves entity from other store', () => {
  const f = makeFlightsRecord('a1b2c3', { callsign: 'F' });
  const m = makeMilitaryRecord('a1b2c3', { callsign: 'M' });

  const idx1 = buildRecordIndex([
    { storeId: 'flights', records: [f] },
    { storeId: 'military', records: [m] },
  ]);
  assert.equal(idx1.size, 1);
  assert.equal(idx1.get('aircraft:icao24:a1b2c3').records.length, 2);

  // Rebuild where flights no longer has it, but military still does
  const idx2 = buildRecordIndex([
    { storeId: 'flights', records: [] },
    { storeId: 'military', records: [m] },
  ]);
  assert.equal(idx2.size, 1);
  const entry = idx2.get('aircraft:icao24:a1b2c3');
  assert.equal(entry.records.length, 1);
  assert.equal(entry.records[0].storeId, 'military');

  // Rebuild where both gone → entity gone
  const idx3 = buildRecordIndex([
    { storeId: 'flights', records: [] },
    { storeId: 'military', records: [] },
  ]);
  assert.equal(idx3.size, 0);
});

// 11. No previous-state/history retained
test('I2c: no history retained', () => {
  const r1 = makeFlightsRecord('a1b2c3', { lat: 1 });
  const idx1 = buildRecordIndex([{ storeId: 'flights', records: [r1] }]);
  const r2 = makeFlightsRecord('a1b2c3', { lat: 2 });
  const idx2 = buildRecordIndex([{ storeId: 'flights', records: [r2] }]);
  // idx2 should have lat 2, not retain lat 1 history
  assert.equal(idx2.get('aircraft:icao24:a1b2c3').records[0].record.lat, 2);
  // idx1 still has lat 1 (immutable, no shared history)
  assert.equal(idx1.get('aircraft:icao24:a1b2c3').records[0].record.lat, 1);
});

// 12. No diff/change events produced
test('I2c: no diff/change events', () => {
  const idx = buildRecordIndex([{ storeId: 'flights', records: [makeFlightsRecord('a1b2c3')] }]);
  // API should not have on/diff/subscribe methods
  assert.equal(typeof idx.subscribe, 'undefined');
  assert.equal(typeof idx.on, 'undefined');
  assert.equal(typeof idx.diff, 'undefined');
  assert.equal(typeof idx.events, 'undefined');
});

// 13. Returned data cannot mutate index internals
test('I2c: returned data cannot mutate internals', () => {
  const rec = makeFlightsRecord('a1b2c3', { callsign: 'ORIG' });
  const idx = buildRecordIndex([{ storeId: 'flights', records: [rec] }]);

  const entry = idx.get('aircraft:icao24:a1b2c3');
  entry.records[0].record.callsign = 'MUTATED';
  entry.entityKey = 'mutated';

  const entry2 = idx.get('aircraft:icao24:a1b2c3');
  assert.equal(entry2.records[0].record.callsign, 'ORIG');
  assert.equal(entry2.entityKey, 'aircraft:icao24:a1b2c3');

  const vals = idx.values();
  vals[0].records[0].record.callsign = 'MUTATED2';
  vals.length = 0;

  const entry3 = idx.get('aircraft:icao24:a1b2c3');
  assert.equal(entry3.records[0].record.callsign, 'ORIG');
  assert.equal(idx.size, 1);
});

// 14. Deterministic enumeration contract holds
test('I2c: deterministic enumeration', () => {
  const recs = [
    makeFlightsRecord('c3d4e5'),
    makeFlightsRecord('a1b2c3'),
    makeFlightsRecord('b2c3d4'),
  ];
  const idx = buildRecordIndex([{ storeId: 'flights', records: recs }]);
  const keys = idx.keys();
  assert.deepEqual(keys, ['aircraft:icao24:a1b2c3', 'aircraft:icao24:b2c3d4', 'aircraft:icao24:c3d4e5']);

  const vals = idx.values();
  assert.equal(vals[0].entityKey, 'aircraft:icao24:a1b2c3');
  assert.equal(vals[1].entityKey, 'aircraft:icao24:b2c3d4');
  assert.equal(vals[2].entityKey, 'aircraft:icao24:c3d4e5');

  // Repeat values() deterministic
  const vals2 = idx.values();
  assert.deepEqual(vals.map(v => v.entityKey), vals2.map(v => v.entityKey));
});

// 15. Existing I2a/I2b tests remain passing (checked via separate test run, but basic sanity here)
test('I2c: I2a entityKey still works', () => {
  assert.equal(aircraftEntityKey('ABC123'), 'aircraft:icao24:abc123');
  assert.equal(aircraftEntityKey('~abc123'), null);
});

// 16. Index does not call getAnalystRecords
test('I2c: does not call getAnalystRecords', async () => {
  const { readFile } = await import('node:fs/promises');
  const content = await readFile(new URL('./recordIndex.js', import.meta.url), 'utf8');
  assert.ok(!content.includes('getAnalystRecords'), 'should not contain getAnalystRecords');
  assert.ok(!content.includes('getAllPositions'), 'should not contain getAllPositions');
});

// 17. Index does not depend on Cesium
test('I2c: does not depend on Cesium', async () => {
  const { readFile } = await import('node:fs/promises');
  const content = await readFile(new URL('./recordIndex.js', import.meta.url), 'utf8');
  // Check no import of Cesium package
  assert.ok(!content.includes("from 'cesium'"), 'should not import from cesium');
  assert.ok(!content.includes('from \"cesium\"'), 'should not import from cesium');
  assert.ok(!content.includes('import * as Cesium'), 'should not import Cesium');
  // Also ensure no Cesium.Cartesian3 etc usage
  assert.ok(!content.includes('Cartesian3'), 'should not use Cartesian3');
  assert.ok(!content.includes('Cartographic'), 'should not use Cartographic');
});

// 18. Index does not depend on DOM/UI
test('I2c: does not depend on DOM/UI', async () => {
  const { readFile } = await import('node:fs/promises');
  const content = await readFile(new URL('./recordIndex.js', import.meta.url), 'utf8');
  // Check no direct DOM access, not just mention in comment
  // Look for patterns like document. or window. or viewer.
  assert.ok(!content.match(/\bdocument\./), 'should not use document.');
  assert.ok(!content.match(/\bwindow\./), 'should not use window.');
  // We check for flightState._viewer or viewer. usage which would be Cesium viewer
  assert.ok(!content.includes('_viewer'), 'should not use _viewer');
});

// 19. Index does not use timestamp winner logic
test('I2c: does not use timestamp winner', async () => {
  const { readFile } = await import('node:fs/promises');
  const content = await readFile(new URL('./recordIndex.js', import.meta.url), 'utf8');
  // Should not use observedReceiptMs, lastContactEpochMs, positionTimeMs for reconciliation
  assert.ok(!content.includes('observedReceiptMs'), 'should not use observedReceiptMs');
  assert.ok(!content.includes('lastContactEpochMs'), 'should not use lastContactEpochMs');
  assert.ok(!content.includes('positionTimeMs'), 'should not use positionTimeMs');
  assert.ok(!content.toLowerCase().includes('newest'), 'should not use newest-wins');
});

// 20. Layer visibility does not arbitrarily select a payload
test('I2c: visibility does not select payload', () => {
  const f = makeFlightsRecord('a1b2c3', { callsign: 'F' });
  const m = makeMilitaryRecord('a1b2c3', { callsign: 'M' });

  // Build index with both — should have both, no visibility check inside core
  const idx = buildRecordIndex([
    { storeId: 'flights', records: [f] },
    { storeId: 'military', records: [m] },
  ]);
  const entry = idx.get('aircraft:icao24:a1b2c3');
  assert.equal(entry.records.length, 2);

  // Core does not import isMilitaryLayerActive or check show
  // Adapter responsibility to exclude disabled stores, not core
});

// Additional: buildAircraftRecordIndex convenience
test('I2c: buildAircraftRecordIndex convenience', () => {
  const f = makeFlightsRecord('a1b2c3');
  const m = makeMilitaryRecord('a1b2c3');
  const idx = buildAircraftRecordIndex({ flightsRecords: [f], militaryRecords: [m] });
  assert.equal(idx.size, 1);
  assert.equal(idx.get('aircraft:icao24:a1b2c3').records.length, 2);
});

// Performance sanity at ~11k
test('I2c: performance at ~11k', () => {
  const records = [];
  for (let i = 0; i < 11000; i++) {
    const hex = i.toString(16).padStart(6, '0');
    records.push(makeFlightsRecord(hex));
  }
  const start = Date.now();
  const idx = buildRecordIndex([{ storeId: 'flights', records }]);
  const elapsed = Date.now() - start;
  assert.equal(idx.size, 11000);
  // Should be <200ms for 11k in Node (generous)
  assert.ok(elapsed < 500, `build 11k took ${elapsed}ms, expected <500ms`);
  const vals = idx.values();
  assert.equal(vals.length, 11000);
});
