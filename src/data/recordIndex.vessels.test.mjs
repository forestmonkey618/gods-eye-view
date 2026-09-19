import assert from 'node:assert/strict';
import test from 'node:test';
import { aircraft, vessel, isValid } from './entityKey.js';
import { buildRecordIndex } from './recordIndex.js';

function makeAircraftRecord(icao24, overrides = {}) {
  return {
    entityKey: aircraft(icao24),
    icao24,
    lat: 51.5,
    lon: -0.12,
    altitudeM: 10000,
    callsign: 'TEST',
    ...overrides,
  };
}

function makeVesselRecord(mmsi, overrides = {}) {
  return {
    entityKey: vessel(mmsi),
    mmsi,
    lat: 10,
    lon: 20,
    name: 'VESSEL',
    speedKts: 10,
    courseDeg: 90,
    ...overrides,
  };
}

// 1. aircraft + vessel coexist
test('I2d: aircraft + vessel canonical keys coexist in one index', () => {
  const a = makeAircraftRecord('a1b2c3');
  const v = makeVesselRecord('123456789');
  const idx = buildRecordIndex([
    { storeId: 'flights', records: [a] },
    { storeId: 'vessels', records: [v] },
  ]);
  assert.equal(idx.size, 2);
  assert.ok(idx.has('aircraft:icao24:a1b2c3'));
  assert.ok(idx.has('vessel:mmsi:123456789'));
  assert.equal(idx.get('aircraft:icao24:a1b2c3').records[0].storeId, 'flights');
  assert.equal(idx.get('vessel:mmsi:123456789').records[0].storeId, 'vessels');
});

// 2. recordIndex has no domain-specific ICAO/MMSI grammar
test('I2d: recordIndex has no domain-specific ICAO/MMSI grammar', async () => {
  const { readFile } = await import('node:fs/promises');
  const content = await readFile(new URL('./recordIndex.js', import.meta.url), 'utf8');
  // Should not contain its own ICAO24_HEX or MMSI_9 definitions or regex literals
  // Comments may mention canonical forms, but code should not define them
  assert.ok(!content.match(/const\s+ICAO24_HEX/), 'should not define ICAO24_HEX');
  assert.ok(!content.match(/const\s+MMSI_9/), 'should not define MMSI_9');
  assert.ok(!content.match(/\/\^.*\[0-9a-f\].*6.*\$/), 'should not contain ICAO hex regex');
  assert.ok(!content.match(/\/\^\\d\{9\}\$/), 'should not contain MMSI 9-digit regex literal');
  assert.ok(content.includes('isValid'), 'should use isValid from entityKey');
  assert.ok(content.includes("from './entityKey.js'") || content.includes('entityKey'), 'should import from entityKey');
});

// 3. validation delegated to entityKey authority
test('I2d: validation delegated to entityKey authority', () => {
  // isValid should be the authority
  assert.equal(isValid('aircraft:icao24:abc123'), true);
  assert.equal(isValid('vessel:mmsi:123456789'), true);
  assert.equal(isValid('banana'), false);
  // recordIndex should use same validation — test via index
  const malformed = { entityKey: 'banana', mmsi: 'banana', lat: 0, lon: 0 };
  const idx = buildRecordIndex([{ storeId: 'vessels', records: [malformed] }]);
  assert.equal(idx.size, 0);
});

// 4. vessel single-store record fits same entry shape
test('I2d: vessel single-store record fits same entry shape', () => {
  const v = makeVesselRecord('123456789', { name: 'TEST VESSEL', speedKts: 12 });
  const idx = buildRecordIndex([{ storeId: 'vessels', records: [v] }]);
  const entry = idx.get('vessel:mmsi:123456789');
  assert.equal(entry.entityKey, 'vessel:mmsi:123456789');
  assert.equal(entry.records.length, 1);
  assert.equal(entry.records[0].storeId, 'vessels');
  assert.equal(entry.records[0].record.mmsi, '123456789');
  assert.equal(entry.records[0].record.name, 'TEST VESSEL');
  assert.equal(entry.records[0].record.speedKts, 12);
});

// 5. aircraft two-store behavior remains unchanged
test('I2d: aircraft two-store behavior remains unchanged', () => {
  const f = makeAircraftRecord('a1b2c3', { callsign: 'F' });
  const m = makeAircraftRecord('a1b2c3', { callsign: 'M' });
  const idx = buildRecordIndex([
    { storeId: 'flights', records: [f] },
    { storeId: 'military', records: [m] },
  ]);
  assert.equal(idx.size, 1);
  assert.equal(idx.get('aircraft:icao24:a1b2c3').records.length, 2);
});

// 6. malformed vessel key excluded
test('I2d: malformed vessel key excluded', () => {
  const malformed = [
    { entityKey: 'vessel:mmsi:12345678', mmsi: '12345678', lat: 0, lon: 0 }, // 8 digits
    { entityKey: 'vessel:mmsi:1234567890', mmsi: '1234567890', lat: 0, lon: 0 }, // 10
    { entityKey: 'vessel:mmsi:12345abcd', mmsi: '12345abcd', lat: 0, lon: 0 },
    { entityKey: 'vessel:mmsi:ABC', mmsi: 'ABC', lat: 0, lon: 0 },
    { entityKey: null, mmsi: '', lat: 0, lon: 0 },
  ];
  const idx = buildRecordIndex([{ storeId: 'vessels', records: malformed }]);
  assert.equal(idx.size, 0);
});

// 7. null entityKey excluded
test('I2d: null entityKey excluded', () => {
  const rec = { entityKey: null, mmsi: null, lat: 10, lon: 20 };
  const idx = buildRecordIndex([{ storeId: 'vessels', records: [rec] }]);
  assert.equal(idx.size, 0);
});

// 8. deterministic ordering across aircraft and vessel keys
test('I2d: deterministic ordering works across aircraft and vessel', () => {
  const a1 = makeAircraftRecord('a1b2c3');
  const a2 = makeAircraftRecord('b2c3d4');
  const v1 = makeVesselRecord('123456789');
  const v2 = makeVesselRecord('987654321');
  const idx = buildRecordIndex([
    { storeId: 'vessels', records: [v2, v1] },
    { storeId: 'flights', records: [a2, a1] },
  ]);
  const keys = idx.values().map((e) => e.entityKey);
  // Sorted asc: aircraft:... < vessel:... because 'a' < 'v'
  assert.deepEqual(keys, [
    'aircraft:icao24:a1b2c3',
    'aircraft:icao24:b2c3d4',
    'vessel:mmsi:123456789',
    'vessel:mmsi:987654321',
  ]);
});

// 9. rebuild removes missing vessels
test('I2d: rebuild removes missing vessels', () => {
  const v1 = makeVesselRecord('123456789');
  const v2 = makeVesselRecord('987654321');
  const idx1 = buildRecordIndex([{ storeId: 'vessels', records: [v1, v2] }]);
  assert.equal(idx1.size, 2);
  const idx2 = buildRecordIndex([{ storeId: 'vessels', records: [v1] }]);
  assert.equal(idx2.size, 1);
  assert.ok(idx2.has('vessel:mmsi:123456789'));
  assert.ok(!idx2.has('vessel:mmsi:987654321'));
});

// 10. no history/diff
test('I2d: no history/diff', () => {
  const idx = buildRecordIndex([{ storeId: 'vessels', records: [makeVesselRecord('123456789')] }]);
  assert.equal(typeof idx.subscribe, 'undefined');
  assert.equal(typeof idx.diff, 'undefined');
});

// 11. copy safety remains valid
test('I2d: copy safety remains valid', () => {
  const v = makeVesselRecord('123456789', { name: 'ORIG' });
  const idx = buildRecordIndex([{ storeId: 'vessels', records: [v] }]);
  const entry = idx.get('vessel:mmsi:123456789');
  entry.records[0].record.name = 'MUTATED';
  const entry2 = idx.get('vessel:mmsi:123456789');
  assert.equal(entry2.records[0].record.name, 'ORIG');
});

// 12. storeId vessels accepted
test('I2d: storeId vessels accepted', () => {
  const v = makeVesselRecord('123456789');
  const idx = buildRecordIndex([{ storeId: 'vessels', records: [v] }]);
  assert.equal(idx.size, 1);
});

// 13. unknown storeId rejected
test('I2d: unknown storeId rejected', () => {
  const v = makeVesselRecord('123456789');
  assert.throws(() => buildRecordIndex([{ storeId: 'ais-live-vessels', records: [v] }]), /Invalid storeId/);
  assert.throws(() => buildRecordIndex([{ storeId: 'AISStream', records: [v] }]), /Invalid storeId/);
  assert.throws(() => buildRecordIndex([{ storeId: 'vessel', records: [v] }]), /Invalid storeId/);
});

// 14. no provider identity encoded into storeId
test('I2d: no provider identity encoded into storeId', async () => {
  const { readFile } = await import('node:fs/promises');
  const content = await readFile(new URL('./recordIndex.js', import.meta.url), 'utf8');
  // VALID_STORE_IDS should contain only flights, military, vessels — not provider ids
  assert.ok(content.includes("'vessels'"), 'should contain bounded storeId vessels');
  assert.ok(content.includes("'flights'"), 'should contain flights');
  assert.ok(content.includes("'military'"), 'should contain military');
  // Ensure invalid storeIds are rejected (tested elsewhere), and provider not in VALID_STORE_IDS set literal
  const validSetMatch = content.match(/VALID_STORE_IDS\s*=\s*new\s+Set\(\[([^\]]+)\]\)/);
  assert.ok(validSetMatch, 'should have VALID_STORE_IDS set');
  const setContent = validSetMatch[1];
  assert.ok(!setContent.includes('ais-live-vessels'), 'VALID_STORE_IDS should not contain ais-live-vessels');
  assert.ok(!setContent.includes('AISStream'), 'VALID_STORE_IDS should not contain AISStream');
});
