# I5b DESIGN REDUCTION — Next-Slice Selection after I5a

**Date:** 2026-09-26
**Base:** `main` @ `3eea37d64a05eb821d093aaee2bd30fc46a848df` (merge of PR #9 / I5a)
**Status:** Analysis only. **No production code, schema, UI or test was changed.** Stopped for owner review.
**Verdict:** **Implement a narrowly defined I5b — layer observation currency ("as-of"): the two clocks of each queried layer's loaded data, on I5a's existing observation receipt** (exact contract in §F). Geographic coverage (§D.2) is not ready — almost no layer can supply truthful geometry, and no consumer can intersect it yet. Feed-state widening (§D.3) is a subset of §F's plumbing and is folded in. "I5 is complete, proceed to I6" is rejected in §F.1: I3's documented hand-off of snapshot-publish time and age to I5 would remain unclaimed while I6 scales the very surface that overstates currency.

Out of scope and untouched: the military `speedMps`/`track` `?? 0`/`|| 0` sticky-retention bug, stale I2 error wording, source-registry expansion, adsbdb licensing/compliance, the aircraft label-based `sourceId` fallback, UI redesign, AOIs, proximity, events, watchlists, workspaces, history/time machine. Where an observed issue materially shaped the design it is recorded in §C/§H, not fixed.

---

## Evidence base

**Read:** `docs/planning/{MASTER-PLAN,REFERENCE,I4b-DESIGN-REDUCTION,I3-DESIGN-REDUCTION-ADDENDUM}.md`, `docs/{CURRENT-STATE,OBSERVATION-STATUS,PROVENANCE,SOURCE-REGISTRY,CODE-BOUNDARIES}.md`; `src/data/{observationStatus,feedState,analystEngine,provenance,sourceRegistry,currentRecordIndex,lifecycle(getAll/isEnabled),manager,aisWatchdog,cctvFootprint,cctvViewshed,trafficBounds}.js`; `src/sources/live/{standalone,aircraft,vessels}.js`; `src/layers/{flights,military,vessels}/{ingestion,queries,records}.js`, `src/layers/flights/controller.js`, `src/layers/{earthquakes,firms,satellites,cctv,alpr,traffic,bikeshare,transit,awareness,radio}/{…}` (ingestion/queries/controls/policy/source as cited), `src/voice/gevActions.js` (`analystProviders`, `getLayerObservation`, `runAnalystQuery`, `VIEWPORT_LOADED_LAYERS`, warm-up note, `getViewContext`, nearest-aircraft `feed` block), `src/ui/layerPanel.js` (`_buildMetaText`, `_timeAgo`), `server/providers/aircraft/opensky.js`, `server/providers/firms.js`, `server/providers/cctv/{catalog,cap,range}.js`; `src/data/analystObservation.test.mjs`; PR #9 body (I5a final contract).

**Searches run across `src/`, `server/`, `scripts/`:** `coverage`, `footprint`, `bounds`, `bbox`, `viewport`, `range`, `radius`, `lastUpdate`, `updatedAt`, `reportedAt`, `receivedAt`, `asOf`, `age`, `stale`, `fresh`, `latency`, `cadence`, `poll`, `refresh`, `observed`, `feedState`, `observedAtMs`, `newestPositionAt`, `evaluatedAt`, `fetchedAt`, `Date.now()` in feed paths. **`asOf` appears nowhere in production code.** Line numbers below are at the base SHA and will drift.

**Baseline gates — Node 24.14.0** (CI's calibrated runtime, fetched from the npm registry; the sandbox default 22.22.3 is below `engines` and `doctor` rejects it, per REFERENCE §1.8):

| Gate | Result |
|---|---|
| `npm run doctor` | Ready (optional credentials unconfigured, as expected in sandbox) |
| `npm run format:check` | OK — 926 files |
| `npm run check:boundaries` | OK — all six checks incl. spatial / identity / provenance / source-registry authority |
| `npm test` | **4,436 tests: 4,435 pass, 0 fail, 1 skipped** (Windows-only DACL test) |
| `npm run build` | OK |

---

## A. Current I5 state — exactly what I5a guarantees

**Guaranteed (on every successful analyst/voice result):**

- `src/data/observationStatus.js` is a zero-import, clock-free leaf exporting `assessLayerObservation({layerKey, enabled, feedState})` → frozen `{layerKey, enabled, feedState, reason}` and `unobservedLayers(assessments)`. `reason` is `null` **only** for enabled + exactly `nominal`; `layer-disabled` overrides any feed state; each non-nominal feed state maps to `feed-*`; anything missing/unrecognized is `feed-state-unknown` — **unknown never becomes nominal**.
- `coverage.layersQueried[]` entries carry `{layerKey, records, enabled, feedState}`; `observation: {unobserved: [{layerKey, reason}, …]}` is always present (empty array when every layer is enabled + nominal).
- An enabled, non-nominal layer **keeps its records and count** and carries its limitation alongside; a disabled layer reads `count: 0` *and* `layer-disabled`, never as an observed zero.
- Status is read synchronously beside records, before any async scope resolution, through one optional provider (`getLayerObservation`) fed by `isEnabled` + `layerFeedState()` over the manager's normalized `getAll().stats` (so manager-owned refresh failures are not hidden). Rendering visibility (`show`) is **not** eligibility.
- Follow-ups reuse the original frozen status snapshot; they never re-read feed or lifecycle. The voice payload forwards `observation` on ordinary results and the Contacts-window read-back alike.

**Deliberately NOT guaranteed (I5a limits, unchanged here):** geographic footprint, sensor range, AOI intersection, spatial completeness, **as-of time**, **feed age/latency/cadence**, history, source attribution. `layerFeedState(stats)` remains the sole feed-state normalizer; I5a consumes its string and never recomputes freshness. The existing `coverage` block (scope/note/followUp) is untouched. Enabled + nominal qualifies only *the layer-level zero over its currently loaded data*.

---

## B. Evidence inventory — what GEV actually knows today

### B.1 Temporal facts (name → semantic meaning → level)

| Fact (where) | What it actually means | Level |
|---|---|---|
| `reportedAtMs` (I3 sidecars: flights/military/vessels stores) | **Source report time of THAT value** — `null` whenever the source supplied none. Never filled from receipt/wall clock | value |
| `receivedAtMs` (I3 sidecars) | GEV client receipt/ingest of the batch carrying the value | value/batch |
| `snapshot.observedAtMs` (`sources/live/aircraft.js` `openSkySnapshot` = `payload.time` epoch; `readsbSnapshot` = receipt − `X-ADS-B-Cache-Age-Ms`; `vessels.js` = `newestPositionAt` else newest row) | **Source-side currency of the snapshot batch** — exactly the "snapshot publish time" PROVENANCE.md hands to I5 | snapshot |
| `snapshot.receivedAtMs` (`standalone.js` `receiptMs`) | Client receipt of the batch; seeds the per-value descriptors and `records[].observedReceiptMs` | snapshot |
| `snapshot.ageMs` / `stale` / `freshness` (aircraft.js) | Derived at adapter build time as `now − observedAtMs`, thresholded at **120 s** (also `OPENSKY_SOURCE_STALE_MS = 120_000` server-side, `aisWatchdog` `staleMs: 120_000` — same literal, three homes); `freshness: 'unknown'` when no source time | snapshot (policy) |
| `feed._lastUpdate` — flights (`flights/ingestion.js` *"Freshness belongs to the source snapshot, not the moment this browser received a cached 200 response"*), military (`= snapshot.observedAtMs`) | **Source snapshot time**, deliberately | layer |
| `feed.lastUpdate` — vessels (`vessels/ingestion.js` `payload.observedAtMs ? … : now()`) | **Mixed:** source position currency *or* GEV receipt when the payload lacked one — a receipt silently posing as an observation time | layer |
| `layerState._lastUpdate` — earthquakes, satellites, cctv, bikeshare, alpr, directions (`Date.now()` at fetch/ingest completion) | **GEV fetch/receipt time** — nothing about when the data was observed | layer |
| `layerState._lastUpdate` — FIRMS (`payload.fetchedAt`, *"Data age, not response age"*) | Upstream fetch time of the held dataset (proxy cache-entry time) | layer |
| `results.evaluatedAt` — awareness | When the cohort was evaluated — a third clock (computation) | layer |
| `fire.acqMs` (analyst item `acqTime`), quake `timeMs` | Per-record **source** times (satellite acquisition / USGS origin). Reach engine `items`, but are not in `ANALYST_LAYERS` field tables and are stripped by the voice compaction key list | record |
| aircraft `positionTimeMs`/`contactTimeMs`, vessel `last_position_epoch` | Per-record source times → I3 `reportedAtMs` | record |
| `observedReceiptMs` (flights/military records) | Record-level receipt bookkeeping — *"not provenance"*, never tagged | record |
| `FIX_FLAGS` three-clock vocabulary (`contactPlayback.js`: `VEHICLE_TIME`, `FEED_TIME`, `RECEIPT_TIME`) | The repo's own "which clock is this timestamp?" vocabulary — and a do-not-break: *"never collapse them into one timestamp"*. The in-repo precedent for naming clocks instead of one `lastUpdate` | track |
| `lastMessageAt`, `silentForMs`, `nextAttemptAt`, `retryInSec`, `transportStatus` (vessels/aisWatchdog/getStats) | Transport health, not observation time | transport |
| Warm-up note (`gevActions.runAnalystQuery`, `_layerEnabledAt`, 45 s) | Ad hoc `Date.now()` comparison; I4b §F.3 already recorded it as **I5 debt against P9**, "to be addressed when `asOf` enters coverage" | query surface |
| `_timeAgo(stats.lastUpdate)` (`layerPanel.js`) | A derived age rendered **identically for every row** although `lastUpdate` means source time on two rows, receipt on most, upstream fetch on one, evaluation on another | UI derived |
| FIRMS chip `formatAge(now − _lastUpdate)` | Feed-cache age phrase (its own formatter, `layers/firms/model.js`) | UI derived |
| Stale thresholds | Duplicated per-domain literals: 120 s ×3, transit `FEED_STALE_AFTER_MS = 90_000`, radio `RADIO_DIRECTORY_STALE_MS = 7 d`, record-recency 300 s, warm-up 45 s. No canonical vocabulary | policy |
| Cadence (`layers/*/policy.js` `REFRESH_MS`, `TRANSIT_POLL_MS`, `STATUS_POLL_MS`, …) | GEV request rates — config, not source facts (I4b row 4) | policy |
| **`asOf`** | **Absent from all code.** I3 addendum §20 designed `ageMs = asOf − reportedAtMs` around an explicit `asOf` that no result carries | — |

**The two hand-offs already in the contracts (not this reduction's invention):** PROVENANCE.md "What is intentionally left unknown" — *"Snapshot publish time (OpenSky `payload.time`, AIS `newestPositionAt`) is feed-level metadata owned by feed state (I5)"*, *"adsbdb upstream fetch time … Surfacing it is an age/freshness concern (I5)"*, *"Freshness/staleness is not in the descriptor … any age computation remain[s] separate (I5)"*; I3 addendum Decision 3 and §20 say the same. **I5's own current-state doc lists "as-of time" first among what I5a does not model.** The facts exist at snapshot level today and flatten into `lastUpdate` before any consumer can classify them.

### B.2 Spatial facts

| Fact (where) | What it actually means | Class |
|---|---|---|
| ALPR `state.lastQueryBox` (`layers/alpr/index.js` — *"Snapped box of the last successful query; a view still inside it reuses its records"*), `snapAlprBox` grid snapping | **Retained truthful request bounds** — the only layer that keeps its request area as data | request |
| Traffic `loadRoadsForBounds(bounds)` clamped (`data/trafficBounds.js`, `maxSpanDeg`), tile cache keyed by box | Viewport request bounds, retained as cache keys, not as a coverage claim | request |
| Flights `_flightQuery` (`flights/controller.js`) = `{latitude, longitude}` anchor only | No bounds are ever requested; upstream is `opensky-network.org/api/states/all?extended=1` — **worldwide**. The anchor exists solely for the fallback | request |
| `ADSBLOL_POINT_RADIUS_NM = 250`, upstream `lat/…/lon/…/dist/250`, `X-Flight-Coverage: '250nm regional fallback'` → `feed._lastCoverage` → `stats.coverage` | **Request coverage of the fallback** (a disk GEV asked for), already labelled as such — not provider capability. The label reaches `layerFeedState` as a `source` string and the panel | request |
| military `/api/adsblol/mil`, snapshot `coverage: 'military upstream snapshot'`; vessels `coverage: 'received AIS positions'` | Prose describing a filter/transport, not geometry | request (label) |
| FIRMS upstream `…/api/area/csv/{KEY}/{SOURCE}/world/2` | **World + trailing 2 days** — a temporal request window as much as a spatial one | request |
| USGS `summary/all_day.geojson` | World + trailing day window | request |
| CCTV: 12 catalog packs + `cap.js` round-robin caps (catalog is region-configured, **not** viewport-bound); `cctvFootprint.js`/`cctvViewshed.js`/`layers/cctv/geometry.js` frustum pose (heading/pitch/FOV/range) | **True sensor geometry exists for exactly one family** — used for rendering/viewshed/gizmo, never for query coverage | sensor (CCTV only) |
| Satellites/launches | No FOV/swath model anywhere ("footprint" in installations = building polygon — I4b confirmed) | — |
| Transit `TRANSIT_FEED_REGISTRY` `region` | Prose region labels of configured feeds | source |
| `getViewContext().viewRadiusKm` (`altKm × 1.6`, clamped 25–2500) | A query-scope heuristic radius — not a viewport bound (the engine docblock's `bounds?` is aspirational; the provider returns none) | query |
| `VIEWPORT_LOADED_LAYERS` note (`gevActions` — *"counts cover loaded data; the flights layer loads by viewport"*) | Ad hoc scope honesty, applied for **radius/view scopes and flights only** — region scopes get no caveat | query surface |
| awareness honest zero — *"viewport feed is not a complete 250 km survey"* | Shipped precedent: a zero whose limits are stated | query surface |
| Loaded extent (record bboxes) | **Not coverage** (and never inferable from returns — zero records define no polygon) | data |

**Provider coverage is unknowable from GEV** (OpenSky / adsb.lol / AISStream receiver networks). **Request coverage exists for two real boxes (ALPR, traffic), one labelled disk (flights fallback), and two hard-coded windows (FIRMS 48 h, USGS 24 h).** There is no common structure for a generic coverage authority, and no consumer computes a spatial intersection until I7 AOIs.

### B.3 Ownership boundaries (unchanged, and where the new fact sits)

| Authority | Owns | I5b must |
|---|---|---|
| I3 provenance | Per-value `reportedAtMs`/`receivedAtMs`/`via` | Not read into, not reinterpreted, not replaced. Its vocabulary is mirrored, not imported |
| I4 source registry | Static source identity/description | Not consulted. No registry input, no source-identity claim in the receipt |
| Feed state (`feedState.js`) | The seven normalized feed states | Consume unchanged. I5b adds **no state** — only times |
| Observation status (`observationStatus.js`) | Layer-level "was this query meaningfully observed?" | Stay the single I5a receipt; the as-of entry is a sibling fact on the same receipt |
| I9 events | Transitions (APPEARED/STALE/DEPARTED/…) | Not touched. No history, no thresholds, no departure semantics |

---

## C. Consumer ambiguity inventory — ranked by architectural dependency

1. **Layer currency is absent from every result contract.** The analyst — the one surface that emits counts to narration — can say *observed / nominal / N* and never *as of when*. The model fills the gap in natural phrasing ("3 **active** fires", "**no** earthquakes in Texas") — a currency claim no field supports. This blocks I6 (18 families of counts), I9 (STALE interaction needs currency facts to transition against) and I11 ("at what timestamp and age"). It is also the unclaimed I3→I5 hand-off (§B.1). **Highest dependency: everything temporal reads through it.**
2. **`stats.lastUpdate` silently conflates four clocks** (source snapshot, GEV fetch, upstream fetch, evaluation; plus vessels' receipt-fallback). The panel renders one `ago` string for all. Any future reader that treats `lastUpdate` as either observation time or receipt time is wrong for most layers. Underlies (1) — solved by adding explicit clocks **beside** `lastUpdate`, never by redefining it (do-not-break).
3. **Query scope vs loaded-data extent has no structural guard.** A region-scoped analyst query ("over Texas") over the viewport-following flights set can return a nominal, unobserved-empty **zero** — the exact false-clear class I5a killed at layer level, alive at scope level. The `VIEWPORT_LOADED_LAYERS` note covers radius/view scopes and flights only. Fixing this truthfully needs per-layer extent/request facts that mostly do not exist (§B.2) — it cannot be honestly implemented yet; see §D.2.
4. **Temporal request windows are unexposed.** FIRMS answers over 48 h and USGS over 24 h; a count or zero silently embeds the window. These are the temporal twins of request bounds — request-scope facts, no consumer contract yet (deferred with §D.2's family).
5. **Stale thresholds are duplicated literals** (120 s ×3, 90 s, 7 d, 300 s, 45 s). No current consumer needs canonicalization; I9's transition design will. Documented, not fixed.
6. **Feed age is computed ad hoc at surfaces** (`_timeAgo`, FIRMS `formatAge`, adapter `ageMs`). These are derivations over (1)/(2) and will read the recorded clocks instead of inventing their own; wording work is presentation and follows.

---

## D. Candidate slices (three)

### D.1 — I5b: layer observation currency ("as-of") on the observation receipt — **RECOMMENDED (§F)**

- **Exact problem solved:** A successful analyst result (and any consumer of `getStats()`/the observation receipt) cannot state **when the layer's loaded data was current**, and the only time field that exists (`lastUpdate`) means different things per layer. Narration overstates currency; the panel's "ago" is ambiguous.
- **Fact / semantic claim:** *For each queried layer, the currently loaded set carries two clocks: `observedAtMs` — the source-side snapshot currency, when the feed supplies one — and `receivedAtMs` — when GEV ingested/fetched the set. Neither substitutes for the other; both may be `null`; no age is stored.* This is I3's two-clock rule (reported vs received) applied one level up, at exactly the grain PROVENANCE.md handed to I5 ("snapshot publish time … owned by feed state (I5)").
- **Authoritative input:** the snapshot builders already compute both clocks (`openSkySnapshot`/`readsbSnapshot`/`vesselSnapshot` → `observedAtMs`, `receivedAtMs`); fetch-stamped layers already store their receipt in `_lastUpdate`. Who knows each fact: the layer module that ingested the batch (module knowledge is declared by the module — no classification tables elsewhere).
- **Level:** snapshot/layer-level (the feed's current loaded set). **Not** value-level (I3 sidecars unchanged), not record-level (`acqTime`/`timeMs` stay record fields), not source-level (I4), not query-time (future P2 `coverage` echo).
- **First real production consumer:** the voice analyst narration — `observation` already rides both voice payload paths (ordinary + Contacts read-back). Secondary, same vocabulary: the layer panel's `ago` label (presentation follow-up), I6 text surface, I11 briefs.
- **Likely files:** `src/data/observationStatus.js` (additive pure export), `src/data/analystEngine.js` (additive `observation.asOf`), `src/voice/gevActions.js` (provider mapping only), the five `ANALYST_LAYERS` families' `getStats()` additive keys (`layers/{flights,military,vessels}/queries.js`, `layers/firms/queries.js`, `layers/earthquakes/index.js`) + three ingestion retentions of `snapshot.receivedAtMs` (`layers/{flights,military}/ingestion.js`, `layers/vessels/ingestion.js`), tests, `docs/OBSERVATION-STATUS.md`.
- **Minimal API / result contract:** see §F.3. Two nullable epoch-ms fields per queried layer on `observation.asOf[]`, plus the same two keys on `getStats()` for the five analyst families.
- **Tests required:** see §G.
- **What remains unknown:** per-record time summarization; temporal request windows (48 h / 24 h); age/threshold policy; query-time `asOf`; clocks for non-analyst families (satellites, cctv, transit, …) until I6 adopts them; adsbdb upstream fetch time (stripped by the proxy).
- **Explicitly excludes:** spatial coverage; age computation; `feedState` changes; `lastUpdate` redefinition; registry lookups; narration/UI wording; history; I9 transitions.
- **Replacement risk: low.** Additive fields on an established receipt; the two-clock vocabulary is I3's, already frozen; later I5/I9/I6/I11 consume the same facts. The array sits in `observation`, not `coverage.layersQueried`, so the future spatial work extends `coverage` without colliding (naming guard in §F.3).
- **Requires wall clock? No** (inside authorities/engine/providers — ages are never computed in results). **Requires provenance? No** (vocabulary mirrored; I3 untouched). **Requires source registry? No.** **Requires spatial geometry? No.**

**Answers to Candidate A's questions:** (1) No canonical layer/snapshot `asOf` exists (`asOf` appears nowhere in code). (2) No — `lastUpdate` is semantically inconsistent. (3) It means source-observation for flights/military, source-or-receipt for vessels, GEV fetch for earthquakes/satellites/cctv/bikeshare/alpr/directions, upstream fetch for FIRMS, evaluation for awareness (§B.1). (4) No — a multi-layer query cannot carry one truthful observation `asOf`; the smallest honest unit is the layer (per-record source times are the record-level facts and stay there). (5) Yes — layer-level, mirroring I5a; entity-level currency is I3's per-value territory. (6) Yes, ad hoc (panel, FIRMS chip, adapter `ageMs`) — never as one authority. (7) Duplicated literals (§C.5). (8) Yes — the voice narration (live) and the panel label; I6/I9/I11 follow. (9) It would fabricate precision only if receipt were passed off as observation or nulls were filled — the two-clock shape with enforced nulls is exactly the guard.

### D.2 — I5b: spatial request-scope receipt / coverage authority (considered, NOT recommended)

- **Exact problem solved:** the §C.3 false-clear — region-scoped zeros over viewport-loaded data — and the unlabelled request shapes (ALPR box, traffic box, 250 nm fallback disk).
- **Fact / semantic claim:** *the area GEV asked a provider for* (request coverage) per layer. Deliberately **not** provider coverage (unknowable), not sensor coverage (CCTV only, rendering-side), not loaded extent (returns ≠ coverage).
- **Authoritative input:** ALPR `lastQueryBox`; traffic clamped bounds; the server's `ADSBLOL_POINT_RADIUS_NM` + `X-Flight-Coverage` label. That is the complete truthful inventory (§B.2).
- **Level:** request-level (per refresh) with layer-level projection.
- **First real production consumer:** — none that computes with it. The only near-term use is phrasing the note the analyst already carries; real intersection arrives with I7 AOIs.
- **Likely files:** a new `coverage.js`, per-layer request retention, analyst `coverage` extension, map view (none exists).
- **Minimal contract:** per-layer request-area receipt `{kind: 'bbox'|'disk'|'window'|'world'|null, …}`. The shape is guesswork until a consumer exists.
- **Tests:** box retention, honesty of labels, "zero records define no polygon" invariants — all testable, but the *contract* is not yet pinned by a consumer.
- **Remains unknown:** provider coverage (forever, honestly); CCTV-as-sensor-coverage wiring; loaded-extent semantics; satellites/earthquakes/etc. request shapes beyond the windows.
- **Excludes:** AOIs, proximity, D10 sensor-frustum abstraction.
- **Replacement risk: high.** Only 2 of ~21 layers can supply truthful geometry; a generic `coverage.js` now would be the one-consumer abstraction I4b §C.1 rejected — and I7's User Spatial Objects will reshape the geometry vocabulary. **Wall clock: no. Provenance: no. Registry: eventually (naming sources), not required. Geometry: yes — the reason it is premature.**

**Answers to Candidate B's questions:** (1) ALPR, traffic (real boxes); flights fallback (250 nm disk, label only); FIRMS/USGS (windows). (2) Only ALPR (and traffic's cache keys) retain them. (3) No — the flight query sends an anchor point, not bounds; the fallback disk is server-side and survives only as a label. (4) **Request coverage** (the API call GEV makes); provider coverage is the ADS-B receiver network, unknowable. (5) No. (6) Yes — CCTV has true frustum/viewshed geometry, but it is presentation-side today and is D10-deferred alongside I4/I5. (7) No — two boxes, one labelled disk and two windows share no common structure. (8) No — no intersection consumer until I7; the analyst needs phrasing, not geometry. (9) Yes, premature.

### D.3 — I5b: feed-state widening without age (considered, NOT standalone)

- **Exact problem:** the §C.2 conflation and §C.6 ad hoc ages — make `lastUpdate`'s meaning explicit at the stats/panel level (e.g. `lastUpdateKind`, last-success vs last-attempt) without an analyst contract.
- **Fact claim / input / level:** same two clocks as §D.1, but declared only in `getStats()`; consumer = the panel label.
- **First consumer:** `layerPanel._buildMetaText` (cosmetic). Last-success vs last-attempt has **no** consumer beyond the existing `retryInSec`/`_retryAt` exposure; capturing request-scope metadata is §D.2.
- **Likely files / contract / tests:** subsets of §D.1/§D.2.
- **Remains unknown / excludes / risk:** as §D.1 minus the result contract; as a standalone it leaves the narration gap open and ships presentation-only churn.
- **Verdict:** its stats-level clock declarations are **already required** by §D.1 (the provider must read them from somewhere), so they are folded into F.3 rather than shipped as a second slice. The only standalone-worthy piece — rewording the panel's `ago` — is presentation and waits for the vocabulary to prove out. **Wall clock: no. Provenance: no. Registry: no. Geometry: no.**

---

## E. Decision matrix

Qualitative; the evidence above is the score.

| Criterion | D.1 currency (recommended) | D.2 spatial | D.3 widening | Skip to I6 |
|---|---|---|---|---|
| 1. Fixes a real current ambiguity | Yes — narration currency + four-clock `lastUpdate` | Partial — note gap real, facts thin | Partial — panel label only | No — leaves §C.1–2 open |
| 2. Real production consumer | Yes — voice analyst (payload path live) | None until I7 | Panel cosmetics | I6 would scale on the gap |
| 3. Facts GEV actually knows | Yes for all five analyst families, with honest nulls | 2 boxes + 1 label + 2 windows | Yes, shallow | n/a |
| 4. One clear authority | Yes — the observation receipt; clocks already computed by adapters; I3 handed the fact class to I5 | No — coverage.js would be a premature authority | Splits across stats/panel | n/a |
| 5. Deterministic tests | Yes — injected clocks, poisoned `Date.now`, frozen outputs | Boxes testable; semantics unpinned | Yes | n/a |
| 6. No fabricated precision | Yes — two clocks, never substituted, nulls enforced, no query-level asOf | Trap-prone (request≠provider; bbox-of-returns) | Yes | Status quo lets narration invent currency |
| 7. No duplication | Yes — mirrors I3 vocabulary; feedState untouched | Would duplicate future I7 geometry + scope echo | Risk of two feed-metadata owners | n/a |
| 8. One focused PR | Yes — I5a-sized | No — open-ended | Yes, but pointless alone | Yes, but wrong |
| 9. Useful after I6–I11 | Yes — I6 "measured when", I9 STALE inputs, I11 timestamps | Reusable later, shape will be replaced | Marginal | Delays all of them |
| 10. Unlocks without premature implementation | Yes — recorded clocks await I6/I9/I11 policy | Premature (D10 + I7 deferred) | Middling | No |

---

## F. Recommendation

**Option 1 — implement a narrowly defined I5b: layer observation currency.** Everything else in I5 (spatial coverage, request-scope capture, thresholds, latency/cadence, history) is either premature or belongs to I6/I9/I11 policy.

### F.1 Why not "I5 is complete — proceed to I6"

I6 makes the analyst the primary interface across all families. Shipping it on top of a result contract that cannot say *as of when* scales §C.1 from one surface to the product's main one, while the two clocks sit computed-but-flattened one layer below. I3's contract and I5a's own limits list both name as-of as I5's next fact; the consumer exists today. The slice is I5a-sized and additive.

### F.2 The architectural test — what each new field claims

| Field | Claim | Who knows it | Stored today | Survives? | Level | Already owned by? | Consumer |
|---|---|---|---|---|---|---|---|
| `observedAtMs` (per layer) | "The source-side clock of the currently loaded snapshot is T" | snapshot builders (`payload.time` / cache-age / `newestPositionAt`) | flattened into `feed._lastUpdate`/`lastUpdate` (vessels: `?? now()`) | yes, but unlabelled | snapshot | nobody — PROVENANCE.md hands it to I5 | voice narration, later panel/I6/I11 |
| `receivedAtMs` (per layer) | "GEV ingested/fetched this set at T" | ingestion (batch receipt / fetch completion) | `snapshot.receivedAtMs` → per-record descriptors only; fetch layers' `_lastUpdate` | partially (per-record only) | snapshot/batch | nobody at layer level | same |

Both pass: one known fact, one current home, one authority (the observation receipt), one live consumer, and no other subsystem owns the claim. Every other proposed field was rejected on the same test: `ageMs` (derived — computed by consumers from recorded clocks + explicit `asOf`, P9), `staleAt`/thresholds (I9 policy), request bounds (§D.2), source identity (I4), per-value times (I3).

### F.3 Exact minimal contract

**Naming and placement (deliberate contract, not mechanical append).** `coverage.layersQueried` stays as I5a left it — a consultation record (`layerKey`, `records`, `enabled`, `feedState`) — and gains **no** temporal fields. The clocks join I5a's receipt: `observation` answers layer-observation questions (*was it observed? as of when?*), while `coverage` stays scope/consultation and the future spatial map. Result shape (additions only):

```json
"observation": {
  "unobserved": [{"layerKey": "military", "reason": "layer-disabled"}],
  "asOf": [
    {"layerKey": "flights", "observedAtMs": 1758870000000, "receivedAtMs": 1758870001234},
    {"layerKey": "local-firms", "observedAtMs": null, "receivedAtMs": 1758869950000}
  ]
}
```

- `asOf` entries appear **once per queried layer, in `layersQueried` order**, on every `ok: true` result.
- `observedAtMs` — the feed-level snapshot currency (I3 Decision 3's hand-off), finite positive epoch ms or **`null`**. It never replaces per-value `reportedAtMs`, and a set with no single source clock (FIRMS' 48 h of acquisitions, USGS' day of origins) is `null` even though per-record times exist on items. Newest-record-time is **not** substituted — that would claim currency the older records do not have.
- `receivedAtMs` — GEV ingest/fetch completion of the loaded set, finite positive epoch ms or `null`.
- **Neither clock substitutes for the other. Invalid input → `null`. No wall clock, no age, no stale flags in the structure.**
- Query-time `asOf` (MASTER-PLAN P2's coverage echo) is a **different fact**; if/when it lands it belongs to `coverage` and must not overload `observation.asOf`. (Owner decision point at review: if any collision risk is unacceptable, rename `observation.asOf` → `observation.clocks` before first payload ships.)

**`src/data/observationStatus.js`** — additive export, same zero-import, clock-free posture (unknown stays unknown):

```js
// → frozen {layerKey, observedAtMs, receivedAtMs}; finite-positive ms or null.
export function assessLayerAsOf({ layerKey, observedAtMs, receivedAtMs } = {});
```

`assessLayerObservation` / `unobservedLayers` remain byte-compatible. One I5a module continues to own the layer-observation receipt; a second leaf for two fields would duplicate the boundary story (revisit if the receipt grows a third fact class).

**`src/data/analystEngine.js`** — additive only:

- The existing optional provider **gains two optional keys**: `getLayerObservation(layerKey)` → `{enabled, feedState, observedAtMs?, receivedAtMs?}`. Missing provider or missing keys → `null` clocks (never `Date.now()`). The synchronous status-beside-records read is unchanged — one call fills both the I5a assessment and the as-of entry.
- Every `ok: true` result carries `observation.asOf` as above, built through `assessLayerAsOf`. **Follow-ups reuse the frozen `asOf` array exactly as they reuse `unobserved`/`layersQueried`** — the snapshot rule: *follow-ups describe the observation state of the original result, not the feed's current state.* No re-reads, no silent re-snapshotting.
- `count`, `items`, `summary`, `scopeLabel`, `coverage` (incl. `layersQueried`, `note`, `warmup`, `followUp`), and all `ok: false` paths stay byte-for-byte unchanged.

**`src/voice/gevActions.js`** — the existing `getLayerObservation` provider additionally maps `observedAtMs`/`receivedAtMs` from `getAll().stats` (the same normalized path I5a chose so manager-owned failures cannot hide). Both payload sites (ordinary + Contacts read-back) already forward `observation`; compaction key lists and tool wording are untouched.

**Layer modules — the five `ANALYST_LAYERS` families declare what they actually know** (module knowledge lives in the module; no classification tables elsewhere). Additive `getStats()` keys only; **`lastUpdate` and every existing key keep their exact semantics**:

| Family | `observedAtMs` | `receivedAtMs` |
|---|---|---|
| `flights` | `feed._lastUpdate` (= `snapshot.observedAtMs`, unchanged) | **new** `feed._lastReceivedAtMs` ← `snapshot.receivedAtMs` retained per batch in ingestion |
| `military` | `feed._lastUpdate` (= `snapshot.observedAtMs`, unchanged) | same pattern |
| `ais-live-vessels` | `payload.observedAtMs ?? null` (the adapter's `newestPositionAt`/newest-row currency) — truthful; the `lastUpdate` key-absent `now()` fallback is **not** propagated into the new key | **new** retained reconcile receipt |
| `local-firms` | `null` (no layer-level source clock; per-record `acqTime` stays record-level) | `_lastUpdate` (upstream `fetchedAt`) |
| `earthquakes` | `null` | `_lastUpdate` (fetch completion) |

Non-analyst families keep their current `getStats()`; when I6 adopts them they declare the same two keys. **Docs:** `docs/OBSERVATION-STATUS.md` gains the receipt's second fact and the follow-up rule; `docs/CURRENT-STATE.md`'s I5a paragraph points at it; an implementation report follows at implementation time. **Boundary script:** none — purity is unit-tested as in I5a; revisit with the spatial slice (I5a's own recorded rule).

### F.4 Deliberate exclusions

No age/staleness computation anywhere in results; no `feedState`/`lifecycle`/`layerState` changes; no `lastUpdate` redefinition (the vessels `?? now()` fallback stays where it is — the truthful clock is added beside it; the conflation is recorded in §B.1 so no reader repeats it); no registry reads; no per-record time summarization; no narration/UI wording changes (surfaces may later phrase ages from recorded clocks + an explicit query-time `asOf`, per P9); no spatial fields; no history, cadence or latency modeling; the warm-up note stays until query-time `asOf` exists (I4b §F.3's recorded debt).

### F.5 Follow-up snapshot semantics — the rule, explicitly

Follow-ups describe the observation state of the **original result**. `observation.asOf` (like `unobserved` and `layersQueried`) is captured once, frozen, and carried forward unchanged; a follow-up never re-reads `getLayerObservation`, never re-derives clocks, and never mixes a newer feed state into an older answer. This generalizes I5a's rule to every future I5 receipt field by default.

---

## G. Acceptance tests (for the recommended slice — listed, not implemented)

1. **Purity of `assessLayerAsOf`.** Invalid/absent/`Infinity`/negative inputs → `null`; outputs frozen; inputs unmutated; results identical under a poisoned `Date.now`; the two clocks are never cross-filled.
2. **Receipt order and completeness.** A three-layer query yields `observation.asOf` entries in `layersQueried` order, one per layer, including enabled+nominal layers (currency is reported for observed layers too, not only limitations).
3. **Unknown stays unknown.** Missing provider, missing keys, or unrecognized layer → `null`/`null` — never `Date.now()`, never `lastUpdate` laundered into `observedAtMs`.
4. **Two-clock truthfulness per family** (fixture snapshots): flights/military report source snapshot time as `observedAtMs` and batch receipt as `receivedAtMs`; a payload without `observedAtMs` on vessels yields `observedAtMs: null` (the `now()` fallback is not propagated); FIRMS/earthquakes report `observedAtMs: null` even when per-record times are present, with `receivedAtMs` = fetch stamp.
5. **No query-level asOf.** A mixed-currency two-layer query asserts there is no single result-level observation time — only per-layer entries.
6. **Follow-up snapshot.** After a follow-up, `observation.asOf` deep-equals the original; spies prove `getRecords` and `getLayerObservation` were not called again.
7. **I5a untouched.** All `analystObservation.test.mjs` / `observationStatus.test.mjs` cases pass unmodified; `count`/`items`/`summary`/`scopeLabel`/`coverage`/`unobserved` deep-equal with and without the new keys; failure results unchanged.
8. **`lastUpdate` compatibility.** For every touched family, `getStats().lastUpdate` retains its pre-slice value under the same fixtures (do-not-break proof).
9. **Voice wiring end to end** (`gevActions.test.mjs` harness): the `analyst_query` payload's `observation.asOf` carries the injected clocks on both the ordinary and Contacts paths.
10. **Gates.** `npm test`, `npm run check:boundaries`, `npm run format:check`, `npm run build` green on Node 24.14.0 and 26.x.

---

## H. Explicit deferrals

- **Spatial request-scope receipt / coverage authority (§D.2)** — waits for I7's intersection consumer and more truthful geometry; `coverage.js` name stays reserved. The §C.3 region-scope caveat gap is tracked there (an I6 narration-pass candidate if honesty needs a stopgap first).
- **Temporal request windows** (FIRMS 48 h, USGS 24 h) — the temporal twins of request bounds; expose with the request-scope family or I6 field tables. Until then a count's window stays unstated (recorded gap).
- **Query-time `asOf`** (P2 coverage echo; "deterministic for a fixed `asOf`") — I6/I11, plus the warm-up-note replacement it unblocks (P9 debt).
- **Age phrasing and panel `ago` rewording** ("source Nm ago" vs "fetched Nm ago") — presentation, derives from recorded clocks; follows the vocabulary, does not define it.
- **Per-record source times to narration** (`acqTime`/`timeMs` compaction key list) — I6 payload work; record-level, orthogonal to the layer receipt.
- **Stale-threshold canonicalization and latency/cadence modeling** — I9's transition policy surface (MASTER-PLAN 0.4.2 Change 3).
- **Clocks for non-analyst families** (satellites, cctv, transit, radio, …) — same two-key declaration when I6 adopts each family.
- **adsbdb upstream fetch time** — remains unknown (proxy strips it; PROVENANCE.md gap stands).
- **`getStats().lastUpdate` semantic unification** — not attempted; the panels' mixed `ago` persists until the presentation follow-up. Documented, not fixed.
- **D10 parametric sensor geometry / CCTV coverage participation** — deferred per MASTER-PLAN 0.4.3 until multiple sensor consumers exist.
- Everything in the out-of-scope header (military sticky-zero, I2 wording, registry expansion, adsbdb compliance, label-based `sourceId` fallback, UI redesign, AOIs, proximity, events, watchlists, workspaces, history).

---

## Baseline verification (this pass)

`main` = `origin/main` = `3eea37d64a05eb821d093aaee2bd30fc46a848df`, clean tree on `arena/01a0dd6c-gods-eye-view`. Gates ran on **Node 24.14.0** (fetched from the npm registry; sandbox default 22.22.3 fails `doctor`'s engine floor, as documented in REFERENCE §1.8): doctor Ready · format:check OK (926 files) · check:boundaries OK (all six checks) · **npm test 4,436: 4,435 pass / 0 fail / 1 skipped (Windows-only)** · build OK. No production code, schema, UI or test was changed by this reduction — the only artifact is this document.
