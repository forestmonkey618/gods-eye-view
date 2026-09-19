# I3c AUDIT + IMPLEMENTATION REPORT — Remaining AIRCRAFT Provenance (military store, turnRateDps, enrichment cache)

**Date:** 2026-09-19
**Base:** `main` @ `a5b8e33046f2d12261186b81931e1e638adc26ab`
**Branch:** `arena/01a0b7ac-gods-eye-view`
**Status:** audit complete; ONE small, clearly supported slice implemented (military current-field provenance + civil lifecycle cleanup); STOPPED for owner review. I1 (spatial) and I2 (identity/RecordIndex) were NOT reopened.

Locked vocabulary: REPORTED / DERIVED / MODELED / INTERPRETED. Invariant: **provenance follows the CURRENT value**. Current-state only, no longitudinal history. `storeId != sourceId`. `recordIndex` remains provenance-unaware. `getCurrentEntities()` remains I2 primitive-only.

---

## Part A — Military store trace

### A.1 Path traced (file → function)

1. `server/providers/aircraft/adsb-lol.js` — proxies `https://api.adsb.lol/v2/mil` at `/api/adsblol/mil`; single-body cache; response headers `X-ADS-B-Cache: MISS|HIT|STALE` and (HIT/STALE only) `X-ADS-B-Cache-Age-Ms = Date.now() − _cacheAt` where `_cacheAt` is the server's upstream fetch time. Body is passed through unmodified (adsb.lol `V2Response_Model {ac[], now, ctime, ptime, msg, total}`).
2. `src/sources/live/standalone.js::createAdsbLolSource().getSnapshot()` — `receiptMs = now()` (client clock at response), `observedAtMs = receiptMs − cacheAge` (MISS → `observedAtMs === receiptMs`), then `readsbSnapshot(payload, { observedAtMs, sourceId: 'adsb.lol', receivedAtMs: receiptMs, stale })`. Payload `now` (adsb.lol's generation epoch) is NOT used.
3. `src/sources/live/aircraft.js::normalizeReadsbAircraft(row, snapshotTimeMs)` — admission requires `hex` + finite lat/lon; `positionTimeMs = observedAtMs − (seen_pos ?? 0)·1000`; `contactTimeMs = seen == null ? null : observedAtMs − seen·1000`; `alt_baro` ft→m (`"ground"` → `baroAltitudeM null`, `onGround true`); `alt_geom` ft→m; `gs` kt→m/s; `track`; `baro_rate` ft/min→m/s; `flight`→callsign; `t`/`r`/`ownOp`→typeCode/registration/operator; `category` passed through; `originCountry: null`. Dropped at normalization: `squawk`, `emergency`, readsb `type` (message source adsb_icao/mlat/tisb…), `track_rate`, `nic/rc/nac_*`, `messages`, `rssi`, `dbFlags`, `lastPosition`.
4. `src/sources/live/aircraft.js::readsbSnapshot()` — snapshot `{records, source:'adsb.lol', sourceId:'adsb.lol', observedAtMs, receivedAtMs, ageMs, stale, freshness}`.
5. `src/layers/military/controller.js` / `ingestion.js` — fetch orchestration; `feed._lastUpdate = snapshot.observedAtMs`; replayed (HIT/STALE) snapshots do not create new fixes.
6. `src/layers/military/snapshotRenderer.js::applySnapshot(snapshot)` — per row `records.receive(aircraft, { observedAtMs: snapshot.observedAtMs, floorWarmPoints, modelOwnsVisual, sourceId, receivedAtMs })` (the last two are NEW in I3c); billboard/model placement; absence sweep via `records.absence()` → `records.forget()`; `registerMilitaryIcaos(currentIcaos)` at the end of the poll.
7. `src/layers/military/records.js::MilitaryFlightRecords.receive()` — writes the store record (`data: Map<nativeId, meta>`); sticky merge via `stickyText`/`stickyNumber` (`src/data/aircraftMeta.js`); `renderAltitudeM` via `pickRenderAltitudeM` + ground-floor clamp; `klass` via `classifyAircraft`.
8. `src/layers/military/queries.js` — `getCurrentEntities()` (I2 primitive: entityKey, icao24, lat, lon, altitudeM, callsign), `getAnalystRecords()` → `mapAnalystRecord()`, plus the NEW `getProvenanceMap()`.
9. Consumers: `src/data/analystEngine.js` (analyst records), labels/readout (`src/layers/military/*`), Context cohorts, `recordIndex` adapter over `getCurrentEntities()`.

### A.2 Per-field table (military store, CURRENT record)

| Field (store) | Raw adsb.lol/readsb | Normalization | Sticky / replacement | Available report time | GEV receipt | Class | Truthful sourceId | Before I3c | I3c action |
|---|---|---|---|---|---|---|---|---|---|
| `position` (`rawLat`,`rawLon`) | `lat`,`lon` | admission requires finite | replacement every poll | `positionTimeMs` (= observedAt − `seen_pos`) | batch `receivedAtMs` | REPORTED | `adsb.lol` | none | IMPLEMENTED |
| `altitudeFt` | `alt_baro` (ft or `"ground"`) | ft→m→ft (unit only) | `stickyNumber(.., null)`; `"ground"` rows retain last baro | `positionTimeMs` (position-message group; readsb has no per-field age) | batch | REPORTED | `adsb.lol` | none | IMPLEMENTED (retention keeps old descriptor) |
| `geoAltitudeM` | `alt_geom` | ft→m | replacement; `null` when absent | `positionTimeMs` | batch | REPORTED | `adsb.lol` | none | IMPLEMENTED (null → no descriptor) |
| `onGround` | `alt_baro === "ground"` | boolean | replacement | `positionTimeMs` | batch | REPORTED | `adsb.lol` | none | IMPLEMENTED |
| `speedMps` | `gs` | kt→m/s | **`?? 0` BEFORE sticky** → missing gs stores synthetic 0 | `contactTimeMs` (= observedAt − `seen`) | batch | REPORTED only when raw finite | `adsb.lol` | none | IMPLEMENTED; synthetic 0 → descriptor DELETED |
| `track` | `track` | deg | **`\|\| 0` BEFORE sticky** → same | `contactTimeMs` | batch | REPORTED only when raw finite | `adsb.lol` | none | IMPLEMENTED; synthetic 0 → DELETED |
| `verticalRateMps` | `baro_rate` | ft/min→m/s | `stickyNumber(.., null)` | `contactTimeMs` | batch | REPORTED | `adsb.lol` | none | IMPLEMENTED |
| `callsign` | `flight` | trim | `stickyText` | `contactTimeMs` | batch | REPORTED | `adsb.lol` | none | IMPLEMENTED |
| `type` | `t` (tar1090-db lookup by adsb.lol) | trim | `stickyText` | **none** (database attribute) | batch | REPORTED | `adsb.lol` | none | IMPLEMENTED, `reportedAtMs: null` |
| `registration` | `r` (db lookup) | trim | `stickyText` | none | batch | REPORTED | `adsb.lol` | none | IMPLEMENTED, `reportedAtMs: null` |
| `operator` | `ownOp` (db lookup; absent from the published adsb.lol schema, usually `''`) | trim | `stickyText` | none | batch | REPORTED | `adsb.lol` | none | IMPLEMENTED, `reportedAtMs: null` |
| `lastContactEpochMs` | `seen` | observedAt − seen·1000 | `stickyNumber(.., null)` | itself (`contactTimeMs`) | batch | REPORTED | `adsb.lol` | none | IMPLEMENTED |
| `klass` | — (`t` + `category` → `classifyAircraft`) | local | recomputed each poll | — | — | DERIVED `via: classification` | none | none | IMPLEMENTED |
| `wasAirborne` | — (`prev.wasAirborne \|\| !onGround`) | local | sticky-true | — | — | DERIVED `via: airborne-history` | none | none | IMPLEMENTED |
| `renderAltitudeM` | — (`pickRenderAltitudeM` + geoid N + ground floor) | local | recomputed | — | — | DERIVED `via: render-altitude-selection` | none | none | IMPLEMENTED |
| `category` | `category` | passthrough | **not stored** (feeds `classifyAircraft` only) | — | — | — | — | — | none (no current field) |
| `originCountry` | — | always `null` | — | — | — | — | — | — | none |
| `squawk`, `emergency`, readsb `type` (message source), `track_rate`, `nic/rc`, `dbFlags`, `lastPosition` | present upstream | **dropped at normalization** | — | — | — | — | — | — | NO PROVENANCE (no value in GEV) |
| `military` (analyst record) | — | layer-membership constant `true` | — | — | — | — | — | — | none (not a stored observation; see B.3) |
| `aircraftClass` (analyst record) | — | `tr3bAircraftClass()` presentation override at query time | — | — | — | — | — | — | none (I6 presentation) |
| `turnRateDps` | — (`_positionHistory` ≤5 fixes) | motion model | overwritten outside `receive()` | — | — | see Part B | — | — | NO PROVENANCE (internal motion input) |
| `sourceReference`, `observedReceiptMs`, `geoidNCache`, `missingPolls` | — | bookkeeping | — | — | — | — | — | — | never tagged |

**Airborne state**: `onGround` (REPORTED) + `wasAirborne` (DERIVED) as above. **Render altitude**: DERIVED. **Military classification**: not a per-record value in the military store (registry membership; `dbFlags` is not ingested) — no provenance field; the analyst `military: true` is a store-membership constant, not a claim sourced from a row.

### A.3 Timestamp semantics (verified against readsb `README-json.md` and adsb.lol `openapi.json`, NOT assumed from OpenSky)

- readsb exposes exactly two ages per aircraft: `seen` ("seconds before `now` a message was last received from this aircraft") and `seen_pos` ("seconds before `now` the position was last updated"). It exposes **no per-field ages** for `alt_baro`, `alt_geom`, `gs`, `track`, `baro_rate`, `flight`, `category`, `squawk`.
- GEV mapping (production `normalizeReadsbAircraft`): `positionTimeMs = observedAtMs − seen_pos·1000` (seen_pos absent → `observedAtMs`, but readsb only emits lat/lon with a valid `seen_pos`); `contactTimeMs = observedAtMs − seen·1000`, **null** when `seen` is absent.
- `observedAtMs = client receipt − X-ADS-B-Cache-Age-Ms` (server upstream fetch time); on MISS it equals the client receipt. Known, documented small bias: readsb ages are relative to the payload's own `now`, which precedes the proxy fetch by network/adsb.lol staging latency (typically ≤1–2 s); GEV ignores payload `now`. This is a pre-existing normalizer choice, not changed here (changing `observedAtMs` would alter fix epochs and motion history).
- I3c rule: position / altitudeFt / geoAltitudeM / onGround → `positionTimeMs`; speedMps / track / verticalRateMps / callsign / lastContactEpochMs → `contactTimeMs` (null stays null — **no fallback to position time**, unlike the civil store's OpenSky mapping); type / registration / operator → `reportedAtMs: null` (database attributes have no event time; using `seen` would be false precision).
- Owner decision point (flagged, not blocking): the altitude-group → `seen_pos` convention is an *associated-message* time, kept consistent with the civil store; the defensible alternative is `contactTimeMs` for altitude fields. Both are derived from the same two ages; neither is per-field truth.

### A.4 sourceId semantics

- `sourceId` is the snapshot adapter's stable machine id (`'adsb.lol'`), one per batch, carried on the snapshot object — never the human label, never the storeId (`military`).
- `t`/`r`/`ownOp` are database joins performed by adsb.lol's readsb; GEV received them FROM adsb.lol, so `sourceId: 'adsb.lol'` is truthful. Which upstream database adsb.lol joins is I4 registry metadata, not provenance.
- Locally computed fields (`klass`, `wasAirborne`, `renderAltitudeM`) are DERIVED and never carry the feed id.
- If a layer is configured with a source whose snapshot lacks `sourceId`/`receivedAtMs` (fixtures, legacy callers), NO REPORTED descriptor is created and stale REPORTED descriptors are dropped; DERIVED descriptors remain. Absence is truthful; a guess is not.

### A.5 Sticky / replacement semantics (as the store actually behaves)

- Replacement (position, geoAltitudeM, onGround; sticky fields when the row reports them): new descriptor with the batch receipt and the row's report time.
- Retention (`callsign`, `type`, `registration`, `operator`, `altitudeFt`, `verticalRateMps`, `lastContactEpochMs` when the row lacks them and the store keeps the previous value): the previous descriptor is kept (older receipt/report) — the value is not relabelled as new.
- **Pre-existing military value bug (reported, NOT fixed — it changes rendering):** `speedMps = aircraft.speedMps ?? 0` and `track = aircraft.courseDeg || 0` are coerced BEFORE `stickyNumber`, so sticky retention is defeated for these two fields — a missing gs/track stores a synthetic 0. Provenance is truthful about this: only a finite raw observation earns a descriptor; the synthetic 0 carries none (and a previously reported 0 is distinguishable by its descriptor).
- Null / absent: `geoAltitudeM` null → no descriptor; `lastContactEpochMs` null → no descriptor; first-poll empty text → no descriptor.

### A.6 Same-ICAO implications

The civil and military stores can hold the same ICAO simultaneously (civil suppression only happens when the military layer is active). Provenance is STORE-LOCAL: `MilitaryFlightRecords.provenance` and `FlightRecords.provenance` are independent Maps keyed by each store's own native key. No dedupe, no winner, nothing moved into `recordIndex`, no canonical projection (no consumer requires one yet). TIS-B `~xxxxxx` rows keep their native key; `entityKey` stays null for them; no synthetic identity is invented.

---

## Part B — turnRateDps and overlooked flight fields

### B.1 turnRateDps — seven questions

1. **Externally reported?** No. readsb publishes `track_rate` (transponder turn rate) but GEV does not ingest it; GEV's value is computed from `_positionHistory`.
2. **Deterministically derived from the current record?** No — from a window of ≤5 recent fixes (`POSITION_HISTORY_LIMIT`), requiring ≥2 samples, 2–120 s apart, with a noise floor and clamp; the window may include a *synthesized* forward-kinematics fix (wall-clock dependent), so it is not reproducible from reported inputs alone.
3. **Modeled/extrapolated?** Partly — the history it consumes may contain modeled samples.
4. **Depends on previous observations?** Yes, inherently (Δtrack/Δt).
5. **Introduces state/history?** It CONSUMES the already-existing, bounded motion history that dead-reckoning requires; tagging it would not add history, but describing it truthfully would require a window (from/to/sample count) the primitive does not and should not express.
6. **CURRENT state or change measurement?** A change measurement over a window — I9-adjacent, not a current reported value.
7. **I3 or later?** Its only consumers are `motion.js` (dead-reckon arc) and the corridor/context cell logic — internal rendering inputs. It is not analyst-visible, not queryable, and makes no user-facing factual claim.

**Decision: NO PROVENANCE NEEDED (defer).** No history system was created. If it ever becomes analyst-visible it must be described under I9 as a windowed change measurement, not by expanding I3.

### B.2 Overlooked civil-store fields

All analyst-visible current fields already carry I3b provenance. `observedReceiptMs` (per-record receipt bookkeeping used by `absence()`), `sourceReference`, `turnRateDps`, `rawLat/rawLon` (covered by `position`) → NO PROVENANCE NEEDED. `squawk`/`emergency`/`spi`/`position_source` are not ingested → no value to tag.

### B.3 Query-time analyst flags

Civil `military: isMilitaryIcao(icao24)` and military `aircraftClass: tr3bAircraftClass(...)` are computed in `mapAnalystRecord()` at query time from the registry / a presentation override, not stored current fields. DEFER to I4 (registry provenance) / I6 (analyst presentation). Not I3c.

---

## Part C — adsbdb enrichment cache semantics (civil store)

1. **Where cached:** server `server/providers/aircraft/enrichment.js` — in-memory `cache = {routes:{}, aircraft:{}}` persisted to `.gev-cache/adsbdb.json` as `{at, data}` with a 24 h TTL and negative caching. Client: NO value cache; `flightState._enrichSeen` is a request-dedupe `Set` (`t:<hex>`, `r:<callsign>`) for the layer lifetime; values live only in `records.data`, descriptors in `records.provenance`.
2. **Memory / browser storage / server:** server memory + disk; browser memory only (no localStorage/IndexedDB).
3. **Receipt time on a recreated record:** there is no client-side reapplication of cached values. A record forgotten and recreated in the SAME lifetime is blocked by `_enrichSeen` from re-requesting → it gets no enrichment values and no enrichment descriptors (a functional gap, not a provenance lie). Across destroy → init, `_enrichSeen` is cleared and a fresh request is made; `receivedAtMs = Date.now()` at the callback is the genuine browser receipt of that response.
4. **Does the cache make old enrichment look new?** Under the locked I3 definition (receivedAtMs = GEV client receipt of the response carrying the value): NO. `reportedAtMs` is null (adsbdb states no event time). Within a lifetime, `enrichmentCore` keeps the old receipt when the value is unchanged (tested in I3b).
5. **Does it retain the original receipt?** The server retains its own upstream fetch time (`at`) but strips it from the proxy response; there is no client cache to retain anything.
6. **Small metadata fix vs redesign:** exposing `at` would need a new descriptor slot (`upstreamReceivedAtMs` — neither `reportedAtMs` nor client `receivedAtMs`) → primitive expansion, rejected; forwarding it as feed-state (like `X-ADS-B-Cache-Age-Ms` for snapshots) is an age/freshness concern.
7. **I3 vs I5:** I5. **NO CACHE FIX in I3c.**

The only cache-adjacent *truth* bug found was not in the cache: civil `destroy()`/`init()` and the Military-layer activation sweep left `records.provenance` populated after `records.data` was cleared/deleted, so stale descriptors (including adsbdb enrichment descriptors) could be spread onto a recreated record whose values were null. Fixed (Part F).

---

## Part D — `src/data/provenance.js`

**NOT expanded.** Military uses REPORTED (`sourceId 'adsb.lol'`, `reportedAtMs` = position/contact time or null, `receivedAtMs` = batch receipt) and DERIVED with the existing `via` strings `classification`, `airborne-history`, `render-altitude-selection`. No new `via`, no confidence/quality/freshness/staleness/license/coverage/registry/history/lineage/observation-id fields.

---

## Part E — Military accessor

`militaryFlightsLayer.getProvenanceMap()` (`src/layers/military/queries.js`): `Map<nativeRecordKey, {field: descriptor}>`, CURRENT only, copy-safe (fresh Map, fresh object per aircraft, fresh copy per frozen descriptor), no history, no Cesium, no `recordIndex`, no analyst dependency. TIS-B `~` keys included verbatim. Same contract as the civil accessor; consumers join by native key (or `entityKey` suffix for canonical rows) — no canonical projection was built because no consumer requires one.

---

## Part F — Lifecycle / cleanup / memory

- `MilitaryFlightRecords.forget(id)` deletes the descriptor set with the record.
- Military `init()` and `destroy()` now `records.provenance.clear()` alongside `records.data`.
- Civil `init()`, `destroy()`, dev-only `_setFocusEvidenceAircraft()` now clear `records.provenance` (I3b omission); the Military-layer activation sweep (`tracking.js::_onMilitaryActiveChange(true)`) now calls `records.forget(icao24)` exactly like the poll-time suppression branch (previously `data.delete` + `missingPolls.delete` only → orphaned descriptors).
- Test seams `_setTracked*RefreshStateForTest` clear provenance when they replace `records.data`.
- `disable()` retains the store (pre-existing retained-disabled-cache behaviour) — descriptors are retained with it, consistently.
- Memory: ≤15 frozen descriptors per aircraft (~100 B each) + one holder object + Map entry ≈ 1–1.5 KB per aircraft. The `/v2/mil` feed is typically 300–1,500 aircraft (rare peaks ~2–3k) → ~0.5–2 MB typical, <5 MB worst case. Sparse: absent fields carry nothing, empty sets are removed.

---

## Part G — Tests

New files (23 tests, all executing production code paths):

- `src/layers/military/provenance.test.mjs` (16) — production `MilitaryFlightRecords` (+ production `readsbSnapshot` for the TIS-B case, + production `FlightRecords` for the same-ICAO case): REPORTED position with `adsb.lol`; seen_pos vs seen mapping; db-backed identity `reportedAtMs null`; missing `seen` → null (no borrowed time); one receipt per batch; sticky retention keeps descriptor; replacement; ground row retention; synthetic 0 carries no descriptor and reported 0 does; DERIVED via names, no feed id; bookkeeping never tagged (exact key set); no-source batch → no REPORTED, stale dropped; TIS-B native key; civil vs military store-local; `forget()`; current-only shape.
- `src/data/militaryFlights.provenance.test.mjs` (5) — mocked `/api/adsblol/mil` response through the real layer (`createAdsbLolSource → readsbSnapshot → applySnapshot → receive`) read via the production `getProvenanceMap()`: truthful readsb times; proxy-cache age counted; accessor copy safety + `getCurrentEntities()`/`getAnalystRecords()` provenance-unaware; missing kinematic on a later poll; `destroy()` leaves nothing.
- `src/data/flights.provenance.lifecycle.test.mjs` (2) — civil activation sweep forgets record AND descriptors; civil `destroy()` clears descriptors. Both verified to FAIL without the fixes.

---

## Part H — STOP conditions

None triggered: no military storage redesign (a sidecar Map, same as civil); truthful timestamps exist (`seen`/`seen_pos`, null for db attributes); no `recordIndex` change; no I4/I5; turnRateDps needed no history system (no provenance); enrichment cache needs no redesign (I5 owns age); source identity unambiguous (`snapshot.sourceId` from the adapter); no grouped/shared descriptors that could lie; no scope enlargement beyond aircraft.

---

## Part J — 30-item deliverable

1. **Main SHA:** `a5b8e33046f2d12261186b81931e1e638adc26ab`.
2. **Files traced:** `server/providers/aircraft/adsb-lol.js`, `server/providers/aircraft/opensky.js`, `server/providers/aircraft/enrichment.js`, `src/sources/live/{standalone,aircraft,contract}.js`, `src/data/adsbLolFallback.js`, `src/data/aircraftMeta.js`, `src/data/renderAltitude.js`, `src/data/provenance.js`, `src/data/recordIndex.js`, `src/data/militaryRegistry.js`, `src/layers/aircraft/{index,classification}.js`, `src/layers/military/{records,snapshotRenderer,ingestion,controller,lifecycle,queries,index,testing,recordPolicy,motion}.js`, `src/layers/flights/{records,snapshotRenderer,lifecycle,queries,tracking,evidence,enrichment,enrichmentCore,testing}.js`, `src/data/motionModel.js`, `scripts/package-boundaries.json`, `scripts/check-*.mjs`, `.github/workflows/ci.yml`; external: readsb `README-json.md`, adsb.lol `openapi.json`.
3. **Military field table:** Part A.2.
4. **Timestamp semantics:** Part A.3 — `seen_pos`/`seen` only; no per-field ages; db attributes null; no fallback from contact to position time.
5. **sourceId semantics:** Part A.4 — `'adsb.lol'` from the snapshot adapter, one per batch; DERIVED never inherits it; absent source → no REPORTED descriptor.
6. **Sticky/replacement:** Part A.5 — retention keeps the old descriptor; synthetic 0 (speed/track coercion bug, pre-existing, reported not fixed) carries none.
7. **Same-ICAO:** Part A.6 — store-local, no dedupe/winner/recordIndex involvement; TIS-B native keys.
8. **turnRateDps:** NO PROVENANCE NEEDED / DEFER (Part B.1) — internal motion input, windowed change measurement, no history system created.
9. **Overlooked fields:** none requiring action (Part B.2); query-time `military`/`aircraftClass` flags → I4/I6 (Part B.3).
10. **Cache architecture:** Part C.1–2 — server memory+disk (`.gev-cache/adsbdb.json`, 24 h), client dedupe Set only.
11. **Cache receipt truthful?** Yes under the locked definition (client receipt of the response; `reportedAtMs` null). Server upstream fetch time is not represented — an age concern, not a lie.
12. **Cache fix needed?** No (I5). Only the lifecycle leak of civil descriptors (incl. enrichment descriptors) was a truth bug — fixed.
13. **Primitive expansion?** None.
14. **Storage/accessor shape:** `MilitaryFlightRecords.provenance: Map<nativeId, {field: frozen descriptor}>`; `militaryFlightsLayer.getProvenanceMap()` copy-safe, same contract as civil.
15. **Lifecycle:** Part F — forget/init/destroy/evidence/activation-sweep all clear; seams clear; disable retains (consistent with data).
16. **Memory estimate:** ~1–1.5 KB per aircraft; ~0.5–2 MB typical, <5 MB worst case for the military feed.
17. **Scope chosen:** military current-field provenance (allowed item 1) + tiny civil lifecycle/sweep provenance cleanup (allowed item 2, truth bug) + tests/docs. NOT done: turnRateDps (no provenance), cache (I5), unit-conversion `via` (not needed), any vessel/satellite/UI/registry work.
18. **Files changed (10 modified, 3 new tests, 1 new doc):** `src/layers/military/records.js` (sidecar + `_recordProvenance` + `forget`), `src/layers/military/snapshotRenderer.js` (pass `sourceId`/`receivedAtMs`), `src/layers/military/queries.js` (`getProvenanceMap`), `src/layers/military/lifecycle.js` (init/destroy clear), `src/layers/military/testing.js` (seam clear), `src/layers/flights/lifecycle.js` (init/destroy clear), `src/layers/flights/tracking.js` (sweep uses `records.forget`), `src/layers/flights/evidence.js` (dev fleet replacement clears), `src/layers/flights/testing.js` (seam clear + `_onMilitaryActiveChangeForTest`), `scripts/package-boundaries.json` (see 23); new `src/layers/military/provenance.test.mjs`, `src/data/militaryFlights.provenance.test.mjs`, `src/data/flights.provenance.lifecycle.test.mjs`, `docs/planning/I3c-IMPLEMENTATION-REPORT.md`; status lines touched in `docs/planning/I3-DESIGN-REDUCTION-ADDENDUM.md` and `docs/planning/I3b-IMPLEMENTATION-REPORT.md`.
19. **Tests added:** 23 (16 + 5 + 2), Part G.
20. **Test totals:** provenance-focused command (I3b's 155-test baseline + 3 new files) → **178 pass / 0 fail**. Full `npm test` (Node 22.22.3; engines say ≥24 so GC probes skip): **4346 tests, 4343 pass, 2 fail, 1 skipped** vs baseline on `main` **4323 / 4320 / 2 / 1**. The 2 failures are PRE-EXISTING on `main` and untouched: `src/data/flights.test.mjs:57` and `src/data/militaryFlights.test.mjs:53` ("full record maps every contract field") — their deep-equal expectations predate the I2a `entityKey` field on analyst records. Recommend the owner authorize that one-line expectation fix separately (I2 test debt, out of I3c scope).
21. **Identity check:** `node scripts/check-identity-authority.mjs` → OK.
22. **Spatial check:** `node scripts/check-spatial-authority.mjs` → OK (7 frozen reasoned sites, no new raw distance code).
23. **Other boundary checks:** `check-import-directions` → OK (719 modules, 54 portable entries). `npm run check:boundaries` **FAILED on `main`** (pre-existing: `src/data/entityKey.js`, `src/data/provenance.js`, `src/layers/flights/enrichmentCore.js` were never registered in `scripts/package-boundaries.json` by I2/I3a/I3b; CI never ran on this fork so nothing caught it). Registered them in the groups that import them (civil-flights, military-flights, vessel-layer, application-components, application-layer-construction, civil-flight-records, military-flight-records — manifest only, no behaviour) → now **passes**. `npm run format:check` also fails on `main` (9 files, all pre-existing I1/I2/I3a/I3b debt); after I3c 8 remain (`src/data/{analystEngine,entityKey,geo,provenance,recordIndex}.js`, `src/layers/flights/records.js`, `src/sources/live/{aircraft,standalone}.js`) — deliberately NOT reformatted here (closed-module churn); every file I3c touched is Prettier-clean.
24. **recordIndex unchanged:** yes — no edit, provenance-unaware, identity check green.
25. **getCurrentEntities unchanged:** yes — both stores; asserted by test (exact key set `entityKey, icao24, lat, lon, altitudeM, callsign`).
26. **No history:** yes — one current descriptor per field, asserted (no arrays, five-key descriptors, single Map entry after five polls).
27. **D9/I4/I5/I6/I9 untouched:** yes.
28. **Remaining gaps:** (a) pre-existing military `speedMps`/`track` `?? 0` / `|| 0` coercion defeats sticky retention — rendering-affecting, needs owner authorization; (b) `observedAtMs` ignores payload `now` (≤1–2 s late bias on readsb-derived report times) — normalizer, I5-adjacent; (c) proxy-cache age of adsbdb enrichment not surfaced (I5); (d) same-lifetime `_enrichSeen` blocks re-enrichment of recreated records (functional, pre-existing); (e) `format:check` debt and the 2 `entityKey` test expectations on `main`; (f) MODELED (ground floor / geoid N inputs) and INTERPRETED remain unassigned by design; (g) vessels/satellites/other families untouched by design.
29. **Can AIRCRAFT I3 be declared complete?** Yes for CURRENT aircraft field provenance in both stores under the locked I3 contract: every analyst-visible current aircraft value in `FlightRecords` and `MilitaryFlightRecords` now carries a truthful REPORTED or DERIVED descriptor that follows the current value, with store-local accessors, lifecycle hygiene and production-path tests. Items 28(a)–(d) are value-semantics/freshness issues owned elsewhere, not provenance gaps.
30. **ONE next step:** owner review of this slice; then decide whether I3 closes for aircraft and the next family (vessels: `src/layers/vessels/records.js`, static vs position message times) opens as I3d — or whether item 28(a) (speed/track coercion) is authorized first as a separate rendering-affecting fix.
