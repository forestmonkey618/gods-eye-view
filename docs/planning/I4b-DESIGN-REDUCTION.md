# I4b DESIGN REDUCTION — Next-Slice Selection after I4a

**Date:** 2026-09-25
**Base:** `main` @ `ff2f0645b28fd21f819da38e20dbfef1bbabf8c1` (merge of PR #8 / I4a)
**Status:** Analysis only. **No production code, registry schema, UI or test was changed.** Stopped for owner review.
**Verdict:** **I4 is sufficiently complete for now. Proceed directly to I5a** (contract in §F). Return to I4 when one of the triggers in §D.2 happens.

Out of scope and untouched: the military `speedMps`/`track` `?? 0`/`|| 0` sticky-retention issue, stale I2 error wording, voice docs, freshness logic changes, AOIs, proximity, events, watchlists, workspaces, history, UI redesign.

---

## Evidence base

**Read:** `docs/planning/{MASTER-PLAN,REFERENCE,I4a-IMPLEMENTATION-REPORT,I3-DESIGN-REDUCTION-ADDENDUM}.md`, `docs/{SOURCE-REGISTRY,PROVENANCE,CODE-BOUNDARIES}.md`, `DATA_SOURCES.md`; `src/data/{sourceRegistry,provenance,feedState,dataCredits,transitFeeds,analystEngine,currentRecordIndex,lifecycle(getAll/isEnabled),layerState}.js`; `src/sources/live/{standalone,aircraft,vessels}.js`; `src/layers/{flights,military,vessels}/{records,queries}.js`, `layers/flights/enrichmentCore.js`; `src/ui/layerPanel.js`; `src/voice/gevActions.js` (`analystProviders`, `runAnalystQuery`, `withCanonicalIdentity`, nearest-aircraft feed block); `scripts/check-source-registry-authority.mjs`, `sourceRegistry.test.mjs`; layer `policy.js` cadence constants; CCTV/satellite geometry modules.

**Consumer facts that decide this reduction (verified by grep at the base SHA):**

| Fact | Evidence |
|---|---|
| The registry has **zero production callers** | `getSourceDescriptor` / `isRegisteredSource` / `listSourceDescriptors` appear only in `sourceRegistry.js`, its test and its boundary script |
| I3 provenance has **zero production readers** | `getProvenanceMap()` (flights/military/vessels) is called only from tests; no UI, voice or analyst path reads a provenance descriptor |
| I2 identity **does** have a production consumer | `gevActions.withCanonicalIdentity` → `buildCurrentRecordIndex` (tracked read-back) |
| Feed state **does** have production consumers | `layerPanel._buildMetaText`, layer chips, `gevActions` nearest-aircraft `feed` block, all via `layerFeedState()` |
| Key requirement **is already owned** | layer module `requiresKeyId` (FIRMS) → `lifecycle.getAll()` → `layerPanel` key-setup hint; `setup-doctor` capabilities |
| Cadence **is already owned, as GEV poll policy** | `layers/*/policy.js` (`REFRESH_MS`, `TRANSIT_POLL_MS`, `STATUS_POLL_MS`, `REFRESH_INTERVAL_MS`, …): these are GEV request rates, not upstream source facts |
| Runtime coverage **is already owned** | `stats.coverage` / `X-Flight-Coverage` (e.g. "250nm regional fallback") flows into `layerFeedState` |
| No compliance flag is read by any code | no commercial-mode switch, build profile or export path reads a restriction; `DATA_SOURCES.md` is the compliance surface |
| Only one sensor-geometry consumer exists | CCTV (`cctvFootprint.js`, `cctvViewshed.js`, `layers/cctv/geometry.js`); satellites/launches have no FOV/swath model ("footprint" in installations = building polygon) |
| **A real P4 gap exists in the one surface that emits counts to narration** | `analystProviders.getRecords` returns `[]` for a disabled layer; the engine then reports `layersQueried:[{layerKey, records:0}]`, `count:0`, which is indistinguishable from "live feed, nothing there". Stale/unavailable/fallback feeds are likewise unqualified. `runAnalystQuery` patches this ad hoc with a `Date.now()` warm-up note and a viewport note |

---

## A. Current I4 state (what I4a provides)

- `src/data/sourceRegistry.js`: the single, zero-import, frozen, deterministic authority answering *"what known external source does `sourceId` X refer to?"*
- A closed descriptor with `sourceId` and `name`, plus optional `homeUrl`, `license`, `licenseUrl` and `attribution`. An optional key is left absent when the fact isn't established.
- Four production entries, which are exactly the provenance origins production code emits: `opensky`, `adsb.lol`, `adsbdb`, `aisstream`.
- Exact-match lookup with no aliasing. Duplicate ids throw, and so does any unknown key.
- Namespace separation: `sourceId`, `storeId` and layer id stay distinct. One store may carry several sources.
- I3 stays membership-independent: `createProvenance` never consults the registry.
- `check-source-registry-authority.mjs` freezes these properties: purity, closed keys, a single construction path, no competing registry, and the grammar mirror.
- Documented gaps: `adsbdb` license and attribution are unknown; there's no compliance flag; no helper exists yet because no consumer exists yet.

**I4a satisfies I4's identity and licence half.** The rest of the MASTER-PLAN I4 paragraph is either owned elsewhere, belongs to I5 or later, or conflicts with namespace rules established after the plan was written (see B).

---

## B. MASTER-PLAN gap matrix

Legend: **Done** = satisfied by I4a · **Owned** = already owned by another authority; do not duplicate · **I5+** = belongs to a later increment · **Defer** = no consumer, revisit on trigger · **Reject** = conflicts with an established contract.

| # | Requirement (source) | Current owner | Current consumer | Static / runtime | Truthful data available? | Decision |
|---|---|---|---|---|---|---|
| 1 | Source identity: name, home URL (I4 purpose) | `sourceRegistry.js` | none yet (by design) | static | yes, for 4 sources | **Done** |
| 2 | Licence, licence URL, attribution (I4 purpose, I4 tests "every entry declares licence + attribution") | `sourceRegistry.js` (plain facts); `dataCredits.js` (rendered HTML); `DATA_SOURCES.md` (terms) | the attribution lightbox reads `dataCredits` | static | partial. `adsbdb` is unknown and the `opensky` URL is unknown. The "every entry declares" test would force guessing | **Done** within the honesty rule. "Declare always" is **rejected** because it would require invented values |
| 3 | Coverage (I4 purpose) | runtime: `stats.coverage` / `X-Flight-Coverage` → `feedState`. Spatial coverage: nobody yet | layer chip, voice feed block | **mostly runtime.** The adsb.lol 250 nm figure is GEV's request shape, not the source's reach. OpenSky's reach depends on its receiver network | no truthful static footprint for any registered source | **I5+**. Coverage is I5's spatial map, not a registry field |
| 4 | Cadence (I4 purpose; "community sensors need I4 to describe cadence honestly") | GEV poll cadence: `layers/*/policy.js` | layer schedulers | config (GEV) vs upstream (unknown) | GEV rate yes, but it's not a source fact. Upstream publish cadence isn't established for any source | **Owned** (GEV cadence) plus **I5/I9** (staleness thresholds). Don't add to the registry |
| 5 | Latency (I4 purpose) | nobody. It would be measured at runtime | none | runtime | no | **I5+**, runtime only. Never a static descriptor |
| 6 | Key requirement (I4 purpose; "names which key, like `requiresKeyId`") | layer `requiresKeyId` → `lifecycle.getAll()`; `keySetup`; `setup-doctor` | `layerPanel` key hint, doctor | deployment config. OpenSky runs anonymous *or* OAuth | yes, but it's already represented | **Owned**. `SOURCE-REGISTRY.md` explicitly excludes it. Duplicating would create two answers to one question (§8.2 invariant 1) |
| 7 | Failure modes (I4 purpose) | runtime: server fallback (OpenSky → adsb.lol), `feedState`'s seven states, `stats.error/retryInSec` | layer chip, voice | runtime behaviour | static prose only; no consumer for prose | **I5** (feed-state widening). Not a descriptor |
| 8 | "Trustworthiness stated where a layer is enabled" (I4 user-visible result) | `layerPanel` meta text (`stats.source` + feed state) | layer panel | runtime | yes, as feed state | **I5**. It's freshness/coverage presentation, not identity |
| 9 | Every registered layer resolves to a registry entry; completeness asserted against the lifecycle (I4 tests / DoD) | none | none | — | no: 21 layers, most without provenance | **Reject as written.** It requires a layer → source binding, which I4a forbids (a store can carry several sources, and `sourceId` ≠ layer id). Replacement invariant: *every `sourceId` production code emits as provenance is registered*. It's met today for all four literal ids and asserted by `sourceRegistry.test.mjs` |
| 10 | "The I5 coverage map is a pure view over [the registry]" (I4 DoD) | — | — | — | registry holds no coverage (row 3) | **I5 decides.** I5a (§F) needs no registry input. A later spatial I5 slice may *join* registry names onto source-level coverage, and that would be the first real registry consumer |
| 11 | Compliance flags for non-commercial sources (I4 tests; REFERENCE §3 "declared in the source registry") | `DATA_SOURCES.md` (TeleGeography CC BY-NC-SA, Bhote Koshi CC BY-NC, OpenSky non-commercial, Google News noncommercial, FOSSGIS restricted) | humans; no code | static | text yes. A machine vocabulary would be a legal interpretation | **Defer.** Documentation is sufficient: no code consumer, and only 1 of those 5 is a registered `sourceId`. Trigger: I11 export ("licence obligations travel", invariant 7) or a commercial build profile |
| 12 | Source type/category, capabilities (plan wishlist) | none; layer modules declare their own capabilities (`getAnalystRecords`, `getNearby`) | none | static | no vocabulary exists | **Defer** (speculative) |
| 13 | Parametric sensor geometry (D10, 0.4.3) | CCTV modules | CCTV only | static + runtime pose | CCTV only | **Defer.** The "multiple real consumers" bar isn't met (1 consumer) |
| 14 | `dataCredits.js` retained, referenced (I4 modules) | `dataCredits.js` | lightbox | static | yes | **Done** (retained). Integration: see §C.2 / Q3 |
| 15 | `TRANSIT_FEED_REGISTRY` retained as a specialisation | `transitFeeds.js` | transit layer, proxy, per-feed credit | static | yes | **Done** (retained, no relationship needed). See Q4 |
| 16 | `lifecycle.getAll()` "extended, not restructured" | `lifecycle.js` | layer panel | — | — | **Defer.** Nothing needs registry data in `getAll()`. It would also re-introduce a layer → source binding (row 9) |
| 17 | `adsbdb` licence/attribution gap (I4a known gap) | — | the attribution lightbox *should* credit displayed adsbdb enrichment | static | **unknown**; requires owner/legal verification | **Compliance follow-up**, not an I4 architecture slice (see §C.3) |

### Answers to the seven questions

1. **What I4 still requires.** Rows 1, 2, 14 and 15 are done. Rows 3, 5, 7, 8 and 10 belong to I5. Rows 4 and 6 are already owned. Rows 11, 12, 13 and 16 are deferred with no consumer. Row 9 is rejected, and its replacement invariant already holds. No remaining requirement both belongs to I4 and has a consumer.
2. **Descriptor expansion is not justified now.** Every candidate field is runtime (latency, failure, coverage), already owned (key requirement, GEV cadence), untruthful for the current four sources (static coverage, upstream cadence), or consumer-less (type, capabilities, compliance). Adding any of them now would make a schema that I5/I9 would likely replace. Unknown stays unknown.
3. **`dataCredits.js`: leave it alone.** Only 3 of its 39 credit keys correspond to registered sources (`opensky`, `adsblol` → `adsb.lol`, `aisstream`). Its keys differ from `sourceId`s. Its HTML carries usage context that the registry correctly doesn't hold ("Military flights, aircraft traces & bounded regional flight fallback: …"). Deriving credits now would create two rendering paths (3 derived + 36 hand-written) and pull display text into the registry, or make rendering the de facto authority. A registry ↔ credit consistency test covers 3 strings and is exactly the fragile sync lint REFERENCE §1.5 warns against. Defer until credits are generated from provenance-bearing layers (I11 export or a real attribution-per-answer consumer).
4. **`TRANSIT_FEED_REGISTRY`: no relationship now.** Its keys are *configured feed* identities (`mbta`, `hsl-helsinki`, …) with per-feed operational state (`defaultEnabled`, URLs, `terms`). Registry keys are *external provenance origins*. Transit records carry no I3 provenance, so no transit `sourceId` exists to resolve. If transit ever records provenance, the decision to make then is whether each feed's operator becomes a `sourceId`. It should be an explicit reviewed mapping, never a namespace merge.
5. **Compliance metadata is not an I4 requirement now.** No code consumes it. `DATA_SOURCES.md` already states each restriction in reviewed prose. A machine flag would encode a legal interpretation ("non-commercial" has per-licence nuance: OpenSky's written-agreement clause, FOSSGIS "commercial only with restrictions"). Documentation is enough until export (I11) or a commercial build profile needs a machine answer.
6. **Query helpers have no consumer.** Resolving provenance `sourceId` → descriptor needs someone reading provenance, and nobody does (`getProvenanceMap()` is test-only). Building helpers now means designing their shape against imagined callers. The first real caller will probably be I5 (naming the source behind a fallback/coverage statement) or I6/I11 (per-answer attribution), and that caller should shape the helper.
7. **I4 does not need another slice before I5.** An I4b now would ship code with no production consumer on top of a primitive (I3 provenance) that also has no production consumer. Its only verifiable output would be more tests of itself. I5a closes a live, user-facing P4 defect in the surface that narrates counts today, using authorities that already exist.

---

## C. Candidate next slices (at most three)

### C.1 — I4b "registry query helpers" (considered, not recommended)

- **Responsibility:** `resolveSources(sourceIds)` → `{resolved: descriptor[], unresolved: string[]}`, deterministic order and deduplicated. Plus a "sources represented by a provenance entry" collector.
- **Likely files:** `src/data/sourceRegistry.js` (or a sibling `sourceQueries.js`), tests, `SOURCE-REGISTRY.md`.
- **Actual consumer:** **none.** No production code reads provenance.
- **Why now:** only roadmap numbering.
- **Excludes:** freshness, lifecycle, UI, rendering, and membership validation inside I3.
- **Replacement risk:** high. The shape (per-record, per-entity or per-answer; whether a DERIVED `via` counts as a "source") is decided by the first consumer, most likely I5/I6/I11.

### C.2 — I4b "attribution coherence" (considered, not recommended)

- **Responsibility:** a test asserting that registry `attribution`/`homeUrl` appear in the matching `dataCredits.js` HTML, or deriving those 3 credits from the registry.
- **Likely files:** `dataCredits.js`, a new test, docs.
- **Actual consumer:** the attribution lightbox, but it already renders correct strings.
- **Why now:** it would reduce manual sync for 3 of 39 credits.
- **Excludes:** the other 36 credits, transit credits, rendering changes.
- **Replacement risk:** high. It creates split authority (derived vs hand-written credits), and the mapping (`adsblol` ↔ `adsb.lol`) plus prose context make string checks fragile. It will likely be superseded when credits are generated per answer or export.

### C.3 — I5a "analyst result coverage honesty" (**recommended**, see §F)

- **Responsibility:** each analyst result states, for every queried layer, whether the layer was consulted and its feed state, and always carries `coverage.unobserved[]`. This implements P4 / D8 for the one surface that currently emits counts to narration.
- **Likely files:** new `src/data/coverage.js` (named by MASTER-PLAN I5); `src/data/analystEngine.js` (optional provider plus additive coverage fields); `src/voice/gevActions.js` (`analystProviders.getLayerCoverage` only); tests; `docs/COVERAGE.md`.
- **Actual consumer:** `runAnalystQuery` → the voice model's narration (production, today), and later the T6/I6 text surface.
- **Why now:** it's a live honesty defect (a disabled or unavailable layer reads as a confirmed zero). All inputs already exist (`layerFeedState`, `isEnabled`, the analyst `coverage` block), and I6/I9/I11 all depend on I5.
- **Excludes:** spatial coverage maps, `asOf`/age computation, registry lookups, UI, narration wording, feed-state logic changes, warm-up-note replacement.
- **Replacement risk:** low. It's additive to an existing result shape. `coverage.js` is the module I5 is already slated to own, and later spatial slices extend `unobserved[]` rather than replacing it.

**Not a roadmap slice, but real:** the **`adsbdb` compliance gap** (row 17). adsbdb enrichment (type, registration, airline, route) is displayed with no credit and no `DATA_SOURCES.md` row. Closing it needs the owner to verify adsbdb's actual terms (no legal conclusion is drawn here). Then it's a docs + `dataCredits` + optional registry-field change, each an ordinary reviewed edit. Recommended as an independent owner action item, not blocking I5.

---

## D. Recommendation

**Option 2: I4 is sufficiently complete for now. Proceed directly to I5.**

### D.1 Cost comparison

| | I4b now (C.1 or C.2) | I5a now (C.3) |
|---|---|---|
| Production consumer | none | voice `analyst_query` narration (live) |
| User-visible effect | none | a disabled/stale/unavailable layer can no longer be narrated as a confirmed zero |
| Contract stability | shape guessed; likely rewritten by the first real caller | additive to the existing `coverage` block; extended, not replaced, by later I5 slices |
| Unblocks | nothing (I5a doesn't need it) | I6 (text surface shares the result), I9 (STALE interaction), I11 (coverage in briefs) |
| Churn | new API surface plus tests to maintain | about one new pure module plus two small additive edits |

### D.2 Triggers to reopen I4 (each supplies the consumer the slice needs)

1. **A production reader of provenance appears** (e.g. I5/I6 names the source behind a value or a fallback). Then add a resolve helper shaped by that caller.
2. **A layer beyond flights/military/vessels starts recording I3 provenance.** Register its true `sourceId`s, which is an ordinary entry addition.
3. **I11 export / briefs must carry licence obligations** (invariant 7), or a commercial build profile is introduced. Then design compliance fields against that consumer.
4. **A second real sensor-geometry consumer** (e.g. satellite imagery footprints). Then evaluate D10.
5. **The owner verifies adsbdb terms.** Fill the `adsbdb` descriptor, `DATA_SOURCES.md` row and credit.

### D.3 Observation recorded, not acted on

`src/sources/live/aircraft.js` has a backward-compat fallback. When no explicit `sourceId` is supplied, it infers one from the display label (`label.includes('adsb')` → `'adsb.lol'`). A label naming another "adsb"-containing provider would map to `adsb.lol`. It's unreachable on the audited production paths, which pass explicit ids. It's I3 territory and should be reviewed there. It's recorded here only because I4's identity rule says labels are never identity.

---

## E. I4b contract

Not applicable. No I4b is recommended. (If the owner overrides, C.1 is the least harmful option. It should wait for trigger 1 so its signature comes from a real caller.)

---

## F. I5a — smallest correct starting slice

### F.1 Authorities it builds on (no new authority for existing questions)

| Question | Existing owner (unchanged) |
|---|---|
| What state is this layer's feed in? | `src/data/feedState.js` `layerFeedState(stats)`: sole normalizer of the seven states |
| Is this layer enabled? | `lifecycle.js` `isEnabled(layerId)` |
| What did the query consult and where? | `analystEngine.js` `coverage` / `scopeLabel` |
| **New:** does this layer's state permit a negative claim, and if not, why? | **`src/data/coverage.js`** (new, I5 owner) |

`coverage.js` takes an already-normalized feed-state **string**. It never takes `stats`, so feed-state computation stays in one place (P2).

### F.2 Exact contract

**`src/data/coverage.js`**: pure. It imports nothing: no Cesium, DOM, wall clock, lifecycle or registry.

```js
export const UNOBSERVED_REASONS = Object.freeze([
  'layer-disabled', 'feed-loading', 'feed-unavailable', 'feed-stale',
  'feed-degraded', 'feed-partial', 'feed-fallback', 'feed-state-unknown',
]);

// → frozen {layerKey, enabled, feedState, reason}; reason null only when the
//   layer was consulted AND its feed state is exactly 'nominal'.
export function assessLayerObservation({ layerKey, enabled, feedState });

// → frozen array of frozen {layerKey, reason} for every non-null reason,
//   in input order. Empty array when every layer is enabled + nominal.
export function unobservedLayers(observations);
```

Mapping (total):

| Input | `reason` |
|---|---|
| `enabled === false` (regardless of feed state) | `layer-disabled` |
| `enabled === true`, `feedState === 'nominal'` | `null` |
| `enabled === true`, `feedState` ∈ {loading, unavailable, stale, degraded, partial, fallback} | `feed-<state>` |
| `enabled` not boolean, or `feedState` missing/unrecognized | `feed-state-unknown` (unknown is never read as nominal) |

**`src/data/analystEngine.js`**: additive only.

- New **optional** provider `getLayerCoverage(layerKey)` → `{enabled: boolean, feedState: string}`.
- Each `coverage.layersQueried` entry becomes `{layerKey, records, enabled, feedState}`. When the provider is absent, `enabled: null, feedState: null`, which assesses to `feed-state-unknown`.
- Every `ok: true` result carries `coverage.unobserved` (always an array) from `unobservedLayers`.
- **Follow-up** queries carry the remembered snapshot's `layersQueried` and `unobserved` forward unchanged. They make no new `getRecords` or `getLayerCoverage` calls.
- `count`, `items`, `summary`, `scopeLabel`, scope resolution, filters, sort, limit and all `ok: false` paths stay **byte-for-byte unchanged**.

**`src/voice/gevActions.js`**: in `analystProviders`, add `getLayerCoverage(layerKey)` returning `{enabled: dataManager.isEnabled(layerKey), feedState: layerFeedState(module.getStats?.() || {})}`. Nothing else in the file changes: the warm-up note, viewport note, Contacts reconciliation and payload shape stay as they are. `coverage` already rides along to the model.

**Docs:** new `docs/COVERAGE.md` (current-state reference, following the `PROVENANCE.md`/`SOURCE-REGISTRY.md` convention), a `CURRENT-STATE.md` pointer, and an implementation report under `docs/planning/`.

**Boundary script:** none in I5a. Purity is asserted by unit tests. Add a `check-coverage-authority.mjs` when `coverage.js` gains a second consumer (spatial slice), following the I3/I4 precedent of freezing an authority once its shape has settled.

### F.3 Deliberate exclusions

No spatial coverage or map; no `asOf`, age or staleness computation; no change to `feedState.js`, `lifecycle.js` or any layer's `getStats()`; no registry lookup; no UI or narration wording change; no voice schema change; no replacement of the `Date.now()` warm-up note. That last one is recorded as follow-on I5 debt against P9, to be addressed when `asOf` enters coverage. Also excluded: AOIs, events, history, the military `?? 0` issue.

### F.4 Acceptance tests

1. **Disabled layer is unobserved, not zero.** Querying `military` with it disabled gives `layersQueried[0]` = `{layerKey:'military', records:0, enabled:false, …}`, and `unobserved` contains `{layerKey:'military', reason:'layer-disabled'}`.
2. **Stale/unavailable feeds qualify an empty result.** An enabled `flights` layer in `stale` with 0 matches gives `unobserved` = `[{layerKey:'flights', reason:'feed-stale'}]`. Same for `unavailable`.
3. **Mapping is total and exact.** Each of the seven feed states maps to its documented reason. `enabled:false` wins over any feed state. A missing or unrecognized feed state, or a non-boolean `enabled`, gives `feed-state-unknown`, never `null`.
4. **Healthy zero stays a zero, scoped.** All queried layers enabled and nominal with 0 matches gives `count:0`, `unobserved:[]`, and the existing `scopeLabel`/`note` present.
5. **Partial answers are labeled.** `flights` nominal with N matches plus `military` unavailable gives `count === N`, and `unobserved` lists only `military`.
6. **Follow-up doesn't re-snapshot.** A follow-up query carries the prior `unobserved` and `layersQueried`. Spies prove `getRecords` and `getLayerCoverage` aren't called.
7. **Missing provider is honest.** An engine built without `getLayerCoverage` reports every queried layer as `feed-state-unknown`. All 15 existing `analystEngine.test.mjs` tests pass unmodified.
8. **Result is otherwise unchanged.** For a fixed provider set, `count`/`items`/`summary`/`scopeLabel`/`coverage.scope` are deep-equal with and without `getLayerCoverage`. Failure results (unsupported layer, unresolved region) are unchanged.
9. **`coverage.js` purity.** Outputs are frozen, inputs aren't mutated, results are deterministic, and nothing changes under a poisoned `Date.now`. The API accepts no `stats` object, so feed state can't be recomputed there.
10. **Voice wiring end to end** (`gevActions.test.mjs` harness): with a fake `dataManager` where `flights` is enabled and nominal and `military` is disabled, the `analyst_query` payload's `coverage.unobserved` names `military` / `layer-disabled`. Feed state comes from `layerFeedState(getStats())`, not a second computation.
11. **Gates.** `npm test`, `npm run check:boundaries`, `npm run format:check` and `npm run build` are green on Node 24.14.0 and 26.x.

---

## Baseline verification (this pass)

`main` = `origin/main` = `ff2f0645b28fd21f819da38e20dbfef1bbabf8c1`, clean tree. Gates run on **Node 24.14.0** (CI's calibrated runtime; fetched from the npm registry because the sandbox default is 22.22.3):

| Gate | Result |
|---|---|
| `npm run doctor -- --json` | ready: true (optional credentials unconfigured, as expected in sandbox) |
| `npm run format:check` | OK, 925 files |
| `npm run check:boundaries` | OK, all six checks including SOURCE REGISTRY AUTHORITY |
| `npm test` | **4,418 tests: 4,417 pass, 0 fail, 1 skipped** (Windows-only DACL test). Allocation benchmarks ran (not skipped) on 24.14.0 |
| `npm run build` | OK |

(On the sandbox default Node 22.22.3, `doctor` exits 1 with "too old; install Node 24.14 or newer". That's the documented environment limitation, not a repository regression.)
