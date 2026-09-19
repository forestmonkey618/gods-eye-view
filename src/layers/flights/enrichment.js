import { horizonOccluder } from '../../data/iconOrientation.js';
import * as Cesium from 'cesium';
import {
  ENRICH_MAX_INFLIGHT,
  ENRICH_DISPATCH_GAP_MS,
  ENRICH_AMBIENT_BUDGET_CEIL,
  ENRICH_AMBIENT_REFILL_TOKENS,
  ENRICH_AMBIENT_REFILL_WINDOW_MS,
  ENRICH_AMBIENT_PER_SWEEP,
} from './policy.js';
import {
  applyTypeEnrichment,
  applyRouteEnrichment,
  ensureProvObj,
} from './enrichmentCore.js';

export function createEnrichment({
  flightState,
  services,
  parts,
  layer,
  resolveAsset,
}) {
  function _enqueueEnrich(key, query, onData, priority = false) {
    if (flightState.lifetime.signal.aborted) return;
    if (flightState._enrichSeen.has(key)) return;
    flightState._enrichSeen.add(key);
    const job = { query, onData };
    if (priority) flightState._enrichQueue.unshift(job);
    else flightState._enrichQueue.push(job);
    _drainEnrich();
  }

  function _drainEnrich() {
    if (flightState.lifetime.signal.aborted) return;
    while (
      flightState._enrichActive < ENRICH_MAX_INFLIGHT &&
      flightState._enrichQueue.length
    ) {
      const wait =
        ENRICH_DISPATCH_GAP_MS -
        (Date.now() - flightState._enrichLastDispatchMs);
      if (wait > 0) {
        if (!flightState._enrichDripTimer) {
          flightState._enrichDripTimer = setTimeout(() => {
            flightState._enrichDripTimer = null;
            _drainEnrich();
          }, wait);
        }
        return;
      }
      flightState._enrichLastDispatchMs = Date.now();
      const job = flightState._enrichQueue.shift();
      flightState._enrichActive += 1;
      const lifetime = flightState.lifetime;
      Promise.resolve()
        .then(() => {
          lifetime.signal.throwIfAborted();
          return flightState.feed._source.getEnrichment?.(job.query, {
            signal: lifetime.signal,
          });
        })
        .then((data) => {
          if (!lifetime.signal.aborted && data && data.found) job.onData(data);
        })
        .catch(() => {})
        .finally(() => {
          if (lifetime.signal.aborted) return;
          flightState._enrichActive -= 1;
          _drainEnrich();
        });
    }
  }

  function _requestTypeEnrichment(icao24, priority = false) {
    if (!/^[0-9a-f]{6}$/i.test(icao24)) return;
    _enqueueEnrich(
      `t:${icao24}`,
      { kind: 'type', id: icao24.toLowerCase() },
      (data) => {
        const meta = flightState.records.data.get(icao24);
        if (!meta) return;
        const receivedAtMs = Date.now();
        let provMap = flightState.records.provenance;
        if (!provMap) {
          provMap = flightState.records.provenance = new Map();
        }
        const provObj = ensureProvObj(provMap, icao24);
        const result = applyTypeEnrichment({
          meta,
          provObj,
          data,
          receivedAtMs,
        });
        if (result.klassChanged) {
          const bb = flightState._billboards.get(icao24);
          if (bb) parts.rendering._applyFleetBillboardPresentation(icao24, bb);
          parts.rendering._syncModelToClass(icao24);
        }
        if (icao24 === flightState._trackedIcao && flightState._trackedEntity)
          parts.tracking._updateTrackedLabelModel(icao24);
      },
      priority,
    );
  }

  function _requestRouteEnrichment(icao24) {
    const cs = String(flightState.records.data.get(icao24)?.callsign || '')
      .trim()
      .toUpperCase();
    if (!/^[A-Z]{3}\d/.test(cs)) return;
    _enqueueEnrich(
      `r:${cs}`,
      { kind: 'route', id: cs },
      (data) => {
        const meta = flightState.records.data.get(icao24);
        if (!meta) return;
        const receivedAtMs = Date.now();
        let provMap = flightState.records.provenance;
        if (!provMap) {
          provMap = flightState.records.provenance = new Map();
        }
        const provObj = ensureProvObj(provMap, icao24);
        applyRouteEnrichment({ meta, provObj, data, receivedAtMs });
        if (icao24 === flightState._trackedIcao && flightState._trackedEntity)
          parts.tracking._updateTrackedLabelModel(icao24);
      },
      true,
    );
  }

  function _ambientBudgetKnobs() {
    const o =
      (typeof window !== 'undefined' && window.__GEV_ENRICH_AMBIENT_QA) || null;
    return {
      ceil:
        Number.isFinite(o?.ceil) && o.ceil > 0
          ? o.ceil
          : ENRICH_AMBIENT_BUDGET_CEIL,
      refillTokens:
        Number.isFinite(o?.refillTokens) && o.refillTokens > 0
          ? o.refillTokens
          : ENRICH_AMBIENT_REFILL_TOKENS,
      windowMs:
        Number.isFinite(o?.windowMs) && o.windowMs > 0
          ? o.windowMs
          : ENRICH_AMBIENT_REFILL_WINDOW_MS,
    };
  }

  function _refillAmbientBudget(nowMs) {
    const { ceil, refillTokens, windowMs } = _ambientBudgetKnobs();
    if (!flightState._enrichAmbientRefillAnchorMs) {
      flightState._enrichAmbientRefillAnchorMs = nowMs;
      return;
    }
    const windows = Math.floor(
      (nowMs - flightState._enrichAmbientRefillAnchorMs) / windowMs,
    );
    if (windows <= 0) return;
    flightState._enrichAmbientBudget = Math.min(
      ceil,
      flightState._enrichAmbientBudget + windows * refillTokens,
    );
    flightState._enrichAmbientRefillAnchorMs += windows * windowMs;
  }

  function _sweepAmbientEnrichment() {
    _refillAmbientBudget(Date.now());
    if (
      flightState._enrichAmbientBudget <= 0 ||
      !flightState._viewer ||
      !flightState._billboardCollection ||
      !flightState._billboardCollection.show
    )
      return;
    try {
      const camera = flightState._viewer.camera;
      const camPos = camera.positionWC;
      const occluder = horizonOccluder(camera);
      const cull = camera.frustum.computeCullingVolume(
        camPos,
        camera.directionWC,
        camera.upWC,
      );
      const cand = [];
      for (const [icao24, bb] of flightState._billboards) {
        if (flightState._enrichSeen.has(`t:${icao24}`)) continue;
        if (!/^[0-9a-f]{6}$/i.test(icao24)) continue;
        if (flightState.records.data.get(icao24)?.onGround) continue;
        if (!bb.position || !occluder.isPointVisible(bb.position)) continue;
        Cesium.Cartesian3.clone(
          bb.position,
          flightState._scratchModelBS.center,
        );
        if (
          cull.computeVisibility(flightState._scratchModelBS) ===
          Cesium.Intersect.OUTSIDE
        )
          continue;
        cand.push([
          icao24,
          Cesium.Cartesian3.distanceSquared(camPos, bb.position),
        ]);
      }
      cand.sort((a, b) => a[1] - b[1]);
      const n = Math.min(
        cand.length,
        ENRICH_AMBIENT_PER_SWEEP,
        flightState._enrichAmbientBudget,
      );
      for (let i = 0; i < n; i++) {
        flightState._enrichAmbientBudget -= 1;
        _requestTypeEnrichment(cand[i][0]);
      }
    } catch {}
  }
  return {
    _enqueueEnrich,
    _drainEnrich,
    _requestTypeEnrichment,
    _requestRouteEnrichment,
    _ambientBudgetKnobs,
    _refillAmbientBudget,
    _sweepAmbientEnrichment,
  };
}
