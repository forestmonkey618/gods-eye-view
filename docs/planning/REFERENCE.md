# Reference — verified facts the Master Plan depends on

Carried forward from the fork review and direction study, re-verified at HEAD `0d41b6b`, and updated for ATAK-CIV study (2026-09) and for I1 spatial-authority implementation. This is the **evidence file** behind `MASTER-PLAN.md`; where the two disagree, the code wins and this file is corrected.

Everything here was read from the checkout, not from a README. Line numbers are from `0d41b6b` and will drift, except where noted as post-I1 (current checkout).

### Update note — I1 implemented, ATAK accepted findings

- I1 spatial authority `src/data/geo.js` now exists (see 1.7). The confirmed antimeridian bug in `pointInRing` is now fixed via delegation to `geo.ringContains`.
- ATAK-CIV comparative study (2026-09) validated GEV foundation and expanded I7 into User Spatial Objects + AOIs, formalized transient vs persistent lifecycles (new P11), added ephemeral vs persistent distinction (P12), expanded I9 to edge-triggered transitions (APPEARED/UPDATED/STALE/DEPARTED/ENTERED_SCOPE/EXITED_SCOPE), added future selection-deconfliction requirement around I8, and clarified reproducible workspaces/briefs (see MASTER-PLAN 0.4). Parametric sensor geometry deferred to I4/I5, I1 NOT reopened. Concepts NOT adopted from ATAK are listed in MASTER-PLAN 0.4.4.
- Flights/military `getNearby` still uses `Cesium.Cartesian3.distance` from ECEF center — D9 now RESOLVED as DUAL SEMANTICS, SURFACE authoritative for geographic proximity (see MASTER-PLAN Part 3.4 and D9). DECISION resolved, IMPLEMENTATION pending.

---

## 1. Verified primitives the plan reuses

### 1.1 Analyst engine — already a working NL query engine

`src/data/analystEngine.js` (317 lines). Not a stub. Its own doc: *"answers spoken questions over data ALREADY sitting client-side in the layers ('how many flights over Texas?', 'biggest fire near LA?', 'which ships are headed to Oakland?')"*.

- **Pure helpers, node-testable:** `haversineKm`, `applyFilter`, `applyScope`, `summarize`.
- **Operators:** `gt` `gte` `lt` `lte` `eq` `neq` `contains`.
- **Scope kinds:** `view` | `region` | `radius` | `anywhere`; `region` resolved through an injected `resolveRegionRing`.
- **Result shape:** `{ok, count, items, truncated, summary, scopeLabel, coverage:{layersQueried, scope, followUp, note}, centeredOn?}`.
- **Follow-up memory:** `followUp: true` re-filters the remembered set without re-snapshotting; `reset()` clears it.
- **Injected providers:** `getRecords(layerKey)`, `resolveRegionRing(name)`, `getViewContext()`, plus optional `getContextSubject()`.
- **`ANALYST_LAYERS`** declares `numeric` / `text` / `flags` per layer for **5 of 18 families**: `flights`, `military`, `ais-live-vessels`, `local-firms`, `earthquakes`. Unknown layers fail with a courteous refusal, never a wrong answer.
- **Tests:** `src/data/analystEngine.test.mjs` — 203 lines, 15 tests, covering scope naming, radius centring on an active contact, explicit-centre precedence, honest failure on an unresolved region, follow-up memory, and haversine sanity.

### 1.2 The provider factory and record-accessor contract already exist

`src/voice/gevActions.js:4125` — `analystProviders(viewer, dataManager, {recordLimitByLayer, placeSearch, resolveRegionRing})` returns the four providers above. Wired at `gevActions.js:971`.

`getRecords` routes through a **uniform per-layer contract**: it looks up `dataManager.layers.get(layerKey).module.getAnalystRecords(limit)` and returns `[]` if the layer is disabled or does not implement it. **Implemented today by exactly five layers**: `earthquakes/index.js`, `firms/queries.js`, `flights/queries.js`, `military/queries.js`, `vessels/queries.js`.

**Consequence:** adding a family to the analyst engine is *implementing one method plus a field table* — it does not require an `ANALYST_LAYERS`-adjacent rewrite of `gevActions`.

### 1.3 The "one computation, two consumers" precedent

`src/layers/awareness/queries.js:101–165`. Verbatim from the source:

> *"THE aircraft-proximity engine. One computation, two consumers: the Contacts panel window and the voice analyst's entity-centred 'how many nearby'. They used to be separate. The panel read live billboard positions through `getNearby` with a 20 000 cap; the analyst re-derived its own answer from last-fix coordinates over a 2 000-record slice. Same question, same centre, two numbers — and in the owner's trial the spoken answer (15) and the panel (111) disagreed badly enough that the model narrated the difference away. Routing both through here makes them the same number BY CONSTRUCTION, so they cannot drift again."*

Returned by `collectAircraftProximityWindow(position, {radiusM, subject})` → `{flights, military, aircraft}`, with the subject excluded from its own window. Also in this module: `isSame(subject, item, layerKey, idField)`, and an honest-zero guard at line 22 written to prevent a *"false all-clear"*, returning *"viewport feed is not a complete 250 km survey"* as the reason for a zero.

### 1.4 The honesty vocabulary already shipped

- `src/ui/cockpitContext.js:56` — `'CONTACT LOST · LAST KNOWN READOUT · NOT AN ALL-CLEAR'`
- `src/ui/cockpitContext.js:143` — `` `${unknownCount} INPUT${…} UNKNOWN · NOT AN ALL-CLEAR` ``
- `src/ui/cockpitContext.js:144` — `'AVAILABLE INPUTS CURRENT · NOT AN ALL-CLEAR'`
- `docs/CURRENT-STATE.md:1054` — *"Without the predicate that window prints an all-clear `0`."*
- `src/data/feedState.js` (55 lines) — `layerFeedState(stats)` normalizes heterogeneous stats into seven states: `nominal`, `loading`, `degraded`, `stale`, `partial`, `fallback`, `unavailable`. Guidance states ask the user to act (zoom in, run a search) and are deliberately not treated as feed faults; a genuinely stale cache still reads `STALE`.
- `src/data/contactPlayback.js` — `FIX_FLAGS.VEHICLE_TIME | FEED_TIME | RECEIPT_TIME` distinguishes when a thing was measured from when it was reported and received.
- `src/services/groundFloor.js:23` — *"the clamp is a visual floor, not a survey"* — the precedent for labelling a visual approximation.

### 1.5 Provenance and licence machinery

- `src/data/dataCredits.js` — the `DATA_CREDITS` array (**35 entries**) plus four named conditional credits (`TOMTOM_CREDIT`, `NATURAL_EARTH_CREDIT`, `BHOTE_KOSHI_CREDIT`, `BHOTE_KOSHI_LOCATOR_CREDIT`) — **39 distinct credit keys in total** — and `registerDynamicCredit(viewer, credit)` for conditional ones (TomTom appears only when its flow data displays; Natural Earth when a region outline first resolves; transit credit registered per feed on first render). Registered as Cesium static credits with `showOnScreen=false` into the expandable "Data attribution" lightbox. The file's own rule: *"if you add a data source, add it there AND here [DATA_SOURCES.md]"* — a **manual synchronization with no test enforcing it**. `DATA_SOURCES.md` is organized as prose sections rather than a keyed list, so a strict 1:1 sync test would be fragile; I4's registry is the structural fix, not a new lint.
  - `src/maps/credits.js` is a **different concern** — a display helper for the map stack's own credit. Not duplication.
- `src/data/transitFeeds.js` — `TRANSIT_FEED_REGISTRY`, seven feeds (mbta, capmetro-austin, metrotransit-msp, hsl-helsinki, ovapi-nl, entur-norway, translink-seq), each with `{license, licenseUrl, attribution, terms:{quote, note}}`. MBTA's note records that *"the agreement forbids using MBTA/MassDOT logos or trademarks"*.
- `src/data/local_data/natural_earth/*.json` — a **custom compact format** (not GeoJSON): `{meta:{source,url,commit,license,fetched,curation,featureCount}, features:[{name,featurecla,polygons}]}`. `regions.json` 1,046 features / 2,335 rings; `marine.json` 292 features / 300 rings. `license: "Public domain (Natural Earth)"`. **Provenance metadata already ships inside the pack.**

### 1.6 Layer lifecycle, state and security

- `src/data/lifecycle.js` (2,314 lines) — public API includes `setEnabled`, `getEnabledLayerIds`, `setLayerParams`, `getLayerParams`, `destroyLayer`, `destroyAll`, `getLayerLifecycleState`, `getAll`, `subscribe`, `subscribeVisibilityRequests`, `addVisibilityGuard`, `subscribeBeforeDestroy`, `subscribeActivity`.
  - `getAll()` returns per layer: `{id, name, icon, source, showInTogglePanel, requiresKeyId, enabled, lifecycleState, lifecycleUncertain, stats}` — **module metadata, not records**.
  - `subscribeActivity(callback)` (`:2299`) / `_publishActivity(change)` publishes five change types: `status`, `destroy-all`, `data-updated` (with `layerId`), `visibility-settled`, `params-settled`. **One subscriber** — `src/app/layerPresentation.js:17` — which maps them to render reasons (`layer-tick:${layerId}`, `layer-visibility`, `layer-params:${layerId}`) for the render governor. **The payload carries no diff.**
- `src/data/layerState.js` — `LAYER_STATE_VERSION = 2`, `LAYER_STATE_STORAGE_KEY = 'gev:layer-state:v2'`. Share-link codec with reject-wholesale validation (`MAX_ENABLED_LAYERS_CHARS = 64`, `MAX_LAYER_OPTIONS_CHARS = 512`), a `TRACKING_ID_GRAMMAR` (`/^[0-9a-z~_-]{1,16}$/`) justified as *"an out-of-grammar ID is rejected outright, because half an address is a DIFFERENT aircraft, not a shorter name for the same one"*, and the rule that unknown tokens reject the whole payload.
- `src/data/lifecycle.js` `finalizeRegistrations()` throws `Layer serialization registry mismatch (missing: …; extra: …)` if a layer and its `LAYER_STATE_REGISTRY` entry land apart.
- `build/application-html.js` — `APPLICATION_TEMPLATES` is a **closed allowlist**; `expandApplicationHtml` throws `Unknown application template` for a template file that was added but not listed.

### 1.7 Spatial primitives (see MASTER-PLAN Part 3 for the full inventory) — updated post-I1

- **I1 implemented:** `src/data/geo.js` is now the canonical spatial authority (22,476 bytes). Exports `EARTH_RADIUS_M = 6371008.8`, `METRIC {SURFACE, SLANT}`, `DEFAULT_METRIC = SURFACE`, `surfaceM`, `slantM` (with degradation reporting), `distanceM`, `ringContains` (antimeridian-correct), `ringAreaM2`, `anyRingContains`, `nearbyM`, etc. Allocation-free hot path, metres internally. `geoEllipsoid.js` holds `geodesicM` (WGS84, Cesium-backed) for reported numbers. `geoid.js` / `geoid.test.mjs` also present.
- `src/data/naturalEarthRegions.js` now imports `ringContains, surfaceM` from `./geo.js` (line 19). `pointInRing(ring, lat, lon)` at :273 is now `return ringContains(ring, lat, lon)` — **previously naive ray casting with no antimeridian handling (see PRE-IMPLEMENTATION-AUDIT.md §A1), now fixed and antimeridian-correct**. The only lon-first implementation previously at :38 is retired at boundary — `geo.js` enforces (lat, lon) order everywhere, ring vertices remain [[lon, lat]] per GeoJSON.
- `src/annotations/drawMode.js:49,184,200` — `greatCircleM`, `ringAreaM2`, `ringCentroid`; `formatMeasure()` formats area and length. Now re-exports/uses `geo.js` where appropriate; Class C duplicates collapsed per I1c intent.
- `src/data/cctvViewshed.js`, `src/data/cctvFootprint.js`, `src/layers/cctv/geometry.js` — camera pose, frustum primitives, `projectPoint(lat, lon, heading, dist)`, ray/plane intersection. **Parametric sensor geometry (origin/azimuth/elevation/FOV/range) deferred to I4/I5 evaluation — I1 NOT reopened (see MASTER-PLAN 0.4.3, D10).**
- `src/services/groundFloor.js` (661 lines) — terrain sampling and a mesh floor sampler.
- `src/hud.js:488` — `_estimateSunElevation(latDeg, lonDeg)`; `src/data/issPass.js` — generalized `findNextIssPass({satrec, latDeg, lonDeg, …})` with `lookAnglesAt`.
- `src/layers/alpr/policy.js:40` — `EARTH_MEAN_RADIUS_M = 6371008.8` (**Decision D2's value, already in the repo**, now canonical in `geo.js`).
- **Flights/military `getNearby` (D9 RESOLVED, implementation PENDING):** `src/layers/flights/queries.js:538`, `src/layers/military/queries.js:326` still compute `Cesium.Cartesian3.distance(center, pos)` where center is ECEF — effectively slant 3D. Owner decision 2026-09: DUAL SEMANTICS, SURFACE authoritative for geographic proximity. SURFACE governs radius membership, cutoff filtering, proximity/discovery, sorting, AOIs, watch/geofence boundaries, ordinary rosters, analyst/search "within X km", ordinary narration. SLANT = physical 3D separation, explicitly named secondary metric, must NEVER silently substitute for `distanceM`, must NOT alter geographic radius membership. Example overhead: surface 0 km, slant ≈10.7 km at 35k ft. Whether slant is eagerly attached as `slantDistanceM`, lazily calculated, or calculated only by specialized 3D consumers is implementation detail deferred. Vessels/installations NOT automatically mandated for migration by D9. DECISION resolved, IMPLEMENTATION pending — do NOT claim surface-consistent until code matches. See MASTER-PLAN Part 3.4 and D9.
- **Future User Spatial Objects (I7 expanded):** model must support point/pin, polygon, radial circle, corridor (polyline + width/buffer), bbox — general-purpose data-oriented, avoiding class-hierarchy over-engineering. Ephemeral telestration vs persistent User Spatial Objects distinct (P12). Persistence mechanism NOT locked (localStorage vs IndexedDB etc. deferred).

### 1.8 Environment and baselines

- `npm test` — 4,144 passing / 0 failing / 1 skipped, ≈161 s at HEAD.
- `npm run check:boundaries` = `check-import-directions.mjs` + `check-package-boundaries.mjs`. Ownership categories include `entry`, `tests`, `source`, `renderer`; `portableExport` enumerates exportable keys.
- `scripts/format-scope.json` is an **explicit allowlist** — new files outside it are not formatted or checked (`docs/CODE-BOUNDARIES.md` and `docs/APPLICATION.md` *are* in it; the files in `docs/planning/` are not).
- Stack: vanilla JS + CesiumJS 1.124 + Vite 6, six runtime dependencies. `src` ≈281 K LOC excluding tests; `server` 12,591; `scripts` 49,047.
- Node in the sandbox is v22.22.3, below the declared `engines` range (`>=24.14 <25 || >=26 <27`) → `EBADENGINE` warning, both allocation microbenchmarks skipped. Expected. No Chromium → browser QA scripts cannot run.

### 1.9 Camera catalogue

`server/providers/cctv/sources.js` — **12 official packs**: Austin, Caltrans, TfL, Ontario, Fintraffic, DriveBC, TxDOT, Tallinn, TarkTee, NSW, Calgary, plus a file/env override path. Each bounded by `CCTV_<X>_MAX_SOURCES`, empty string disables. `resolveCatalogCap` merges packs **round-robin** so lowering `CCTV_MAX_SOURCES` thins every region rather than deleting the last-appended pack.
**Note:** `server/providers/cctv/cap.js` is this **source-capacity resolver** — *not* Common Alerting Protocol. Confirmed separately: `grep -rniE "cap alert|common alerting|alert\.cap|cap\.xml"` over `src/` and `server/` returns nothing, so **CAP alert ingestion does not exist**.

### 1.10 Confirmed absences (verified, not assumed)

- **No anomaly detection.** `grep -rniE "anomal(y|ies)" src/` returns zero files. `src/data/detection.js` (1,604 lines) is render-density management (`MODE_OFF`/`MODE_SPARSE`/`MODE_BALANCED`/`MODE_DENSE`, candidate caps, fade bands, billboard LOD) — the name is a false friend.
- **No CAP/weather-alert ingestion.**
- **No weather layer**; **no IndexedDB / service worker / PWA**; **no export**; **no touch or i18n support**.
- **The only text input is `#location-search`** (place geocoding).
- **No test enforces `DATA_CREDITS` ↔ `DATA_SOURCES.md` synchronization.**

### 1.11 Three documents cited from code that do not exist

All inside backtick spans, which is why link checkers miss them:

1. `docs/voice-engine-evaluation-2026-07-23.md` — cited at `analystEngine.js:6` as **owner-ratified** design authority (§5.3) for the engine.
2. `docs/pre-ship-audit-2026-07-01.md` — cited at `dataCredits.js:11` as the source of findings H10/H11 justifying the attribution system; also cited at the head of `scripts/qa-attribution-b12.mjs`.
3. The height-datum handover report cited at `docs/KNOWN-ISSUES.md:77`.

---

## 2. Data sources, by access tier

Licensing was verified where it could be; **verify per product at the time of integration** rather than trusting this table indefinitely.

### Tier A — Free / open, no registration

OSM / Overpass; USGS earthquakes + NWIS; NWS `api.weather.gov` (CAP); NASA GIBS / Worldview; NASA FIRMS (free `MAP_KEY`); CelesTrak; Natural Earth (public domain — already bundled); OurAirports; World Port Index; NOAA ENC / CO-OPS / NDBC; GEBCO; OpenFEMA; USGS + Smithsonian volcanoes; EMSC; GDACS; **UCDP (CC-BY)**; GDELT; ReliefWeb; HDX; Wikidata / Wikipedia GeoSearch; OpenAQ / AirNow; NOAA SWPC; SPC storm reports; WFIGS / CAL FIRE; GOES / Himawari + GLM; OpenSeaMap / OpenRailwayMap / OpenInfraMap; community seismic networks; SatNOGS.
**⚠️ Open-Meteo** is already a repo dependency and its **free tier is non-commercial only** (data itself CC-BY 4.0; commercial from $29/mo). A live constraint if the fork ever goes commercial.

### Tier B — Free with registration / API key

AISStream; TomTom; Cesium ion; OpenSky (**non-commercial**); adsb.lol / airplanes.live; Launch Library 2; PurpleAir; **Marine Regions (⚠️ verify per product — GlobalFishingWatch cites EEZ layers as CC BY 4.0; Marine Regions' general terms have stated CC-BY-NC-SA)**; Copernicus Data Space; EUMETSAT; **APRS.fi (⚠️ people-operated — aggregate only)**; eBird / iNaturalist / GBIF (**never de-obscure sensitive species**); SkyTruth; GFW / GLAD; Overture; FAA / EASA + aviationweather; **NOAA HYCOM / OSCAR / NCODA (drift input)**.

### Tier C — Paid but citizen-accessible

Open-Meteo commercial; Sentinel Hub; ADSBExchange / FlightAware / MarineTraffic / VesselFinder; what3words; Mapbox / Google; commercial satellite tasking.

### Tier D — Restricted / not realistically available

ACLED (**registration; access level assigned by organisation type; API behind Research/Partner/Enterprise; raw-data redistribution prohibited**); Global Fishing Watch bulk; HIFLD-restricted layers; satellite AIS; MarineTraffic archives; some Space-Track products; CAD / dispatch / 911.
**And all person-location data — social media, ALPR reads, face recognition, private communications — excluded on principle, not for access reasons.**

### Already-bundled assets worth knowing

- **TeleGeography pack: 712 submarine cables + 1,917 landing points** (⚠️ **CC BY-NC-SA**).
- **Bhote Koshi flood-event scene** — an existing flood-event precedent (`public/events/bhote-koshi-2026/`, CC BY-NC 4.0).
- Before/after imagery comparison pattern (Vantor pairs); 838-object TLE catalog; MGRS grid; `sharelink.js`; `director/sharing/bundle.js`.

---

## 3. Boundary rules

The people boundary is preserved by **structure**, not by an assertion in the docs. It holds because:

1. No layer schema has a person-shaped field; no entity type is a person.
2. ALPR models **camera hardware** in space, not plate reads.
3. `docs/CURRENT-STATE.md:3107` records that the aircraft-focus feature *"is an attention-priority navigation shortcut, not a high-risk, affiliation, or threat classification."*
4. **The exact string "People are not a query type here" does not exist in the repo.** It was an earlier paraphrase and is not quoted as source.

The standing rules the plan commits to:

- No person search, face recognition, or private-person tracking.
- Asset-watching is not person-watching.
- Aggregation floors on person-adjacent counts.
- No claim without source, timestamp and freshness.
- OBSERVED, DERIVED and INTERPRETED never share a container unlabelled.
- No threat scores, no unqualified "linked to".
- Compliance is structural: TeleGeography CC BY-NC-SA, Vantor CC BY-NC, Open-Meteo's free tier, all declared in the source registry (I4).
- No operational authority — context only.
- Anomaly detection operates on **aggregate series and asset classes**, never individual movement patterns.
- Co-location is reported as **a fact with distance and timestamp**, never as a link or a score.
