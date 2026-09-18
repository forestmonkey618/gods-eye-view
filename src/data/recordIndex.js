/**
 * I2c — Canonical Current-State Record Index — Aircraft only.
 *
 * Purpose: smallest deterministic current-state index that answers:
 * 1. Which canonical aircraft entities are currently represented?
 * 2. Given entityKey, which current store-owned records presently represent it?
 * 3. Enumerate current canonical entities deterministically/safely.
 *
 * NOT responsible for deciding which source observation is "truth".
 *
 * Conceptual model:
 * ONE CANONICAL ENTITY (aircraft:icao24:<id>) may have MULTIPLE CURRENT STORE-OWNED RECORDS:
 *   aircraft:icao24:abc123
 *     +-- current record from flights store
 *     +-- current record from military store
 *
 * These are NOT two canonical entities, NOT history, NOT trajectory, NOT provenance.
 * They are CURRENT records presently exposed by independent stores for same entity.
 *
 * Architecture:
 * - Zero-dependency, no Cesium, no DOM, no analystProviders, no UI, no lifecycle.
 * - Pull/current-snapshot model: rebuild fresh index from current accessors on demand.
 *   Old state cannot accidentally survive — strong no-history guarantee.
 * - Input contract: array of {storeId, records} where records are I2b normalized
 *   records {entityKey:string|null, icao24, lat, lon, altitudeM, callsign} primitive-only.
 * - Store origin is NOT entity identity. Kept OUTSIDE normalized record, known by adapter.
 * - Canonical-only: only records with valid entityKey enter index; entityKey:null excluded
 *   (TIS-B/non-ICAO remain available from I2b accessors but outside canonical index).
 * - No arbitrary winner: same entityKey from two stores → ONE canonical entry with TWO
 *   store-owned records. No Map iteration order, layer visibility, active state,
 *   timestamp, callsign completeness, coordinate completeness, provider preference
 *   used to choose best.
 * - Current-state only: rebuild from new input removes entities no longer present,
 *   removes store record that disappeared while preserving same entity from other store,
 *   no history retained, no DEPARTED/UPDATED events, no previous coordinates.
 * - No timestamp winner logic, no primaryRecord/bestRecord.
 * - Copy/mutation safety: inputs shallow-copied at build, outputs return fresh copies.
 *   Safe because I2b normalized record contract is primitive-only (string/number/null).
 *
 * Eligibility ownership:
 * - LAYER / ADAPTER determines whether its feed/store is actively current
 *   (e.g., via LayerLifecycle isEnabled / lifecycleState === 'enabled').
 * - RECORD INDEX indexes explicitly supplied eligible current records only.
 * - Index never infers feed freshness from payloads, never checks billboard.show,
 *   never imports lifecycle.js, never makes visibility epistemic authority.
 * - Disabled stores retain their FlightRecords.data Map as stale cache but stop
 *   ingestion (interval cleared, refresh invalidated). Therefore
 *   getCurrentEntities() can expose retained disabled cache. Adapter must NOT pass
 *   disabled stores to buildRecordIndex if global-current index is desired.
 *
 * Store lifecycle (traced from actual code):
 * - flights.disable(): aborts active updates, hides collection show=false,
 *   releases models, clears tracking, removes handlers, clears intervalId.
 *   Does NOT clear records.data Map → retains stale cache.
 * - military.disable(): same — aborts active updates, hides show=false,
 *   releases models, clears tracking, sets militaryLayerActive false,
 *   removes preRender listeners, clears interval. Does NOT clear records.data.
 * - flights.destroy() / military.destroy() DO clear records.data.
 * - LayerLifecycle._runPeriodicUpdate only runs if entry.enabled && lifecycleState==='enabled'.
 *   So disabled = not ingesting, not refreshed.
 * - Rule generic: store-owned getCurrentEntities() represents store's retained
 *   current-record model, but eligibility to contribute to GLOBAL current index
 *   depends on whether that store is actively ingesting/current.
 *   Do not call retained disabled cache globally current.
 *
 * StoreId semantics:
 * - storeId means GEV current-record STORE ORIGIN (which FlightRecords instance
 *   currently owns the record), not provider, not provenance, not entity type,
 *   not layer identity baked into entityKey, not source reliability.
 * - Example: flights store itself contains observations merged from OpenSky + adsb.lol
 *   via sticky merge — provider is observation identity (I3), storeId is current-record
 *   store origin (I2). Military store similarly may contain multiple provider observations
 *   merged. Store origin ≠ provider provenance. I3 will later handle provider provenance.
 *
 * Input trust boundary:
 * - I2b accessors getCurrentEntities() are trusted normalized producers: they call
 *   aircraft() which validates 6-hex and returns canonical entityKey or null.
 * - Core index defensively validates canonical form aircraft:icao24:<6-hex lowercased>
 *   to fail safely on malformed like "banana" or "foo:bar" and to ensure only
 *   canonical aircraft keys enter. Validation is local to I2c (regex) to avoid
 *   duplicating full entityKey API, but mirrors I2a canonical rule.
 *
 * @module data/recordIndex
 */

// Bounded store identifiers for this checkpoint only — GEV current-record store origin.
// Not provider, not provenance, not entity type.
const VALID_STORE_IDS = new Set(['flights', 'military']);

// Canonical aircraft:icao24:<6-hex> validation — mirrors I2a authority aircraft().
// I2b is trusted producer, but we validate defensively to avoid "banana" entering index.
const ICAO24_HEX = /^[0-9a-f]{6}$/;
const CANONICAL_PREFIX = 'aircraft:icao24:';

function isValidEntityKey(key) {
  if (typeof key !== 'string') return false;
  if (!key.startsWith(CANONICAL_PREFIX)) return false;
  const suffix = key.slice(CANONICAL_PREFIX.length);
  return ICAO24_HEX.test(suffix);
}

function copyRecord(rec) {
  // I2b records are primitive-only: string/number/null. Shallow copy sufficient TODAY.
  // Documented as safe because normalized I2b contract is primitive-only.
  // Do NOT imply generic deep-clone safety for future nested records.
  if (!rec || typeof rec !== 'object') return null;
  return {
    entityKey: rec.entityKey ?? null,
    icao24: rec.icao24 ?? null,
    lat: Number.isFinite(rec.lat) ? rec.lat : rec.lat ?? null,
    lon: Number.isFinite(rec.lon) ? rec.lon : rec.lon ?? null,
    altitudeM: Number.isFinite(rec.altitudeM) ? rec.altitudeM : rec.altitudeM ?? null,
    callsign: rec.callsign ?? null,
  };
}

/**
 * Build a fresh canonical current-state record index from explicitly eligible
 * store-owned collections.
 *
 * Eligibility is owned by LAYER/ADAPTER: adapter determines whether its feed/store
 * is actively current (e.g., lifecycle enabled) and only passes eligible collections.
 * Index never infers freshness from payloads.
 *
 * @param {Array<{storeId: string, records: Array<Object>}>} collections
 *   Array of store collections. Each collection: {storeId: 'flights'|'military', records: I2b normalized array}
 *   Records with entityKey null or malformed are excluded from canonical index.
 * @returns {RecordIndex} Deterministic current-state index, no history
 */
export function buildRecordIndex(collections) {
  if (!Array.isArray(collections)) {
    throw new TypeError('collections must be an array');
  }

  // Internal Map: entityKey -> {entityKey, byStore: Map<storeId, record>}
  const internal = new Map();

  for (const collection of collections) {
    if (!collection || typeof collection !== 'object') continue;
    const storeId = collection.storeId;
    if (!VALID_STORE_IDS.has(storeId)) {
      throw new TypeError(`Invalid storeId: ${String(storeId)} — expected flights or military`);
    }
    const records = collection.records;
    if (!Array.isArray(records)) continue;

    for (const raw of records) {
      if (!raw || typeof raw !== 'object') continue;
      const entityKey = raw.entityKey;
      if (entityKey == null) continue; // canonical-only: exclude null (TIS-B/non-ICAO)
      if (!isValidEntityKey(entityKey)) continue; // fail-safe: malformed like "banana" excluded

      let entry = internal.get(entityKey);
      if (!entry) {
        entry = {
          entityKey,
          byStore: new Map(),
        };
        internal.set(entityKey, entry);
      }
      const copied = copyRecord(raw);
      if (!copied) continue;
      copied.entityKey = entityKey;
      entry.byStore.set(storeId, copied);
    }
  }

  const sortedKeys = [...internal.keys()].sort();

  function getEntryCopy(entityKey) {
    const entry = internal.get(entityKey);
    if (!entry) return undefined;
    const sortedStores = [...entry.byStore.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    const records = sortedStores.map(([storeId, rec]) => ({
      storeId,
      record: copyRecord(rec),
    }));
    return {
      entityKey: entry.entityKey,
      records,
    };
  }

  const api = {
    get(entityKey) {
      if (!isValidEntityKey(entityKey)) return undefined;
      return getEntryCopy(entityKey);
    },

    has(entityKey) {
      if (!isValidEntityKey(entityKey)) return false;
      return internal.has(entityKey);
    },

    get size() {
      return internal.size;
    },

    values() {
      const result = [];
      for (const key of sortedKeys) {
        const copy = getEntryCopy(key);
        if (copy) result.push(copy);
      }
      return result;
    },
  };

  return Object.freeze(api);
}
