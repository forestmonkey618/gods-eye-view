/**
 * I2c/I2d — Canonical Current-State Record Index — Aircraft + Vessels.
 *
 * Purpose: smallest deterministic current-state index that answers:
 * 1. Which canonical entities are currently represented?
 * 2. Given entityKey, which current store-owned records presently represent it?
 * 3. Enumerate current canonical entities deterministically/safely.
 *
 * NOT responsible for deciding which source observation is "truth".
 *
 * Conceptual model:
 * ONE CANONICAL ENTITY (aircraft:icao24:<id> or vessel:mmsi:<id>) may have
 * MULTIPLE CURRENT STORE-OWNED RECORDS:
 *   aircraft:icao24:abc123
 *     +-- current record from flights store
 *     +-- current record from military store
 *   vessel:mmsi:123456789
 *     +-- current record from vessels store
 *
 * These are NOT two canonical entities, NOT history, NOT trajectory, NOT provenance.
 * They are CURRENT records presently exposed by independent stores for same entity.
 *
 * Architecture:
 * - Zero-dependency, no Cesium, no DOM, no analystProviders, no UI, no lifecycle.
 * - Pull/current-snapshot model: rebuild fresh index from current accessors on demand.
 *   Old state cannot accidentally survive — strong no-history guarantee.
 * - Input contract: array of {storeId, records} where records are I2b/I2d normalized
 *   records {entityKey:string|null, ...primitive fields} primitive-only.
 * - Store origin is NOT entity identity. Kept OUTSIDE normalized record, known by adapter.
 * - Canonical-only: only records with valid entityKey enter index; entityKey:null excluded
 *   (TIS-B/non-ICAO, unkeyed vessels remain available from I2b/I2d accessors but outside canonical index).
 * - No arbitrary winner: same entityKey from two stores → ONE canonical entry with TWO
 *   store-owned records. No Map iteration order, layer visibility, active state,
 *   timestamp, callsign completeness, coordinate completeness, provider preference
 *   used to choose best.
 * - Current-state only: rebuild from new input removes entities no longer present,
 *   removes store record that disappeared while preserving same entity from other store,
 *   no history retained, no DEPARTED/UPDATED events, no previous coordinates.
 * - No timestamp winner logic, no primaryRecord/bestRecord.
 * - Copy/mutation safety: inputs shallow-copied at build, outputs return fresh copies.
 *   Safe because I2b/I2d normalized record contract is primitive-only (string/number/null/boolean).
 *
 * Eligibility ownership:
 * - LAYER / ADAPTER determines whether its feed/store is actively current
 *   (e.g., via LayerLifecycle isEnabled / lifecycleState === 'enabled').
 * - RECORD INDEX indexes explicitly supplied eligible current records only.
 * - Index never infers feed freshness from payloads, never checks billboard.show,
 *   never imports lifecycle.js, never makes visibility epistemic authority.
 * - Disabled stores retain their data Map as stale cache but stop ingestion.
 *   Therefore getCurrentEntities() can expose retained disabled cache. Adapter must NOT pass
 *   disabled stores to buildRecordIndex if global-current index is desired.
 *
 * Store lifecycle (traced from actual code):
 * - flights.disable(): aborts active updates, hides collection show=false,
 *   releases models, clears tracking, removes handlers, clears intervalId.
 *   Does NOT clear records.data Map → retains stale cache.
 * - military.disable(): same — aborts active updates, hides show=false,
 *   releases models, clears tracking, sets militaryLayerActive false,
 *   removes preRender listeners, clears interval. Does NOT clear records.data.
 * - vessels.disable(): sets enabled false, invalidates session, releases render,
 *   hides collection, clears overlay, clears inspection, destroys trail, aborts.
 *   Does NOT clear records.byMmsi Map or unkeyed — retains stale cache.
 * - flights.destroy() / military.destroy() / vessels resetState() DO clear records.
 * - Rule generic: store-owned getCurrentEntities() represents store's retained
 *   current-record model, but eligibility to contribute to GLOBAL current index
 *   depends on whether that store is actively ingesting/current.
 *   Do not call retained disabled cache globally current.
 *
 * StoreId semantics:
 * - storeId means GEV current-record STORE ORIGIN (which records instance
 *   currently owns the record), not provider, not provenance, not entity type,
 *   not layer identity baked into entityKey, not source reliability.
 * - Example: flights store = OpenSky with 250nm adsb.lol regional fallback when
 *   OpenSky stale/unavailable, labeled via X-Flight-Source header (server
 *   providers/aircraft/opensky.js serveAdsbLolPointFallback sets
 *   X-Flight-Source: adsb.lol). Sticky merge occurs across time within the
 *   store (callsign/velocity retention), not simultaneous cross-provider merge
 *   in same poll. Military store = adsb.lol. Provider is observation identity
 *   (I3 sourceId), storeId is GEV ownership (I2). Vessels store = AISStream
 *   observations. Store origin ≠ external source origin.
 * - vessels means GEV vessel current-record store, not AISStream provider identity.
 *
 * Input trust boundary:
 * - I2b/I2d accessors getCurrentEntities() are trusted normalized producers: they call
 *   aircraft() / vessel() which validate and return canonical entityKey or null.
 * - Core index defensively validates via entityKey.js isValid() to fail safely on
 *   malformed like "banana" and to ensure only canonical keys enter. Validation
 *   delegated to identity authority — recordIndex no longer knows ICAO24 or MMSI grammar.
 *
 * @module data/recordIndex
 */

import { isValid as isValidEntityKey } from './entityKey.js';

// Bounded store identifiers — GEV current-record STORE ORIGIN.
// Not provider, not provenance, not entity type.
const VALID_STORE_IDS = new Set(['flights', 'military', 'vessels']);

function copyRecord(rec) {
  // I2b/I2d records are primitive-only: string/number/null/boolean. Shallow copy
  // sufficient TODAY. Generic primitive-only copy preserves both aircraft and
  // vessel fields without domain-specific branches. Skips non-primitive to keep
  // copy-safety contract explicit. Do NOT imply generic deep-clone safety.
  if (!rec || typeof rec !== 'object') return null;
  const out = {};
  for (const [key, value] of Object.entries(rec)) {
    if (value === null) {
      out[key] = null;
    } else if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      out[key] = value;
    }
    // Skip non-primitive (object/array/function) — preserves copy-safety contract
  }
  // Ensure entityKey at least present
  if (!('entityKey' in out)) {
    out.entityKey = rec.entityKey ?? null;
  }
  return out;
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
