# I2 — Identity / Record Index — Pre-Implementation Architecture and Code Audit (Revision 2)

**Date:** 2026-09-18 (Rev 2)  
**Scope:** Inspect REAL current GEV implementation to determine smallest, safest I2 design. Revisit entity vs observation vs layer, namespace, unstable records, recordIndex input source, snapshot terminology, brittle checks, first scope, owner decisions.  
**Constraints:** No production code modified, no I2 implementation, no D9 implementation, no I1 reopen.  
**Current state:** I1 `src/data/geo.js` implemented and merged. D9 resolved architecturally as DUAL SEMANTICS, SURFACE authoritative for geographic proximity, SLANT reserved as explicitly named secondary; implementation pending for I8 stage. This revision updates only `docs/planning/I2-PRE-IMPLEMENTATION-REPORT.md`.

---

## 1. EXECUTIVE SUMMARY — Revised

I2 is **not** a database, not history log, not provenance, not coverage. It is the smallest deterministic substrate that answers:

- "What thing is GEV referring to?" — canonical **entityKey** for stable real-world referents
- "What currently known stable entities can the system deterministically query?" — **current-state-only** `recordIndex` for stable entities

Revision 2 findings that supersede Rev 1:

- **entityKey must identify ENTITY, not observation or layer.** Repository evidence: `src/layers/flights/snapshotRenderer.js:49-65` suppresses OpenSky duplicate when same ICAO24 is known military and military layer active (`isMilitaryIcao` + `_militaryLayerSuppresses`). Flights store = OpenSky primary with 250nm adsb.lol regional fallback when OpenSky stale/unavailable (server/providers/aircraft/opensky.js serveAdsbLolPointFallback sets X-Flight-Source: adsb.lol), not simultaneous OpenSky+adsb.lol merge. Same physical aircraft appears in at most one rendering layer at a time, but identity is aircraft, not layer. Layer membership is presentation, not identity. Sticky merge occurs across time within store, not across providers in same poll.
- **Namespace must be semantic entity type, not GEV layer id.** `flights` and `military` are both aircraft presentation layers for same entity type aircraft. `aircraft:icao24:abc123` is more correct than `flights:icao24:abc123` / `military:icao24:abc123`. Layer/source membership remains available as metadata in recordIndex, not baked into key.
- **Not every record deserves canonical entityKey.** FIRMS `FIRE-#####` index-based, earthquake `event-<index>` fallback, traffic simulated, transit vehicle transient have no trustworthy stable identity. Forcing them into canonical index invents false stability. They must remain outside canonical entity index or in separate ephemeral observation store.
- **recordIndex must NOT pull from `getAnalystRecords` as primary source.** Those accessors are capped (2000 default, 500/800 for positions), analyst-specific, exist on only 5 layers. Foundational index would silently inherit truncation (11k flights vs 500 cap). Smallest durable approach is new lightweight normalized current-record accessor `getEntitySnapshot()` / `getCurrentEntities()` returning uncapped JSON-safe copies, on-demand, no Cesium types, no live references.
- **Snapshot terminology `asOf` misleading.** Implies historical querying. I2 is current-state-only. Use `assembledAt` / `builtAt` / `indexedAt` for bookkeeping when snapshot assembled, never confused with observation time, source freshness, historical query.
- **Brittle person-shaped key test must be removed.** Product prohibition on named-person search/private-person tracking is real but string-grammar test is unreliable enforcement. Enforcement point is schema enumeration (no person fields in layer schemas), analyst engine field types, ALPR modeling camera hardware not plate data, not I2 key pattern.
- **First implementation scope too broad.** Integrating 6 domains (flights, military, vessels, earthquakes, FIRMS, satellites) is migration marathon. Smallest representative set that proves contract: aircraft only (flights + military sharing same `aircraft:icao24` namespace, proving fallback OpenSky primary with adsb.lol regional fallback via X-Flight-Source and cross-layer suppression) — high-frequency moving, stable canonical, cross-provider/layer issue. Optionally one additional domain to prove namespace (e.g., vessel or satellite) after aircraft proven, but not 6 at once. Note: flights does NOT simultaneously merge OpenSky+adsb.lol in same poll; fallback is server-side regional when OpenSky stale.

**Smallest safe first implementation (revised):** I2a entityKey helper with semantic namespace + I2b new `getEntitySnapshot` accessor audit (measurement only) + I2c recordIndex current-state-only for stable entities only + I2d integration aircraft only (flights + military as same entity type) proving entity vs layer vs observation + I2e arch checks.

---

## 2. CURRENT IDENTITY INVENTORY (unchanged facts, revised interpretation)

Inspected `src/layers/*`, `src/data/*`, `src/app/layers/*`, `src/app/constructCatalog.js`, `src/data/lifecycle.js`, `src/layers/aircraft/classification.js`, `src/sources/live/standalone.js`.

### Flights — `flights`

- Native ID: ICAO24 hex from OpenSky
- Internal: `FlightRecords.data: Map<icao24, meta>` sticky merge, `missingPolls` bounded, `geoidNCache`
- Label: callsign || registration || icao24; analyst id is label not key; engine keys on icao24
- Stable: Yes within session, evicted after `MISSING_POLL_LIMIT=3` (landed=1)
- Cross-provider same entity: Flights = OpenSky primary with 250nm adsb.lol regional fallback when OpenSky stale/unavailable, labeled via X-Flight-Source header (server/providers/aircraft/opensky.js). Same ICAO24 from fallback still same aircraft entity, but NOT simultaneous OpenSky+adsb.lol merge in same poll. Sticky merge occurs across time within store (callsign/velocity retention via stickyText/stickyNumber), not across providers simultaneously. Evidence: snapshotRenderer.js military suppression, records.js sticky, server opensky.js serveAdsbLolPointFallback.
- Cross-layer same entity: Yes — same ICAO24 appears in flights and military. When military layer active, flights suppresses duplicate: `if (isMil && tracking._militaryLayerSuppresses(icao24)) { remove billboard; records.forget; continue; }` — same physical aircraft, not two entities.
- Canonical readiness: High — ICAO24 trustworthy, should be `aircraft:icao24:<id>` not `flights:icao24:<id>`

### Military Flights — `military`

- Native ID: ICAO24 hex same, from adsb.lol source `createAdsbLolSource` with `getIdentities` for registry
- Internal: Same Map pattern, same registry `createMilitaryRegistry` shared via `constructCatalog.js: militaryRegistry = createMilitaryRegistry(); configureSource(sources.military)`
- Stable: Yes
- Cross-layer same: Same ICAO24 same physical aircraft as flights, classification is attribute (military bool) not identity. Registry `_milIcaos` Set accumulates, never declassifies mid-session.
- Canonical readiness: Yes — same as flights, identical entityKey `aircraft:icao24:<id>`

### Vessels — `ais-live-vessels`

- Native ID: MMSI 9-digit
- Internal: `byMmsi Map`
- Stable: Yes while feed reports
- Cross-provider: Currently single AISStream, but future multi-provider same MMSI should be one canonical vessel
- Canonical readiness: Yes — `vessel:mmsi:<id>` semantic

### Satellites — `satellites`

- Native ID: NORAD int
- Internal: `_catalog Map` stable, `_points Map` via SGP4
- Canonical readiness: Yes — `satellite:norad:<id>`

### Earthquakes — `earthquakes`

- Native ID: USGS event id stable when present, fallback `event-<index>` synthetic index-based
- Internal: `earthquake:${stableId}` entity id
- Stable: USGS id stable within 24h window; fallback NOT stable
- Canonical readiness: USGS id => `earthquake:usgs:<id>` stable; fallback => ephemeral, no canonical

### FIRMS — `local-firms`

- Native ID: No stable provider ID — index position sorted by FRP
- Internal: `_firesByFrp Array` sorted, `_pickIndexById Map<firms-${index}>`
- Stable: No — index changes when sorted, truncation, reuse for different detection
- Canonical readiness: No trustworthy stable — D no identity, should NOT enter canonical index

### CCTV — `cctv`

- Native ID: Camera id string from 12 official packs + seed
- Internal: `_recordById Map` merges seed + backend by id
- Stable: Yes infrastructure
- Cross-provider: Seed + configured source merge by id same entity
- Canonical readiness: Yes — `camera:cctv:<id>` or `infrastructure:camera:<id>` semantic type camera

### Installations — `military-installations`

- Native ID: OSM id from Overpass + Google Places id from `searchNearby()` viewport-bounded
- Stable: OSM id stable, Google Places id stable per provider but different namespace
- Cross-provider: Same installation could appear via OSM and Google Places — possibly same real-world, needs later correlation, currently two observation identities
- Canonical readiness: OSM => `installation:osm:<id>` stable; Google => `installation:google:<id>` source-scoped, but real canonical installation may aggregate both later

### ALPR — `alpr`

- Native ID: OSM node id int `alpr:${id}`
- Stable: Yes mapped infrastructure
- Cross-provider: Same hardware could be CCTV and ALPR — possibly same but distinct datasets
- Canonical readiness: Yes — `camera:alpr:<osmId>` or `installation:alpr:<id>` but semantic camera

### Bikeshare — `bikeshare`

- Native ID: GBFS `station_id` per city
- Stable: Yes per city, but raw id collides across cities
- Canonical readiness: Needs composite — `station:gbfs:<cityId>:<stationId>` or `bikeshare:station:<city>:<id>` semantic station

### Transit — `transit`

- Native ID: GTFS vehicle id feed-scoped
- Stable: No — transient, may recycle
- Canonical readiness: Transient, source-scoped `vehicle:gtfs:<feedId>:<vehicleId>` ephemeral

### Traffic — `traffic`

- Native ID: Simulated no stable id
- Canonical readiness: No identity — D, outside canonical index

### Launches — `rocket-launches`

- Native ID: Launch id/slug/name from LL2, event identity
- Canonical readiness: Event, not asset — `event:launch:<id>` belongs to I9, not I2 canonical entity

### Awareness — `military-awareness`

- No native records, derived aggregates flights/military/vessels/installations
- Not source of identity, consumer

### Submarine Cables — `submarine-cables`

- Static id bundledSource
- Canonical: `infrastructure:cable:<id>` stable

**Key takeaways revised (I3a correction):**
- Flights = OpenSky primary with 250nm adsb.lol regional fallback when OpenSky stale/unavailable (X-Flight-Source: adsb.lol), same ICAO24 still same entity, provider is observation sourceId (opensky/adsb.lol) not identity, sticky merge across time within store not simultaneous cross-provider merge in same poll. StoreId = GEV ownership (flights/military/vessels) vs sourceId = external origin.
- Same ICAO24 in flights+military = same physical aircraft, layer membership is presentation suppression, not identity — evidence `snapshotRenderer.js` suppression logic
- Namespace must be semantic entity type (aircraft, vessel, satellite, earthquake, camera, installation, station) not GEV layer id
- Unstable synthetic must not enter canonical index

---

## 3. CURRENT RECORD ACCESS INVENTORY — Revised with caps analysis

`getAnalystRecords(maxCount=2000)` — 5 layers: flights, military, vessels, earthquakes, firms. Contract: [] while disabled/empty, on-demand once per spoken query, zero per-frame cost, no listeners, no caching, no enrichment fetches (cached adsbdb only), truncation keeps strongest (firms FRP-sorted), plain JSON-safe missing fields null, limit `max(1,floor)`, no side effects, not deterministic across refreshes.

`getAllPositions(maxCount)`: flights 500, military 500, vessels 800, satellites 300, `getDetectableObjects` stride sampling. Returns `{id, label, position: Cartesian3, latitude, longitude, altitudeM}` billboard positions dead-reckoned, capped, presence must NOT infer absence (11k contacts vs 1k cap per comment in `queries.js: hasContact`). Live mutable `position: bb.position` reference — no cloning per comment "cheap snapshot for voice-tool framing — billboard positions only, no dead reckoning and no cloning" — unsafe for index.

`getNearby(center, range, maxCount, {includeHidden})`: flights/military `Cartesian3.distance` slant currently, D9 resolved SURFACE authoritative implementation pending; installations already SURFACE via `EllipsoidGeodesic`; CCTV no getNearby yet T8 planned must call `geo.distanceM` from day one.

**Caps problem for foundational index:**
- Analyst caps load-bearing for voice tool, not for foundational index. If recordIndex pulls from `getAnalystRecords` capped 2000, it silently truncates 11k flights to 2000, losing entities. Same for `getAllPositions` 500 cap vs 11k contacts.
- Foundational index must not inherit analyst-specific truncation. Must have uncapped accessor or explicit documented truncation with separate limit.

---

## 4. ACTIVITY/EVENT IDENTITY FINDINGS (unchanged)

`lifecycle.js:2299 subscribeActivity` / `2305 _publishActivity` — 5 types: `status`, `destroy-all`, `data-updated {layerId}`, `visibility-settled {layerId}`, `params-settled {layerId}`. One subscriber `layerPresentation.js` maps to render reasons. No stable identity, no diff, no raw objects. I2 must NOT implement APPEARED/UPDATED/STALE/DEPARTED/ENTERED_SCOPE/EXITED_SCOPE (I9). I2 must provide stable entityKey so I9 can emit events with identity, expose deterministic snapshot with explicit `builtAt` (not `asOf`), no history.

---

## 5. REVISED DEFINITION — ENTITY IDENTITY vs OBSERVATION vs LAYER MEMBERSHIP

### Three distinct concepts — repository evidence

**A. ENTITY IDENTITY — The thing GEV believes it is referring to.**
- Real-world referent: physical aircraft (ICAO24), vessel (MMSI), satellite (NORAD), earthquake event (USGS id), camera infrastructure (CCTV id), installation (OSM id), etc.
- Stable across providers and presentation layers. Same ICAO24 through OpenSky and adsb.lol is same aircraft. Same ICAO24 in civilian and military layers is same airframe (evidence: `militaryRegistry` suppresses duplicate billboard when military layer active, same `icao24` key in both layers' `FlightRecords`).
- EntityKey must represent this.

**B. OBSERVATION / SOURCE IDENTITY — A provider/source's record about that thing.**
- Provider snapshot record: OpenSky observation of ICAO24 at time T with lat/lon/alt, adsb.lol observation of same ICAO24, AISStream observation of MMSI, USGS observation of earthquake.
- Contains observation time, source, freshness, accuracy — belongs to I3 provenance with three clocks `VEHICLE_TIME | FEED_TIME | RECEIPT_TIME` already in `contactPlayback.js`.
- Current code: `FlightRecords.receive(observation, {viewerLatDeg,...})` takes observation and merges into entity Map with sticky fields. Observation is ephemeral, entity is accumulated current state.
- Observation identity should NOT be baked into canonical entityKey. Provider is metadata.

**C. LAYER MEMBERSHIP — Where GEV currently exposes that record.**
- GEV layers are presentation/data organization constructs: `flights` (civil aircraft presentation), `military` (military aircraft presentation), `ais-live-vessels`, `satellites`, etc.
- Layer membership is UI concern: which toggle shows aircraft, which icon, which source. Same entity can move between layers (civil to military classification via registry) or be suppressed in one layer when another active.
- Evidence: `constructCatalog.js` creates both flights and military from same `militaryRegistry` instance; `snapshotRenderer.js` suppresses flights duplicate when military active; `isMilitaryLayerActive()` drives suppression. Layer is not identity.
- Layer membership must remain available without becoming identity: recordIndex entry should include `layerIds: Set<string>` or `presentIn: ['flights']` or `sourceRef` metadata, not part of key.

**Conclusion: entityKey = ENTITY IDENTITY (A). Observation (B) and layer membership (C) are metadata tracked separately, not part of canonical key.**

### Concrete examples

- **Same ICAO24 through OpenSky and adsb.lol fallback:** One entity `aircraft:icao24:abc123`. Two observations possible over time: OpenSky observation at T1 (primary), adsb.lol observation at T2 (regional 250nm fallback when OpenSky stale, via X-Flight-Source: adsb.lol). Both would merge into same FlightRecords.data entry over time via sticky retention across polls, not simultaneous merge in same poll. Provenance (I3) tracks sourceId opensky vs adsb.lol with reportedAtMs=positionTimeMs and receivedAtMs=snapshot receipt. EntityKey identical, observation sourceId distinct. Do NOT encode flights==opensky invariant — flights is general aircraft store with fallback.

- **Same ICAO24 appearing in civilian and military layers:** One entity `aircraft:icao24:abc123`. Layer membership changes: when military layer inactive, entity present in flights layer; when military layer active and `isMilitaryIcao(icao24)` true, flights suppresses, military presents. Classification `military: true` is attribute, not identity. EntityKey identical, layer membership metadata changes.

- **MMSI vessel:** One entity `vessel:mmsi:123456789`. Currently single provider AISStream, but future multi-provider would be multiple observations of same vessel. EntityKey identical, provider metadata distinct.

- **NORAD satellite:** One entity `satellite:norad:25544`. Static catalog, SGP4 propagation. EntityKey identical.

- **USGS earthquake event:** Event identity `earthquake:usgs:us7000abcd` when USGS id present — stable event, not persistent object, but canonical for event. When fallback `event-<index>` no stable id, no canonical entity.

- **CCTV infrastructure item:** Entity `camera:cctv:austin-001` stable infrastructure. Seed + backend merge by id same entity.

- **OSM installation vs Google Places representation:** Two observation identities: `installation:osm:123` and `installation:google:ChIJ...` possibly same real-world installation. For I2, keep distinct entityKeys initially (observation-scoped), document that true canonical installation may aggregate both later via correlation (I3/I9). Do not auto-merge.

---

## 6. REVISED KEY NAMESPACE

**Namespace should be based on semantic entity type, not GEV layer id.**

Repository evidence:
- `flights` and `military` are both aircraft, same `FlightRecords` structure, same `createFlightState`, same `isMilitaryIcao` classification, suppression logic proves same entity type.
- `ais-live-vessels` layer id is already semantic (vessel) but layer id includes live qualifier; semantic `vessel` cleaner.
- `satellites` layer id equals semantic type satellite.
- `earthquakes` layer id equals semantic type earthquake.
- `cctv`, `alpr`, `military-installations`, `bikeshare`, `transit` are layer ids that are presentation groupings, not entity types; semantic types camera, installation, station, vehicle more correct.

**Revised examples (semantic):**
- `aircraft:icao24:abc123` — not `flights:icao24:abc123` / `military:icao24:abc123`
- `vessel:mmsi:123456789` — not `ais-live-vessels:mmsi:...`
- `satellite:norad:25544` — not `satellites:norad:...`
- `earthquake:usgs:us7000abcd`
- `camera:cctv:austin-001`
- `camera:alpr:12345` (OSM node)
- `installation:osm:12345` and `installation:google:ChIJ...` distinct observation-scoped but same semantic type
- `station:gbfs:capmetro-austin:1` composite city+station
- `vehicle:gtfs:mbta:1234` feed+vehicle ephemeral
- `infrastructure:cable:telecom-001`

**Answer: If flights and military both contain ICAO24 ABC123, should entityKey be identical?**

**Yes — identical: `aircraft:icao24:abc123`.**

Justification:
- Same ICAO24 = same physical airframe per ICAO allocation and per GEV's own suppression logic (`snapshotRenderer.js` removes duplicate billboard, `records.forget`, same key in both layers' maps).
- Civil vs military is classification attribute (`military: isMilitaryIcao(icao24)` in `queries.js:713`), not identity. `militaryRegistry` is classification registry, not identity registry — it stores known military ICAOs, accumulates, never declassifies mid-session.
- No real-world distinction justifies two canonical identities for same transponder address. If same ICAO24 were two different aircraft due to spoofing/reuse, that's source error, not intended dual identity.

**How layer/source membership remains available without becoming identity:**

- RecordIndex entry includes metadata not part of key: `{entityKey: 'aircraft:icao24:abc123', presentInLayers: Set{'military'}, presentInSources: Set{'adsb.lol'}, classification: {military: true}, label, lat, lon, ...}`
- When military layer inactive, `presentInLayers` = `{'flights'}`; when active and isMilitary, `presentInLayers` = `{'military'}` (flights suppressed). EntityKey stable, membership changes.
- For flights with fallback, same aircraft can be observed via OpenSky primary or adsb.lol regional fallback at different times, `presentInSources` conceptually = {'opensky','adsb.lol'} but entityKey identical. Provenance (I3) tracks sourceId per observation with reportedAtMs and receivedAtMs. StoreId (GEV ownership flights) vs sourceId (external origin opensky/adsb.lol) distinct — flights general aircraft store, not tied to single provider.
- Analyst engine can still emit `layerKey` for UI, but identity is entityKey.

**If answer were No (distinct keys), what would justify?** Would need evidence that same ICAO24 in flights vs military are intentionally distinct real-world things (e.g., same transponder reused for different airframes, or civil and military are separate logical entities even if same physical). Repository shows opposite: suppression logic explicitly treats them as same physical aircraft that should not be double-rendered. No justification for distinct canonical identities.

---

## 7. UNSTABLE / SYNTHETIC RECORDS — Revised Classification

**Do not assume every record deserves canonical entityKey. Do not invent false stability.**

### Classification

**A. Canonical stable identity available**
- ICAO24 aircraft (flights, military) — `aircraft:icao24:<hex>` lowercased trimmed, stable per ICAO allocation, Map key, sticky merge, `MISSING_POLL_LIMIT` bounded
- MMSI vessel — `vessel:mmsi:<id>` 9-digit, stable, Map key
- NORAD satellite — `satellite:norad:<id>` int, stable catalog
- USGS earthquake id when present — `earthquake:usgs:<id>` stable within 24h window, event identity
- CCTV camera id — `camera:cctv:<id>` stable infrastructure, `_recordById` Map
- ALPR OSM id — `camera:alpr:<osmId>` or `installation:alpr:<osmId>` stable mapped infrastructure
- Bikeshare city+station — `station:gbfs:<cityId>:<stationId>` composite, stable per city, needs city namespace
- OSM installation id — `installation:osm:<id>` stable mapped
- Submarine cable id — `infrastructure:cable:<id>` static

**B. Source-scoped identity available but canonical stability uncertain**
- Google Places installation id — `installation:google:<id>` stable per Google but different namespace than OSM, may represent same real installation as OSM — source-scoped, stability uncertain for canonical, needs later correlation
- Transit vehicle id — `vehicle:gtfs:<feedId>:<vehicleId>` feed-scoped, may recycle per agency, transient
- Radio station id — `station:radio:<id>` directory large, may change, source-scoped
- Launch id — `event:launch:<id>` event identity, stable per LL2 but event not persistent entity, belongs to I9
- Earthquake id present but event is transient — stable for event but not for persistent entity tracking (which we must NOT do anyway)

**C. Session/local ephemeral identity only**
- Earthquake fallback `event-<index>` — index-based within snapshot, `stableId = feature.id || event-${index+1}`, not stable across refreshes, session-scoped
- Any `QUAKE-####` fallback synthetic

**D. No trustworthy identity**
- FIRMS `FIRE-#####` — index-based `FIRE-${index pad 5}`, sorted by FRP, truncation 2000, index changes when sorted, reused for different fire detection after eviction, no stable provider id
- Traffic simulated vehicles — no stable id, simulation only, dots per road
- Any other synthetic/index-based ids

### Treatment for recordIndex

**Canonical entity index should contain only A (and optionally B with explicit `stable:false` and source-scoped namespace, but not C/D).**

- **A records:** Enter canonical entity index under `entityKey` with `stable:true`, usable for watchlists, briefs, share links (when share links eventually include entity references).
- **B records:** May enter canonical index but must be marked `stable:false` or `sourceScoped:true`, with explicit namespace (city, feed, provider). Usable for current-state enumeration but NOT for persistent references that require stable identity (watchlists, briefs). Or remain in separate source-scoped index until stability proven. Recommend: include B in canonical index with `stable:false` and `sourceScoped:true` for now, but document as not suitable for persistent references.
- **C records:** Session/local ephemeral identity only — should NOT enter canonical entity index. May enter ephemeral observation index under explicitly ephemeral key `ephemeral:<layer>:<sessionId>` or remain outside canonical index, accessed via existing layer-specific accessors only. Do not invent canonical stability.
- **D records:** No trustworthy identity — should remain outside canonical entity index. No canonical entityKey. Accessed via layer-specific accessors only, not indexed centrally. Traffic simulated excluded entirely.

**Do not invent false stability merely so every record fits API.** FIRMS `FIRE-#####` must NOT get canonical entityKey. It is transient detection, not stable entity.

### Whether recordKey/ephemeral identity is needed

**Yes, distinction is necessary — repository evidence shows need.**

Evidence:
- Flights: observation (provider snapshot record) vs entity (aircraft in `FlightRecords.data` Map). Observation is ephemeral, entity is accumulated current state. Same ICAO24 has many observations over time, one entity.
- FIRMS: each fire detection is observation, not entity. Index-based id is observation id, not entity id.
- Earthquake fallback `event-<index>` is observation id within snapshot, not stable entity.

If we force every record into `entityKey`, we invent false stability for FIRMS and fallback.

**Minimal distinction without overengineering:**

- `entityKey` — canonical stable identity for A (and optionally B with flag). Format `semantic:kind:id` e.g., `aircraft:icao24:abc123`. Stable, usable for persistent references.
- `observationKey` / `ephemeralKey` / `recordKey` — internal ephemeral identity for C/D observations that lack stable entity identity. Format `ephemeral:<layer>:<sessionLocalId>` e.g., `ephemeral:local-firms:fire-00001` or `ephemeral:earthquakes:event-1`. Explicitly marked ephemeral, never used for watchlists/briefs/share links, not part of canonical entity index. May be used for current-state observation enumeration if needed, but not required for I2 first implementation.

For I2 minimal substrate, **do NOT implement full observationKey system yet**. Instead, keep canonical entity index for A only, and leave C/D outside index (accessed via layer accessors). Document that future I3 provenance may need observationKey for tracking individual observations, but I2 does not need it.

**Recommendation:**
- I2 canonical entity index = A only (stable).
- B optionally included with `stable:false` flag but not required for first implementation.
- C/D remain outside canonical index, no entityKey, no recordKey for I2. If ephemeral enumeration needed later, introduce `ephemeral:<layer>:<id>` explicitly marked.

---

## 8. REVISED recordIndex INPUT SOURCE

**Challenge original recommendation (pull from `getAnalystRecords`):**

Those methods:
- Created for analyst use (voice tool framing, once per spoken query)
- Capped 2000 default, 500/800 for positions — load-bearing for render governor
- Exist on only 5 layers (flights, military, vessels, earthquakes, firms)
- Return label `id` not stable key for flights (label = callsign||registration||icao24)

Foundational recordIndex must not silently inherit analyst-specific truncation.

### Compare options

**A. Index pulls from `getAnalystRecords`**
- Completeness: Incomplete — only 5 of 18 families, capped 2000, 11k flights truncated to 2000, 500 cap for positions, presence must NOT infer absence per `hasContact` comment
- Caps: Inherits analyst caps, silently loses entities — violates foundational index completeness
- Allocations: Returns new plain objects safe, no live Cartesian3 refs — good for mutation safety
- Mutation safety: Safe (plain copies)
- High-frequency feeds: On-demand once per query, zero per-frame cost — good
- Architecture boundaries: Reuses existing uniform contract `mod.getAnalystRecords(limit)` already in `gevActions.js:4140 analystProviders` — respects boundaries
- Implementation scope: Zero new layer code, reuse existing — smallest scope but incomplete
- Future I3 compatibility: No observation time, no source ref in analyst records — limited

**B. New lightweight normalized current-record accessor contract (RECOMMENDED)**
- Define new method e.g., `getEntitySnapshot()` or `getCurrentEntities()` per layer that returns uncapped current records, JSON-safe, no Cesium types, copy semantics, no live refs, deterministic order
- Completeness: Complete — returns all current entities from underlying Map (e.g., `FlightRecords.data` size 11k) without cap, or with explicit limit param but default uncapped for index
- Caps: No cap for index, or explicit cap param separate from analyst cap — prevents silent truncation
- Allocations: Returns new plain objects with lat/lon, no Cartesian3, on-demand not per-frame — acceptable, measure
- Mutation safety: Safe if returns copies, not live billboard positions
- High-frequency feeds: On-demand, not per-frame, respects high-frequency by not being per-tick
- Architecture boundaries: Layers own storage, index pulls via accessor, no circular deps, no push, no layer imports index — clean, similar to existing `getAnalystRecords` but separate contract
- Implementation scope: Requires adding method to each layer (small, 10-20 lines per layer, returns from existing Map), but only for first implementation aircraft layers, not all 18 — small scope
- Future I3 compatibility: Can include minimal sourceRef placeholder, but keep minimal for I2, allow I3 to extend

**C. Layers push current records into index**
- Completeness: Could be complete if push all
- Caps: No cap if push all, but push model
- Allocations: Push per tick could be high-frequency, per-frame risk
- Mutation safety: Risk if push live refs
- High-frequency: Push per tick would be performance regression, violates on-demand
- Architecture boundaries: Tight coupling, circular dependency (layer imports index, index imports layer), violates pull model, breaks lifecycle contract
- Implementation scope: Larger, requires lifecycle changes
- Future I3: Push model complicates provenance

**D. Index adapters over existing layer-specific accessors**
- Adapter normalizes from `getAllPositions`, `getAnalystRecords`, `getNearby`, `hasContact`, etc.
- Completeness: Still inherits caps from underlying accessors unless adapter accesses internal Map via testing hooks (breaks boundaries)
- Caps: Inherits caps unless adapter bypasses
- Allocations: Adapter may allocate extra
- Mutation safety: Must handle live Cartesian3 refs from `getAllPositions`
- Architecture boundaries: Adapter layer adds indirection but still coupled to existing caps
- Implementation scope: Medium, but still incomplete

**Recommendation: B — new lightweight normalized current-record accessor contract, smallest durable.**

- Define `getEntitySnapshot()` or `getCurrentEntities()` per layer:
  - Returns `Array<{nativeId, label, lat, lon, altitudeM?, ...minimal}>` plain JSON-safe, no Cesium, copies, uncapped by default, explicit limit optional
  - For flights: returns from `FlightRecords.data` Map (all current, not capped 500), using `rawLat/rawLon` (reported fix) for deterministic, not dead-reckoned billboard position
  - For vessels: returns from `byMmsi Map` all current
  - For satellites: returns from `_catalog` all current
  - Etc.
- For first implementation, implement only for aircraft layers (flights + military) to prove contract.
- Existing `getAnalystRecords` remains for analyst use, with caps, not used for foundational index.
- How caps prevented from truncating foundational index: foundational index uses new uncapped accessor, not `getAnalystRecords`. If accessor has optional limit param, index calls without limit or with large limit, and documents that analyst caps are separate. Architecture check ensures index does not call capped accessor.

---

## 9. CURRENT-STATE SNAPSHOT TERMINOLOGY — Revised

Original proposed `asOf` with explicit timestamp.

Problem: `asOf` implies historical querying — "what was known as of time T" — suggests time machine, playback, historical query support, which I2 must NOT have. I2 is current-state-only.

Epistemic observation time, source freshness, historical/as-of query support belong later (I3/I5/I9).

If index needs timestamp representing when snapshot itself was assembled (bookkeeping), use terminology that cannot be confused with observation time, source freshness, historical query.

**Revised terminology:**
- Use `assembledAt`, `builtAt`, `indexedAt`, `snapshotBuiltAt` — indicates when index snapshot was assembled in client, not when source observed, not source freshness.
- Or avoid timestamp altogether for first implementation: snapshot is current-state, deterministic for given underlying Maps, no time needed. Return `{count, records}` without time, or with optional `builtAt` for debugging only, internal, not exposed as `observedAt`.
- Recommendation: Use `assembledAt` for bookkeeping, internal, not exposed as epistemic time. Document that `assembledAt` is NOT observation time, NOT source freshness, NOT historical query support. It is when client assembled snapshot from current layer Maps.
- Alternatively, use `snapshotMs` with comment "client assembly time, not observation time".
- Do NOT use `asOf`, `observedAt`, `staleAt`, `accuracyM` in recordIndex — those belong to I3/I4/I5/I9 per MASTER-PLAN 0.4.5 correction.

**Example revised snapshot shape:**
```js
{
  assembledAt: 1234567890, // client assembly time, bookkeeping only, not observation time
  count: 42,
  records: [{entityKey, ...}]
}
```
Or without time:
```js
{
  count: 42,
  records: [...]
}
```
With `assembledAt` optional for debugging.

---

## 10. REMOVE BRITTLE POLICY CHECK IDEAS — Revised

Original report recommended architecture test based on detecting "person-shaped keys" by string grammar.

**Retracted:** String-pattern test is not reliable enforcement mechanism for product prohibition on named-person search/private-person tracking.

Product prohibition is important, but enforcement point is not I2 key grammar.

**Genuine architectural enforcement points (from repository evidence):**

- **Layer schemas:** No person-shaped fields in any layer schema. Check `src/layers/*/model.js`, `src/data/aircraftMeta.js`, etc. — fields are icao24, callsign, mmsi, norad, usgsId, camera id, etc., not person names. ALPR models camera hardware `alpr:${osmId}` not plate data.
- **Analyst engine field types:** `ANALYST_LAYERS` in `src/voice/gevActions.js` declares numeric/text/flags per layer, no person field type. No name-valued operator for person search.
- **No face recognition, no private-person tracking, no longitudinal per-entity movement profiles** — structural absence, not string pattern.
- **Awareness/selection:** `isSame`, `collectAircraftProximityWindow` operate on aircraft/vessels/installations, not persons.
- **Tests:** Schema enumeration tests that layer schemas contain no person fields, analyst engine contains no person field type, not string grammar of entityKey.

**Recommendation:**
- Record product prohibition as product invariant in `MASTER-PLAN` and `CURRENT-STATE`, not as I2 architecture test based on key grammar.
- If architecture check needed, check layer schemas and analyst field types enumeration, not entityKey string pattern.
- I2 entityKey helper should have explicit allowlist of semantic domains/kinds (aircraft, vessel, satellite, earthquake, camera, installation, station, vehicle, infrastructure, event) — person not in allowlist, so person-shaped key unrepresentable by construction, but not via brittle regex.
- Remove proposed `check-identity-authority.mjs` person-shaped key detection via grammar; replace with schema enumeration check if needed, or record as product invariant.

---

## 11. REDUCE FIRST IMPLEMENTATION SCOPE — Revised

Original proposed integrating flights, military, vessels, earthquakes, FIRMS, satellites (6 domains) in first implementation.

**Too broad — migration marathon, not substrate.**

**Smallest representative set that proves contract:**

- **Stable canonical identity:** ICAO24 aircraft — stable, trustworthy, Map key, sticky merge
- **High-frequency moving entity:** Aircraft — 11k contacts, `MISSING_POLL_LIMIT` eviction, dead-reckoning, high-frequency feed
- **Static/event-style entity if needed:** Could be added second, but not required for first proof
- **Cross-provider or cross-layer identity issue:** Aircraft proves both:
  - Cross-provider: OpenSky + adsb.lol same ICAO24 merged into one entity via sticky (observation vs entity)
  - Cross-layer: flights + military same ICAO24, suppression logic, layer membership vs entity identity

**Revised first implementation scope: Aircraft only (flights + military layers sharing same `aircraft:icao24` namespace).**

- Implement `entityKey` helper with semantic namespace
- Implement new `getEntitySnapshot()` accessor for flights and military layers only (return from `FlightRecords.data` uncapped, JSON-safe, copies)
- Implement `recordIndex` for stable entities only, initially only aircraft domain
- Prove: identical entityKey `aircraft:icao24:abc123` for same ICAO24 in both layers, layer membership metadata `presentInLayers`, observation metadata `presentInSources`, no false merging, no history, deterministic, copy semantics, no caps truncation
- Tests: entityKey normalization, case-insensitivity (exact then lowercase per `trackById`), parse, equal, composite not needed yet, no person domain, recordIndex current-state removal, lookup, enumeration deterministic, copy vs mutable, no history

**Then expand only after contract proven:**

- Second domain: vessel `vessel:mmsi` or satellite `satellite:norad` to prove multi-domain namespace, still stable canonical
- Third: static infrastructure camera `camera:cctv` to prove static entity
- Earthquake `earthquake:usgs` event-style if needed
- FIRMS, traffic, transit, bikeshare, etc. remain outside canonical index until needed, or in ephemeral observation store

**We want substrate, not migration marathon.**

---

## 12. REVISED ARCHITECTURE/TEST RECOMMENDATIONS

**Architecture:**

- `src/data/entityKey.js` — zero-dependency helper, no Cesium, no imports, semantic domains allowlist (aircraft, vessel, satellite, earthquake, camera, installation, station, vehicle, infrastructure, event, ephemeral). Exports `DOMAIN`, `KIND`, `create(domain,kind,nativeId)`, `parse(key)`, `isValid(key)`, `normalizeNativeId(kind,id)`, `equal(a,b)`. String canonical `semantic:kind:id` e.g., `aircraft:icao24:abc123`, structured object `{domain,kind,nativeId,key,stable}`. No class hierarchy.

- `src/data/recordIndex.js` — current-state-only index for stable entities only (A). Map-based `Map<entityKey, {entityKey, nativeId, kind, domain, label, lat, lon, presentInLayers: Set, presentInSources: Set, stable, assembledAt?}>`. Minimal, copies, no live Cartesian3. Public API `upsertFromLayer`, `removeByLayer`, `get`, `has`, `enumerate`, `snapshot({assembledAt})`, `clear`, `size`. No provenance, no coverage, no history, no watchlist. Clock explicit `assembledAt` bookkeeping not `asOf`, never ambient `Date.now()` inside calculation except bookkeeping. Pull via new `getEntitySnapshot()` accessor, not `getAnalystRecords`. On-demand, not per-frame.

- New accessor contract: `getEntitySnapshot()` per layer — uncapped, JSON-safe, copies, no Cesium, deterministic order, returns all current entities from underlying Map. For flights: from `FlightRecords.data` using `rawLat/rawLon` reported fix, not billboard dead-reckoned. For first implementation only flights + military.

**Tests:**

- `entityKey.test.mjs`: creation `aircraft:icao24:a1b2c3` normalized lower trim rejects empty rejects out-of-grammar per `TRACKING_ID_GRAMMAR` principle; parse; case-insensitivity `equal('aircraft:icao24:ABC123','aircraft:icao24:abc123')` true for icao24; composite not needed first; synthetic unstable not in canonical index; domain allowlist no person, schema enumeration not string grammar; no trajectory.

- `recordIndex.test.mjs`: current-state only upsert layer A 2 records upsert same layer 1 record → old removed size 1; lookup returns copy not mutable; enumeration deterministic sorted by key; snapshot deterministic with `assembledAt` optional; filter by domain; copy vs mutable; removal; no history; no `observedAt`/`staleAt`/`accuracyM`/`provenance`/`coverage`/`transitions` in record shape; caps not inherited (uses uncapped accessor).

- Integration: dataManager stub with `getEntitySnapshot`, enumeration, lookup, removal, layer membership metadata, cross-layer identical entityKey for same ICAO24 in flights+military.

- Architecture checks: `check-spatial-authority.mjs` still green; new check `check-identity-authority.mjs` additive but NOT person-shaped grammar — instead checks: no `getAnalystRecords` called from recordIndex (must use `getEntitySnapshot`), no live Cartesian3 in recordIndex, no trajectory, no history, recordIndex only contains A stable, no C/D.

**Performance:** Measure index rebuild for 11k aircraft on-demand, not per-frame, <50ms baseline, allocation measured.

---

## 13. REVISED OWNER DECISIONS

### Decisions that can be resolved from repository evidence (no owner choice needed)

| # | Decision | Evidence | Resolution |
|---|---|---|---|
| D12 | Composite key format `domain:kind:city:id` | `bikeshare/model.js` has `cityId:stationId` composite need, `transit/queries.js` feed.id + vehicle id, `constructCatalog.js` `cityId` param | Resolved: composite needed, format `semantic:kind:namespace:nativeId` with helper `createComposite(domain,kind,namespace,nativeId)` e.g., `station:gbfs:capmetro-austin:1`, `vehicle:gtfs:mbta:1234`. Not owner policy, implementation detail from repo. |
| D13 | Flights vs military identical entityKey? | `snapshotRenderer.js:49-65` suppression `isMilitaryIcao` + `_militaryLayerSuppresses`, `militaryRegistry` shared instance, same `FlightRecords.data` key, classification attribute not identity | Resolved: Yes identical `aircraft:icao24:abc123`. Layer membership metadata `presentInLayers`, not identity. No owner choice — evidence shows same physical aircraft. |
| D15 | Case sensitivity | `queries.js: trackById` exact then lowercase for ICAO24, `classification.js` lowercases ICAO24, MMSI numeric trim, NORAD numeric | Resolved: ICAO24 lowercased trimmed, MMSI trimmed numeric, NORAD numeric string trimmed, USGS trimmed (preserve case in structured but lowercased in string key for deterministic lookup), CCTV trimmed case-sensitive? Actually trim as-is but store lower? Evidence: CCTV id string from provider, case-sensitive? Keep trimmed as-is for camera, lower for icao24/mmsi/norad. Not owner policy. |
| D16 | recordIndex input source | `getAnalystRecords` capped 2000 vs 11k contacts, `getAllPositions` capped 500 vs 11k, `hasContact` comment presence must NOT infer absence from capped rows | Resolved: Must NOT pull from capped accessors. New lightweight uncapped `getEntitySnapshot()` accessor B is smallest durable. Not owner policy — evidence caps load-bearing for analyst, foundational index must not inherit truncation. |
| D17 | Location `src/data/entityKey.js` | `geo.js` zero-dep in `src/data/` as spatial authority, no imports | Resolved: `src/data/entityKey.js` alongside `geo.js`, `recordIndex.js` same folder. Not owner policy — existing pattern. |
| D14-partial | Synthetic representation | `firms/queries.js` `FIRE-#####` index-based, `earthquakes/index.js` `event-<index>` fallback, `traffic/model.js` no id | Resolved: Synthetic index-based must NOT get canonical entityKey. C/D remain outside canonical index. Not owner policy — evidence shows unstable, reused for different detection. |

### True owner policy / architectural decisions (require owner)

| # | Decision | Why owner needed | Options |
|---|---|---|---|
| D18 | Should B source-scoped identities (Google Places installation, transit vehicle, radio) enter canonical index with `stable:false` or remain outside until proven stable? | Product decision about what counts as entity vs observation. Affects watchlists/briefs/share links eligibility. | Option 1: Include B with `stable:false` + `sourceScoped:true` flag, usable for current-state enumeration but not persistent refs. Option 2: Exclude B from canonical index, keep in separate source-scoped index or outside until stability proven. Recommendation: Exclude B from first implementation, include only A stable, expand later after contract proven. |
| D19 | Namespace semantic type exact wording — `aircraft` vs `flight` vs `aircraft:icao24`? Owner may have preference for domain vocabulary. | Evidence suggests semantic type more correct than layer id, but exact strings `aircraft`, `vessel`, `satellite`, `earthquake`, `camera`, `installation`, `station` vs alternatives `flight`, `ship`, `sat`, `quake` etc. need owner approval for stability. | Recommend `aircraft`, `vessel`, `satellite`, `earthquake`, `camera`, `installation`, `station`, `vehicle`, `infrastructure`, `event`, `ephemeral` as semantic allowlist. Owner to approve. |
| D20 | Snapshot terminology — `assembledAt` vs `builtAt` vs no timestamp? | `asOf` misleading, but whether index needs any timestamp for bookkeeping is product decision. | Recommend `assembledAt` for bookkeeping internal, not exposed as observation time, or no timestamp for first implementation. Owner to approve. |
| D21 | First implementation scope — aircraft only vs aircraft + one more domain? | Risk tolerance, substrate proof. | Recommend aircraft only (flights + military sharing same namespace) for first checkpoint, then vessel or satellite after proven. Owner to approve minimal scope. |
| D22 | Person boundary enforcement mechanism — schema enumeration vs product invariant? | Product prohibition important, but enforcement via brittle string grammar not reliable. | Recommend product invariant in MASTER-PLAN + schema enumeration tests (no person fields in layer schemas, no person field type in analyst engine, ALPR hardware not plate data), not I2 key grammar test. Owner to approve enforcement point. |

**Retracted owner decisions from Rev 1:**
- D12 composite format now resolved from evidence, not owner choice (except exact wording)
- D13 flights vs military distinct keys now resolved as identical from evidence, not owner choice
- D15 case sensitivity now resolved from evidence
- D16 input source now resolved as B new accessor from evidence
- D17 location resolved from evidence
- D14 synthetic now split: C/D remain outside canonical index resolved from evidence, B inclusion remains owner policy D18

---

## 14. ANYTHING RETRACTED OR SUPERSEDED FROM ORIGINAL REPORT

- **Retracted:** `domain:kind:id` where domain = GEV layer id (`flights:icao24`, `military:icao24`, `ais-live-vessels:mmsi`). Superseded by semantic entity type namespace `aircraft:icao24`, `vessel:mmsi`, `satellite:norad`, etc. Evidence: flights and military are same entity type aircraft, layer is presentation, suppression logic proves same physical aircraft.

- **Retracted:** Flights and military should have distinct entityKeys `flights:icao24` vs `military:icao24` for I2 first implementation to avoid false merging. Superseded by identical `aircraft:icao24:abc123` with layer membership metadata. False merging risk was overestimated; repository evidence shows same ICAO24 is same airframe, classification is attribute.

- **Retracted:** RecordIndex should pull from `getAnalystRecords` (and `getAllPositions`). Superseded by new lightweight uncapped accessor `getEntitySnapshot()` to prevent silent truncation from caps (2000 vs 11k, 500 vs 11k). Evidence: `hasContact` comment presence must NOT infer absence from capped `getAllPositions` rows.

- **Retracted:** Synthetic unstable IDs should enter canonical index under `domain:synthetic:<fallback>` with `stable:false`. Superseded by classification A/B/C/D where C/D (FIRMS `FIRE-#####`, earthquake `event-<index>` fallback, traffic simulated) remain outside canonical entity index, no canonical entityKey, no false stability. B source-scoped may enter with flag or remain outside per owner decision D18.

- **Retracted:** `asOf` terminology for deterministic snapshots. Superseded by `assembledAt` / `builtAt` / no timestamp to avoid implying historical querying. I2 is current-state-only.

- **Retracted:** Architecture test based on detecting "person-shaped keys" by string grammar. Superseded by product invariant + schema enumeration (no person fields in layer schemas, no person field type in analyst engine, ALPR hardware not plate data). Person-shaped key unrepresentable by allowlist of semantic domains, not brittle regex.

- **Retracted:** First implementation integrating 6 domains (flights, military, vessels, earthquakes, FIRMS, satellites). Superseded by minimal substrate: aircraft only (flights + military sharing same namespace) proving stable canonical, high-frequency moving, cross-provider OpenSky+adsb.lol merge, cross-layer suppression, then expand.

- **Retracted:** `recordKey` / `observationKey` / `ephemeralKey` needed for I2 first implementation. Superseded by: distinction necessary conceptually (entity vs observation), but for I2 minimal substrate, ephemeral observation index not needed yet. Canonical entity index = A only, C/D remain outside accessed via layer accessors. Future I3 provenance may need observationKey, but not I2.

- **Retracted:** Owner decisions D12-D17 as originally framed as owner choices. Superseded by split: many resolvable from repository evidence (D12 composite, D13 identical aircraft key, D15 case sensitivity, D16 input source, D17 location, D14 synthetic C/D outside), true owner policy decisions now D18-D22.

---

## 15. CURRENT-STATE / HISTORY BOUNDARY (unchanged principle, revised terminology)

P11 lifecycle distinction preserved: transient feed state (live ADS-B, AIS, earthquakes 24h, FIRMS) vs persistent user knowledge (saved spatial objects, AOIs, watchlists, notes, workspace). I2 recordIndex current-state-only, removal = absence, no tombstone, no trajectory, no per-entity chronology, no longitudinal profiles (P6). Previous-state comparison owned by I9 outside index. Bounded staleness `missingPolls` `MISSING_POLL_LIMIT=3` (landed=1) is not history. No IndexedDB, no service worker, no PWA history. Terminology `assembledAt` not `asOf`.

---

## 16. CROSS-LAYER FINDINGS (revised interpretation)

- A clearly same canonical entity: flights OpenSky+adsb.lol same ICAO24 merged via sticky into one Map entry — same entity `aircraft:icao24`, two observations. Vessels future multi-provider same MMSI same entity. CCTV seed+backend same id same entity.

- B possibly same but needs later correlation: OSM installation vs Google Places same real installation possibly, two observation identities `installation:osm:123` vs `installation:google:ChIJ...` distinct for I2, future correlation may aggregate to canonical installation. ALPR + CCTV same hardware possibly same camera but distinct datasets — distinct for I2.

- C intentionally distinct: bikeshare station_id "1" different cities — composite `station:gbfs:city:station` distinct, transit vehicle id across feeds distinct via feed namespace.

- D insufficient evidence: radio, cables.

- Avoid false merging: mandatory semantic namespace prevents MMSI 123 vs NORAD 123 collision, but same ICAO24 across flights/military is NOT false merging — it IS same entity, identical key correct.

---

## 17. FIRST CONSUMERS — Needed-now vs later-enabled (revised scope)

Needed now for I2 first implementation (aircraft only):
- Analyst/search (I6): Needs stable `aircraft:icao24` identity, not label `id` = callsign||registration||icao24. Follow-up memory needs stable identity to avoid double-counting.
- Selection/focus: `trackById` exact then lowercase for ICAO24 — preserve.
- Awareness: `collectAircraftProximityWindow` needs stable identity to exclude subject, `isSame` via entityKey equality.

Later-enabled after substrate proven: vessels, satellites, CCTV, installations, AOIs (I7), watchlists (I10), I9 transitions, briefs (I11), share links (D4 deferred), cross-layer correlation BUILD LATER.

---

## 18. CONTRADICTIONS (updated)

- Flights/military `getNearby` metric MASTER-PLAN Part 3.4 D9 resolved DUAL SEMANTICS SURFACE authoritative but code still `Cartesian3.distance` slant — implementation pending, expected.
- Analyst record `id` label vs stable key — flights analyst `id` = callsign||registration||icao24 label not stable key, engine keys on icao24 — inconsistent with ideal entityKey, I2 introduces canonical `aircraft:icao24`.
- Firms stable identity — `FIRE-#####` index-based unstable contradicts ideal stable identity, must remain outside canonical index.
- Earthquake fallback synthetic `event-<index>`/`QUAKE-####` reuse contradicts never-reuse ideal for stable keys — must remain outside canonical index.
- Bikeshare composite key — no current composite, raw station_id collides — I2 must introduce composite when integrated.
- Transit feed namespace — vehicle id collides across feeds, no feed namespace in analyst path — I2 must introduce when integrated.
- CCTV `getNearby` missing — T8 planned, should call `geo.distanceM` from day one.
- Installations `getNearby` already SURFACE geodesic ahead of plan while flights/military still slant — inverse expected, installations already correct.

---

## 19. CONFIDENCE / UNCERTAINTY (updated)

- ICAO24 stability: Generally stable per airframe, but can be reassigned long-term, random ICAO24 for privacy? Sticky merge holds last-known-good, but true identity ambiguous — repository cannot prove forever unique, only session stable. Treat as stable canonical for I2.
- MMSI/NORAD/USGS stability: Allocated per entity, but can be reused after decommission — repository cannot prove decades, only current feed.
- FIRMS index: Provably unstable, changes when sorted by FRP — cannot be canonical.
- Cross-layer same entity flights+military same ICAO24: Repository proves same physical aircraft via suppression logic `snapshotRenderer.js`, not possibly same — confidently same entity.
- OSM vs Google Places same installation: Insufficient evidence whether same real installation, needs manual mapping — classify as B possibly same needs later correlation.
- ALPR+CCTV same hardware: Insufficient evidence.
- Provider merging OpenSky vs adsb.lol same ICAO24 lat/lon divergence: Cannot be proven without live feed, but code merges via sticky — true divergence unknown.
- Billboard position vs raw fix: `getAllPositions` live dead-reckoned vs `getAnalystRecords` rawLat/rawLon reported fix — which authoritative? Analyst raw fix for deterministic queries, billboard for rendering/proximity I8 — separate concerns.
- Performance 11k flights index rebuild: Cannot be proven without real data + Node 24/26 + `npm ci`, need measurement.
- Event-bus eager vs on-demand: Analyst on-demand, awareness on-demand via `getNearby` not index — recommend on-demand first.

---

## 20. FILES CHANGED

- `docs/planning/I2-PRE-IMPLEMENTATION-REPORT.md` — updated to Revision 2 with revised architecture per owner feedback. No other planning docs changed (unless contradiction correction absolutely required — none required beyond this report).
- No production code changed — verified `git diff HEAD -- src/` empty.
- I1 not reopened — `src/data/geo.js` untouched.
- Sequence preserved Step0→I1→I2→I3→I4→I5→I6→I7→I8→I9→I10→I11 with D9 dual semantics resolved pending implementation, plus accepted expansions I7 User Spatial Objects, I9 edge-triggered transitions.
- Tests/checks run: None required for audit (no prod code change); existing `check-spatial-authority` baseline still valid.

**End of I2 Pre-Implementation Report Revision 2 — No code modified, no docs edited except this report, I1 preserved, D9 implementation not started, awaiting owner approval on D18-D22.**


---

## 21. I2a IMPLEMENTED — Canonical Entity Identity Authority (Aircraft Only)

**Date:** 2026-09-18  
**Checkpoint:** I2a — first implementation of I2 Identity / Record Index  
**Status:** IMPLEMENTED, awaiting owner review. RecordIndex NOT implemented, I3 NOT implemented, D9 NOT implemented, I1 NOT reopened.

### Actual entityKey API

Module: `src/data/entityKey.js` — zero-dependency, no Cesium, no DOM, no network, deterministic, stateless, allocation-light.

```js
import { aircraft, create, parse, isValid, equal, normalizeIcao24, DOMAIN, KIND } from './entityKey.js'

aircraft(icao24) -> string|null
  Canonical: aircraft:icao24:<normalized>
  Returns null if missing/empty/malformed — never invents identity.

create(domain, kind, nativeId) -> string|null
  Generic factory, currently only aircraft:icao24 supported.
  Unsupported domains/kinds return null (not constructible) — makes invalid/unsupported difficult.
  Case-insensitive domain/kind.

parse(key) -> {domain, kind, icao24, nativeId, key}|null
  Parses canonical key into components, normalizes nativeId, returns canonical key.
  Returns null if invalid.

isValid(key) -> boolean
  Whether key is valid canonical aircraft key.

equal(a,b) -> boolean
  Equality of canonical identity regardless of case or whether input is raw ICAO24 or full entityKey.
  Extracts normalized ICAO24 from either form.

normalizeIcao24(value) -> string|null
  Trim + lowercase + grammar validation.

DOMAIN = { AIRCRAFT: 'aircraft' } frozen
KIND = { ICAO24: 'icao24' } frozen
```

Default export frozen object with same methods.

### Actual canonical aircraft key format

`aircraft:icao24:<normalized-icao24>`

Examples:
- `ABC123` → `aircraft:icao24:abc123`
- ` a1b2c3 ` → `aircraft:icao24:a1b2c3`
- `~abc123` (TIS-B) → `aircraft:icao24:~abc123`

Delimiter `:` safe — ICAO24 grammar `/^[0-9a-z~_-]{1,16}$/` excludes colon, so split into 3 parts safe. No escaping system needed for I2a.

### Normalization and validation rules

Derived from actual GEV aircraft lookup behavior:

- Source normalization in `src/sources/live/aircraft.js`: `cleanText(row[0]).toLowerCase()` — trim + lowercase, no hex check.
- Tracking id grammar in `src/data/layerState.js`: `/^[0-9a-z~_-]{1,16}$/` — 6 hex digits for ICAO24 with slack for TIS-B `~abc123`, bounded 1-16, identity never truncated, out-of-grammar rejected outright.
- `trackById` exact then lowercase: `let id = String(icao24).trim(); if (!billboards.has(id)) id = id.toLowerCase();`
- `isMilitaryIcao`, `_normalizeTrackedIcao`, `registerMilitaryIcaos` all trim + lowercase.

I2a normalization:
- `cleanString`: if string trim, if number finite String.trim, else empty.
- `normalizeIcao24`: trim, lowercase, test `ICAO24_GRAMMAR`, return normalized or null.
- `aircraft()`: uses `normalizeIcao24`, returns canonical key or null.
- Malformed/missing: `''`, `'   '`, `null`, `undefined`, `'abc:123'` (colon), `'a'.repeat(17)` (>16), `'!@#'` (out-of-grammar), `'abc 123'` (inner space) → null, no invented identity.
- Number handling: finite number → String → normalized (e.g., `123` → `aircraft:icao24:123`) — matches layerState trackingIdOption handling number.

Validation:
- `parse` expects exactly 3 parts `domain:kind:nativeId`, domain `aircraft`, kind `icao24`, nativeId passes `normalizeIcao24`.
- `isValid` = parse != null.

### How flights and military prove shared identity

Minimal integration point: `mapAnalystRecord` in both layers now includes `entityKey`.

- `src/layers/flights/queries.js`: import `aircraft as aircraftEntityKey` from `../../data/entityKey.js`, add `entityKey: aircraftEntityKey(icao24)` to analyst record.
- `src/layers/military/queries.js`: same.

Result:
- Flight record ICAO24 `ABC123` → `aircraft:icao24:abc123`
- Military record ICAO24 `ABC123` → `aircraft:icao24:abc123`
- Identical canonical key regardless of layer/provider.

Proves:
- Same ICAO24 through OpenSky and adsb.lol = same entityKey (provider is observation, not identity)
- Same ICAO24 in flights and military = same entityKey (layer is presentation, not identity, suppression logic in `snapshotRenderer.js` confirms same physical aircraft)
- Layer/provider names do not alter identity.

No modification to Cesium entities, raw feed objects, UI components — only normalized analyst record access.

### What integration was deliberately NOT done

- No recordIndex implemented — per I2a scope, only identity authority.
- No `getEntitySnapshot()` / `getCurrentEntities()` accessor yet — belongs to I2b/I2c.
- No `getAllPositions` modification — returns live Cartesian3 refs, unsafe for index, left alone.
- No `getNearby` modification — D9 pending, left alone.
- No `geo.js` reopened — spatial authority preserved.
- No `lifecycle.js`, `gevActions.js`, analyst engine, awareness proximity semantics, event/activity system, persistence/storage, share links, User Spatial Objects/AOIs, watchlists, I9 transitions, provenance/source/coverage modified.
- No vessels, satellites, earthquakes, FIRMS, CCTV, ALPR, installations, bikeshare, transit, radio, launches, cables domains — only aircraft supported, unsupported domains not constructible via `create()` returns null.
- No ephemeral/synthetic fallback keys, no `stable:false`, no `observationKey`/`recordKey`/`session IDs` — I2a requires trustworthy canonical identifier, records without one get no key.
- No person-key regex — product invariant remains, but I2a enforces via allowlist (only aircraft domain constructible), not brittle pattern.

### Tests added

`src/data/entityKey.test.mjs` — 11 tests, all passing:

1. Same ICAO24 produces same canonical key.
2. Case normalization deterministic (trim + lowercase, TIS-B `~` allowed).
3. Flights and military use SAME semantic namespace (`aircraft:icao24`, not `flights:`/`military:`).
4. Missing/empty/malformed do not receive invented identities (empty, whitespace, null, out-of-grammar >16, colon, inner space, special chars, unsupported domains).
5. Layer/provider names do not alter aircraft identity.
6. Helper does not retain history/state (no internal registry, calling with different ids does not affect previous).
7. Parse and isValid (valid canonical, case-insensitive, invalid domain, too many parts, empty).
8. Equal compares canonical identity regardless of case or full key vs raw.
9. NormalizeIcao24.
10. DOMAIN and KIND constants frozen.
11. Existing aircraft lookup behavior not broken — trackById exact then lowercase simulation.

Test run: `node --test src/data/entityKey.test.mjs` — 11 pass, 0 fail.

Additional relevant tests run: `aircraftMeta`, `aircraftClass`, `contactMatch` — 30 pass, 0 fail (excluding cesium-dependent `geo` and `layerState` which fail due to missing cesium package in sandbox, not related to I2a).

Full suite `npm test` (via `scripts/run-unit-tests.mjs`): 1541 pass, 183 fail due to `ERR_MODULE_NOT_FOUND: Cannot find package 'cesium'` in `worldFocus.test.mjs` and similar — environment missing node_modules/cesium, not caused by I2a changes. Same failures exist on main.

### Whether architecture check was added and why/why not

**No architecture check added for I2a.**

Justification: Unit tests and module boundaries sufficient for I2a. Module is zero-dependency, stateless, deterministic, small API, only aircraft domain. No meaningful invariant to police yet that unit tests don't already cover (no history, no registry, no live refs, no caps). Architecture check `check-identity-authority.mjs` becomes appropriate once multiple domains and recordIndex exist, when we need to police no `getAnalystRecords` from index, no trajectory, no history, no caps inheritance. Avoid adding maintenance machinery before something meaningful to police. Documented as deferred to I2c/I2e.

### Documentation updated

- This report updated with Section 21 I2a IMPLEMENTED.
- No other planning docs modified for I2a (MASTER-PLAN, REFERENCE, PRE-IMPLEMENTATION-AUDIT remain as D9/ATAK state).
- Deviation from audit proposal: Audit proposed `domain:kind:id` with domain = GEV layer id initially, later revised to semantic. I2a implements semantic `aircraft:icao24` as per Revision 2 accepted architecture. No deviation from Revision 2. Generic `create(domain,kind,nativeId)` retained for extensibility but only aircraft supported now, as recommended smallest extensible shape.

### Confirmation recordIndex NOT implemented

Confirmed: `src/data/recordIndex.js` does not exist, no recordIndex module, no indexing, no current-state snapshot. I2a is identity semantics only.

### Confirmation I3 provenance NOT implemented

Confirmed: No provenance chains, no `observedAt`/`staleAt`/`accuracyM`, no source reliability, no observationKey. Those belong to I3 and later.

### Confirmation D9 NOT implemented

Confirmed: `src/layers/flights/queries.js: getNearby` still uses `Cartesian3.distance` slant, `src/layers/military/queries.js` same, `src/data/geo.js` untouched for D9, no `slantDistanceM` added, no eager/lazy slant decision. D9 decision resolved, implementation pending for I8.

### Confirmation I1 NOT reopened

Confirmed: `src/data/geo.js` untouched, no sensor-frustum abstraction, no parametric sensor geometry, spatial authority preserved.

### Any issue discovered that should block I2b/I2c

None blocking. Minor observations for I2b:

- Existing `getAnalystRecords` capped 2000 and `getAllPositions` capped 500 vs 11k contacts — foundational index must use new uncapped accessor `getEntitySnapshot()` as recommended in Revision 2, not analyst accessors. I2a proves identity authority works, but I2b must define new accessor to avoid silent truncation.
- `getAllPositions` returns live `bb.position` reference (no cloning) — unsafe for index, must return copies or lat/lon only in new accessor.
- Flights/military `trackById` exact then lowercase behavior matches entityKey normalization (trim + lowercase) — good, no conflict.
- ICAO24 grammar allows `~` prefix for TIS-B per TRACKING_ID_GRAMMAR — I2a allows it, consistent with layerState. If strict hex-only desired later, owner decision needed, but current behavior matches GEV input.

No blockers.


---

## 22. I2a FINAL API/IDENTITY-CONTRACT REVIEW (Follow-up)

**Date:** 2026-09-18 (follow-up)  
**Scope:** Minimize public API, verify ICAO24 validation semantics, TIS-B/non-ICAO identifiers, per owner request. No I2b/I2c/recordIndex work.

### 1. Final public API after minimization

**Previous reported API (Rev 2 + initial I2a):**
- `aircraft`, `create`, `parse`, `isValid`, `equal`, `normalizeIcao24`, `DOMAIN`, `KIND`, default export

**Actual production usage after I2a changes:**
- `src/layers/flights/queries.js` uses `aircraft` (as `aircraftEntityKey`)
- `src/layers/military/queries.js` uses `aircraft`
- No production consumer for `create`, `parse`, `isValid`, `equal`, `normalizeIcao24`, `DOMAIN`, `KIND`, default export
- Test-only consumers: `entityKey.test.mjs` used all exports to justify speculative convenience

**Removed public API (follow-up tightening):**
- `create` — generic factory only supported aircraft:icao24, production never used, speculative extensibility. Removed. Future domains will be added as separate named functions `vessel(mmsi)`, `satellite(norad)` etc., which is extensible without generic framework and avoids dead end.
- `parse` — parses full key into components, production never used, speculative. Removed. Validation already via `aircraft()` returning null.
- `isValid` — production never used, speculative, aircraft returning null already signals invalid. Removed.
- `equal` — production never used, test-only, and previous implementation blurred nativeId and entityKey by accepting both `ABC123` and `aircraft:icao24:abc123` as interchangeable. Fuzzy identity API removed. Equality now proven by same ICAO24 producing same canonical key via `aircraft()`.
- `normalizeIcao24` — production never used directly (aircraft uses internally), test-only. Made internal, not exported.
- `DOMAIN`, `KIND` constants — production never used, speculative. Removed.
- Default export object — production never used, speculative. Removed.

**Final public API after minimization (boring and very small):**

```js
import { aircraft } from './entityKey.js'

aircraft(icao24) -> string|null
  Canonical: aircraft:icao24:<normalized-6-hex>
  Returns null if missing/empty/malformed — never invents identity.
```

Single named export. Stateless, deterministic, no history, no registry.

Future extensibility: Add `vessel(mmsi)`, `satellite(norad)` etc. as separate named exports when needed — smallest extensible shape without huge generic registry framework, avoids aircraft-specific dead end that would require replacement.

### 2. Which previous exports were removed and why

| Export | Production consumers | Test-only | Why removed |
|---|---|---|---|
| `aircraft` | flights, military queries | yes | **Kept** — genuine current architectural consumer, proves shared identity |
| `create` | none | yes | Speculative generic framework merely to produce one key, not needed for I2a |
| `parse` | none | yes | Speculative, no production consumer, validation via aircraft null return sufficient |
| `isValid` | none | yes | Speculative, aircraft null return already signals invalid |
| `equal` | none | yes | Speculative and fuzzy — accepted both raw ICAO24 and full entityKey as interchangeable, blurs nativeId vs entityKey semantics, no production requirement |
| `normalizeIcao24` | none (internal use only) | yes | Internal helper, not needed public, aircraft encapsulates normalization |
| `DOMAIN`/`KIND` | none | yes | Speculative constants, not used in production |
| default export | none | yes | Speculative convenience, not needed |

Ideal I2a authority is boring and very small — now single function.

### 3. Exact semantic validation rule for canonical aircraft identity

**Revised rule derived from actual records, not tracking UI grammar:**

Canonical aircraft:icao24 = exactly 6 hex digits `[0-9a-f]{6}` lowercased trimmed.

- Grammar: `/^[0-9a-f]{6}$/` after `trim().toLowerCase()`
- Length: exactly 6, not 1-16
- Characters: only 0-9, a-f, not ~_-
- Normalization: trim outer whitespace, lowercase, validate 6 hex, return `aircraft:icao24:<normalized>` or null

Evidence:

**A. What forms does GEV actually store in field called `icao24`?**
- `FlightRecords.data: Map<icao24, meta>` keyed by `observation.id` which is `cleanText(row[0]).toLowerCase()` (OpenSky) or `cleanText(row?.hex).toLowerCase()` (readsb). So stored as trimmed lowercased string, whatever source provides, no hex check in storage layer.
- But actual source data: OpenSky state-vector row[0] is ICAO24 6 hex digits per OpenSky API spec. readsb row.hex is 6 hex for ICAO aircraft, `~` + 6 hex for TIS-B non-ICAO per readsb/dump1090 documentation and layerState comment.
- So GEV stores 6 hex for ICAO aircraft, and `~` + 6 hex for TIS-B if present.

**B. What forms do OpenSky records use?**
- OpenSky `normalizeOpenSkyAircraft`: `id = cleanText(row[0]).toLowerCase()` — row[0] is ICAO24 hex from OpenSky REST `/states/all`, which per OpenSky docs is 6 hex digits lowercased. No ~, no _-.

**C. What forms do adsb.lol records use?**
- adsb.lol `normalizeReadsbAircraft`: `id = cleanText(row?.hex).toLowerCase()` — row.hex from readsb JSON `ac` array, which per readsb docs is 6 hex for ICAO, `~` + 6 hex for TIS-B (Traffic Information Service - Broadcast) non-ICAO targets generated by ground stations for aircraft without ADS-B transponder but seen via secondary radar.

**D. What does leading `~` actually mean in current data path?**
- TIS-B — non-ICAO aircraft identifier, ground-generated pseudo-address, not assigned ICAO24, used for aircraft without ADS-B transponder but tracked via secondary radar/multilateration. LayerState comment: "A tracking ID is a transponder address, not free text: 6 hex digits for an ICAO24, with slack for TIS-B (`~abc123`) and similar prefixed forms." So ~ indicates non-ICAO, semantically distinct from ICAO24.

**E. Are `_` and `-` genuinely valid canonical aircraft identifiers, or only accepted by broader tracking UI grammar?**
- No evidence in aircraft feeds. OpenSky and readsb produce only [0-9a-f] and ~. `_` and `-` never appear in `row[0]` or `row.hex`. TRACKING_ID_GRAMMAR `/^[0-9a-z~_-]{1,16}$/` allows them as slack for "similar prefixed forms" to keep URL bounded and not reject future forms, but they are not genuinely valid canonical aircraft identifiers. Should NOT be allowed for canonical aircraft:icao24.

**F. Are lengths other than expected aircraft-address representation actually present/meaningful?**
- ICAO24 meaningful length is exactly 6 hex digits. TIS-B meaningful is `~` + 6 hex = 7 chars, but distinct kind (non-ICAO). Lengths 1-5, 8-16 allowed by tracking grammar but not present/meaningful for aircraft feeds. For canonical ICAO24, only 6 hex meaningful.

**Conclusion:** Canonical ICAO24 validation for I2a = exactly 6 hex digits `[0-9a-f]{6}` lowercased trimmed. Derived from actual feeds, not tracking UI grammar.

### 4. Evidence for or against `~` identifiers being `icao24`

**Against `~` being `icao24`:**

- LayerState comment explicitly says "6 hex digits for an ICAO24, with slack for TIS-B (`~abc123`) and similar prefixed forms" — distinguishes ICAO24 (6 hex) from TIS-B slack.
- OpenSky spec: ICAO24 is 6 hex digits, no ~.
- readsb/dump1090 docs: TIS-B targets use `~` prefix to indicate non-ICAO address, explicitly not ICAO24.
- `~abc123` is provider-specific non-ICAO/transponder-derived identifier, not ICAO24.
- Labeling `aircraft:icao24:~abc123` would be false — ~abc123 is NOT ICAO24.

**For `~` being aircraft identifier (but not icao24):**

- GEV stores `~abc123` as id in `FlightRecords` if adsb.lol returns it (cleanText lowercases, no filter), and tracking id grammar allows it, so GEV intentionally supports tracking TIS-B aircraft.
- It is deterministic aircraft identifier, but different namespace.

**Finding:** GEV uses more than one semantically distinct aircraft identifier kind: ICAO24 (6 hex) and TIS-B (~ + 6 hex). Evidence requires multiple aircraft identifier kinds. Per prompt, STOP and report rather than broadening automatically.

**Unresolved identifier-kind question that blocks I2a approval?**

Yes — TIS-B `~` identifiers. If `~abc123` is NOT semantically ICAO24, do not label its canonical key `aircraft:icao24:~abc123` merely because old tracking grammar accepts it. Need owner decision for separate namespace, e.g.:

- `aircraft:icao24:abc123` for ICAO24
- `aircraft:tisb:abc123` or `aircraft:other:~abc123` or `aircraft:non-icao:abc123` for TIS-B

Do not invent namespace without review. I2a currently restricts to strict 6 hex, so `~abc123` returns null (no canonical entityKey from aircraft:icao24 authority), which is correct per "records without trustworthy canonical identifier do not receive canonical entityKey". TIS-B would remain outside canonical icao24 index until owner decides separate namespace.

### 5. Evidence for or against `_`, `-`, variable-length IDs

- **Against:** No evidence in OpenSky or adsb.lol feeds. OpenSky row[0] is 6 hex, readsb row.hex is 6 hex or ~ + 6 hex. No `_` or `-` produced. Lengths other than 6 (or 7 for TIS-B) not produced for aircraft. Tracking grammar allows 1-16 and _- as slack to keep URL bounded and not reject future forms, but not genuine aircraft identifiers.
- **Conclusion:** `_`, `-`, variable-length 1-16 not valid canonical aircraft:icao24. Should be rejected.

### 6. Whether `aircraft:icao24:~abc123` remains valid

**No — after tightening, `aircraft:icao24:~abc123` is NOT valid.**

- `aircraft('~abc123')` now returns null (rejected, not 6 hex).
- Previous implementation allowed it because it used TRACKING_ID_GRAMMAR, promoting permissive UI grammar into canonical semantics without evidence.
- Correct behavior for I2a: `~abc123` is NOT icao24, requires separate namespace and owner decision. Do not label as icao24.

### 7. Whether any unresolved identifier-kind question blocks I2a approval

**Yes — TIS-B / non-ICAO aircraft identifiers.**

GEV stores `~` prefixed identifiers as aircraft ids (evidence: cleanText lowercases any hex, tracking grammar allows ~, layerState comment calls out TIS-B slack). Semantically distinct from ICAO24 (non-ICAO, ground-generated).

I2a currently supports only `aircraft:icao24:<6-hex>` strict. TIS-B aircraft would not receive canonical key from this authority, which is correct per "records without trustworthy canonical identifier do not receive canonical entityKey" if ~ is not icao24.

But if owner intends GEV to track TIS-B aircraft as canonical entities (which layerState comment suggests, since tracking ID allows ~), then need explicit owner decision for separate namespace:

- Option A: Keep I2a as ICAO24 only (6 hex), TIS-B remains outside canonical icao24 index (no key) until I2b defines `aircraft:tisb:<id>` or similar.
- Option B: Broaden I2a to support both kinds with distinct kinds: `aircraft:icao24:<6-hex>` and `aircraft:tisb:<6-hex>` (strip ~) or `aircraft:non-icao:~abc123`.

Do NOT guess — report and stop for owner decision. I2a as currently tightened to 6 hex is smallest evidence-supported contract for ICAO24 and is approvable if owner agrees TIS-B needs separate namespace.

No other identifier kinds found — _- variable-length not valid.

### 8. Exact files changed in this follow-up

- `src/data/entityKey.js` — rewritten to minimal API single export `aircraft(icao24)` with strict 6-hex validation `/^[0-9a-f]{6}$/`, internal `normalizeIcao24`, no generic `create`, `parse`, `isValid`, `equal`, `DOMAIN`, `KIND`, default export.
- `src/data/entityKey.test.mjs` — rewritten to 8 tests proving actual small public contract only, no speculative API, includes TIS-B rejection and strict 6-hex validation.
- `src/layers/flights/queries.js` — unchanged from previous I2a (still imports `aircraft` and adds `entityKey`), but now `aircraft('~abc123')` would return null, so TIS-B flights would have `entityKey: null` — correct if ~ not icao24.
- `src/layers/military/queries.js` — same.
- `docs/planning/I2-PRE-IMPLEMENTATION-REPORT.md` — appended Section 22 final review.

No I2b/I2c/recordIndex work, no other src/ changes.

### 9. Tests run and results

- `node --test src/data/entityKey.test.mjs` — **8 pass, 0 fail** (after minimization, strict 6-hex, TIS-B rejection).
- `node --test src/data/aircraftMeta.test.mjs src/data/aircraftClass.test.mjs src/data/contactMatch.test.mjs src/data/entityKey.test.mjs` — **27 pass, 0 fail**.
- `node --input-type=module` manual check: `aircraft('ABC123')` → `aircraft:icao24:abc123`, `aircraft('~abc123')` → `null`, `aircraft('A1B2C3') === aircraft('a1b2c3')` → true, flights vs military same true.
- Full suite `npm test` — 1541 pass, 183 fail due to `ERR_MODULE_NOT_FOUND: Cannot find package 'cesium'` (missing node_modules), same as before, not caused by I2a.

### 10. Confirmation no I2b/I2c/recordIndex work occurred

Confirmed: `src/data/recordIndex.js` does not exist, no `getEntitySnapshot()` accessor, no indexing, no current-state snapshot. Only identity authority `entityKey.js`.

### 11. Confirmation no unrelated code changed

Confirmed: `git diff HEAD -- src/` shows only `entityKey.js`, `entityKey.test.mjs`, `flights/queries.js`, `military/queries.js` (previous I2a integration) plus pre-existing D9/ATAK M files in docs/planning. No `geo.js`, no `lifecycle.js`, no `gevActions.js`, no `getNearby`, no D9, no I1 reopen, no persistence, no share links, no AOIs, no watchlists, no I9, no provenance.

---

## 23. I2b IMPLEMENTED — Current Aircraft Entity Accessor

**Date:** 2026-09-18  
**Checkpoint:** I2b — CURRENT AIRCRAFT ENTITY ACCESSOR  
**Status:** IMPLEMENTED, awaiting owner review. Full I2 NOT complete. recordIndex NOT implemented, I3 NOT implemented, D9 NOT implemented, I1 NOT reopened.

### Storage ownership tracing

- **Flights:** `flightState.records = FlightRecords` instance created via `createFlightState` (see `src/layers/flights/state.js`). `FlightRecords.data: Map<icao24, meta>` holds authoritative current records. Meta fields include `rawLat/rawLon` (reported fix pre-dead-reckon, not billboard), `altitude` (barometric MSL meters, sticky), `geoAltitudeM`, `renderAltitudeM`, `callsign`, `velocity`, `true_track`, `onGround`, `wasAirborne`, `lastContactEpochMs`, etc. `missingPolls` Map + `geoidNCache`. `receive()` sticky merge. `absence(id,{complete,likelyLanded})` retains if `!complete && <5min` since `observedReceiptMs`, else increments misses, limit `LANDED_MISSING_POLL_LIMIT=1` if likelyLanded else `MISSING_POLL_LIMIT=3`, stale if <limit, remove if >=limit. `forget()` deletes `data/missingPolls/geoidNCache`.
- **Military:** `flightState.records = MilitaryFlightRecords` independent instance per military layer (`src/layers/military/state.js`), same pattern. Data fields `rawLat/rawLon`, `altitudeFt` (feet, not meters), `speedMps`, `track`, `callsign`, etc. Same absence/forget.
- **Relationship:** Flights and military each have independent `FlightRecords` instance. Not shared. Flights `snapshotRenderer.js` suppresses known military ICAOs when military layer active via `militaryRegistry.registerMilitaryIcaos(currentIcaos)` → flights checks `isMil && _militaryLayerSuppresses(icao24)` → `forget()` removes billboard/cullPositions/history. So same ICAO24 not in both visible stores when military active. When military inactive, military `billboardCollection.show = false` → `hasContact` returns null but `data` Map may still retain, so same ICAO24 could be in both hidden stores. Union with dedup by ICAO24 naturally includes both without duplication when military active.
- **Ingestion:** OpenSky `normalizeOpenSkyAircraft` and adsb.lol `normalizeReadsbAircraft` → `records.receive(observation)` → sticky merge into `data` Map. Current-state is accumulated Map, not history.
- **Non-visible:** Store includes only current known after missing-poll lifecycle; absence policy evicts. Non-visible horizon-hidden still in store if billboard hidden but modelOwnsVisual or includeHidden — but accessor independent of visibility.
- **Military suppression:** Affects storage (forget) for flights, not just rendering. Military snapshot does NOT suppress flights; flights suppression is one-way.

### Accessor name / owner

- **Name:** `getCurrentEntities()` — chosen over `getEntitySnapshot()` to avoid `asOf` snapshot terminology confusion; aligns with Revision 2 recommendation B but uses current-entities wording.
- **Owner:** Flights layer `src/layers/flights/queries.js` and Military layer `src/layers/military/queries.js` — each owns its accessor projecting its own `FlightRecords.data`. Not shared module. Future `recordIndex` will pull from both.

### Normalized record shape

Minimum useful, no provenance/history:

```js
{
  entityKey: string|null, // canonical aircraft:icao24:<6-hex> or null for TIS-B/malformed
  icao24: string,         // native identifier as stored — field called icao24 but actually general aircraft id including TIS-B ~ (documented ambiguity)
  lat: number|null,       // rawLat from current record model
  lon: number|null,       // rawLon from current record model
  altitudeM: number|null, // flights: altitude (meters barometric MSL) | military: altitudeFt*0.3048 converted to meters
  callsign: string|null   // trimmed callsign or null
}
```

Justified: `entityKey` for future recordIndex input, `icao24` native preserved, `lat/lon/alt` minimal geographic, `callsign/label` useful for display without enrichment. Excludes `observedAt/staleAt/accuracyM/provenance/provider history/coverage/blind spots/previous position/history/APPEARED/etc/AI/watchlist`.

- **Military classification:** Not added as separate field; military layer accessor inherently implies classification via layer membership, but entityKey identical. Layer membership remains available via which accessor called, not baked into record.
- **Domain/type:** Implicit aircraft, not included as field — accessor owner is aircraft layer.

### Coordinate source

- **Authority:** `rawLat/rawLon` from current record model (`info.rawLat`, `info.rawLon`) — actual reported fix pre-dead-reckon, not mutable Cesium `Cartesian3` billboard position, not camera-relative, no new spatial computations.
- **Altitude:** Flights `info.altitude` is barometric MSL meters (sticky, grounded 0 fallback). Military `info.altitudeFt` is feet, converted `*0.3048` to meters for normalized shape consistency. Documented actual stored convention: flights meters, military feet. No `renderAltitudeM` / terrain height.
- **No identity from position:** No position-derived identity, no I1/D9 reopen, no `geo.js` use.

### Cap / ordering

- **Cap:** Uncapped — iterates entire `FlightRecords.data` Map size (11k practical). On-demand not per-frame. Performance O(n) allocation per record acceptable.
- **Ordering:** Explicit Map insertion order deterministic for same store state. Documented in JSDoc. Not sorted, not random.
- **Relationship to existing caps:** `getAnalystRecords` capped 2000 and `getAllPositions` capped 500 remain intact, unchanged. New accessor does not inherit caps.

### TIS-B handling

- Native identifier `icao24` field actually stores general aircraft identifier including TIS-B `~abc123`. Preserved as `icao24` for compatibility, with documented ambiguity in code comment.
- `entityKey: aircraft(icao24)` returns null for `~` prefixed and malformed per I2a strict 6-hex rule. TIS-B record remains represented but with `entityKey: null` explicit — NOT discarded, NOT invented session identity, NOT `aircraft:icao24:~abc123`. Requires owner decision for separate namespace `aircraft:tisb:<id>` if desired.
- Malformed missing/malformed IDs also get `entityKey: null`, no invented identity.

### Copy / mutation safety

- Fresh array per call `[]`, fresh plain object per record `{}`, primitives only (string, number, null). No Cesium refs, no live `bb.position`, no Map references.
- Mutating returned record does not mutate `FlightRecords.data` storage — proven by test.
- Side-effect free: calling accessor repeatedly yields deepEqual but not same references, storage size unchanged, no history accumulation, no `missingPolls` mutation.

### Tests added

`src/data/currentEntities.test.mjs` — 12 tests, all passing, covering required 12 items:

1. **Uncapped:** 3000 synthetic records → accessor returns 3000, exceeds 2000 analyst cap and 500 position cap.
2. **Every stored represented:** Map size 2 → accessor length 2, ids match.
3. **Canonical key correct:** `a1b2c3` → `aircraft:icao24:a1b2c3`.
4. **Same ICAO24 not duplicate per storage semantics:** flights and military both have `a1b2c3` same entityKey, union Map by icao24 size 1 (flights forgets when military active per snapshotRenderer).
5. **TIS-B remains with null key:** `~abc123` preserved as icao24, entityKey null, normal `abc123` has key.
6. **Malformed no invented:** `''`, `'   '`, `'abc'`, `'zzzzzz'`, `'abc:123'` → all null entityKey.
7. **Coordinates from correct fields not billboard:** lat=rawLat, lon=rawLon, altitudeM=altitude, no position field.
8. **Plain/copy-safe:** mutate returned record, storage unchanged, fresh array/object per call.
9. **Repeat no side effects:** 3 calls deepEqual, storage size unchanged.
10. **No history accumulation:** update Map entry replaces, delete removes, no tombstone, length reflects current only.
11. **Existing caps intact (simulated):** capped accessor 2000 vs uncapped 3000, proves separation.
12. **Lookup/tracking intact:** hasContact exact then lowercase simulation, entityKey lowercases.

Test run: `node --test src/data/currentEntities.test.mjs` — 12 pass, 0 fail.

Additional: `entityKey.test.mjs` 8 pass, `aircraftMeta`, `aircraftClass`, `contactMatch` still pass. Full suite cesium-missing failures unchanged (environment, not I2b).

### Deviations / decisions

- **Altitude normalization:** Military altitudeFt feet → meters conversion `*0.3048` for normalized shape consistency. Documented as conversion, not stored convention. Flights altitude already meters. Decision justified: normalized shape should be meters for future index, but actual stored convention documented.
- **Record shape minimal:** Only 6 fields. No `military` bool, no `layerId`, no `operator`, `type`, etc. Justified: smallest useful for recordIndex input, military classification available via accessor owner, additional fields can be added later without breaking.
- **Name `getCurrentEntities` vs `getEntitySnapshot`:** Chose `getCurrentEntities` to avoid snapshot `asOf` terminology; still on-demand current-state only. Both names acceptable per Revision 2.
- **No union accessor yet:** Flights and military each have own accessor. Union with dedup belongs to recordIndex (I2c), not I2b. I2b provides per-layer uncapped projection only.
- **No `assembledAt`:** Accessor returns array only, not `{assembledAt,count,records}` — keeps accessor boring, recordIndex can add bookkeeping if needed. No `asOf`.

### Architecture check decision

No new architecture check added for I2b. Justification: I2b is per-layer accessor, not yet index. Existing caps still enforced in `getAnalystRecords`/`getAllPositions`, new accessor explicitly uncapped with comment. Check `check-identity-authority.mjs` that would police no `getAnalystRecords` from index, no live Cartesian3, no history becomes meaningful once recordIndex exists (I2c). Deferred to I2c/I2e per same rationale as I2a.

### Confirmations

- **No recordIndex file:** `src/data/recordIndex.js` does not exist.
- **No I2c:** No indexing, no `upsertFromLayer`, no `snapshot`.
- **No I3 provenance:** No `observedAt`/`staleAt`/`accuracyM`/`provenance`/`provider history`/`coverage`.
- **No D9:** `getNearby` still `Cartesian3.distance` slant, no `slantDistanceM`, no eager/lazy decision, `geo.js` untouched.
- **No I1 reopen:** `src/data/geo.js` untouched.
- **No TIS-B canonical namespace:** `aircraft:icao24:~` not valid, returns null, no `aircraft:tisb` invented.
- **Full I2 NOT complete:** Only I2a (identity authority) + I2b (current accessor) implemented. I2c recordIndex, I2d integration, I2e arch checks remain pending. This report section records I2b only.

**End of I2b — Accessor `getCurrentEntities()` implemented flights + military, uncapped, deterministic, side-effect free, plain/copy-safe, coordinate authority rawLat/rawLon/altitude, TIS-B null key preserved, 12 tests passing, no recordIndex, no I3, no D9, no I1 reopen.**

---

## 24. I2b REVIEW — Independent Stores, Overlap Lifecycle, and I2c Reconciliation Contract

**Date:** 2026-09-18 (review)  
**Scope:** Resolve architectural contract for two independent aircraft stores before I2b approval. No recordIndex, no merged accessor, no I2c, no provenance, no D9.

### 1. Exact flights/military overlap lifecycle (traced from actual code)

**Independent stores:**
- `src/layers/flights/state.js`: `flightState.records = new FlightRecords(...)` independent Map.
- `src/layers/military/state.js`: `flightState.records = new MilitaryFlightRecords(...)` independent Map.
- Not shared. Each has `data Map<icao24,meta>`, `missingPolls`, `geoidNCache`, `receive()`, `absence()`, `forget()`.

**Military snapshotRenderer (`src/layers/military/snapshotRenderer.js`):**
- Builds `currentIcaos Set` from `snapshot.records` (ids that arrived in this military poll).
- For each aircraft: `records.receive()` → `data.set()`, billboard handling.
- After loop: `registerMilitaryIcaos(currentIcaos)` → `militaryRegistry._milIcaos.add(lowercased)` accumulates, never declassifies, `_lastRefreshMs = now()`.
- Returns `{count, ids: currentIcaos}`.

**Flights snapshotRenderer (`src/layers/flights/snapshotRenderer.js`):**
- `refreshMilitaryRegistryIfStale()` at start — early returns if `_militaryLayerActive true`, so when military active, flights does NOT poll military source for classification; relies on existing `_milIcaos`.
- For each observation in `snapshot.records`:
  - `isMil = isMilitaryIcao(icao24)` checks `_milIcaos.has(lowercased)`.
  - If `isMil && tracking._militaryLayerSuppresses(icao24)`: if billboard exists, remove billboard, delete from `_billboards`, `_releaseModel`, `records.forget(icao24)` (synchronous delete from data/missingPolls/geoidNCache), delete `_cullPositions`, `_positionHistory`, `_displayCourse`, `_groundSnap.forget()`, then `continue` (does NOT add to currentIcaos, does NOT receive).
- `_militaryLayerSuppresses(icao24)` in `src/layers/flights/tracking.js:706`:
  - `if (!isMilitaryLayerActive()) return false;`
  - `if (icao24 === _trackedIcao) return false;` // tracked exemption
  - `if (icao24 === _pendingTrackingRestore?.id) return false;` // restore latch exemption
  - `return true;`
- `forget()` is immediate synchronous.

**Layer toggle:**
- Military `lifecycle.js enable()`: `setMilitaryLayerActive(true)` → fires `onMilitaryLayerActiveChange` listeners.
- Flights `tracking.js _onMilitaryActiveChange(active)`:
  - If active true: iterate flights `_billboards`, for each where `isMilitaryIcao(icao) && icao !== tracked`, remove billboard, `_releaseModel`, `records.data.delete`, `_cullPositions.delete`, `_positionHistory.delete`, `_displayCourse.delete`, `_groundSnap.forget`, `missingPolls.delete`. Immediate suppression, not waiting for next poll. Sets `feed._count = size`.
  - If active false and billboardCollection.show: `void flightsLayer.update(viewer)` fire-and-forget to bring next OpenSky poll forward.
- Military `disable()`: `setMilitaryLayerActive(false)`, hides `billboardCollection.show=false`, `releaseContinuousRender`, `_releaseModels`, `_clearTracking`, `_destroyTrail`, destroys click handler, unregisters pick owner, removes preRender listeners. Does NOT clear `records.data` Map. So data remains populated (stale) while hidden.
- Flights `disable()`: hides collection, aborts updates, clears tracking, etc., but does NOT clear `records.data`? Actually `destroy()` clears, but `disable()` does NOT clear data Map — it keeps records but hides collection, per `hasContact` returning null when hidden.

**Visibility vs ownership:**
- `billboardCollection.show` controls presentation. Data ownership affected by `isMilitaryLayerActive + isMilitaryIcao` suppression which calls `forget()` (deletes from flights data). So military active affects flights data ownership, not just presentation. Military inactive: military data remains but hidden (visibility false, ownership remains).

**Provider refresh/reconnect:**
- Each poll calls `applySnapshot`. Flights forget is immediate within poll loop. Military register is at end of poll.

### 2. Whether simultaneous same-ICAO24 records can exist in both Maps

**Yes, under timing/race conditions:**

- **Military activation race:** Military layer becomes active, flights immediately deletes known military from its store via `_onMilitaryActiveChange(true)`. But if military then discovers NEW military ICAO in its next poll that flights already had, flights won't suppress until its next poll (suppression only in snapshotRenderer loop, not via registry listener except for activation transition). Window: after military poll registers new icao, before flights next poll → both Maps contain same ICAO24.

- **Military deactivation window:** Military disable does NOT clear its data Map. It sets active false. Flights triggers update fire-and-forget, but will only re-acquire after next OpenSky poll succeeds. So during deactivation window, military Map still has old record (stale), flights Map may newly receive same ICAO24 from OpenSky → both contain same ICAO24 simultaneously.

- **Initial activation before first military poll:** If military layer just enabled but hasn't completed first poll, `_milIcaos` may be empty/stale, flights may still have military ICAO in its Map, military Map may not yet have it → not both, but opposite hole. After military poll, both could temporarily coexist until flights next poll.

- **Feed dropout hole:** When military active, flights suppresses known military. If military feed drops ICAO24 (missing polls → forget), flights still suppresses because `_milIcaos` never declassifies, so neither store has it → hole, not overlap, but shows suppression not purely data-driven.

**Normally, when military active and steady-state after both layers have polled, same ICAO24 should NOT exist in both Maps (flights suppressed).** Code guarantees this via `forget()` in flights snapshot loop and immediate delete on activation transition, but only for ICAOs already in `_milIcaos` Set.

**Older/newer payload:** Each store has independent `observedReceiptMs = Date.now()` at receive, `lastContactEpochMs` from feed, `positionTimeMs`. No cross-store comparison. So if both contain same ICAO24 during overlap window, each holds its own last-known meta from its own provider (OpenSky vs adsb.lol) with different lat/lon/alt/callsign and different timestamps. Can be older/newer arbitrarily.

### 3. Exact semantics of each getCurrentEntities()

- `flights.getCurrentEntities()`: **Current records owned by THIS flights FlightRecords.data Map**, i.e., aircraft currently known to flights store after its own ingestion, sticky merge, missing-poll eviction, and military suppression. NOT globally authoritative for all aircraft known to GEV. When military active, does NOT contain known-military ICAOs (suppressed). When military inactive, contains all current OpenSky/adsb.lol aircraft including military-classified ones.

- `military.getCurrentEntities()`: **Current records owned by THIS military MilitaryFlightRecords.data Map**, i.e., aircraft currently known to military store after its own ingestion and missing-poll eviction. NOT globally authoritative. When military active, contains military aircraft currently known to adsb.lol. When military inactive/hidden, still contains its last-known Map (stale) until evicted, but presentation hidden (`billboardCollection.show=false`, `hasContact` returns null).

Both accessors are store-owned, on-demand, uncapped, plain, side-effect free, independent of Cesium billboard visibility/dead-reckon.

Naming `getCurrentEntities()` does NOT falsely imply global authority when documented as store-owned — JSDoc now explicitly states store-owned semantics and overlap behavior.

### 4. Whether either accessor claims global aircraft authority

**No.** After JSDoc clarification, neither accessor claims global authority. Each explicitly returns records owned by its own store. Global view requires I2c recordIndex that knows which store produced each array.

### 5. Whether I2c can safely union/dedup today

**No, not safely by simply keeping whichever enumerated last.** If two independent stores contain `aircraft:icao24:abc123`, naive union dedup by ICAO24 with first-wins or last-wins makes Map iteration order determine authoritative payload, which is unsafe and non-deterministic for consumers.

### 6. Deterministic reconciliation evidence that exists today

- **Military classification:** `militaryRegistry.isMilitaryIcao(icao)` — Set `_milIcaos` accumulates, never declassifies mid-session, deterministic, small (few hundred hexes).
- **Layer activation state:** `isMilitaryLayerActive()` boolean — true while military layer enabled.
- **Store ownership/suppression rules:** When military active and isMilitaryIcao true, flights forgets, military wins. When military inactive, flights wins (military hidden). This is explicit priority rule encoded in `snapshotRenderer.js` and `_onMilitaryActiveChange`.
- **Provider timestamps:** Each meta has `observedReceiptMs` (client receipt), `lastContactEpochMs` (feed contact time), `positionTimeMs` / `fixEpochMs`. These exist but are per-store, from different providers (OpenSky vs adsb.lol) with different clocks, not cross-provider comparable without I3 provenance semantics. Using newest-wins would import I3-like timestamp comparison prematurely.

**Evidence provides deterministic priority via active state + registry, but that priority is presentation-layer state, not pure data.** It matches current rendering: military wins when active, flights wins when inactive. However, it still leaves holes (military active but military feed dropped → neither has it) and stale data (military inactive but its Map still holds old record).

No safe pure-data winner (e.g., baro vs geo altitude, lat/lon) without I3. Timestamps not safe without I3.

### 7. Whether reconciliation is resolved by existing architecture or remains I2c design issue

**Partially resolved by existing architecture, but genuine I2c design decision remains.**

Existing architecture attempts deterministic resolution via suppression: when military active, flights forgets, so only military holds it in steady state. This resolves most cases.

But genuine I2c decision remains because:
- Overlap windows exist (activation race, deactivation window) where both hold same ICAO24 with different payloads.
- Hole case exists where neither holds it (military active, military feed dropped, flights suppressing due to never-declassify registry).
- Layer activation state is UI presentation, not pure data, so I2c must decide whether to respect presentation priority or be presentation-agnostic.
- Timestamps exist but require I3 semantics to be safe.

**Smallest safe options for I2c WITHOUT choosing based on speculation:**

- **Option A — Respect current suppression priority:** If `isMilitaryLayerActive && isMilitaryIcao(icao)`, military record wins; else flights wins. Simple, matches existing rendering, deterministic, but couples index to UI layer state and registry (presentation concerns).

- **Option B — Keep both as separate observations with same entityKey:** Do not dedup in I2c; expose conflict as array of store-owned records per entityKey, or keep both with explicit `sourceStore` metadata outside normalized record. Lets consumers see conflict, avoids arbitrary winner.

- **Option C — Newest-wins by observedReceiptMs / positionTimeMs:** Pick record with most recent `observedReceiptMs` or `lastContactEpochMs`. Requires timestamp comparison across providers, imports I3-like freshness semantics, not safe without provenance, but deterministic if timestamps trusted.

- **Option D — No dedup in I2b, explicit policy in I2c adapter:** I2b accessors remain store-owned, I2c adapter retains context of which accessor produced each array (e.g., `sourceLayer: 'flights'|'military'` outside normalized record) and applies explicit policy with documentation, not inside entity record.

Do NOT implement any option now; report as open I2c design decision.

### 8. Whether normalized record shape changed and why

**No shape change.** Shape remains 6 fields: `entityKey, icao24, lat, lon, altitudeM, callsign`. Minimal, justified.

**Military classification field NOT added.** Layer membership is NOT entity identity, provider provenance belongs I3. Store/layer origin should remain OUTSIDE normalized entity record and be known by index adapter via which accessor was called. This avoids contaminating entity record merely to solve future problem. If needed, adapter can attach `sourceLayer` metadata outside record.

If future index needs to distinguish two store-owned observations without knowing which accessor produced them, adapter boundary retains context — does not require field inside entity record.

### 9. Exact altitude semantics for each store

Verified from source:

- `src/sources/live/aircraft.js`:
  - OpenSky: `baroAltitudeM: finite(row[7])` — row[7] is barometric altitude in meters per OpenSky API spec.
  - readsb (adsb.lol): `baroFt = finite(row.alt_baro)` where `alt_baro` is feet per readsb spec (barometric altitude in feet), then `baroAltitudeM: baroFt*0.3048` → meters barometric.
  - Both sources normalize to `baroAltitudeM` meters barometric MSL.

- `src/layers/flights/records.js`:
  - `alt = stickyNumber(baro_alt, prevMeta?.altitude, onGround?0:10000)` where `baro_alt = observation.baroAltitudeM` (meters barometric). Stored as `altitude` meters barometric MSL, sticky, grounded 0 fallback. `geoAltitudeM` separate (ellipsoid geometric), `renderAltitudeM` separate (visual datum with geoid/ground corrections).

- `src/layers/military/records.js`:
  - `altitudeFt = baroAltitudeM == null ? null : baroAltitudeM/0.3048` where `baroAltitudeM = aircraft.baroAltitudeM` (meters barometric from readsb normalization). So `altitudeFt` is feet barometric MSL, derived from meters barometric.
  - `altitudeM = baroAltitudeM ?? (onGround ? prev altitudeFt*0.3048 : 3048)` — fallback, but primary is barometric.
  - `geoAltitudeM` separate, `renderAltitudeM` separate.

**Both stores represent same altitude concept: barometric altitude MSL, just different stored units.** Flights stores meters, military stores feet (converted from meters). Not geometric, not AGL, not render height.

### 10. Whether altitudeM remains semantically valid

**Yes.** Converting both to `altitudeM` meters barometric MSL is valid and does NOT erase important distinction. Both are barometric MSL, same concept, different units. Conversion `*0.3048` preserves semantics. No mixing of baro vs geo.

Narrowest safe representation: keep `altitudeM` as barometric MSL meters for both, with JSDoc stating barometric MSL and verified source chain. Do NOT introduce separate `baroAltitudeM` vs `geoAltitudeM` in I2b minimal shape — that would be I3/I4 detail.

### 11. Correction to "dedup via suppression" test claim

**Previous claim:** Test named `same ICAO24 classification/layer does not create duplicate canonical entities` and comment said "Union dedup by ICAO24 naturally includes one entity when military active (flights store forgets military when military active, per snapshotRenderer)" — implied I2b deduplicates globally.

**Correction:** Test renamed to `same ICAO24 yields same entityKey — store-owned accessors, not global dedup`. Now proves:
- Same ICAO24 → same entityKey (I2a identity)
- Payloads NOT interchangeable (different lat/lon/callsign/alt from independent stores)
- Each accessor store-owned, not globally authoritative
- During transitions both Maps can contain same ICAO24 (verified from actual lifecycle code: military disable does NOT clear data, flights update fire-and-forget)
- Naive union dedup by keeping first/last enumerated is order-dependent and unsafe — demonstrates I2c cannot safely dedup by simply keeping whichever enumerated last.

Test now accurately reflects I2b does NOT globally dedup; it exposes store-owned records.

### 12. Exact files changed in this review

- `src/layers/flights/queries.js` — JSDoc for `getCurrentEntities()` expanded to document store-owned semantics, exact overlap lifecycle (independent stores, registerMilitaryIcaos at END of military poll, flights checks at START, _militaryLayerSuppresses false if !active/tracked/pending, _onMilitaryActiveChange immediate delete on activation, fire-and-forget update on deactivation, military disable does NOT clear data Map, both Maps can contain same ICAO24 during deactivation and race windows, either can contain older/newer payload, visibility vs ownership, forget immediate), clarifies does NOT claim global authority, same entityKey != interchangeable payloads, I2c reconciliation open, altitude verified barometric MSL meters from OpenSky row[7] meters and readsb alt_baro feet*0.3048.

- `src/layers/military/queries.js` — Same JSDoc expansion, altitude verified barometric MSL (readsb alt_baro feet → meters, stored as altitudeFt feet barometric, converted back), store origin outside normalized record.

- `src/data/currentEntities.test.mjs` — Test 4 renamed/reframed from "does not create duplicate canonical entities" to "yields same entityKey — store-owned accessors, not global dedup", now proves identity same but payloads different, both stores can contain same ICAO24 during transitions, naive dedup unsafe.

- `docs/planning/I2-PRE-IMPLEMENTATION-REPORT.md` — Appended Section 24 with full lifecycle trace, semantics, reconciliation analysis, altitude verification, test correction.

No recordIndex file created, no merged/union accessor implemented, no I2c, no provenance, no D9.

### 13. Tests run/results

- `node --test src/data/currentEntities.test.mjs` — **12 pass, 0 fail** after reframing (including corrected test 4).
- `node --test src/data/entityKey.test.mjs src/data/currentEntities.test.mjs` — **20 pass, 0 fail**.
- `grep -n getCurrentEntities src/layers/flights/queries.js src/layers/military/queries.js` — both present, store-owned JSDoc.
- `ls src/data/recordIndex.js` — does NOT exist (confirmed no recordIndex).
- `grep -n Cartesian3.distance src/layers/flights/queries.js src/layers/military/queries.js` — still slant, D9 not implemented.

### 14. Confirmation no recordIndex/I2c implementation occurred

Confirmed:
- `src/data/recordIndex.js` does NOT exist.
- No merged/union aircraft accessor implemented — only per-store `getCurrentEntities()`.
- No I2c indexing, no `upsertFromLayer`, no `snapshot`, no `assembledAt`.
- No provenance (`observedAt`/`staleAt`/`accuracyM`), no D9 (`slantDistanceM`), no I1 reopen (`geo.js` untouched).

### 15. Genuine owner decision now required before I2c

**Yes — I2c reconciliation policy:**

When both independent stores contain same canonical `aircraft:icao24:<id>` simultaneously (during military disable window or activation race), what should canonical index do?

- **Option A** respects current suppression priority (military wins when active and isMilitaryIcao) — matches rendering, but couples index to UI layer active state and never-declassify registry.
- **Option B** keeps both as separate observations with same entityKey, exposing conflict, avoiding arbitrary winner.
- **Option C** newest-wins by `observedReceiptMs`/`lastContactEpochMs` — requires cross-provider timestamp trust, imports I3 semantics.
- **Option D** adapter retains `sourceLayer` context outside normalized record and applies explicit policy documented, not inside entity record.

Owner must decide whether I2c index should be presentation-aware (respect active layer) or presentation-agnostic (pure data), and whether to allow dual records per entityKey or enforce single winner.

Additionally, TIS-B `~` identifiers remain outside canonical `aircraft:icao24` (entityKey null) per I2a strict 6-hex — owner decision needed if separate namespace `aircraft:tisb:<id>` desired before I2c.

**End of I2b Review — Independent stores clarified, overlap lifecycle traced, accessor semantics store-owned not global, same entityKey != interchangeable payloads, altitude verified barometric MSL, test claim corrected, no I2c implemented, owner decision required for I2c reconciliation.**

---

## 25. I2c IMPLEMENTED — Canonical Current-State Record Index (Final Review)

**Date:** 2026-09-18  
**Checkpoint:** I2c — CANONICAL CURRENT-STATE RECORD INDEX — FINAL CONTRACT REVIEW  
**Status:** IMPLEMENTED, minimized API, awaiting owner approval. I3 NOT implemented, I9 NOT implemented, D9 NOT implemented, I1 NOT reopened. No additional domains, no new consumers wired.

### Final minimized public API

Module: `src/data/recordIndex.js` — zero-dependency, no Cesium, no DOM, no analystProviders, no UI, no lifecycle, deterministic, stateless.

```js
import { buildRecordIndex } from './recordIndex.js'

buildRecordIndex(collections) -> RecordIndex
  collections: Array<{storeId: 'flights'|'military', records: Array<I2b normalized>}>
  Valid storeId: 'flights' | 'military' — GEV current-record STORE ORIGIN, not provider.
  Throws TypeError if collections not array or storeId invalid.
  Rebuilds fresh index from explicitly eligible current-store collections — old state cannot survive.

RecordIndex (frozen):
  get(entityKey) -> {entityKey, records: [{storeId, record}]} | undefined — fresh copy
  has(entityKey) -> boolean — O(1) existence without allocation
  size -> number — canonical entities count
  values() -> Array<{entityKey, records}> — deterministic sorted entityKey asc, each fresh copy, inner storeId alphabetical flights before military
```

No `keys()`, no `_contributingStores()`, no `buildAircraftRecordIndex()`, no `STORE_ID` export, no parse/equal/history/diff/subscribe.

### APIs removed and why

| API | Production consumer | Test-only consumer | Why removed |
|---|---|---|---|
| `buildAircraftRecordIndex({flightsRecords,militaryRecords})` | none | 1 test | Convenience wrapper that unions arrays without lifecycle eligibility — misleading, implies authoritative current aircraft state while cannot distinguish CURRENT military records from retained disabled cache. Creates footgun. Removed per Option A: keep pure builder over explicitly eligible collections. |
| `STORE_ID` export | none | tests used constants | Bounded identifiers still enforced internally via `VALID_STORE_IDS Set{'flights','military'}`, but export not needed for core. Valid strings documented in JSDoc. Removes speculative constant export when no production consumer. |
| `keys()` | none | 1 test (deterministic enumeration) | Convenience — derivable from `values().map(v=>v.entityKey)`. Not needed for minimal contract. |
| `_contributingStores()` | none | none (not used) | Leading-underscore method on public object suspicious — debug only, not needed. Removed. |

Kept `has()` because O(1) existence check without allocating copy via `get()`. Kept `size` for count without enumeration. Kept `get` and `values` as core.

### Whether buildAircraftRecordIndex remains and why

**Removed.** Reason: disabled-store footgun. Wrapper took `{flightsRecords, militaryRecords}` and unioned without eligibility info. Both `flights.getCurrentEntities()` and `military.getCurrentEntities()` can expose retained disabled cache (see lifecycle below). Wrapper's name implied authoritative current aircraft state but had no way to distinguish current vs retained cache. Cleanest boundary: remove wrapper, keep `recordIndex` as pure builder over explicitly eligible current-store collections. Future adapter can explicitly filter eligibility before calling `buildRecordIndex`. No lifecycle import into core, no visibility authority, no global singleton.

### Exact eligibility boundary

**LAYER / ADAPTER owns eligibility, RECORD INDEX owns indexing.**

- **Layer/Adapter:** Determines whether its feed/store is actively current — e.g., `LayerLifecycle.isEnabled(layerId)` && `lifecycleState==='enabled'`. Only if actively ingesting/current, call `getCurrentEntities()` and include its array in collections passed to `buildRecordIndex`.
- **Record Index:** Indexes explicitly supplied eligible current records only. Never infers freshness from payloads (`observedReceiptMs`, `lastContactEpochMs`, `positionTimeMs`), never checks `billboardCollection.show`, never imports `lifecycle.js`, never makes visibility epistemic authority. Input-agnostic: builds from whatever collections are passed, fails safe on null/malformed.

Fits actual GEV architecture: `LayerLifecycle` owns enabled/disabled, periodic refresh `_runPeriodicUpdate` only when `enabled && lifecycleState==='enabled'`, interval management, `_invalidateRefresh`. Layers own `FlightRecords.data` Map. Adapter (future dataManager or explicit caller) checks lifecycle enabled before gathering records. Index remains pure.

### Flights disabled lifecycle (traced)

From `src/layers/flights/lifecycle.js`:

- `disable(viewer)`: `parts.controller._abortActiveUpdates()` aborts active fetch controllers, `_cancelPendingTrackingRestore()`, `billboardCollection.show=false`, `releaseContinuousRender('flights')`, `_releaseModels()`, `modelCollection.show=false`, `_clearTracking()`, `_destroyTrail()`, destroys click handler, removes `trackedEntityChanged` listener, `removeEventListener('keydown')`, `unregisterPickOwner('flights')`, clears `preRender`, `trackedModelPreUpdate`, `moveEnd` listeners.
- **Does NOT clear `records.data` Map.** Only `destroy()` clears `records.data.clear()`.
- `LayerLifecycle` disable path: `_invalidateRefresh(layerId, entry, 'layer-disabled')` invalidates refresh epoch, clears `intervalId`, sets `enabled=false`, `lifecycleState='disabled'`.

**Therefore flights.disable() leaves `FlightRecords.data` populated as retained stale cache, stops ingestion (interval cleared, refresh invalidated). `getCurrentEntities()` can expose retained disabled cache.**

### Military disabled lifecycle (traced)

From `src/layers/military/lifecycle.js`:

- `disable(viewer)`: same pattern — `_abortActiveUpdates()`, `_cancelPendingTrackingRestore()`, `billboardCollection.show=false`, `releaseContinuousRender('military')`, `_releaseModels()`, `modelCollection.show=false`, `_clearTracking()`, `_destroyTrail()`, destroys click handler, removes listeners, `unregisterPickOwner('military')`, `setMilitaryLayerActive(false)`, clears preRender listeners.
- **Does NOT clear `records.data` Map.** Only `destroy()` clears.
- `LayerLifecycle` same invalidation.

**Therefore military.disable() leaves `MilitaryFlightRecords.data` populated as retained stale cache, stops ingestion.**

### Whether either disabled store can expose retained records

**Yes — BOTH.** Flights and military disable retain `data` Map. So `flights.getCurrentEntities()` and `military.getCurrentEntities()` can both return retained disabled cache that is no longer actively refreshed.

**Generic rule:** Store-owned `getCurrentEntities()` represents store's retained current-record model (what store currently holds after sticky merge and missing-poll eviction), but **eligibility to contribute to GLOBAL current index depends on whether that store is actively ingesting/current**. Do not call retained disabled cache globally current.

Adapter must filter: `isEnabled('flights') ? flights.getCurrentEntities() : []`, same for military, before `buildRecordIndex`.

### Exact storeId semantics

- `storeId` means **GEV current-record STORE ORIGIN** — which `FlightRecords` instance (flights or military) currently owns the record.
- Not provider (`OpenSky` vs `adsb.lol`), not provenance, not entity type, not layer identity baked into `entityKey`, not source reliability.
- Example: `flights` store itself contains observations merged from OpenSky + adsb.lol via sticky merge in `FlightRecords.receive()`. Provider is observation identity (I3 concern), storeId is current-record store origin (I2 concern). `military` store similarly merges but from adsb.lol only currently.
- `storeId` is kept OUTSIDE normalized record as `{storeId, record}` to preserve separation: store origin ≠ entity identity, ≠ provenance. I3 will later handle observation/provider provenance.

### Exact malformed entityKey trust/validation contract

**Trust boundary:**

- **Trusted producers:** I2b accessors `flights.getCurrentEntities()` and `military.getCurrentEntities()` call `aircraft(icao24)` which validates strict 6-hex and returns canonical `aircraft:icao24:<6-hex>` or null. So by contract they only produce canonical keys or null.
- **Core defensive validation:** `recordIndex` validates canonical form `aircraft:icao24:<6-hex lowercased>` via local regex `/^[0-9a-f]{6}$/` with prefix check, to fail safely on malformed inputs like `"banana"`, `"foo:bar"`, `"aircraft:icao24:zzzzzz"` (non-hex), `"aircraft:icao24:ABC123"` (uppercase). Malformed excluded, does NOT enter index, size unchanged, no throw (except invalid storeId or collections not array which throw TypeError).
- **Why not duplicate full entityKey API:** I2a currently exports only `aircraft()`, not `isValid` or `parse` (minimized). I2c needs defensive check to avoid `"banana"` entering canonical index if someone bypasses I2b. Smallest evidence-supported boundary: local regex mirroring I2a canonical rule, not generic parser, not duplicating full API. Documented as defensive.
- **Result:** `entityKey:null` excluded, `"banana"` excluded, `"foo:bar"` excluded, `"aircraft:icao24:abc123"` accepted, `"aircraft:icao24:a1b2c3"` accepted, uppercase rejected (since I2b always lowercases).

### Exact copy-safety contract

- **I2b normalized record contract is primitive-only:** `{entityKey:string|null, icao24:string, lat:number|null, lon:number|null, altitudeM:number|null, callsign:string|null}` — all primitives, no nested objects, no arrays, no Cartesian3.
- **Shallow copy sufficient TODAY:** `copyRecord` does shallow copy of those 6 primitives. Documented as safe because I2b contract is primitive-only. Do NOT imply generic deep-clone safety for future nested records. If future I2b adds nested fields, copy strategy must be revisited.
- **Build-time copy + output-time copy:** Inputs shallow-copied into internal `byStore Map`, `get()` returns fresh object with fresh `records` array and fresh record copies, `values()` returns fresh array of fresh copies. Mutating returned does not corrupt future lookups — proven by test.

### Architecture check decision

**No new static `check-identity-authority.mjs` script added.**

- Existing checks: `check-spatial-authority.mjs`, `check-import-directions.mjs`, `check-package-boundaries.mjs` run via `check:boundaries`.
- Current invariants already enforced via unit tests in `recordIndex.test.mjs`: no `from 'cesium'`, no `Cartesian3`, no `getAnalystRecords`/`getAllPositions`, no `document.`/`window.`, no `_viewer`, no `lifecycle` import, no `billboardCollection.show`, no `isMilitaryLayerActive`, no timestamp winner strings.
- Module is zero-dependency except `entityKey.js` import — verified by file content.
- Adding a small regex checker would follow conventions cleanly, but tests already cover same invariants and are run in CI via `node --test`. To avoid giant regex policy checker and extra maintenance, defer static check until multi-domain expansion justifies it. Documented as tests sufficient for aircraft-only checkpoint.

### Files changed in final review

- `src/data/recordIndex.js` — minimized: removed `STORE_ID` export, removed `buildAircraftRecordIndex`, removed `keys()` and `_contributingStores()`, kept `buildRecordIndex` with `get/has/size/values`, added strict canonical validation `aircraft:icao24:<6-hex>` to prevent `"banana"` entering, documented eligibility ownership (layer/adapter vs index), documented generic disabled-retained-cache rule for both flights and military, documented storeId semantics (store origin not provider), documented copy-safety primitive-only boundary, zero-dependency maintained.
- `src/data/recordIndex.test.mjs` — updated to minimized API: uses literal storeIds, removed `STORE_ID` and `buildAircraftRecordIndex` tests, removed `keys()` usage, added malformed `"banana"`/`"foo:bar"`/`"aircraft:icao24:zzzzzz"`/uppercase tests, added eligibility tests (adapter excludes disabled, retained cache not globally current), added storeId semantics test (store origin not provider, last-wins within same store), added final API surface minimal test, adjusted DOM/lifecycle checks to allow comment mentions but forbid actual imports/calls.
- `docs/planning/I2-PRE-IMPLEMENTATION-REPORT.md` — Section 25 rewritten to final review with minimized API, removed APIs table, disabled footgun analysis, eligibility boundary, flights+military disabled lifecycle traces, storeId semantics, malformed trust boundary, copy-safety boundary, architecture check decision.

### Tests / results

- `node --test src/data/recordIndex.test.mjs src/data/currentEntities.test.mjs src/data/entityKey.test.mjs` — **44 pass, 0 fail** (8 I2a + 12 I2b + 24 I2c final).
- I2c 24 tests covering: one entity, same key two stores, different payloads preserved, order not winner, null excluded, TIS-B outside, malformed safe including `"banana"` and `"foo:bar"` and non-hex and uppercase, different keys separate, rebuild removes entities, rebuild removes store record preserves other, no history, no diff/events, mutation safety primitive-only, deterministic enumeration, I2a still works, no getAnalystRecords, no Cesium, no DOM/UI/lifecycle/billboard/isMilitaryLayerActive, no timestamp winner, visibility does not select payload eligibility owned by adapter, storeId is store origin not provider, eligibility retained disabled cache not globally current, performance 11k <500ms (~33ms), final API surface minimal.

### Confirmations

- **No I3 provenance:** No `observedAt`/`staleAt`/`accuracyM`/provenance chains, no timestamp winner logic — verified via file content checks.
- **No I9 transitions/history:** No DEPARTED/UPDATED/APPEARED/ENTERED_SCOPE/EXITED_SCOPE, no trajectories, no history retained, no diff events.
- **No D9:** `getNearby` still `Cartesian3.distance` slant in flights/military, no `slantDistanceM`, `geo.js` untouched.
- **No additional domains:** Only `aircraft:icao24` via I2a, no `vessel:mmsi`, `satellite:norad`, etc., no `aircraft:tisb:` namespace.
- **No new consumers wired:** No analyst, awareness, cockpit, selection, watchlists, AOIs, share links modified.

### Whether any unresolved issue still blocks I2c approval

**No blocking issue.**

- Disabled-store footgun resolved by removing `buildAircraftRecordIndex` wrapper and documenting eligibility ownership: adapter must filter by `isEnabled`/`lifecycleState`, not core. Both flights and military retain data when disabled but stop ingestion — generic rule documented, tests prove adapter exclusion.
- Malformed `"banana"` prevented by strict canonical validation `aircraft:icao24:<6-hex>`.
- StoreId semantics clarified as store origin, not provider — example flights merging OpenSky+adsb.lol but storeId remains `flights`.
- Copy-safety documented as primitive-only shallow copy sufficient today.
- Architecture check decision explicit: tests sufficient, no new static script needed for aircraft-only checkpoint.
- Multi-record-per-entity design accepted and preserved without arbitrary winner.

**I2c ready for owner approval as minimal current-state index: one entry per canonical entityKey, multiple current store records per entity, no winner, canonical-only, rebuild model, deterministic ordering, copy-safe primitive-only, bounded storeIds flights/military validated internally, eligibility owned by layer/adapter, disabled retained cache not globally current.**

**End of I2c FINAL REVIEW — minimized API `buildRecordIndex` only with `get/has/size/values`, removed `buildAircraftRecordIndex`/`STORE_ID`/`keys()`/`_contributingStores()`, eligibility layer/adapter vs index, flights+military disable retain data but stop ingestion, storeId is store origin not provider, malformed trust boundary strict canonical, copy-safety primitive-only, no I3/I9/D9/additional domains, 24 tests passing.**










---

## 26. I2d IMPLEMENTED — Vessel / MMSI Canonical Identity + Current-State Index Integration

**Date:** 2026-09-18
**Checkpoint:** I2d — FINAL controlled I2 expansion before I3 — VESSELS ONLY
**Status:** IMPLEMENTED, awaiting owner review. I3 NOT implemented, D9 NOT implemented, I1 NOT reopened. No other domains added.

### Owner decisions accepted for I2d

1. Vessels as ONE second canonical entity domain before I3.
2. Canonical vessel identity: `vessel:mmsi:<9-digit-mmsi>` example `vessel:mmsi:123456789`.
3. Canonical MMSI grammar: exactly 9 decimal digits `/^\d{9}$/` after safe string normalization/trim.
4. Invalid/noncanonical vessel identifiers: entityKey null, no invented identity, no fallback/session/synthetic.
5. Vessel recordIndex storeId: `vessels` NOT `ais-live-vessels` — storeId describes GEV current-record STORE ORIGIN, not provider identity. Provider/source belongs I3.
6. Canonical key validation authority moved to `src/data/entityKey.js`, recordIndex no longer contains aircraft-only grammar.
7. Add only narrow canonical-key validator: `isValid(key)` — chosen over `isValidCanonical` for preferred conceptual API. No parse/equal/generic create/DOMAIN/KIND/default export/registry.
8. TIS-B/non-ICAO remains deferred.
9. Event/detection domains remain outside recordIndex.
10. Infrastructure domains remain deferred.
11. Architecture check evaluated AFTER second-domain implementation.

### Purpose

Prove I2 substrate works naturally for AIRCRAFT + VESSELS without redesign:
- second semantic entity domain
- second native identifier grammar (9-digit numeric vs 6-hex)
- single-store canonical entities (vessels) vs multi-store (aircraft flights+military)
- general canonical-key validation authority
- expanded bounded store origin
- uncapped current-state accessor outside aviation

If vessels required major recordIndex redesign, STOP and report — did NOT occur, fits naturally.

### 1. Vessel model trace — actual findings

**Files inspected:**
- `src/layers/vessels/records.js` — `normalizeVessel(row)` lat/lon finite check, `mmsi: String(row.mmsi || '').trim()`, name fallback, imo/type/destination string, speed/course/heading finiteNumber, lastPositionUtc/Epoch, missedRefreshes.
- `src/layers/vessels/state.js` — `VesselRecords` instance `byMmsi Map`, `unkeyed []`, `all []`, `now` injectable.
- `src/layers/vessels/ingestion.js` — `vesselDisplayRow` maps live source `record.id` (string) to `mmsi`, speedMps to knots `/0.514444`, course/heading, last_position_epoch/UTC.
- `src/sources/live/vessels.js` — `normalizeVesselObservation` id `String(row?.mmsi || row?.input_identifier || '').trim()`, latitude/longitude finite, speedKts finite, reference.
- `src/layers/vessels/lifecycle.js` — `enable` sets enabled true, begins session, holds render, ensures collections, geoid warm, registers pick owner. `disable` sets enabled false, invalidates session, releases render, hides collection, clears overlay, clears inspection, destroys trail, aborts. Does NOT clear `byMmsi`, `unkeyed`, `all` — retains stale cache. `resetState` (destroy) DOES clear Maps.
- `src/layers/vessels/queries.js` — `mapAnalystRecord`, `getAllPositions` capped 800, `getAnalystRecords` capped 2000, `getNearby` uses `Cartesian3.distance` slant (D9 pending), `hasContact` returns null when disabled or empty, `findByQuery`, `getDetectableObjects`, `getStats`.

**Authoritative current vessel store:** `VesselRecords` with `byMmsi Map<string, record>` + `unkeyed []` + `all []`. Owner `vesselState.state.records`.

**Exact MMSI field representation:** Always string trimmed — `String(row.mmsi || '').trim()` in both `normalizeVessel` and live source normalization. Evidence supports string contract preserving leading zeros.

**Unkeyed vessel handling:** If `next.mmsi` falsy (empty string) after normalization, goes to `unkeyed` array via `effects.add`, not in `byMmsi`. `unkeyed` cleared each reconcile, rebuilt. `all = [...byMmsi.values(), ...unkeyed]` — current records but without canonical identity, still displayed.

**Normalization currently performed:** lat/lon finite, mmsi string trim, name fallback to mmsi or 'VESSEL', imo/type/destination string, speed/course/heading finiteNumber, lastPositionUtc string, lastPositionEpoch finiteNumber.

**Simulated/fallback vessels:** No simulated, no fallback identity. Unkeyed is only non-canonical path.

**Non-9-digit values in current store:** Production MMSI is 9-digit per ITU, but `VesselRecords` permissive check allows any non-empty string as keyed (test uses '111','222'). Actual feed should be 9-digit, but store may contain non-9-digit if provider sends malformed — handled as canonical-invalid.

**Coordinate fields:** `lat`, `lon` Number finite.

**Speed/course/name/type fields:** `speed` knots (converted from mps in ingestion), `course`, `heading`, `name`, `type`, `destination`, `imo`.

**Lifecycle/eviction semantics:** `reconcile(rows, {complete, selectedRecord, cap})` — seen Set dedup, updates existing via `beforeUpdate`/`updated`, retains if `!complete && <PARTIAL_RETENTION_MS`, pins selected for `SELECTED_PIN_REFRESHES` complete misses, removes via `effects.remove` + `removed`, cap eviction preserves seen and selected.

**Disable behavior:** Retains `byMmsi` and `unkeyed` and `all` — stale cache, stops ingestion.

**Ingestion stops when disabled:** `loadLivePositions` checks `feed.loading`, `ownsAisRequest` checks `feed.enabled`, lifecycle `disable` sets enabled false and aborts.

**Existing caps:** `getAllPositions` capped 800, `getAnalystRecords` capped 2000, `getNearby` capped 25, `all` uncapped.

### 2. Entity identity authority — final API

Module `src/data/entityKey.js` — zero-dep, no Cesium/DOM/network, deterministic, stateless.

```js
export function aircraft(icao24) -> string|null
  Canonical: aircraft:icao24:<6 hex lowercase>
  Trim + lowercase + exactly 6 hex, null if invalid.

export function vessel(mmsi) -> string|null
  Canonical: vessel:mmsi:<9 decimal digits>
  Trim + exactly 9 digits, preserves leading-zero string, no zero-padding, null if invalid.
  Numeric input accepted only if String(value) is exactly 9 digits — no manufacture.

export function isValid(key) -> boolean
  Is this currently supported canonical GEV entityKey?
  Supported: aircraft:icao24:<6 hex lower> OR vessel:mmsi:<9 digits>
  Canonical representation only — no normalization, whitespace, uppercase rejected.
```

No `parse`, `equal`, `create`, `DOMAIN`, `KIND`, default export, registry.

### 3. MMSI normalization/validation contract

**Input contract evidence-supported:** Actual GEV vessel records use strings — `String(row.mmsi).trim()`. Prefer string, but accept finite number that stringifies to 9 digits.

- `cleanString(value)`: if string trim, if finite number String(value).trim(), else ''.
- `normalizeMmsi(value)`: raw = cleanString(value), if !raw null, if !/^\d{9}$/ null, else raw.
- Preserves leading zero if input string "012345678" → "012345678" valid.
- No automatic zero-padding: numeric 12345678 (8 digits) → "12345678" → null, not padded to "012345678". String "12345678" → null.
- No digit manufacture.

**Validation:** `/^\d{9}$/` after trim. Letters rejected, too short/long rejected, missing/empty rejected.

**Numeric vs string behavior:**
- String "123456789" → `vessel:mmsi:123456789`
- String "012345678" → `vessel:mmsi:012345678` (leading zero preserved)
- Number 123456789 → "123456789" → valid
- Number 12345678 → "12345678" → null (no padding, would lose leading zero)
- Number 0, NaN, Infinity → null
- This matches GEV source representation is STRING, so leading-zero meaningful.

### 4. Canonical vessel key format

`vessel:mmsi:<9-digit>`

Example: `vessel:mmsi:123456789`, `vessel:mmsi:012345678`

Delimiter `:` safe — MMSI grammar digits only, no colon.

### 5. Canonical-key validation design

Narrow validator `isValid(key)` in `entityKey.js`:

```js
AIRCRAFT_PREFIX = 'aircraft:icao24:'
VESSEL_PREFIX = 'vessel:mmsi:'
ICAO24_HEX = /^[0-9a-f]{6}$/
MMSI_9 = /^\d{9}$/

isValid(key):
  if typeof key !== string return false
  if key.startsWith(AIRCRAFT_PREFIX): suffix = slice, test ICAO24_HEX
  if key.startsWith(VESSEL_PREFIX): suffix = slice, test MMSI_9
  else false
```

- Canonical representation only — no trim, no lowercase, no normalization.
- `aircraft:icao24:ABC123` → false (uppercase not canonical)
- ` vessel:mmsi:123456789` → false (whitespace)
- `vessel:mmsi:12345678` → false (8 digits)
- `satellite:norad:12345` → false (unsupported domain)

Constructor normalization (`aircraft()`, `vessel()`) separate from canonical-key validation.

### 6. Confirmation recordIndex no longer knows ICAO/MMSI grammar

`src/data/recordIndex.js` now:

```js
import { isValid as isValidEntityKey } from './entityKey.js'
VALID_STORE_IDS = Set{'flights','military','vessels'}
copyRecord generic primitive-only
```

No `ICAO24_HEX`, no `MMSI_9`, no `/^[0-9a-f]{6}$/`, no `/^\d{9}$/` literal, no hardcoded `aircraft:icao24:` or `vessel:mmsi:` prefix regex. Validation delegated to identity authority.

Proven by `recordIndex.vessels.test.mjs` checks: no `const ICAO24_HEX`, no `const MMSI_9`, no hex regex, no 9-digit regex literal, imports `isValid`.

### 7. Final bounded store IDs

`flights`, `military`, `vessels`

- `flights` = GEV flights current-record store (merges OpenSky + adsb.lol)
- `military` = GEV military current-record store (adsb.lol military)
- `vessels` = GEV vessel current-record store (AISStream)

NOT provider identity: NOT `ais-live-vessels`, NOT `AISStream`. Provider/source semantics belong I3.

Unknown storeId rejected via TypeError.

### 8. Vessel getCurrentEntities() API

Location `src/layers/vessels/queries.js` methods.

```js
getCurrentEntities() -> Array<{
  entityKey: string|null, // canonical vessel:mmsi:<9-digit> or null for unkeyed/malformed
  mmsi: string|null,      // native identifier trimmed or null if empty
  lat: number|null,
  lon: number|null,
  name: string|null,
  speedKts: number|null,  // record.speed knots
  courseDeg: number|null  // record.course
}>
```

Properties:
- Uncapped — iterates `state.records.all` (byMmsi + unkeyed), no max, O(n)
- Deterministic — `all` insertion order deterministic for same store state
- Side-effect free — fresh array and fresh plain objects per call, no Cesium, no billboard, no camera
- On-demand — not per-frame, no listeners
- Plain/copy-safe — primitives only, no nested, mutation does not mutate storage
- Current-state only — no history, rebuild removes missing
- Coordinate authority — `record.lat/lon` from current record model, not `billboard.position`
- Independent of D9 — no distance, no geo.js, no slant/surface
- Independent of getNearby/getAllPositions/getAnalystRecords

### 9. Exact vessel normalized record shape

Minimum useful, no provenance:

- `entityKey`: canonical or null
- `mmsi`: native identifier trimmed string or null
- `lat`: number|null from record.lat
- `lon`: number|null from record.lon
- `name`: string|null from record.name trimmed
- `speedKts`: number|null from record.speed (knots)
- `courseDeg`: number|null from record.course

Potential ship type/class NOT added — not necessary for I2d, per owner "Do NOT add fields merely for symmetry."

No `observedAt`, `staleAt`, `accuracyM`, `provider`, `provenance`, `source reliability`, `history`, `previous position`, `trajectory`, `event/change state`, `coverage`, `watchlist state`, `AI interpretation`.

Primitive-only, so existing recordIndex shallow-copy contract remains valid (generic primitive copy).

### 10. MMSI field semantics

Current GEV model field `mmsi` actually represents MMSI (Maritime Mobile Service Identity) 9-digit, not broader provider identifier. Verified via `normalizeVesselObservation` id = mmsi, `vesselDisplayRow` mmsi = record.id.

### 11. Unkeyed/malformed vessel behavior

**Unkeyed:** `mmsi == ''` after trim → goes to `unkeyed []`, still in `all`, displayed, current record but no canonical identity.

**Malformed:** Non-9-digit non-empty string e.g., '111' → goes to `byMmsi` Map due to permissive existing VesselRecords check, but canonical invalid.

**getCurrentEntities() behavior — Option B chosen:** Expose BOTH canonical and unkeyed current vessel records, with unkeyed/malformed carrying `entityKey:null`.

Rationale per I2b precedent: flights `getCurrentEntities()` exposes TIS-B with entityKey null, while recordIndex indexes only canonical. Same for vessels.

- Valid 9-digit MMSI → entityKey `vessel:mmsi:<9-digit>`
- Invalid short/long/letters → entityKey null
- Unkeyed empty → entityKey null, mmsi null

No invented identity: no `vessel:unknown:`, `vessel:aisstream:`, `session:`, `synthetic:`.

**RecordIndex:** Canonical-only — only records with valid entityKey enter index, null excluded. So unkeyed/malformed remain available from accessor but outside canonical index.

### 12. Coordinate authority

`lat/lon` from current record model `record.lat`, `record.lon` — stored geographic coordinates from AIS, not mutable Cesium `billboard.position`, not camera-relative, not getNearby.

Verified: `getCurrentEntities` does not call `components.rendering.getVisual`, does not use `Cartesian3`.

### 13. Disabled vessel retained-data behavior

Traced from `src/layers/vessels/lifecycle.js`:

- `disable()`: sets `enabled false`, invalidates session, releases render, hides collection, clears overlay, clears inspection, destroys trail, aborts. Does NOT clear `byMmsi`, `unkeyed`, `all`.
- `resetState()` (destroy): DOES clear Maps.

**Therefore vessels.disable() leaves records populated as retained stale cache, stops ingestion.** Same pattern as flights/military disable.

**Generic rule documented:** Store-owned `getCurrentEntities()` represents store's retained current-record model, but eligibility to contribute to GLOBAL current index depends on whether that store is actively ingesting/current (feed.enabled). Do not call retained disabled cache globally current.

Adapter must filter: `isEnabled('vessels') ? vessels.getCurrentEntities() : []` before `buildRecordIndex`.

### 14. Global eligibility boundary

**STORE ACCESSOR = retained current-record model owned by store**

**GLOBAL INDEX ELIGIBILITY = determined externally by active/ingesting lifecycle**

- RecordIndex never inspects visibility, never imports lifecycle, never uses `billboard.show`.
- Documented alongside aircraft in recordIndex.js JSDoc.

### 15. How vessel fits existing recordIndex without redesign

Canonical vessel fits naturally:

```
vessel:mmsi:123456789
  |
  +-- vessels current record (single-store)
```

- Same generic entry structure `{entityKey, byStore: Map<storeId, record>}` works for both aircraft (multi-store) and vessel (single-store).
- No vessel-specific payload logic necessary.
- Deterministic enumeration across `aircraft:...` and `vessel:...` via sortedKeys asc.
- No winner, no history, no diff.
- Copy safety remains valid because vessel records primitive-only.

**If recordIndex required structural redesign to accommodate simple single-store domain, would STOP and report abstraction flaw — did NOT occur, proves architecture general.**

### 16. Copy-safety result

- Vessel normalized records primitive-only: `entityKey`, `mmsi`, `lat`, `lon`, `name`, `speedKts`, `courseDeg` — all string/number/null.
- Existing recordIndex shallow-copy contract remains valid — now generic primitive-only copy that preserves both aircraft and vessel fields without domain-specific branches, skips non-primitive.
- No generic deep cloning introduced.
- If actual necessary vessel fields introduced nested objects/arrays, would STOP and evaluate — did not occur.

### 17. Tests added

**Entity identity — `src/data/entityKey.test.mjs` extended 8 → 22 tests:**

- vessel canonical identity exact 9 digits
- whitespace normalization deliberate
- exactly 9 digits required
- letters rejected
- too short/long rejected
- missing/empty rejected
- leading-zero STRING preserved
- no automatic zero-padding (numeric 8-digit null, numeric 9-digit valid, numeric losing leading zero rejected)
- aircraft behavior remains unchanged
- isValid accepts canonical aircraft key
- isValid accepts canonical vessel key
- isValid rejects uppercase/noncanonical aircraft key
- isValid rejects malformed vessel key
- isValid rejects unsupported domains

All 22 pass.

**Vessel current accessor — `src/layers/vessels/getCurrentEntities.test.mjs` new 13 tests:**

- uncapped beyond analyst/position cap (2500 > 2000, >800)
- every eligible current stored vessel represented
- valid MMSI gets correct entityKey
- malformed/unkeyed does not get invented canonical identity (no synthetic)
- coordinates from current record model not Cesium
- plain/primitive-only
- mutation does not mutate storage
- repeated calls no side effects (deepEqual but fresh references)
- no history accumulation (reconcile removes old)
- queries.js contains getCurrentEntities and uses vesselEntityKey and state.records.all
- getAnalystRecords cap/output unchanged (file content check)
- getAllPositions behavior unchanged (capped 800)
- getNearby behavior unchanged (still Cartesian3.distance, D9 untouched)

All 13 pass.

**Multi-domain recordIndex — `src/data/recordIndex.vessels.test.mjs` new 14 tests:**

- aircraft + vessel coexist in one index
- recordIndex has no domain-specific ICAO/MMSI grammar (no ICAO24_HEX/MMSI_9 defs, no regex literals, imports isValid)
- validation delegated to entityKey authority
- vessel single-store record fits same entry shape
- aircraft two-store behavior remains unchanged
- malformed vessel key excluded
- null entityKey excluded
- deterministic ordering across aircraft and vessel (sorted asc, aircraft < vessel)
- rebuild removes missing vessels
- no history/diff
- copy safety remains valid
- storeId vessels accepted
- unknown storeId rejected (ais-live-vessels, AISStream, vessel)
- no provider identity encoded into storeId (VALID_STORE_IDS only flights,military,vessels)

All 14 pass.

**Existing tests still green:**

- `src/data/recordIndex.test.mjs` 24 tests — all pass (aircraft behavior unchanged, copy safety generic still works)
- `src/layers/vessels/records.test.mjs` 4 tests — pass
- `src/data/currentEntities.test.mjs` 12 tests — pass (flights/military accessor still works)
- `src/data/entityKey.test.mjs` 22 tests — pass
- Total I2 related: 22 + 13 + 14 + 24 + 12 + 4 = 89 tests pass.

### 18. Architecture check added

**New script `scripts/check-identity-authority.mjs` — SMALL enforceable invariants:**

- recordIndex must not import Cesium
- recordIndex must not import UI/app
- recordIndex must not import analyst-specific accessors (getAnalystRecords/getAllPositions)
- recordIndex must not import lifecycle
- recordIndex canonical validation comes from entityKey authority (imports isValid from entityKey.js)
- recordIndex must not define its own ICAO/MMSI grammar
- recordIndex must not contain obvious history state fields (this.history, _history, previousPosition)
- entityKey must not import Cesium, must not use DOM (document./window.), must not use network (fetch/XMLHttpRequest)
- entityKey must export aircraft, vessel, isValid, must not export oversized DOMAIN or parser
- current entity accessors must not route through getAnalystRecords (checks flights/military/vessels queries.js getCurrentEntities snippet)
- VALID_STORE_IDS must include flights,military,vessels

Run: `node scripts/check-identity-authority.mjs` → **OK**.

Existing `check-spatial-authority.mjs` still green — D9 untouched.

No giant brittle regex checker, no policing every future identifier/domain — minimal freeze.

### 19. Documentation changed

- `src/data/entityKey.js` — extended with vessel(mmsi) + isValid(key), MMSI grammar, leading-zero preservation, no padding, narrow validator.
- `src/data/recordIndex.js` — removed local aircraft-specific regex, now imports isValid from entityKey, extended VALID_STORE_IDS to include vessels, generic primitive-only copyRecord, updated JSDoc with vessels lifecycle and storeId semantics (vessels means GEV store not AISStream provider).
- `src/layers/vessels/queries.js` — added import vesselEntityKey, added getCurrentEntities() with full JSDoc documenting store-owned semantics, unkeyed handling Option B, coordinate authority, disabled eligibility, minimal shape.
- `scripts/check-identity-authority.mjs` — new architecture check.
- `docs/planning/I2-PRE-IMPLEMENTATION-REPORT.md` — appended Section 26 with all required fields, plus this update.

MASTER-PLAN / REFERENCE / PRE-AUDIT surgical updates: No material false statements found requiring change — MASTER-PLAN I2 definition "Every family declares its identity fields; one identity function shared by engine and awareness" now partially true for aircraft+vessels, still not every family but roadmap sequence preserved and I2d is controlled expansion before I3, so no contradiction requiring rewrite. D9 dual semantics preserved. No rewrite of roadmap.

### 20. Confirmation D9 untouched

- `grep -n Cartesian3.distance src/layers/vessels/queries.js` — still present in getNearby.
- `grep -n distanceM src/data/geo.js` — unchanged.
- No `slantDistanceM` added to records.
- No eager/lazy slant decision.
- `getNearby` signature unchanged, sorting unchanged, radius behavior unchanged.
- `src/data/geo.js` untouched.

### 21. Confirmation I3 untouched

- No `observedAt`, `staleAt`, `accuracyM`, `provider`, `provenance`, `source reliability`, `coverage`, `watchlist state`, `AI interpretation` added to vessel accessor or recordIndex.
- No provenance chains.
- No observationKey.
- `isValid` is canonical validation only, not provenance.

### 22. Confirmation TIS-B namespace still deferred

- `aircraft:icao24:~abc123` still invalid → null, isValid false.
- No `aircraft:tisb:` namespace invented.
- Tests still prove TIS-B outside canonical index.

### 23. Confirmation no other entity domains added

- Only `vessel:mmsi` added, not satellite, CCTV, ALPR, installations, bikeshare, earthquakes, FIRMS, launches, traffic, cables, radio.
- `VALID_STORE_IDS` only flights,military,vessels — no other layer names.
- No other getCurrentEntities added.

### 24. Whether I2 general-purpose substrate can now be considered COMPLETE

**Yes — I2 GENERAL-PURPOSE SUBSTRATE: COMPLETE.**

Evidence:
- At least two semantic entity domains: aircraft + vessel
- At least two native identity grammars: 6-hex lowercase vs 9-digit numeric
- Multi-store case: aircraft flights+military (two records per entity, no winner)
- Single-store case: vessel vessels (one record per entity, fits same entry shape without redesign)
- Canonical validation centralized: entityKey.js isValid is sole authority, recordIndex delegates, no domain-specific branches
- Current accessors uncapped: flights, military, vessels all have getCurrentEntities uncapped, deterministic, side-effect free, plain/copy-safe, current-state only
- Canonical index multi-domain: buildRecordIndex handles aircraft and vessel keys coexisting, deterministic ordering across domains, rebuild removes missing, no history/diff, copy safety preserved
- No history/provenance contamination: recordIndex no history, no trajectory, no observedAt, no provider, no coverage — verified by architecture check

This does NOT mean every GEV domain indexed — only aircraft and vessels. Does NOT mean analyst/awareness consumer adoption complete — substrate vs adoption distinction preserved.

### 25. Whether next milestone should now be I3

**Yes — recommend proceeding to I3 Provenance/Epistemic Typing.**

I2d proves substrate generalizes beyond aircraft without redesign. Second domain forces validation authority generalization and tests single-store case — maximum learning/min cost. No further I2 expansion needed before I3. I3 can now build on multi-domain substrate with two distinct source types (ADS-B vs AIS) to test provenance across domains.

### 26. Any issue requiring owner decision

- Leading-zero MMSI handling: Implemented as string-preserving, numeric 8-digit rejected (no padding). Owner to confirm this matches product expectation for MMSI with leading zero.
- StoreId naming: `vessels` chosen per owner decision, not `ais-live-vessels`. Confirmed.
- isValid API name: Chose `isValid` over `isValidCanonical` per preferred conceptual API. Owner to confirm name acceptable (isValidCanonical more explicit but longer).
- Unkeyed exposure: Chose Option B expose both canonical and unkeyed with entityKey null, per I2b precedent. Owner to confirm this matches desired vessel accessor contract (vs only byMmsi).
- No further I2 expansion needed — owner to approve I2 general-purpose substrate COMPLETE and proceed to I3.

**End of I2d — VESSELS IMPLEMENTED — identity format vessel:mmsi:<9-digit>, MMSI validation exact 9 digits trimmed preserving leading-zero string no padding, entityKey API aircraft+vessel+isValid, canonical validator narrow isValid canonical-only no normalization, recordIndex validation delegated to entityKey no longer knows ICAO/MMSI grammar, bounded storeIds flights/military/vessels, vessel accessor getCurrentEntities uncapped deterministic side-effect free plain/copy-safe current-state only coordinate authority record model not Cesium billboard, unkeyed/malformed entityKey null no invented identity, disabled retained-data behavior same as flights/military (retain Map but stop ingestion), global eligibility boundary store accessor vs adapter, vessel fits existing recordIndex without redesign, copy-safety primitive-only generic, 22+13+14+24 tests passing, architecture check scripts/check-identity-authority.mjs OK, docs updated, D9 untouched, I3 untouched, TIS-B deferred, no other domains, I2 substrate COMPLETE, next I3.**

---

## 27. I3a IMPLEMENTED — Provenance Primitive + Aircraft Position Provenance — SURGICAL DOC CORRECTION

**Date:** 2026-09-18
**Checkpoint:** I3a — minimal provenance primitive + truthful CURRENT aircraft POSITION provenance + sidecar accessor
**Status:** IMPLEMENTED per owner-approved I3a slice. I2 remains closed/complete, D9 untouched, I1 untouched.

### I3a source correction — exact path re-traced

- **Server:** `server/providers/aircraft/opensky.js` — `openSkyProxy` main path does NOT set X-Flight-Source (only X-OpenSky-* headers), `serveAdsbLolPointFallback` (250nm regional fallback when OpenSky stale/unavailable) explicitly sets `X-Flight-Source: adsb.lol` and `X-Flight-Coverage: 250nm regional fallback`.
- **API route:** `/api/opensky` forwards those headers.
- **Client adapter:** `src/sources/live/standalone.js` `createOpenSkySource.getSnapshot` reads `header(response,'x-flight-source')||'OpenSky Network'` and normalizes to stable machine `sourceId`: 'adsb.lol' when header contains adsb, else 'opensky'. Captures single `now()` as `receivedAtMs` per snapshot batch (more truthful than per-aircraft Date.now()).
- **Normalization:** `src/sources/live/aircraft.js` `normalizeOpenSkyAircraft` row[6]/row[5] lat/lon, row[3]=time_position epoch → positionTimeMs, row[4]=last contact. Returns null if !coordinates — so observation always has valid position when admitted.
- **Store:** `src/layers/flights/records.js` `FlightRecords.receive()` previously did NOT receive source identity, used per-aircraft Date.now() as observedReceiptMs inside loop. Now receives {sourceId, receivedAtMs} from snapshotRenderer, stores `positionProvenance Map<icao24, frozen descriptor>` with {epistemic:'reported', sourceId, reportedAtMs=positionTimeMs|null, receivedAtMs}. Follows rawLat/rawLon current fix, remains with retained position when newer observation lacks replacement, switches with value on source switch (opensky→adsb.lol fallback).
- **Sidecar:** `src/layers/flights/queries.js` `getProvenanceMap()` returns Map keyed by native icao24 (lowercased hex, preserves ~ for TIS-B), no synthetic keys, copy-safe, CURRENT only, no history. `getCurrentEntities()` remains I2 primitive-only unchanged, byte/shape compatible.
- **StoreId vs sourceId:** storeId = GEV ownership flights/military/vessels (bounded VALID_STORE_IDS), sourceId = I3 stable machine id opensky/adsb.lol/adsbdb/aisstream etc (no registry, validated ^[a-z0-9._:-]+$ 1..128 no whitespace). Do NOT encode flights==opensky or military==adsb.lol invariant.

### Surgical corrections applied in this I3a slice

- **src/data/recordIndex.js JSDoc:** Corrected stale example "flights store itself contains observations merged from OpenSky + adsb.lol via sticky merge" to accurate fallback description: flights = OpenSky primary with 250nm adsb.lol regional fallback via X-Flight-Source, sticky merge across time within store not simultaneous cross-provider merge, military = adsb.lol, storeId is GEV ownership vs sourceId external origin.
- **This report (I2-PRE-IMPLEMENTATION-REPORT.md):** Corrected executive summary and inventory and key takeaways and concrete examples that previously claimed simultaneous OpenSky+adsb.lol merge in same poll. Now describes fallback model truthfully per traced path. Remaining older sections may still contain phrasing "OpenSky+adsb.lol merge" but should be read as corrected to fallback model per this Section 27 — full file rewrite deferred to avoid giant diff.
- **I3-DESIGN-REDUCTION-ADDENDUM.md:** Header status updated from research-only to I3a IMPLEMENTED, added source correction summary and production changes list, updated confirmation no prod code changed to list I3a minimal changes, updated I2 remains closed with corrected recordIndex comment.

### Confirmations for I3a

- **No full aircraft provenance:** Only position group (rawLat/rawLon) has provenance, not callsign/altitude/etc.
- **No general sticky provenance:** Only position provenance, which always fresh when admitted, but guard retains old when invalid.
- **No vessel/satellite:** Flights only.
- **No I4/I5/I6/I9, no D9:** D9 still Cartesian3.distance slant, no slantDistanceM added, geo.js untouched.
- **No recordIndex behavior change:** Only comment correction, no logic change, still primitive-only copy, still delegates validation to entityKey, still bounded storeIds flights/military/vessels, no provenance import beyond isValid.
- **No entity identity change:** aircraft() still strict 6-hex, vessel() 9-digit, TIS-B entityKey null still deferred.
- **Copy-safe frozen:** Provenance descriptors frozen, getProvenanceMap returns fresh Map and fresh plain objects.
- **Tests:** 11 primitive + 16 position + 7 header = 34 new, plus 89 existing I2 tests still passing, identity/record-index checks still passing.

**End of I3a correction — flights = OpenSky primary with 250nm adsb.lol regional fallback via X-Flight-Source, not simultaneous merge, sticky across time within store, storeId = GEV ownership, sourceId = stable machine id opensky/adsb.lol.**
