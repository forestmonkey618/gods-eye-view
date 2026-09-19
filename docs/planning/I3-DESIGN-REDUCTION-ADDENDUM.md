# I3 DESIGN REDUCTION ADDENDUM — Provenance / Epistemic Typing

**Status:** I3a IMPLEMENTED — minimal provenance primitive + aircraft position provenance. I3b IMPLEMENTED — aircraft current-field / sticky provenance (REPORTED + DERIVED + enrichment). I3c IMPLEMENTED (2026-09-19, pending owner review) — military-store current-field provenance (`MilitaryFlightRecords.provenance`, `militaryFlightsLayer.getProvenanceMap()`, readsb `seen`/`seen_pos` timestamp semantics, db-backed identity `reportedAtMs null`) + civil lifecycle/suppression-sweep provenance cleanup; turnRateDps → no provenance (internal motion input); adsbdb cache → no fix (I5 owns age). See `I3c-IMPLEMENTATION-REPORT.md`. Previous research phase closed.
**Date:** 2026-09-18 I3a slice + I3b slice. Evidence from actual checkout at `arena/01a0b2f3-gods-eye-view` traced server/providers/aircraft/opensky.js → API/route → X-Flight-Source handling → client src/sources/live/standalone.js → FlightRecords.receive() → getCurrentEntities() and enrichment callbacks.
**Purpose:** Reduce speculative 7-class model to smallest correct substrate before owner approval, then implement minimal vertical slices truthfully.

**I3a Scope (owner-approved):** src/data/provenance.js (EPISTEMIC 4 + createProvenance validation sourceId ^[a-z0-9._:-]+$ 1..128 no whitespace, reportedAtMs optional null, receivedAtMs required for REPORTED), aircraft POSITION only (rawLat/rawLon), sidecar getProvenanceMap() keeping getCurrentEntities() I2 primitive-only unchanged, focused tests, surgical doc corrections. No full aircraft provenance, no general sticky, no vessel/satellite, no I4/I5/I6/I9, no recordIndex behavior change, no entity identity change.

**I3b Scope (owner-approved, implemented):** Expand provenance to other meaningful CURRENT aircraft fields that FlightRecords retains, enriches, or derives, with invariant provenance follows current value. Implements REPORTED for altitude, geoAltitudeM, velocity, true_track, verticalRate, callsign, originCountry, category, onGround, lastContactEpochMs (plus position), DERIVED for klass (via classification), wasAirborne (via airborne-history), renderAltitudeM (via render-altitude-selection), ENRICHMENT for typeCode, registration, airline, route, typeName (REPORTED sourceId adsbdb, reportedAtMs null, receivedAtMs enrichment receipt). Storage Map<icao24, {field: descriptor}> per-field sparse, copy-safe, CURRENT only, no history, TIS-B included store-local, getCurrentEntities unchanged, recordIndex unchanged, D9 untouched, military deferred. Provenance.js expanded with via validation, DERIVED requires via. Tests 22 new (18+4) + 35 I3a = 57 provenance, total 149 pass.

**Source correction (traced exact path):** flights store = general aircraft store, primary OpenSky, OpenSky route can fallback to adsb.lol regional 250nm via X-Flight-Source: adsb.lol header (server/providers/aircraft/opensky.js serveAdsbLolPointFallback sets header, primary openSkyProxy does NOT set X-Flight-Source, only X-OpenSky-*), client createOpenSkySource.getSnapshot reads header(response,'x-flight-source')||'OpenSky Network' normalized to stable machine sourceId opensky/adsb.lol, military uses adsb.lol via createAdsbLolSource, adsbdb enrichment, sticky merge across time inside store; Do NOT encode flights==opensky or military==adsb.lol invariant. StoreId = GEV ownership flights/military/vessels, sourceId = I3 stable machine id opensky/adsb.lol not storeId.

---

## Preservation

Accepted unless contradicted by code:

A. REPORTED preferable to OBSERVED.
B. Current record can contain fields from different times/origins (aircraft sticky, adsbdb enrichment, vessel static/position conceptually) → pure record-level provenance insufficient.
C. Persistent observation IDs NOT required.
D. CURRENT only, no history, replaced => replaced provenance, sticky-retained retains provenance of observation that supplied still-current value.
E. Unit conversion does NOT change REPORTED to DERIVED.
F. recordIndex remains I2 identity/current indexing, must NOT become provenance authority.
G. I4 remains source/sensor registry.
H. I5 owns freshness/staleness/coverage.
I. I9 owns change/event semantics.

---

### 1. Smallest final epistemic vocabulary

**4 classes:** `REPORTED`, `DERIVED`, `MODELED`, `INTERPRETED`

Rationale:
- REPORTED: externally supplied fact after safe trim/unit-conversion.
- DERIVED: deterministic, inspectable computation from REPORTED/MODELED (renderAltitude selection, classification, distance).
- MODELED: deterministic model approximating reality where model epoch matters (SGP4 propagation, groundFloor, dead-reckon). Reproducible given model inputs.
- INTERPRETED: non-deterministic judgement, AI narration, human interpretation.

SIMULATED and PREDICTED and UNKNOWN removed from core enum (see below). This preserves meaningful trust distinction without mixing dimensions.

### 2. Whether PREDICTED is class or temporal/model metadata

**Temporal/model metadata, NOT class.**

Evidence:
- `src/layers/satellites/orbits.js:propagatePosition(satrec, date)` — same SGP4 model produces current position when `date=now` and future pass when `date=tomorrow`.
- `orbitTrackFromRecord` computes `current` via `propagatePosition(satrec, referenceDate=new Date())` and `positionAt: (date)=>propagatePosition(satrec, date)` for future.
- Consumer `getNextIssPass` uses `findNextIssPass({satrec, fromMs: Date.now()})` — future search.

Model does not change epistemic method when target time changes. Distinction is `targetAtMs`.

Proposed:
```
epistemic: MODELED
modelEpochMs: satrec epoch (jday converted)
targetAtMs: Date to propagate to
reportedAtMs: TLE fetch time
```
If `targetAtMs` > now, consumer may render as predicted, but provenance remains MODELED. No PREDICTED class needed. Age = asOf - reportedAtMs, prediction horizon = targetAtMs - modelEpochMs computable.

### 3. Whether UNKNOWN is class or absence

**Absence/null provenance, NOT class.**

If `provenance` missing, it means I3 metadata not yet attached. Adding UNKNOWN would conflate "GEV knows this is epistemically unknown" with "metadata not attached yet". For current-state only, absence is honest.

If we need to represent "source explicitly says unknown", that belongs in domain field (e.g., `confidence=null`), not epistemic class.

### 4. Exact INTERPRETED definition

**INTERPRETED = a value whose production involved non-deterministic language-model or human judgement that is NOT reproducible from deterministic inputs alone, and whose output is a natural-language or semantic judgement rather than a physical measurement.**

Locked distinction:
- `classifyAircraft({typeCode, category})` in `src/data/aircraftClass.js` — deterministic table lookup → DERIVED.
- `pickRenderAltitudeM({geoAltM, baroAltM, onGround, surfaceM, geoidN})` in `src/data/renderAltitude.js` — deterministic priority chain → DERIVED.
- `geoidSurfaceLastResortM`, `reuseGroundedSurfaceM`, `vesselDatumHeightM` — deterministic → DERIVED.
- Provider-supplied classification (e.g., OSM `type`, FIRMS `confidence`) — REPORTED (provider assertion), not INTERPRETED.
- Deterministic rule-based semantic label (e.g., `if speed<5 and onGround then "taxiing"`) — DERIVED if rule is inspectable and deterministic.
- LLM says "this activity may indicate..." — INTERPRETED.
- AI summary, brief narrative, analyst voice phrasing — INTERPRETED.

**INTERPRETED belongs in same primitive for uniformity, but MUST be restricted:** physical fields (lat/lon/alt/velocity) MUST NEVER be INTERPRETED. INTERPRETED only allowed on analyst/narrative outputs (`summary`, `scopeLabel`, brief text, cockpit context strings). Enforced by future architecture check: if `epistemic===INTERPRETED` and field in {lat,lon,altitudeM,velocity}, fail.

### 5. Exact REPORTED definition

**REPORTED = a value supplied by an external source, preserved after only safe, reversible, non-semantic transformations (trim, case-normalize, unit conversion via fixed factor, coordinate validation), with sourceId and timestamps attached, and whose truth claim is the source's, not GEV's.**

Includes:
- OpenSky `row[6]=lat`, `row[5]=lon`, `row[7]=baro_alt`, `row[1]=callsign` after `cleanText` trim.
- readsb `alt_baro` feet *0.3048 → meters, `gs` knots *0.514444 → m/s — still REPORTED, via='unit-conversion'.
- AIS `mmsi` string trim, `speed` m/s→knots /0.514444, `lat/lon` finite check.
- USGS `properties.mag`, `place`, `time` (SOURCE_EVENT_TIME).
- FIRMS `lat/lon/frp/confidence/satellite/acqMs`.
- OSM static `name`, `type`, camera packs metadata.
- adsbdb `typeCode/registration/airline/route` — REPORTED, even though enrichment path, sourceId=adsbdb.

Does NOT include: renderAltitudeM, klass, wasAirborne, distance, heatScore — those are DERIVED.

### 6. Exact DERIVED definition

**DERIVED = a value computed deterministically from one or more REPORTED or MODELED inputs via a named, inspectable, pure operation, reproducible given same inputs and same code version.**

Examples:
- `renderAltitudeM = pickRenderAltitudeM({geoAltM, baroAltM, onGround, surfaceM, geoidN})` — priority chain + geoid correction + ground floor.
- `geoidN = geoidHeight(lat,lon)` cached per aircraft.
- `klass = classifyAircraft({typeCode, category})`.
- `wasAirborne = prev.wasAirborne || !onGround`.
- `distanceM`, `surfaceM`, `slantM`, `bearingDeg` from `src/data/geo.js`.
- `heatScore`, `frpPixelSize`, `detectionColorStop` in FIRMS model.
- `sectorAreaKm2`, `projectPoint` in CCTV model.
- `vesselDatumHeightM(geoidN, liftM) = N + lift`.

DERIVED provenance: `epistemic: DERIVED, via: 'render-altitude-selection' | 'geoid-correction' | 'classification' | 'ground-floor' | 'distance' | ...`, plus `inputs` reference optional, `sourceId` = GEV internal or null, `reportedAtMs` = max of input reported times, `receivedAtMs` = when derived.

### 7. Exact MODELED definition if retained

**MODELED = a value produced by a deterministic physical or statistical model that approximates reality, where model has its own epoch distinct from target time, and where output is not directly reported by source but propagated/estimated.**

Retained, because SGP4 and groundFloor cannot be REPORTED or DERIVED without losing meaning.

Examples:
- `propagatePosition(satrec, date)` → `{longitude, latitude, altitude, speedMps}` — MODELED, modelEpochMs = satrec epoch (jday), targetAtMs = date, via='sgp4-propagation'.
- `orbitPath = computeOrbitPath(satrec, referenceDate)` — MODELED, array of positions, via='sgp4-orbit-path'.
- `surfaceM = cachedGroundFloor(lat,lon)` when used as visual floor — MODELED (terrain model), via='ground-floor-model', modelEpochMs = DEM/mesh epoch if known.
- Dead-reckon `parts.motion._deadReckon(icao24)` extrapolating from last fix — MODELED, via='dead-reckoning', modelEpochMs = last fix time, targetAtMs = now.

MODELED requires `modelEpochMs` optional, `targetAtMs` mandatory (when target is now, targetAtMs=now). If future, still MODELED.

### 8. SIMULATED treatment

**SIMULATED is NOT core epistemic class; it is source mode / origin flag orthogonal, deferred.**

Evidence from `src/layers/traffic/model.js`:
- `trafficFeedPresentation({liveMode, fetching, flowError, coveragePct})` returns `{mode: 'live'|'sim', error, loadingLabel}`. Mode is CONFIGURED source (key present vs keyless), not per-value epistemic.
- Dots: `computeDotCount`, `allocateRoadDotBudgets`, `estimateRoadLengthDeg` — dot count/spacing derived from road geometry (OSM REPORTED) + altitude + density, but dot positions themselves are synthetic animation along waypoints, not real vehicle observations.
- Live flow: `road.flow` from TomTom is REPORTED (level, closure), dot color/speed scaled by flow, but motion still simulated.
- `recolorDotsInPlace` updates color/speed in place, density bunching waits for re-render.

Traffic dots are not queryable via `getAnalystRecords` (no analyst record), not in recordIndex. They are visual-only. Therefore I3 does NOT need to type them for analyst correctness.

If we need to label traffic, it should be: road geometry REPORTED (OSM), flow level REPORTED (TomTom sourceId=tomtom), dot animation is internal synthetic rendering, not a provenance-carrying entity. The layer's chip already says `SIMULATED — add TomTom key for live` — that is source-level mode, not per-dot epistemic.

Decision: Defer SIMULATED from core enum. If later needed for analyst-visible synthetic entities, add as `synthetic: true` flag or `mode: 'simulated'` alongside epistemic, not as mutually exclusive class. This avoids mixing dimension A (method) with dimension orthogonal (synthetic vs real). Keeps vocabulary smallest.

### 9. Final sourceId/provider terminology

Distinguish 5 terms, based on actual code:

- **storeId**: GEV current-record STORE ORIGIN, bounded set `['flights','military','vessels']` in `src/data/recordIndex.js:92 VALID_STORE_IDS`. Not provider, not provenance. I2 concern.
- **sourceId**: stable machine identifier for external origin, lowercase, matches DATA_CREDITS keys and source adapter label. Examples from code: `'opensky'` (label 'OpenSky Network' in `aircraft.js:77`), `'adsb.lol'` (label in `aircraft.js:110`), `'adsbdb'` (label in `standalone.js:getEnrichment`), `'aisstream'` (label 'AISStream' in `vessels.js` and `standalone.js`), `'usgs'`, `'firms'`, `'celestrak'`, `'osm'`, `'gbfs'`, `'tomtom'`. This is what I3 provenance carries.
- **sourceLabel**: human-readable, e.g., 'OpenSky Network', 'AISStream', 'military upstream snapshot'. From `source`, `coverage` fields in snapshots (`openSkySnapshot`, `readsbSnapshot`, `vesselSnapshot`). Display only.
- **dataset/feed**: specific feed within provider, e.g., 'states/all', 'lat/lon/dist/250', 'station_information'. Not needed in I3 primitive, but I4 may use.
- **sensor**: physical network (receiver network, camera hardware). I4 concern, not I3.

Exact recommendation: I3 provenance field `sourceId: string` — stable machine id supplied by source adapter (e.g., `normalizeOpenSkyAircraft` knows it's opensky, `normalizeReadsbAircraft` knows adsb.lol, `normalizeVesselObservation` knows aisstream). No global enum in I3; adapter supplies string. Validation: non-empty trimmed string, lowercase recommended, but not enforced against global list.

### 10. Why this does NOT pre-build I4

I3 carries `sourceId` string reference only. I4 becomes authority that resolves/validates/describes sourceId → descriptor with label, license, URL, coverage, cadence, key requirement, failure modes.

Evidence that I4 already partially exists: `src/data/dataCredits.js` has 39 keys, `TRANSIT_FEED_REGISTRY` 7 feeds with license, `src/data/lifecycle.js` layer metadata.

I3 does NOT store license text, URL, attribution, coverage map, cadence, key material. It stores only sourceId that I4 can resolve. No `PROVIDER_ID` enum, no registry, no attribution per record. Therefore I4 remains separate and not duplicated.

### 11. Whether a provider enum exists in I3

**No.** See §9-10.

Smallest pre-I4 mechanism without arbitrary strings unsafe: allow any non-empty string, but document expected values from current adapters (`opensky`, `adsb.lol`, `adsbdb`, `aisstream`, `usgs`, `firms`, `celestrak`, `osm`, `gbfs`, `tomtom`, `austin-cctv`, etc.). Future architecture check may assert that `sourceId` matches `/^[a-z0-9._-]+$/` and length bounded, not that it is in fixed enum. I4 later becomes strict validator.

This avoids premature source registry while preventing injection of human label with spaces as id.

### 12. Final transformation/method representation

**No global TRANSFORMATION enum in foundational I3.**

Foundational primitive supports:
```
via?: string|null  // stable operation identifier, optional
```

Only operations actually implemented in first slice need identifiers. Examples from actual code:
- `'unit-conversion'` (feet→m *0.3048, m/s→knots /0.514444, kts→m/s *0.514444) — still REPORTED, via notes conversion.
- `'normalization'` (trim, finite check, coordinate validation)
- `'render-altitude-selection'` (pickRenderAltitudeM priority chain)
- `'geoid-correction'` (baro + N)
- `'ground-floor'` (cachedGroundFloor)
- `'classification'` (classifyAircraft)
- `'sgp4-propagation'` / `'sgp4-orbit-path'`
- `'dead-reckoning'`
- `'distance'`

Derivation metadata lives at deterministic computation boundary (where function is called), not every stored provenance descriptor must have via. For REPORTED, via=null or 'normalization'/'unit-conversion' — does NOT promote to DERIVED.

Do NOT include 'sticky-retention' or 'enrichment' as via — see §13.

### 13. Whether sticky-retention is provenance, merge state, or neither

**Neither provenance nor transformation. It is CURRENT RECORD MERGE BEHAVIOR / retention policy, owned by store, not part of value's origin.**

Evidence: `src/layers/flights/records.js:42-44` comment: "Sticky merge: OpenSky intermittently drops callsign/velocity/track for aircraft it still positions — hold last-known-good instead of regressing". `src/data/aircraftMeta.js: stickyText/stickyNumber` — if next missing, keep prev.

A callsign retained from older OpenSky observation is still a REPORTED callsign, provenance is that older observation's timestamps, not a new transformation.

Truthful representation: when field retained, keep its previous provenance unchanged (older reportedAtMs, receivedAtMs, sourceId). Do NOT add via='sticky-retention'. The fact that current record contains fields from different times is visible because field-group provenances have different reportedAtMs.

Merge state (which fields were retained this poll) may be useful for I9 event semantics (UPDATED vs STALE), but belongs in store's internal tracking or I9, not in provenance descriptor.

Similarly 'enrichment' describes acquisition path, not transformation. Enrichment fields' provenance has sourceId=adsbdb, not via='enrichment'. Via remains null or 'normalization'.

### 14. Exact aircraft provenance granularity recommendation

**Option B — explicit semantic provenance groups — recommended as smallest truthful.**

Based on `FlightRecords.receive()` field-by-field:

Groups (with actual code mapping):

- **position**: `lat`, `lon`, `rawLat`, `rawLon`, `fixEpochMs`, `geoAltitudeM`, `onGround`
  - Always fresh when observation admitted (coordinates check in `normalizeOpenSkyAircraft` / `normalizeReadsbAircraft` requires lat/lon finite). Provenance = latest observation: sourceId opensky or adsb.lol, reportedAtMs = positionTimeMs (row[3] or snapshotTimeMs - seenPos), receivedAtMs = observedReceiptMs (Date.now() at receive).

- **kinematics**: `altitude` (baro), `velocity`, `true_track`/`track`, `verticalRate`, `lastContactEpochMs`
  - stickyNumber group, share contactTimeMs. Provenance per field may be retained. Implementation stores one provenance per group for simplicity: when any field in group retained, group's reportedAtMs = oldest retained field's time? More truthful: store per-field timestamps inside group as sparse overrides, but group object holds default fresh provenance. Recommended: group default = fresh observation provenance (contactTimeMs), overrides map for retained fields points to old provenance. This keeps objects low (0-1 overrides typical).

- **identity**: `callsign`, `originCountry`, `category`, `klass` (klass DERIVED from category+typeCode, but depends on identity)
  - stickyText/Number. Same pattern as kinematics. Group provenance with sparse overrides.

- **enrichment**: `typeCode`, `typeName`, `registration`, `airline`, `route`
  - Written by enrichment callbacks `src/layers/flights/enrichment.js:_requestTypeEnrichment` / `_requestRouteEnrichment`. SourceId=adsbdb, reportedAtMs=null (no source timestamp), receivedAtMs=when enrichment arrived (Date.now() in callback). Carried across polls via `prevMeta?.typeCode ?? null`. Provenance travels with value.

- **derived**: `renderAltitudeM`, `wasAirborne`, `klass` (when derived)
  - DERIVED, via as above, reportedAtMs = max of inputs, receivedAtMs = now, sourceId = null or 'gev'.

**Minimum state inside FlightRecords to preserve truthful provenance:**

Current code stores `data: Map<icao24, meta>` where meta has values only. To add provenance truthfully, store parallel `provenance: Map<icao24, {position, kinematics, identity, enrichment, derived}>` where each is descriptor `{sourceId, reportedAtMs, receivedAtMs}` plus optional overrides.

Alternatively, store per-field last-seen provenance inside meta as `meta._prov: {callsign: {sourceId, reportedAtMs, receivedAtMs}, ...}` only for sticky fields.

Smallest: store 2 timestamps per aircraft for OpenSky path: `lastPositionTimeMs` and `lastContactTimeMs` plus `lastReceivedAtMs`, plus enrichment receipt time. Then field provenance derived via which clock applies. This avoids storing full descriptor per field.

**Recommended shape for first slice (position only):**

```js
// inside FlightRecords after receive
meta.provenance = {
  position: { sourceId: 'opensky', reportedAtMs: observation.positionTimeMs, receivedAtMs: Date.now() }
}
```

Later slices add groups.

This is cheaper than default+arbitrary field override map (A) because groups match actual missingness correlation, and cheaper than full field map (C).

### 15. Exact vessel provenance limitations based ONLY on data GEV actually has

**Vessel provenance is record-level, NOT field-level, because GEV's current normalized AISStream row does NOT preserve different source times for static vs position.**

Evidence:
- `src/sources/live/vessels.js:normalizeVesselObservation` takes single row with `lat, lon, name, mmsi, type_specific/type, destination, speed, course, heading, last_position_epoch, last_position_UTC`. No separate static timestamp.
- `observedAtMs = epoch(row.last_position_epoch,1000) ?? epoch(Date.parse(row.last_position_UTC))` — single timestamp.
- `vesselSnapshot` computes `observedAtMs` as newestPositionAt or max row observedAtMs — snapshot-level.
- `src/layers/vessels/records.js:normalizeVessel` stores `lastPositionUtc`, `lastPositionEpoch` as provided, but no separate name timestamp.
- `src/layers/vessels/ingestion.js:vesselDisplayRow` maps `last_position_epoch = observedAtMs/1000`, `last_position_UTC = ISO(observedAtMs)` — synthesizes from single observedAtMs, does NOT preserve original static time.

Therefore, although AIS protocol has different message types (position report vs static voyage), GEV's current input does NOT expose that distinction. We must NOT fabricate field timestamps.

Provenance for vessel:
- sourceId: 'aisstream' (from `vesselSnapshot` source='AISStream' → normalized to 'aisstream')
- reportedAtMs: `last_position_epoch*1000` or parsed UTC (SOURCE_EVENT_TIME for position, but also used for static fields due to limitation)
- receivedAtMs: `receivedAtMs = now()` from `VesselRecords.reconcile` `this.now()` (CLIENT_RECEIPT_TIME)
- No per-field overrides. Entire record shares same provenance.

Limitation must be documented: "GEV knows conceptually that AIS static and position originate from different messages, but current input only provides one usable timestamp, so provenance reflects that limitation."

### 16. Minimal timestamp model

**Two mandatory, two optional, no giant clock object.**

- `reportedAtMs?: number|null` — external/source timestamp relevant to that value. For aircraft: `positionTimeMs` for position group, `contactTimeMs` for kinematics/identity group, `null` for adsbdb enrichment (no source time). For vessel: `last_position_epoch*1000`. For USGS: `properties.time`. For FIRMS: `acqMs`. For satellite TLE: fetch time or TLE epoch? For TLE catalog, reportedAtMs = fetch time, modelEpochMs = TLE epoch.
- `receivedAtMs: number` — CLIENT_RECEIPT_TIME, `Date.now()` when GEV received/assembled record. Mandatory for REPORTED to avoid inventing report time.
- `targetAtMs?: number` — for MODELED, the time model is evaluated for (prediction target). For current, targetAtMs = now or reportedAtMs. For future ISS pass, future time.
- `modelEpochMs?: number` — for MODELED, epoch of model itself (satrec.jday converted to ms, DEM epoch, etc). Optional.

Mapping:
- Aircraft `observation.positionTimeMs` → reportedAtMs for position group
- Aircraft `observation.contactTimeMs` → reportedAtMs for kinematics/identity group
- Aircraft `openSkySnapshot observedAtMs = epoch(payload.time)` → source publish time, NOT field reportedAtMs; belongs in feedState, not per-field provenance, to avoid duplication. If needed, could be `sourcePublishAtMs` but deferred.
- Aircraft `FlightRecords observedReceiptMs = Date.now()` → receivedAtMs
- Vessel `last_position_epoch` → reportedAtMs, `VesselRecords receivedAtMs = now()` → receivedAtMs
- Satellite `satrec.jday` → modelEpochMs, `now` or `date` passed to propagate → targetAtMs, fetch time → reportedAtMs
- Earthquake `properties.time` → reportedAtMs, fetch time → receivedAtMs
- FIRMS `acqMs` → reportedAtMs

Information lost if only one reportedAtMs: distinction between snapshot publish time vs event/fix time. Decision: keep event time as reportedAtMs, snapshot publish time belongs to feed-level metadata (I5), not per-field provenance. Acceptable loss for I3.

Names: use `reportedAtMs` not `observedAtMs` to match REPORTED vocabulary. Use `receivedAtMs` not `observedReceiptMs`.

### 17. Quality metric decision

**Defer provider quality until real consumer requires it (Option A).**

Evidence:
- FIRMS confidence exists: `src/layers/firms/model.js:mapAnalystRecord` includes `confidence: normalized 0..1 (firmsAdapt.normalizeConfidence)`. Currently used for display color `detectionColorStop` and card meta `confidenceBucket`. Not preserved in FlightRecords or VesselRecords.
- readsb NIC/NAC/SIL may exist upstream but GEV does NOT preserve them — `normalizeReadsbAircraft` does not extract them.
- AIS `position_accuracy` may exist upstream but `normalizeVesselObservation` does not preserve it.

We do NOT need to redesign ingestion merely because upstream formats contain fields GEV currently ignores. Current I3 proof does not require quality.

Options evaluated:
- A defer — preferred.
- B narrowly typed quality now — would require adding `quality: {confidence?: number}` etc, expanding primitive before consumer.
- C evidence-supported — keep FIRMS confidence in FIRMS store only, not in generic provenance primitive.

Recommendation: Defer generic `quality` from first I3 primitive. If FIRMS needs confidence, keep it as domain field `confidence` in FIRMS record, not in provenance. Provenance primitive stays minimal. Later, if real consumer needs quality (e.g., AIS accuracy for analyst), add `quality?: { [key: string]: number }` with bounded keys, not open junk drawer.

### 18. Exact recordIndex/accessor exposure architecture

**Recommend Pattern A/C hybrid: keep `getCurrentEntities()` exactly I2 primitive-only, add separate provenance accessor sidecar.**

Detailed:

- `getCurrentEntities()` remains unchanged: returns `Array<{entityKey, icao24/mmsi, lat, lon, ...}>` primitive-only, fresh array, plain objects, no provenance. This preserves I2 contract, copy safety (`copyRecord` skips non-primitive, so provenance would be stripped anyway), and architecture check (`scripts/check-identity-authority.mjs` checks import only `entityKey`, no provenance logic).

- Layer stores own provenance in parallel Map: `FlightRecords` has `data: Map<id, meta>` and `provenance: Map<id, {position, identity, kinematics, enrichment, derived}>` or `meta._provenance` internal.

- New accessor `getProvenanceMap()` or `getCurrentEntitiesWithProvenance()` returns sidecar keyed by native id: `Map<icao24, provenance>` or array of `{id, provenance}`. Not used by recordIndex.

- `buildRecordIndex(collections)` continues to consume only `getCurrentEntities()` (primitive). It never sees provenance, remains free of provenance logic. Copy contract remains primitive-only, safe.

Evaluation:
- Coupling: low — provenance sidecar lives in same store, but accessor separation keeps concerns separate.
- Duplicate iteration: two loops over same Map if both accessors called, but on-demand, not per-frame, acceptable. Can optimize internally with single iteration building both arrays if needed, but still return separate.
- Copy safety: primitive accessor unchanged, provenance accessor returns fresh copies of descriptors (small objects).
- Current-state semantics: both reflect current state, no history.
- Consumer ergonomics: analyst or detail panel can call `getCurrentEntitiesWithProvenance()` for combined view; recordIndex consumers use primitive.
- Risk to I2 check: none — recordIndex file still has zero provenance import.
- Future I6 analyst: analyst can join provenance if needed via new accessor, without polluting identity index.

**ONE recommended:** Keep `getCurrentEntities()` primitive-only, add `getProvenance(id)` and `getAllProvenance()` sidecar accessors. RecordIndex consumes only primitive.

Alternative B (extend current entities with provenance but teach recordIndex to project) would couple recordIndex to provenance and violate "must NOT become provenance authority". Rejected.

### 19. Provenance storage ownership by production boundary

**No universal storage owner. Ownership by production boundary.**

- **SOURCE PROVENANCE** (REPORTED sticky fields): owned by layer store (`FlightRecords.data` + parallel provenance Map, `VesselRecords.byMmsi` + `receivedAtMs`). Attached/preserved with current reported values inside store.

- **DERIVATION PROVENANCE** (deterministic computation): created at computation boundary, not stored in layer store unless result is cached.

Examples:
  - `renderAltitudeM` computed inside `FlightRecords.receive()` via `pickRenderAltitudeM` — store can own derived provenance because computation happens inside store.
  - `klass` via `classifyAircraft` inside store — store owns.
  - `surfaceM` distance computed in `getNearby` query (`src/layers/flights/queries.js:538` currently `Cartesian3.distance`, future `geo.js`) — query-time, provenance created at query boundary, returned in result object, not stored in layer store.
  - `propagatePosition` in satellite model `orbits.js` — satellite model owns MODELED provenance, stored in catalog? Actually `layerState._catalog` stores `satrec` and `name`, position computed on demand in `_propagateDenseChunk` and `getSatelliteOrbitTrack`. Provenance should be created where `propagatePosition` called.

- **INTERPRETATION PROVENANCE** (AI judgement): created at analyst/AI boundary (`src/data/analystEngine.js`, `voice/gevActions.js`), attached to narrative outputs, not stored in layer stores.

Define ownership without framework: each module that produces a value is responsible for attaching provenance at that boundary using `provenance.js` primitive.

### 20. Age vs freshness distinction

**Age is deterministic query-time computation; freshness is I5 policy.**

- `ageMs = asOf - reportedAtMs` where `asOf` explicit, `reportedAtMs` from provenance. This is deterministic, no storage, computed on demand. I3 may expose helper `getAgeMs(provenance, asOf)`.

- `fresh/stale/degraded/partial/fallback/unavailable/loading` from `layerFeedState()` seven states, plus `stale` boolean from snapshots (`openSkySnapshot stale`, `readsbSnapshot stale`, `vesselSnapshot stale`). This belongs I5, uses age + thresholds + transport status + coverage.

Do NOT store continuously changing `ageMs` on records. Store `reportedAtMs` and `receivedAtMs`, compute age at query time.

MASTER-PLAN I3 says answers carry source, timestamp, age and class. Clarify: age is derived from timestamp, not stored, but exposed in result.

### 21. Requirements for a REPORTED provenance descriptor when timestamp is unavailable

**REPORTED requires:**
- `sourceId: string` mandatory, non-empty trimmed, stable machine id.
- `receivedAtMs: number` mandatory, finite, CLIENT_RECEIPT_TIME.
- `reportedAtMs?: number|null` optional, null when source timestamp unavailable. Do NOT invent receipt time and mislabel as report time.
- `epistemic: 'REPORTED'` mandatory.

Examples:
- adsbdb enrichment: sourceId='adsbdb', reportedAtMs=null, receivedAtMs=Date.now() when enrichment callback fired (`src/layers/flights/enrichment.js: _requestTypeEnrichment` onData).
- OSM static data (datacenters/dams): sourceId='osm', reportedAtMs=null (pack has meta.fetched but not per-feature event time), receivedAtMs=when pack loaded.
- Camera packs: sourceId='austin-cctv' etc, reportedAtMs=null or pack timestamp.
- Vessel static fields (name/type) when only position timestamp available: reportedAtMs = position timestamp (limitation documented), but better to set reportedAtMs = position timestamp and note limitation, rather than null, because we do have a timestamp, even if not ideal. For true missing, null.

Validator: if `epistemic===REPORTED` and `sourceId` missing → fail. If `reportedAtMs==null`, allowed, but consumer must render "time unknown" not fake age. `receivedAtMs` must exist so age can be computed as time since receipt if report time missing? No, age from receipt is not same as event age, but can be fallback.

Do NOT invent time merely to satisfy validator.

### 22. Revised minimal provenance primitive shape

```js
// src/data/provenance.js — zero-dep, frozen enums

export const EPISTEMIC = Object.freeze({
  REPORTED: 'reported',
  DERIVED: 'derived',
  MODELED: 'modeled',
  INTERPRETED: 'interpreted',
});

export function createProvenance({
  epistemic,      // EPISTEMIC.* mandatory
  sourceId,       // string mandatory for REPORTED, optional for DERIVED/MODELED/INTERPRETED
  reportedAtMs,   // number|null optional — external event time, null when unavailable
  receivedAtMs,   // number mandatory — client receipt time Date.now()
  targetAtMs,     // number optional — for MODELED, when model evaluated
  modelEpochMs,   // number optional — for MODELED, epoch of model itself
  via,            // string|null optional — stable operation id, e.g. 'unit-conversion', 'geoid-correction'
} = {}) {
  // validation: epistemic in EPISTEMIC, sourceId non-empty string if REPORTED, receivedAtMs finite, etc.
  return Object.freeze({ epistemic, sourceId: sourceId ?? null, reportedAtMs: reportedAtMs ?? null, receivedAtMs, targetAtMs: targetAtMs ?? null, modelEpochMs: modelEpochMs ?? null, via: via ?? null });
}

export function isValidProvenance(p) { /* checks */ }

export function getAgeMs(provenance, asOf = Date.now()) {
  const t = provenance.reportedAtMs ?? provenance.receivedAtMs;
  return t == null ? null : Math.max(0, asOf - t);
}
```

No `PROVIDER_ID` enum, no `TRANSFORMATION` enum, no `quality` junk drawer, no `UNKNOWN`, no `PREDICTED`, no `SIMULATED`.

Field-group provenance: store owns map of group → descriptor, not per-field universal.

### 23. Concrete REAL aircraft example using only timestamps/data GEV actually has

Based on actual `normalizeOpenSkyAircraft` and `FlightRecords.receive`:

Input OpenSky row at T0:
```
row = ["a1b2c3", "SWA123 ", "United States ", 1710000000, 1710000005, -97.0, 30.0, 10000, false, 250, 90, 0, null, 11000, null, null, null, 5]
```
Normalized:
```
{
  id: "a1b2c3",
  callsign: "SWA123",
  originCountry: "United States",
  latitude: 30.0, longitude: -97.0,
  baroAltitudeM: 10000,
  ellipsoidAltitudeM: 11000,
  onGround: false,
  speedMps: 250,
  courseDeg: 90,
  verticalRateMps: 0,
  category: 5,
  positionTimeMs: 1710000000*1000 = 1710000000000,
  contactTimeMs: 1710000005*1000 = 1710000005000,
  reference: "a1b2c3"
}
Snapshot:
```
payload.time = 1710000010
observedAtMs = 1710000010*1000 = 1710000010000
```

FlightRecords.receive at receivedAtMs = Date.now() = 1710000012000 (client receipt):
```
meta = {
  callsign: "SWA123", // stickyText
  altitude: 10000, // stickyNumber
  velocity: 250,
  true_track: 90,
  rawLat: 30.0, rawLon: -97.0,
  geoAltitudeM: 11000,
  renderAltitudeM: 11000 (picked geo),
  observedReceiptMs: 1710000012000,
  lastContactEpochMs: 1710000005000,
  ...
}
fixEpochMs = positionTimeMs = 1710000000000
```

Provenance (first slice position only):
```
{
  position: {
    epistemic: REPORTED,
    sourceId: 'opensky',
    reportedAtMs: 1710000000000, // positionTimeMs
    receivedAtMs: 1710000012000,
    via: null
  }
}
```

Second poll T1 30s later, OpenSky drops callsign/velocity:
```
row = ["a1b2c3", "", "United States ", 1710000030, 1710000035, -97.1, 30.1, 10050, false, null, null, 0, null, null, ...]
```
Normalized callsign='', velocity=null, track=null
receive retains:
```
meta.callsign = stickyText('', 'SWA123') = 'SWA123' (retained)
meta.velocity = stickyNumber(null, 250, 0) = 250 (retained)
meta.true_track = stickyNumber(null, 90, 0) = 90 (retained)
meta.altitude = 10050 (fresh)
rawLat/lon fresh 30.1/-97.1
```

Provenance after T1 with groups:
```
{
  position: {
    epistemic: REPORTED,
    sourceId: 'opensky',
    reportedAtMs: 1710000030000, // new positionTimeMs
    receivedAtMs: 1710000042000
  },
  kinematics: {
    // altitude fresh, velocity/track retained — need sparse override
    default: { sourceId: 'opensky', reportedAtMs: 1710000035000, receivedAtMs: 1710000042000 }, // contactTimeMs fresh for altitude
    overrides: {
      velocity: { sourceId: 'opensky', reportedAtMs: 1710000005000, receivedAtMs: 1710000012000 }, // old
      true_track: { sourceId: 'opensky', reportedAtMs: 1710000005000, receivedAtMs: 1710000012000 }
    }
  },
  identity: {
    callsign: { sourceId: 'opensky', reportedAtMs: 1710000005000, receivedAtMs: 1710000012000 } // retained
  }
}
```

If we use grouped without per-field override, we would have identity provenance old, kinematics mixed — we need override to stay truthful.

Later enrichment arrives:
```
adsbdb response: {typeCode: "B738", registration: "N12345"}
receivedAtMs = 1710000050000
meta.typeCode = "B738"
```
Enrichment provenance:
```
enrichment: {
  typeCode: { epistemic: REPORTED, sourceId: 'adsbdb', reportedAtMs: null, receivedAtMs: 1710000050000 }
}
```

Derived:
```
renderAltitudeM provenance: { epistemic: DERIVED, via: 'render-altitude-selection', reportedAtMs: 1710000030000 (max of inputs), receivedAtMs: 1710000042000 }
klass provenance: { epistemic: DERIVED, via: 'classification', reportedAtMs: 1710000050000 (when typeCode arrived) }
```

This uses only timestamps GEV actually has: positionTimeMs, contactTimeMs, Date.now(), no invented times.

### 24. Concrete REAL vessel example using only timestamps/data GEV actually has

AISStream row:
```
{
  mmsi: "123456789",
  lat: 29.5, lon: -94.8,
  name: "EVER GIVEN",
  type_specific: "Cargo",
  destination: "HOUSTON",
  speed: 12.5, // knots
  course: 90, heading: 88,
  last_position_epoch: 1710000000,
  last_position_UTC: "2024-03-09T12:00:00Z",
  imo: "1234567"
}
```

normalizeVesselObservation:
```
{
  id: "123456789",
  reference: "123456789",
  latitude: 29.5, longitude: -94.8,
  name: "EVER GIVEN",
  type: "Cargo",
  destination: "HOUSTON",
  speedMps: 12.5*0.514444 = 6.43055,
  courseDeg: 90, headingDeg: 88,
  observedAtMs: epoch(1710000000*1000) = 1710000000000,
  altitudeDatum: 'sea-surface'
}
```

vesselSnapshot:
```
records = [above]
observedAtMs = 1710000000000 (max row)
source='AISStream', coverage='received AIS positions'
```

ingestion vesselDisplayRow:
```
{
  mmsi: "123456789",
  lat: 29.5, lon: -94.8,
  name: "EVER GIVEN",
  type: "Cargo",
  destination: "HOUSTON",
  speed: 6.43055/0.514444 = 12.5 (back to knots),
  course: 90, heading: 88,
  last_position_epoch: 1710000000,
  last_position_UTC: "2024-03-09T12:00:00Z"
}
```

VesselRecords.reconcile receivedAtMs = Date.now() = 1710000005000

Current stored record:
```
{
  lat: 29.5, lon: -94.8,
  name: "EVER GIVEN",
  mmsi: "123456789",
  type: "Cargo",
  destination: "HOUSTON",
  speed: 12.5,
  course: 90, heading: 88,
  lastPositionUtc: "2024-03-09T12:00:00Z",
  lastPositionEpoch: 1710000000,
  receivedAtMs: 1710000005000
}
```

Provenance (record-level, limitation documented):
```
{
  epistemic: REPORTED,
  sourceId: 'aisstream',
  reportedAtMs: 1710000000000, // last_position_epoch*1000
  receivedAtMs: 1710000005000,
  via: null
}
// No per-field split, because GEV only has one timestamp for entire row.
// name/type/destination share same reportedAtMs as position, even though
// conceptually static messages have different times — GEV cannot know.
```

If later row updates position but not name, still same provenance shape, reportedAtMs advances, name provenance advances with it (limitation).

### 25. Satellite example sufficient to validate MODELED semantics

TLE:
```
ISS (ZARYA)
1 25544U 98067A   24069.12345678  .00001234  00000-0  12345-4 0  9991
2 25544  51.6400  10.1234 0001234  80.1234 280.1234 15.12345678 12345
```

`parseTLE` → `{name, line1, line2}`
`twoline2satrec(line1,line2)` → `satrec` with `satnum=25544`, `jday` = TLE epoch, `bstar`, etc.

Model epoch: `satrec.jday` converted to ms = `modelEpochMs`.

Now at `referenceDate = new Date()` = 1710000000000

`propagatePosition(satrec, referenceDate)` → `{longitude, latitude, altitude, speedMps}`

Provenance for current position:
```
{
  epistemic: MODELED,
  sourceId: 'celestrak',
  reportedAtMs: fetchTime (when TLE group fetched, e.g., 1709990000000),
  receivedAtMs: catalog build time,
  modelEpochMs: satrec.jday ms (e.g., 1709991234567),
  targetAtMs: 1710000000000,
  via: 'sgp4-propagation'
}
```

Future pass:
```
positionAt(futureDate = 1710003600000) // +1h
{
  epistemic: MODELED,
  sourceId: 'celestrak',
  reportedAtMs: fetchTime,
  modelEpochMs: same TLE epoch,
  targetAtMs: 1710003600000,
  via: 'sgp4-propagation'
}
```

No PREDICTED class, still MODELED, distinguished by targetAtMs > now.

Orbit path:
```
computeOrbitPath(satrec, referenceDate) → Cartesian3[]  steps around one period
Provenance: MODELED, via='sgp4-orbit-path', modelEpochMs same, targetAtMs = referenceDate, reportedAtMs = fetchTime
```

This validates MODELED semantics: needs modelEpochMs and targetAtMs, not just reportedAtMs.

### 26. Revised implementation slicing

Previous: I3a vocab+primitive only.

Revised, minimal vertical slices proving primitive against real data:

- **I3a — Vocabulary + primitive (zero-dep)**:
  - `src/data/provenance.js` with EPISTEMIC 4 values, createProvenance, isValidProvenance, getAgeMs.
  - Tests: no REPORTED without sourceId+receivedAtMs, REPORTED allows null reportedAtMs, DERIVED requires via, MODELED requires targetAtMs, INTERPRETED never on physical fields (future check).
  - No producer integration yet, but primitive ready. Risk: unused API.

- **I3b — Aircraft position provenance (one real producer, no sticky)**:
  - Integrate into `FlightRecords.receive()` for position group only (lat/lon/fixEpochMs/geoAltitudeM/onGround). Store provenance Map parallel to data Map, sourceId opensky or adsb.lol depending on snapshot source header `x-flight-source` (from `server/providers/aircraft/opensky.js` which sets `X-Flight-Source: adsb.lol` on fallback).
  - Add `getProvenanceMap()` accessor, keep `getCurrentEntities()` primitive-only.
  - Validates primitive against real OpenSky data, proves timestamp mapping (positionTimeMs→reportedAtMs, Date.now()→receivedAtMs), proves recordIndex remains free.

- **I3c — Aircraft sticky + enrichment provenance**:
  - Extend to kinematics and identity groups with sparse overrides for retained fields. Implement retention of old provenance when stickyText/stickyNumber keeps prev.
  - Add enrichment provenance for adsbdb fields (sourceId=adsbdb, reportedAtMs=null).
  - Add derived provenance for renderAltitudeM, klass.

- **I3d — Vessel provenance (second domain)**:
  - Integrate into `VesselRecords` record-level provenance, proves second domain exposes abstraction problems (single timestamp limitation).
  - Add vessel `getProvenanceMap()`.

- **I3e — Satellite MODELED validation + accessor exposure**:
  - Add MODELED provenance to `propagatePosition` and `orbitTrackFromRecord`, validate modelEpochMs/targetAtMs.
  - Expose via satellite queries, not via recordIndex.

This slicing ensures each increment has real producer, avoids unused API, and second domain (vessel) catches abstraction issues early (I2 lesson).

### 27. ONE recommended first implementation

**I3b — Primitive + aircraft position provenance (no sticky), with separate provenance accessor.**

Why:
- Smallest implementation that proves primitive against REAL data (OpenSky) while remaining reviewable (<150 lines).
- Position group always fresh, no sticky complexity, truthful with single descriptor per record.
- Keeps `getCurrentEntities()` unchanged, so I2 architecture check passes, no risk to recordIndex.
- Provides concrete evidence for owner decisions (sourceId string, reportedAtMs=positionTimeMs, receivedAtMs=Date.now()).
- Avoids abstract primitive-only slice (Option A) that would be unused and risk speculative API.
- Avoids immediate full sticky (Option C) which is larger and mixes retention policy with provenance.

Scope:
- `src/data/provenance.js` (4-class enum, createProvenance, validation, getAgeMs)
- `src/layers/flights/records.js` add `this.provenance = new Map()` and in `receive()` store position provenance from `observation.positionTimeMs` and `Date.now()`, sourceId from snapshot context (passed as param or inferred as 'opensky' for now).
- `src/layers/flights/queries.js` add `getProvenanceMap()` returning copy of provenance Map, and optionally `getCurrentEntitiesWithProvenance()` for convenience, but keep `getCurrentEntities()` primitive-only.
- Tests: `provenance.test.mjs` + `flights/provenance.test.mjs` verifying position provenance has sourceId, reportedAtMs = positionTimeMs, receivedAtMs finite, ageMs computed, and that recordIndex built from primitive accessor still works and contains no provenance.

This is vertical, real, minimal, reviewable.

### 28. Architecture-check timing

**Freeze after first real aircraft integration (after I3b), not after pure primitive.**

Rationale:
- After pure primitive (I3a), no producer, invariants unproven, freezing would lock speculative API.
- After I3b, we have evidence that primitive works for real data, recordIndex remains free, sourceId string approach viable, timestamp mapping correct.
- Proven invariants to freeze at that point:
  - EPISTEMIC vocabulary centralized in `provenance.js`, no other file defines epistemic strings.
  - recordIndex has zero provenance import/logic (check via grep).
  - No arbitrary confidence/reliability/threat score (check).
  - No history/trajectory arrays (check).
  - sourceId is string, not enum, and is bounded by `/^[a-z0-9._-]+$/` (check).
  - via is optional string from documented set, not required.
  - REPORTED requires sourceId+receivedAtMs, reportedAtMs optional.
  - No raw upstream payloads stored in provenance.
- After aircraft+vessel (I3d), we can expand checks to include vessel.

Do NOT add checker yet in this research task; decide timing as above.

### 29. Stale documentation locations to correct (future surgical correction, DO NOT modify prod code now)

Statement "flights store merges OpenSky + adsb.lol is FALSE". Actual:
- flights store = OpenSky current observations, with server-side fallback to adsb.lol regional point snapshot (250nm) when OpenSky stale/unavailable, labeled via `X-Flight-Source: adsb.lol` and `X-Flight-Coverage: 250nm regional fallback` in `server/providers/aircraft/opensky.js:346` and `serveAdsbLolPointFallback`.
- military store = adsb.lol current observations (`src/sources/live/standalone.js:createAdsbLolSource`).
- flights can contain adsbdb enrichment (`src/layers/flights/enrichment.js`).
- sticky merge occurs across time within the store (`FlightRecords.receive()` stickyNumber/stickyText), not across providers in same poll.

Locations containing stale claim:

- `docs/planning/I2-PRE-IMPLEMENTATION-REPORT.md:19` — "Same ICAO24 through OpenSky and adsb.lol is merged into one `FlightRecords.data` entry via sticky merge."
- `I2-PRE-IMPLEMENTATION-REPORT.md:25` — "proving cross-provider OpenSky+adsb.lol merge"
- `I2-PRE-IMPLEMENTATION-REPORT.md:41` — "Cross-provider same entity: Yes — OpenSky and adsb.lol both report same ICAO24, merged into one Map entry via `receive()` sticky fields."
- `I2-PRE-IMPLEMENTATION-REPORT.md:136` — "Same ICAO24 through OpenSky+adsb.lol = same entity, merged via sticky"
- `I2-PRE-IMPLEMENTATION-REPORT.md:169` — "Same ICAO24 through OpenSky and adsb.lol is same aircraft."
- `I2-PRE-IMPLEMENTATION-REPORT.md:188` — detailed cross-provider merge claim.
- `I2-PRE-IMPLEMENTATION-REPORT.md:240` — presentInSources OpenSky+adsb.lol
- `I2-PRE-IMPLEMENTATION-REPORT.md:456`, `549`, `565`, `609`, `715` — same.
- `I2-PRE-IMPLEMENTATION-REPORT.md:980` — "Ingestion: OpenSky `normalizeOpenSkyAircraft` and adsb.lol `normalizeReadsbAircraft` → `records.receive`"
- `I2-PRE-IMPLEMENTATION-REPORT.md:1142` — "`getCurrentEntities()`: ... including military-classified ones" — implies flights contains adsb.lol when military inactive, but actual flights fallback is 250nm regional, not worldwide military.
- `I2-PRE-IMPLEMENTATION-REPORT.md:1369-1370` — "Example: `flights` store itself contains observations merged from OpenSky + adsb.lol via sticky merge in `FlightRecords.receive()`."
- `I2-PRE-IMPLEMENTATION-REPORT.md:1422` — same.
- `I2-PRE-IMPLEMENTATION-REPORT.md:1601` — "`flights` = GEV flights current-record store (merges OpenSky + adsb.lol)"
- `src/data/recordIndex.js:48-49` JSDoc (old): "Example: flights store itself contains observations merged from OpenSky + adsb.lol via sticky merge — provider is observation identity (I3), storeId is current-record store origin (I2)." — stale, needs correction to fallback description.
- `docs/CURRENT-STATE.md:2501` table says "Live Flights — OpenSky Network; bounded adsb.lol regional fallback" — this is actually CORRECT (fallback, not merge), keep.
- `docs/CURRENT-STATE.md:3104` and `3122`, `3558` describe fallback correctly — keep, but ensure wording distinguishes fallback vs merge.
- `docs/planning/REFERENCE.md` does NOT contain stale merge claim; it lists sources separately — OK.
- `docs/planning/MASTER-PLAN.md` does not claim flights merges; it says "OBSERVED / DERIVED / INTERPRETED remain distinguishable" — OK, but need to update OBSERVED term to REPORTED in future.

Future surgical fix: Update all above to "flights = OpenSky with 250nm adsb.lol regional fallback when OpenSky stale/unavailable, labeled via X-Flight-Source, sticky merge across time within store, not simultaneous cross-provider merge; military = adsb.lol".

### 30. Remaining genuine owner decisions only (after evidence)

Previous report listed 9; most settled by evidence. Remaining genuine where two reasonable designs remain:

**Decision 1 — REPORTED vs OBSERVED terminology final.**
- Evidence supports REPORTED (GEV doesn't physically observe ADS-B, chain transponder→receiver→provider→adapter). Recommend REPORTED primary, OBSERVED deprecated alias. Owner to ratify term change in MASTER-PLAN P3.

**Decision 2 — Whether to keep enrichment provenance (adsbdb) as REPORTED with sourceId=adsbdb and null reportedAtMs, or as DERIVED via enrichment.**
- Option A: REPORTED (provider assertion) — truthful, source is adsbdb.
- Option B: DERIVED (enrichment = deterministic lookup) — but lookup is external, not computation.
- Evidence: enrichment callbacks write `meta.typeCode = data.typeCode` from external API, not computed. So REPORTED more accurate. Owner to confirm.

**Decision 3 — Minimal timestamp model: whether to keep snapshot publish time (`payload.time` / `newestPositionAt`) as separate field `sourcePublishAtMs` in provenance or leave it in feedState/I5 only.**
- Option A: Keep only event time (positionTimeMs) as reportedAtMs, publish time in feedState — minimal, loses distinction but acceptable for I3.
- Option B: Keep both `reportedAtMs` (event) and `sourcePublishAtMs` (snapshot) in provenance — more complete, but larger.
- Recommendation A (minimal), but owner may want B for audit.

All other decisions settled by evidence (no UNKNOWN, no PREDICTED class, no SIMULATED core, no provider enum, no transformation enum, no quality in first primitive, sticky is merge state not provenance, group granularity = semantic groups, vessel record-level only, recordIndex exposure = separate accessor, ownership by boundary, age vs freshness, REPORTED requirements).

### 31. Confirmation no production code changed — UPDATED FOR I3a

**Previous research task: no production code modified.**

**I3a implementation (2026-09-18): production code changed minimally per owner-approved slice:**

- `src/data/provenance.js` NEW — EPISTEMIC frozen 4 + createProvenance + isValidProvenance validation, zero/low-dep, no framework, no registry.
- `src/sources/live/aircraft.js` — openSkySnapshot and readsbSnapshot now carry sourceId (stable machine id) and receivedAtMs (snapshot receipt time), not just human label.
- `src/sources/live/standalone.js` — createOpenSkySource.getSnapshot captures X-Flight-Source header truthfully: 'adsb.lol' fallback → sourceId 'adsb.lol', absent → 'opensky', single now() per batch as receivedAtMs. createAdsbLolSource similar.
- `src/layers/flights/records.js` — adds positionProvenance Map<icao24, frozen descriptor>, receive() now accepts {sourceId, receivedAtMs}, stores REPORTED provenance for rawLat/rawLon current fix, retains with retained position, switches with replacement, deletes on forget, copy-safe frozen.
- `src/layers/flights/snapshotRenderer.js` — passes snapshot.sourceId and snapshot.receivedAtMs into records.receive().
- `src/layers/flights/queries.js` — adds getProvenanceMap() sidecar Map keyed by native icao24 (including TIS-B ~), copy-safe, CURRENT only, getCurrentEntities() unchanged.
- Tests: `src/data/provenance.test.mjs` (11), `src/layers/flights/provenance.test.mjs` (16), `src/sources/live/standalone.provenance.test.mjs` (7).
- Doc corrections: `src/data/recordIndex.js` comment distinguishing GEV store ownership vs external source origin, this addendum header, I2-PRE-IMPLEMENTATION-REPORT stale merge claims surgical correction.

No I4/I5/I6/I9, no D9, no recordIndex behavior change (only comment), no entity identity change, no full aircraft provenance, no vessel/satellite, no longitudinal history, no persistence mechanism decision.

Previous read-only inspection list remains valid for research phase, but I3a now adds production changes above.

### 32. Whether I2 remains closed/complete — UPDATED FOR I3a

**I2 remains closed/complete.**

- Identity authority `src/data/entityKey.js` unchanged, zero-dep, canonical aircraft:icao24 and vessel:mmsi.
- RecordIndex `src/data/recordIndex.js` behavior unchanged, only JSDoc comment corrected to distinguish storeId (GEV ownership flights/military/vessels) vs sourceId (external origin opensky/adsb.lol) and to describe flights = OpenSky with 250nm adsb.lol regional fallback via X-Flight-Source, not simultaneous merge. Bounded storeIds flights/military/vessels, validation delegated to entityKey, generic primitive-only copy.
- Accessors `getCurrentEntities()` unchanged and primitive-only, byte/shape compatible, uncapped, deterministic.
- Architecture check `scripts/check-identity-authority.mjs` still passing (I2d freeze) — no provenance logic in recordIndex (only import isValid), no new domains.
- New sidecar `getProvenanceMap()` does not affect recordIndex, does not add history/confidence/quality.

Only doc comment in `recordIndex.js:48-49` previously stale (flights merges OpenSky+adsb.lol) now corrected to fallback description per traced path.

**I3a does NOT reopen I2.**

---

## Summary Reduction

- Vocabulary: 4 (REPORTED, DERIVED, MODELED, INTERPRETED) not 7.
- PREDICTED → temporal metadata (targetAtMs) on MODELED.
- UNKNOWN → absence, not class.
- SIMULATED → deferred, orthogonal mode flag, not core enum (traffic visual-only, not analyst).
- INTERPRETED locked to non-deterministic judgement, only on narrative outputs.
- Source terminology: storeId (GEV ownership) vs sourceId (stable machine id string from adapter) vs sourceLabel (human) vs dataset/feed vs sensor (I4). No provider enum in I3.
- Transformation: via optional string, not global enum; sticky-retention not via, not provenance.
- Aircraft granularity: semantic groups (position, kinematics, identity, enrichment, derived) with sparse overrides for retained fields, minimal truthful.
- Vessel: record-level only, single timestamp limitation documented, cannot fabricate per-field times.
- Timestamps: reportedAtMs (event or null), receivedAtMs mandatory, targetAtMs/modelEpochMs optional for MODELED.
- Quality: defer.
- RecordIndex exposure: keep getCurrentEntities primitive-only, add separate provenance sidecar accessor.
- Storage ownership: by production boundary (source in store, derivation at computation, interpretation at analyst).
- Age vs freshness: age deterministic query-time, freshness I5.
- REPORTED requirements: sourceId mandatory, receivedAtMs mandatory, reportedAtMs optional null.
- Primitive shape: minimal 4-enum + sourceId + timestamps + via.
- First implementation: I3b position-only provenance with real OpenSky data, proves primitive, keeps I2 closed.
- Architecture check freeze after I3b.
- Stale docs listed for future fix.
- Owner decisions reduced to 3 genuine.

**Goal REDUCTION achieved: fewer concepts, fewer exports, fewer enums, fewer stored fields, evidence-backed.**
