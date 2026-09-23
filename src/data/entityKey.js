/**
 * Canonical entity identity authority — I2a + I2d.
 *
 * I2d supports:
 * - AIRCRAFT ICAO24: aircraft:icao24:<6 hex lowercase>
 * - VESSEL MMSI: vessel:mmsi:<9 decimal digits>
 *
 * Core rule: entityKey identifies the THING GEV believes it refers to.
 * Same ICAO24 = same canonical entityKey regardless of flights/military/OpenSky/adsb.lol.
 * Same MMSI = same canonical entityKey regardless of AIS provider.
 *
 * Deterministic, stateless, allocation-light, no Cesium, no DOM, no network.
 * No history, no registry, no persistence, no subscriptions.
 *
 * Aircraft normalization consistent with GEV aircraft lookup:
 * - trim
 * - lowercase
 * - validated as 6 hex digits (ICAO24) — evidence from actual feeds
 *
 * Vessel normalization consistent with GEV vessel store:
 * - src/layers/vessels/records.js: mmsi: String(row.mmsi || '').trim()
 * - src/sources/live/vessels.js: id: String(row?.mmsi || row?.input_identifier || '').trim()
 * - Actual GEV source representation is STRING, preserving leading zeros.
 * - Canonical MMSI grammar: exactly 9 decimal digits /^\d{9}$/ after trim.
 * - Numeric input accepted only if String(value) is exactly 9 digits — no zero-padding,
 *   no digit manufacture. Leading-zero string "012345678" preserved, numeric 12345678
 *   (8 digits) rejected as non-canonical.
 *
 * @module data/entityKey
 */

const DOMAIN_AIRCRAFT = 'aircraft';
const KIND_ICAO24 = 'icao24';
const DOMAIN_VESSEL = 'vessel';
const KIND_MMSI = 'mmsi';
const SEPARATOR = ':';

// Canonical ICAO24: exactly 6 hex digits, per ICAO allocation and per OpenSky/readsb
// evidence. Lowercased, trimmed. No TIS-B ~, no _-, no variable length.
const ICAO24_HEX = /^[0-9a-f]{6}$/;
// Canonical MMSI: exactly 9 decimal digits, per ITU and AIS evidence.
const MMSI_9 = /^\d{9}$/;

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
 * Normalize MMSI to canonical form: trimmed, exactly 9 decimal digits.
 * Returns normalized id or null if missing/empty/malformed.
 * Preserves leading zeros when input is string.
 * No zero-padding, no digit manufacture.
 * @param {*} value
 * @returns {string|null}
 */
function normalizeMmsi(value) {
  const raw = cleanString(value);
  if (!raw) return null;
  if (!MMSI_9.test(raw)) return null;
  return raw;
}

/**
 * Construct canonical aircraft entityKey: aircraft:icao24:<normalized>
 * Returns null if icao24 missing/empty/malformed — never invents identity.
 * @param {*} icao24
 * @returns {string|null}
 */
export function aircraft(icao24) {
  const n = normalizeIcao24(icao24);
  if (!n) return null;
  return `${DOMAIN_AIRCRAFT}${SEPARATOR}${KIND_ICAO24}${SEPARATOR}${n}`;
}

/**
 * Construct canonical vessel entityKey: vessel:mmsi:<9-digit>
 * Returns null if mmsi missing/empty/malformed — never invents identity.
 * Preserves leading zeros when input is string "012345678".
 * Numeric input accepted only if String(value) is exactly 9 digits — no padding.
 * @param {*} mmsi
 * @returns {string|null}
 */
export function vessel(mmsi) {
  const n = normalizeMmsi(mmsi);
  if (!n) return null;
  return `${DOMAIN_VESSEL}${SEPARATOR}${KIND_MMSI}${SEPARATOR}${n}`;
}

/**
 * Narrow canonical-key validator — I2d.
 * Answers: Is this a currently supported canonical GEV entityKey?
 * Supported after I2d:
 * - aircraft:icao24:<6 lowercase hex>
 * - vessel:mmsi:<9 decimal digits>
 * Canonical validation means canonical representation only — no normalization,
 * no whitespace, no uppercase hex allowed. Constructor normalization separate.
 * @param {*} key
 * @returns {boolean}
 */
export function isValid(key) {
  if (typeof key !== 'string') return false;
  if (
    key.startsWith(`${DOMAIN_AIRCRAFT}${SEPARATOR}${KIND_ICAO24}${SEPARATOR}`)
  ) {
    const suffix = key.slice(
      `${DOMAIN_AIRCRAFT}${SEPARATOR}${KIND_ICAO24}${SEPARATOR}`.length,
    );
    return ICAO24_HEX.test(suffix);
  }
  if (key.startsWith(`${DOMAIN_VESSEL}${SEPARATOR}${KIND_MMSI}${SEPARATOR}`)) {
    const suffix = key.slice(
      `${DOMAIN_VESSEL}${SEPARATOR}${KIND_MMSI}${SEPARATOR}`.length,
    );
    return MMSI_9.test(suffix);
  }
  return false;
}
