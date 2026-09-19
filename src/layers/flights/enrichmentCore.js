/**
 * I3b enrichment core — zero-Cesium, zero-DOM, zero-network, current-state only.
 * Pure metadata + provenance application logic shared by production enrichment.js
 * and tests. No history, no I4.
 */

import { EPISTEMIC, createProvenance } from '../../data/provenance.js';
import { classifyAircraft } from '../../data/aircraftClass.js';

function tryCreateEnrichmentProv(receivedAtMs) {
  try {
    return createProvenance({
      epistemic: EPISTEMIC.REPORTED,
      sourceId: 'adsbdb',
      reportedAtMs: null,
      receivedAtMs,
    });
  } catch {
    return null;
  }
}

function tryCreateClassificationProv() {
  try {
    return createProvenance({
      epistemic: EPISTEMIC.DERIVED,
      via: 'classification',
    });
  } catch {
    return null;
  }
}

/**
 * Ensure provenance map and object exist for icao24.
 * @param {Map} provenanceMap - FlightRecords.provenance
 * @param {string} icao24
 * @returns {object} provObj mutable
 */
export function ensureProvObj(provenanceMap, icao24) {
  let provObj = provenanceMap.get(icao24);
  if (!provObj) {
    provObj = {};
    provenanceMap.set(icao24, provObj);
  }
  return provObj;
}

/**
 * Apply adsbdb type enrichment to meta + provenance.
 * Production caller supplies receivedAtMs = Date.now() at callback boundary.
 * Tests can supply deterministic timestamp.
 *
 * Invariant: PROVENANCE FOLLOWS CURRENT VALUE.
 * - If data.field truthy and differs from meta.field, replace value and provenance with new receipt time.
 * - If data.field truthy and same as meta.field but provenance missing, ensure provenance (first time).
 * - If data.field truthy and same as meta.field and provenance exists, retain existing provenance (do not make appear newer).
 * - If data.field falsy, retain old value and provenance.
 *
 * @param {object} params
 * @param {object} params.meta - FlightRecords meta mutable
 * @param {object} params.provObj - provenance object for this icao24 mutable
 * @param {object} params.data - adsbdb response {typeCode, typeName, registration}
 * @param {number} params.receivedAtMs - enrichment receipt time
 * @returns {{changed: boolean, klassChanged: boolean, newKlass: string|null, prevKlass: string|null}}
 */
export function applyTypeEnrichment({ meta, provObj, data, receivedAtMs }) {
  let changed = false;
  let klassChanged = false;
  let prevKlass = meta.klass ?? null;
  let newKlass = prevKlass;

  // typeCode
  if (data.typeCode) {
    if (data.typeCode !== meta.typeCode) {
      meta.typeCode = data.typeCode;
      changed = true;
      const p = tryCreateEnrichmentProv(receivedAtMs);
      if (p) provObj.typeCode = p;
    } else if (!provObj.typeCode) {
      const p = tryCreateEnrichmentProv(receivedAtMs);
      if (p) provObj.typeCode = p;
    }
  }
  // typeName
  if (data.typeName) {
    if (data.typeName !== meta.typeName) {
      meta.typeName = data.typeName;
      const p = tryCreateEnrichmentProv(receivedAtMs);
      if (p) provObj.typeName = p;
    } else if (!provObj.typeName) {
      const p = tryCreateEnrichmentProv(receivedAtMs);
      if (p) provObj.typeName = p;
    }
  }
  // registration
  if (data.registration) {
    if (data.registration !== meta.registration) {
      meta.registration = data.registration;
      const p = tryCreateEnrichmentProv(receivedAtMs);
      if (p) provObj.registration = p;
    } else if (!provObj.registration) {
      const p = tryCreateEnrichmentProv(receivedAtMs);
      if (p) provObj.registration = p;
    }
  }

  // Preserve previous || behavior for falsy new values (retain old)
  meta.typeCode = data.typeCode || meta.typeCode;
  meta.typeName = data.typeName || meta.typeName;
  meta.registration = data.registration || meta.registration;

  // klass derived from typeCode + category
  if (meta.typeCode) {
    const klass = classifyAircraft({
      typeCode: meta.typeCode,
      category: meta.category,
    });
    if (klass !== meta.klass) {
      meta.klass = klass;
      newKlass = klass;
      changed = true;
      klassChanged = true;
      const dp = tryCreateClassificationProv();
      if (dp) provObj.klass = dp;
    } else if (!provObj.klass) {
      const dp = tryCreateClassificationProv();
      if (dp) provObj.klass = dp;
    }
  }

  return { changed, klassChanged, newKlass, prevKlass };
}

/**
 * Apply adsbdb route enrichment to meta + provenance.
 * @param {object} params
 * @param {object} params.meta
 * @param {object} params.provObj
 * @param {object} params.data - {airline, origin, destination}
 * @param {number} params.receivedAtMs
 * @returns {{changed: boolean, airlineChanged: boolean, routeChanged: boolean}}
 */
export function applyRouteEnrichment({ meta, provObj, data, receivedAtMs }) {
  let changed = false;
  let airlineChanged = false;
  let routeChanged = false;

  if (data.airline) {
    if (data.airline !== meta.airline) {
      meta.airline = data.airline;
      changed = true;
      airlineChanged = true;
      const p = tryCreateEnrichmentProv(receivedAtMs);
      if (p) provObj.airline = p;
    } else if (!provObj.airline) {
      const p = tryCreateEnrichmentProv(receivedAtMs);
      if (p) provObj.airline = p;
    }
  }

  if (data.origin && data.destination) {
    const newRoute = { origin: data.origin, destination: data.destination };
    const prev = meta.route;
    const isChanged =
      !prev ||
      prev.origin?.code !== newRoute.origin?.code ||
      prev.destination?.code !== newRoute.destination?.code;
    if (isChanged) {
      meta.route = newRoute;
      changed = true;
      routeChanged = true;
      const p = tryCreateEnrichmentProv(receivedAtMs);
      if (p) provObj.route = p;
    } else if (!provObj.route) {
      const p = tryCreateEnrichmentProv(receivedAtMs);
      if (p) provObj.route = p;
    }
  }

  // Preserve || behavior
  meta.airline = data.airline || meta.airline;
  if (data.origin && data.destination) {
    meta.route = { origin: data.origin, destination: data.destination };
  }

  return { changed, airlineChanged, routeChanged };
}

// Export for tests to validate provenance creation without duplicating logic
export function _testCreateEnrichmentProv(receivedAtMs) {
  return tryCreateEnrichmentProv(receivedAtMs);
}
export function _testCreateClassificationProv() {
  return tryCreateClassificationProv();
}
