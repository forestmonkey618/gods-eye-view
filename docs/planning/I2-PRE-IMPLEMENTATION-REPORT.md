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

- **entityKey must identify ENTITY, not observation or layer.** Repository evidence: `src/layers/flights/snapshotRenderer.js:49-65` suppresses OpenSky duplicate when same ICAO24 is known military and military layer active (`isMilitaryIcao` + `_militaryLayerSuppresses`). Same ICAO24 through OpenSky and adsb.lol is merged into one `FlightRecords.data` entry via sticky merge. Same physical aircraft appears in at most one rendering layer at a time, but identity is aircraft, not layer. Layer membership is presentation, not identity.
- **Namespace must be semantic entity type, not GEV layer id.** `flights` and `military` are both aircraft presentation layers for same entity type aircraft. `aircraft:icao24:abc123` is more correct than `flights:icao24:abc123` / `military:icao24:abc123`. Layer/source membership remains available as metadata in recordIndex, not baked into key.
- **Not every record deserves canonical entityKey.** FIRMS `FIRE-#####` index-based, earthquake `event-<index>` fallback, traffic simulated, transit vehicle transient have no trustworthy stable identity. Forcing them into canonical index invents false stability. They must remain outside canonical entity index or in separate ephemeral observation store.
- **recordIndex must NOT pull from `getAnalystRecords` as primary source.** Those accessors are capped (2000 default, 500/800 for positions), analyst-specific, exist on only 5 layers. Foundational index would silently inherit truncation (11k flights vs 500 cap). Smallest durable approach is new lightweight normalized current-record accessor `getEntitySnapshot()` / `getCurrentEntities()` returning uncapped JSON-safe copies, on-demand, no Cesium types, no live references.
- **Snapshot terminology `asOf` misleading.** Implies historical querying. I2 is current-state-only. Use `assembledAt` / `builtAt` / `indexedAt` for bookkeeping when snapshot assembled, never confused with observation time, source freshness, historical query.
- **Brittle person-shaped key test must be removed.** Product prohibition on named-person search/private-person tracking is real but string-grammar test is unreliable enforcement. Enforcement point is schema enumeration (no person fields in layer schemas), analyst engine field types, ALPR modeling camera hardware not plate data, not I2 key pattern.
- **First implementation scope too broad.** Integrating 6 domains (flights, military, vessels, earthquakes, FIRMS, satellites) is migration marathon. Smallest representative set that proves contract: aircraft only (flights + military sharing same `aircraft:icao24` namespace, proving cross-provider OpenSky+adsb.lol merge and cross-layer suppression) — high-frequency moving, stable canonical, cross-provider/layer issue. Optionally one additional domain to prove namespace (e.g., vessel or satellite) after aircraft proven, but not 6 at once.

**Smallest safe first implementation (revised):** I2a entityKey helper with semantic namespace + I2b new `getEntitySnapshot` accessor audit (measurement only) + I2c recordIndex current-state-only for stable entities only + I2d integration aircraft only (flights + military as same entity type) proving entity vs layer vs observation + I2e arch checks.

---

## 2. CURRENT IDENTITY INVENTORY (unchanged facts, revised interpretation)

Inspected `src/layers/*`, `src/data/*`, `src/app/layers/*`, `src/app/constructCatalog.js`, `src/data/lifecycle.js`, `src/layers/aircraft/classification.js`, `src/sources/live/standalone.js`.

### Flights — `flights`

- Native ID: ICAO24 hex from OpenSky
- Internal: `FlightRecords.data: Map<icao24, meta>` sticky merge, `missingPolls` bounded, `geoidNCache`
- Label: callsign || registration || icao24; analyst id is label not key; engine keys on icao24
- Stable: Yes within session, evicted after `MISSING_POLL_LIMIT=3` (landed=1)
- Cross-provider same entity: Yes — OpenSky and adsb.lol both report same ICAO24, merged into one Map entry via `receive()` sticky fields. Evidence: `snapshotRenderer.js` merges, `records.js` sticky.
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

**Key takeaways revised:**
- Same ICAO24 through OpenSky+adsb.lol = same entity, merged via sticky, provider is observation not identity
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

- **Same ICAO24 through OpenSky and adsb.lol:** One entity `aircraft:icao24:abc123`. Two observations: OpenSky observation at T1, adsb.lol observation at T2. Both merge into same `FlightRecords.data` entry via sticky. Provenance (I3) will track which source observed when. EntityKey identical, observation identity distinct.

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
- For cross-provider same aircraft (OpenSky + adsb.lol), `presentInSources` = `{'OpenSky','adsb.lol'}` but entityKey identical. Provenance (I3) tracks observation times per source.
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





