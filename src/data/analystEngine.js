/**
 * Analyst query engine — answers spoken questions over data ALREADY sitting
 * client-side in the layers ("how many flights over Texas?", "biggest fire
 * near LA?", "which ships are headed to Oakland?").
 *
 * Design (owner-ratified, docs/voice-engine-evaluation-2026-07-23.md §5.3):
 *  - ENGINE (this module) is pure query logic over plain record arrays; it
 *    renders nothing. SURFACES (voice narration, panels, detection brackets)
 *    consume the returned result set — the engine/surface seam is the
 *    `items` array with stable {layerKey, id} identities.
 *  - v1 scope is CLIENT-SIDE DATA ONLY. The one enrichment path (flight
 *    routes) reads the already-cached adsbdb results surfaced by the layer
 *    accessor; the engine never fetches. Fleet-wide route search is
 *    explicitly out of scope.
 *  - Follow-up memory: the previous result set can be re-queried ("which of
 *    those is closest?") via `followUp: true`. Held per engine instance,
 *    cleared by `reset()` (layer toggles should reset via the caller).
 *
 * Providers (injected — keeps the engine pure and node-testable):
 *   getRecords(layerKey) → Array<record>            (layer accessor snapshot)
 *   getLayerObservation?(layerKey) → {enabled, feedState}  (settled lifecycle + normalized feed state)
 *   resolveRegionRing(name) → Promise<{ring, name}|null>  (NE pack / admin boundary)
 *   getViewContext() → {lat, lon, viewRadiusKm, bounds?}  (camera-derived)
 *
 * @module data/analystEngine
 */

import { surfaceM } from './geo.js';
import { pointInRing } from './naturalEarthRegions.js';
import {
  assessLayerObservation,
  unobservedLayers,
} from './observationStatus.js';

/** Layers the engine understands, with the fields queries may reference. */
export const ANALYST_LAYERS = {
  flights: {
    numeric: ['altitudeM', 'speedMps', 'verticalRateMps'],
    text: [
      'callsign',
      'icao24',
      'originCountry',
      'operator',
      'routeOrigin',
      'routeDestination',
      'aircraftClass',
    ],
    flags: ['military', 'onGround'],
  },
  military: {
    numeric: ['altitudeM', 'speedMps', 'verticalRateMps'],
    text: ['callsign', 'icao24', 'originCountry', 'operator', 'aircraftClass'],
    flags: ['military', 'onGround'],
  },
  'ais-live-vessels': {
    numeric: ['speedKts', 'courseDeg'],
    text: ['name', 'mmsi', 'shipType', 'destination', 'navStatus'],
    flags: [],
  },
  'local-firms': {
    numeric: ['frp'],
    text: ['confidence', 'satellite'],
    flags: [],
  },
  earthquakes: {
    numeric: ['magnitude', 'depthKm'],
    text: ['place'],
    flags: [],
  },
};

/** Great-circle distance in km. */
/**
 * Great-circle distance in km, `(lat, lon)` order.
 *
 * Delegates to `data/geo.js` so the analyst cannot disagree with any other
 * surface about how far apart two points are. The name is retained for
 * callers; the distance is the canonical SURFACE metric.
 */
export function haversineKm(lat1, lon1, lat2, lon2) {
  return surfaceM(lat1, lon1, lat2, lon2) / 1000;
}

/** One filter: {field, op:'gt'|'lt'|'gte'|'lte'|'eq'|'neq'|'contains', value}. */
export function applyFilter(records, filter) {
  const { field, op, value } = filter || {};
  if (!field || !op) return records;
  return records.filter((r) => {
    const got = r[field];
    if (got === null || got === undefined) return false;
    switch (op) {
      case 'gt':
        return Number(got) > Number(value);
      case 'gte':
        return Number(got) >= Number(value);
      case 'lt':
        return Number(got) < Number(value);
      case 'lte':
        return Number(got) <= Number(value);
      case 'eq': {
        if (typeof got === 'boolean' || typeof value === 'boolean')
          return Boolean(got) === Boolean(value);
        return String(got).toLowerCase() === String(value).toLowerCase();
      }
      case 'neq':
        return String(got).toLowerCase() !== String(value).toLowerCase();
      case 'contains':
        return String(got).toLowerCase().includes(String(value).toLowerCase());
      default:
        return true;
    }
  });
}

/** Scope records spatially. scope: {kind:'view'|'region'|'radius'|'anywhere', …}. */
export function applyScope(records, scope, resolved) {
  if (!scope || scope.kind === 'anywhere') return records;
  if (scope.kind === 'region' && resolved?.ring) {
    return records.filter(
      (r) =>
        Number.isFinite(r.lat) &&
        Number.isFinite(r.lon) &&
        pointInRing(resolved.ring, r.lat, r.lon),
    );
  }
  if (scope.kind === 'radius' || scope.kind === 'view') {
    const c = resolved?.center;
    const km = resolved?.km;
    if (!c || !Number.isFinite(km)) return records;
    return records.filter(
      (r) =>
        Number.isFinite(r.lat) &&
        Number.isFinite(r.lon) &&
        haversineKm(c.lat, c.lon, r.lat, r.lon) <= km,
    );
  }
  return records;
}

/** Numeric summary for the narration layer. */
function summarize(items, sortField) {
  const summary = { count: items.length };
  if (sortField && items.length) {
    const vals = items.map((r) => Number(r[sortField])).filter(Number.isFinite);
    if (vals.length) {
      summary[`${sortField}Min`] = Math.min(...vals);
      summary[`${sortField}Max`] = Math.max(...vals);
    }
  }
  return summary;
}

/**
 * Create an engine bound to live providers. All spatial/text/number logic is
 * in the pure helpers above; this closure only sequences and remembers.
 */
export function createAnalystEngine(providers) {
  let lastResult = null;

  async function query(spec = {}) {
    const layers =
      spec.followUp && lastResult
        ? null // follow-up: re-filter the remembered set, no re-snapshot
        : Array.isArray(spec.layers) && spec.layers.length
          ? spec.layers
          : ['flights'];

    // 1) Source records
    let records;
    let layersQueried;
    let observation;
    if (layers === null) {
      records = lastResult.items.slice();
      layersQueried = lastResult.layersQueried;
      observation = lastResult.observation;
    } else {
      records = [];
      layersQueried = [];
      const unknown = layers.filter((k) => !ANALYST_LAYERS[k]);
      if (unknown.length) {
        return {
          ok: false,
          error: `I can't query ${unknown.join(', ')} yet — supported layers: ${Object.keys(ANALYST_LAYERS).join(', ')}.`,
          coverage: { layersQueried: [], scope: 'unsupported-layer' },
        };
      }
      const assessments = [];
      for (const key of layers) {
        if (!ANALYST_LAYERS[key]) continue;
        // Both accessors are synchronous: take the status beside the records,
        // before any async scope resolution. A follow-up never calls either.
        const rows = providers.getRecords(key) || [];
        const state = providers.getLayerObservation?.(key);
        const assessment = assessLayerObservation({
          layerKey: key,
          enabled: state?.enabled,
          feedState: state?.feedState,
        });
        assessments.push(assessment);
        layersQueried.push(
          Object.freeze({
            layerKey: key,
            records: rows.length,
            enabled: assessment.enabled,
            feedState: assessment.feedState,
          }),
        );
        for (const row of rows) records.push({ layerKey: key, ...row });
      }
      layersQueried = Object.freeze(layersQueried);
      observation = Object.freeze({
        unobserved: unobservedLayers(assessments),
      });
    }

    // 2) Spatial scope
    let resolvedScope = null;
    let scopeNote = 'anywhere';
    // Human phrasing for the same scope, so every spoken count can name what it
    // measured ("8 in view", "about 30 within 250 km of Austin") instead of
    // arriving as a bare number that contradicts the panel.
    let scopeLabel = 'anywhere in the loaded data';
    const scope = spec.scope || { kind: 'view' };
    if (scope.kind === 'region' && scope.name) {
      const region = await providers.resolveRegionRing(scope.name);
      if (!region?.ring) {
        return {
          ok: false,
          error: `I couldn't resolve a boundary for "${scope.name}" — try a state, country, or a named natural region.`,
          coverage: { layersQueried, scope: `region:${scope.name}:unresolved` },
        };
      }
      resolvedScope = region;
      scopeNote = `region:${region.name}`;
      scopeLabel = `over ${region.name}`;
    } else if (scope.kind === 'radius') {
      // An explicit center always wins. Otherwise, when Contacts is active its
      // SUBJECT is the centre the operator is actually reasoning about: the
      // panel counts a contact-centred window, so centring the radius on the
      // camera made the two disagree — a parked, high-altitude camera answered
      // "46 within 250 km" while the panel showed a far larger contact-centred
      // count. Same question, two numbers.
      const explicitCenter =
        scope.center && Number.isFinite(scope.center.lat) ? scope.center : null;
      const subject = explicitCenter
        ? null
        : providers.getContextSubject?.() || null;
      const view = providers.getViewContext();
      // Only a subject that actually SUPPLIED the centre may name it. A
      // subject present but without usable coordinates silently fell back to
      // the camera while the label still read "within 250 km of <contact>" —
      // a count centred on one place, reported as centred on another, with
      // nothing in the payload to show which.
      const subjectCenter =
        Number.isFinite(subject?.lat) && Number.isFinite(subject?.lon)
          ? { lat: subject.lat, lon: subject.lon }
          : null;
      const center = explicitCenter ||
        subjectCenter || { lat: view.lat, lon: view.lon };
      resolvedScope = { center, km: Number(scope.km) || 100 };
      if (subjectCenter) resolvedScope.centeredOn = subject.label || null;
      scopeNote = resolvedScope.centeredOn
        ? `radius:${resolvedScope.km}km@${resolvedScope.centeredOn}`
        : `radius:${resolvedScope.km}km`;
      scopeLabel = resolvedScope.centeredOn
        ? `within ${resolvedScope.km} km of ${resolvedScope.centeredOn}`
        : `within ${resolvedScope.km} km`;
    } else if (scope.kind === 'view') {
      const view = providers.getViewContext();
      resolvedScope = {
        center: { lat: view.lat, lon: view.lon },
        km: view.viewRadiusKm,
      };
      scopeNote = `view:${Math.round(view.viewRadiusKm)}km`;
      scopeLabel = 'in view';
    } else {
      scopeNote = 'anywhere';
      scopeLabel = 'anywhere in the loaded data';
    }
    let items = applyScope(records, scope, resolvedScope);

    // 3) Attribute filters
    for (const f of spec.filters || []) items = applyFilter(items, f);

    // 4) Aggregate / sort / limit — nearest needs a reference point
    const sortBy = spec.sortBy || null;
    if (sortBy === 'distance') {
      const ref = resolvedScope?.center || providers.getViewContext();
      for (const it of items) {
        it.distanceKm =
          Number.isFinite(it.lat) && Number.isFinite(it.lon)
            ? Math.round(haversineKm(ref.lat, ref.lon, it.lat, it.lon) * 10) /
              10
            : null;
      }
    }
    if (sortBy) {
      const dir = spec.sortDir === 'asc' ? 1 : -1;
      items.sort(
        (a, b) =>
          (Number(a[sortBy]) - Number(b[sortBy])) * dir ||
          String(a.id).localeCompare(String(b.id)),
      );
      if (sortBy === 'distance')
        items.sort((a, b) => (a.distanceKm ?? 1e9) - (b.distanceKm ?? 1e9));
    }
    const limit = Math.max(1, Math.min(50, Number(spec.limit) || 10));
    const top = items.slice(0, limit);

    const result = {
      ok: true,
      count: items.length,
      items: top,
      truncated: items.length > top.length,
      summary: summarize(
        items,
        sortBy && sortBy !== 'distance' ? sortBy : null,
      ),
      scopeLabel,
      coverage: {
        layersQueried,
        scope: scopeNote,
        followUp: Boolean(spec.followUp && lastResult),
        note: 'client-side data only — answers cover what the enabled layers currently hold',
      },
      // Layer observation status is separate from the existing scope/coverage
      // block: it makes no claim about geographic footprint or completeness.
      observation,
      // Surfaced so the narration can name the centre it measured from rather
      // than implying a view-centred answer.
      ...(resolvedScope?.centeredOn
        ? { centeredOn: resolvedScope.centeredOn }
        : {}),
    };
    // Retain the original, frozen status snapshot independently of caller edits
    // to the presentation-oriented coverage block (e.g. voice adds a note).
    lastResult = { items, layersQueried, observation };
    return result;
  }

  return {
    query,
    reset() {
      lastResult = null;
    },
    hasMemory() {
      return Boolean(lastResult);
    },
  };
}
