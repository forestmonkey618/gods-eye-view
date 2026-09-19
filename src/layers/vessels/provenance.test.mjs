import test from 'node:test';
import assert from 'node:assert/strict';
import { VesselRecords } from './records.js';
import { EPISTEMIC, isValidProvenance } from '../../data/provenance.js';
import { vessel as vesselEntityKey } from '../../data/entityKey.js';

function makeEffects() {
  return {
    add: () => {},
    beforeUpdate: () => null,
    updated: () => {},
    remove: () => {},
    removed: () => {},
    staleSelected: () => {},
  };
}

function row(mmsi, overrides = {}) {
  return {
    mmsi,
    lat: 51.93,
    lon: 4.05,
    name: `Vessel ${mmsi}`,
    imo: 'IMO1234567',
    type: 'Cargo',
    destination: 'Rotterdam',
    speed: 12.5,
    course: 90,
    heading: 95,
    last_position_UTC: '2024-01-01T12:00:00.000Z',
    last_position_epoch: 1704110400, // 2024-01-01T12:00:00Z
    ...overrides,
  };
}

test('vessel provenance: REPORTED with truthful sourceId and timestamps', () => {
  let now = 1_700_000_000_000;
  const records = new VesselRecords({ now: () => now });
  records.reconcile([row('123456789')], {}, makeEffects());
  const provMap = records.provenance;
  assert.equal(provMap.size, 1);
  const prov = provMap.get('123456789');
  assert.ok(prov);
  // All fields REPORTED
  for (const field of ['position', 'speed', 'course', 'heading', 'name', 'imo', 'type', 'destination']) {
    assert.ok(prov[field], `should have ${field}`);
    assert.equal(isValidProvenance(prov[field]), true, field);
    assert.equal(prov[field].epistemic, EPISTEMIC.REPORTED, field);
    assert.equal(prov[field].sourceId, 'aisstream', field);
  }
  // Position timestamp truthful from last_position_epoch
  assert.equal(prov.position.reportedAtMs, 1704110400 * 1000);
  assert.equal(prov.speed.reportedAtMs, 1704110400 * 1000);
  assert.equal(prov.course.reportedAtMs, 1704110400 * 1000);
  assert.equal(prov.heading.reportedAtMs, 1704110400 * 1000);
  // Static fields have null reportedAtMs (no event time retained)
  assert.equal(prov.name.reportedAtMs, null);
  assert.equal(prov.imo.reportedAtMs, null);
  assert.equal(prov.type.reportedAtMs, null);
  assert.equal(prov.destination.reportedAtMs, null);
  // receivedAtMs is GEV receipt time
  assert.equal(prov.position.receivedAtMs, now);
  assert.equal(prov.name.receivedAtMs, now);
});

test('vessel provenance: replacement replaces descriptors with new receipt time', () => {
  let now = 1_700_000_000_000;
  const records = new VesselRecords({ now: () => now });
  records.reconcile([row('123456789', { last_position_epoch: 1000 })], {}, makeEffects());
  const first = records.provenance.get('123456789').position;
  assert.equal(first.reportedAtMs, 1000 * 1000);
  assert.equal(first.receivedAtMs, now);

  now += 60_000;
  records.reconcile([row('123456789', { last_position_epoch: 2000, speed: 15 })], {}, makeEffects());
  const second = records.provenance.get('123456789').position;
  assert.equal(second.reportedAtMs, 2000 * 1000);
  assert.equal(second.receivedAtMs, now);
  assert.notEqual(first.receivedAtMs, second.receivedAtMs);
  // Speed also replaced
  assert.equal(records.provenance.get('123456789').speed.receivedAtMs, now);
});

test('vessel provenance: missing kinematic on later poll removes its descriptor, identity retained', () => {
  let now = 1_700_000_000_000;
  const records = new VesselRecords({ now: () => now });
  records.reconcile([row('123456789', { speed: 10, course: 90 })], {}, makeEffects());
  assert.ok(records.provenance.get('123456789').speed);
  assert.ok(records.provenance.get('123456789').course);

  now += 20_000;
  records.reconcile([row('123456789', { speed: null, course: null, heading: null })], {}, makeEffects());
  const prov = records.provenance.get('123456789');
  assert.equal('speed' in prov, false, 'synthetic null carries no descriptor');
  assert.equal('course' in prov, false);
  assert.equal('heading' in prov, false);
  assert.ok(prov.position, 'position retained');
  assert.ok(prov.name, 'identity retained with its own descriptor');
});

test('vessel provenance: partial retention keeps descriptors', () => {
  let now = 1000;
  const records = new VesselRecords({ now: () => now });
  records.reconcile([row('111111111'), row('222222222')], {}, makeEffects());
  assert.equal(records.provenance.size, 2);
  const before = records.provenance.get('111111111').position.receivedAtMs;

  now += 1000; // within PARTIAL_RETENTION_MS
  records.reconcile([row('222222222')], { complete: false }, makeEffects());
  // 111 retained due to partial
  assert.equal(records.byMmsi.has('111111111'), true);
  assert.equal(records.provenance.has('111111111'), true);
  assert.equal(records.provenance.get('111111111').position.receivedAtMs, before, 'retained provenance unchanged');

  now += 5 * 60 * 1000 + 1; // beyond retention
  records.reconcile([row('222222222')], { complete: false }, makeEffects());
  assert.equal(records.byMmsi.has('111111111'), false);
  assert.equal(records.provenance.has('111111111'), false, 'descriptors aged out with record');
});

test('vessel provenance: selected pin retains descriptors for 3 misses', () => {
  let now = 1000;
  const records = new VesselRecords({ now: () => now });
  records.reconcile([row('111111111'), row('222222222')], {}, makeEffects());
  const selected = records.byMmsi.get('111111111');
  assert.ok(records.provenance.has('111111111'));

  for (let i = 1; i <= 3; i++) {
    now += 60_000;
    records.reconcile([row('222222222')], { complete: true, selectedRecord: selected }, makeEffects());
    assert.equal(records.byMmsi.has('111111111'), true, `miss ${i} retained`);
    assert.equal(records.provenance.has('111111111'), true, `miss ${i} provenance retained`);
  }
  now += 60_000;
  records.reconcile([row('222222222')], { complete: true, selectedRecord: selected }, makeEffects());
  assert.equal(records.byMmsi.has('111111111'), false);
  assert.equal(records.provenance.has('111111111'), false);
});

test('vessel provenance: cap eviction removes descriptors', () => {
  let now = 1000;
  const records = new VesselRecords({ now: () => now });
  records.reconcile([row('111111111'), row('222222222'), row('333333333')], {}, makeEffects());
  assert.equal(records.provenance.size, 3);
  // cap 2, evicts first non-seen non-selected
  records.reconcile([row('333333333')], { cap: 2 }, makeEffects());
  assert.equal(records.byMmsi.size, 1);
  assert.equal(records.provenance.size, 1);
  assert.equal(records.provenance.has('333333333'), true);
});

test('vessel provenance: unkeyed records have no provenance entry', () => {
  let now = 1000;
  const records = new VesselRecords({ now: () => now });
  records.reconcile([{ mmsi: '', lat: 10, lon: 20, name: 'No MMSI', speed: 5 }], {}, makeEffects());
  assert.equal(records.unkeyed.length, 1);
  assert.equal(records.provenance.size, 0, 'unkeyed excluded');
});

test('vessel provenance: malformed MMSI still has provenance (native key)', () => {
  let now = 1000;
  const records = new VesselRecords({ now: () => now });
  records.reconcile([row('111', { lat: 10, lon: 20 })], {}, makeEffects());
  assert.equal(records.byMmsi.has('111'), true);
  assert.equal(records.provenance.has('111'), true);
  const prov = records.provenance.get('111');
  assert.equal(prov.position.sourceId, 'aisstream');
  // entityKey null for malformed, but provenance present
  assert.equal(vesselEntityKey('111'), null);
});

test('vessel provenance: copy-safety of public accessor', () => {
  // Simulate queries.js getProvenanceMap copy logic
  let now = 1000;
  const records = new VesselRecords({ now: () => now });
  records.reconcile([row('123456789')], {}, makeEffects());

  function getProvenanceMap() {
    const fullMap = records.provenance;
    const out = new Map();
    for (const [mmsi, provObj] of fullMap) {
      const copy = {};
      for (const [field, desc] of Object.entries(provObj)) {
        copy[field] = { ...desc };
      }
      out.set(mmsi, copy);
    }
    return out;
  }

  const first = getProvenanceMap();
  first.get('123456789').position.sourceId = 'tampered';
  first.get('123456789').forged = { epistemic: 'reported' };
  first.delete('123456789');

  const second = getProvenanceMap();
  assert.equal(second.get('123456789').position.sourceId, 'aisstream');
  assert.equal('forged' in second.get('123456789'), false);
  assert.notEqual(first, second);
});

test('vessel provenance: getCurrentEntities remains provenance-unaware', () => {
  let now = 1000;
  const records = new VesselRecords({ now: () => now });
  records.reconcile([row('123456789')], {}, makeEffects());
  const entities = records.all.map((rec) => ({
    entityKey: vesselEntityKey(rec.mmsi),
    mmsi: rec.mmsi,
    lat: rec.lat,
    lon: rec.lon,
    name: rec.name,
    speedKts: rec.speed,
    courseDeg: rec.course,
  }));
  assert.equal(entities.length, 1);
  const keys = Object.keys(entities[0]).sort();
  assert.deepEqual(keys, ['courseDeg', 'entityKey', 'lat', 'lon', 'mmsi', 'name', 'speedKts']);
  for (const k of keys) {
    assert.doesNotMatch(k, /provenance|epistemic|sourceId/i);
  }
});

test('vessel provenance: no descriptor outlives its record on clear', () => {
  let now = 1000;
  const records = new VesselRecords({ now: () => now });
  records.reconcile([row('123456789'), row('987654321')], {}, makeEffects());
  assert.equal(records.provenance.size, 2);
  records.reconcile([], {}, makeEffects());
  assert.equal(records.byMmsi.size, 0);
  assert.equal(records.provenance.size, 0);
});

test('vessel provenance: reportedAtMs null when timestamp missing', () => {
  let now = 1000;
  const records = new VesselRecords({ now: () => now });
  records.reconcile([row('123456789', { last_position_epoch: null, last_position_UTC: '' })], {}, makeEffects());
  const prov = records.provenance.get('123456789');
  assert.equal(prov.position.reportedAtMs, null);
  assert.equal(prov.position.receivedAtMs, now);
});
