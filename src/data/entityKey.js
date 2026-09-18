/**
 * Canonical entity identity authority — I2a.
 *
 * I2a supports AIRCRAFT ONLY, ICAO24 only.
 * Canonical form: aircraft:icao24:<normalized-icao24>
 *
 * Core rule: entityKey identifies the THING GEV believes it refers to.
 * Same ICAO24 = same canonical entityKey regardless of flights/military/OpenSky/adsb.lol.
 *
 * Deterministic, stateless, allocation-light, no Cesium, no DOM, no network.
 * No history, no registry, no persistence, no subscriptions.
 *
 * Normalization consistent with GEV aircraft lookup:
 * - trim
 * - lowercase
 * - validated as 6 hex digits (ICAO24) — evidence from actual feeds
 *
 * Source normalization:
 * - src/sources/live/aircraft.js: cleanText(row[0]).toLowerCase() and cleanText(row?.hex).toLowerCase()
 *   OpenSky API returns 6 hex digits, readsb returns 6 hex for ICAO aircraft.
 * - TRACKING_ID_GRAMMAR /^[0-9a-z~_-]{1,16}$/ is tracking-input grammar with slack for
 *   TIS-B (~abc123) and similar prefixed forms — NOT canonical ICAO24 semantics.
 *   TIS-B ~ prefix indicates non-ICAO address, semantically distinct from ICAO24.
 *   _ and - not produced by aircraft feeds, only allowed by broader UI grammar.
 *   Lengths other than 6 not present for ICAO24 (TIS-B is ~ + 6 hex = 7, distinct kind).
 *
 * Canonical ICAO24 validation for I2a: exactly 6 hex digits [0-9a-f]{6} lowercased.
 * TIS-B ~ identifiers require separate namespace and owner decision — see report.
 *
 * @module data/entityKey
 */

const DOMAIN_AIRCRAFT = 'aircraft';
const KIND_ICAO24 = 'icao24';
const SEPARATOR = ':';

// Canonical ICAO24: exactly 6 hex digits, per ICAO allocation and per OpenSky/readsb
// evidence. Lowercased, trimmed. No TIS-B ~, no _-, no variable length for I2a.
const ICAO24_HEX = /^[0-9a-f]{6}$/;

function cleanString(value) {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value).trim();
  }
  return '';
}

/**
 * Normalize ICAO24 to canonical form: trimmed, lowercased, 6 hex digits.
 * Returns normalized id or null if missing/empty/malformed.
 * Internal — not exported as public API for I2a minimal.
 * @param {*} value
 * @returns {string|null}
 */
function normalizeIcao24(value) {
  const raw = cleanString(value);
  if (!raw) return null;
  const normalized = raw.toLowerCase();
  if (!ICAO24_HEX.test(normalized)) return null;
  return normalized;
}

/**
 * Construct canonical aircraft entityKey: aircraft:icao24:<normalized>
 * Returns null if icao24 missing/empty/malformed — never invents identity.
 * Only public API for I2a.
 * @param {*} icao24
 * @returns {string|null}
 */
export function aircraft(icao24) {
  const n = normalizeIcao24(icao24);
  if (!n) return null;
  return `${DOMAIN_AIRCRAFT}${SEPARATOR}${KIND_ICAO24}${SEPARATOR}${n}`;
}
