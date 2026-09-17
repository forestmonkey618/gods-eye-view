# God's Eye View — Master Development Plan

**A general-purpose open-signal intelligence foundation, built in small increments.**

Reconciles three prior studies: the fork review, the V1 roadmap, and the direction study with its coverage audit. Every architectural claim was verified against the code at HEAD `0d41b6b`; nothing is inherited from a README.

**Planning document only.** No application or source code is modified by this plan. Companions: `REFERENCE.md` (verified facts the plan depends on) and `PRE-IMPLEMENTATION-AUDIT.md` (the final check before Step 0).

---

## Part 0 — What this plan reconciles, and what changed along the way

### 0.1 The three studies, and what each contributes

| Study | What it established | What this plan takes |
|---|---|---|
| **Fork review** | Component inventory; verified APIs; test/perf baselines; the do-not-break list; docs-drift findings | The module map, affected-file lists, gates, and the do-not-break list |
| **V1 roadmap** | Dependency ordering; the nine-question step format; the epistemic ladder; buckets A–D | The incremental discipline and dependency-first ordering. **Its chosen specialization is discarded**; its mechanics are retained |
| **Direction study + audit** | Foundational vs specialized split; the five substrates; the capability ladder; data-source tiers; five identities; shipped-pattern discoveries | The foundational set, boundary rules, data tiers — and corrected difficulty ratings |

### 0.2 The strategic conclusion this plan is built on

The fork is **not** competing on more data or better 3D. It competes on being the tool that answers:

> **"What do we actually know about this place or public event, which sources tell us that, how fresh is the information, what can reasonably be derived from it, and what did we NOT observe or check?"**

Three findings make that position defensible rather than aspirational.

**First — the honesty culture is already load-bearing.** These are shipped strings and comments:

- `src/ui/cockpitContext.js:56` — `'CONTACT LOST · LAST KNOWN READOUT · NOT AN ALL-CLEAR'`, with the comment above it: *"hold the last rendered readout and say so instead of re-deriving stale geometry as if it were live."*
- `src/ui/cockpitContext.js:143,144` — *"N INPUTS UNKNOWN · NOT AN ALL-CLEAR"* and *"AVAILABLE INPUTS CURRENT · NOT AN ALL-CLEAR"* — even the all-good state refuses to print a bare all-clear.
- `src/layers/awareness/queries.js:22` — a guard written to prevent a *"false all-clear"*.
- `docs/CURRENT-STATE.md:1054` — *"Without the predicate that window prints an all-clear `0`."*

**`NOT AN ALL-CLEAR` is the repo's own name for the principle this plan formalizes.**

**Second — the "one computation, many surfaces" rule is already demonstrated once.**

`src/layers/awareness/queries.js:101–124` documents that the Contacts panel and the voice analyst used to compute "how many nearby" separately: the panel read live billboard positions with a 20,000 cap; the analyst re-derived an answer from last-fix coordinates over a 2,000-record slice. *"Same question, same centre, two numbers — and in the owner's trial the spoken answer (15) and the panel (111) disagreed badly enough that the model narrated the difference away."* They were unified so they **cannot drift again**.

**Third — the foundation is partly shipped.** `src/data/analystEngine.js` is a working client-side NL query engine over typed fields with spatial scoping and follow-up memory. `dataCredits.js` + `TRANSIT_FEED_REGISTRY` are a working license registry. `layerFeedState()` is a working seven-state freshness vocabulary. **The work is completion and generalization, not invention.**

### 0.3 Corrections recorded against earlier studies

1. **Difficulty revised down** for entity identity (Major → Moderate: `{layerKey, id}` already flows through every analyst result), provenance (Major → Moderate: `layerFeedState`, `coverage`, `centeredOn`, `FIX_FLAGS` already ship), and the sensor registry (Moderate → Low-Moderate: the license registry already exists).
2. **`server/providers/cctv/cap.js` is a camera source-cap resolver, not Common Alerting Protocol.** No CAP ingestion exists anywhere in `src/` or `server/`.
3. **`src/data/detection.js` is render-density management, not anomaly detection.** `grep -rniE "anomal(y|ies)" src/` returns zero files.
4. **Three documents cited from code are absent from the checkout**: `docs/voice-engine-evaluation-2026-07-23.md` (cited at `analystEngine.js:6` as the *owner-ratified* design authority for the engine), `docs/pre-ship-audit-2026-07-01.md` (cited at `dataCredits.js:11`), and the `KNOWN-ISSUES.md:77` reference. All three hide inside backtick spans, so link checkers miss them.
5. **Correction to earlier phrasing.** The line *"People are not a query type here"* does **not** exist in the repo. The people boundary is real and structural — it lives in the absence of person-shaped fields from every layer schema, in ALPR modelling camera *hardware* rather than plate data, and in `docs/CURRENT-STATE.md:3107`'s disclaimer that the aircraft-focus feature *"is an attention-priority navigation shortcut, not a high-risk, affiliation, or threat classification."* The boundary is preserved by structure, and this plan keeps it there.
6. **CONFIRMED CORRECTNESS BUG (see `PRE-IMPLEMENTATION-AUDIT.md` §A1).** `pointInRing` mishandles rings crossing the antimeridian. Five rings in the shipped Natural Earth pack cross ±180°. Verified wrong today: `Antarctica` returns **outside** for (-80, 179), an unambiguous interior point.

---

## Part 1 — The guiding question, clause by clause

Each clause imposes a specific architectural obligation. Every increment traces to at least one row.

| Clause | Obligation | Satisfied by |
|---|---|---|
| *"What do we actually know about this place"* | Scope must be addressable — a place is a queryable object, not a camera position | **I7** AOIs |
| *"or public event"* | Events must be first-class objects with identity and time | **I9** event substrate |
| *"which sources tell us that"* | Every record carries its source; every answer names the layers consulted | **I3**, **I4** |
| *"how fresh is the information"* | Age computable per record and per feed, with three clocks distinct | **I3**, **I5** |
| *"what can reasonably be derived from it"* | Derived values labelled as derived and reproducible from the record | **I3** epistemic typing |
| *"and what did we NOT observe/check"* | Every result carries coverage; empty is never a bare zero | **I5** — `NOT AN ALL-CLEAR` generalized |
| *(implicit) same answer wherever asked* | One computation per question, shared by every surface | **I1**, **I2**, **I6**, **I8** |

---

## Part 2 — Architectural principles

Ten principles. Each states the rule, its **structural** enforcement (not convention — convention decays), and what violates it.

### P1 — Source data and deterministic computation are authoritative over AI narration

**Rule.** The model may *select, sequence and phrase*. It may not originate a number, distance, count, time or relationship. Every figure must be a field read from a computation result object.

**Enforcement.** Narration reads from the result object (`count`, `summary`, `scopeLabel`, `coverage`, `centeredOn`, `items[]`). Extend to a **receipt requirement**: any narrated figure must be attributable to a field path in a returned result. A narration that computes its own number is a defect.

**Violated by.** Any surface that re-derives a value in order to phrase it — precisely the failure `awareness/queries.js:101–124` was written to kill.

### P2 — The same question asked through different surfaces must use the same computation

**Rule.** One question, one implementation. Surfaces differ in presentation, never in arithmetic.

**Enforcement.**
1. **One module owns each question.** `geo.js` owns distance/proximity (I1); the analyst engine owns attribute query (I6); the record index owns identity (I2).
2. **A machine check.** `scripts/check-spatial-authority.mjs` (new, modelled on `check-import-directions.mjs`) fails when a raw haversine or hand-written proximity scan appears outside its owning module — **in freeze mode**: existing sites are allowlisted and the list shrinks as features migrate.
3. **Coverage echo.** Every result carries the computation's identity and parameters (`metric`, `radiusM`, `asOf`, `layersQueried`) so divergence is *visible in the payload*, not only as two different numbers on screen.

### P3 — OBSERVED, DERIVED/MODELED and INTERPRETED are structurally distinct

**Rule.** Three classes, never mixed in one container, never rendered as one another.
- **OBSERVED** — a value reported by a source, with the source's own timestamp.
- **DERIVED / MODELED** — computed deterministically from observed values by a named, inspectable operation.
- **INTERPRETED** — a judgement, including any AI-produced statement.

**Enforcement.** A `recordClass` field on every record and analysis output, required at schema level. UI containers render one class at a time with distinct treatment. A record with no `recordClass` is rejected by the same validation that rejects a bad layer registration.

### P4 — "No observation" must never automatically mean "nothing happened"

**Rule.** Absence of a record is evidence of *absence of observation* until coverage proves otherwise.

**Enforcement.** The existing **NOT AN ALL-CLEAR** rule, generalized:
- Empty or zero results must carry a non-empty `coverage` and, where relevant, `unobserved[]` / `reason`.
- UI must not render a bare `0` for a query result. Precedent: `awareness/queries.js` returns *"viewport feed is not a complete 250 km survey"* as the reason for a zero.
- Feeds in `stale`, `partial`, `fallback` or `unavailable` state suppress or qualify any negative claim derived from them.

### P5 — Coverage, staleness, unavailability and blind spots are visible, first-class data

**Rule.** What the platform cannot see is as reportable as what it can.

**Enforcement.** `layerFeedState()`'s seven states are promoted from a per-layer chip into query results and briefs. I5 adds the spatial dimension: coverage is a *map*, not only a list of feeds.

### P6 — The people boundary is structural, not editorial

**Rule.** No named-person search. No face recognition. No private-person tracking. No identifying, profiling or linking individuals.

**Enforcement — the load-bearing part.** The boundary must be **unrepresentable**, not discouraged:
- The query schema expresses only **assets, events and areas**. "Person" is not a field type, filter target, scope kind, or entity type — a person-shaped query cannot be constructed, not merely refused.
- Watchlist rules are assets/events/areas only, with an **aggregation floor**: area rules report aggregate counts and asset classes by default, so no rule can confirm an individual's presence.
- No longitudinal individual movement profile is stored or derivable.
- Person-adjacent sources (e.g. APRS) are **aggregate-only by schema**.
- Any feature whose useful form requires crossing the line gets an explicit written **boundary-change decision** first — see Part 7's third bucket.

### P7 — Prefer existing repository primitives over parallel implementations

**Rule.** Extend what exists before adding what does not.

**Enforcement.** Every increment names its **Existing primitives reused**. A step that cannot name any must justify why. This is the direct lesson of the `getNearby` inventory in Part 3.

### P8 — Preserve the render governor, security model, layer contracts and test invariants

**Enforcement.** The gates in Part 8, plus three specific constraints:
- A new layer and its `LAYER_STATE_REGISTRY` entry must land in the same commit, or `finalizeRegistrations()` throws `Layer serialization registry mismatch`.
- Any new `layerState.js` entry becomes **encodable in share links**, and token/`optional`/`absentValue` semantics are permanent once links are shared.
- `build/application-html.js`'s `APPLICATION_TEMPLATES` is a closed allowlist — adding a template file alone throws `Unknown application template`.

### P9 — Determinism: same inputs, same outputs

**Rule.** A computation is a function of its inputs. Wall-clock time enters only through an explicit, recorded `asOf`.

**Enforcement.** `asOf` is a parameter and a field in every result, never an ambient `Date.now()` inside a calculation.

### P10 — Evidence over conclusion

**Rule.** Report what was observed, where, when, how far, by which source. No scores, no suspicion rankings, no "linked to", no unqualified causal claims.

**Enforcement.** Co-location and correlation outputs are phrased as facts with distance and timestamp. No numeric suspicion score exists anywhere in the data model. `docs/CURRENT-STATE.md:3107`'s disclaimer is the standing posture.

**Vocabulary note.** "Threat" is overloaded. The `thermal-threats` scene concerns **physical hazard** (fires, earthquakes) — legitimate. But `src/data/detectionDraw.js:127` documents `resolveTier` as returning a *"threat tier"* when its values are domain **categories** (`civil`/`military`/`sea`/`space`/`vehicle`). **Decision D3: rename the comment to "category tier"; do not rename `resolveTier`.** Step 0 T2.

---

## Part 3 — The canonical spatial authority

This is the highest-priority item, because distance and proximity appear in search, AOIs, `nearby`, correlation, camera discovery and watchlists — the six capabilities that must never disagree. Settled **before** any of them is built.

### 3.1 Full inventory, classified by the question each answers

Several of these are *not* spatial queries and **must not be unified**; doing so would be a regression.

**Class A — Geographic distance (unify into `geo.js`)**

| # | Location | Signature / convention | Radius | Formula |
|---|---|---|---|---|
| 1 | `data/analystEngine.js:69` | `haversineKm(lat1, lon1, lat2, lon2)` — **exported** | `EARTH_R_KM = 6371` | `asin` |
| 2 | `data/naturalEarthRegions.js:38` | `haversineKm(lon1, lat1, lon2, lat2)` — **LON FIRST, private** | `EARTH_RADIUS_KM = 6371` | `asin` |
| 3 | `data/transitFeeds.js:326` | `haversineKm(aLat, aLon, bLat, bLon)` — exported | literal `6371` | `asin` |
| 4 | `layers/bikeshare/model.js:54` | `haversineKm(aLat, aLon, bLat, bLon)` — private | literal `6371` | `atan2` |
| 5 | `layers/cctv/model.js:300` | `haversineKm(lat1, lon1, lat2, lon2)` — private | literal `6371` | `atan2` |
| 6 | `data/routePlausible.js:17` | `greatCircleKm(lat1, lon1, lat2, lon2)` — exported | `R_KM = 6371` | `atan2` |
| 7 | `data/trafficBounds.js:31` | `greatCircleKm(lat1, lon1, lat2, lon2)` — exported | `EARTH_RADIUS_KM = 6371` | `asin` |
| 8 | `data/regionalModel.js:153` | inline | `6371000` (m) | `atan2` |
| 9 | `hud.js:598` | inline | `6371` | `atan2` |
| 10 | `layers/alpr/policy.js:40` | `EARTH_MEAN_RADIUS_M = 6371008.8` — constant only | `6371008.8` | — |

**Class B — Scene-space proximity (unify behind one `nearby()` contract)**

| # | Location | Signature | Default cap | Metric |
|---|---|---|---|---|
| 11 | `layers/flights/queries.js:538` | `getNearby(center, range, maxCount=50, {includeHidden})` | 50 | `Cartesian3.distance` |
| 12 | `layers/military/queries.js:326` | `getNearby(center, range, maxCount=50, {includeHidden})` | 50 | `Cartesian3.distance` |
| 13 | `layers/vessels/queries.js:294` | `getNearby(centerCartesian, rangeM, maxCount=25)` | 25 | `Cartesian3.distance` |
| 14 | `layers/installations/controls.js:25` | `getNearby(center, rangeM, maxCount=50)` | 50 | `Cartesian3.distance` |
| 15 | `layers/awareness/queries.js:130` | `collectAircraftProximityWindow(position, {radiusM, subject})` | 2 families | composed |

**Class C — Measurement (three copies of one function)**

| # | Location | Note |
|---|---|---|
| 16 | `annotations/drawMode.js:49` | `greatCircleM(a, b)`, `R = 6371000` — exported, **canonical candidate** |
| 17 | `annotations/annotationEngine.js:1532` | `greatCircleM` — duplicate |
| 18 | `cockpitCloudEffects.js:129` | `greatCircleM` — third copy |
| 19 | `data/contactPlayback.js:194` | local `distance(a, b)` |

**Class D — Camera / viewer range (DO NOT UNIFY — "how far from the viewer", not "how far on Earth")**

`annotations/screenAnnotationRenderer.js:414`, `cameraVerbs.js:1126,1392,1512`, `data/detection.js:1342`, `data/focusDeemphasis.js:235,492`, `data/localGeojsonCore.js:863,912,966,991,1096,1164,1183`, `layers/alpr/presentation.js:81,304,418`, `layers/awareness/focus.js:123`, `layers/awareness/rendering.js:243`, `layers/awareness/subject.js:337`.

**This distinction is the most important judgement in Part 3.** Camera-to-object distance in world space is a *rendering* concern (LOD, fade, culling, framing) and is correctly `Cartesian3.distance` against `camera.positionWC`. The bug is not that both metrics exist; the bug is that a **user-facing question** ("within 250 km") is answerable by either without declaring which.

### 3.2 Which disagreements are real

| Difference | Severity | Evidence |
|---|---|---|
| **Radius constant** | **Negligible.** `6371` km and `6371000` m are the *same* radius; only `6371008.8` differs, by 8.8 m — 1.4 × 10⁻⁶, i.e. **0.35 m at 250 km** | Arithmetic on the constants |
| **Formula (`asin` vs `atan2`)** | **Negligible.** Algebraically identical; they diverge only in floating-point behaviour near antipodal points | Both forms in Class A |
| **Argument order** | **A live trap, not a current bug.** `naturalEarthRegions.js` is the only `(lon, lat, …)` implementation, and it is **private**, so it cannot be called wrongly from outside. A call copied between it and any other module would silently swap latitude and longitude | `naturalEarthRegions.js:38` vs every other Class A row |
| **Metric (surface vs slant)** | **Real, demonstrable, user-visible** | Quantified below |

**The metric disagreement, quantified.** `haversineKm` measures great-circle distance **on the sphere**; `Cesium.Cartesian3.distance` measures the **straight line through space**, so altitude participates.

- *At the boundary:* a 250 km **surface**-radius window includes an aircraft at 12 km altitude whose ground range is exactly 250.0 km — but that aircraft is **250.29 km away by slant**, sitting ~290 m inside a limit it would fail under a slant test.
- *In ordering, where it bites:* aircraft A at 249.0 km ground range / 20 km altitude (slant ≈ 249.80 km) vs aircraft B at 249.5 km ground range / 0.5 km altitude (slant ≈ 249.50 km). **Surface says A is nearer; slant says B is nearer.** Opposite answers to *"which of those is closest?"* — a question the analyst engine answers today, with no screen admitting it is being answered differently from the panel beside it.

That inversion is the concrete mechanism by which the 111-versus-15 class of defect could return.

### 3.3 DECIDED — one authority, two named metrics, one rule

**Decision D1 — default geographic metric: `SURFACE`.** Surface/geographic distance for all user-facing geographic windows, proximity, ordering and questions such as "within 250 km" or "which is closest?". Slant/3D remains available for situations where physical sensor-to-object distance is genuinely the question — e.g. future line-of-sight and sensor analysis.

**Decision D2 — canonical spherical radius: `6,371,008.8 m`** (IUGG mean, already present at `alpr/policy.js:40`).

**Do not collapse to a single formula.** Surface and slant answer different questions, and later line-of-sight work needs slant to be correct. Collapse instead to **one authority**: a single module owns every decision that currently varies — argument order, radius, units, formula, and *which metric applies to which question*.

**New module: `src/data/geo.js`.**

```
src/data/geo.js  — the single spatial authority

export const EARTH_RADIUS_M = 6371008.8;   // IUGG mean. One radius.

export const METRIC = Object.freeze({
  SURFACE: 'surface',   // great-circle on the sphere — "how far apart on Earth"
  SLANT:   'slant',     // 3D including heightM — "how far from the sensor"
});

// Argument order is (lat, lon) EVERYWHERE. No exception, no overload.
export function distanceM(a, b, { metric = METRIC.SURFACE } = {});
export function geodesicM(a, b);           // near-exact, for REPORTED numbers
export function bearingDeg(a, b);
export function destinationPoint(a, bearingDeg, distanceM);
export function withinM(a, b, radiusM, opts);
export function nearbyM(items, ref, radiusM, { metric, cap, key } = {});
export function ringContains(ring, lat, lon);   // antimeridian-correct (see I1b)
export function ringAreaM2(ring);               // re-export
```

**The five rules that make disagreement impossible.**

- **R1 — Argument order is `(lat, lon)`, always.** The `(lon, lat)` convention is retired at the boundary. Coordinates are `{lat, lon, heightM?}` objects or two positional numbers in that order.
- **R2 — Metres internally, always.** `haversineKm`/`greatCircleKm` are not exported from `geo.js`. Kilometre display formatting is a *surface* concern.
- **R3 — The metric is named whenever a distance reaches a user**, echoed into `coverage.metric` alongside `radiusM` and `asOf`.
- **R4 — Two tiers by purpose.** Hot paths use `distanceM` (spherical, allocation-free). **Numbers reported as evidence use `geodesicM`** (`Cesium.EllipsoidGeodesic.surfaceDistance`, exact on WGS84, Cesium already a dependency). **A reported measurement never comes from the fast path.**
- **R5 — `SLANT` requires heights and says so.** If either endpoint lacks a finite `heightM`, `SLANT` degrades to `SURFACE` **and records that it did** (`metricResolved: 'surface'`, `degraded: 'missing-height'`). It never silently substitutes a different quantity.

**Enforcement: `scripts/check-spatial-authority.mjs` (new)**, wired into `npm run check:boundaries`. It fails when:
- a haversine / great-circle / `Math.asin(Math.sqrt(…))` pattern appears in `src/` outside `src/data/geo.js` and outside the **shrink-only freeze allowlist**;
- a `getNearby` implementation exists outside the single nearby contract (I8);
- a `Cartesian3.distance` call is made against a **non-camera** reference outside `geo.js`.

**Class D sites are explicitly allowlisted and stay**, with a comment explaining why, so a future contributor does not "fix" them.

### 3.4 Migration strategy — scoped, not repo-wide

The migration is deliberately **behaviour-preserving except where behaviour is wrong**, and proven by test before anything depends on it. Per `PRE-IMPLEMENTATION-AUDIT.md` §A2, it is **deliberately scoped** so that spatial authority does not become a repo-wide refactor.

**I1a — Create and freeze (the only part that must happen up front).**
1. Add `src/data/geo.js` with no callers but the reference test.
2. Land `geo.test.mjs` (metric semantics, degradation, determinism) and `geo.differential.test.mjs`, evaluating every Class A implementation against `geo.distanceM` over a grid (poles, antimeridian, equator, existing fixtures) with a stated epsilon. **This measures real divergence before any change.**
3. Land `check-spatial-authority.mjs` in **freeze mode**: every current site is allowlisted; new raw haversines fail. The allowlist shrinks as features migrate. **The check freezes the surface area; it does not demand a big-bang cleanup.**

**I1b — Ring containment correctness (a confirmed bug, fixed here because I7 depends on it).**
`pointInRing` (`naturalEarthRegions.js:268`) is naive ray-casting in raw lon/lat space with **no antimeridian handling**. Five shipped Natural Earth rings cross ±180°: Antarctica, East Antarctica, Polar Plateau, Arctic Ocean, Southern Ocean. Verified wrong today against the unmodified function: **`Antarctica` returns outside for (-80, 179)**, an unambiguous interior point. Because `analystEngine.applyScope` uses it for `kind: 'region'`, a region-scoped analyst query over those five regions returns a wrong count *today*.
Fix: `geo.ringContains` splits a crossing ring at ±180° and tests the parts (or equivalent), with tests over all five affected rings. `naturalEarthRegions.pointInRing` becomes a re-export.

**I1c — Migrate what a dependent feature needs (not everything).**
4. Migrate the **exported, user-facing** distance functions: `analystEngine.haversineKm`, `routePlausible.greatCircleKm`, `trafficBounds.greatCircleKm`, `transitFeeds.haversineKm`, `layers/cctv/model.js`, `layers/bikeshare/model.js`.
5. Collapse Class C's three `greatCircleM` copies into the `drawMode.js` export.
6. Convert the **flights and military** `getNearby` implementations to surface-consistent, because those two feed the awareness window that must agree with the analyst. **Vessels and installations migrate at I8**, when the contract lands.
7. `regionalModel.js` (inline, private), `hud.js` (inline, display-only), and `naturalEarthRegions`'s private (lon-first) helper migrate **naturally** as I7 moves ring maths into `geo.js`. No dedicated refactor.

**Behaviour change is confined to high-altitude aircraft near a window edge**, and every such change is a defect being corrected. **Deliberate choice: proximity windows default to `SURFACE`** because (a) "250 km window" is a map promise, (b) it is stable when a feed momentarily reports altitude as null — an unstable count is worse than a slightly different one, and (c) it matches existing panel wording.

**Definition of done for Part 3.** One authority; no haversine/great-circle definition outside `geo.js` other than the freeze allowlist; three `greatCircleM` copies reduced to one; flights/military `getNearby` surface-consistent with the analyst; ring containment correct for all five crossing regions; `check-spatial-authority.mjs` green and wired into `check:boundaries`; differential test in the suite; a boundary and ordering test asserting the §3.2 A/B inversion returns the *same* answer through the panel and the analyst.

---

## Part 4 — Which candidates are genuinely foundational

Test: **does this capability make every *other* capability cheaper, or does it consume them?** Foundations are multipliers; products are consumers.

| # | Candidate | Verdict | Reasoning |
|---|---|---|---|
| 1 | **Canonical proximity / spatial queries** | **FOUNDATIONAL — first** | Six of the fifteen depend on it; divergence accumulates daily |
| 2 | **Entity identity / record index** | **FOUNDATIONAL** | Precondition for correlation, watchlists, change detection, briefs |
| 3 | **Provenance and epistemic typing** | **FOUNDATIONAL** | Converts every other output from assertion into evidence |
| 4 | **Source / sensor registry** | **FOUNDATIONAL** | Input to coverage, compliance, blind-spot analysis; half-built as a licence registry |
| 5 | **Feed freshness and coverage state** | **FOUNDATIONAL** | Implements P4; turns `layerFeedState` from a chip into a trust layer |
| 6 | **Cross-layer text + NL analyst search** | **FOUNDATIONAL** | The interface to everything else; engine exists, gap is 5-of-18 layers and a text box |
| 7 | **AOIs** | **FOUNDATIONAL** | Turns "a place" into a queryable object; scope primitive for watchlists and briefs |
| 8 | **Event / change bus** | **FOUNDATIONAL** | Watchlists, briefs and alerts consume change |
| 9 | **Watchlists (assets, events, areas)** | **FOUNDATIONAL, dependent** | Direction-agnostic and high-leverage, but dishonest before identity + scope + events exist |
| 10 | **Area / event briefs** | **FOUNDATIONAL as the payoff** | A brief *is* the guiding question — the product of the layer beneath it |
| 11 | **Public-camera proximity + LOS** | **SPLIT** | The **proximity contract** is foundational (I8). **Line-of-sight is specialization-leaning** and waits |
| 12 | **Infrastructure context** | **FOUNDATIONAL-LOW, cheap** | Highest value-per-line in the list; it is enrichment, so it waits behind the trust layer |
| 13 | **Correlation** | **LATER (depends)** | Needs identity + provenance + events + coverage; earlier it manufactures "linked to" |
| 14 | **Anomaly detection (defensible baseline only)** | **LATER, conditional** | Needs retained series, coverage-aware baselines, a first-class "unknown" |
| 15 | **Workspaces / case files** | **LATER (depends)** | Durable provenance plus export; before provenance it saves assertions without evidence |
| 16 | **Coverage / blind-spot analysis** | **FOUNDATIONAL, emergent** | Not a separate build — what I4 + I5 + the spatial layer produce; gets its own increment because it is the platform's most distinctive output |

### 4.1 The dependency graph

```
                      ┌─────────────────────────────┐
   I1 geo.js ────────►│ spatial authority           │  no dependencies
                      └──────────┬──────────────────┘
                                 │ every spatial capability
                                 ▼
   I2 recordIndex ──────────────► identity ──────────┐
   I3 provenance ───────────────► trust layer ───────┤
   I4 registry ─────────────────► capability meta ───┤
   I5 coverage ─────────────────► freshness ─────────┤
                                                     │
   I6 analyst search ◄── needs I2 + I3 + I1
   I7 AOIs ◄──────────── needs I1 + I3
   I8 nearby + discovery ◄ needs I1 + I2 + I7
   I9 event bus ◄─────── needs I2 + I3 + I5
   I10 watchlists ◄───── needs I2 + I7 + I9
   I11 briefs ◄───────── needs I3 + I5 + I7 + I9   ← the guiding question, as an artefact

   LATER:  correlation ◄ I2+I3+I9+I5    anomaly ◄ I5 + retained series
           workspaces  ◄ I3+I11         LOS ◄ I8        infra ◄ I1+I4
```

I1 is a true prerequisite (everything spatial). I2–I5 are the trust layer and can proceed in parallel — different modules. I6–I9 are surfaces on the trust layer. I10–I11 are the payoff. **Nothing depends on historical playback.**

---

## Part 5 — Step 0: small first changes that expose what already exists

Ordered smallest-first. Each is independently shippable, leaves the app usable, and keeps the suite green. **Amendments from `PRE-IMPLEMENTATION-AUDIT.md` are marked ⌁.**

**T1 — Repair three dangling code-cited document references.**
`analystEngine.js:6` cites `docs/voice-engine-evaluation-2026-07-23.md` as the owner-ratified design authority for the engine; `dataCredits.js:11` cites `docs/pre-ship-audit-2026-07-01.md`; `KNOWN-ISSUES.md:77` cites a height-datum handover report. None exist. Restore the documents or correct the citations to a surviving source.
*Why first:* For a platform whose identity is provenance, its own query engine's design authority being unverifiable is the cheapest credibility defect to fix. *Risk:* none, documentation only.

**T2 — Retire the word "threat" from a non-hazard code path.** (**Decision D3: YES**)
`src/data/detectionDraw.js:127` documents `resolveTier` as a *"threat tier"* when its values are domain categories. Reword to "category tier"; **do not rename `resolveTier`**. `thermal-threats` (fires/earthquakes) legitimately keeps the word. *Risk:* none, comment only.

**T3 — Extend `ANALYST_LAYERS` to three more layer families.** ⌁
⌁ **Cheaper than originally scoped.** The record path is already a uniform contract: `analystProviders.getRecords` (`gevActions.js:4145`) routes through **`mod.getAnalystRecords(limit)`**, implemented today by exactly 5 layers (`earthquakes`, `firms`, `flights`, `military`, `vessels`). So T3 = implement `getAnalystRecords` on three chosen families + add their field tables to `ANALYST_LAYERS`. **No `gevActions` change is needed**, and an unknown layer already fails with a courteous refusal rather than a wrong answer.
*Risk:* low; a wrong field name yields a filter matching nothing — cover with a per-layer field-table test.

**T4 — Collapse three `greatCircleM` copies into one.**
`annotations/drawMode.js:49` exports it; `annotationEngine.js:1532` and `cockpitCloudEffects.js:129` are duplicates. Delete the copies, import the original. *Risk:* none if truly identical — verify first.

**T5 — Land the differential distance test (measurement only).** ⌁ Uses **Decision D1 (SURFACE)** and **D2 (6,371,008.8 m)** as the reference. Changes no production code. *Risk:* none.

**T6 — Surface the analyst engine's `coverage` block.**
Results already return `coverage: {layersQueried, scope, note, followUp}`, plus `scopeLabel` and `centeredOn`. Display them rather than only speaking them. First visible application of P4. *Risk:* low, additive display.

**T7 — Expose aircraft-class filtering in the layer panel.**
`classifyAircraft()` and the class tables exist; the voice path already filters via `normalizeAircraftClassFilter` (`gevActions.js:2729`); the layer panel has no filter UI at all. ⌁ **Route the panel filter through the same normalization the voice path uses** — if panel and voice disagree on what "heavy" means, that is P2 violated on day one. *Risk:* low.

**T8 — Give the CCTV family a `getNearby`.** ⌁ **PRECEDED BY I1a.** `layers/cctv/model.js` has its own `haversineKm` (line 300) but no proximity query. Add one — but have it call `geo.distanceM` from day one rather than adding a tenth distance call site. This makes T8 the **first real consumer of the spatial authority**. *Risk:* low.

**T9 — Show feed state on the layer panel row.**
`layerFeedState()` already normalizes seven honest states and drives control chips. Surface the same state on the panel row. *Risk:* low, but **presentation only** — must not alter `getStats()` semantics or lifecycle behaviour.

**T10 — Give the analyst engine a text input.** ⌁ **SMALLER than originally scoped.**
`analyst_query` is reachable only through voice. ⌁ **The shared provider factory already exists**: `analystProviders(viewer, dataManager, {placeSearch, resolveRegionRing})` at `gevActions.js:4125`, returning `getRecords`, `resolveRegionRing`, `getContextSubject`, `getViewContext`. No extraction is required — only **reuse/export** it so the text surface constructs the engine identically.
*Risk:* moderate for this list — wiring, not arithmetic. **Do not let the text surface build its own engine.** *Done:* the same question typed and spoken returns the same `count`, `scopeLabel` and `coverage`.

---

## Part 6 — The increments

Eleven increments, each independently shippable and each carrying the nine required elements. **I1 and I6 are the two large ones**; the rest are small-to-moderate.

### I1 · The canonical spatial authority
**Purpose.** One module owns every spatial decision (argument order, radius, units, formula, metric) so search, AOIs, `nearby`, correlation, camera discovery and watchlists cannot disagree. Includes **I1b**, the confirmed ring-containment bug.
**User-visible result.** Distances that agree across surfaces; region-scoped queries correct over Antarctica and the polar oceans.
**Existing primitives reused.** `drawMode.greatCircleM` (canonical measurement), `ringAreaM2`, `ringCentroid`, `analystEngine.haversineKm`, `alpr/policy.js`'s `EARTH_MEAN_RADIUS_M`, Cesium `EllipsoidGeodesic`, `check-import-directions.mjs` as the check-script pattern.
**Modules affected.** `data/analystEngine.js`, `data/naturalEarthRegions.js`, `data/transitFeeds.js`, `data/routePlausible.js`, `data/trafficBounds.js`, `layers/bikeshare/model.js`, `layers/cctv/model.js`, `annotations/drawMode.js`, `annotations/annotationEngine.js`, `cockpitCloudEffects.js`, `layers/{flights,military}/queries.js`, `package.json`.
**New modules.** `src/data/geo.js`; `scripts/check-spatial-authority.mjs`; `geo.test.mjs`; `geo.differential.test.mjs`.
**Tests.** Differential (legacy vs `distanceM` over polar/antimeridian/equatorial grid); metric degradation records *why*; boundary membership + **ordering** test asserting the §3.2 A/B inversion returns one answer; argument-order regression; **all five antimeridian rings**.
**Performance/security risks.** `distanceM` runs in scans over tens of thousands of records — allocation-free, never a `Cartesian3` per comparison. `geodesicM` allocates; reported numbers only. No security surface.
**Dependencies.** None — the root of the graph.
**Definition of done.** As Part 3's closing paragraph.

### I2 · Canonical entity identity and the record index
**Purpose.** One addressable identity for "the same aircraft/vessel/camera/quake" across layers and time.
**User-visible result.** Consistent answers about an entity regardless of source layer; no double-counting a contact present in two feeds.
**Existing primitives reused.** The analyst engine's **already-emitted `{layerKey, id}` identity**; `awareness/queries.js`'s `isSame(subject, item, layerKey, idField)`; per-layer identity fields in `ANALYST_LAYERS` (`icao24`, `mmsi`); `TRACKING_ID_GRAMMAR`'s principle that an out-of-grammar id is rejected rather than truncated.
**Modules affected.** `data/analystEngine.js`, `layers/awareness/queries.js`, `layers/{flights,military,vessels,cctv,earthquakes,installations}/queries.js`, `voice/gevActions.js`.
**New modules.** `src/data/recordIndex.js` + test. **No new layer** — no `layerState.js` entry, no share-link token.
**Tests.** Key stability across refresh; cross-layer de-duplication; malformed-id rejection; **a person-shaped key is not expressible**.
**Performance/security risks.** The index must not become per-entity history — that is a movement profile (P6). **Index current identity and last-seen, never a trajectory.** Bound and evict.
**Dependencies.** I1.
**Definition of done.** Every family declares identity fields; one identity function shared by engine and awareness; a tested guarantee of no trajectory.

### I3 · Provenance and epistemic typing
**Purpose.** Every value can say where it came from, when it was true, and which class it belongs to.
**User-visible result.** Answers carry source, timestamp, age and class; derived values are visually distinct from observed; AI output is never styled like a reading.
**Existing primitives reused.** `layerFeedState()`'s seven states; the analyst's `coverage`/`centeredOn`; `contactPlayback.js`'s **three clocks** (`FIX_FLAGS.VEHICLE_TIME | FEED_TIME | RECEIPT_TIME`); `DATA_CREDITS` per-source attribution; `groundFloor.js`'s *"a visual floor, not a survey"* labelling precedent.
**Modules affected.** `data/analystEngine.js`, each family's `records.js`/`ingestion.js`, `data/contactPlayback.js`, `voice/gevActions.js`, `src/ui/*`.
**New modules.** `src/data/provenance.js` + tests.
**Tests.** No OBSERVED without source + timestamp; age against explicit `asOf`; AI statements classed INTERPRETED **by construction**; **narration receipt test** (every narrated figure resolves to a field).
**Performance/security risks.** Per-record metadata increases memory in hot layers — measure against the baseline and share a source descriptor by reference. **Do not store raw upstream payloads**; retention can violate redistribution terms.
**Dependencies.** I2.
**Definition of done.** Every result and briefed value carries source, timestamp, age, class; classes cannot share a container; receipt test in the suite.

### I4 · Source / sensor registry
**Purpose.** One registry describing what each source *is* — coverage, cadence, latency, licence, key requirement, failure modes.
**User-visible result.** A layer's trustworthiness stated where it is enabled; conditional attribution continues to appear only when data is displayed.
**Existing primitives reused.** `src/data/dataCredits.js` — 35-array entries + four named conditional credits + `registerDynamicCredit` (**39 credit keys**) — which already solves licence display and static-vs-conditional distinction. `TRANSIT_FEED_REGISTRY` is the stronger precedent: `{license, licenseUrl, attribution, terms:{quote, note}}` including usage constraints (MBTA forbids logo use). The layer module is already a capability-declaration document (`name`, `icon`, `source`, `requiresKeyId`, `showInTogglePanel`).
**Modules affected.** `data/dataCredits.js` (retain; referenced), `data/transitFeeds.js` (retain as a specialisation), each layer's `index.js`, `data/lifecycle.js` (`getAll()` extended, not restructured).
**New modules.** `src/data/sourceRegistry.js` + tests. **No new layer.**
**Tests.** Every enabled layer resolves to a registry entry; every entry declares licence + attribution; **completeness asserted against the lifecycle's registered layers** so a new layer without an entry fails the suite; compliance flags for known non-commercial sources.
**Performance/security risks.** The registry holds **key requirements, never key material** — it names which key a layer needs, exactly as `requiresKeyId` does today. Runtime metadata, not shareable state.
**Dependencies.** I3.
**Definition of done.** Every registered layer has a complete descriptor; the I5 coverage map is a pure view over it; no key material.

### I5 · Coverage, freshness and blind-spot surface
**Purpose.** Answer *"what did we NOT observe or check?"* and enforce P4.
**User-visible result.** A coverage view showing where each source can and cannot see, which feeds are stale/partial/degraded/fallback/unavailable, and a non-suppressible coverage statement on every answer. **A zero states its scope and limits.**
**Existing primitives reused.** `layerFeedState()`'s seven states; `awareness/queries.js`'s honest-zero precedent returning *"viewport feed is not a complete 250 km survey"*; `CURRENT-STATE.md:1054`; the cockpit's shipped **`NOT AN ALL-CLEAR`** strings; `stats.coverage`.
**Modules affected.** `data/feedState.js` (retain, widen), `data/lifecycle.js`, `ui/layerPanel.js` + CSS, `data/analystEngine.js` (coverage gains the spatial dimension and `unobserved[]`).
**New modules.** `src/data/coverage.js` + tests.
**Tests.** An empty result **must** carry coverage or explicit `unobserved[]` (asserted invariant); stale sources suppress negative claims; spatial-limit coverage.
**Performance/security risks.** Compute on demand with explicit `asOf`, never in the render loop. **Report presence and freshness, never an assessment of what is inadequately watched** — the line between "we can't see here" and "this is unwatched."
**Dependencies.** I3, I4.
**Definition of done.** `NOT AN ALL-CLEAR` semantics enforced in code for every query surface; registry-derived coverage view; empty-result invariant as a test.

### I6 · Analyst search generalization: all families, text surface, aggregates
**Purpose.** Make the most under-exposed capability the primary interface.
**User-visible result.** A text box answering questions across all 18 families, with grouping and time windows, always stating what it measured.
**Existing primitives reused.** Essentially all of it: `createAnalystEngine` and its pure helpers, the **`ANALYST_LAYERS` field-typing schema** (already the safety mechanism making LLM-generated queries answerable), follow-up memory, the injected `resolveRegionRing`, `runAnalystQuery`, the **existing `analystProviders` factory**, and **`getAnalystRecords(limit)`** as the uniform record accessor. Existing coverage: `analystEngine.test.mjs` — 203 lines, 15 tests, including scope naming, radius centring, follow-up memory and honest failure.
**Modules affected.** `data/analystEngine.js`, `voice/gevActions.js`, `voice/actionSchemas.js`, `src/ui/*`, `data/recordIndex.js`.
**New modules.** `src/data/analystSurface.js` (shared provider assembly for voice and text), aggregate/group support inside the engine.
**Tests.** Parameterised tests across every family's field table; text and voice identical for identical questions; unsupported-layer refusal; `limit` clamping; follow-up memory; **an unknown operator cannot reach the engine from a model-generated argument**.
**Performance/security risks.** **The largest injection surface in the plan.** Mitigations: the field-typing schema limits the model to existing fields, and the engine must validate operators and values against the declared type rather than trusting arguments. Never `eval`, expressions or `Function` construction. Aggregates need a row cap and must not become per-frame work.
**Dependencies.** I1, I2, I3, I5.
**Definition of done.** All 18 families queryable; one shared factory used by voice and text; receipt test passes; no unvalidated model argument reaches computation.

### I7 · AOIs as first-class scope
**Purpose.** Turn "a place" into a queryable object.
**User-visible result.** Draw or name an area, name it, use it as scope everywhere.
**Existing primitives reused.** **The injection seam already exists**: `analystEngine` documents and injects `resolveRegionRing(name) → Promise<{ring, name}|null>` (resolved at `analystEngine.js:197`, wired at `gevActions.js:328`, implemented at `annotations/resolver.js:1884`, consumed at `gevActions.js:608,975`). **An AOI is a new resolver behind an existing interface — no engine schema change.** Plus `applyScope`'s `region` kind, `pointInRing` → `geo.ringContains`, `drawMode` drawing + `ringAreaM2`/`ringCentroid`/`formatMeasure`, and the `layerState` codec's durability pattern.
**Modules affected.** `annotations/resolver.js`, `annotations/annotationEngine.js`, `data/analystEngine.js`, `voice/gevActions.js`, `voice/actionSchemas.js`, `src/ui/*`, `data/naturalEarthRegions.js`.
**New modules.** `src/data/aoi.js` + tests. **No new layer** — an AOI is a scope object, not a rendered layer. **Exception: if AOIs become shareable they enter the share-link grammar and their token semantics become permanent (P8) — Decision D4, deferred.**
**Tests.** AOI scope equals an equivalent radius scope; **antimeridian-crossing polygon** (now covered by I1b); persistence round-trip through the existing codec; empty AOI result carries coverage.
**Performance/security risks.** Precompute the bounding box and reject before point-in-ring. **AOI geometry is user input and becomes durable state** — validate and bound vertex count, area and coordinate ranges.
**Dependencies.** I1, I3.
**Definition of done.** AOI scope from voice and UI through the existing injected resolver, no engine schema change; bounding-box and antimeridian paths tested.

### I8 · The proximity contract, and asset/camera discovery
**Purpose.** One `nearby()` contract every layer can implement.
**User-visible result.** Given any point, one coherent provenance-carrying answer spanning every enabled family, with distance and metric declared.
**Existing primitives reused.** **The unification precedent is already written**: `awareness/queries.js::collectAircraftProximityWindow` is documented as *"the aircraft-proximity engine. One computation, two consumers"* — written precisely because the panel (111) and the analyst (15) disagreed. Generalize it from two families to all. Reuses the four existing `getNearby` signatures, `isSame` for subject exclusion, `geo` for the metric, and the record index for identity.
**Modules affected.** `layers/{flights,military,vessels,installations}/queries.js` (adapters; **public signatures preserved**), `layers/cctv/queries.js`, `layers/awareness/queries.js` (becomes a consumer), `data/analystEngine.js` (a `nearby` scope kind), `voice/gevActions.js`.
**New modules.** `src/data/nearby.js` + tests; possibly `layers/cctv/proximity.js`.
**Tests.** Contract conformance per implementer (shape, metric declaration, ordering); component-wise equivalence against current behaviour; **subject-exclusion parity** with awareness; one answer regardless of surface; degraded-metric test (R5).
**Performance/security risks.** Composition multiplies per-record work — bounding-box rejection first, bounded records, existing per-layer caps preserved so render-governor assumptions hold. Distance scans must not run per frame.
**Dependencies.** I1, I2, I7.
**Definition of done.** One contract, five implementers, identical result shape; four legacy signatures unchanged; a single cross-family answer available to search, AOIs, camera discovery and watchlists.

### I9 · The event / change bus and the change log
**Purpose.** Turn live feeds into *stated* changes with a time, place and source.
**User-visible result.** An activity view listing what changed and when, each carrying source, timestamp and coverage.
**Existing primitives reused.** `lifecycle.js:2299 subscribeActivity(callback)` / `_publishActivity(change)` publishes `status`, `destroy-all`, `data-updated` (with `layerId`), `visibility-settled`, `params-settled`. **Be precise about the gap: the bus says "redraw", not "here is what changed"** — its single subscriber (`src/app/layerPresentation.js:17`) converts them into render reasons such as `layer-tick:${layerId}`. This increment computes the difference and publishes a richer payload, reusing I2 (what is genuinely new), I3 (labelling), I5 (coverage) and `getStats()`.
**Modules affected.** `data/lifecycle.js` (publish a diff-bearing event type **without** altering the five existing types or their consumers), `app/layerPresentation.js` (unchanged for render reasons), layer `lifecycle.js`/`ingestion.js`, `data/analystEngine.js`.
**New modules.** `src/data/eventLog.js`, `src/data/eventRules.js` + tests. **Do not add a layer for events until I5 establishes coverage.**
**Tests.** Threshold fires once per crossing, not per tick (**flapping test**); first-seen fires only for genuinely new identities; every event carries source/timestamp/coverage; **feed-fault suppression** — a stale feed must not generate "nothing detected" events; determinism against `asOf`.
**Performance/security risks.** Diffing every layer every tick is the likeliest performance regression — compute per layer on its own cadence. **An unbounded event log is a movement-profile generator**: retain events about *areas, assets and hazards*, not per-entity chronology.
**Explicit non-goal — no time machine.** This log answers *"what changed, and what were we watching?"* — **no playback, no seek, no rewind**, and deliberately no frame-by-frame position record. Historical playback remains very low priority and nothing in this plan depends on it.
**Dependencies.** I2, I3, I5.
**Definition of done.** Change events with source/timestamp/class/coverage; flapping and fault-suppression tests green; no per-entity chronology; no playback surface.

### I10 · Watchlists — assets, events and areas only
**Purpose.** Standing questions about a place or class of asset — with a person-shaped rule **impossible to express**.
**User-visible result.** "Tell me when a new fire appears inside this AOI", "when a vessel of this class enters this strait", "when this feed goes stale during an event". Aggregate by default.
**Existing primitives reused.** I2 identity, I7 AOIs, I9 events, I5 coverage, and the **analyst engine's filter/scope vocabulary** — a rule *is* a saved analyst query evaluated against the event stream, so the safety property already exists: the schema expresses only declared fields, operators and scope kinds. `layerState.js`'s reject-wholesale validation posture is the model.
**Modules affected.** `data/analystEngine.js`, `data/eventRules.js`, `src/ui/*`, `voice/gevActions.js`, `voice/actionSchemas.js`.
**New modules.** `src/data/watchlist.js` + the most important test suite in the plan.
**Tests.** **Schema-expressiveness tests are the point:** a person-shaped rule must be *unrepresentable* — no person field type, no name-valued operator, no individual-identity scope target — asserted by **enumerating the accepted schema**, not by trying a few forbidden examples. **Aggregation-floor tests.** Rule validation rejects unknown fields wholesale. **A rule over a stale source reports "not evaluated — source stale"** rather than silence (P4 applied to automation).
**Performance/security risks.** Standing rules evaluate continuously — per-layer cadence from I9, cache rule state, cap rule count and cost. **A rule that could answer "is a specific person here?" must be structurally impossible**, because watchlists are the feature most likely to be repurposed. Notifications must never be phrased as alerts about people.
**Dependencies.** I2, I7, I9.
**Definition of done.** Rules expressible only over assets/events/areas; aggregation floor enforced in code and tested; stale-source rules say so; no rule targets an individual.

### I11 · Briefs — the guiding question, as an artefact
**Purpose.** Assemble everything into the one output the platform exists to produce.
**User-visible result.** Select an AOI or event and produce a brief: what is observed, from which sources, at what timestamp and age; what is derived and how; what is uncertain; what was not observed and why; and the licence obligations for everything included. Exportable.
**Existing primitives reused.** The whole trust layer (I2–I5, I7, I9), plus `dataCredits.js` attribution strings, `drawMode.formatMeasure()`, the MGRS grid, `director/sharing/bundle.js`, and the analyst engine's `coverage`/`scopeLabel`/`centeredOn` as the brief's skeleton.
**Modules affected.** `data/analystEngine.js`, `data/coverage.js`, `data/provenance.js`, `data/sourceRegistry.js`, `src/ui/*`, `voice/gevActions.js`, `director/sharing/*`.
**New modules.** `src/data/brief.js`, `src/ui/brief*` + tests. **No new layer.**
**Tests.** A brief over a stale feed names the staleness; a brief with no observations states coverage rather than reporting emptiness; **every number resolves to a computation with declared metric, `asOf` and source**; attribution present for every included source; deterministic for a fixed `asOf`.
**Performance/security risks.** Compute on demand, never in the render path. **Export is where licence obligations travel with the data** — a brief containing TeleGeography cables (CC BY-NC-SA) or Open-Meteo data inherits those terms. **Do not include sources whose terms forbid redistribution.**
**Dependencies.** I3, I5, I7, I9.
**Definition of done.** Reproducible for a fixed `asOf`; every figure receipted; coverage and non-observation always present; licence obligations travel with the export.

---

## Part 7 — The three buckets

### 7.1 BUILD NOW

Step 0 (T1–T10) + I1–I11, ordered by dependency:

| Order | Item | Why now |
|---|---|---|
| 0 | T1–T10 small exposures | Safe, immediate; several shrink later increments |
| 1 | **I1** Spatial authority (+ I1b ring bug) | Root of the graph; six capabilities depend on it; a confirmed correctness bug sits inside it |
| 2 | **I2** Identity + record index | Precondition for correlation, watchlists, change detection, briefs |
| 3 | **I3** Provenance + epistemic typing | Nothing else is safe to show a user before this exists |
| 4 | **I4** Source/sensor registry | Halves as licence compliance; already half-built |
| 5 | **I5** Coverage, freshness, blind spots | Implements P4 — the clause of the guiding question nothing answers today |
| 6 | **I6** Analyst search generalization | The interface to everything else |
| 7 | **I7** AOIs | Makes "this place" a first-class object; a near-pure extension of an existing seam |
| 8 | **I8** Proximity contract + discovery | The whole-exceeds-the-parts capability at the engine level |
| 9 | **I9** Event/change bus + change log | Watchlists and briefs both consume change |
| 10 | **I10** Watchlists (assets/events/areas) | High-leverage and direction-agnostic; honest only once I2/I7/I9 exist |
| 11 | **I11** Briefs | The guiding question as a citable artefact |

Every item is justified as useful **regardless of eventual specialization**; ten of eleven are required by all five candidate identities in the direction study. None presumes a domain.

### 7.2 BUILD LATER

| Capability | What unlocks it / why it waits |
|---|---|
| **Workspaces / case files** | Needs I3 + I11. Earlier, it saves assertions without evidence |
| **Correlation engine** | Needs I2 + I3 + I5 + I9. Earlier, it manufactures "linked to" |
| **Anomaly detection** | Needs I5 + retained series + a first-class "unknown"; aggregate-series-only scoping |
| **Line-of-sight / viewshed** | Needs I8. `cctvViewshed.js`, `cctvFootprint.js`, `groundFloor.js` already provide the geometry |
| **Infrastructure enrichment** | Needs I1 + I4 + I8. Cheapest high-value item once proximity exists |
| **Drift physics** | Direction-leaning; needs I1. NOAA HYCOM/OSCAR/NCODA are Tier-B sources |
| **Community sensor networks** | A new source class; needs I4's registry to describe cadence honestly |
| **Education / directed scenes** | Director machinery exists; best as a secondary identity |
| **Export / field pack** | Needs I11's provenance rules so licence terms travel |
| **Overpass & illumination planning** | Needs I1; `hud.js::_estimateSunElevation` already exists |

### 7.3 DO NOT BUILD — or requires a conscious boundary change

**7.3.1 Never — violates the boundary (P6)**

| Item | Why excluded |
|---|---|
| **Named-person search** | Making "person" expressible in the query schema destroys the platform's central property |
| **Face recognition** | Permanently out of scope |
| **License-plate tracking of private individuals** | Precise distinction: the ALPR layer models **camera hardware** in space — infrastructure context. Plate reads, plate matching, or vehicle tracking by plate are a different system and excluded |
| **Private communications interception** | Unconditional |
| **Social-media person-location** | Person-centric by construction |
| **Circumventing access controls, scraping private systems, leaked data** | Excluded on principle; it would also poison the platform's only real asset — trustworthiness about sourcing |
| **Per-entity longitudinal movement profiles** | The subtlest exclusion, because it looks like a feature: storing where one aircraft/vessel has been recreates tracking by another route. Keep identity current + last-seen, never a trajectory (I2) |
| **Threat scores, risk rankings, suspicion scores** | P10 and `CURRENT-STATE.md:3107`'s existing posture |
| **Vulnerability / single-point-of-failure views of infrastructure** | Infrastructure is context, never targeting. "We cannot see here" is permitted; "this is inadequately watched" is not |
| **Anomaly detection on individual movement patterns** | Aggregate series and asset classes only |
| **A general AI agent that asserts uncited facts** | An agent that computes or asserts outside returned results violates P1 |

**7.3.2 Requires a conscious, written boundary change first**

Not condemned — but they must not arrive by drift, and each needs a recorded decision before implementation:

1. **Missing-person SAR.** Asset-only SAR (vessels, aircraft, drifting objects, beacons) is clean. A missing-person capability is person-centric and conflicts with P6; it would require an explicit written carve-out — authority-initiated, declared, time-bounded, no face recognition, no identity database, no general person search. The direction study recommends asset-only.
2. **Person-adjacent data as a source class.** APRS is person-operated; admissible only in aggregate, and only if the schema enforces aggregation.
3. **CAD / dispatch / 911 feeds.** Legitimate for professionals; access is restricted and the data is person-adjacent; cannot be an ordinary-developer dependency.
4. **Anything requiring a person-shaped field.** The answer is a recorded boundary decision, not a new field.

**7.3.3 Deliberately deprioritized (not forbidden)**

- **Historical playback / the "time machine".** Very low priority, and **this plan is deliberately constructed so nothing depends on it.** I9's log answers *"what changed and what were we watching?"* — no seek, no rewind, no frame-by-frame position record. If playback is ever wanted, the trust layer built here is what would make it honest, so deferring costs nothing.
- **Better 3D / competing with upstream on visuals.** The strongest ground the upstream already owns.
- **A competing full AI agent.** The valuable AI work is I3's honesty about what is known, not a general assistant.

---

## Part 8 — Gates, invariants and what must not break

### 8.1 The gate every increment must pass

```
npm test                          # 4,144 passing / 0 failing at HEAD; must not regress
npm run check:boundaries          # import directions + package boundaries
                                  # + the new scripts/check-spatial-authority.mjs (I1)
scripts/qa-perf.mjs               # render-governor and performance baseline
scripts/track-regression.mjs      # regression tracking
<increment's own qa-*.mjs>        # for any increment touching rendering or lifecycle
```

**Environment notes.** The sandbox Node version (v22.22.3) is below the repo's `engines` range (`>=24.14 <25 || >=26 <27`), producing an `EBADENGINE` warning and skipping both allocation microbenchmarks — expected, not a failure to fix by reinstalling. Browser-dependent QA scripts cannot run where no Chromium is present.

### 8.2 Invariants that must hold after every increment

1. **One computation per question.** No second implementation of distance, proximity, identity, feed state or licence lookup.
2. **No bare zero.** Every empty result carries coverage or an explicit non-observation reason.
3. **No unclassified value.** Every record and output carries `recordClass`.
4. **No person-shaped field.** Enforced by schema enumeration, not by review.
5. **No trajectory.** The record index holds identity and last-seen, never movement history.
6. **Determinism.** Computation depends on explicit `asOf`, never ambient time.
7. **Licence obligations travel.** Attribution and terms accompany any export.
8. **Render governor untouched.** New work computes outside the render loop or through the existing governor.

### 8.3 The do-not-break list

- The layer lifecycle contract and the **serialization registry** — a new layer plus its `LAYER_STATE_REGISTRY` entry must land in the same commit, or `finalizeRegistrations()` throws `Layer serialization registry mismatch`.
- **Share-link token semantics are permanent** once links exist in the wild; the codec's reject-wholesale rule must survive.
- The **closed template allowlist** in `build/application-html.js` — a new template file alone throws `Unknown application template`.
- **Input ownership** and key handling (the security model).
- The **five existing activity change types** and their single render consumer.
- `getStats()` semantics — presentation may consume them, never redefine them.
- The **250 km awareness window**'s subject-exclusion semantics.
- The three **`FIX_FLAGS` clocks** — never collapse them into one timestamp.

---

## Part 9 — Decisions requiring owner input

| # | Decision | Status |
|---|---|---|
| **D1** | **Default geographic metric** | **DECIDED — `SURFACE`.** Surface/geographic distance for all user-facing geographic windows, proximity, ordering and questions such as "within 250 km" or "which is closest?". Slant/3D remains available where physical sensor-to-object distance is genuinely the question, such as future line-of-sight/sensor analysis |
| **D2** | **Canonical spherical Earth radius** | **DECIDED — `6,371,008.8 m`** (IUGG mean; already present at `alpr/policy.js:40`) |
| **D3** | **"Threat tier" wording** | **DECIDED — YES.** Rename the misleading developer description/comment only. **Do not rename `resolveTier`** unless later implementation reveals a technical reason |
| D4 | AOIs in share links | **DEFERRED to I7.** If yes, fix the token grammar before the first link is shared — semantics are permanent (P8) |
| D5 | Watchlist notification surface | **DEFERRED to I10.** Plan recommends in-app first; notifications later and opt-in |
| D6 | Event log retention | **DEFERRED to I9.** Plan recommends workspace-scoped with an explicit bound |
| D7 | Whether the ALPR layer stays | **DEFERRED, owner's call.** Plan recommends: keep, off by default, labelled as publicly-mapped camera infrastructure |
| D8 | Empty-result enforcement | **DEFERRED to I5.** Plan recommends a hard failure plus an architecture script |

---

## Closing

The plan's claim is narrow and testable: **the fork's advantage is not that it knows more, but that it can say what it knows and what it does not.** Three things already in the codebase — the `NOT AN ALL-CLEAR` strings, the "one computation, two consumers" engine written to stop the panel saying 111 while the voice said 15, and a licence registry built because the law required it — show that this culture is already load-bearing rather than aspirational.

What is missing is **generality**. Nine distance implementations drifted apart because nothing owned the answer; four `getNearby` variants accumulated because nothing owned the contract; five Natural Earth rings have been silently mis-tested because nothing owned ring containment; three documents are cited that do not exist. None of that is a rebuild. It is completion, in small increments, each leaving the application working.

Build the trust layer first. Every direction you might later choose — public safety, journalism, emergency management, asset SAR, environmental monitoring, or simply understanding what is happening outside — needs exactly the same foundation, and none of them needs it built differently.
