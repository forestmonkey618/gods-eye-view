/**
 * I4a — canonical Source Registry: static external-source identity and
 * description.
 *
 * Zero-dependency leaf: no imports at all. No Cesium, no DOM, no network, no
 * wall clock, no credentials. Deterministic and immutable from the consumer
 * side.
 *
 * It answers exactly one question:
 *
 *   "What known external source does this stable sourceId refer to?"
 *
 * It is deliberately NOT any of these (each stays owned elsewhere):
 * - provenance ("this value came from sourceId X") — `provenance.js` (I3);
 *   its constructor does not consult this registry and unknown/future
 *   sourceIds remain representable at ingestion boundaries. This registry only
 *   resolves what a known id MEANS when a consumer asks.
 * - freshness / runtime state (age, stale/fresh, last fetch/attempt/update,
 *   status, errors, latency, retry) — `feedState.js` (I5).
 * - lifecycle state (enabled/disabled/eligible/visible/layer-active/loaded) —
 *   `lifecycle.js` / `layerState.js`. Registration says a source EXISTS, not
 *   that any layer or feed using it is currently enabled.
 * - dynamic coverage / AOI computation (I5+).
 * - credential/configuration material or availability. Source existence never
 *   depends on whether an API key happens to be configured.
 * - attribution rendering — `dataCredits.js` owns the Cesium credit display.
 * - per-feed specializations (e.g. `transitFeeds.js` TRANSIT_FEED_REGISTRY).
 * - UI state and source-selection logic.
 *
 * The registry key is the stable machine identity of an EXTERNAL origin — the
 * exact `sourceId` string provenance records. It is not a GEV `storeId`
 * (store ownership), not a layer id (LAYER_STATE_REGISTRY), not a display
 * label, and never a URL. One store may truthfully carry data from several
 * registered sources (the civil flights store already draws from `opensky`,
 * `adsb.lol` and `adsbdb`), so entries carry no store binding of any kind.
 *
 * Unknown metadata stays ABSENT (missing key), never guessed and never
 * back-filled to make entries symmetrical.
 *
 * @module data/sourceRegistry
 */

/**
 * Registry-key grammar. Mirrors `provenance.js`'s sourceId grammar exactly
 * (that file owns the grammar; `scripts/check-source-registry-authority.mjs`
 * freezes the two literals against drift): 1–128 trimmed chars of
 * `[a-z0-9._:-]`, no whitespace.
 */
const SOURCE_ID_PATTERN = /^[a-z0-9._:-]+$/;
const MAX_SOURCE_ID_LENGTH = 128;

/** The ONLY keys a descriptor may carry — static identity/description. */
const DESCRIPTOR_KEYS = Object.freeze([
  'sourceId',
  'name',
  'homeUrl',
  'license',
  'licenseUrl',
  'attribution',
]);

/** Optional description keys, absent when not established. */
const OPTIONAL_KEYS = Object.freeze([
  'homeUrl',
  'license',
  'licenseUrl',
  'attribution',
]);

function normalizeSourceId(sourceId) {
  if (typeof sourceId !== 'string')
    throw new TypeError('sourceId must be string');
  const trimmed = sourceId.trim();
  if (!trimmed) throw new TypeError('sourceId cannot be empty');
  if (trimmed.length > MAX_SOURCE_ID_LENGTH)
    throw new TypeError('sourceId too long');
  if (/\s/.test(trimmed))
    throw new TypeError('sourceId must not contain whitespace');
  if (!SOURCE_ID_PATTERN.test(trimmed)) {
    throw new TypeError(`sourceId has invalid characters: ${trimmed}`);
  }
  return trimmed;
}

function normalizeName(name) {
  if (typeof name !== 'string') throw new TypeError('name must be string');
  const trimmed = name.trim();
  if (!trimmed) throw new TypeError('name cannot be empty');
  return trimmed;
}

function normalizeOptionalString(value, key) {
  if (value == null) return null;
  if (typeof value !== 'string') throw new TypeError(`${key} must be string`);
  const trimmed = value.trim();
  if (!trimmed) throw new TypeError(`${key} cannot be empty`);
  return trimmed;
}

/**
 * Copy one entry into a canonical frozen-shape descriptor. The input object is
 * never mutated; unknown keys throw so runtime/freshness/lifecycle/credential
 * state can never leak into a descriptor.
 */
function normalizeDescriptor(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    throw new TypeError('registry entry must be an object');
  }
  for (const key of Object.keys(entry)) {
    if (!DESCRIPTOR_KEYS.includes(key)) {
      throw new TypeError(`unknown descriptor key: ${key}`);
    }
  }
  const descriptor = {
    sourceId: normalizeSourceId(entry.sourceId),
    name: normalizeName(entry.name),
  };
  for (const key of OPTIONAL_KEYS) {
    const value = normalizeOptionalString(entry[key], key);
    if (value != null) descriptor[key] = value;
  }
  return descriptor;
}

/**
 * Build an immutable source registry. This is the ONLY construction path —
 * production entries are registered once below; tests may build fixture-only
 * registries (fixture ids never become production entries).
 *
 * Duplicate sourceIds throw — a second entry can never silently overwrite the
 * first. Malformed entries and unknown keys throw. The returned registry is
 * frozen and exposes no mutable internal state; every descriptor it returns is
 * frozen, and enumeration is deterministic (sorted by sourceId).
 *
 * @param {ReadonlyArray<Object>} entries - descriptors: required `sourceId`
 *   (provenance sourceId grammar) and `name`; optional `homeUrl`, `license`,
 *   `licenseUrl`, `attribution` (non-empty strings, omitted when unknown).
 * @returns {{getSourceDescriptor: (sourceId: string) => Object|null,
 *   isRegisteredSource: (sourceId: string) => boolean,
 *   listSourceDescriptors: () => ReadonlyArray<Object>}} frozen registry
 */
export function createSourceRegistry(entries) {
  if (!Array.isArray(entries))
    throw new TypeError('registry entries must be an array');
  const bySourceId = new Map();
  for (const entry of entries) {
    const descriptor = normalizeDescriptor(entry);
    if (bySourceId.has(descriptor.sourceId)) {
      throw new Error(`duplicate sourceId: ${descriptor.sourceId}`);
    }
    bySourceId.set(descriptor.sourceId, Object.freeze(descriptor));
  }
  const list = Object.freeze(
    [...bySourceId.values()].sort((a, b) =>
      a.sourceId < b.sourceId ? -1 : a.sourceId > b.sourceId ? 1 : 0,
    ),
  );
  // Exact key match only — no trimming, case-folding or aliasing at lookup:
  // two different strings are two different identities.
  const lookup = (sourceId) =>
    typeof sourceId === 'string' ? bySourceId.get(sourceId) || null : null;
  return Object.freeze({
    getSourceDescriptor: lookup,
    isRegisteredSource: (sourceId) => lookup(sourceId) !== null,
    listSourceDescriptors: () => list,
  });
}

/**
 * The canonical production entries. Registering a source means: current
 * production code really uses this exact sourceId as an external provenance
 * origin (verified against the adapters and record stores at registration
 * time). GEV store ids, layer ids, overlay-source ids, detection-declutter
 * ids, fixtures and retired names are deliberately NOT registered.
 *
 * Metadata facts are copied from repository configuration/documentation only
 * (`DATA_SOURCES.md`, `src/data/dataCredits.js`, server provider code) or
 * carefully verified; unknown facts stay absent rather than guessed. A
 * `license` value requires an established actual license — descriptive
 * terms/status/policy prose is documentation context (docs/SOURCE-REGISTRY.md),
 * never a canonical `license` value, and no `terms`/`notes` field exists to
 * carry it.
 */
const SOURCE_REGISTRY = createSourceRegistry([
  Object.freeze({
    // Military flights + bounded civil fallback + traces (readsb/adsb.lol).
    sourceId: 'adsb.lol',
    name: 'adsb.lol',
    homeUrl: 'https://adsb.lol',
    license: 'ODbL 1.0',
    licenseUrl: 'https://opendatacommons.org/licenses/odbl/1-0/',
    attribution: 'adsb.lol (ODbL)',
  }),
  Object.freeze({
    // Civil-flight enrichment: type/registration/airline/route lookups
    // (server/providers/aircraft/enrichment.js → api.adsbdb.com).
    sourceId: 'adsbdb',
    name: 'adsbdb',
    homeUrl: 'https://www.adsbdb.com',
    // license and attribution: NOT established anywhere in the repository's
    // data-source configuration or docs — intentionally absent (known gap,
    // see docs/SOURCE-REGISTRY.md).
  }),
  Object.freeze({
    // Live vessels (AIS) via AISStream (src/sources/live/vessels.js).
    sourceId: 'aisstream',
    name: 'AISStream.io',
    homeUrl: 'https://aisstream.io',
    // license: intentionally ABSENT — no formal license is established. The
    // DATA_SOURCES.md terms/status note ("Free, beta, no formal ToS; AIS is a
    // public broadcast") is descriptive policy prose, not a license value;
    // it is retained as documentation context (docs/SOURCE-REGISTRY.md) only.
    attribution: 'AISStream.io (courtesy)',
  }),
  Object.freeze({
    // Primary worldwide civil-flight snapshot (src/sources/live/standalone.js
    // primary path — server sets no X-Flight-Source header on this route).
    sourceId: 'opensky',
    name: 'OpenSky Network',
    homeUrl: 'https://opensky-network.org',
    license: 'Non-commercial research/education license',
    attribution:
      'Schäfer et al., "Bringing Up OpenSky", IPSN 2014 + opensky-network.org',
  }),
]);

/**
 * Get the frozen descriptor for a known external source, or `null` when the
 * sourceId is unknown (or not a string). Unknown ids never magically become
 * registered. Lookups are exact-match and never mutate registry state.
 *
 * @param {string} sourceId
 * @returns {Object|null} frozen descriptor {sourceId, name, …optional}
 */
export function getSourceDescriptor(sourceId) {
  return SOURCE_REGISTRY.getSourceDescriptor(sourceId);
}

/**
 * Test whether a sourceId is registered in the canonical registry.
 * @param {string} sourceId
 * @returns {boolean}
 */
export function isRegisteredSource(sourceId) {
  return SOURCE_REGISTRY.isRegisteredSource(sourceId);
}

/**
 * Enumerate every registered descriptor, deterministic order (sorted by
 * sourceId). The returned array and its descriptors are frozen.
 *
 * @returns {ReadonlyArray<Object>} frozen descriptors
 */
export function listSourceDescriptors() {
  return SOURCE_REGISTRY.listSourceDescriptors();
}
