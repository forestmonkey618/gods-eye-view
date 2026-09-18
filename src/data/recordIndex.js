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
 *   records {entityKey:string|null, icao24, lat, lon, altitudeM, callsign}.
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
 *
 * Store lifecycle — disabled military handling (traced):
 * - military.disable() does NOT clear MilitaryFlightRecords.data Map. It aborts active
 *   updates (controller abort), hides billboardCollection.show=false, releases models,
 *   clears tracking, sets militaryLayerActive false, removes preRender listeners,
 *   clears interval. So periodic updates stop (enabled false, interval cleared).
 *   Data Map remains as retained stale cache, not refreshed while disabled.
 * - flights.disable() similarly retains its data Map but stops ingestion.
 * - Therefore military.getCurrentEntities() WOULD return retained stale cache while
 *   disabled if it only checks data Map size (current implementation). That retained
 *   data is NOT current per lifecycle (not ingesting, not refreshed).
 * - Canonical index contents must NOT depend on whether layer is visible
 *   (billboardCollection.show), but must NOT count retained-but-unrefreshed cache as current.
 * - Narrowest way: adapter that calls getCurrentEntities() should filter by store
 *   active/ingesting status (enabled && lifecycleState enabled), not just visibility,
 *   BEFORE passing to buildRecordIndex. Core recordIndex itself is agnostic — it
 *   builds from whatever collections are passed. It does NOT import lifecycle or
 *   check show. Disabled-store exclusion is adapter responsibility.
 *
 * @module data/recordIndex
 */

import { aircraft as aircraftEntityKey } from './entityKey.js';

export const STORE_ID = Object.freeze({
  FLIGHTS: 'flights',
  MILITARY: 'military',
});

const VALID_STORE_IDS = new Set([STORE_ID.FLIGHTS, STORE_ID.MILITARY]);

function isValidEntityKey(key) {
  // I2a canonical: aircraft:icao24:<6-hex>. For I2c we accept any non-empty string
  // that is a valid canonical key per I2a authority, but we also allow future
  // extension to check via aircraftEntityKey? Simplest: non-null string and
  // aircraftEntityKey validation via parsing? Since I2b already produces
  // canonical keys via aircraft(), we can trust non-null string, but also
  // verify it is not empty and contains ':'.
  // To be safe, we check that aircraft() of extracted icao24 would reproduce?
  // For minimal, we accept any non-null string that is not empty and passes
  // basic shape aircraft:icao24:<6-hex> — but we already have entityKey null
  // excluded, so we just check truthy string.
  // Additionally, we ensure it is not TIS-B: entityKey null already excluded.
  return typeof key === 'string' && key.length > 0 && key.includes(':');
}

function copyRecord(rec) {
  // I2b records contain primitives only, but copy defensively
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
 * Build a fresh canonical current-state record index from store-owned collections.
 *
 * @param {Array<{storeId: string, records: Array<Object>}>} collections
 *   Array of store collections. Each collection: {storeId: 'flights'|'military', records: I2b normalized array}
 *   Records with entityKey null are excluded from canonical index.
 * @returns {RecordIndex} Deterministic current-state index, no history
 */
export function buildRecordIndex(collections) {
  if (!Array.isArray(collections)) {
    throw new TypeError('collections must be an array');
  }

  // Internal Map: entityKey -> {entityKey, records: Map<storeId, record>}
  // Use inner Map per entity to enforce at most one per store per entityKey
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
      if (!isValidEntityKey(entityKey)) continue; // fail-safe

      // At most one per store per entityKey — last wins within same store if duplicate input
      // (deterministic, documented, store semantics guarantee at most one normally)
      let entry = internal.get(entityKey);
      if (!entry) {
        entry = {
          entityKey,
          // storeId -> record (shallow copy)
          byStore: new Map(),
        };
        internal.set(entityKey, entry);
      }
      const copied = copyRecord(raw);
      if (!copied) continue;
      // Ensure copied entityKey matches entry key (defensive)
      copied.entityKey = entityKey;
      entry.byStore.set(storeId, copied);
    }
  }

  // Build deterministic sorted list of entityKeys for enumeration
  // At ~11k, sorting O(n log n) once at build time is acceptable, on-demand not per-frame
  const sortedKeys = [...internal.keys()].sort();

  // For public API, we need to return copies, not internal Maps
  function getEntryCopy(entityKey) {
    const entry = internal.get(entityKey);
    if (!entry) return undefined;
    // Deterministic store ordering: alphabetical storeId (flights before military)
    const sortedStores = [...entry.byStore.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    const records = sortedStores.map(([storeId, rec]) => ({
      storeId,
      record: copyRecord(rec),
    }));
    return {
      entityKey: entry.entityKey,
      records, // array of {storeId, record}
    };
  }

  const api = {
    /**
     * Get canonical entry for entityKey, or undefined if not present.
     * Returns fresh copy — mutating result does not corrupt index.
     * @param {string} entityKey
     * @returns {{entityKey: string, records: Array<{storeId: string, record: Object}>}|undefined}
     */
    get(entityKey) {
      if (!isValidEntityKey(entityKey)) return undefined;
      return getEntryCopy(entityKey);
    },

    /**
     * Whether canonical index contains entityKey.
     * @param {string} entityKey
     * @returns {boolean}
     */
    has(entityKey) {
      if (!isValidEntityKey(entityKey)) return false;
      return internal.has(entityKey);
    },

    /** Number of canonical entities currently represented */
    get size() {
      return internal.size;
    },

    /**
     * Enumerate canonical entities deterministically (sorted by entityKey ascending).
     * Each entry is fresh copy with deterministic store ordering (flights before military).
     * @returns {Array<{entityKey: string, records: Array<{storeId: string, record: Object}>}>}
     */
    values() {
      const result = [];
      for (const key of sortedKeys) {
        const copy = getEntryCopy(key);
        if (copy) result.push(copy);
      }
      return result;
    },

    /**
     * For debugging/testing: list all entityKeys sorted.
     * @returns {Array<string>}
     */
    keys() {
      return [...sortedKeys];
    },

    /**
     * Internal: for adapter to know storeIds that contributed (not part of canonical truth)
     * @returns {Array<string>} sorted storeIds that had at least one valid record in input
     */
    _contributingStores() {
      const stores = new Set();
      for (const entry of internal.values()) {
        for (const sid of entry.byStore.keys()) stores.add(sid);
      }
      return [...stores].sort();
    },
  };

  return Object.freeze(api);
}

/**
 * Convenience: build from two I2b accessors (flights and military) that are already
 * filtered to be current (active/ingesting). Does NOT check layer visibility itself —
 * caller (adapter) must exclude disabled stores if their getCurrentEntities() would
 * return retained stale cache.
 *
 * @param {{flightsRecords?: Array<Object>, militaryRecords?: Array<Object>}} param
 * @returns {RecordIndex}
 */
export function buildAircraftRecordIndex({ flightsRecords = [], militaryRecords = [] } = {}) {
  const collections = [];
  if (Array.isArray(flightsRecords) && flightsRecords.length > 0) {
    collections.push({ storeId: STORE_ID.FLIGHTS, records: flightsRecords });
  } else if (Array.isArray(flightsRecords)) {
    // Include empty to allow rebuild removing entities — but if empty, we still
    // want to represent that flights contributed zero? For rebuild semantics,
    // we should include empty collections only if we want to signal store present
    // but zero records. Simpler: only push if array provided, even if empty,
    // to allow explicit empty to clear. We'll push empty if explicitly passed as array.
    collections.push({ storeId: STORE_ID.FLIGHTS, records: [] });
  }
  if (Array.isArray(militaryRecords) && militaryRecords.length > 0) {
    collections.push({ storeId: STORE_ID.MILITARY, records: militaryRecords });
  } else if (Array.isArray(militaryRecords)) {
    collections.push({ storeId: STORE_ID.MILITARY, records: [] });
  }
  return buildRecordIndex(collections);
}
