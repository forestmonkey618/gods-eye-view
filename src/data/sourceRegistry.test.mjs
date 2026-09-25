import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createSourceRegistry,
  getSourceDescriptor,
  isRegisteredSource,
  listSourceDescriptors,
} from './sourceRegistry.js';
import { EPISTEMIC, createProvenance, isValidProvenance } from './provenance.js';
import { REGISTERED_LAYER_IDS } from './layerState.js';

// I4a — canonical Source Registry. The suite itself runs in plain Node with no
// DOM, no Cesium and no network, so every test below is also evidence that the
// registry is independent of rendering and platform globals.

const PRODUCTION_SOURCE_IDS = Object.freeze([
  'adsb.lol',
  'adsbdb',
  'aisstream',
  'opensky',
]);

test('registry: every current production sourceId resolves with truthful identity', () => {
  const expectedNames = {
    'adsb.lol': 'adsb.lol',
    adsbdb: 'adsbdb',
    aisstream: 'AISStream.io',
    opensky: 'OpenSky Network',
  };
  for (const sourceId of PRODUCTION_SOURCE_IDS) {
    const descriptor = getSourceDescriptor(sourceId);
    assert.ok(descriptor, `expected ${sourceId} to resolve`);
    assert.equal(descriptor.sourceId, sourceId);
    assert.equal(descriptor.name, expectedNames[sourceId]);
    assert.equal(isRegisteredSource(sourceId), true);
    assert.ok(Object.isFrozen(descriptor));
  }
  // Completeness is asserted, not assumed: exactly the audited production set.
  assert.deepEqual(
    listSourceDescriptors().map((d) => d.sourceId),
    [...PRODUCTION_SOURCE_IDS],
  );
});

test('registry: unestablished licenses stay absent — policy prose is not a license', () => {
  // Owner-review rule: `license` carries an actual established license only.
  // Descriptive/legal-policy prose (e.g. AISStream's documented "Free, beta,
  // no formal ToS; AIS is a public broadcast") is documentation context, not a
  // license value — it must never come back as `license`, and the schema is
  // never broadened with a `terms`/`notes` field to smuggle it in.
  const aisstream = getSourceDescriptor('aisstream');
  assert.ok(!('license' in aisstream), 'AISStream has no formal license');
  const adsbdb = getSourceDescriptor('adsbdb');
  assert.ok(!('license' in adsbdb), 'adsbdb license is not established');
  for (const descriptor of listSourceDescriptors()) {
    for (const key of ['terms', 'notes', 'note', 'comment', 'policy']) {
      assert.ok(!(key in descriptor), `${key} must not exist in descriptors`);
    }
  }
  // Established licenses, conversely, remain — absence is not blanket.
  assert.equal(getSourceDescriptor('adsb.lol').license, 'ODbL 1.0');
  assert.equal(
    getSourceDescriptor('opensky').license,
    'Non-commercial research/education license',
  );
});

test('registry: unknown source IDs do not magically become registered', () => {
  for (const unknown of [
    'definitely-not-a-source',
    'opensky ', // exact match only — no silent aliasing/normalization
    'OpenSky',
    'opensky-network',
    'mbta', // a transit feed id is not a provenance sourceId
  ]) {
    assert.equal(getSourceDescriptor(unknown), null, unknown);
    assert.equal(isRegisteredSource(unknown), false, unknown);
  }
  for (const notAString of [undefined, null, 42, {}, [], Symbol.iterator]) {
    assert.equal(getSourceDescriptor(notAString), null);
    assert.equal(isRegisteredSource(notAString), false);
  }
});

test('registry: lookup never mutates descriptors and returned state is frozen', () => {
  const first = getSourceDescriptor('opensky');
  const second = getSourceDescriptor('opensky');
  assert.deepEqual(first, second);
  assert.ok(Object.isFrozen(first));
  assert.ok(Object.isFrozen(second));
  assert.ok(Object.isFrozen(listSourceDescriptors()));
  for (const descriptor of listSourceDescriptors()) {
    assert.ok(Object.isFrozen(descriptor));
  }
});

test('registry: consumer mutation cannot mutate canonical registry state', () => {
  const registry = createSourceRegistry([
    { sourceId: 'fixture-immutable', name: 'Fixture' },
  ]);
  const descriptor = registry.getSourceDescriptor('fixture-immutable');
  assert.throws(() => {
    descriptor.name = 'hacked';
  }, TypeError);
  assert.throws(() => {
    descriptor.injected = true;
  }, TypeError);
  assert.equal(registry.getSourceDescriptor('fixture-immutable').name, 'Fixture');

  const list = registry.listSourceDescriptors();
  assert.throws(() => {
    list.push({ sourceId: 'injected', name: 'Injected' });
  }, TypeError);
  assert.throws(() => {
    list[0] = { sourceId: 'injected', name: 'Injected' };
  }, TypeError);
  assert.equal(registry.listSourceDescriptors().length, 1);

  // Caller-side entry objects are copied, never retained or mutated.
  const entry = { sourceId: 'fixture-copied', name: 'Original' };
  const copied = createSourceRegistry([entry]);
  entry.name = 'Mutated later';
  entry.extra = 'leak';
  assert.equal(copied.getSourceDescriptor('fixture-copied').name, 'Original');
  assert.deepEqual(Object.keys(copied.getSourceDescriptor('fixture-copied')), [
    'sourceId',
    'name',
  ]);
});

test('registry: enumeration is deterministic and sorted by sourceId', () => {
  assert.deepEqual(
    listSourceDescriptors(),
    listSourceDescriptors(),
    'repeated enumeration must be identical',
  );
  const fixture = createSourceRegistry([
    { sourceId: 'zulu', name: 'Zulu' },
    { sourceId: 'alpha', name: 'Alpha' },
    { sourceId: 'mike', name: 'Mike' },
  ]);
  const first = fixture.listSourceDescriptors().map((d) => d.sourceId);
  const second = fixture.listSourceDescriptors().map((d) => d.sourceId);
  assert.deepEqual(first, ['alpha', 'mike', 'zulu']);
  assert.deepEqual(second, first, 'order must not depend on call timing');
  assert.deepEqual(
    fixture.listSourceDescriptors(),
    fixture.listSourceDescriptors(),
  );
});

test('registry: duplicate source IDs cannot silently overwrite one another', () => {
  assert.throws(
    () =>
      createSourceRegistry([
        { sourceId: 'dup', name: 'First' },
        { sourceId: 'dup', name: 'Second' },
      ]),
    /duplicate sourceId: dup/,
  );
  assert.throws(
    () =>
      createSourceRegistry([
        { sourceId: 'dup', name: 'First' },
        { sourceId: '  dup  ', name: 'Second' }, // normalizes to the same id
      ]),
    /duplicate sourceId/,
  );
  // The failure is loud: nothing half-built is handed back to a consumer.
});

test('registry: production registry is independent of the wall clock', async () => {
  const realNow = Date.now;
  Date.now = () => {
    throw new Error('source registry read the wall clock');
  };
  try {
    // Fresh module instance (URL query bypasses the ESM cache) so module-init
    // code runs under the poisoned clock too — not just the accessors.
    const fresh = await import('./sourceRegistry.js?clock-freeze-test');
    assert.equal(fresh.getSourceDescriptor('opensky').name, 'OpenSky Network');
    assert.equal(fresh.isRegisteredSource('aisstream'), true);
    assert.deepEqual(
      fresh.listSourceDescriptors().map((d) => d.sourceId),
      [...PRODUCTION_SOURCE_IDS],
    );
    const fixture = fresh.createSourceRegistry([
      { sourceId: 'fixture-clock', name: 'Fixture' },
    ]);
    assert.equal(fixture.getSourceDescriptor('fixture-clock').name, 'Fixture');
  } finally {
    Date.now = realNow;
  }
});

test('registry: descriptors are independent of credentials/environment', async () => {
  const before = listSourceDescriptors();
  const saved = {};
  const poisoned = {
    AISSTREAM_API_KEY: 'fixture-secret',
    OPENSKY_CLIENT_ID: 'fixture-secret',
    OPENSKY_CLIENT_SECRET: 'fixture-secret',
    TOMTOM_API_KEY: 'fixture-secret',
  };
  try {
    for (const [key, value] of Object.entries(poisoned)) {
      saved[key] = process.env[key];
      process.env[key] = value;
    }
    const fresh = await import('./sourceRegistry.js?env-poison-test');
    assert.deepEqual(fresh.listSourceDescriptors(), before);
    // Source existence never depends on credential availability: aisstream is
    // registered even though its key is (or is not) configured, and no
    // descriptor field mentions credentials.
    assert.equal(fresh.isRegisteredSource('aisstream'), true);
    for (const descriptor of fresh.listSourceDescriptors()) {
      for (const key of Object.keys(descriptor)) {
        assert.ok(
          !/key|token|secret|credential/i.test(key),
          `credential-shaped key leaked into descriptor: ${key}`,
        );
      }
    }
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('registry: descriptors carry no lifecycle state (enabled/disabled/visible)', () => {
  const allowed = new Set([
    'sourceId',
    'name',
    'homeUrl',
    'license',
    'licenseUrl',
    'attribution',
  ]);
  const lifecycleOrFreshness = new Set([
    'enabled',
    'disabled',
    'eligible',
    'visible',
    'active',
    'loaded',
    'status',
    'show',
    'age',
    'ageMs',
    'stale',
    'fresh',
    'freshness',
    'lastFetch',
    'lastAttempt',
    'lastUpdate',
    'latency',
    'retry',
    'error',
    'coverage',
  ]);
  for (const descriptor of listSourceDescriptors()) {
    for (const key of Object.keys(descriptor)) {
      assert.ok(allowed.has(key), `unexpected descriptor key: ${key}`);
      assert.ok(
        !lifecycleOrFreshness.has(key),
        `lifecycle/freshness key leaked into descriptor: ${key}`,
      );
    }
  }
  // Registration is existence only — it asserts nothing about a layer being
  // enabled. The builder rejects such state outright, fixture-proven:
  assert.throws(
    () => createSourceRegistry([{ sourceId: 'x', name: 'X', enabled: true }]),
    /unknown descriptor key/,
  );
  assert.throws(
    () => createSourceRegistry([{ sourceId: 'x', name: 'X', status: 'up' }]),
    /unknown descriptor key/,
  );
});

test('registry: descriptors carry no rendering-visibility state', () => {
  for (const descriptor of listSourceDescriptors()) {
    for (const key of ['show', 'visible', 'visibility', 'rendered']) {
      assert.ok(!(key in descriptor), `${key} must not appear in descriptors`);
    }
  }
  assert.throws(
    () => createSourceRegistry([{ sourceId: 'x', name: 'X', show: true }]),
    /unknown descriptor key/,
  );
});

test('registry: source IDs are a distinct namespace from layer IDs and storeIds', () => {
  // Layer ids (LAYER_STATE_REGISTRY) must never resolve as sources …
  for (const layerId of REGISTERED_LAYER_IDS) {
    assert.equal(
      isRegisteredSource(layerId),
      false,
      `layer id must not be a sourceId: ${layerId}`,
    );
  }
  // … and representative record-store ids must not either (store ownership is
  // I2's concern; a store is not an external origin).
  for (const storeId of ['flights', 'military', 'vessels', 'ais-live-vessels']) {
    assert.equal(isRegisteredSource(storeId), false, storeId);
  }
  // Conversely, no production sourceId is a layer id.
  for (const sourceId of PRODUCTION_SOURCE_IDS) {
    assert.ok(!REGISTERED_LAYER_IDS.includes(sourceId), sourceId);
  }
});

test('registry: one store can truthfully use multiple registered sources', () => {
  // The civil flights store draws current values from three external sources
  // (OpenSky snapshots, adsb.lol fallback, adsbdb enrichment) and the vessels
  // store from a fourth. All must be representable at once, as distinct
  // identities, with no descriptor claiming store ownership — the registry
  // exposes no store/layer binding keys at all (asserted above), so one store
  // referencing several sources can never be contradicted by registry data.
  const flightsSources = ['opensky', 'adsb.lol', 'adsbdb'].map(
    getSourceDescriptor,
  );
  const vesselsSource = getSourceDescriptor('aisstream');
  for (const descriptor of [...flightsSources, vesselsSource]) {
    assert.ok(descriptor);
  }
  assert.equal(new Set(flightsSources.map((d) => d.sourceId)).size, 3);
  for (const descriptor of [...flightsSources, vesselsSource]) {
    assert.ok(!('storeId' in descriptor));
    assert.ok(!('layerId' in descriptor));
  }
});

test('registry: builder accepts only well-formed static descriptors', () => {
  assert.throws(() => createSourceRegistry('nope'), TypeError);
  assert.throws(() => createSourceRegistry([null]), TypeError);
  assert.throws(() => createSourceRegistry([{ name: 'No id' }]), TypeError);
  assert.throws(
    () => createSourceRegistry([{ sourceId: 'x', name: '' }]),
    TypeError,
  );
  assert.throws(
    () => createSourceRegistry([{ sourceId: 'not a machine id', name: 'X' }]),
    TypeError,
  );
  assert.throws(
    () => createSourceRegistry([{ sourceId: 'Label Injection', name: 'X' }]),
    TypeError,
  );
  assert.throws(
    () => createSourceRegistry([{ sourceId: 'x', name: 'X', homeUrl: '' }]),
    TypeError,
  );
  assert.equal(createSourceRegistry([]).isRegisteredSource('anything'), false);
});

test('registry: fixture-only source IDs stay out of the production registry', () => {
  const fixture = createSourceRegistry([
    { sourceId: 'fixture-only-source', name: 'Fixture provider' },
  ]);
  assert.equal(
    fixture.getSourceDescriptor('fixture-only-source').name,
    'Fixture provider',
  );
  // …while the canonical registry keeps saying the honest thing: unknown.
  assert.equal(getSourceDescriptor('fixture-only-source'), null);
  assert.equal(isRegisteredSource('fixture-only-source'), false);
});

test('registry: I3 provenance semantics stay unchanged and membership-free', () => {
  // Registry membership is a QUERY-boundary concern only: createProvenance
  // keeps accepting well-grammatical sourceIds it cannot resolve, so unknown
  // and future sources remain representable at ingestion.
  const unknownButValid = createProvenance({
    epistemic: EPISTEMIC.REPORTED,
    sourceId: 'future-source-42',
    reportedAtMs: 1700000000000,
    receivedAtMs: 1700000005000,
  });
  assert.equal(isRegisteredSource('future-source-42'), false);
  assert.equal(unknownButValid.sourceId, 'future-source-42');
  assert.ok(isValidProvenance(unknownButValid));

  // A registered id behaves exactly the same — the I3 five-key shape carries
  // no registry object and no registry-derived fields.
  const reported = createProvenance({
    epistemic: EPISTEMIC.REPORTED,
    sourceId: 'opensky',
    reportedAtMs: 1700000000000,
    receivedAtMs: 1700000005000,
  });
  assert.deepEqual(Object.keys(reported), [
    'epistemic',
    'sourceId',
    'reportedAtMs',
    'receivedAtMs',
    'via',
  ]);
  assert.ok(isValidProvenance(reported));

  // DERIVED values still require no sourceId and gain no registry coupling.
  const derived = createProvenance({ epistemic: EPISTEMIC.DERIVED, via: 'classification' });
  assert.equal(derived.sourceId, null);
  assert.ok(isValidProvenance(derived));

  // Resolution never writes back into provenance: lookups around descriptor
  // construction change nothing.
  assert.equal(getSourceDescriptor(reported.sourceId).name, 'OpenSky Network');
  assert.deepEqual(Object.keys(reported), [
    'epistemic',
    'sourceId',
    'reportedAtMs',
    'receivedAtMs',
    'via',
  ]);
});
