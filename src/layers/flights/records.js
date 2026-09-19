import { stickyNumber, stickyText } from '../../data/aircraftMeta.js';
import {
  geoidSurfaceLastResortM,
  pickRenderAltitudeM,
} from '../../data/renderAltitude.js';
import { classifyAircraft } from '../../data/aircraftClass.js';
import {
  approxDistanceKm,
  GROUND_FLOOR_CLAMP_RADIUS_KM,
  GROUND_FLOOR_WARM_MAX_ALT_M,
  LANDED_MISSING_POLL_LIMIT,
  MISSING_POLL_LIMIT,
} from './recordPolicy.js';
import { EPISTEMIC, createProvenance } from '../../data/provenance.js';

/** Source-independent aircraft metadata and bounded missing-poll retention. */
export class FlightRecords {
  constructor({ geoidHeight, cachedGroundFloor, floorAltitudeM }) {
    this.services = {
      geoidHeight,
      cachedGroundFloor,
      floorAltitudeM,
    };
    this.data = new Map();
    this.missingPolls = new Map();
    this.geoidNCache = new Map();
    this.geoidReady = false;
    // I3a: current position provenance sidecar — Map<icao24, provenance descriptor>
    // Position = rawLat/rawLon/fix. CURRENT only, no history.
    this.positionProvenance = new Map();
    // I3b: full per-field provenance sidecar — Map<icao24, {field: descriptor}>
    // Each field's provenance follows its current value (sticky retention retains old provenance).
    // Copy-safe frozen descriptors. CURRENT only, no history.
    this.provenance = new Map();
  }

  receive(
    observation,
    {
      viewerLatDeg,
      viewerLonDeg,
      trackedId,
      floorWarmPoints,
      sourceId,
      receivedAtMs,
    } = {},
  ) {
    const { geoidHeight, cachedGroundFloor, floorAltitudeM } = this.services;
    const {
      id: icao24,
      callsign,
      originCountry: origin_country,
      longitude: lon,
      latitude: lat,
      baroAltitudeM: baro_alt,
      onGround: on_ground,
      speedMps: velocity,
      courseDeg: true_track,
      ellipsoidAltitudeM: geo_alt,
      category,
      verticalRateMps: vertical_rate,
    } = observation;

    const onGround = on_ground === true;
    this.missingPolls.delete(icao24);
    // Sticky merge: OpenSky intermittently drops callsign/velocity/track for
    // aircraft it still positions — hold last-known-good instead of
    // regressing to the ICAO hex / a 0° (north) heading. Bounded by the
    // MISSING_POLL_LIMIT eviction below, which deletes the whole entry.
    const prevMeta = this.data.get(icao24);
    const prevProv = this.provenance.get(icao24) || {};
    // Grounded planes with no baro reading sit at 0 m, not the 10 km
    // airborne default (a parked plane must never float).
    // NOTE (height-datum fix): `alt` stays the AVIATION field — the sticky
    // barometric/MSL altitude read by labels (FL/altitude readout),
    // route-plausibility, and follow-camera range heuristics. It is
    // NEVER overwritten or renamed. Where the aircraft actually RENDERS
    // on the ellipsoidal globe is a SEPARATE value (renderAltitudeM,
    // below) — geo_altitude when OpenSky reports it (already WGS84
    // ellipsoidal), else baro+geoid as a visual fallback, else ground
    // surface when parked. `Cartesian3.fromDegrees` gets renderAltitudeM,
    // never `alt` directly.
    const alt = stickyNumber(
      baro_alt,
      prevMeta?.altitude,
      onGround ? 0 : 10000,
    );

    // geoid undulation N: cached per-aircraft (negligible drift — see
    // task brief) once the geoid grid has loaded; unavailable pre-load
    // just means the baro fallback branch below adds N=0 for a beat.
    let geoidN = this.geoidNCache.get(icao24);
    if (geoidN === undefined && this.geoidReady) {
      geoidN = geoidHeight(lat, lon);
      this.geoidNCache.set(icao24, geoidN);
    }

    // on_ground surface prior: ONLY synchronous warm-cache reads here —
    // never a per-aircraft network fetch inside the poll loop (see the
    // batch resolve call below, which fills this cache for NEXT poll). A
    // Round 5 SIMPLIFICATION (owner directive: one floor, evenly applied):
    // the grounded surface is the round-4 choke point and nothing else —
    // rendered-mesh cell first, real (never fallback-poisoned) DEM cell
    // second. The old exact-5-decimal warm chain is GONE: it minted a new
    // key per parked-jitter poll for every grounded contact ON EARTH,
    // hammering Re:Earth into the very failures that poisoned the cache.
    let surfaceM = null;
    if (onGround) {
      surfaceM = cachedGroundFloor(lat, lon); // mesh ?? real DEM (coarse cell)
      // Taxiing crosses into a fresh cold cell every poll — always one
      // step ahead of the warm batch — so fall back to LAST poll's cell
      // (warmed by last poll's batch; aprons are flat across adjacent
      // 111 m cells). Round-5 verify caught taxiing contacts stuck at
      // the geoid without this (round 2's lesson, at cell granularity).
      if (
        surfaceM == null &&
        Number.isFinite(prevMeta?.rawLat) &&
        Number.isFinite(prevMeta?.rawLon)
      ) {
        surfaceM = cachedGroundFloor(prevMeta.rawLat, prevMeta.rawLon);
      }
      // Grounded contacts near the viewer feed the floor warm/sampler
      // (the only ones whose exact height is visible; far contacts are
      // subpixel and always-on-top anyway).
      if (
        viewerLatDeg != null &&
        approxDistanceKm(viewerLatDeg, viewerLonDeg, lat, lon) <=
          GROUND_FLOOR_CLAMP_RADIUS_KM
      ) {
        floorWarmPoints.push({ lat, lon });
      }
      // Last synchronous resort for a BRAND-NEW grounded contact with NO
      // altitude data at all (nothing warm yet, not even the coarse
      // cell): the geoid surface. At the sea-level airports where most
      // grounded traffic sits, geoidN IS the local ellipsoidal ground to
      // within metres — instantly right — and at elevated fields it is
      // far less wrong than the raw 0 m ellipsoid default for the one
      // poll until the coarse cell warms. STRICTLY gated on "no geo, no
      // baro": a reported baro already reflects the field elevation, and
      // pickRenderAltitudeM's surfaceM branch would let this crude guess
      // outrank it (caught by the ground-3d track regression).
      //
      // 2026-08-21: the rule moved to geoidSurfaceLastResortM, which adds
      // one more gate — a contact that already HAS a render height keeps
      // it. Leaving surfaceM null routes it through the sentinel path
      // below, which holds that height.
      if (surfaceM == null) {
        surfaceM = geoidSurfaceLastResortM({
          geoAltM: geo_alt,
          baroAltM: baro_alt,
          priorRenderM: prevMeta?.renderAltitudeM,
          geoidN,
        });
      }
    }

    const geoAltitudeM = Number.isFinite(geo_alt) ? geo_alt : null;
    const pickedAltM = pickRenderAltitudeM({
      geoAltM: geoAltitudeM,
      baroAltM: Number.isFinite(baro_alt) ? baro_alt : null,
      onGround,
      surfaceM,
      geoidN,
    });
    // pickRenderAltitudeM returns the sentinel `null` only when NEITHER
    // geo_altitude nor baro_altitude was reported THIS poll. Two fallbacks,
    // in priority order:
    //   (1) hold the previous geoid-corrected render height if we have one —
    //       a one-poll baro dropout must NOT snap the plane down by the geoid
    //       undulation N (~46 m in London) and back up next poll. `alt` stays
    //       sticky for labels, so holding the last render height keeps the two
    //       layers consistent through the gap.
    //   (2) otherwise the SAME default policy `alt` already uses, so the two
    //       never disagree on the genuine "no data yet" case (a never-reported
    //       aircraft has no prior render height, so it lands here unchanged).
    let renderAltitudeM;
    if (pickedAltM != null) {
      renderAltitudeM = pickedAltM;
    } else if (Number.isFinite(prevMeta?.renderAltitudeM)) {
      renderAltitudeM = prevMeta.renderAltitudeM;
    } else {
      renderAltitudeM = alt;
    }
    // Field-test fix (WAKE01/RS46 class, 2026-07-06; widened round 3):
    // floor a low airborne contact's render height at the local coarse
    // ground so it can never dive below the mesh. Round 3 (Austin
    // fleet-underground): baro can read BELOW an elevated field — SWA696
    // showed 450 ft at Austin's 542 ft field elevation — and rollout/taxi
    // traffic that OpenSky hasn't flagged on_ground yet renders from that
    // baro, so the whole fleet sat buried at AUS in 2D. Clamping every
    // global contact would need unbounded terrain resolution; instead the
    // clamp covers the TRACKED contact (always) plus every low contact
    // within GROUND_FLOOR_CLAMP_RADIUS_KM of the viewer — the only ones
    // whose burial is visible. Cells warm in one batch after the loop.
    // Airborne only (grounded planes keep the surface-cache path above).
    if (
      !onGround &&
      renderAltitudeM < GROUND_FLOOR_WARM_MAX_ALT_M &&
      (icao24 === trackedId ||
        (viewerLatDeg != null &&
          approxDistanceKm(viewerLatDeg, viewerLonDeg, lat, lon) <=
            GROUND_FLOOR_CLAMP_RADIUS_KM))
    ) {
      renderAltitudeM = floorAltitudeM(
        renderAltitudeM,
        cachedGroundFloor(lat, lon),
      );
      floorWarmPoints.push({ lat, lon });
    }

    // Landing/takeoff transition: the on_ground flip restyles IN PLACE.
    const groundFlipped =
      !!prevMeta && (prevMeta.onGround === true) !== onGround;
    // Store flight metadata for click-to-track labels
    const cat = stickyNumber(category, prevMeta?.category, null);
    const meta = {
      sourceReference: observation.reference,
      observedReceiptMs: Date.now(),
      callsign: stickyText(callsign, prevMeta?.callsign),
      altitude: alt,
      // geoAltitudeM/renderAltitudeM are ADDITIVE fields alongside the
      // untouched aviation `altitude` — never rename/replace it (labels,
      // FL readout, route-plausibility, and follow-camera range math all
      // still read `altitude`/baro).
      geoAltitudeM,
      renderAltitudeM,
      onGround,
      // Round 7: sticky airborne history — the landed fast-cull only
      // applies to contacts that actually flew this session.
      wasAirborne: prevMeta?.wasAirborne === true || !onGround,
      velocity: stickyNumber(velocity, prevMeta?.velocity, 0),
      true_track: stickyNumber(true_track, prevMeta?.true_track, 0),
      category: cat,
      // An adsbdb-enriched type code outranks the coarse OpenSky category.
      klass: classifyAircraft({
        typeCode: prevMeta?.typeCode ?? null,
        category: cat,
      }),
      turnRateDps: prevMeta?.turnRateDps || 0,
      verticalRate: stickyNumber(vertical_rate, prevMeta?.verticalRate, null),
      // Analyst seam: OpenSky origin_country (state[2]) — additive, sticky
      // like callsign so a transient blank row doesn't blank the field.
      originCountry:
        stickyText(origin_country, prevMeta?.originCountry) || null,
      // OpenSky distinguishes the last position epoch from the last
      // transponder message. The fleet coast horizon uses this actual
      // contact time so a temporarily old position does not hard-freeze
      // while fresh velocity/track messages are still arriving.
      lastContactEpochMs: stickyNumber(
        observation.contactTimeMs,
        prevMeta?.lastContactEpochMs,
        null,
      ),
      // adsbdb enrichment — written by the enrichment callbacks, carried across polls:
      typeCode: prevMeta?.typeCode ?? null,
      typeName: prevMeta?.typeName ?? null,
      registration: prevMeta?.registration ?? null,
      airline: prevMeta?.airline ?? null,
      route: prevMeta?.route ?? null,
      // The RAW poll fix lat/lon (this tick's OpenSky state-vector
      // coords, pre-dead-reckon) — kept distinct from the continuously
      // dead-reckoned billboard position for any consumer that needs the
      // actual reported fix.
      rawLat: lat,
      rawLon: lon,
    };
    this.data.set(icao24, meta);

    const fixEpochMs =
      Number.isFinite(observation.positionTimeMs) &&
      observation.positionTimeMs > 0
        ? observation.positionTimeMs
        : Date.now();

    // --- I3a+I3b provenance: CURRENT only, follows current value ---
    // Helpers
    const hasValidPosition =
      Number.isFinite(lat) && Math.abs(lat) <= 90 && Number.isFinite(lon) && Math.abs(lon) <= 180;
    const positionReportedAtMs =
      Number.isFinite(observation.positionTimeMs) && observation.positionTimeMs > 0
        ? observation.positionTimeMs
        : null;
    const contactReportedAtMs =
      Number.isFinite(observation.contactTimeMs) && observation.contactTimeMs > 0
        ? observation.contactTimeMs
        : positionReportedAtMs; // fallback to position time if contact missing

    function tryReported(sourceIdVal, reportedAtMsVal, receivedAtMsVal) {
      if (!sourceIdVal || !Number.isFinite(receivedAtMsVal)) return null;
      try {
        return createProvenance({
          epistemic: EPISTEMIC.REPORTED,
          sourceId: sourceIdVal,
          reportedAtMs: reportedAtMsVal,
          receivedAtMs: receivedAtMsVal,
        });
      } catch {
        return null;
      }
    }
    function tryDerived(via) {
      try {
        return createProvenance({
          epistemic: EPISTEMIC.DERIVED,
          via,
        });
      } catch {
        return null;
      }
    }

    const newProv = { ...prevProv };

    // Position — always replacement when valid position present
    if (hasValidPosition) {
      const prov = tryReported(sourceId, positionReportedAtMs, receivedAtMs);
      if (prov) {
        this.positionProvenance.set(icao24, prov);
        newProv.position = prov;
      } else {
        // No source info for new position — remove old to avoid lying
        if (sourceId == null && receivedAtMs == null) {
          // Legacy path without source — delete old provenance to avoid stale label
          const had = this.positionProvenance.get(icao24);
          if (had) this.positionProvenance.delete(icao24);
          delete newProv.position;
        } else {
          // If we have sourceId but creation failed (invalid), keep absent
          this.positionProvenance.delete(icao24);
          delete newProv.position;
        }
      }
    }
    // else retain previous position provenance (do not overwrite)

    // Helper to handle stickyNumber fields with fallback synthetic detection
    function handleStickyNumber(fieldName, nextVal, prevVal, fallbackVal, reportedAtMsVal) {
      const nextFinite = Number.isFinite(nextVal);
      const prevFinite = Number.isFinite(prevVal);
      if (nextFinite) {
        // replacement
        const prov = tryReported(sourceId, reportedAtMsVal, receivedAtMs);
        if (prov) newProv[fieldName] = prov;
        else {
          // If no source info, remove old provenance to avoid stale
          if (sourceId == null && receivedAtMs == null) delete newProv[fieldName];
          else delete newProv[fieldName];
        }
      } else if (prevFinite) {
        // retention — keep old provenance (do nothing, already in newProv via spread)
        // Ensure it exists, else leave absent
      } else {
        // fallback or null — no provenance (synthetic or absent)
        delete newProv[fieldName];
      }
    }

    function handleStickyText(fieldName, nextVal, prevVal, reportedAtMsVal) {
      const nextClean = String(nextVal || '').trim();
      const prevClean = String(prevVal || '').trim();
      if (nextClean) {
        const prov = tryReported(sourceId, reportedAtMsVal, receivedAtMs);
        if (prov) newProv[fieldName] = prov;
        else delete newProv[fieldName];
      } else if (prevClean) {
        // retention — keep old
      } else {
        delete newProv[fieldName];
      }
    }

    // altitude (baro) — REPORTED when finite, position time
    // Distinguish synthetic fallback: if both next and prev not finite, it's fallback 0/10000 -> no provenance
    {
      const nextFinite = Number.isFinite(baro_alt);
      const prevFinite = Number.isFinite(prevMeta?.altitude);
      if (nextFinite) {
        const prov = tryReported(sourceId, positionReportedAtMs, receivedAtMs);
        if (prov) newProv.altitude = prov;
        else delete newProv.altitude;
      } else if (prevFinite) {
        // retain old provenance (already spread)
        // But if prev was fallback synthetic (no provenance), keep absent
      } else {
        delete newProv.altitude;
      }
    }

    // geoAltitudeM — non-sticky, null when missing
    {
      if (Number.isFinite(geo_alt)) {
        const prov = tryReported(sourceId, positionReportedAtMs, receivedAtMs);
        if (prov) newProv.geoAltitudeM = prov;
        else delete newProv.geoAltitudeM;
      } else {
        delete newProv.geoAltitudeM;
      }
    }

    // velocity — stickyNumber fallback 0 synthetic
    handleStickyNumber('velocity', velocity, prevMeta?.velocity, 0, contactReportedAtMs);
    // true_track
    handleStickyNumber('true_track', true_track, prevMeta?.true_track, 0, contactReportedAtMs);
    // verticalRate — fallback null
    handleStickyNumber('verticalRate', vertical_rate, prevMeta?.verticalRate, null, contactReportedAtMs);
    // category — fallback null
    handleStickyNumber('category', category, prevMeta?.category, null, contactReportedAtMs);
    // lastContactEpochMs — stickyNumber null, value is contactTimeMs itself
    handleStickyNumber('lastContactEpochMs', observation.contactTimeMs, prevMeta?.lastContactEpochMs, null, contactReportedAtMs);

    // callsign — stickyText
    handleStickyText('callsign', callsign, prevMeta?.callsign, contactReportedAtMs);
    // originCountry — stickyText || null
    handleStickyText('originCountry', origin_country, prevMeta?.originCountry, contactReportedAtMs);

    // onGround — always replacement, boolean
    {
      const prov = tryReported(sourceId, positionReportedAtMs, receivedAtMs);
      if (prov) newProv.onGround = prov;
      else {
        // If no source info but we have new onGround value, remove old to avoid stale? For legacy tests without source, delete.
        if (sourceId == null && receivedAtMs == null) {
          // legacy: if we never had provenance, leave absent; if we had, keep? Actually new onGround with no source -> remove old to avoid lying
          const had = prevProv.onGround;
          if (had) delete newProv.onGround;
        } else {
          delete newProv.onGround;
        }
      }
    }

    // DERIVED fields — always present, via only
    // klass: classification from typeCode+category
    {
      const prov = tryDerived('classification');
      if (prov) newProv.klass = prov;
    }
    // wasAirborne: airborne-history
    {
      const prov = tryDerived('airborne-history');
      if (prov) newProv.wasAirborne = prov;
    }
    // renderAltitudeM: render-altitude-selection (includes ground-floor clamp)
    {
      const prov = tryDerived('render-altitude-selection');
      if (prov) newProv.renderAltitudeM = prov;
    }

    // Enrichment fields: typeCode, registration, etc are retained via prevMeta but their provenance
    // is managed by enrichment callbacks (see enrichment.js). Here we retain existing enrichment
    // provenance from prevProv if present, unless enrichment callback overwrote it.
    // Since receive() does not set enrichment values, we just keep whatever prev provenance had
    // for enrichment fields (already spread). No new provenance created here.

    // Prune empty? Keep at least position etc.
    // If newProv has no keys, delete map entry to keep sparse.
    if (Object.keys(newProv).length === 0) {
      this.provenance.delete(icao24);
    } else {
      this.provenance.set(icao24, newProv);
    }

    return { icao24, prevMeta, meta, groundFlipped, fixEpochMs };
  }

  absence(id, { complete, likelyLanded }) {
    // Partial admissions do not prove absence, but retention remains bounded.
    if (
      !complete &&
      Date.now() - (this.data.get(id)?.observedReceiptMs ?? 0) < 300000
    )
      return 'retain';
    const misses = (this.missingPolls.get(id) || 0) + 1;
    const limit = likelyLanded ? LANDED_MISSING_POLL_LIMIT : MISSING_POLL_LIMIT;
    if (misses < limit) {
      this.missingPolls.set(id, misses);
      return 'stale';
    }
    this.missingPolls.delete(id);
    return 'remove';
  }

  forget(id) {
    this.data.delete(id);
    this.missingPolls.delete(id);
    this.geoidNCache.delete(id);
    this.positionProvenance.delete(id);
    this.provenance.delete(id);
  }
}
