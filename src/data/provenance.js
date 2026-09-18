/**
 * I3a — Minimal provenance primitive — CURRENT position only.
 *
 * Zero-dependency, no Cesium, no DOM, no network.
 * Purpose: smallest correct descriptor that answers where CURRENT aircraft
 * position came from and when it was reported/received, without history.
 *
 * Owner decisions locked:
 * - epistemic term REPORTED (not OBSERVED)
 * - vocab REPORTED|DERIVED|MODELED|INTERPRETED (no PREDICTED/UNKNOWN/SIMULATED)
 * - sourceId = stable machine id (e.g. 'opensky','adsb.lol'), not storeId, not label
 * - recordIndex remains provenance-unaware
 * - CURRENT only, no history
 *
 * @module data/provenance
 */

export const EPISTEMIC = Object.freeze({
  REPORTED: 'reported',
  DERIVED: 'derived',
  MODELED: 'modeled',
  INTERPRETED: 'interpreted',
});

const EPISTEMIC_VALUES = new Set(Object.values(EPISTEMIC));

function isFinitePositiveMs(value) {
  return Number.isFinite(value) && value > 0;
}

/**
 * Validate sourceId as stable machine identifier.
 * Smallest safe rule: non-empty trimmed string, 1..128 chars, no whitespace,
 * only lower-case alphanumerics, dot, dash, underscore, colon? Keep permissive
 * but reject objects/labels with spaces.
 * Allowed: a-z, 0-9, ., -, _, :  (covers 'opensky','adsb.lol','austin-cctv')
 * Length 1..128, trimmed, no whitespace.
 * This does NOT enforce global membership — I4 will later validate existence.
 */
function validateSourceId(sourceId, { required = false } = {}) {
  if (sourceId == null) {
    if (required) throw new TypeError('sourceId is required for REPORTED');
    return null;
  }
  if (typeof sourceId !== 'string') throw new TypeError('sourceId must be string');
  const trimmed = sourceId.trim();
  if (!trimmed) throw new TypeError('sourceId cannot be empty');
  if (trimmed.length > 128) throw new TypeError('sourceId too long');
  if (/\s/.test(trimmed)) throw new TypeError('sourceId must not contain whitespace');
  // Very small syntax rule — lower-case recommended but not strictly enforced to avoid rejecting future sources;
  // however we require at least one alphanumeric and only allow a-z0-9._-:
  if (!/^[a-z0-9._:-]+$/.test(trimmed)) {
    // Allow upper-case for forward compat? Owner locked to machine id, lower-case expected.
    // Reject if contains characters outside allowed set to avoid label injection.
    throw new TypeError(`sourceId has invalid characters: ${trimmed}`);
  }
  return trimmed;
}

function validateReportedAtMs(value) {
  if (value == null) return null;
  if (!isFinitePositiveMs(value)) throw new TypeError('reportedAtMs must be finite positive ms or null');
  return value;
}

function validateReceivedAtMs(value, { required = false } = {}) {
  if (value == null) {
    if (required) throw new TypeError('receivedAtMs is required for REPORTED');
    return null;
  }
  if (!isFinitePositiveMs(value)) throw new TypeError('receivedAtMs must be finite positive ms');
  return value;
}

/**
 * Create a current-state provenance descriptor.
 *
 * For I3a first slice only REPORTED position is used, but primitive supports
 * DERIVED/MODELED/INTERPRETED for future extension without speculative fields.
 *
 * @param {Object} params
 * @param {string} params.epistemic - one of EPISTEMIC values, required
 * @param {string} [params.sourceId] - stable machine id, required for REPORTED
 * @param {number|null} [params.reportedAtMs] - external event/fix time, optional/null when unavailable
 * @param {number} [params.receivedAtMs] - client receipt time, required for REPORTED in this slice
 * @returns {Object} frozen descriptor {epistemic, sourceId, reportedAtMs, receivedAtMs}
 */
export function createProvenance({ epistemic, sourceId, reportedAtMs, receivedAtMs } = {}) {
  if (!epistemic || typeof epistemic !== 'string') throw new TypeError('epistemic is required');
  if (!EPISTEMIC_VALUES.has(epistemic)) throw new TypeError(`unsupported epistemic: ${epistemic}`);

  const isReported = epistemic === EPISTEMIC.REPORTED;

  const validSourceId = validateSourceId(sourceId, { required: isReported });
  const validReportedAtMs = validateReportedAtMs(reportedAtMs);
  const validReceivedAtMs = validateReceivedAtMs(receivedAtMs, { required: isReported });

  // No implicit age/fresh/stale/confidence/history/observationId
  const descriptor = {
    epistemic,
    sourceId: validSourceId,
    reportedAtMs: validReportedAtMs,
    receivedAtMs: validReceivedAtMs,
  };

  return Object.freeze(descriptor);
}

/**
 * Narrow validator for current descriptor shape.
 * Does NOT check age/freshness — I5 owns that.
 */
export function isValidProvenance(value) {
  if (!value || typeof value !== 'object') return false;
  const { epistemic, sourceId, reportedAtMs, receivedAtMs } = value;
  if (!EPISTEMIC_VALUES.has(epistemic)) return false;
  try {
    validateSourceId(sourceId, { required: epistemic === EPISTEMIC.REPORTED });
    validateReportedAtMs(reportedAtMs);
    validateReceivedAtMs(receivedAtMs, { required: epistemic === EPISTEMIC.REPORTED });
  } catch {
    return false;
  }
  // Ensure no forbidden fields present (ageMs, fresh, stale, confidence, history, observationId)
  const forbidden = ['ageMs', 'fresh', 'stale', 'confidence', 'quality', 'history', 'observationId', 'age', 'providerLabel', 'license', 'url', 'storeId'];
  for (const key of forbidden) {
    if (key in value) return false;
  }
  return true;
}
