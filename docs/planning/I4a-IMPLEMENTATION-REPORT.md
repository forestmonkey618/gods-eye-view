# I4a IMPLEMENTATION REPORT — Canonical Source Registry Foundation

**Date:** 2026-09-25
**Base:** `main` @ `53ffda073edcbb5db9ca4d9740f2942208e85b00` (merge commit of PR #7 / I3a provenance finalization)
**Branch:** `arena/01a0d6bd-gods-eye-view`
**Status:** I4a implemented and gated locally; PR opened; **STOPPED for owner review — not merged.** I3 (provenance), I5 (freshness) and all UI were NOT reopened.

Scope discipline: this slice is the **minimal canonical registry of static
external-source identity and description**. No freshness, lifecycle, coverage,
credentials, UI, source selection, AOIs, events, history, confidence, ranking
or switching. The military `speedMps`/`track` `?? 0`/`|| 0` sticky-retention
issue is explicitly out of scope and untouched.

---

## Part A — Architectural inspection (before any change)

Searched the repository for every source/provider/feed/registry/attribution/
license/URL/coverage/`sourceId` concept: `src/data/provenance.js`,
`docs/PROVENANCE.md`, `src/data/feedState.js`, `src/data/dataCredits.js`,
`src/data/transitFeeds.js`, `src/data/lifecycle.js`, `src/data/layerState.js`,
`militaryRegistry.js` / `tr3bRegistry.js` / `pickRegistry.js`, `src/sources/**`,
`src/sources/live/**`, `server/providers/**`, layer `records`/`queries`/
`ingestion`, source-tray/UI code, `scripts/package-boundaries.json`, the
import-direction/authority checks, and `docs/planning/**` (MASTER-PLAN,
REFERENCE).

### A.1 Verdict — no competing authority existed; a new module was necessary

| Candidate | What it actually is | Reused as I4? |
|---|---|---|
| `src/data/provenance.js` (I3) | "This value came from sourceId X." Validates sourceId **grammar only**; its own comments and `docs/PROVENANCE.md` defer existence/description to I4. | No — kept as-is (see Part C). |
| `src/data/dataCredits.js` | Cesium attribution **display** surface (credit HTML; imports Cesium). Keys are credit keys (`adsblol`), not provenance ids (`adsb.lol`). REFERENCE.md itself calls I4's registry "the structural fix". | No — retained as display surface; referenced. |
| `src/data/transitFeeds.js` `TRANSIT_FEED_REGISTRY` | Per-feed specialization (GTFS-RT catalog keyed by transit feed id; `license`/`licenseUrl`/`attribution`/`terms`). MASTER-PLAN: "retain as a specialisation". | Not merged — its descriptor field shape is the **precedent** for `license`/`licenseUrl`/`attribution`. |
| `src/data/militaryRegistry.js`, `tr3bRegistry.js`, `pickRegistry.js` | Military-ICAO classification, easter-egg conversions, scene pick ownership. | No. |
| `src/data/lifecycle.js`, `src/data/layerState.js` | Layer lifecycle/serialization (`LAYER_STATE_REGISTRY`: enabled/visible state). | No — lifecycle is an explicit I4a exclusion. |
| `src/data/feedState.js` | Freshness states (I5). | No — untouched. |
| Layer `queries.js` `sourceId:` fields | Detection-declutter identity (`object.sourceId` = icao24/mmsi/key). | No — different namespace. |
| `*_OVERLAY_SOURCE_ID` constants | worldOverlay source ids (`bhote-koshi-witnesses`, …). | No — different namespace. |

MASTER-PLAN already names the module (`src/data/sourceRegistry.js` + tests);
I4a follows that naming and the `createProvenance`/`createMilitaryRegistry`
factory-plus-authority precedent.

### A.2 Production `sourceId` audit

Traced every `createProvenance` construction site (`layers/flights/records.js`,
`layers/flights/enrichmentCore.js`, `layers/military/records.js`,
`layers/vessels/records.js`) and every adapter that supplies `sourceId`
(`src/sources/live/{standalone,aircraft,vessels}.js`). The complete production
set is exactly four external origins:

| `sourceId` | Used by | Established metadata |
|---|---|---|
| `opensky` | Flights store, primary path (server sets no `X-Flight-Source` header — route invariant) | name/homeUrl/license/attribution from `DATA_SOURCES.md` + `dataCredits.js` |
| `adsb.lol` | Flights store regional fallback (`X-Flight-Source: adsb.lol`) + Military store (all reported fields) | name/homeUrl/license/attribution from `DATA_SOURCES.md` + `dataCredits.js` (ODbL 1.0; `licenseUrl` = the canonical ODbL URL already used elsewhere in-repo) |
| `adsbdb` | Flights store enrichment (type/registration/airline/route; `enrichmentCore.js`) | name in code/docs; `homeUrl` `https://www.adsbdb.com` **verified against the live service** (repo proxy code uses `api.adsbdb.com`). **License/attribution UNKNOWN — intentionally absent** (compliance gap called out below) |
| `aisstream` | Vessels store (all reported fields) | name/homeUrl/attribution from `DATA_SOURCES.md` + `dataCredits.js`. **`license` absent** — no formal license is established (the `DATA_SOURCES.md` terms/status note is documentation context only; see Part F) |

Nothing else is a production provenance origin today: no store ids, no layer
ids, no overlay ids, no detection ids, no transit feed ids, no map providers,
no retired names. (Most `dataCredits.js` sources — CelesTrak, USGS, OSM packs,
CCTV authorities — never appear as provenance `sourceId`s yet and are
deliberately NOT registered.)

**Questionable metadata not guessed:** `adsbdb` has no `DATA_SOURCES.md` row
and no `dataCredits.js` entry anywhere in the repository; its descriptor
carries only id + name + verified home URL. AISStream has no formal license
to name — its `license` field is **absent**, and the documented terms/status
statement is retained as documentation context only (corrected after owner
review, see Part F). OpenSky's license URL is not established in-repo, so
`licenseUrl` is absent there.

---

## Part B — Design (I4a contract)

New module `src/data/sourceRegistry.js` + `src/data/sourceRegistry.test.mjs`.
Full contract: `docs/SOURCE-REGISTRY.md`.

- **API:** `createSourceRegistry(entries)` (single construction path; throws on
  malformed entries, unknown keys, duplicate `sourceId`s; copies inputs;
  freezes everything) and the canonical accessors `getSourceDescriptor(id)`
  (frozen descriptor or `null`), `isRegisteredSource(id)`, and
  `listSourceDescriptors()` (frozen, sorted by `sourceId`, deterministic).
  Lookup is exact-match only — no silent aliasing/normalization.
- **Descriptor contract (closed key list):** `sourceId` (required, provenance
  grammar), `name` (required); optional `homeUrl`, `license`, `licenseUrl`,
  `attribution` — absent (missing key) when not established. Unknown keys
  throw at construction, so freshness/lifecycle/credential/store state can
  never be smuggled in.
- **Module purity:** zero imports (like `provenance.js`) — feed state,
  lifecycle, Cesium, DOM, network, wall clock and env are unreachable by
  construction.
- **Identity rule:** the key is the exact provenance `sourceId`. `sourceId` ≠
  `storeId` ≠ layer id; descriptors carry no store/layer binding, so one store
  using several sources (civil flights: `opensky` + `adsb.lol` + `adsbdb`)
  stays representable and truthful.
- **I3 unchanged:** `provenance.js` is byte-identical to `main`. Membership
  validation lives at query boundaries; `createProvenance` keeps accepting
  well-grammatical unknown ids.

### Boundary guard (justified — concrete rules, not filenames)

`scripts/check-source-registry-authority.mjs` added to `npm run check:boundaries`
(sixth check; `docs/CODE-BOUNDARIES.md` updated). It freezes:

1. Authority purity: zero imports; no `Date.now`/`new Date(`/`Date(`; no
   Cesium/DOM/network/storage; no `process.env`/`import.meta.env`.
2. Descriptor hygiene: freshness/lifecycle/credential/store/epistemic keys may
   never appear as object-literal keys in the authority.
3. Single construction path: `createSourceRegistry` appears only in the
   authority (tests excluded); no other `src/`/`server/` module defines the
   lookup surface or a `SOURCE_REGISTRY`/`SourceRegistry` singleton — a
   competing registry cannot appear. (Consumers *calling* the lookups is
   allowed — later I4 work must not need guard edits.)
4. Provenance independence: `provenance.js` never references the registry.
5. Grammar mirror: the `sourceId` charset literal `/^[a-z0-9._:-]+$/` must
   exist in both authorities so the namespaces cannot drift.

This guards seven concrete architectural rules that tests alone cannot fully
protect (tests can't see modules nobody has written yet); unit tests add the
behavioral layer (immutability, duplicates, purity under poisoned clock/env).

---

## Part C — Files changed

| File | Change |
|---|---|
| `src/data/sourceRegistry.js` | NEW — I4a authority + four production entries |
| `src/data/sourceRegistry.test.mjs` | NEW — 15 focused tests (see `docs/SOURCE-REGISTRY.md` Tests table) |
| `scripts/check-source-registry-authority.mjs` | NEW — boundary freeze check |
| `package.json` | `check:boundaries` now also runs the source-registry authority check |
| `docs/SOURCE-REGISTRY.md` | NEW — authority contract, entries, namespace rules, I3/I5 relationships, exclusions, gaps |
| `docs/CODE-BOUNDARIES.md` | check list 5 → 6, sixth check described |
| `docs/PROVENANCE.md` | I4 gap bullet refreshed to point at the implemented registry (semantics unchanged) |
| `docs/planning/I4a-IMPLEMENTATION-REPORT.md` | NEW — this report |

---

## Part D — Gates and falsification

Local gates (Node 22 sandbox; CI runs Node 24.14.0 + 26.x):

- `npm run doctor` — OK (reports unconfigured optional credentials in the bare
  sandbox, as expected; `--json` policy path is what CI runs)
- `npm run format:check` — OK
- `npm run check:boundaries` — OK (import directions, package boundaries,
  spatial, identity, provenance, **source-registry**)
- `npm test` — full unit suite green (2 allocation microbenchmarks skipped on
  non-24 runtime per the calibrated-runtime rule; CI runs them on 24.14.0)
- `npm run build` — production bundle OK

Mutation/falsification pass — each representative mutation is caught by the
named protection, then reverted:

| Mutation | Caught by |
|---|---|
| duplicate sourceId accepted (silent overwrite) | `createSourceRegistry` throws — unit test "duplicate source IDs cannot silently overwrite one another" |
| descriptor becomes mutable | `Object.freeze` removed — immutability/mutation unit tests |
| registry reads `Date.now()` | source-registry authority check (purity) + poisoned-clock fresh-import unit test |
| registry imports `feedState.js` | authority check (zero-import leaf) |
| registry imports Cesium | authority check (zero-import leaf) |
| unknown id accidentally resolves | unit test "unknown source IDs do not magically become registered" |
| provenance validates registry membership | authority check (provenance must not reference the registry) + unit test "I3 provenance semantics stay unchanged and membership-free" |

---

## Part E — Remaining I4 gaps (documented in `docs/SOURCE-REGISTRY.md`)

- Coverage/cadence/latency/key-requirement/failure-mode descriptors
  (MASTER-PLAN I4 full vision) — later I4 slices extend the closed key list
  deliberately.
- `adsbdb` license/attribution unknown — compliance follow-up to determine and
  record them (`DATA_SOURCES.md` row + `dataCredits.js` credit also missing).
- Machine compliance flags (e.g. non-commercial) — no existing vocabulary.
- Source descriptors for non-provenance data sources (CelesTrak, USGS, …) as
  layers begin recording truthful provenance sourceIds.
- `dataCredits.js` ↔ `DATA_SOURCES.md` sync enforcement.
- Parametric sensor geometry — deferred to I4/I5 evaluation (MASTER-PLAN D10).
- Registry-based query helpers — added when a consumer exists.

---

## Part F — Owner-review correction (2026-09-25)

PR #8 review found one semantic issue: the AISStream entry encoded
descriptive/legal-policy prose as a canonical `license` value —

`license: 'Free, beta, no formal ToS; AIS is a public broadcast'` —

even though the audit itself established that AISStream has **no formal
license to name**. Under I4a's governing rule (unknown/unestablished metadata
stays absent), policy prose is documentation context, not a license value.

**Change:** the AISStream `license` field is removed. The `DATA_SOURCES.md`
terms/status statement is retained as **contextual documentation** (a labeled
note in `docs/SOURCE-REGISTRY.md` and in `DATA_SOURCES.md` itself), explicitly
not a canonical `license` value. The schema is **not** broadened with a
`terms`/`notes`/similar field — that can be considered in a later I4 slice if
a real consumer requirement appears. A regression test locks the rule
(`registry: unestablished licenses stay absent — policy prose is not a
license`).

**Same-rule re-audit of the other three entries** (established metadata kept;
no changes made for symmetry):

| Entry | `license` / related fields | Verdict |
|---|---|---|
| `adsb.lol` | `license: 'ODbL 1.0'`, `licenseUrl` (canonical ODbL 1.0 text, URL mapping already used in-repo), `attribution: 'adsb.lol (ODbL)'` | **Retained** — `ODbL 1.0` is an actual established license identifier (DATA_SOURCES.md License column), and the attribution is the established attribution line. Genuinely supported fields. |
| `adsbdb` | `license`/`attribution` absent | **Unchanged** — already honest. |
| `opensky` | `license: 'Non-commercial research/education license'`, `licenseUrl` absent, `attribution` = required OpenSky citation | **Retained — judgment call, flagged for owner visibility.** Unlike AISStream, an actual license regime IS established (DATA_SOURCES.md License column plus its compliance paragraph: non-commercial; live operational use may require prior written agreement). The value is a compact license designation (noun phrase naming the license category — the repo's canonical license wording for OpenSky), not "no formal license" status prose. If the owner prefers a stricter rule where `license` may only carry standard license identifiers, this value would also become absent — under the rule as reviewed ("when no actual license is established"), it is retained. |
| `aisstream` | `license` removed; `name`/`homeUrl`/`attribution` (`AISStream.io (courtesy)` — the established DATA_SOURCES.md attribution line) | **Corrected** — the one prose-as-license value. The `(courtesy)` attribution wording is the documented attribution column value and remains genuinely supported. |
