# Source Registry authority — I4a contract and current state

This is the current-state reference for the GEV Source Registry (I4a). Design
history for the wider I4 vision lives in `docs/planning/MASTER-PLAN.md`; the
I4a implementation audit is in `docs/planning/I4a-IMPLEMENTATION-REPORT.md`.

The registry answers exactly one question: **"What known external source does
this stable `sourceId` refer to?"** It is static identity and description for
external origins — nothing else. It is deliberately not feed state, not
freshness, not lifecycle, not coverage, not credentials, not provenance
observations, not attribution rendering, not UI and not source selection. Each
of those stays owned elsewhere (see "What is intentionally not represented").

## Authority

**`src/data/sourceRegistry.js`** is the single canonical source registry. It
is a zero-dependency leaf — no imports at all, no Cesium, no DOM, no network,
no wall clock, no storage, no environment reads (frozen by
`scripts/check-source-registry-authority.mjs`, wired into
`npm run check:boundaries`). Output is a pure function of its frozen static
entries: deterministic and immutable from the consumer side.

There is no other source registry. `dataCredits.js` is the attribution
*display* surface (Cesium credits, HTML), `transitFeeds.js`
(`TRANSIT_FEED_REGISTRY`) is a per-feed specialization keyed by transit feed
id, and `layerState.js` (`LAYER_STATE_REGISTRY`) is the layer lifecycle
registry — none of them resolve provenance `sourceId`s, and the boundary check
rejects any module that defines a competing registry surface.

### API

```js
import {
  createSourceRegistry,
  getSourceDescriptor,
  isRegisteredSource,
  listSourceDescriptors,
} from 'src/data/sourceRegistry.js';
```

- `getSourceDescriptor(sourceId)` — the frozen descriptor for a known source,
  or `null`. Total function: unknown ids and non-strings return `null`; they
  never throw and never become registered. Lookup is **exact string match** —
  no trimming, case-folding or aliasing: two different strings are two
  different identities.
- `isRegisteredSource(sourceId)` — `getSourceDescriptor(sourceId) !== null`.
- `listSourceDescriptors()` — every registered descriptor, **deterministic
  order (sorted by `sourceId`)**, as a frozen array of frozen descriptors.
- `createSourceRegistry(entries)` — the single construction path (exported so
  tests can build fixture-only registries). Normalizes each entry, copies it
  (inputs are never mutated nor retained), freezes every descriptor, and
  **throws on malformed entries, unknown keys and duplicate `sourceId`s** — a
  second entry can never silently overwrite the first. Production entries are
  registered once inside the authority; no other `src/` or `server/` module may
  call the constructor or define the lookup surface (boundary check).

### Descriptor contract — exact

A descriptor is a frozen plain object with exactly these keys:

| Key | Required | Meaning | Rules |
|---|---|---|---|
| `sourceId` | yes | Stable machine identity of the **external** origin; the registry key | The exact `sourceId` string I3 provenance records. Grammar mirrors `provenance.js` (which owns it): 1–128 trimmed chars of `[a-z0-9._:-]`, no whitespace. Never a `storeId`, layer id, display label or URL. |
| `name` | yes | Human-readable display name | Non-empty string. Presentation text only — never identity. |
| `homeUrl` | no | Official/home URL of the source | Non-empty string, **only when established** by repository configuration/documentation or careful verification. |
| `license` | no | License/terms statement for the data | Non-empty string, only when established. May be a non-standard terms statement (e.g. "no formal ToS") when that is the documented truth. |
| `licenseUrl` | no | URL of the license text | Non-empty string, only when established. |
| `attribution` | no | Attribution line for the source | Non-empty string, only when required/known. Plain text — `dataCredits.js` owns rendered credit HTML. |

Optional keys are **absent** (missing, not `null`) when the fact is not
established. Unknown metadata is never guessed and entries are never padded to
be symmetrical. Any other key (freshness, status, enabled, coverage, keys and
secrets, `storeId`, `layerId`, epistemic fields, …) is rejected at
construction — the allowed-key list above is the entire vocabulary.

## Registered production sources

A source is registered only when current production code actually uses that
exact `sourceId` as an external provenance origin (audited against the live
adapters and record stores). As of this document, all four are the complete
production set:

| `sourceId` | `name` | What the entry means | Metadata provenance |
|---|---|---|---|
| `adsb.lol` | `adsb.lol` | The adsb.lol ADS-B network (readsb deployments): military-flight snapshots, aircraft traces, and the bounded 250 nm civil-flight fallback. `homeUrl` `https://adsb.lol`; `license` `ODbL 1.0`; `licenseUrl` the canonical ODbL 1.0 text; `attribution` `adsb.lol (ODbL)`. | `DATA_SOURCES.md` (ODbL 1.0, "adsb.lol" attribution), `dataCredits.js` |
| `adsbdb` | `adsbdb` | The adsbdb aircraft/route database (api.adsbdb.com) supplying civil-flight enrichment: type, registration, airline and route. `homeUrl` `https://www.adsbdb.com`. **`license` and `attribution` are intentionally absent** — no license or attribution is established anywhere in this repository's configuration or docs (known gap, see below). | server `providers/aircraft/enrichment.js` + verified against the public adsbdb service |
| `aisstream` | `AISStream.io` | The AISStream.io live AIS stream supplying the vessels store. `homeUrl` `https://aisstream.io`; `license` `Free, beta, no formal ToS; AIS is a public broadcast` (the documented truth — there is no formal license to name); `attribution` `AISStream.io (courtesy)`. | `DATA_SOURCES.md`, `dataCredits.js` |
| `opensky` | `OpenSky Network` | The OpenSky Network state-vector feed — the primary worldwide civil-flight snapshot. `homeUrl` `https://opensky-network.org`; `license` `Non-commercial research/education license`; `attribution` the required OpenSky citation. | `DATA_SOURCES.md`, `dataCredits.js` |

Not registered — on purpose: GEV store ids, `LAYER_STATE_REGISTRY` layer ids
(`flights`, `military`, `ais-live-vessels`, …), overlay-source ids
(`bhote-koshi-witnesses`, …), detection-declutter ids, map/basemap providers,
transit feed ids, fixture-only ids, and any historical or inferred name. Tests
may build fixture registries with fixture-only ids; those never become
production entries.

## Identity — `sourceId` vs `storeId` vs layer ID

Three namespaces, three owners, never interchangeable:

| Namespace | Example | Owner | Answers |
|---|---|---|---|
| `sourceId` | `opensky`, `adsb.lol`, `adsbdb`, `aisstream` | I3 records it; **this registry (I4) resolves it** | Which **external origin** supplied this value? |
| `storeId` | the Flights / Military Flights / AIS Vessels record stores | I2 (entity identity / store ownership) | Which GEV store currently holds this record? |
| Layer ID | `flights`, `military`, `ais-live-vessels`, `cctv`, `satellites`, … | `layerState.js` / lifecycle | Which toggleable layer renders/enables this data? |

- Display labels (`OpenSky Network`, `AISStream.io`) are never identity.
- URLs and names are never keys.
- Provider identity is never inferred from store ownership. **One store may
  truthfully carry values from several registered sources** — the civil
  flights store already does (`opensky` snapshots, `adsb.lol` fallback,
  `adsbdb` enrichment) — so descriptors carry no store or layer binding of any
  kind.
- Two ids are never silently aliased. If upstream architecture ever
  establishes two ids as the same source, that equivalence must be documented
  first and encoded deliberately; lookup itself never folds ids.

## Relationship to I3 provenance

I3 provenance (`src/data/provenance.js`, [PROVENANCE.md](PROVENANCE.md))
continues to say *"this value came from `sourceId` X."* This registry answers
*"X means this known external source."* The two meet only at query time:

- `createProvenance()` does **not** consult the registry and does not validate
  membership. Grammar-only validation stays intact, so unknown and future
  sourceIds remain representable at ingestion boundaries (a real ingestion
  property, tested).
- A provenance descriptor never carries a registry descriptor object, and a
  registry descriptor never carries per-record provenance (`epistemic`,
  `reportedAtMs`, `receivedAtMs`, `via` are absent here and forbidden there).
- Registry membership validation, where it is ever wanted, belongs at an
  integration/query boundary (`getSourceDescriptor(...) === null` says
  "unresolved"), never inside the I3 primitive.
- Both authorities use the same `sourceId` grammar (the boundary check freezes
  the two literals against drift).

## Relationship to `feedState` / I5

`src/data/feedState.js` remains the freshness authority (nominal / loading /
degraded / stale / partial / fallback / unavailable). Nothing about *when* a
source last answered is in this registry: no age, stale/fresh flags, last
fetch/attempt/update, status, errors, latency or retry state. A registered
source that has been dead for a week is still exactly as registered — the
registry states identity and description only, and I5 answers freshness.

Likewise lifecycle: a source existing here does **not** mean any layer or feed
using it is enabled, eligible, visible or loaded. Those states live in
`lifecycle.js` / `layerState.js` and are rejected as descriptor keys.

## What is intentionally not represented

- **Runtime/freshness state** (age, stale, last fetch/attempt/update, status,
  errors, latency, retry, snapshot timestamps) — `feedState.js` / I5.
- **Lifecycle state** (enabled, disabled, eligible, visible, layer active,
  module loaded) — `lifecycle.js` / `layerState.js`.
- **Dynamic coverage / AOI computation** — I5+ (`coverage.js` is a later
  module). No static coverage footprint is claimed either; see gaps.
- **Credentials and configuration** — API keys, tokens, secrets, environment
  values, credential availability, even *which key a source needs*. Source
  existence never depends on whether a credential happens to be configured.
- **Per-record provenance** — I3 sidecars.
- **Attribution rendering** — `dataCredits.js` (Cesium credit HTML) and
  `DATA_SOURCES.md` remain the display/compliance surfaces; this registry
  stores plain attribution text only.
- **Type/category taxonomy** — no source-type vocabulary exists in the
  repository today (the "live vs bundled" split is documentation prose), so
  none is invented. If I4b+ establishes one, it can extend the contract.
- **Cadence, latency budgets, key requirements, failure modes** — the wider
  MASTER-PLAN I4 vision; deliberately deferred beyond I4a (see gaps).
- **UI state, source selection/ranking/switching logic** — never here.

## Known I4 gaps

- **Coverage/cadence/latency/key-requirement/failure-mode descriptors** —
  MASTER-PLAN I4 describes these; I4a ships only static identity/description.
  Later I4 work extends this contract in place (the builder's closed key list
  widens deliberately, one review at a time).
- **`adsbdb` license and attribution are unknown** — the source is used in
  production enrichment but appears in neither `DATA_SOURCES.md`'s source
  table nor `dataCredits.js`. Its descriptor carries only what is established
  (id + name + verified home URL). Closing this is a compliance follow-up:
  determine adsbdb's actual license/terms and record attribution, then add the
  missing `DATA_SOURCES.md` row and credit.
- **Non-commercial/compliance flags** — OpenSky's non-commercial restriction
  is captured only as the `license` statement text; there is no machine
  compliance flag (none exists in the repository vocabulary yet).
- **Source descriptors beyond provenance origins** — most of
  `dataCredits.js`'s 39 credit keys (CelesTrak, USGS, OSM packs, CCTV
  authorities, …) are not yet provenance `sourceId`s in production code and so
  are not registered. As layers begin recording per-value provenance with
  their true sourceIds, those ids register here.
- **`dataCredits.js` ↔ `DATA_SOURCES.md` manual sync** — REFERENCE.md notes
  this has no enforcing test; the registry is the structural fix *for identity
  and description*, but the display surfaces are still hand-synchronized.
- **Parametric sensor geometry** (origin/azimuth/FOV/range) — explicitly
  deferred to I4/I5 evaluation per MASTER-PLAN D10; not attempted here.
- **Registry-based query helpers** (e.g. "resolve a provenance map entry to a
  descriptor for display") — no consumer exists yet; I4a establishes the
  authority first.

## Tests

| File | Guarantees |
|---|---|
| `src/data/sourceRegistry.test.mjs` | Each production source resolves with truthful identity and the production set is exactly these four; unknown/non-string ids never resolve and never alias (exact match only); lookups never mutate descriptors and all returned state is frozen; consumer mutation (descriptors, enumeration, input entries) cannot reach canonical state; enumeration is deterministic and sorted; duplicate `sourceId`s throw (including whitespace-normalizing duplicates); the registry reads no wall clock (fresh module init under a poisoned `Date.now`); descriptors are independent of credential/environment state (poisoned env, fresh import); descriptors carry no lifecycle and no rendering-visibility keys and the builder rejects such state; source ids are disjoint from `LAYER_STATE_REGISTRY` layer ids and store ids; one store can truthfully use multiple registered sources (flights → `opensky`/`adsb.lol`/`adsbdb`, vessels → `aisstream`) with no store binding anywhere; fixture-only ids resolve in fixture registries but never in the canonical one; I3 `createProvenance` semantics are unchanged and membership-free (unknown-but-valid ids still ingest). |

`scripts/check-source-registry-authority.mjs` freezes the architecture: the
authority stays a zero-import leaf free of clock/Cesium/DOM/network/storage/env
(so freshness, lifecycle, rendering and credentials cannot leak in through
imports or reads), descriptor keys stay inside the static vocabulary,
`createSourceRegistry` stays the only construction path with no competing
registry anywhere in `src/` or `server/`, `provenance.js` never references the
registry (ingestion independence), and the `sourceId` grammar literal is
mirrored between the two authorities.
