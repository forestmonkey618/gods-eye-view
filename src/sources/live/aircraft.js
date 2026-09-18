import {
  admitRecords,
  cleanText,
  coordinates,
  epoch,
  finite,
} from './contract.js';

/** Normalize the OpenSky state-vector route, including its regional fallback. */
export function normalizeOpenSkyAircraft(row) {
  if (!Array.isArray(row)) return null;
  const id = cleanText(row[0]).toLowerCase();
  if (!id || !coordinates(row[6], row[5])) return null;
  return {
    id,
    reference: id,
    latitude: row[6],
    longitude: row[5],
    callsign: cleanText(row[1]),
    originCountry: cleanText(row[2]),
    positionTimeMs: epoch(row[3], 1000),
    contactTimeMs: epoch(row[4], 1000),
    baroAltitudeM: finite(row[7]),
    ellipsoidAltitudeM: finite(row[13]),
    onGround: row[8] === true,
    speedMps: finite(row[9]),
    courseDeg: finite(row[10]),
    verticalRateMps: finite(row[11]),
    category: finite(row[17]),
    typeCode: null,
    registration: null,
    operator: null,
  };
}

/** Normalize readsb observations. The caller supplies the source snapshot epoch. */
export function normalizeReadsbAircraft(row, snapshotTimeMs) {
  const id = cleanText(row?.hex).toLowerCase();
  const latitude = finite(row?.lat),
    longitude = finite(row?.lon);
  if (!id || !coordinates(latitude, longitude)) return null;
  const baroFt = finite(row.alt_baro),
    geoFt = finite(row.alt_geom);
  const speedKts = finite(row.gs),
    rateFtMin = finite(row.baro_rate);
  const seen = finite(row.seen),
    seenPos = finite(row.seen_pos);
  return {
    id,
    reference: id,
    latitude,
    longitude,
    callsign: cleanText(row.flight),
    originCountry: null,
    positionTimeMs:
      snapshotTimeMs == null ? null : snapshotTimeMs - (seenPos ?? 0) * 1000,
    contactTimeMs:
      snapshotTimeMs == null || seen == null
        ? null
        : snapshotTimeMs - seen * 1000,
    baroAltitudeM: baroFt == null ? null : baroFt * 0.3048,
    ellipsoidAltitudeM: geoFt == null ? null : geoFt * 0.3048,
    onGround: cleanText(row.alt_baro).toLowerCase() === 'ground',
    speedMps: speedKts == null ? null : speedKts * 0.514444,
    courseDeg: finite(row.track),
    verticalRateMps: rateFtMin == null ? null : rateFtMin * 0.00508,
    category: row.category ?? null,
    typeCode: cleanText(row.t),
    registration: cleanText(row.r),
    operator: cleanText(row.ownOp),
  };
}

export function openSkySnapshot(
  payload,
  {
    source = 'OpenSky Network',
    sourceId = null,
    coverage = 'worldwide upstream snapshot',
    now = Date.now(),
    receivedAtMs = null,
    stale = false,
  } = {},
) {
  const admitted = admitRecords(
    payload?.states,
    normalizeOpenSkyAircraft,
    'OpenSky',
  );
  const observedAtMs = epoch(payload?.time, 1000);
  const ageMs = observedAtMs == null ? null : Math.max(0, now - observedAtMs);
  // I3a: stable machine sourceId and receipt time for provenance.
  // receivedAtMs = client receipt of this snapshot (now if not supplied).
  // sourceId = 'opensky' or 'adsb.lol' (from X-Flight-Source), not human label.
  const resolvedReceivedAtMs =
    Number.isFinite(receivedAtMs) && receivedAtMs > 0 ? receivedAtMs : now;
  // Normalize sourceId: if explicit, use it; else derive from source label for backward compat.
  let resolvedSourceId = sourceId;
  if (!resolvedSourceId) {
    const label = String(source || '').toLowerCase();
    if (label.includes('adsb.lol') || label.includes('adsb')) resolvedSourceId = 'adsb.lol';
    else if (label.includes('opensky')) resolvedSourceId = 'opensky';
    else resolvedSourceId = null;
  }
  return {
    ...admitted,
    source,
    sourceId: resolvedSourceId,
    coverage,
    observedAtMs,
    receivedAtMs: resolvedReceivedAtMs,
    ageMs,
    stale: stale || (ageMs != null && ageMs > 120000),
    freshness:
      observedAtMs == null
        ? 'unknown'
        : stale || ageMs > 120000
          ? 'stale'
          : 'current',
  };
}

export function readsbSnapshot(
  payload,
  {
    observedAtMs,
    source = 'adsb.lol',
    sourceId = 'adsb.lol',
    coverage = 'military upstream snapshot',
    now = Date.now(),
    receivedAtMs = null,
    stale = false,
  } = {},
) {
  const admitted = admitRecords(
    payload?.ac,
    (row) => normalizeReadsbAircraft(row, observedAtMs),
    'adsb.lol',
  );
  const ageMs = observedAtMs == null ? null : Math.max(0, now - observedAtMs);
  const resolvedReceivedAtMs =
    Number.isFinite(receivedAtMs) && receivedAtMs > 0 ? receivedAtMs : now;
  return {
    ...admitted,
    source,
    sourceId,
    coverage,
    observedAtMs,
    receivedAtMs: resolvedReceivedAtMs,
    ageMs,
    stale,
    freshness: observedAtMs == null ? 'unknown' : stale ? 'stale' : 'current',
  };
}

/** Track altitude remains barometric; renderers choose a visual ground fallback. */
export function normalizeAircraftTrack(
  rows,
  { baseTimeMs = 0, readsb = false } = {},
) {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row) => {
    if (!Array.isArray(row)) return [];
    const latitude = finite(row[1]),
      longitude = finite(row[2]);
    const offset = finite(row[0]);
    const observedAtMs =
      offset == null ? null : epoch(baseTimeMs + offset * 1000);
    if (
      !coordinates(latitude, longitude) ||
      observedAtMs == null ||
      observedAtMs <= 0
    )
      return [];
    const altitude = finite(row[3]);
    return [
      {
        latitude,
        longitude,
        observedAtMs,
        baroAltitudeM:
          altitude == null ? null : altitude * (readsb ? 0.3048 : 1),
        ellipsoidAltitudeM: null,
        onGround: readsb
          ? cleanText(row[3]).toLowerCase() === 'ground'
          : row[5] === true,
      },
    ];
  });
}

/** Known source identities are useful for classification even without positions. */
export function readsbIdentities(payload) {
  const admitted = admitRecords(
    payload?.ac,
    (row) => {
      const id = cleanText(row?.hex).toLowerCase();
      return id ? { id } : null;
    },
    'aircraft identities',
  );
  return admitted.records.map((record) => record.id);
}
