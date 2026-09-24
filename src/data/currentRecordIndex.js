/**
 * Current record index adapter — connects the production Flights, Military
 * Flights and AIS Vessels stores to the canonical current-state record index.
 *
 * Eligibility is owned here, as the recordIndex contract requires. A store
 * contributes only while its layer lifecycle is settled ON: `enabled`,
 * `lifecycleState` 'enabled', and not uncertain. A disabled layer keeps its
 * records as a retained cache, a disabling layer still reports `enabled`, and
 * an enabling layer holds its retained cache until its first update lands, so
 * none of them is read. Records come from the module registered under the
 * same layer id whose lifecycle was checked, never from a default instance.
 * Feed freshness is not an eligibility input: an enabled store in backoff
 * contributes what it currently holds; freshness belongs to provenance.
 *
 * Identity: records enter with the `entityKey` their store accessor produced.
 * Nothing here constructs, repairs or infers identity; a record without a
 * canonical key stays outside the index. Store origin stays outside the record
 * as `storeId`, so a civil and a military record for one aircraft remain
 * separately attributable under one canonical entity.
 *
 * Current state only: every call rebuilds from the stores' current accessors.
 * No cache, subscription, history or diff is kept, so records of an
 * ineligible store, or records their store has evicted, are simply not
 * indexed — never reported as a departure.
 *
 * One snapshot: each contributing store is read exactly once per call. The
 * records that read returned are exposed beside the index as
 * `stores[].records` — the very arrays the index was built from — so a
 * consumer can locate its own contact in the same snapshot instead of reading
 * the store again. Only the index decides which entities are canonical; a
 * record's `entityKey` is just the key its store assigned, to look up there.
 *
 * No Cesium, DOM or scene visibility is consulted.
 *
 * @module data/currentRecordIndex
 */

import { buildRecordIndex } from './recordIndex.js';

/** Production store origins and the lifecycle layers that own them. */
const STORE_LAYERS = Object.freeze([
  Object.freeze({ storeId: 'flights', layerId: 'flights' }),
  Object.freeze({ storeId: 'military', layerId: 'military' }),
  Object.freeze({ storeId: 'vessels', layerId: 'ais-live-vessels' }),
]);

function isSettledOn(state) {
  return (
    state?.enabled === true &&
    state.lifecycleState === 'enabled' &&
    state.uncertain !== true
  );
}

/**
 * Build a fresh canonical record index from the production stores whose
 * layers are currently settled ON. A manager without lifecycle state, an
 * unregistered layer, or a module without `getCurrentEntities` contributes
 * nothing.
 * @param {{getLayerLifecycleState: function(string): ({enabled: boolean, lifecycleState: string, uncertain: boolean}|null), layers: Map<string, {module: object}>}} lifecycle
 *   The application's layer lifecycle manager.
 * @returns {{index: {get: function(string): (object|undefined), has: function(string): boolean, size: number, values: function(): Array<object>}, stores: ReadonlyArray<{storeId: string, layerId: string, records: ReadonlyArray<object>}>}}
 *   The frozen RecordIndex from `buildRecordIndex`, and the stores that
 *   contributed to it (in fixed Flights, Military, Vessels order), each with
 *   the frozen list of records its single read returned. Those records are
 *   the accessor's own fresh copies, canonical or not; read, never write.
 */
export function buildCurrentRecordIndex(lifecycle) {
  const collections = [];
  const stores = [];
  for (const store of STORE_LAYERS) {
    if (!isSettledOn(lifecycle?.getLayerLifecycleState?.(store.layerId)))
      continue;
    const module = lifecycle.layers?.get?.(store.layerId)?.module;
    if (typeof module?.getCurrentEntities !== 'function') continue;
    // This store's one read: the index and the exposed records share it.
    const read = module.getCurrentEntities();
    const records = Object.freeze(Array.isArray(read) ? [...read] : []);
    collections.push({ storeId: store.storeId, records });
    stores.push(Object.freeze({ ...store, records }));
  }
  return Object.freeze({
    index: buildRecordIndex(collections),
    stores: Object.freeze(stores),
  });
}
