# Pre-implementation audit — dependency-focused

**Purpose.** Identify what in the existing application should be improved, corrected, consolidated, tested or hardened **before** we begin changing functionality — but only where doing so directly supports `MASTER-PLAN.md`.

**The rule applied, verbatim.** Only recommend improving existing code now when a planned foundational capability will depend upon it **AND** doing the improvement first prevents duplicated work, fixes a correctness problem, reduces meaningful implementation risk, or creates a substantially safer foundation.

**Explicitly out of scope and not recommended here:** general refactoring, modernization, cleanup, formatting, cosmetic work, and "while we're here" improvements. Where such work is visible, it is recorded in §B as something to leave alone, with the reason.

Verdicts are **FIX BEFORE** / **FIX WHEN REACHED** / **LEAVE ALONE**.

### Addendum — 2026-09 ATAK-CIV study and I1 implementation

This audit was written before I1 spatial authority was implemented and before the ATAK-CIV comparative study. Two updates are recorded here to prevent contradictions with `MASTER-PLAN.md` (see 0.4) and current code:

- **I1 FIX BEFORE items (A1 ring containment, A2 scoped spatial authority, A8 spatial check) have been implemented:** `src/data/geo.js`, `geo.test.mjs`, `geoEllipsoid.js`, `geoid.js` now exist. `naturalEarthRegions.pointInRing` now delegates to `geo.ringContains` (antimeridian-correct). The confirmed bug in §A1 is fixed. `check-spatial-authority.mjs` (or equivalent) was part of that implementation. This audit's §A1/A2/A8 remain historically accurate as the rationale, but their status is now **DONE**, not still FIX BEFORE.

- **ATAK accepted findings (2026-09) incorporated into MASTER-PLAN 0.4:**
  - I7 expanded to User Spatial Objects + AOIs: general-purpose persistent geometry (point/pin, polygon, radial circle, corridor, bbox) serving multiple semantic roles (AOI scope, watch/geofence boundary, saved reference mark, investigation/workspace object, brief subject) without duplicating geometry. Ephemeral telestration vs persistent User Spatial Objects distinct (P12). Persistence mechanism NOT locked.
  - P11 transient vs persistent lifecycles: high-volume feed state (live ADS-B, AIS, earthquakes) vs persistent user knowledge (saved spatial objects, AOIs, watchlists, investigation notes, workspace state). Lifecycle distinction, not storage tech. No longitudinal per-entity movement history.
  - I9 expanded to edge-triggered state transitions: APPEARED, UPDATED, STALE, DEPARTED, ENTERED_SCOPE, EXITED_SCOPE (edge semantics, anti-flapping, prior-state ownership, thresholds, cadence interaction, division across I2/I3/I4/I5/I9). STALE as meaningful transition.
  - I8 future selection-deconfliction requirement for dense scenes: compact candidate-selection when multiple entities overlap same click/touch area (identity/callsign/label, layer/domain, distance, bearing).
  - I11/workspaces reproducible: workspace/brief should describe reproducible analytical context (spatial scope/User Spatial Objects, temporal/as-of, layers, sources, provenance, user knowledge, coverage/blind-spot, license) without adopting ATAK XML/CoT.
  - Parametric sensor geometry (origin/azimuth/elevation/FOV/range) deferred to I4/I5 evaluation, I1 NOT reopened (D10).
  - Concepts NOT adopted from ATAK listed in MASTER-PLAN 0.4.4.
  - Corrections to ATAK report (0.4.5): do NOT assign observedAt/staleAt/accuracyM automatically to recordIndex, do NOT lock persistence, do NOT eliminate ephemeral annotations, do NOT treat ATAK as authoritative.

- **D9 now RESOLVED (2026-09):** flights/military `getNearby` SURFACE vs SLANT due to ECEF center is now RESOLVED as DUAL SEMANTICS, SURFACE authoritative for geographic proximity. Owner decision: SURFACE authoritative for radius membership, cutoff, discovery, sorting, AOIs, watch/geofence, rosters, analyst/search "within X km", narration; SLANT = physical 3D separation, explicitly named secondary, must NEVER silently substitute for `distanceM`, must NOT alter geographic radius membership (example overhead: surface 0 km, slant ≈10.7 km at 35k ft). Whether slant is eagerly attached as `slantDistanceM`, lazily, or only by specialized 3D consumers is implementation detail deferred. Current code still uses `Cartesian3.distance` — DECISION resolved, IMPLEMENTATION pending. Vessels/installations NOT automatically mandated for migration by D9. This audit's original recommendation to migrate flights/military `getNearby` to surface-consistent is now superseded by resolved dual-semantics contract, to be implemented when I8 proximity contract is designed. See MASTER-PLAN Part 3.4 and D9.

- **Sequencing preserved:** Step 0 → I1 (done) → I2/I3/I4/I5 → I6 → I7 (expanded) → I8 (+deconfliction) → I9 (+edge transitions) → I10/I11 (consume stronger foundations). See MASTER-PLAN 0.4.6.

---

## §A — Candidates that pass the rule

### A1 · Ring containment across the antimeridian — **FIX BEFORE** ★

**Existing component.** `src/data/naturalEarthRegions.js:268` — `pointInRing(ring, lat, lon)`, consumed by `analystEngine.applyScope` for every `scope: {kind:'region'}` query, and by the annotation resolver's region path.

**Current weakness.** Naive ray casting in raw lon/lat degrees:

```js
const intersects = yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
```

No antimeridian handling exists — `grep -niE "antimeridian|wrap|180|dateline"` over the module returns nothing. The shipped Natural Earth pack contains rings that cross ±180°: **Antarctica, East Antarctica, Polar Plateau, Arctic Ocean, Southern Ocean** (2 jumps in `marine.json`, 3 in `regions.json`, ~5 rings total).

**Verified failure, not theory.** Running the unmodified function against the shipped pack:

| Query | Expected | Actual |
|---|---|---|
| Antarctica (-80, 179) — interior, near the antimeridian | inside | **`false` — WRONG** |
| Southern Ocean (-60, 0) | inside | **`false` — WRONG** |
| Antarctica (-80, 0) / (-50, 0) / Arctic Ocean (85, 0) | — | correct |

**Planned capabilities that depend on it.** **I7 (AOIs)** directly — an AOI is a ring, and user-drawn rings will hit the same class of problem, so building AOIs on this primitive would ship a known-wrong containment test. Also I5 (AOI-scoped coverage) and I8 (`nearby` inside an AOI).

**Consequence of leaving it alone.** A **shipped** feature returns a wrong count today: `analyst_query` scoped to Antarctica, the Arctic Ocean or the Southern Ocean can report aircraft/vessel/fire counts for the wrong region. Those are exactly the regions where a polar-route or climate question would be asked. Worse, I7 would be built on top of it, converting one wrong answer into a whole feature's worth.

**Does later roadmap work replace it?** Yes — I1 makes `geo.js` the spatial authority and `naturalEarthRegions.pointInRing` becomes a re-export. But the *fix* is not automatic: moving the same naive loop into a new module would relocate the bug. It must be fixed as part of that move.

**Recommendation: FIX BEFORE** — as **I1b**, ahead of I7 and alongside the `geo.js` creation. It is a small, self-contained, testable change (split a crossing ring at ±180° and test the parts, or equivalent) with a built-in acceptance test: all five affected rings. It satisfies the rule twice over — it **fixes a correctness problem** and **creates a substantially safer foundation**.

### A2 · Spatial authority — consolidated now, but **scoped, not repo-wide**

**Existing component.** Nine-plus distance implementations in four behavioural classes (full inventory in `MASTER-PLAN.md` Part 3.1).

**Current weakness.** The user-facing question "within 250 km" is answerable by either a great-circle surface distance or a 3D slant distance (`Cesium.Cartesian3.distance` against billboard positions) with nothing declaring which. Demonstrated ordering inversion: aircraft A at 249.0 km ground / 20 km altitude (slant ≈ 249.80) vs B at 249.5 km ground / 0.5 km altitude (slant ≈ 249.50) — **surface says A is nearer, slant says B**.

Two differences are **not** weaknesses and must not be "fixed": the radius difference (`6371` km vs `6371000` m are the same radius; only `6371008.8` differs, by 0.35 m at 250 km) and the formula difference (`asin` vs `atan2` are algebraically identical). The argument-order difference is a **trap, not a current bug** — `naturalEarthRegions.js`'s `(lon, lat)` form is *private*, so it cannot currently be called wrongly from outside.

**Planned capabilities that depend on it.** Search (I6), AOIs (I7), proximity/discovery (I8), correlation (later), camera discovery (T8), watchlists (I10) — six capabilities that must not disagree.

**Consequence of leaving it alone.** Divergence accumulates. Every new feature that needs a distance adds a tenth implementation; the panel/analyst disagreement the codebase already fixed once returns in a new form.

**Does later roadmap work replace it?** This *is* the later roadmap work (I1). The question is only scope.

**Recommendation: FIX BEFORE, scoped to three things** (detailed in §C):
1. **I1a — create `geo.js` and its tests, and land `check-spatial-authority.mjs` in freeze mode.** Nothing migrates yet; the check simply stops *new* divergence and records the existing surface area in a shrinking allowlist.
2. **I1b — the ring-containment fix (A1).**
3. **I1c — migrate only what a dependent feature needs now**: the six exported user-facing distance functions, the three duplicate `greatCircleM` copies, and the **flights + military** `getNearby` implementations (the two that feed the awareness window which must agree with the analyst).

**Explicitly not now:** vessels/installations `getNearby` (migrate at I8 with the contract); `regionalModel.js` and `hud.js` inline forms (private / display-only); `naturalEarthRegions`' private lon-first helper (goes with I7's ring maths). **This is deliberately not a repo-wide refactor.**

### A3 · Analyst engine — **FIX WHEN REACHED** (nothing to do first)

**Existing component.** `src/data/analystEngine.js` + `analystEngine.test.mjs` + `analystProviders` (`gevActions.js:4125`).

**Current weakness.** Two, and neither justifies pre-work:
- `ANALYST_LAYERS` covers **5 of 18** families. Extending it is the *substance* of T3/I6, not a prerequisite for it.
- The engine's `haversineKm` is one site of the A2 divergence — **already scheduled as I1c**, because it is the half of the disagreement that must match the proximity window.

**Planned capabilities that depend on it.** I6 (all of it), I3 (result typing), I5 (coverage in results), I10 (rules as saved queries).

**Consequence of leaving it alone.** None before I6 starts. The engine is **already tested** — 203 lines, 15 tests, covering scope naming, radius centring, explicit-centre precedence, honest failure on an unresolved region, follow-up memory and haversine sanity — so I6's changes land against an existing safety net rather than a bare function.

**Does later roadmap work replace it?** No — I6 generalizes it; I3 adds typing to its results. Both are additive.

**Recommendation: FIX WHEN REACHED.** Add no work ahead of T3/I6. Two properties are worth preserving deliberately: the **field-typing schema** (it is what makes an LLM-generated query answerable and safe) and the **courteous refusal** for unknown layers (a wrong field name must never become a wrong answer).

### A4 · Record accessor contract — **FIX WHEN REACHED** (the contract already exists)

**Existing component.** `analystProviders.getRecords` → `mod.getAnalystRecords(limit)`.

**Current weakness.** Only **five layers implement `getAnalystRecords`** (`earthquakes`, `firms`, `flights`, `military`, `vessels`), and there is no conformance test asserting a record shape beyond `lat`/`lon`.

**Planned capabilities that depend on it.** T3, I6, I2 (identity fields), I3 (source/timestamp attachment).

**Consequence of leaving it alone.** Adding a family without an accessor silently yields an empty record set — which, under P4, would be *indistinguishable from "nothing there"*. That is a real trap, but it is a trap inside the increments that create the risk, not a pre-existing defect.

**Does later roadmap work replace it?** No — I2 and I6 extend it.

**Recommendation: FIX WHEN REACHED.** When I2/I6 land, add a conformance test that a layer advertising analyst support actually returns records with the declared fields. Do not build a new indexing layer now: the uniform contract already exists, and inventing a parallel one is exactly the duplication P7 forbids.

### A5 · Feed state and coverage — **FIX WHEN REACHED** (I5)

**Existing component.** `src/data/feedState.js` (55 lines, one export), plus the honest-zero guard in `awareness/queries.js:22`.

**Current weakness.** `layerFeedState()` infers seven states from heterogeneous `stats` heuristically; and the "no bare zero" rule exists as **string-level intent** (`NOT AN ALL-CLEAR` in the cockpit) plus one hand-written guard — not as an enforceable, code-level invariant.

**Planned capabilities that depend on it.** I5 (its whole substance), I9 (fault suppression), I10 (stale-source rules), I11 (briefs naming staleness).

**Consequence of leaving it alone.** Nothing before I5. But note the asymmetry that makes I5 important: the *presentation* of honesty already ships in several places, while the *invariant* does not — so a new surface can omit coverage without anything failing.

**Does later roadmap work replace it?** I5 widens it. The heuristic is small and self-contained, so widening is low-risk.

**Recommendation: FIX WHEN REACHED.** Do not pre-emptively harden a 55-line function before its consumers exist — the invariant is best designed knowing what must satisfy it.

### A6 · Event/activity subscription — **FIX WHEN REACHED** (I9), with one standing constraint

**Existing component.** `lifecycle.js:2299` `subscribeActivity` / `_publishActivity`; one subscriber at `src/app/layerPresentation.js:17`.

**Current weakness.** The payload carries **no diff** — it publishes `status`, `destroy-all`, `data-updated` (with `layerId`), `visibility-settled`, `params-settled`, which its single consumer maps to *render reasons* (`layer-tick:${layerId}`). So the bus answers "should we redraw?", not "what changed?".

**Planned capabilities that depend on it.** I9, and through it I10 and I11.

**Consequence of leaving it alone.** Nothing before I9. The gap is one of *payload*, not architecture: I9 computes the difference itself and publishes a richer event type — it does not need a new bus.

**Does later roadmap work replace it?** I9 extends it; the five existing types and their consumer must remain intact.

**Recommendation: FIX WHEN REACHED.** **Standing constraint until then:** no Step 0 item or early increment may add a second `subscribeActivity` consumer or alter the existing five change types. The render consumer is load-bearing and its contract is easy to disturb by accident.

### A7 · Source provenance and licensing — **FIX WHEN REACHED** (I4)

**Existing component.** `src/data/dataCredits.js` (39 credit keys), `TRANSIT_FEED_REGISTRY`, `DATA_SOURCES.md`, and per-pack `meta` blocks.

**Current weakness.** The credits module is **display-oriented** — its entries are HTML strings for Cesium's credit display, not capability descriptors. Coverage, cadence, latency and failure modes are absent; a new layer's trustworthiness is not declared anywhere machine-readable. Additionally, the file's own instruction to keep `DATA_SOURCES.md` in sync is **unenforced**.

**Planned capabilities that depend on it.** I4, and through it I5's coverage map, I11's export licence obligations, and compliance for TeleGeography (CC BY-NC-SA), Open-Meteo (non-commercial free tier) and Vantor (CC BY-NC).

**Consequence of leaving it alone.** Compliance still works today — it is done by hand and it is done carefully. The cost is that I4 must reconcile 39 prose entries when it arrives.

**Does later roadmap work replace it?** No — I4 generalizes it, keeping the same registration mechanism and the static-vs-conditional distinction.

**Recommendation: FIX WHEN REACHED.** I specifically **reject** adding a strict `DATA_CREDITS` ↔ `DATA_SOURCES.md` sync test as pre-work: the markdown is organized as prose sections rather than a keyed list, so a 1:1 test would be brittle, would fail for cosmetic reasons, and would be superseded by I4's registry anyway. This is a case where "test it first" is the wrong instinct.

### A8 · Architecture and test enforcement — **FIX BEFORE**, but only additively

**Existing component.** `scripts/check-import-directions.mjs`, `scripts/check-package-boundaries.mjs`, wired as `npm run check:boundaries`; the serialization-registry mismatch check in `finalizeRegistrations()`.

**Current weakness.** Architecture is enforced for import direction and package boundaries, but **nothing enforces the spatial authority** — which is precisely why nine implementations accumulated.

**Planned capabilities that depend on it.** Every increment that touches distance, proximity, identity, feed state or licences.

**Consequence of leaving it alone.** The freeze allowlist in I1a cannot exist, so **new** divergence is unconstrained. This is the one enforcement gap that makes A2's fix durable.

**Does later roadmap work replace it?** It is part of I1a.

**Recommendation: FIX BEFORE — additively only.** Add `scripts/check-spatial-authority.mjs` and wire it into the existing `check:boundaries` script. **Do not restructure, rename or reorganize the existing check scripts**, and do not broaden them into general linting.

### A9 · Missing design-authority documents — **FIX BEFORE** (it is Step 0's T1)

**Existing component.** Three code-cited paths that do not exist (`analystEngine.js:6`, `dataCredits.js:11`, `KNOWN-ISSUES.md:77`).

**Current weakness.** The design authority for the analyst engine is cited as **owner-ratified** and is unverifiable in the checkout. All three hide inside backtick spans, so link checkers miss them.

**Planned capabilities that depend on it.** I6 relies on the analyst engine's design intent; I4 relies on the reasoning behind the attribution system. Both currently rest on citations a reader cannot follow.

**Consequence of leaving it alone.** For a platform whose identity is provenance, its own governance trail is broken — and a fork inherits the ambiguity about which decisions were ratified and by whom.

**Does later roadmap work replace it?** No.

**Recommendation: FIX BEFORE — it is already T1.** Either restore the documents or correct the citations to a surviving source. Documentation only; no code risk.

---

## §B — Explicitly do NOT improve now

Recorded so the decision is deliberate rather than forgotten. Each is either replaced by later roadmap work, irrelevant to the direction, or a refactor the brief excludes.

| Component | Visible condition | Why we leave it alone |
|---|---|---|
| **`src/voice/gevActions.js` (4,337 lines)** | Very large; mixes action dispatch with helper logic | Splitting it is a textbook "while we're here" refactor. The one thing we need — `analystProviders` — is **already extracted as a function**, so T10 needs only reuse, not surgery. File size is not on the critical path |
| **Class D camera-relative distances (~25 sites)** | Uses `Cartesian3.distance` against `camera.positionWC` | **Not a defect.** These answer "how far from the viewer" for LOD, fade, culling and framing. Migrating them to a geographic metric would be a regression. They are permanently allowlisted, with a comment explaining why |
| **`regionalModel.js:153`, `hud.js:598` inline haversines** | Duplicated maths | Private and display-only respectively; near-zero divergence risk. They migrate naturally when a dependent feature touches them — not worth a dedicated change |
| **`naturalEarthRegions.js` private `(lon, lat)` helper** | The only lon-first convention | Private, so it cannot currently be mis-called. It goes with I7's ring maths move, not before |
| **`src/data/lifecycle.js` (2,314 lines)** | Large | Load-bearing, well-tested, and its contract is what we must preserve (P8). Restructuring it is the highest-risk low-reward change available |
| **`finalizeRegistrations()` / `layerState.js` codec** | Strict, reject-wholesale | Working as designed. Only the **rule** matters: no new layer and no new share-link token in Step 0 or I1–I6 |
| **`src/data/detection.js` (1,604 lines)** | Misleading name; not anomaly detection | Its name caused a documentation error, now recorded. Renaming it would touch rendering call sites for no functional gain |
| **Render governor, input ownership, key handling** | — | Sound. Only *constraints* apply: compute outside the render loop; never hold key material in the new registry; never emit key material into shareable state |
| **`docs/CURRENT-STATE.md` Runtime Stack prose drift** | Documented drift from an earlier review | Documentation accuracy, not capability. Not on the critical path; revisit when a step touches the affected subsystems |
| **`src/data/localLayers.js` — genuinely unimported** | Dead module | Deleting dead code is cleanup, and it carries no dependency risk either way. Out of scope by the brief |
| **`docs/format-scope.json` coverage** | New docs are outside the allowlist | Deliberate: `docs/planning/` documents should not be silently reformatted by a tool. No action |

**One structural note, not an improvement:** several components already hold *part* of the trust layer — `layerFeedState` (freshness), `FIX_FLAGS` (three clocks), `DATA_CREDITS` (licences), the analyst's `coverage` block (what was queried). **They are not consolidated**, and this audit does not recommend consolidating them. I3/I4/I5 should *compose* them, because each already has consumers that depend on its current shape.

---

## §C — The spatial consolidation question: how much now?

**The risk we are avoiding in both directions.** Migrate too little, and the divergence that motivated I1 survives; I7 and I8 build on an authority that is not actually authoritative. Migrate too much, and I1 becomes a repo-wide refactor touching ~40 call sites across rendering, annotations, layers and HUD — a large, risky change that delays every dependent capability and violates the small-increment requirement.

**The dividing line.** Consolidate now exactly what a **planned foundational capability depends on**, and *freeze* the rest. Three signals determine which:

1. **Exported vs private.** An exported distance function can be called wrongly from anywhere; a private one cannot. Exported: migrate. Private: freeze.
2. **Answers a user-facing question vs a rendering question.** "Within 250 km" is user-facing; "how far is this billboard from the camera" is not. User-facing: migrate. Rendering: allowlist permanently.
3. **Feeds a window that must agree with another surface.** `flights` and `military` `getNearby` feed the awareness window that the analyst must match. Those two: migrate. `vessels` and `installations`: migrate at I8 when the contract lands.

| Now (I1a–I1c) | Later, when reached | Never |
|---|---|---|
| `geo.js` + tests + freeze check | `vessels`, `installations` `getNearby` (I8) | Class D camera-relative distances (~25 sites) |
| `analystEngine.haversineKm` | `naturalEarthRegions` private lon-first helper (I7) | — |
| `routePlausible`, `trafficBounds`, `transitFeeds`, `cctv/model`, `bikeshare/model` | `regionalModel.js`, `hud.js` inline forms (natural migration) | — |
| Three `greatCircleM` copies → one | `contactPlayback.distance` (natural migration) | — |
| `flights` + `military` `getNearby` | — | — |
| `geo.ringContains` (the A1 bug) | — | — |

**Roughly a third of the sites move up front, all of them exported or correctness-bearing. The remaining two-thirds are frozen, allowlisted, or migrate on contact.** `check-spatial-authority.mjs` in freeze mode is what makes "later" safe: the allowlist is the inventory of known divergence, and it can only shrink.

---

## §D — Step 0 reconciliation

| Item | Verdict | Reasoning |
|---|---|---|
| **T1** Repair three dangling doc references | **KEEP** | It *is* the A9 fix. Documentation only |
| **T2** "Threat tier" → "category tier" | **KEEP** | **Decision D3 = YES.** Comment only; `resolveTier` keeps its name |
| **T3** Extend `ANALYST_LAYERS` to three more families | **MODIFY (smaller)** | The `getAnalystRecords` contract already exists, and `analystProviders.getRecords` already routes through it. **No `gevActions` change is required** — implement the accessor on three families and add their field tables. Risk drops accordingly |
| **T4** Collapse three `greatCircleM` copies | **KEEP** | Pure de-duplication, no behaviour change, and it removes two sites before I1's freeze allowlist is written — so the allowlist starts smaller |
| **T5** Differential distance test | **KEEP** | Now has decided inputs: **D1 `SURFACE`**, **D2 `6,371,008.8 m`**. Measurement only; changes no production code |
| **T6** Surface the analyst `coverage` block | **KEEP** | First visible application of P4; additive display |
| **T7** Aircraft-class filter in the layer panel | **KEEP (with a condition)** | Condition: route it through the same `normalizeAircraftClassFilter` the voice path uses. Panel and voice disagreeing on "heavy" would be P2 violated on day one |
| **T8** CCTV `getNearby` | **PRECEDED BY A FOUNDATION FIX** | Gate it behind **I1a** so it calls `geo.distanceM` from the start. Otherwise it becomes a tenth distance implementation on the very day we begin eliminating them. It is then the **first consumer** of the spatial authority — a useful proof that the module works before anything depends on it |
| **T9** Feed state on the layer panel row | **KEEP** | Presentation only. Must not alter `getStats()` semantics or lifecycle behaviour |
| **T10** Text input over the analyst engine | **MODIFY (smaller)** | **The factory already exists** — `analystProviders(viewer, dataManager, {…})` at `gevActions.js:4125`. No extraction is needed, only reuse/export. Risk falls from moderate to low. **Condition unchanged: do not let the text surface construct its own engine** |
| — | **NEW: I1b ring-containment fix** | **PRECEDED BY / FOLDED INTO I1** — added because it is a confirmed shipped correctness bug (A1) that I7 would otherwise inherit. Not a Step 0 item: it belongs with the spatial authority so the fix and the module land together |

**Nothing removed from Step 0.** Three items are smaller than originally scoped (T3, T8's precondition, T10), one is a new addition inside I1 (I1b), and no item was found redundant.

**Revised Step 0 shape.** T1, T2, T4, T5, T6, T7, T9 are independent and can land in any order — all are documentation, comments, tests, de-duplication or additive display, and none requires the spatial authority. **T3 and T10 should follow I1a–I1c**, and **T8 must**, because both touch modules that I1 changes and both benefit from the authority existing first. That reordering is the audit's only substantive change to the sequence.

---

## §E — Summary

**FIX BEFORE (three):**
1. **A1 — ring containment across the antimeridian.** A confirmed, reproducible wrong answer in shipped code, inherited by I7 if left.
2. **A2 — the scoped spatial authority** (`geo.js` + freeze check + the third of sites that are exported or correctness-bearing), including **I1b**.
3. **A8 — the spatial architecture check**, additively, as part of I1a.

**Plus A9, which is already Step 0's T1.**

**FIX WHEN REACHED (five):** analyst-engine generalization (A3), record-accessor conformance (A4), feed state and coverage (A5), event payload (A6), provenance/licence registry (A7). Each has a real weakness; none is a prerequisite for anything before it, and each is best designed with its consumers in hand.

**LEAVE ALONE:** everything in §B — notably the 4,337-line voice module, the ~25 camera-relative distance sites, `lifecycle.js`, the share-link codec, and the render governor.

**The audit's single most important conclusion:** the plan did not need a large cleanup before it starts. It needed **one correctness fix, one new module with a frozen boundary, and one enforcement script** — and the discovery that two things previously assumed to need building (`analystProviders`' factory and the `getAnalystRecords` contract) already exist, which makes Step 0's risk lower than the plan first estimated.
