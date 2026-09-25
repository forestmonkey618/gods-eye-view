# Provenance authority — I3a contract and current state

This is the current-state reference for the GEV provenance contract. Design
history and per-slice audit reports live in `docs/planning/`
(`I3-DESIGN-REDUCTION-ADDENDUM.md`, `I3a-FINAL-CONTRACT-REVIEW.md`,
`I3b-IMPLEMENTATION-REPORT.md`, `I3c-IMPLEMENTATION-REPORT.md`).

Provenance answers one question: **for a CURRENT record, where did each value
come from, and when was it reported / received?** It is deliberately distinct
from canonical entity identity (I2), store attribution, lifecycle eligibility,
freshness (feed state / I5), rendering visibility, history, inferred events
(I9) and departure/disappearance semantics. None of those may be read into a
descriptor, and a descriptor may not be read as any of them.

## Core rule — unknown must remain unknown

- A fact is carried **only when the underlying source actually supplied it
  with that meaning**. Absence is valid and is represented as `null` or a
  missing field, never as a guess.
- If GEV only knows when it received or processed a record, that is recorded
  as receipt time — it is **never** represented as the source report time.
- No current wall-clock time, polling time, object-creation time or receipt
  time may fill a missing report time.
- No provider, sensor, collection method, confidence, quality, departure or
  movement event is inferred from fields that do not establish it.

## Authority

**`src/data/provenance.js`** is the single provenance normalization/validation
authority. Every descriptor in the application is produced by its
`createProvenance`; no consumer constructs descriptors by hand.

Invariants (enforced by `scripts/check-provenance-authority.mjs`, wired into
`npm run check:boundaries`):

- Zero-dependency leaf: no imports at all, no Cesium, no DOM, no network.
- No wall clock inside the authority: it cannot manufacture a time.
- Deterministic: output is a pure function of the explicitly supplied facts.
- Immutable: descriptors are `Object.freeze`d; input objects are not mutated.
- The epistemic vocabulary is defined here and only here.
- The identity surface (`entityKey.js`, `recordIndex.js`,
  `currentRecordIndex.js`) and the freshness authority (`feedState.js`) are
  provenance-unaware; the record stores that own the sidecars are
  Cesium/DOM-free, so rendering visibility cannot influence provenance.

### API

```js
import { EPISTEMIC, createProvenance, isValidProvenance } from 'src/data/provenance.js';
```

- `EPISTEMIC` — frozen vocabulary: `REPORTED`, `DERIVED`, `MODELED`,
  `INTERPRETED`. (No `OBSERVED`/`PREDICTED`/`SIMULATED`/`UNKNOWN` classes —
  see the planning addendum §1–8 for the reduction rationale. "Unknown" is
  the *absence* of a descriptor, not a class.)
- `createProvenance({ epistemic, sourceId, reportedAtMs, receivedAtMs, via })`
  — validates and returns a **frozen** descriptor with exactly the five keys
  below. Throws `TypeError` on malformed input; callers that catch it store
  nothing (absence stays honest).
- `isValidProvenance(value)` — narrow shape validator; also rejects any
  forbidden field (`confidence`, `ageMs`, `freshness`, `stale`, `history`,
  `observationId`, `storeId`, …) present on the value.

### Field semantics — exact

| Key | Meaning | Rules |
|---|---|---|
| `epistemic` | Epistemic class of the value | One of the four frozen values. `REPORTED` = externally supplied fact, preserved after safe non-semantic normalization (trim, case, fixed-factor unit conversion); the truth claim is the source's. `DERIVED` = deterministic, inspectable computation from reported/modeled inputs (requires `via`). `MODELED` / `INTERPRETED` are defined for future use (see "Left unknown"). |
| `sourceId` | Stable machine identity of the **external** origin | Required for `REPORTED`, optional otherwise. Grammar: 1–128 chars of `[a-z0-9._:-]`, trimmed, no whitespace. Current values in production: `opensky`, `adsb.lol`, `adsbdb`, `aisstream`. It is **not** the `storeId` (GEV store ownership, I2), not a human label, and not validated against a registry (I4 will own existence validation later). |
| `reportedAtMs` | **Source report time** — when the source says the fact was reported/observed, in epoch ms | Optional; `null` whenever the source did not supply a trustworthy time *for that value with that meaning*. Finite positive number or `null` only. Never filled from receipt time, polling time or the wall clock. |
| `receivedAtMs` | **Client receipt/ingest time** — when GEV received/processed the data carrying the value, epoch ms | Required for `REPORTED` (it is the only clock that always exists); optional for other classes. One receipt per snapshot batch in the production adapters. |
| `via` | Stable operation id for `DERIVED` values (e.g. `classification`, `airborne-history`, `render-altitude-selection`) | Required for `DERIVED`; optional `null` otherwise. A named, inspectable operation — not a free-text explanation. |

**The two clocks are never substituted for one another.** `reportedAtMs`
answers "when does the source say this is true?"; `receivedAtMs` answers
"when did GEV get it?". A descriptor with `reportedAtMs: null` is a value
whose age is **unknown** — consumers must say so, not compute a fake age.
Age itself is a query-time computation (I5 territory), never stored.

## Where provenance lives — the sidecar architecture

Provenance is a **store-local, current-state-only sidecar**, owned by the
record store, parallel to the record data:

- `FlightRecords.provenance: Map<icao24, {field: descriptor}>` — civil store
  (includes TIS-B `~…` native keys; no canonical identity is invented).
- `MilitaryFlightRecords.provenance: Map<nativeKey, {field: descriptor}>`.
- `VesselRecords.provenance: Map<mmsi, {field: descriptor}>` (unkeyed
  records carry no entry).

Rules:

- **Provenance follows the current value.** Replacement moves the descriptor;
  sticky retention keeps the *original* descriptor of the retained value; a
  synthetic fallback (e.g. the military store's coerced `0` speed/track)
  carries **no** descriptor; a forgotten record drops its descriptor set.
- **Sparse and immutable.** Only fields with a truthful origin carry a
  descriptor; descriptors are frozen; public accessors return fresh copies.
- **Current state only.** One descriptor per field per record — no arrays, no
  previous values, no history, no trajectory.
- **Accessors:** each of the Flights, Military Flights and AIS Vessels layers
  exposes `getProvenanceMap()` (copy-safe, keyed by the store's own native
  key). Canonical consumers join via `getCurrentEntities()`, which returns
  both `entityKey` and the native id. A future canonical (entityKey-keyed,
  cross-store) provenance projection is deliberately **not** built — no
  consumer requires one yet.
- **I2 is untouched.** `getCurrentEntities()` remains the I2 primitive-only
  contract; `recordIndex` / `currentRecordIndex` are provenance-unaware; a
  canonical entity held by two stores keeps two independently attributable
  current records, each with its own provenance.

## What each production feed actually supplies

Verified against the production adapters and stores at HEAD. "—" = the feed
does not expose the fact; GEV records absence, never a substitute.

### Flights store (OpenSky primary, 250 nm adsb.lol regional fallback)

`sourceId` is `opensky` when the `/api/opensky` route answered from the
primary path (the server sets no `X-Flight-Source` there — a proven route
invariant) and `adsb.lol` on the regional fallback
(`X-Flight-Source: adsb.lol`, `X-Flight-Coverage: 250nm regional fallback`).
A single `receivedAtMs` (client receipt) is captured once per snapshot batch.

| Current field(s) | `reportedAtMs` from | `sourceId` |
|---|---|---|
| position, baro `altitude`, `geoAltitudeM`, `onGround` | OpenSky `time_position` (row 3) | `opensky` / `adsb.lol` |
| `velocity`, `true_track`, `verticalRate`, `callsign`, `originCountry`, `category`, `lastContactEpochMs` | OpenSky `last_contact` (row 4); falls back to position time when the row carried no `last_contact`; `null` when neither | same |
| `typeCode`, `typeName`, `registration`, `airline`, `route` (adsbdb enrichment) | **none** — adsbdb states no event time | `adsbdb` |
| `klass`, `wasAirborne`, `renderAltitudeM` | — (locally computed) | DERIVED, `via` `classification` / `airborne-history` / `render-altitude-selection`; no `sourceId` |

Never tagged: `turnRateDps` (windowed motion-model input, not a current
reported value), `observedReceiptMs`, `sourceReference`, geoid/floor caches.

### Military store (adsb.lol)

`sourceId` is `adsb.lol` (adapter-supplied, one per batch). `receivedAtMs` is
the client receipt. readsb exposes exactly **two** ages per aircraft —
`seen_pos` (position last updated) and `seen` (any message last received) —
no per-field ages. GEV's `observedAtMs` is receipt minus the proxy cache age
(`X-ADS-B-Cache-Age-Ms`; equals receipt on cache MISS).

| Current field(s) | `reportedAtMs` from | `sourceId` |
|---|---|---|
| position, `altitudeFt`, `geoAltitudeM`, `onGround` | `observedAtMs − seen_pos·1000` | `adsb.lol` |
| `speedMps`, `track`, `verticalRateMps`, `callsign`, `lastContactEpochMs` | `observedAtMs − seen·1000`; **`null` when the row has no `seen`** — no fallback to position time | `adsb.lol` |
| `type`, `registration`, `operator` (database lookups delivered by adsb.lol) | **none** — a database attribute has no event time; `seen` would be false precision | `adsb.lol` |
| `klass`, `wasAirborne`, `renderAltitudeM` | — | DERIVED, same `via` vocabulary; no `sourceId` |

A missing `gs`/`track` is stored by the store as a synthetic `0` (a
pre-existing value-semantics issue, reported separately) and — by a frozen
provenance rule — a reported `0` is REPORTED while the synthetic `0` carries
no descriptor.

### Vessels store (AISStream)

`sourceId` is `aisstream`. `receivedAtMs` is the store's injected clock at
reconcile time (one per batch). GEV's normalized AIS row carries **one**
usable position timestamp — `last_position_epoch` (s→ms) or
`last_position_UTC` — not separate static-vs-position message times.

| Current field(s) | `reportedAtMs` from | `sourceId` |
|---|---|---|
| position, `speed`, `course`, `heading` | `last_position_epoch·1000` else parsed `last_position_UTC` else **`null`** | `aisstream` |
| `name`, `imo`, `type`, `destination` (static attributes) | **`null`** — no static-message time is retained by the input; GEV does not borrow the position time for them | `aisstream` |

Unkeyed rows (no MMSI) carry no provenance entry.

## Rendering visibility has no effect

The sidecars live in the record stores, which are Cesium/DOM-free (frozen by
the boundary check). A billboard's `show`, the collection's `show`, or any
scene state neither creates, removes nor alters a descriptor. Layer
*eligibility* for the I2 current-record index is a separate adapter concern
(`currentRecordIndex.js`); it is likewise never consulted as an epistemic
input.

## What is intentionally left unknown (known gaps)

- **Vessel static vs position message times.** AIS distinguishes them; GEV's
  current input does not. Static fields are `reportedAtMs: null`, and the
  limitation is stated here rather than papered over.
- **Snapshot publish time** (OpenSky `payload.time`, AIS
  `newestPositionAt`) is feed-level metadata owned by feed state (I5), not a
  per-field `reportedAtMs`.
- **adsbdb upstream fetch time** is stripped by the proxy; only the client
  receipt is represented. Surfacing it is an age/freshness concern (I5).
- **`sourceId` existence is not validated here** — the provenance authority
  validates grammar only. Resolving a `sourceId` to a known source is I4: the
  canonical Source Registry (`src/data/sourceRegistry.js`, see
  [SOURCE-REGISTRY.md](SOURCE-REGISTRY.md)) answers it at query time, and
  `createProvenance` deliberately stays independent of registry membership so
  unknown/future source ids remain representable at ingestion.
- **Freshness/staleness is not in the descriptor.** `feedState.js`'s seven
  states and any age computation remain separate (I5).
- **`MODELED` and `INTERPRETED` are unassigned in production.** The primitive
  supports them (satellite SGP4 propagation, ground-floor model values,
  AI narration would use them); no production value carries them yet, and
  none will be forced onto values that are not modelled or interpreted.
- **No quality/confidence fields** — upstream quality data (readsb
  NIC/NAC, AIS position accuracy) is not ingested by GEV and is deliberately
  not speculated on.
- **No canonical cross-store provenance projection** — the sidecars are
  store-local by design; a canonical join is an adapter concern for when a
  consumer needs it.
- **`turnRateDps` is untagged on purpose** — a windowed change measurement
  over the motion history, not a current reported value (I9-adjacent).

## Tests

| File | Guarantees |
|---|---|
| `src/data/provenance.test.mjs` | Vocabulary, REQUIRED/optional rules, malformed metadata rejection (including malformed *optional* values), absence as `null`, no wall clock, no forbidden fields, immutability, input non-mutation, determinism, `isValidProvenance`. |
| `src/layers/flights/provenance.test.mjs`, `provenance.b.test.mjs`, `provenance.enrichment.test.mjs` | Civil store: report/receipt mapping, sticky retention keeps the original descriptor, replacement moves it, synthetic fallbacks carry none, source switch truthfulness, enrichment provenance, DERIVED fields, current-state-only, copy safety, TIS-B native keys, **missing source time stays null (never wall clock/receipt)**, **observation input not mutated**. |
| `src/layers/military/provenance.test.mjs`, `src/data/militaryFlights.provenance.test.mjs` | Military store: `seen_pos`/`seen` mapping, no borrowed time when `seen` is absent, database attributes `null`, synthetic-0 frozen rule (store-level and end-to-end), DERIVED guards, same-ICAO civil-vs-military store-local independence. |
| `src/layers/vessels/provenance.test.mjs` | Vessels: position-timestamp mapping, static fields `null`, unkeyed/malformed handling, eviction and cap cleanup, copy safety. |
| `src/data/flights.provenance.lifecycle.test.mjs` | Civil lifecycle: no descriptor outlives its record (absent sweep, suppression, activation sweep, init/destroy), **rendering visibility has no effect**. |
| `src/sources/live/standalone.provenance.test.mjs` | Adapter truthfulness: `X-Flight-Source` header mapping (primary/fallback/future provider), one receipt per batch. |

`scripts/check-provenance-authority.mjs` freezes the architecture: authority
purity (zero imports, no clock, no Cesium/DOM/network, locked vocabulary, no
forbidden descriptor keys), single construction authority (no second
`EPISTEMIC`, every `createProvenance` call site imports the authority),
I2/freshness separation, and record stores free of Cesium/DOM.
