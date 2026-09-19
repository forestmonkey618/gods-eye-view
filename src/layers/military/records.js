import { pickRenderAltitudeM } from '../../data/renderAltitude.js';
import { stickyText, stickyNumber } from '../../data/aircraftMeta.js';
import { classifyAircraft } from '../../data/aircraftClass.js';
import { EPISTEMIC, createProvenance } from '../../data/provenance.js';
import {
  GROUND_FLOOR_WARM_MAX_ALT_M,
  LANDED_MISSING_POLL_LIMIT,
  MISSING_POLL_LIMIT,
} from './recordPolicy.js';

/** I3c: a REPORTED descriptor, or null when the batch carried no source
 * identity / receipt (legacy callers) — absence is truthful, a guess is not. */
function reportedProvenance(sourceId, reportedAtMs, receivedAtMs) {
  if (!sourceId || !Number.isFinite(receivedAtMs) || receivedAtMs <= 0)
    return null;
  try {
    return createProvenance({
      epistemic: EPISTEMIC.REPORTED,
      sourceId,
      reportedAtMs:
        Number.isFinite(reportedAtMs) && reportedAtMs > 0 ? reportedAtMs : null,
      receivedAtMs,
    });
  } catch {
    return null;
  }
}

/** I3c: a DERIVED descriptor for a locally computed field (never carries the
 * feed's sourceId — the feed did not assert the value). */
function derivedProvenance(via) {
  try {
    return createProvenance({ epistemic: EPISTEMIC.DERIVED, via });
  } catch {
    return null;
  }
}

/** Portable military aircraft metadata and bounded missing-poll retention. */
export class MilitaryFlightRecords {
  constructor({ geoidHeight, cachedGroundFloor, floorAltitudeM }) {
    this.services = { geoidHeight, cachedGroundFloor, floorAltitudeM };
    this.data = new Map();
    this.missingPolls = new Map();
    this.geoidNCache = new Map();
    this.geoidReady = false;
    // I3c: per-field provenance sidecar — Map<native record key, {field: descriptor}>.
    // STORE-LOCAL (keyed like `data`, including TIS-B `~...` ids — no canonical
    // identity is invented). CURRENT only: each field's descriptor follows the
    // value currently held in `data`; sticky retention keeps the descriptor of
    // the retained value; a synthetic fallback carries no descriptor at all.
    // Frozen descriptors, copy-safe. No history.
    this.provenance = new Map();
  }
  receive(
    aircraft,
    {
      observedAtMs,
      floorWarmPoints: _floorWarmPoints,
      modelOwnsVisual,
      sourceId = null,
      receivedAtMs = null,
    },
  ) {
    const { geoidHeight, cachedGroundFloor, floorAltitudeM } = this.services;
    const { id: icao24, longitude: lon, latitude: lat } = aircraft;
    this.missingPolls.delete(icao24);
    const prevMeta = this.data.get(icao24);
    // adsb.lol/readsb reports GROUND traffic as alt_baro === "ground" (no
    // separate boolean). Grounded planes fall back to their last known
    // altitude (field elevation is unknowable here), else 0 m — never the
    // 3 km airborne default (a parked plane must not float).
    const onGround = aircraft.onGround;
    const altitudeFt =
      aircraft.baroAltitudeM == null ? null : aircraft.baroAltitudeM / 0.3048;
    const altitudeM =
      aircraft.baroAltitudeM ??
      (onGround
        ? Number.isFinite(prevMeta?.altitudeFt)
          ? prevMeta.altitudeFt * 0.3048
          : 0
        : 3048);
    const track = aircraft.courseDeg || 0;
    const speedMps = aircraft.speedMps ?? 0;
    const verticalRateMps = aircraft.verticalRateMps;
    const callsign = aircraft.callsign;
    const type = aircraft.typeCode;
    const registration = aircraft.registration;
    const operator = aircraft.operator;
    const geoAltitudeM = aircraft.ellipsoidAltitudeM;
    const baroAltitudeM = aircraft.baroAltitudeM;

    // geoid undulation N: cached per-aircraft (negligible drift — see
    // task brief) once the geoid grid has loaded; unavailable pre-load
    // just means the baro fallback branch below adds N=0 for a beat.
    let geoidN = this.geoidNCache.get(icao24);
    if (geoidN === undefined && this.geoidReady) {
      geoidN = geoidHeight(lat, lon);
      this.geoidNCache.set(icao24, geoidN);
    }

    // GROUND-SNAP INTERPLAY (brief item 3 — "don't double-correct"): a
    // grounded plane's MODEL already rides groundSnap.js's one-shot tileset
    // sample (_modelDisplayPosition), which is the visual on the ground, and
    // its billboard is depth-test-free (_groundDepthDistance) so its exact
    // height is cosmetic. Deliberately pass surfaceM=null so
    // pickRenderAltitudeM's on-ground surface branch never fires here:
    //  1. It would be the SECOND correction of the same grounded plane
    //     (model tileset-snap is the first) — the exact double-correct the
    //     brief forbids.
    //  2. Military ground rows carry NO baro ("alt_baro":"ground"), so the
    //     grounded billboard sits at 0 m until a surface value warms; letting
    //     surfaceM then jump it 0 -> ~surface (often ~100 m) BETWEEN polls
    //     drags the model's ground-snap input past groundSnap's 50 m
    //     move-invalidation threshold and forces a re-sample every time the
    //     cache warms — breaking the ONE-SHOT-per-(camera,regime) invariant
    //     the track regression locks (qa: sampleHeight count must stay flat).
    // Grounded planes therefore keep the pre-existing `altitudeM` default
    // (last-known baro / 0). The datum fix (alt_geom -> baro+geoidN) is what
    // matters for AIRBORNE military planes — the actual "renders at MSL" bug.
    const pickedAltM = pickRenderAltitudeM({
      geoAltM: geoAltitudeM,
      baroAltM: baroAltitudeM,
      onGround,
      surfaceM: null,
      geoidN,
    });
    // pickRenderAltitudeM returns the sentinel `null` only when NEITHER
    // alt_geom nor alt_baro was ever reported for this aircraft (not even
    // stickily) — fall back to the SAME existing default policy `altitudeM`
    // already uses (which also carries the on-ground 0 m / last-known-baro
    // case), so the two never disagree on the "no data yet" case.
    let renderAltitudeM = pickedAltM != null ? pickedAltM : altitudeM;
    // Field-test fix (RS46 heli-in-hillside, 2026-07-06): a baro-only
    // AIRBORNE contact near steep terrain can compute a render height
    // BELOW the local surface (no alt_geom; baro+N carries QNH error
    // larger than the height above ground). Floor it at the coarse-grid
    // ellipsoidal ground (warm-cache read only — the batch warm below
    // fills cells for later polls). Grounded contacts are deliberately
    // NOT touched: their model rides groundSnap's tileset sample and
    // their billboard is depth-test-free (see the surfaceM:null block
    // above — same one-shot-invariant reasoning).
    if (!onGround && renderAltitudeM < GROUND_FLOOR_WARM_MAX_ALT_M) {
      renderAltitudeM = floorAltitudeM(
        renderAltitudeM,
        cachedGroundFloor(lat, lon),
      );
      _floorWarmPoints.push({ lat, lon });
    } else if (onGround) {
      // Grounded contacts: warm the floor cell, and — round 4 — when NO
      // 3D model owns this contact's visual, lift the billboard itself
      // onto the floor (mesh-first): the R20053 heli sat "straight up in
      // the ground" because grounded rows render at the legacy ~0 m.
      // With a model present the billboard stays put (it hides behind
      // the tileset-snapped model, and moving it would drag groundSnap's
      // input past its move-invalidation threshold — the T7 one-shot
      // invariant the track regression locks).
      _floorWarmPoints.push({ lat, lon });
      if (!modelOwnsVisual) {
        const floor = cachedGroundFloor(lat, lon);
        if (Number.isFinite(floor)) {
          renderAltitudeM = floorAltitudeM(renderAltitudeM, floor);
        }
      }
    }

    // Landing/takeoff transition: the ground flip restyles IN PLACE.
    const groundFlipped =
      !!prevMeta && (prevMeta.onGround === true) !== onGround;
    // Sticky merge — adsb.lol intermittently drops flight/t/r/ownOp; hold
    // last-known-good (bounded by the layer's eviction, which deletes the entry).
    const stickyType = stickyText(type, prevMeta?.type);
    const meta = {
      sourceReference: aircraft.reference,
      observedReceiptMs: Date.now(),
      callsign: stickyText(callsign, prevMeta?.callsign),
      type: stickyType,
      // Type outranks category automatically inside classifyAircraft.
      klass: classifyAircraft({
        typeCode: stickyType,
        category: aircraft?.category,
      }),
      registration: stickyText(registration, prevMeta?.registration),
      operator: stickyText(operator, prevMeta?.operator),
      altitudeFt: stickyNumber(altitudeFt, prevMeta?.altitudeFt, null),
      // geoAltitudeM/renderAltitudeM are ADDITIVE fields alongside the
      // untouched aviation `altitudeFt` — never rename/replace it (labels,
      // the FL readout, and the landed-fast-cull heuristic all still read
      // altitudeFt/baro).
      geoAltitudeM,
      renderAltitudeM,
      speedMps: stickyNumber(speedMps, prevMeta?.speedMps, null),
      track: stickyNumber(track, prevMeta?.track, null),
      // Analyst seam (additive): sticky like the other kinematics.
      verticalRateMps: stickyNumber(
        verticalRateMps,
        prevMeta?.verticalRateMps,
        null,
      ),
      lastContactEpochMs: stickyNumber(
        aircraft.contactTimeMs,
        prevMeta?.lastContactEpochMs,
        null,
      ),
      turnRateDps: prevMeta?.turnRateDps || 0,
      onGround,
      // Round 7: sticky airborne history (see _likelyLanded).
      wasAirborne: prevMeta?.wasAirborne === true || !onGround,
      // Raw poll-fix coords (pre-dead-reckon) — the stale-grounded
      // re-floor sweep keys floors off these (mirror of flights.js).
      rawLat: lat,
      rawLon: lon,
    };
    this.data.set(icao24, meta);
    this._recordProvenance(icao24, aircraft, prevMeta, {
      sourceId,
      receivedAtMs,
    });

    return {
      prevMeta,
      meta,
      groundFlipped,
      fixEpochMs: aircraft.positionTimeMs ?? observedAtMs,
    };
  }

  /**
   * I3c — provenance follows the CURRENT value just written to `data`.
   *
   * Timestamps (readsb/adsb.lol semantics, NOT OpenSky's): the payload carries
   * only two ages per aircraft — `seen_pos` (position last updated) and `seen`
   * (any message last received) — which the normalizer turns into
   * `positionTimeMs` / `contactTimeMs`. There are NO per-field report times, so:
   *  - position, altitudeFt, geoAltitudeM, onGround → positionTimeMs
   *    (the position-message group; same convention as the civil store);
   *  - speedMps, track, verticalRateMps, callsign, lastContactEpochMs →
   *    contactTimeMs, null when the row carried no `seen`;
   *  - type / registration / operator (readsb `t` / `r` / `ownOp`) are
   *    database lookups delivered BY adsb.lol, not transponder reports: still
   *    REPORTED by 'adsb.lol', but reportedAtMs is null — a database attribute
   *    has no event time and `seen` would be false precision.
   * Value semantics honoured exactly as the store writes them: `speedMps` and
   * `track` are coerced to a synthetic 0 BEFORE the sticky merge when the row
   * lacks gs/track, so a missing kinematic gets NO descriptor (the stored 0 is
   * not a report and not a retained report). Locally computed fields (klass,
   * wasAirborne, renderAltitudeM) are DERIVED and never inherit the feed id.
   * Internal bookkeeping (sourceReference, observedReceiptMs, turnRateDps,
   * rawLat/rawLon beyond `position`) is deliberately untagged.
   */
  _recordProvenance(icao24, aircraft, prevMeta, { sourceId, receivedAtMs }) {
    const prevProv = this.provenance.get(icao24) || {};
    const next = { ...prevProv };
    const positionReportedAtMs =
      Number.isFinite(aircraft.positionTimeMs) && aircraft.positionTimeMs > 0
        ? aircraft.positionTimeMs
        : null;
    const contactReportedAtMs =
      Number.isFinite(aircraft.contactTimeMs) && aircraft.contactTimeMs > 0
        ? aircraft.contactTimeMs
        : null;
    const reported = (reportedAtMs) =>
      reportedProvenance(sourceId, reportedAtMs, receivedAtMs);

    /** Replacement: the row asserted the value this poll. */
    const replace = (field, reportedAtMs) => {
      const prov = reported(reportedAtMs);
      if (prov) next[field] = prov;
      else delete next[field];
    };
    /** Sticky number: replacement when reported, retention when the store
     * kept the previous finite value, otherwise (null) no descriptor. */
    const stickyNumberProv = (field, reportedNow, prevValue, reportedAtMs) => {
      if (reportedNow) replace(field, reportedAtMs);
      else if (!Number.isFinite(prevValue)) delete next[field];
      // else: retention — the previous descriptor already follows the value
    };
    /** Sticky text: same shape for callsign / type / registration / operator. */
    const stickyTextProv = (field, reportedNow, prevValue, reportedAtMs) => {
      if (reportedNow) replace(field, reportedAtMs);
      else if (!String(prevValue || '').trim()) delete next[field];
    };

    // Position — admitted rows always carry a finite lat/lon (replacement).
    if (
      Number.isFinite(aircraft.latitude) &&
      Number.isFinite(aircraft.longitude)
    )
      replace('position', positionReportedAtMs);
    else delete next.position;

    // Position-message group.
    stickyNumberProv(
      'altitudeFt',
      Number.isFinite(aircraft.baroAltitudeM),
      prevMeta?.altitudeFt,
      positionReportedAtMs,
    );
    if (Number.isFinite(aircraft.ellipsoidAltitudeM))
      replace('geoAltitudeM', positionReportedAtMs);
    else delete next.geoAltitudeM; // non-sticky: null when the row lacks alt_geom
    replace('onGround', positionReportedAtMs); // boolean, always replaced

    // Kinematics / identification — general-message time.
    // speedMps / track: the store writes a synthetic 0 when the row lacks the
    // value (coercion precedes the sticky merge), so only a finite raw
    // observation earns a descriptor; the synthetic 0 carries none.
    if (Number.isFinite(aircraft.speedMps))
      replace('speedMps', contactReportedAtMs);
    else delete next.speedMps;
    if (Number.isFinite(aircraft.courseDeg))
      replace('track', contactReportedAtMs);
    else delete next.track;
    stickyNumberProv(
      'verticalRateMps',
      Number.isFinite(aircraft.verticalRateMps),
      prevMeta?.verticalRateMps,
      contactReportedAtMs,
    );
    stickyNumberProv(
      'lastContactEpochMs',
      Number.isFinite(aircraft.contactTimeMs),
      prevMeta?.lastContactEpochMs,
      contactReportedAtMs,
    );
    stickyTextProv(
      'callsign',
      !!String(aircraft.callsign || '').trim(),
      prevMeta?.callsign,
      contactReportedAtMs,
    );

    // Database-backed identity delivered by the feed: no event time (null).
    stickyTextProv(
      'type',
      !!String(aircraft.typeCode || '').trim(),
      prevMeta?.type,
      null,
    );
    stickyTextProv(
      'registration',
      !!String(aircraft.registration || '').trim(),
      prevMeta?.registration,
      null,
    );
    stickyTextProv(
      'operator',
      !!String(aircraft.operator || '').trim(),
      prevMeta?.operator,
      null,
    );

    // Locally computed — DERIVED, same `via` vocabulary as the civil store.
    const klass = derivedProvenance('classification');
    if (klass) next.klass = klass;
    const airborne = derivedProvenance('airborne-history');
    if (airborne) next.wasAirborne = airborne;
    const render = derivedProvenance('render-altitude-selection');
    if (render) next.renderAltitudeM = render;

    if (Object.keys(next).length === 0) this.provenance.delete(icao24);
    else this.provenance.set(icao24, next);
  }
  absence(id, { complete, likelyLanded }) {
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
    this.provenance.delete(id);
  }
}
