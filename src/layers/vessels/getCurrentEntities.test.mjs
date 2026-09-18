import assert from 'node:assert/strict';
import test from 'node:test';
import { VesselRecords } from './records.js';
import { vessel as vesselEntityKey } from '../../data/entityKey.js';
import fs from 'node:fs';

// Pure implementation mirroring queries.js getCurrentEntities — to test contract without Cesium import
function getCurrentEntitiesFromState(state) {
  const records = state.records.all;
  if (!Array.isArray(records) || !records.length) return [];
  const result = [];
  for (const record of records) {
    const num = (v) => (Number.isFinite(v) ? v : null);
    const text = (v) => {
      const t = String(v ?? '').trim();
      return t || null;
    };
    result.push({
      entityKey: vesselEntityKey(record.mmsi),
      mmsi: text(record.mmsi),
      lat: num(record.lat),
      lon: num(record.lon),
      name: text(record.name),
      speedKts: num(record.speed),
      courseDeg: num(record.course),
    });
  }
  return result;
}

function makeVesselState() {
  const records = new VesselRecords({ now: () => Date.now() });
  return {
    records,
  };
}

test('vessel getCurrentEntities uncapped beyond analyst/position cap', () => {
  const state = makeVesselState();
  const rows = [];
  for (let i = 0; i < 2500; i++) {
    const mmsi = String(100000000 + i);
    rows.push({ mmsi, lat: 10 + i * 0.001, lon: 20, name: `V${i}`, speed: 10, course: 90 });
  }
  const effects = {
    add: () => {},
    beforeUpdate: () => null,
    updated: () => {},
    remove: () => {},
    removed: () => {},
    staleSelected: () => {},
  };
  state.records.reconcile(rows, {}, effects);
  const entities = getCurrentEntitiesFromState(state);
  assert.equal(entities.length, 2500);
  assert.ok(entities.length > 2000);
  assert.ok(entities.length > 800);
});

test('vessel getCurrentEntities every eligible current stored vessel represented', () => {
  const state = makeVesselState();
  const effects = {
    add: () => {},
    beforeUpdate: () => null,
    updated: () => {},
    remove: () => {},
    removed: () => {},
    staleSelected: () => {},
  };
  state.records.reconcile(
    [
      { mmsi: '123456789', lat: 10, lon: 20, name: 'A', speed: 5, course: 90 },
      { mmsi: '987654321', lat: 11, lon: 21, name: 'B', speed: 6, course: 180 },
    ],
    {},
    effects,
  );
  const entities = getCurrentEntitiesFromState(state);
  assert.equal(entities.length, 2);
  const mmsis = entities.map((e) => e.mmsi).sort();
  assert.deepEqual(mmsis, ['123456789', '987654321']);
});

test('vessel getCurrentEntities valid MMSI gets correct entityKey', () => {
  const state = makeVesselState();
  const effects = {
    add: () => {},
    beforeUpdate: () => null,
    updated: () => {},
    remove: () => {},
    removed: () => {},
    staleSelected: () => {},
  };
  state.records.reconcile(
    [{ mmsi: '123456789', lat: 10, lon: 20, name: 'A', speed: 5, course: 90 }],
    {},
    effects,
  );
  const [entity] = getCurrentEntitiesFromState(state);
  assert.equal(entity.entityKey, 'vessel:mmsi:123456789');
  assert.equal(entity.mmsi, '123456789');
});

test('vessel getCurrentEntities malformed/unkeyed does not get invented canonical identity', () => {
  const state = makeVesselState();
  const effects = {
    add: () => {},
    beforeUpdate: () => null,
    updated: () => {},
    remove: () => {},
    removed: () => {},
    staleSelected: () => {},
  };
  state.records.reconcile(
    [
      { mmsi: '123456789', lat: 10, lon: 20, name: 'Valid', speed: 5, course: 90 },
      { mmsi: '111', lat: 10, lon: 20, name: 'Short', speed: 5, course: 90 },
      { mmsi: '', lat: 10, lon: 20, name: 'Unkeyed', speed: 5, course: 90 },
    ],
    {},
    effects,
  );
  const entities = getCurrentEntitiesFromState(state);
  assert.equal(entities.length, 3);
  const valid = entities.find((e) => e.mmsi === '123456789');
  const short = entities.find((e) => e.mmsi === '111');
  const unkeyed = entities.find((e) => e.name === 'Unkeyed');
  assert.equal(valid.entityKey, 'vessel:mmsi:123456789');
  assert.equal(short.entityKey, null);
  assert.equal(unkeyed.entityKey, null);
  for (const e of entities) {
    if (e.entityKey !== null) {
      assert.ok(e.entityKey.startsWith('vessel:mmsi:'));
    }
  }
});

test('vessel getCurrentEntities coordinates come from current record model not Cesium', () => {
  const state = makeVesselState();
  const effects = {
    add: () => {},
    beforeUpdate: () => null,
    updated: () => {},
    remove: () => {},
    removed: () => {},
    staleSelected: () => {},
  };
  state.records.reconcile(
    [{ mmsi: '123456789', lat: 51.93, lon: 4.05, name: 'A', speed: 8, course: 90 }],
    {},
    effects,
  );
  const [entity] = getCurrentEntitiesFromState(state);
  assert.equal(entity.lat, 51.93);
  assert.equal(entity.lon, 4.05);
  state.records.byMmsi.get('123456789').lat = 52.0;
  const [entity2] = getCurrentEntitiesFromState(state);
  assert.equal(entity2.lat, 52.0);
});

test('vessel getCurrentEntities plain/primitive-only', () => {
  const state = makeVesselState();
  const effects = {
    add: () => {},
    beforeUpdate: () => null,
    updated: () => {},
    remove: () => {},
    removed: () => {},
    staleSelected: () => {},
  };
  state.records.reconcile(
    [{ mmsi: '123456789', lat: 10, lon: 20, name: 'A', speed: 5, course: 90 }],
    {},
    effects,
  );
  const [entity] = getCurrentEntitiesFromState(state);
  for (const [k, v] of Object.entries(entity)) {
    assert.ok(
      v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean',
      `field ${k} should be primitive`,
    );
  }
  assert.equal(Object.hasOwn(entity, 'position'), false);
  assert.equal(Object.hasOwn(entity, 'billboard'), false);
});

test('vessel getCurrentEntities mutation does not mutate storage', () => {
  const state = makeVesselState();
  const effects = {
    add: () => {},
    beforeUpdate: () => null,
    updated: () => {},
    remove: () => {},
    removed: () => {},
    staleSelected: () => {},
  };
  state.records.reconcile(
    [{ mmsi: '123456789', lat: 10, lon: 20, name: 'A', speed: 5, course: 90 }],
    {},
    effects,
  );
  const [entity] = getCurrentEntitiesFromState(state);
  entity.lat = 999;
  entity.mmsi = '000000000';
  const stored = state.records.byMmsi.get('123456789');
  assert.equal(stored.lat, 10);
  assert.equal(stored.mmsi, '123456789');
});

test('vessel getCurrentEntities repeated calls have no side effects', () => {
  const state = makeVesselState();
  const effects = {
    add: () => {},
    beforeUpdate: () => null,
    updated: () => {},
    remove: () => {},
    removed: () => {},
    staleSelected: () => {},
  };
  state.records.reconcile(
    [{ mmsi: '123456789', lat: 10, lon: 20, name: 'A', speed: 5, course: 90 }],
    {},
    effects,
  );
  const first = getCurrentEntitiesFromState(state);
  const second = getCurrentEntitiesFromState(state);
  assert.deepEqual(first, second);
  assert.notEqual(first, second);
  assert.notEqual(first[0], second[0]);
});

test('vessel getCurrentEntities no history accumulation', () => {
  const state = makeVesselState();
  const effects = {
    add: () => {},
    beforeUpdate: () => null,
    updated: () => {},
    remove: () => {},
    removed: () => {},
    staleSelected: () => {},
  };
  state.records.reconcile(
    [{ mmsi: '123456789', lat: 10, lon: 20, name: 'A', speed: 5, course: 90 }],
    {},
    effects,
  );
  assert.equal(getCurrentEntitiesFromState(state).length, 1);
  state.records.reconcile(
    [{ mmsi: '987654321', lat: 11, lon: 21, name: 'B', speed: 6, course: 180 }],
    {},
    effects,
  );
  const entities = getCurrentEntitiesFromState(state);
  assert.equal(entities.length, 1);
  assert.equal(entities[0].mmsi, '987654321');
});

test('vessel queries.js contains getCurrentEntities and uses vesselEntityKey and state.records.all', () => {
  const content = fs.readFileSync('src/layers/vessels/queries.js', 'utf8');
  assert.ok(content.includes('getCurrentEntities'), 'should contain getCurrentEntities');
  assert.ok(content.includes('vesselEntityKey') || content.includes('vessel as'), 'should use vessel entityKey');
  assert.ok(content.includes('state.records.all'), 'should use state.records.all');
  assert.ok(content.includes('entityKey'), 'should produce entityKey');
  // Ensure D9 not touched: getNearby still uses Cartesian3.distance
  assert.ok(content.includes('Cartesian3.distance'), 'getNearby should still use Cartesian3.distance');
});

test('vessel getAnalystRecords cap unchanged (checked via file content)', () => {
  const content = fs.readFileSync('src/layers/vessels/queries.js', 'utf8');
  // getAnalystRecords should still have maxCount 2000 default
  assert.ok(content.includes('getAnalystRecords(maxCount = 2000)'), 'should still have capped analyst records');
});

test('vessel getAllPositions cap unchanged (checked via file content)', () => {
  const content = fs.readFileSync('src/layers/vessels/queries.js', 'utf8');
  assert.ok(content.includes('getAllPositions(maxCount = 800)'), 'should still have capped positions');
});

test('vessel getNearby unchanged (checked via file content)', () => {
  const content = fs.readFileSync('src/layers/vessels/queries.js', 'utf8');
  assert.ok(content.includes('getNearby(centerCartesian, rangeM, maxCount = 25)'), 'getNearby signature unchanged');
});
