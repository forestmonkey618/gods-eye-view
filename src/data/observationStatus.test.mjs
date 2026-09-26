import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  assessLayerObservation,
  unobservedLayers,
} from './observationStatus.js';

test('observation: enabled + exactly nominal has no limitation', () => {
  assert.deepEqual(
    assessLayerObservation({ layerKey: 'flights', enabled: true, feedState: 'nominal' }),
    { layerKey: 'flights', enabled: true, feedState: 'nominal', reason: null },
  );
});

test('observation: disabled takes precedence over every feed state, even missing or unknown', () => {
  for (const feedState of [
    'nominal', 'loading', 'unavailable', 'stale', 'degraded',
    'partial', 'fallback', 'future-state', undefined,
  ]) {
    const assessment = assessLayerObservation({ layerKey: 'military', enabled: false, feedState });
    assert.equal(assessment.reason, 'layer-disabled', String(feedState));
  }
});

test('observation: each existing non-nominal feed state has one stable reason', () => {
  for (const [feedState, reason] of Object.entries({
    loading: 'feed-loading',
    unavailable: 'feed-unavailable',
    stale: 'feed-stale',
    degraded: 'feed-degraded',
    partial: 'feed-partial',
    fallback: 'feed-fallback',
  })) {
    assert.equal(
      assessLayerObservation({ layerKey: 'flights', enabled: true, feedState }).reason,
      reason,
      feedState,
    );
  }
});

test('observation: missing, unrecognized or untrusted state is never nominal', () => {
  for (const feedState of [undefined, null, '', 'unknown', 'NOMINAL', 'offline', '__proto__', 'toString', {}, 0]) {
    const assessment = assessLayerObservation({ layerKey: 'flights', enabled: true, feedState });
    assert.equal(assessment.reason, 'feed-state-unknown', String(feedState));
    assert.notEqual(assessment.feedState, 'nominal');
  }
  for (const enabled of [undefined, null, 1, 'true', {}]) {
    const assessment = assessLayerObservation({ layerKey: 'flights', enabled, feedState: 'nominal' });
    assert.equal(assessment.reason, 'feed-state-unknown', String(enabled));
    assert.equal(assessment.enabled, null);
  }
});

test('observation: collected limitations preserve query order and cannot be mutated by a consumer', () => {
  const inputs = Object.freeze([
    Object.freeze({ layerKey: 'flights', enabled: true, feedState: 'nominal' }),
    Object.freeze({ layerKey: 'military', enabled: false, feedState: 'nominal' }),
    Object.freeze({ layerKey: 'ais-live-vessels', enabled: true, feedState: 'partial' }),
  ]);
  const assessments = inputs.map(assessLayerObservation);
  const unobserved = unobservedLayers(assessments);
  assert.deepEqual(unobserved, [
    { layerKey: 'military', reason: 'layer-disabled' },
    { layerKey: 'ais-live-vessels', reason: 'feed-partial' },
  ]);
  assert.deepEqual(unobservedLayers([assessments[0]]), []);
  assert.ok(Object.isFrozen(unobserved));
  for (const entry of [...assessments, ...unobserved]) assert.ok(Object.isFrozen(entry));
  assert.throws(() => { unobserved[0].reason = 'something-else'; }, TypeError);
  assert.throws(() => { unobserved.push({ layerKey: 'injected' }); }, TypeError);
  assert.deepEqual(assessLayerObservation(inputs[1]), assessments[1]);
  assert.deepEqual(inputs[1], { layerKey: 'military', enabled: false, feedState: 'nominal' });
});

test('observation authority is a deterministic leaf with no clock, network, DOM or rendering input', async () => {
  // No imports: feed-state calculation, lifecycle, Cesium, rendering and network
  // cannot creep into this status-only primitive through another module.
  const source = readFileSync(new URL('./observationStatus.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /^\s*import\s/m);
  assert.doesNotMatch(source, /\b(?:Date\.now|new Date|fetch\(|document\.|window\.)/);
  const originalNow = Date.now;
  const originalFetch = globalThis.fetch;
  try {
    Date.now = () => { throw new Error('clock read'); };
    globalThis.fetch = () => { throw new Error('network read'); };
    const fresh = await import('./observationStatus.js?purity-test');
    const input = { layerKey: 'flights', enabled: true, feedState: 'fallback' };
    assert.deepEqual(fresh.assessLayerObservation(input), fresh.assessLayerObservation(input));
    assert.deepEqual(input, { layerKey: 'flights', enabled: true, feedState: 'fallback' });
  } finally {
    Date.now = originalNow;
    globalThis.fetch = originalFetch;
  }
});
