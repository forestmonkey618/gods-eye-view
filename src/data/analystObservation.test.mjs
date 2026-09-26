import assert from 'node:assert/strict';
import test from 'node:test';
import { createAnalystEngine } from './analystEngine.js';

const ANYWHERE = { kind: 'anywhere' };

function engineFor({ rows = {}, state = {}, getLayerObservation } = {}) {
  return createAnalystEngine({
    getRecords: (key) => rows[key] || [],
    ...(getLayerObservation === false ? {} : {
      getLayerObservation: getLayerObservation || ((key) => state[key]),
    }),
    getViewContext: () => ({ lat: 30, lon: -97, viewRadiusKm: 100 }),
    resolveRegionRing: async () => null,
  });
}

test('analyst: an enabled nominal zero stays a scoped zero, not an unobserved layer', async () => {
  const result = await engineFor({
    state: { flights: { enabled: true, feedState: 'nominal' } },
  }).query({ layers: ['flights'], scope: ANYWHERE });
  assert.equal(result.ok, true);
  assert.equal(result.count, 0);
  assert.deepEqual(result.items, []);
  assert.deepEqual(result.summary, { count: 0 });
  assert.equal(result.scopeLabel, 'anywhere in the loaded data');
  assert.deepEqual(result.coverage.layersQueried, [
    { layerKey: 'flights', records: 0, enabled: true, feedState: 'nominal' },
  ]);
  assert.deepEqual(result.observation, { unobserved: [] });
  assert.match(result.coverage.note, /client-side data only/);
});

test('analyst: a disabled zero remains count 0 but explicitly was not observed', async () => {
  const result = await engineFor({
    state: { military: { enabled: false, feedState: 'nominal' } },
  }).query({ layers: ['military'], scope: ANYWHERE });
  assert.equal(result.count, 0);
  assert.deepEqual(result.coverage.layersQueried, [
    { layerKey: 'military', records: 0, enabled: false, feedState: 'nominal' },
  ]);
  assert.deepEqual(result.observation.unobserved, [
    { layerKey: 'military', reason: 'layer-disabled' },
  ]);
});

test('analyst: degraded, partial, fallback and unavailable feeds retain records and counts', async () => {
  for (const feedState of ['degraded', 'partial', 'fallback', 'unavailable']) {
    const rows = [{ id: 'A', lat: 30, lon: -97, altitudeM: 12000 }];
    const result = await engineFor({
      rows: { flights: rows },
      state: { flights: { enabled: true, feedState } },
    }).query({ layers: ['flights'], scope: ANYWHERE, sortBy: 'altitudeM' });
    assert.equal(result.count, 1, feedState);
    assert.deepEqual(result.items.map(({ id }) => id), ['A'], feedState);
    assert.deepEqual(result.summary, { count: 1, altitudeMMin: 12000, altitudeMMax: 12000 });
    assert.deepEqual(result.observation.unobserved, [
      { layerKey: 'flights', reason: `feed-${feedState}` },
    ]);
  }
});

test('analyst: a mixed result names only the limited layers without dropping healthy records', async () => {
  const result = await engineFor({
    rows: { flights: [{ id: 'FL1' }] },
    state: {
      flights: { enabled: true, feedState: 'nominal' },
      military: { enabled: true, feedState: 'stale' },
      earthquakes: { enabled: false, feedState: 'unavailable' },
    },
  }).query({ layers: ['flights', 'military', 'earthquakes'], scope: ANYWHERE });
  assert.equal(result.count, 1);
  assert.equal(result.items[0].id, 'FL1');
  assert.deepEqual(result.coverage.layersQueried.map(({ layerKey, records }) => [layerKey, records]), [
    ['flights', 1], ['military', 0], ['earthquakes', 0],
  ]);
  assert.deepEqual(result.observation.unobserved, [
    { layerKey: 'military', reason: 'feed-stale' },
    { layerKey: 'earthquakes', reason: 'layer-disabled' },
  ]);
});

test('analyst: without an observation provider, no zero or nonzero is called nominal', async () => {
  const result = await engineFor({
    rows: { flights: [{ id: 'FL1' }] },
    getLayerObservation: false,
  }).query({ layers: ['flights', 'military'], scope: ANYWHERE });
  assert.equal(result.count, 1);
  assert.deepEqual(result.coverage.layersQueried.map(({ enabled, feedState }) => [enabled, feedState]), [
    [null, null], [null, null],
  ]);
  assert.deepEqual(result.observation.unobserved, [
    { layerKey: 'flights', reason: 'feed-state-unknown' },
    { layerKey: 'military', reason: 'feed-state-unknown' },
  ]);

  const missing = await engineFor({ getLayerObservation: () => ({ enabled: true }) })
    .query({ layers: ['flights'], scope: ANYWHERE });
  assert.deepEqual(missing.observation.unobserved, [
    { layerKey: 'flights', reason: 'feed-state-unknown' },
  ]);
});

test('analyst: follow-up carries the original observation snapshot, never reads live state again', async () => {
  const rows = [{ id: 'FL1', speedMps: 220 }, { id: 'FL2', speedMps: 90 }];
  let state = { enabled: true, feedState: 'partial' };
  let recordReads = 0;
  let observationReads = 0;
  const engine = createAnalystEngine({
    getRecords: () => { recordReads++; return rows; },
    getLayerObservation: () => { observationReads++; return state; },
    getViewContext: () => ({ lat: 0, lon: 0, viewRadiusKm: 100 }),
  });
  const first = await engine.query({ layers: ['flights'], scope: ANYWHERE });
  state = { enabled: false, feedState: 'unavailable' };
  rows.pop();
  // Even a consumer overwriting the editable coverage field cannot change
  // the engine's separately held status snapshot.
  first.coverage.layersQueried = [];
  const followUp = await engine.query({
    followUp: true, scope: ANYWHERE,
    filters: [{ field: 'speedMps', op: 'gt', value: 100 }],
  });
  assert.equal(followUp.count, 1);
  assert.equal(followUp.items[0].id, 'FL1');
  assert.equal(followUp.coverage.followUp, true);
  assert.deepEqual(followUp.coverage.layersQueried, [
    { layerKey: 'flights', records: 2, enabled: true, feedState: 'partial' },
  ]);
  assert.strictEqual(followUp.observation, first.observation);
  assert.deepEqual(followUp.observation.unobserved, [
    { layerKey: 'flights', reason: 'feed-partial' },
  ]);
  assert.deepEqual([recordReads, observationReads], [1, 1]);
  const fresh = await engine.query({ layers: ['flights'], scope: ANYWHERE });
  assert.deepEqual(fresh.observation.unobserved, [
    { layerKey: 'flights', reason: 'layer-disabled' },
  ]);
  assert.deepEqual([recordReads, observationReads], [2, 2]);
});

test('analyst: status is captured with records before asynchronous scope resolution', async () => {
  let resolveRegion;
  let currentState = { enabled: true, feedState: 'loading' };
  const engine = createAnalystEngine({
    getRecords: () => [],
    getLayerObservation: () => currentState,
    resolveRegionRing: () => new Promise((resolve) => { resolveRegion = resolve; }),
  });
  const pending = engine.query({ layers: ['flights'], scope: { kind: 'region', name: 'Texland' } });
  currentState = { enabled: true, feedState: 'nominal' };
  resolveRegion({ name: 'Texland', ring: [[-100, 28], [-94, 28], [-94, 33], [-100, 33]] });
  const result = await pending;
  assert.equal(result.count, 0);
  assert.deepEqual(result.observation.unobserved, [
    { layerKey: 'flights', reason: 'feed-loading' },
  ]);
  assert.equal(result.coverage.layersQueried[0].feedState, 'loading');
});

test('analyst: the new provider does not alter numbers, scope, or existing failure paths', async () => {
  const rows = { flights: [{ id: 'A', lat: 30, lon: -97, speedMps: 25 }] };
  const withStatus = engineFor({
    rows, state: { flights: { enabled: true, feedState: 'nominal' } },
  });
  const without = engineFor({ rows, getLayerObservation: false });
  const spec = { layers: ['flights'], scope: ANYWHERE };
  const a = await withStatus.query(spec);
  const b = await without.query(spec);
  for (const key of ['ok', 'count', 'items', 'summary', 'scopeLabel', 'truncated']) {
    assert.deepEqual(a[key], b[key], key);
  }
  for (const key of ['scope', 'followUp', 'note']) {
    assert.deepEqual(a.coverage[key], b.coverage[key], key);
  }
  for (const engine of [withStatus, without]) {
    const unknown = await engine.query({ layers: ['satellites'], scope: ANYWHERE });
    assert.equal(unknown.ok, false);
    assert.deepEqual(unknown.coverage, { layersQueried: [], scope: 'unsupported-layer' });
    const unresolved = await engine.query({ layers: ['flights'], scope: { kind: 'region', name: 'Atlantis' } });
    assert.equal(unresolved.ok, false);
    assert.equal(unresolved.coverage.scope, 'region:Atlantis:unresolved');
    assert.equal(unresolved.observation, undefined);
  }
});
