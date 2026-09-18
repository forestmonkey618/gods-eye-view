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

### 0.4 ATAK-CIV comparative study (2026-09) — accepted findings

**Study date:** 2026-09. **Scope:** deep comparative architecture study of ATAK-CIV against God's Eye View. The research repo is not assumed present in this checkout; only the accepted findings below are incorporated.

#### 0.4.1 Core result — GEV foundation validated

ATAK did **NOT** invalidate GEV's foundational architecture. The existing broad dependency sequence (Step 0 → I1 → I2/I3/I4/I5 → I6/I7/I8/I9 → I10/I11) remains sound. Do **NOT** rewrite the master plan from scratch.

Preserved principles (reaffirmed, not new):

- deterministic data/computation is authoritative
- AI interrogates/narrates authoritative state rather than inventing reality
- OBSERVED / DERIVED / INTERPRETED remain distinguishable
- provenance remains first-class
- freshness remains first-class
- coverage and blind spots remain first-class
- absence of observation is not evidence of absence
- general-purpose substrate before specialization
- public/open lawful signals remain the core
- no named-person search
- no face recognition
- no private-person tracking
- no longitudinal movement-profile database
- no threat/suspicion scoring
- local-first remains valuable
- do not turn GEV into ATAK or a military C2 product

#### 0.4.2 Five accepted changes

**Change 1 — I7 expands to User Spatial Objects + AOIs (most important).** See I7 for full expansion. Summary: do not build separate persistent geometry systems for saved AOIs, persistent marks, geofence boundaries, corridors, investigation landmarks, brief subjects. I7 evolves from named polygon rings into a general-purpose User Spatial Object foundation. Two concepts remain distinct: **Ephemeral telestration** (short-lived whiteboard, optimized for explanation/pointing/voice) and **User Spatial Object** (explicitly saved persistent geometry that can participate in deterministic analysis). Future model must be capable of point/pin, polygon, radial circle, corridor (polyline + width/buffer), bounding box/rectangular area. General-purpose, data-oriented, avoid class-hierarchy over-engineering. A saved object may serve one or more semantic roles: analyst query scope / AOI, watch/geofence boundary, saved reference mark, investigation/workspace object, brief subject. Avoid duplicating geometry between those systems. **Persistence mechanism and schema NOT locked** — do not prematurely decide localStorage vs IndexedDB, `persistent: true` flag, storage keys, serialization format. Decide at milestone.

**Change 2 — Formal transient vs persistent lifecycles.** New principle P11. Transient feed state (live ADS-B aircraft, AIS vessels, earthquakes, continuously refreshed external records) vs persistent user knowledge (saved spatial objects, AOIs, watchlists, investigation notes, workspace state, explicitly saved references). Lifecycle distinction, not storage technology. High-volume feed records must not accidentally become permanent local history merely because persistence exists elsewhere. Persistent user knowledge must survive appropriate application/session boundaries once persistence is implemented. No longitudinal per-entity movement history. No storage technology decision yet.

**Change 3 — I9 must define edge-triggered state transitions.** Expand I9 design requirements. Coarse activity bus and raw update/diff concepts insufficient for future watchlists/alerts/briefs. I9 must eventually establish deterministic, edge-triggered lifecycle/spatial transitions with vocabulary at least: APPEARED, UPDATED, STALE, DEPARTED, ENTERED_SCOPE, EXITED_SCOPE (names may adjust if GEV terminology dictates, preserve semantics). ENTERED_SCOPE is outside→inside edge only; EXITED_SCOPE is inside→outside; do not emit repeatedly while inside. STALE is a meaningful transition, not merely a display property. Design must eventually define prior-state ownership, transition thresholds, source cadence/freshness interaction, anti-flapping behavior, how recordIndex/provenance/source health/eventLog divide responsibility. Do NOT blindly put all temporal/provenance state inside recordIndex. Preserve separation: I2 identity/indexing, I3 provenance/epistemic, I4 source/sensor capability, I5 coverage/blind spots, I9 meaningful transitions/change history. Determine exact ownership when I9 is designed.

**Change 4 — Selection deconfliction as later UI requirement (I8).** Future map-interaction requirement for dense scenes: when multiple selectable entities overlap or fall within same practical click/touch area, do not silently choose arbitrary contact. Future UI should offer compact candidate-selection/deconfliction interaction. Candidate info might include identity/callsign/label, layer/domain, distance, bearing — already available. Belongs around I8/discovery/interaction. NOT a current foundational blocker. Do not implement now.

**Change 5 — Workspaces / Briefs should eventually be reproducible.** ATAK's data-package concept reinforced useful idea, but GEV adapts for open-signal analysis rather than copying mission packages. Future Workspaces/Briefs should be able to describe a reproducible analytical context including, where appropriate: spatial scope / User Spatial Objects, temporal/as-of context, selected layers, source/provider references, provenance, user-created knowledge objects, coverage/blind-spot context, relevant license/attribution obligations. Do not define final package format now. Do not adopt ATAK Mission Package XML or CoT. Planning clarification for later milestones (I11 and BUILD LATER workspaces).

#### 0.4.3 Deferred finding — parametric sensor geometry

ATAK demonstrated value in generalized parametric sensor geometry model: origin, azimuth, elevation, horizontal FOV, vertical FOV, range, etc. Could eventually unify public camera direction/FOV, sensor coverage, satellite/imagery footprints, other directional sensing models.

**Decision:** DO NOT REOPEN I1. Spatial authority work already completed and intentionally scoped. Do not add sensor-frustum abstraction merely because ATAK has one. Instead, record as something to evaluate when I4 Source/Sensor Registry and I5 Coverage are actually designed. At that point, inspect GEV's real camera/CCTV/satellite needs and introduce generalized sensor descriptor only if multiple real consumers justify it.

#### 0.4.4 Concepts explicitly NOT adopted from ATAK

GEV is **NOT** adopting:

- Cursor-on-Target XML as internal/wire architecture
- MIL-STD tactical symbology
- friendly/hostile classifications
- threat scoring
- suspicion scoring
- combat workflows
- tactical chat/PTT architecture
- longitudinal individual/entity movement databases
- ATAK's Android component/broadcast architecture
- ATAK's plugin architecture wholesale

GEV may learn abstract lessons from mature systems without inheriting domain assumptions. Document only where useful; do not clutter plan unnecessarily.

#### 0.4.5 Important corrections to ATAK research report

Do not blindly incorporate every recommendation from research report:

1. DO NOT reopen I1 to add parametric sensor geometry. Defer evaluation to I4/I5 (see 0.4.3).
2. DO NOT automatically assign observedAt/staleAt/accuracyM ownership to recordIndex. Useful concepts, but ownership must respect I2/I3/I4/I5/I9 boundaries.
3. DO NOT lock persistence to localStorage, IndexedDB, or specific schema yet.
4. DO NOT eliminate ephemeral annotations. Ephemeral telestration and persistent User Spatial Objects are different capabilities and both useful.
5. DO NOT treat ATAK architecture as authoritative. Adapt only concepts that strengthen GEV's general-purpose architecture.

#### 0.4.6 Sequencing after ATAK

Preserve broad sequence: Step 0 → I1 Spatial Authority → I2 Identity/Record Index → I3 Provenance/Epistemic Typing → I4 Source/Sensor Registry → I5 Coverage/Blind Spots → I6 Analyst Search → I7 User Spatial Objects/AOIs → I8 Proximity/Discovery → I9 Event/Change Semantics → I10 Watchlists → I11 Briefs.

Do not reorder I1–I6 based on ATAK. I7 expanded. I8 gains later selection-deconfliction requirement. I9 gains formal state-transition semantics. I10 and I11 consume stronger foundations.

Implementation state note: spatial-foundation work (I1 `src/data/geo.js`) has already been implemented and merged. This plan reconciles language with that reality and does not reopen I1 for sensor geometry. D9 flights/military `getNearby` measurement (SURFACE vs SLANT due to ECEF center) is now RESOLVED as DUAL SEMANTICS, SURFACE authoritative for geographic proximity (see Part 3.4 and Part 9 D9) — DECISION resolved, IMPLEMENTATION pending (current code still uses `Cartesian3.distance`).

---

## Part 1 — The guiding question, clause by clause

Each clause imposes a specific architectural obligation. Every increment traces to at least one row.

| Clause | Obligation | Satisfied by |
|---|---|---|
| *"What do we actually know about this place"* | Scope must be addressable — a place is a queryable object, not a camera position | **I7** User Spatial Objects / AOIs |
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

### P11 — Transient feed state vs persistent user knowledge are distinct lifecycles

**Rule.** High-volume, continuously refreshed external records and explicitly saved user knowledge have different lifecycle requirements and must not be conflated.

**Transient feed state — examples:** live ADS-B aircraft, AIS vessels, earthquakes, other continuously refreshed external records. These are ephemeral by nature, refreshed on a cadence, and must not accidentally become permanent local history merely because persistence exists elsewhere in the application. No longitudinal per-entity movement history (P6).

**Persistent user knowledge — examples:** saved spatial objects, AOIs, watchlists, investigation notes, workspace state, explicitly saved references. This must survive appropriate application/session boundaries once persistence is implemented.

**Enforcement.** Architectural boundary, not storage-technology choice. Do NOT lock to localStorage vs IndexedDB, `persistent: true` flag, storage keys, or final serialization format yet — decide at milestone (see I7). The important decision is the lifecycle distinction itself. I7, I10, I11 are consumers of persistent knowledge; I2/I3/I5/I9 must not cause transient feed state to be retained as history.

### P12 — Ephemeral telestration vs persistent User Spatial Objects

**Rule.** Temporary visual annotation/whiteboard behavior and explicitly created persistent geometry are different capabilities; both are useful, neither replaces the other.

**Ephemeral telestration:** existing short-lived visual annotation/whiteboard behavior, optimized for explanation, pointing, temporary marks and voice interaction. Does NOT automatically become persistent operational object.

**User Spatial Object:** explicitly created/saved persistent geometry that can participate in deterministic analysis (search scope, watch boundary, reference mark, investigation object, brief subject). See I7.

**Enforcement.** Preserve existing ephemeral annotation system. Do not promote every voice/drawing annotation to persistent storage. I7 defines the persistent model (point/pin, polygon, radial circle, corridor, bounding box) as general-purpose, data-oriented, without over-engineered class hierarchy, and capable of serving multiple semantic roles without duplicating geometry.

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

**D9 RESOLVED — flights/military `getNearby` metric: DUAL SEMANTICS, SURFACE authoritative for geographic proximity.**

Current implementation (`src/layers/flights/queries.js:538`, `src/layers/military/queries.js:326`) still computes `getNearby` as `Cesium.Cartesian3.distance(center, pos)` where `center` is ECEF. That is effectively a 3D slant distance from the subject aircraft's ECEF position, not a surface great-circle distance. **Implementation remains PENDING — see Part 9 D9.**

**Resolved architectural contract (owner decision 2026-09, recorded here):**

1. **SURFACE distance is the authoritative geographic proximity metric in GEV.**
2. `distanceM` represents canonical SURFACE distance for geographic proximity operations.
3. SURFACE distance governs:
   - radius membership
   - cutoff filtering
   - geographic proximity/discovery
   - standard proximity sorting
   - AOIs
   - watch/geofence boundaries
   - ordinary map/contact rosters
   - analyst/search questions such as "within X km"
   - ordinary user-facing geographic distance narration
4. **SLANT distance represents physical three-dimensional separation.**
5. SLANT must be an explicitly named secondary metric and must NEVER silently substitute for geographic `distanceM`.
6. SLANT is appropriate only when the consumer's actual question requires physical 3D range, such as:
   - cockpit/3D target telemetry
   - future line-of-sight calculations
   - future sensor/range calculations
   - other explicitly 3D physical-range questions
7. **SLANT distance must NOT alter membership in a geographic proximity radius.**

Example: An aircraft directly overhead may correctly have:
   - surface distance = 0 km
   - slant range = 10.7 km (at 35,000 ft)
Those values answer different questions. Another: aircraft 10 km away geographically at 35,000 ft: SURFACE ≈ 10 km, SLANT ≈ 14.6 km.

8. We are **NOT yet deciding** that every `getNearby` result must eagerly calculate or carry `slantDistanceM`. Whether slant range is eagerly attached, lazily calculated, or calculated only by specialized 3D consumers is an **implementation detail** to determine from actual consumers when D9 is implemented. Do NOT lock that contract into the architectural decision.

**Why resolved this way:** Focused research found current flights/military `getNearby` uses ECEF `Cartesian3.distance`, so altitude currently participates in membership/sorting. However GEV presents these results as geographic proximity windows — Awareness UI draws a 250 km circle on Earth's surface and labels it 250 KM FLIGHT / VESSEL WINDOW. Under slant cutoff, high-altitude aircraft whose ground projection is inside displayed circle can be excluded because 3D slant exceeds 250 km, so deterministic computation can disagree with geographic boundary shown. Both metrics legitimate but answer different questions. Existing analyst/geographic-query semantics already favor SURFACE for "within X km". ATAK comparative research independently supported separation (ordinary map proximity/roster sorting/geofence use geographic/surface, explicit slant reserved for specialized 3D range/targeting). ATAK is supporting evidence only; decision based on GEV's own semantic requirements.

**Scope limits (must not be expanded in this doc task):**
- Do NOT automatically add `slantDistanceM` to records
- Do NOT decide eager vs lazy slant computation
- Do NOT automatically migrate vessels
- Do NOT automatically migrate installations
- Do NOT touch camera-relative/rendering distance sites (Class D)
- Do NOT modify `src/data/geo.js`
- Do NOT reopen completed I1 spatial authority
- Do NOT change production code at all

D9 directly resolves semantic ambiguity for flights/military `getNearby`. Other layer migrations (vessels, installations) remain governed by existing spatial migration plan and should be changed only when required by actual consumer contract. See Part 9 D9 for authoritative wording.

**Parametric sensor geometry — I1 intentionally NOT reopened.**

ATAK study demonstrated value in generalized parametric sensor geometry (origin, azimuth, elevation, horizontal FOV, vertical FOV, range, etc.) that could unify public camera direction/FOV, sensor coverage, satellite/imagery footprints, other directional sensing. Decision: DO NOT reopen I1 to add this abstraction. Spatial authority work (`src/data/geo.js`) is intentionally scoped and already merged. Evaluate generalized sensor descriptor only when I4 Source/Sensor Registry and I5 Coverage are designed, and only if multiple real consumers (CCTV, satellite footprints, etc.) justify it. See 0.4.3.

**Definition of done for Part 3.** One authority (`src/data/geo.js` exists, see implementation note in 0.4.6); no haversine/great-circle definition outside `geo.js` other than the freeze allowlist; three `greatCircleM` copies reduced to one; ring containment correct for all five crossing regions; `check-spatial-authority.mjs` green and wired into `check:boundaries`; differential test in the suite; a boundary and ordering test asserting the §3.2 A/B inversion returns the *same* answer through the panel and the analyst.

**D9 status:** Decision RESOLVED — DUAL SEMANTICS, SURFACE authoritative for geographic proximity (see above and Part 9 D9). Implementation PENDING — current code (`flights/queries.js:538`, `military/queries.js:326`) still uses `Cartesian3.distance` (slant). Docs must distinguish DECISION resolved vs IMPLEMENTATION pending, and must not claim surface-consistent until code matches. Vessels/installations NOT automatically mandated for migration by D9; governed by existing migration plan.

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
| 7 | **User Spatial Objects / AOIs** | **FOUNDATIONAL** | Turns "a place" into a queryable, persistent object; general-purpose spatial object foundation (point/pin, polygon, radial circle, corridor, bbox) for AOI scope, geofence/watch boundaries, saved reference marks, investigation/workspace objects, brief subjects. Avoids duplicating geometry between those systems. Ephemeral telestration remains distinct. |
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
   I7 User Spatial Objects / AOIs ◄ needs I1 + I3  (expanded: general-purpose persistent geometry)
   I8 nearby + discovery ◄ needs I1 + I2 + I7  (plus later selection-deconfliction)
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

### I7 · User Spatial Objects / AOIs as first-class scope (expanded per ATAK study)

**Purpose.** Establish a general-purpose, persistent User Spatial Object foundation that replaces separate geometry systems for saved AOIs, persistent user marks, geofence boundaries, corridors, investigation landmarks, and brief subjects. Turn "a place" into a queryable, persistent object that can participate in deterministic analysis.

**ATAK lesson incorporated:** GEV should not build separate persistent geometry systems for saved AOIs, persistent marks, geofence boundaries, corridors, investigation landmarks, brief subjects. I7 evolves from narrowly treating AOIs as named polygon rings into a general-purpose User Spatial Object foundation. See 0.4.2 Change 1.

**Two concepts, both useful:**

1. **Ephemeral telestration** — existing short-lived visual annotation/whiteboard behavior. Optimized for explanation, pointing, temporary marks and voice interaction. Does NOT automatically become persistent operational object. Preserve existing system.

2. **User Spatial Object** — explicitly created/saved persistent geometry that can participate in deterministic analysis. Future model must be capable of representing at least:
   - point / pin
   - polygon
   - radial circle
   - corridor (polyline + width/buffer)
   - bounding box / rectangular area where useful

General-purpose and data-oriented. Do not over-engineer a class hierarchy now. A saved spatial object should eventually be capable of serving one or more semantic roles, such as:
   - analyst query scope / AOI
   - watch/geofence boundary
   - saved reference mark
   - investigation/workspace object
   - brief subject

Avoid duplicating geometry between those systems.

**Persistence — explicitly NOT locked yet.** Exact persistence mechanism and schema are NOT yet locked. Do NOT prematurely decide localStorage vs IndexedDB, a `persistent: true` implementation flag, final storage keys, final serialization format. Those are implementation decisions to make when the milestone is reached. Record architectural boundary (P11): high-volume transient feed records must not become permanent history merely because persistence exists elsewhere; persistent user knowledge must survive appropriate session boundaries once implemented. No longitudinal per-entity movement history.

**User-visible result.** Draw or name an area, save it as persistent object, name it, use it as scope everywhere, as geofence/watch boundary, as investigation reference, as brief subject. Ephemeral annotations remain for quick explanation.

**Existing primitives reused.** **The injection seam already exists**: `analystEngine` documents and injects `resolveRegionRing(name) → Promise<{ring, name}|null>` (resolved at `analystEngine.js:197`, wired at `gevActions.js:328`, implemented at `annotations/resolver.js:1884`, consumed at `gevActions.js:608,975`). **An AOI / User Spatial Object is a new resolver behind an existing interface — no engine schema change.** Plus `applyScope`'s `region` kind, `pointInRing` → `geo.ringContains`, `drawMode` drawing + `ringAreaM2`/`ringCentroid`/`formatMeasure`, and the `layerState` codec's durability pattern. Ephemeral annotation system (`annotations/*`) remains.

**Modules affected.** `annotations/resolver.js`, `annotations/annotationEngine.js`, `data/analystEngine.js`, `voice/gevActions.js`, `voice/actionSchemas.js`, `src/ui/*`, `data/naturalEarthRegions.js`. Future persistent store module (deferred).

**New modules.** `src/data/userSpatialObjects.js` (or `aoi.js` evolved) + tests covering geometry types. **No new layer** — a User Spatial Object is a scope/knowledge object, not a rendered layer. **Exception: if spatial objects become shareable they enter the share-link grammar and their token semantics become permanent (P8) — Decision D4, deferred. Persistence mechanism deferred.**

**Tests.** AOI scope equals an equivalent radius scope; **antimeridian-crossing polygon** (now covered by I1b); geometry type coverage (point, polygon, circle, corridor, bbox); semantic-role attachment (same geometry usable as query scope and watch boundary without duplication); persistence round-trip (once mechanism chosen); empty AOI result carries coverage; ephemeral telestration does NOT auto-persist.

**Performance/security risks.** Precompute the bounding box and reject before point-in-ring. **User Spatial Object geometry is user input and becomes durable state** — validate and bound vertex count, area and coordinate ranges. Transient feed state must not be retained as history (P11).

**Dependencies.** I1, I3. Consumes P11/P12 lifecycle distinction.

**Definition of done.** User Spatial Object model capable of point/pin, polygon, radial circle, corridor, bbox as data-oriented general-purpose objects; AOI scope from voice and UI through existing injected resolver, no engine schema change; same geometry reusable as query scope, watch boundary, reference mark, investigation object, brief subject without duplication; ephemeral telestration preserved as distinct; bounding-box and antimeridian paths tested; persistence mechanism decision deferred but lifecycle boundary documented.

### I8 · The proximity contract, and asset/camera discovery (plus future selection deconfliction)

**Purpose.** One `nearby()` contract every layer can implement, plus future UI requirement for dense-scene selection deconfliction.

**User-visible result.** Given any point, one coherent provenance-carrying answer spanning every enabled family, with distance and metric declared. Later, when multiple selectable entities overlap or fall within same practical click/touch area, UI offers compact candidate-selection/deconfliction interaction rather than silently choosing arbitrary contact (see below).

**Existing primitives reused.** **The unification precedent is already written**: `awareness/queries.js::collectAircraftProximityWindow` is documented as *"the aircraft-proximity engine. One computation, two consumers"* — written precisely because the panel (111) and the analyst (15) disagreed. Generalize it from two families to all. Reuses the four existing `getNearby` signatures, `isSame` for subject exclusion, `geo` for the metric, and the record index for identity.

**Future requirement — selection deconfliction (ATAK Change 4, not a foundational blocker).**

When multiple selectable entities overlap or fall within same practical click/touch area, GEV should not silently choose arbitrary contact. Future UI should offer compact candidate-selection/deconfliction interaction. Candidate information might include things already available in GEV such as identity/callsign/label, layer/domain, distance, bearing.

This belongs around I8 / discovery / interaction work. It is NOT a current foundational blocker. Do not implement now. Record as future requirement to be designed when I8 is implemented. Ensure underlying `nearby()` contract can supply candidate list with those fields.

D9 now RESOLVED — DUAL SEMANTICS, SURFACE authoritative for geographic proximity (see Part 3.4 and D9). I8 design must implement SURFACE for radius membership/cutoff/filtering/sorting/AOI/watch boundaries/ordinary rosters/analyst questions, and reserve SLANT as explicitly named secondary metric for cockpit/3D telemetry, future LOS, future sensor/range, other explicitly 3D physical-range questions. SLANT must NOT alter geographic radius membership. Whether slant is eagerly attached as `slantDistanceM`, lazily calculated, or calculated only by specialized 3D consumers is implementation detail deferred. Record metric in result per R3. Vessels/installations NOT automatically mandated for migration by D9.

**Modules affected.** `layers/{flights,military,vessels,installations}/queries.js` (adapters; **public signatures preserved**), `layers/cctv/queries.js`, `layers/awareness/queries.js` (becomes a consumer), `data/analystEngine.js` (a `nearby` scope kind), `voice/gevActions.js`, `src/ui/*` for future deconfliction UI.

**New modules.** `src/data/nearby.js` + tests; possibly `layers/cctv/proximity.js`; future `src/ui/selectionDeconfliction.js` (deferred).

**Tests.** Contract conformance per implementer (shape, metric declaration, ordering); component-wise equivalence against current behaviour; **subject-exclusion parity** with awareness; one answer regardless of surface; degraded-metric test (R5); future deconfliction candidate-list test (deferred).

**Performance/security risks.** Composition multiplies per-record work — bounding-box rejection first, bounded records, existing per-layer caps preserved so render-governor assumptions hold. Distance scans must not run per frame. Deconfliction UI must not introduce per-entity history.

**Dependencies.** I1, I2, I7. Selection deconfliction is later UI layer on top.

**Definition of done.** One contract, five implementers, identical result shape; four legacy signatures unchanged; a single cross-family answer available to search, User Spatial Objects/AOIs, camera discovery and watchlists; selection-deconfliction recorded as future requirement with candidate fields identified; unresolved flights/military metric decision explicitly tracked.

### I9 · The event / change bus and the change log (expanded: edge-triggered state transitions)

**Purpose.** Turn live feeds into *stated* changes with a time, place and source, with deterministic edge-triggered lifecycle/spatial transitions suitable for future watchlists, alerts and briefs.

**ATAK lesson incorporated (Change 3):** Current coarse activity bus and raw update/diff concepts are not sufficient for future watchlists, alerts and briefs. I9 must eventually establish deterministic, edge-triggered lifecycle/spatial transitions.

**User-visible result.** An activity view listing what changed and when, each carrying source, timestamp and coverage, with meaningful transitions (not just raw diffs).

**Conceptual vocabulary — at least:**

- APPEARED
- UPDATED
- STALE
- DEPARTED
- ENTERED_SCOPE
- EXITED_SCOPE

Names may be adjusted if existing GEV terminology makes another naming convention clearly better, but preserve semantics. Important:

- Do not emit ENTERED_SCOPE repeatedly while entity remains inside scope. It represents outside→inside edge.
- EXITED_SCOPE represents inside→outside edge.
- STALE is meaningful transition rather than merely display property.
- APPEARED/DEPARTED are lifecycle edges.

**Design must eventually define:**

- prior-state ownership
- transition thresholds
- source cadence/freshness interaction
- anti-flapping behavior
- how recordIndex/provenance/source health/eventLog divide responsibility

**Architectural separation preserved:**

- I2 = identity/indexing
- I3 = provenance/epistemic information
- I4 = source/sensor capability
- I5 = coverage/blind spots
- I9 = meaningful transitions/change history

Do NOT blindly put all temporal/provenance state inside recordIndex (see 0.4.5 correction). Determine exact ownership when I9 is designed. Useful concepts like observedAt/staleAt/accuracyM may be valuable, but ownership must respect boundaries above.

**Existing primitives reused.** `lifecycle.js:2299 subscribeActivity(callback)` / `_publishActivity(change)` publishes `status`, `destroy-all`, `data-updated` (with `layerId`), `visibility-settled`, `params-settled`. **Be precise about the gap: the bus says "redraw", not "here is what changed"** — its single subscriber (`src/app/layerPresentation.js:17`) converts them into render reasons such as `layer-tick:${layerId}`. This increment computes the difference and publishes a richer payload, reusing I2 (what is genuinely new), I3 (labelling), I5 (coverage) and `getStats()`. Future User Spatial Objects (I7) provide scopes for ENTERED_SCOPE/EXITED_SCOPE.

**Modules affected.** `data/lifecycle.js` (publish a diff-bearing event type **without** altering the five existing types or their consumers), `app/layerPresentation.js` (unchanged for render reasons), layer `lifecycle.js`/`ingestion.js`, `data/analystEngine.js`, future `userSpatialObjects.js` for scope edges.

**New modules.** `src/data/eventLog.js`, `src/data/eventRules.js` + tests covering edge-triggered semantics. **Do not add a layer for events until I5 establishes coverage.**

**Tests.** Threshold fires once per crossing, not per tick (**flapping test**); first-seen fires only for genuinely new identities; APPEARED fires once per identity lifecycle; ENTERED_SCOPE fires only on outside→inside edge, not repeatedly while inside; EXITED_SCOPE fires only on inside→outside; STALE is emitted as transition, not just display property; every event carries source/timestamp/coverage; **feed-fault suppression** — a stale feed must not generate "nothing detected" events; determinism against `asOf`; prior-state ownership and anti-flapping behavior tested.

**Performance/security risks.** Diffing every layer every tick is the likeliest performance regression — compute per layer on its own cadence. **An unbounded event log is a movement-profile generator**: retain events about *areas, assets and hazards*, not per-entity chronology. Edge-triggered state must not become longitudinal per-entity movement history.

**Explicit non-goal — no time machine.** This log answers *"what changed, and what were we watching?"* — **no playback, no seek, no rewind**, and deliberately no frame-by-frame position record. Historical playback remains very low priority and nothing in this plan depends on it.

**Dependencies.** I2, I3, I5. Consumes User Spatial Objects (I7) for scope-based edges when available, but can start without them.

**Definition of done.** Change events with source/timestamp/class/coverage and edge-triggered semantics (APPEARED/UPDATED/STALE/DEPARTED/ENTERED_SCOPE/EXITED_SCOPE or equivalent names preserving semantics); prior-state ownership, thresholds, cadence interaction, anti-flapping defined; separation of responsibilities across I2/I3/I4/I5/I9 documented; flapping and fault-suppression tests green; no per-entity chronology; no playback surface.

### I10 · Watchlists — assets, events and areas only (consumes expanded I7/I9)

**Purpose.** Standing questions about a place or class of asset — with a person-shaped rule **impossible to express**. Consumes stronger foundations from expanded I7 (User Spatial Objects) and I9 (edge-triggered transitions).

**User-visible result.** "Tell me when a new fire appears inside this AOI", "when a vessel of this class enters this strait", "when this feed goes stale during an event", "when aircraft ENTERED_SCOPE for this corridor". Aggregate by default. Watch boundaries are User Spatial Objects (point, polygon, radial circle, corridor, bbox) rather than separate geofence system — avoids duplicating geometry (see I7).

**Existing primitives reused.** I2 identity, I7 User Spatial Objects/AOIs (now general-purpose persistent geometry, not just polygon rings), I9 events with edge-triggered semantics (APPEARED/ENTERED_SCOPE/EXITED_SCOPE/STALE/DEPARTED), I5 coverage, and the **analyst engine's filter/scope vocabulary** — a rule *is* a saved analyst query evaluated against the event stream, so the safety property already exists: the schema expresses only declared fields, operators and scope kinds. `layerState.js`'s reject-wholesale validation posture is the model. P11 lifecycle distinction ensures watchlist definitions (persistent user knowledge) survive session boundaries while transient feed state does not become permanent history.

**Modules affected.** `data/analystEngine.js`, `data/eventRules.js`, `src/ui/*`, `voice/gevActions.js`, `voice/actionSchemas.js`, `userSpatialObjects.js`.

**New modules.** `src/data/watchlist.js` + the most important test suite in the plan. Watchlist persistence respects P11 (persistent user knowledge).

**Tests.** **Schema-expressiveness tests are the point:** a person-shaped rule must be *unrepresentable* — no person field type, no name-valued operator, no individual-identity scope target — asserted by **enumerating the accepted schema**, not by trying a few forbidden examples. **Aggregation-floor tests.** Rule validation rejects unknown fields wholesale. **A rule over a stale source reports "not evaluated — source stale"** rather than silence (P4 applied to automation). ENTERED_SCOPE/EXITED_SCOPE rules fire only on edge, not repeatedly while inside; STALE transition triggers appropriate watchlist handling; User Spatial Object as watch boundary reusable without duplication.

**Performance/security risks.** Standing rules evaluate continuously — per-layer cadence from I9, cache rule state, cap rule count and cost. **A rule that could answer "is a specific person here?" must be structurally impossible**, because watchlists are the feature most likely to be repurposed. Notifications must never be phrased as alerts about people. No longitudinal movement history.

**Dependencies.** I2, I7 (User Spatial Objects), I9 (edge-triggered). Consumes stronger foundations.

**Definition of done.** Rules expressible only over assets/events/areas with User Spatial Objects as boundaries (point/pin, polygon, radial circle, corridor, bbox); aggregation floor enforced; stale-source rules say so; edge-triggered semantics respected; no rule targets an individual; lifecycle distinction preserved.

### I11 · Briefs — the guiding question, as an artefact (reproducible workspaces)

**Purpose.** Assemble everything into the one output the platform exists to produce, with future workspaces/briefs able to describe a reproducible analytical context.

**ATAK lesson incorporated (Change 5):** ATAK's data-package concept reinforced useful idea, but GEV adapts for open-signal analysis rather than copying mission packages. Future Workspaces/Briefs should be able to describe a reproducible analytical context.

**User-visible result.** Select a User Spatial Object / AOI or event and produce a brief: what is observed, from which sources, at what timestamp and age; what is derived and how; what is uncertain; what was not observed and why; and the licence obligations for everything included. Exportable. Future workspace/brief should be reproducible.

**Reproducible analytical context — planning clarification (do not define final package format now, do not adopt ATAK Mission Package XML or CoT):**

Where appropriate, a workspace/brief should include:

- spatial scope / User Spatial Objects (point, polygon, circle, corridor, bbox) — avoids duplicating geometry, same objects used as AOI, watch boundary, investigation landmark, brief subject
- temporal/as-of context
- selected layers
- source/provider references
- provenance
- user-created knowledge objects (saved spatial objects, investigation notes, watchlists, etc.)
- coverage/blind-spot context
- relevant license/attribution obligations

This is a planning clarification for later milestones. Do not define final package format now. Do not adopt ATAK XML/CoT. See BUILD LATER workspaces.

**Existing primitives reused.** The whole trust layer (I2–I5, I7 User Spatial Objects, I9 edge-triggered), plus `dataCredits.js` attribution strings, `drawMode.formatMeasure()`, the MGRS grid, `director/sharing/bundle.js`, and the analyst engine's `coverage`/`scopeLabel`/`centeredOn` as the brief's skeleton. P11 ensures brief/workspace definitions are persistent user knowledge, while transient feed records remain transient.

**Modules affected.** `data/analystEngine.js`, `data/coverage.js`, `data/provenance.js`, `data/sourceRegistry.js`, `src/ui/*`, `voice/gevActions.js`, `director/sharing/*`, `userSpatialObjects.js`.

**New modules.** `src/data/brief.js`, `src/ui/brief*` + tests, future `src/data/workspace.js` for reproducible context (deferred). **No new layer.**

**Tests.** A brief over a stale feed names the staleness; a brief with no observations states coverage rather than reporting emptiness; **every number resolves to a computation with declared metric, `asOf` and source**; attribution present for every included source; deterministic for a fixed `asOf`; reproducible context includes spatial scope / User Spatial Objects, temporal/as-of, layers, sources, provenance, user objects, coverage, license; no ATAK XML/CoT dependency.

**Performance/security risks.** Compute on demand, never in the render path. **Export is where licence obligations travel with the data** — a brief containing TeleGeography cables (CC BY-NC-SA) or Open-Meteo data inherits those terms. **Do not include sources whose terms forbid redistribution.** Reproducible workspace must not bundle transient feed history as permanent local history (P11) and must not create longitudinal movement-profile database.

**Dependencies.** I3, I5, I7 (User Spatial Objects), I9 (edge-triggered). Consumes stronger foundations.

**Definition of done.** Reproducible for a fixed `asOf`; every figure receipted; coverage and non-observation always present; licence obligations travel with the export; workspace/brief can describe reproducible analytical context including spatial scope/User Spatial Objects, temporal/as-of, layers, sources, provenance, user knowledge, coverage, license; no ATAK package format adopted; lifecycle distinction preserved.

---

## Part 7 — The three buckets

### 7.1 BUILD NOW

Step 0 (T1–T10) + I1–I11, ordered by dependency:

| Order | Item | Why now |
|---|---|---|
| 0 | T1–T10 small exposures | Safe, immediate; several shrink later increments |
| 1 | **I1** Spatial authority (+ I1b ring bug) | Root of the graph; six capabilities depend on it; a confirmed correctness bug sits inside it. **Already implemented** (`src/data/geo.js`) — does NOT get reopened for parametric sensor geometry (see 0.4.3). |
| 2 | **I2** Identity + record index | Precondition for correlation, watchlists, change detection, briefs |
| 3 | **I3** Provenance + epistemic typing | Nothing else is safe to show a user before this exists |
| 4 | **I4** Source/sensor registry | Halves as licence compliance; already half-built. **Deferred evaluation point for parametric sensor geometry** (see 0.4.3) — introduce generalized sensor descriptor only if multiple real consumers justify it. |
| 5 | **I5** Coverage, freshness, blind spots | Implements P4 — the clause of the guiding question nothing answers today. **Deferred evaluation point for parametric sensor geometry** alongside I4. |
| 6 | **I6** Analyst search generalization | The interface to everything else |
| 7 | **I7** User Spatial Objects / AOIs | Makes "this place" a first-class, persistent object; general-purpose spatial object foundation (point/pin, polygon, radial circle, corridor, bbox) avoiding duplicate geometry systems. Near-pure extension of existing seam plus lifecycle distinction (P11). Ephemeral telestration remains distinct (P12). |
| 8 | **I8** Proximity contract + discovery | The whole-exceeds-the-parts capability at the engine level. Plus future selection-deconfliction requirement for dense scenes (candidate list: identity/callsign/label, layer/domain, distance, bearing) — recorded as later UI, not foundational blocker. |
| 9 | **I9** Event/change bus + change log | Watchlists and briefs both consume change. Expanded to define deterministic edge-triggered lifecycle/spatial transitions (APPEARED/UPDATED/STALE/DEPARTED/ENTERED_SCOPE/EXITED_SCOPE) with prior-state ownership, thresholds, cadence interaction, anti-flapping, and clear division of responsibility across I2/I3/I4/I5/I9. |
| 10 | **I10** Watchlists (assets/events/areas) | High-leverage and direction-agnostic; honest only once I2/I7/I9 exist. Consumes expanded I7 (User Spatial Objects as reusable boundaries) and I9 (edge-triggered). |
| 11 | **I11** Briefs | The guiding question as a citable artefact. Expanded to reproducible workspaces/briefs: spatial scope/User Spatial Objects, temporal/as-of, layers, sources, provenance, user knowledge, coverage, license — without adopting ATAK XML/CoT. |

Every item is justified as useful **regardless of eventual specialization**; ten of eleven are required by all five candidate identities in the direction study. None presumes a domain.

### 7.2 BUILD LATER

| Capability | What unlocks it / why it waits |
|---|---|
| **Workspaces / case files (reproducible)** | Needs I3 + I11. Earlier, it saves assertions without evidence. Future workspaces should be reproducible analytical context (spatial scope/User Spatial Objects, temporal/as-of, layers, sources, provenance, user knowledge, coverage, license) without adopting ATAK Mission Package XML/CoT. See I11 and 0.4.2 Change 5. Respects P11 transient vs persistent lifecycles. |
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
5. **No trajectory.** The record index holds identity and last-seen, never movement history. Event log (I9) must not become per-entity movement history either.
6. **Determinism.** Computation depends on explicit `asOf`, never ambient time.
7. **Licence obligations travel.** Attribution and terms accompany any export.
8. **Render governor untouched.** New work computes outside the render loop or through the existing governor.
9. **Transient vs persistent lifecycles respected (P11).** High-volume transient feed state (live ADS-B, AIS, earthquakes, etc.) must not become permanent local history merely because persistence exists for user knowledge. Persistent user knowledge (User Spatial Objects, AOIs, watchlists, investigation notes, workspace state) must survive appropriate session boundaries once persistence is implemented. No longitudinal per-entity movement history.
10. **Ephemeral vs persistent spatial objects distinct (P12).** Ephemeral telestration does not auto-persist; persistent User Spatial Objects are explicitly created/saved and reusable as AOI, watch boundary, reference mark, investigation object, brief subject without duplicating geometry.
11. **Edge-triggered transitions are edges (I9).** ENTERED_SCOPE is outside→inside edge only, EXITED_SCOPE inside→outside, not repeated while inside. STALE is meaningful transition, not just display property. Anti-flapping and prior-state ownership must be defined when I9 is designed.

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
| D4 | AOIs / User Spatial Objects in share links | **DEFERRED to I7.** If yes, fix the token grammar before the first link is shared — semantics are permanent (P8). Persistence mechanism itself also deferred (localStorage vs IndexedDB etc.) |
| D5 | Watchlist notification surface | **DEFERRED to I10.** Plan recommends in-app first; notifications later and opt-in |
| D6 | Event log retention | **DEFERRED to I9.** Plan recommends workspace-scoped with an explicit bound. Must also define prior-state ownership, thresholds, anti-flapping for edge-triggered transitions (APPEARED/ENTERED_SCOPE etc.) |
| D7 | Whether the ALPR layer stays | **DEFERRED, owner's call.** Plan recommends: keep, off by default, labelled as publicly-mapped camera infrastructure |
| D8 | Empty-result enforcement | **DEFERRED to I5.** Plan recommends a hard failure plus an architecture script |
| D9 | Flights/military `getNearby` metric — DUAL SEMANTICS, SURFACE authoritative | **RESOLVED — DUAL SEMANTICS, SURFACE authoritative for geographic proximity. Implementation PENDING.** Owner decision 2026-09: SURFACE is authoritative geographic proximity metric; `distanceM` = canonical SURFACE for geographic proximity. SURFACE governs: radius membership, cutoff filtering, geographic proximity/discovery, standard proximity sorting, AOIs, watch/geofence boundaries, ordinary map/contact rosters, analyst/search questions such as "within X km", ordinary user-facing geographic distance narration. SLANT = physical 3D separation, explicitly named secondary metric, must NEVER silently substitute for geographic `distanceM`. SLANT appropriate only when consumer's actual question requires physical 3D range (cockpit/3D target telemetry, future LOS, future sensor/range, other explicitly 3D physical-range questions). SLANT must NOT alter membership in geographic proximity radius. Example: aircraft directly overhead: surface = 0 km, slant ≈10.7 km at 35k ft; 10 km geographic at 35k ft: surface ≈10 km, slant ≈14.6 km — different questions. Current code still uses `Cartesian3.distance` (slant) — DECISION resolved, IMPLEMENTATION pending (see Part 3.4). Whether slant is eagerly attached as `slantDistanceM`, lazily calculated, or calculated only by specialized 3D consumers is implementation detail deferred, do NOT lock. Vessels/installations NOT automatically mandated for migration by D9; governed by existing migration plan. ATAK supporting evidence only; decision based on GEV semantics (250 km circle drawn on surface labeled 250 KM FLIGHT/VESSEL WINDOW must agree with computation). |
| D10 | Parametric sensor geometry (origin/azimuth/FOV/range) | **DEFERRED to I4/I5 — I1 NOT reopened.** ATAK demonstrated value in generalized sensor geometry model, but I1 (`src/data/geo.js`) is intentionally scoped and already implemented. Evaluate generalized sensor descriptor only when I4 Source/Sensor Registry and I5 Coverage are designed, and only if multiple real consumers (CCTV direction/FOV, sensor coverage, satellite/imagery footprints) justify it. See 0.4.3. |
| D11 | Persistence technology for User Spatial Objects / watchlists / workspaces | **DEFERRED to I7/I10/I11.** Lifecycle distinction (P11 transient vs persistent) is decided; storage technology (localStorage vs IndexedDB, keys, serialization) is NOT. Do not lock prematurely. |

---

## Closing

The plan's claim is narrow and testable: **the fork's advantage is not that it knows more, but that it can say what it knows and what it does not.** Three things already in the codebase — the `NOT AN ALL-CLEAR` strings, the "one computation, two consumers" engine written to stop the panel saying 111 while the voice said 15, and a licence registry built because the law required it — show that this culture is already load-bearing rather than aspirational.

What is missing is **generality**. Nine distance implementations drifted apart because nothing owned the answer; four `getNearby` variants accumulated because nothing owned the contract; five Natural Earth rings have been silently mis-tested because nothing owned ring containment; three documents are cited that do not exist. None of that is a rebuild. It is completion, in small increments, each leaving the application working.

Build the trust layer first. Every direction you might later choose — public safety, journalism, emergency management, asset SAR, environmental monitoring, or simply understanding what is happening outside — needs exactly the same foundation, and none of them needs it built differently.
