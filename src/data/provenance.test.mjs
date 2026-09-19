import assert from 'node:assert/strict';
import test from 'node:test';
import { EPISTEMIC, createProvenance, isValidProvenance } from './provenance.js';

// I3a minimal primitive — 10 items per spec

test('provenance primitive: valid REPORTED requires sourceId and receivedAtMs', () => {
  const prov = createProvenance({
    epistemic: 'reported',
    sourceId: 'opensky',
    reportedAtMs: 1700000000000,
    receivedAtMs: 1700000005000,
  });
  assert.equal(prov.epistemic, 'reported');
  assert.equal(prov.sourceId, 'opensky');
  assert.equal(prov.reportedAtMs, 1700000000000);
  assert.equal(prov.receivedAtMs, 1700000005000);
  assert.ok(Object.isFrozen(prov));
});

test('provenance primitive: REPORTED requires sourceId non-empty', () => {
  assert.throws(() => createProvenance({
    epistemic: 'reported',
    sourceId: '',
    reportedAtMs: 1,
    receivedAtMs: 2,
  }));
  assert.throws(() => createProvenance({
    epistemic: 'reported',
    sourceId: '   ',
    reportedAtMs: 1,
    receivedAtMs: 2,
  }));
  assert.throws(() => createProvenance({
    epistemic: 'reported',
    sourceId: null,
    reportedAtMs: 1,
    receivedAtMs: 2,
  }));
});

test('provenance primitive: REPORTED requires receivedAtMs finite >0', () => {
  assert.throws(() => createProvenance({
    epistemic: 'reported',
    sourceId: 'opensky',
    reportedAtMs: 1,
    receivedAtMs: null,
  }));
  assert.throws(() => createProvenance({
    epistemic: 'reported',
    sourceId: 'opensky',
    reportedAtMs: 1,
    receivedAtMs: 0,
  }));
  assert.throws(() => createProvenance({
    epistemic: 'reported',
    sourceId: 'opensky',
    reportedAtMs: 1,
    receivedAtMs: NaN,
  }));
});

test('provenance primitive: reportedAtMs optional null allowed', () => {
  const withNull = createProvenance({
    epistemic: 'reported',
    sourceId: 'opensky',
    reportedAtMs: null,
    receivedAtMs: 123,
  });
  assert.equal(withNull.reportedAtMs, null);
  const without = createProvenance({
    epistemic: 'reported',
    sourceId: 'opensky',
    receivedAtMs: 123,
  });
  assert.equal(without.reportedAtMs, null);
  const withValue = createProvenance({
    epistemic: 'reported',
    sourceId: 'opensky',
    reportedAtMs: 1700000000000,
    receivedAtMs: 123,
  });
  assert.equal(withValue.reportedAtMs, 1700000000000);
});

test('provenance primitive: unsupported epistemic rejected', () => {
  assert.throws(() => createProvenance({
    epistemic: 'predicted',
    sourceId: 'opensky',
    receivedAtMs: 1,
  }));
  assert.throws(() => createProvenance({
    epistemic: 'observed',
    sourceId: 'opensky',
    receivedAtMs: 1,
  }));
  assert.throws(() => createProvenance({
    epistemic: 'simulated',
    sourceId: 'opensky',
    receivedAtMs: 1,
  }));
  assert.throws(() => createProvenance({
    epistemic: 'unknown',
    sourceId: 'opensky',
    receivedAtMs: 1,
  }));
  assert.throws(() => createProvenance({
    epistemic: '',
    sourceId: 'opensky',
    receivedAtMs: 1,
  }));
  assert.throws(() => createProvenance({
    epistemic: null,
    sourceId: 'opensky',
    receivedAtMs: 1,
  }));
});

test('provenance primitive: sourceId non-empty trimmed no whitespace 1..128 ^[a-z0-9._:-]+$', () => {
  // valid
  createProvenance({ epistemic: 'reported', sourceId: 'opensky', receivedAtMs: 1 });
  createProvenance({ epistemic: 'reported', sourceId: 'adsb.lol', receivedAtMs: 1 });
  createProvenance({ epistemic: 'reported', sourceId: 'my-source_1:2', receivedAtMs: 1 });
  // invalid
  assert.throws(() => createProvenance({ epistemic: 'reported', sourceId: 'OpenSky', receivedAtMs: 1 }));
  assert.throws(() => createProvenance({ epistemic: 'reported', sourceId: 'open sky', receivedAtMs: 1 }));
  assert.throws(() => createProvenance({ epistemic: 'reported', sourceId: 'a b', receivedAtMs: 1 }));
  assert.throws(() => createProvenance({ epistemic: 'reported', sourceId: 'a\nb', receivedAtMs: 1 }));
  assert.throws(() => createProvenance({ epistemic: 'reported', sourceId: 'a'.repeat(129), receivedAtMs: 1 }));
});

test('provenance primitive: no implicit age/fresh/confidence/history/observationId/storeId', () => {
  const prov = createProvenance({
    epistemic: 'reported',
    sourceId: 'opensky',
    reportedAtMs: 1,
    receivedAtMs: 2,
  });
  assert.equal(prov.ageMs, undefined);
  assert.equal(prov.freshness, undefined);
  assert.equal(prov.fresh, undefined);
  assert.equal(prov.stale, undefined);
  assert.equal(prov.confidence, undefined);
  assert.equal(prov.quality, undefined);
  assert.equal(prov.history, undefined);
  assert.equal(prov.observationId, undefined);
  assert.equal(prov.storeId, undefined);
  assert.equal(Object.keys(prov).includes('ageMs'), false);
  assert.equal(Object.keys(prov).includes('confidence'), false);
});

test('provenance primitive: input mutation safe', () => {
  const input = {
    epistemic: 'reported',
    sourceId: 'opensky',
    reportedAtMs: 1,
    receivedAtMs: 2,
  };
  const prov = createProvenance(input);
  input.sourceId = 'tampered';
  input.reportedAtMs = 999;
  assert.equal(prov.sourceId, 'opensky');
  assert.equal(prov.reportedAtMs, 1);
});

test('provenance primitive: no registry, no observation ID — only epistemic set + sourceId string', () => {
  // No global registry imported, no PROVIDER_ID enum
  const prov1 = createProvenance({ epistemic: 'reported', sourceId: 'custom-source', receivedAtMs: 1 });
  assert.equal(prov1.sourceId, 'custom-source');
  const prov2 = createProvenance({ epistemic: 'derived', via: 'classification' });
  assert.equal(prov2.epistemic, 'derived');
  // derived/modeled/interpreted do not require receivedAtMs? Actually spec says REPORTED requires, others not necessarily — check implementation
  // Our implementation requires receivedAtMs only for REPORTED, which matches I3a
  assert.equal(prov2.receivedAtMs, null);
  assert.equal(prov2.via, 'classification');
  // via optional for REPORTED, required for DERIVED in I3b
  const prov3 = createProvenance({ epistemic: 'derived', via: 'render-altitude-selection' });
  assert.equal(prov3.via, 'render-altitude-selection');
});

test('provenance primitive: EPISTEMIC frozen 4 values only', () => {
  assert.deepEqual(Object.keys(EPISTEMIC).sort(), ['DERIVED', 'INTERPRETED', 'MODELED', 'REPORTED']);
  assert.equal(EPISTEMIC.REPORTED, 'reported');
  assert.equal(EPISTEMIC.DERIVED, 'derived');
  assert.equal(EPISTEMIC.MODELED, 'modeled');
  assert.equal(EPISTEMIC.INTERPRETED, 'interpreted');
  assert.ok(Object.isFrozen(EPISTEMIC));
  assert.throws(() => { EPISTEMIC.REPORTED = 'tampered'; });
});

test('provenance primitive: isValidProvenance helper', () => {
  const good = createProvenance({ epistemic: 'reported', sourceId: 'opensky', reportedAtMs: 1, receivedAtMs: 2 });
  assert.equal(isValidProvenance(good), true);
  assert.equal(isValidProvenance({ epistemic: 'reported', sourceId: 'opensky', reportedAtMs: 1, receivedAtMs: 2 }), true);
  assert.equal(isValidProvenance({ epistemic: 'reported', sourceId: '', receivedAtMs: 2 }), false);
  assert.equal(isValidProvenance({ epistemic: 'observed', sourceId: 'opensky', receivedAtMs: 2 }), false);
  assert.equal(isValidProvenance(null), false);
});
