/**
 * I5a — layer-level observation eligibility, not geographic coverage.
 * `feedState` is the already-normalized result of layerFeedState(stats); this
 * authority neither reads stats nor decides freshness itself.
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
