# I3b PRE-IMPLEMENTATION TRACE — Aircraft Current-Field Provenance

Date: 2026-09-18
Branch: arena/01a0b2f3-gods-eye-view
Scope: Trace FlightRecords.receive() and enrichment callbacks before editing.

## Source path traced

- server/providers/aircraft/opensky.js -> openSkyProxy primary no X-Flight-Source, fallback serveAdsbLolPointFallback sets X-Flight-Source: adsb.lol
- src/sources/live/standalone.js createOpenSkySource.getSnapshot reads header, maps to sourceId opensky/adsb.lol, captures receiptMs = now() once per batch, passes to openSkySnapshot as receivedAtMs + sourceId
- src/sources/live/aircraft.js openSkySnapshot/readsbSnapshot -> {records, sourceId, receivedAtMs, observedAtMs, source}
- src/layers/flights/snapshotRenderer.js applySnapshot -> records.receive(observation, {sourceId, receivedAtMs, ...})
- src/layers/flights/records.js FlightRecords.receive() sticky merge, enrichment retention via prevMeta
- src/layers/flights/enrichment.js _requestTypeEnrichment/_requestRouteEnrichment -> feed._source.getEnrichment -> /api/adsbdb/type|route -> onData callback mutates meta.typeCode etc
- src/data/aircraftMeta.js stickyText / stickyNumber
- src/data/renderAltitude.js pickRenderAltitudeM
- src/data/aircraftClass.js classifyAircraft

## Observation normalization

OpenSky row:
- id = row[0] lowercased
- callsign = cleanText(row[1])
- originCountry = cleanText(row[2])
- positionTimeMs = epoch(row[3],1000)  // time_position
- contactTimeMs = epoch(row[4],1000)   // last_contact
- longitude = row[5], latitude = row[6]
- baroAltitudeM = finite(row[7])
- onGround = row[8]===true
- speedMps = finite(row[9])
- courseDeg = finite(row[10])
- verticalRateMps = finite(row[11])
- ellipsoidAltitudeM = finite(row[13])
- category = finite(row[17])

readsb (adsb.lol):
- id = hex lowercased
- lat/lon finite required
- baroAltitudeM = alt_baro ft *0.3048 else null, onGround = alt_baro === 'ground'
- geoAltitudeM = alt_geom ft *0.3048
- speedMps = gs kts *0.514444
- courseDeg = track
- verticalRateMps = baro_rate ft/min *0.00508
- callsign = flight trimmed
- positionTimeMs = snapshotTimeMs - seenPos*1000
- contactTimeMs = snapshotTimeMs - seen*1000
- snapshotTimeMs = receiptMs - cacheAge

## FlightRecords.receive() current field inventory

From src/layers/flights/records.js meta:

- sourceReference: observation.reference (internal)
- observedReceiptMs: Date.now() per receive (legacy, not provenance)
- callsign: stickyText(callsign, prev.callsign) -> '' if both missing
- altitude: stickyNumber(baro_alt, prev.altitude, onGround?0:10000) -> 0/10000 fallback synthetic
- geoAltitudeM: finite(geo_alt)?geo_alt:null -> null when missing, NOT sticky
- renderAltitudeM: pickRenderAltitudeM({geoAltM, baroAltM, onGround, surfaceM, geoidN}) -> null sentinel then fallback to prev.renderAltitudeM if finite else alt. Plus floorAltitudeM clamp for low airborne near viewer/tracked.
- onGround: on_ground===true boolean, NOT sticky
- wasAirborne: prev.wasAirborne===true || !onGround -> derived sticky boolean
- velocity: stickyNumber(velocity, prev.velocity, 0) -> 0 fallback synthetic
- true_track: stickyNumber(true_track, prev.true_track, 0) -> 0 fallback synthetic
- category: stickyNumber(category, prev.category, null) -> null when missing
- klass: classifyAircraft({typeCode: prev.typeCode??null, category: cat}) -> derived from enrichment + category
- turnRateDps: prev.turnRateDps||0 -> retained, updated via history in snapshotRenderer
- verticalRate: stickyNumber(vertical_rate, prev.verticalRate, null)
- originCountry: stickyText(origin_country, prev.originCountry)||null
- lastContactEpochMs: stickyNumber(contactTimeMs, prev.lastContactEpochMs, null)
- typeCode: prev.typeCode??null (enrichment, not set in receive)
- typeName: prev.typeName??null
- registration: prev.registration??null
- airline: prev.airline??null
- route: prev.route??null
- rawLat: lat direct, NOT sticky, always present when admitted
- rawLon: lon direct, NOT sticky

## Sticky semantics per field

- stickyNumber(next, prev, fallback):
  - if finite(next) -> replace with next
  - else if finite(prev) -> retain prev
  - else -> fallback (may be null or synthetic 0/10000)

- stickyText(next, prev):
  - trimmed next non-empty -> replace
  - else trimmed prev non-empty -> retain
  - else '' (or ||null becomes null for originCountry)

- Non-sticky direct (rawLat/rawLon, geoAltitudeM, onGround, renderAltitudeM computation):
  - rawLat/rawLon: always replacement when new observation (admission requires lat/lon finite)
  - geoAltitudeM: finite? replacement, else null (no retention)
  - onGround: boolean from observation, always replacement
  - renderAltitudeM: derived each receive, replacement always (computed)

- Enrichment retention via prevMeta?.field ?? null in receive, plus enrichment callback overwrite with || retention:
  - typeCode/typeName/registration/airline/route retained across polls until enrichment callback overwrites with truthy value.

- Derived:
  - klass: recomputed each receive from typeCode+category, replacement always when inputs change
  - wasAirborne: true if ever airborne this session, sticky boolean
  - renderAltitudeM: derived each receive
  - turnRateDps: from history, retained then recomputed

## Timestamp availability

- positionTimeMs: available for both OpenSky (row[3]) and readsb (snapshotTimeMs - seenPos). Represents time of last position fix.
- contactTimeMs: available for both OpenSky (row[4]) and readsb (snapshotTimeMs - seen). Represents time of last transponder message.
- No per-field separate timestamps for altitude, velocity, track, verticalRate, callsign, category, originCountry. Only positionTimeMs and contactTimeMs exist.
- Truthful mapping:
  - position group (rawLat/rawLon): reportedAtMs = positionTimeMs
  - geoAltitudeM, altitude, onGround: position-related, best available = positionTimeMs (fallback to contactTimeMs if positionTimeMs missing)
  - kinematics/identity (velocity, true_track, verticalRate, callsign, originCountry, category, lastContactEpochMs): contactTimeMs (fallback to positionTimeMs)
  - onGround: could be either, but positionTimeMs more appropriate (ground state tied to position)
  - lastContactEpochMs: its value IS contactTimeMs, so reportedAtMs = contactTimeMs (self)
  - enrichment (typeCode, registration, airline, route, typeName): no source timestamp from adsbdb, reportedAtMs = null
  - derived (klass, wasAirborne, renderAltitudeM, turnRateDps): no external report time, derived time = max of input reported times or null, not required to have source timestamp.

- Receipt timestamp: receivedAtMs = snapshot receipt time (one per batch, from standalone.js now() ) for REPORTED fields from OpenSky/adsb.lol. For enrichment, receipt time = Date.now() when enrichment callback fires (client receipt of enrichment). Available via capturing now in callback.

## Field trace table

| field | current source | sticky? | replacement condition | becomes null/default | source/report ts available | receipt ts available | REPORTED/DERIVED | can implement now? | recommended group |
|---|---|---|---|---|---|---|---:|---|---|
| rawLat | observation.latitude (row[6] / lat) | No | always new observation (admission requires finite) | never null when admitted (else record not admitted) | positionTimeMs | snapshot receivedAtMs (batch) | REPORTED | YES (already I3a) | position |
| rawLon | observation.longitude | No | always new | never null | positionTimeMs | batch | REPORTED | YES (I3a) | position |
| altitude (baro) | observation.baroAltitudeM | Yes stickyNumber fallback 0/10000 | finite next -> replace | null never, fallback 0 (ground) or 10000 (airborne) synthetic | positionTimeMs (or contactTimeMs) | batch | REPORTED when finite, no provenance when fallback | YES | altitude (separate from geo) |
| geoAltitudeM | observation.ellipsoidAltitudeM | No (finite?value:null) | finite next -> replace, else null | null when missing | positionTimeMs | batch | REPORTED when finite, no prov when null | YES | geoAltitude (separate) |
| velocity | observation.speedMps | Yes stickyNumber fallback 0 | finite next -> replace | 0 fallback synthetic when both missing | contactTimeMs | batch | REPORTED when finite, no prov when fallback 0 without source | YES | velocity |
| true_track | observation.courseDeg | Yes stickyNumber fallback 0 | finite next -> replace | 0 fallback synthetic | contactTimeMs | batch | REPORTED when finite | YES | track |
| verticalRate | observation.verticalRateMps | Yes stickyNumber fallback null | finite next -> replace | null when both missing | contactTimeMs | batch | REPORTED when finite | YES | verticalRate |
| callsign | observation.callsign | Yes stickyText '' | trimmed non-empty next -> replace | '' when both missing (then null in some views) | contactTimeMs | batch | REPORTED when non-empty | YES | callsign |
| originCountry | observation.originCountry | Yes stickyText||null | trimmed non-empty next -> replace | null when both missing | contactTimeMs | batch | REPORTED when non-empty | YES | originCountry |
| category | observation.category | Yes stickyNumber null | finite next -> replace | null when both missing | contactTimeMs | batch | REPORTED when finite | YES | category |
| onGround | observation.onGround boolean | No | always replacement (boolean) | never null, false when missing | positionTimeMs (or contact) | batch | REPORTED | YES | onGround |
| lastContactEpochMs | observation.contactTimeMs | Yes stickyNumber null | finite next -> replace | null when both missing | contactTimeMs (value itself) | batch | REPORTED when finite | YES | lastContact |
| typeCode | adsbdb aircraft.icao_type via enrichment callback | Yes via prev ?? null + \|\| retain | enrichment returns truthy -> replace | null when never enriched | null (adsbdb no timestamp) | enrichment callback Date.now() | REPORTED sourceId adsbdb | YES with minor wiring (capture now) | enrichment.typeCode |
| typeName | adsbdb manufacturer+type | Same | same | null | null | enrichment now | REPORTED adsbdb | YES | enrichment.typeName |
| registration | adsbdb registration | Same | same | null | null | enrichment now | REPORTED adsbdb | YES | enrichment.registration |
| airline | adsbdb route airline.name | Same (route) | truthy -> replace | null | null | enrichment now | REPORTED adsbdb | YES | enrichment.airline |
| route | adsbdb route origin/destination | Same | origin+destination present -> replace | null | null | enrichment now | REPORTED adsbdb | YES | enrichment.route |
| klass | classifyAircraft({typeCode, category}) | Derived recomputed each receive | inputs change -> replace | always present (defaults airliner) | max of typeCode/category reported times or null | batch or enrichment receipt | DERIVED via classification | YES with via support | derived.klass |
| wasAirborne | prev.wasAirborne \|\| !onGround | Derived sticky boolean | once true stays true | boolean always | null or max of onGround times | batch | DERIVED via airborne-history | YES | derived.wasAirborne |
| renderAltitudeM | pickRenderAltitudeM + fallback + floorAltitudeM clamp | Derived recomputed each receive | always replacement (computed) | never null (fallback alt) | max of geo/baro/onGround/surface inputs or null | batch | DERIVED via render-altitude-selection + ground-floor-clamp | YES but complex inputs (surfaceM MODELED) | derived.renderAltitudeM |
| turnRateDps | turnRateFromFixHistory(history) in snapshotRenderer | Derived retained + recomputed | history changes -> replace | 0 fallback | null | batch | DERIVED via turn-rate-from-history | YES but depends on history, can defer | derived.turnRate (defer) |

Additional fields not listed but present:
- sourceReference, observedReceiptMs internal, not analyst.
- operator (military only) not in flights.

## Altitude care

- barometric altitude (altitude field) is provider-reported aviation altitude, sticky, REPORTED when finite.
- geometric altitude (geoAltitudeM) is provider-reported WGS84 ellipsoidal, non-sticky, REPORTED when finite.
- renderAltitudeM is NOT reported, it's GEV visual height: priority chain geo > baro+geoid > surface, plus floor clamp. Must NOT contaminate reported altitude provenance. Unit conversion (ft*0.3048) preserves REPORTED.

Military ft/m conversions: military store converts baroAltitudeM ft->m via /0.3048? Actually military receives baroAltitudeM already in meters from normalizeReadsb (ft*0.3048), then stores altitudeFt = baro/0.3048, altitudeM = baro. So same.

## Enrichment trace A-G

A. exact external sourceId: 'adsbdb' (stable machine id, matches server provider name, not storeId)
B. exact fetch/receipt time currently available: client receipt time via Date.now() in enrichment onData callback, not currently captured but trivially available (add now). Server cache at Date.now() stored as at, but client receipt is more truthful for GEV client receipt.
C. whether adsbdb supplies meaningful source/report timestamp: No. API returns aircraft/route data without timestamp. Server caches with at=Date.now() but that's cache time, not source report time. So reportedAtMs = null truthful.
D. whether enrichment callback knows which fields actually changed: Yes via truthy check: data.typeCode || meta.typeCode retains if falsy, so can detect change by checking if data.field truthy and different from prev.
E. how enrichment is retained across observations: via prevMeta?.field ?? null in FlightRecords.receive() carries across polls, plus || in callback.
F. how enrichment cache affects provenance: enrichSeen Set prevents re-enqueue for same key t:icao24 or r:callsign, so enrichment fetched once per session per aircraft/callsign. Provenance set once, retained.
G. whether route and aircraft metadata have different requests/caches: Yes, type enrichment keyed by icao24 (t:icao24), route enrichment keyed by callsign (r:CS), separate queues, separate caches, separate sourceId same 'adsbdb' but different kind.

Owner decision locked: adsbdb-supplied values REPORTED, aircraft class deterministically computed from typeCode/category DERIVED.

Conclusion: enrichment provenance feasible with minor wiring to capture receipt time in callback.

## Derived fields

- klass: inputs typeCode (adsbdb REPORTED) + category (opensky REPORTED). Deterministic pure function classifyAircraft. Recomputes when inputs change. Can truthfully identify via='classification' without lineage graph. No single external source, so no sourceId. ReceivedAtMs not needed or could be batch receipt. Implement as DERIVED via classification.

- wasAirborne: inputs prev.wasAirborne (internal) + onGround (REPORTED). Deterministic sticky boolean. Via='airborne-history'. DERIVED.

- renderAltitudeM: inputs geoAltitudeM (REPORTED), baroAltitudeM (REPORTED), onGround (REPORTED), surfaceM (MODELED ground floor cache), geoidN (MODELED). Multiple origins/times, deterministic priority chain + clamp. Via='render-altitude-selection' (plus floor clamp). No single sourceId. DERIVED.

All deterministic, recompute when inputs change, via sufficient, no DAG needed.

## INTERPRETED not part of slice

Do NOT implement analyst/AI provenance.

## Provenance storage design evaluation

I3a: positionProvenance Map<icao24, descriptor>

Options:
A. Map<nativeId, {position, state, callsign, enrichment, derived...}> grouped: Would lie when fields within group diverge (e.g., velocity retained while track replaced). Not acceptable without sparse overrides.

B. Several small Maps: positionProvenance, altitudeProvenance, velocityProvenance... Many Maps, more overhead, still need per-field.

C. Sparse field/group sidecar: Map<icao24, {position, altitude, geoAltitudeM, velocity, true_track, verticalRate, callsign, originCountry, category, onGround, lastContactEpochMs, typeCode, registration, airline, route, klass, wasAirborne, renderAltitudeM}> where each value is provenance descriptor or undefined. Per-field, explicit, correct, handles divergence, simple. Overhead ~11k * ~15 fields = 165k descriptors worst case, but sparse (null fields no provenance) reduces. For 11k aircraft, estimate: position always present (11k), altitude maybe 10k, geoAltitude maybe 5k, velocity 10k, track 10k, verticalRate 5k, callsign 8k, originCountry 8k, category 6k, onGround 11k, lastContact 11k, enrichment maybe 3k each, derived 11k each. Total maybe ~100k descriptors. Each descriptor ~ 4 fields + frozen overhead ~ maybe 100 bytes => ~10 MB plus Map overhead ~ few MB. Acceptable for browser? Might be high but still within 20-30 MB. No history.

D. Group default + sparse overrides: Map<icao24, {position, state:{default, overrides:Map}, identity:{default, overrides}, enrichment:{...}, derived:{...}}> Correct, more memory efficient (1-2 descriptors per aircraft typical, overrides only when divergence). More complex.

Decision: Choose C (explicit per-field) for simplicity and correctness, because task says correctness and maintainability matter more than saving handful of objects, and do not implement clever compression unless actually simpler. Per-field is simplest to reason about and matches invariant provenance follows current value exactly.

We can implement as single Map<icao24, Object> where object contains provenance per field, copy-safe.

Memory estimate: O(records * fields_with_values) ~ O(records * ~10) = ~110k descriptors, ~10-20 MB, acceptable for I3b. No premature compression.

If needed later, can optimize to group default + overrides.

## Current-state only

Replacement: old provenance disappears
Retention: current provenance stays
Deletion/reset: provenance disappears with record (forget)
No arrays, no history.

## Null/absent semantics

Preferred rule: NO CURRENT VALUE => NO VALUE PROVENANCE

- geoAltitudeM null => no provenance
- altitude fallback 0/10000 synthetic when both next and prev missing => no provenance (value exists but not reported, should have no REPORTED provenance; could have DERIVED via default but prefer no provenance for REPORTED group)
- velocity fallback 0 synthetic => no provenance when fallback, provenance present when reported 0 (distinguishable by presence)
- true_track same
- verticalRate null => no provenance
- callsign '' => no provenance (or empty string considered absent)
- originCountry null => no provenance
- category null => no provenance
- onGround always boolean => always provenance (REPORTED)
- lastContact null => no provenance
- enrichment null => no provenance
- derived always present => always DERIVED provenance

Distinguish provider reported null vs GEV has no current value: we only store provenance when current value is present and reported. If provider reports null (missing), we retain old value+provenance or have no value, not attach new provenance for null.

## Source switches

General flights store can receive OpenSky primary and adsb.lol fallback (via X-Flight-Source header). Test sticky behavior across source switches.

Example T1 OpenSky: callsign ABC123, velocity 200, position P1, sourceId opensky, reportedAtMs T1, receivedAtMs R1
T2 adsb.lol fallback: new position P2, velocity 210, callsign absent, sourceId adsb.lol, reportedAtMs T2, receivedAtMs R2

Expected:
- position provenance -> adsb.lol T2/R2 (replaced)
- velocity provenance -> adsb.lol T2/R2 (replaced)
- callsign remains ABC123, provenance remains opensky T1/R1 (retained)

Reverse switch similar.

This proves independent sticky per field.

## Military store decision

Military uses same FlightRecords-like but separate class MilitaryFlightRecords. Currently does NOT receive sourceId/receivedAtMs. SnapshotRenderer does not pass sourceId. Would require wiring.

Fields similar but with altitudeFt, type, operator.

Including military now would require:
- Add provenance Maps to MilitaryFlightRecords
- Update military snapshotRenderer to pass sourceId/receivedAtMs (available from snapshot: sourceId adsb.lol, receivedAtMs receiptMs)
- Update military queries to expose getProvenanceMap()
- Tests

This materially enlarges slice beyond flights, and military has unit conversion and different enrichment? No enrichment for military currently.

Decision: DEFER military to next slice. Keep I3b focused on general flights store only. Document.

## Sidecar public contract

I3a: getProvenanceMap() returns Map<icao24, descriptor> position only, STORE-LOCAL keyed by native record key.

I3b evolution: need to return Map<icao24, {position, altitude, ...}> full per-field provenance.

Breaking change from I3a position-only shape. Currently no broad consumers, only tests. So changing shape is acceptable if explicit and tests updated.

Alternative: preserve getProvenanceMap() as position-only for backward compat and add getFullProvenanceMap() or getAircraftProvenanceMap(). But that preserves awkward temporary shape forever.

Prefer smallest coherent API: evolve getProvenanceMap() to new shape {position, ...} and update I3a contract docs/tests explicitly. Document as evolution.

TIS-B behavior: store-local includes TIS-B ~, keyed by native id, no synthetic keys, same as I3a.

recordIndex unchanged.

## Provenance primitive expansion

Current src/data/provenance.js supports REPORTED with sourceId, reportedAtMs, receivedAtMs, but not via for DERIVED.

Need to add via?: string optional for DERIVED (and possibly REPORTED for unit-conversion note).

Proposed minimal expansion:

createProvenance({epistemic, sourceId, reportedAtMs, receivedAtMs, via})

- epistemic required
- sourceId required for REPORTED, optional for DERIVED
- reportedAtMs optional null
- receivedAtMs required for REPORTED, optional for DERIVED
- via optional string, allowed for DERIVED (and optionally REPORTED for unit-conversion), must be non-empty trimmed if present, ^[a-z0-9._-]+$ or similar, 1..64 chars, no whitespace.

Add validation, include via in frozen descriptor, forbid other fields.

Update isValidProvenance to allow via and check forbidden list still.

## Age remains query-time

Do not store ageMs.

## No quality/confidence

Still deferred.

## Memory check

See storage design evaluation.

## Stop conditions check

A. truthful provenance requires full per-observation history? No, current-state only sufficient, sticky retention handled via retaining provenance with retained value.

B. adsbdb receipt timing cannot be obtained without significant redesign? No, receipt timing via Date.now() in callback is trivial, not significant redesign. So enrichment feasible, but we may defer to keep slice small. Decision: include REPORTED fields now, defer enrichment to I3c if we want smallest, but task says enrich is part of meaningful fields. We can include enrichment with minor wiring, not significant redesign.

C. fields grouped together can diverge independently in ways proposed representation cannot express? If we use per-field representation, no. If we used grouped, yes would lie. So per-field avoids.

D. implementing DERIVED requires lineage graph? No, via sufficient.

E. military support materially enlarges task? Yes, so defer.

F. sidecar evolution would require recordIndex changes? No.

G. current provider timestamps cannot truthfully support field provenance claim? We have positionTimeMs and contactTimeMs, sufficient for REPORTED, with null allowed.

H. current code's sticky semantics ambiguous/buggy? Sticky semantics clear: stickyNumber/Text with fallback. Not ambiguous.

All stop conditions pass, can implement.

## Recommended implementation plan for I3b

1. Expand src/data/provenance.js to support via optional.
2. Extend FlightRecords to maintain full provenance Map<icao24, {field: descriptor}>:
   - Keep positionProvenance for backward compat internally or migrate to full map
   - In receive(), for each REPORTED field, determine if replacement (finite/non-empty) vs retention vs fallback, create/update provenance accordingly
   - For geoAltitudeM null => delete provenance
   - For altitude/velocity/track fallback synthetic => no provenance
   - For onGround always replacement
   - For enrichment: update enrichment.js to capture receipt time and update provenance sidecar
   - For derived: klass, wasAirborne, renderAltitudeM with DERIVED via
3. Update getProvenanceMap() to return Map<icao24, {position, altitude, ...}> copy-safe
4. Update tests: I3a position tests still pass if new shape includes position field, but need to update expectations
5. Add new tests for I3b per matrix
6. Update docs

## Fields receiving provenance in I3b (proposed)

REPORTED (flights store):
- position (rawLat/rawLon) already
- altitude (baro)
- geoAltitudeM
- velocity
- true_track
- verticalRate
- callsign
- originCountry
- category
- onGround
- lastContactEpochMs

ENRICHMENT (deferred? include if feasible):
- typeCode
- registration
- airline
- route
- typeName

DERIVED:
- klass via classification
- wasAirborne via airborne-history
- renderAltitudeM via render-altitude-selection

Deferred:
- turnRateDps (depends on history, can defer)
- military store
- vessel, satellite

## Next slice recommendation

I3c: enrichment provenance + remaining derived + military store

