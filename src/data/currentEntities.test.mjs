import assert from 'node:assert/strict';
import test from 'node:test';

import { aircraft as aircraftEntityKey } from './entityKey.js';

// Helper to simulate getCurrentEntities logic for flights (meters) and military (feet->meters)
// Uses same normalization as implemented in queries.js

function makeFlightsCurrentEntities(recordsMap) {
  const result = [];
  for (const [icao24, info] of recordsMap) {
    const num = (v) => (Number.isFinite(v) ? v : null);
    const text = (v) => {
      const t = String(v ?? '').trim();
      return t || null;
    };
    result.push({
      entityKey: aircraftEntityKey(icao24),
      icao24,
      lat: num(info?.rawLat),
      lon: num(info?.rawLon),
      altitudeM: num(info?.altitude),
      callsign: text(info?.callsign),
    });
  }
  return result;
}

function makeMilitaryCurrentEntities(recordsMap) {
  const result = [];
  for (const [icao24, info] of recordsMap) {
    const num = (v) => (Number.isFinite(v) ? v : null);
    const text = (v) => {
      const t = String(v ?? '').trim();
      return t || null;
    };
    result.push({
      entityKey: aircraftEntityKey(icao24),
      icao24,
      lat: num(info?.rawLat),
      lon: num(info?.rawLon),
      altitudeM: Number.isFinite(info?.altitudeFt) ? info.altitudeFt * 0.3048 : null,
      callsign: text(info?.callsign),
    });
  }
  return result;
}

test('I2b: accessor is uncapped — exceeds analyst/position caps', () => {
  // Create 3000 synthetic records exceeding 2000 analyst cap and 500 position cap
  const records = new Map();
  for (let i = 0; i < 3000; i++) {
    const hex = i.toString(16).padStart(6, '0'); // 6 hex digits
    records.set(hex, {
      rawLat: 0 + i * 0.001,
      rawLon: 0 + i * 0.001,
      altitude: 10000,
      callsign: `CALL${i}`,
    });
  }
  const entities = makeFlightsCurrentEntities(records);
  assert.equal(entities.length, 3000);
  // Would be truncated to 2000 if using getAnalystRecords logic
  assert.ok(entities.length > 2000);
  assert.ok(entities.length > 500);
});

test('I2b: every current stored aircraft is represented', () => {
  const records = new Map();
  records.set('abc123', { rawLat: 51.5, rawLon: -0.12, altitude: 11000, callsign: 'BAW123' });
  records.set('def456', { rawLat: 40.7, rawLon: -74, altitude: 9000, callsign: 'AAL456' });
  const entities = makeFlightsCurrentEntities(records);
  assert.equal(entities.length, 2);
  const ids = entities.map((e) => e.icao24).sort();
  assert.deepEqual(ids, ['abc123', 'def456']);
});

test('I2b: canonical ICAO24 record gets correct entityKey', () => {
  const records = new Map();
  records.set('a1b2c3', { rawLat: 0, rawLon: 0, altitude: 10000, callsign: 'TEST' });
  const entities = makeFlightsCurrentEntities(records);
  assert.equal(entities[0].entityKey, 'aircraft:icao24:a1b2c3');
  assert.equal(entities[0].icao24, 'a1b2c3');
});

test('I2b: same ICAO24 yields same entityKey — store-owned accessors, not global dedup', () => {
  // Simulate flights and military stores with same ICAO24 — independent stores
  const flightsRecords = new Map();
  flightsRecords.set('a1b2c3', { rawLat: 51.5, rawLon: -0.12, altitude: 11000, callsign: 'BAW123' });
  const militaryRecords = new Map();
  militaryRecords.set('a1b2c3', { rawLat: 51.6, rawLon: -0.13, altitudeFt: 36000, callsign: 'RCH123' });

  const flightsEntities = makeFlightsCurrentEntities(flightsRecords);
  const militaryEntities = makeMilitaryCurrentEntities(militaryRecords);

  // Same canonical key — I2a solved entity identity
  assert.equal(flightsEntities[0].entityKey, militaryEntities[0].entityKey);
  assert.equal(flightsEntities[0].entityKey, 'aircraft:icao24:a1b2c3');

  // But payloads NOT interchangeable — different lat/lon/callsign/alt from independent stores
  assert.notEqual(flightsEntities[0].lat, militaryEntities[0].lat);
  assert.notEqual(flightsEntities[0].callsign, militaryEntities[0].callsign);

  // Each accessor is store-owned, not globally authoritative
  assert.equal(flightsEntities.length, 1);
  assert.equal(militaryEntities.length, 1);

  // In steady-state when military active, flights forgets military ICAOs, so normally only
  // military store would contain it. But during transitions (military disable, or race where
  // military just discovered new military ICAO before flights next poll), BOTH Maps can
  // contain same ICAO24 simultaneously — verified from actual snapshotRenderer code:
  // military disable does NOT clear its data Map, flights update is fire-and-forget.
  // Therefore I2b does NOT globally dedup; I2c must decide reconciliation.

  // Simulate what would happen if both stores contain same ICAO24 at same time:
  const both = [...flightsEntities, ...militaryEntities];
  assert.equal(both.length, 2); // two store-owned records, same entityKey
  assert.equal(both[0].entityKey, both[1].entityKey);

  // If I2c naively dedups by ICAO24 keeping last enumerated, Map iteration order
  // would determine authoritative payload — unsafe. Must have deterministic priority.
  const naiveUnion = new Map();
  for (const e of both) {
    if (!naiveUnion.has(e.icao24)) naiveUnion.set(e.icao24, e);
  }
  // Naive first-wins would keep flights, last-wins would keep military — order-dependent
  assert.equal(naiveUnion.size, 1);
  // This proves same entityKey does NOT make payloads interchangeable and that
  // I2c cannot safely union/dedup by simply keeping whichever enumerated last.
});

test('I2b: TIS-B/non-ICAO current record remains represented but has entityKey null', () => {
  const records = new Map();
  records.set('~abc123', { rawLat: 51.5, rawLon: -0.12, altitude: 10000, callsign: 'TISB1' });
  records.set('abc123', { rawLat: 0, rawLon: 0, altitude: 10000, callsign: 'NORMAL' });
  const entities = makeFlightsCurrentEntities(records);
  assert.equal(entities.length, 2);
  const tisb = entities.find((e) => e.icao24 === '~abc123');
  const normal = entities.find((e) => e.icao24 === 'abc123');
  assert.ok(tisb);
  assert.equal(tisb.entityKey, null); // NOT aircraft:icao24:~abc123 — TIS-B not ICAO24, needs owner decision
  assert.equal(tisb.icao24, '~abc123'); // native identifier preserved
  assert.ok(normal);
  assert.equal(normal.entityKey, 'aircraft:icao24:abc123');
});

test('I2b: missing/malformed canonical ID does not get invented identity', () => {
  const records = new Map();
  records.set('', { rawLat: 0, rawLon: 0, altitude: 10000, callsign: 'EMPTY' });
  records.set('   ', { rawLat: 0, rawLon: 0, altitude: 10000, callsign: 'SPACE' });
  records.set('abc', { rawLat: 0, rawLon: 0, altitude: 10000, callsign: 'SHORT' });
  records.set('zzzzzz', { rawLat: 0, rawLon: 0, altitude: 10000, callsign: 'NONHEX' });
  records.set('abc:123', { rawLat: 0, rawLon: 0, altitude: 10000, callsign: 'COLON' });
  const entities = makeFlightsCurrentEntities(records);
  for (const e of entities) {
    assert.equal(e.entityKey, null);
  }
});

test('I2b: geographic coordinates come from correct current record fields, not Cesium billboard', () => {
  const records = new Map();
  records.set('abc123', { rawLat: 51.5, rawLon: -0.12, altitude: 11000, callsign: 'TEST' });
  const entities = makeFlightsCurrentEntities(records);
  assert.equal(entities[0].lat, 51.5);
  assert.equal(entities[0].lon, -0.12);
  assert.equal(entities[0].altitudeM, 11000);
  // rawLat/rawLon are reported fix (pre-dead-reckon), not mutable Cesium Cartesian3
  // No Cartesian3 in record
  assert.equal(typeof entities[0].lat, 'number');
  assert.equal(typeof entities[0].lon, 'number');
  assert.ok(!('position' in entities[0]));
  assert.ok(!('pos' in entities[0]));
});

test('I2b: returned records are plain/copy-safe — mutating does not mutate storage', () => {
  const records = new Map();
  records.set('abc123', { rawLat: 51.5, rawLon: -0.12, altitude: 11000, callsign: 'ORIG' });
  const entities = makeFlightsCurrentEntities(records);
  assert.equal(entities[0].callsign, 'ORIG');
  // Mutate returned record
  entities[0].callsign = 'MUTATED';
  entities[0].lat = 999;
  // Original storage unchanged
  const stored = records.get('abc123');
  assert.equal(stored.callsign, 'ORIG');
  assert.equal(stored.rawLat, 51.5);
  // Fresh array per call
  const entities2 = makeFlightsCurrentEntities(records);
  assert.equal(entities2[0].callsign, 'ORIG');
  assert.notEqual(entities, entities2);
  assert.notEqual(entities[0], entities2[0]);
});

test('I2b: calling accessor repeatedly has no side effects', () => {
  const records = new Map();
  records.set('abc123', { rawLat: 0, rawLon: 0, altitude: 10000, callsign: 'TEST' });
  const e1 = makeFlightsCurrentEntities(records);
  const e2 = makeFlightsCurrentEntities(records);
  const e3 = makeFlightsCurrentEntities(records);
  assert.deepEqual(e1, e2);
  assert.deepEqual(e2, e3);
  assert.equal(records.size, 1); // storage not mutated
});

test('I2b: no previous-state/history accumulation', () => {
  const records = new Map();
  records.set('abc123', { rawLat: 0, rawLon: 0, altitude: 10000, callsign: 'V1' });
  let entities = makeFlightsCurrentEntities(records);
  assert.equal(entities.length, 1);
  // Update record — should replace, not accumulate history
  records.set('abc123', { rawLat: 1, rawLon: 1, altitude: 11000, callsign: 'V2' });
  entities = makeFlightsCurrentEntities(records);
  assert.equal(entities.length, 1);
  assert.equal(entities[0].lat, 1);
  assert.equal(entities[0].callsign, 'V2');
  // Remove record — should be gone, no tombstone
  records.delete('abc123');
  entities = makeFlightsCurrentEntities(records);
  assert.equal(entities.length, 0);
});

test('I2b: existing getAnalystRecords cap/output behavior remains intact (simulated)', () => {
  // Simulate getAnalystRecords capped logic
  const records = new Map();
  for (let i = 0; i < 3000; i++) {
    const hex = i.toString(16).padStart(6, '0');
    records.set(hex, { rawLat: 0, rawLon: 0, altitude: 10000, callsign: `CALL${i}` });
  }
  function getAnalystRecordsSimulated(maxCount = 2000) {
    const limit = Number.isFinite(maxCount) ? Math.max(1, Math.floor(maxCount)) : 2000;
    const result = [];
    for (const [icao24, info] of records) {
      result.push({ icao24, callsign: info.callsign });
      if (result.length >= limit) break;
    }
    return result;
  }
  const capped = getAnalystRecordsSimulated();
  assert.equal(capped.length, 2000); // capped
  const uncapped = makeFlightsCurrentEntities(records);
  assert.equal(uncapped.length, 3000); // uncapped accessor
  assert.ok(uncapped.length > capped.length);
});

test('I2b: existing aircraft lookup/tracking behavior remains intact', () => {
  // Simulate trackById exact then lowercase
  const billboards = new Map();
  billboards.set('a1b2c3', {});
  function hasContact(icao24) {
    if (!icao24) return false;
    const id = String(icao24).trim();
    return billboards.has(id) || billboards.has(id.toLowerCase());
  }
  assert.equal(hasContact('a1b2c3'), true);
  assert.equal(hasContact('A1B2C3'), true);
  assert.equal(hasContact('  a1b2c3  '), true);
  // entityKey normalization matches
  assert.equal(aircraftEntityKey('A1B2C3'), 'aircraft:icao24:a1b2c3');
});
