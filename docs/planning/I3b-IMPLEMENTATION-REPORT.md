# I3b IMPLEMENTATION REPORT — Aircraft Current-Field / Sticky Provenance

Date: 2026-09-18
Branch: arena/01a0b2f3-gods-eye-view
Status: I3b IMPLEMENTED, ready for owner review

## 1. Exact files changed

- src/data/provenance.js — added via validation, DERIVED requires via, descriptor now {epistemic, sourceId, reportedAtMs, receivedAtMs, via}
- src/layers/flights/records.js — added full per-field provenance Map<icao24, {field: descriptor}>:
  - Keeps positionProvenance for backward compat (I3a)
  - New provenance Map for all current fields
  - Implements sticky retention: replacement replaces provenance, retention retains old provenance, fallback/null deletes provenance
  - Implements REPORTED for altitude, geoAltitudeM, velocity, true_track, verticalRate, callsign, originCountry, category, onGround, lastContactEpochMs, position
  - Implements DERIVED for klass (classification), wasAirborne (airborne-history), renderAltitudeM (render-altitude-selection)
  - Handles sourceId/receivedAtMs from snapshot, reportedAtMs from positionTimeMs/contactTimeMs
  - forget() deletes both maps
- src/layers/flights/queries.js — evolved getProvenanceMap() from I3a Map<icao24, descriptor> position-only to I3b Map<icao24, {field: descriptor}> full per-field:
  - Copy-safe: fresh Map, fresh object per aircraft, fresh copy per descriptor
  - Merges legacy positionProvenance if full map empty (backward compat)
  - Updated JSDoc to explain breaking change from I3a, TIS-B, store-local vs canonical two-level
- src/layers/flights/enrichment.js — added enrichment provenance:
  - Imports EPISTEMIC, createProvenance
  - Captures receivedAtMs = Date.now() at onData callback
  - Creates REPORTED descriptor sourceId='adsbdb', reportedAtMs=null, receivedAtMs
  - Updates provenance Map for typeCode, typeName, registration, airline, route when enrichment sets field
  - Ensures klass DERIVED provenance exists after enrichment changes typeCode
- src/data/provenance.test.mjs — updated test "no registry" to require via for DERIVED (I3b evolution)
- src/layers/flights/provenance.b.test.mjs NEW — 18 tests for I3b REPORTED + DERIVED + sticky divergence + source switch + null semantics + copy-safe
- src/layers/flights/provenance.enrichment.test.mjs NEW — 4 tests for enrichment provenance (adsbdb REPORTED, retention, no invented timestamp)
- docs/planning/I3b-TRACE.md NEW — pre-implementation trace table (Phase 1)
- docs/planning/I3b-IMPLEMENTATION-REPORT.md NEW — this file

No changes to:
- src/data/entityKey.js
- src/data/recordIndex.js (behavior unchanged, provenance-unaware)
- src/layers/military/* (deferred)
- src/data/geo.js (D9 untouched)
- I4/I5/I6/I9 files

## 2. Pre-implementation field trace table

See docs/planning/I3b-TRACE.md for full table.

Summary:

| field | source | sticky | replacement | fallback | report ts | receipt ts | epistemic | implement? | group |
|---|---|---|---|---|---|---|---|---|---|
| rawLat | obs.latitude | No | always new | never null | positionTimeMs | batch | REPORTED | YES (I3a) | position |
| rawLon | obs.longitude | No | always new | never null | positionTimeMs | batch | REPORTED | YES (I3a) | position |
| altitude (baro) | obs.baroAltitudeM | Yes 0/10000 fallback | finite next | fallback synthetic | positionTimeMs | batch | REPORTED when finite | YES | altitude |
| geoAltitudeM | obs.ellipsoidAltitudeM | No null | finite next | null | positionTimeMs | batch | REPORTED when finite | YES | geoAltitudeM |
| velocity | obs.speedMps | Yes 0 fallback | finite next | 0 synthetic | contactTimeMs | batch | REPORTED when finite | YES | velocity |
| true_track | obs.courseDeg | Yes 0 fallback | finite next | 0 synthetic | contactTimeMs | batch | REPORTED when finite | YES | track |
| verticalRate | obs.verticalRateMps | Yes null | finite next | null | contactTimeMs | batch | REPORTED when finite | YES | verticalRate |
| callsign | obs.callsign | Yes '' | trimmed non-empty next | '' | contactTimeMs | batch | REPORTED when non-empty | YES | callsign |
| originCountry | obs.originCountry | Yes null | trimmed non-empty next | null | contactTimeMs | batch | REPORTED when non-empty | YES | originCountry |
| category | obs.category | Yes null | finite next | null | contactTimeMs | batch | REPORTED when finite | YES | category |
| onGround | obs.onGround bool | No | always | never null | positionTimeMs | batch | REPORTED | YES | onGround |
| lastContactEpochMs | obs.contactTimeMs | Yes null | finite next | null | contactTimeMs (self) | batch | REPORTED when finite | YES | lastContact |
| typeCode | adsbdb aircraft.icao_type | Yes via prev ?? null + enrichment | enrichment truthy | null | null | enrichment callback now | REPORTED adsbdb | YES (implemented in enrichment.js) | enrichment |
| typeName | adsbdb | Same | same | null | null | enrichment now | REPORTED adsbdb | YES | enrichment |
| registration | adsbdb | Same | same | null | null | enrichment now | REPORTED adsbdb | YES | enrichment |
| airline | adsbdb route airline.name | Same | truthy | null | null | enrichment now | REPORTED adsbdb | YES | enrichment |
| route | adsbdb route origin/dest | Same | origin+dest present | null | null | enrichment now | REPORTED adsbdb | YES | enrichment |
| klass | classifyAircraft({typeCode, category}) | Derived | inputs change | always present | null or max inputs | batch/enrichment | DERIVED via classification | YES | derived |
| wasAirborne | prev.wasAirborne \|\| !onGround | Derived sticky | once true stays true | boolean | null | batch | DERIVED via airborne-history | YES | derived |
| renderAltitudeM | pickRenderAltitudeM + floor clamp | Derived | always recomputed | never null | null or max inputs | batch | DERIVED via render-altitude-selection | YES | derived |
| turnRateDps | turnRateFromFixHistory | Derived history | history changes | 0 | null | batch | DERIVED via turn-rate-from-history | DEFERRED | derived (defer) |

Altitude care: baro altitude REPORTED, geo altitude REPORTED, renderAltitudeM DERIVED, unit conversion preserves REPORTED, military ft/m conversions similar.

## 3. Fields receiving provenance in I3b

REPORTED (flights store, from OpenSky/adsb.lol snapshot):
- position (rawLat/rawLon) — already I3a, retained
- altitude (baro) — REPORTED when finite, positionTimeMs
- geoAltitudeM — REPORTED when finite, positionTimeMs, non-sticky null
- velocity — REPORTED when finite, contactTimeMs, sticky 0 fallback no provenance
- true_track — REPORTED when finite, contactTimeMs, sticky 0 fallback no provenance
- verticalRate — REPORTED when finite, contactTimeMs, sticky null
- callsign — REPORTED when non-empty, contactTimeMs, sticky ''
- originCountry — REPORTED when non-empty, contactTimeMs, sticky null
- category — REPORTED when finite, contactTimeMs, sticky null
- onGround — REPORTED always boolean, positionTimeMs
- lastContactEpochMs — REPORTED when finite, contactTimeMs (self)

ENRICHMENT (adsbdb, via enrichment.js):
- typeCode — REPORTED sourceId adsbdb, reportedAtMs null, receivedAtMs enrichment callback now
- typeName — same
- registration — same
- airline — same
- route — same

DERIVED:
- klass — DERIVED via classification, no sourceId
- wasAirborne — DERIVED via airborne-history
- renderAltitudeM — DERIVED via render-altitude-selection

## 4. Fields explicitly deferred

- turnRateDps — derived from fix history, depends on history, can defer to I3c
- Military store — same FlightRecords-like but separate wiring, deferred (see §12)
- Vessel, satellite, other layers — not aircraft current-state
- Enrichment cache timing edge cases — enrichment provenance implemented but route/type have different keys (t:icao vs r:callsign), already handled; full cache provenance (server .gev-cache) deferred
- Quality/confidence, ageMs, freshness — still I5 deferred
- MODELED fields (groundFloor, geoidN, dead-reckon) — not current-state REPORTED, deferred to I4/I5
- INTERPRETED — not part of slice

## 5. Final provenance grouping/storage shape

Design C — explicit per-field sparse sidecar — chosen for correctness and maintainability over clever compression.

FlightRecords:
- positionProvenance: Map<icao24, descriptor> — legacy I3a position only, kept for backward compat, synced
- provenance: Map<icao24, {field: descriptor}> — full per-field, sparse (only fields with current value have provenance)

Per aircraft object example:
```js
{
  position: {epistemic:'reported', sourceId:'opensky', reportedAtMs:1710000000000, receivedAtMs:1710000005000, via:null},
  altitude: {epistemic:'reported', sourceId:'opensky', reportedAtMs:1710000000000, receivedAtMs:1710000005000, via:null},
  geoAltitudeM: {epistemic:'reported', sourceId:'opensky', reportedAtMs:1710000000000, receivedAtMs:1710000005000, via:null},
  velocity: {epistemic:'reported', sourceId:'opensky', reportedAtMs:1710000001000, receivedAtMs:1710000005000, via:null},
  true_track: {...},
  verticalRate: {...},
  callsign: {...},
  originCountry: {...},
  category: {...},
  onGround: {...},
  lastContactEpochMs: {...},
  typeCode: {epistemic:'reported', sourceId:'adsbdb', reportedAtMs:null, receivedAtMs:1710000010000, via:null},
  registration: {...},
  airline: {...},
  route: {...},
  klass: {epistemic:'derived', sourceId:null, reportedAtMs:null, receivedAtMs:null, via:'classification'},
  wasAirborne: {epistemic:'derived', via:'airborne-history'},
  renderAltitudeM: {epistemic:'derived', via:'render-altitude-selection'}
}
```

Sparse: if geoAltitudeM null, field absent; if altitude fallback 10000, altitude absent; if velocity fallback 0, velocity absent.

Memory: O(records * fields_with_values). For 11k aircraft, typical fields present ~10 REPORTED + 3 DERIVED + maybe 2 enrichment = 15. Worst 165k descriptors. Each descriptor frozen object ~ 5 props, ~100 bytes => ~16.5 MB plus Map overhead ~5 MB => ~20 MB. Acceptable, no history.

Alternative group default + sparse overrides considered but rejected as more complex than explicit per-field, task says correctness over saving handful objects.

## 6. Why grouped fields cannot lie when updates diverge — or how sparse overrides handle divergence

Fields can become sticky independently: OpenSky intermittently drops callsign/velocity/track individually (comment in records.js). If we grouped velocity+track+callsign under single "kinematics" or "identity" provenance descriptor, one shared descriptor would eventually lie: e.g., T1 velocity=200 track=90 callsign=ABC all from same observation T1. T2 provides velocity=210 but omits callsign and track. If we have one group descriptor for all three, after T2 we would have to choose either T1 or T2 for whole group, lying about either velocity (should be T2) or callsign/track (should remain T1).

Our per-field design avoids this: each field has independent provenance. When T2 arrives with velocity=210 but no callsign/track, we replace velocity provenance to T2/R2, retain callsign/track provenance at T1/R1. Provenance diverges correctly.

Example from tests:
- T1: callsign AAA, velocity 100, track 10, altitude 1000, source opensky R1
- T2: callsign '', velocity 110, track null, altitude null, source opensky R2
  - Result: callsign AAA retained, provenance R1; velocity 110 replaced, provenance R2; track 10 retained, provenance R1; altitude 1000 retained, provenance R1.
- T3: callsign BBB, velocity null, altitude 2000, R3
  - Result: callsign BBB replaced R3, velocity 110 retained R2, altitude 2000 replaced R3.

This proves independent sticky fields diverge correctly.

We do NOT need sparse overrides because per-field is explicit and simple. If we later want compression, group default + overrides could be introduced, but per-field is currently simpler and correct.

## 7. Exact REPORTED timestamp semantics for each group

- position (rawLat/rawLon): reportedAtMs = observation.positionTimeMs (OpenSky row[3] time_position, readsb snapshotTimeMs - seenPos). If positionTimeMs missing/invalid, null. receivedAtMs = snapshot.receivedAtMs (one per batch, from standalone.js now()).
- altitude (baro): reportedAtMs = positionTimeMs (same as position, since altitude part of state vector tied to position). Fallback to contactTimeMs if positionTimeMs null.
- geoAltitudeM: reportedAtMs = positionTimeMs (geometric altitude tied to position fix). Null when missing.
- onGround: reportedAtMs = positionTimeMs (ground state tied to position).
- velocity, true_track, verticalRate, callsign, originCountry, category, lastContactEpochMs: reportedAtMs = contactTimeMs (OpenSky row[4] last_contact, readsb snapshotTimeMs - seen). Fallback to positionTimeMs if contactTimeMs missing, else null. This is most truthful available: no per-field separate timestamps exist, only positionTimeMs and contactTimeMs. Using contactTimeMs for kinematics/identity is reasonable, as last_contact is time of last transponder message.
- lastContactEpochMs: value itself is contactTimeMs, so reportedAtMs = contactTimeMs (self-referential but truthful).
- Enrichment (typeCode, registration, airline, route, typeName): reportedAtMs = null (adsbdb API provides no source timestamp, server cache at Date.now() is cache time not source report time). receivedAtMs = Date.now() when enrichment callback fires (client receipt of enrichment). sourceId = 'adsbdb'.
- Derived: no reportedAtMs required, no receivedAtMs required, via only. Optionally receivedAtMs could be batch receipt, but we omit to avoid inventing.

All REPORTED require sourceId and receivedAtMs per I3a rule. For flights store, sourceId = 'opensky' or 'adsb.lol' from X-Flight-Source header, receivedAtMs = snapshot receipt time (single per batch). For enrichment, sourceId='adsbdb', receivedAtMs=enrichment receipt.

No ageMs stored, no freshness.

## 8. Exact sticky-retention behavior

- stickyNumber(next, prev, fallback): if finite(next) -> replace value and provenance; else if finite(prev) -> retain value and retain old provenance; else -> fallback value (0/10000 or null) with no REPORTED provenance (synthetic or absent).
- stickyText(next, prev): trimmed next non-empty -> replace value and provenance; else trimmed prev non-empty -> retain value and provenance; else '' or null -> no value, no provenance.
- Non-sticky (geoAltitudeM): finite(next) -> replace value and provenance, else null and delete provenance (no retention).
- onGround boolean: always replacement, always new provenance (boolean always present).
- Enrichment: via prevMeta?.field ?? null in receive() retains across polls, plus enrichment callback overwrite with truthy check (data.field || meta.field). Provenance for enrichment retained with value, updated when enrichment callback sets new value (new receipt time).
- Derived: always present, via only, recomputed each receive (klass from typeCode+category, wasAirborne from prev+onGround, renderAltitudeM from pickRenderAltitudeM+floor clamp). Provenance via stays constant, no timestamps.

Invariant preserved: provenance follows current value. If newer observation does not replace current value, old provenance remains. If replaced, new provenance with new sourceId/report/receipt.

## 9. Exact source-switch behavior

General flights store can receive OpenSky primary and adsb.lol fallback (via X-Flight-Source header). Military store separate.

Source switch handling:

- Position: always replacement when valid position present (admission requires lat/lon). So source switch always updates position provenance to new sourceId if new position valid.

- Other REPORTED fields: independent sticky per field.

Example T1 OpenSky: callsign ABC123, velocity 200, position P1, sourceId opensky, reportedAtMs T1, receivedAtMs R1
T2 adsb.lol fallback: new position P2, velocity 210, callsign absent, sourceId adsb.lol, reportedAtMs T2, receivedAtMs R2

Expected and implemented:
- position provenance -> adsb.lol T2/R2 (replaced)
- velocity provenance -> adsb.lol T2/R2 (replaced)
- callsign remains ABC123, provenance remains opensky T1/R1 (retained)

Reverse switch same.

Tested in provenance.b.test.mjs:
- source switch with replacement updates provenance
- source switch without replacement preserves provenance
- independent sticky fields diverge correctly across source switches

Implementation ensures: if new observation lacks valid position (NaN guard), old position provenance retained, not relabeled to new source (I3a invariant). Similarly for other fields: if new observation omits field, old provenance retained.

## 10. adsbdb enrichment decision

Enrichment traced end-to-end (see I3b-TRACE.md A-G):

- sourceId: 'adsbdb' stable machine id
- receipt timing: available via Date.now() in enrichment onData callback (client receipt of enrichment), not previously captured but trivially available (add now) — not significant redesign
- source timestamp: none from adsbdb API, reportedAtMs=null truthful
- callback knows which fields changed via truthy check
- retained across observations via prevMeta?.field ?? null
- cache affects: enrichSeen Set prevents re-enqueue, provenance set once retained
- route vs aircraft metadata have different keys (t:icao24 vs r:callsign) and caches, same sourceId

Decision: IMPLEMENT enrichment provenance in I3b, with minor wiring to capture receipt time in enrichment.js. This is not significant redesign, just adding Date.now() and provenance Map update in callbacks.

Enrichment provenance shape:
- REPORTED, sourceId='adsbdb', reportedAtMs=null, receivedAtMs=callback now, via=null

Tests added in provenance.enrichment.test.mjs covering sourceId, receipt time, retention, no invented timestamp.

If enrichment receipt timing had required significant source-layer redesign (e.g., server not providing timestamp and client not having now), we would have deferred. But now available, so implemented.

## 11. Derived-field decision

Inspect klass, wasAirborne, renderAltitudeM:

- klass: inputs typeCode (adsbdb REPORTED) + category (opensky REPORTED), deterministic pure function classifyAircraft, recomputes when inputs change, via='classification', no single external source, so no sourceId, no receivedAtMs needed. Implement as DERIVED.
- wasAirborne: inputs prev.wasAirborne (internal) + onGround (REPORTED), deterministic sticky boolean, via='airborne-history', DERIVED.
- renderAltitudeM: inputs geoAltitudeM (REPORTED), baroAltitudeM (REPORTED), onGround (REPORTED), surfaceM (MODELED ground floor), geoidN (MODELED), deterministic priority chain + floor clamp, via='render-altitude-selection', DERIVED, no single sourceId.

All deterministic, recompute when inputs change, via sufficient, no lineage graph needed.

Decision: IMPLEMENT DERIVED provenance for these three fields in I3b, with via required. Update provenance.js to support via and require via for DERIVED.

No history, no DAG.

## 12. Military-store decision

Military uses same/similar FlightRecords machinery but separate class MilitaryFlightRecords with different fields (altitudeFt, type, operator) and different snapshotRenderer that currently does NOT pass sourceId/receivedAtMs.

- MilitaryFlightRecords.receive signature: (aircraft, {observedAtMs, floorWarmPoints, modelOwnsVisual}) — no sourceId/receivedAtMs
- Military snapshotRenderer: uses snapshot.observedAtMs as receiptNowMs, but snapshot also has sourceId and receivedAtMs available from standalone.js (sourceId='adsb.lol', receivedAtMs=receiptMs), not passed to receive
- Including military would require: add provenance Maps to MilitaryFlightRecords, update military snapshotRenderer to pass sourceId/receivedAtMs, add getProvenanceMap() to military queries, tests

This materially enlarges slice beyond flights, requires separate wiring.

Decision: DEFER military to next slice (I3c or I3d). Keep I3b focused on general flights store only. Document.

## 13. Final provenance.js API changes, if any

I3a:
- EPISTEMIC frozen 4
- createProvenance({epistemic, sourceId, reportedAtMs, receivedAtMs}) -> frozen {epistemic, sourceId, reportedAtMs, receivedAtMs}
- isValidProvenance checks forbidden fields
- sourceId regex ^[a-z0-9._:-]+$ 1..128 no whitespace, required for REPORTED
- reportedAtMs optional null, receivedAtMs required for REPORTED

I3b expansion:
- Added via optional param
- validateVia: non-empty trimmed string 1..64 chars, no whitespace, ^[a-z0-9._:-]+$
- createProvenance now accepts via, includes via in descriptor (null when absent)
- DERIVED requires via (new requirement)
- REPORTED via optional (for unit-conversion note future)
- isValidProvenance now also validates via, allows via, still forbids ageMs etc.
- Descriptor shape now {epistemic, sourceId, reportedAtMs, receivedAtMs, via}

No MODELED fields (targetAtMs, modelEpochMs) added yet, per task "Do NOT add modeled fields yet."

No global transformation enum, no provider enum, no history.

## 14. Final getProvenanceMap() contract

I3a: Map<icao24, descriptor> position only, STORE-LOCAL keyed by native icao24 including TIS-B ~, copy-safe frozen.

I3b evolution: Map<icao24, {field: descriptor}> full per-field, STORE-LOCAL same keying, copy-safe.

- Key: native icao24 lowercased hex, preserves ~ for TIS-B (e.g., 'abc123', '~abc123'), no synthetic keys
- Value: object with sparse per-field provenance descriptors, each descriptor frozen internally but returned as shallow copy
  - position: REPORTED
  - altitude: REPORTED when finite else absent
  - geoAltitudeM: REPORTED when finite else absent
  - velocity: REPORTED when finite else absent (fallback 0 no provenance)
  - true_track: REPORTED when finite else absent
  - verticalRate: REPORTED when finite else absent
  - callsign: REPORTED when non-empty else absent
  - originCountry: REPORTED when non-empty else absent
  - category: REPORTED when finite else absent
  - onGround: REPORTED always when source info available
  - lastContactEpochMs: REPORTED when finite else absent
  - typeCode, typeName, registration, airline, route: REPORTED adsbdb when enriched, else absent
  - klass: DERIVED via classification
  - wasAirborne: DERIVED via airborne-history
  - renderAltitudeM: DERIVED via render-altitude-selection

- CURRENT only, no history, no arrays
- Copy-safe: fresh Map per call, fresh object per aircraft, fresh copy per descriptor
- getCurrentEntities() remains I2 primitive-only unchanged
- recordIndex remains provenance-unaware
- TIS-B included store-local, no invented canonical entityKey
- Future canonical projection adapter (I3c+) will filter canonical only and re-key by entityKey, omitting TIS-B from canonical sidecar

Breaking change from I3a explicitly documented: I3a returned position descriptor directly, I3b returns object containing position plus other fields. No broad consumers existed, only tests, tests updated.

## 15. TIS-B behavior

- TIS-B ids like ~abc123 are non-canonical per I2a strict 6-hex, entityKey null
- Included in store-local provenance sidecar keyed by native id ~abc123, no synthetic keys, no invented canonical identity
- No TIS-B canonical identity, no aircraft:tisb: namespace
- Future canonical projection will omit TIS-B from canonical sidecar (filter entityKey != null)
- Tested in provenance.b.test.mjs and I3a tests

## 16. Null/absent-value behavior

Preferred rule: NO CURRENT VALUE => NO VALUE PROVENANCE

- geoAltitudeM null when missing -> no provenance
- verticalRate null -> no provenance
- category null -> no provenance
- lastContactEpochMs null -> no provenance
- callsign '' -> no provenance (empty considered absent)
- originCountry null -> no provenance
- altitude fallback 10000 (airborne) or 0 (grounded) synthetic when both next and prev missing -> no REPORTED provenance (value exists but not reported, should have no REPORTED provenance)
- velocity fallback 0 synthetic when both missing -> no provenance, distinguishable from reported 0 (reported 0 has provenance, fallback 0 has no provenance)
- true_track same
- onGround always boolean -> always provenance when source info available
- enrichment null -> no provenance
- derived always present -> always DERIVED provenance

Do not attach REPORTED provenance to value that isn't present merely because latest provider observation mentioned field as null. Distinguish provider reported null vs GEV has no current value: we only store provenance when current value present and reported.

## 17. Cleanup/reset behavior

- forget(id): deletes data Map entry, missingPolls, geoidNCache, positionProvenance, provenance (full)
- absence handling: partial admissions do not prove absence, retention bounded by MISSING_POLL_LIMIT, provenance retained with retained position/value during stale period
- When record evicted via missing poll limit, forget() called, provenance disappears with record
- No arrays, no previousValue, no history

Tested: forget deletes provenance.

## 18. Copy-safety behavior

- provenance descriptors frozen via Object.freeze in createProvenance
- getProvenanceMap() returns fresh Map per call
- Each aircraft entry is fresh plain object
- Each field descriptor is shallow copy {...desc} (frozen internally, but copy prevents mutation of stored)
- Mutating returned copy does not affect internal store
- Tested in provenance.b.test.mjs copy-safe tests

## 19. Memory/storage assessment

For ~11k aircraft:

- I3a: positionProvenance Map<11k, descriptor> ~11k descriptors
- I3b: full provenance Map<11k, {~10-15 fields}> sparse

Estimate:
- Position always present: 11k
- Altitude: maybe 10k (most have baro)
- geoAltitudeM: maybe 5k (OpenSky reports geo for subset)
- Velocity: 10k
- Track: 10k
- VerticalRate: 5k
- Callsign: 8k
- OriginCountry: 8k (OpenSky only)
- Category: 6k
- onGround: 11k
- lastContact: 11k
- Enrichment: typeCode 3k, registration 3k, airline 1k, route 1k
- Derived: klass 11k, wasAirborne 11k, renderAltitudeM 11k

Total ~100-120k descriptors. Each descriptor ~5 props, frozen, ~100 bytes => ~10-12 MB. Map overhead (Map entry ~ 50 bytes) => ~5 MB. Total ~15-20 MB additional for 11k aircraft.

This is O(records * fields_with_values) not O(records * every possible field) worst case, but sparse reduces. Acceptable for browser, no history, no per-field arrays.

No premature compression tricks. If needed later, group default + sparse overrides could reduce to ~1-2 descriptors per aircraft typical (11k-22k descriptors, ~2 MB) but per-field is simpler and correct now.

## 20. Tests added

I3b new:
- src/layers/flights/provenance.b.test.mjs — 18 tests:
  - REPORTED fields created with provenance
  - replacement replaces provenance
  - omission retains value+provenance
  - null/absent semantics correct
  - source switch with replacement updates provenance
  - source switch without replacement preserves provenance
  - reportedAtMs truthful position vs contact
  - receivedAtMs truthful snapshot receipt
  - independent sticky fields diverge correctly (central proof)
  - DERIVED fields epistemic DERIVED via
  - DERIVED no false external source
  - DERIVED recomputation follows inputs
  - current-state only no history
  - cleanup forget removes all
  - copy-safe frozen
  - getProvenanceMap copy-safe shape
  - TIS-B included no synthetic keys
  - getCurrentEntities unchanged

- src/layers/flights/provenance.enrichment.test.mjs — 4 tests:
  - typeCode REPORTED adsbdb with receipt time
  - retained enrichment retains provenance
  - no invented source timestamp
  - sourceId reflects actual source

Total I3b new = 22 tests (18+4)

I3a existing 35 tests still pass.

## 21. Exact test totals

- I3a new: 11 (provenance.test.mjs) +16 (provenance.test.mjs) +8 (standalone.provenance.test.mjs) = 35
- I3b new: 18 (provenance.b) +4 (enrichment) = 22
- I2 core: 22 (entityKey) +24 (recordIndex) +14 (recordIndex.vessels) +12 (currentEntities) = 72
- I2 total vessels: 22+13+14+24+12+4 = 89 (includes vessels/getCurrentEntities 13, vessels/records 4, flights/records 3 not in 89)
- Full suite including I3a+I3b+I2+records: 11+16+18+4+8+22+24+14+12+3+4+13 = 149 tests pass

Command:
```
node --test src/data/provenance.test.mjs src/layers/flights/provenance.test.mjs src/layers/flights/provenance.b.test.mjs src/layers/flights/provenance.enrichment.test.mjs src/sources/live/standalone.provenance.test.mjs src/data/entityKey.test.mjs src/data/recordIndex.test.mjs src/data/recordIndex.vessels.test.mjs src/data/currentEntities.test.mjs src/layers/flights/records.test.mjs src/layers/vessels/records.test.mjs src/layers/vessels/getCurrentEntities.test.mjs
```
Result: 149 pass, 0 fail.

## 22. Architecture-check results

- check-identity-authority.mjs: OK — I2d boundaries frozen (recordIndex no Cesium/UI/lifecycle/analyst, validation delegated to entityKey, entityKey zero-dep, accessors not via analyst, no history)
- check-spatial-authority.mjs: OK — 7 frozen, reasoned site(s) across 6 file(s); no new raw geographic-distance implementations
- No new provider enum, no global transformation enum, no history, no confidence

Commands:
```
node scripts/check-identity-authority.mjs
node scripts/check-spatial-authority.mjs
```

## 23. Confirmation getCurrentEntities unchanged

- getCurrentEntities() remains I2 primitive-only, returns Array<{entityKey, icao24, lat, lon, altitudeM, callsign}> fresh array, plain objects, primitives only, no provenance, no history, uncapped, deterministic
- Tested in provenance.b.test.mjs and I3a tests
- No provenance import in getCurrentEntities path

## 24. Confirmation recordIndex unchanged

- src/data/recordIndex.js behavior unchanged, no provenance import beyond isValid (already), no provenance logic, still canonical-only, rebuild removes missing, no winner, deterministic, copy-safe primitive-only, eligibility owned by adapter
- Validated via recordIndex tests 24+14 pass
- No history, no provenance authority

## 25. Confirmation no history

- No arrays of previous values, no history[], timeline, trajectory, previousValue, previousSource
- Provenance is CURRENT only: replacement old disappears, retention keeps current, deletion removes
- Tested: current-state only no history

## 26. Confirmation no I4/I5/I6/I9

- No source/sensor registry (I4) — sourceId string only, no registry, no PROVIDER_ID enum
- No freshness/stale classification (I5) — no ageMs stored, no fresh/stale fields, age remains query-time
- No analyst/AI provenance (I6/I9) — INTERPRETED not implemented, no analyst engine changes
- No quality/confidence, no coverage, no transitions

## 27. Confirmation D9 untouched

- D9 dual semantics SURFACE authoritative for geographic proximity, SLANT reserved as explicitly named physical 3D range, still pending
- Current code still Cartesian3.distance in flights/military/vessels getNearby, no slantDistanceM added to records, no eager/lazy slant decision, no migration of vessels/installations
- geo.js untouched
- Verified via grep Cartesian3.distance still in getNearby

## 28. Remaining aircraft provenance gaps

- turnRateDps — derived from fix history, depends on history, deferred
- Enrichment route/type have different caches (t:icao vs r:callsign) — provenance implemented but server cache .gev-cache provenance not exposed
- Military store — deferred, needs wiring
- Vessel, satellite — not aircraft current-state, deferred
- MODELED fields (groundFloor, geoidN, dead-reckon) — deferred to I4/I5
- INTERPRETED — deferred
- Unit conversion via note — REPORTED preserves via optional, not yet populated for ft*0.3048 conversions (could add via='unit-conversion' but still REPORTED)
- Snapshot publish time (payload.time) vs event time — publish time remains in feedState/I5, not in per-field provenance (minimal)

## 29. ONE recommended next I3 slice

I3c — Enrichment + Military + Turn Rate + Full Derived Coverage

- Polish enrichment provenance: ensure route and aircraft metadata have distinct receipt times, test cache behavior, ensure klass derived provenance updates correctly when enrichment arrives after category change
- Add military store provenance: add provenance Maps to MilitaryFlightRecords, update military snapshotRenderer to pass sourceId/receivedAtMs (already available in snapshot), add getProvenanceMap() to military queries, tests for source switch military (adsb.lol only, but still sticky)
- Add turnRateDps derived provenance via turn-rate-from-history
- Consider adding via for unit-conversion (feet->m) as optional for REPORTED to preserve conversion note without promoting to DERIVED
- Evaluate whether renderAltitudeM should carry max input reportedAtMs or null — currently via only, no timestamps, which is minimal and correct per task (do not pretend single source)
- Keep military classification separate from provenance

Why: completes aircraft current-state provenance across both general and military stores, proves enrichment and derived fully, before moving to vessel (second domain) and satellite MODELED.

## 30. Any genuine owner decision still required

- Enrichment provenance: we implemented as REPORTED sourceId adsbdb reportedAtMs null. Owner decision already locked as REPORTED, confirmed. No new decision.
- Derived via naming: we used via='classification', 'airborne-history', 'render-altitude-selection' — stable operation identifiers, lowercased, ^[a-z0-9._:-]+$ . Owner to ratify via names or suggest alternatives.
- Timestamp semantics for altitude/geoAltitudeM/onGround: we used positionTimeMs for position-related (altitude, geo, onGround) and contactTimeMs for kinematics/identity. Alternative could be all non-position use contactTimeMs, or all use positionTimeMs. Our choice is reasoned: position-related tied to position fix, kinematics/identity tied to last contact. Owner to confirm or require all use contactTimeMs for simplicity.
- Military deferral: we deferred military to keep slice small. Owner to confirm deferral or require military now.
- getProvenanceMap() breaking change: I3a returned Map<icao24, descriptor> position directly, I3b returns Map<icao24, {field: descriptor}>. No broad consumers, only tests, but breaking. Owner to approve evolution or require backward compat wrapper (e.g., keep getPositionProvenanceMap()).
- Memory: per-field sparse ~15-20 MB for 11k aircraft. Acceptable? Owner to confirm or require group default + sparse overrides compression in future.

No blocking decisions, slice ready for owner review.

---

**Success criterion:** A current aircraft field can tell us where its CURRENT value came from, and sticky retention/source switching never causes provenance to describe a newer observation than the value it actually belongs to.

Verified via tests:
- Independent sticky fields diverge correctly (one updates while other retained, provenance diverges)
- Source switch with replacement updates provenance, without replacement preserves
- Null/absent no provenance
- Copy-safe, no history, no mutation

I3b ready for owner review.

