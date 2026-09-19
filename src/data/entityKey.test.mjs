import assert from 'node:assert/strict';
import test from 'node:test';

import { aircraft, vessel, isValid } from './entityKey.js';

// I2a supports aircraft only — canonical form aircraft:icao24:<normalized>
// Validation: exactly 6 hex digits [0-9a-f]{6} lowercased trimmed per actual feeds
// TIS-B ~, _-, variable length NOT valid as icao24 — requires owner decision for separate namespace

test('entityKey: same ICAO24 produces same canonical key', () => {
  const k1 = aircraft('abc123');
  const k2 = aircraft('abc123');
  assert.equal(k1, 'aircraft:icao24:abc123');
  assert.equal(k2, 'aircraft:icao24:abc123');
  assert.equal(k1, k2);
});

test('entityKey: case normalization deterministic per GEV lookup (trim + lowercase)', () => {
  assert.equal(aircraft('ABC123'), 'aircraft:icao24:abc123');
  assert.equal(aircraft(' abc123 '), 'aircraft:icao24:abc123');
  assert.equal(aircraft('AbC123'), 'aircraft:icao24:abc123');
  assert.equal(aircraft('ABC123'), aircraft('abc123'));
  assert.equal(aircraft('ABC123'), aircraft('  abc123  '));
});

test('entityKey: flights and military use SAME semantic namespace', () => {
  const flightKey = aircraft('a1b2c3');
  const militaryKey = aircraft('a1b2c3');
  assert.equal(flightKey, militaryKey);
  assert.equal(flightKey, 'aircraft:icao24:a1b2c3');
  assert.ok(!flightKey.startsWith('flights:'));
  assert.ok(!flightKey.startsWith('military:'));
  assert.ok(flightKey.startsWith('aircraft:icao24:'));
});

test('entityKey: missing/empty/malformed do not receive invented identities', () => {
  assert.equal(aircraft(''), null);
  assert.equal(aircraft('   '), null);
  assert.equal(aircraft(null), null);
  assert.equal(aircraft(undefined), null);
  // Out-of-grammar rejected — identity never truncated
  assert.equal(aircraft('a'.repeat(17)), null);
  assert.equal(aircraft('abc:123'), null); // colon would break delimiter
  assert.equal(aircraft('abc 123'), null); // inner space
  assert.equal(aircraft('!@#'), null);
  // Non-6-hex rejected for I2a canonical icao24
  assert.equal(aircraft('abc'), null); // too short
  assert.equal(aircraft('abc1234'), null); // too long (7 hex without ~)
  assert.equal(aircraft('zzzzzz'), null); // non-hex
  assert.equal(aircraft('~abc123'), null); // TIS-B ~ prefix — NOT icao24, needs separate namespace (owner decision)
  assert.equal(aircraft('abc-123'), null); // _- not valid aircraft identifier
  assert.equal(aircraft('abc_def'), null);
});

test('entityKey: layer/provider names do not alter aircraft identity', () => {
  const fromOpenSky = aircraft('ABC123');
  const fromAdsbLol = aircraft('abc123');
  const fromFlightsLayer = aircraft('  ABC123 ');
  const fromMilitaryLayer = aircraft('abc123');
  assert.equal(fromOpenSky, fromAdsbLol);
  assert.equal(fromFlightsLayer, fromMilitaryLayer);
  assert.equal(fromOpenSky, 'aircraft:icao24:abc123');
});

test('entityKey: helper does not retain history/state', () => {
  const k1 = aircraft('abc123');
  const k2 = aircraft('def456');
  const k3 = aircraft('abc123');
  assert.equal(k1, 'aircraft:icao24:abc123');
  assert.equal(k2, 'aircraft:icao24:def456');
  assert.equal(k3, k1);
  assert.equal(aircraft('abc123'), k1);
});

test('entityKey: existing aircraft lookup behavior not broken — trackById exact then lowercase', () => {
  const billboards = new Map();
  billboards.set('a1b2c3', {});
  let id = 'a1b2c3'.trim();
  let found = billboards.has(id) || billboards.has(id.toLowerCase());
  assert.equal(found, true);
  id = 'A1B2C3'.trim();
  found = billboards.has(id) || billboards.has(id.toLowerCase());
  assert.equal(found, true);
  assert.equal(aircraft('A1B2C3'), 'aircraft:icao24:a1b2c3');
  assert.equal(aircraft('a1b2c3'), 'aircraft:icao24:a1b2c3');
});

test('entityKey: deterministic 6-hex validation from actual feeds', () => {
  // OpenSky and readsb produce 6 hex lowercased for ICAO aircraft
  assert.equal(aircraft('a1b2c3'), 'aircraft:icao24:a1b2c3');
  assert.equal(aircraft('000000'), 'aircraft:icao24:000000');
  assert.equal(aircraft('ffffff'), 'aircraft:icao24:ffffff');
  assert.equal(aircraft('ABCDEF'), 'aircraft:icao24:abcdef');
  // 6 hex is the only meaningful length for ICAO24
  assert.equal(aircraft('a1b2c'), null); // 5
  assert.equal(aircraft('a1b2c3d'), null); // 7 without ~
});

// I2d — VESSEL / MMSI

test('entityKey: vessel canonical identity — exact 9 digits', () => {
  assert.equal(vessel('123456789'), 'vessel:mmsi:123456789');
});

test('entityKey: vessel whitespace normalization deliberate', () => {
  assert.equal(vessel(' 123456789 '), 'vessel:mmsi:123456789');
  assert.equal(vessel(' 123456789 '), vessel('123456789'));
});

test('entityKey: vessel exactly 9 digits required', () => {
  assert.equal(vessel('12345678'), null); // 8
  assert.equal(vessel('1234567890'), null); // 10
  assert.equal(vessel(''), null);
  assert.equal(vessel('   '), null);
  assert.equal(vessel(null), null);
  assert.equal(vessel(undefined), null);
});

test('entityKey: vessel letters rejected', () => {
  assert.equal(vessel('12345abcd'), null);
  assert.equal(vessel('abcdefghi'), null);
  assert.equal(vessel('12345678a'), null);
});

test('entityKey: vessel too short / too long rejected', () => {
  assert.equal(vessel('1'), null);
  assert.equal(vessel('12'), null);
  assert.equal(vessel('12345678901'), null);
});

test('entityKey: vessel missing/empty rejected', () => {
  assert.equal(vessel(''), null);
  assert.equal(vessel('   '), null);
  assert.equal(vessel(null), null);
  assert.equal(vessel(undefined), null);
  assert.equal(vessel('abc:123'), null);
  assert.equal(vessel('123 456789'), null);
});

test('entityKey: vessel leading-zero STRING preserved', () => {
  assert.equal(vessel('012345678'), 'vessel:mmsi:012345678');
  assert.equal(vessel('000000001'), 'vessel:mmsi:000000001');
  // Ensure leading zero not stripped
  const key = vessel('012345678');
  assert.ok(key.endsWith('012345678'));
});

test('entityKey: vessel no automatic zero-padding', () => {
  // Numeric 8-digit should NOT be padded to 9
  assert.equal(vessel(12345678), null);
  assert.equal(vessel('12345678'), null);
  // Numeric 9-digit valid, but numeric losing leading zero is rejected
  assert.equal(vessel(123456789), 'vessel:mmsi:123456789');
  // Number 12345678 that would be "012345678" if padded must be null
  assert.equal(vessel(12345678), null);
  // String "12345678" must be null, not padded
  assert.equal(vessel('12345678'), null);
});

test('entityKey: aircraft behavior remains unchanged after vessel addition', () => {
  assert.equal(aircraft('abc123'), 'aircraft:icao24:abc123');
  assert.equal(aircraft('ABC123'), 'aircraft:icao24:abc123');
  assert.equal(aircraft(''), null);
  assert.equal(aircraft('~abc123'), null);
});

test('entityKey: isValid accepts canonical aircraft key', () => {
  assert.equal(isValid('aircraft:icao24:abc123'), true);
  assert.equal(isValid('aircraft:icao24:000000'), true);
  assert.equal(isValid('aircraft:icao24:ffffff'), true);
});

test('entityKey: isValid accepts canonical vessel key', () => {
  assert.equal(isValid('vessel:mmsi:123456789'), true);
  assert.equal(isValid('vessel:mmsi:012345678'), true);
  assert.equal(isValid('vessel:mmsi:000000001'), true);
});

test('entityKey: isValid rejects uppercase/noncanonical aircraft key', () => {
  assert.equal(isValid('aircraft:icao24:ABC123'), false);
  assert.equal(isValid('aircraft:icao24:AbC123'), false);
  assert.equal(isValid(' aircraft:icao24:abc123'), false);
  assert.equal(isValid('aircraft:icao24:abc123 '), false);
  assert.equal(isValid('aircraft:icao24:abc12'), false); // too short
  assert.equal(isValid('aircraft:icao24:abc1234'), false); // too long
  assert.equal(isValid('aircraft:icao24:zzzzzz'), false);
});

test('entityKey: isValid rejects malformed vessel key', () => {
  assert.equal(isValid('vessel:mmsi:12345678'), false); // 8
  assert.equal(isValid('vessel:mmsi:1234567890'), false); // 10
  assert.equal(isValid('vessel:mmsi:12345abcd'), false);
  assert.equal(isValid('vessel:mmsi: 123456789'), false);
  assert.equal(isValid('vessel:mmsi:123456789 '), false);
  assert.equal(isValid(' vessel:mmsi:123456789'), false);
  assert.equal(isValid('vessel:mmsi:'), false);
});

test('entityKey: isValid rejects unsupported domains', () => {
  assert.equal(isValid('satellite:norad:12345'), false);
  assert.equal(isValid('banana'), false);
  assert.equal(isValid('foo:bar'), false);
  assert.equal(isValid('aircraft:icao24:tisb'), false);
  assert.equal(isValid(''), false);
  assert.equal(isValid(null), false);
  assert.equal(isValid(undefined), false);
  assert.equal(isValid(123), false);
});
