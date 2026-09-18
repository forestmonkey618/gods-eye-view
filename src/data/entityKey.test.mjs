import assert from 'node:assert/strict';
import test from 'node:test';

import { aircraft } from './entityKey.js';

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
