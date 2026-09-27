import { ERROR_BACKOFF_INTERVAL } from './recordPolicy.js';

/** Own military source acquisition, cancellation, freshness and error backoff. */
export function createIngestion({
  feed,
  applySnapshot,
  setSourceLabel,
  applyPendingTrackingRestore,
}) {
  const methods = {
    async update(viewer, { signal = null } = {}) {
      const nowMs = Date.now();
      const trackingRefreshEpoch = ++feed._trackingRefreshEpoch;
      feed._lastTrackingRefreshOutcome = {
        epoch: trackingRefreshEpoch,
        status: 'source-unavailable',
        ids: new Set(),
        source: feed._lastSource,
      };
      if (feed._retryAt && nowMs < feed._retryAt) {
        feed._backoff = true;
        return;
      }

      const resourceController = new AbortController();
      feed._activeUpdateControllers.add(resourceController);
      const updateSignal = signal
        ? AbortSignal.any([signal, resourceController.signal])
        : resourceController.signal;
      try {
        updateSignal.throwIfAborted();
        const snapshot = await feed._source.getSnapshot(
          {},
          { signal: updateSignal },
        );
        updateSignal.throwIfAborted();
        feed._lastStatus = snapshot.status ?? 200;
        feed._lastSource = snapshot.source;
        setSourceLabel(feed._lastSource);
        feed._backoff = snapshot.stale || snapshot.freshness === 'unknown';
        feed._retryAt = 0;
        feed._lastError =
          snapshot.reason ||
          (snapshot.freshness === 'unknown'
            ? 'Source snapshot time unavailable'
            : null);
        const accepted = applySnapshot(snapshot, viewer);
        feed._count = accepted.count;
        feed._lastUpdate = snapshot.observedAtMs;
        // I5b: retain the snapshot's own clocks so the observation receipt never
        // reads lastUpdate (its meaning varies per layer). Unknown stays
        // unknown: a missing clock is retained as null, never substituted.
        feed._observedAtMs = Number.isFinite(snapshot.observedAtMs)
          ? snapshot.observedAtMs
          : null;
        feed._receivedAtMs = Number.isFinite(snapshot.receivedAtMs)
          ? snapshot.receivedAtMs
          : null;
        feed._lastTrackingRefreshOutcome = {
          epoch: trackingRefreshEpoch,
          status: 'accepted',
          ids: accepted.ids,
          source: feed._lastSource,
        };
        console.log(`[Data:Military] Updated: ${feed._count} aircraft`);
        applyPendingTrackingRestore();
      } catch (e) {
        if (updateSignal.aborted || e?.name === 'AbortError') {
          throw new DOMException('Military update aborted', 'AbortError');
        }
        console.warn('[Data:Military] Fetch error:', e);
        feed._backoff = true;
        feed._retryAt =
          Date.now() + (e?.retryAfterMs ?? ERROR_BACKOFF_INTERVAL);
        feed._lastStatus = e?.status ?? null;
        if (e?.source) {
          feed._lastSource = e.source;
          setSourceLabel(feed._lastSource);
        }
        feed._lastError =
          e?.name === 'LiveSourceError' ? e.message : 'Live data unavailable';
      } finally {
        feed._activeUpdateControllers.delete(resourceController);
      }
    },
  };

  return { methods };
}

/** Construct an independent military source lifetime and status. */
export function createMilitaryFeed(source) {
  const feed = {};
  feed._source = source;
  feed._count = 0;
  feed._lastUpdate = null;
  // I5b snapshot clocks, retained beside (never derived from) lastUpdate.
  feed._observedAtMs = null;
  feed._receivedAtMs = null;
  feed._backoff = false;
  feed._retryAt = 0;
  feed._lastError = null;
  feed._activeUpdateControllers = new Set();
  feed._lastStatus = null;
  feed._lastSource = source?.label || 'Aircraft';
  feed._trackingRefreshEpoch = 0;
  feed._lastTrackingRefreshOutcome = {
    epoch: 0,
    status: 'unavailable',
    ids: new Set(),
    source: feed._lastSource,
  };
  return feed;
}
