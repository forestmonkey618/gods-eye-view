/**
 * I5a — layer-level observation eligibility, not geographic coverage.
 * `feedState` is the already-normalized result of layerFeedState(stats); this
 * authority neither reads stats nor decides freshness itself.
 *
 * I5b — layer/snapshot-level observation currency ("as-of") lives beside the
 * eligibility assessment with the same grain discipline: only clocks a layer's
 * own ingestion established for the snapshot, never per-value provenance (I3),
 * never generic lastUpdate, never wall-clock substitutes. Unknown stays
 * unknown (null); this module never ages or compares timestamps.
 */

// Keys are the existing feedState.js output states, not a second feed-state
// normalizer. An unrecognized state must never be treated as nominal.
const FEED_LIMIT_REASONS = Object.freeze({
  loading: 'feed-loading',
  unavailable: 'feed-unavailable',
  stale: 'feed-stale',
  degraded: 'feed-degraded',
  partial: 'feed-partial',
  fallback: 'feed-fallback',
});

/** A frozen assessment; reason is null ONLY for enabled + exactly nominal. */
export function assessLayerObservation({ layerKey, enabled, feedState } = {}) {
  const knownEnabled = typeof enabled === 'boolean' ? enabled : null;
  const knownFeedState = typeof feedState === 'string' ? feedState : null;
  const reason =
    enabled === false
      ? 'layer-disabled'
      : enabled === true && knownFeedState === 'nominal'
        ? null
        : enabled === true && Object.hasOwn(FEED_LIMIT_REASONS, knownFeedState)
          ? FEED_LIMIT_REASONS[knownFeedState]
          : 'feed-state-unknown';
  return Object.freeze({
    layerKey,
    enabled: knownEnabled,
    feedState: knownFeedState,
    reason,
  });
}

/** Collect layer limitations in assessment order, without retaining input objects. */
export function unobservedLayers(assessments) {
  return Object.freeze(
    assessments
      .filter(({ reason }) => reason !== null)
      .map(({ layerKey, reason }) => Object.freeze({ layerKey, reason })),
  );
}

/**
 * I5b — normalize one layer's snapshot-level observation currency ("as-of").
 *
 * `observedAtMs` is the source/adapter-established snapshot observation or
 * currency time of the applied data; `receivedAtMs` is the time GEV
 * received/ingested that batch when the ingestion path explicitly knows it.
 * The two clocks never substitute for each other, and neither is ever derived
 * here: each finite number a layer established is preserved exactly; missing,
 * non-finite, or non-numeric values become null and stay null. No age, no
 * freshness, no comparison, no wall clock — deterministic and zero-dependency.
 */
export function assessLayerAsOf({ layerKey, observedAtMs, receivedAtMs } = {}) {
  return Object.freeze({
    layerKey,
    observedAtMs: Number.isFinite(observedAtMs) ? observedAtMs : null,
    receivedAtMs: Number.isFinite(receivedAtMs) ? receivedAtMs : null,
  });
}
