# I3b IMPLEMENTATION REPORT — Aircraft Current-Field / Sticky Provenance

Date: 2026-09-18 + 2026-09-19 FINAL VERIFICATION FIX
Branch: arena/01a0b2f3-gods-eye-view
Status: I3b IMPLEMENTED + FINAL VERIFICATION FIX, ready for owner re-review
Previous commit reviewed: 1a589d9
Current commit: with enrichmentCore shared helper + positionProvenance removal

## FINAL VERIFICATION FIX — what changed vs 1a589d9

Owner review found enrichment tests did not exercise production enrichment.js (manually recreated provenance).

Fix:

- Created `src/layers/flights/enrichmentCore.js` — zero-Cesium, zero-DOM, zero-network, current-state only, pure metadata + provenance application logic.
  - Exports `applyTypeEnrichment({meta, provObj, data, receivedAtMs})`, `applyRouteEnrichment`, `ensureProvObj`
  - Implements REPORTED adsbdb provenance creation, retention (same value keeps old receipt), replacement (new receipt), klass DERIVED via classification
  - Accepts `receivedAtMs` injection for deterministic tests, production passes `Date.now()` at callback boundary
- Refactored `src/layers/flights/enrichment.js` to import and call helper, then do rendering side effects only (billboard, model, tracked label). No longer duplicates provenance logic.
- Rewrote `src/layers/flights/provenance.enrichment.test.mjs` to import `enrichmentCore.js` — now tests actual production helper/path, 10 tests covering type initial, retention, replacement, same-value-does-not-falsely-update, route initial/retention/replacement, klass DERIVED, receipt injection, ensureProvObj.
- Removed legacy duplicate `positionProvenance` Map from `FlightRecords` after owner approved I3b evolution (no compat wrapper needed). Now single authority `provenance` Map<icao24,{field:descriptor}> with `position` field.
  - `src/layers/flights/records.js`: removed `positionProvenance` Map, `forget()` now deletes only `provenance`
  - `src/layers/flights/queries.js`: removed fallback to `positionProvenance`, simplified to single authority
  - `src/layers/flights/provenance.test.mjs` (I3a): updated to use `store.provenance.get(id).position` instead of `positionProvenance`
  - `src/layers/flights/provenance.b.test.mjs`: removed positionProvenance assertions
- Timestamp semantics verified with OpenSky REST API docs (see §9).

## 1. Exact files changed (final)

- src/data/provenance.js — via validation, DERIVED requires via
- src/layers/flights/records.js — single authority per-field provenance Map, sticky handling, DERIVED, cleanup, positionProvenance removed
- src/layers/flights/queries.js — single authority getProvenanceMap(), no fallback, JSDoc updated with OpenSky timestamp evidence
- src/layers/flights/enrichmentCore.js NEW — zero-Cesium shared helper, production + tests share same code
- src/layers/flights/enrichment.js — refactored to use enrichmentCore, rendering side effects only
- src/data/provenance.test.mjs — updated for via
- src/layers/flights/provenance.test.mjs — updated to new single authority
- src/layers/flights/provenance.b.test.mjs — updated (removed positionProvenance check)
- src/layers/flights/provenance.enrichment.test.mjs — REWRITTEN to exercise actual production helper (10 tests)
- docs/planning/I3b-TRACE.md — pre-implementation trace
- docs/planning/I3b-IMPLEMENTATION-REPORT.md — this file
- docs/planning/I3-DESIGN-REDUCTION-ADDENDUM.md + I3a-FINAL-CONTRACT-REVIEW.md — evolution notes

## 2. Pre-implementation field trace table

See I3b-TRACE.md. Summary same as before.

## 3. Fields receiving provenance in I3b

Same as before: REPORTED flights position, altitude, geoAltitudeM, velocity, true_track, verticalRate, callsign, originCountry, category, onGround, lastContactEpochMs; ENRICHMENT REPORTED adsbdb typeCode/typeName/registration/airline/route; DERIVED klass/wasAirborne/renderAltitudeM.

## 4. Fields explicitly deferred

turnRateDps, military, vessel/satellite, MODELED groundFloor/geoidN, INTERPRETED, quality/confidence.

## 5. Final provenance grouping/storage shape

Single authority: `provenance: Map<icao24, {field: descriptor}>` per-field sparse. Example:

```js
{
  position: {epistemic:'reported', sourceId:'opensky', reportedAtMs:1710000000000, receivedAtMs:1710000005000, via:null},
  altitude: {epistemic:'reported', sourceId:'opensky', reportedAtMs:1710000000000, receivedAtMs:1710000005000},
  geoAltitudeM: {...},
  velocity: {...},
  callsign: {...},
  typeCode: {epistemic:'reported', sourceId:'adsbdb', reportedAtMs:null, receivedAtMs:2000},
  klass: {epistemic:'derived', via:'classification', sourceId:null},
  ...
}
```

Sparse: absent fields have no provenance.

## 6. Why grouped fields cannot lie

Per-field independent. Example T1 AAA/100/10/1000 R1, T2 ''/110/null/null R2 → callsign AAA retained R1, velocity 110 replaced R2, track retained R1. Tested.

## 7. Exact REPORTED timestamp semantics with evidence

OpenSky REST API docs (https://openskynetwork.github.io/opensky-api/rest.html):

- time_position: Unix timestamp for last position update. Can be null if no position report was received within past 15s.
- last_contact: Unix timestamp for last update in general. Updated for any new valid message.
- State vector fields: longitude, latitude, baro_altitude, on_ground, velocity, true_track, vertical_rate, geo_altitude, category, callsign, etc. all in same response but time_position specifically timestamps position.

ADS-B semantics:
- Airborne position message contains lat/lon + baro altitude + geo altitude + on_ground flag (surface vs airborne). So baro_altitude, geo_altitude, on_ground share position time.
- Velocity message contains velocity, true_track, vertical_rate.
- Identification message contains callsign, category.

Thus:

- position (rawLat/rawLon): reportedAtMs = positionTimeMs (time_position) — position update time per docs
- altitude (baro): reportedAtMs = positionTimeMs — baro_altitude part of position report per OpenSky, same as lat/lon
- geoAltitudeM: reportedAtMs = positionTimeMs — geo_altitude part of position
- onGround: reportedAtMs = positionTimeMs — on_ground boolean indicates if position was retrieved from surface report, tied to position time per docs
- velocity, true_track, verticalRate, callsign, originCountry, category, lastContactEpochMs: reportedAtMs = contactTimeMs (last_contact = last update in general) — these come from velocity/identification messages, not position, so last_contact is more truthful. Fallback to positionTimeMs if contact missing.
- Enrichment: reportedAtMs = null (adsbdb API returns no timestamp, server cache at=Date.now() is cache time not source report)
- Derived: via only, no timestamps

This avoids false precision: we do not claim per-field separate times where only two exist, but we do distinguish position-related vs general-contact per OpenSky semantics, which is truthful and not fabricated.

## 8. Exact sticky-retention behavior

Same as before: stickyNumber finite next → replace value+prov, else finite prev → retain value+old prov, else fallback synthetic → no prov. stickyText trimmed non-empty → replace, else prev non-empty → retain, else ''/null → no prov. geoAltitudeM non-sticky null → no prov when null. onGround boolean always replacement.

Enrichment retention via prevMeta?.field ?? null in receive() plus helper logic: same value keeps old receipt, different value replaces with new receipt.

## 9. Exact source-switch behavior

Same as before: position always replacement when valid, other fields independent sticky. Tested.

## 10. adsbdb enrichment decision

IMPLEMENTED via enrichmentCore shared helper. Production path and tests share same code.

- sourceId adsbdb
- receipt timing: Date.now() at callback boundary, passed to helper, tests inject exact timestamp
- reportedAtMs null truthful
- callback knows changed fields via !== check
- retained across observations via prevMeta
- cache enrichSeen prevents re-enqueue
- route vs type different keys (t:icao vs r:callsign) same sourceId
- Replacement updates receipt, same value retains old receipt (invariant PROVENANCE FOLLOWS CURRENT VALUE, not merely callback fired)

## 11. Derived-field decision

IMPLEMENTED klass, wasAirborne, renderAltitudeM via classification/airborne-history/render-altitude-selection. No sourceId, via required.

## 12. Military-store decision

DEFERRED — owner approved.

## 13. Final provenance.js API

Same as before: descriptor {epistemic, sourceId, reportedAtMs, receivedAtMs, via}, DERIVED requires via, REPORTED requires sourceId+receivedAtMs, reportedAtMs optional null.

## 14. Final getProvenanceMap() contract

Map<icao24, {field: descriptor}> STORE-LOCAL keyed by native icao24 including ~ TIS-B, CURRENT only, copy-safe, single authority (positionProvenance removed), no fallback. Breaking change from I3a approved, no compat wrapper.

## 15. TIS-B behavior

Included store-local keyed ~abc123, entityKey null, no synthetic keys.

## 16. Null/absent-value behavior

NO CURRENT VALUE => NO VALUE PROVENANCE. Fallback synthetic 0/10000 → no REPORTED prov, distinguishable from reported 0.

## 17. Cleanup/reset behavior

forget(id) deletes data, missingPolls, geoidNCache, provenance (single authority). No history.

## 18. Copy-safety

Descriptors frozen, getProvenanceMap returns fresh Map, fresh object per aircraft, shallow copy per descriptor.

## 19. Memory/storage

Same estimate ~15-20 MB for 11k aircraft, O(records×fields_with_values), sparse, acceptable per owner.

## 20. Tests added (final)

- provenance.b.test.mjs 18 tests (REPORTED, sticky divergence, source switch, DERIVED, cleanup, copy-safe, TIS-B)
- provenance.enrichment.test.mjs 10 tests REWRITTEN to exercise actual production helper:
  - type enrichment initial values + REPORTED provenance shared receipt
  - retained enrichment retains provenance across poll
  - replacement changes value + receipt
  - same value again does NOT falsely update receipt (retains old)
  - route enrichment initial
  - route same data retains old receipt
  - route replacement updates receipt
  - klass DERIVED via classification, sourceId null, no adsbdb source on klass
  - ensureProvObj creates/reuses
  - receipt injection deterministic

Total I3b new = 28 tests (18+10)

## 21. Exact test totals (final)

- provenance.test.mjs 11
- flights/provenance.test.mjs 16 (updated to single authority)
- flights/provenance.b.test.mjs 18
- flights/provenance.enrichment.test.mjs 10 (real production helper)
- standalone.provenance.test.mjs 8
- entityKey.test.mjs 22
- recordIndex.test.mjs 24
- recordIndex.vessels.test.mjs 14
- currentEntities.test.mjs 12
- flights/records.test.mjs 3
- vessels/records.test.mjs 4
- vessels/getCurrentEntities.test.mjs 13

Total = 155 pass, 0 fail.

Command:
```
node --test src/data/provenance.test.mjs src/layers/flights/provenance.test.mjs src/layers/flights/provenance.b.test.mjs src/layers/flights/provenance.enrichment.test.mjs src/sources/live/standalone.provenance.test.mjs src/data/entityKey.test.mjs src/data/recordIndex.test.mjs src/data/recordIndex.vessels.test.mjs src/data/currentEntities.test.mjs src/layers/flights/records.test.mjs src/layers/vessels/records.test.mjs src/layers/vessels/getCurrentEntities.test.mjs
```

## 22. Architecture-check results

- check-identity-authority.mjs: OK — I2d frozen, recordIndex no provenance, no history
- check-spatial-authority.mjs: OK — 7 frozen sites, no new raw distance
- enrichmentCore.js: zero Cesium verified (grep Cesium none, only imports provenance + aircraftClass)

## 23. Confirmation getCurrentEntities unchanged

Yes — primitive-only, no provenance, tested.

## 24. Confirmation recordIndex unchanged

Yes — provenance-unaware, 24+14 tests pass.

## 25. Confirmation no history

No arrays, no previousValue, no timeline. Replacement old disappears, retention keeps current.

## 26. Confirmation no I4/I5/I6/I9

No source registry, no freshness/stale, no analyst, no quality.

## 27. Confirmation D9 untouched

Cartesian3.distance still in getNearby, no slantDistanceM, geo.js untouched.

## 28. Remaining aircraft provenance gaps

turnRateDps (history), military, vessel/satellite, MODELED groundFloor/geoidN, INTERPRETED, unit-conversion via note.

## 29. ONE recommended next I3 slice

I3c — military provenance + turnRateDps + enrichment cache edge cases + optional unit-conversion via.

## 30. Owner decisions resolved

- via names classification/airborne-history/render-altitude-selection APPROVED, kept
- getProvenanceMap I3a→I3b evolution APPROVED, no compat wrapper, positionProvenance removed
- sparse per-field memory ~15-20 MB ACCEPTED, no optimization yet
- military deferral APPROVED
- Timestamp semantics: altitude/geoAltitudeM/onGround → positionTimeMs justified by OpenSky docs (time_position for last position update, baro_altitude/on_ground/geo_altitude part of position report), velocity/track/verticalRate/callsign/category → contactTimeMs (last_contact for any valid message). Evidence cited, not false precision, reportedAtMs null allowed for enrichment.

## Final verification fix deliverable

1. Exact files changed in this correction: enrichmentCore.js NEW, enrichment.js refactored to use helper, records.js removed positionProvenance, queries.js removed fallback, provenance.test.mjs updated to single authority, provenance.b.test.mjs updated, provenance.enrichment.test.mjs REWRITTEN to use production helper, I3b-IMPLEMENTATION-REPORT.md updated.
2. Reason previous enrichment tests insufficient: manually recreated provenance via createProvenance() and mutating store.provenance, did not import or execute enrichment.js production callbacks, did not prove receipt capture, sourceId, field attachment, retention, replacement, klass DERIVED via same code.
3. New production/shared seam: src/layers/flights/enrichmentCore.js zero-Cesium helper with applyTypeEnrichment, applyRouteEnrichment, ensureProvObj, shared by production and tests.
4. Proof tests execute same logic production uses: tests import enrichmentCore.js which is imported by enrichment.js production path, same functions, same provenance creation, same change detection.
5. Type enrichment: initial applies values + REPORTED adsbdb null report + receipt shared, retained across poll retains old receipt, replacement updates receipt, same value again retains old receipt (does not falsely make newer).
6. Route enrichment: initial applies airline+route REPORTED adsbdb null report + receipt, same data retains old receipt, replacement updates receipt.
7. klass derived: when typeCode changes, klass recomputes via classifyAircraft, provenance DERIVED via classification, sourceId null, no adsbdb source on klass.
8. Receipt timestamp: production captures Date.now() at callback boundary and passes to helper, tests inject exact timestamps deterministic, one receipt per callback shared across fields from same response.
9. Final altitude/geo/onGround timestamp: positionTimeMs per OpenSky REST API docs (time_position for last position update, baro_altitude/geo_altitude/on_ground part of position report), not false precision, cited. Velocity/track/etc contactTimeMs per last_contact semantics.
10. positionProvenance duplicate Map: REMOVED after owner approved evolution, single authority provenance Map with position field. No production consumers, only old tests/compat code. Checked via grep, only records.js, queries.js fallback, and tests used it. Removed.
11. Updated test totals: 155 pass (11+16+18+10+8+22+24+14+12+3+4+13)
12. Architecture checks: IDENTITY OK, SPATIAL OK, enrichmentCore zero Cesium
13. recordIndex unchanged: yes
14. getCurrentEntities unchanged: yes
15. no history: yes
16. D9/I4/I5/I6/I9 untouched: yes
17. Ready for owner approval: YES — enrichment now tested via actual production helper, timestamp evidence provided, duplicate Map removed, 155 tests pass.

**Success criterion**: current aircraft field can tell where CURRENT value came from, sticky retention/source switching never causes provenance to describe newer observation than value, and enrichment provenance now proven through shared production code.
